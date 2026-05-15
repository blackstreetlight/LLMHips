import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProcessEvent, AnalysisRecord, AnalysisChatMessage, BlockRecord, WhitelistEntry } from '../types/index';

/**
 * 系统状态接口
 */
interface SystemState {
  // ── 事件数据 ──
  events: ProcessEvent[];
  selectedEvent: ProcessEvent | null;

  // ── 研判工单记录 ──
  analysisRecords: AnalysisRecord[];

  // ── 阻断历史记录 ──
  blockRecords: BlockRecord[];

  // ── 白名单 ──
  whitelistEntries: WhitelistEntry[];
  /** 从服务端 whitelist.json 加载白名单（应用启动时调用） */
  loadWhitelist: () => Promise<void>;
  /** 批量替换白名单并写回 whitelist.json（编辑器「应用」时调用） */
  applyWhitelist: (entries: WhitelistEntry[]) => Promise<void>;
  /** 快速追加单条并写回文件（LLM 面板「加入白名单放行」时调用） */
  addToWhitelist: (entry: Omit<WhitelistEntry, 'id' | 'addedAt'>) => Promise<void>;
  /** 判断某进程是否命中白名单（工具函数，供组件直接调用） */
  isWhitelisted: (processName: string, processPath: string) => boolean;

  // ── 连接与监控状态 ──
  driverStatus: 'online' | 'offline' | 'error';
  isMonitoring: boolean;
  eventStats: {
    totalBlocked: number;
    totalHigh: number;
    totalMedium: number;
    totalLow: number;
    totalAllowed: number;
  };

  // ── 事件操作 ──
  addEvent: (event: ProcessEvent) => void;
  setSelectedEvent: (event: ProcessEvent | null) => void;
  clearEvents: () => void;
  /** 将指定 PID 的所有活跃事件标记为已结束（由 process_exit 消息触发） */
  markTerminated: (pid: number, terminatedAt: number) => void;

  // ── 阻断操作 ──
  /** 阻断指定进程：从 events 删除，写入阻断历史 */
  blockEvent: (eventId: string) => void;
  deleteBlockRecord: (recordId: string) => void;
  clearBlockRecords: () => void;

  // ── 研判工单操作 ──
  createAnalysisRecord: (event: ProcessEvent) => string;
  updateAnalysisChat: (recordId: string, messages: AnalysisChatMessage[]) => void;
  updateAnalysisVerdict: (recordId: string, verdict: {
    aiRiskLevel: 'high' | 'medium' | 'low';
    aiConfidence: number;
    aiRecommendation: 'block' | 'allow' | 'investigate';
  }) => void;
  finalizeAnalysis: (recordId: string, action: 'blocked' | 'allowed') => void;
  deleteAnalysisRecord: (recordId: string) => void;
  clearAnalysisRecords: () => void;

  // ── 连接操作 ──
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  toggleMonitoring: () => void;

  // ── 全局设置 ──
  writebackEnabled: boolean;
  toggleWriteback: () => void;

  // ── 推理引擎配置 ──
  enginePreset: 'local' | 'openai' | 'deepseek' | 'anthropic' | 'custom';
  engineApiKey: string;
  engineBaseUrl: string;
  engineModel: string;
  setEngineConfig: (config: {
    enginePreset?: 'local' | 'openai' | 'deepseek' | 'anthropic' | 'custom';
    engineApiKey?: string;
    engineBaseUrl?: string;
    engineModel?: string;
  }) => void;

  // ── 推理参数 ──
  inferMaxTokens: number;    // 最大输出 token 数，默认 1024
  inferTemperature: number;  // 温度，默认 0.7
  inferTopP: number;         // Top-P 核采样，默认 0.9
  inferMaxHistory: number;   // 保留对话轮数，默认 10
  setInferParams: (params: {
    inferMaxTokens?: number;
    inferTemperature?: number;
    inferTopP?: number;
    inferMaxHistory?: number;
  }) => void;
}


let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_BASE_DELAY = 2000; // 2s, 4s, 8s... 指数退避，上限 30s

export const useSystemStore = create<SystemState>()(
  persist(
    (set, get) => ({
      // ── 初始状态 ──
      events: [],
      selectedEvent: null,
      analysisRecords: [],
      blockRecords: [],
      whitelistEntries: [],
      driverStatus: 'offline',
      isMonitoring: true,
      eventStats: { totalBlocked: 0, totalHigh: 0, totalMedium: 0, totalLow: 0, totalAllowed: 0 },
      writebackEnabled: true,
      toggleWriteback: () => set((state) => ({ writebackEnabled: !state.writebackEnabled })),

      // ── 推理引擎配置初始值 ──
      enginePreset: 'local',
      engineApiKey: '',
      engineBaseUrl: '',
      engineModel: '',
      setEngineConfig: (config) => set((state) => ({ ...state, ...config })),

      // ── 推理参数初始值 ──
      inferMaxTokens: 1024,
      inferTemperature: 0.7,
      inferTopP: 0.9,
      inferMaxHistory: 10,
      setInferParams: (params) => set((state) => ({ ...state, ...params })),

      // ── 事件操作 ──
      addEvent: (event) => set((state) => {
        const stats = { ...state.eventStats };
        if (event.status === 'blocked') stats.totalBlocked++;
        if (event.status === 'allowed') stats.totalAllowed++;
        if (event.riskLevel === 'high') stats.totalHigh++;
        if (event.riskLevel === 'medium') stats.totalMedium++;
        if (event.riskLevel === 'low') stats.totalLow++;
        return {
          events: [event, ...state.events].slice(0, 500),
          eventStats: stats,
        };
      }),

      setSelectedEvent: (event) => set({ selectedEvent: event }),

      clearEvents: () => set({
        events: [],
        eventStats: { totalBlocked: 0, totalHigh: 0, totalMedium: 0, totalLow: 0, totalAllowed: 0 },
      }),

      markTerminated: (pid, terminatedAt) => set((state) => ({
        events: state.events.map(e =>
          e.pid === pid && !e.terminated
            ? { ...e, terminated: true, terminatedAt }
            : e
        ),
      })),

      // ── 阻断操作 ──
      blockEvent: (eventId) => {
        const event = get().events.find(e => e.id === eventId);
        if (!event) return;

        // ── 第一步：通过 WebSocket 向 C# 中间层下发 IOCTL kill 指令 ──
        // 消息格式与 SecurityBridge/WebSocket/WebSocketHandler.cs 的
        // HandleDriverCommandAsync() 完全对齐：
        //   type    = "driver_command"
        //   payload = { action: "kill", pid: number, reason?: string }
        // C# 侧收到后调用 SendCommandAsync → IOCTL_SEND_COMMAND(0x80002004) → 驱动执行 ZwTerminateProcess
        if (_ws && _ws.readyState === WebSocket.OPEN) {
          const killMsg = JSON.stringify({
            type: 'driver_command',
            payload: {
              action: 'kill',
              pid: event.pid,
              reason: `User initiated block via console — ${event.processName} (${event.ruleTriggered})`,
            },
          });
          _ws.send(killMsg);
          console.log(`[KILL] 指令已发送 → PID ${event.pid} (${event.processName})`);
        } else {
          // WebSocket 未连接时（Mock 模式 / 驱动离线）仍允许 UI 操作，仅记录警告
          console.warn(`[KILL] WebSocket 未连接，PID ${event.pid} 仅从前端移除，未发送内核指令`);
        }

        // ── 第二步：立即更新前端状态（乐观 UI，不等 command_ack） ──
        // command_ack 回来后在 onmessage 中记录日志，不需要二次修改 UI
        const record: BlockRecord = {
          id: 'blk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          eventId: event.id,
          pid: event.pid,
          parentPid: event.parentPid,
          processName: event.processName,
          processPath: event.processPath,
          cmdLine: event.cmdLine,
          parentProcessName: event.parentProcessName,
          isSigned: event.isSigned,
          riskLevel: event.riskLevel,
          ruleTriggered: event.ruleTriggered,
          processCreatedAt: event.timestamp,
          blockedAt: Date.now(),
        };

        set((state) => ({
          events: state.events.filter(e => e.id !== eventId),
          blockRecords: [record, ...state.blockRecords].slice(0, 500),
          eventStats: {
            ...state.eventStats,
            totalBlocked: state.eventStats.totalBlocked + 1,
          },
        }));
      },

      deleteBlockRecord: (recordId) => set((state) => ({
        blockRecords: state.blockRecords.filter(r => r.id !== recordId),
      })),

      clearBlockRecords: () => set({ blockRecords: [] }),

      // ── 白名单操作 ──
      // 白名单读写完全在前端工程内：
      //   读取 → GET  /whitelist.json （Vite 静态服务 public/whitelist.json）
      //   写回 → PUT  /whitelist.json （vite.config.ts 插件挂载的 dev 中间件，写回 public/whitelist.json）

      loadWhitelist: async () => {
        try {
          const res = await fetch('/whitelist.json');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: WhitelistEntry[] = await res.json();
          set({ whitelistEntries: data });
          console.log(`[Whitelist] 从文件加载 ${data.length} 条规则`);
        } catch (err) {
          console.warn('[Whitelist] 加载失败，将使用内存现有状态:', err);
        }
      },

      applyWhitelist: async (entries) => {
        set({ whitelistEntries: entries });
        try {
          await fetch('/whitelist.json', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entries, null, 2),
          });
          console.log(`[Whitelist] 已写回文件，共 ${entries.length} 条规则`);
        } catch (err) {
          console.warn('[Whitelist] 写回文件失败:', err);
        }
      },

      addToWhitelist: async (entry) => {
        const state = get();
        const id = 'wl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        // 避免重复：同 matchType + 同 value 不重复添加
        const dup = state.whitelistEntries.some(
          e => e.matchType === entry.matchType &&
               e.value.toLowerCase() === entry.value.toLowerCase()
        );
        if (dup) return;
        const next: WhitelistEntry[] = [
          { ...entry, id, addedAt: Date.now() },
          ...state.whitelistEntries,
        ];
        set({ whitelistEntries: next });
        try {
          await fetch('/whitelist.json', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next, null, 2),
          });
        } catch (err) {
          console.warn('[Whitelist] 写回文件失败:', err);
        }
      },

      isWhitelisted: (processName, processPath) => {
        const entries = get().whitelistEntries;
        const name = processName.toLowerCase();
        const path = processPath.toLowerCase();
        return entries.some(e => {
          const val = e.value.toLowerCase();
          if (e.matchType === 'processName') return name === val;
          if (e.matchType === 'path') return path.startsWith(val);
          return false;
        });
      },

      // ── 研判工单操作 ──

      /** 创建研判工单，返回工单 ID */
      createAnalysisRecord: (event) => {
        const recordId = 'ar-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const record: AnalysisRecord = {
          id: recordId,
          event: { ...event },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          aiRiskLevel: event.riskLevel,
          aiConfidence: 0,
          aiRecommendation: 'investigate',
          finalAction: 'pending',
          chatHistory: [],
        };
        set((state) => ({
          analysisRecords: [record, ...state.analysisRecords].slice(0, 200),
        }));
        return recordId;
      },

      /** 更新对话记录 */
      updateAnalysisChat: (recordId, messages) => set((state) => ({
        analysisRecords: state.analysisRecords.map(r =>
          r.id === recordId
            ? { ...r, chatHistory: messages, updatedAt: Date.now() }
            : r
        ),
      })),

      /** 更新 AI 研判结论 */
      updateAnalysisVerdict: (recordId, verdict) => set((state) => ({
        analysisRecords: state.analysisRecords.map(r =>
          r.id === recordId
            ? { ...r, ...verdict, updatedAt: Date.now() }
            : r
        ),
      })),

      /** 用户最终决策（放行/拦截） */
      finalizeAnalysis: (recordId, action) => set((state) => ({
        analysisRecords: state.analysisRecords.map(r =>
          r.id === recordId
            ? { ...r, finalAction: action, updatedAt: Date.now() }
            : r
        ),
      })),

      deleteAnalysisRecord: (recordId) => set((state) => ({
        analysisRecords: state.analysisRecords.filter(r => r.id !== recordId),
      })),

      clearAnalysisRecords: () => set({ analysisRecords: [] }),

      // ── 总开关 ──
      toggleMonitoring: () => {
        const { isMonitoring, connectWebSocket, disconnectWebSocket } = get();
        if (isMonitoring) {
          disconnectWebSocket();
          set({ isMonitoring: false });
        } else {
          set({ isMonitoring: true });
          connectWebSocket();
        }
      },

      // ── WebSocket（含自动重连） ──
      connectWebSocket: () => {
        if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
          return;
        }
        const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:9527/ws';
        console.log(`[WS] 正在连接 ${wsUrl} (第 ${_reconnectAttempts + 1} 次)`);
        _ws = new WebSocket(wsUrl);

        _ws.onopen = () => {
          console.log('[WS] 连接成功');
          _reconnectAttempts = 0;          // 重连成功后重置计数
          set({ driverStatus: 'online' });
        };

        _ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'process_event' && message.payload) {
              get().addEvent(message.payload as ProcessEvent);
            }

            if (message.type === 'heartbeat' && message.payload) {
              set({ driverStatus: message.payload.driverStatus === 'online' ? 'online' : 'offline' });
            }

            // ── 内核指令回执 ──
            // C# SecurityBridge 在执行 IOCTL 后广播此消息（WebSocketHandler.cs line ~208）
            // payload: { pid, action, success, message }
            if (message.type === 'command_ack' && message.payload) {
              const { pid, action, success } = message.payload as {
                pid: number; action: string; success: boolean; message: string;
              };
              if (success) {
                console.log(`[ACK ✅] ${action.toUpperCase()} PID ${pid} — 驱动执行成功`);
              } else {
                console.warn(`[ACK ❌] ${action.toUpperCase()} PID ${pid} — 驱动返回失败: ${message.payload.message}`);
              }
            }

            // ── 进程退出事件 ──
            // Worker.cs 在收到 EventType=exit 的驱动事件后广播此消息
            // payload: { pid, timestamp }
            if (message.type === 'process_exit' && message.payload) {
              const { pid, timestamp } = message.payload as { pid: number; timestamp: number };
              get().markTerminated(pid, timestamp);
              console.log(`[EXIT] PID ${pid} 已结束 @ ${new Date(timestamp).toLocaleTimeString()}`);
            }
          } catch (err) {
            console.error('[WS] 解析中间层事件失败:', err);
          }
        };

        _ws.onerror = (err) => {
          console.error('[WS] 连接错误:', err);
          set({ driverStatus: 'error' });
        };

        _ws.onclose = () => {
          console.log('[WS] 连接关闭');
          _ws = null;
          set({ driverStatus: 'offline' });

          // 如果监控仍处于开启状态，则自动重连
          if (get().isMonitoring && _reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, _reconnectAttempts), 30000);
            _reconnectAttempts++;
            console.log(`[WS] 将在 ${delay / 1000}s 后重连 (${_reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            _reconnectTimer = setTimeout(() => {
              get().connectWebSocket();
            }, delay);
          }
        };
      },

      disconnectWebSocket: () => {
        // 清除重连定时器
        if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        _reconnectAttempts = 0;
        if (_ws) { _ws.close(); _ws = null; }
        set({ driverStatus: 'offline' });
      },
    }),
    {
      name: 'sentinel-security-store',
      // 白名单不再走 localStorage，改由 /whitelist 文件持久化；应用启动时 loadWhitelist() 读取
      partialize: (state) => ({
        events: state.events,
        eventStats: state.eventStats,
        analysisRecords: state.analysisRecords,
        blockRecords: state.blockRecords,
        writebackEnabled: state.writebackEnabled,
        enginePreset: state.enginePreset,
        engineApiKey: state.engineApiKey,
        engineBaseUrl: state.engineBaseUrl,
        engineModel: state.engineModel,
        inferMaxTokens: state.inferMaxTokens,
        inferTemperature: state.inferTemperature,
        inferTopP: state.inferTopP,
        inferMaxHistory: state.inferMaxHistory,
      }),
    }
  )
);
