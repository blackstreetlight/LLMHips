import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Dashboard } from './features/dashboard/Dashboard';
import { MonitorPanel } from './features/monitor/MonitorPanel';
import { LLMAnalysisView } from './features/llm/LLMAnalysisView';
import { ProcessDetailView } from './features/process-detail/ProcessDetailView';
import { ProcessBehaviorView } from './features/process-behavior/ProcessBehaviorView';
import { LLMHistoryView } from './features/llm-history/LLMHistoryView';
import { BlockHistoryView } from './features/block-history/BlockHistoryView';
import { ProcessTreeView } from './features/process-tree/ProcessTreeView';
import { SettingsView } from './features/settings/SettingsView';
import { TerminalView } from './features/terminal/TerminalView';
import { useSystemStore } from './store/useSystemStore';
import type { ProcessEvent } from './types/index';
import { registerTerminalSkill } from './features/skills/handlers/terminalSkillHandler';
import {
  LayoutDashboard, FileSearch, Bot, Terminal, ShieldCheck,
  Settings, LogOut, Power, ShieldOff, GitBranch, TerminalSquare,
} from 'lucide-react';

// ── 一次性注册 AI 技能（应用启动时执行）──────────────────────────────────────
// 后续新增技能，在此处追加 registerXxxSkill() 即可
let _skillsRegistered = false;

/**
 * 侧边栏页面 ID
 */
type PageId = 'dashboard' | 'process-detail' | 'process-tree' | 'llm-history' | 'block-history' | 'terminal' | 'settings';

/**
 * 侧边栏菜单项
 */
const sidebarItems: { id: PageId; icon: typeof LayoutDashboard; label: string }[] = [
  { id: 'dashboard',      icon: LayoutDashboard, label: '系统总览' },
  { id: 'process-detail', icon: FileSearch,      label: '进程详情' },
  { id: 'process-tree',   icon: GitBranch,       label: '进程树' },
  { id: 'llm-history',   icon: Bot,             label: 'LLM 研判历史' },
  { id: 'block-history', icon: ShieldOff,       label: '阻断历史' },
  { id: 'terminal',      icon: TerminalSquare,  label: '终端控制' },
];

export default function App() {
  // ── 页面路由 ──
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const { sendWsMessage } = useSystemStore();
  // 进程行为详情面板：选中的进程
  const [behaviorEvent, setBehaviorEvent] = useState<ProcessEvent | null>(null);

  // ── 面板拖拽 ──
  const [leftWidth, setLeftWidth] = useState(65);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Store ──
  const { driverStatus, isMonitoring, toggleMonitoring, eventStats, loadWhitelist } = useSystemStore();

  // ── 注册 AI 技能（仅首次 render 时执行一次）──
  useEffect(() => {
    if (_skillsRegistered) return;
    _skillsRegistered = true;
    registerTerminalSkill((msg) => sendWsMessage(msg));
  }, [sendWsMessage]);

  // 应用启动时从 whitelist.json 加载白名单
  useEffect(() => {
    loadWhitelist();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
  };

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = 'default';
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (pct > 30 && pct < 80) setLeftWidth(pct);
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // ── 状态指示器颜色 ──
  const driverColor = driverStatus === 'online'
    ? 'bg-green-400 shadow-[0_0_5px_#4ade80]'
    : driverStatus === 'error'
    ? 'bg-red-400 shadow-[0_0_5px_#f87171]'
    : 'bg-gray-500';

  const driverLabel = driverStatus === 'online' ? 'Driver' : driverStatus === 'error' ? 'Driver ERR' : 'Driver OFF';

  const networkColor = driverStatus === 'online'
    ? 'bg-green-400 shadow-[0_0_5px_#4ade80]'
    : 'bg-gray-500';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0d1117]">

      {/* ── 顶部状态栏 ── */}
      <div className="h-9 shrink-0 bg-[#0a0d12] border-b border-gray-800 flex items-center justify-between px-4 z-40">
        <span className="font-mono text-xs text-gray-500 tracking-widest">
          SENTINEL SECURITY CONSOLE v1.0.0
        </span>

        {/* 实时状态指示器 */}
        <div className="flex items-center gap-5">
          {/* 总开关 */}
          <button
            onClick={toggleMonitoring}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono transition-all border ${
              isMonitoring
                ? 'bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20'
                : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700 hover:text-gray-300'
            }`}
          >
            <Power size={12} className={isMonitoring ? 'text-green-400' : 'text-gray-500'} />
            {isMonitoring ? 'MONITORING' : 'STOPPED'}
          </button>

          <div className="w-px h-4 bg-gray-700" />

          {/* Driver 状态 */}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${driverColor} ${driverStatus === 'online' ? '' : ''}`} />
            <span className="font-mono text-xs text-gray-500">{driverLabel}</span>
          </div>

          {/* LLM 状态 */}
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan shadow-[0_0_5px_#00d4ff] animate-pulse" />
            <span className="font-mono text-xs text-gray-500">LLM</span>
          </div>

          {/* 网络状态 */}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${networkColor}`} />
            <span className="font-mono text-xs text-gray-500">Network</span>
          </div>

          <div className="w-px h-4 bg-gray-700" />

          {/* 实时计数 */}
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-red-400">{eventStats.totalBlocked} blocked</span>
            <span className="text-orange-400">{eventStats.totalHigh} high</span>
          </div>
        </div>

        {/* 用户区 */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-400 tracking-wider">ADMIN</span>
          <LogOut size={13} className="text-gray-600 cursor-pointer hover:text-gray-300 transition-colors" />
        </div>
      </div>

      {/* ── 主布局 ── */}
      <div className="flex flex-1 overflow-hidden relative select-none">
        <LLMAnalysisView />

        {/* ── 侧边栏 ── */}
        <div
          className="w-16 flex flex-col items-center py-4 bg-[#161b22] z-10 shrink-0 relative"
          style={{
            borderRight: '1px solid rgba(0,212,255,0.12)',
            boxShadow: '2px 0 16px rgba(0,212,255,0.04)',
          }}
        >
          {/* Brand icon */}
          <div className="w-8 h-8 rounded bg-[#00d4ff] shadow-[0_0_16px_#00d4ff] mb-2 shrink-0" />
          <div className="w-8 h-px bg-gray-700/70 mb-3 shrink-0" />

          {/* 可点击的菜单项 */}
          <nav className="flex flex-col items-center gap-1 flex-1 w-full">
            {sidebarItems.map(({ id, icon: Icon, label }) => {
              const isActive = activePage === id;
              return (
                <div key={id} className="relative w-full flex justify-center py-0.5">
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-7 bg-[#00d4ff] rounded-r shadow-[0_0_6px_#00d4ff]" />
                  )}
                  <div
                    onClick={() => { setActivePage(id); setBehaviorEvent(null); }}
                    className={`group relative p-2.5 rounded-lg cursor-pointer transition-colors
                      ${isActive ? 'bg-[#00d4ff]/10' : 'hover:bg-gray-800'}`}
                  >
                    <Icon
                      size={18}
                      className={isActive
                        ? 'text-[#00d4ff]'
                        : 'text-gray-500 group-hover:text-gray-300 transition-colors'}
                    />
                    <span className="absolute left-12 top-1/2 -translate-y-1/2 bg-[#161b22] border border-gray-700 text-gray-200 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity duration-150">
                      {label}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* 未实现的按钮保留灰色 */}
            {[
              { icon: Terminal, label: '驱动控制台' },
              { icon: ShieldCheck, label: '规则管理' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="relative w-full flex justify-center py-0.5">
                <div className="group relative p-2.5 rounded-lg cursor-not-allowed opacity-40">
                  <Icon size={18} className="text-gray-500" />
                  <span className="absolute left-12 top-1/2 -translate-y-1/2 bg-[#161b22] border border-gray-700 text-gray-200 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity duration-150">
                    {label}（开发中）
                  </span>
                </div>
              </div>
            ))}
          </nav>

          {/* 底部设置 */}
          <div
            onClick={() => setActivePage('settings')}
            className={`group relative p-2.5 rounded-lg cursor-pointer transition-colors shrink-0
              ${activePage === 'settings' ? 'bg-[#00d4ff]/10' : 'hover:bg-gray-800'}`}
          >
            <Settings size={18} className={`transition-colors ${activePage === 'settings' ? 'text-[#00d4ff]' : 'text-gray-500 group-hover:text-gray-300'}`} />
            <span className="absolute left-12 top-1/2 -translate-y-1/2 bg-[#161b22] border border-gray-700 text-gray-200 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50 transition-opacity duration-150">
              设置
            </span>
          </div>
        </div>

        {/* ── 主内容区 ── */}
        <div className="flex-1 flex flex-row z-10 relative" ref={containerRef}>
          {activePage === 'dashboard' && (
            <>
              <div style={{ width: `${leftWidth}%` }} className="h-full overflow-hidden">
                <Dashboard />
              </div>

              <div
                onMouseDown={handleMouseDown}
                className="w-1.5 bg-gray-800 hover:bg-[#00d4ff] cursor-col-resize transition-colors z-20 flex flex-col justify-center items-center group relative shadow-[0_0_10px_rgba(0,0,0,0.5)]"
              >
                <div className="h-8 w-0.5 bg-gray-500 group-hover:bg-white rounded transition-colors" />
              </div>

              <div style={{ width: `${100 - leftWidth}%` }} className="h-full min-w-[300px] overflow-hidden">
                <MonitorPanel />
              </div>
            </>
          )}

          {activePage === 'process-detail' && !behaviorEvent && (
            <div className="w-full h-full overflow-hidden">
              <ProcessDetailView
                onViewBehavior={(ev) => {
                  setBehaviorEvent(ev);
                }}
              />
            </div>
          )}

          {activePage === 'process-detail' && behaviorEvent && (
            <div className="w-full h-full overflow-hidden">
              <ProcessBehaviorView
                event={behaviorEvent}
                onBack={() => setBehaviorEvent(null)}
              />
            </div>
          )}

          {activePage === 'process-tree' && (
            <div className="w-full h-full overflow-hidden">
              <ProcessTreeView />
            </div>
          )}

          {activePage === 'llm-history' && (
            <div className="w-full h-full overflow-hidden">
              <LLMHistoryView />
            </div>
          )}

          {activePage === 'block-history' && (
            <div className="w-full h-full overflow-hidden">
              <BlockHistoryView />
            </div>
          )}

          {activePage === 'terminal' && (
            <div className="w-full h-full overflow-hidden">
              <TerminalView />
            </div>
          )}

          {activePage === 'settings' && (
            <div className="w-full h-full overflow-hidden">
              <SettingsView />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
