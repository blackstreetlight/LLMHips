/*
 * EventQueue.h
 *
 * 内核事件队列模块声明。
 *
 * 设计说明：
 *   使用双向循环链表（LIST_ENTRY）+ KSPIN_LOCK 自旋锁 实现线程安全的 FIFO 队列。
 *
 *   生产者：ProcessCallback（进程创建回调，PASSIVE_LEVEL）
 *   消费者：IoctlHandler::HandleGetEvent（IOCTL 调用路径，PASSIVE_LEVEL）
 *
 *   自旋锁特性：
 *     - 获取自旋锁时 IRQL 被提升到 DISPATCH_LEVEL，释放后恢复
 *     - 在 DISPATCH_LEVEL 下不能访问分页内存（Paged Pool）
 *     - 因此队列节点使用 NonPagedPool 分配，确保在任意 IRQL 下均可访问
 *
 *   队列上限：MAX_QUEUE_SIZE（256）
 *     - 防止恶意程序短时间内启动大量进程导致内核内存耗尽
 *     - 超出上限时新事件被丢弃并打印警告日志
 */

#pragma once
#include "Common.h"

/*
 * EventQueueInit
 * 初始化队列链表头和自旋锁。
 * 必须在注册进程回调之前调用，否则回调写入时队列未就绪会导致 BSOD。
 */
VOID EventQueueInit(VOID);

/*
 * EventQueueDestroy
 * 清空队列并释放所有节点内存。
 * 在 DriverUnload 中调用，注销回调之后调用，防止清理期间仍有节点写入。
 */
VOID EventQueueDestroy(VOID);

/*
 * EventQueueEnqueue
 * 将一个进程事件压入队列尾部（生产者接口）。
 *
 * @param EventData   指向待入队事件数据的指针，函数内部会拷贝一份到新节点
 * @return NTSTATUS
 *   STATUS_SUCCESS          —— 入队成功
 *   STATUS_INSUFFICIENT_RESOURCES —— 内存分配失败
 *   STATUS_TOO_MANY_COMMANDS      —— 队列已满（超过 MAX_QUEUE_SIZE）
 */
NTSTATUS EventQueueEnqueue(
    _In_ PDRIVER_EVENT_BUFFER EventData
);

/*
 * EventQueueDequeue
 * 从队列头部取出一个事件（消费者接口）。
 *
 * @param OutEventData  输出参数，接收出队的事件数据（调用方负责提供缓冲区）
 * @return NTSTATUS
 *   STATUS_SUCCESS          —— 成功取出一个事件
 *   STATUS_NO_MORE_ENTRIES  —— 队列为空
 */
NTSTATUS EventQueueDequeue(
    _Out_ PDRIVER_EVENT_BUFFER OutEventData
);

/*
 * EventQueueGetCount
 * 获取当前队列中的事件数量（仅供调试/监控使用，读取时不加锁）。
 *
 * @return ULONG  当前队列条目数
 */
ULONG EventQueueGetCount(VOID);
