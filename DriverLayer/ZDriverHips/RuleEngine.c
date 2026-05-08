/*
 * RuleEngine.c
 *
 * 驱动层简单规则预判引擎实现。
 *
 * 所有字符串比较均使用大小写不敏感的宽字符匹配（RtlEqualUnicodeString /
 * 手动 towlower），原因：Windows 路径和进程名对大小写不敏感，
 * 恶意程序常用大小写混淆规避检测（如 MiMiKaTz.exe、PSEXEC.EXE）。
 *
 * IRQL：PASSIVE_LEVEL（由进程创建回调调用，满足要求）
 */

#include "RuleEngine.h"
#include <ntstrsafe.h>  /* RtlStringCchLengthW */
#include <wdm.h>        /* RtlUpcaseUnicodeChar 等 */

/* ============================================================
 *  内部辅助：大小写不敏感的宽字符子串搜索
 *
 *  标准库的 wcsstr 是大小写敏感的，内核中也没有 wcscasestr。
 *  这里实现一个简单版本：将 Haystack 和 Needle 均转为大写后比较。
 *
 *  @param Haystack  被搜索的字符串
 *  @param Needle    要查找的子串
 *  @return BOOLEAN  TRUE = 找到
 * ============================================================ */
static BOOLEAN ContainsSubstringI(
    _In_ PCWSTR Haystack,
    _In_ PCWSTR Needle)
{
    /* Use size_t to match RtlStringCchLengthW's third parameter type exactly.
     * On x64, size_t is 8 bytes; using ULONG (4 bytes) with a (size_t*) cast
     * would cause RtlStringCchLengthW to write 8 bytes into a 4-byte slot,
     * corrupting adjacent stack variables and producing wrong length values. */
    size_t hayLen, needleLen;
    size_t i, j;
    WCHAR  hc, nc;

    if (Haystack == NULL || Needle == NULL) return FALSE;

    if (!NT_SUCCESS(RtlStringCchLengthW(Haystack, SD_MAX_CMDLINE, &hayLen))) return FALSE;
    if (!NT_SUCCESS(RtlStringCchLengthW(Needle, SD_MAX_PATH, &needleLen))) return FALSE;
    if (needleLen == 0 || needleLen > hayLen) return FALSE;

    /* sliding window match */
    for (i = 0; i <= hayLen - needleLen; i++) {
        for (j = 0; j < needleLen; j++) {
            hc = RtlUpcaseUnicodeChar(Haystack[i + j]);
            nc = RtlUpcaseUnicodeChar(Needle[j]);
            if (hc != nc) break;
        }
        if (j == needleLen) return TRUE;
    }
    return FALSE;
}

/* ============================================================
 *  内部辅助：判断路径是否以指定前缀开头（大小写不敏感）
 *
 *  用于检测路径是否在某个目录下，例如：
 *    StartsWithI(L"C:\Windows\System32\calc.exe", L"C:\\Windows\\System32\\") → TRUE
 * ============================================================ */
static BOOLEAN StartsWithI(
    _In_ PCWSTR OriString,
    _In_ PCWSTR Prefix)
{
    /* Same size_t fix as ContainsSubstringI - avoid ULONG/size_t mismatch. */
    size_t strLen, prefLen;
    size_t i;

    if (OriString == NULL || Prefix == NULL) return FALSE;

    if (!NT_SUCCESS(RtlStringCchLengthW(OriString, SD_MAX_PATH * 2, &strLen))) return FALSE;
    if (!NT_SUCCESS(RtlStringCchLengthW(Prefix, SD_MAX_PATH, &prefLen))) return FALSE;
    if (prefLen == 0 || prefLen > strLen) return FALSE;

    for (i = 0; i < prefLen; i++) {
        if (RtlUpcaseUnicodeChar(OriString[i]) != RtlUpcaseUnicodeChar(Prefix[i])) {
            return FALSE;
        }
    }
    return TRUE;
}

/* ============================================================
 *  HIGH 规则集 1：危险工具名黑名单
 *
 *  匹配 EventData->ProcessName（进程文件名），大小写不敏感。
 *  列表来源：常见渗透/横向移动工具，任何正常业务环境中均无需出现。
 * ============================================================ */
static const PCWSTR g_DangerousToolNames[] = {
    /* 凭据窃取 */
    L"mimikatz.exe",
    L"wce.exe",             /* Windows Credentials Editor */
    L"pwdump.exe",
    L"fgdump.exe",
    L"quarks-pwdump.exe",

    /* 横向移动 / 远程执行 */
    L"psexec.exe",
    L"psexesvc.exe",
    L"paexec.exe",          /* PsExec 克隆 */
    L"remcom.exe",

    /* 端口扫描 / 网络探测 */
    L"nmap.exe",
    L"masscan.exe",
    L"zmap.exe",

    /* 代理 / 隧道 */
    L"frpc.exe",            /* FRP 内网穿透客户端 */
    L"frps.exe",
    L"lcx.exe",             /* 端口转发 */
    L"netcat.exe",
    L"nc.exe",
    L"ncat.exe",
    L"socat.exe",

    /* Webshell 管理 / C2 */
    L"cobalt_strike.exe",
    L"cobaltstrike.exe",
    L"beacon.exe",
    L"meterpreter.exe",

    /* 漏洞利用框架 */
    L"msfconsole.exe",
    L"msf.exe",

    /* 提权 / 令牌操纵 */
    L"juicypotato.exe",
    L"sweetpotato.exe",
    L"rottenpotato.exe",
    L"tokenvator.exe",
    L"incognito.exe",

    /* 其他已知高危工具 */
    L"sharphound.exe",      /* BloodHound AD 枚举 */
    L"rubeus.exe",          /* Kerberos 攻击 */
    L"certify.exe",         /* AD CS 攻击 */
    L"printspoofer.exe",
};

#define DANGEROUS_TOOL_COUNT (sizeof(g_DangerousToolNames) / sizeof(g_DangerousToolNames[0]))

/* ============================================================
 *  HIGH 规则集 2：命令行高危关键词
 *
 *  匹配 EventData->CommandLine，大小写不敏感。
 *  这些关键词在合法场景中极少出现，出现即需重点审查。
 * ============================================================ */
static const PCWSTR g_DangerousCmdKeywords[] = {
    /* PowerShell 混淆/绕过执行 */
    L"-enc ",               /* EncodedCommand：Base64 编码的命令，常用于隐藏意图 */
    L"-encodedcommand",
    L"-exec bypass",        /* 绕过执行策略 */
    L"-executionpolicy bypass",
    L"-nop ",               /* -NoProfile，减少日志 */
    L"-windowstyle hidden", /* 隐藏窗口执行 */
    L"iex(",                /* Invoke-Expression：动态执行字符串 */
    L"invoke-expression",
    L"downloadstring(",     /* 从网络下载并执行 */
    L"downloadfile(",

    /* cmd 常见恶意用法 */
    L"/c certutil",         /* certutil 常被滥用下载文件 */
    L"certutil -decode",
    L"certutil -urlcache",
    L"bitsadmin /transfer", /* BITS 下载文件（LOLBin）*/

    /* WMI 远程执行 */
    L"wmic process call create",

    /* 注册表持久化 */
    L"reg add.*currentversion\\run", /* 注册表自启动项写入 */

    /* 计划任务持久化 */
    L"schtasks /create",

    /* 服务创建 */
    L"sc create",
    L"sc config",

    /* 禁用防御 */
    L"set-mppreference",    /* 关闭 Windows Defender */
    L"add-mppreference",
    L"netsh advfirewall set allprofiles state off",

    /* 内存注入相关 */
    L"virtualalloc",
    L"writeprocessmemory",

    /* 网络回连特征 */
    L"tcp://",
    L"http://",             /* 注意：仅命令行中出现 http:// 才判断，路径中的不算 */
};

#define DANGEROUS_CMD_COUNT (sizeof(g_DangerousCmdKeywords) / sizeof(g_DangerousCmdKeywords[0]))

/* ============================================================
 *  HIGH 规则集 3：高危路径前缀
 *  未签名进程从这些目录启动 → 高度可疑
 * ============================================================ */
static const PCWSTR g_SuspiciousPaths[] = {
    L"C:\\Users\\",             /* 用户目录下的 exe */
    L"C:\\ProgramData\\",       /* 常见恶意软件落地位置 */
    L"C:\\Windows\\Temp\\",     /* 系统临时目录 */
    L"C:\\Temp\\",
};

#define SUSPICIOUS_PATH_COUNT (sizeof(g_SuspiciousPaths) / sizeof(g_SuspiciousPaths[0]))

/* ============================================================
 *  LOW 规则集 1：受信任系统目录
 *  合法系统进程绝大多数在这些目录下
 * ============================================================ */
static const PCWSTR g_TrustedPaths[] = {
    L"C:\\Windows\\System32\\",
    L"C:\\Windows\\SysWOW64\\",
    L"C:\\Windows\\WinSxS\\",
    L"C:\\Windows\\servicing\\",
    L"C:\\Program Files\\",         /* 正规安装的应用 */
    L"C:\\Program Files (x86)\\",
};

#define TRUSTED_PATH_COUNT (sizeof(g_TrustedPaths) / sizeof(g_TrustedPaths[0]))

/* ============================================================
 *  LOW 规则集 2：可信父进程名
 *  由这些进程创建的子进程初始可信度更高
 * ============================================================ */
static const PCWSTR g_TrustedParentNames[] = {
    L"explorer.exe",        /* 用户双击启动 */
    L"services.exe",        /* 系统服务启动 */
    L"svchost.exe",         /* 服务宿主 */
    L"wininit.exe",
    L"winlogon.exe",
    L"lsass.exe",
    L"csrss.exe",
    L"smss.exe",
    L"taskmgr.exe",         /* 任务管理器手动启动 */
    L"msiexec.exe",         /* 安装程序 */
};

#define TRUSTED_PARENT_COUNT (sizeof(g_TrustedParentNames) / sizeof(g_TrustedParentNames[0]))

/* ============================================================
 *  EvaluateRiskLevel —— 主判断函数
 *
 *  规则检查顺序（短路求值，命中即返回）：
 *    1. HIGH：进程名命中危险工具黑名单
 *    2. HIGH：命令行包含高危关键词
 *    3. HIGH：未签名 + 路径在可疑目录
 *    4. LOW ：路径在受信任系统目录
 *    5. LOW ：父进程是已知可信进程
 *    6. MEDIUM：默认
 * ============================================================ */
ULONG EvaluateRiskLevel(_In_ PDRIVER_EVENT_BUFFER EventData)
{
    ULONG i;

    if (EventData == NULL) {
        return RISK_MEDIUM;
    }

    /* ----------------------------------------------------------
     *  规则 1（HIGH）：进程名命中危险工具黑名单
     *
     *  只匹配文件名（ProcessName），不匹配路径，
     *  防止攻击者将 mimikatz.exe 放在任意目录绕过检测。
     * ---------------------------------------------------------- */
    if (EventData->ProcessName[0] != L'\0') {
        for (i = 0; i < DANGEROUS_TOOL_COUNT; i++) {
            if (ContainsSubstringI(EventData->ProcessName, g_DangerousToolNames[i])) {
                DbgPrint("[SecurityDriver] RuleEngine: HIGH - 危险工具名匹配: %ws → %ws\n",
                         EventData->ProcessName, g_DangerousToolNames[i]);
                EventData->Status = STATUS_BLOCKED;
                return RISK_HIGH;
            }
        }
    }

    /* ----------------------------------------------------------
     *  规则 2（HIGH）：命令行包含高危关键词
     *
     *  命令行为空（NULL 或全零）时跳过，避免误判系统早期进程。
     * ---------------------------------------------------------- */
    if (EventData->CommandLine[0] != L'\0') {
        for (i = 0; i < DANGEROUS_CMD_COUNT; i++) {
            if (ContainsSubstringI(EventData->CommandLine, g_DangerousCmdKeywords[i])) {
                DbgPrint("[SecurityDriver] RuleEngine: HIGH - 命令行高危关键词: %ws\n",
                         g_DangerousCmdKeywords[i]);
                EventData->Status = STATUS_BLOCKED;
                return RISK_HIGH;
            }
        }
    }

    /* ----------------------------------------------------------
     *  规则 3（HIGH）：未签名 + 路径在可疑目录
     *
     *  IsSigned == SIGN_UNSIGNED（目前恒为 SIGN_UNKNOWN，
     *  此条件暂时不会触发，待后续签名验证接入后生效）
     * ---------------------------------------------------------- */
    if (EventData->IsSigned == SIGN_UNSIGNED && EventData->ProcessPath[0] != L'\0') {
        for (i = 0; i < SUSPICIOUS_PATH_COUNT; i++) {
            if (StartsWithI(EventData->ProcessPath, g_SuspiciousPaths[i])) {
                DbgPrint("[SecurityDriver] RuleEngine: HIGH - 未签名 + 可疑路径: %ws\n",
                         EventData->ProcessPath);
                EventData->Status = STATUS_BLOCKED;
                return RISK_HIGH;
            }
        }
    }

    /* ----------------------------------------------------------
     *  规则 4（LOW）：路径在受信任系统目录
     *
     *  注意：此规则在 HIGH 规则之后，防止攻击者将恶意工具
     *  放入 System32 后被误判为低风险（规则 1 已优先命中）。
     * ---------------------------------------------------------- */
    if (EventData->ProcessPath[0] != L'\0') {
        for (i = 0; i < TRUSTED_PATH_COUNT; i++) {
            if (StartsWithI(EventData->ProcessPath, g_TrustedPaths[i])) {
                DbgPrint("[SecurityDriver] RuleEngine: LOW - 受信任路径: %ws\n",
                         EventData->ProcessPath);
                EventData->Status = STATUS_ALLOWED;
                return RISK_LOW;
            }
        }
    }

    /* ----------------------------------------------------------
     *  规则 5（LOW）：父进程是已知可信进程
     *
     *  例如用户双击启动的程序，父进程是 explorer.exe，
     *  通常不需要重点关注。
     * ---------------------------------------------------------- */
    if (EventData->ParentProcessName[0] != L'\0') {
        for (i = 0; i < TRUSTED_PARENT_COUNT; i++) {
            if (ContainsSubstringI(EventData->ParentProcessName, g_TrustedParentNames[i])) {
                DbgPrint("[SecurityDriver] RuleEngine: LOW - 可信父进程: %ws\n",
                         EventData->ParentProcessName);
                EventData->Status = STATUS_ALLOWED;
                return RISK_LOW;
            }
        }
    }

    /* ----------------------------------------------------------
     *  默认：MEDIUM
     *  不在任何已知规则范围内，交由 LLM 进一步研判
     * ---------------------------------------------------------- */
    DbgPrint("[SecurityDriver] RuleEngine: MEDIUM - 无命中规则, 进程名: %ws\n",
             EventData->ProcessName);
    return RISK_MEDIUM;
}
