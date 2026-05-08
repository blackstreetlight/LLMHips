#include"ObjectHelper.h"
//RingEvent:Ring3层句柄数组，Ring3EventLength：句柄个数，Ring0EventRing0层句柄数组
NTSTATUS Ring3Event2Ring0Event(HANDLE* Ring3Event, ULONG32 Ring3EventLength, HANDLE* Ring0Event)
{
	NTSTATUS Status = STATUS_UNSUCCESSFUL;
	int i = 0;
	for (i = 0; i < Ring3EventLength; i++)		//要转换的句柄个数
	{
		if (MmIsAddressValid(&Ring3Event[i]))    //内存是否有效
		{
			__try
			{
				Status = ObReferenceObjectByHandle((HANDLE)Ring3Event[i],		//引用计数++，防止操作过程中句柄关闭。
					SYNCHRONIZE,
					*ExEventObjectType,   //事件对象的类型对象
					KernelMode,
					&Ring0Event[i],
					NULL);
			}
			__except (EXCEPTION_EXECUTE_HANDLER)
			{
				for (i = 0; i < Ring3EventLength; i++)
				{
					if (Ring0Event[i] != NULL)
					{

						ObDereferenceObject(Ring0Event[i]);

						Ring0Event[i] = NULL;
					}
				}
				return Status;
			}
		}
	}
	return Status;
}
