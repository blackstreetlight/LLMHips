#include"DriverEntry.h"
#include"MajorFunction.h"
#include"ProcessHelper.h"
NTSTATUS DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegisterPath)
{
	PDEVICE_OBJECT DeviceObject;
	UNICODE_STRING DeviceObjectName;
	UNICODE_STRING SymbolicLink;
	NTSTATUS Status = STATUS_UNSUCCESSFUL;
	PLDR_DATA_TABLE_ENTRY LdrDataTableEntry;
	int i = 0;

	RtlInitUnicodeString(&DeviceObjectName, DEVICE_OBJECT_NAME);
	RtlInitUnicodeString(&SymbolicLink, SYMBOLIC_LINK);


	//创建设备对象
	Status = IoCreateDevice(DriverObject, 0, &DeviceObjectName, FILE_DEVICE_UNKNOWN, 0, FALSE, &DeviceObject);
	if (!NT_SUCCESS(Status))
	{
		return Status;
	}
	DeviceObject->Flags |= DO_BUFFERED_IO;
	Status = IoCreateSymbolicLink(&SymbolicLink, &DeviceObjectName);
	//初始化派遣历程
	for (int i = 0; i < IRP_MJ_MAXIMUM_FUNCTION; i++)
	{
		DriverObject->MajorFunction[i] = PassThroughDispatch;
	}
	DriverObject->MajorFunction[IRP_MJ_READ] = ReadThroughDispatch;
	DriverObject->MajorFunction[IRP_MJ_WRITE] = WriteThroughDispatch;
	//
	LdrDataTableEntry = (PLDR_DATA_TABLE_ENTRY)DriverObject->DriverSection;  //不是枚举其他的系统
	LdrDataTableEntry->Flags |= 0x20;   //小机关


	return STATUS_SUCCESS;
}