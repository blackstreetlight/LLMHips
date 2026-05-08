/*
 * EventQueue.c
 *
 * 内核事件队列实现。
 *
 * 内存布局（每个队列节点）：
 *
 *   ┌─────────────────────────────────────────┐
 *   │  EVENT_QUEUE_ENTRY                      │
 *   │  ┌──────────────┐                       │
 *   │  │  LIST_ENTRY  │  ← 链表前/后向指针      │
 *   │  │  Flink/Blink │                       │
 *   │  └──────────────┘                       │
 *   │  ┌──────────────────────────────────┐   │
 *   │  │  DRIVER_EVENT_BUFFER  EventData  │   │
 *   │  │  (PID, Path, CmdLine, ...)       │   │
 *   │  └──────────────────────────────────┘   │
 *   └─────────────────────────────────────────┘
 *         ↑ NonPagedPoolNx 分配，DISPATCH_LEVEL 可访问
 *
 * 并发模型：
 *   进程回调（生产者）与 IOCTL 调用（消费者）可能在不同线程同时运行，
 *   所有链表操作均在 KeAcquireSpinLock / KeReleaseSpinLock 保护下进行。
 */

#include "EventQueue.h"

/* ============================================================
 *  全局队列变量（定义在此，Common.h 中已 extern 声明）
 * ============================================================ */

LIST_ENTRY  g_EventQueueHead;   /* 双向链表头节点（哨兵节点，不存储数据） */
KSPIN_LOCK  g_EventQueueLock;   /* 自旋锁，保护链表所有操作 */
ULONG       g_EventQueueCount;  /* 当前队列中的节点数量 */

/* 内存池标签，用于调试时追踪内存分配来源
 * 'EvQu' 在 WinDbg 中以小端显示为 'uQvE' */
#define QUEUE_POOL_TAG  'uQvE'

/* ============================================================
 *  EventQueueInit —— 初始化队列
 *
 *  InitializeListHead：将链表头的 Flink 和 Blink 都指向自身，
 *  表示空链表状态（IsListEmpty 检测此状态）。
 *  KeInitializeSpinLock：将自旋锁置为未锁定状态（0）。
 * ============================================================ */
VOID EventQueueInit(VOID)
{
    InitializeListHead(&g_EventQueueHead);
    KeInitializeSpinLock(&g_EventQueueLock);
    g_EventQueueCount = 0;

    DbgPrint("[SecurityDriver] EventQueueInit: 事件队列初始化完成，最大容量=%d\n",
             MAX_QUEUE_SIZE);
}

/* ============================================================
 *  EventQueueDestroy —— 销毁队列，释放所有节点
 *
 *  调用时机：DriverUnload 中，进程回调已注销之后。
 *  逐个摘除链表节点并释放内存，直到链表为空。
 *
 *  注意：此函数运行在 PASSIVE_LEVEL，持锁期间 IRQL 提升到
 *        DISPATCH_LEVEL，因此只能访问 NonPagedPool 内存。
 * ============================================================ */
VOID EventQueueDestroy(VOID)
{
    KIRQL          oldIrql;
    PLIST_ENTRY    entry;
    PEVENT_QUEUE_ENTRY node;
    ULONG          freed = 0;

    KeAcquireSpinLock(&g_EventQueueLock, &oldIrql);

    /* 循环摘除头节点直到链表为空 */
    while (!IsListEmpty(&g_EventQueueHead)) {
        entry = RemoveHeadList(&g_EventQueueHead);
        /* CONTAINING_RECORD：通过成员指针反推结构体起始地址
         * 参数：成员指针、结构体类型、成员名 */
        node = CONTAINING_RECORD(entry, EVENT_QUEUE_ENTRY, ListEntry);
        ExFreePoolWithTag(node, QUEUE_POOL_TAG);
        freed++;
    }

    g_EventQueueCount = 0;

    KeReleaseSpinLock(&g_EventQueueLock, oldIrql);

    DbgPrint("[SecurityDriver] EventQueueDestroy: 已释放 %lu 个队列节点\n", freed);
}

/* ============================================================
 *  EventQueueEnqueue —— 事件入队（生产者）
 *
 *  步骤：
 *    1. 检查队列是否已满（超过 MAX_QUEUE_SIZE）
 *    2. 从 NonPagedPoolNx 分配节点内存
 *       NonPagedPoolNx：非分页、不可执行的内存，满足以下需求：
 *         - 自旋锁持有期间（DISPATCH_LEVEL）必须用非分页内存
 *         - Nx（No-eXecute）防止数据区被当代码执行，安全性更高
 *    3. 将 EventData 拷贝进节点
 *    4. 加锁 → InsertTailList 插入队尾 → 计数器自增 → 解锁
 * ============================================================ */
NTSTATUS EventQueueEnqueue(_In_ PDRIVER_EVENT_BUFFER EventData)
{
    PEVENT_QUEUE_ENTRY  node;
    KIRQL               oldIrql;

    /* Step 1：快速检查队列容量（不加锁，仅做估算；精确检查在锁内进行） */
    if (g_EventQueueCount >= MAX_QUEUE_SIZE) {
        DbgPrint("[SecurityDriver] EventQueueEnqueue: 队列已满（%lu/%d），丢弃事件 PID=%lu\n",
                 g_EventQueueCount, MAX_QUEUE_SIZE, EventData->Pid);
        return STATUS_TOO_MANY_COMMANDS;
    }

    /* Step 2：分配节点内存
     *   ExAllocatePool2 是 Win10 2004 (20H1) 引入的新 API，
     *   替代已废弃的 ExAllocatePoolWithTag，强制要求指定内存属性标志。
     *   POOL_FLAG_NON_PAGED：非分页 + 不可执行（等价于 NonPagedPoolNx）
     *     - 非分页：自旋锁持有期间 IRQL = DISPATCH_LEVEL，必须用非分页内存
     *     - 不可执行（NX）：节点存储的是数据而非代码，不需要执行权限；
     *       使用 EXECUTE 标志反而会降低安全性，给漏洞利用提供可执行内存
     *   返回 NULL 表示内存不足                                          */
    node = (PEVENT_QUEUE_ENTRY)ExAllocatePool2(
        POOL_FLAG_NON_PAGED,            /* NonPagedPoolNx，数据用 NON_PAGED 而非 NON_PAGED_EXECUTE */
        sizeof(EVENT_QUEUE_ENTRY),
        QUEUE_POOL_TAG);

    if (node == NULL) {
        DbgPrint("[SecurityDriver] EventQueueEnqueue: 内存分配失败，PID=%lu\n",
                 EventData->Pid);
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    /* Step 3：拷贝事件数据到节点（深拷贝，回调栈帧释放后数据依然有效） */
    RtlCopyMemory(&node->EventData, EventData, sizeof(DRIVER_EVENT_BUFFER));

    /* Step 4：加锁后操作链表
     *   KeAcquireSpinLock：获取自旋锁，IRQL 提升到 DISPATCH_LEVEL，
     *   旧 IRQL 保存在 oldIrql 中（用于释放时恢复）
     *
     *   精确的队列满检查必须在锁内做，防止并发竞态：
     *   两个线程同时通过锁外检查 → 都分配内存 → 都尝试入队 → 超出上限 */
    KeAcquireSpinLock(&g_EventQueueLock, &oldIrql);

    if (g_EventQueueCount >= MAX_QUEUE_SIZE) {
        /* 并发情况下再次超出上限，释放已分配的节点并退出 */
        KeReleaseSpinLock(&g_EventQueueLock, oldIrql);
        ExFreePoolWithTag(node, QUEUE_POOL_TAG);
        DbgPrint("[SecurityDriver] EventQueueEnqueue: 并发检查：队列已满，丢弃事件 PID=%lu\n",
                 EventData->Pid);
        return STATUS_TOO_MANY_COMMANDS;
    }

    /* 插入链表尾部：InsertTailList 维护 FIFO 顺序
     * 链表头的 Blink 指向尾节点，Flink 指向头（哨兵） */
    InsertTailList(&g_EventQueueHead, &node->ListEntry);
    g_EventQueueCount++;

    KeReleaseSpinLock(&g_EventQueueLock, oldIrql);

    DbgPrint("[SecurityDriver] EventQueueEnqueue: 入队成功，PID=%lu，当前队列长度=%lu\n",
             EventData->Pid, g_EventQueueCount);

    return STATUS_SUCCESS;
}

/* ============================================================
 *  EventQueueDequeue —— 事件出队（消费者）
 *
 *  步骤：
 *    1. 加锁
 *    2. 检查链表是否为空 → 空则返回 STATUS_NO_MORE_ENTRIES
 *    3. RemoveHeadList 摘除头节点
 *    4. 计数器自减
 *    5. 解锁
 *    6. 将节点数据拷贝到调用方缓冲区
 *    7. 释放节点内存
 *
 *  注意：节点内存的释放放在锁外（Step 7），
 *        持锁时间尽量短，降低其他线程的自旋等待时间。
 * ============================================================ */
NTSTATUS EventQueueDequeue(_Out_ PDRIVER_EVENT_BUFFER OutEventData)
{
    KIRQL               oldIrql;
    PLIST_ENTRY         entry;
    PEVENT_QUEUE_ENTRY  node;

    KeAcquireSpinLock(&g_EventQueueLock, &oldIrql);

    /* 检查队列是否为空：IsListEmpty 检查头节点的 Flink 是否指向自身 */
    if (IsListEmpty(&g_EventQueueHead)) {
        KeReleaseSpinLock(&g_EventQueueLock, oldIrql);
        return STATUS_NO_MORE_ENTRIES;
    }

    /* 摘除头节点（最早入队的事件，FIFO 顺序） */
    entry = RemoveHeadList(&g_EventQueueHead);
    g_EventQueueCount--;

    KeReleaseSpinLock(&g_EventQueueLock, oldIrql);

    /* 通过 ListEntry 成员地址反推 EVENT_QUEUE_ENTRY 结构体起始地址 */
    node = CONTAINING_RECORD(entry, EVENT_QUEUE_ENTRY, ListEntry);

    /* 拷贝数据到调用方缓冲区（在锁外进行，避免持锁时做大块内存拷贝） */
    RtlCopyMemory(OutEventData, &node->EventData, sizeof(DRIVER_EVENT_BUFFER));

    /* 释放队列节点内存 */
    ExFreePoolWithTag(node, QUEUE_POOL_TAG);

    DbgPrint("[SecurityDriver] EventQueueDequeue: 出队成功，PID=%lu，剩余队列长度=%lu\n",
             OutEventData->Pid, g_EventQueueCount);

    return STATUS_SUCCESS;
}

/* ============================================================
 *  EventQueueGetCount —— 获取当前队列长度
 *
 *  读取 g_EventQueueCount 不加锁（ULONG 读取在 x86/x64 上是原子的），
 *  仅供调试和监控使用，不保证与链表实际长度严格一致。
 * ============================================================ */
ULONG EventQueueGetCount(VOID)
{
    return g_EventQueueCount;
}
