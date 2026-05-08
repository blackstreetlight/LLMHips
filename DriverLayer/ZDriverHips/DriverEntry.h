/*
 * DriverEntry.h
 *
 * 驱动入口模块声明。
 * 负责：
 *   - 创建设备对象（\Device\SecurityDriver）
 *   - 创建用户态符号链接（\??\SecurityDriver）
 *   - 注册所有 IRP 分发函数
 *   - 驱动卸载清理（DriverUnload）
 */

#pragma once
#include "Common.h"

/*
 * DriverEntry
 * 驱动程序入口点，由 Windows 内核在加载驱动时调用。
 *
 * @param DriverObject   驱动对象指针，代表本驱动在内核中的实例
 * @param RegistryPath   驱动在注册表中的服务键路径（本驱动暂不使用）
 * @return NTSTATUS      STATUS_SUCCESS 表示加载成功，否则驱动将被卸载
 */
NTSTATUS DriverEntry(
    _In_ PDRIVER_OBJECT  DriverObject,
    _In_ PUNICODE_STRING RegistryPath
);

/*
 * DriverUnload
 * 驱动卸载例程，在驱动被卸载时由内核调用。
 * 必须完成以下清理工作，否则会导致内存泄漏或系统不稳定：
 *   1. 注销进程创建回调
 *   2. 清空并释放内核事件队列
 *   3. 删除符号链接
 *   4. 删除设备对象
 *
 * @param DriverObject   驱动对象指针
 */
VOID DriverUnload(
    _In_ PDRIVER_OBJECT DriverObject
);
