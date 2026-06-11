/**
 * skillsMeta.ts — 技能元数据注册表
 *
 * 为每个技能定义用于 UI 展示的静态信息：
 *   id、显示名称、描述、图标色、危险等级、警告说明
 *
 * 新增技能时在此追加一条记录即可，管理面板自动渲染。
 */

export interface SkillMeta {
  /** 技能唯一 ID，与 store.skillsEnabled 的 key 及 SkillRegistry 的 handler key 对应 */
  id: string;
  /** AI 调用时使用的标签名，如 Terminal_control */
  tagName: string;
  /** 在管理面板中展示的中文名称 */
  displayName: string;
  /** 一句话功能描述 */
  description: string;
  /** 详细说明（多条），展示在卡片展开区 */
  details: string[];
  /**
   * 危险等级
   *   low:    只读操作，几乎无副作用
   *   medium: 可能修改系统状态
   *   high:   可执行任意命令，高风险
   */
  riskLevel: 'low' | 'medium' | 'high';
  /** 禁用后的特殊返回值前缀（用于 UI 说明，实际值在 handler 中定义） */
  disabledNote: string;
}

export const SKILLS_META: SkillMeta[] = [
  {
    id:          'terminal',
    tagName:     'Terminal_control',
    displayName: '终端命令执行',
    description: 'AI 可在受控端执行 Shell 命令，获取实时系统状态、文件内容、网络连接等信息用于安全分析。',
    details: [
      '支持 PowerShell（Windows）/ Bash（Linux/macOS）',
      '命令在独立子进程中执行，不影响交互终端会话',
      '单条命令最长执行 60 秒，超时自动终止',
      '执行结果（stdout + stderr）完整返回给 AI',
    ],
    riskLevel:    'high',
    disabledNote: 'AI 尝试调用时将收到 [SKILL_DISABLED] 响应，并被告知改用已有上下文分析',
  },
  // ── 未来技能在此追加 ──────────────────────────────────────────────────────
  // {
  //   id: 'filesystem_read',
  //   tagName: 'Filesystem_read',
  //   displayName: '文件系统读取',
  //   description: 'AI 可读取受控端指定路径的文件内容。',
  //   details: ['只读，不支持写入或删除', '文件大小限制 512KB'],
  //   riskLevel: 'low',
  //   disabledNote: 'AI 尝试调用时将收到 [SKILL_DISABLED] 响应',
  // },
];

/** 按 id 快速查找元数据 */
export function getSkillMeta(id: string): SkillMeta | undefined {
  return SKILLS_META.find(s => s.id === id);
}

/** 危险等级对应的颜色 class */
export const RISK_COLOR: Record<SkillMeta['riskLevel'], string> = {
  low:    'text-green-400 bg-green-500/10 border-green-500/30',
  medium: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  high:   'text-red-400 bg-red-500/10 border-red-500/30',
};

export const RISK_LABEL: Record<SkillMeta['riskLevel'], string> = {
  low:    '低风险',
  medium: '中风险',
  high:   '高风险',
};
