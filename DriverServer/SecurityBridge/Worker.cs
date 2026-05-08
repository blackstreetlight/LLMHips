// Worker.cs
using System.Text.Json;
using SecurityBridge.Driver;
using SecurityBridge.Models;
using SecurityBridge.WebSocket;

/// <summary>
/// 后台常驻工作线程：驱动事件轮询 + 心跳广播
/// </summary>
public class Worker : BackgroundService
{
    private readonly IDriverClient _driverClient;
    private readonly WebSocketConnectionManager _wsManager;
    private readonly ILogger<Worker> _logger;
    private readonly IConfiguration _config;

    // JSON 序列化选项：字段名转为 camelCase，与前端 TypeScript 接口对齐
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public Worker(
        IDriverClient driverClient,
        WebSocketConnectionManager wsManager,
        ILogger<Worker> logger,
        IConfiguration config)
    {
        _driverClient = driverClient;
        _wsManager    = wsManager;
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

        // ── 第三步：主轮询循环 ────────────────────────────────────────────────
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
                        // 进程退出事件：轻量广播，仅携带 PID + 时间戳
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
                        // 进程创建事件：完整事件广播
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

        // ── 第四步：服务停止时断开驱动连接 ───────────────────────────────────
        await _driverClient.DisconnectAsync();
        _logger.LogInformation("Worker stopped, driver disconnected.");
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
