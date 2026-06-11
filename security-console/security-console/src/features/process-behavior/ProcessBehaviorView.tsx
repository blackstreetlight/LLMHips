import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSystemStore } from '../../store/useSystemStore';
import type { ProcessEvent, EtwEvent } from '../../types/index';
import {
  ArrowLeft, FileText, Database, Wifi, AlertTriangle,
  Search, Bot, Send, User, Sparkles, WifiOff,
  Lock, LockOpen, HelpCircle, ChevronDown, ChevronUp,
  ShieldOff, Skull, Clock, Terminal, GitFork, Filter,
} from 'lucide-react';
import { BlockSuccessModal } from '../../components/BlockSuccessModal';
import { buildSystemPrompt, SYSTEM_PROMPT_BASE } from '../skills/systemPrompt';
import { streamWithSkills } from '../skills/streamWithSkills';

const LLM_URL = (import.meta.env.VITE_LLM_URL as string | undefined) || 'http://localhost:8000';

// ─────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────

function buildEnginePayload(preset: string, key: string, url: string, model: string) {
  if (preset === 'local')     return { provider: 'local' };
  if (preset === 'openai')    return { provider: 'openai',    api_key: key, model: model || 'gpt-4o' };
  if (preset === 'deepseek')  return { provider: 'openai',    api_key: key, base_url: 'https://api.deepseek.com/v1', model: model || 'deepseek-chat' };
  if (preset === 'anthropic') return { provider: 'anthropic', api_key: key, model: model || 'claude-3-5-sonnet-20241022' };
  return { provider: 'openai', api_key: key, base_url: url, model };
}

function cleanOutput(text: string): string {
  return text
    .replace(/```(\w*)\s*\n?([\s\S]*?)```/g, (_, lang: string, inner: string) => {
      const s = inner.replace(/<risk_score>\d+<\/risk_score>/g, '').replace(/<action>[A-Z]+<\/action>/g, '').trim();
      return s ? (lang ? `\`\`\`${lang}\n${s}\n\`\`\`` : `\`\`\`\n${s}\n\`\`\``) : '';
    })
    .replace(/<risk_score>\d+<\/risk_score>/g, '')
    .replace(/<action>[A-Z]+<\/action>/g, '')
    .replace(/<summary>[\s\S]*?<\/summary>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildProcessContext(ev: ProcessEvent, etwEvents: EtwEvent[]): string {
  const signed = ev.isSigned === 2 ? '已签名（Authenticode）' : ev.isSigned === 1 ? '未签名' : '签名状态未知';
  const lines = [
    `进程名: ${ev.processName} (PID: ${ev.pid})`,
    `进程路径: ${ev.processPath || '未知'}`,
    `命令行: ${ev.cmdLine || '（无）'}`,
    `父进程: ${ev.parentProcessName || '未知'} (PID: ${ev.parentPid})`,
    `数字签名: ${signed}`,
    `触发规则: ${ev.ruleTriggered}`,
    `风险等级: ${ev.riskLevel.toUpperCase()}`,
    `处置状态: ${ev.status.toUpperCase()}`,
  ];
  if (etwEvents.length > 0) {
    const cnt = { File: 0, Registry: 0, Network: 0 } as Record<string, number>;
    const sev = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    etwEvents.forEach(e => { cnt[e.category] = (cnt[e.category] ?? 0) + 1; sev[e.severity]++; });
    lines.push('', `ETW 行为链（${etwEvents.length} 条 | File:${cnt.File} Registry:${cnt.Registry} Network:${cnt.Network} | 高危:${sev.high} 中危:${sev.medium} 低危:${sev.low}）:`);
    etwEvents.forEach((e, i) => {
      const t = new Date(e.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const tag = e.severity === 'high' ? '[⚠高危]' : e.severity === 'medium' ? '[中危]' : '';
      lines.push(`  ${i + 1}. [${t}]${tag} ${e.category}.${e.action} → ${e.target}${e.ruleDescription ? ' // ' + e.ruleDescription : ''}`);
    });
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────

export const ProcessBehaviorView: React.FC<{
  event: ProcessEvent;
  onBack: () => void;
}> = ({ event: ev, onBack }) => {
  const { events, blockEvent } = useSystemStore();

  // 订阅 store 里最新的该进程快照（ETW 事件实时追加后自动更新）
  const liveEv   = events.find(e => e.id === ev.id) ?? ev;
  const etwEvents = liveEv.etwEvents ?? [];

  const [blockSuccess, setBlockSuccess] = useState<{ processName: string; pid: number; blockedAt: number } | null>(null);

  // ── AI 侧边栏宽度拖拽 ──
  const [sidebarWidth, setSidebarWidth] = useState(288); // 初始 w-72 = 288px
  const isDraggingSidebar = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSidebar.current = true;
    document.body.style.cursor = 'col-resize';
  };

  const handleSidebarMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingSidebar.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = rect.right - e.clientX;
    if (newWidth >= 220 && newWidth <= 560) setSidebarWidth(newWidth);
  }, []);

  const handleSidebarMouseUp = useCallback(() => {
    isDraggingSidebar.current = false;
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleSidebarMouseMove);
    document.addEventListener('mouseup', handleSidebarMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleSidebarMouseMove);
      document.removeEventListener('mouseup', handleSidebarMouseUp);
    };
  }, [handleSidebarMouseMove, handleSidebarMouseUp]);

  // ── 进程信息卡折叠 ──
  const [infoOpen, setInfoOpen] = useState(true);

  // ── 行为事件过滤 ──
  type Cat = 'All' | 'File' | 'Registry' | 'Network';
  type Sev = 'All' | 'high' | 'medium' | 'low';
  const [catFilter, setCatFilter] = useState<Cat>('All');
  const [sevFilter, setSevFilter] = useState<Sev>('All');
  const [searchQ, setSearchQ]     = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [sortDesc, setSortDesc]   = useState(true);

  const filteredEtw = useMemo(() => {
    let list = [...etwEvents];
    if (catFilter !== 'All') list = list.filter(e => e.category === catFilter);
    if (sevFilter !== 'All') list = list.filter(e => e.severity === sevFilter);
    if (searchQ.trim())      list = list.filter(e =>
      e.target.toLowerCase().includes(searchQ.toLowerCase()) ||
      e.action.toLowerCase().includes(searchQ.toLowerCase()) ||
      e.ruleDescription.toLowerCase().includes(searchQ.toLowerCase())
    );
    list.sort((a, b) => sortDesc ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
    return list;
  }, [etwEvents, catFilter, sevFilter, searchQ, sortDesc]);

  const highCount   = etwEvents.filter(e => e.severity === 'high').length;
  const mediumCount = etwEvents.filter(e => e.severity === 'medium').length;

  // ── 样式 ──
  const riskBadge = ev.riskLevel === 'high'
    ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : ev.riskLevel === 'medium'
    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : 'bg-green-500/20 text-green-400 border-green-500/30';
  const statusBadge = ev.status === 'blocked'
    ? 'bg-red-900/50 text-red-400 border-red-800/60'
    : ev.status === 'watching'
    ? 'bg-orange-900/30 text-orange-400 border-orange-800/50'
    : 'bg-green-900/30 text-green-400 border-green-800/50';

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-gray-300 font-mono overflow-hidden">

      {/* ── 顶部导航栏 ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 h-11 border-b border-gray-800 bg-[#0a0d12]">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#00d4ff] transition-colors shrink-0">
          <ArrowLeft size={13} /> 进程详情记录
        </button>
        <span className="text-gray-700 text-sm">/</span>
        <span className="text-white text-sm font-medium truncate">{ev.processName || '未知进程'}</span>
        <span className="text-gray-600 text-xs shrink-0">PID: {ev.pid}</span>
        {ev.terminated && (
          <span className="flex items-center gap-1 text-[11px] text-gray-500 border border-gray-700 bg-gray-800/50 px-1.5 py-0.5 rounded shrink-0">
            <Skull size={9} /> 已结束
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`text-[11px] px-2 py-0.5 rounded border font-mono ${riskBadge}`}>{ev.riskLevel.toUpperCase()}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded border font-mono ${statusBadge}`}>{ev.status.toUpperCase()}</span>
          {!ev.terminated && (
            <button
              onClick={() => {
                if (window.confirm(`确认对 ${ev.processName}（PID: ${ev.pid}）执行内核阻断？`)) {
                  blockEvent(ev.id);
                  setBlockSuccess({ processName: ev.processName, pid: ev.pid, blockedAt: Date.now() });
                }
              }}
              className="flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              <ShieldOff size={11} /> 内核阻断
            </button>
          )}
        </div>
      </div>

      {/* ── 主体 ── */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>

        {/* ════════════════ 左侧主区 ════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* 进程信息卡（可折叠） */}
          <div className="shrink-0 border-b border-gray-800">
            <button
              onClick={() => setInfoOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-800/30 transition-colors"
            >
              <span className="text-xs text-gray-400 font-mono flex items-center gap-2">
                <Filter size={11} className="text-gray-600" />
                进程信息
              </span>
              {infoOpen ? <ChevronUp size={12} className="text-gray-600" /> : <ChevronDown size={12} className="text-gray-600" />}
            </button>

            {infoOpen && (
              <div className="px-4 pb-3 grid grid-cols-3 gap-x-6 gap-y-2 text-[11px]">
                <InfoItem label="进程路径" value={ev.processPath || '—'} span={2} />
                <InfoItem
                  label="签名"
                  value={ev.isSigned === 2 ? '已签名' : ev.isSigned === 1 ? '未签名' : '未检查'}
                  icon={ev.isSigned === 2 ? <Lock size={10} className="text-green-500" /> : ev.isSigned === 1 ? <LockOpen size={10} className="text-red-400" /> : <HelpCircle size={10} className="text-gray-600" />}
                />
                <InfoItem
                  label="命令行"
                  value={ev.cmdLine || '（无参数）'}
                  span={2}
                  icon={<Terminal size={10} className="text-gray-600" />}
                />
                <InfoItem
                  label="触发规则"
                  value={ev.ruleTriggered}
                />
                <InfoItem
                  label="父进程"
                  value={`${ev.parentProcessName || '未知'} (PID: ${ev.parentPid})`}
                  icon={<GitFork size={10} className="text-gray-600" />}
                  span={2}
                />
                <InfoItem
                  label="事件时间"
                  value={new Date(ev.timestamp).toLocaleString('zh-CN')}
                  icon={<Clock size={10} className="text-gray-600" />}
                />
              </div>
            )}
          </div>

          {/* 行为事件区 */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* 过滤栏 */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-800 flex-wrap">
              {/* 类别过滤 */}
              <div className="flex items-center gap-1">
                {(['All', 'File', 'Registry', 'Network'] as Cat[]).map(c => (
                  <button
                    key={c}
                    onClick={() => setCatFilter(c)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                      catFilter === c
                        ? c === 'All'     ? 'bg-gray-700 text-white border-gray-600'
                        : c === 'File'    ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                        : c === 'Registry'? 'bg-purple-500/20 text-purple-400 border-purple-500/40'
                        : 'bg-green-500/20 text-green-400 border-green-500/40'
                        : 'text-gray-600 border-gray-700 hover:text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {c === 'File'     && <FileText size={9} />}
                    {c === 'Registry' && <Database size={9} />}
                    {c === 'Network'  && <Wifi size={9} />}
                    {c}
                  </button>
                ))}
              </div>

              <div className="w-px h-4 bg-gray-700" />

              {/* 严重度过滤 */}
              <div className="flex items-center gap-1">
                {(['All', 'high', 'medium', 'low'] as Sev[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSevFilter(s)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                      sevFilter === s
                        ? s === 'All'    ? 'bg-gray-700 text-white border-gray-600'
                        : s === 'high'   ? 'bg-red-500/20 text-red-400 border-red-500/40'
                        : s === 'medium' ? 'bg-orange-500/20 text-orange-400 border-orange-500/40'
                        : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
                        : 'text-gray-600 border-gray-700 hover:text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {s === 'All' ? '全部' : s.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="w-px h-4 bg-gray-700" />

              {/* 搜索 */}
              <div className="flex items-center gap-1.5 flex-1 min-w-[140px] max-w-[280px]">
                <Search size={11} className="text-gray-600 shrink-0" />
                <input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="搜索目标路径、动作、规则..."
                  className="flex-1 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 focus:outline-none"
                />
                {searchQ && (
                  <button onClick={() => setSearchQ('')} className="text-gray-600 hover:text-gray-400 text-[11px]">✕</button>
                )}
              </div>

              {/* 计数 + 排序 */}
              <div className="ml-auto flex items-center gap-3 text-[11px] shrink-0">
                {highCount > 0 && <span className="text-red-400">⚠ 高危 {highCount}</span>}
                {mediumCount > 0 && <span className="text-orange-400">中危 {mediumCount}</span>}
                <span className="text-gray-600">
                  {filteredEtw.length} / {etwEvents.length} 条
                </span>
                <button
                  onClick={() => setSortDesc(v => !v)}
                  className="text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-0.5"
                  title={sortDesc ? '当前：最新在前' : '当前：最早在前'}
                >
                  <Clock size={10} />
                  {sortDesc ? '↓' : '↑'}
                </button>
              </div>
            </div>

            {/* 事件列表 */}
            <div className="flex-1 overflow-y-auto">
              {etwEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-700">
                  <Wifi size={28} className="opacity-30" />
                  <p className="text-xs">暂无 ETW 行为记录</p>
                  <p className="text-[11px]">等待运行时事件上报…</p>
                </div>
              ) : filteredEtw.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-700 text-xs">
                  没有匹配的行为记录
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-[#0d1117] border-b border-gray-800 z-10">
                    <tr className="text-gray-600 text-left">
                      <th className="px-4 py-2 font-normal w-[88px] shrink-0">时间</th>
                      <th className="px-2 py-2 font-normal w-[96px]">类别</th>
                      <th className="px-2 py-2 font-normal w-[80px]">动作</th>
                      <th className="px-2 py-2 font-normal w-[60px]">严重度</th>
                      <th className="px-2 py-2 font-normal">目标 / 规则</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/40">
                    {filteredEtw.map(e => (
                      <EtwRow
                        key={e.id}
                        event={e}
                        expanded={expandedRowId === e.id}
                        onToggle={() => setExpandedRowId(prev => prev === e.id ? null : e.id)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* ════════════════ 拖拽分割条 ════════════════ */}
        <div
          onMouseDown={handleSidebarMouseDown}
          className="w-1 bg-gray-800 hover:bg-[#00d4ff] cursor-col-resize transition-colors shrink-0 flex flex-col justify-center items-center group"
        >
          <div className="h-8 w-px bg-gray-600 group-hover:bg-white rounded transition-colors" />
        </div>

        {/* ════════════════ 右侧 AI 侧边栏 ════════════════ */}
        <AIChatSidebar ev={liveEv} etwEvents={etwEvents} width={sidebarWidth} />
      </div>

      {blockSuccess && (
        <BlockSuccessModal
          processName={blockSuccess.processName}
          pid={blockSuccess.pid}
          blockedAt={blockSuccess.blockedAt}
          onConfirm={() => { setBlockSuccess(null); onBack(); }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// ETW 事件行
// ─────────────────────────────────────────────────────────

const EtwRow: React.FC<{ event: EtwEvent; expanded: boolean; onToggle: () => void }> = ({ event: e, expanded, onToggle }) => {
  const t = new Date(e.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const catStyle = e.category === 'File'
    ? { icon: <FileText size={10} />, text: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' }
    : e.category === 'Registry'
    ? { icon: <Database  size={10} />, text: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' }
    : { icon: <Wifi      size={10} />, text: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' };

  const sevStyle = e.severity === 'high'
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : e.severity === 'medium'
    ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    : 'bg-gray-700/40 text-gray-500 border-gray-700/50';

  const rowBg = e.severity === 'high'
    ? 'bg-red-500/5 hover:bg-red-500/10'
    : 'hover:bg-gray-800/40';

  return (
    <tr
      className={`cursor-pointer transition-colors ${rowBg}`}
      onClick={onToggle}
    >
      <td className="px-4 py-2 text-gray-600 font-mono whitespace-nowrap">{t}</td>
      <td className="px-2 py-2">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${catStyle.text} ${catStyle.bg}`}>
          {catStyle.icon}{e.category}
        </span>
      </td>
      <td className="px-2 py-2 text-gray-400">{e.action}</td>
      <td className="px-2 py-2">
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] ${sevStyle}`}>
          {e.severity === 'high' && <AlertTriangle size={8} />}
          {e.severity.toUpperCase()}
        </span>
      </td>
      <td className="px-2 py-2 max-w-0">
        <p className={`font-mono text-gray-300 ${expanded ? 'break-all whitespace-pre-wrap' : 'truncate'}`}>
          {e.target}
        </p>
        {e.ruleDescription && (
          <p className={`text-gray-600 mt-0.5 ${expanded ? 'break-all' : 'truncate'}`}>
            // {e.ruleDescription}
          </p>
        )}
      </td>
    </tr>
  );
};

// ─────────────────────────────────────────────────────────
// AI 研判侧边栏（独立组件，管理自己的对话状态）
// ─────────────────────────────────────────────────────────

interface ChatMsg {
  id: string;
  /** ai: AI 回复  user: 用户消息  system: 系统提示  skill: 技能执行卡片 */
  role: 'ai' | 'user' | 'system' | 'skill';
  content: string;
  isStreaming?: boolean;
  skillInfo?: { name: string; cmd: string; status: 'running' | 'done' | 'disabled'; result?: string };
}

const AIChatSidebar: React.FC<{ ev: ProcessEvent; etwEvents: EtwEvent[]; width: number }> = ({ ev, etwEvents, width }) => {
  const { enginePreset, engineApiKey, engineBaseUrl, engineModel, inferMaxTokens, inferTemperature, inferTopP, inferMaxHistory } = useSystemStore();

  const [messages, setMessages]       = useState<ChatMsg[]>([]);
  const [question, setQuestion]       = useState('');
  const [isThinking, setIsThinking]   = useState(false);
  const [llmOffline, setLlmOffline]   = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  // 未点击研判按钮前：只有基础角色定义（无技能、无进程上下文）
  // 点击后：角色 + 全部技能 + 进程上下文
  const systemContextRef  = useRef(SYSTEM_PROMPT_BASE);
  // 当前正在写入的 AI 消息 ID（多轮技能调用时会更新）
  const activeMsgIdRef = useRef('');
  const abortRef         = useRef<AbortController | null>(null);
  const endRef           = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const stream = async (
    apiMessages: { role: string; content: string }[],
    targetId: string,
    isActive: () => boolean,
    onDone: (text: string) => void,
  ) => {
    activeMsgIdRef.current = targetId;

    await streamWithSkills({
      url:         LLM_URL,
      messages:    apiMessages,
      systemExtra: systemContextRef.current,
      fetchExtra:  {
        max_new_tokens: inferMaxTokens,
        temperature:    inferTemperature,
        top_p:          inferTopP,
        engine:         buildEnginePayload(enginePreset, engineApiKey, engineBaseUrl, engineModel),
      },
      abortRef,
      callbacks: {
        isActive,

        onChunk: (text) => {
          setMessages(prev => prev.map(m =>
            m.id === activeMsgIdRef.current ? { ...m, content: m.content + text } : m,
          ));
        },

        onSkillStart: (skillName, displayCmd) => {
          const skillId = `skill-${Date.now()}`;
          setMessages(prev => [
            ...prev.map(m => m.id === activeMsgIdRef.current ? { ...m, isStreaming: false } : m),
            { id: skillId, role: 'skill' as const, content: '',
              skillInfo: { name: skillName, cmd: displayCmd, status: 'running' as const } },
          ]);
          activeMsgIdRef.current = skillId;
        },

        onSkillResult: (skillName, result) => {
          const isDisabled = result.startsWith('[SKILL_DISABLED]');
          setMessages(prev => prev.map(m =>
            m.role === 'skill' && m.skillInfo?.name === skillName && m.skillInfo?.status === 'running'
              ? { ...m, skillInfo: { ...m.skillInfo!, status: isDisabled ? 'disabled' as const : 'done' as const, result: isDisabled ? '技能已禁用' : result } }
              : m,
          ));
        },

        onNewAITurn: () => {
          const newId = `ai-${Date.now()}`;
          activeMsgIdRef.current = newId;
          setMessages(prev => [...prev, { id: newId, role: 'ai' as const, content: '', isStreaming: true }]);
        },

        onDone: (fullText) => {
          setMessages(prev => prev.map(m =>
            m.id === activeMsgIdRef.current ? { ...m, isStreaming: false } : m,
          ));
          if (isActive()) setIsThinking(false);
          onDone(fullText);
        },

        onError: (errMsg) => {
          if (!isActive()) return;
          setLlmOffline(true);
          setMessages(prev => prev.map(m =>
            m.id === activeMsgIdRef.current ? { ...m, content: errMsg, isStreaming: false } : m,
          ));
          if (isActive()) setIsThinking(false);
          onDone(errMsg);
        },
      },
    });
  };

  // 普通追问
  const sendMessage = (content?: string) => {
    const text = (content ?? question).trim();
    if (!text || isThinking) return;
    if (!content) setQuestion('');
    const userId = 'u-' + Date.now();
    const aiId   = 'a-' + Date.now();
    let snap: ChatMsg[] = [];
    setMessages(prev => { snap = prev; return [...prev, { id: userId, role: 'user', content: text }]; });
    setIsThinking(true);
    // 过滤 system 提示消息和 skill 技能卡片，只保留 ai / user 对话内容
    const hist = snap.filter(m => m.role !== 'system' && m.role !== 'skill' && !m.isStreaming && m.content);
    const trimmed = inferMaxHistory > 0 ? hist.slice(-inferMaxHistory * 2) : hist;
    const apiMsgs = [
      ...trimmed.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: text },
    ];
    setMessages(prev => [...prev, { id: aiId, role: 'ai', content: '', isStreaming: true }]);
    let active = true;
    stream(apiMsgs, aiId, () => active, () => {});
  };

  // 加载进程信息并生成研判报告（注入角色 + 技能 + 进程上下文）
  const loadAndAnalyze = () => {
    if (isThinking) return;
    const contextBlock = buildProcessContext(ev, etwEvents);
    // 点击后升级为：完整系统提示（含 Terminal_control 技能 + 进程上下文）
    systemContextRef.current = buildSystemPrompt({
      skills: ['terminal'],
      contextBlock,
    });
    setContextLoaded(true);

    const sysId  = 'sys-' + Date.now();
    const userId = 'u-'   + Date.now();
    const aiId   = 'a-'   + Date.now();
    const sysMsg = `✓ 已注入进程上下文：${ev.processName} (PID: ${ev.pid})，共 ${etwEvents.length} 条 ETW 行为记录`;
    const userPrompt = '请对该进程进行完整的安全研判，包括风险分析、行为评估、ATT&CK 映射，以及处置建议。';

    setMessages(prev => [
      ...prev,
      { id: sysId,  role: 'system', content: sysMsg },
      { id: userId, role: 'user',   content: userPrompt },
      { id: aiId,   role: 'ai',     content: '', isStreaming: true },
    ]);
    setIsThinking(true);
    let active = true;
    stream([{ role: 'user', content: userPrompt }], aiId, () => active, () => {});
  };

  return (
    <div className="flex flex-col bg-[#0a0d12] shrink-0 overflow-hidden" style={{ width }}>

      {/* 侧边栏头部 */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <Bot size={13} className="text-[#00d4ff]" /> AI 研判助手
        </span>
        {llmOffline
          ? <span className="flex items-center gap-1 text-[10px] text-red-400"><WifiOff size={9} /> 离线</span>
          : <span className="flex items-center gap-1 text-[10px] text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400" /> 在线</span>
        }
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 font-sans">
        {messages.length === 0 && (
          <div className="text-[11px] text-gray-700 text-center pt-4 leading-relaxed px-2">
            你可以直接向 AI 提问，<br />
            或点击下方按钮加载进程信息生成专项研判报告。
          </div>
        )}
        {messages.map(msg => {
          if (msg.role === 'system') {
            return (
              <div key={msg.id} className="flex items-center gap-1.5 text-[10px] text-[#00d4ff]/60 bg-[#00d4ff]/5 border border-[#00d4ff]/15 rounded px-2 py-1.5">
                <span className="w-1 h-1 rounded-full bg-[#00d4ff]/60 shrink-0" />
                {msg.content}
              </div>
            );
          }

          // ── 技能执行卡片 ───────────────────────────────────────
          if (msg.role === 'skill' && msg.skillInfo) {
            const { name, cmd, status, result } = msg.skillInfo;
            const running  = status === 'running';
            const disabled = status === 'disabled';
            return (
              <div key={msg.id} className={`rounded border text-[10px] font-mono overflow-hidden
                ${disabled ? 'bg-gray-800/30 border-gray-700' : running ? 'bg-[#00d4ff]/5 border-[#00d4ff]/20' : 'bg-green-500/5 border-green-500/20'}`}>
                <div className={`flex items-center gap-1.5 px-2 py-1 border-b ${disabled ? 'border-gray-700' : running ? 'border-[#00d4ff]/15' : 'border-green-500/15'}`}>
                  <Terminal size={9} className={disabled ? 'text-gray-600' : running ? 'text-[#00d4ff]' : 'text-green-400'} />
                  <span className={disabled ? 'text-gray-500' : running ? 'text-[#00d4ff]' : 'text-green-400'}>{name}</span>
                  <span className="text-gray-700 ml-auto">
                    {running && <span className="animate-pulse">执行中…</span>}
                    {!running && !disabled && '✓'}
                    {disabled && '⊘ 已禁用'}
                  </span>
                </div>
                <div className="px-2 py-1 text-gray-600"><span className="text-gray-700">$ </span>{cmd}</div>
                {result && !disabled && (
                  <div className="px-2 py-1.5 border-t border-green-500/10 text-gray-500 whitespace-pre-wrap max-h-28 overflow-y-auto">
                    {result.length > 300 ? result.slice(0, 300) + '…' : result}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <div className="w-5 h-5 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={10} className="text-[#00d4ff]" />
                </div>
              )}
              <div className={`max-w-[90%] rounded-lg px-2.5 py-2 text-[11px] leading-relaxed relative overflow-hidden select-text
                ${msg.role === 'user'
                  ? 'bg-[#1f6feb]/20 text-[#c9d1d9] border border-[#1f6feb]/30 font-mono whitespace-pre-wrap'
                  : 'bg-[#161b22] text-gray-300 border border-[#30363d]'}`}
              >
                {msg.role === 'user' ? cleanOutput(msg.content) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 className="text-xs font-bold text-gray-100 mb-1.5 mt-2 first:mt-0">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-xs font-bold text-gray-100 mb-1.5 mt-2 first:mt-0">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-[11px] font-semibold text-[#00d4ff] mb-1 mt-1.5 first:mt-0">{children}</h3>,
                      p:  ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5 pl-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5 pl-1">{children}</ol>,
                      li: ({ children }) => <li className="text-gray-300">{children}</li>,
                      strong: ({ children }) => <strong className="font-bold text-gray-100">{children}</strong>,
                      pre: ({ children }) => <pre className="bg-[#0d1117] border border-[#30363d] rounded p-2 overflow-x-auto mb-1.5 text-[10px] font-mono text-gray-300 whitespace-pre">{children}</pre>,
                      code: ({ children, className: cn }: { children?: React.ReactNode; className?: string }) =>
                        cn || String(children ?? '').includes('\n')
                          ? <code className="font-mono">{children}</code>
                          : <code className="bg-[#0d1117] text-[#00d4ff] px-1 py-0.5 rounded text-[10px] font-mono">{children}</code>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-[#00d4ff]/50 pl-2 my-1.5 text-gray-400 italic">{children}</blockquote>,
                      table: ({ children }) => <div className="overflow-x-auto mb-1.5"><table className="text-[10px] border-collapse w-full">{children}</table></div>,
                      th: ({ children }) => <th className="border border-[#30363d] px-1.5 py-0.5 text-left text-gray-300 font-semibold">{children}</th>,
                      td: ({ children }) => <td className="border border-[#30363d] px-1.5 py-0.5 text-gray-400">{children}</td>,
                      hr: () => <hr className="border-[#30363d] my-2" />,
                    }}
                  >
                    {cleanOutput(msg.content)}
                  </ReactMarkdown>
                )}
                {msg.isStreaming && <span className="inline-block w-1.5 h-3.5 bg-[#00d4ff] animate-pulse ml-0.5 align-middle" />}
              </div>
              {msg.role === 'user' && (
                <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
                  <User size={10} className="text-gray-300" />
                </div>
              )}
            </div>
          );
        })}
        {isThinking && messages.every(m => !m.content || m.role === 'system') && (
          <div className="flex gap-2">
            <div className="w-5 h-5 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center">
              <Sparkles size={10} className="text-[#00d4ff] animate-pulse" />
            </div>
            <span className="text-[#00d4ff] text-[11px] font-mono animate-pulse">分析中…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 底部：加载按钮 + 输入框 */}
      <div className="shrink-0 border-t border-gray-800 px-3 pt-2 pb-3 space-y-2">
        {/* 加载进程信息按钮 */}
        <button
          onClick={loadAndAnalyze}
          disabled={isThinking}
          className={`w-full py-1.5 rounded text-[11px] font-mono border transition-all flex items-center justify-center gap-1.5
            ${contextLoaded
              ? 'bg-[#00d4ff]/5 text-[#00d4ff]/60 border-[#00d4ff]/20 hover:bg-[#00d4ff]/10 hover:text-[#00d4ff]/80'
              : 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/30 hover:bg-[#00d4ff]/20 shadow-[0_0_8px_rgba(0,212,255,0.1)]'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <Bot size={11} />
          {contextLoaded ? '重新生成研判报告' : '加载进程信息并生成研判报告'}
        </button>

        {/* 输入框 */}
        <div className="flex gap-1.5">
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            rows={2}
            placeholder="直接提问 AI…"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-[11px] font-mono text-gray-200 focus:outline-none focus:border-[#00d4ff] transition-colors resize-none placeholder-gray-700"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!question.trim() || isThinking}
            className="px-2 rounded bg-[#00d4ff]/10 text-[#00d4ff] hover:bg-[#00d4ff]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-end h-8 flex items-center"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// 小工具组件
// ─────────────────────────────────────────────────────────

const InfoItem: React.FC<{ label: string; value: string; span?: number; icon?: React.ReactNode }> = ({ label, value, span, icon }) => (
  <div className={span === 2 ? 'col-span-2' : ''}>
    <span className="text-gray-600 flex items-center gap-1">{icon}{label}</span>
    <p className="text-gray-300 mt-0.5 break-all">{value}</p>
  </div>
);
