<!-- 语言切换 -->
<div align="right">
  <strong>中文</strong> | <a href="README.md">English</a>
</div>

<br/>

<div align="center">

```
██╗     ██╗     ███╗   ███╗    ██╗  ██╗██╗██████╗ ███████╗
██║     ██║     ████╗ ████║    ██║  ██║██║██╔══██╗██╔════╝
██║     ██║     ██╔████╔██║    ███████║██║██████╔╝███████╗
██║     ██║     ██║╚██╔╝██║    ██╔══██║██║██╔═══╝ ╚════██║
███████╗███████╗██║ ╚═╝ ██║    ██║  ██║██║██║     ███████║
╚══════╝╚══════╝╚═╝     ╚═╝    ╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝
```

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

起初只是毕业设计的选题，做着做着发现这个方向真的挺有意思。我把它开源出来，是希望有内核安全、威胁检测或 LLM Agent 领域经验的朋友能帮我找到设计上的问题——无论是架构上的错误，还是我根本不知道自己不知道的东西。

**我是一名学生。如果这里有什么幼稚或错误的地方，请直接开 Issue 告诉我。这比点一个 Star 对我有价值得多。**

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

## 🔧 真正值得说的工程问题

*不是"技术亮点"——是那些真正让东西坏掉、然后让我明白了什么的地方。如果你有更好的解法，我真诚地想听。*

### 1. 跨特权级结构体对齐：4 字节的陷阱

C# `DRIVER_EVENT_BUFFER` 结构体必须与内核 `Common.h` 中的同名结构体**逐字节对齐**，通过 `[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]` 约束。开发过程中，在结构体首位多加了一个 `uint EventType` 字段（4 字节），导致 `ProcessName` 字段从实际缓冲区偏移 2 个 Unicode 字符处开始读取——在中间层日志里表现为进程名乱码。根本原因：编译好的 `.sys` 和 C# 结构体用的是不同版本的头文件。

这是一种安静的失败：数据读回来没有报错，只是值是错的。如果你做过跨特权级 P/Invoke 并且涉及变长 Unicode 字符串，值得留意。

### 2. LLM 不能碰执行路径

内核阻断决策必须在 `PsSetCreateProcessNotifyRoutineEx` 回调中**同步完成**，延迟预算是个位数毫秒。LLM 没有任何立足之地。

当前设计把 LLM 完全放在**分析路径**上：前端在事件已经被放行或阻断之后，才异步发起对 vllm 服务的 HTTP 请求。内核→桥接→前端的整条链路不受推理延迟影响。我认为这个切分是对的，但我很好奇——有没有让 LLM 拥有真正否决权的架构，同时又不引入不可接受的延迟？

### 3. 签名验证天然需要两层

`WinVerifyTrust` 是用户态 API，内核微过滤驱动无法调用。这意味着驱动对每个进程都只能上报 `SIGN_UNKNOWN`，由桥接层在收到事件后通过 P/Invoke 二次运行 Authenticode 验证。

实际后果：规则"未签名程序从用户可写路径启动 → HIGH 风险"只能在桥接层正确触发，不能在内核。没有这一层，该规则是死代码，`%APPDATA%` 下的未签名恶意程序会永远被评为 `MEDIUM`。

### 4. 用事件流维护一棵活的 DAG

进程树（React Flow + Dagre）接收的是**事件流**，不是树的快照。每个 `process_create` 事件携带的 `parentPid` 可能已经在树里，也可能不在。进程退出事件应该让节点变暗，而不是删除。

主要的细节问题：PID 复用（新进程可能拿到一个处于"已退出"状态的 PID）、孤儿进程（因为监控是中途启动的，父节点从未被观测到）、以及布局抖动（Dagre 在每个事件到来时都重新计算，高频事件流下这是主要渲染瓶颈）。

### 5. IOCTL 环形缓冲区：丢弃 vs. 阻塞

驱动维护一个固定大小的环形事件缓冲区。如果用户态消费者（`DeviceIoControl` 轮询）速度跟不上——比如编译工具链在短时间内生成数百个进程——缓冲区填满后新事件会被丢弃。这是有意为之的策略：内核回调必须快速返回，让缓冲区满了阻塞它，比丢几条事件代价要大。

我不确定这是不是最佳方案。ETW（Windows 事件追踪）可能是更干净的架构，有操作系统级别的缓冲，并发访问下数据损坏的风险也更低。如果你有 ETW 内核事件流水线的经验，我很想了解其中的权衡。

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

**如果你也是正在学习安全或系统知识的学生：**

Mock 模式可以让你不需要任何内核环境或 GPU，就能运行整个系统。这是理解多层安全事件管道结构的一个还算不错的起点。有问题欢迎在 Discussions 里提，我会尽量解释我学到的东西，包括哪里出了问题和为什么。

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
