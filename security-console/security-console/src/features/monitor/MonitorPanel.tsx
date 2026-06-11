import React, { useMemo, useRef, useState } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import { ShieldAlert, Activity, CheckCircle, Trash2, Lock, LockOpen, HelpCircle, ShieldCheck, EyeOff, Zap } from 'lucide-react';
import { WhitelistDrawer } from './WhitelistDrawer';

/**
 * 实时监控面板组件
 * 显示实时进程威胁监控事件列表
 */
export const MonitorPanel: React.FC = () => {
  const { events, isMonitoring, setSelectedEvent, clearEvents, isWhitelisted } = useSystemStore();

  // ── Local filter state ──
  const [filterLevel, setFilterLevel] = useState<'HIGH' | 'MED' | 'LOW' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hideWhitelisted, setHideWhitelisted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 列表滚动容器引用，用于清空时即时滚顶
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * 根据风险等级获取对应的样式类名
   */   
  const getRiskStyles = (level: string) => {
    switch (level) {
      case 'high':   return 'bg-red-500/10 border-red-500 text-red-500 animate-pulse-fast';
      case 'medium': return 'bg-orange-500/10 border-orange-500 text-orange-500';
      case 'low':    return 'bg-green-500/10 border-green-500 text-green-500';
      default:       return '';
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'blocked':  return 'bg-red-900/50 text-red-400 shadow-[0_0_6px_rgba(239,68,68,0.35)] border border-red-800/60';
      case 'watching': return 'bg-orange-900/30 text-orange-400 border border-orange-800/50';
      case 'allowed':  return 'bg-green-900/30 text-green-400 border border-green-800/50';
      default:         return 'bg-gray-700 text-gray-300';
    }
  };

  // 过滤 + 搜索 + 白名单隐藏 + 已结束隐藏 + 时间戳降序兜底排序，用 useMemo 避免无关 re-render 重算
  const filteredEvents = useMemo(() => {
    return events
      .filter(ev => {
        // 实时监控面板永远隐藏已结束进程（到进程详情页查历史）
        if (ev.terminated) return false;
        const levelMatch =
          !filterLevel ||
          (filterLevel === 'HIGH' && ev.riskLevel === 'high') ||
          (filterLevel === 'MED'  && ev.riskLevel === 'medium') ||
          (filterLevel === 'LOW'  && ev.riskLevel === 'low');
        const searchMatch =
          !searchQuery || ev.processName.toLowerCase().includes(searchQuery.toLowerCase());
        const whitelistMatch =
          !hideWhitelisted || !isWhitelisted(ev.processName, ev.processPath);
        return levelMatch && searchMatch && whitelistMatch;
      })
      .sort((a, b) => b.timestamp - a.timestamp); // 保证最新事件始终在顶部
  }, [events, filterLevel, searchQuery, hideWhitelisted, isWhitelisted]);

  return (
    <div className="bg-[#0d1117] h-full p-4 flex flex-col font-mono text-gray-300">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-2 border-b border-gray-800 pb-2">
        <h2 className="text-[#00d4ff] text-xl font-bold flex items-center gap-2">
          <Activity size={24} /> 实时进程威胁监控
        </h2>
        <div className="flex items-center gap-3">
          {/* Event counter */}
          <span className="text-sm text-brand-cyan font-mono">
            TOTAL: {events.length}
          </span>
          {/* 监控状态 */}
          <span className={`text-sm flex items-center gap-1 ${isMonitoring ? 'text-green-400' : 'text-gray-500'}`}>
            {isMonitoring && <span className="w-2 h-2 rounded-full bg-green-500 animate-ping" />}
            {isMonitoring ? '监控中' : '监控已停止'}
          </span>
          {/* Clear button */}
          <button
            onClick={() => { clearEvents(); listRef.current && (listRef.current.scrollTop = 0); }}
            className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="清空事件列表"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 mb-3">
        {(['HIGH', 'MED', 'LOW'] as const).map(level => (
          <button
            key={level}
            onClick={() => setFilterLevel(filterLevel === level ? null : level)}
            className={`px-2.5 py-0.5 rounded text-xs font-mono transition-colors border
              ${filterLevel === level
                ? level === 'HIGH'
                  ? 'bg-red-500/20 text-red-400 border-red-500/50'
                  : level === 'MED'
                  ? 'bg-orange-500/20 text-orange-400 border-orange-500/50'
                  : 'bg-green-500/20 text-green-400 border-green-500/50'
                : 'text-gray-500 border-gray-700 hover:border-gray-600 hover:text-gray-400'}`}
          >
            {level}
          </button>
        ))}

        {/* 不显示白名单 toggle */}
        <button
          onClick={() => setHideWhitelisted(v => !v)}
          title={hideWhitelisted ? '已隐藏白名单进程，点击取消' : '点击隐藏白名单进程'}
          className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-mono transition-colors border ${
            hideWhitelisted
              ? 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/40'
              : 'text-gray-500 border-gray-700 hover:border-gray-600 hover:text-gray-400'
          }`}
        >
          <EyeOff size={11} />
          白名单
        </button>

        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜索进程名..."
          className="flex-1 bg-[#161b22] border border-gray-700 rounded px-2.5 py-0.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
        />

        {/* 白名单管理入口 */}
        <button
          onClick={() => setDrawerOpen(true)}
          title="编辑白名单"
          className="flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-mono border text-gray-500 border-gray-700 hover:border-[#00d4ff]/50 hover:text-[#00d4ff] transition-colors"
        >
          <ShieldCheck size={11} />
          白名单
        </button>
      </div>

      {/* ── Whitelist Drawer ── */}
      <WhitelistDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* ── Event list ── */}
      <div ref={listRef} className="flex-1 overflow-y-auto pr-2 relative">
        {/* Top gradient fade mask */}
        <div
          className="sticky top-0 left-0 right-0 h-8 pointer-events-none z-10 -mb-8"
          style={{ background: 'linear-gradient(to bottom, #0d1117 0%, transparent 100%)' }}
        ></div>

        <div className="space-y-2">
          {filteredEvents.map((ev) => (
            <div
              key={ev.id}
              onClick={() => setSelectedEvent(ev)}
              className={`cursor-pointer border-l-4 p-3 flex justify-between items-start bg-[#161b22] hover:bg-gray-800 hover:border-gray-500 transition-colors ${getRiskStyles(ev.riskLevel)}`}
            >
              {/* Left: icon + process info */}
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {ev.riskLevel === 'high'
                  ? <ShieldAlert size={20} className="shrink-0 mt-0.5" />
                  : <CheckCircle  size={20} className="shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  {/* 进程名 + PID + 签名状态 */}
                  <p className="font-bold text-white truncate flex items-center gap-1.5">
                    {ev.processName}{' '}
                    <span className="text-gray-500 text-sm font-normal">(PID: {ev.pid})</span>
                    {ev.isSigned === 2 && <Lock size={12} className="text-green-500" aria-label="已签名" />}
                    {ev.isSigned === 1 && <LockOpen size={12} className="text-red-400" aria-label="未签名" />}
                    {ev.isSigned === 0 && <HelpCircle size={12} className="text-gray-600" aria-label="签名未知" />}
                  </p>
                  {/* 触发规则 */}
                  <p className="text-xs mt-0.5 font-sans text-gray-400 truncate">{ev.ruleTriggered}</p>
                </div>
              </div>

              {/* Right: etw badge + status badge + time */}
              <div className="text-right text-sm shrink-0 ml-3 flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {/* ETW 行为计数徽章：有事件时显示 */}
                  {(ev.etwEvents?.length ?? 0) > 0 && (
                    <span
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/25 font-mono"
                      title={`已捕获 ${ev.etwEvents!.length} 条 ETW 行为事件`}
                    >
                      <Zap size={9} />
                      {ev.etwEvents!.length}
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadgeClass(ev.status)}`}>
                    {ev.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-gray-500 text-xs">
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
