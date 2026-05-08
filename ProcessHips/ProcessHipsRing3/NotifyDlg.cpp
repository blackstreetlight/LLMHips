// NotifyDlg.cpp: 实现文件
//

#include "pch.h"
#include "ProcessHipsRing3.h"
#include "NotifyDlg.h"
#include "afxdialogex.h"


// CNotifyDlg 对话框

IMPLEMENT_DYNAMIC(CNotifyDlg, CDialogEx)

CNotifyDlg::CNotifyDlg(HANDLE* EventHandle, SIZE_T Count, CWnd* pParent)
	: CDialogEx(IDD_NOTIFY_DIALOG, pParent)
{
	int i = 0;
	for (i = 0; i < Count; i++)
	{
		m_EventHandle[i] = EventHandle[i];
	}
}

CNotifyDlg::~CNotifyDlg()
{
}

void CNotifyDlg::DoDataExchange(CDataExchange* pDX)
{
	CDialogEx::DoDataExchange(pDX);
	DDX_Control(pDX, IDC_EDIT1, m_Edit);
}


BEGIN_MESSAGE_MAP(CNotifyDlg, CDialogEx)
	ON_BN_CLICKED(IDC_OK, &CNotifyDlg::OnBnClickedOk)
	ON_BN_CLICKED(IDC_CANCEL, &CNotifyDlg::OnBnClickedCancel)
	ON_WM_TIMER()
END_MESSAGE_MAP()


// CNotifyDlg 消息处理程序


void CNotifyDlg::OnBnClickedOk()
{
	// TODO: 在此添加控件通知处理程序代码
	if (m_EventHandle[1] != NULL)   //放行进程
	{
		SetEvent(m_EventHandle[1]);

		ResetEvent(m_EventHandle[1]);
	}
}


void CNotifyDlg::OnBnClickedCancel()
{
	// TODO: 在此添加控件通知处理程序代码
	if (m_EventHandle[2] != NULL)
	{
		SetEvent(m_EventHandle[2]);

		ResetEvent(m_EventHandle[2]);
	}
}


BOOL CNotifyDlg::OnInitDialog()
{
	CDialogEx::OnInitDialog();

	// TODO:  在此添加额外的初始化
	m_Count = 5;

	ModifyStyleEx(WS_EX_APPWINDOW, WS_EX_TOOLWINDOW);//设置扩展工具窗模式。阻止任务栏显示图标
	CRect WindowRect;
	SystemParametersInfoW(SPI_GETWORKAREA, 0, &WindowRect, SPIF_SENDCHANGE);

	//获得对话框大小
	CRect ClientRect;
	GetWindowRect(&ClientRect);
	int WindowWidth = ClientRect.Width();
	int WindowHeight = ClientRect.Height();

	//将窗口设置到右下脚
	::SetWindowPos(this->m_hWnd, HWND_BOTTOM,
		WindowRect.right - WindowWidth - 6, WindowRect.bottom - WindowHeight,
		WindowWidth, WindowHeight,
		SWP_NOZORDER);
	SetTimer(0, 1000, NULL);
	return TRUE;  // return TRUE unless you set the focus to a control
				  // 异常: OCX 属性页应返回 FALSE
}


void CNotifyDlg::OnTimer(UINT_PTR nIDEvent)
{
	// TODO: 在此添加消息处理程序代码和/或调用默认值
	switch (nIDEvent)
	{
	case 0:
	{
		if (m_Count == 0)
		{
			KillTimer(nIDEvent);

			if (m_EventHandle[1] != NULL)   //放行进程
			{
				SetEvent(m_EventHandle[1]);

				ResetEvent(m_EventHandle[1]);
			}
			SendMessage(WM_CLOSE);
			break;
		}

		m_Count--;
	}
	}
	CDialogEx::OnTimer(nIDEvent);
}
