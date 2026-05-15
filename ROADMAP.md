# LLMHips 下一阶段工程规划

> 基于当前工程完整代码审阅后的技术规划文档。  
> 评估维度：**难度 / 价值 / 依赖关系 / 设计思路 / 关键障碍**

---

## 当前系统架构概述（问题识别基础）

```
驱动层 (C)          C#桥接层              React前端           Python LLM
ProcessCallback  →  Worker轮询  →  WebSocket → Zustand  →  /chat SSE
仅监控进程创建      IOCTL轮询             事件列表              分析+RAG
RuleEngine评分      事件广播              研判对话
```

**当前核心限制：**
- 驱动仅捕获进程创建/退出，`DRIVER_EVENT_BUFFER` 中 `CommandLine` 字段已有但其他遥测缺失
- LLM 是「被动分析器」，无法主动发起任何操作
- 单 Agent 架构，无分工协同
- 案例库 100 条种子，覆盖面有限但检索逻辑健全
- WebSocket 无认证，无双向终端通道

---

## 方向一：驱动扩展

> **核心论断：驱动获取的信息量是整个系统的天花板。进程创建只是冰山一角。**

### 难度评级：⭐⭐⭐⭐⭐（最高）

### 当前驱动采集字段（`Common.h` / `DRIVER_EVENT_BUFFER`）

```c
Pid, ParentPid          // 进程标识
ProcessName/Path        // 进程路径（260字符）
CommandLine             // 命令行（1024字符）
ParentProcessName/Path  // 父进程
IsSigned                // 签名状态（WinVerifyTrust）
RiskLevel               // 启发式评分
Timestamp               // 创建时间
```

### 可以扩展的采集维度

#### 1.1 文件系统监控（难度 ⭐⭐⭐⭐）

**采集目标：**
- 敏感文件写入：`%APPDATA%`、`%TEMP%`、`C:\Windows\System32` 等
- 注册表持久化键位：`HKLM\...\Run`、`Winlogon\Userinit` 等
- 可执行文件投放：新增 `.exe/.dll/.ps1/.vbs/.bat` 文件创建

**实现方式：**
```c
// 使用 FltRegisterFilter 注册文件系统微筛选器驱动
// 监控 IRP_MJ_CREATE（文件创建）、IRP_MJ_WRITE（写入）
// 关注 Pre/Post 操作回调
FltRegisterFilter(DriverObject, &FilterRegistration, &FilterHandle);
```

**障碍：**
- 需要额外的 `INF` 安装文件和驱动签名
- 文件筛选器驱动与进程监控驱动需要共存（可合并为一个驱动包）
- 性能：文件 IO 频率极高，需严格过滤避免风暴

---

#### 1.2 注册表监控（难度 ⭐⭐⭐）

**采集目标：**
- Run 键写入（自启动持久化）
- 服务创建（`HKLM\SYSTEM\CurrentControlSet\Services`）
- IFEO（映像劫持：`Image File Execution Options`）
- Winlogon 键篡改

**实现方式：**
```c
// CmRegisterCallback — 注册表操作回调
// 在 RegNtPreSetValueKey 中过滤高危键路径
CmRegisterCallbackEx(RegistryCallback, &Altitude, DriverObject, NULL, &Cookie, NULL);
```

**障碍：**
- 注册表回调触发频率非常高，需要精细的路径匹配过滤
- 部分键路径需要区分 HKCU（各用户独立）与 HKLM

---

#### 1.3 网络连接监控（难度 ⭐⭐⭐⭐⭐）

**采集目标：**
- 进程发起的 TCP/UDP 连接（五元组：源IP、源Port、目标IP、目标Port、协议）
- DNS 查询（域名解析行为）
- 可疑 C2 通信（连接到 IP 信誉黑名单）

**实现方式：**
```c
// 方案A：WFP（Windows Filtering Platform）Callout 驱动
// 在 FWPM_LAYER_ALE_FLOW_ESTABLISHED_V4 层注册
FwpsCalloutRegister(DeviceObject, &callout, &CalloutId);

// 方案B：NDIS 轻量筛选器驱动（更底层，更复杂）
```

**障碍：**
- WFP 是 Windows 正式推荐的网络过滤接口，但 API 学习曲线陡
- 需要额外的驱动签名（网络驱动签名要求更严格）
- DNS 监控需要在更高层捕获（可通过 ETW 消费替代驱动方案）

---

#### 1.4 内存注入检测（难度 ⭐⭐⭐⭐⭐）

**采集目标：**
- `CreateRemoteThread` / `NtCreateThreadEx` 跨进程线程创建
- `WriteProcessMemory` 跨进程内存写入
- `VirtualAllocEx` 远程内存分配

**实现方式：**
```c
// 通过 PsSetCreateThreadNotifyRoutine 监控线程创建
// 通过 SSDT Hook 或 Kernel Patch Guard（需绕过 PatchGuard）监控系统调用
// 推荐：用 ETW（Event Tracing for Windows）消费 Microsoft-Windows-Kernel-Process
```

**障碍：**
- PatchGuard 保护 SSDT，直接 Hook 会 BSOD
- ETW 替代方案：从用户态消费内核 ETW Provider，无需驱动修改

---

#### 1.5 ETW 驱动外挂方案（推荐优先实现，难度 ⭐⭐）

ETW 是微软官方提供的遥测框架，无需内核 Hooking，在用户态即可获取大量内核级事件：

```csharp
// 在 C# 中间层用 Microsoft.Diagnostics.Tracing.TraceEvent 订阅
var session = new TraceEventSession("LLMHips-ETW");
session.EnableKernelProvider(
    KernelTraceEventType.NetworkTCPIP |   // 网络
    KernelTraceEventType.FileIO |          // 文件
    KernelTraceEventType.Registry          // 注册表
);
session.Source.Dynamic.All += evt => BroadcastToWebSocket(evt);
```

**优势：**
- 不需要额外的驱动签名
- 覆盖面极广（Sysmon 本质就是 ETW 消费者）
- 可在现有 C# 中间层直接扩展

**障碍：**
- ETW 事件量极大，需要高效过滤管道
- 与驱动事件需要关联聚合（通过 PID + 时间窗口）

---

#### 数据结构扩展方向

```c
// 扩展 DRIVER_EVENT_BUFFER（或新增事件类型）
typedef struct {
    ULONG EventType;   // 新增: EVENT_TYPE_REGISTRY / FILE / NETWORK / THREAD
    ULONG Pid;
    union {
        struct { WCHAR TargetPath[260]; ULONG Operation; } FileEvent;
        struct { WCHAR KeyPath[260]; WCHAR ValueName[128]; } RegEvent;
        struct { ULONG RemoteIp; USHORT RemotePort; UCHAR Protocol; } NetEvent;
        struct { ULONG TargetPid; ULONGLONG BaseAddress; } InjectionEvent;
    };
} DRIVER_EVENT_BUFFER_V2;
```

---

## 方向二：Skill 开发

> **核心论断：Agent 应该有「工具手」，而不仅仅是「嘴」。当前 Agent 只能输出文字建议，无法执行任何操作。**

### 难度评级：⭐⭐⭐（中等）

### 设计思路

参考 LLM Function Calling / Tool Use 架构，为 Agent 定义一组可调用的 Skill，后端在流式响应中解析工具调用意图并执行。

#### 2.1 Skill 架构设计

```python
# server.py 扩展：Skill注册表
SKILLS = {
    "query_process_history": {
        "description": "查询指定进程名的历史研判记录",
        "parameters": { "process_name": "string", "limit": "int" }
    },
    "search_case_library": {
        "description": "在案例库中搜索相似进程行为",
        "parameters": { "query": "string", "k": "int" }
    },
    "lookup_mitre": {
        "description": "查询 MITRE ATT&CK 技术详情",
        "parameters": { "technique_id": "string" }
    },
    "check_ip_reputation": {
        "description": "查询 IP 地址的威胁情报",
        "parameters": { "ip": "string" }
    },
    "query_file_hash": {
        "description": "查询文件哈希在 VirusTotal 的记录",
        "parameters": { "hash": "string" }
    },
    "send_block_command": {
        "description": "向中间层发送阻断指令（需要人工确认）",
        "parameters": { "pid": "int", "reason": "string" }
    }
}
```

#### 2.2 Skill 执行流程

```
用户追问 → LLM 推理
  → 模型输出包含 <tool_call> 标签
  → server.py 解析标签，执行对应 Skill
  → 结果注入到下一轮 Prompt
  → 继续流式输出给前端
```

#### 2.3 可实现的具体 Skill

| Skill | 实现来源 | 难度 |
|-------|---------|------|
| 案例库相似检索 | 已有 `retrieve_top_k()` 直接复用 | ⭐ |
| MITRE ATT&CK 查询 | 下载 enterprise-attack.json 本地检索 | ⭐⭐ |
| 历史研判记录查询 | 查 SQLite cases 表 | ⭐ |
| IP 信誉查询 | 调用 AbuseIPDB / VirusTotal API | ⭐⭐ |
| 文件哈希查询 | VirusTotal API | ⭐⭐ |
| 进程关系图构建 | 从 events[] 中关联父子进程 | ⭐⭐ |
| Whois 域名查询 | python-whois 库 | ⭐ |
| 阻断指令（需确认）| 回调到 WebSocket 发 driver_command | ⭐⭐⭐ |

#### 2.4 前端适配

```tsx
// 识别 AI 输出中的 Skill 调用结果，特殊渲染
// 例如：MITRE查询结果渲染为卡片，IP信誉渲染为红/绿标签
{msg.skillResults?.map(r => <SkillResultCard key={r.skill} data={r} />)}
```

**障碍：**
- 模型输出格式不稳定，Tool Call 解析需要鲁棒的正则 + 重试
- 需要防范「幻觉工具调用」（模型编造不存在的 Skill）
- 阻断类 Skill 必须强制人工二次确认，不能自动执行

---

## 方向三：Agent 扩展（多 Agent 架构）

> **核心论断：单 Agent 既要分析进程，又要关联威胁情报，又要给处置建议，认知负担过重。专业分工才能产生更深洞察。**

### 难度评级：⭐⭐⭐⭐（高）

### 设计思路：多 Agent 协作框架

```
┌─────────────────────────────────────────────────────────┐
│                   Orchestrator Agent                      │
│  职责：任务分发、结果聚合、最终研判                        │
│  输入：进程事件                                           │
│  输出：综合研判报告 + 处置建议                            │
└────┬────────────────────────────────────────────────────┘
     │ 并行分发任务
     ├──────────────────────────────────────────┐
     ↓                                          ↓
┌────────────────────┐              ┌───────────────────────┐
│  行为分析 Agent     │              │  威胁情报 Agent        │
│  职责：             │              │  职责：                │
│  - 命令行解析        │              │  - IP/域名情报查询     │
│  - 进程链评估        │              │  - 文件哈希 VirusTotal │
│  - ATT&CK 映射      │              │  - CVE 漏洞关联        │
│  - 内存注入评估      │              │  - APT 组织归因        │
└────────────────────┘              └───────────────────────┘
     ↓                                          ↓
     └──────────────┐          ┌────────────────┘
                    ↓          ↓
              ┌─────────────────────┐
              │  规则核验 Agent      │
              │  职责：              │
              │  - 白名单比对        │
              │  - 历史案例检索      │
              │  - 误报概率评估      │
              └─────────────────────┘
                         ↓
              ┌─────────────────────┐
              │  处置推荐 Agent      │
              │  职责：              │
              │  - 整合三方结论      │
              │  - 生成处置建议      │
              │  - 风险评分（0-100）  │
              └─────────────────────┘
```

#### 3.1 实现策略

**方案 A：顺序链（Sequential Chain）— 低成本起步**
```python
# server.py 扩展
async def multi_agent_analysis(event_context):
    # Step 1: 行为分析
    behavior_report = await run_agent("behavior", event_context)
    # Step 2: 情报查询（可并行）
    intel_report = await run_agent("intel", event_context)
    # Step 3: 综合研判
    final = await run_agent("orchestrator", behavior_report, intel_report)
    yield from final  # SSE流式输出
```

**方案 B：并行任务（Parallel Tasks）— 更快响应**
```python
behavior_task = asyncio.create_task(run_agent("behavior", ctx))
intel_task = asyncio.create_task(run_agent("intel", ctx))
behavior_report, intel_report = await asyncio.gather(behavior_task, intel_task)
```

#### 3.2 Agent 间通信协议

```json
{
  "agent_id": "behavior_analyzer",
  "input": { "process_event": {...} },
  "output": {
    "risk_indicators": ["命令行含 -enc", "父进程为 Office"],
    "attack_techniques": ["T1059.001", "T1566.001"],
    "confidence": 0.87
  }
}
```

#### 3.3 前端适配

```tsx
// 显示多 Agent 分析过程（类似 Chain of Thought 可视化）
<AgentPipelineView>
  <AgentStep name="行为分析" status="done" result={...} />
  <AgentStep name="情报查询" status="running" />
  <AgentStep name="综合研判" status="pending" />
</AgentPipelineView>
```

**障碍：**
- Token 消耗成倍增加（多次 LLM 调用），本地模型延迟会叠加
- 各 Agent 结论冲突时需要仲裁逻辑
- 系统 Prompt 需要为每个 Agent 角色精心设计，避免角色漂移
- 流式响应难以合并多 Agent 输出，需要前端支持分段显示

---

## 方向四：知识库扩充

> **核心论断：扩充知识库的关键不是「堆数据」，而是「精准检索」。在 Token 有限的情况下，只把最相关的知识注入 Prompt。**

### 难度评级：⭐⭐⭐（中等）

### 4.1 当前 RAG 现状

- 向量模型：`paraphrase-multilingual-MiniLM-L12-v2`（轻量，384维）
- 检索：Top-3 余弦相似度
- 案例库：100 条种子 + 人工回写案例
- 注入位置：System Prompt 末尾

### 4.2 知识库扩展方向

#### A. MITRE ATT&CK 本地知识库（不消耗 Token）

```python
# 下载 enterprise-attack.json（约12MB，4000+条技术）
# 构建本地向量索引（一次性）
import json

with open("enterprise-attack.json") as f:
    attack_data = json.load(f)

techniques = [
    {
        "id": t["external_references"][0]["external_id"],
        "name": t["name"],
        "description": t["description"],
        "platforms": t.get("x_mitre_platforms", []),
        "detection": t.get("x_mitre_detection", "")
    }
    for t in attack_data["objects"] if t["type"] == "attack-pattern"
]

# 向量化后存入独立 SQLite 表，检索时只取1-2条最相关技术
```

**效果：** 当检测到 `T1059.001` 时，自动注入该技术的检测方法和缓解建议，**不额外消耗 Token 查询**，2条技术描述约 800 Token。

---

#### B. 分层知识注入策略（Token 控制核心）

```python
def build_system_prompt(event_context, similar_cases, attack_techniques):
    prompt = SECURITY_SYSTEM_PROMPT  # ~2000 Token，固定成本
    
    # 层1：相似案例（最高优先级，Top-2，~400 Token）
    if similar_cases:
        prompt += format_cases(similar_cases[:2])
    
    # 层2：ATT&CK 技术详情（按相关性，Top-1，~400 Token）
    if attack_techniques:
        prompt += format_attack_technique(attack_techniques[0])
    
    # 层3：事件上下文（动态，~200 Token）
    prompt += format_event_context(event_context)
    
    # 总 System Prompt：~3000 Token（可控）
    return prompt
```

---

#### C. 知识库数据来源扩充

| 来源 | 内容 | 规模 | 获取方式 |
|------|------|------|---------|
| MITRE ATT&CK Enterprise | 攻击技术 | 4000+ 条 | 官方 JSON |
| OTRF Security Datasets | 真实 Sysmon 日志 | 数百 GB | 已有脚本扩展 |
| Sigma Rules | 检测规则 | 2000+ 条 | GitHub Sigma 仓库 |
| MalwareBazaar | 恶意软件样本元数据 | 百万级 | API 按需查询 |
| CISA KEV | 已知被利用漏洞 | 1000+ 条 | 官方 JSON |

---

#### D. 混合检索（BM25 + 向量）

```python
# 当前：纯向量检索（语义相似）
# 优化：BM25（关键词精确匹配） + 向量（语义相似）结合
from rank_bm25 import BM25Okapi

# BM25 对进程名、命令行关键词精确匹配效果更好
# 向量检索对行为模式语义匹配效果更好
# 两路结果 RRF（Reciprocal Rank Fusion）融合

def hybrid_retrieve(event, k=3):
    vector_results = retrieve_by_embedding(event, k*2)
    bm25_results = retrieve_by_bm25(event, k*2)
    return rrf_merge(vector_results, bm25_results)[:k]
```

**障碍：**
- MITRE ATT&CK JSON 解析需要处理复杂的 STIX2 格式
- BM25 索引需要在服务启动时预构建
- 注入 Token 总量需要严格控制（建议上限 3500 Token）

---

## 方向五：终端远程控制

> **核心论断：现有的「阻断」是原子操作。分析员需要的是「诊断环境」——能在目标机器上执行查询命令来收集更多证据。**

### 难度评级：⭐⭐⭐⭐（高）

### 5.1 系统架构设计

```
前端 Terminal UI (xterm.js)
    ↓ WebSocket (新 message type: "terminal_input")
C# 中间层 (新增 TerminalSession 管理)
    ↓ Process.Start() / Named Pipe
目标机器终端 (cmd.exe / PowerShell)
    ↑ stdout/stderr 实时回传
C# 中间层
    ↑ WebSocket ("terminal_output")
前端 Terminal UI (xterm.js 渲染)
```

### 5.2 前端实现（xterm.js）

```tsx
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const TerminalView: React.FC = () => {
  const termRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const term = new Terminal({ theme: { background: '#0d1117' } });
    term.onData(data => {
      // 发送到后端
      ws.send(JSON.stringify({ type: 'terminal_input', payload: { data } }));
    });
    // 接收后端输出
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'terminal_output') term.write(msg.payload.data);
    });
  }, []);
};
```

### 5.3 C# 中间层扩展

```csharp
// WebSocketHandler.cs 新增分支
case "terminal_input":
    await terminalSession.WriteAsync(payload.Data);
    break;

// 新增 TerminalSession 类
public class TerminalSession {
    private Process _shell;
    
    public void Start() {
        _shell = new Process {
            StartInfo = new ProcessStartInfo("powershell.exe") {
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            }
        };
        _shell.OutputDataReceived += async (s, e) =>
            await wsManager.BroadcastAsync(new { type = "terminal_output", payload = new { data = e.Data } });
        _shell.Start();
    }
}
```

### 5.4 安全设计（必须考虑）

```
认证层：
  - WebSocket 连接必须携带 Token（JWT 或预共享密钥）
  - 目前 WebSocket 完全无认证，开放终端前必须解决

命令白名单：
  - 限制可执行命令类型（只读查询：Get-Process、netstat、dir 等）
  - 禁止格式化、删除、系统修改类命令

审计日志：
  - 所有终端输入/输出持久化记录，带时间戳和操作人

沙箱隔离：
  - 受限用户权限运行 shell（非 SYSTEM 权限）
  - 资源限制（CPU/内存/超时）
```

**障碍：**
- 安全风险极高：未经保护的远程终端相当于后门
- xterm.js + WebSocket 双向流处理复杂（回车/退格/特殊字符编码）
- 多会话管理（多个分析员同时连接时终端隔离）
- 跨平台：macOS 开发环境 vs Windows 目标机器的 shell 差异

---

## 方向六：Agent 主动控制（自动化审计）

> **核心论断：当前系统是「被动响应」——等待人类审批。真正的 AISOC（AI Security Operations Center）应该是「主动巡查」——Agent 定期审计，自主发现异常。**

### 难度评级：⭐⭐⭐⭐⭐（最高，也是最有研究价值的方向）

### 6.1 自动化审计 Agent 设计

```python
class AuditAgent:
    """
    主动审计 Agent，定时运行或由触发器激活
    具备：自主规划 → 工具调用 → 结论输出 的能力
    """
    
    async def run_audit(self, trigger: str):
        # 1. 规划阶段：LLM 决定审计步骤
        plan = await self.llm.plan(f"针对 {trigger} 制定审计步骤")
        
        # 2. 执行阶段：按计划调用 Skill
        results = []
        for step in plan.steps:
            result = await self.execute_skill(step.skill, step.params)
            results.append(result)
            # 动态调整：根据中间结果决定下一步
            plan = await self.llm.replan(plan, result)
        
        # 3. 报告阶段
        report = await self.llm.summarize(results)
        await self.broadcast_report(report)
```

### 6.2 自动化审计场景

| 触发器 | 审计内容 | 自动动作 |
|--------|---------|---------|
| 新进程创建（高危） | 进程树遍历、父子关系分析、同PID历史 | 标记关注 |
| 定时（每30min） | 当前运行进程全扫描、异常进程检测 | 生成报告 |
| 案例库命中（>0.9） | 直接标记为已知威胁 | 发出告警 |
| 用户追问 | 执行相关查询 Skill、补充证据 | 更新结论 |

### 6.3 Plan-Execute-Observe 循环（ReAct 架构）

```
思考(Thought): 这个进程 mimikatz.exe 的父进程是 cmd.exe
行动(Action): query_process_history(process_name="mimikatz.exe")
观察(Observation): 历史记录：3次，均被阻断，verdict=BLOCK
思考(Thought): 已有历史阻断记录，高置信度恶意
行动(Action): search_case_library(query="凭据转储 lsass 内存")
观察(Observation): 匹配案例T1003.001，相似度0.94
思考(Thought): 直接触发阻断建议
输出: 高置信度威胁，建议立即阻断，附ATT&CK映射
```

### 6.4 人机协同约束（必须设计）

```
自动化程度分级：
  Level 0：纯建议（当前模式）
  Level 1：自动标记 + 等待人工确认
  Level 2：低风险自动放行 + 高风险人工审批
  Level 3：全自动（仅限测试环境，生产绝不开启）

每个自动动作都需要：
  - 操作日志（谁触发、什么时间、什么理由）
  - 撤销能力（白名单可快速移除阻断）
  - 告警升级（高置信度恶意 → 推送通知给管理员）
```

**障碍：**
- LLM 幻觉可能导致误报，误阻断合法进程后果严重
- ReAct 循环的终止条件设计（避免无限循环）
- 与现有单次分析模式的共存设计
- 自动化阻断的法律和合规风险（在企业环境需要审批流）

---

## 综合优先级推荐

> 综合**技术可行性 × 工程价值 × 实现时间**排序

| 优先级 | 方向 | 建议阶段 | 预计工期 | 核心价值 |
|--------|------|---------|---------|---------|
| 🥇 P0 | ETW 遥测扩展（方向一简化版） | 立即 | 2-3周 | 信息量 3x 提升，难度可控 |
| 🥇 P0 | Skill 开发（方向二） | 立即 | 1-2周 | Agent 能力质变，对毕设价值极高 |
| 🥈 P1 | MITRE ATT&CK 知识库（方向四） | 近期 | 1周 | 研判质量提升，Token零成本 |
| 🥈 P1 | 终端远程控制（方向五） | 近期 | 2-3周 | 演示亮点，完整闭环 |
| 🥉 P2 | 多 Agent 架构（方向三） | 中期 | 3-4周 | 架构升级，需要P0基础 |
| 🥉 P2 | 驱动深度扩展（方向一完整版） | 中期 | 4-6周 | 需 Windows 驱动环境 |
| 🏅 P3 | Agent 自动化控制（方向六） | 后期 | 4-8周 | 研究性强，需要全部基础 |

---

## 技术债务（建议同步解决）

| 问题 | 影响 | 解决方案 |
|------|------|---------|
| WebSocket 无认证 | 安全隐患，开放终端前必须解决 | JWT Token 认证 |
| 白名单存在静态文件 | 多实例部署会冲突 | 迁移到 SQLite |
| 案例库无备份机制 | 数据丢失风险 | 定期导出 JSON |
| 前端 `select-none` 全局样式 | 体验问题（已有针对修复） | 改为按需设置 |
| LLM 错误无前端区分 | 离线/API错误无差异提示 | 细化错误码 |

---

## 毕设论文对应价值分析

| 方向 | 论文贡献点 | 创新性 |
|------|-----------|--------|
| ETW 遥测 | 多维度遥测数据融合 | ⭐⭐⭐ |
| Skill 开发 | 安全领域 Tool-Use Agent 设计 | ⭐⭐⭐⭐ |
| 多 Agent | 多 Agent 协作威胁研判框架 | ⭐⭐⭐⭐⭐ |
| 知识库 | RAG + ATT&CK 融合检索 | ⭐⭐⭐⭐ |
| 终端控制 | 人机协同安全响应闭环 | ⭐⭐⭐ |
| Agent 自控 | LLM 自主安全审计 | ⭐⭐⭐⭐⭐ |

---

*文档生成时间：2026-05-15*  
*基于代码版本：commit c165042*
