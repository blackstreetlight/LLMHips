/**
 * SkillParser.ts — 通用 AI 技能标签解析器
 *
 * 工作原理：
 *   AI 在流式输出中，可以嵌入如下格式的技能调用标签：
 *
 *     <Terminal_control>{"cmd":"whoami","timeout":10}</Terminal_control>
 *
 *   SkillParser 在 AI 流式文本中实时扫描这类标签，一旦检测到完整标签，
 *   立即调用对应 skill handler 执行，并将结果注入后续对话。
 *
 * 可扩展性：
 *   通过 SkillRegistry.register() 注册新 handler，无需修改解析核心。
 *   例如：
 *     SkillRegistry.register('Filesystem_read', filesystemHandler);
 *     SkillRegistry.register('Network_scan', networkHandler);
 *
 * AI 输出约定（写入 system prompt）：
 *   - 需要调用技能时，在回复中包含完整的 <SkillName>{...json...}</SkillName> 标签
 *   - 标签必须独占一行（方便检测），payload 为 JSON 字符串
 *   - 调用后等待结果（由前端注入 <SkillName_result> 消息）再继续输出
 */

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** Skill Handler 签名：接收 payload JSON 字符串，返回执行结果字符串 */
export type SkillHandler = (payload: string) => Promise<string>;

/** 解析到的技能调用 */
export interface SkillCall {
  skillName: string;   // 如 "Terminal_control"
  payload:   string;   // 原始 JSON 字符串
  fullMatch: string;   // 原始完整标签文本，用于从流中定位
}

// ─── 技能注册表 ───────────────────────────────────────────────────────────────

const _handlers = new Map<string, SkillHandler>();

export const SkillRegistry = {
  /** 注册一个技能 handler */
  register(skillName: string, handler: SkillHandler) {
    _handlers.set(skillName, handler);
  },

  /** 获取 handler（未注册时返回 undefined） */
  get(skillName: string): SkillHandler | undefined {
    return _handlers.get(skillName);
  },

  /** 所有已注册的技能名 */
  names(): string[] {
    return [..._handlers.keys()];
  },
};

// ─── 流式文本解析器 ───────────────────────────────────────────────────────────

/**
 * parseSkillCalls
 *
 * 在 AI 输出的文本中扫描所有已注册技能的完整调用标签。
 * 返回找到的第一个技能调用（或 null），同时返回标签之前的"干净"文本前缀。
 *
 * 调用方处理流程：
 *   1. 每次收到新的流式片段，追加到 buffer
 *   2. 调用 parseSkillCalls(buffer)
 *   3. 若返回非 null，截断 buffer，执行 skill，注入结果，重启 AI 流
 *   4. 若返回 null，继续等待更多片段
 */
export function parseSkillCalls(text: string): {
  before:    string;     // 标签之前的文本（已完整显示给用户的部分）
  call:      SkillCall;  // 找到的技能调用
  after:     string;     // 标签之后的文本（通常为空，AI 应等结果再续写）
} | null {
  for (const skillName of _handlers.keys()) {
    const openTag  = `<${skillName}>`;
    const closeTag = `</${skillName}>`;

    const startIdx = text.indexOf(openTag);
    if (startIdx === -1) continue;

    const endIdx = text.indexOf(closeTag, startIdx);
    if (endIdx === -1) continue; // 标签未闭合，等待更多数据

    const payload   = text.slice(startIdx + openTag.length, endIdx).trim();
    const fullMatch = text.slice(startIdx, endIdx + closeTag.length);

    return {
      before:    text.slice(0, startIdx),
      call:      { skillName, payload, fullMatch },
      after:     text.slice(endIdx + closeTag.length),
    };
  }
  return null;
}

/**
 * hasOpenTag
 *
 * 检查文本中是否有任意已注册技能的 "开标签"（开了但还没闭合），
 * 用于在流式接收过程中判断是否需要继续缓冲。
 */
export function hasOpenTag(text: string): boolean {
  for (const skillName of _handlers.keys()) {
    if (text.includes(`<${skillName}>`)) return true;
  }
  return false;
}
