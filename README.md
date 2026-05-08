# LLMHips

**基于轻量化 LLM 的危险进程识别与分析拦截系统**

Windows 主机入侵防御系统（HIPS），通过 Windows 内核驱动实时拦截进程创建事件，经规则引擎预判后将高风险进程推送至前端，并借助大语言模型（Qwen2.5-7B-Instruct）进行深度研判，最终由用户决策是否执行内核级阻断。

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                   React 前端控制台                    │
│  实时监控 · 进程树 · LLM 研判面板 · 阻断历史 · 白名单  │
└─────────────────┬───────────────────────────────────┘
                  │ WebSocket
┌─────────────────▼───────────────────────────────────┐
│              C# 桥接层（SecurityBridge）               │
│   IOCTL 轮询 · 签名验证 · 规则引擎 · 指令下发          │
└─────────────────┬───────────────────────────────────┘
                  │ IOCTL
┌─────────────────▼───────────────────────────────────┐
│              Ring 0 内核驱动（ZDriverHips）            │
│  进程回调 · 无锁队列 · 事件上报 · 进程终止             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              LLM 推理服务（FastAPI + SSE）             │
│         Qwen2.5-7B-Instruct · 安全专用 Prompt        │
└─────────────────────────────────────────────────────┘
```

---

## 各模块说明

### 🔵 DriverLayer — 内核驱动（Ring 0）

- 通过 `PsSetCreateProcessNotifyRoutineEx` 注册进程创建/退出回调
- 采集进程 PID、路径、命令行、父进程信息、文件创建时间
- SPSC 无锁 Ring Buffer 在 DISPATCH_LEVEL 下安全传递事件
- 通过 IOCTL 接口（`0x80002000` / `0x80002004`）与用户态通信
- 支持内核级进程终止（`ZwTerminateProcess`）

### 🟢 DriverServer — C# 桥接层

- 通过 `DeviceIoControl` 轮询驱动事件队列
- 调用 `WinVerifyTrust` 补充 Authenticode 签名验证（驱动层无法在高 IRQL 完成）
- L2 规则引擎：危险工具名 / 高危命令行 / 未签名可疑路径 / 受信任目录 / 受信任父进程
- WebSocket 服务器：向前端广播 `process_event` / `process_exit` / `heartbeat` / `command_ack`
- 接收前端 `driver_command`，通过 IOCTL 将 kill 指令下发至内核

### 🟡 security-console — React 前端控制台

- **实时监控面板**：进程事件流、风险等级过滤、白名单隐藏、实时统计图表
- **进程树**：基于 React Flow + Dagre 的父子关系树形可视化，高危连线动画
- **LLM 研判面板**：SSE 流式渲染、多轮对话、一键阻断/放行/加白
- **白名单管理**：进程名精确匹配 + 路径前缀匹配，持久化至 JSON 文件
- **阻断历史**：时间轴展示，记录每次内核阻断的完整上下文
- **研判工单历史**：保留所有 LLM 对话记录与最终决策

### 🔴 LLM — 推理服务

- 基座模型：Qwen2.5-7B-Instruct（本地推理，无需联网）
- FastAPI + SSE 流式接口，前端实时展示推理过程
- 安全专用 System Prompt：五维分析框架（进程溯源 / 签名 / 命令行 / 父子链 / 路径）
- 引导模型输出 ATT&CK 战术编号与结构化处置建议

---

## 目录结构

```
LLMHips/
├── DriverLayer/
│   ├── ZDriverHips/          # 内核驱动（C）
│   └── ProcessHips/          # 参考驱动实现
├── DriverServer/
│   └── SecurityBridge/       # C# 桥接服务
├── LLM/
│   └── QwenLLM/              # LLM 推理服务（FastAPI）
├── security-console/
│   └── security-console/     # React 前端
└── ProjectPlan/              # 实现规划文档
```

---

## 运行环境要求

| 组件 | 要求 |
|------|------|
| 内核驱动 | Windows 10/11 x64，已禁用驱动签名强制（测试签名模式） |
| C# 桥接层 | .NET 8，Windows x64 |
| 前端 | Node.js 18+，任意平台（Mock 模式可在 macOS/Linux 运行） |
| LLM 推理 | Python 3.10+，GPU 推荐 16GB+ 显存（可 CPU 推理，速度较慢） |

---

## 快速开始

### 1. 启动 LLM 推理服务

```bash
cd LLM/QwenLLM
pip install -r Web/requirements.txt
python Web/server.py
# 默认监听 http://localhost:8000
```

### 2. 启动 C# 桥接服务

```bash
cd DriverServer/SecurityBridge
dotnet run
# 默认监听 ws://localhost:9527/ws
# appsettings.json 中 UseMockDriver: true 可在无驱动环境下运行
```

### 3. 启动前端

```bash
cd security-console/security-console
cp .env.example .env.local
# 编辑 .env.local，填入桥接服务地址
npm install
npm run dev
```

### 4. 加载内核驱动（Windows 环境）

```powershell
# 以管理员身份运行
sc create ZDriverHips binPath= "C:\path\to\ZDriverHips.sys" type= kernel
sc start ZDriverHips
```

---

## 技术亮点

- **跨特权级完整通信链路**：React → WebSocket → C# → IOCTL → Ring 0 → `ZwTerminateProcess`
- **IRQL 安全的无锁队列**：DISPATCH_LEVEL 下正确使用原子操作，无锁、无死锁
- **签名验证分层方案**：内核层采集原始数据，用户态 `WinVerifyTrust` 补充签名验证
- **实时进程树可视化**：React Flow + Dagre 自动布局，高危攻击链一目了然
- **LLM 流式研判**：SSE 实时渲染，AbortController 处理竞态，支持多轮追问

---

## License

MIT
