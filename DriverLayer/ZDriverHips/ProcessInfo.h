/*
 * ProcessInfo.h
 *
 * 进程信息采集辅助模块声明。
 *
 * 本模块封装所有"从内核对象查询路径/时间"的底层操作，
 * 供 ProcessCallback.c 在回调中调用，保持回调函数逻辑清晰。
 *
 * 函数命名前缀 Pi（ProcessInfo）用于区分模块归属。
 */

#pragma once
#include "Common.h"

NTSTATUS ZwQueryInformationProcess(HANDLE ProcessHandle,
    PROCESSINFOCLASS ProcessInformationClass, PVOID ProcessInformation, ULONG ProcessInformationLength,
    PULONG ReturnLength);

/*
 * PiGetDosPathFromFileObject
 * 通过文件对象（PFILE_OBJECT）获取可读的 DOS 格式路径（如 C:\Windows\...）。
 *
 * 原理：调用 IoQueryFileDosDeviceName，内部将 NT 设备路径
 *       （\Device\HarddiskVolume3\...）转换为 DOS 驱动器字母路径。
 *
 * 注意：IoQueryFileDosDeviceName 分配的内存由本函数负责释放，
 *       调用方只需提供目标缓冲区，无需关心中间内存。
 *
 * @param FileObject      文件对象指针（来自 CreateInfo->FileObject）
 * @param PathBuffer      接收路径的宽字符缓冲区
 * @param PathBufferChars 缓冲区大小（以 WCHAR 为单位，含 NULL 终止符）
 * @return BOOLEAN        TRUE=成功，FALSE=失败（FileObject 为 NULL 或转换失败）
 */
BOOLEAN PiGetDosPathFromFileObject(
    _In_  PFILE_OBJECT FileObject,
    _Out_ PWCHAR       PathBuffer,
    _In_  ULONG        PathBufferChars
);

/*
 * PiGetDosPathFromEProcess
 * 通过 EPROCESS 对象获取 DOS 格式路径。
 * 用于采集父进程路径（父进程无法直接提供 FileObject）。
 *
 * 流程：
 *   EPROCESS → ObOpenObjectByPointer（获取句柄）
 *   → ZwQueryInformationProcess（获取 NT 格式路径）
 *   → ZwOpenFile（打开文件获取 FileHandle）
 *   → ObReferenceObjectByHandle（FileHandle → FileObject）
 *   → IoQueryFileDosDeviceName（NT 路径 → DOS 路径）
 *
 * @param EProcess        目标进程的内核对象指针
 * @param PathBuffer      接收路径的宽字符缓冲区
 * @param PathBufferChars 缓冲区大小（以 WCHAR 为单位）
 * @return BOOLEAN        TRUE=成功
 */
BOOLEAN PiGetDosPathFromEProcess(
    _In_  PEPROCESS EProcess,
    _Out_ PWCHAR    PathBuffer,
    _In_  ULONG     PathBufferChars
);

/*
 * PiExtractNameFromPath
 * 从完整路径中截取文件名部分。
 * 例如：L"C:\Windows\System32\notepad.exe" → L"notepad.exe"
 *
 * @param FullPath        完整路径字符串（以 NULL 结尾）
 * @param NameBuffer      接收文件名的缓冲区
 * @param NameBufferChars 缓冲区大小（以 WCHAR 为单位）
 */
VOID PiExtractNameFromPath(
    _In_  PCWSTR FullPath,
    _Out_ PWCHAR NameBuffer,
    _In_  ULONG  NameBufferChars
);

/*
 * PiGetFileCreationTime
 * 通过文件对象查询可执行文件的创建时间。
 *
 * 文件创建时间是判断威胁的重要特征：
 *   - 刚创建的 .exe（几秒/几分钟内）启动 → 高度可疑
 *   - 系统文件通常创建时间与系统安装时间接近
 *
 * 原理：ObOpenObjectByPointer(FileObject) → ZwQueryInformationFile(FileBasicInformation)
 *
 * @param FileObject      文件对象指针
 * @param CreationTime    输出：文件创建时间（UTC，100 纳秒间隔的 FILETIME 格式）
 * @return BOOLEAN        TRUE=成功
 */
BOOLEAN PiGetFileCreationTime(
    _In_  PFILE_OBJECT  FileObject,
    _Out_ PLARGE_INTEGER CreationTime
);
