// Models/ProcessEvent.cs
namespace SecurityBridge.Models;

/// <summary>
/// 内核驱动上报的进程拦截事件。
/// 字段需同时与驱动 DRIVER_EVENT_BUFFER 和前端 TypeScript ProcessEvent 保持对齐。
/// </summary>
public class ProcessEvent
{
    /// <summary>事件唯一标识，由桥接层生成 GUID，保证前端列表 key 唯一</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>事件类型："create"（进程创建）| "exit"（进程退出）</summary>
    public string EventType { get; set; } = "create";

    /// <summary>被拦截进程的 PID</summary>
    public int Pid { get; set; }

    /// <summary>父进程 PID</summary>
    public int ParentPid { get; set; }

    /// <summary>进程可执行文件名（不含路径）</summary>
    public string ProcessName { get; set; } = string.Empty;

    /// <summary>进程可执行文件完整路径（DOS 格式，如 C:\Windows\...）</summary>
    public string ProcessPath { get; set; } = string.Empty;

    /// <summary>进程启动命令行参数</summary>
    public string CmdLine { get; set; } = string.Empty;

    /// <summary>父进程可执行文件名</summary>
    public string ParentProcessName { get; set; } = string.Empty;

    /// <summary>父进程完整路径</summary>
    public string ParentProcessPath { get; set; } = string.Empty;

    /// <summary>签名状态：0=未检查, 1=未签名, 2=已签名</summary>
    public int IsSigned { get; set; }

    /// <summary>触发拦截的规则描述（由桥接层根据 RiskLevel 生成）</summary>
    public string RuleTriggered { get; set; } = string.Empty;

    /// <summary>风险等级："high" | "medium" | "low"</summary>
    public string RiskLevel { get; set; } = string.Empty;

    /// <summary>当前处置状态："blocked" | "watching" | "allowed"</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>可执行文件创建时间，Unix 毫秒时间戳</summary>
    public long FileCreateTime { get; set; }

    /// <summary>事件发生时间，Unix 毫秒时间戳</summary>
    public long Timestamp { get; set; }
}
