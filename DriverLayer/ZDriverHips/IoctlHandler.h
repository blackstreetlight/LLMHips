/*
 * IoctlHandler.h
 *
 * IOCTL 分发模块声明。
 *
 * 职责：
 *   处理 IRP_MJ_DEVICE_CONTROL，根据控制码分发到对应处理函数：
 *     IOCTL_GET_EVENT    —— 从内核队列取出一个进程事件，返回给中间层
 *     IOCTL_SEND_COMMAND —— 接收中间层决策指令，执行 kill / 白名单 / 黑名单等操作
 *
 * 通信方式：METHOD_BUFFERED（双向缓冲由 I/O 管理器自动拷贝）
 *   - 输入数据来自：Irp->AssociatedIrp.SystemBuffer
 *   - 输出数据写入：Irp->AssociatedIrp.SystemBuffer（同一块缓冲区）
 *   - 实际输出长度设置到：Irp->IoStatus.Information
 */

#pragma once
#include "Common.h"

#define PROCESS_TERMINATE 0x0001

/*
 * IoctlDispatch
 * IRP_MJ_DEVICE_CONTROL 的顶层分发函数，在 DriverEntry 中注册。
 * 负责从 IRP 栈中读取控制码，派发到具体的处理函数。
 *
 * @param DeviceObject  设备对象（本驱动只有一个，通常不使用）
 * @param Irp           当前 I/O 请求包
 * @return NTSTATUS     操作结果状态码
 */
NTSTATUS IoctlDispatch(
    _In_ PDEVICE_OBJECT DeviceObject,
    _In_ PIRP           Irp
);

/*
 * HandleGetEvent
 * 处理 IOCTL_GET_EVENT：
 *   从内核事件队列头部取出一个 EVENT_QUEUE_ENTRY，
 *   将其中的 DRIVER_EVENT_BUFFER 拷贝到输出缓冲区，
 *   释放队列节点内存。
 *   若队列为空则返回 STATUS_NO_MORE_ENTRIES。
 *
 * @param Irp   当前 I/O 请求包
 * @return NTSTATUS
 */
NTSTATUS HandleGetEvent(
    _In_ PIRP Irp
);

/*
 * HandleSendCommand
 * 处理 IOCTL_SEND_COMMAND：
 *   从输入缓冲区解析 DRIVER_COMMAND_BUFFER，
 *   根据 Action 字段执行对应操作（kill / 白名单 / 黑名单 / 本次放行）。
 *
 * @param Irp   当前 I/O 请求包
 * @return NTSTATUS
 */
NTSTATUS HandleSendCommand(
    _In_ PIRP Irp
);
