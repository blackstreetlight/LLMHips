#pragma once
#include <fltKernel.h>


extern BOOLEAN __IsProcessHipsOn;
extern PUNICODE_STRING  __ProcessFullPath;
//进程回调通知
NTSTATUS RegisterProcessNotify();
VOID  ProcessNotifyProcedure(
	PEPROCESS  EProcess, HANDLE  ProcessIdentify, PPS_CREATE_NOTIFY_INFO  CreateInfo);
NTSTATUS UnregisterProcessNotify();