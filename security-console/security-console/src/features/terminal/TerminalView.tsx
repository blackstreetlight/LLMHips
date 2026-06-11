/**
 * TerminalView.tsx — 终端控制面板
 *
 * 功能：
 *   - 使用 xterm.js 渲染终端，视觉上还原真实命令行体验
 *   - 连接到 C# 中间层的 shell 进程（通过现有 WebSocket，发送 terminal_start/terminal_input）
 *   - 终端输出通过 terminalBus 解耦（WS onmessage → bus.emit → term.write）
 *   - 美化：暗色 Cyber 主题 + 扫描线 CSS 动效 + 顶部状态栏
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { terminalBus } from '../../lib/terminalBus';
import { useSystemStore } from '../../store/useSystemStore';
import {
  TerminalSquare, Wifi, WifiOff, RefreshCw, Trash2, Copy,
  Maximize2, Minimize2,
} from 'lucide-react';

// ─── xterm 主题（Cyber 配色） ─────────────────────────────────────────────────

const XTERM_THEME = {
  background:  'transparent',           // 透明，让 CSS 背景透出来
  foreground:  '#c9d1d9',
  cursor:      '#00d4ff',
  cursorAccent:'#0d1117',
  selectionBackground: 'rgba(0,212,255,0.25)',
  black:       '#0d1117',
  red:         '#ff7b72',
  green:       '#3fb950',
  yellow:      '#d29922',
  blue:        '#58a6ff',
  magenta:     '#bc8cff',
  cyan:        '#39c5cf',
  white:       '#c9d1d9',
  brightBlack: '#6e7681',
  brightRed:   '#ffa198',
  brightGreen: '#56d364',
  brightYellow:'#e3b341',
  brightBlue:  '#79c0ff',
  brightMagenta:'#d2a8ff',
  brightCyan:  '#56d4dd',
  brightWhite: '#f0f6fc',
};

// ─── 组件 ─────────────────────────────────────────────────────────────────────

export const TerminalView: React.FC = () => {
  const { sendWsMessage, driverStatus } = useSystemStore();

  // xterm 实例和 DOM 引用
  const termRef     = useRef<Terminal | null>(null);
  const fitRef      = useRef<FitAddon | null>(null);
  const containerEl = useRef<HTMLDivElement>(null);

  const [connected,   setConnected]   = useState(false);
  const [fullscreen,  setFullscreen]  = useState(false);
  const [lineCount,   setLineCount]   = useState(0);

  // ─── 初始化 xterm ──────────────────────────────────────────────

  useEffect(() => {
    if (!containerEl.current) return;

    const term = new Terminal({
      fontFamily:      '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize:        13,
      lineHeight:      1.4,
      letterSpacing:   0.3,
      cursorBlink:     true,
      cursorStyle:     'bar',
      scrollback:      5000,
      theme:           XTERM_THEME,
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerEl.current);
    fit.fit();

    termRef.current = term;
    fitRef.current  = fit;

    // 打印欢迎信息
    term.writeln('\x1b[36m┌─────────────────────────────────────────┐\x1b[0m');
    term.writeln('\x1b[36m│\x1b[0m  \x1b[1;37mSENTINEL\x1b[0m \x1b[36mSECURITY CONSOLE — TERMINAL\x1b[0m    \x1b[36m│\x1b[0m');
    term.writeln('\x1b[36m└─────────────────────────────────────────┘\x1b[0m');
    term.writeln('');
    term.writeln('\x1b[33m  点击右上角「连接终端」按钮以启动 shell 会话\x1b[0m');
    term.writeln('');

    // 键盘输入 → WebSocket
    // 注意：onData 在 mount 时注册一次，闭包里的 `connected` state 会永远是初始值 false，
    // 因此必须通过 connectedRef（在组件顶层声明，每次 render 更新）来读取最新状态。
    term.onData((data) => {
      if (connectedRef.current) {
        sendWsMessage({ type: 'terminal_input', payload: { data } });
      }
    });

    // 统计行数（仅用于状态栏显示）
    term.onLineFeed(() => setLineCount(c => c + 1));

    // 窗口 resize → fit 重新计算
    const onResize = () => { fitRef.current?.fit(); };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // 只 mount 一次；connected 状态通过 connectedRef 透传，无需重新注册 onData

  // connectedRef 跟踪最新的 connected 值，供 onData 闭包读取
  const connectedRef = useRef(false);
  connectedRef.current = connected;

  // ─── 订阅终端输出总线 ──────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = terminalBus.onOutput((data) => {
      termRef.current?.write(data);
    });
    return unsubscribe;
  }, []);

  // ─── 连接 / 断开 ───────────────────────────────────────────────

  const connect = useCallback(() => {
    if (connected) return;
    sendWsMessage({ type: 'terminal_start' });
    setConnected(true);
    setLineCount(0);
    termRef.current?.clear();
    termRef.current?.writeln('\x1b[32m● 已连接到远端 shell\x1b[0m');
    termRef.current?.writeln('');
  }, [connected, sendWsMessage]);

  const disconnect = useCallback(() => {
    if (!connected) return;
    sendWsMessage({ type: 'terminal_close' });
    setConnected(false);
    termRef.current?.writeln('');
    termRef.current?.writeln('\x1b[31m● 连接已断开\x1b[0m');
  }, [connected, sendWsMessage]);

  const clearTerminal = useCallback(() => {
    termRef.current?.clear();
    setLineCount(0);
  }, []);

  const copySelection = useCallback(() => {
    const sel = termRef.current?.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
  }, []);

  // 全屏时重新 fit
  useEffect(() => {
    setTimeout(() => fitRef.current?.fit(), 50);
  }, [fullscreen]);

  // ─── 渲染 ──────────────────────────────────────────────────────

  return (
    <div
      className={`flex flex-col bg-[#0d1117] text-gray-300 font-mono overflow-hidden
        ${fullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}
    >
      {/* ── 顶部状态栏 ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 h-10 border-b border-[#00d4ff]/15 bg-[#0a0d12]">
        {/* 图标 + 标题 */}
        <TerminalSquare size={14} className="text-[#00d4ff]" />
        <span className="text-xs text-gray-400 tracking-widest">TERMINAL</span>

        {/* 连接状态 */}
        <div className="flex items-center gap-1.5">
          {connected
            ? <><span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_#4ade80] animate-pulse" /><span className="text-[11px] text-green-400">已连接</span></>
            : <><span className="w-1.5 h-1.5 rounded-full bg-gray-600" /><span className="text-[11px] text-gray-600">未连接</span></>
          }
        </div>

        <div className="w-px h-4 bg-gray-700" />

        {/* 行计数 */}
        {connected && (
          <span className="text-[11px] text-gray-600">{lineCount} 行</span>
        )}

        {/* WS 状态 */}
        <div className="flex items-center gap-1 text-[11px]">
          {driverStatus === 'online'
            ? <Wifi size={10} className="text-green-400" />
            : <WifiOff size={10} className="text-gray-600" />
          }
          <span className={driverStatus === 'online' ? 'text-green-400' : 'text-gray-600'}>
            {driverStatus === 'online' ? 'Bridge Online' : 'Bridge Offline'}
          </span>
        </div>

        {/* 右侧操作按钮 */}
        <div className="ml-auto flex items-center gap-1">
          <ToolBtn title="复制选中" onClick={copySelection}><Copy size={11} /></ToolBtn>
          <ToolBtn title="清空" onClick={clearTerminal}><Trash2 size={11} /></ToolBtn>
          <ToolBtn title={fullscreen ? '退出全屏' : '全屏'} onClick={() => setFullscreen(v => !v)}>
            {fullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </ToolBtn>

          <div className="w-px h-4 bg-gray-700 mx-1" />

          {connected ? (
            <button
              onClick={disconnect}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              <WifiOff size={10} /> 断开
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={driverStatus !== 'online'}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/30 hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <RefreshCw size={10} /> 连接终端
            </button>
          )}
        </div>
      </div>

      {/* ── 终端主体 ── */}
      <div className="flex-1 relative overflow-hidden">
        {/* 赛博朋克背景：网格 + 渐变 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              linear-gradient(180deg, rgba(0,212,255,0.015) 0%, transparent 30%, transparent 70%, rgba(0,212,255,0.01) 100%),
              repeating-linear-gradient(0deg, transparent, transparent 24px, rgba(0,212,255,0.025) 24px, rgba(0,212,255,0.025) 25px),
              repeating-linear-gradient(90deg, transparent, transparent 24px, rgba(0,212,255,0.015) 24px, rgba(0,212,255,0.015) 25px)
            `,
          }}
        />

        {/* 扫描线动效 */}
        <div
          className="absolute inset-0 pointer-events-none scanline"
          style={{ mixBlendMode: 'overlay' }}
        />

        {/* xterm 挂载点 */}
        <div
          ref={containerEl}
          className="absolute inset-0 px-3 pt-2"
          style={{ zIndex: 1 }}
        />
      </div>

      {/* 扫描线 CSS */}
      <style>{`
        @keyframes scanline {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        .scanline::after {
          content: '';
          display: block;
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 120px;
          background: linear-gradient(180deg,
            transparent 0%,
            rgba(0,212,255,0.03) 40%,
            rgba(0,212,255,0.06) 50%,
            rgba(0,212,255,0.03) 60%,
            transparent 100%
          );
          animation: scanline 8s linear infinite;
          pointer-events: none;
        }
        /* xterm 背景透明 */
        .xterm .xterm-viewport { background: transparent !important; }
        .xterm-screen canvas { image-rendering: pixelated; }
      `}</style>
    </div>
  );
};

// ─── 工具按钮 ─────────────────────────────────────────────────────────────────

const ToolBtn: React.FC<{
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ title, onClick, children }) => (
  <button
    title={title}
    onClick={onClick}
    className="p-1.5 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
  >
    {children}
  </button>
);
