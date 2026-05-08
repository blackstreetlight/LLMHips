import React, { useState, useMemo } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import type { AnalysisRecord } from '../../types/index';
import {
  Bot, ChevronDown, ChevronRight, Trash2, Search,
  ShieldAlert, ShieldCheck, Clock, CheckCircle, XCircle,
  AlertTriangle, User, Filter, RotateCcw,
} from 'lucide-react';

/**
 * LLM 研判历史页面
 * 展示所有历史研判工单，支持展开查看对话记录
 */
export const LLMHistoryView: React.FC = () => {
  const { analysisRecords, deleteAnalysisRecord, clearAnalysisRecords, setSelectedEvent } = useSystemStore();

  // ── 本地状态 ──
  // 使用 Set 支持同时展开多条，展开/收起完全由用户自己控制
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState<'all' | 'blocked' | 'allowed' | 'pending'>('all');

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

  // ── 过滤 + 搜索 ──
  const filteredRecords = useMemo(() => {
    return analysisRecords.filter(r => {
      const actionMatch = filterAction === 'all' || r.finalAction === filterAction;
      const searchMatch =
        !searchQuery ||
        r.event.processName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.event.processPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.event.ruleTriggered.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.id.toLowerCase().includes(searchQuery.toLowerCase());
      return actionMatch && searchMatch;
    });
  }, [analysisRecords, filterAction, searchQuery]);

  // ── 工具函数 ──
  const riskBadge = (level: string) => {
    if (level === 'high') return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (level === 'medium') return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    return 'bg-green-500/20 text-green-400 border-green-500/30';
  };

  const actionBadge = (action: string) => {
    if (action === 'blocked') return 'bg-red-900/50 text-red-400 border-red-800/60';
    if (action === 'allowed') return 'bg-green-900/30 text-green-400 border-green-800/50';
    return 'bg-yellow-900/30 text-yellow-400 border-yellow-800/50';
  };

  const actionLabel = (action: string) => {
    if (action === 'blocked') return 'BLOCKED';
    if (action === 'allowed') return 'ALLOWED';
    return 'PENDING';
  };

  const recommendIcon = (rec: string) => {
    if (rec === 'block') return <XCircle size={14} className="text-red-400" />;
    if (rec === 'allow') return <CheckCircle size={14} className="text-green-400" />;
    return <AlertTriangle size={14} className="text-yellow-400" />;
  };

  const handleReAnalyze = (record: AnalysisRecord) => {
    // 重新打开 LLM 研判弹窗（设置 selectedEvent 即可触发 LLMAnalysisView）
    setSelectedEvent(record.event);
  };

  return (
    <div className="bg-[#0d1117] h-full flex flex-col font-mono text-gray-300">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[#00d4ff] text-xl font-bold flex items-center gap-2">
            <Bot size={24} /> LLM 研判历史
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              共 {analysisRecords.length} 条记录
            </span>
            {expandedIds.size > 0 && (
              <button
                onClick={collapseAll}
                className="text-xs text-[#00d4ff] hover:text-white transition-colors"
              >
                全部折叠 ({expandedIds.size})
              </button>
            )}
            {analysisRecords.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('确认清空所有研判记录？此操作不可撤销。')) {
                    clearAnalysisRecords();
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

        {/* ── 搜索 + 筛选 ── */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索进程名、路径、规则、工单ID..."
              className="w-full bg-[#161b22] border border-gray-700 rounded px-2.5 py-1.5 pl-8 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter size={14} className="text-gray-600" />
            {(['all', 'pending', 'blocked', 'allowed'] as const).map(action => (
              <button
                key={action}
                onClick={() => setFilterAction(action)}
                className={`px-2 py-1 rounded text-xs transition-colors border ${
                  filterAction === action
                    ? action === 'blocked'
                      ? 'bg-red-500/20 text-red-400 border-red-500/40'
                      : action === 'allowed'
                      ? 'bg-green-500/20 text-green-400 border-green-500/40'
                      : action === 'pending'
                      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                      : 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/30'
                    : 'text-gray-500 border-gray-700 hover:border-gray-600'
                }`}
              >
                {action === 'all' ? 'ALL' : action.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 记录列表 ── */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            {analysisRecords.length === 0 ? (
              <>
                <Bot size={48} className="mb-3 opacity-30" />
                <p className="text-sm">暂无研判记录</p>
                <p className="text-xs mt-1 text-gray-700">在监控面板或进程详情中点击「LLM 深度研判」发起分析</p>
              </>
            ) : (
              <>
                <Search size={36} className="mb-3 opacity-30" />
                <p className="text-sm">未找到匹配的记录</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRecords.map(record => {
              const isExpanded = expandedIds.has(record.id);
              return (
                <div
                  key={record.id}
                  className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden transition-all"
                >
                  {/* ── 工单摘要行 ── */}
                  <div
                    onClick={() => toggleExpand(record.id)}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1c2129] transition-colors"
                  >
                    {/* 展开/折叠 */}
                    <div className="shrink-0 text-gray-600">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>

                    {/* 风险图标 */}
                    {record.aiRiskLevel === 'high'
                      ? <ShieldAlert size={18} className="text-red-500 shrink-0" />
                      : record.aiRiskLevel === 'medium'
                      ? <AlertTriangle size={18} className="text-orange-400 shrink-0" />
                      : <ShieldCheck size={18} className="text-green-400 shrink-0" />}

                    {/* 进程信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium text-sm truncate">
                          {record.event.processName}
                        </span>
                        <span className="text-gray-600 text-xs">PID: {record.event.pid}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {record.event.ruleTriggered}
                      </p>
                    </div>

                    {/* AI 置信度 */}
                    {record.aiConfidence > 0 && (
                      <div className="shrink-0 text-right mr-2">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          {recommendIcon(record.aiRecommendation)}
                          <span>{record.aiConfidence}%</span>
                        </div>
                      </div>
                    )}

                    {/* 风险等级 + 最终决策 */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${riskBadge(record.aiRiskLevel)}`}>
                        {record.aiRiskLevel.toUpperCase()}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${actionBadge(record.finalAction)}`}>
                        {actionLabel(record.finalAction)}
                      </span>
                    </div>

                    {/* 时间 */}
                    <div className="shrink-0 text-xs text-gray-600 flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(record.createdAt).toLocaleString('zh-CN', {
                        month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleReAnalyze(record)}
                        className="p-1 rounded text-gray-600 hover:text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-colors"
                        title="重新研判"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => deleteAnalysisRecord(record.id)}
                        className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        title="删除记录"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* ── 展开的对话记录 ── */}
                  {isExpanded && (
                    <div className="border-t border-[#30363d]">
                      {/* 事件详情 */}
                      <div className="px-4 py-3 bg-[#0a0d12] text-xs space-y-1.5">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                          <p><span className="text-gray-600">路径:</span> <span className="text-gray-400">{record.event.processPath}</span></p>
                          <p><span className="text-gray-600">父进程:</span> <span className="text-gray-400">{record.event.parentProcessName} (PID: {record.event.parentPid})</span></p>
                          <p className="col-span-2"><span className="text-gray-600">命令行:</span> <span className="text-gray-400">{record.event.cmdLine || '（无参数）'}</span></p>
                          <p><span className="text-gray-600">签名:</span> <span className={record.event.isSigned === 2 ? 'text-green-400' : record.event.isSigned === 1 ? 'text-red-400' : 'text-gray-500'}>
                            {record.event.isSigned === 2 ? '已签名' : record.event.isSigned === 1 ? '未签名' : '未知'}
                          </span></p>
                          <p><span className="text-gray-600">工单ID:</span> <span className="text-gray-500">{record.id}</span></p>
                        </div>
                      </div>

                      {/* 对话消息 */}
                      {record.chatHistory.length > 0 ? (
                        <div className="px-4 py-3 space-y-3 max-h-80 overflow-y-auto">
                          {record.chatHistory.map(msg => (
                            <div
                              key={msg.id}
                              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              {msg.role === 'ai' && (
                                <div className="w-6 h-6 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center shrink-0">
                                  <Bot size={12} className="text-[#00d4ff]" />
                                </div>
                              )}
                              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                                msg.role === 'user'
                                  ? 'bg-[#1f6feb]/15 text-gray-300 border border-[#1f6feb]/20'
                                  : 'bg-[#161b22] text-gray-400 border border-[#30363d]'
                              }`}>
                                {msg.content}
                              </div>
                              {msg.role === 'user' && (
                                <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                                  <User size={12} className="text-gray-300" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-4 py-3 text-xs text-gray-600 text-center">
                          暂无对话记录
                        </div>
                      )}

                      {/* 底部结论 */}
                      <div className="px-4 py-2.5 bg-[#0a0d12] border-t border-[#30363d] flex items-center justify-between text-xs">
                        <div className="flex items-center gap-4">
                          <span className="text-gray-600">
                            AI 建议: {' '}
                            <span className={
                              record.aiRecommendation === 'block' ? 'text-red-400' :
                              record.aiRecommendation === 'allow' ? 'text-green-400' : 'text-yellow-400'
                            }>
                              {record.aiRecommendation === 'block' ? '阻断' :
                               record.aiRecommendation === 'allow' ? '放行' : '继续调查'}
                            </span>
                          </span>
                          {record.aiConfidence > 0 && (
                            <span className="text-gray-600">
                              置信度: <span className="text-gray-400">{record.aiConfidence}%</span>
                            </span>
                          )}
                        </div>
                        <span className="text-gray-600">
                          更新于 {new Date(record.updatedAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
