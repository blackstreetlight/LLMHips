#include"ProcessHelper.h"


//根据进程体得到进程完整路径
BOOLEAN GetProcessFullPathByEProcess(PEPROCESS EProcess, PUNICODE_STRING* FullPath)
{
	//通过进程对象得到进程ID：ObOpenObjectByPointer
	//通过进程ID得到进程的完整路径，带有Hard Disk的路径。ZwQueryInformationProcess函数
	//初始化一个结构OBJECT_ATTRIBUTES，用于接下来的打开文件。得到文件路径。InitializeObjectAttributes
	//通过OBJECT_ATTRIBUTES打开文件获得文件句柄。ZwOpenFile
	//通过文件句柄查询文件的完整路径，首先调用一下ObReferenceObjectByHandle函数，防止对象释放。
	//然后根据文件句柄得到文件完整路径IoQueryFileDosDeviceName。
	BOOLEAN IsOk = FALSE;
	KPROCESSOR_MODE PreviousMode = NULL;
	ULONG HandleAttributes = 0;
	HANDLE ProcessHandle = NULL;
	NTSTATUS Status;
	PreviousMode = PsGetCurrentThreadPreviousMode();		//得到当前线程的运行模式。
	HandleAttributes = (PreviousMode == KernelMode ? OBJ_KERNEL_HANDLE : 0);
#define PROCESS_QUERY_INFORMATION          (0x0400)  
	if (NT_SUCCESS(ObOpenObjectByPointer(EProcess,
		HandleAttributes, NULL, PROCESS_QUERY_INFORMATION, *PsProcessType, PreviousMode, &ProcessHandle)))   //通过进程对象获取进程句柄
	{
		PVOID BufferData = NULL;
		ULONG BufferLength = 0;
		//通过进程句柄查找进程完整路径。
		if (ZwQueryInformationProcess(ProcessHandle, ProcessImageFileName, BufferData,
			BufferLength, &BufferLength) == STATUS_INFO_LENGTH_MISMATCH)   //由于没有提供内存所以必须报错
		{
			//根据返回的长度动态申请内存
			if (BufferData = ExAllocatePool(PagedPool, BufferLength))
			{
				//再次查询路径信息。
				if (NT_SUCCESS(ZwQueryInformationProcess(ProcessHandle,
					ProcessImageFileName, BufferData, BufferLength, &BufferLength)))
				{

					//此时路径看不懂
					//是一个文件的路径
					HANDLE FileHandle;
					OBJECT_ATTRIBUTES ObjectAttributes;
					IO_STATUS_BLOCK IoStatusBlock = { 0 };
					//初始化不透明的OBJECT_ATTRIBUTES结构，该结构指定打开句柄的例程的对象句柄的属性。
					InitializeObjectAttributes(&ObjectAttributes,
						(PUNICODE_STRING)BufferData, OBJ_CASE_INSENSITIVE | HandleAttributes, NULL, NULL);


					//根据路径获取文件句柄
					if (NT_SUCCESS(ZwOpenFile(&FileHandle,
						FILE_READ_ATTRIBUTES | SYNCHRONIZE, &ObjectAttributes, &IoStatusBlock,
						FILE_SHARE_READ, FILE_SYNCHRONOUS_IO_NONALERT)))
					{
						PFILE_OBJECT FileObject = NULL;
						Status = ObReferenceObjectByHandle(FileHandle,
							FILE_READ_ATTRIBUTES, *IoFileObjectType,
							PreviousMode, (PVOID*)&FileObject, NULL);   //通过文件句柄获取文件对象
						if (NT_SUCCESS(Status))
						{
							POBJECT_NAME_INFORMATION ObjetNameInfo;
							//通过文件对象查找文件路径。
							if (NT_SUCCESS(IoQueryFileDosDeviceName(FileObject, &ObjetNameInfo)))  //通过文件对象获取的文件路径是看的懂的
							{
								*FullPath = (UNICODE_STRING*)ObjetNameInfo;
								IsOk = TRUE;
							}
							ObDereferenceObject(FileObject);
						}
						ZwClose(FileHandle);
					}
				}
				ExFreePool(BufferData);
			}
		}
		ZwClose(ProcessHandle);
	}
	return IsOk;
}
