/**
 * terminalSkillHandler.ts — Terminal_control 技能 Handler
 *
 * 职责：
 *   将 AI 输出的 <Terminal_control>{"cmd":"..."}</Terminal_control> 解析成具体命令，
 *   通过 WebSocket 发到 C# 中间层执行，等待 terminal_command_result 响应后返回结果。
 *
 * AI 调用格式示例：
 *   <Terminal_control>{"cmd":"netstat -an","timeout":10}</Terminal_control>
 *
 * 注册方式（在应用初始化时调用一次）：
 *   import { registerTerminalSkill } from '.../terminalSkillHandler';
 *   registerTerminalSkill(sendWsMessage);
 */

import { SkillRegistry } from '../SkillParser';
import { useSystemStore } from '../../../store/useSystemStore';

/**
 * 技能被禁用时返回给 AI 的特殊值。
 * 格式设计原则：
 *   - 以 [SKILL_DISABLED] 开头，让 AI 明确识别这是"技能禁用"状态，而非命令错误
 *   - 包含技能名，便于 AI 在回复中准确告知用户
 *   - 包含行动指引：不要重试，改用现有信息分析
 */
const DISABLED_RESPONSE =
  '[SKILL_DISABLED] 技能 "Terminal_control" 当前已被用户禁用，无法执行命令。\n' +
  '请在回复中告知用户该技能已关闭，并基于已有的进程信息和 ETW 行为链进行分析，不要尝试重新调用此技能。';

// ─── 等待命令结果的 Promise 注册表 ───────────────────────────────────────────
// requestId → { resolve, reject, timer }
// terminalBus.ts 中拿到结果后会调用 resolve

type PendingCommand = {
  resolve: (output: string) => void;
  reject:  (reason: string) => void;
  timer:   ReturnType<typeof setTimeout>;
};

const _pending = new Map<string, PendingCommand>();

/**
 * 由 terminalBus.ts 调用，当 bridge 返回 terminal_command_result 时解析 Promise
 */
export function resolveCommand(requestId: string, output: string, exitCode: number) {
  const pending = _pending.get(requestId);
  if (!pending) return;
  _pending.delete(requestId);
  clearTimeout(pending.timer);
  const result = exitCode === 0
    ? output || '（命令执行成功，无输出）'
    : `[退出码: ${exitCode}]\n${output}`;
  pending.resolve(result);
}

// ─── 注册到 SkillRegistry ─────────────────────────────────────────────────────

/**
 * registerTerminalSkill
 * @param sendWsMessage - 发送 WebSocket 消息的函数（从 store 获取）
 *
 * 注册后，SkillParser 检测到 <Terminal_control> 时会自动调用此 handler。
 */
export function registerTerminalSkill(sendWsMessage: (msg: object) => boolean) {
  SkillRegistry.register('Terminal_control', async (payloadStr: string) => {
    // ── 优先检查技能开关 ──────────────────────────────────────────
    // getState() 在非 React 上下文中可直接调用，读取最新持久化状态
    const { skillsEnabled } = useSystemStore.getState();
    const isEnabled = skillsEnabled['terminal'] ?? true;
    if (!isEnabled) return DISABLED_RESPONSE;

    // 解析 payload JSON
    let cmd  = payloadStr.trim();
    let timeout = 15;

    try {
      const parsed = JSON.parse(payloadStr) as { cmd?: string; timeout?: number };
      if (parsed.cmd)     cmd     = parsed.cmd;
      if (parsed.timeout) timeout = parsed.timeout;
    } catch {
      // payload 直接是命令字符串（兼容简单格式）
      cmd = payloadStr.trim();
    }

    if (!cmd) return '（命令为空，未执行）';

    const requestId = `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 发送 terminal_command 消息到中间层；若 WebSocket 未连接立即返回错误，
    // 避免傻等 17 秒超时后再抛出异常
    const sent = sendWsMessage({
      type:    'terminal_command',
      payload: { requestId, cmd, timeout },
    });
    if (!sent) {
      return '[执行失败] WebSocket 未连接，命令未送达中间层。\n' +
             '请确认 SecurityBridge 服务已启动且前端已建立 WebSocket 连接后重试。';
    }

    // 等待结果（Promise 由 resolveCommand 触发）
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        _pending.delete(requestId);
        reject(`命令执行超时（${timeout}s）`);
      }, (timeout + 2) * 1000);  // 给中间层多 2 秒的网络延迟

      _pending.set(requestId, { resolve, reject, timer });
    });
  });
}
