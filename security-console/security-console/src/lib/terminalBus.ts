/**
 * terminalBus.ts — 终端事件总线
 *
 * 解决的问题：
 *   xterm.js 的 Terminal 实例需要直接调用 term.write(data)，
 *   而 data 来自 Zustand store 的 WebSocket onmessage 处理器。
 *   直接在 store 里持有 xterm 实例会导致循环依赖和 SSR 问题。
 *
 * 方案：
 *   store 将 terminal_output 消息发布到此总线；
 *   TerminalView 订阅总线，拿到 data 后调用 term.write()。
 *   这样 store 和 xterm 实例完全解耦。
 *
 * 同理用于 terminal_command_result：
 *   store 发布结果 → terminalSkillHandler 的 resolveCommand() 解析 Promise。
 */

import { resolveCommand } from '../features/skills/handlers/terminalSkillHandler';

type OutputListener = (data: string) => void;

class TerminalBus {
  private _outputListeners: Set<OutputListener> = new Set();

  // ─── terminal_output（交互终端输出）─────────────────────────────

  /** 注册输出监听（TerminalView 调用） */
  onOutput(fn: OutputListener): () => void {
    this._outputListeners.add(fn);
    return () => this._outputListeners.delete(fn); // 返回取消订阅函数
  }

  /** 发布输出（useSystemStore 的 onmessage 调用） */
  emit(data: string) {
    this._outputListeners.forEach(fn => fn(data));
  }

  // ─── terminal_command_result（AI 技能命令结果）──────────────────

  /** 接收命令执行结果，分发给等待中的 Promise（terminalSkillHandler 调用） */
  emitCommandResult(requestId: string, output: string, exitCode: number) {
    resolveCommand(requestId, output, exitCode);
  }
}

/** 全局单例 */
export const terminalBus = new TerminalBus();
