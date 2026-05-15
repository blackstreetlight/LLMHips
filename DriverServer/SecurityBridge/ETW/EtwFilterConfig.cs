// ETW/EtwFilterConfig.cs
namespace SecurityBridge.ETW;

/// <summary>
/// 静态过滤规则库：对 ETW 上报的文件/注册表/网络事件打威胁等级。
/// 返回 null 表示"不关心，丢弃"；返回字符串元组 (severity, rule) 表示需要广播。
///
/// 规则优先级：从上到下，命中第一条即返回。
/// </summary>
public static class EtwFilterConfig
{
    // ─── 文件监控规则 ───────────────────────────────────────────────────────────

    /// <summary>高危路径片段：出现即报 high</summary>
    private static readonly string[] _highRiskFilePaths =
    [
        // 系统启动项目录（持久化经典手段）
        @"\Microsoft\Windows\Start Menu\Programs\Startup\",
        @"\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\",
        // 驱动目录（驱动投放）
        @"\System32\drivers\",
        @"\SysWOW64\drivers\",
        // 系统策略脚本
        @"\Windows\System32\GroupPolicy\",
        @"\Windows\PolicyDefinitions\",
    ];

    /// <summary>中危路径片段 + 可疑扩展名的组合</summary>
    private static readonly string[] _mediumRiskFilePaths =
    [
        @"\Temp\",
        @"\AppData\Local\Temp\",
        @"\Users\Public\",
        @"\ProgramData\",
        @"\Windows\Temp\",
    ];

    /// <summary>在中危路径下，这些扩展名直接升级为 high</summary>
    private static readonly HashSet<string> _executableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".sys", ".drv", ".scr",
        ".bat", ".cmd", ".ps1", ".vbs", ".js", ".hta",
        ".msi", ".msp", ".pif"
    };

    /// <summary>
    /// 对文件事件打分。
    /// </summary>
    /// <param name="filePath">文件完整路径（ETW 上报的 FileName）</param>
    /// <returns>(severity, ruleDescription) 或 null（不关心）</returns>
    public static (string severity, string rule)? ClassifyFileEvent(string filePath)
    {
        if (string.IsNullOrEmpty(filePath)) return null;

        // 高危路径
        foreach (var pattern in _highRiskFilePaths)
        {
            if (filePath.Contains(pattern, StringComparison.OrdinalIgnoreCase))
                return ("high", $"写入高危路径: {pattern.Trim('\\')}");
        }

        // 中危路径 + 可执行扩展名 → high；中危路径本身 → medium
        foreach (var pattern in _mediumRiskFilePaths)
        {
            if (!filePath.Contains(pattern, StringComparison.OrdinalIgnoreCase)) continue;

            var ext = Path.GetExtension(filePath);
            if (_executableExtensions.Contains(ext))
                return ("high", $"Temp/公开目录释放可执行文件: {ext}");

            return ("medium", $"在可疑目录写文件: {pattern.Trim('\\')}");
        }

        return null; // 普通路径，不关心
    }

    // ─── 注册表监控规则 ─────────────────────────────────────────────────────────

    /// <summary>高危注册表键前缀（持久化/劫持）→ high</summary>
    private static readonly (string prefix, string desc)[] _highRiskRegKeys =
    [
        // 自启动 Run / RunOnce
        (@"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",  "HKLM Run 自启动写入"),
        (@"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",  "HKCU Run 自启动写入"),
        (@"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce", "RunOnce 写入"),
        // 服务注册
        (@"HKLM\SYSTEM\CurrentControlSet\Services\",             "系统服务注册/修改"),
        // AppInit DLL 劫持
        (@"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows\AppInit_DLLs", "AppInit_DLL 劫持"),
        // Image File Execution Options（调试器劫持）
        (@"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\", "IFEO 调试器劫持"),
        // Winlogon 劫持
        (@"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon", "Winlogon 劫持"),
        // COM 劫持
        (@"HKCU\SOFTWARE\Classes\CLSID\",                        "HKCU COM 劫持"),
        // 安全工具禁用
        (@"HKLM\SOFTWARE\Policies\Microsoft\Windows Defender",   "Defender 策略修改"),
    ];

    /// <summary>中危注册表键前缀 → medium</summary>
    private static readonly (string prefix, string desc)[] _mediumRiskRegKeys =
    [
        (@"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders", "Shell 文件夹重定向"),
        (@"HKCU\Environment\",                                   "用户环境变量修改"),
        (@"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\BootExecute", "BootExecute 修改"),
    ];

    /// <summary>对注册表 SetValue 事件打分</summary>
    public static (string severity, string rule)? ClassifyRegistryEvent(string keyPath)
    {
        if (string.IsNullOrEmpty(keyPath)) return null;

        foreach (var (prefix, desc) in _highRiskRegKeys)
        {
            if (keyPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return ("high", desc);
        }

        foreach (var (prefix, desc) in _mediumRiskRegKeys)
        {
            if (keyPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return ("medium", desc);
        }

        return null;
    }

    // ─── 网络监控规则 ────────────────────────────────────────────────────────────

    /// <summary>高危端口（C2 常用、RAT 通信、反弹 Shell）→ high</summary>
    private static readonly HashSet<ushort> _highRiskPorts = new()
    {
        4444,  // Metasploit 默认反弹 Shell
        1234,  // 常见测试/RAT 端口
        31337, // 经典后门端口（Elite/Back Orifice）
        8888,  // 常见 C2 HTTP
        9999,  // 常见 C2 HTTP
        6666,  // IRC Bot / C2
        6667,  // IRC
        1337,  // Leet 端口，常见后门
        65535, // 边界测试端口
    };

    /// <summary>
    /// 可疑但不一定恶意的端口（需结合进程上下文判断）→ medium
    /// 例如：Tor 代理、非标准远程桌面等
    /// </summary>
    private static readonly HashSet<ushort> _mediumRiskPorts = new()
    {
        9050, 9051, // Tor SOCKS 代理
        3389,       // RDP（普通进程不该主动连 RDP）
        5985, 5986, // WinRM（横向移动）
        445,        // SMB（横向移动）
        135,        // DCOM/RPC
        23,         // Telnet（明文、老旧）
    };

    /// <summary>对 TCP 连接事件打分</summary>
    public static (string severity, string rule)? ClassifyNetworkEvent(ushort destPort)
    {
        if (_highRiskPorts.Contains(destPort))
            return ("high", $"连接高危端口 {destPort}（已知 C2/反弹 Shell）");

        if (_mediumRiskPorts.Contains(destPort))
            return ("medium", $"连接可疑端口 {destPort}（横向移动/代理）");

        // 端口正常但仍可告知（可由配置开关控制是否全量上报）
        return null;
    }
}
