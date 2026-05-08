// Models/DriverCommand.cs
namespace SecurityBridge.Models;

/// <summary>
/// 前端下发的进程控制指令，桥接层将其转换为 IOCTL 结构体发送给驱动
/// </summary>
public class DriverCommand
{
    /// <summary>
    /// 操作类型：
    ///   "kill"        → 立即终止进程
    ///   "whitelist"   → 加入白名单，后续放行
    ///   "blacklist"   → 加入黑名单，后续自动阻断
    ///   "allow_once"  → 本次放行，下次仍拦截
    /// </summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>目标进程 PID</summary>
    public int Pid { get; set; }

    /// <summary>操作原因（可选，前端记录用，不传给驱动）</summary>
    public string? Reason { get; set; }
}
