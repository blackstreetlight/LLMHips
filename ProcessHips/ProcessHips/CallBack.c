#include"CallBack.h"
#include"MajorFunction.h"
#include"ProcessHelper.h"



//进程回调
static BOOLEAN _IsProcessNotify = FALSE; //是否注册了进程回调通知
BOOLEAN __IsProcessHipsOn = TRUE;       //是否开启了进程Hips
static KMUTEX   _ProcessHipsMutex;
static BOOLEAN  _IsProcessHipsMutex = FALSE;
PUNICODE_STRING  __ProcessFullPath = NULL;    //某某进程启动了


//注册保护
NTSTATUS RegisterProcessNotify()
{
	NTSTATUS Status = STATUS_SUCCESS;
	int i = 0;
	//注册或删除一个回调例程，该例程在创建或退出进程时通知调用方。
	Status = PsSetCreateProcessNotifyRoutineEx((PCREATE_PROCESS_NOTIFY_ROUTINE_EX)ProcessNotifyProcedure, FALSE);   //添加一个 进程 创建的回调Notity
	if (NT_SUCCESS(Status))
	{
		DbgPrint("进程回调通知注册成功\r\n");
		_IsProcessNotify = TRUE;

		//创建Mutex，此处是一个互斥体，作用主要是实现线程同步
		KeInitializeMutant(&_ProcessHipsMutex, 0);
	}

	return Status;
}

VOID ProcessNotifyProcedure(PEPROCESS EProcess, HANDLE ProcessIdentify, PPS_CREATE_NOTIFY_INFO CreateInfo)
{
	NTSTATUS  Status;
	if (__IsProcessHipsOn == TRUE)
	{
		if (CreateInfo)  //判断进程是启动还是关闭
		{
			//等待事件
			KeWaitForSingleObject(&_ProcessHipsMutex, Executive, KernelMode, FALSE, NULL);
			{
				_IsProcessHipsMutex = TRUE;		//将互斥体设置为TRUE
				if (GetProcessFullPathByEProcess(EProcess, &__ProcessFullPath))   //通过进程对象获取进程完整路径
				{
					//系统进程放心，白名单，应该自己设计
					if (0)
					{
						goto White;
					}

					//已经在黑名单中，授信后应该立马设置为非授信状态。
					KeSetEvent(__Ring0ProcessEvent[0], IO_NO_INCREMENT, FALSE);	  //通知Ring3层 有进程创建									
					KeResetEvent(__Ring0ProcessEvent[0]);  //将授信恢复为不授信状态

					Status = KeWaitForMultipleObjects(2,
						&__Ring0ProcessEvent[1],
						WaitAny,    //只要有一个事件授信就向下执行
						Executive,
						KernelMode,
						FALSE,
						NULL,
						NULL);

					//0     1号事件 放行   2号事件 阻止
					if (Status == 0)
					{
					White:;

					}
					else if (Status == 1)
					{
						CreateInfo->CreationStatus = STATUS_UNSUCCESSFUL;   //拒绝启动
					}
					if (__ProcessFullPath != NULL)
					{
						ExFreePool(__ProcessFullPath);
					}

					KeReleaseMutex(&_ProcessHipsMutex,		//释放互斥体
						FALSE);
					_IsProcessHipsMutex = FALSE;
				}
			}
		}
		else
		{
			//当前进程销毁时，不做任何处理
		}
	}
}

NTSTATUS UnregisterProcessNotify()
{
	NTSTATUS Status = STATUS_SUCCESS;		
	if (_IsProcessNotify)		//如果处于保护状态
	{
		PsSetCreateProcessNotifyRoutineEx(ProcessNotifyProcedure, TRUE);
		_IsProcessNotify = FALSE;
	}

	if (_IsProcessHipsMutex)		//释放互斥体
	{
		KeReleaseMutex(&_ProcessHipsMutex,
			FALSE);
		_IsProcessHipsMutex = FALSE;
	}

	//注意调整一下，释放事件。
	int i = 0;
	for (i = 0; i < EVENT_COUNT; i++)
	{
		if (__Ring0ProcessEvent[i] != NULL)
		{

			ObDereferenceObject(__Ring0ProcessEvent[i]);

			__Ring0ProcessEvent[i] = NULL;
		}
	}
	return Status;
}
