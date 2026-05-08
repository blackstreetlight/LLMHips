
// ProcessHipsRing3Dlg.h: 头文件
//

#pragma once
#include"NotifyDlg.h"

#include<list>
using namespace std;
#define EVENT_COUNT 3
#define UM_NOTIFY_DIALOG  WM_USER+10
#define UM_PROCESS_HIPS_START  WM_USER+11
typedef enum _CONTROL_CODE_
{
	CTL_PROCESS_HIPS_TRANSFER,
	CTL_PROCESS_HIPS_REGISTER,
	CTL_PROCESS_HIPS_UNREGISTER,
	CTL_PROCESS_HIPS_ON,
	CTL_PROCESS_HIPS_OFF,
}CONTROL_CODE, * PCONTROL_CODE;


// CProcessHipsRing3Dlg 对话框
class CProcessHipsRing3Dlg : public CDialogEx
{
// 构造
public:
	CProcessHipsRing3Dlg(CWnd* pParent = nullptr);	// 标准构造函数

// 对话框数据
#ifdef AFX_DESIGN_TIME
	enum { IDD = IDD_PROCESSHIPSRING3_DIALOG };
#endif

	protected:
	virtual void DoDataExchange(CDataExchange* pDX);	// DDX/DDV 支持


// 实现
protected:
	HICON m_hIcon;

	// 生成的消息映射函数
	virtual BOOL OnInitDialog();
	afx_msg void OnSysCommand(UINT nID, LPARAM lParam);
	afx_msg void OnPaint();
	afx_msg HCURSOR OnQueryDragIcon();
	DECLARE_MESSAGE_MAP()
	afx_msg LRESULT OnNotifyDialog(WPARAM ParameterData1, LPARAM ParameterData2);
	afx_msg LRESULT OnProcessHipsStart(WPARAM ParameterData1, LPARAM ParameterData2);
	afx_msg void OnBnClickedOnButton();
	afx_msg void OnBnClickedOffButton();

public:
	BOOL OpenDevice(LPCTSTR ParameterData);
	static  DWORD WINAPI  ThreadProcedure(LPVOID ParameterData);
private:
	list<CStringW>   m_BlcakList;
	HANDLE m_DeviceHandle = INVALID_HANDLE_VALUE;
	HANDLE m_ThreadHandle;
	DWORD  m_ThreadIdentify = 0;
	BOOL   m_IsLoop = TRUE;
	HANDLE m_EventHandle[EVENT_COUNT];
public:

};
