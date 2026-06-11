import React, { useMemo, useState } from 'react';
import type { EtwEvent } from '../../types/index';
import { FileText, Database, Wifi, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * ETW 行为链时间轴组件
 * etwEvents 直接来自 ProcessEvent.etwEvents（由父组件传入，无需订阅独立 store）
 */
export const BehaviorChainTimeline: React.FC<{ etwEvents?: EtwEvent[] }> = ({ etwEvents = [] }) => {
  const [expanded, setExpanded] = useState(false);

  // 时间降序（最新在顶），展示上限：折叠 8 条，展开全部
  const sorted = useMemo(
    () => [...etwEvents].sort((a, b) => b.timestamp - a.timestamp),
    [etwEvents],
  );
  const visible = expanded ? sorted : sorted.slice(0, 8);

  if (etwEvents.length === 0) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-800">
        <p className="text-xs text-gray-600 font-mono">暂无 ETW 行为记录（等待运行时事件…）</p>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-800">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 font-mono">
          行为链 · <span className="text-[#00d4ff]">{sorted.length}</span> 条 ETW 事件
        </span>
        {sorted.length > 8 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-0.5 text-xs text-gray-600 hover:text-[#00d4ff] transition-colors"
          >
            {expanded ? <><ChevronUp size={11} />收起</> : <><ChevronDown size={11} />展开全部</>}
          </button>
        )}
      </div>

      {/* 时间轴列表 */}
      <div className="relative">
        {/* 竖线 */}
        <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-800" />

        <div className="space-y-1">
          {visible.map((ev) => (
            <EtwRow key={ev.id} event={ev} />
          ))}
        </div>
      </div>

      {!expanded && sorted.length > 8 && (
        <p className="text-xs text-gray-700 font-mono mt-1.5 pl-8">
          还有 {sorted.length - 8} 条，点击「展开全部」查看
        </p>
      )}
    </div>
  );
};

/** 单条 ETW 事件行 */
const EtwRow: React.FC<{ event: EtwEvent }> = ({ event: ev }) => {
  const [showTarget, setShowTarget] = useState(false);

  const { icon, color } = categoryStyle(ev.category);
  const severityDot = ev.severity === 'high'
    ? 'bg-red-500'
    : ev.severity === 'medium'
    ? 'bg-orange-400'
    : 'bg-gray-600';

  return (
    <div
      className="relative flex items-start gap-3 pl-1 group cursor-pointer"
      onClick={() => setShowTarget(v => !v)}
      title={showTarget ? '点击收起路径' : '点击展开完整路径'}
    >
      {/* 时间轴节点：类别图标 */}
      <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${color.border} ${color.bg}`}>
        {icon}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0 py-0.5">
        <div className="flex items-center gap-2">
          {/* 严重程度小点 */}
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${severityDot}`} />
          {/* 类别 + 动作 */}
          <span className={`text-xs font-mono font-medium ${color.text}`}>{ev.category}</span>
          <span className="text-xs text-gray-400 font-mono">{ev.action}</span>
          {/* 时间 */}
          <span className="text-xs text-gray-700 font-mono ml-auto shrink-0">
            {new Date(ev.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
        {/* 目标路径（截断/展开） */}
        <p className={`text-xs text-gray-500 font-mono mt-0.5 ${showTarget ? 'break-all' : 'truncate'}`}>
          {ev.target}
        </p>
        {/* 规则描述（severity=high 时显示） */}
        {ev.severity === 'high' && ev.ruleDescription && (
          <p className="text-xs text-red-400/70 font-mono mt-0.5 flex items-center gap-1">
            <AlertTriangle size={10} className="shrink-0" />
            {ev.ruleDescription}
          </p>
        )}
      </div>
    </div>
  );
};

/** 各类别的颜色与图标配置 */
function categoryStyle(category: EtwEvent['category']) {
  switch (category) {
    case 'File':
      return {
        icon: <FileText size={11} className="text-blue-400" />,
        color: { border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
      };
    case 'Registry':
      return {
        icon: <Database size={11} className="text-purple-400" />,
        color: { border: 'border-purple-500/30', bg: 'bg-purple-500/10', text: 'text-purple-400' },
      };
    case 'Network':
      return {
        icon: <Wifi size={11} className="text-green-400" />,
        color: { border: 'border-green-500/30', bg: 'bg-green-500/10', text: 'text-green-400' },
      };
  }
}
