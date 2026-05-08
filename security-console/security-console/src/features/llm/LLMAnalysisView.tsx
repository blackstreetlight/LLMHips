import React, { useState, useEffect, useRef } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import type { AnalysisChatMessage } from '../../types/index';
import {
  Bot, X, ShieldAlert, Sparkles, CheckCircle, Activity, Send,
  User, Lock, LockOpen, HelpCircle, Terminal, GitFork, WifiOff,
} from 'lucide-react';
import { BlockSuccessModal } from '../../components/BlockSuccessModal';

const LLM_URL = (import.meta.env.VITE_LLM_URL as string | undefined) || 'http://localhost:8000';

interface ChatMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  isStreaming?: boolean;
}

/**
 * 清理模型输出：
 *  - 移除仅包含 XML 标签的 markdown 代码块（```xml ... ```）
 *  - 移除裸 XML 标签
 *  - 合并多余空行（3+ → 2）
 */
function cleanModelOutput(text: string): string {
  return text
    // 移除只含 risk_score / action 标签的代码块（包括 ```xml 和 ``` 两种形式）
    .replace(/```(?:xml)?\s*\n?([\s\S]*?)```/g, (_, inner: string) => {
      const stripped = inner
        .replace(/<risk_score>\d+<\/risk_score>/g, '')
        .replace(/<action>(?:BLOCK|WATCH|ALLOW)<\/action>/g, '')
        .trim();
      // 代码块里除了 XML 标签还有其他内容 → 保留（只去掉标签）
      return stripped ? '```\n' + stripped + '\n```' : '';
    })
    // 移除残留的裸标签
    .replace(/<risk_score>\d+<\/risk_score>/g, '')
    .replace(/<action>(?:BLOCK|WATCH|ALLOW)<\/action>/g, '')
    // 3+ 连续空行 → 2 行
    .replace(/\n{3,}/g, '\n')
    .trim();
}

export const LLMAnalysisView: React.FC = () => {
  const {
    selectedEvent, setSelectedEvent,
    createAnalysisRecord, updateAnalysisChat, updateAnalysisVerdict, finalizeAnalysis,
    blockEvent, addToWhitelist,
  } = useSystemStore();

  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [showActions,  setShowActions]  = useState(false);
  const [question,     setQuestion]     = useState('');
  const [llmOffline,   setLlmOffline]   = useState(false);
  const [blockSuccess, setBlockSuccess] = useState<{
    processName: string; pid: number; blockedAt: number;
  } | null>(null);

  const currentRecordIdRef  = useRef<string | null>(null);
  const abortControllerRef  = useRef<AbortController | null>(null);
  const messagesEndRef       = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────
  // 持久化同步
  // ─────────────────────────────────────────────────────────
  const syncChatToStore = (msgs: ChatMessage[]) => {
    const recordId = currentRecordIdRef.current;
    if (!recordId) return;
    const persistable: AnalysisChatMessage[] = msgs
      .filter(m => !m.isStreaming)
      .map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: Date.now() }));
    updateAnalysisChat(recordId, persistable);
  };

  // ─────────────────────────────────────────────────────────
  // 核心流式请求
  //
  //  isActive  : () => boolean
  //    由调用方提供的「本次会话是否仍有效」判断函数。
  //    useEffect cleanup 会将其置为 false，从而让
  //    已被切换/关闭的旧请求不再写入任何 React state，
  //    彻底避免快速切换时的竞态卡死。
  // ─────────────────────────────────────────────────────────
  const streamFromLLM = async (
    apiMessages: { role: string; content: string }[],
    systemExtra: string,
    targetMsgId: string,
    isActive: () => boolean,
    onDone: (fullText: string) => void,
  ) => {
    // 每次新请求都建一个独立的 AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resp = await fetch(`${LLM_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: apiMessages,
          system_extra: systemExtra,
          max_new_tokens: 1024,
          temperature: 0.7,
        }),
      });

      if (!isActive()) return;   // 请求返回前已被切换 → 丢弃
      if (!resp.ok)   throw new Error(`服务返回 ${resp.status}`);
      if (!resp.body) throw new Error('响应体为空');

      if (isActive()) setLlmOffline(false);

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullText  = '';
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!isActive()) { reader.cancel(); return; }  // 读取中被切换 → 中止

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const { text, error } = JSON.parse(payload) as { text?: string; error?: string };
            if (error) throw new Error(error);
            if (text && isActive()) {
              fullText += text;
              setMessages(prev => prev.map(m =>
                m.id === targetMsgId ? { ...m, content: fullText } : m,
              ));
            }
          } catch { /* 跳过格式错误帧 */ }
        }
      }

      if (!isActive()) return;

      // 流结束 → 标记完成、持久化
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === targetMsgId ? { ...m, content: fullText, isStreaming: false } : m,
        );
        syncChatToStore(updated);
        return updated;
      });
      setShowActions(true);
      onDone(fullText);

    } catch (err: unknown) {
      if (!isActive()) return;                          // 已切换，忽略所有错误
      if (err instanceof Error && err.name === 'AbortError') return;

      const errMsg  = err instanceof Error ? err.message : '未知错误';
      const fallback = `⚠️ 无法连接到本地推理服务（${LLM_URL}）\n错误：${errMsg}\n\n请确认已运行：\ncd LLM/QwenLLM/Web && python server.py`;
      setLlmOffline(true);
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === targetMsgId ? { ...m, content: fallback, isStreaming: false } : m,
        );
        syncChatToStore(updated);
        return updated;
      });
      setShowActions(true);
      onDone(fallback);

    } finally {
      // 只有本次会话仍然有效时才清除 thinking 状态
      // 避免旧请求的 finally 把新会话的 loading 状态意外重置
      if (isActive()) {
        setIsAiThinking(false);
      }
    }
  };

  // ─────────────────────────────────────────────────────────
  // 构建进程事件上下文
  // ─────────────────────────────────────────────────────────
  const buildEventContext = () => {
    if (!selectedEvent) return '';
    const ev = selectedEvent;
    const signedText = ev.isSigned === 2 ? '已签名（Authenticode 验证通过）'
                     : ev.isSigned === 1 ? '未签名（缺少数字签名）'
                     : '签名状态未知';
    return [
      `进程名: ${ev.processName} (PID: ${ev.pid})`,
      `进程路径: ${ev.processPath}`,
      `命令行参数: ${ev.cmdLine || '（无参数）'}`,
      `父进程: ${ev.parentProcessName} (PID: ${ev.parentPid})`,
      `父进程路径: ${ev.parentProcessPath || '未知'}`,
      `数字签名: ${signedText}`,
      `驱动层触发规则: ${ev.ruleTriggered}`,
      `驱动层风险等级: ${ev.riskLevel.toUpperCase()}`,
      `事件状态: ${ev.status.toUpperCase()}`,
      ev.fileCreateTime > 0
        ? `文件创建时间: ${new Date(ev.fileCreateTime).toLocaleString('zh-CN')}`
        : '',
    ].filter(Boolean).join('\n');
  };

  // ─────────────────────────────────────────────────────────
  // 初始分析：selectedEvent 变化时触发
  //
  // cleanup 函数负责：
  //   1. 将 active 置 false → 让正在进行的流立即停止写 state
  //   2. abort 网络请求
  // 这样无论用户切换多快都不会卡死或状态错乱
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    // ── 每次 effect 运行时先中止上一个 ──
    abortControllerRef.current?.abort();

    if (!selectedEvent) {
      setMessages([]);
      setShowActions(false);
      setQuestion('');
      setIsAiThinking(false);
      setLlmOffline(false);
      currentRecordIdRef.current = null;
      return;
    }

    // active 标记：只有本次 effect 实例能写 state
    let active = true;
    const isActive = () => active;

    const recordId    = createAnalysisRecord(selectedEvent);
    currentRecordIdRef.current = recordId;

    const initialMsgId = 'ai-init-' + Date.now();
    setMessages([{ id: initialMsgId, role: 'ai', content: '', isStreaming: true }]);
    setIsAiThinking(true);
    setShowActions(false);

    const initPrompt = '请对以上进程事件进行完整的安全研判，给出风险分析、行为评估，以及最终的风险评分和处置建议。';

    streamFromLLM(
      [{ role: 'user', content: initPrompt }],
      buildEventContext(),
      initialMsgId,
      isActive,
      (fullText) => {
        const scoreMatch  = fullText.match(/<risk_score>(\d+)<\/risk_score>/);
        const actionMatch = fullText.match(/<action>(BLOCK|WATCH|ALLOW)<\/action>/);
        const score = scoreMatch
          ? parseInt(scoreMatch[1])
          : (selectedEvent.riskLevel === 'high' ? 85 : selectedEvent.riskLevel === 'medium' ? 55 : 25);
        const action = actionMatch?.[1];
        const recommendation: 'block' | 'allow' | 'investigate' =
          action === 'BLOCK' ? 'block' : action === 'ALLOW' ? 'allow' : 'investigate';

        updateAnalysisVerdict(recordId, {
          aiRiskLevel:      score >= 75 ? 'high' : score >= 40 ? 'medium' : 'low',
          aiConfidence:     score,
          aiRecommendation: recommendation,
        });
      },
    );

    // cleanup：让本次流失效 + 中止请求
    return () => {
      active = false;
      abortControllerRef.current?.abort();
    };
  }, [selectedEvent]);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiThinking]);

  // ─────────────────────────────────────────────────────────
  // 用户追问
  // ─────────────────────────────────────────────────────────
  const handleFollowUp = () => {
    if (!question.trim() || isAiThinking || !selectedEvent) return;

    const userMsgId   = 'usr-' + Date.now();
    const aiMsgId     = 'ai-'  + Date.now();
    const userContent = question.trim();
    setQuestion('');

    // 用户消息入队
    let snapshotHistory: ChatMessage[] = [];
    setMessages(prev => {
      snapshotHistory = prev;
      const updated = [...prev, { id: userMsgId, role: 'user' as const, content: userContent }];
      syncChatToStore(updated);
      return updated;
    });

    setIsAiThinking(true);

    // 构造历史对话记录成为新对话的上下文
    const apiMessages = [
      ...snapshotHistory
        .filter(m => !m.isStreaming && m.content)
        .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: userContent },
    ];

    // 占位 AI 消息
    setMessages(prev => [...prev, { id: aiMsgId, role: 'ai', content: '', isStreaming: true }]);

    // 追问没有 effect cleanup，用 active=true 保持活跃（不会被切换中断）
    let active = true;
    streamFromLLM(apiMessages, buildEventContext(), aiMsgId, () => active, () => {});
  };

  if (!selectedEvent) return null;

  // ── 样式工具 ──
  const riskBadgeClass = (level: string) => {
    if (level === 'high')   return 'bg-red-500/20 text-red-400 border border-red-500/30';
    if (level === 'medium') return 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
    return 'bg-green-500/20 text-green-400 border border-green-500/30';
  };
  const statusBadgeClass = (status: string) => {
    if (status === 'blocked')  return 'bg-red-900/50 text-red-400 border border-red-800/60';
    if (status === 'watching') return 'bg-orange-900/30 text-orange-400 border border-orange-800/50';
    return 'bg-green-900/30 text-green-400 border border-green-800/50';
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {/* ── 内核阻断成功弹窗（z-60 覆盖在面板之上） ── */}
      {blockSuccess && (
        <div className="absolute inset-0 z-60 flex items-center justify-center">
          <BlockSuccessModal
            processName={blockSuccess.processName}
            pid={blockSuccess.pid}
            blockedAt={blockSuccess.blockedAt}
            onConfirm={() => {
              setBlockSuccess(null);
              setSelectedEvent(null); // 弹窗确认后才关闭 LLM 面板
            }}
          />
        </div>
      )}
      <div className="bg-[#161b22] border border-[#30363d] w-full max-w-3xl h-[85vh] rounded-xl shadow-[0_0_40px_rgba(0,212,255,0.15)] flex flex-col overflow-hidden relative">

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] bg-[#0d1117] shrink-0">
          <h2 className="flex items-center gap-2 text-[#00d4ff] font-bold text-lg font-mono">
            <Bot size={24} /> 交互式威胁研判沙箱
          </h2>
          <div className="flex items-center gap-3">
            {llmOffline ? (
              <span className="flex items-center gap-1 text-xs text-red-400 font-mono">
                <WifiOff size={12} /> LLM 离线
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-green-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_#4ade80]" />
                Qwen2.5-7B
              </span>
            )}
            <button
              onClick={() => setSelectedEvent(null)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* 事件摘要 */}
        <div className="px-6 py-3 bg-[#0a0d12] border-b border-[#30363d] shrink-0 relative overflow-hidden">
          {selectedEvent.riskLevel === 'high' && (
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(239,68,68,0.07) 0%, transparent 70%)' }} />
          )}
          <div className="space-y-2 relative">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {selectedEvent.riskLevel === 'high'
                  ? <ShieldAlert className="text-red-500 animate-pulse-fast shrink-0" size={20} />
                  : <Activity className="text-orange-500 shrink-0" size={20} />}
                <span className="text-white font-mono font-medium">{selectedEvent.processName}</span>
                <span className="text-gray-500 text-sm font-mono">PID: {selectedEvent.pid}</span>
                {selectedEvent.isSigned === 2 && <span className="flex items-center gap-1 text-xs text-green-500"><Lock size={12} />已签名</span>}
                {selectedEvent.isSigned === 1 && <span className="flex items-center gap-1 text-xs text-red-400"><LockOpen size={12} />未签名</span>}
                {selectedEvent.isSigned === 0 && <span className="flex items-center gap-1 text-xs text-gray-600"><HelpCircle size={12} />签名未知</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${riskBadgeClass(selectedEvent.riskLevel)}`}>
                  {selectedEvent.riskLevel.toUpperCase()}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${statusBadgeClass(selectedEvent.status)}`}>
                  {selectedEvent.status.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {new Date(selectedEvent.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 font-mono truncate pl-8" title={selectedEvent.processPath}>
              {selectedEvent.processPath}
            </p>
            {selectedEvent.cmdLine && (
              <div className="flex items-start gap-1.5 pl-8">
                <Terminal size={12} className="text-gray-600 shrink-0 mt-0.5" />
                <p className="text-xs text-gray-400 font-mono truncate" title={selectedEvent.cmdLine}>
                  {selectedEvent.cmdLine}
                </p>
              </div>
            )}
            <div className="flex items-center gap-1.5 pl-8">
              <GitFork size={12} className="text-gray-600 shrink-0" />
              <p className="text-xs text-gray-500 font-mono truncate">
                父进程: {selectedEvent.parentProcessName || '未知'}
                <span className="text-gray-600 ml-1">(PID: {selectedEvent.parentPid})</span>
                {selectedEvent.parentProcessPath && (
                  <span className="text-gray-600 ml-2" title={selectedEvent.parentProcessPath}>{selectedEvent.parentProcessPath}</span>
                )}
              </p>
            </div>
            <div className="flex items-center justify-between pl-8">
              <p className="text-xs text-gray-400">
                <span className="text-gray-500">触发规则:</span> {selectedEvent.ruleTriggered}
              </p>
              {selectedEvent.fileCreateTime > 0 && (
                <p className="text-xs text-gray-600 font-mono shrink-0">
                  文件创建: {new Date(selectedEvent.fileCreateTime).toLocaleDateString('zh-CN')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0d1117] font-sans relative">
          {isAiThinking && (
            <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-10">
              <div className="h-full w-1/4 bg-[#00d4ff] opacity-80 animate-progress-slide" />
            </div>
          )}

          <div className="flex justify-start">
            <span className="font-mono text-xs text-gray-600 border border-gray-700/80 rounded px-2 py-0.5">
              Qwen2.5-7B-Instruct · Local
            </span>
          </div>

          {messages.map(msg => (
            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center shrink-0">
                  <Bot size={16} className="text-[#00d4ff]" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-lg p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap relative overflow-hidden
                ${msg.role === 'user'
                  ? 'bg-[#1f6feb]/20 text-[#c9d1d9] border border-[#1f6feb]/30'
                  : 'bg-[#161b22] text-gray-300 border border-[#30363d]'}`}
              >
                {cleanModelOutput(msg.content)}
                {msg.isStreaming && (
                  <span className="inline-block w-2 h-4 bg-[#00d4ff] animate-pulse ml-1 align-middle" />
                )}
                {msg.role === 'ai' && msg.isStreaming && (
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[#00d4ff]/5 to-transparent animate-scan" />
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                  <User size={16} className="text-gray-300" />
                </div>
              )}
            </div>
          ))}

          {isAiThinking && messages.every(m => !m.content) && (
            <div className="flex gap-4 justify-start">
              <div className="w-8 h-8 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center">
                <Sparkles size={16} className="text-[#00d4ff] animate-pulse" />
              </div>
              <div className="text-[#00d4ff] text-sm font-mono flex items-center animate-pulse">
                正在调用本地模型分析...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="p-4 bg-[#161b22] border-t border-[#30363d] shrink-0">
          <div className="flex gap-2 mb-4">
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={2}
              placeholder="继续追问 AI，例如：该进程是否已横向移动？"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFollowUp(); }
              }}
              className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-[#00d4ff] transition-colors resize-none placeholder-gray-600"
            />
            <button
              onClick={handleFollowUp}
              disabled={!question.trim() || isAiThinking}
              className="px-3 rounded-lg bg-[#00d4ff]/10 text-[#00d4ff] hover:bg-[#00d4ff]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-end h-9 flex items-center"
            >
              <Send size={16} />
            </button>
          </div>

          <div className={`flex justify-end gap-3 transition-all duration-500 ${showActions ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <button
              onClick={() => {
                if (currentRecordIdRef.current) finalizeAnalysis(currentRecordIdRef.current, 'allowed');
                addToWhitelist({
                  matchType: 'processName',
                  value: selectedEvent.processName,
                  note: `LLM研判放行 — ${new Date().toLocaleString('zh-CN')}`,
                });
                setSelectedEvent(null);
              }}
              className="px-4 py-2 rounded text-gray-300 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors text-sm"
            >
              加入白名单并放行
            </button>
            <button
              onClick={() => {
                if (currentRecordIdRef.current) finalizeAnalysis(currentRecordIdRef.current, 'blocked');
                // blockEvent 负责：① 发送 WebSocket kill 指令到 C# 中间层 → IOCTL → 驱动终止进程
                //                  ② 从 events[] 删除该进程
                //                  ③ 写入阻断历史 blockRecords[]
                const blockedAt = Date.now();
                blockEvent(selectedEvent.id);
                // 先弹成功弹窗，用户点「确认」后再关闭面板（与进程详情页行为一致）
                setBlockSuccess({ processName: selectedEvent.processName, pid: selectedEvent.pid, blockedAt });
              }}
              className="px-5 py-2 rounded text-white bg-red-600 hover:bg-red-700 flex items-center gap-2 shadow-[0_0_15px_rgba(220,38,38,0.4)] transition-all text-sm font-bold"
            >
              <CheckCircle size={16} />
              执行内核阻断 (Kill)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
