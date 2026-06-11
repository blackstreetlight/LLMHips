// Terminal/TerminalSession.cs
using System.Diagnostics;
using System.Text;

namespace SecurityBridge.Terminal;

/// <summary>
/// 单个终端会话：封装一个 shell 子进程，提供双向 I/O。
///
/// 交互终端模式（interactive）：
///   Start() 后持续将 stdout/stderr 通过 onOutput 回调推送给前端；
///   调用方通过 WriteAsync() 把键盘输入送入 stdin。
///
/// 命令执行模式（batch command）：
///   RunCommandAsync() 单独 spawn 一个子进程执行命令，捕获全部输出后返回。
///   此模式专供 AI 技能调用，不影响交互会话。
/// </summary>
public sealed class TerminalSession : IAsyncDisposable
{
    private readonly Func<string, Task> _onOutput;   // 将数据推给前端的回调
    private readonly ILogger _logger;
    private readonly CancellationTokenSource _cts = new();

    private Process? _shellProcess;
    private Task?    _readTask;

    public bool IsRunning => _shellProcess is { HasExited: false };

    public TerminalSession(Func<string, Task> onOutput, ILogger logger)
    {
        _onOutput = onOutput;
        _logger   = logger;
    }

    // ─── 交互 Shell ───────────────────────────────────────────────

    /// <summary>启动交互 shell，持续将输出推送到 onOutput 回调</summary>
    public void Start()
    {
        var (shell, args) = GetShellInfo();

        _shellProcess = new Process
        {
            StartInfo = new ProcessStartInfo(shell, args)
            {
                RedirectStandardInput  = true,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                UseShellExecute        = false,
                CreateNoWindow         = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding  = Encoding.UTF8,
                // 确保发往 shell stdin 的数据也以 UTF-8 编码
                StandardInputEncoding  = Encoding.UTF8,
            }
        };

        _shellProcess.Start();
        _logger.LogInformation("[Terminal] Shell started: {Shell}, PID={Pid}", shell, _shellProcess.Id);

        // 同时读 stdout + stderr，遇到任何数据立即推给前端
        _readTask = Task.WhenAll(
            ReadStreamAsync(_shellProcess.StandardOutput, _cts.Token),
            ReadStreamAsync(_shellProcess.StandardError,  _cts.Token)
        );
    }

    /// <summary>向 shell stdin 写入数据（前端按键 / 粘贴）</summary>
    public async Task WriteAsync(string data)
    {
        if (_shellProcess is null || !IsRunning) return;
        try
        {
            await _shellProcess.StandardInput.WriteAsync(data);
            await _shellProcess.StandardInput.FlushAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Terminal] Failed to write to shell stdin.");
        }
    }

    private async Task ReadStreamAsync(StreamReader reader, CancellationToken ct)
    {
        var buf = new char[2048];
        while (!ct.IsCancellationRequested)
        {
            int count;
            try
            {
                // ReadAsync 不接受 CancellationToken（StreamReader 限制），用 WaitAsync 包装
                count = await reader.ReadAsync(buf, 0, buf.Length).WaitAsync(ct);
            }
            catch { break; }

            if (count == 0) break; // EOF（shell 退出）

            var chunk = new string(buf, 0, count);
            try { await _onOutput(chunk); }
            catch (Exception ex) { _logger.LogWarning(ex, "[Terminal] onOutput callback failed."); }
        }
    }

    // ─── Batch 命令执行（AI 技能用）──────────────────────────────

    /// <summary>
    /// 执行单条命令并返回完整输出（stdout + stderr 合并），
    /// 与交互 shell 会话无关，独立 spawn 子进程。
    /// </summary>
    public static async Task<(string Output, int ExitCode)> RunCommandAsync(
        string command, int timeoutSeconds = 15)
    {
        // Windows：优先 pwsh.exe（PowerShell Core 7，启动比 5.x 快 3-5 倍）
        //          -NoProfile         : 跳过用户 Profile，节省 3-8 秒冷启动
        //          -NonInteractive    : 禁止弹出交互提示，防止命令挂起
        //          UTF-8 初始化内联  : 确保中文输出不乱码，无需额外轮次
        // Linux/macOS：bash -c "..."
        var (shell, args) = OperatingSystem.IsWindows()
            ? (File.Exists(@"C:\Program Files\PowerShell\7\pwsh.exe")
                   ? @"C:\Program Files\PowerShell\7\pwsh.exe"
                   : "powershell.exe",
               "-NoLogo -NoProfile -NonInteractive -Command \"" +
               "[Console]::OutputEncoding=[Console]::InputEncoding=[System.Text.Encoding]::UTF8;" +
               $"chcp 65001|Out-Null;{EscapeArg(command)}\"")
            : ("/bin/bash", $"-c \"{EscapeArg(command)}\"");

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo(shell, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                UseShellExecute        = false,
                CreateNoWindow         = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding  = Encoding.UTF8,
                StandardInputEncoding  = Encoding.UTF8,
            }
        };

        proc.Start();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));

        var stdoutTask = proc.StandardOutput.ReadToEndAsync(cts.Token);
        var stderrTask = proc.StandardError.ReadToEndAsync(cts.Token);

        try
        {
            await proc.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch { }
            return ($"[超时] 命令执行超过 {timeoutSeconds} 秒被终止", -1);
        }

        string stdout = await stdoutTask;
        string stderr = await stderrTask;
        string output = (stdout + (string.IsNullOrEmpty(stderr) ? "" : "\n[stderr]\n" + stderr)).Trim();
        return (output, proc.ExitCode);
    }

    // ─── 工具方法 ─────────────────────────────────────────────────

    private static (string Shell, string Args) GetShellInfo() =>
        OperatingSystem.IsWindows()
            // -NoExit 保持 shell 存活；-Command 先将控制台切到 UTF-8 (65001)，
            // 再设置 Console I/O Encoding，最后 drop 到交互模式
            ? ("powershell.exe",
               "-NoLogo -NoProfile -NoExit -Command " +
               "\"[Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null\"")
            : ("/bin/bash", "--login");

    private static string EscapeArg(string cmd) =>
        // 转义命令中的双引号，避免参数注入
        cmd.Replace("\"", "\\\"");

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();

        if (_shellProcess is not null && !_shellProcess.HasExited)
        {
            try { _shellProcess.Kill(entireProcessTree: true); } catch { }
        }

        if (_readTask is not null)
        {
            try { await _readTask; } catch { }
        }

        _shellProcess?.Dispose();
        _cts.Dispose();
        _logger.LogInformation("[Terminal] Session disposed.");
    }
}
