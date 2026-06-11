/**
 * streamWithSkills.ts — 带技能解析的 SSE 流式引擎
 *
 * 核心职责：
 *   替换各 AI 面板中的原始 SSE 读取循环，在不改变外部接口的前提下，
 *   透明地加入技能标签检测、执行和多轮对话管理。
 *
 * 工作流程（单轮）：
 *   1. 发起 /chat SSE 请求
 *   2. 逐块读取，累积到 buffer
 *   3. 实时用 parseSkillCalls() 检测是否出现完整技能标签
 *      - 未出现：安全部分文本立即 onChunk() → 实时显示给用户
 *      - 出现开标签但未闭合：暂停发送（避免把标签文本显示给用户）
 *      - 出现完整标签：触发技能执行分支（见下）
 *   4. 技能执行分支：
 *      a. onChunk(标签前文本)   ← 补发未显示的部分
 *      b. onSkillStart()        ← UI 显示"执行中"卡片
 *      c. await handler()       ← 调用 SkillRegistry 中注册的 handler
 *      d. onSkillResult()       ← UI 显示结果卡片
 *      e. onNewAITurn()         ← UI 新建一个 AI 消息气泡
 *      f. 递归调用自身（新一轮对话，携带完整历史 + 执行结果）
 *   5. 所有轮次完成后调用 onDone(finalText)
 *
 * 多轮防护：
 *   maxTurns（默认 5）限制技能调用轮数，超出后注入警告文本并结束。
 */

import { parseSkillCalls, hasOpenTag, SkillRegistry } from './SkillParser';

// ─── 回调接口 ─────────────────────────────────────────────────────────────────

export interface SkillStreamCallbacks {
  /** 新的 AI 文本（实时追加到当前消息气泡） */
  onChunk: (text: string) => void;

  /**
   * 检测到技能调用，即将执行。
   * skillName: 技能名（如 "Terminal_control"）
   * displayCmd: 用于 UI 展示的命令摘要（从 payload 解析，可能是 JSON 也可能是纯字符串）
   */
  onSkillStart: (skillName: string, displayCmd: string) => void;

  /**
   * 技能执行完成，result 是最终返回字符串（可能是正常输出，也可能是 DISABLED 或错误信息）
   */
  onSkillResult: (skillName: string, result: string) => void;

  /**
   * 技能结果注入完毕，AI 即将基于结果继续输出。
   * 调用方需要在此创建新的 AI 消息气泡，并更新 activeMsgId 使后续 onChunk 写入正确位置。
   */
  onNewAITurn: () => void;

  /** 本轮（或全部轮次）流式完成，fullText 是最终 AI 回复原始文本 */
  onDone: (fullText: string) => void;

  /** 网络或服务错误 */
  onError: (errMsg: string) => void;

  /** 判断是否仍应继续（组件卸载 / 用户切换时返回 false） */
  isActive: () => boolean;
}

// ─── 选项接口 ─────────────────────────────────────────────────────────────────

export interface SkillStreamOptions {
  /** LLM 服务基础 URL，不含路径 */
  url: string;
  /** 当前轮对话历史（role/content 格式） */
  messages: { role: string; content: string }[];
  /** 系统提示（含技能文档） */
  systemExtra: string;
  /** 除 messages/system_extra 外的额外请求体字段（engine、max_new_tokens 等） */
  fetchExtra: Record<string, unknown>;
  /** AbortController 的引用，用于中止当前请求 */
  abortRef: { current: AbortController | null };
  /** 回调集 */
  callbacks: SkillStreamCallbacks;
  /** 最大技能调用轮数，防止 AI 陷入无限调用循环，默认 5 */
  maxTurns?: number;
  /** 当前递归轮次（内部使用，外部调用时不传） */
  _turn?: number;
}

// ─── 工具：解析显示用命令摘要 ────────────────────────────────────────────────

function extractDisplayCmd(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { cmd?: string };
    return parsed.cmd ?? payload;
  } catch {
    return payload.length > 80 ? payload.slice(0, 80) + '…' : payload;
  }
}

/** 找到 buffer 中第一个技能开标签的位置，用于安全边界截断 */
function findSafeTextEnd(buffer: string): number {
  let safeEnd = buffer.length;
  for (const skillName of SkillRegistry.names()) {
    const idx = buffer.indexOf(`<${skillName}>`);
    if (idx !== -1 && idx < safeEnd) safeEnd = idx;
  }
  return safeEnd;
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

export async function streamWithSkills(opts: SkillStreamOptions): Promise<void> {
  const {
    url, messages, systemExtra, fetchExtra,
    abortRef, callbacks, maxTurns = 5,
  } = opts;
  const turn = opts._turn ?? 0;

  // 超出最大轮数保护
  if (turn > maxTurns) {
    callbacks.onChunk('\n\n> ⚠️ 已达到最大技能调用次数上限，停止继续调用。');
    callbacks.onDone('');
    return;
  }

  const ctrl = new AbortController();
  abortRef.current = ctrl;

  // buffer: 累积本轮所有 AI 输出文本
  // sentUpTo: 已经通过 onChunk 发送给 UI 的位置（index）
  let buffer   = '';
  let sentUpTo = 0;

  try {
    const resp = await fetch(`${url}/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  ctrl.signal,
      body:    JSON.stringify({ messages, system_extra: systemExtra, ...fetchExtra }),
    });

    if (!callbacks.isActive()) return;
    if (!resp.ok)   throw new Error(`服务返回 ${resp.status}`);
    if (!resp.body) throw new Error('响应体为空');

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let skillTriggered = false; // 本轮是否触发了技能调用

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!callbacks.isActive()) { reader.cancel(); return; }

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break outer;

        let chunk: string;
        try {
          const parsed = JSON.parse(payload) as { text?: string; error?: string };
          if (parsed.error) throw new Error(parsed.error);
          if (!parsed.text) continue;
          chunk = parsed.text;
        } catch { continue; /* 跳过格式错误帧 */ }

        if (!callbacks.isActive()) { reader.cancel(); return; }
        buffer += chunk;

        // ── 检测完整技能调用标签 ────────────────────────────────
        const skillResult = parseSkillCalls(buffer);
        if (skillResult) {
          reader.cancel(); // 终止当前 SSE 流
          skillTriggered = true;

          // 补发标签前尚未显示的文本
          if (skillResult.before.length > sentUpTo) {
            callbacks.onChunk(skillResult.before.slice(sentUpTo));
          }

          // 执行技能
          const { call } = skillResult;
          const displayCmd = extractDisplayCmd(call.payload);
          callbacks.onSkillStart(call.skillName, displayCmd);

          const handler = SkillRegistry.get(call.skillName);

          // 单独 try-catch 技能 handler，确保 onSkillResult 无论如何都会被调用，
          // 避免 handler reject 时 skill 卡片永远停在"执行中"状态
          let result: string;
          try {
            result = handler
              ? await handler(call.payload)
              : `[未知技能] "${call.skillName}" 未注册，请检查技能配置。`;
          } catch (handlerErr) {
            result = `[技能执行失败] ${handlerErr instanceof Error ? handlerErr.message : String(handlerErr)}`;
          }

          callbacks.onSkillResult(call.skillName, result);

          // 构建下一轮对话历史
          // assistant 消息内容 = 技能标签前的文字（AI 的分析文本）
          // user 消息内容 = 执行结果（前端注入，模拟"工具返回"）
          const assistantContent = skillResult.before.trim() || `[正在调用 ${call.skillName}]`;
          const toolResultContent = `[${call.skillName} 执行结果]\n${result}`;

          const nextMessages = [
            ...messages,
            { role: 'assistant', content: assistantContent },
            { role: 'user',      content: toolResultContent },
          ];

          // 通知 UI 开始新的 AI 消息气泡
          callbacks.onNewAITurn();

          // 递归：发起下一轮对话
          await streamWithSkills({ ...opts, messages: nextMessages, _turn: turn + 1 });
          return;
        }

        // ── 无完整技能标签：按安全边界发送文本 ─────────────────
        if (hasOpenTag(buffer)) {
          // 开标签已出现但未闭合：只发送标签之前的安全文本
          const safeEnd = findSafeTextEnd(buffer);
          if (safeEnd > sentUpTo) {
            callbacks.onChunk(buffer.slice(sentUpTo, safeEnd));
            sentUpTo = safeEnd;
          }
          // 标签及之后的内容继续缓冲，等待闭合标签
        } else {
          // 无技能标签：实时发送全部新文本
          if (buffer.length > sentUpTo) {
            callbacks.onChunk(buffer.slice(sentUpTo));
            sentUpTo = buffer.length;
          }
        }
      }
    }

    if (!callbacks.isActive()) return;
    if (skillTriggered) return; // 已在技能分支处理

    // 流正常结束：发送剩余缓冲文本，通知完成
    if (buffer.length > sentUpTo) {
      callbacks.onChunk(buffer.slice(sentUpTo));
    }
    callbacks.onDone(buffer);

  } catch (err) {
    if (!callbacks.isActive()) return;
    if (err instanceof Error && err.name === 'AbortError') return;
    const msg = `⚠️ 无法连接推理服务（${url}）\n错误：${err instanceof Error ? err.message : '未知错误'}`;
    callbacks.onError(msg);
  }
}
