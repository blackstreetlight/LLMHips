# LLMHips 工程实现差距分析报告

> 生成时间：2026-05-05  
> 分析范围：实际代码（DriverLayer / DriverServer / LLM / security-console）vs. 答辩 PPT 描述  
> 目的：诚实记录"已实现 / 部分实现 / 未实现"的边界，指导后续开发优先级

---

## 一、已实现功能（可在答辩中放心演示）

| 模块 | 具体内容 | 证明文件 |
|---|---|---|
| Ring 0 驱动 | 进程创建回调 `PsSetCreateProcessNotifyRoutineEx` | `DriverLayer/` |
| Ring 0 驱动 | SPSC 无锁 Ring Buffer，原子操作，IRQL 安全 | `DriverLayer/` |
| Ring 0 驱动 | `KEVENT` + `KeSetEvent` 通知机制 | `DriverLayer/` |
| Ring 0 驱动 | `IOCTL_SEND_COMMAND (0x80002004)` 接收上层指令路由 | `DriverLayer/` |
| C# 中间层 | `DeviceIoControl` + `METHOD_BUFFERED` 跨层数据读取 | `WindowsDriverClient.cs` |
| C# 中间层 | `WinVerifyTrust` 用户态签名验证（补充驱动层无法判断的签名状态） | `WindowsDriverClient.cs` |
| C# 中间层 | **L2 规则引擎已实现** — `ReEvaluateRiskLevel()` 包含危险工具名、高危命令行关键词、未签名+可疑路径、受信任路径/父进程 5 条规则 | `WindowsDriverClient.cs` |
| C# 中间层 | `SendCommandAsync()` → IOCTL kill 指令下发路径完整 | `WindowsDriverClient.cs` |
| C# 中间层 | WebSocket 服务端，接收前端 `driver_command` 消息 → 调用 `SendCommandAsync` | `WebSocketHandler.cs` |
| C# 中间层 | `command_ack` 回执广播机制 | `WebSocketHandler.cs` |
| LLM 推理服务 | FastAPI + SSE 流式推理接口 | `QwenLLM/Web/server.py` |
| LLM 推理服务 | 安全专用 System Prompt（五维分析框架 + ATT&CK 引导 + 结构化输出标签） | `server.py` |
| 前端 | 实时进程监控 Dashboard | `Dashboard.tsx` |
| 前端 | LLM 分析面板 + SSE 流式渲染 | `LLMAnalysisView.tsx` |
| 前端 | 进程详情页（全字段展示、筛选、搜索） | `ProcessDetailView.tsx` |
| 前端 | LLM 研判历史工单（完整对话记录） | `LLMHistoryView.tsx` |
| 前端 | 阻断历史页（时间轴工单，捕获时间→阻断时间） | `BlockHistoryView.tsx` |
| 前端 | SSE 竞态条件处理（AbortController + active 闭包标记） | `LLMAnalysisView.tsx` |
| 前端 | Zustand 持久化（事件、研判记录、阻断历史 → localStorage） | `useSystemStore.ts` |
| 前端 | WebSocket 自动重连（指数退避，最多 20 次） | `useSystemStore.ts` |

---

## 二、实现了后端但前端未接通（最高优先级 BUG）

### 🔴 BUG-001：内核阻断前端未发送 WebSocket 指令

**问题描述：**  
C# 中间层的 kill 指令链路完整可用：  
`WebSocket driver_command → HandleDriverCommandAsync → SendCommandAsync → IOCTL_SEND_COMMAND → 驱动执行终止`

但前端点击「内核阻断」按钮时，`blockEvent()` 只做了两件事：
1. 从 Zustand `events[]` 删除该进程（纯 UI 状态操作）
2. 写入 `blockRecords[]` 显示成功弹窗

**没有**向 C# 中间层发送任何 WebSocket 消息。进程在系统里仍然在运行，只是从前端列表里消失了。

**影响：** 答辩演示"内核阻断"环节，进程实际未被终止。这是当前最严重的功能性缺口。

**修复方案（估时 2-3 小时）：**
```typescript
// useSystemStore.ts — blockEvent 中补充 WebSocket 发送
blockEvent: (eventId) => {
  const event = get().events.find(e => e.id === eventId);
  if (!event) return;
  
  // 1. 发送 kill 指令到 C# 中间层
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({
      type: 'driver_command',
      payload: { action: 'kill', pid: event.pid, reason: 'User initiated block' }
    }));
  }
  
  // 2. 原有的 Zustand 状态更新（保持不变）
  // ...
}
```

---

## 三、未实现功能清单（按优先级排序）

### P0 — 答辩前必须修复

| ID | 功能 | 当前状态 | 影响 |
|---|---|---|---|
| BUG-001 | 内核阻断前端发送 kill 指令 | 见第二节 | 演示时进程未真正终止 |

---

### P1 — 核心架构声称但未实现（高风险）

#### TASK-001：L1 白名单过滤层

**答辩中的声称：** "L1 白名单 → L2 规则引擎过滤 95% → 只有 5% 到 LLM"

**实际情况：**  
- L2 规则引擎：**已实现**（`ReEvaluateRiskLevel` 在中间层运行，对每个事件评估风险等级）  
- L1 白名单：**未实现**。目前所有进程事件（包括 `system.exe`、`conhost.exe` 等系统进程）都推送到前端。L2 规则会把它们标为 LOW，但它们仍然出现在事件列表中，占用前端带宽和存储。

**实现要点：**
- 中间层（`Worker.cs`）在 `PollEventAsync` 之后、广播之前过滤
- 白名单内容：受信任系统进程列表（system、smss、csrss、lsass、svchost、conhost 等）+ 受信任路径前缀
- 已签名 + 系统路径 + 风险为 LOW 的进程直接丢弃，不推送前端
- 估时：3-4 小时

---

#### TASK-002：模型定性与 Fine-tune

**答辩中的声称：** "自研 LLMHips-LM，7B Decoder-Only，RoPE + GQA（28Q:4KV）+ KV Cache + 词表 151936 + 上下文 8192"

**实际情况（代码确认）：**

| 检查项 | 结果 |
|---|---|
| `ZLLM-7B-Instruct/config.json` 中 `model_type` | `"qwen2"` |
| `architectures` | `"Qwen2ForCausalLM"` |
| `README.md` 头部 | `"base_model: Qwen/Qwen2.5-7B"` |
| `modeling_ljz.py` 文件头注释 | "auto-generated from modular_qwen2.py，Do NOT edit manually" |
| 实际推理加载路径 | `./Qwen2.5-7B-Instruct`（QwenLLM/run.py） |

**结论：** ZLLM-7B-Instruct = **Qwen2.5-7B-Instruct 原始权重，未做任何 Fine-tune**。描述的"改进点"（RoPE/GQA/KV Cache 等）是 Qwen2 架构本身的特性，不是本工程的自研实现。

**答辩风险：** 评委如果懂大模型，看到 28Q:4KV + 词表 151936 + 上下文 8192 这几个数字，会立即识别出是 Qwen2.5-7B 的原始规格。

**建议处理方式（二选一）：**

方案 A（诚实叙述，无需额外工作）：  
> "本工程以 Qwen2.5-7B-Instruct 为基座模型，不修改权重，通过设计安全专用 System Prompt 实现领域对齐，并深入研究了其采用的 RoPE、GQA、KV Cache 等架构创新点，这些技术正是使本地轻量化部署可行的关键。"

方案 B（有实际产出，答辩更有说服力）：  
做 Fine-tune：准备 500-1000 条安全领域 QA 对（进程信息 + 研判结论），用 LoRA 微调，保存 adapter 权重。估时：1-2 天（数据准备是瓶颈）。

---

### P2 — PPT 中有详细图示但完全未做（中等风险）

#### TASK-003：动态少样本增强机制

**答辩中的声称：** "向量化 → 案例库 Top-K 检索 → Few-shot 注入 Prompt → 结论写回案例库"

**实际情况：** 完全未实现。当前 Prompt 是静态的 System Prompt，无任何向量数据库或检索逻辑。

**实现要点：**
1. 建立案例库（SQLite 或 JSON 文件，存储进程特征 + 研判结论）
2. 用 `sentence-transformers` 对进程特征做 embedding
3. 余弦相似度检索 Top-3 相似案例
4. 将案例注入 System Prompt 的 Few-shot 段落
5. LLM 给出 BLOCK 判定后，将本次案例写回库

**估时：** 2-3 天（需要种子数据、embedding 模型、检索逻辑）  
**优先级理由：** PPT Slide 12 有详细流程图，评委可能追问"案例库现在有多少条"。

---

#### TASK-004：实时父子进程关系树可视化

**答辩中的声称：** "进程行为图谱"（Slide 11 有图示）

**实际情况：** 事件数据已有 `parentPid` + `parentProcessName` 字段，但前端只用平铺列表展示，无任何树形关系图。

**实现要点：**
- 前端用 `events[]` 数据构建树结构（pid → parentPid 映射）
- 推荐用 `react-flow` 或 `d3.js` 渲染有向树
- 节点颜色按风险等级着色（红/橙/绿）
- 点击节点可触发 LLM 分析

**估时：** 3-5 天（d3/react-flow 学习曲线 + 布局算法）

---

#### TASK-005：ATT&CK 热力图可视化

**答辩中的声称：** CoT 五维中有 ATT&CK 映射，隐含有可视化

**实际情况：** LLM 输出中会提到 ATT&CK 编号（T1059.001 等），但前端只是文本展示，没有矩阵热力图。

**实现要点：**
- 解析 LLM 输出中的 T/TA 编号
- 维护一个本地 ATT&CK 矩阵（战术列 × 技术行）
- 命中的格子高亮（颜色深浅代表频次）

**估时：** 3-4 天

---

### P3 — 规划中但明确标注为未来工作（低风险）

#### TASK-006：Agent 工具调用层

**描述：** 让 LLM 能主动发起工具调用（查进程历史、查网络连接、查文件行为）自动收集多维特征注入 Prompt。  
**当前状态：** PPT/文稿中已标注"规划扩展"，答辩时主动说明即可。  
**估时：** 1-2 周（需要工具函数实现 + LLM function-calling 格式设计）

---

#### TASK-007：少样本库持久化积累

**描述：** 每次 BLOCK 判定后，将进程特征 + 结论自动写入案例库，形成"越用越准"的飞轮。  
**依赖：** TASK-003（动态少样本增强）完成后才有意义。  
**估时：** 0.5 天（TASK-003 完成后很容易扩展）

---

#### TASK-008：自动 Playbook + 报告生成

**描述：** 阻断事件发生后，自动生成结构化安全报告（PDF/JSON），包含时间线、ATT&CK 映射、处置建议。  
**估时：** 2-3 天

---

## 四、优先级总览与工时估算

```
优先级矩阵（横轴=重要性，纵轴=紧迫性）

紧迫 │ BUG-001（内核阻断接通）     │ TASK-003（少样本增强）
     │ TASK-001（L1白名单）        │ TASK-002（模型定性/Fine-tune）
─────┼──────────────────────────────┼──────────────────────────
不急 │                             │ TASK-004（进程树可视化）
     │ TASK-006（Agent层）         │ TASK-005（ATT&CK热力图）
     │ TASK-007（案例库持久化）    │ TASK-008（报告生成）
     │            不重要            │           重要
```

| 任务 ID | 任务名 | 优先级 | 估时 | 答辩前必须 |
|---|---|---|---|---|
| BUG-001 | 前端发送 kill WebSocket 指令 | P0 🔴 | 2-3h | ✅ 是 |
| TASK-001 | L1 白名单过滤（中间层） | P1 🟠 | 3-4h | 建议 |
| TASK-002A | 模型叙述方式修正（改口） | P1 🟠 | 0h | ✅ 是 |
| TASK-002B | LoRA Fine-tune（可选） | P2 🟡 | 1-2d | 否 |
| TASK-003 | 动态少样本增强 | P2 🟡 | 2-3d | 否 |
| TASK-004 | 父子进程树可视化 | P2 🟡 | 3-5d | 否 |
| TASK-005 | ATT&CK 热力图 | P3 🟢 | 3-4d | 否 |
| TASK-006 | Agent 工具调用层 | P3 🟢 | 1-2w | 否 |
| TASK-007 | 案例库持久化积累 | P3 🟢 | 0.5d | 否 |
| TASK-008 | 自动 Playbook 报告 | P3 🟢 | 2-3d | 否 |

---

## 五、答辩前最小行动清单（48 小时内）

按影响从大到小排序：

- [ ] **立刻修复 BUG-001**：在 `useSystemStore.ts` 的 `blockEvent` 中补充 `_ws.send(driver_command)`，让内核阻断真正执行
- [ ] **修改答辩文稿模型描述**：将"自研 LLMHips-LM"改为"以 Qwen2.5-7B-Instruct 为基座，针对安全场景设计专用 System Prompt，并深入研究了其 RoPE/GQA/KV Cache 等架构设计"
- [ ] **补充 L1 白名单**：在 `Worker.cs` 轮询循环中加 10 行过滤逻辑，让系统进程不出现在监控列表，使"三级流水线"说法成立
- [ ] **验证端到端 kill 链路**：在 Windows 环境测试"点击内核阻断 → 进程真正终止"的完整路径，截图/录屏用于演示

---

## 六、工程亮点（已实现，可放心重点讲）

以下是实际代码中证实存在、技术含量高、值得在答辩中重点强调的实现：

1. **跨特权级通信完整实现**：Ring 0 IOCTL 读取 + METHOD_BUFFERED 内存安全拷贝 + KEVENT 通知 + C# P/Invoke 完整链路，这在本科毕设中极为罕见。

2. **IRQL 安全的无锁 Ring Buffer**：在 DISPATCH_LEVEL 中断级别正确实现的生产消费队列，不用锁、不会死锁、不会 BSOD。

3. **中间层签名补签方案**：驱动层无法在高 IRQL 做签名验证，由中间层用 `WinVerifyTrust` 补充，设计上的 trade-off 合理且有实际代码支撑。

4. **L2 规则引擎实际可用**：5 条规则覆盖危险工具名、高危命令行特征、未签名可疑路径、受信任路径、受信任父进程，`ReEvaluateRiskLevel` 在中间层真实运行。

5. **kill 指令双向链路**：前端 → WebSocket → `HandleDriverCommandAsync` → `SendCommandAsync` → `IOCTL_SEND_COMMAND` → 驱动执行 `ZwTerminateProcess`，链路完整，只差前端触发点（BUG-001）。

6. **SSE 流式推理 + 竞态处理**：AbortController + active 闭包标记确保任意时刻只有一条 SSE 流写入状态，工程细节扎实。

7. **安全专用 System Prompt 设计**：五维分析框架 + ATT&CK 映射引导 + 结构化标签输出（`<risk_score>` / `<action>`），让通用 LLM 在安全判别任务上有结构化输出能力。

---

*本报告基于 2026-05-05 代码快照分析，后续实现进度请同步更新此文件。*
