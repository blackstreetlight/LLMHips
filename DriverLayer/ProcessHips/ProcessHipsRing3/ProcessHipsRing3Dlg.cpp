
// ProcessHipsRing3Dlg.cpp: 实现文件
//

#include "pch.h"
#include "framework.h"
#include "ProcessHipsRing3.h"
#include "ProcessHipsRing3Dlg.h"
#include "afxdialogex.h"

#ifdef _DEBUG
#define new DEBUG_NEW
#endif


// 用于应用程序“关于”菜单项的 CAboutDlg 对话框

class CAboutDlg : public CDialogEx
{
public:
	CAboutDlg();

// 对话框数据
#ifdef AFX_DESIGN_TIME
	enum { IDD = IDD_ABOUTBOX };
#endif

	protected:
	virtual void DoDataExchange(CDataExchange* pDX);    // DDX/DDV 支持

// 实现
protected:
	DECLARE_MESSAGE_MAP()
};

CAboutDlg::CAboutDlg() : CDialogEx(IDD_ABOUTBOX)
{
}

void CAboutDlg::DoDataExchange(CDataExchange* pDX)
{
	CDialogEx::DoDataExchange(pDX);
}

BEGIN_MESSAGE_MAP(CAboutDlg, CDialogEx)
END_MESSAGE_MAP()


// CProcessHipsRing3Dlg 对话框



CProcessHipsRing3Dlg::CProcessHipsRing3Dlg(CWnd* pParent /*=nullptr*/)
	: CDialogEx(IDD_PROCESSHIPSRING3_DIALOG, pParent)
{
	m_hIcon = AfxGetApp()->LoadIcon(IDR_MAINFRAME);
}

void CProcessHipsRing3Dlg::DoDataExchange(CDataExchange* pDX)
{
	CDialogEx::DoDataExchange(pDX);
}

BEGIN_MESSAGE_MAP(CProcessHipsRing3Dlg, CDialogEx)
	ON_WM_SYSCOMMAND()
	ON_WM_PAINT()
	ON_WM_QUERYDRAGICON()
	ON_MESSAGE(UM_NOTIFY_DIALOG, OnNotifyDialog)
	ON_MESSAGE(UM_PROCESS_HIPS_START, OnProcessHipsStart)
	ON_BN_CLICKED(IDC_ON_BUTTON, &CProcessHipsRing3Dlg::OnBnClickedOnButton)
	ON_BN_CLICKED(IDC_OFF_BUTTON, &CProcessHipsRing3Dlg::OnBnClickedOffButton)
END_MESSAGE_MAP()


// CProcessHipsRing3Dlg 消息处理程序

BOOL CProcessHipsRing3Dlg::OnInitDialog()
{
	CDialogEx::OnInitDialog();

	// 将“关于...”菜单项添加到系统菜单中。

	// IDM_ABOUTBOX 必须在系统命令范围内。
	ASSERT((IDM_ABOUTBOX & 0xFFF0) == IDM_ABOUTBOX);
	ASSERT(IDM_ABOUTBOX < 0xF000);

	CMenu* pSysMenu = GetSystemMenu(FALSE);
	if (pSysMenu != nullptr)
	{
		BOOL bNameValid;
		CString strAboutMenu;
		bNameValid = strAboutMenu.LoadString(IDS_ABOUTBOX);
		ASSERT(bNameValid);
		if (!strAboutMenu.IsEmpty())
		{
			pSysMenu->AppendMenu(MF_SEPARATOR);
			pSysMenu->AppendMenu(MF_STRING, IDM_ABOUTBOX, strAboutMenu);
		}
	}

	// 设置此对话框的图标。  当应用程序主窗口不是对话框时，框架将自动
	//  执行此操作
	SetIcon(m_hIcon, TRUE);			// 设置大图标
	SetIcon(m_hIcon, FALSE);		// 设置小图标

	// TODO: 在此添加额外的初始化代码

	//与驱动进行通信
	if (m_DeviceHandle == INVALID_HANDLE_VALUE)
	{
		OpenDevice(L"\\\\.\\911Kernel");   //设备链接名称
	}
	if (m_DeviceHandle == INVALID_HANDLE_VALUE)
	{
		MessageBox(_T("设备没有打开"), _T("设备没有打开"));

		return FALSE;
	}

	m_IsLoop = TRUE;
	m_ThreadHandle = CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)ThreadProcedure, this, 0, &m_ThreadIdentify);

	return TRUE;  // 除非将焦点设置到控件，否则返回 TRUE
}

void CProcessHipsRing3Dlg::OnSysCommand(UINT nID, LPARAM lParam)
{
	if ((nID & 0xFFF0) == IDM_ABOUTBOX)
	{
		CAboutDlg dlgAbout;
		dlgAbout.DoModal();
	}
	else
	{
		CDialogEx::OnSysCommand(nID, lParam);
	}
}

// 如果向对话框添加最小化按钮，则需要下面的代码
//  来绘制该图标。  对于使用文档/视图模型的 MFC 应用程序，
//  这将由框架自动完成。

void CProcessHipsRing3Dlg::OnPaint()
{
	if (IsIconic())
	{
		CPaintDC dc(this); // 用于绘制的设备上下文

		SendMessage(WM_ICONERASEBKGND, reinterpret_cast<WPARAM>(dc.GetSafeHdc()), 0);

		// 使图标在工作区矩形中居中
		int cxIcon = GetSystemMetrics(SM_CXICON);
		int cyIcon = GetSystemMetrics(SM_CYICON);
		CRect rect;
		GetClientRect(&rect);
		int x = (rect.Width() - cxIcon + 1) / 2;
		int y = (rect.Height() - cyIcon + 1) / 2;

		// 绘制图标
		dc.DrawIcon(x, y, m_hIcon);
	}
	else
	{
		CDialogEx::OnPaint();
	}
}

//当用户拖动最小化窗口时系统调用此函数取得光标
//显示。
HCURSOR CProcessHipsRing3Dlg::OnQueryDragIcon()
{
	return static_cast<HCURSOR>(m_hIcon);
}

LRESULT CProcessHipsRing3Dlg::OnNotifyDialog(WPARAM ParameterData1, LPARAM ParameterData2)
{
	CNotifyDlg* v1 = new CNotifyDlg(m_EventHandle, 3);
	v1->Create(IDD_NOTIFY_DIALOG, 0);
	CStringW  v2 = L"进程创建\r\n";
	v2 += (WCHAR*)ParameterData1;
	v1->m_Edit.SetWindowText(v2);
	v1->ShowWindow(SW_SHOW);
	return TRUE;
}

LRESULT CProcessHipsRing3Dlg::OnProcessHipsStart(WPARAM ParameterData1, LPARAM ParameterData2)
{
	CONTROL_CODE ControlCode;
	BOOL IsOk = FALSE;
	DWORD ReturnLength = 0;
	if ((BOOL)ParameterData1 == TRUE)
	{
		ControlCode = CTL_PROCESS_HIPS_ON;
	}
	else
	{
		ControlCode = CTL_PROCESS_HIPS_OFF;
	}
	IsOk = WriteFile(m_DeviceHandle, &ControlCode,
		sizeof(CONTROL_CODE), &ReturnLength, NULL);

	if (IsOk == FALSE)
	{
		::MessageBox(NULL, _T("请求失败"), _T("HelloShine"), 0);
		return -1;
	}
	return 0;
}

//打开设备对象。
BOOL CProcessHipsRing3Dlg::OpenDevice(LPCTSTR ParameterData)
{
	m_DeviceHandle = CreateFileW(ParameterData,
		GENERIC_READ | GENERIC_WRITE,
		FILE_SHARE_READ | FILE_SHARE_WRITE,
		NULL,
		OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL,
		NULL);

	if (m_DeviceHandle == INVALID_HANDLE_VALUE)
	{
		return FALSE;
	}

	return TRUE;
}

//线程回调函数
DWORD CProcessHipsRing3Dlg::ThreadProcedure(LPVOID ParameterData)
{
	CProcessHipsRing3Dlg* This = (CProcessHipsRing3Dlg*)ParameterData;
	BOOL IsOk = FALSE;
	DWORD NumberOfBytesWritten = 0;
	ULONG i = 0;


	//创建了三个事件
	for (i = 0; i < EVENT_COUNT; i++)
	{
		This->m_EventHandle[i] = CreateEvent(NULL, TRUE, FALSE, NULL);
	}
#pragma pack(1)
	struct _WRITE_OPERATION_
	{
		CONTROL_CODE ControlCode;
		HANDLE EventHandle[EVENT_COUNT];
	}WriteOperation;

	WriteOperation.ControlCode = CTL_PROCESS_HIPS_TRANSFER;
	memcpy(WriteOperation.EventHandle, This->m_EventHandle, sizeof(HANDLE) * EVENT_COUNT);

	//Ring3发送数据到Ring0
	IsOk = WriteFile(This->m_DeviceHandle, &WriteOperation,
		sizeof(_WRITE_OPERATION_), &NumberOfBytesWritten, NULL);

	if (IsOk == FALSE)
	{
		::MessageBox(NULL, _T("事件句柄传送失败"), _T("事件句柄传送失败"), 0);
		return -1;
	}

	CONTROL_CODE ControlCode = CTL_PROCESS_HIPS_REGISTER;
	IsOk = WriteFile(This->m_DeviceHandle, &ControlCode,
		sizeof(CONTROL_CODE), &NumberOfBytesWritten, NULL);

	if (IsOk == FALSE)
	{
		::MessageBox(NULL, _T("注册进程监控失败"), _T("HelloShine"), 0);
		return -1;
	}

	while (This->m_IsLoop)
	{
	Loop:

		//等待0号事件句柄是否授信
		while (WaitForSingleObject(This->m_EventHandle[0], 1000) == WAIT_OBJECT_0)
		{
			//必须双字
			WCHAR ProcessFullPath[MAX_PATH] = { 0 };
			memset(ProcessFullPath, 0, sizeof(ProcessFullPath));
			DWORD NumberOfBytesRead = 0;

			//读取驱动层发送来的数据，读取得到完整路径。
			IsOk = ReadFile(This->m_DeviceHandle, ProcessFullPath,
				sizeof(ProcessFullPath), &NumberOfBytesRead, NULL);

			if (IsOk == TRUE && NumberOfBytesRead != 0)
			{
				//如果是黑名单，触发2号事件，发送到驱动层。然后驱动层进行拦截
				for (list<CStringW>::iterator i = This->m_BlcakList.begin();
					i != This->m_BlcakList.end(); i++)
				{
					if (lstrcmpiW(*i, ProcessFullPath) == 0)
					{
						if (This->m_EventHandle[2] != NULL)
						{
							SetEvent(This->m_EventHandle[2]);

							ResetEvent(This->m_EventHandle[2]);
						}
						goto Loop;
					}
				}
				This->SendMessage(UM_NOTIFY_DIALOG, (WPARAM)ProcessFullPath, NULL);
			}
			Sleep(1);
		}
	}
	return 0;
}


void CProcessHipsRing3Dlg::OnBnClickedOnButton()
{
	// TODO: 在此添加控件通知处理程序代码
	SendMessage(UM_PROCESS_HIPS_START, (WPARAM)TRUE, NULL);
}


void CProcessHipsRing3Dlg::OnBnClickedOffButton()
{
	// TODO: 在此添加控件通知处理程序代码
	SendMessage(UM_PROCESS_HIPS_START, (WPARAM)FALSE, NULL);
}
