/*
 * IoctlHandler.c
 *
 * IOCTL 分发处理实现。
 *
 * 数据流图：
 *
 *   [中间层 SecurityBridge]
 *         |  DeviceIoControl(IOCTL_GET_EVENT)
 *         ↓
 *   IoctlDispatch → HandleGetEvent → EventQueueDequeue → 拷贝到 SystemBuffer → 完成 IRP
 *
 *   [中间层 SecurityBridge]
 *         |  DeviceIoControl(IOCTL_SEND_COMMAND, DRIVER_COMMAND_BUFFER)
 *         ↓
 *   IoctlDispatch → HandleSendCommand → 解析 Action → ZwTerminateProcess / 记录规则
 */

#include "IoctlHandler.h"
#include "EventQueue.h"     // EventQueueDequeue

/* ============================================================
 *  内部辅助：终止指定 PID 的进程
 *
 *  流程：
 *    1. PsLookupProcessByProcessId  —— 通过 PID 找到 EPROCESS 对象（引用计数 +1）
 *    2. ObOpenObjectByPointer       —— 将 EPROCESS 转换为句柄
 *    3. ZwTerminateProcess          —— 发送终止信号（退出码 0）
 *    4. ZwClose                     —— 关闭句柄（引用计数 -1 通过 ObDereferenceObject）
 *    5. ObDereferenceObject         —— 释放步骤 1 的引用
 *
 *  注意：ZwTerminateProcess 是异步的，进程不会在函数返回时立即消失，
 *        但已发出终止信号，进程会在下次被调度时退出。
 * ============================================================ */
static NTSTATUS KillProcessByPid(_In_ ULONG Pid)
{
    NTSTATUS       status;
    PEPROCESS      eProcess    = NULL;
    HANDLE         procHandle  = NULL;

    /* 将 ULONG PID 转为内核使用的 HANDLE 类型 */
    HANDLE pidHandle = ULongToHandle(Pid);

    /* Step 1：通过 PID 查找 EPROCESS（内核进程对象），引用计数 +1 */
    status = PsLookupProcessByProcessId(pidHandle, &eProcess);
    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] KillProcessByPid: PsLookupProcessByProcessId 失败, PID=%lu, status=0x%08X\n",
                 Pid, status);
        return status;
    }

    /* Step 2：将 EPROCESS 指针转换为可操作的内核句柄
     *   OBJ_KERNEL_HANDLE 确保句柄只在内核态有效，防止用户态访问
     *   PROCESS_TERMINATE 权限足够发送终止信号                      */
    status = ObOpenObjectByPointer(
        eProcess,
        OBJ_KERNEL_HANDLE,      /* 内核句柄，用户态不可见 */
        NULL,                   /* 不需要访问状态检查 */
        PROCESS_TERMINATE,      /* 只需要终止权限 */
        *PsProcessType,         /* 对象类型：进程 */
        KernelMode,             /* 调用模式：内核态 */
        &procHandle);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] KillProcessByPid: ObOpenObjectByPointer 失败, PID=%lu, status=0x%08X\n",
                 Pid, status);
        ObDereferenceObject(eProcess);
        return status;
    }

    /* Step 3：发送终止信号，退出码设为 0 */
    status = ZwTerminateProcess(procHandle, 0);
    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] KillProcessByPid: ZwTerminateProcess 失败, PID=%lu, status=0x%08X\n",
                 Pid, status);
    } else {
        DbgPrint("[SecurityDriver] KillProcessByPid: 已终止进程 PID=%lu\n", Pid);
    }

    /* Step 4 & 5：关闭句柄并释放 EPROCESS 引用 */
    ZwClose(procHandle);
    ObDereferenceObject(eProcess);

    return status;
}

/* ============================================================
 *  HandleGetEvent
 *
 *  中间层轮询调用，每次最多取出一个事件。
 *
 *  输出缓冲区校验：
 *    调用方必须提供至少 sizeof(DRIVER_EVENT_BUFFER) 大小的输出缓冲，
 *    否则返回 STATUS_BUFFER_TOO_SMALL，中间层应修正缓冲区大小。
 * ============================================================ */
NTSTATUS HandleGetEvent(_In_ PIRP Irp)
{
    PIO_STACK_LOCATION  ioStack;
    ULONG               outputLength;
    PDRIVER_EVENT_BUFFER outBuffer;
    DRIVER_EVENT_BUFFER  eventData;
    NTSTATUS             status;

    /* 从 IRP 栈获取本次调用的输入/输出缓冲区长度 */
    ioStack      = IoGetCurrentIrpStackLocation(Irp);
    outputLength = ioStack->Parameters.DeviceIoControl.OutputBufferLength;

    /* 校验输出缓冲区大小：必须能容纳一个完整的 DRIVER_EVENT_BUFFER */
    if (outputLength < sizeof(DRIVER_EVENT_BUFFER)) {
        DbgPrint("[SecurityDriver] HandleGetEvent: 输出缓冲区太小, 需要 %zu 字节, 实际 %lu 字节\n",
                 sizeof(DRIVER_EVENT_BUFFER), outputLength);
        Irp->IoStatus.Status      = STATUS_BUFFER_TOO_SMALL;
        Irp->IoStatus.Information = sizeof(DRIVER_EVENT_BUFFER); /* 告知调用方所需大小 */
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_BUFFER_TOO_SMALL;
    }

    /* 尝试从队列头部取出一个事件 */
    status = EventQueueDequeue(&eventData);

    if (status == STATUS_NO_MORE_ENTRIES) {
        /* 队列为空，中间层应继续轮询 */
        Irp->IoStatus.Status      = STATUS_NO_MORE_ENTRIES;
        Irp->IoStatus.Information = 0;
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_NO_MORE_ENTRIES;
    }

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] HandleGetEvent: EventQueueDequeue 失败, status=0x%08X\n", status);
        Irp->IoStatus.Status      = status;
        Irp->IoStatus.Information = 0;
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return status;
    }

    /* METHOD_BUFFERED 模式下，SystemBuffer 同时作为输入和输出缓冲区
     * 将出队的事件数据拷贝到 SystemBuffer，I/O 管理器会自动拷贝回用户空间 */
    outBuffer = (PDRIVER_EVENT_BUFFER)Irp->AssociatedIrp.SystemBuffer;
    RtlCopyMemory(outBuffer, &eventData, sizeof(DRIVER_EVENT_BUFFER));

    DbgPrint("[SecurityDriver] HandleGetEvent: 返回事件, PID=%lu, 进程名=%ws\n",
             eventData.Pid, eventData.ProcessName);

    Irp->IoStatus.Status      = STATUS_SUCCESS;
    Irp->IoStatus.Information = sizeof(DRIVER_EVENT_BUFFER); /* 实际写出的字节数 */
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return STATUS_SUCCESS;
}

/* ============================================================
 *  HandleSendCommand
 *
 *  接收中间层下发的处置指令并执行。
 *
 *  当前支持的 Action：
 *    ACTION_KILL        (0) —— 立即终止目标进程
 *    ACTION_WHITELIST   (1) —— 加入白名单（当前版本仅打印日志，后续可扩展持久化）
 *    ACTION_BLACKLIST   (2) —— 加入黑名单（同上）
 *    ACTION_ALLOW_ONCE  (3) —— 本次放行，不写规则（仅日志确认）
 * ============================================================ */
NTSTATUS HandleSendCommand(_In_ PIRP Irp)
{
    PIO_STACK_LOCATION   ioStack;
    ULONG                inputLength;
    PDRIVER_COMMAND_BUFFER cmdBuffer;
    NTSTATUS             status = STATUS_SUCCESS;

    ioStack     = IoGetCurrentIrpStackLocation(Irp);
    inputLength = ioStack->Parameters.DeviceIoControl.InputBufferLength;

    /* 校验输入缓冲区大小：必须包含完整的 DRIVER_COMMAND_BUFFER */
    if (inputLength < sizeof(DRIVER_COMMAND_BUFFER)) {
        DbgPrint("[SecurityDriver] HandleSendCommand: 输入缓冲区太小, 需要 %zu 字节, 实际 %lu 字节\n",
                 sizeof(DRIVER_COMMAND_BUFFER), inputLength);
        Irp->IoStatus.Status      = STATUS_BUFFER_TOO_SMALL;
        Irp->IoStatus.Information = 0;
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_BUFFER_TOO_SMALL;
    }

    /* METHOD_BUFFERED 模式下，输入数据已由 I/O 管理器拷贝到 SystemBuffer */
    cmdBuffer = (PDRIVER_COMMAND_BUFFER)Irp->AssociatedIrp.SystemBuffer;

    DbgPrint("[SecurityDriver] HandleSendCommand: 收到指令, PID=%lu, Action=%lu\n",
             cmdBuffer->Pid, cmdBuffer->Action);

    switch (cmdBuffer->Action) {

    case ACTION_KILL:
        /* 终止目标进程 */
        status = KillProcessByPid(cmdBuffer->Pid);
        if (!NT_SUCCESS(status)) {
            DbgPrint("[SecurityDriver] HandleSendCommand: 终止进程失败, PID=%lu\n", cmdBuffer->Pid);
        }
        break;

    case ACTION_WHITELIST:
        /* TODO（后续扩展）：将进程路径持久化到白名单规则表
         * 当前版本仅记录日志，回调中将跳过白名单中的进程 */
        DbgPrint("[SecurityDriver] HandleSendCommand: 加入白名单, PID=%lu（后续扩展）\n", cmdBuffer->Pid);
        status = STATUS_SUCCESS;
        break;

    case ACTION_BLACKLIST:
        /* TODO（后续扩展）：将进程路径持久化到黑名单规则表
         * 当前版本仅记录日志，后续进程启动时直接拦截 */
        DbgPrint("[SecurityDriver] HandleSendCommand: 加入黑名单, PID=%lu（后续扩展）\n", cmdBuffer->Pid);
        status = STATUS_SUCCESS;
        break;

    case ACTION_ALLOW_ONCE:
        /* 本次放行，不写规则：进程已在回调中被加入队列，
         * 此时进程已经在运行中（非阻塞架构），本指令仅作确认用途 */
        DbgPrint("[SecurityDriver] HandleSendCommand: 本次放行（不记录规则）, PID=%lu\n", cmdBuffer->Pid);
        status = STATUS_SUCCESS;
        break;

    default:
        DbgPrint("[SecurityDriver] HandleSendCommand: 未知 Action=%lu, PID=%lu\n",
                 cmdBuffer->Action, cmdBuffer->Pid);
        status = STATUS_INVALID_PARAMETER;
        break;
    }

    Irp->IoStatus.Status      = status;
    Irp->IoStatus.Information = 0; /* SEND_COMMAND 无输出数据 */
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return status;
}

/* ============================================================
 *  IoctlDispatch —— IRP_MJ_DEVICE_CONTROL 顶层分发
 *
 *  从 IRP 当前栈位置取出控制码（IoControlCode），
 *  根据控制码路由到对应的处理函数。
 *  未知的控制码返回 STATUS_INVALID_DEVICE_REQUEST，
 *  避免因未处理 IRP 而挂起。
 * ============================================================ */
NTSTATUS IoctlDispatch(
    _In_ PDEVICE_OBJECT DeviceObject,
    _In_ PIRP           Irp)
{
    PIO_STACK_LOCATION ioStack;
    ULONG              ctrlCode;

    UNREFERENCED_PARAMETER(DeviceObject);

    ioStack  = IoGetCurrentIrpStackLocation(Irp);
    ctrlCode = ioStack->Parameters.DeviceIoControl.IoControlCode;

    switch (ctrlCode) {

    case IOCTL_GET_EVENT:
        /* 中间层轮询取事件（无输入，输出 DRIVER_EVENT_BUFFER） */
        return HandleGetEvent(Irp);

    case IOCTL_SEND_COMMAND:
        /* 中间层下发处置指令（输入 DRIVER_COMMAND_BUFFER，无输出） */
        return HandleSendCommand(Irp);

    default:
        /* 未知控制码：直接完成 IRP，不挂起 */
        DbgPrint("[SecurityDriver] IoctlDispatch: 未知控制码 0x%08X\n", ctrlCode);
        Irp->IoStatus.Status      = STATUS_INVALID_DEVICE_REQUEST;
        Irp->IoStatus.Information = 0;
        IoCompleteRequest(Irp, IO_NO_INCREMENT);
        return STATUS_INVALID_DEVICE_REQUEST;
    }
}
