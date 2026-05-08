#include "MajorFunction.h"
#include"DriverEntry.h"
#include"CallBack.h"
#include"ObjectHelper.h"
#include"ProcessHelper.h"


//用于ProcessHips
PKEVENT  __Ring0ProcessEvent[EVENT_COUNT] = { 0 };
HANDLE   __Ring3ProcessEvent[EVENT_COUNT] = { 0 };



void DriverUnload(PDRIVER_OBJECT DriverObject)
{
	UNICODE_STRING  SymbolicLink;
	PDEVICE_OBJECT	v1 = NULL;
	PDEVICE_OBJECT  DeviceObject = NULL;

	//销毁设备连接名
	RtlInitUnicodeString(&SymbolicLink, SYMBOLIC_LINK);
	IoDeleteSymbolicLink(&SymbolicLink);


	UnregisterProcessNotify();
	DeviceObject = DriverObject->DeviceObject;
	while (DeviceObject != NULL)
	{
		v1 = DeviceObject->NextDevice;
		IoDeleteDevice(DeviceObject);
		DeviceObject = v1;
	}

	DbgPrint(("DriverUnload()\r\n"));
}



NTSTATUS PassThroughDispatch(PDEVICE_OBJECT DeviceObject, PIRP Irp)
{
	Irp->IoStatus.Status = STATUS_SUCCESS;     //LastError()
	Irp->IoStatus.Information = 0;             //ReturnLength 
	IoCompleteRequest(Irp, IO_NO_INCREMENT);   //将Irp返回给Io管理器
	return STATUS_SUCCESS;
}

//Ring3层调用ReadFile函数。将RIng0中获得的数据拷贝到IRP堆栈中去，方便Ring3层读取数据
NTSTATUS ReadThroughDispatch(PDEVICE_OBJECT DeviceObject, PIRP Irp)
{
	NTSTATUS Status = STATUS_SUCCESS;
	PIO_STACK_LOCATION  IoStackLocation = IoGetCurrentIrpStackLocation(Irp);		//得到当前IRP堆栈
	ULONG ReadDataLength = IoStackLocation->Parameters.Read.Length;			//IRP堆栈中读取的数据的长度
#define MAX_PATH          260
	if (ReadDataLength != sizeof(WCHAR) * MAX_PATH)
	{
		Status = STATUS_INVALID_PARAMETER_3;
		ReadDataLength = 0;
	}
	else
	{
		if (__ProcessFullPath != NULL)		//将文件路径拷贝到Irp堆栈中的SystemBuffer中
		{
			memcpy(Irp->AssociatedIrp.SystemBuffer, __ProcessFullPath->Buffer,
				__ProcessFullPath->MaximumLength * sizeof(WCHAR));
			Status = STATUS_SUCCESS;
			ReadDataLength = __ProcessFullPath->MaximumLength * sizeof(WCHAR);
		}
	}
	Irp->IoStatus.Status = Status;			//以下操作完成后Ring3层的ReadFile函数会得到返回，从而继续向下执行。
	Irp->IoStatus.Information = ReadDataLength;
	IoCompleteRequest(Irp, IO_NO_INCREMENT);
	return Status;
}
//Ring3层触发WriteFile函数，将Ring3层的数据通过IRP堆栈写入到Ring0层数据中
NTSTATUS WriteThroughDispatch(PDEVICE_OBJECT DeviceObject, PIRP Irp)
{
	NTSTATUS Status = STATUS_UNSUCCESSFUL;
	//通过Irp获得Irp堆栈
	PIO_STACK_LOCATION IoStackLocation = IoGetCurrentIrpStackLocation(Irp);   //Irp获得Irp堆栈
	//获取存储的长度
	ULONG WriteDataLength = IoStackLocation->Parameters.Write.Length;    //获得Ring3发给Ring0数据长度

	if (WriteDataLength >= sizeof(CONTROL_CODE))
	{
		switch (*((CONTROL_CODE*)Irp->AssociatedIrp.SystemBuffer))    //获得Ring3发给Ring0数据
		{
		case CTL_PROCESS_HIPS_TRANSFER:
		{
			if (WriteDataLength - sizeof(CONTROL_CODE) != EVENT_COUNT * sizeof(HANDLE))
			{
				Status = STATUS_UNSUCCESSFUL;
				WriteDataLength = 0;
			}
			else
			{
				//将IRP堆栈中，也就是Ring3层发送的数据拷贝到RIng0层的变量中。
				memcpy(__Ring3ProcessEvent,
					(char*)Irp->AssociatedIrp.SystemBuffer + sizeof(CONTROL_CODE), WriteDataLength - sizeof(CONTROL_CODE));
				//Ring3层的句柄在Ring0层中不能使用，需要进行事件句柄转换，内部调用ObReferenceObjectByHandle
				Status = Ring3Event2Ring0Event(__Ring3ProcessEvent, EVENT_COUNT, __Ring0ProcessEvent);
				WriteDataLength = 0;
			}
			break;
		}
		case CTL_PROCESS_HIPS_REGISTER:		//注册防御
		{
			Status = RegisterProcessNotify();   //注册进程回调
			WriteDataLength = 0;
			break;
		}
		case CTL_PROCESS_HIPS_UNREGISTER:		//解除保护
		{
			__IsProcessHipsOn = FALSE;
			Status = UnregisterProcessNotify();
			WriteDataLength = 0;
			break;
		}
		case CTL_PROCESS_HIPS_OFF:				//关闭保护
		{

			Status = STATUS_SUCCESS;
			WriteDataLength = 0;
			__IsProcessHipsOn = FALSE;

			break;
		}
		case CTL_PROCESS_HIPS_ON:				//开启保护
		{
			Status = STATUS_SUCCESS;
			WriteDataLength = 0;
			__IsProcessHipsOn = TRUE;

			break;
		}
		default:
			break;
		}
	}
	//请求完成
	Irp->IoStatus.Status = Status;
	Irp->IoStatus.Information = WriteDataLength;
	IoCompleteRequest(Irp, IO_NO_INCREMENT);
	return Status;
}
