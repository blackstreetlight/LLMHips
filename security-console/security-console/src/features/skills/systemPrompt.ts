/**
 * systemPrompt.ts — AI 系统提示构建器
 *
 * 职责：
 *   将 AI 角色定义、技能清单（Manifest）、技能约定（Contracts）
 *   按需组合成最终注入给 AI 的 system_extra 字符串。
 *
 * 使用方式：
 *
 *   // 通用分析 AI（含终端技能）
 *   const systemPrompt = buildSystemPrompt({ skills: ['terminal'] });
 *
 *   // 不含技能的纯分析 AI（ProcessBehaviorView 初始状态）
 *   const systemPrompt = buildSystemPrompt({ skills: [] });
 *
 *   // 含进程上下文的分析模式（ProcessBehaviorView 点击研判报告后）
 *   const systemPrompt = buildSystemPrompt({
 *     skills: ['terminal'],
 *     contextBlock: buildProcessContext(ev, etwEvents),
 *   });
 *
 * 扩展新技能：
 *   1. 在 contracts/ 下新建约定文档（export const XXX_CONTRACT = ...）
 *   2. 在 CONTRACT_MAP 中注册
 *   3. 在 manifest.ts 的 SKILLS_TABLE 追加一行
 *   无需修改此文件其他部分。
 */

import { SKILLS_MANIFEST } from './manifest';
import { TERMINAL_CONTRACT } from './contracts/terminal';

// ─── Skill 名称类型（TypeScript 枚举，防止拼写错误）────────────────────────────

export type SkillName = 'terminal';

// ─── Contract 注册表（新增技能在此追加）─────────────────────────────────────────

const CONTRACT_MAP: Record<SkillName, string> = {
  terminal: TERMINAL_CONTRACT,
};

// ─── AI 基础角色定义 ──────────────────────────────────────────────────────────

const BASE_ROLE = `
你是 Sentinel 安全控制台的 AI 研判助手，专注于 Windows 端点安全分析。

核心能力：
- 分析进程行为、ETW 事件链、注册表/文件/网络异常
- 进行 ATT&CK 战术映射（Tactic / Technique / Sub-technique）
- 评估风险等级，给出阻断 / 放行 / 持续观察的处置建议
- 生成 IOC 指标（文件哈希、IP、域名、注册表键等）

回复风格：
- 使用 Markdown 格式，结构清晰（标题、列表、表格）
- 关键威胁信息用加粗标注
- 技术术语准确，避免冗余解释
- 给出具体可操作的建议，不说废话
`.trim();

// ─── 构建器 ───────────────────────────────────────────────────────────────────

export interface BuildSystemPromptOptions {
  /**
   * 需要注入的技能列表。
   * 会将 Manifest + 对应 Contracts 一起注入。
   * 传空数组 [] 表示纯对话模式，不注入任何技能文档。
   */
  skills?: SkillName[];

  /**
   * 额外的上下文块（如进程详情、ETW 事件链）。
   * 若提供，会追加在技能文档之后。
   */
  contextBlock?: string;
}

/**
 * buildSystemPrompt
 *
 * 生成最终注入 AI 的系统提示字符串。
 * 结构：角色定义 → 技能清单 → 技能约定 → 上下文块
 */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
  const { skills = [], contextBlock } = options;

  const parts: string[] = [BASE_ROLE];

  if (skills.length > 0) {
    // 注入技能清单（Manifest）
    parts.push('---');
    parts.push(SKILLS_MANIFEST);

    // 注入各技能的详细约定（Contracts）
    parts.push('---');
    parts.push('# 技能详细约定');
    for (const skill of skills) {
      const contract = CONTRACT_MAP[skill];
      if (contract) parts.push(contract);
    }
  }

  // 注入进程/事件上下文块（如果有）
  if (contextBlock) {
    parts.push('---');
    parts.push('# 当前分析上下文');
    parts.push(contextBlock);
  }

  return parts.join('\n\n');
}

/**
 * SYSTEM_PROMPT_WITH_SKILLS
 *
 * 预构建的「含全部技能」系统提示，供 LLMAnalysisView 等固定场景直接使用。
 * 避免每次渲染都重新拼接字符串。
 */
export const SYSTEM_PROMPT_WITH_SKILLS = buildSystemPrompt({
  skills: ['terminal'],
});

/**
 * SYSTEM_PROMPT_BASE
 *
 * 无技能的基础系统提示，供纯对话场景使用。
 */
export const SYSTEM_PROMPT_BASE = buildSystemPrompt({ skills: [] });
