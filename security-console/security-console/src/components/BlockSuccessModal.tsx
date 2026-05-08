import React from 'react';
import { CheckCircle2 } from 'lucide-react';

interface Props {
  processName: string;
  pid: number;
  blockedAt: number; // Unix ms
  onConfirm: () => void;
}

/**
 * 内核阻断成功弹窗
 * 在 ProcessDetailView 和 LLMAnalysisView 中共用
 */
export const BlockSuccessModal: React.FC<Props> = ({ processName, pid, blockedAt, onConfirm }) => (
  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
    <div className="bg-[#161b22] border border-green-500/40 rounded-xl shadow-2xl p-8 w-[420px] flex flex-col items-center gap-4">

      {/* 成功图标 */}
      <div className="w-16 h-16 rounded-full bg-green-500/10 border-2 border-green-500/40 flex items-center justify-center">
        <CheckCircle2 size={36} className="text-green-400" />
      </div>

      {/* 文字 */}
      <div className="text-center">
        <p className="text-green-400 font-bold text-lg tracking-wide">内核阻断指令已下发</p>
        <p className="text-gray-400 text-sm mt-1">
          ZwTerminateProcess → PID <span className="text-white font-mono font-bold">{pid}</span>
        </p>
        <p className="text-gray-500 text-xs mt-2 font-mono truncate max-w-[340px]">
          {processName}
        </p>
      </div>

      {/* 分隔线 */}
      <div className="w-full border-t border-gray-700/60" />

      {/* 信息栏 */}
      <div className="w-full bg-[#0d1117] rounded-lg px-4 py-3 text-xs font-mono space-y-1.5">
        <div className="flex justify-between">
          <span className="text-gray-600">阻断时间</span>
          <span className="text-gray-300">{new Date(blockedAt).toLocaleString('zh-CN')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">阻断方式</span>
          <span className="text-[#00d4ff]">ZwTerminateProcess (Ring 0)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">记录状态</span>
          <span className="text-green-400">已写入阻断历史</span>
        </div>
      </div>

      <button
        onClick={onConfirm}
        className="w-full py-2 rounded-lg bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors text-sm font-medium"
      >
        确认
      </button>
    </div>
  </div>
);
