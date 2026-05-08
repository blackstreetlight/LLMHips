import React, { useMemo, useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { Shield, Cpu, BrainCircuit, Activity, GitCommitHorizontal, AlertTriangle } from 'lucide-react';
import { useSystemStore } from '../../store/useSystemStore';

/**
 * 仪表盘组件
 * 所有数据均来自 store 实时状态
 */
export const Dashboard: React.FC = () => {
  const { events, driverStatus, isMonitoring, eventStats } = useSystemStore();

  // ── 实时统计 ──
  const blockedCount  = eventStats.totalBlocked;
  const highRiskCount = eventStats.totalHigh;
  const mediumCount   = eventStats.totalMedium;
  const lowCount      = eventStats.totalLow;
  const totalEvents   = events.length;

  // ── 时钟 ──
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleString('zh-CN'));
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const startMs = Date.now();
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleString('zh-CN'));
      setUptime(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  // ── 图表：基于真实事件数据统计 Top5 进程 ──
  const topProcessData = useMemo(() => {
    const countMap = new Map<string, number>();
    events.forEach(ev => {
      if (ev.riskLevel === 'high' || ev.riskLevel === 'medium') {
        countMap.set(ev.processName, (countMap.get(ev.processName) || 0) + 1);
      }
    });
    const sorted = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    // ECharts 需要从小到大排（底部到顶部）
    sorted.reverse();
    return {
      names: sorted.map(([name]) => name),
      values: sorted.map(([, count]) => count),
    };
  }, [events]);

  const topProcessOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '14%', bottom: '3%', containLabel: true },
    xAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
    yAxis: {
      type: 'category',
      data: topProcessData.names.length > 0 ? topProcessData.names : ['(暂无数据)'],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#c9d1d9', fontFamily: 'monospace' },
    },
    series: [{
      name: '拦截频次',
      type: 'bar',
      barWidth: '40%',
      label: { show: true, position: 'right', color: '#8b949e', fontFamily: 'monospace', fontSize: 11 },
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
          { offset: 0, color: '#ff4d4f' },
          { offset: 1, color: 'rgba(255, 77, 79, 0.2)' },
        ]),
      },
      data: topProcessData.values.length > 0 ? topProcessData.values : [0],
    }],
  }), [topProcessData]);

  // ── 图表：风险等级分布饼图 ──
  const riskPieOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', backgroundColor: 'rgba(22, 27, 34, 0.9)', borderColor: '#30363d', textStyle: { color: '#c9d1d9' } },
    legend: { show: false },
    series: [{
      type: 'pie',
      radius: ['50%', '75%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: '#0d1117', borderWidth: 2 },
      label: { show: true, color: '#8b949e', fontSize: 11 },
      data: [
        { value: highRiskCount, name: '高危', itemStyle: { color: '#ef4444' } },
        { value: mediumCount, name: '中危', itemStyle: { color: '#f97316' } },
        { value: lowCount, name: '低危', itemStyle: { color: '#22c55e' } },
      ].filter(d => d.value > 0),
    }],
  }), [highRiskCount, mediumCount, lowCount]);

  // ── 驱动状态卡片 ──
  const driverStatusText = driverStatus === 'online' ? 'Online' : driverStatus === 'error' ? 'Error' : 'Offline';
  const driverStatusColor = driverStatus === 'online' ? 'bg-brand-neon' : driverStatus === 'error' ? 'bg-red-500' : 'bg-gray-500';
  const driverBarColor = driverStatus === 'online' ? 'bg-brand-neon' : driverStatus === 'error' ? 'bg-red-500' : 'bg-gray-600';
  const driverIconColor = driverStatus === 'online' ? 'text-brand-neon' : driverStatus === 'error' ? 'text-red-500' : 'text-gray-500';

  // ── 最近事件 ──
  const recentEvents = events.slice(0, 6);

  return (
    <div className="p-6 h-full overflow-y-auto bg-brand-dark text-gray-300 font-sans space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-mono font-bold text-brand-cyan tracking-wide">系统安全总览</h1>
          <p className="text-xs text-gray-500 font-mono mt-0.5">{currentTime}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 监控状态 */}
          {!isMonitoring && (
            <div className="font-mono text-yellow-500 text-sm bg-yellow-500/5 border border-yellow-500/20 px-3 py-1.5 rounded flex items-center gap-1.5">
              <AlertTriangle size={14} />
              监控已关闭
            </div>
          )}
          <div className={`font-mono text-sm px-3 py-1.5 rounded ${
            driverStatus === 'online'
              ? 'text-green-400 bg-green-400/5 border border-green-400/20'
              : 'text-gray-500 bg-gray-800 border border-gray-700'
          }`}>
            UPTIME: {formatUptime(uptime)}
          </div>
        </div>
      </div>

      {/* ── 状态卡片 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          title="总事件数"
          value={totalEvents}
          icon={<Shield className="text-brand-neon" size={28} />}
          subtitle={`拦截 ${blockedCount} 次`}
          subtitleColor="text-brand-neon"
          barColor="bg-brand-neon"
        />
        <StatusCard
          title="高危威胁"
          value={highRiskCount}
          icon={<Activity className="text-red-500" size={28} />}
          subtitle={`中危 ${mediumCount} / 低危 ${lowCount}`}
          subtitleColor="text-red-500"
          barColor="bg-red-500"
        />

        {/* Driver 状态卡片 — 实时 */}
        <div className="bg-brand-card border border-gray-800 rounded-lg p-5 flex items-center justify-between shadow-lg hover:border-gray-600 hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden">
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${driverBarColor} rounded-l`} />
          <div className="pl-2">
            <h3 className="text-gray-500 text-sm font-medium mb-1">Driver 层状态</h3>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${driverStatus === 'online' ? 'text-white' : driverStatus === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
                {driverStatusText}
              </span>
              {driverStatus === 'online' && (
                <span className="relative flex h-3 w-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${driverStatusColor} opacity-75`} />
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${driverStatusColor}`} />
                </span>
              )}
            </div>
          </div>
          <div className={`p-3 rounded-full ${driverStatus === 'online' ? 'bg-brand-neon/10' : 'bg-gray-800/50'}`}>
            <Cpu className={driverIconColor} size={28} />
          </div>
        </div>

        {/* LLM 引擎卡片 */}
        <div className="bg-brand-card border border-gray-800 rounded-lg p-5 flex items-center justify-between shadow-lg hover:border-gray-600 hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-cyan rounded-l" />
          <div className="pl-2">
            <h3 className="text-gray-500 text-sm font-medium mb-1">LLM 推理引擎</h3>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-white">Standby</span>
              <span className="w-2 h-2 rounded-full bg-brand-cyan shadow-[0_0_8px_#00d4ff] animate-pulse" />
            </div>
          </div>
          <div className="p-3 bg-brand-cyan/10 rounded-full">
            <BrainCircuit className="text-brand-cyan" size={28} />
          </div>
        </div>
      </div>

      {/* ── 图表 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* 风险分布饼图 */}
        <div className="bg-brand-card border border-gray-800 rounded-lg p-5 shadow-lg hover:border-gray-600 transition-colors duration-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield size={18} className="text-brand-cyan" /> 风险等级分布
            </h2>
            <span className="text-xs text-gray-500 bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700">实时</span>
          </div>
          <div className="border-t border-gray-800 mb-4" />
          {totalEvents > 0 ? (
            <ReactECharts option={riskPieOption} style={{ height: '280px', width: '100%' }} />
          ) : (
            <div className="h-[280px] flex items-center justify-center text-gray-600 text-sm font-mono">
              等待事件数据...
            </div>
          )}
        </div>

        {/* Top5 高危进程 */}
        <div className="lg:col-span-2 bg-brand-card border border-gray-800 rounded-lg p-5 shadow-lg hover:border-gray-600 transition-colors duration-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield size={18} className="text-red-500" /> 高危进程 Top 5
            </h2>
            <div className="flex items-center gap-1.5">
              {isMonitoring && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
                  </span>
                  <span className="text-xs text-green-400 font-mono">实时更新</span>
                </>
              )}
            </div>
          </div>
          <div className="border-t border-gray-800 mb-4" />
          <ReactECharts option={topProcessOption} style={{ height: '280px', width: '100%' }} />
        </div>
      </div>

      {/* ── 事件时间轴 ── */}
      <div className="bg-brand-card border border-gray-800 rounded-lg p-5 shadow-lg hover:border-gray-600 transition-colors duration-200">
        <div className="flex items-center gap-2 mb-3">
          <GitCommitHorizontal size={18} className="text-brand-cyan" />
          <h2 className="text-lg font-bold text-white">最近安全事件时间轴</h2>
        </div>
        <div className="border-t border-gray-800 mb-4" />

        {recentEvents.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6 font-mono">
            {isMonitoring ? '等待事件数据...' : '监控未开启，点击顶部开关启动监控'}
          </p>
        ) : (
          <div>
            {recentEvents.map((ev, idx) => (
              <div key={ev.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center shrink-0 pt-0.5">
                  <div className={`w-2.5 h-2.5 rounded-full z-10 relative shrink-0
                    ${ev.riskLevel === 'high'
                      ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]'
                      : ev.riskLevel === 'medium'
                      ? 'bg-orange-500'
                      : 'bg-gray-600'}`}
                  />
                  {idx < recentEvents.length - 1 && (
                    <div className="w-px bg-gray-700/70 mt-1" style={{ minHeight: '28px' }} />
                  )}
                </div>

                <div className="flex-1 pb-3 flex items-start justify-between min-w-0">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="font-mono text-xs text-gray-500 pt-0.5 shrink-0 w-[68px]">
                      {new Date(ev.timestamp).toLocaleTimeString('zh-CN', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                    <div className="min-w-0">
                      <span className="text-white text-sm font-medium">{ev.processName}</span>
                      <span className="text-gray-500 text-xs font-mono ml-2 truncate">{ev.ruleTriggered}</span>
                      {ev.parentProcessName && (
                        <span className="text-gray-600 text-xs ml-2">{'\u2190'} {ev.parentProcessName}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-mono ml-3 shrink-0
                    ${ev.riskLevel === 'high'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : ev.riskLevel === 'medium'
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                      : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
                    {ev.riskLevel.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── StatusCard ──
const StatusCard = ({
  title, value, icon, subtitle, subtitleColor, barColor,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  subtitle: string;
  subtitleColor: string;
  barColor: string;
}) => (
  <div className="bg-brand-card border border-gray-800 rounded-lg p-5 flex items-center justify-between shadow-lg hover:border-gray-600 hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden">
    <div className={`absolute left-0 top-0 bottom-0 w-1 ${barColor} rounded-l`} />
    <div className="pl-2 flex-1">
      <h3 className="text-gray-500 text-sm font-medium mb-1">{title}</h3>
      <div className="text-3xl font-bold text-white font-mono">{value}</div>
      <p className={`text-xs mt-1 ${subtitleColor}`}>{subtitle}</p>
    </div>
    <div className="p-3 bg-gray-800/50 rounded-full">{icon}</div>
  </div>
);
