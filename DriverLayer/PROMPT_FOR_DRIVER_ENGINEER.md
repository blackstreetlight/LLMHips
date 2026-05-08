# 驱动工程师提示词

你是一名 Windows 内核驱动工程师，你的任务是为一个安全防护系统开发 **Windows 内核驱动程序**。

## 一、项目背景

这是一个主机入侵防御系统（HIPS），整体架构三层：

```
驱动层 (你负责)  ←IOCTL→  中间层 (SecurityBridge, C#)  ←WebSocket→  前端控制台 (React)
```

- 进程启动时，驱动拦截并采集信息（此时进程还未真正运行）
- 中间层通过 IOCTL 轮询驱动获取事件，通过 WebSocket 推送给前端
- 前端展示事件信息，交由 LLM 自动研判或用户手动决策（放行/拦截）
- 中间层将决策通过 IOCTL 回传驱动执行

## 二、参考项目：ProcessHips

在 `../ProcessHips/` 目录下有一个完整的 HIPS 参考实现，**请先完整阅读并理解它**，这是你开发新驱动的基础。

### 核心文件及作用

| 文件 | 作用 |
|------|------|
| `ProcessHips/DriverEntry.h/c` | 驱动入口，创建设备对象和符号链接（`\Device\911Kernel`、`\\??\\911Kernel`） |
| `ProcessHips/CallBack.h/c` | **最核心**。用 `PsSetCreateProcessNotifyRoutineEx` 注册进程创建回调，在回调中采集进程路径，通过事件对象同步等待 Ring3 决策，设置 `CreateInfo->CreationStatus` 来放行或拦截 |
| `ProcessHips/MajorFunction.h/c` | IRP 分发函数，处理 ReadFile/WriteFile 请求，实现控制码分发（注册/注销回调、传递事件句柄、开关 HIPS） |
| `ProcessHips/ProcessHelper.h/c` | 通过 EPROCESS 获取进程完整路径（`ObOpenObjectByPointer` → `ZwQueryInformationProcess` → `IoQueryFileDosDeviceName`） |
| `ProcessHips/ObjectHelper.h/c` | 将 Ring3 事件句柄转为 Ring0 内核事件对象（`ObReferenceObjectByHandle`） |

### ProcessHips 的工作流程

1. Ring3 通过 `WriteFile` 传递 3 个事件句柄给驱动
2. Ring3 通过 `WriteFile` 发送控制码注册进程回调
3. 进程创建时回调触发 → 采集进程路径 → 设置 Event[0] 通知 Ring3
4. Ring3 收到通知 → 通过 `ReadFile` 读取进程路径 → 弹窗让用户决策
5. 用户点击放行设置 Event[1]，点击拦截设置 Event[2]
6. 驱动在回调中 `KeWaitForMultipleObjects` 等待 Event[1] 或 Event[2]，据此放行或拦截

### ProcessHips 的问题（你需要改进的）

1. **回调中阻塞等待**：`KeWaitForMultipleObjects` 在回调中等 Ring3 决策，如果决策慢（LLM 需要几秒），整个系统进程创建都会卡死
2. **信息太少**：只采集了进程路径和 PID，对 LLM 研判来说信息不够
3. **通信方式不匹配**：ProcessHips 用事件对象同步通信，但中间层 SecurityBridge 用的是 IOCTL 轮询模式

## 三、你要开发的新驱动

### 设计原则

- **不在回调中阻塞**：采集信息后写入内核队列立即返回，不等待决策
- **信息尽量丰富**：在 `PsSetCreateProcessNotifyRoutineEx` 回调中尽可能多地采集合法可获取的进程信息
- **IOCTL 通信**：通过 IOCTL 与 SecurityBridge 中间层对接，而非事件对象

### 架构设计

```
进程创建回调 (PsSetCreateProcessNotifyRoutineEx)
    ↓
采集信息 → 写入内核环形队列/链表（SpinLock 保护）
    ↓ （立即返回，不阻塞）

SecurityBridge 轮询:
    IOCTL_GET_EVENT → 从队列取出一个事件返回
    IOCTL_SEND_COMMAND → 接收前端决策，执行 kill（ZwTerminateProcess）
```

### 需要采集的进程信息

在回调中尽量采集以下信息（都是合法的，不需要 hook）：

| 字段 | 获取方式 | 说明 |
|------|----------|------|
| PID | `CreateInfo->CreatingThreadId.UniqueProcess` 或回调参数 | 新进程的 PID |
| 进程名 | 从路径截取 | 可执行文件名 |
| 完整路径 | `CreateInfo->ImageFileName`（Win10+）或 `ZwQueryInformationProcess` | 进程完整路径 |
| 命令行 | `CreateInfo->CommandLine`（Win10+，`PsSetCreateProcessNotifyRoutineEx` 的 `CreateInfo` 中） | **重要**，很多恶意行为体现在命令行参数中 |
| 父进程 PID | `CreateInfo->ParentProcessId` | 父进程 ID |
| 父进程路径 | 通过父进程 PID → `PsLookupProcessByProcessId` → 获取 EPROCESS → 查路径 | 异常父子关系是关键特征 |
| 文件创建时间 | `ZwQueryInformationFile(FileBasicInformation)` | 刚创建的 exe 更可疑 |
| 是否签名 | 可考虑在用户态验证，或使用 `CI.dll` 的导出函数（非官方） | 未签名进程风险更高 |

**注意**：`CreateInfo->CommandLine` 和 `CreateInfo->ImageFileName` 是 Windows 10+ 才有的，项目目标平台就是 Win10+，请放心使用。

### IOCTL 协议

需要与 SecurityBridge 中间层对接，设备名和 IOCTL 码需要两边一致。

**设备名**：`\\Device\\SecurityDriver`，符号链接：`\\??\\SecurityDriver`（用户态访问 `\\.\SecurityDriver`）

**IOCTL 定义**：
```c
#define DEVICE_TYPE_SECURITY 0x8000
#define IOCTL_GET_EVENT    CTL_CODE(DEVICE_TYPE_SECURITY, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_SEND_COMMAND CTL_CODE(DEVICE_TYPE_SECURITY, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)
```

**IOCTL_GET_EVENT 输出缓冲区（驱动 → 中间层）**：
```c
typedef struct _DRIVER_EVENT_BUFFER {
    ULONG Pid;
    ULONG ParentPid;
    WCHAR ProcessName[260];
    WCHAR ProcessPath[260];
    WCHAR CommandLine[1024];
    WCHAR ParentProcessName[260];
    WCHAR ParentProcessPath[260];
    ULONG IsSigned;               // 0=未知, 1=未签名, 2=已签名
    ULONG RiskLevel;              // 0=low, 1=medium, 2=high（驱动层预判）
    ULONG Status;                 // 0=已放行, 1=watching, 2=已拦截
    LARGE_INTEGER FileCreateTime; // 可执行文件创建时间
    LARGE_INTEGER Timestamp;      // 事件时间戳
} DRIVER_EVENT_BUFFER, *PDRIVER_EVENT_BUFFER;
```

**IOCTL_SEND_COMMAND 输入缓冲区（中间层 → 驱动）**：
```c
typedef struct _DRIVER_COMMAND_BUFFER {
    ULONG Pid;
    ULONG Action;    // 0=kill, 1=whitelist, 2=blacklist, 3=allow_once
} DRIVER_COMMAND_BUFFER, *PDRIVER_COMMAND_BUFFER;
```

当 `Action=0 (kill)` 时，驱动需要通过 `PsLookupProcessByProcessId` + `ZwTerminateProcess` 终止目标进程。

### 驱动层简单预判（RiskLevel 字段）

驱动端可以做一些简单的规则预判来填充 `RiskLevel`：
- 父进程是 `explorer.exe` / `services.exe` 等系统进程 → low
- 路径在 `C:\Windows\System32\` 下 → low
- 未签名 + 路径在临时目录或用户目录 → high
- 进程名包含已知危险工具名（如 `mimikatz`、`psexec` 等）→ high
- 其余 → medium

这只是辅助，最终判断由 LLM 在前端完成。

### 内核队列设计建议

```c
typedef struct _EVENT_QUEUE_ENTRY {
    LIST_ENTRY ListEntry;
    DRIVER_EVENT_BUFFER EventData;
} EVENT_QUEUE_ENTRY, *PEVENT_QUEUE_ENTRY;

// 全局变量
LIST_ENTRY g_EventQueueHead;     // 链表头
KSPIN_LOCK g_EventQueueLock;     // 自旋锁
ULONG g_EventQueueCount;         // 当前队列长度
#define MAX_QUEUE_SIZE 256       // 防止内存溢出
```

回调中：分配 `EVENT_QUEUE_ENTRY`，填充数据，`InsertTailList` 入队。
IOCTL_GET_EVENT 中：`RemoveHeadList` 出队，拷贝到用户缓冲区，释放内存。

### 项目结构建议

```
DriverLayer/
├── SecurityDriver.inf          # 驱动安装文件
├── SecurityDriver.vcxproj      # VS 项目文件
├── DriverEntry.h/c             # 驱动入口、设备创建、IRP 分发注册
├── ProcessCallback.h/c         # 进程创建回调、信息采集
├── IoctlHandler.h/c            # IOCTL 处理（GET_EVENT / SEND_COMMAND）
├── EventQueue.h/c              # 内核事件队列（链表 + 自旋锁）
├── ProcessInfo.h/c             # 进程信息采集辅助函数
├── RuleEngine.h/c              # 简单规则预判引擎
└── Common.h                    # 公共定义（IOCTL 码、数据结构、常量）
```

### 编译环境

- 使用 WDK (Windows Driver Kit) 编译
- 驱动类型：WDM 或 KMDF 均可（参考项目用的 WDM）
- 目标平台：Windows 10 x64
- 需要在 Windows 环境下用 Visual Studio + WDK 编译

## 四、注意事项

1. **IRQL 问题**：`PsSetCreateProcessNotifyRoutineEx` 回调在 PASSIVE_LEVEL 执行，可以调用大部分 Zw 系列函数，但注意 SpinLock 操作会提升到 DISPATCH_LEVEL
2. **内存管理**：内核中用 `ExAllocatePool2` (Win10 2004+) 或 `ExAllocatePoolWithTag` 分配内存，务必释放
3. **字符串安全**：使用 `RtlStringCchCopyW` / `RtlStringCchCatW` 等安全字符串函数，避免缓冲区溢出
4. **卸载清理**：`DriverUnload` 中必须注销回调、清空队列释放内存、删除设备和符号链接
5. **错误处理**：内核中任何 NTSTATUS 返回值都要检查，失败要有降级逻辑而非崩溃
6. **测试安全**：建议在虚拟机中测试，蓝屏（BSOD）是正常的调试过程

## 五、开发顺序建议

1. 先搭骨架：DriverEntry、设备创建、符号链接、DriverUnload
2. 实现 IOCTL 分发框架（IRP_MJ_DEVICE_CONTROL）
3. 实现事件队列（链表 + 锁）
4. 注册进程回调，先只采集 PID + 路径，验证 IOCTL_GET_EVENT 能取到数据
5. 逐步扩展采集信息（命令行、父进程、签名等）
6. 实现 IOCTL_SEND_COMMAND（kill 进程）
7. 添加简单规则引擎预判
8. 与 SecurityBridge 联调（将 `UseMockDriver` 设为 `false`）
