// Driver/IDriverClient.cs
using SecurityBridge.Models;

namespace SecurityBridge.Driver;

/// <summary>
/// 驱动通信抽象接口。
/// 桥接服务的其他模块只依赖此接口，不感知底层是真实驱动还是 Mock。
/// </summary>
public interface IDriverClient
{
    /// <summary>打开驱动设备句柄，建立通信通道</summary>
    Task<bool> ConnectAsync();

    /// <summary>
    /// 向驱动轮询一次，拉取一条待处理的进程拦截事件。
    /// 当驱动队列为空时返回 null。
    /// </summary>
    Task<ProcessEvent?> PollEventAsync();

    /// <summary>将前端下发的控制指令转发给驱动执行</summary>
    Task<bool> SendCommandAsync(DriverCommand cmd);

    /// <summary>关闭驱动设备句柄，释放资源</summary>
    Task DisconnectAsync();

    /// <summary>驱动通信通道是否处于已连接状态</summary>
    bool IsConnected { get; }
}
