<!-- Language switch -->
<div align="right">
  <a href="README_CN.md">中文</a> | <strong>English</strong>
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

It started as a small personal project that turned into something I genuinely find interesting. I'm sharing it publicly because I believe the architecture has potential, and I'd like experienced engineers — especially those in kernel security, threat detection, or LLM agent systems — to poke holes in it and help me grow.

**I'm a newcomer just getting my footing in this field. If something here is naive or wrong, please open an issue and explain why. That kind of feedback is worth far more to me than a star.**

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

## 🔩 Module Design Overview

A brief walkthrough of each layer's design thinking — not a complete spec, just the key decisions worth knowing about.

### Layer 1 — Kernel Driver (`ZDriverHips`)

The driver registers a `PsSetCreateProcessNotifyRoutineEx` callback to intercept every process creation system-wide. Inside the callback, a lightweight rule engine evaluates the process against a set of heuristics (dangerous tool names, suspicious command-line patterns, path-based risk signals) and either terminates the process immediately via `ZwTerminateProcess` or tags it for monitoring. The decision is synchronous and must complete in microseconds.

Events are written to a fixed-size IOCTL ring buffer. When the buffer is full, new events are dropped — by design. The kernel callback cannot be blocked waiting for userspace to consume events.

### Layer 2 — Bridge Server (`SecurityBridge`)

The bridge polls the driver buffer via `DeviceIoControl` and unmarshals each event into a C# struct using `Marshal.PtrToStructure<T>`. The struct layout must be byte-exact with the kernel definition (`LayoutKind.Sequential`).

Because `WinVerifyTrust` (Authenticode signature verification) is a user-mode-only API, the driver reports `SIGN_UNKNOWN` for all processes. The bridge re-evaluates each event's signing status via P/Invoke, then re-runs the risk scoring with the actual signing result. This two-pass design is what makes the rule "unsigned binary in `%APPDATA%` → HIGH risk" actually work.

Finalized events are serialized to JSON and pushed to connected clients over WebSocket (`System.Net.WebSockets`).

### Layer 3 — React Console (`security-console`)

The frontend maintains a single Zustand store as the source of truth for the event stream. Four views read from this store:

- **Dashboard** — aggregate stats, risk distribution, and a rolling alert feed
- **Process Monitor** — filterable live list of process events with inline action controls (allow / block / whitelist)
- **Process Tree** — a React Flow + Dagre graph that builds a parent-child DAG from incoming events in real time. Exit events dim nodes rather than removing them, so the tree shows the history of process activity, not just what's alive.
- **Intercept History** — an audit log of all kernel-blocked events with full metadata

### Layer 4 — LLM Server (`QwenLLM`)

A vllm-served Qwen2.5-7B-Instruct instance exposes a simple HTTP endpoint. When the user opens the detail panel for a specific process event, the frontend constructs a prompt from the event metadata and fires an async request. The response is displayed as a plain-language analysis of the process.

The LLM runs **entirely off the enforcement path** — the kernel has already decided before any inference happens.

---

## ⚠️ Known Limitations & Honest Shortcomings

*This section exists because glossing over weaknesses in a README is pointless. Here's what doesn't work well yet.*

### The LLM Isn't Actually Reasoning — It's Paraphrasing

This is the most important caveat. Right now, the LLM receives a prompt that contains the process name, path, command line, risk level, parent process, and signing status — and generates a paragraph that largely re-describes that same information in natural language. It looks like analysis, but it's closer to structured summarization.

There's no genuine reasoning happening because:
- The model has no access to external threat intelligence (VirusTotal, MITRE ATT&CK, sandbox reports)
- It has no memory of previous events — each query is stateless
- It doesn't build behavioral profiles or detect sequences of low-risk events that together constitute an attack
- It cannot take action — it can only describe

The risk level it "explains" was already determined by the rule engine before the LLM was invoked. In the current architecture, removing the LLM would not change a single blocking decision. This is the core limitation the v1.1 Agent architecture and RAG integration are meant to address.

### Kernel Detection Coverage Is Narrow

The driver only monitors **process creation**. This means the following are completely invisible to the system:

- Fileless attacks (shellcode injected into existing processes, no new process spawned)
- DLL injection and process hollowing
- Registry persistence (`HKLM\...\Run` writes)
- Network connections initiated by already-running processes
- File writes to sensitive paths

A real EDR monitors all of these. This system currently covers one entry point.

### No Behavioral Baseline or Sequence Analysis

Each event is evaluated in isolation. The system cannot detect slow attacks where each individual action appears benign — for example, a legitimate-looking process that runs for 10 minutes before reaching out to a C2 server. Without temporal correlation across events, these patterns are invisible.

### WebSocket Has No Authentication

The bridge pushes all process events over an unauthenticated WebSocket endpoint. Anyone on the local network who discovers `ws://host:9527/ws` can receive the full event stream. This is fine for a local demo but would need proper auth (token-based or mTLS) before any real deployment.

### LLM Hallucination Risk

The model may confidently describe a process as malicious based on superficial name similarity, or miss a genuinely dangerous process it hasn't seen patterns of. The LLM output is advisory only and should never be used as the sole basis for a blocking decision. The rule engine is more trustworthy for enforcement; the LLM is better suited for helping a human analyst understand context quickly.

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

**If you're also early in your career and exploring security or systems:**

The mock driver mode lets you run everything without any kernel setup or GPU. It's a reasonable starting point for understanding how a multi-layer security event pipeline is structured. Feel free to ask questions in Discussions — I'll answer what I can, and I'd genuinely appreciate pointers from those who know more.

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
