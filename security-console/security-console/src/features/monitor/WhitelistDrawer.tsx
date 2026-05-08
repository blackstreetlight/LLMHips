import React, { useState, useEffect, useMemo } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import type { WhitelistEntry } from '../../types/index';
import { X, Plus, Trash2, ShieldCheck, FileText, FolderOpen, Search } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 白名单编辑抽屉
 * 本地暂存编辑结果，点击「应用」才写入 Zustand Store
 */
export const WhitelistDrawer: React.FC<Props> = ({ open, onClose }) => {
  const { whitelistEntries, applyWhitelist } = useSystemStore();

  // 本地暂存：打开时从 store 复制，只有「应用」才提交
  const [local, setLocal] = useState<WhitelistEntry[]>([]);

  // 搜索
  const [searchQuery, setSearchQuery] = useState('');

  // 新条目表单
  const [formType,  setFormType]  = useState<'processName' | 'path'>('processName');
  const [formValue, setFormValue] = useState('');
  const [formNote,  setFormNote]  = useState('');
  const [formError, setFormError] = useState('');

  // 每次打开时同步 store → local，并清空搜索
  useEffect(() => {
    if (open) {
      setLocal([...whitelistEntries]);
      setSearchQuery('');
    }
  }, [open, whitelistEntries]);

  // 搜索过滤：对 value 和 note 做模糊匹配
  const displayedEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return local;
    return local.filter(e =>
      e.value.toLowerCase().includes(q) ||
      e.note.toLowerCase().includes(q)
    );
  }, [local, searchQuery]);

  const handleAdd = () => {
    const val = formValue.trim();
    if (!val) { setFormError('匹配值不能为空'); return; }
    const dup = local.some(
      e => e.matchType === formType && e.value.toLowerCase() === val.toLowerCase()
    );
    if (dup) { setFormError('该条目已存在'); return; }

    const entry: WhitelistEntry = {
      id:        'wl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      matchType: formType,
      value:     val,
      note:      formNote.trim(),
      addedAt:   Date.now(),
    };
    setLocal(prev => [entry, ...prev]);
    setFormValue('');
    setFormNote('');
    setFormError('');
  };

  const handleDelete = (id: string) =>
    setLocal(prev => prev.filter(e => e.id !== id));

  const handleApply = () => {
    applyWhitelist(local);
    onClose();
  };

  const handleCancel = () => {
    setLocal([...whitelistEntries]); // 丢弃本地修改
    onClose();
  };

  const matchTypeLabel = (t: WhitelistEntry['matchType']) =>
    t === 'processName' ? '进程名' : '路径前缀';

  const matchTypeIcon = (t: WhitelistEntry['matchType']) =>
    t === 'processName'
      ? <FileText size={12} className="text-[#00d4ff] shrink-0" />
      : <FolderOpen size={12} className="text-orange-400 shrink-0" />;

  return (
    <>
      {/* 遮罩 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={handleCancel}
        />
      )}

      {/* 抽屉主体 */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] z-50 bg-[#161b22] border-l border-[#30363d]
          shadow-[-8px_0_32px_rgba(0,0,0,0.5)] flex flex-col font-mono
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d] bg-[#0d1117] shrink-0">
          <h3 className="flex items-center gap-2 text-[#00d4ff] font-bold text-base">
            <ShieldCheck size={18} /> 白名单管理
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {searchQuery ? `${displayedEntries.length} / ` : ''}{local.length} 条规则
            </span>
            <button onClick={handleCancel} className="text-gray-500 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── 搜索栏 ── */}
        <div className="px-5 py-2.5 border-b border-[#30363d] bg-[#0d1117] shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索条目值或备注..."
              className="w-full bg-[#161b22] border border-gray-700 rounded pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00d4ff] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── 新增表单 ── */}
        <div className="px-5 py-4 border-b border-[#30363d] bg-[#0a0d12] shrink-0 space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider">添加新规则</p>

          {/* 匹配类型 */}
          <div className="flex gap-2">
            {(['processName', 'path'] as const).map(t => (
              <button
                key={t}
                onClick={() => setFormType(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors ${
                  formType === t
                    ? t === 'processName'
                      ? 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/40'
                      : 'bg-orange-400/10 text-orange-400 border-orange-400/40'
                    : 'text-gray-500 border-gray-700 hover:border-gray-600'
                }`}
              >
                {matchTypeIcon(t)} {matchTypeLabel(t)}
              </button>
            ))}
          </div>

          {/* 匹配值 */}
          <div>
            <input
              value={formValue}
              onChange={e => { setFormValue(e.target.value); setFormError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder={
                formType === 'processName'
                  ? '进程名，如 svchost.exe（包含匹配）'
                  : '路径前缀，如 C:\\Windows\\System32\\'
              }
              className="w-full bg-[#161b22] border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#00d4ff] transition-colors"
            />
            {formError && <p className="text-red-400 text-xs mt-1">{formError}</p>}
          </div>

          {/* 备注 */}
          <input
            value={formNote}
            onChange={e => setFormNote(e.target.value)}
            placeholder="备注说明（可选）"
            className="w-full bg-[#161b22] border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
          />

          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/20 transition-colors"
          >
            <Plus size={13} /> 添加到列表
          </button>
        </div>

        {/* ── 条目列表 ── */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {local.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <ShieldCheck size={36} className="mb-2 opacity-20" />
              <p className="text-sm">白名单为空</p>
              <p className="text-xs mt-1 text-gray-700">添加进程名或路径前缀，匹配的进程将被过滤</p>
            </div>
          ) : displayedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <Search size={30} className="mb-2 opacity-20" />
              <p className="text-sm">无匹配结果</p>
              <p className="text-xs mt-1 text-gray-700">尝试修改搜索关键词</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedEntries.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5"
                >
                  {/* 图标 */}
                  <div className="mt-0.5">{matchTypeIcon(entry.matchType)}</div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-200 text-xs truncate font-mono">{entry.value}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        entry.matchType === 'processName'
                          ? 'text-[#00d4ff]/70 border-[#00d4ff]/20 bg-[#00d4ff]/5'
                          : 'text-orange-400/70 border-orange-400/20 bg-orange-400/5'
                      }`}>
                        {matchTypeLabel(entry.matchType)}
                      </span>
                      {entry.note && (
                        <span className="text-gray-600 text-[10px] truncate">{entry.note}</span>
                      )}
                    </div>
                  </div>

                  {/* 删除 */}
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-gray-600 hover:text-red-400 hover:bg-red-400/10 p-1 rounded transition-colors shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer 操作按钮 ── */}
        <div className="px-5 py-4 border-t border-[#30363d] bg-[#0a0d12] shrink-0">
          {/* 未应用变更提示 */}
          {JSON.stringify(local.map(e => e.id)) !== JSON.stringify(whitelistEntries.map(e => e.id)) && (
            <p className="text-yellow-400/70 text-xs mb-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              有未应用的更改
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 rounded border border-gray-700 text-gray-400 text-sm hover:border-gray-600 hover:text-gray-300 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleApply}
              className="flex-1 py-2 rounded bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/20 transition-colors text-sm font-bold"
            >
              应用
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
