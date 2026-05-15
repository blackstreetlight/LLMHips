#!/usr/bin/env python3
"""
Comprehensive extraction of seeds from Sysmon EventID=1 records.
Appends new seeds to existing seeds.json.
"""

import json
import os
import re
import glob
from collections import defaultdict

BASE_DIR = '/Users/ludeng/MyProject/TraeProject/LLMHips/LLM/QwenLLM/FewShot'
M_JSON_DIR = os.path.join(BASE_DIR, 'm_Json')
SEEDS_FILE = os.path.join(BASE_DIR, 'seeds.json')

# ── Category → technique / risk / verdict ──────────────────────────────────
CATEGORIES = [
    '01_process_injection',
    '02_credential_access',
    '03_privilege_escalation',
    '04_defense_evasion_lolbins',
    '05_log_tampering',
]

# Default per-category settings (may be overridden per-file below)
CAT_DEFAULTS = {
    '01_process_injection':       ('T1055',    'BLOCK', (85, 92)),
    '02_credential_access':       ('T1003',    'BLOCK', (90, 97)),
    '03_privilege_escalation':    ('T1548.002','BLOCK', (82, 88)),
    '04_defense_evasion_lolbins': ('T1218',    'BLOCK', (78, 87)),
    '05_log_tampering':           ('T1562.002','BLOCK', (75, 83)),
}

# File-name keyword → override technique (matched via substring)
FILE_TECHNIQUE_MAP = {
    # process injection sub-types
    'herpaderping':  'T1055.013',
    'dllinjection':  'T1055.001',
    'psinject':      'T1055.002',
    'pe_injection':  'T1055.002',
    'mavinject':     'T1055.001',
    'wuauclt':       'T1055.003',
    # credential access sub-types
    'lsass':         'T1003.001',
    'sam':           'T1003.002',
    'ntds':          'T1003.003',
    'lsa_secrets':   'T1003.004',
    'dcsync':        'T1003.006',
    'rubeus':        'T1003.006',
    # privilege escalation
    'service_mod':   'T1543.003',
    'fodhelper':     'T1548.002',
    # lolbins
    'mshta':         'T1218.005',
    'regsvr32':      'T1218.010',
    'installutil':   'T1218.004',
    'cmstp':         'T1218.003',
    'control_panel': 'T1218.002',
    'hh_':           'T1218.001',
    'wmic':          'T1047',
    'bitsadmin':     'T1197',
    'netsh':         'T1562.004',
    'wscript':       'T1059.005',
    'cscript':       'T1059.005',
    # log tampering
    'wevtutil':      'T1070.001',
    'auditpol':      'T1562.002',
}

# CommandLine keyword → override technique (for process-level detection)
CMD_TECHNIQUE_MAP = {
    'mshta':       'T1218.005',
    'regsvr32':    'T1218.010',
    'installutil': 'T1218.004',
    'cmstp':       'T1218.003',
    'hh.exe':      'T1218.001',
    'wmic':        'T1047',
    'bitsadmin':   'T1197',
    'netsh':       'T1562.004',
    'wscript':     'T1059.005',
    'cscript':     'T1059.005',
    'wevtutil':    'T1070.001',
    'auditpol':    'T1562.002',
    'vssadmin':    'T1003.003',
    'ntdsutil':    'T1003.003',
    'sekurlsa':    'T1003.001',
    'lsadump::sam': 'T1003.002',
    'lsadump::dcsync': 'T1003.006',
    'lsadump::lsa':    'T1003.004',
    'dumpert':     'T1003.001',
    'comsvcs':     'T1003.001',
    'minidump':    'T1003.001',
    'esentutl':    'T1003.002',
    'ninjacopy':   'T1003.003',
}

SIGNED_PREFIXES = (
    'C:\\Windows\\System32',
    'C:\\Windows\\SysWOW64',
    'C:\\Windows\\Microsoft.NET',
    'C:\\Program Files\\',
    'C:\\Program Files (x86)\\',
)


def is_signed(path: str) -> bool:
    if not path:
        return False
    norm = path.replace('/', '\\')
    return any(norm.lower().startswith(p.lower()) for p in SIGNED_PREFIXES)


def process_name_from_path(path: str) -> str:
    """Extract basename from a Windows path."""
    return path.replace('\\', '/').split('/')[-1].lower()


def get_technique(cat: str, filename: str, cmd: str) -> str:
    fname_lower = filename.lower()
    cmd_lower = cmd.lower()

    # File-level override (most specific)
    for kw, tech in FILE_TECHNIQUE_MAP.items():
        if kw in fname_lower:
            return tech

    # Command-line keyword override
    for kw, tech in CMD_TECHNIQUE_MAP.items():
        if kw in cmd_lower:
            return tech

    return CAT_DEFAULTS[cat][0]


def get_risk(cat: str, technique: str) -> int:
    lo, hi = CAT_DEFAULTS[cat][2]
    # Higher risk for more severe techniques
    high_risk = {'T1003.001', 'T1003.006', 'T1003.002', 'T1055.013'}
    mid_risk  = {'T1003.003', 'T1003.004', 'T1055.001', 'T1055.002', 'T1548.002'}
    if technique in high_risk:
        return hi
    if technique in mid_risk:
        return hi - 2
    return (lo + hi) // 2


def truncate_cmdline(cmd: str) -> str:
    if len(cmd) <= 300:
        return cmd
    # Check for base64 blob
    b64_pattern = re.compile(r'[A-Za-z0-9+/=]{40,}')
    if b64_pattern.search(cmd):
        return cmd[:200] + '[base64截断]'
    return cmd[:300]


def make_summary(proc_name: str, cmd: str, cat: str, technique: str) -> str:
    """Generate a concise Chinese summary ≤40 chars."""
    cmd_l = cmd.lower()
    pname = proc_name.lower().replace('.exe', '')

    # Category-specific summaries
    if cat == '05_log_tampering':
        if 'wevtutil' in cmd_l:
            if ' cl ' in cmd_l or 'clear' in cmd_l:
                m = re.search(r'wevtutil\s+cl\s+(\S+)', cmd_l)
                log = m.group(1).strip('"') if m else 'Security'
                return f'wevtutil cl {log}清除事件日志，消除攻击痕迹'[:40]
            elif 'sl' in cmd_l:
                return 'wevtutil sl 修改安全事件日志路径，规避检测'[:40]
            return 'wevtutil 操纵Windows事件日志，消除攻击痕迹'[:40]
        if 'auditpol' in cmd_l:
            if '/set' in cmd_l:
                m = re.search(r'/category:"?([^"/]+)"?', cmd_l)
                cat_name = m.group(1)[:12] if m else '审计策略'
                return f'auditpol /set 禁用{cat_name}审计，使攻击无法被记录'[:40]
            return 'auditpol 修改审计策略，使攻击行为无法被记录'[:40]
        if 'reg' in cmd_l and ('start' in cmd_l or 'eventlog' in cmd_l):
            if 'start' in cmd_l:
                return 'reg 禁用EventLog服务开机启动，重启后停止日志记录'[:40]
            return 'reg 修改注册表禁用事件日志服务'[:40]
        if 'sc' in cmd_l and 'eventlog' in cmd_l:
            return 'sc 停止EventLog服务，禁止系统安全日志记录'[:40]
        if 'minint' in cmd_l or 'controlset' in cmd_l:
            return f'{pname} 修改MinInt注册表键停止事件日志记录'[:40]
        if 'net stop' in cmd_l and 'eventlog' in cmd_l:
            return 'net stop 停止Windows EventLog服务消除日志'[:40]
        if 'netsh' in cmd_l:
            return 'netsh 关闭Windows防火墙，解除网络防护'[:40]
        return f'{pname} 篡改日志配置，阻止安全审计记录'[:40]

    if cat == '04_defense_evasion_lolbins':
        if 'mshta' in cmd_l:
            if 'vbscript' in cmd_l:
                return 'mshta 通过VBScript执行恶意代码，绕过应用白名单'[:40]
            if 'javascript' in cmd_l or 'jscript' in cmd_l:
                return 'mshta 通过JavaScript远程加载SCT脚本执行'[:40]
            return 'mshta 执行HTML应用程序加载恶意payload'[:40]
        if 'regsvr32' in cmd_l:
            return 'regsvr32 通过scrobj.dll远程加载SCT脚本执行'[:40]
        if 'installutil' in cmd_l:
            return 'InstallUtil 利用.NET安装工具执行恶意程序集'[:40]
        if 'cmstp' in cmd_l:
            return 'cmstp 利用连接管理器安装程序加载恶意INF'[:40]
        if 'wmic' in cmd_l:
            if 'xsl' in cmd_l or 'format' in cmd_l:
                return 'wmic 通过XSL样式表远程执行JScript代码'[:40]
            if 'create' in cmd_l:
                return 'wmic process create 创建新进程执行攻击命令'[:40]
            return 'wmic 执行WMI命令进行横向移动或持久化'[:40]
        if 'bitsadmin' in cmd_l:
            return 'bitsadmin 利用BITS服务下载恶意PowerShell脚本'[:40]
        if 'netsh' in cmd_l:
            return 'netsh 修改防火墙规则开放端口，允许攻击流量'[:40]
        if 'hh.exe' in cmd_l or pname == 'hh':
            return 'hh.exe 加载本地HTML payload执行恶意代码'[:40]
        if 'control' in cmd_l:
            return 'control.exe 加载恶意.cpl文件执行任意代码'[:40]
        if 'register-cimprovider' in cmd_l or 'cimprovider' in cmd_l:
            return 'Register-CimProvider 注册CIM提供程序加载恶意DLL'[:40]
        return f'{pname} 利用系统工具执行恶意代码，绕过检测'[:40]

    if cat == '02_credential_access':
        if 'sekurlsa' in cmd_l or 'logonpasswords' in cmd_l:
            return 'mimikatz sekurlsa 从内存读取明文凭据和哈希'[:40]
        if 'lsadump::dcsync' in cmd_l or 'dcsync' in cmd_l:
            return 'mimikatz DCSync 模拟域控复制拉取凭据哈希'[:40]
        if 'lsadump::sam' in cmd_l:
            return 'mimikatz lsadump::sam 转储本地SAM数据库凭据'[:40]
        if 'lsadump::lsa' in cmd_l:
            return 'mimikatz lsadump::lsa 提取LSA保存的服务密码'[:40]
        if 'comsvcs' in cmd_l or 'minidump' in cmd_l:
            return 'comsvcs MiniDump 通过系统DLL转储LSASS内存'[:40]
        if 'dumpert' in cmd_l:
            return 'dumpert 通过系统调用直接转储LSASS绕过EDR'[:40]
        if 'ntdsutil' in cmd_l:
            return 'ntdsutil 利用系统工具提取NTDS.dit域凭据数据库'[:40]
        if 'vssadmin' in cmd_l or 'shadow' in cmd_l:
            return 'vssadmin 通过卷影复制绕过锁定提取NTDS.dit'[:40]
        if 'esentutl' in cmd_l:
            return 'esentutl 复制受锁SAM数据库文件进行离线破解'[:40]
        if 'ninjacopy' in cmd_l:
            return 'NinjaCopy 绕过文件锁定复制NTDS.dit域数据库'[:40]
        if 'reg save' in cmd_l and ('sam' in cmd_l or 'system' in cmd_l):
            return 'reg save 导出SAM和SYSTEM注册表蜂提取凭据'[:40]
        if 'rubeus' in cmd_l:
            if 'asktgt' in cmd_l and 'ptt' in cmd_l:
                return 'Rubeus asktgt+ptt 申请Kerberos票据传递认证'[:40]
            if 'createnetonly' in cmd_l:
                return 'Rubeus createnetonly 创建仅网络登录会话传递票据'[:40]
            return 'Rubeus 操纵Kerberos票据进行横向移动'[:40]
        if 'backupkeys' in cmd_l:
            return 'mimikatz dpapi::backupkeys 提取DPAPI域主密钥'[:40]
        if 'psexec' in cmd_l:
            return 'PsExec 远程转储LSA Secrets注册表中的密码'[:40]
        if 'taskmgr' in cmd_l or 'taskmanager' in cmd_l.replace('_', ''):
            return '任务管理器交互式转储LSASS进程内存凭据'[:40]
        if 'vault' in cmd_l:
            return 'PowerShell 提取Windows Vault保存的Web凭据'[:40]
        if 'promptforcreds' in cmd_l:
            return 'PowerShell 弹出伪造凭据对话框捕获用户密码'[:40]
        return f'{pname} 提取系统凭据数据，获取账户访问权限'[:40]

    if cat == '03_privilege_escalation':
        if 'fodhelper' in cmd_l or 'uac' in cmd_l.replace('_',''):
            return f'{pname} 利用fodhelper UAC绕过获取高权限'[:40]
        if 'sc' in cmd_l and ('config' in cmd_l or 'create' in cmd_l):
            return f'sc 修改Fax服务配置实现服务提权持久化'[:40]
        return f'{pname} 提升系统权限绕过UAC安全限制'[:40]

    if cat == '01_process_injection':
        if 'herpaderping' in cmd_l or 'herpaderping' in pname:
            return 'ProcessHerpaderping 伪装进程欺骗安全扫描注入恶意代码'[:40]
        if 'mavinject' in cmd_l or pname == 'mavinject':
            return 'mavinject.exe 将恶意DLL注入合法进程逃避检测'[:40]
        if 'wuauclt' in pname:
            return 'wuauclt.exe 利用更新客户端CreateRemoteThread注入'[:40]
        if 'loadlibrary' in cmd_l or 'createremotethread' in cmd_l.replace('_',''):
            return f'{pname} LoadLibrary+CreateRemoteThread远程DLL注入'[:40]
        return f'{pname} 将恶意代码注入合法进程内存中执行'[:40]

    return f'{pname} 执行恶意操作，威胁系统安全'[:40]


def get_parent(record: dict) -> str:
    pp = record.get('ParentImage') or record.get('ParentProcessName') or ''
    if pp:
        return pp.replace('/', '\\').split('\\')[-1]
    return None


def cmd_key(cmd: str) -> str:
    """Return first 80 chars of CommandLine as dedup key."""
    return cmd.strip()[:80]


def load_existing_seeds() -> list:
    with open(SEEDS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_existing_keys(seeds: list) -> set:
    keys = set()
    for s in seeds:
        pname = (s.get('process_name') or '').lower()
        cmd   = (s.get('cmd_line') or '')
        keys.add((pname, cmd_key(cmd)))
    return keys


def extract_records_from_file(filepath: str, cat: str) -> list:
    """Read all EventID=1 records with Image+CommandLine from a single NDJSON file."""
    records = []
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get('EventID') != 1:
                continue
            image = r.get('Image', '')
            cmd   = r.get('CommandLine', '')
            if not image or not cmd:
                continue
            records.append(r)
    return records


def pick_diverse(records: list, cat: str, filename: str,
                 existing_keys: set, global_seen: set,
                 max_per_file: int = 5) -> list:
    """
    Pick up to max_per_file diverse records from a file's EventID=1 set.
    Diversity: prefer different process_name values; if same, require cmd differs
    beyond first 80 chars.
    """
    fname = os.path.basename(filename).lower()
    chosen = []
    seen_proc = defaultdict(list)  # proc_name → [cmd80s]

    # Prioritise records by "interestingness":
    # - records with longer / richer CommandLine first
    # - avoid boring conhost/wmiprvse unless they're the only option
    # Processes that are definitely benign Windows services captured as noise
    # These appear in logs as context but are NOT attacker-controlled
    noise_procs = {
        'conhost.exe', 'wmiprvse.exe', 'svchost.exe', 'smartscreen.exe',
        'werfault.exe', 'dllhost.exe', 'searchprotocolhost.exe',
        'sppsvc.exe', 'trustedinstaller.exe', 'tiworker.exe', 'taskhostw.exe',
        'searchindexer.exe', 'services.exe', 'lsass.exe',
        'wininit.exe', 'csrss.exe', 'winlogon.exe', 'explorer.exe',
        'consent.exe', 'dwm.exe', 'fontdrvhost.exe', 'lsm.exe',
        # browser and update noise
        'msedge.exe', 'chrome.exe', 'firefox.exe', 'iexplore.exe',
        'identity_helper.exe', 'msedgewebview2.exe',
        # system diagnostic noise
        'wermgr.exe', 'werhost.exe',
        # Windows update context processes
        'launcher.exe',  # often a context process not the attacker tool
        'msiexec.exe',
    }

    # Attacker-interesting keywords that override the noise list
    attacker_keywords = [
        'mimikatz', 'meterpreter', 'cobalt', 'covenant', 'empire',
        'sekurlsa', 'lsadump', 'dcsync', 'rubeus', 'kerberos',
        'powersploit', 'ninjacopy', 'dumpert', 'mavinject',
        '/set /category', '/set /subcategory', '/set /user',  # auditpol
        'wevtutil', 'auditpol',
        'minint', 'controlset', 'eventlog',
        'ntdsutil', 'vssadmin', 'esentutl',
        'wmic', 'mshta', 'regsvr32', 'cmstp', 'installutil', 'bitsadmin',
        'hh.exe', 'certutil', 'bcedit', 'bcdedit',
    ]

    # Noise command-line patterns — clearly not attacker-issued invocations
    noise_cmd_patterns = [
        r'^\s*\\?\?\\?[A-Za-z]:\\[Ww]indows\\[Ss]ystem32\\conhost\.exe\s+0x',
        r'^\s*[A-Za-z]:\\[Ww]indows\\[Ss]ystem32\\sppsvc\.exe\s*$',
        r'^\s*[A-Za-z]:\\[Ww]indows\\[Ss]ystem32\\wbem\\[Ww]mi[Pp]rv[Ss][Ee]\.exe\s+-(?:Embedding|secured)',
        r'^\s*[A-Za-z]:\\[Ww]indows\\servicing\\[Tt]rusted[Ii]nstaller\.exe\s*$',
        r'^\s*[A-Za-z]:\\[Ww]indows\\[Ww]in[Ss]x[Ss]\\.*\\[Tt]i[Ww]orker\.exe\s',
        r'^taskhostw\.exe\s+Install\s+\$',
        r'^smartscreen\.exe\s+-Embedding',
        r'^consent\.exe\s+\d+',
        r'--type=gpu-process',
        r'--type=renderer',
        r'msedge.*--disable-features',
        r'identity_helper.*--type=',
        r'WerFault\.exe\s+-pss\s',      # crash reporting
        r'WerFault\.exe\s+-u\s+-p\s',
        r'^svchost\.exe\s+-k\s',
        r'^[A-Za-z]:\\[Ww]indows\\[Ss]ystem32\\svchost\.exe\s+-k\s',
        r'C:\\[Ww]indows\\[Ss]ystem32\\svchost\.exe\s+-k\s',
    ]
    import re as _re
    noise_patterns_compiled = [_re.compile(p, _re.IGNORECASE) for p in noise_cmd_patterns]

    def is_noise(r):
        pname = process_name_from_path(r['Image'])
        cmd = r['CommandLine']
        cmd_l = cmd.lower()

        # Check if cmd contains attacker-interesting keywords → always keep
        for kw in attacker_keywords:
            if kw in cmd_l:
                return False

        # Noise patterns always mark as noise regardless of process name
        for pat in noise_patterns_compiled:
            if pat.search(cmd):
                return True

        # If the process is in our noise list
        if pname in noise_procs:
            return True

        # Generic: very short cmd that's just a path invocation of a system binary
        stripped = cmd.strip().strip('"')
        if (len(stripped) < 80
                and stripped.lower().startswith(('c:\\windows', 'c:\\program files'))
                and ' ' not in stripped.replace('"', '')):
            # bare system binary path, no arguments → likely noise
            return True

        return False

    def score(r):
        pname = process_name_from_path(r['Image'])
        cmd = r['CommandLine']
        s = len(cmd)
        if pname in noise_procs:
            s -= 200
        return s

    records_sorted = sorted(records, key=score, reverse=True)

    for r in records_sorted:
        if is_noise(r):
            continue
        if len(chosen) >= max_per_file:
            break
        pname = process_name_from_path(r['Image'])
        cmd   = r['CommandLine']
        ck    = cmd_key(cmd)

        # Skip if already in existing seeds
        if (pname, ck) in existing_keys:
            continue
        # Skip if already picked this session
        if (pname, ck) in global_seen:
            continue

        # Diversity check: if same proc already chosen, cmd must differ significantly
        if pname in seen_proc:
            too_similar = False
            for prev_ck in seen_proc[pname]:
                # If they share >60% of first 80 chars, skip
                if ck[:60] == prev_ck[:60]:
                    too_similar = True
                    break
            if too_similar:
                continue

        chosen.append(r)
        seen_proc[pname].append(ck)
        global_seen.add((pname, ck))

    return chosen


def record_to_seed(r: dict, cat: str, filename: str) -> dict:
    image   = r['Image']
    cmd_raw = r['CommandLine']
    cmd     = truncate_cmdline(cmd_raw)
    pname   = process_name_from_path(image)
    parent  = get_parent(r)
    fname   = os.path.basename(filename).lower()
    tech    = get_technique(cat, fname, cmd_raw)
    risk    = get_risk(cat, tech)
    signed  = is_signed(image)
    summary = make_summary(pname, cmd_raw, cat, tech)

    return {
        "process_name":    pname,
        "process_path":    image,
        "parent_process":  parent,
        "cmd_line":        cmd,
        "is_signed":       signed,
        "verdict":         "BLOCK",
        "risk_score":      risk,
        "attack_technique": tech,
        "summary":         summary,
        "network_info":    None,
        "file_ops":        None,
        "registry_ops":    None,
        "extra":           None,
    }


def main():
    print("Loading existing seeds...")
    existing_seeds = load_existing_seeds()
    print(f"  Existing seeds: {len(existing_seeds)}")

    existing_keys = build_existing_keys(existing_seeds)
    global_seen   = set(existing_keys)  # track across ALL files this run

    new_seeds = []
    cat_stats = {}

    for cat in CATEGORIES:
        cat_dir = os.path.join(M_JSON_DIR, cat)
        files = sorted(glob.glob(os.path.join(cat_dir, '*.json')))
        cat_new = 0

        for filepath in files:
            records = extract_records_from_file(filepath, cat)
            if not records:
                continue

            chosen = pick_diverse(records, cat, filepath,
                                  existing_keys, global_seen, max_per_file=5)
            seeds = [record_to_seed(r, cat, filepath) for r in chosen]
            new_seeds.extend(seeds)
            cat_new += len(seeds)

            if seeds:
                print(f"  [{cat}] {os.path.basename(filepath)}: "
                      f"+{len(seeds)} (from {len(records)} records)")

        cat_stats[cat] = cat_new
        print(f"  ── Category {cat}: +{cat_new} new seeds ──\n")

    combined = existing_seeds + new_seeds
    total = len(combined)

    print(f"\nWriting {total} seeds to {SEEDS_FILE} ...")
    with open(SEEDS_FILE, 'w', encoding='utf-8') as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)
    print("Done.\n")

    print("=" * 60)
    print(f"SUMMARY")
    print("=" * 60)
    print(f"  Original seeds:   {len(existing_seeds)}")
    print(f"  New seeds added:  {len(new_seeds)}")
    print(f"  Total:            {total}")
    print()
    print("Breakdown by category:")
    for cat, cnt in cat_stats.items():
        print(f"  {cat}: +{cnt}")

    # Verify
    with open(SEEDS_FILE, 'r', encoding='utf-8') as f:
        verify = json.load(f)
    print(f"\nVerification: seeds.json is valid JSON with {len(verify)} entries.")


if __name__ == '__main__':
    main()
