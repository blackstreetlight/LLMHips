// Worker.cs
using System.Text.Json;
using SecurityBridge.Driver;
using SecurityBridge.ETW;
using SecurityBridge.Models;
using SecurityBridge.WebSocket;

/// <summary>
/// 后台常驻工作线程：驱动事件轮询 + 心跳广播 + ETW 行为监控
/// </summary>
public class Worker : BackgroundService
{
    private readonly IDriverClient _driverClient;
    private readonly WebSocketConnectionManager _wsManager;
    private readonly EtwMonitor _etwMonitor;
    private readonly ILogger<Worker> _logger;
    private readonly IConfiguration _config;

    // Mock 模式下用于记录活跃 PID，供 ETW 模拟事件使用
    private readonly List<int> _mockActivePids = new();

    // JSON 序列化选项：字段名转为 camelCase，与前端 TypeScript 接口对齐
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public Worker(
        IDriverClient driverClient,
        WebSocketConnectionManager wsManager,
        EtwMonitor etwMonitor,
        ILogger<Worker> logger,
        IConfiguration config)
    {
        _driverClient = driverClient;
        _wsManager    = wsManager;
        _etwMonitor   = etwMonitor;
        _logger       = logger;
        _config       = config;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // ── 第一步：连接驱动，失败则每5秒重试 ───────────────────────────────
        int retryCount = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            bool connected = await _driverClient.ConnectAsync();
            if (connected)
            {
                _logger.LogInformation("Driver connected successfully.");
                break;
            }

            retryCount++;
            _logger.LogWarning("[RETRY {N}] Connecting to driver...", retryCount);
            await Task.Delay(5000, stoppingToken);
        }

        if (stoppingToken.IsCancellationRequested) return;

        // ── 第二步：启动心跳广播（独立后台 Task，不阻塞主轮询循环）────────────
        int heartbeatSec = _config.GetValue<int>("Bridge:HeartbeatIntervalSec", 30);
        _ = HeartbeatLoopAsync(heartbeatSec, stoppingToken);

        // ── 第三步：启动 ETW 监控 / Mock ETW 模拟 ───────────────────────────
        // 真实模式：EtwMonitor.StartAsync 阻塞在内核事件泵（macOS 直接返回）
        // Mock 模式：另起一个模拟循环，定期为活跃进程生成假 ETW 事件供前端调试
        if (_driverClient is MockDriverClient)
            _ = MockEtwLoopAsync(stoppingToken);
        else
            _ = _etwMonitor.StartAsync(stoppingToken);

        // ── 第四步：主轮询循环 ────────────────────────────────────────────────
        int pollIntervalMs = _config.GetValue<int>("Bridge:PollIntervalMs", 500);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // 向驱动轮询一次，无事件返回 null
                ProcessEvent? evt = await _driverClient.PollEventAsync();

                if (evt != null)
                {
                    string json;

                    if (evt.EventType == "exit")
                    {
                        // 进程退出事件：
                        // 1. 通知 ETW 停止追踪该 PID（防止 PID 复用导致误报）
                        _etwMonitor.UntrackPid(evt.Pid);

                        // 2. 轻量广播，仅携带 PID + 时间戳
                        var exitMsg = new WsMessage<object>
                        {
                            Type    = "process_exit",
                            Payload = new { pid = evt.Pid, timestamp = evt.Timestamp }
                        };
                        json = JsonSerializer.Serialize(exitMsg, _jsonOptions);
                        _logger.LogInformation("[EXIT] PID={Pid}", evt.Pid);
                    }
                    else
                    {
                        // 进程创建事件：
                        // 1. 将新进程 PID 加入 ETW 追踪白名单（仅追踪可疑进程）
                        _etwMonitor.TrackPid(evt.Pid);
                        // Mock 模式下同时记录活跃 PID 供模拟 ETW 使用
                        if (_driverClient is MockDriverClient)
                        {
                            lock (_mockActivePids) { _mockActivePids.Add(evt.Pid); if (_mockActivePids.Count > 50) _mockActivePids.RemoveAt(0); }
                        }

                        // 2. 完整事件广播
                        var createMsg = new WsMessage<ProcessEvent>
                        {
                            Type    = "process_event",
                            Payload = evt
                        };
                        json = JsonSerializer.Serialize(createMsg, _jsonOptions);
                        _logger.LogInformation(
                            "[EVENT] {Name} PID={Pid} Risk={Risk} Status={Status}",
                            evt.ProcessName, evt.Pid, evt.RiskLevel, evt.Status);
                    }

                    await _wsManager.BroadcastAsync(json);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during driver poll loop.");
            }

            await Task.Delay(pollIntervalMs, stoppingToken);
        }

        // ── 第五步：服务停止时断开驱动连接 ───────────────────────────────────
        await _driverClient.DisconnectAsync();
        _logger.LogInformation("Worker stopped, driver disconnected.");
    }

    /// <summary>
    /// Mock 模式 ETW 模拟循环：每隔 600~1200ms 为某个活跃进程随机生成 1~3 条 ETW 行为事件，
    /// 用于前端开发调试（行为链时间轴、展开全部按钮等功能的验证）。
    /// </summary>
    private async Task MockEtwLoopAsync(CancellationToken ct)
    {
        var rng = new Random();

        string[][] fileTargets =
        [
            [@"C:\Users\Admin\AppData\Local\Temp\payload.bin", "high",    "可疑 Temp 目录写入"],
            [@"C:\Windows\System32\drivers\etc\hosts",         "high",    "hosts 文件篡改"],
            [@"C:\Users\Admin\Documents\report.docx",          "low",     ""],
            [@"C:\ProgramData\malware\persist.exe",            "high",    "ProgramData 可执行文件写入"],
            [@"C:\Windows\Temp\inject.dll",                    "medium",  "系统 Temp 目录写入"],
            [@"C:\Users\Admin\Desktop\readme.txt",             "low",     ""],
        ];
        string[][] regTargets =
        [
            [@"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\Backdoor", "high",   "注册表自启动项写入"],
            [@"HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Agent",    "high",   "用户自启动项写入"],
            [@"HKLM\SYSTEM\CurrentControlSet\Services\MalSvc",               "medium", "服务注册"],
            [@"HKCU\Software\Classes\ms-settings\shell\open\command",        "high",   "COM 劫持"],
            [@"HKLM\SOFTWARE\Policies\Microsoft\Windows Defender",           "medium", "Defender 策略修改"],
        ];
        string[][] netTargets =
        [
            ["185.62.188.10:4444",  "high",   "命中 C2 外联规则"],
            ["10.0.0.5:445",        "medium", "SMB 横向移动尝试"],
            ["8.8.8.8:53",          "low",    ""],
            ["192.168.1.100:8080",  "medium", "内网 HTTP 扫描"],
            ["23.44.112.8:443",     "low",    ""],
        ];

        string[] fileActions = ["Create", "Write", "Delete"];
        string[] regActions  = ["SetValue", "CreateKey", "DeleteKey"];
        string[] netActions  = ["Connect", "UdpSend"];

        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(rng.Next(600, 1200), ct);
            if (ct.IsCancellationRequested) break;

            int pid;
            lock (_mockActivePids)
            {
                if (_mockActivePids.Count == 0) continue;
                pid = _mockActivePids[rng.Next(_mockActivePids.Count)];
            }

            // 每次生成 1~3 条 ETW 事件
            int count = rng.Next(1, 4);
            for (int i = 0; i < count; i++)
            {
                int kind = rng.Next(3); // 0=File, 1=Registry, 2=Network
                string category, action, target, severity, rule;

                if (kind == 0)
                {
                    var t = fileTargets[rng.Next(fileTargets.Length)];
                    category = "File"; action = fileActions[rng.Next(fileActions.Length)];
                    target = t[0]; severity = t[1]; rule = t[2];
                }
                else if (kind == 1)
                {
                    var t = regTargets[rng.Next(regTargets.Length)];
                    category = "Registry"; action = regActions[rng.Next(regActions.Length)];
                    target = t[0]; severity = t[1]; rule = t[2];
                }
                else
                {
                    var t = netTargets[rng.Next(netTargets.Length)];
                    category = "Network"; action = netActions[rng.Next(netActions.Length)];
                    target = t[0]; severity = t[1]; rule = t[2];
                }

                var etwEvt = new EtwEvent
                {
                    Id              = Guid.NewGuid().ToString(),
                    Timestamp       = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    Pid             = pid,
                    ProcessName     = "mock.exe",
                    Category        = category,
                    Action          = action,
                    Target          = target,
                    Severity        = severity,
                    RuleDescription = rule,
                };

                var msg  = new WsMessage<EtwEvent> { Type = "etw_event", Payload = etwEvt };
                var json = JsonSerializer.Serialize(msg, _jsonOptions);
                await _wsManager.BroadcastAsync(json);
            }
        }
    }

    /// <summary>
    /// 独立心跳广播循环：每隔 heartbeatSec 秒向所有前端推送驱动在线状态
    /// </summary>
    private async Task HeartbeatLoopAsync(int intervalSec, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(intervalSec), ct);

            if (ct.IsCancellationRequested) break;

            try
            {
                // 心跳携带当前时间戳和驱动连接状态，供前端判断服务是否存活
                var heartbeat = new WsMessage<object>
                {
                    Type = "heartbeat",
                    Payload = new
                    {
                        timestamp    = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        driverStatus = _driverClient.IsConnected ? "online" : "offline"
                    }
                };
                string json = JsonSerializer.Serialize(heartbeat, _jsonOptions);
                await _wsManager.BroadcastAsync(json);
                _logger.LogDebug("[HEARTBEAT] Broadcasted to all clients.");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to broadcast heartbeat.");
            }
        }
    }
}
