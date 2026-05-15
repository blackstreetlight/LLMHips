// ETW/EtwMonitor.cs
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Parsers.Kernel;
using Microsoft.Diagnostics.Tracing.Session;
using SecurityBridge.Models;
using SecurityBridge.WebSocket;

namespace SecurityBridge.ETW;

/// <summary>
/// ETW 会话管理器：订阅 Windows 内核 ETW 事件，对被追踪进程的
/// 文件写入 / 注册表写入 / 网络连接行为进行实时监控。
///
/// 设计要点
/// ─────────
/// 1. PID 白名单门控：只处理驱动层已上报的可疑进程（见 TrackPid / UntrackPid），
///    防止内核事件洪泛（Event Storm）拖垮服务。
/// 2. 规则静态库：所有威胁分类逻辑集中在 EtwFilterConfig，与本类解耦。
/// 3. 跨平台编译：运行时 OS 检测，macOS / Linux 上直接退出，不影响开发调试。
/// 4. 优雅停止：CancellationToken 注册 session.Stop()，主线程 Task.Run 随之退出。
/// </summary>
public sealed class EtwMonitor
{
    private readonly WebSocketConnectionManager _wsManager;
    private readonly ILogger<EtwMonitor> _logger;
    private readonly IConfiguration _config;

    /// <summary>
    /// 当前正在监控的进程 PID 集合。
    /// key = PID，value = 1（ConcurrentDictionary 用作线程安全 HashSet）。
    /// </summary>
    private readonly ConcurrentDictionary<int, byte> _trackedPids = new();

    /// <summary>ETW 会话名称，全局唯一；重名会话需先销毁旧会话</summary>
    private const string SessionName = "SecurityBridgeETW";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public EtwMonitor(
        WebSocketConnectionManager wsManager,
        ILogger<EtwMonitor> logger,
        IConfiguration config)
    {
        _wsManager = wsManager;
        _logger    = logger;
        _config    = config;
    }

    // ── PID 追踪管理（由 Worker 调用）──────────────────────────────────────────

    /// <summary>将驱动上报的可疑进程 PID 加入 ETW 过滤白名单</summary>
    public void TrackPid(int pid)
    {
        _trackedPids.TryAdd(pid, 0);
        _logger.LogDebug("[ETW] 开始追踪 PID={Pid}", pid);
    }

    /// <summary>进程退出时从追踪集合中移除，避免 PID 复用误报</summary>
    public void UntrackPid(int pid)
    {
        _trackedPids.TryRemove(pid, out _);
        _logger.LogDebug("[ETW] 停止追踪 PID={Pid}", pid);
    }

    // ── 主入口 ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// 启动 ETW 会话（阻塞式，由 Worker 通过 Task.Run 在后台线程运行）。
    /// 收到 CancellationToken 后调用 session.Stop() 退出阻塞。
    /// </summary>
    public async Task StartAsync(CancellationToken ct)
    {
        // ── 运行时平台检查 ──────────────────────────────────────────────────────
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            _logger.LogWarning("[ETW] 当前平台非 Windows，ETW 监控已跳过（开发模式正常）。");
            return;
        }

        // ── 配置开关 ────────────────────────────────────────────────────────────
        bool enabled = _config.GetValue<bool>("ETW:Enabled", true);
        if (!enabled)
        {
            _logger.LogInformation("[ETW] ETW 监控已通过配置关闭。");
            return;
        }

        // ── 清理同名残留会话（上次异常退出可能遗留）──────────────────────────
        TraceEventSession.GetActiveSession(SessionName)?.Stop(noThrow: true);

        try
        {
            // TraceEventSession 不实现 IDisposable，需手动 Stop/Dispose
            using var session = new TraceEventSession(SessionName);

            // ── 启用内核 Provider ──────────────────────────────────────────────
            // FileIO：文件创建/写入/删除（Init = 元数据，FileIO = 数据传输）
            // Registry：注册表增删改
            // NetworkTCPIP：TCP 连接/发送
            session.EnableKernelProvider(
                KernelTraceEventParser.Keywords.FileIOInit  |
                KernelTraceEventParser.Keywords.FileIO      |
                KernelTraceEventParser.Keywords.Registry    |
                KernelTraceEventParser.Keywords.NetworkTCPIP
            );

            RegisterFileEvents(session);
            RegisterRegistryEvents(session);
            RegisterNetworkEvents(session);

            // ── 注册停止回调 ────────────────────────────────────────────────────
            ct.Register(() =>
            {
                _logger.LogInformation("[ETW] 收到停止信号，关闭 ETW 会话。");
                session.Stop(noThrow: true);
            });

            _logger.LogInformation(
                "[ETW] 会话已启动，正在监控文件/注册表/网络事件（当前追踪 PID 数: {Count}）。",
                _trackedPids.Count);

            // session.Source.Process() 是阻塞调用，直到 session.Stop() 才返回
            await Task.Run(() => session.Source.Process(), ct).ConfigureAwait(false);
        }
        catch (UnauthorizedAccessException)
        {
            _logger.LogError(
                "[ETW] 权限不足，ETW 需要以管理员身份运行。" +
                "请用 'Run as Administrator' 启动服务，或在 appsettings.json 中关闭 ETW:Enabled。");
        }
        catch (OperationCanceledException)
        {
            // 正常停止，不视为错误
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ETW] ETW 会话异常退出。");
        }
    }

    // ── 文件事件订阅 ────────────────────────────────────────────────────────────

    private void RegisterFileEvents(TraceEventSession session)
    {
        // 文件创建（含覆盖写）
        session.Source.Kernel.FileIOCreate += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyFileEvent(data.FileName);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "File",
                Action          = "Create",
                Target          = data.FileName,
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };

        // 文件写入（内容变更）—— 比 Create 更精准捕获已有文件的篡改
        session.Source.Kernel.FileIOWrite += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyFileEvent(data.FileName);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "File",
                Action          = "Write",
                Target          = data.FileName,
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };

        // 文件删除（覆盖痕迹清除）
        session.Source.Kernel.FileIODelete += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyFileEvent(data.FileName);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "File",
                Action          = "Delete",
                Target          = data.FileName,
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };
    }

    // ── 注册表事件订阅 ──────────────────────────────────────────────────────────

    private void RegisterRegistryEvents(TraceEventSession session)
    {
        // 键创建（新建注册表项）
        session.Source.Kernel.RegistryCreate += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyRegistryEvent(data.KeyName);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "Registry",
                Action          = "CreateKey",
                Target          = data.KeyName,
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };

        // 值写入（最常见的持久化操作：往 Run 键写可执行路径）
        session.Source.Kernel.RegistrySetValue += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            // 拼接 "键路径\值名" 作为完整目标
            var fullKey = string.IsNullOrEmpty(data.ValueName)
                ? data.KeyName
                : $"{data.KeyName}\\{data.ValueName}";
            var result = EtwFilterConfig.ClassifyRegistryEvent(fullKey);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "Registry",
                Action          = "SetValue",
                Target          = fullKey,
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };

        // 键/值删除（清理痕迹或破坏恢复点）
        session.Source.Kernel.RegistryDelete += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyRegistryEvent(data.KeyName);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "Registry",
                Action          = "DeleteKey",
                Target          = data.KeyName,
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };
    }

    // ── 网络事件订阅 ────────────────────────────────────────────────────────────

    private void RegisterNetworkEvents(TraceEventSession session)
    {
        // IPv4 TCP 主动连接
        session.Source.Kernel.TcpIpConnect += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyNetworkEvent((ushort)data.dport);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "Network",
                Action          = "Connect",
                Target          = $"{data.daddr}:{data.dport}",
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };

        // IPv6 TCP 主动连接
        session.Source.Kernel.TcpIpConnectIPV6 += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyNetworkEvent((ushort)data.dport);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "Network",
                Action          = "Connect",
                Target          = $"[{data.daddr}]:{data.dport}",
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };

        // UDP 发送（DNS 外泄、隐蔽通道）
        session.Source.Kernel.UdpIpSend += data =>
        {
            if (!IsTracked(data.ProcessID)) return;
            var result = EtwFilterConfig.ClassifyNetworkEvent((ushort)data.dport);
            if (result is null) return;
            FireAndForget(BuildAndBroadcast(new EtwEvent
            {
                Pid             = data.ProcessID,
                ProcessName     = data.ProcessName,
                Category        = "Network",
                Action          = "UdpSend",
                Target          = $"{data.daddr}:{data.dport}",
                Severity        = result.Value.severity,
                RuleDescription = result.Value.rule,
                Timestamp       = NowMs()
            }));
        };
    }

    // ── 工具方法 ────────────────────────────────────────────────────────────────

    private bool IsTracked(int pid) => _trackedPids.ContainsKey(pid);

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private async Task BuildAndBroadcast(EtwEvent evt)
    {
        var msg  = new WsMessage<EtwEvent> { Type = "etw_event", Payload = evt };
        var json = JsonSerializer.Serialize(msg, JsonOpts);
        await _wsManager.BroadcastAsync(json);

        _logger.LogInformation(
            "[ETW] [{Severity}] {Category}/{Action} PID={Pid}({Name}) → {Target} | {Rule}",
            evt.Severity.ToUpper(), evt.Category, evt.Action,
            evt.Pid, evt.ProcessName, evt.Target, evt.RuleDescription);
    }

    /// <summary>
    /// 在 ETW 回调中（同步上下文）安全地触发异步广播，
    /// 不阻塞 ETW 分发线程；异常单独记录，不让 ETW 会话崩溃。
    /// </summary>
    private void FireAndForget(Task task)
    {
        task.ContinueWith(t =>
        {
            if (t.IsFaulted)
                _logger.LogWarning(t.Exception?.InnerException, "[ETW] 广播失败。");
        }, TaskScheduler.Default);
    }
}
