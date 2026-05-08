import React, { useMemo, useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
  Position,
  MarkerType,
} from 'reactflow';
import dagre from '@dagrejs/dagre';
import 'reactflow/dist/style.css';

import { useSystemStore } from '../../store/useSystemStore';
import type { ProcessEvent } from '../../types/index';
import {
  ShieldAlert, Shield, Lock, LockOpen, HelpCircle,
  Skull, Activity, Search, X, EyeOff,
} from 'lucide-react';

// ── Dagre 布局参数 ────────────────────────────────────────────────────────────
const NODE_WIDTH  = 220;
const NODE_HEIGHT = 72;

function getDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 60 });

  nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach(e => g.setEdge(e.source, e.target));

  dagre.layout(g);

  const layoutedNodes = nodes.map(n => {
    const { x, y } = g.node(n.id);
    return {
      ...n,
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      targetPosition: direction === 'LR' ? Position.Left  : Position.Top,
      sourcePosition: direction === 'LR' ? Position.Right : Position.Bottom,
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ── 自定义节点类型 ────────────────────────────────────────────────────────────

interface NodeData {
  event: ProcessEvent;
  onSelect: (ev: ProcessEvent) => void;
}

const ProcessNode: React.FC<NodeProps<NodeData>> = ({
  data,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
}) => {
  const { event: ev, onSelect } = data;

  const borderColor = ev.terminated
    ? '#374151'
    : ev.riskLevel === 'high'   ? '#ef4444'
    : ev.riskLevel === 'medium' ? '#f97316'
    : '#22c55e';

  const bgColor = ev.terminated
    ? '#111827'
    : ev.riskLevel === 'high'   ? 'rgba(239,68,68,0.07)'
    : ev.riskLevel === 'medium' ? 'rgba(249,115,22,0.07)'
    : 'rgba(34,197,94,0.05)';

  const glowColor = ev.terminated
    ? 'none'
    : ev.riskLevel === 'high'   ? '0 0 12px rgba(239,68,68,0.35)'
    : ev.riskLevel === 'medium' ? '0 0 10px rgba(249,115,22,0.25)'
    : '0 0 8px rgba(34,197,94,0.15)';

  const signedIcon = ev.isSigned === 2
    ? <Lock size={11} className="text-green-500 shrink-0" />
    : ev.isSigned === 1
    ? <LockOpen size={11} className="text-red-400 shrink-0" />
    : <HelpCircle size={11} className="text-gray-600 shrink-0" />;

  const riskIcon = ev.terminated
    ? <Skull size={14} className="text-gray-600 shrink-0" />
    : ev.riskLevel === 'high'
    ? <ShieldAlert size={14} className="text-red-400 shrink-0 animate-pulse" />
    : <Shield size={14} className={`shrink-0 ${ev.riskLevel === 'medium' ? 'text-orange-400' : 'text-green-500'}`} />;

  const riskBadge = ev.terminated
    ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-600 border border-gray-700 flex items-center gap-0.5"><Skull size={8} />已结束</span>
    : ev.riskLevel === 'high'
    ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-400 border border-red-800/60 font-mono">HIGH</span>
    : ev.riskLevel === 'medium'
    ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400 border border-orange-800/50 font-mono">MED</span>
    : <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-500 border border-green-800/40 font-mono">LOW</span>;

  const handleStyle = {
    background: borderColor,
    width: 8,
    height: 8,
    border: '2px solid #0d1117',
  };

  return (
    <div
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        boxShadow: glowColor,
        opacity: ev.terminated ? 0.55 : 1,
        borderRadius: 8,
        padding: '8px 10px',
        fontFamily: 'monospace',
        cursor: 'pointer',
        transition: 'opacity 0.2s, box-shadow 0.2s',
        userSelect: 'none',
        position: 'relative',
      }}
      onClick={() => onSelect(ev)}
    >
      {/* 连接句柄 — dagre 计算出的方向决定位置 */}
      <Handle type="target" position={targetPosition} style={handleStyle} />
      <Handle type="source" position={sourcePosition} style={handleStyle} />
      {/* 顶行：图标 + 进程名 + 风险标签 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {riskIcon}
        <span style={{
          color: ev.terminated ? '#6b7280' : '#f3f4f6',
          fontSize: 13,
          fontWeight: 600,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: ev.terminated ? 'line-through' : 'none',
          textDecorationColor: '#4b5563',
        }}>
          {ev.processName}
        </span>
        {riskBadge}
      </div>

      {/* 底行：PID + 签名 + 时间 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#6b7280' }}>
        <span style={{ color: '#9ca3af' }}>PID {ev.pid}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {signedIcon}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9 }}>
          {ev.terminated && ev.terminatedAt
            ? `✕ ${new Date(ev.terminatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : new Date(ev.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>

      {/* 父进程名 */}
      {ev.parentProcessName && (
        <div style={{ fontSize: 9, color: '#4b5563', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ← {ev.parentProcessName}
        </div>
      )}
    </div>
  );
};

const nodeTypes = { processNode: ProcessNode };

// ── 数据转换：ProcessEvent[] → RF nodes + edges ───────────────────────────────

function buildRFGraph(
  events: ProcessEvent[],
  onSelect: (ev: ProcessEvent) => void,
): { nodes: Node[]; edges: Edge[] } {
  const pidSet = new Set(events.map(e => e.pid));

  const nodes: Node[] = events.map(ev => ({
    id: String(ev.pid),
    type: 'processNode',
    position: { x: 0, y: 0 },   // dagre 会覆盖
    data: { event: ev, onSelect },
    // 让 React Flow 知道句柄位置（dagre layout 完成后再设置）
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  }));

  const edges: Edge[] = [];
  events.forEach(ev => {
    if (ev.parentPid && pidSet.has(ev.parentPid) && ev.parentPid !== ev.pid) {
      const isHighRisk = ev.riskLevel === 'high' && !ev.terminated;
      edges.push({
        id: `e-${ev.parentPid}-${ev.pid}`,
        source: String(ev.parentPid),
        target: String(ev.pid),
        animated: isHighRisk,
        style: {
          stroke: isHighRisk ? '#ef4444'
                : ev.riskLevel === 'medium' && !ev.terminated ? '#f97316'
                : ev.terminated ? '#374151'
                : '#374151',
          strokeWidth: isHighRisk ? 2 : 1.5,
          opacity: ev.terminated ? 0.35 : 0.8,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isHighRisk ? '#ef4444' : '#374151',
          width: 14,
          height: 14,
        },
      });
    }
  });

  return { nodes, edges };
}

// ── 主视图 ────────────────────────────────────────────────────────────────────

export const ProcessTreeView: React.FC = () => {
  const { events, setSelectedEvent } = useSystemStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [hideTerminated, setHideTerminated] = useState(false);
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // 过滤后的事件
  const displayedEvents = useMemo(() => {
    let list = hideTerminated ? events.filter(e => !e.terminated) : events;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      // 搜索命中自身，或者父链上有命中 → 都保留（简化：先只过滤命中者，连线由 buildRFGraph 自动处理）
      list = list.filter(e =>
        e.processName.toLowerCase().includes(q) ||
        String(e.pid).includes(q) ||
        e.processPath.toLowerCase().includes(q)
      );
    }
    return list;
  }, [events, hideTerminated, searchQuery]);

  // 重新计算布局
  const relayout = useCallback((evts: ProcessEvent[], dir: 'TB' | 'LR') => {
    const { nodes, edges } = buildRFGraph(evts, setSelectedEvent);
    if (nodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }
    const { nodes: ln, edges: le } = getDagreLayout(nodes, edges, dir);
    setRfNodes(ln);
    setRfEdges(le);
  }, [setSelectedEvent, setRfNodes, setRfEdges]);

  // events / 过滤条件 / 方向变化时重新布局
  useEffect(() => {
    relayout(displayedEvents, direction);
  }, [displayedEvents, direction, relayout]);

  // ── 统计 ──
  const stats = useMemo(() => ({
    total:      events.length,
    alive:      events.filter(e => !e.terminated).length,
    terminated: events.filter(e => e.terminated).length,
    highRisk:   events.filter(e => e.riskLevel === 'high' && !e.terminated).length,
  }), [events]);

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-gray-300 font-mono">

      {/* ── Header ── */}
      <div className="px-5 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <h1 className="text-lg font-bold text-[#00d4ff] flex items-center gap-2">
            <Activity size={18} /> 实时进程树
          </h1>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-gray-400">
              活跃 <span className="text-green-400 font-bold">{stats.alive}</span>
            </span>
            <span className="text-gray-400">
              已结束 <span className="text-gray-500 font-bold">{stats.terminated}</span>
            </span>
            {stats.highRisk > 0 && (
              <span className="flex items-center gap-1 text-red-400 animate-pulse">
                <ShieldAlert size={11} />
                {stats.highRisk} 高危
              </span>
            )}
          </div>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-2">
          {/* 搜索 */}
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索进程名、PID、路径..."
              className="w-full bg-[#161b22] border border-gray-700 rounded pl-7 pr-7 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00d4ff] transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                <X size={12} />
              </button>
            )}
          </div>

          {/* 布局方向切换 */}
          <button
            onClick={() => setDirection(d => d === 'TB' ? 'LR' : 'TB')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 text-xs transition-colors"
            title={direction === 'TB' ? '切换为左右布局' : '切换为上下布局'}
          >
            {direction === 'TB' ? '↕ 上下' : '↔ 左右'}
          </button>

          {/* 隐藏已结束 */}
          <button
            onClick={() => setHideTerminated(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-colors ${
              hideTerminated
                ? 'bg-gray-800/60 text-gray-300 border-gray-600'
                : 'text-gray-600 border-gray-700 hover:text-gray-400 hover:border-gray-600'
            }`}
          >
            <EyeOff size={12} />
            {hideTerminated ? '已隐藏结束' : '隐藏已结束'}
          </button>
        </div>
      </div>

      {/* ── 图例 ── */}
      <div className="px-5 py-1.5 border-b border-gray-800/40 shrink-0 flex items-center gap-5 text-[10px] text-gray-600">
        <span className="flex items-center gap-1.5"><span className="w-3 h-px bg-red-500 inline-block" />高危连线（流动动画）</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-px bg-orange-500/60 inline-block" />中危连线</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-px bg-gray-600 inline-block" />低危 / 已结束</span>
        <span className="text-gray-700 ml-auto">点击节点 → LLM 研判 · 滚轮缩放 · 拖拽平移</span>
      </div>

      {/* ── React Flow 画布 ── */}
      <div className="flex-1 relative">
        {rfNodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-700">
            <Activity size={44} className="mb-3 opacity-20" />
            <p className="text-sm">暂无进程数据</p>
            <p className="text-xs mt-1 opacity-60">等待驱动上报进程事件...</p>
          </div>
        ) : (
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.15}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            className="bg-[#0d1117]"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="#1f2937"
            />
            <Controls
              className="!bg-[#161b22] !border-gray-700"
              style={{ bottom: 24, left: 16 }}
            />
            <MiniMap
              nodeColor={n => {
                const ev = (n.data as NodeData).event;
                if (ev.terminated) return '#374151';
                if (ev.riskLevel === 'high')   return '#ef4444';
                if (ev.riskLevel === 'medium') return '#f97316';
                return '#22c55e';
              }}
              maskColor="rgba(13,17,23,0.85)"
              className="!bg-[#161b22] !border-gray-700 !rounded-lg"
              style={{ bottom: 24, right: 16 }}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
};
