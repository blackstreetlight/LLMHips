/*
 * DriverEntry.c
 *
 * 驱动程序入口与卸载实现。
 *
 * 职责：
 *   DriverEntry  —— 初始化设备对象、符号链接、IRP 分发表
 *   DriverUnload —— 反向清理所有资源，保证安全卸载
 */

#include "DriverEntry.h"
#include "IoctlHandler.h"   // IRP_MJ_DEVICE_CONTROL 分发函数
#include "EventQueue.h"     // 队列初始化 / 清理
#include "ProcessCallback.h"// 回调注销

/* ============================================================
 *  IRP 直通分发（Pass-Through Dispatch）
 *
 *  对于不关心的 IRP 类型（如 IRP_MJ_CREATE、IRP_MJ_CLOSE 等），
 *  统一以 STATUS_SUCCESS 完成，避免上层应用打开设备时失败。
 * ============================================================ */
static NTSTATUS PassThroughDispatch(
    _In_ PDEVICE_OBJECT DeviceObject,
    _In_ PIRP           Irp)
{
    UNREFERENCED_PARAMETER(DeviceObject);

    Irp->IoStatus.Status      = STATUS_SUCCESS;
    Irp->IoStatus.Information = 0;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return STATUS_SUCCESS;
}

/* ============================================================
 *  DriverUnload —— 驱动卸载清理
 *
 *  卸载顺序很重要：
 *    1. 先注销进程回调 —— 防止卸载过程中回调继续向队列写入
 *    2. 再清空事件队列 —— 释放所有未消费的队列节点内存
 *    3. 删除符号链接   —— 用户态不再能打开设备
 *    4. 删除设备对象   —— 释放内核设备资源
 * ============================================================ */
VOID DriverUnload(_In_ PDRIVER_OBJECT DriverObject)
{
    UNICODE_STRING symLink;

    DbgPrint("[SecurityDriver] DriverUnload: 开始卸载驱动...\n");

    /* Step 1：注销进程创建回调，阻止新事件入队 */
    UnregisterProcessCallback();
    DbgPrint("[SecurityDriver] DriverUnload: 进程回调已注销\n");

    /* Step 2：清空事件队列，释放所有节点内存 */
    EventQueueDestroy();
    DbgPrint("[SecurityDriver] DriverUnload: 事件队列已清空\n");

    /* Step 3：删除符号链接（用户态访问路径） */
    RtlInitUnicodeString(&symLink, SYMBOLIC_LINK_NAME);
    IoDeleteSymbolicLink(&symLink);
    DbgPrint("[SecurityDriver] DriverUnload: 符号链接已删除\n");

    /* Step 4：删除设备对象链上的所有设备
     *         一个驱动可能关联多个设备对象，遍历删除 */
    PDEVICE_OBJECT current = DriverObject->DeviceObject;
    while (current != NULL) {
        PDEVICE_OBJECT next = current->NextDevice;
        IoDeleteDevice(current);
        current = next;
    }
    DbgPrint("[SecurityDriver] DriverUnload: 设备对象已删除，驱动卸载完成\n");
}

/* ============================================================
 *  DriverEntry —— 驱动入口
 *
 *  执行顺序：
 *    1. 创建设备对象
 *    2. 设置 DO_BUFFERED_IO 标志（METHOD_BUFFERED IOCTL 需要）
 *    3. 创建用户态符号链接
 *    4. 初始化事件队列（链表 + 自旋锁）
 *    5. 注册 IRP 分发函数
 *    6. 注册进程创建回调
 *    7. 设置卸载例程
 * ============================================================ */
NTSTATUS DriverEntry(
    _In_ PDRIVER_OBJECT  DriverObject,
    _In_ PUNICODE_STRING RegistryPath)
{
    UNREFERENCED_PARAMETER(RegistryPath);

    NTSTATUS       status;
    UNICODE_STRING deviceName;
    UNICODE_STRING symLink;
    PDEVICE_OBJECT deviceObject = NULL;
    ULONG          i;

    DbgPrint("[SecurityDriver] DriverEntry: 驱动开始加载...\n");

    /* --------------------------------------------------------
     *  Step 1：创建设备对象
     *
     *  IoCreateDevice 参数说明：
     *    DriverObject       —— 所属驱动对象
     *    DeviceExtensionSize—— 设备扩展大小，暂不使用，传 0
     *    DeviceName         —— 内核态设备名称
     *    DeviceType         —— FILE_DEVICE_UNKNOWN（自定义设备）
     *    DeviceCharacteristics —— 0（无特殊属性）
     *    Exclusive          —— FALSE（允许多个句柄同时打开）
     *    DeviceObject       —— 输出：创建好的设备对象指针
     * -------------------------------------------------------- */
    RtlInitUnicodeString(&deviceName, DEVICE_NAME);
    status = IoCreateDevice(
        DriverObject,
        0,
        &deviceName,
        FILE_DEVICE_UNKNOWN,
        0,
        FALSE,
        &deviceObject);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] DriverEntry: IoCreateDevice 失败, status=0x%08X\n", status);
        return status;
    }

    /* --------------------------------------------------------
     *  Step 2：设置 DO_BUFFERED_IO 标志
     *
     *  IOCTL 使用 METHOD_BUFFERED 时，I/O 管理器负责在内核缓冲区
     *  与用户缓冲区之间拷贝数据，驱动只需访问 SystemBuffer，
     *  无需手动处理用户态地址映射，更安全。
     * -------------------------------------------------------- */
    deviceObject->Flags |= DO_BUFFERED_IO;

    /* --------------------------------------------------------
     *  Step 3：创建符号链接
     *
     *  用户态程序通过 CreateFile("\\.\SecurityDriver", ...) 访问。
     *  内核符号链接路径为 \??\SecurityDriver。
     * -------------------------------------------------------- */
    RtlInitUnicodeString(&symLink, SYMBOLIC_LINK_NAME);
    status = IoCreateSymbolicLink(&symLink, &deviceName);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] DriverEntry: IoCreateSymbolicLink 失败, status=0x%08X\n", status);
        /* 创建符号链接失败，需删除已创建的设备对象，避免资源泄漏 */
        IoDeleteDevice(deviceObject);
        return status;
    }

    /* --------------------------------------------------------
     *  Step 4：初始化内核事件队列
     *
     *  必须在注册进程回调之前完成，否则回调触发时队列尚未就绪，
     *  会导致写入未初始化的链表，引发系统崩溃（BSOD）。
     * -------------------------------------------------------- */
    EventQueueInit();
    DbgPrint("[SecurityDriver] DriverEntry: 事件队列初始化完成\n");

    /* --------------------------------------------------------
     *  Step 5：注册 IRP 分发函数
     *
     *  先将所有 IRP 类型指向直通函数（PassThroughDispatch），
     *  再单独覆盖需要处理的类型，这样可以确保未处理的 IRP
     *  也能正常完成而不会挂起（hang）。
     * -------------------------------------------------------- */
    for (i = 0; i <= IRP_MJ_MAXIMUM_FUNCTION; i++) {
        DriverObject->MajorFunction[i] = PassThroughDispatch;
    }
    /* IOCTL 由专用处理函数负责 */
    DriverObject->MajorFunction[IRP_MJ_DEVICE_CONTROL] = IoctlDispatch;
    DbgPrint("[SecurityDriver] DriverEntry: IRP 分发函数注册完成\n");

    /* --------------------------------------------------------
     *  Step 6：注册进程创建回调
     *
     *  PsSetCreateProcessNotifyRoutineEx 要求驱动镜像必须设置
     *  IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY 标志（即强制签名）。
     *  测试阶段在 bcdedit /set testsigning on 模式下可绕过。
     * -------------------------------------------------------- */
    status = RegisterProcessCallback();
    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] DriverEntry: 注册进程回调失败, status=0x%08X\n", status);
        /* 回调注册失败：清理队列、符号链接、设备对象后退出 */
        EventQueueDestroy();
        IoDeleteSymbolicLink(&symLink);
        IoDeleteDevice(deviceObject);
        return status;
    }
    DbgPrint("[SecurityDriver] DriverEntry: 进程创建回调注册成功\n");

    /* --------------------------------------------------------
     *  Step 7：注册卸载例程
     *
     *  必须设置 DriverUnload，否则驱动无法被动态卸载（sc stop 失败）。
     * -------------------------------------------------------- */
    DriverObject->DriverUnload = DriverUnload;

    DbgPrint("[SecurityDriver] DriverEntry: 驱动加载成功，设备路径: %ws\n", DEVICE_NAME);
    return STATUS_SUCCESS;
}
