<!-- Language switch -->
<div align="right">
  <a href="README_CN.md">中文</a> | <strong>English</strong>
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

**LLM-powered Host Intrusion Prevention System**

*A small idea that got a little out of hand — your critique is genuinely welcome.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-8.0-purple?logo=dotnet)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://reactjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python)](https://python.org)
[![LLM](https://img.shields.io/badge/LLM-Qwen2.5--7B-orange)](https://huggingface.co/Qwen)
[![Platform](https://img.shields.io/badge/Platform-Windows%20Kernel-0078D4?logo=windows)](https://learn.microsoft.com/en-us/windows-hardware/drivers/)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen)](https://github.com/blackstreetlight/LLMHips/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4)](https://github.com/blackstreetlight/LLMHips/pulls)

</div>

---

## 🧠 The Idea Behind This

Traditional HIPS relies on static rule engines — they either block too aggressively or miss novel attack patterns entirely. The question I kept asking was:

> *What if the decision layer could reason about process behavior in natural language, not just match signatures?*

This project is my attempt at an answer. It wires a **Windows kernel minifilter driver** to a **C# WebSocket bridge** to a **React security console** — and plugs a locally-running LLM into that chain for contextual analysis and human-readable explanations.

It started as a graduation thesis. It grew into something I genuinely find interesting. I'm sharing it publicly because I believe the architecture has potential, and I'd like experienced engineers — especially those in kernel security, threat detection, or LLM agent systems — to poke holes in it and help me understand what I'm missing.

**I am a student. If something here is naive or wrong, please open an issue and explain why. That's worth more to me than a star.**

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><b>Security Dashboard</b></td>
    <td align="center"><b>Process Monitor</b></td>
  </tr>
  <tr>
    <td><img src="Picture/截屏2026-05-08 18.31.27.png" alt="Security Dashboard" width="480"/></td>
    <td><img src="Picture/截屏2026-05-08 18.32.18.png" alt="Process Monitor" width="480"/></td>
  </tr>
  <tr>
    <td align="center"><b>Real-time Process Tree</b></td>
    <td align="center"><b>Kernel Intercept History</b></td>
  </tr>
  <tr>
    <td><img src="Picture/截屏2026-05-08 18.32.53.png" alt="Process Tree" width="480"/></td>
    <td><img src="Picture/截屏2026-05-08 18.33.19.png" alt="Intercept History" width="480"/></td>
  </tr>
</table>

> 📹 A demo video is available locally at `Picture/演示视频.mov` (not uploaded — exceeds GitHub's 100 MB file limit).

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────┐
│                  Windows Kernel  (Ring 0)                  │
│                                                            │
│  PsSetCreateProcessNotifyRoutineEx                         │
│            │                                               │
│            ▼                                               │
│    ZDriverHips.sys ──── rule pre-filter ──► ZwTerminateProcess
│            │             (synchronous, <1ms)               │
│            │   IOCTL ring buffer (circular, drop-on-full)  │
└────────────┼───────────────────────────────────────────────┘
             │  DeviceIoControl  (METHOD_BUFFERED)
             ▼
┌────────────────────────────────────────────────────────────┐
│          SecurityBridge  (C# / .NET 8,  Ring 3)            │
│                                                            │
│  WindowsDriverClient                                       │
│    └─ Marshal.PtrToStructure<DRIVER_EVENT_BUFFER>          │
│         (byte-exact struct alignment, LayoutKind.Sequential)
│                                                            │
│  WinVerifyTrust (P/Invoke) ── Authenticode re-verify       │
│  ReEvaluateRiskLevel ──────── rule mirror (post-sign)      │
│                                                            │
│  WebSocketHandler ─────────── JSON push → frontend         │
└────────────┼───────────────────────────────────────────────┘
             │  ws://host:9527/ws
             ▼
┌────────────────────────────────────────────────────────────┐
│        React Security Console  (Vite + TypeScript)         │
│                                                            │
│  Zustand store ──── event stream                           │
│  MonitorPanel ─────────────── real-time event list         │
│  ProcessTreeView ──────────── React Flow + Dagre DAG       │
│  InterceptHistory ─────────── blocked event audit log      │
│  ProcessDetailView ── LLM query ──► vllm HTTP endpoint     │
│                                         │                  │
│                                         ▼                  │
│                               Qwen2.5-7B-Instruct          │
│                               (local, Python / vllm)       │
└────────────────────────────────────────────────────────────┘
```

---

## 🔧 Real Engineering Challenges

*(Not "highlights" — these are the places where things actually broke and taught me something. If you've solved them better, I want to know.)*

### 1. Cross-Privilege Struct Alignment: The 4-Byte Trap

The C# `DRIVER_EVENT_BUFFER` struct must be **byte-for-byte identical** to the kernel struct in `Common.h`, enforced via `[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]`. During development, a single misplaced `uint EventType` field (4 bytes) caused `ProcessName` to read 2 Unicode characters into the actual buffer — appearing as garbled output in logs. The compiled `.sys` and the C# struct had drifted to different revisions of the header.

This is a quiet failure mode: the data reads back without error, it's just wrong. Worth knowing if you ever do cross-privilege P/Invoke with variable-length Unicode strings.

### 2. The LLM Must Not Touch the Enforcement Path

The blocking decision — whether to call `ZwTerminateProcess` — must be made synchronously, inside the `PsSetCreateProcessNotifyRoutineEx` callback, with a latency budget in single-digit milliseconds. The LLM has no place here.

The current design keeps the LLM entirely on the **analysis path**: the frontend fires an async HTTP request to the vllm server only after the event has already been blocked or allowed. The kernel-to-bridge-to-frontend pipeline is unaffected by inference latency. I think this is the right split, but I'm curious whether anyone has seen architectures where the LLM is given real veto power without introducing unacceptable latency.

### 3. Signature Verification Requires a Two-Layer Design

`WinVerifyTrust` is a user-mode API. The kernel minifilter cannot call it. This means the driver reports `SIGN_UNKNOWN` for every process, and the bridge re-runs Authenticode verification via P/Invoke after receiving the event.

The practical consequence: the rule *"unsigned binary launched from a user-writable path → HIGH risk"* can only fire correctly in the bridge, not the kernel. Without this second layer, that rule is dead code and unsigned malware in `%APPDATA%` would always be classified as `MEDIUM`.

### 4. Maintaining a Live DAG under a Stream of Events

The process tree (React Flow + Dagre) receives events as a stream, not a snapshot. Each `process_create` event references a `parentPid` that may or may not already exist in the tree. Process exit events should dim — not remove — nodes.

The main subtleties: PID reuse (a new process can claim a PID whose node is still in the "terminated" state), orphan processes (parent PID was never observed because monitoring started mid-session), and layout thrash (Dagre re-runs on every event, which at high event rates becomes the dominant render cost).

### 5. IOCTL Ring Buffer: Drop vs. Block

The driver maintains a fixed-size circular event buffer. If the userspace consumer (`DeviceIoControl` polling) is slow — for example, because a build toolchain is spawning hundreds of processes per second — the buffer fills and new events are dropped. This is a deliberate policy choice: the kernel callback must return quickly, and starving it of buffer space is preferable to blocking it.

I'm not confident this is the best approach. An ETW (Event Tracing for Windows) session might be a cleaner architecture, with better OS-level buffering and less risk of data corruption under concurrent access. If you have experience with ETW-based kernel event pipelines, I'd genuinely like to understand the tradeoffs.

---

## 📁 Repository Structure

```
LLMHips/
├── DriverLayer/              # WDK kernel driver (C)
│   └── ZDriverHips/          # Minifilter + rule engine + IOCTL interface
├── DriverServer/             # C# bridge server (.NET 8)
│   └── SecurityBridge/       # WebSocket handler, driver client, LLM proxy
├── security-console/         # React frontend (Vite + TypeScript)
│   └── security-console/
│       ├── src/features/     # Dashboard, Monitor, ProcessTree, InterceptHistory
│       └── src/store/        # Zustand global state
├── LLM/                      # Python inference server
│   └── QwenLLM/              # vllm + Qwen2.5-7B-Instruct
└── Picture/                  # Screenshots & demo video
```

---

## 🚀 Quick Start

### Environment Requirements

| Component | Requirement |
|-----------|------------|
| Kernel Driver | Windows 10/11 x64, test-signing enabled |
| C# Bridge | .NET 8 SDK |
| Frontend | Node.js 18+, npm or pnpm |
| LLM Server | Python 3.10+, CUDA GPU (≥16 GB VRAM recommended) |

> **Mock mode**: The bridge ships with `"UseMockDriver": true` in `appsettings.json`. The full frontend + bridge stack runs on macOS and Linux with no kernel driver or GPU required — useful for frontend development and architecture exploration.

### 1 — LLM Inference Server

```bash
cd LLM/QwenLLM
pip install -r requirements.txt
python server.py          # Listens on http://localhost:8000
```

### 2 — C# Bridge

```bash
cd DriverServer/SecurityBridge
dotnet run                # WebSocket on ws://localhost:9527/ws
```

### 3 — React Console

```bash
cd security-console/security-console
cp .env.example .env.local   # set VITE_WS_URL and VITE_LLM_URL
npm install && npm run dev   # http://localhost:5173
```

### 4 — Windows Kernel Driver *(production only)*

```
# Open DriverLayer/ZDriverHips/ZDriverHips.sln in Visual Studio
# Build → x64 / Release
# bcdedit /set testsigning on   (requires elevated prompt, reboot)
# sc create ZDriverHips binPath= "C:\path\to\ZDriverHips.sys" type= kernel
# sc start ZDriverHips
```

---

## 🗺️ v1.1 Roadmap

v1.0 establishes the end-to-end pipeline. Here's what's planned for v1.1:

| Feature | What & Why |
|---------|-----------|
| **RAG for threat context** | Index CVE records, MITRE ATT&CK techniques, and malware sandbox reports into a vector store. LLM retrieves relevant context before generating analysis, reducing hallucination on specific threat names and TTPs. |
| **Domain-specific fine-tuning** | Fine-tune the base model on labeled process event datasets (open malware sandbox telemetry). Goal: more accurate risk classification than the current heuristic rule engine, especially for living-off-the-land binaries (LOLBins). |
| **Multi-step Agent architecture** | Replace single-turn LLM calls with a ReAct-style agent loop: `observe → plan → act`. The agent will be able to call tools (VirusTotal lookup, parent chain traversal, network connection query) before committing to a recommendation. |
| **Kernel detection surface expansion** | Add network socket monitoring (`FwpmFilterAdd`), registry write interception (`CmRegisterCallback`), and file write events (`FltRegisterFilter`). Current version monitors process creation only — a significant blind spot for fileless attacks. |
| **Online / offline model switching** | UI toggle to route LLM queries to either the local vllm server (offline, private data stays local) or a cloud API endpoint (online, higher capability). Configuration-driven, no code change required. |
| **Multi-LLM backend support** | Plugin-style LLM backend adapter so users can swap in Claude, Gemini, ChatGPT, DeepSeek, or any OpenAI-compatible endpoint without modifying bridge code. |

---

## 🤝 Let's Build This Together

I'm sharing this openly because I think the direction is interesting, and I know I'm not the right person to take it to its full potential alone.

**If you work in kernel security, EDR/XDR, threat intelligence, or LLM agent systems:**

There are real open questions in this project that I don't have good answers for. If you do, I'd love to hear them — even if the answer is "your approach is wrong because...". Especially if it's that.

Questions I'm sitting with:
- Is `PsSetCreateProcessNotifyRoutineEx` + `ZwTerminateProcess` the right interception point, or does the industry use a different mechanism for reliable pre-execution blocking?
- How do production EDRs deal with the latency/accuracy tradeoff on the enforcement path? Is there a standard pattern I should be reading about?
- IOCTL ring buffer vs. ETW vs. kernel streaming — what would you choose for this use case and why?
- Is a 7B model running locally actually useful in this context, or is the rule engine doing all the real work and the LLM is just generating plausible-sounding explanations?

**If you're a student or early-career engineer exploring security or systems:**

The mock driver mode lets you run everything without any kernel setup or GPU. It's a reasonable starting point for understanding how a multi-layer security event pipeline is structured. Feel free to ask questions in Discussions — I'll answer what I can.

**How to contribute:**
- 🐛 Open an issue for bugs, wrong assumptions, or architectural critique
- 💡 Open a discussion for questions or ideas
- 🔀 Submit a PR with improvements — all sizes welcome
- ⭐ A star helps visibility, but honest feedback helps more

---

## ⚠️ Disclaimer

This project interacts with the Windows kernel. **Test only in isolated virtual machines with snapshots.** Never deploy the driver to a production system. The authors accept no responsibility for system instability, data loss, or unintended process termination resulting from use of this software.

---

## 📄 License

[MIT](LICENSE) — use it freely, attribution appreciated.
