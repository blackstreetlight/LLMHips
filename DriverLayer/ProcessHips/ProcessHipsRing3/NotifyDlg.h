#pragma once


// CNotifyDlg 对话框
#define EVENT_COUNT 3
class CNotifyDlg : public CDialogEx
{
	DECLARE_DYNAMIC(CNotifyDlg)

public:
	CNotifyDlg(HANDLE* EventHandle, SIZE_T Count, CWnd* pParent = nullptr);
	virtual ~CNotifyDlg();

// 对话框数据
#ifdef AFX_DESIGN_TIME
	enum { IDD = IDD_NOTIFY_DIALOG };
#endif

protected:
	virtual void DoDataExchange(CDataExchange* pDX);    // DDX/DDV 支持

	DECLARE_MESSAGE_MAP()
public:
	CEdit m_Edit;
	int m_Count = 0;
	HANDLE m_EventHandle[EVENT_COUNT];
	afx_msg void OnBnClickedOk();
	afx_msg void OnBnClickedCancel();
	virtual BOOL OnInitDialog();
	afx_msg void OnTimer(UINT_PTR nIDEvent);
};
