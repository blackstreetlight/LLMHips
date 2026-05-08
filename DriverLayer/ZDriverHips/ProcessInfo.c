/*
 * ProcessInfo.c
 *
 * 进程信息采集辅助函数实现。
 *
 * IRQL 约束：
 *   所有函数都预期在 PASSIVE_LEVEL 下调用（进程创建回调即在此级别），
 *   内部使用的 Zw* 系列函数均要求 PASSIVE_LEVEL。
 */

#include "ProcessInfo.h"
#include <ntstrsafe.h>   /* RtlStringCchCopyW、RtlStringCchLengthW */

/* 中间缓冲区内存池标签，WinDbg 中显示为 'fniP' */
#define PROCINFO_POOL_TAG  'fniP'

/* ============================================================
 *  PiGetDosPathFromFileObject
 *
 *  IoQueryFileDosDeviceName 会分配一块 OBJECT_NAME_INFORMATION 内存，
 *  其中 Name 字段就是 DOS 路径的 UNICODE_STRING。
 *  拷贝完成后必须用 ExFreePool 释放该内存（注意：不是 ExFreePoolWithTag）。
 * ============================================================ */
BOOLEAN PiGetDosPathFromFileObject(
    _In_  PFILE_OBJECT FileObject,
    _Out_ PWCHAR       PathBuffer,
    _In_  ULONG        PathBufferChars)
{
    POBJECT_NAME_INFORMATION nameInfo = NULL;
    NTSTATUS                 status;
    ULONG                    copyChars;

    /* 防御性检查：FileObject 为空直接返回 */
    if (FileObject == NULL || PathBuffer == NULL || PathBufferChars == 0) {
        return FALSE;
    }

    /* 调用 IoQueryFileDosDeviceName 获取 DOS 路径
     * 函数内部分配内存，成功后 nameInfo 指向一块 OBJECT_NAME_INFORMATION */
    status = IoQueryFileDosDeviceName(FileObject, &nameInfo);
    if (!NT_SUCCESS(status) || nameInfo == NULL) {
        DbgPrint("[SecurityDriver] PiGetDosPathFromFileObject: 转换失败, status=0x%08X\n", status);
        return FALSE;
    }

    /* 计算可拷贝的字符数（不含 NULL），防止目标缓冲区溢出 */
    copyChars = nameInfo->Name.Length / sizeof(WCHAR);
    if (copyChars >= PathBufferChars) {
        copyChars = PathBufferChars - 1; /* 保留 NULL 终止符位置 */
    }

    RtlCopyMemory(PathBuffer, nameInfo->Name.Buffer, copyChars * sizeof(WCHAR));
    PathBuffer[copyChars] = L'\0'; /* 手动补 NULL，因为 UNICODE_STRING 不保证以 NULL 结尾 */

    /* 释放 IoQueryFileDosDeviceName 内部分配的内存 */
    ExFreePool(nameInfo);

    return TRUE;
}

/* ============================================================
 *  PiGetDosPathFromEProcess
 *
 *  用于采集父进程路径。
 *  整体流程与 ProcessHips/ProcessHelper.c 一致，但：
 *    1. 使用 ExAllocatePool2 替代已废弃的 ExAllocatePool
 *    2. 每一步均检查返回值，失败时跳转到统一 cleanup 标签
 *    3. 使用 OBJ_KERNEL_HANDLE 确保句柄只在内核态有效
 * ============================================================ */
BOOLEAN PiGetDosPathFromEProcess(
    _In_  PEPROCESS EProcess,
    _Out_ PWCHAR    PathBuffer,
    _In_  ULONG     PathBufferChars)
{
    NTSTATUS         status;
    HANDLE           processHandle  = NULL; /* 进程句柄 */
    HANDLE           fileHandle     = NULL; /* 文件句柄 */
    PVOID            ntPathBuffer   = NULL; /* ZwQueryInformationProcess 返回的 NT 路径缓冲 */
    ULONG            ntPathLength   = 0;
    PFILE_OBJECT     fileObject     = NULL;
    BOOLEAN          result         = FALSE;

    OBJECT_ATTRIBUTES objAttr;
    IO_STATUS_BLOCK   ioStatusBlock = { 0 };

    if (EProcess == NULL || PathBuffer == NULL || PathBufferChars == 0) {
        return FALSE;
    }

    /* Step 1：将 EPROCESS 转换为内核句柄
     *   PROCESS_QUERY_INFORMATION 权限足以查询进程路径
     *   OBJ_KERNEL_HANDLE 使句柄只在内核态可见，防止用户态访问 */
#define PROCESS_QUERY_INFORMATION_FLAG 0x0400
    status = ObOpenObjectByPointer(
        EProcess,
        OBJ_KERNEL_HANDLE,
        NULL,
        PROCESS_QUERY_INFORMATION_FLAG,
        *PsProcessType,
        KernelMode,
        &processHandle);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] PiGetDosPathFromEProcess: ObOpenObjectByPointer 失败, 0x%08X\n", status);
        goto Cleanup;
    }

    /* Step 2：第一次调用 ZwQueryInformationProcess，获取所需缓冲区大小
     *   传入 NULL 缓冲区 + 长度 0，系统会返回 STATUS_INFO_LENGTH_MISMATCH
     *   并在 ntPathLength 中填入实际需要的字节数 */
    status = ZwQueryInformationProcess(
        processHandle,
        ProcessImageFileName,   /* 查询类型：NT 格式的镜像路径 */
        NULL,
        0,
        &ntPathLength);

    if (status != STATUS_INFO_LENGTH_MISMATCH || ntPathLength == 0) {
        DbgPrint("[SecurityDriver] PiGetDosPathFromEProcess: 获取路径长度失败, 0x%08X\n", status);
        goto Cleanup;
    }

    /* Step 3：分配足够的缓冲区，第二次调用获取实际路径
     *   使用 PagedPool：此函数运行在 PASSIVE_LEVEL，分页内存可用
     *   且路径字符串较大，节省非分页内存 */
    ntPathBuffer = ExAllocatePool2(POOL_FLAG_PAGED, ntPathLength, PROCINFO_POOL_TAG);
    if (ntPathBuffer == NULL) {
        DbgPrint("[SecurityDriver] PiGetDosPathFromEProcess: 内存分配失败\n");
        goto Cleanup;
    }

    status = ZwQueryInformationProcess(
        processHandle,
        ProcessImageFileName,
        ntPathBuffer,
        ntPathLength,
        &ntPathLength);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] PiGetDosPathFromEProcess: ZwQueryInformationProcess 失败, 0x%08X\n", status);
        goto Cleanup;
    }

    /* ntPathBuffer 指向的内容是一个 UNICODE_STRING，其 Buffer 字段是 NT 路径
     * 例如：\Device\HarddiskVolume3\Windows\System32\notepad.exe */

    /* Step 4：以 NT 路径打开文件，获取文件句柄
     *   只需 FILE_READ_ATTRIBUTES 权限，最小权限原则
     *   FILE_SYNCHRONOUS_IO_NONALERT 使 ZwOpenFile 同步执行 */
    InitializeObjectAttributes(
        &objAttr,
        (PUNICODE_STRING)ntPathBuffer,  /* NT 路径 UNICODE_STRING */
        OBJ_CASE_INSENSITIVE | OBJ_KERNEL_HANDLE,
        NULL,
        NULL);

    status = ZwOpenFile(
        &fileHandle,
        FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        &objAttr,
        &ioStatusBlock,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        FILE_SYNCHRONOUS_IO_NONALERT);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] PiGetDosPathFromEProcess: ZwOpenFile 失败, 0x%08X\n", status);
        goto Cleanup;
    }

    /* Step 5：将文件句柄转换为 PFILE_OBJECT
     *   ObReferenceObjectByHandle 会增加 FileObject 的引用计数，
     *   使用完毕后必须调用 ObDereferenceObject 释放 */
    status = ObReferenceObjectByHandle(
        fileHandle,
        FILE_READ_ATTRIBUTES,
        *IoFileObjectType,
        KernelMode,
        (PVOID*)&fileObject,
        NULL);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] PiGetDosPathFromEProcess: ObReferenceObjectByHandle 失败, 0x%08X\n", status);
        goto Cleanup;
    }

    /* Step 6：通过 FileObject 获取 DOS 格式路径 */
    result = PiGetDosPathFromFileObject(fileObject, PathBuffer, PathBufferChars);

Cleanup:
    /* 按获取顺序反向释放所有资源，防止资源泄漏 */
    if (fileObject    != NULL) { ObDereferenceObject(fileObject); }
    if (fileHandle    != NULL) { ZwClose(fileHandle); }
    if (ntPathBuffer  != NULL) { ExFreePoolWithTag(ntPathBuffer, PROCINFO_POOL_TAG); }
    if (processHandle != NULL) { ZwClose(processHandle); }

    return result;
}

/* ============================================================
 *  PiExtractNameFromPath
 *
 *  在路径字符串中从后向前搜索最后一个反斜杠 L'\\'，
 *  取其后的部分作为文件名。
 *  若路径中没有反斜杠（非正常情况），则将整个字符串作为文件名。
 * ============================================================ */
VOID PiExtractNameFromPath(
    _In_  PCWSTR FullPath,
    _Out_ PWCHAR NameBuffer,
    _In_  ULONG  NameBufferChars)
{
    PCWSTR  cursor;
    PCWSTR  lastSlash = NULL;
    size_t  pathLen   = 0;

    if (FullPath == NULL || NameBuffer == NULL || NameBufferChars == 0) {
        return;
    }

    /* 先确认路径字符串合法，获取长度（RtlStringCchLengthW 有上限检查） */
    if (!NT_SUCCESS(RtlStringCchLengthW(FullPath, SD_MAX_PATH * 2, &pathLen)) || pathLen == 0) {
        NameBuffer[0] = L'\0';
        return;
    }

    /* 从后向前线性扫描，找最后一个反斜杠 */
    cursor = FullPath + pathLen - 1;
    while (cursor >= FullPath) {
        if (*cursor == L'\\') {
            lastSlash = cursor;
            break;
        }
        cursor--;
    }

    /* 拷贝文件名部分到目标缓冲区 */
    if (lastSlash != NULL && *(lastSlash + 1) != L'\0') {
        RtlStringCchCopyW(NameBuffer, NameBufferChars, lastSlash + 1);
    } else {
        /* 路径中没有反斜杠，整个字符串就是文件名 */
        RtlStringCchCopyW(NameBuffer, NameBufferChars, FullPath);
    }
}

/* ============================================================
 *  PiGetFileCreationTime
 *
 *  ZwQueryInformationFile(FileBasicInformation) 返回文件的时间属性：
 *    CreationTime / LastAccessTime / LastWriteTime / ChangeTime
 *  我们只需要 CreationTime。
 *
 *  注意：必须先将 PFILE_OBJECT 转为 HANDLE，才能传给 ZwQueryInformationFile。
 * ============================================================ */
BOOLEAN PiGetFileCreationTime(
    _In_  PFILE_OBJECT   FileObject,
    _Out_ PLARGE_INTEGER CreationTime)
{
    NTSTATUS            status;
    HANDLE              fileHandle  = NULL;
    FILE_BASIC_INFORMATION basicInfo = { 0 };
    IO_STATUS_BLOCK     ioStatus    = { 0 };
    BOOLEAN             result      = FALSE;

    if (FileObject == NULL || CreationTime == NULL) {
        return FALSE;
    }

    /* 将 PFILE_OBJECT 转换为内核句柄
     *   OBJ_KERNEL_HANDLE：只在内核态有效
     *   FILE_READ_ATTRIBUTES：查询基本属性所需的最小权限 */
    status = ObOpenObjectByPointer(
        FileObject,
        OBJ_KERNEL_HANDLE,
        NULL,
        FILE_READ_ATTRIBUTES,
        *IoFileObjectType,
        KernelMode,
        &fileHandle);

    if (!NT_SUCCESS(status)) {
        DbgPrint("[SecurityDriver] PiGetFileCreationTime: ObOpenObjectByPointer 失败, 0x%08X\n", status);
        return FALSE;
    }

    /* 查询文件基本信息（包含 4 个时间字段）
     *   FileBasicInformation 返回 FILE_BASIC_INFORMATION 结构 */
    status = ZwQueryInformationFile(
        fileHandle,
        &ioStatus,
        &basicInfo,
        sizeof(FILE_BASIC_INFORMATION),
        FileBasicInformation);

    if (NT_SUCCESS(status)) {
        CreationTime->QuadPart = basicInfo.CreationTime.QuadPart;
        result = TRUE;
        DbgPrint("[SecurityDriver] PiGetFileCreationTime: 文件创建时间获取成功\n");
    } else {
        DbgPrint("[SecurityDriver] PiGetFileCreationTime: ZwQueryInformationFile 失败, 0x%08X\n", status);
    }

    ZwClose(fileHandle);
    return result;
}
