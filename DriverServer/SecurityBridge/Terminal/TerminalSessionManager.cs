// Terminal/TerminalSessionManager.cs
using System.Collections.Concurrent;
using System.Text.Json;
using SecurityBridge.WebSocket;

namespace SecurityBridge.Terminal;

/// <summary>
/// 管理所有 WebSocket 连接对应的终端会话（单例）。
/// 每个前端连接（connId）最多对应一个交互 shell 会话。
///
/// 职责：
///   - 接收前端的 terminal_start / terminal_input / terminal_close 消息
///   - 接收 terminal_command 消息（AI 技能用，批量执行单条命令）
///   - 将 shell 输出通过 WebSocketConnectionManager 点对点发回给对应连接
/// </summary>
public class TerminalSessionManager
{
    // connId → 交互会话
    private readonly ConcurrentDictionary<string, TerminalSession> _sessions = new();

    private readonly WebSocketConnectionManager _wsManager;
    private readonly ILogger<TerminalSessionManager> _logger;

    private static readonly JsonSerializerOptions _json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public TerminalSessionManager(
        WebSocketConnectionManager wsManager,
        ILogger<TerminalSessionManager> logger)
    {
        _wsManager = wsManager;
        _logger    = logger;
    }

    // ─── 交互终端 ─────────────────────────────────────────────────

    /// <summary>
    /// 为指定连接启动一个 shell 会话。
    /// 若该连接已有会话，先关闭旧会话。
    /// </summary>
    public async Task StartSessionAsync(string connId)
    {
        // 清理旧会话
        if (_sessions.TryRemove(connId, out var old))
            await old.DisposeAsync();

        var session = new TerminalSession(
            onOutput: data => SendOutputAsync(connId, data),
            logger: _logger
        );

        session.Start();
        _sessions[connId] = session;
        _logger.LogInformation("[Terminal] Session started for conn {ConnId}", connId);
    }

    /// <summary>将前端的键盘输入转发给对应的 shell stdin</summary>
    public async Task WriteInputAsync(string connId, string data)
    {
        if (_sessions.TryGetValue(connId, out var session))
            await session.WriteAsync(data);
    }

    /// <summary>关闭指定连接的 shell 会话</summary>
    public async Task CloseSessionAsync(string connId)
    {
        if (_sessions.TryRemove(connId, out var session))
        {
            await session.DisposeAsync();
            _logger.LogInformation("[Terminal] Session closed for conn {ConnId}", connId);
        }
    }

    // ─── AI 技能：批量命令执行 ─────────────────────────────────────

    /// <summary>
    /// 执行单条命令（独立进程，不影响交互会话），
    /// 执行完成后将结果通过 terminal_command_result 消息发给对应连接。
    ///
    /// requestId 由前端生成并附带，用于前端匹配请求与响应。
    /// </summary>
    public async Task RunCommandAsync(string connId, string requestId, string cmd, int timeout = 15)
    {
        _logger.LogInformation(
            "[Terminal] RunCommand connId={ConnId} requestId={ReqId} cmd={Cmd}",
            connId, requestId, cmd);

        var (output, exitCode) = await TerminalSession.RunCommandAsync(cmd, timeout);

        var msg = new
        {
            type    = "terminal_command_result",
            payload = new
            {
                requestId,
                output,
                exitCode,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            }
        };

        await _wsManager.SendToAsync(connId, JsonSerializer.Serialize(msg, _json));
    }

    // ─── 连接断开时清理 ───────────────────────────────────────────

    /// <summary>当 WebSocket 连接断开时（WebSocketHandler 调用），清理其会话</summary>
    public async Task OnConnectionClosedAsync(string connId)
    {
        await CloseSessionAsync(connId);
    }

    // ─── 内部工具 ─────────────────────────────────────────────────

    /// <summary>将 shell 输出包装为 terminal_output 消息，点对点发给对应连接</summary>
    private async Task SendOutputAsync(string connId, string data)
    {
        var msg = new
        {
            type    = "terminal_output",
            payload = new { data }
        };
        await _wsManager.SendToAsync(connId, JsonSerializer.Serialize(msg, _json));
    }
}
