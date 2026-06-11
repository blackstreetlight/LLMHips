import React, { useState, useEffect } from 'react';
import { useSystemStore } from '../../store/useSystemStore';
import { Database, BookOpen, Cpu, Cloud, Key, Link, Tag, CheckCircle, XCircle, Loader, SlidersHorizontal, Puzzle, ChevronDown, ChevronUp, ShieldAlert, TerminalSquare, AlertTriangle } from 'lucide-react';
import { SKILLS_META, RISK_COLOR, RISK_LABEL } from '../skills/skillsMeta';

const LLM_URL = (import.meta.env.VITE_LLM_URL as string | undefined) || 'http://localhost:8000';

type LocalModelStatus = 'checking' | 'loaded' | 'not_loaded' | 'offline';

/** 云端供应商预设列表 */
const CLOUD_PRESETS = [
  { id: 'openai',    label: 'OpenAI',     defaultModel: 'gpt-4o',                    baseUrl: 'https://api.openai.com/v1'    },
  { id: 'deepseek',  label: 'DeepSeek',   defaultModel: 'deepseek-chat',             baseUrl: 'https://api.deepseek.com/v1'  },
  { id: 'anthropic', label: 'Anthropic',  defaultModel: 'claude-3-5-sonnet-20241022', baseUrl: ''                             },
  { id: 'custom',    label: '自定义',      defaultModel: '',                          baseUrl: ''                             },
] as const;

export const SettingsView: React.FC = () => {
  const {
    writebackEnabled, toggleWriteback,
    enginePreset, engineApiKey, engineBaseUrl, engineModel,
    setEngineConfig,
    inferMaxTokens, inferTemperature, inferTopP, inferMaxHistory,
    setInferParams,
    skillsEnabled, toggleSkill,
  } = useSystemStore();

  // 技能卡片展开状态（key = skill id）
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  // 本地模型状态检测
  const [localModelStatus, setLocalModelStatus] = useState<LocalModelStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setLocalModelStatus('checking');
      try {
        const res = await fetch(`${LLM_URL}/health`, { signal: AbortSignal.timeout(4000) });
        if (cancelled) return;
        if (!res.ok) { setLocalModelStatus('offline'); return; }
        const data = await res.json();
        setLocalModelStatus(data.local_model_loaded ? 'loaded' : 'not_loaded');
      } catch {
        if (!cancelled) setLocalModelStatus('offline');
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  // 本地临时编辑态，避免每次按键都触发 store 更新
  const [localApiKey,  setLocalApiKey]  = useState(engineApiKey);
  const [localBaseUrl, setLocalBaseUrl] = useState(engineBaseUrl);
  const [localModel,   setLocalModel]   = useState(engineModel);
  const [showApiKey,   setShowApiKey]   = useState(false);
  const [saved,        setSaved]        = useState(false);

  const isCloud = enginePreset !== 'local';
  const selectedPreset = CLOUD_PRESETS.find(p => p.id === enginePreset);

  const handleSave = () => {
    setEngineConfig({
      engineApiKey:  localApiKey.trim(),
      engineBaseUrl: localBaseUrl.trim(),
      engineModel:   localModel.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handlePresetChange = (preset: typeof enginePreset) => {
    const found = CLOUD_PRESETS.find(p => p.id === preset);
    setEngineConfig({ enginePreset: preset });
    // 切换预设时自动填入默认 model，保留用户已输入的 apiKey
    if (found && found.defaultModel && !localModel) {
      setLocalModel(found.defaultModel);
    }
    if (found && found.baseUrl) {
      setLocalBaseUrl(found.baseUrl);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0d1117] p-8">
      <h1 className="text-lg font-bold text-gray-200 font-mono mb-6 border-b border-[#30363d] pb-4">
        系统设置
      </h1>

      {/* ── 推理引擎配置 ── */}
      <section className="mb-8">
        <h2 className="text-xs font-mono text-[#00d4ff] uppercase tracking-widest mb-4">
          推理引擎
        </h2>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg divide-y divide-[#30363d]">

          {/* 本地 / 云端切换 */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-3 mb-3">
              <Cpu size={18} className="text-gray-400 shrink-0" />
              <p className="text-sm text-gray-200 font-mono">引擎选择</p>
            </div>
            <div className="flex gap-2 pl-7 flex-wrap">
              {/* 本地 */}
              <button
                onClick={() => setEngineConfig({ enginePreset: 'local' })}
                disabled={localModelStatus === 'not_loaded' || localModelStatus === 'offline'}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  enginePreset === 'local'
                    ? 'bg-[#00d4ff]/15 text-[#00d4ff] border-[#00d4ff]/40'
                    : 'bg-[#0d1117] text-gray-400 border-gray-700 hover:border-gray-500'
                }`}
              >
                <Cpu size={14} />
                本地模型
                {/* 状态指示 */}
                {localModelStatus === 'checking'   && <Loader    size={12} className="animate-spin text-gray-500" />}
                {localModelStatus === 'loaded'     && <CheckCircle size={12} className="text-green-400" />}
                {localModelStatus === 'not_loaded' && <XCircle   size={12} className="text-red-400" />}
                {localModelStatus === 'offline'    && <XCircle   size={12} className="text-gray-500" />}
              </button>
              {/* 云端分组 */}
              {CLOUD_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePresetChange(p.id as typeof enginePreset)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono border transition-all ${
                    enginePreset === p.id
                      ? 'bg-[#00d4ff]/15 text-[#00d4ff] border-[#00d4ff]/40'
                      : 'bg-[#0d1117] text-gray-400 border-gray-700 hover:border-gray-500'
                  }`}
                >
                  <Cloud size={14} />
                  {p.label}
                </button>
              ))}
            </div>
            {/* 本地模型状态说明 */}
            <div className="mt-3 pl-7 text-xs space-y-1">
              {localModelStatus === 'checking' && (
                <p className="text-gray-500">正在检测本地推理服务...</p>
              )}
              {localModelStatus === 'loaded' && (
                <p className="text-green-500">✓ 本地模型已就绪，可正常使用本地模式</p>
              )}
              {localModelStatus === 'not_loaded' && (
                <p className="text-orange-400">
                  本地服务在线，但模型未加载（内存不足或未启用）。<br />
                  如需本地模式，请用 <code className="bg-[#0d1117] px-1 rounded">LOAD_LOCAL_MODEL=1 python server.py</code> 启动服务。
                </p>
              )}
              {localModelStatus === 'offline' && (
                <p className="text-gray-500">
                  本地推理服务未运行。云端 API 模式下无需启动本地服务。<br />
                  如需本地模式，请在 <code className="bg-[#0d1117] px-1 rounded">LLM/QwenLLM/Web/</code> 目录下运行 <code className="bg-[#0d1117] px-1 rounded">LOAD_LOCAL_MODEL=1 python server.py</code>。
                </p>
              )}
            </div>
            {isCloud && (
              <p className="text-xs text-gray-500 mt-3 pl-7">
                使用云端 API 推理，Prompt 工程、Few-Shot 检索、案例回写逻辑与本地模式完全一致，仅底层推理引擎切换为远程调用。
              </p>
            )}
          </div>

          {/* 云端配置项（仅云端模式显示） */}
          {isCloud && (
            <>
              {/* API Key */}
              <div className="flex items-start gap-3 px-5 py-4">
                <Key size={18} className="text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-gray-200 font-mono mb-2">API Key</p>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={localApiKey}
                      onChange={e => setLocalApiKey(e.target.value)}
                      placeholder={`${selectedPreset?.label ?? 'Provider'} API Key`}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-[#00d4ff] pr-20 transition-colors"
                    />
                    <button
                      onClick={() => setShowApiKey(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
                    >
                      {showApiKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Key 仅存储在浏览器 localStorage，不会上传到任何服务器。</p>
                </div>
              </div>

              {/* 模型名称 */}
              <div className="flex items-start gap-3 px-5 py-4">
                <Tag size={18} className="text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-gray-200 font-mono mb-2">模型名称</p>
                  <input
                    type="text"
                    value={localModel}
                    onChange={e => setLocalModel(e.target.value)}
                    placeholder={selectedPreset?.defaultModel || 'model-name'}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-[#00d4ff] transition-colors"
                  />
                  {enginePreset !== 'custom' && selectedPreset?.defaultModel && (
                    <p className="text-xs text-gray-600 mt-1">默认: <code className="text-gray-500">{selectedPreset.defaultModel}</code></p>
                  )}
                </div>
              </div>

              {/* Base URL（仅 custom 显示） */}
              {enginePreset === 'custom' && (
                <div className="flex items-start gap-3 px-5 py-4">
                  <Link size={18} className="text-gray-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-200 font-mono mb-2">Base URL</p>
                    <input
                      type="text"
                      value={localBaseUrl}
                      onChange={e => setLocalBaseUrl(e.target.value)}
                      placeholder="https://your-api.example.com/v1"
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-[#00d4ff] transition-colors"
                    />
                    <p className="text-xs text-gray-600 mt-1">兼容 OpenAI Chat Completions API 格式的任意端点（SiliconFlow、月之暗面、智谱等）。</p>
                  </div>
                </div>
              )}

              {/* 保存按钮 */}
              <div className="px-5 py-4 flex justify-end">
                <button
                  onClick={handleSave}
                  className={`px-5 py-2 rounded text-sm font-mono transition-all ${
                    saved
                      ? 'bg-green-600 text-white'
                      : 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/25'
                  }`}
                >
                  {saved ? '✓ 已保存' : '保存配置'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── 推理参数 ── */}
      <section className="mb-8">
        <h2 className="text-xs font-mono text-[#00d4ff] uppercase tracking-widest mb-4">
          推理参数
        </h2>
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg divide-y divide-[#30363d]">

          {/* 最大输出 Token */}
          <div className="flex items-center gap-6 px-5 py-4">
            <SlidersHorizontal size={18} className="text-gray-400 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-200 font-mono">最大输出 Token</p>
                <span className="text-sm font-mono text-[#00d4ff] w-16 text-right">{inferMaxTokens}</span>
              </div>
              <input
                type="range" min={256} max={8192} step={256}
                value={inferMaxTokens}
                onChange={e => setInferParams({ inferMaxTokens: Number(e.target.value) })}
                className="w-full accent-[#00d4ff]"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>256（简短）</span>
                <span>2048（推荐）</span>
                <span>8192（超长）</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                控制单次响应的最大长度。九维分析建议 2048 以上；云端模型上限因供应商而异（GPT-4o 16k、Claude 8k、DeepSeek 8k）。
              </p>
            </div>
          </div>

          {/* Temperature */}
          <div className="flex items-center gap-6 px-5 py-4">
            <SlidersHorizontal size={18} className="text-gray-400 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-200 font-mono">Temperature（温度）</p>
                <span className="text-sm font-mono text-[#00d4ff] w-16 text-right">{inferTemperature.toFixed(1)}</span>
              </div>
              <input
                type="range" min={0} max={2} step={0.1}
                value={inferTemperature}
                onChange={e => setInferParams({ inferTemperature: Number(e.target.value) })}
                className="w-full accent-[#00d4ff]"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>0（确定性）</span>
                <span>0.7（推荐）</span>
                <span>2（随机）</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                值越低输出越稳定确定，值越高创意性越强但可能偏题。安全分析场景建议 0.3–0.7。
              </p>
            </div>
          </div>

          {/* Top-P */}
          <div className="flex items-center gap-6 px-5 py-4">
            <SlidersHorizontal size={18} className="text-gray-400 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-200 font-mono">Top-P（核采样）</p>
                <span className="text-sm font-mono text-[#00d4ff] w-16 text-right">{inferTopP.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0.1} max={1} step={0.05}
                value={inferTopP}
                onChange={e => setInferParams({ inferTopP: Number(e.target.value) })}
                className="w-full accent-[#00d4ff]"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>0.1（保守）</span>
                <span>0.9（推荐）</span>
                <span>1.0（无限制）</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                从概率累积达到 P 的候选 token 中采样。通常与 Temperature 配合使用，无需频繁调整。
              </p>
            </div>
          </div>

          {/* 对话历史轮数 */}
          <div className="flex items-center gap-6 px-5 py-4">
            <SlidersHorizontal size={18} className="text-gray-400 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-200 font-mono">保留对话轮数</p>
                <span className="text-sm font-mono text-[#00d4ff] w-16 text-right">{inferMaxHistory === 0 ? '全部' : `${inferMaxHistory} 轮`}</span>
              </div>
              <input
                type="range" min={0} max={20} step={1}
                value={inferMaxHistory}
                onChange={e => setInferParams({ inferMaxHistory: Number(e.target.value) })}
                className="w-full accent-[#00d4ff]"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>0（全部保留）</span>
                <span>10（推荐）</span>
                <span>20 轮</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                追问时带入的历史对话条数。值越大上下文越完整，但消耗的输入 token 也越多。0 表示保留全部历史（对长对话不推荐）。
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* ── LLM 分析 ── */}
      <section className="mb-8">
        <h2 className="text-xs font-mono text-[#00d4ff] uppercase tracking-widest mb-4">
          LLM 分析 / 案例库
        </h2>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg divide-y divide-[#30363d]">
          {/* 案例回写开关 */}
          <div className="flex items-start justify-between px-5 py-4 gap-6">
            <div className="flex items-start gap-3">
              <Database size={18} className="text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-200 font-mono">案例回写</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  开启后，用户点击「执行内核阻断」或「加入白名单放行」时，
                  将自动把本次研判结果写入案例库，用于后续少样本检索增强。
                  写入前会进行相似度去重（阈值 0.85），避免重复案例污染库。
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  verdict / risk_score 来自人工处置动作，summary / ATT&CK 来自 AI 分析输出。
                </p>
              </div>
            </div>
            {/* Toggle 开关 */}
            <button
              onClick={toggleWriteback}
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none mt-0.5
                ${writebackEnabled ? 'bg-[#00d4ff]' : 'bg-gray-700'}`}
              title={writebackEnabled ? '点击关闭案例回写' : '点击开启案例回写'}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                  ${writebackEnabled ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {/* 案例库说明（只读信息） */}
          <div className="flex items-start gap-3 px-5 py-4">
            <BookOpen size={18} className="text-gray-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-gray-200 font-mono">案例库位置</p>
              <p className="text-xs text-gray-500 mt-1 font-mono break-all">
                LLM/QwenLLM/FewShot/case_library.db
              </p>
              <p className="text-xs text-gray-600 mt-1">
                SQLite 数据库，包含 cases 和 embeddings 两张表。可直接用 DB Browser for SQLite 查看。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ AI 技能管理 ═══════════════ */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 mb-1">
          <Puzzle size={15} className="text-[#00d4ff]" />
          AI 技能管理
        </h2>
        <p className="text-xs text-gray-600 mb-4">
          控制 AI 在分析过程中可调用的技能工具。关闭后 AI 尝试调用时将收到禁用提示，无法执行对应操作。
        </p>

        <div className="space-y-3">
          {SKILLS_META.map((skill) => {
            const enabled  = skillsEnabled[skill.id] ?? true;
            const expanded = expandedSkill === skill.id;

            return (
              <div
                key={skill.id}
                className={`rounded-lg border transition-all duration-200 overflow-hidden
                  ${enabled
                    ? 'border-gray-700 bg-[#161b22]'
                    : 'border-gray-800 bg-[#0d1117] opacity-60'}`}
              >
                {/* 卡片主行 */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* 图标 */}
                  <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0
                    ${enabled ? 'bg-[#00d4ff]/10' : 'bg-gray-800'}`}>
                    <TerminalSquare size={15} className={enabled ? 'text-[#00d4ff]' : 'text-gray-600'} />
                  </div>

                  {/* 名称 + 描述 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-mono font-medium ${enabled ? 'text-gray-200' : 'text-gray-500'}`}>
                        {skill.displayName}
                      </span>
                      <code className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">
                        &lt;{skill.tagName}&gt;
                      </code>
                      {/* 风险等级 */}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${RISK_COLOR[skill.riskLevel]}`}>
                        {RISK_LABEL[skill.riskLevel]}
                      </span>
                      {/* 禁用标签 */}
                      {!enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border text-gray-500 bg-gray-800/50 border-gray-700 font-mono">
                          已禁用
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">{skill.description}</p>
                  </div>

                  {/* 展开按钮 */}
                  <button
                    onClick={() => setExpandedSkill(expanded ? null : skill.id)}
                    className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors shrink-0"
                    title="查看详情"
                  >
                    {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {/* Toggle 开关 */}
                  <button
                    onClick={() => toggleSkill(skill.id)}
                    className={`relative w-10 h-5 rounded-full transition-colors shrink-0 focus:outline-none
                      ${enabled
                        ? 'bg-[#00d4ff] shadow-[0_0_8px_rgba(0,212,255,0.4)]'
                        : 'bg-gray-700'}`}
                    title={enabled ? '点击禁用' : '点击启用'}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
                        ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </div>

                {/* 展开详情区 */}
                {expanded && (
                  <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
                    {/* 功能详情 */}
                    <div>
                      <p className="text-[11px] text-gray-500 mb-1.5 font-mono">功能说明</p>
                      <ul className="space-y-1">
                        {skill.details.map((d, i) => (
                          <li key={i} className="flex items-start gap-2 text-[11px] text-gray-400">
                            <span className="text-[#00d4ff] mt-0.5 shrink-0">·</span>
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* 禁用行为说明 */}
                    <div className="flex items-start gap-2 bg-orange-500/5 border border-orange-500/20 rounded px-3 py-2">
                      <AlertTriangle size={11} className="text-orange-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] text-orange-400 font-mono mb-0.5">禁用后的行为</p>
                        <p className="text-[11px] text-gray-500">{skill.disabledNote}</p>
                        <p className="text-[10px] text-gray-600 mt-1 font-mono">
                          AI 收到：<code className="text-orange-300/70">[SKILL_DISABLED] 技能 "{skill.tagName}" 当前已被用户禁用…</code>
                        </p>
                      </div>
                    </div>

                    {/* 高风险警告 */}
                    {skill.riskLevel === 'high' && enabled && (
                      <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded px-3 py-2">
                        <ShieldAlert size={11} className="text-red-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-red-400/80">
                          此技能允许 AI 在受控端执行任意命令，请确保仅在可信的分析场景下启用，并监控 AI 的命令调用行为。
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
