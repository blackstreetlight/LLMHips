<div align="center">

```
 ██╗     ██╗     ███╗   ███╗    ██╗  ██╗██╗██████╗ ███████╗
 ██║     ██║     ████╗ ████║    ██║  ██║██║██╔══██╗██╔════╝
 ██║     ██║     ██╔████╔██║    ███████║██║██████╔╝███████╗
 ██║     ██║     ██║╚██╔╝██║    ██╔══██║██║██╔═══╝ ╚════██║
 ███████╗███████╗██║ ╚═╝ ██║    ██║  ██║██║██║     ███████║
 ╚══════╝╚══════╝╚═╝     ╚═╝    ╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝
```

**基于轻量化 LLM 的危险进程识别与分析拦截系统**

*Windows Kernel-Level HIPS · LLM Threat Analysis · Real-time Process Tree*

<img src="https://img.shields.io/github/stars/blackstreetlight/LLMHips?style=flat&logo=github&color=00d4ff" alt="stars"/>
<img src="https://img.shields.io/github/forks/blackstreetlight/LLMHips?style=flat&logo=github&color=00d4ff" alt="forks"/>
<img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-blue?style=flat&logo=windows" alt="platform"/>
<img src="https://img.shields.io/badge/Driver-Ring%200%20%7C%20WDM-red?style=flat" alt="driver"/>
<img src="https://img.shields.io/badge/LLM-Qwen2.5--7B-orange?style=flat" alt="llm"/>
<img src="https://img.shields.io/badge/Frontend-React%2019-61dafb?style=flat&logo=react" alt="react"/>
<img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="license"/>

</div>

---

## 🎯 项目介绍

LLMHips 是一个完整的 **Windows 主机入侵防御系统（HIPS）**，将传统内核级进程拦截与大语言模型智能研判相结合，构建了一套"内核感知 → 规则预判 → LLM 深度分析 → 人工决策"的四级威胁响应链路。

系统通过 Windows 内核驱动实时捕获每一个进程创建事件，经由 C# 桥接层完成签名验证与规则引擎评分后，将威胁信息推送至 React 前端控制台。对于高风险进程，用户可一键触发 LLM 进行 ATT&CK 框架下的多维度分析，并最终下发内核级阻断指令（`ZwTerminateProcess`）。

```
用户操作 ──► React 控制台 ──► WebSocket ──► C# 桥接层 ──► IOCTL ──► 内核驱动
                ▲                                                      │
                └──────────── 进程事件 / 退出通知 / 心跳 ◄─────────────┘

                        ↕ SSE 流式推理
                   LLM 推理服务（Qwen2.5-7B）
```

---

## ✨ 核心功能

<table>
<tr>
<td width="50%">

**🛡️ 内核级进程拦截**
- `PsSetCreateProcessNotifyRoutineEx` 进程回调
- 采集 PID、路径、命令行、父进程、签名、文件创建时间
- SPSC 无锁 Ring Buffer（DISPATCH_LEVEL 安全）
- 支持 `ZwTerminateProcess` 内核强制终止

</td>
<td width="50%">

**🤖 LLM 智能研判**
- Qwen2.5-7B-Instruct 本地推理，无需联网
- 五维分析框架：进程溯源 / 签名 / 命令行 / 父子链 / 路径
- ATT&CK 战术编号映射与结构化输出
- SSE 流式渲染，支持多轮追问

</td>
</tr>
<tr>
<td width="50%">

**📊 实时可视化**
- 进程树：React Flow + Dagre 自动布局
- 高危攻击链连线动画，一眼识别横向移动
- ECharts 实时风险统计图表
- 进程退出实时感知（内核 → 前端全链路）

</td>
<td width="50%">

**⚙️ 完整管控能力**
- 白名单：进程名精确匹配 + 路径前缀匹配
- 研判工单：完整对话记录与处置历史
- 阻断历史：时间轴展示，保留完整现场信息
- 指数退避 WebSocket 自动重连

</td>
</tr>
</table>

---

## 🏗️ 系统架构

### 四层架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                     React 前端控制台（TSX）                        │
│                                                                    │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐  │
│  │实时监控  │ │ 进程树  │ │LLM研判   │ │阻断历史 │ │白名单管理│  │
│  │Dashboard│ │ReactFlow│ │SSE流式   │ │时间轴   │ │JSON持久化│  │
│  └─────────┘ └─────────┘ └──────────┘ └─────────┘ └──────────┘  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ WebSocket (ws://host:9527)
┌────────────────────────▼─────────────────────────────────────────┐
│                  C# 桥接层（SecurityBridge）                       │
│                                                                    │
│  DeviceIoControl ──► WinVerifyTrust签名验证 ──► L2规则引擎评分    │
│                                                                    │
│  process_event / process_exit / heartbeat / command_ack           │
│  ◄──────────────────────────────────────────── driver_command     │
└────────────────────────┬─────────────────────────────────────────┘
                         │ IOCTL (0x80002000 GET / 0x80002004 SET)
┌────────────────────────▼─────────────────────────────────────────┐
│                 Ring 0 内核驱动（ZDriverHips）                     │
│                                                                    │
│  PsSetCreateProcessNotifyRoutineEx                                 │
│  ──► 进程信息采集 ──► SPSC Ring Buffer ──► KEVENT 通知            │
│                                                                    │
│  IOCTL_SEND_COMMAND ──► ZwTerminateProcess（内核强制终止）         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                   LLM 推理服务（独立进程）                         │
│                                                                    │
│  FastAPI + SSE  ◄──► Qwen2.5-7B-Instruct（本地 GPU 推理）        │
│  安全专用 System Prompt · ATT&CK 映射 · 结构化输出                │
└──────────────────────────────────────────────────────────────────┘
```

### 进程拦截完整数据流

```
进程创建
  │
  ▼
PsSetCreateProcessNotifyRoutineEx（内核回调，Ring 0）
  │  采集：PID / PPID / 路径 / 命令行 / 父进程信息
  ▼
SPSC Ring Buffer（DISPATCH_LEVEL 无锁写入）
  │
  ▼
IOCTL_GET_EVENT（C# 桥接层 500ms 轮询读取）
  │
  ├─► WinVerifyTrust 签名验证（用户态，补充内核层无法完成的验签）
  │
  ├─► L2 规则引擎评分
  │     ├── 危险工具名（mimikatz / frpc / cobalt_strike...）
  │     ├── 高危命令行（-enc / bypass / downloadstring...）
  │     ├── 未签名 + 可疑路径（%APPDATA% / %TEMP%...）
  │     ├── 受信任系统路径（System32 / Program Files → LOW）
  │     └── 受信任父进程（explorer / svchost → LOW）
  │
  ▼
WebSocket 广播（process_event）
  │
  ▼
React 前端实时展示
  │
  ├─► [用户触发] LLM 深度研判（SSE 流式推理）
  │
  └─► [用户决策] 内核阻断
        │  WebSocket driver_command { action: "kill", pid }
        ▼
      C# → IOCTL_SEND_COMMAND → ZwTerminateProcess
```

---

## 📁 目录结构

```
LLMHips/
│
├── DriverLayer/
│   ├── ZDriverHips/                  # 核心内核驱动（C）
│   │   ├── DriverEntry.c/h           # 驱动入口，设备对象创建
│   │   ├── ProcessCallback.c/h       # 进程创建/退出回调
│   │   ├── EventQueue.c/h            # SPSC 无锁 Ring Buffer
│   │   ├── IoctlHandler.c/h          # IOCTL 分发路由
│   │   ├── ProcessInfo.c/h           # 进程信息采集
│   │   ├── RuleEngine.c/h            # L2 规则引擎
│   │   └── Common.h                  # 驱动/桥接层共享结构体定义
│   └── ProcessHips/                  # 参考驱动实现（原型）
│
├── DriverServer/
│   └── SecurityBridge/               # C# 桥接服务
│       ├── Driver/
│       │   ├── IDriverClient.cs      # 驱动通信抽象接口
│       │   ├── WindowsDriverClient.cs # 真实 IOCTL 实现（Windows only）
│       │   └── MockDriverClient.cs   # Mock 驱动（跨平台开发用）
│       ├── WebSocket/
│       │   ├── WebSocketHandler.cs   # 消息路由与指令处理
│       │   └── WebSocketConnectionManager.cs
│       ├── Models/                   # 数据结构定义
│       ├── Worker.cs                 # 轮询主循环 + 心跳广播
│       └── Program.cs                # 依赖注入 + 服务配置
│
├── LLM/
│   └── QwenLLM/
│       ├── Web/server.py             # FastAPI + SSE 推理接口
│       └── Web/requirements.txt
│
├── security-console/
│   └── security-console/             # React 19 前端
│       ├── src/
│       │   ├── features/
│       │   │   ├── dashboard/        # 实时监控 + ECharts 图表
│       │   │   ├── process-tree/     # React Flow 进程树可视化
│       │   │   ├── llm/              # LLM 研判面板（SSE 流式）
│       │   │   ├── monitor/          # 事件列表 + 白名单抽屉
│       │   │   ├── process-detail/   # 进程详情全字段展示
│       │   │   ├── llm-history/      # 研判工单历史
│       │   │   └── block-history/    # 阻断历史时间轴
│       │   ├── store/useSystemStore.ts  # Zustand 全局状态
│       │   └── types/index.ts           # TypeScript 类型定义
│       └── public/whitelist.json     # 白名单持久化文件
│
└── ProjectPlan/                      # 实现规划与差距分析文档
```

---

## 🚀 快速开始

### 环境要求

| 组件 | 环境要求 |
|------|---------|
| 内核驱动 | Windows 10/11 x64，启用测试签名模式 |
| C# 桥接层 | .NET 8 SDK，Windows x64（Mock 模式可跨平台） |
| 前端控制台 | Node.js 18+，任意平台 |
| LLM 推理服务 | Python 3.10+，建议 GPU ≥ 16GB 显存 |

### 1. 启动 LLM 推理服务

```bash
cd LLM/QwenLLM
pip install -r Web/requirements.txt
# 下载模型权重至 Qwen2.5-7B-Instruct/ 目录
python Web/server.py
# 默认监听 http://localhost:8000
```

### 2. 启动 C# 桥接层

```bash
cd DriverServer/SecurityBridge
dotnet run
# 默认监听 ws://localhost:9527/ws
```

> `appsettings.json` 中设置 `"UseMockDriver": true` 可在无驱动环境下运行，用随机数据模拟进程事件，便于前端开发调试。

### 3. 启动前端控制台

```bash
cd security-console/security-console
cp .env.example .env.local
# 编辑 .env.local，填入实际地址
npm install
npm run dev
# 访问 http://localhost:5173
```

**.env.local 示例：**
```env
VITE_WS_URL=ws://YOUR_HOST:9527/ws
VITE_LLM_URL=http://localhost:8000
```

### 4. 加载内核驱动（Windows，需管理员权限）

```powershell
# 开启测试签名模式（重启生效）
bcdedit /set testsigning on

# 注册并启动驱动服务
sc create ZDriverHips binPath= "C:\path\to\ZDriverHips.sys" type= kernel start= demand
sc start ZDriverHips

# 停止驱动
sc stop ZDriverHips
```

---

## 🔬 技术实现亮点

### 跨特权级完整阻断链路
```
前端点击「内核阻断」
  → WebSocket driver_command { action:"kill", pid }
  → C# WebSocketHandler.HandleDriverCommandAsync()
  → DeviceIoControl(IOCTL_SEND_COMMAND = 0x80002004)
  → 驱动 IoctlHandler → ZwTerminateProcess
```
从用户界面的一次点击到内核强制终止进程，全链路打通。

### IRQL 安全的无锁队列
内核回调运行在 `PASSIVE_LEVEL` ~ `APC_LEVEL`，但中断随时可能将执行提升至 `DISPATCH_LEVEL`。EventQueue 使用 `InterlockedIncrement` 等原子操作实现 SPSC Ring Buffer，在不使用互斥锁的前提下保证线程安全，避免死锁风险。

### 签名验证分层方案
内核层在进程创建回调中无法安全调用 Authenticode 验签 API（IRQL 限制）。ZDriverHips 仅标记 `IsSigned = SIGN_UNKNOWN`，由 C# 桥接层在用户态通过 `WinVerifyTrust` 完成真实签名验证，再结合验签结果重新执行规则引擎评分，使「未签名 + 可疑路径 → HIGH」规则得以真正生效。

### 进程退出实时感知
`PsSetCreateProcessNotifyRoutineEx` 同时捕获进程退出事件（`CreateInfo == NULL`）。驱动将退出 PID 写入队列，经 WebSocket 广播 `process_exit` 消息，前端 Zustand store 收到后立即调用 `markTerminated(pid)`，实时监控面板隐藏已结束进程，进程详情页保留记录并打上「已结束」标签。

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 内核驱动 | C · WDM · Windows Kernel API |
| 桥接层 | C# · .NET 8 · ASP.NET Core · WebSocket |
| 前端 | React 19 · TypeScript · Tailwind CSS · Zustand |
| 可视化 | ECharts · React Flow · Dagre |
| LLM | Python · FastAPI · Qwen2.5-7B-Instruct · SSE |

---

## ⚠️ 免责声明

本项目仅供学习与研究使用。内核驱动程序若使用不当可能导致系统蓝屏（BSOD），请在虚拟机或测试机上运行。请勿将本系统用于任何未授权的环境监控行为。

---

## 📜 License

[MIT License](./LICENSE) · © 2026 blackstreetlight
