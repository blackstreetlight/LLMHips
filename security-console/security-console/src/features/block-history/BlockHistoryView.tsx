import React, { useMemo, useState } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import type { BlockRecord } from '../../types/index';
import {
  ShieldOff, Search, Trash2, Clock, Lock, LockOpen, HelpCircle,
  Terminal, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';

/**
 * 内核阻断历史页
 * 以工单卡片形式展示所有已阻断进程，重点展示进程创建时间和阻断时间
 */
export const BlockHistoryView: React.FC = () => {
  const { blockRecords, deleteBlockRecord, clearBlockRecords } = useSystemStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredRecords = useMemo(() => {
    return blockRecords.filter(r => {
      const matchRisk = riskFilter === 'all' || r.riskLevel === riskFilter;
      const matchSearch =
        !searchQuery ||
        r.processName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.processPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.cmdLine.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(r.pid).includes(searchQuery) ||
        r.ruleTriggered.toLowerCase().includes(searchQuery.toLowerCase());
      return matchRisk && matchSearch;
    });
  }, [blockRecords, riskFilter, searchQuery]);

  // ── 统计 ──
  const stats = useMemo(() => ({
    total: blockRecords.length,
    high: blockRecords.filter(r => r.riskLevel === 'high').length,
    medium: blockRecords.filter(r => r.riskLevel === 'medium').length,
    low: blockRecords.filter(r => r.riskLevel === 'low').length,
  }), [blockRecords]);

  const riskBadge = (level: string) => {
    if (level === 'high') return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (level === 'medium') return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    return 'bg-green-500/20 text-green-400 border-green-500/30';
  };

  const riskLabel = (level: string) => {
    if (level === 'high') return '高危';
    if (level === 'medium') return '中危';
    return '低危';
  };

  const signedInfo = (val: number) => {
    if (val === 2) return { icon: <Lock size={12} className="text-green-500" />, label: '已签名' };
    if (val === 1) return { icon: <LockOpen size={12} className="text-red-400" />, label: '未签名' };
    return { icon: <HelpCircle size={12} className="text-gray-600" />, label: '未知' };
  };

  /** 计算进程存活到阻断的时间差 */
  const lifespan = (createdAt: number, blockedAt: number) => {
    const ms = blockedAt - createdAt;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-gray-300 font-mono">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[#00d4ff] text-xl font-bold flex items-center gap-2">
            <ShieldOff size={22} className="text-red-400" />
            内核阻断历史
          </h2>
          <div className="flex items-center gap-4">
            {/* 统计 */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500">共 <span className="text-white font-bold">{stats.total}</span> 条</span>
              <span className="text-red-400">高危 {stats.high}</span>
              <span className="text-orange-400">中危 {stats.medium}</span>
              <span className="text-green-400">低危 {stats.low}</span>
            </div>
            {blockRecords.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('确认清空所有阻断历史记录？此操作不可撤销。')) {
                    clearBlockRecords();
                  }
                }}
                className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                title="清空所有记录"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        {/* 搜索 + 筛选 */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索进程名、路径、PID、触发规则..."
              className="w-full bg-[#161b22] border border-gray-700 rounded pl-9 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00d4ff] transition-colors"
            />
          </div>
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
        </div>
      </div>

      {/* ── 记录列表 ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <ShieldOff size={48} className="mb-3 opacity-20" />
            {blockRecords.length === 0 ? (
              <>
                <p className="text-sm">暂无阻断记录</p>
                <p className="text-xs mt-1 text-gray-700">在进程详情中展开进程，点击「内核阻断」执行拦截</p>
              </>
            ) : (
              <p className="text-sm">未找到匹配的记录</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecords.map(record => (
              <BlockTicket
                key={record.id}
                record={record}
                isExpanded={expandedIds.has(record.id)}
                onToggle={() => toggleExpand(record.id)}
                onDelete={() => deleteBlockRecord(record.id)}
                riskBadge={riskBadge}
                riskLabel={riskLabel}
                signedInfo={signedInfo}
                lifespan={lifespan}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 单张阻断工单卡片
 */
const BlockTicket: React.FC<{
  record: BlockRecord;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  riskBadge: (l: string) => string;
  riskLabel: (l: string) => string;
  signedInfo: (v: number) => { icon: React.ReactNode; label: string };
  lifespan: (created: number, blocked: number) => string;
}> = ({ record: r, isExpanded, onToggle, onDelete, riskBadge, riskLabel, signedInfo, lifespan }) => {
  const signed = signedInfo(r.isSigned);
  const span = lifespan(r.processCreatedAt, r.blockedAt);

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden hover:border-gray-600 transition-colors">

      {/* ── 工单摘要行（可点击展开） ── */}
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1c2129] transition-colors"
      >
        {/* 展开箭头 */}
        <div className="shrink-0 text-gray-600">
          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </div>

        {/* BLOCKED 徽章 */}
        <span className="shrink-0 px-2 py-0.5 rounded text-xs font-bold bg-red-900/60 text-red-400 border border-red-700/50 tracking-wider">
          BLOCKED
        </span>

        {/* 进程名 + PID */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium text-sm truncate">{r.processName}</span>
            <span className="text-gray-600 text-xs shrink-0">PID: {r.pid}</span>
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">{r.ruleTriggered}</p>
        </div>

        {/* 风险等级 */}
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded border font-medium ${riskBadge(r.riskLevel)}`}>
          {riskLabel(r.riskLevel)}
        </span>

        {/* 时间轴摘要 */}
        <div className="shrink-0 text-xs text-gray-500 text-right space-y-0.5 mr-1">
          <div className="flex items-center gap-1 justify-end">
            <Clock size={11} className="text-gray-600" />
            <span>存活 <span className="text-orange-400 font-mono">{span}</span></span>
          </div>
          <div className="text-gray-600">
            {new Date(r.blockedAt).toLocaleString('zh-CN', {
              month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            })}
          </div>
        </div>

        {/* 删除 */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="删除记录"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* ── 时间轴详情条（始终可见，不需要展开） ── */}
      <div className="border-t border-[#30363d]/60 px-4 py-2 bg-[#0a0d12] flex items-center gap-0 text-xs font-mono">
        {/* 创建时间 */}
        <div className="flex flex-col items-center gap-0.5 min-w-[200px]">
          <span className="text-gray-600 text-[10px] uppercase tracking-wider">进程捕获时间</span>
          <span className="text-gray-300">{new Date(r.processCreatedAt).toLocaleString('zh-CN')}</span>
        </div>

        {/* 箭头 + 时间差 */}
        <div className="flex-1 flex flex-col items-center gap-0.5">
          <span className="text-gray-700 text-[10px]">存活</span>
          <div className="flex items-center gap-1 w-full">
            <div className="flex-1 h-px bg-gradient-to-r from-gray-700 via-red-500/60 to-red-500" />
            <span className="text-red-400 font-bold shrink-0 px-1">{span}</span>
            <div className="w-0 h-0 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-8 border-l-red-500" />
          </div>
        </div>

        {/* 阻断时间 */}
        <div className="flex flex-col items-center gap-0.5 min-w-[200px] text-right items-end">
          <span className="text-red-400/70 text-[10px] uppercase tracking-wider">内核阻断时间</span>
          <span className="text-red-300">{new Date(r.blockedAt).toLocaleString('zh-CN')}</span>
        </div>
      </div>

      {/* ── 展开详情 ── */}
      {isExpanded && (
        <div className="border-t border-[#30363d] px-4 py-3 bg-[#0d1117]">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
            <InfoField label="进程 PID" value={String(r.pid)} />
            <InfoField label="父进程 PID" value={String(r.parentPid)} />
            <InfoField label="进程名" value={r.processName} />
            <InfoField label="父进程名" value={r.parentProcessName || '—'} />
            <InfoField label="进程完整路径" value={r.processPath} full />
            <InfoField
              label="命令行参数"
              value={r.cmdLine || '（无）'}
              full
              icon={<Terminal size={11} className="text-gray-600" />}
            />
            <div>
              <span className="text-gray-600 flex items-center gap-1">
                {signed.icon} 签名状态
              </span>
              <p className="text-gray-300 mt-0.5">{signed.label}</p>
            </div>
            <InfoField label="触发规则" value={r.ruleTriggered} />
            <InfoField label="阻断记录 ID" value={r.id} full />
          </div>

          {/* 阻断技术说明 */}
          <div className="mt-3 px-3 py-2 bg-red-900/10 border border-red-800/30 rounded text-xs text-red-400/80 flex items-center gap-2">
            <AlertTriangle size={12} className="shrink-0" />
            <span>
              已通过 <span className="font-bold text-red-400">ZwTerminateProcess</span> 内核调用强制终止该进程，
              进程已从监控事件列表中移除并归档至此历史页面。
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 展开详情中的字段组件
 */
const InfoField: React.FC<{
  label: string;
  value: string;
  full?: boolean;
  icon?: React.ReactNode;
}> = ({ label, value, full, icon }) => (
  <div className={full ? 'col-span-2' : ''}>
    <span className="text-gray-600 flex items-center gap-1">
      {icon}{label}
    </span>
    <p className="text-gray-300 mt-0.5 break-all font-mono">{value}</p>
  </div>
);
