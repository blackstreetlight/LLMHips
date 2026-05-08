#pragma once
#include <fltKernel.h>

#define DEVICE_NAME         L"\\Device\\SecurityDriver"
#define SYMBOLIC_LINK_NAME  L"\\??\\SecurityDriver"

#define DEVICE_TYPE_SECURITY    0x8000

#define IOCTL_GET_EVENT    CTL_CODE(DEVICE_TYPE_SECURITY, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_SEND_COMMAND CTL_CODE(DEVICE_TYPE_SECURITY, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)

#define SD_MAX_PATH         260
#define SD_MAX_CMDLINE      1024
#define MAX_QUEUE_SIZE      256

#define SIGN_UNKNOWN        0   // δ���
#define SIGN_UNSIGNED       1   // δǩ��
#define SIGN_SIGNED         2   // ��ǩ��

#define RISK_LOW            0   // �ͷ��գ�ϵͳĿ¼�����Ÿ����̵ȣ�
#define RISK_MEDIUM         1   // �з��գ�Ĭ��ֵ��
#define RISK_HIGH           2   // �߷��գ�δǩ�� + ��ʱĿ¼����֪Σ�չ������ȣ�

#define STATUS_WATCHING     1   // �����ߣ�����ӣ���δ������
#define STATUS_ALLOWED      0   // �ѷ���
#define STATUS_BLOCKED      2   // ������

#define ACTION_KILL         0   // ��ֹ���̣�ZwTerminateProcess��
#define ACTION_WHITELIST    1   // ��������������汾��¼��������չ��
#define ACTION_BLACKLIST    2   // ��������������汾��¼��������չ��
#define ACTION_ALLOW_ONCE   3   // ���η��У�����¼����

// ---- 事件类型（EventType 字段） ----
#define EVENT_TYPE_CREATE   0   // 进程创建事件（CreateInfo != NULL）
#define EVENT_TYPE_EXIT     1   // 进程退出事件（CreateInfo == NULL）

typedef struct _DRIVER_EVENT_BUFFER {
    ULONG           EventType;                      // 事件类型：EVENT_TYPE_*（首字段，便于 C# 侧快速判断）
    ULONG           Pid;                            // �½��� PID
    ULONG           ParentPid;                      // ������ PID

    WCHAR           ProcessName[SD_MAX_PATH];       // ��ִ���ļ�������·����ȡ��
    WCHAR           ProcessPath[SD_MAX_PATH];       // ��ִ���ļ�����·����DOS ��ʽ��
    WCHAR           CommandLine[SD_MAX_CMDLINE];    // ���������в���

    WCHAR           ParentProcessName[SD_MAX_PATH]; // �����̿�ִ���ļ���
    WCHAR           ParentProcessPath[SD_MAX_PATH]; // ����������·����DOS ��ʽ��

    ULONG           IsSigned;               // ǩ��״̬��SIGN_*
    ULONG           RiskLevel;              // ���յȼ���RISK_*���������������Ԥ�У�
    ULONG           Status;                 // �¼�״̬��STATUS_*

    LARGE_INTEGER   FileCreateTime;         // ��ִ���ļ�����ʱ�䣨UTC��FILETIME ��ʽ��
    LARGE_INTEGER   Timestamp;              // �¼�����ʱ�����KeQuerySystemTime��
} DRIVER_EVENT_BUFFER, * PDRIVER_EVENT_BUFFER;

typedef struct _DRIVER_COMMAND_BUFFER {
    ULONG   Pid;        // Ŀ����� PID
    ULONG   Action;     // �������ͣ�ACTION_*
} DRIVER_COMMAND_BUFFER, * PDRIVER_COMMAND_BUFFER;

typedef struct _EVENT_QUEUE_ENTRY {
    LIST_ENTRY          ListEntry;  // �����ڵ㣬�����ǽṹ���һ����Ա������ CONTAINING_RECORD ���ʣ�
    DRIVER_EVENT_BUFFER EventData;  // ʵ���¼�����
} EVENT_QUEUE_ENTRY, * PEVENT_QUEUE_ENTRY;

extern LIST_ENTRY   g_EventQueueHead;   // ˫������ͷ�ڵ�
extern KSPIN_LOCK   g_EventQueueLock;   // ������������������������
extern ULONG        g_EventQueueCount;  // ��ǰ������Ŀ��������������