#pragma once
#include<fltKernel.h>

#define EVENT_COUNT 3

extern PKEVENT  __Ring0ProcessEvent[EVENT_COUNT];
extern HANDLE   __Ring3ProcessEvent[EVENT_COUNT];

typedef enum _CONTROL_CODE_
{
	CTL_PROCESS_HIPS_TRANSFER,    //×ªËÍÊÂ¼þ
	CTL_PROCESS_HIPS_REGISTER,   //×¢²á¼à¿Ø
	CTL_PROCESS_HIPS_UNREGISTER, //Ð¶ÔØ¼à¿Ø
	CTL_PROCESS_HIPS_ON,         //¿ªÆô¼à¿Ø
	CTL_PROCESS_HIPS_OFF,        //¹Ø±Õ¼à¿Ø
}CONTROL_CODE, * PCONTROL_CODE;



void DriverUnload(PDRIVER_OBJECT DriverObject);

NTSTATUS PassThroughDispatch(PDEVICE_OBJECT DeviceObject, PIRP Irp);
NTSTATUS ReadThroughDispatch(PDEVICE_OBJECT DeviceObject, PIRP Irp);
NTSTATUS WriteThroughDispatch(PDEVICE_OBJECT DeviceObject, PIRP Irp);