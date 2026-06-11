// WebSocket/WebSocketConnectionManager.cs
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

namespace SecurityBridge.WebSocket;

/// <summary>
/// WebSocket 连接池管理器（单例）。
/// 维护所有已建立的前端连接，支持并发广播。
/// </summary>
public class WebSocketConnectionManager
{
    // 线程安全字典：连接ID → WebSocket 实例
    private readonly ConcurrentDictionary<string, System.Net.WebSockets.WebSocket> _connections = new();
    private readonly ILogger<WebSocketConnectionManager> _logger;

    public WebSocketConnectionManager(ILogger<WebSocketConnectionManager> logger)
    {
        _logger = logger;
    }

    /// <summary>将新建立的 WebSocket 连接注册到连接池</summary>
    public void AddConnection(string id, System.Net.WebSockets.WebSocket ws)
    {
        _connections[id] = ws;
        _logger.LogInformation("WebSocket connected: {Id}, total: {Count}", id, _connections.Count);
    }

    /// <summary>从连接池移除指定连接（断开或出错时调用）</summary>
    public void RemoveConnection(string id)
    {
        _connections.TryRemove(id, out _);
        _logger.LogInformation("WebSocket disconnected: {Id}, total: {Count}", id, _connections.Count);
    }

    /// <summary>
    /// 向连接池中所有处于 Open 状态的客户端广播 JSON 文本消息。
    /// 单个连接发送失败不影响其他连接，失败的连接从池中移除。
    /// </summary>
    public async Task BroadcastAsync(string jsonMessage)
    {
        if (_connections.IsEmpty) return;

        byte[] bytes  = Encoding.UTF8.GetBytes(jsonMessage);
        var    buffer = new ArraySegment<byte>(bytes);

        // 收集需要移除的断开连接，避免在遍历中修改字典
        List<string>? toRemove = null;

        foreach (var (id, ws) in _connections)
        {
            if (ws.State != WebSocketState.Open)
            {
                (toRemove ??= []).Add(id);
                continue;
            }

            try
            {
                await ws.SendAsync(buffer, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to send to WebSocket {Id}, removing.", id);
                (toRemove ??= []).Add(id);
            }
        }

        // 清理已断开的连接
        if (toRemove != null)
        {
            foreach (var id in toRemove)
                RemoveConnection(id);
        }
    }

    /// <summary>
    /// 向指定连接 ID 的客户端点对点发送消息（不广播）。
    /// 用于终端输出、命令结果等只需返回给特定前端的场景。
    /// </summary>
    public async Task SendToAsync(string connId, string jsonMessage)
    {
        if (!_connections.TryGetValue(connId, out var ws)) return;
        if (ws.State != WebSocketState.Open)
        {
            RemoveConnection(connId);
            return;
        }

        try
        {
            byte[] bytes = Encoding.UTF8.GetBytes(jsonMessage);
            await ws.SendAsync(
                new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text,
                true,
                CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send to WebSocket {Id}, removing.", connId);
            RemoveConnection(connId);
        }
    }

    /// <summary>当前已连接的客户端数量</summary>
    public int Count => _connections.Count;
}
