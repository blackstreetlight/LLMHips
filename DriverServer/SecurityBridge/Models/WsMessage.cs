// Models/WsMessage.cs
namespace SecurityBridge.Models;

/// <summary>
/// WebSocket 消息通用包装，用泛型保证 Payload 类型安全。
/// 所有服务端 → 前端的消息统一通过此类序列化，
/// Type 字段供前端 switch 路由到对应处理逻辑。
/// </summary>
public class WsMessage<T>
{
    /// <summary>
    /// 消息类型路由键，已定义值：
    ///   "process_event"  → 驱动拦截事件推送
    ///   "heartbeat"      → 服务存活心跳
    ///   "command_ack"    → 指令执行回执
    ///   "pong"           → 心跳探测响应
    /// </summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>消息载荷，具体类型由 Type 决定</summary>
    public T Payload { get; set; } = default!;
}
