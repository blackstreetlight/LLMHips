// Driver/MockDriverClient.cs
using SecurityBridge.Models;

namespace SecurityBridge.Driver;

/// <summary>
/// Mock 驱动客户端，用于 macOS / 无驱动开发环境。
/// 模拟驱动随机上报进程事件，供前端联调和演示使用。
/// 跨平台编译，不包含任何 Windows P/Invoke 调用。
/// </summary>
public class MockDriverClient : IDriverClient
{
    private readonly ILogger<MockDriverClient> _logger;
    private readonly Random _rng = new();
    private bool _connected;

    // 追踪已上报的 PID，用于随机模拟进程退出
    private readonly List<int> _alivePids = new();

    // ── Mock 数据随机池 ───────────────────────────────────────────────────────

    /// <summary>进程名 + 对应路径 + 典型命令行（模拟真实场景）</summary>
    private static readonly (string Name, string Path, string CmdLine)[] MockProcesses =
    [
        ("svchost.exe",         @"C:\Windows\System32\svchost.exe",                   "-k netsvcs -p"),
        ("unknown_miner.exe",   @"C:\Users\Admin\AppData\Local\Temp\unknown_miner.exe", "--algo=ethash --pool=stratum+tcp://pool.evil.com:3333"),
        ("cmd.exe",             @"C:\Windows\System32\cmd.exe",                       @"/c whoami"),
        ("powershell.exe",      @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", "-ExecutionPolicy Bypass -NoProfile -File C:\\payload.ps1"),
        ("mimikatz.exe",        @"C:\Users\Admin\Desktop\mimikatz.exe",               "privilege::debug sekurlsa::logonpasswords"),
        ("notepad.exe",         @"C:\Windows\System32\notepad.exe",                   @"C:\Users\Admin\notes.txt"),
        ("calc.exe",            @"C:\Windows\System32\calc.exe",                      ""),
        ("explorer.exe",        @"C:\Windows\explorer.exe",                           ""),
        ("taskmgr.exe",         @"C:\Windows\System32\Taskmgr.exe",                   "/4"),
        ("services.exe",        @"C:\Windows\System32\services.exe",                  ""),
        ("winlogon.exe",        @"C:\Windows\System32\winlogon.exe",                  ""),
        ("frpc.exe",            @"C:\ProgramData\frpc\frpc.exe",                      "-c frpc.ini"),
        ("LDF.exe",             @"C:\Program Files\LDF\LDF.exe",                      ""),
    ];

    /// <summary>父进程模拟数据</summary>
    private static readonly (string Name, string Path)[] MockParents =
    [
        ("explorer.exe",  @"C:\Windows\explorer.exe"),
        ("services.exe",  @"C:\Windows\System32\services.exe"),
        ("svchost.exe",   @"C:\Windows\System32\svchost.exe"),
        ("cmd.exe",       @"C:\Windows\System32\cmd.exe"),
        ("powershell.exe", @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
    ];

    private static readonly string[] Rules =
    [
        "危险工具检测: mimikatz.exe",
        "高危命令行特征: -executionpolicy bypass",
        "未签名程序从可疑目录启动",
        "系统受信任目录",
        "由受信任进程 explorer.exe 启动",
        "规则引擎默认判定"
    ];

    public bool IsConnected => _connected;

    public MockDriverClient(ILogger<MockDriverClient> logger)
    {
        _logger = logger;
    }

    public Task<bool> ConnectAsync()
    {
        _connected = true;
        _logger.LogInformation("[MOCK] Driver connected in simulation mode.");
        return Task.FromResult(true);
    }

    public Task<ProcessEvent?> PollEventAsync()
    {
        // 30% 概率上报一条事件，70% 概率返回 null（模拟驱动队列空闲）
        if (_rng.NextDouble() > 0.30)
            return Task.FromResult<ProcessEvent?>(null);

        // 15% 概率上报进程退出事件（仅当存在已记录的活跃 PID 时）
        if (_alivePids.Count > 0 && _rng.NextDouble() < 0.15)
        {
            int idx    = _rng.Next(_alivePids.Count);
            int exitPid = _alivePids[idx];
            _alivePids.RemoveAt(idx);

            return Task.FromResult<ProcessEvent?>(new ProcessEvent
            {
                Id        = Guid.NewGuid().ToString(),
                EventType = "exit",
                Pid       = exitPid,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });
        }

        // 按真实概率分布生成风险等级：60% low / 25% medium / 15% high
        string riskLevel = PickRiskLevel();

        // 高风险进程默认处于 blocked 状态，其余处于 watching 状态
        string status = riskLevel == "high" ? "blocked" : "watching";

        // 随机选取进程和父进程
        var proc   = MockProcesses[_rng.Next(MockProcesses.Length)];
        var parent = MockParents[_rng.Next(MockParents.Length)];

        // 签名状态模拟：系统目录下的进程已签名，其余未知或未签名
        int isSigned = proc.Path.StartsWith(@"C:\Windows\", StringComparison.OrdinalIgnoreCase) ? 2 : // SIGN_SIGNED
                       proc.Path.StartsWith(@"C:\Program Files", StringComparison.OrdinalIgnoreCase) ? 2 :
                       _rng.NextDouble() < 0.5 ? 1 : 0; // 50% 未签名 / 50% 未知

        int newPid = _rng.Next(1000, 65535);

        // 60% 概率从已存活的进程里选父进程 → 形成真实父子链，可在进程树上展示连线
        // 40% 概率使用固定系统 PID（模拟从 explorer / svchost 启动，显示为根节点）
        int parentPid;
        if (_alivePids.Count > 0 && _rng.NextDouble() < 0.60)
        {
            parentPid = _alivePids[_rng.Next(_alivePids.Count)];
        }
        else
        {
            // 固定几个"系统根进程" PID，让前端可以看到多棵子树汇聚到同一根
            int[] systemPids = [4, 604, 728, 952]; // System / smss / winlogon / services
            parentPid = systemPids[_rng.Next(systemPids.Length)];
        }

        var evt = new ProcessEvent
        {
            Id                = Guid.NewGuid().ToString(),
            EventType         = "create",
            Pid               = newPid,
            ParentPid         = parentPid,
            ProcessName       = proc.Name,
            ProcessPath       = proc.Path,
            CmdLine           = proc.CmdLine,
            ParentProcessName = parent.Name,
            ParentProcessPath = parent.Path,
            IsSigned          = isSigned,
            RuleTriggered     = Rules[_rng.Next(Rules.Length)],
            RiskLevel         = riskLevel,
            Status            = status,
            FileCreateTime    = DateTimeOffset.UtcNow.AddDays(-_rng.Next(1, 365)).ToUnixTimeMilliseconds(),
            Timestamp         = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        // 记录活跃 PID，供后续退出事件随机选取
        _alivePids.Add(newPid);
        if (_alivePids.Count > 100) _alivePids.RemoveAt(0); // 防止无限增长

        return Task.FromResult<ProcessEvent?>(evt);
    }

    public Task<bool> SendCommandAsync(DriverCommand cmd)
    {
        // Mock 模式仅记录日志，模拟指令已发送给驱动
        _logger.LogInformation(
            "[MOCK] Command received — Action={Action} PID={Pid} Reason={Reason}",
            cmd.Action, cmd.Pid, cmd.Reason ?? "(none)");
        return Task.FromResult(true);
    }

    public Task DisconnectAsync()
    {
        _connected = false;
        _logger.LogInformation("[MOCK] Driver disconnected.");
        return Task.CompletedTask;
    }

    // ── 私有辅助方法 ──────────────────────────────────────────────────────────

    /// <summary>
    /// 按概率分布随机选取风险等级。
    /// 分布参考真实场景：大多数告警为低风险，高风险告警较少见。
    /// </summary>
    private string PickRiskLevel()
    {
        double roll = _rng.NextDouble();
        return roll switch
        {
            < 0.60 => "low",
            < 0.85 => "medium", // 0.60~0.85 = 25%
            _      => "high"    // 0.85~1.00 = 15%
        };
    }
}
