<!-- 语言切换 -->
<div align="right">
  <strong>中文</strong> | <a href="README.md">English</a>
</div>

<br/>

<div align="center">

<pre>
██╗     ██╗     ███╗   ███╗    ██╗  ██╗██╗██████╗ ███████╗
██║     ██║     ████╗ ████║    ██║  ██║██║██╔══██╗██╔════╝
██║     ██║     ██╔████╔██║    ███████║██║██████╔╝███████╗
██║     ██║     ██║╚██╔╝██║    ██╔══██║██║██╔═══╝ ╚════██║
███████╗███████╗██║ ╚═╝ ██║    ██║  ██║██║██║     ███████║
╚══════╝╚══════╝╚═╝     ╚═╝    ╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝
</pre>

**基于大语言模型的主机入侵防御系统**

*一个小小的想法，做着做着就成了现在这个样子——欢迎各位大神批评指正。*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-8.0-purple?logo=dotnet)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://reactjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python)](https://python.org)
[![LLM](https://img.shields.io/badge/LLM-Qwen2.5--7B-orange)](https://huggingface.co/Qwen)
[![Platform](https://img.shields.io/badge/Platform-Windows%20Kernel-0078D4?logo=windows)](https://learn.microsoft.com/en-us/windows-hardware/drivers/)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen)](https://github.com/blackstreetlight/LLMHips/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-欢迎提交-ff69b4)](https://github.com/blackstreetlight/LLMHips/pulls)

</div>

---

## 🧠 这个项目从哪里来

传统 HIPS 依赖静态规则引擎——要么过度拦截，要么对新型攻击模式无能为力。我一直在想一个问题：

> *如果决策层能够用自然语言推理进程行为，而不只是匹配特征，会怎样？*

这个项目就是我对这个问题的一次探索。它把 **Windows 内核微过滤驱动**、**C# WebSocket 桥接服务**和 **React 安全控制台**串联起来，并把本地运行的 LLM 接入这条链路，用于上下文分析和可读性解释。

起初只是一个小想法，做着做着发现这个方向真的挺有意思。我把它开源出来，是希望有内核安全、威胁检测或 LLM Agent 领域经验的朋友能帮我找到设计上的问题——无论是架构上的错误，还是我根本不知道自己不知道的东西。

**我是刚入行的小白，如果这里有什么幼稚或错误的地方，请直接开 Issue 告诉我。这比点一个 Star 对我有价值得多。**

---

## 📸 系统截图

<table>
  <tr>
    <td align="center"><b>安全总览仪表盘</b></td>
    <td align="center"><b>进程监控列表</b></td>
  </tr>
  <tr>
    <td><img src="Picture/截屏2026-05-08 18.31.27.png" alt="安全总览" width="480"/></td>
    <td><img src="Picture/截屏2026-05-08 18.32.18.png" alt="进程监控" width="480"/></td>
  </tr>
  <tr>
    <td align="center"><b>实时进程树可视化</b></td>
    <td align="center"><b>内核阻断历史</b></td>
  </tr>
  <tr>
    <td><img src="Picture/截屏2026-05-08 18.32.53.png" alt="进程树" width="480"/></td>
    <td><img src="Picture/截屏2026-05-08 18.33.19.png" alt="阻断历史" width="480"/></td>
  </tr>
</table>

> 📹 完整演示视频在本地 `Picture/演示视频.mov`（文件 178MB，超过 GitHub 100MB 限制，未上传）。

---

## 🏗️ 系统架构

```
┌───────────────────────────────────────────────────────────────┐
│                      Windows 内核  (Ring 0)                   │
│                                                               │
│  PsSetCreateProcessNotifyRoutineEx                            │
│            │                                                  │
│            ▼                                                  │
│    ZDriverHips.sys ──── 规则预过滤 ──► ZwTerminateProcess     │
│            │              (同步执行，<1ms)                     │
│            │   IOCTL 环形缓冲区（满则丢弃，不阻塞回调）         │
└────────────┼──────────────────────────────────────────────────┘
             │  DeviceIoControl  (METHOD_BUFFERED)
             ▼
┌───────────────────────────────────────────────────────────────┐
│         SecurityBridge  (C# / .NET 8,  Ring 3)                │
│                                                               │
│  WindowsDriverClient                                          │
│    └─ Marshal.PtrToStructure<DRIVER_EVENT_BUFFER>             │
│         (字节精确的结构体对齐，LayoutKind.Sequential)          │
│                                                               │
│  WinVerifyTrust (P/Invoke) ── Authenticode 二次签名验证        │
│  ReEvaluateRiskLevel ──────── 规则引擎镜像（利用签名结果）     │
│                                                               │
│  WebSocketHandler ─────────── JSON 推送 → 前端                │
└────────────┼──────────────────────────────────────────────────┘
             │  ws://host:9527/ws
             ▼
┌───────────────────────────────────────────────────────────────┐
│         React 安全控制台  (Vite + TypeScript)                  │
│                                                               │
│  Zustand store ──── 事件流                                    │
│  MonitorPanel ─────────────── 实时事件列表                    │
│  ProcessTreeView ──────────── React Flow + Dagre 进程 DAG     │
│  InterceptHistory ─────────── 阻断事件审计日志                │
│  ProcessDetailView ── LLM 查询 ──► vllm HTTP 推理接口         │
│                                          │                    │
│                                          ▼                    │
│                                Qwen2.5-7B-Instruct            │
│                                (本地部署，Python / vllm)      │
└───────────────────────────────────────────────────────────────┘
```

---

## 🔩 各模块设计思路

简单说说每一层的设计出发点，不是完整的技术文档，只是关键决策点的快速说明。

### 第一层 — 内核驱动（`ZDriverHips`）

驱动通过注册 `PsSetCreateProcessNotifyRoutineEx` 回调，在系统全局范围内拦截每一次进程创建。回调内部，一个轻量规则引擎对进程进行评估（危险工具名、高危命令行特征、路径风险信号），结果要么通过 `ZwTerminateProcess` 同步终止进程，要么打上"监控"标签放行。整个决策必须在微秒级内完成。

事件写入一个固定大小的 IOCTL 环形缓冲区，满则丢弃——这是有意为之。内核回调不能因为用户态消费慢而被阻塞。

### 第二层 — 桥接服务（`SecurityBridge`）

桥接层通过 `DeviceIoControl` 轮询驱动缓冲区，用 `Marshal.PtrToStructure<T>` 将原始内存反序列化为 C# 结构体。结构体的字段布局必须与内核定义逐字节对齐（`LayoutKind.Sequential`）。

`WinVerifyTrust`（Authenticode 签名验证）是用户态专属 API，内核驱动无法调用，所以驱动对每个进程都只能上报 `SIGN_UNKNOWN`。桥接层在收到事件后通过 P/Invoke 二次执行签名验证，再用真实的签名结果重新评分。正是这个两段式设计，让"未签名程序从 `%APPDATA%` 启动 → 高风险"这条规则能够真正触发。

最终事件序列化为 JSON，通过 WebSocket 推送给前端。

### 第三层 — React 控制台（`security-console`）

前端用单一 Zustand store 作为事件流的唯一数据源，四个视图从中读取：

- **仪表盘**：汇总统计、风险分布、滚动告警流
- **进程监控**：可筛选的实时进程事件列表，带内联操作（放行 / 阻断 / 加白）
- **进程树**：基于 React Flow + Dagre 的实时 DAG，从事件流中增量构建父子关系。退出事件让节点变暗而不删除，保留进程活动的历史记录
- **阻断历史**：所有内核阻断事件的审计日志，带完整元数据

### 第四层 — LLM 服务（`QwenLLM`）

vllm 托管的 Qwen2.5-7B-Instruct 实例对外暴露简单的 HTTP 接口。用户在前端打开某条进程事件的详情面板时，前端用事件元数据构造 Prompt 并异步请求推理结果，返回的自然语言分析展示在面板中。

LLM **完全运行在执行路径之外**——内核在任何推理发生之前就已经做出了阻断/放行决策。

---

## ⚠️ 已知不足与坦诚的问题

*这一节存在是因为在 README 里掩盖缺陷没有任何意义。以下是目前做得不够好的地方。*

### LLM 没有在真正"研判"——它只是在转述

这是最重要的一条。目前 LLM 收到的 Prompt 包含进程名、路径、命令行、风险等级、父进程、签名状态等字段，然后生成一段大体上是把这些信息重新描述一遍的自然语言段落。看起来像分析，实质上更接近结构化摘要。

没有真正的推理在发生，因为：
- 模型没有任何外部威胁情报来源（VirusTotal、MITRE ATT&CK、沙箱报告）
- 每次查询都是无状态的，模型对历史事件没有任何记忆
- 无法建立行为基线，无法检测多个低风险事件组合起来构成的攻击链
- 模型只能描述，不能采取任何行动

LLM"解释"的风险等级，是规则引擎在 LLM 被调用之前就已经确定的。在当前架构下，去掉 LLM 不会改变任何一个阻断决策。这是 v1.1 Agent 架构和 RAG 集成要重点解决的核心问题。

### 内核检测覆盖面很窄

驱动目前只监控**进程创建**这一个维度，以下攻击手法对系统完全不可见：

- 无文件攻击（Shellcode 注入到已有进程，不创建新进程）
- DLL 注入与进程空洞（Process Hollowing）
- 注册表持久化写入
- 已运行进程发起的网络连接
- 对敏感路径的文件写操作

一个生产级 EDR 会监控上述所有维度。本系统目前只覆盖了一个入口点。

### 没有行为基线，没有时序关联分析

每个事件都是孤立评估的。系统无法识别"慢攻击"——比如一个看起来完全正常的进程运行 10 分钟后才开始向 C2 服务器发起连接。缺少跨事件的时序关联，这类攻击模式无法被发现。

### WebSocket 没有鉴权

桥接层的 WebSocket 端点没有任何认证机制，局域网内任何知道 `ws://host:9527/ws` 的客户端都可以接收完整的事件流。本地演示可以接受，但真实部署前需要加上基于 Token 或 mTLS 的认证。

### LLM 幻觉风险

模型可能因为进程名的表面相似性就自信地将其判定为恶意，也可能对它没见过的真实威胁视而不见。LLM 的输出应当仅作为参考，不能作为阻断决策的唯一依据。规则引擎在执行层面更可靠；LLM 更适合帮助分析人员快速理解上下文。

---

## 📁 目录结构

```
LLMHips/
├── DriverLayer/              # WDK 内核驱动（C）
│   └── ZDriverHips/          # 微过滤 + 规则引擎 + IOCTL 接口
├── DriverServer/             # C# 桥接服务（.NET 8）
│   └── SecurityBridge/       # WebSocket 处理、驱动客户端、LLM 代理
├── security-console/         # React 前端（Vite + TypeScript）
│   └── security-console/
│       ├── src/features/     # 仪表盘、监控、进程树、阻断历史
│       └── src/store/        # Zustand 全局状态
├── LLM/                      # Python 推理服务
│   └── QwenLLM/              # vllm + Qwen2.5-7B-Instruct
└── Picture/                  # 截图与演示视频
```

---

## 🚀 快速上手

### 环境要求

| 组件 | 要求 |
|------|------|
| 内核驱动 | Windows 10/11 x64，已开启测试签名 |
| C# 桥接 | .NET 8 SDK |
| 前端 | Node.js 18+，npm 或 pnpm |
| LLM 服务 | Python 3.10+，CUDA GPU（推荐 ≥16GB 显存） |

> **Mock 模式**：桥接服务的 `appsettings.json` 中设置 `"UseMockDriver": true`，可在 macOS/Linux 上不依赖任何内核驱动或 GPU，运行完整的前端 + 桥接栈。适合前端开发和架构学习。

### 第一步：LLM 推理服务

```bash
cd LLM/QwenLLM
pip install -r requirements.txt
python server.py          # 监听 http://localhost:8000
```

### 第二步：C# 桥接服务

```bash
cd DriverServer/SecurityBridge
dotnet run                # WebSocket 监听 ws://localhost:9527/ws
```

### 第三步：React 控制台

```bash
cd security-console/security-console
cp .env.example .env.local   # 填写 VITE_WS_URL 和 VITE_LLM_URL
npm install && npm run dev   # http://localhost:5173
```

### 第四步：Windows 内核驱动 *（生产环境）*

```
# 用 Visual Studio 打开 DriverLayer/ZDriverHips/ZDriverHips.sln
# 编译 → x64 / Release
# bcdedit /set testsigning on   （需要管理员权限，重启后生效）
# sc create ZDriverHips binPath= "C:\path\to\ZDriverHips.sys" type= kernel
# sc start ZDriverHips
```

---

## 🗺️ v1.1 路线图

v1.0 建立了端到端的完整链路。v1.1 计划新增：

| 特性 | 内容 |
|------|------|
| **RAG 威胁上下文检索** | 将 CVE 数据、MITRE ATT&CK 技战术和恶意软件沙箱报告向量化入库，LLM 在生成分析前先检索相关上下文，减少对具体威胁名称的幻觉。 |
| **领域专项微调** | 在公开恶意软件沙箱遥测数据集上对基础模型进行微调，目标是在 LOLBin（离地攻击）场景下超越当前启发式规则引擎的分类准确率。 |
| **多步骤 Agent 架构** | 将单轮 LLM 调用替换为 ReAct 风格的 Agent 循环：`观察 → 规划 → 行动`。Agent 可调用工具（VirusTotal 查询、父进程链溯源、网络连接检查）后再给出建议。 |
| **内核检测面扩展** | 新增网络套接字监控（`FwpmFilterAdd`）、注册表写入拦截（`CmRegisterCallback`）、文件系统写入事件（`FltRegisterFilter`）。当前版本仅监控进程创建，对无文件攻击存在明显盲区。 |
| **在线/离线模型切换** | 界面开关控制 LLM 查询路由到本地 vllm 服务（离线，数据不出本机）或云端 API（在线，能力更强），配置驱动，无需修改代码。 |
| **多 LLM 后端支持** | 插件式 LLM 后端适配器，支持 Claude、Gemini、ChatGPT、DeepSeek 或任何 OpenAI 兼容接口，切换不需要改桥接代码。 |

---

## 🤝 一起来做这件事

我把这个项目开源，是因为我觉得这个方向有意思，但我很清楚自己一个人很难把它做到应有的样子。

**如果你在内核安全、EDR/XDR、威胁情报或 LLM Agent 领域有经验：**

这个项目里有我没有好答案的真实工程问题。如果你有答案，我诚恳地想听——哪怕答案是"你这个方向根本就错了，因为……"，尤其是这种。

我一直没想清楚的问题：
- `PsSetCreateProcessNotifyRoutineEx` + `ZwTerminateProcess` 是正确的拦截点吗？还是业界有更可靠的执行前拦截机制？
- 生产级 EDR 是怎么处理执行路径上的延迟/准确率权衡的？有没有我应该读的标准文献或开源实现？
- IOCTL 环形缓冲区 vs. ETW vs. 内核流式传输——对于这个场景你会怎么选，为什么？
- 7B 模型本地运行在这个场景下真的有用吗？还是规则引擎做了所有实质工作，LLM 只是在生成听起来合理的解释？

**如果你也是刚入行、在摸索安全或系统方向的新人：**

Mock 模式可以让你不需要任何内核环境或 GPU，就能运行整个系统。这是理解多层安全事件管道结构的一个还算不错的起点。有问题欢迎在 Discussions 里提，我会尽量解释我学到的东西，包括哪里出了问题和为什么。如果你比我懂得多，也欢迎反过来指导我。

**参与方式：**
- 🐛 开 Issue——报 Bug、指出错误假设、提架构批评
- 💡 开 Discussion——提问或讨论想法
- 🔀 提 PR——任何大小的改进都欢迎
- ⭐ 点 Star 帮助传播，但直接的反馈对我更有价值

---

## ⚠️ 免责声明

本项目涉及 Windows 内核操作。**请只在有快照的隔离虚拟机中测试。** 切勿在生产系统上部署驱动。因使用本软件导致的系统不稳定、数据丢失或意外进程终止，作者不承担任何责任。

---

## 📄 许可证

[MIT](LICENSE)——随意使用，保留署名即可。
