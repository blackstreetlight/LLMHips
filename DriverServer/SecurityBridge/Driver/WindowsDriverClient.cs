// Driver/WindowsDriverClient.cs
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using SecurityBridge.Models;

namespace SecurityBridge.Driver;

/// <summary>
/// 真实 Windows 驱动通信客户端，通过 DeviceIoControl (IOCTL) 与内核驱动交互。
/// 整个类仅在 Windows 平台编译和运行，由 Program.cs 根据配置条件注入。
/// </summary>
[SupportedOSPlatform("windows")]
public class WindowsDriverClient : IDriverClient
{
    // ── IOCTL 控制码 ────────────────────────────────────────────────────────
    // 与驱动 Common.h 中 CTL_CODE 宏计算结果保持一致：
    //   CTL_CODE(0x8000, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS) = 0x80002000
    //   CTL_CODE(0x8000, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS) = 0x80002004
    private const uint IOCTL_GET_EVENT    = 0x80002000; // 读取一条进程拦截事件
    private const uint IOCTL_SEND_COMMAND = 0x80002004; // 下发进程控制指令

    private const uint GENERIC_READ_WRITE = 0xC0000000;
    private const uint OPEN_EXISTING      = 3;
    private const int  INVALID_HANDLE     = -1;
    private const int  ERROR_NO_MORE_ITEMS = 259; // 驱动返回 STATUS_NO_MORE_ENTRIES 时映射的 Win32 错误码

    private readonly string _devicePath;
    private readonly ILogger<WindowsDriverClient> _logger;
    private nint _deviceHandle = INVALID_HANDLE; // 驱动设备文件句柄

    public bool IsConnected =>
        _deviceHandle != INVALID_HANDLE && _deviceHandle != 0;

    public WindowsDriverClient(IConfiguration config, ILogger<WindowsDriverClient> logger)
    {
        // 驱动设备路径从配置读取，默认为 \\.\SecurityDriver
        _devicePath = config.GetValue<string>("Bridge:DriverDeviceName", @"\\.\SecurityDriver")!;
        _logger     = logger;
    }

    // ── P/Invoke 声明 ─────────────────────────────────────────────────────────

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern nint CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        nint lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        nint hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        nint hDevice,
        uint dwIoControlCode,
        nint lpInBuffer,
        uint nInBufferSize,
        nint lpOutBuffer,
        uint nOutBufferSize,
        out uint lpBytesReturned,
        nint lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint hObject);

    // ── 签名验证 P/Invoke ────────────────────────────────────────────────────
    // WinVerifyTrust 是 Windows 标准 Authenticode 签名验证 API
    // 在用户态调用远比内核态简单可靠（内核中需要使用未文档化的 CI.dll）

    [DllImport("wintrust.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int WinVerifyTrust(
        nint hwnd,                  // INVALID_HANDLE_VALUE = 无 UI
        [MarshalAs(UnmanagedType.LPStruct)] Guid pgActionID,
        ref WINTRUST_DATA pWVTData);

    /// <summary>WinVerifyTrust 操作类型：验证文件签名</summary>
    private static readonly Guid WINTRUST_ACTION_GENERIC_VERIFY_V2 =
        new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    private const int WTD_UI_NONE            = 2;     // 不弹 UI
    private const int WTD_CHOICE_FILE        = 1;     // 验证对象是文件
    private const int WTD_REVOKE_NONE        = 0;     // 不检查吊销（加快速度）
    private const int WTD_STATEACTION_VERIFY = 1;     // 执行验证

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WINTRUST_FILE_INFO
    {
        public uint cbStruct;
        public string pcwszFilePath;
        public nint hFile;
        public nint pgKnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WINTRUST_DATA
    {
        public uint cbStruct;
        public nint pPolicyCallbackData;
        public nint pSIPClientData;
        public int dwUIChoice;
        public int fdwRevocationChecks;
        public int dwUnionChoice;
        public nint pFile;              // 指向 WINTRUST_FILE_INFO
        public int dwStateAction;
        public nint hWVTStateData;
        public nint pwszURLReference;
        public int dwProvFlags;
        public int dwUIContext;
        public nint pSignatureSettings;
    }

    // ── 与驱动通信的原始内存结构体 ────────────────────────────────────────────
    // 字段顺序、名称、长度须与驱动 Common.h 中 DRIVER_EVENT_BUFFER 完全对齐
    // 总大小约 4196 字节（0x1064）

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DRIVER_EVENT_BUFFER
    {
        // NOTE: EventType 字段已从此处移除，与当前编译的 .sys 驱动保持字节对齐。
        public uint EventType;
        // 若驱动更新后在首位加入 EventType，请重新加回此字段并开启下方退出事件处理逻辑。
        public uint Pid;                // ULONG — 新进程 PID
        public uint ParentPid;          // ULONG — 父进程 PID

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ProcessName;      // WCHAR[260] — 进程文件名

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ProcessPath;      // WCHAR[260] — 进程完整路径（DOS 格式）

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 1024)]
        public string CmdLine;          // WCHAR[1024] — 命令行参数

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ParentProcessName;// WCHAR[260] — 父进程文件名

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ParentProcessPath;// WCHAR[260] — 父进程完整路径

        public uint IsSigned;           // ULONG — 0=未知, 1=未签名, 2=已签名
        public uint RiskLevel;          // ULONG — 0=low, 1=medium, 2=high
        public uint EventStatus;        // ULONG — 0=allowed, 1=watching, 2=blocked

        public long FileCreateTime;     // LARGE_INTEGER — 可执行文件创建时间 (FILETIME)
        public long Timestamp;          // LARGE_INTEGER — 事件时间戳 (FILETIME)
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DRIVER_COMMAND_BUFFER
    {
        public int Pid;
        public int Action; // 0=kill, 1=whitelist, 2=blacklist, 3=allow_once
    }

    // ── IDriverClient 实现 ────────────────────────────────────────────────────

    public Task<bool> ConnectAsync()
    {
        // 以读写权限打开驱动设备文件，获取通信句柄
        _deviceHandle = CreateFile(
            _devicePath,
            GENERIC_READ_WRITE,
            0,
            nint.Zero,
            OPEN_EXISTING,
            0,
            nint.Zero);

        if (_deviceHandle == new nint(INVALID_HANDLE) || _deviceHandle == nint.Zero)
        {
            int err = Marshal.GetLastWin32Error();
            _logger.LogError("Failed to open driver device '{Path}', Win32 error: {Err}",
                _devicePath, err);
            _deviceHandle = INVALID_HANDLE;
            return Task.FromResult(false);
        }

        _logger.LogInformation("Driver device '{Path}' opened successfully.", _devicePath);
        return Task.FromResult(true);
    }

    public Task<ProcessEvent?> PollEventAsync()
    {
        if (!IsConnected) return Task.FromResult<ProcessEvent?>(null);

        int bufferSize = Marshal.SizeOf<DRIVER_EVENT_BUFFER>();
        nint pBuffer   = Marshal.AllocHGlobal(bufferSize);

        try
        {
            bool ok = DeviceIoControl(
                _deviceHandle,
                IOCTL_GET_EVENT,
                nint.Zero, 0,
                pBuffer, (uint)bufferSize,
                out uint bytesReturned,
                nint.Zero);

            if (!ok)
            {
                int err = Marshal.GetLastWin32Error();

                // 驱动队列为空是正常状态，不需要报错
                if (err == ERROR_NO_MORE_ITEMS)
                    return Task.FromResult<ProcessEvent?>(null);

                _logger.LogWarning("DeviceIoControl (GET_EVENT) failed, Win32 error: {Err}", err);
                return Task.FromResult<ProcessEvent?>(null);
            }

            // 将非托管内存中的结构体拷贝到托管对象
            var buf = Marshal.PtrToStructure<DRIVER_EVENT_BUFFER>(pBuffer);

            // ── 进程退出事件 ──────────────────────────────────────────────────
            // 驱动在进程退出时触发回调，EventType=1，ProcessName/ProcessPath 为空。
            // 直接构造轻量的 exit 事件返回，由 Worker 负责广播 process_exit 消息
            // 并调用 EtwMonitor.UntrackPid()。
            if (buf.EventType == 1)
            {
                return Task.FromResult<ProcessEvent?>(new ProcessEvent
                {
                    Id        = Guid.NewGuid().ToString(),
                    EventType = "exit",
                    Pid       = (int)buf.Pid,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                });
            }

            // ── 中间层补充签名验证 ────────────────────────────────────────────
            // 驱动层 IsSigned 恒为 SIGN_UNKNOWN(0)，由中间层通过 WinVerifyTrust 补充
            int isSigned = (int)buf.IsSigned;
            if (isSigned == 0 && !string.IsNullOrEmpty(buf.ProcessPath))
            {
                isSigned = VerifyFileSignature(buf.ProcessPath);
            }

            // ── 中间层重新评估 RiskLevel ─────────────────────────────────────
            // 驱动的规则引擎在 IsSigned 恒为 SIGN_UNKNOWN 的前提下做的预判，
            // 其中"未签名+可疑路径→HIGH"这条规则永远不会触发。
            // 中间层拿到真实签名结果后，需要重新评估风险等级。
            int riskLevel = ReEvaluateRiskLevel(buf, isSigned);

            // ── 根据最终 RiskLevel 决定 Status ──────────────────────────────
            // high → blocked（建议拦截），medium → watching（持续监控），low → allowed（放行）
            string status = riskLevel switch
            {
                2 => "blocked",     // HIGH → 建议拦截
                1 => "watching",    // MEDIUM → 监控中
                _ => "allowed"      // LOW → 已放行
            };

            var evt = new ProcessEvent
            {
                Id                = Guid.NewGuid().ToString(),
                EventType         = "create",
                Pid               = (int)buf.Pid,
                ParentPid         = (int)buf.ParentPid,
                ProcessName       = buf.ProcessName ?? string.Empty,
                ProcessPath       = buf.ProcessPath ?? string.Empty,
                CmdLine           = buf.CmdLine ?? string.Empty,
                ParentProcessName = buf.ParentProcessName ?? string.Empty,
                ParentProcessPath = buf.ParentProcessPath ?? string.Empty,
                IsSigned          = isSigned,
                RuleTriggered     = InferRuleTriggered(buf, isSigned),
                RiskLevel         = MapRiskLevel(riskLevel),
                Status            = status,
                FileCreateTime    = FileTimeToUnixMs(buf.FileCreateTime),
                Timestamp         = FileTimeToUnixMs(buf.Timestamp)
            };

            return Task.FromResult<ProcessEvent?>(evt);
        }
        finally
        {
            Marshal.FreeHGlobal(pBuffer);
        }
    }

    public Task<bool> SendCommandAsync(DriverCommand cmd)
    {
        if (!IsConnected) return Task.FromResult(false);

        var buf = new DRIVER_COMMAND_BUFFER
        {
            Pid    = cmd.Pid,
            Action = MapAction(cmd.Action)
        };

        int bufferSize = Marshal.SizeOf<DRIVER_COMMAND_BUFFER>();
        nint pBuffer   = Marshal.AllocHGlobal(bufferSize);

        try
        {
            Marshal.StructureToPtr(buf, pBuffer, false);

            bool ok = DeviceIoControl(
                _deviceHandle,
                IOCTL_SEND_COMMAND,
                pBuffer, (uint)bufferSize,
                nint.Zero, 0,
                out _,
                nint.Zero);

            if (!ok)
            {
                int err = Marshal.GetLastWin32Error();
                _logger.LogWarning(
                    "DeviceIoControl (SEND_COMMAND) failed for PID {Pid}, Win32 error: {Err}",
                    cmd.Pid, err);
                return Task.FromResult(false);
            }

            return Task.FromResult(true);
        }
        finally
        {
            Marshal.FreeHGlobal(pBuffer);
        }
    }

    public Task DisconnectAsync()
    {
        if (IsConnected)
        {
            CloseHandle(_deviceHandle);
            _deviceHandle = INVALID_HANDLE;
            _logger.LogInformation("Driver device handle closed.");
        }
        return Task.CompletedTask;
    }

    // ── 枚举值映射：驱动整型 → 前端字符串 ───────────────────────────────────

    private static string MapRiskLevel(int level) => level switch
    {
        0 => "low",
        1 => "medium",
        2 => "high",
        _ => "low"
    };

    private static string MapStatus(int status) => status switch
    {
        0 => "allowed",
        1 => "watching",
        2 => "blocked",
        _ => "watching"
    };

    /// <summary>将前端 Action 字符串转换为驱动识别的整型指令码</summary>
    private static int MapAction(string action) => action switch
    {
        "kill"       => 0,
        "whitelist"  => 1,
        "blacklist"  => 2,
        "allow_once" => 3,
        _            => 0
    };

    // ── 辅助方法 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 将 Windows FILETIME（100 纳秒间隔，起点 1601-01-01）转换为 Unix 毫秒时间戳。
    /// 如果值为 0 或无效，返回当前时间。
    /// </summary>
    private static long FileTimeToUnixMs(long fileTime)
    {
        if (fileTime <= 0)
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        try
        {
            return DateTimeOffset.FromFileTime(fileTime).ToUnixTimeMilliseconds();
        }
        catch
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }

    /// <summary>
    /// 通过 WinVerifyTrust API 验证可执行文件的 Authenticode 数字签名。
    /// 返回值与驱动 Common.h 中的 SIGN_* 常量一致：0=未知, 1=未签名, 2=已签名。
    /// </summary>
    private int VerifyFileSignature(string filePath)
    {
        try
        {
            var fileInfo = new WINTRUST_FILE_INFO
            {
                cbStruct       = (uint)Marshal.SizeOf<WINTRUST_FILE_INFO>(),
                pcwszFilePath  = filePath,
                hFile          = nint.Zero,
                pgKnownSubject = nint.Zero
            };

            nint pFileInfo = Marshal.AllocHGlobal(Marshal.SizeOf<WINTRUST_FILE_INFO>());

            try
            {
                Marshal.StructureToPtr(fileInfo, pFileInfo, false);

                var trustData = new WINTRUST_DATA
                {
                    cbStruct            = (uint)Marshal.SizeOf<WINTRUST_DATA>(),
                    dwUIChoice          = WTD_UI_NONE,
                    fdwRevocationChecks = WTD_REVOKE_NONE,
                    dwUnionChoice       = WTD_CHOICE_FILE,
                    pFile               = pFileInfo,
                    dwStateAction       = WTD_STATEACTION_VERIFY,
                };

                int result = WinVerifyTrust(new nint(-1), WINTRUST_ACTION_GENERIC_VERIFY_V2, ref trustData);

                // result == 0 表示签名有效
                return result == 0 ? 2 : 1; // SIGN_SIGNED : SIGN_UNSIGNED
            }
            finally
            {
                Marshal.FreeHGlobal(pFileInfo);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Signature check failed for '{Path}': {Msg}", filePath, ex.Message);
            return 0; // SIGN_UNKNOWN — 验证出错，不做判断
        }
    }

    /// <summary>
    /// 中间层重新评估风险等级。
    /// 与驱动 RuleEngine.c 的 EvaluateRiskLevel() 逻辑完全一致，
    /// 但使用中间层补充的真实签名信息，使"未签名+可疑路径→HIGH"规则生效。
    /// 返回值：0=LOW, 1=MEDIUM, 2=HIGH
    /// </summary>
    private static int ReEvaluateRiskLevel(DRIVER_EVENT_BUFFER buf, int isSigned)
    {
        string procName = (buf.ProcessName ?? string.Empty).ToLowerInvariant();
        string cmdLine  = (buf.CmdLine ?? string.Empty).ToLowerInvariant();
        string path     = (buf.ProcessPath ?? string.Empty).ToLowerInvariant();
        string parentName = (buf.ParentProcessName ?? string.Empty).ToLowerInvariant();

        // 规则 1（HIGH）：危险工具名
        string[] dangerousTools = [
            "mimikatz", "wce", "pwdump", "fgdump", "quarks-pwdump",
            "psexec", "psexesvc", "paexec", "remcom",
            "nmap", "masscan", "zmap",
            "frpc", "frps", "lcx", "netcat", "nc", "ncat", "socat",
            "cobalt_strike", "cobaltstrike", "beacon", "meterpreter",
            "msfconsole", "msf",
            "juicypotato", "sweetpotato", "rottenpotato", "tokenvator", "incognito",
            "sharphound", "rubeus", "certify", "printspoofer"
        ];
        foreach (var tool in dangerousTools)
        {
            if (procName.Contains(tool)) return 2; // HIGH
        }

        // 规则 2（HIGH）：命令行高危关键词
        string[] dangerousCmdKeywords = [
            "-enc ", "-encodedcommand", "-exec bypass", "-executionpolicy bypass",
            "-nop ", "-windowstyle hidden",
            "iex(", "invoke-expression", "downloadstring(", "downloadfile(",
            "certutil -urlcache", "certutil -decode", "/c certutil",
            "bitsadmin /transfer",
            "wmic process call create",
            "reg add", "currentversion\\run",
            "schtasks /create", "sc create", "sc config",
            "set-mppreference", "add-mppreference",
            "netsh advfirewall set allprofiles state off",
            "virtualalloc", "writeprocessmemory",
            "tcp://", "http://"
        ];
        foreach (var keyword in dangerousCmdKeywords)
        {
            if (cmdLine.Contains(keyword)) return 2; // HIGH
        }

        // 规则 3（HIGH）：未签名 + 可疑路径 —— 这条在驱动层永远不触发，中间层补签名后才生效
        if (isSigned == 1) // SIGN_UNSIGNED
        {
            string[] suspiciousPaths = [@"c:\users\", @"c:\programdata\", @"c:\windows\temp\", @"c:\temp\"];
            foreach (var sp in suspiciousPaths)
            {
                if (path.StartsWith(sp)) return 2; // HIGH
            }
        }

        // 规则 4（LOW）：受信任系统目录
        string[] trustedPaths = [
            @"c:\windows\system32\", @"c:\windows\syswow64\",
            @"c:\windows\winsxs\", @"c:\windows\servicing\",
            "c:\\program files\\", "c:\\program files (x86)\\"
        ];
        foreach (var tp in trustedPaths)
        {
            if (path.StartsWith(tp)) return 0; // LOW
        }

        // 规则 5（LOW）：受信任父进程
        string[] trustedParents = [
            "explorer.exe", "services.exe", "svchost.exe",
            "wininit.exe", "winlogon.exe", "lsass.exe",
            "csrss.exe", "smss.exe", "taskmgr.exe", "msiexec.exe"
        ];
        foreach (var tp in trustedParents)
        {
            if (parentName.Contains(tp)) return 0; // LOW
        }

        return 1; // MEDIUM — 默认
    }

    /// <summary>
    /// 驱动不提供 RuleTriggered 文本字段，桥接层根据事件数据推断触发的规则描述。
    /// 逻辑与驱动 RuleEngine.c 中 EvaluateRiskLevel() 的判定顺序保持一致。
    /// </summary>
    private static string InferRuleTriggered(DRIVER_EVENT_BUFFER buf, int isSigned)
    {
        // 已知危险工具名
        string[] dangerousTools = [
            "mimikatz.exe", "wce", "pwdump", "fgdump", "quarks-pwdump",
            "psexec", "psexesvc", "paexec", "remcom",
            "nmap", "masscan", "zmap",
            "frpc", "frps", "lcx", "netcat", "nc", "ncat", "socat",
            "cobalt_strike", "cobaltstrike", "beacon", "meterpreter",
            "msfconsole", "msf",
            "juicypotato", "sweetpotato", "rottenpotato", "tokenvator", "incognito",
            "sharphound", "rubeus", "certify", "printspoofer"
        ];

        string procName = (buf.ProcessName ?? string.Empty).ToLowerInvariant();
        string cmdLine  = (buf.CmdLine ?? string.Empty).ToLowerInvariant();
        string path     = (buf.ProcessPath ?? string.Empty).ToLowerInvariant();

        // 规则 1：危险工具名匹配
        foreach (var tool in dangerousTools)
        {
            if (procName.Contains(tool))
                return $"危险工具检测: {buf.ProcessName}";
        }

        // 规则 2：命令行高危关键词
        string[] dangerousCmdKeywords = [
            "-enc ", "-encodedcommand", "-exec bypass", "-executionpolicy bypass",
            "iex(", "invoke-expression", "downloadstring(", "downloadfile(",
            "certutil -urlcache", "certutil -decode", "bitsadmin /transfer",
            "wmic process call create", "schtasks /create", "sc create",
            "-windowstyle hidden"
        ];

        foreach (var keyword in dangerousCmdKeywords)
        {
            if (cmdLine.Contains(keyword))
                return $"高危命令行特征: {keyword.Trim()}";
        }

        // 规则 3：未签名 + 可疑路径
        if (isSigned == 1) // SIGN_UNSIGNED
        {
            string[] suspiciousPaths = [@"c:\users\", @"c:\programdata\", @"c:\windows\temp\", @"c:\temp\"];
            foreach (var sp in suspiciousPaths)
            {
                if (path.StartsWith(sp))
                {
                    return "未签名程序从可疑目录启动";
                }
            }
        }

        // 规则 4：受信任路径 → 低风险
        string[] trustedPaths = [
            @"c:\windows\system32\", @"c:\windows\syswow64\",
            "c:\\program files\\", "c:\\program files (x86)\\",
            @"c:\windows\winsxs\", @"c:\windows\servicing\"
        ];
        foreach (var tp in trustedPaths)
        {
            if (path.StartsWith(tp))
                return "系统受信任目录";
        }

        // 规则 5：受信任父进程
        string parentName = (buf.ParentProcessName ?? string.Empty).ToLowerInvariant();
        string[] trustedParents = [
            "explorer.exe", "services.exe", "svchost.exe",
            "wininit.exe", "winlogon.exe", "taskmgr.exe"
        ];
        foreach (var tp in trustedParents)
        {
            if (parentName.Contains(tp))
                return $"由受信任进程 {buf.ParentProcessName} 启动";
        }

        return "规则引擎默认判定";
    }
}
