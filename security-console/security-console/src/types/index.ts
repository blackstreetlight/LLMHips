/**
 * 进程事件接口
 * 字段名与中间层 JSON 序列化 (camelCase) 完全对齐
 */
export interface ProcessEvent {
  /** 事件唯一标识符（桥接层生成 GUID） */
  id: string;
  /** 进程 PID */
  pid: number;
  /** 父进程 PID */
  parentPid: number;
  /** 进程可执行文件名 */
  processName: string;
  /** 进程完整路径（DOS 格式） */
  processPath: string;
  /** 命令行参数 */
  cmdLine: string;
  /** 父进程文件名 */
  parentProcessName: string;
  /** 父进程完整路径 */
  parentProcessPath: string;
  /** 签名状态：0=未知, 1=未签名, 2=已签名 */
  isSigned: number;
  /** 触发的规则描述（桥接层推断） */
  ruleTriggered: string;
  /** 风险等级 */
  riskLevel: 'high' | 'medium' | 'low';
  /** 处置状态 */
  status: 'blocked' | 'watching' | 'allowed';
  /** 可执行文件创建时间（Unix 毫秒） */
  fileCreateTime: number;
  /** 事件时间戳（Unix 毫秒） */
  timestamp: number;
  /** 进程是否已结束（由 process_exit 消息触发更新） */
  terminated?: boolean;
  /** 进程结束时间戳（Unix 毫秒） */
  terminatedAt?: number;
}

/**
 * LLM 分析响应接口
 */
export interface LLMAnalysisResponse {
  eventId: string;
  summary: string;
  confidence: number;
  recommendation: 'block' | 'allow' | 'investigate';
  detail: string;
}

/**
 * 研判对话消息
 */
export interface AnalysisChatMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  timestamp: number;
}

/**
 * 白名单条目
 * 支持按进程名（精确/模糊）或路径前缀匹配
 */
export interface WhitelistEntry {
  /** 条目唯一 ID */
  id: string;
  /** 匹配类型：processName = 进程名包含匹配，path = 路径前缀匹配 */
  matchType: 'processName' | 'path';
  /** 匹配值（大小写不敏感） */
  value: string;
  /** 备注说明（可选） */
  note: string;
  /** 加入时间（Unix 毫秒） */
  addedAt: number;
}

/**
 * 内核阻断记录
 * 用户点击「内核阻断」后生成，永久保留（进程从 events 中删除）
 */
export interface BlockRecord {
  /** 阻断记录唯一 ID */
  id: string;
  /** 关联的原始事件 ID */
  eventId: string;
  /** 进程 PID */
  pid: number;
  /** 父进程 PID */
  parentPid: number;
  /** 进程名 */
  processName: string;
  /** 进程完整路径 */
  processPath: string;
  /** 命令行参数 */
  cmdLine: string;
  /** 父进程名 */
  parentProcessName: string;
  /** 签名状态 */
  isSigned: number;
  /** 风险等级 */
  riskLevel: 'high' | 'medium' | 'low';
  /** 触发规则 */
  ruleTriggered: string;
  /** 进程被内核捕获的时间（Unix 毫秒）——即"进程创建时间" */
  processCreatedAt: number;
  /** 用户执行阻断的时间（Unix 毫秒） */
  blockedAt: number;
}

/**
 * 研判工单记录
 * 每次用户对一个事件发起 LLM 研判，就产生一条记录
 */
export interface AnalysisRecord {
  /** 工单 ID */
  id: string;
  /** 关联的进程事件快照（记录时的完整事件数据） */
  event: ProcessEvent;
  /** 研判发起时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** AI 给出的风险等级 */
  aiRiskLevel: 'high' | 'medium' | 'low';
  /** AI 置信度 (0-100) */
  aiConfidence: number;
  /** AI 建议操作 */
  aiRecommendation: 'block' | 'allow' | 'investigate';
  /** 用户最终决策 */
  finalAction: 'blocked' | 'allowed' | 'pending';
  /** 完整对话记录 */
  chatHistory: AnalysisChatMessage[];
}
