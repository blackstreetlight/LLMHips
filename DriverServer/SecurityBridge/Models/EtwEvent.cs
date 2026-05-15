// Models/EtwEvent.cs
namespace SecurityBridge.Models;

/// <summary>
/// ETW（Event Tracing for Windows）捕获的行为事件。
/// 由 EtwMonitor 产生，经 WebSocket 推送给前端，消息 Type 为 "etw_event"。
/// </summary>
public class EtwEvent
{
    /// <summary>事件唯一 ID（GUID）</summary>
    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <summary>事件发生时间，Unix 毫秒时间戳</summary>
    public long Timestamp { get; set; }

    /// <summary>触发事件的进程 PID</summary>
    public int Pid { get; set; }

    /// <summary>进程名（不含路径）</summary>
    public string ProcessName { get; set; } = string.Empty;

    /// <summary>事件分类："File" | "Registry" | "Network"</summary>
    public string Category { get; set; } = string.Empty;

    /// <summary>
    /// 具体动作：
    ///   File     → "Create" | "Write" | "Delete"
    ///   Registry → "CreateKey" | "SetValue" | "DeleteKey"
    ///   Network  → "Connect" | "Send"
    /// </summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>
    /// 事件目标：
    ///   File     → 文件完整路径
    ///   Registry → 注册表键路径 + 值名
    ///   Network  → "IP:Port" 字符串
    /// </summary>
    public string Target { get; set; } = string.Empty;

    /// <summary>
    /// 风险等级（由 EtwFilterConfig 静态规则打分）：
    ///   "high"   → 极度可疑，直接触发前端告警
    ///   "medium" → 中等可疑，建议人工确认
    ///   "low"    → 轻微异常，仅记录不弹窗
    /// </summary>
    public string Severity { get; set; } = "low";

    /// <summary>命中的规则描述，便于前端 Tooltip 显示</summary>
    public string RuleDescription { get; set; } = string.Empty;
}
