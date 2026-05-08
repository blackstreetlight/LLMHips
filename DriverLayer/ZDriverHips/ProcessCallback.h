/*
 * ProcessCallback.h
 *
 * 进程创建回调模块声明。
 *
 * 核心设计原则（区别于 ProcessHips）：
 *   【非阻塞】回调触发后仅采集信息并写入队列，立即返回。
 *   不在回调中等待用户决策（无 KeWaitForMultipleObjects），
 *   因此不会因 LLM 研判延迟而卡死系统进程创建。
 *
 * 决策执行：
 *   中间层通过 IOCTL_SEND_COMMAND 下发决策后，
 *   由 IoctlHandler::HandleSendCommand 调用 ZwTerminateProcess 执行拦截。
 */

#pragma once
#include "Common.h"

/*
 * RegisterProcessCallback
 * 注册进程创建/销毁通知回调。
 * 使用 PsSetCreateProcessNotifyRoutineEx（Win Vista+），
 * 相比旧版 PsSetCreateProcessNotifyRoutine 提供更丰富的 CreateInfo 信息。
 *
 * 注意：驱动镜像需具备签名属性（测试模式下可绕过）。
 *
 * @return STATUS_SUCCESS           注册成功
 *         STATUS_ACCESS_DENIED     镜像签名不满足要求
 *         其他 NTSTATUS            系统错误
 */
NTSTATUS RegisterProcessCallback(VOID);

/*
 * UnregisterProcessCallback
 * 注销进程创建回调。
 * 必须在 DriverUnload 中、清空事件队列之前调用，
 * 确保注销完成后不再有新事件写入队列。
 */
VOID UnregisterProcessCallback(VOID);
