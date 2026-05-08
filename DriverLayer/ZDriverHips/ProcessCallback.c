/*
 * ProcessCallback.c
 *
 * 进程创建回调实现。
 *
 * 信息采集来源优先级：
 *
 *   字段              来源（优先 → 降级）
 *   ──────────────────────────────────────────────────────────
 *   ProcessPath       CreateInfo->FileObject → IoQueryFileDosDeviceName  (最快，直接用)
 *                     → 若 FileObject 为 NULL，则取 CreateInfo->ImageFileName NT 路径
 *   ProcessName       从 ProcessPath 截取最后一段（\后面的部分）
 *   CommandLine       CreateInfo->CommandLine（Win8+）→ 若为 NULL 则置空
 *   ParentPid         CreateInfo->ParentProcessId（句柄值即 PID）
 *   ParentProcessPath PsLookupProcessByProcessId → PiGetDosPathFromEProcess
 *   ParentProcessName 从 ParentProcessPath 截取
 *   FileCreateTime    CreateInfo->FileObject → PiGetFileCreationTime
 *   Timestamp         KeQuerySystemTime（事件入队时刻）
 *   IsSigned          固定 SIGN_UNKNOWN（内核态签名验证复杂，交由用户态处理）
 *   RiskLevel         RuleEngine::EvaluateRiskLevel（规则引擎预判）
 *   Status            固定 STATUS_WATCHING（等待中间层决策）
 */

#include "ProcessCallback.h"
#include "ProcessInfo.h"    /* Pi* 辅助函数 */
#include "EventQueue.h"     /* EventQueueEnqueue */
#include "RuleEngine.h"     /* EvaluateRiskLevel（Step 5 实现） */
#include <ntstrsafe.h>      /* RtlStringCchCopyW */

/* 回调是否已注册的状态标志，保护多次注册/注销 */
static BOOLEAN g_CallbackRegistered = FALSE;

/* ============================================================
 *  ProcessNotifyCallback —— 进程创建/销毁通知回调
 *
 *  系统在以下两种情况下调用此函数：
 *    CreateInfo != NULL → 进程正在创建（我们关心的）
 *    CreateInfo == NULL → 进程正在退出（我们忽略）
 *
 *  IRQL：PASSIVE_LEVEL（可调用大多数 Zw* 函数）
 *  注意：回调执行期间目标进程尚未完全初始化，但路径/命令行已确定
 *
 *  关键：函数末尾直接 return，不等待任何事件，保证不阻塞系统
 * ============================================================ */
static VOID ProcessNotifyCallback(
    _In_ PEPROCESS              Process,
    _In_ HANDLE                 ProcessId,
    _In_opt_ PPS_CREATE_NOTIFY_INFO CreateInfo)
{
    DRIVER_EVENT_BUFFER eventData   = { 0 };
    PEPROCESS           parentEProc = NULL;
    NTSTATUS            status;

    /* ---- 进程退出事件 ---- */
    if (CreateInfo == NULL) {
        /* 进程正在退出：只记录 PID + 时间戳，其余字段置零即可
         * 注意：退出回调中目标进程可能已释放部分资源，不要查询路径/命令行 */
        DRIVER_EVENT_BUFFER exitEvent = { 0 };
        exitEvent.EventType = EVENT_TYPE_EXIT;
        exitEvent.Pid       = HandleToUlong(ProcessId);
        KeQuerySystemTime(&exitEvent.Timestamp);

        NTSTATUS exitStatus = EventQueueEnqueue(&exitEvent);
        if (!NT_SUCCESS(exitStatus)) {
            DbgPrint("[SecurityDriver] ProcessNotifyCallback: 退出事件入队失败, PID=%lu, status=0x%08X\n",
                     exitEvent.Pid, exitStatus);
        } else {
            DbgPrint("[SecurityDriver] ProcessNotifyCallback: 进程退出, PID=%lu\n", exitEvent.Pid);
        }
        return;
    }

    DbgPrint("[SecurityDriver] ProcessNotifyCallback: 检测到新进程, PID=%lu\n",
             HandleToUlong(ProcessId));

    /* ---- 事件类型：进程创建 ---- */
    eventData.EventType = EVENT_TYPE_CREATE;

    /* --------------------------------------------------------
     *  字段 1 & 2：PID 和父进程 PID
     *    ProcessId 参数类型是 HANDLE，其值就是 PID
     *    HandleToUlong：将 HANDLE（指针大小）安全转换为 ULONG
     * -------------------------------------------------------- */
    eventData.Pid       = HandleToUlong(ProcessId);
    eventData.ParentPid = HandleToUlong(CreateInfo->ParentProcessId);

    /* --------------------------------------------------------
     *  字段 3 & 4：进程完整路径 和 进程名
     *
     *  优先使用 CreateInfo->FileObject：
     *    - FileOpenNameAvailable 标志为 1 且 FileObject 不为 NULL 时可用
     *    - 直接调用 IoQueryFileDosDeviceName，无需打开文件，效率最高
     *
     *  降级方案：使用 CreateInfo->ImageFileName（NT 格式路径）
     *    - 注意：此路径是 \Device\HarddiskVolume3\... 格式，不是 C:\...
     *    - 仅作为最后手段，中间层需自行处理 NT 路径格式
     * -------------------------------------------------------- */
    if (CreateInfo->FileOpenNameAvailable && CreateInfo->FileObject != NULL) {
        /* 优先路径：FileObject → DOS 路径 */
        if (!PiGetDosPathFromFileObject(
                CreateInfo->FileObject,
                eventData.ProcessPath,
                SD_MAX_PATH)) {

            DbgPrint("[SecurityDriver] ProcessNotifyCallback: FileObject 转 DOS 路径失败，"
                     "尝试使用 ImageFileName\n");

            /* 降级：使用 NT 格式的 ImageFileName */
            if (CreateInfo->ImageFileName != NULL &&
                CreateInfo->ImageFileName->Length > 0) {
                ULONG copyChars = CreateInfo->ImageFileName->Length / sizeof(WCHAR);
                if (copyChars >= SD_MAX_PATH) copyChars = SD_MAX_PATH - 1;
                RtlCopyMemory(eventData.ProcessPath,
                              CreateInfo->ImageFileName->Buffer,
                              copyChars * sizeof(WCHAR));
                eventData.ProcessPath[copyChars] = L'\0';
            }
        }
    } else if (CreateInfo->ImageFileName != NULL &&
               CreateInfo->ImageFileName->Length > 0) {
        /* FileObject 不可用，直接用 ImageFileName（NT 格式） */
        ULONG copyChars = CreateInfo->ImageFileName->Length / sizeof(WCHAR);
        if (copyChars >= SD_MAX_PATH) copyChars = SD_MAX_PATH - 1;
        RtlCopyMemory(eventData.ProcessPath,
                      CreateInfo->ImageFileName->Buffer,
                      copyChars * sizeof(WCHAR));
        eventData.ProcessPath[copyChars] = L'\0';
    }

    /* 从路径提取文件名（截取最后一个 \ 后的部分） */
    PiExtractNameFromPath(eventData.ProcessPath,
                          eventData.ProcessName,
                          SD_MAX_PATH);

    /* --------------------------------------------------------
     *  字段 5：命令行参数
     *
     *  CreateInfo->CommandLine 在 Windows 8+ 上可用，可能为 NULL。
     *  命令行是判断恶意行为的关键特征，例如：
     *    powershell.exe -enc <base64>  → 混淆执行
     *    cmd.exe /c del /f /q ...      → 文件删除
     * -------------------------------------------------------- */
    if (CreateInfo->CommandLine != NULL &&
        CreateInfo->CommandLine->Length > 0) {
        ULONG copyChars = CreateInfo->CommandLine->Length / sizeof(WCHAR);
        if (copyChars >= SD_MAX_CMDLINE) copyChars = SD_MAX_CMDLINE - 1;
        RtlCopyMemory(eventData.CommandLine,
                      CreateInfo->CommandLine->Buffer,
                      copyChars * sizeof(WCHAR));
        eventData.CommandLine[copyChars] = L'\0';
    }

    /* --------------------------------------------------------
     *  字段 6 & 7：父进程路径 和 父进程名
     *
     *  PsLookupProcessByProcessId：通过 PID 获取 EPROCESS，引用计数 +1。
     *  必须在使用完后调用 ObDereferenceObject 释放。
     *
     *  父进程路径用于检测异常父子关系，例如：
     *    word.exe 创建 cmd.exe     → 宏病毒
     *    explorer.exe 创建 powershell.exe → 可疑脚本
     * -------------------------------------------------------- */
    status = PsLookupProcessByProcessId(
        CreateInfo->ParentProcessId,
        &parentEProc);

    if (NT_SUCCESS(status) && parentEProc != NULL) {
        if (PiGetDosPathFromEProcess(
                parentEProc,
                eventData.ParentProcessPath,
                SD_MAX_PATH)) {
            PiExtractNameFromPath(eventData.ParentProcessPath,
                                  eventData.ParentProcessName,
                                  SD_MAX_PATH);
        } else {
            DbgPrint("[SecurityDriver] ProcessNotifyCallback: 获取父进程路径失败, ParentPID=%lu\n",
                     eventData.ParentPid);
        }
        /* 释放 PsLookupProcessByProcessId 增加的引用计数 */
        ObDereferenceObject(parentEProc);
        parentEProc = NULL;
    } else {
        DbgPrint("[SecurityDriver] ProcessNotifyCallback: PsLookupProcessByProcessId 失败, "
                 "ParentPID=%lu, status=0x%08X\n", eventData.ParentPid, status);
    }

    /* --------------------------------------------------------
     *  字段 8：可执行文件创建时间
     *
     *  使用 CreateInfo->FileObject（若可用）直接查询，避免重复打开文件。
     *  刚创建的 exe（几秒/分钟内）启动 → 高度可疑。
     * -------------------------------------------------------- */
    if (CreateInfo->FileObject != NULL) {
        if (!PiGetFileCreationTime(CreateInfo->FileObject,
                                   &eventData.FileCreateTime)) {
            eventData.FileCreateTime.QuadPart = 0; /* 查询失败则置 0 */
        }
    }

    /* --------------------------------------------------------
     *  字段 9：签名状态
     *
     *  内核态签名验证需要使用 CI.dll 非公开导出函数（CiValidateFileObject 等），
     *  在不同 Windows 版本上偏移量不稳定，风险较高。
     *  当前版本统一置为 SIGN_UNKNOWN，由中间层在用户态通过
     *  WinVerifyTrust / Get-AuthenticodeSignature 等方式验证。
     * -------------------------------------------------------- */
    eventData.IsSigned = SIGN_UNKNOWN;

    /* --------------------------------------------------------
     *  字段 10：事件时间戳
     *
     *  KeQuerySystemTime 返回 UTC 时间（FILETIME 格式，100 纳秒间隔）
     *  与 FILETIME 格式相同，中间层可直接用 DateTime.FromFileTimeUtc 转换
     * -------------------------------------------------------- */
    KeQuerySystemTime(&eventData.Timestamp);

    /* --------------------------------------------------------
     *  字段 11：事件处置状态（初始为"待观察"）
     * -------------------------------------------------------- */
    eventData.Status = STATUS_WATCHING;

    /* --------------------------------------------------------
     *  字段 12：风险等级预判（规则引擎，Step 5 实现）
     *
     *  EvaluateRiskLevel 根据路径、父进程名、进程名等做简单规则匹配，
     *  返回 RISK_LOW / RISK_MEDIUM / RISK_HIGH，供 LLM 参考。
     * -------------------------------------------------------- */
    eventData.RiskLevel = EvaluateRiskLevel(&eventData);

    /* --------------------------------------------------------
     *  入队：将事件写入内核队列，立即返回
     *
     *  此处是与 ProcessHips 最核心的区别：
     *    ProcessHips：KeWaitForMultipleObjects → 阻塞等待用户决策
     *    本驱动：  EventQueueEnqueue → 立即返回，由 IOCTL 轮询异步决策
     * -------------------------------------------------------- */
    status = EventQueueEnqueue(&eventData);
    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] ProcessNotifyCallback: 入队失败, PID=%lu, status=0x%08X\n",
                 eventData.Pid, status);
    }

    /* 回调结束，不修改 CreateInfo->CreationStatus，进程正常创建
     * 拦截由后续 IOCTL_SEND_COMMAND(ACTION_KILL) 完成 */
}

/* ============================================================
 *  RegisterProcessCallback
 * ============================================================ */
NTSTATUS RegisterProcessCallback(VOID)
{
    NTSTATUS status;

    /* 防止重复注册 */
    if (g_CallbackRegistered) {
        DbgPrint("[SecurityDriver] RegisterProcessCallback: 回调已注册，跳过\n");
        return STATUS_SUCCESS;
    }

    /* PsSetCreateProcessNotifyRoutineEx 第二个参数：
     *   FALSE → 注册回调
     *   TRUE  → 注销回调（见 UnregisterProcessCallback）
     *
     * 要求：驱动镜像必须有 IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY 标志。
     * 测试阶段：bcdedit /set testsigning on 后可绕过签名要求。 */
    status = PsSetCreateProcessNotifyRoutineEx(
        (PCREATE_PROCESS_NOTIFY_ROUTINE_EX)ProcessNotifyCallback,
        FALSE);

    if (NT_SUCCESS(status)) {
        g_CallbackRegistered = TRUE;
        DbgPrint("[SecurityDriver] RegisterProcessCallback: 进程创建回调注册成功\n");
    } else {
        DbgPrint("[SecurityDriver] RegisterProcessCallback: 注册失败, status=0x%08X\n"
                 "  提示：请确认驱动已签名或系统处于测试签名模式\n", status);
    }

    return status;
}

/* ============================================================
 *  UnregisterProcessCallback
 * ============================================================ */
VOID UnregisterProcessCallback(VOID)
{
    if (!g_CallbackRegistered) {
        DbgPrint("[SecurityDriver] UnregisterProcessCallback: 回调未注册，跳过\n");
        return;
    }

    /* 传入 TRUE 表示注销 */
    PsSetCreateProcessNotifyRoutineEx(
        (PCREATE_PROCESS_NOTIFY_ROUTINE_EX)ProcessNotifyCallback,
        TRUE);

    g_CallbackRegistered = FALSE;
    DbgPrint("[SecurityDriver] UnregisterProcessCallback: 进程创建回调已注销\n");
}
