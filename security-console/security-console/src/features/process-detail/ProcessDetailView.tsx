import React, { useMemo, useState } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import {
  Search, ChevronDown, ChevronUp, Lock, LockOpen, HelpCircle,
  ShieldAlert, Shield, Terminal, Clock, ShieldOff, Skull,
} from 'lucide-react';
import type { ProcessEvent } from '../../types/index';
import { BlockSuccessModal } from '../../components/BlockSuccessModal';
import { BehaviorChainTimeline } from './BehaviorChainTimeline';

/**
 * 进程详情页
 * 展示所有已记录进程的完整信息（驱动上报的全部字段）
 */
export const ProcessDetailView: React.FC<{
  onViewBehavior?: (event: ProcessEvent) => void;
}> = ({ onViewBehavior }) => {
  const { events, setSelectedEvent, blockEvent } = useSystemStore();

  // ── 阻断成功弹窗 ──
  const [blockSuccess, setBlockSuccess] = useState<{
    processName: string; pid: number; blockedAt: number;
  } | null>(null);

  const handleBlock = (ev: ProcessEvent) => {
    const blockedAt = Date.now();
    blockEvent(ev.id);
    setBlockSuccess({ processName: ev.processName, pid: ev.pid, blockedAt });
  };

  // ── 筛选与搜索 ──
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'blocked' | 'watching' | 'allowed'>('all');
  const [terminatedFilter, setTerminatedFilter] = useState<'all' | 'alive' | 'terminated'>('all');
  // 使用 Set 支持同时展开多条，展开/收起完全由用户自己控制
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /**
   * 切换单条展开状态，不影响其他已展开的行
   */
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * 全部折叠
   */
  const collapseAll = () => setExpandedIds(new Set());

  const filteredEvents = useMemo(() => {
    return events.filter(ev => {
      const matchSearch =
        !searchQuery ||
        ev.processName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ev.processPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ev.cmdLine.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ev.parentProcessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(ev.pid).includes(searchQuery);
      const matchRisk = riskFilter === 'all' || ev.riskLevel === riskFilter;
      const matchStatus = statusFilter === 'all' || ev.status === statusFilter;
      const matchTerminated =
        terminatedFilter === 'all' ||
        (terminatedFilter === 'terminated' && ev.terminated) ||
        (terminatedFilter === 'alive' && !ev.terminated);
      return matchSearch && matchRisk && matchStatus && matchTerminated;
    });
  }, [events, searchQuery, riskFilter, statusFilter, terminatedFilter]);

  // ── 统计 ──
  const stats = useMemo(() => ({
    total: filteredEvents.length,
    high: filteredEvents.filter(e => e.riskLevel === 'high').length,
    medium: filteredEvents.filter(e => e.riskLevel === 'medium').length,
    low: filteredEvents.filter(e => e.riskLevel === 'low').length,
    unsigned: filteredEvents.filter(e => e.isSigned === 1).length,
    terminated: filteredEvents.filter(e => e.terminated).length,
  }), [filteredEvents]);

  const riskColor = (level: string) => {
    if (level === 'high') return 'text-red-400';
    if (level === 'medium') return 'text-orange-400';
    return 'text-green-400';
  };

  const statusBadge = (status: string) => {
    if (status === 'blocked') return 'bg-red-900/50 text-red-400 border-red-800/60';
    if (status === 'watching') return 'bg-orange-900/30 text-orange-400 border-orange-800/50';
    return 'bg-green-900/30 text-green-400 border-green-800/50';
  };

  const signedIcon = (val: number) => {
    if (val === 2) return <Lock size={14} className="text-green-500" />;
    if (val === 1) return <LockOpen size={14} className="text-red-400" />;
    return <HelpCircle size={14} className="text-gray-600" />;
  };

  const signedText = (val: number) => {
    if (val === 2) return '已签名';
    if (val === 1) return '未签名';
    return '未知';
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-gray-300 font-mono relative">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-gray-800 shrink-0">
        <h1 className="text-xl font-bold text-[#00d4ff] mb-3">进程详情记录</h1>

        {/* 统计条 */}
        <div className="flex items-center gap-4 text-xs mb-3">
          <span className="text-gray-400">共 <span className="text-white font-bold">{stats.total}</span> 条记录</span>
          <span className="text-red-400">高危 {stats.high}</span>
          <span className="text-orange-400">中危 {stats.medium}</span>
          <span className="text-green-400">低危 {stats.low}</span>
          <span className="text-gray-500">|</span>
          <span className="text-red-300">未签名 {stats.unsigned}</span>
          {stats.terminated > 0 && (
            <>
              <span className="text-gray-500">|</span>
              <span className="text-gray-500 flex items-center gap-1">
                <Skull size={11} /> 已结束 {stats.terminated}
              </span>
            </>
          )}
          {expandedIds.size > 0 && (
            <>
              <span className="text-gray-500">|</span>
              <span className="text-gray-500">已展开 {expandedIds.size}</span>
              <button
                onClick={collapseAll}
                className="text-[#00d4ff] hover:text-white transition-colors"
              >
                全部折叠
              </button>
            </>
          )}
        </div>

        {/* 搜索 + 筛选 */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索进程名、路径、命令行、PID..."
              className="w-full bg-[#161b22] border border-gray-700 rounded pl-9 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00d4ff] transition-colors"
            />
          </div>

          {/* 风险等级筛选 */}
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value as typeof riskFilter)}
            className="bg-[#161b22] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-[#00d4ff]"
          >
            <option value="all">全部等级</option>
            <option value="high">高危</option>
            <option value="medium">中危</option>
            <option value="low">低危</option>
          </select>

          {/* 状态筛选 */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="bg-[#161b22] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-[#00d4ff]"
          >
            <option value="all">全部状态</option>
            <option value="blocked">已拦截</option>
            <option value="watching">监控中</option>
            <option value="allowed">已放行</option>
          </select>

          {/* 进程存活筛选 */}
          <select
            value={terminatedFilter}
            onChange={e => setTerminatedFilter(e.target.value as typeof terminatedFilter)}
            className="bg-[#161b22] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-[#00d4ff]"
          >
            <option value="all">全部进程</option>
            <option value="alive">运行中</option>
            <option value="terminated">已结束</option>
          </select>
        </div>
      </div>

      {/* ── 进程列表 ── */}
      <div className="flex-1 overflow-y-auto">
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            暂无匹配的进程记录
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {filteredEvents.map(ev => (
              <ProcessRow
                key={ev.id}
                event={ev}
                isExpanded={expandedIds.has(ev.id)}
                onToggle={() => toggleExpand(ev.id)}
                onAnalyze={() => setSelectedEvent(ev)}
                onBlock={() => handleBlock(ev)}
                onViewBehavior={() => onViewBehavior?.(ev)}
                riskColor={riskColor}
                statusBadge={statusBadge}
                signedIcon={signedIcon}
                signedText={signedText}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 内核阻断成功弹窗 ── */}
      {blockSuccess && (
        <BlockSuccessModal
          processName={blockSuccess.processName}
          pid={blockSuccess.pid}
          blockedAt={blockSuccess.blockedAt}
          onConfirm={() => setBlockSuccess(null)}
        />
      )}
    </div>
  );
};

/**
 * 单条进程行 — 点击展开查看全部字段
 */
const ProcessRow: React.FC<{
  event: ProcessEvent;
  isExpanded: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  onBlock: () => void;
  onViewBehavior: () => void;
  riskColor: (l: string) => string;
  statusBadge: (s: string) => string;
  signedIcon: (v: number) => React.ReactNode;
  signedText: (v: number) => string;
}> = ({ event: ev, isExpanded, onToggle, onAnalyze, onBlock, onViewBehavior, riskColor, statusBadge, signedIcon, signedText }) => {

  return (
    <div className={`transition-colors ${ev.terminated ? 'opacity-60 hover:opacity-80' : 'hover:bg-[#161b22]/60'}`}>
      {/* 摘要行 */}
      <div
        className="flex items-center gap-3 px-6 py-3 cursor-pointer"
        onClick={onToggle}
      >
        {/* 展开/收起 */}
        {isExpanded
          ? <ChevronUp size={14} className="text-gray-500 shrink-0" />
          : <ChevronDown size={14} className="text-gray-500 shrink-0" />}

        {/* 风险图标 / 已结束图标 */}
        {ev.terminated
          ? <Skull size={16} className="text-gray-600 shrink-0" />
          : ev.riskLevel === 'high'
          ? <ShieldAlert size={16} className="text-red-500 shrink-0" />
          : <Shield size={16} className="text-gray-500 shrink-0" />}

        {/* 进程名 + PID */}
        <span className={`text-sm font-medium w-[160px] truncate shrink-0 ${ev.terminated ? 'text-gray-500 line-through decoration-gray-600' : 'text-white'}`}>
          {ev.processName}
        </span>
        <span className="text-gray-600 text-xs w-[70px] shrink-0">PID: {ev.pid}</span>

        {/* 签名 */}
        <span className="flex items-center gap-1 w-[70px] shrink-0">
          {signedIcon(ev.isSigned)}
          <span className="text-xs text-gray-500">{signedText(ev.isSigned)}</span>
        </span>

        {/* 路径 */}
        <span className="text-gray-500 text-xs flex-1 truncate min-w-0">
          {ev.processPath}
        </span>

        {/* 已结束标签 / 风险等级 */}
        {ev.terminated ? (
          <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800/60 border border-gray-700/50 px-2 py-0.5 rounded w-[80px] justify-center shrink-0">
            <Skull size={10} /> 已结束
          </span>
        ) : (
          <span className={`text-xs font-bold w-[50px] text-right shrink-0 ${riskColor(ev.riskLevel)}`}>
            {ev.riskLevel.toUpperCase()}
          </span>
        )}

        {/* 状态 */}
        <span className={`text-xs px-2 py-0.5 rounded border w-[70px] text-center shrink-0 ${statusBadge(ev.status)}`}>
          {ev.status.toUpperCase()}
        </span>

        {/* 时间：如果已结束显示结束时间，否则显示创建时间 */}
        <span className="text-gray-600 text-xs w-[70px] text-right shrink-0">
          {ev.terminated && ev.terminatedAt
            ? new Date(ev.terminatedAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })
            : new Date(ev.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
        </span>
      </div>

      {/* 展开详情 */}
      {isExpanded && (
        <div className="px-6 pb-4 pt-1 ml-8 mr-6 mb-2 bg-[#161b22] rounded-lg border border-gray-800">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs py-3">
            <DetailField label="进程 ID (PID)" value={String(ev.pid)} />
            <DetailField label="父进程 ID (PPID)" value={String(ev.parentPid)} />
            <DetailField label="进程名" value={ev.processName} />
            <DetailField label="父进程名" value={ev.parentProcessName || '-'} />
            <DetailField label="进程完整路径" value={ev.processPath} full />
            <DetailField label="父进程完整路径" value={ev.parentProcessPath || '-'} full />
            <DetailField
              label="命令行参数"
              value={ev.cmdLine || '（无）'}
              full
              icon={<Terminal size={12} className="text-gray-600" />}
            />
            <DetailField
              label="签名状态"
              value={ev.isSigned === 2 ? '已签名 (Authenticode)' : ev.isSigned === 1 ? '未签名' : '未检查'}
              icon={ev.isSigned === 2
                ? <Lock size={12} className="text-green-500" />
                : ev.isSigned === 1
                ? <LockOpen size={12} className="text-red-400" />
                : <HelpCircle size={12} className="text-gray-600" />}
            />
            <DetailField label="风险等级" value={ev.riskLevel.toUpperCase()} />
            <DetailField label="处置状态" value={ev.status.toUpperCase()} />
            <DetailField label="触发规则" value={ev.ruleTriggered} full />
            <DetailField
              label="文件创建时间"
              value={ev.fileCreateTime > 0 ? new Date(ev.fileCreateTime).toLocaleString('zh-CN') : '未知'}
              icon={<Clock size={12} className="text-gray-600" />}
            />
            <DetailField
              label="事件时间"
              value={new Date(ev.timestamp).toLocaleString('zh-CN')}
              icon={<Clock size={12} className="text-gray-600" />}
            />
            <DetailField label="事件 ID" value={ev.id} full />
            {ev.terminated && ev.terminatedAt && (
              <DetailField
                label="进程结束时间"
                value={new Date(ev.terminatedAt).toLocaleString('zh-CN')}
                icon={<Skull size={12} className="text-gray-600" />}
              />
            )}
          </div>

          {/* ETW 行为链时间轴 */}
          <BehaviorChainTimeline etwEvents={ev.etwEvents} />

          {/* 操作按钮 */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-800 mt-1">
            <button
              onClick={(e) => { e.stopPropagation(); onViewBehavior(); }}
              className="px-3 py-1.5 rounded text-xs bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/20 transition-colors"
            >
              查看详情
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAnalyze(); }}
              className="px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700 transition-colors"
            >
              LLM 研判（弹窗）
            </button>
            {!ev.terminated && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`确认对 ${ev.processName}（PID: ${ev.pid}）执行内核阻断？\n此操作将立即终止该进程并从监控列表移除。`)) {
                    onBlock();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
              >
                <ShieldOff size={12} />
                内核阻断
              </button>
            )}
            {ev.terminated && (
              <span className="flex items-center gap-1.5 text-xs text-gray-600 px-3 py-1.5">
                <Skull size={12} />
                进程已结束，无法阻断
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 详情字段组件
 */
const DetailField: React.FC<{
  label: string;
  value: string;
  full?: boolean;    // 是否占整行
  icon?: React.ReactNode;
}> = ({ label, value, full, icon }) => (
  <div className={full ? 'col-span-2' : ''}>
    <span className="text-gray-600 flex items-center gap-1">
      {icon}
      {label}
    </span>
    <p className="text-gray-300 mt-0.5 break-all font-mono">{value}</p>
  </div>
);
