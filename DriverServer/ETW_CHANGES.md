# ETW 遥测扩展 — 变更记录

> 变更日期：2026-05-15  
> 影响范围：`DriverServer/SecurityBridge`（C# 中间层）

---

## 一、改动总览

| 文件 | 类型 | 说明 |
|------|------|------|
| `SecurityBridge.csproj` | 修改 | 新增 NuGet 依赖 |
| `Models/EtwEvent.cs` | 新增 | ETW 事件数据模型 |
| `ETW/EtwFilterConfig.cs` | 新增 | 静态威胁过滤规则库 |
| `ETW/EtwMonitor.cs` | 新增 | ETW 会话管理核心类 |
| `Worker.cs` | 修改 | 集成 EtwMonitor，PID 联动管理 |
| `Program.cs` | 修改 | DI 注册 EtwMonitor |
| `appsettings.json` | 修改 | 新增 ETW 配置段 |

---

## 二、各文件详细说明

### 1. `SecurityBridge.csproj` — 新增 NuGet 依赖

```xml
<PackageReference Include="Microsoft.Diagnostics.Tracing.TraceEvent" Version="3.1.7" />
```

**作用**：提供 `TraceEventSession`、`KernelTraceEventParser` 等核心 ETW API，
是与 Windows 内核 ETW 总线通信的唯一入口。

---

### 2. `Models/EtwEvent.cs` — ETW 事件数据模型

```csharp
public class EtwEvent {
    public string Id              // GUID，前端列表 key
    public long   Timestamp       // Unix 毫秒时间戳
    public int    Pid             // 触发进程 PID
    public string ProcessName     // 进程名（不含路径）
    public string Category        // "File" | "Registry" | "Network"
    public string Action          // 具体动作（见下）
    public string Target          // 文件路径 / 注册表键 / IP:Port
    public string Severity        // "high" | "medium" | "low"
    public string RuleDescription // 命中的规则文字描述
}
```

**Action 枚举**：

| Category | Action 取值 |
|----------|-------------|
| File | `Create` `Write` `Delete` |
| Registry | `CreateKey` `SetValue` `DeleteKey` |
| Network | `Connect` `UdpSend` |

---

### 3. `ETW/EtwFilterConfig.cs` — 静态威胁过滤规则库

**设计思路**：规则分三类，每类返回 `(severity, ruleDescription)?`，
`null` 表示不关心该事件，直接丢弃（避免洪泛）。

#### 文件规则
| 风险等级 | 触发条件 |
|----------|----------|
| `high` | 写入启动目录（`\Startup\`）、驱动目录（`\System32\drivers\`）、组策略目录 |
| `high` | 在 Temp / Public 目录释放可执行文件（`.exe` `.dll` `.sys` `.ps1` `.bat` 等） |
| `medium` | 在 Temp / Public / ProgramData 目录写任意文件 |

#### 注册表规则
| 风险等级 | 触发条件 |
|----------|----------|
| `high` | `Run` / `RunOnce` 自启动键写入 |
| `high` | `HKLM\SYSTEM\...\Services\` 服务注册 |
| `high` | `AppInit_DLLs` / `Image File Execution Options` 劫持键 |
| `high` | `Winlogon` 劫持、`Defender` 策略修改、`HKCU COM` 劫持 |
| `medium` | Shell Folders 重定向、用户环境变量、`BootExecute` |

#### 网络规则
| 风险等级 | 触发端口 |
|----------|----------|
| `high` | 4444 / 1234 / 31337 / 8888 / 9999 / 6666 / 6667 / 1337 / 65535（已知 C2 / 反弹 Shell）|
| `medium` | 9050 / 9051（Tor）、3389（RDP）、5985 / 5986（WinRM）、445（SMB）、135（DCOM）、23（Telnet）|

---

### 4. `ETW/EtwMonitor.cs` — ETW 会话管理核心类

**核心职责**：
- 创建并管理命名 ETW 实时会话（`TraceEventSession`）
- 启用内核 Provider：`FileIOInit | FileIO | Registry | NetworkTCPIP`
- 订阅 9 个事件回调：文件 Create/Write/Delete，注册表 Create/SetValue/Delete，TCP Connect (IPv4/IPv6) / UDP Send
- 通过 `_trackedPids`（ConcurrentDictionary）做 **PID 白名单门控**，只处理驱动层已上报的可疑进程事件

**关键设计决策**：

```
内核 ETW 事件  →  IsTracked(pid)?  →  EtwFilterConfig.Classify()?  →  BroadcastAsync()
                    ↓否                     ↓null
                   丢弃                    丢弃
```

1. **两级过滤**：先过 PID 白名单，再过规则库，双重拦截防止事件洪泛。
2. **跨平台安全**：`RuntimeInformation.IsOSPlatform(OSPlatform.Windows)` 运行时检测，
   macOS/Linux 直接返回，不影响开发调试。
3. **优雅停止**：`ct.Register(() => session.Stop())` 让 `session.Source.Process()` 的阻塞自然退出。
4. **FireAndForget**：ETW 回调是同步的，异步广播通过 `ContinueWith` 不阻塞事件分发线程。
5. **残留会话清理**：启动时调用 `TraceEventSession.GetActiveSession(name)?.Stop()` 
   清理上次异常退出留下的同名会话。

---

### 5. `Worker.cs` — 集成 EtwMonitor

**改动点**：

```csharp
// 构造函数新增注入
private readonly EtwMonitor _etwMonitor;

// ExecuteAsync 中新增：启动 ETW 后台任务
_ = _etwMonitor.StartAsync(stoppingToken);

// 处理 process_event 时：将 PID 加入 ETW 追踪
_etwMonitor.TrackPid(evt.Pid);

// 处理 process_exit 时：从 ETW 追踪中移除（防 PID 复用误报）
_etwMonitor.UntrackPid(evt.Pid);
```

**联动逻辑图**：

```
驱动上报 process_event(pid=1234)
        ↓
Worker → EtwMonitor.TrackPid(1234)   ← 开启 ETW 追踪
        ↓
ETW 发现 PID=1234 向 4444 端口建立 TCP 连接
        ↓
EtwFilterConfig 判定 severity=high
        ↓
WebSocket 推送 etw_event → 前端告警

驱动上报 process_exit(pid=1234)
        ↓
Worker → EtwMonitor.UntrackPid(1234) ← 停止追踪，防 PID 复用
```

---

### 6. `Program.cs` — DI 注册

```csharp
builder.Services.AddSingleton<EtwMonitor>();
```

EtwMonitor 注册为单例（Singleton），与 Worker 同生命周期，
由 DI 容器自动注入 WebSocketConnectionManager、ILogger、IConfiguration。

---

### 7. `appsettings.json` — ETW 配置段

```json
"ETW": {
  "Enabled": true,
  "SessionName": "SecurityBridgeETW"
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `Enabled` | `true` | 总开关，`false` 完全跳过 ETW 初始化 |
| `SessionName` | `"SecurityBridgeETW"` | ETW 会话名，全局唯一 |

---

## 三、前端 WebSocket 消息格式

ETW 事件通过 WebSocket 推送，`Type = "etw_event"`：

```json
{
  "type": "etw_event",
  "payload": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "timestamp": 1747291200000,
    "pid": 1234,
    "processName": "malware.exe",
    "category": "Registry",
    "action": "SetValue",
    "target": "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\\Malware",
    "severity": "high",
    "ruleDescription": "HKLM Run 自启动写入"
  }
}
```

前端处理建议：
- `severity === "high"` → 弹出告警气泡，高亮对应进程行
- `severity === "medium"` → 在进程详情面板追加行为日志
- `severity === "low"` → 仅写入内部日志，不打扰用户

---

## 四、部署要求

| 条件 | 说明 |
|------|------|
| **操作系统** | Windows（ETW 是 Windows 专有机制） |
| **运行权限** | **管理员（Administrator）** |
| **框架** | .NET 10.0 |
| **NuGet** | `Microsoft.Diagnostics.Tracing.TraceEvent 3.1.7` |

> macOS / Linux 开发时 ETW 代码自动跳过，不影响编译和 Mock 模式调试。

---

## 五、NuGet 包安装指南（Windows）

见下方独立章节 → [如何在 Windows 上安装 NuGet 包](#nuget-install)

---

<a name="nuget-install"></a>
## 六、Windows 上安装 NuGet 包

### 方法一：dotnet CLI（推荐，最简单）

在 `DriverServer/SecurityBridge/` 目录下执行：

```cmd
dotnet add package Microsoft.Diagnostics.Tracing.TraceEvent --version 3.1.7
```

执行后 `SecurityBridge.csproj` 会自动写入 `<PackageReference>`，
下次 `dotnet build` 或 `dotnet run` 时自动从 NuGet.org 下载。

> **已经在 csproj 里写好了**，所以你只需要在 Windows 机器上执行 `dotnet restore` 即可。

### 方法二：Visual Studio NuGet 包管理器

1. 右键项目 → **管理 NuGet 程序包**
2. 搜索 `Microsoft.Diagnostics.Tracing.TraceEvent`
3. 选择版本 `3.1.7` → 点击**安装**

### 方法三：手动 dotnet restore

如果 csproj 里已有 `<PackageReference>`，直接还原即可：

```cmd
dotnet restore
```

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 网络超时 / 访问 nuget.org 失败 | 配置国内镜像：`dotnet nuget add source https://nuget.cdn.azure.cn/v3/index.json` |
| 需要代理 | `set HTTPS_PROXY=http://proxy:8080` 后再执行 |
| 权限不足 | 以管理员身份打开命令提示符 |
| 离线环境 | 将包文件（`.nupkg`）下载到本地，用 `dotnet nuget add source <本地路径>` |

---

## 七、验证 ETW 是否正常工作

在 Windows 管理员命令行启动服务后，观察日志：

```
[ETW] 会话已启动，正在监控文件/注册表/网络事件（当前追踪 PID 数: 0）
```

表示 ETW 会话创建成功。当有可疑进程被驱动上报后，会出现：

```
[ETW] [HIGH] Registry/SetValue PID=1234(malware.exe) → HKLM\...\Run\Malware | HKLM Run 自启动写入
```

如果出现以下日志，说明权限不足：

```
[ETW] 权限不足，ETW 需要以管理员身份运行。
```

解决：以管理员身份重新启动服务即可。
