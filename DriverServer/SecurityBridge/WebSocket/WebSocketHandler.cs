// WebSocket/WebSocketHandler.cs
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SecurityBridge.Driver;
using SecurityBridge.Models;

namespace SecurityBridge.WebSocket;

/// <summary>
/// 单个 WebSocket 连接的完整生命周期处理器。
/// 负责握手接入、消息接收解析、指令转发和连接清理。
/// </summary>
public class WebSocketHandler
{
    private readonly WebSocketConnectionManager _manager;
    private readonly IDriverClient _driverClient;
    private readonly ILogger<WebSocketHandler> _logger;

    // JSON 序列化选项：camelCase，与前端 TypeScript 接口对齐
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy         = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive  = true  // 反序列化时忽略大小写，兼容前端命名差异
    };

    public WebSocketHandler(
        WebSocketConnectionManager manager,
        IDriverClient driverClient,
        ILogger<WebSocketHandler> logger)
    {
        _manager      = manager;
        _driverClient = driverClient;
        _logger       = logger;
    }

    /// <summary>
    /// 接受 WebSocket 握手并进入消息接收循环，直到连接关闭或出现异常。
    /// 每个前端连接独占一个此方法的调用（由 ASP.NET Core 并发调度）。
    /// </summary>
    public async Task HandleAsync(HttpContext context)
    {
        // 完成 WebSocket 握手，获取通信对象
        var ws = await context.WebSockets.AcceptWebSocketAsync();

        // 为此连接生成唯一 ID，注册到连接池
        string connId = Guid.NewGuid().ToString();
        _manager.AddConnection(connId, ws);

        try
        {
            await ReceiveLoopAsync(ws, connId);
        }
        finally
        {
            // 无论正常关闭还是异常，都从连接池移除
            _manager.RemoveConnection(connId);

            // 若连接还未关闭，主动发送 Close 帧
            if (ws.State == WebSocketState.Open)
            {
                try
                {
                    await ws.CloseAsync(
                        WebSocketCloseStatus.NormalClosure,
                        "Connection closed by server",
                        CancellationToken.None);
                }
                catch { /* 关闭时的异常可以忽略 */ }
            }
        }
    }

    /// <summary>
    /// 消息接收主循环：持续读取客户端消息并根据 type 字段路由处理。
    /// </summary>
    private async Task ReceiveLoopAsync(System.Net.WebSockets.WebSocket ws, string connId)
    {
        // 接收缓冲区：4KB，足够处理控制指令
        var buffer = new byte[4096];

        while (ws.State == WebSocketState.Open)
        {
            WebSocketReceiveResult result;
            int totalReceived = 0;

            try
            {
                // 循环读取，直到收到完整的一帧（EndOfMessage = true）
                do
                {
                    result = await ws.ReceiveAsync(
                        new ArraySegment<byte>(buffer, totalReceived, buffer.Length - totalReceived),
                        CancellationToken.None);
                    totalReceived += result.Count;
                } while (!result.EndOfMessage && totalReceived < buffer.Length);
            }
            catch (WebSocketException ex)
            {
                _logger.LogWarning("WebSocket {Id} receive error: {Msg}", connId, ex.Message);
                break;
            }

            // 客户端主动关闭连接
            if (result.MessageType == WebSocketMessageType.Close)
            {
                _logger.LogInformation("WebSocket {Id} closed by client.", connId);
                break;
            }

            // 仅处理文本帧，忽略二进制帧
            if (result.MessageType != WebSocketMessageType.Text)
                continue;

            string raw = Encoding.UTF8.GetString(buffer, 0, totalReceived);
            await ProcessMessageAsync(ws, connId, raw);
        }
    }

    /// <summary>
    /// 解析并路由处理单条 WebSocket 消息。
    /// </summary>
    private async Task ProcessMessageAsync(System.Net.WebSockets.WebSocket ws, string connId, string raw)
    {
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(raw);
        }
        catch (JsonException)
        {
            _logger.LogWarning("WebSocket {Id} sent invalid JSON: {Raw}", connId, raw);
            return;
        }

        // 从消息中提取 type 字段，用于路由
        string? type = root?["type"]?.GetValue<string>();
        if (string.IsNullOrEmpty(type))
        {
            _logger.LogWarning("WebSocket {Id} sent message without 'type' field.", connId);
            return;
        }

        switch (type)
        {
            case "driver_command":
                await HandleDriverCommandAsync(ws, connId, root!);
                break;

            case "ping":
                // 仅向发送方回复 pong，不广播（点对点响应）
                await SendToClientAsync(ws, new WsMessage<object>
                {
                    Type    = "pong",
                    Payload = new { timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }
                });
                break;

            default:
                _logger.LogWarning("WebSocket {Id} sent unknown message type: {Type}", connId, type);
                break;
        }
    }

    /// <summary>
    /// 处理前端下发的进程控制指令：转发给驱动，将执行结果回执广播给所有前端。
    /// </summary>
    private async Task HandleDriverCommandAsync(
        System.Net.WebSockets.WebSocket ws,
        string connId,
        JsonNode root)
    {
        DriverCommand? cmd;
        try
        {
            // 从消息的 payload 字段反序列化控制指令
            var payloadNode = root["payload"];
            if (payloadNode == null)
            {
                _logger.LogWarning("WebSocket {Id} driver_command missing payload.", connId);
                return;
            }
            cmd = payloadNode.Deserialize<DriverCommand>(_jsonOptions);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "WebSocket {Id} driver_command payload parse error.", connId);
            return;
        }

        if (cmd == null)
        {
            _logger.LogWarning("WebSocket {Id} driver_command payload is null.", connId);
            return;
        }

        _logger.LogInformation(
            "[CMD] Action={Action} PID={Pid} from WebSocket {Id}",
            cmd.Action, cmd.Pid, connId);

        // 将指令通过 IOCTL 发送给驱动
        bool success = await _driverClient.SendCommandAsync(cmd);

        // 将执行结果回执广播给所有连接的前端（保证多标签页状态同步）
        var ack = new WsMessage<object>
        {
            Type = "command_ack",
            Payload = new
            {
                pid     = cmd.Pid,
                action  = cmd.Action,
                success = success,
                message = success ? "" : "Driver returned failure"
            }
        };
        string json = JsonSerializer.Serialize(ack, _jsonOptions);
        await _manager.BroadcastAsync(json);
    }

    /// <summary>向单个 WebSocket 连接发送消息（不广播）</summary>
    private async Task SendToClientAsync<T>(System.Net.WebSockets.WebSocket ws, WsMessage<T> msg)
    {
        if (ws.State != WebSocketState.Open) return;

        try
        {
            string  json   = JsonSerializer.Serialize(msg, _jsonOptions);
            byte[]  bytes  = Encoding.UTF8.GetBytes(json);
            await ws.SendAsync(
                new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text,
                true,
                CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send direct message to WebSocket.");
        }
    }
}
