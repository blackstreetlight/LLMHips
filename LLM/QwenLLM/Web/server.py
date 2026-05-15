"""
LLMHips 安全研判推理服务
FastAPI + Qwen2.5-7B-Instruct + MPS (Apple Silicon)
支持本地模型 / OpenAI 兼容 API / Anthropic Claude 三种推理引擎
提供流式 SSE 接口供前端实时对话
"""

import json
import asyncio
import time
import sys
import os
import re
from threading import Thread
from contextlib import asynccontextmanager
from typing import Optional, AsyncGenerator

import httpx
import numpy as np
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── FewShot 路径注册（必须在 import db/retriever 之前）──
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'FewShot')))
from db import init_db, save_case, save_embedding, get_all_embeddings
from retriever import build_embeddings_if_needed, retrieve_top_k, format_cases_for_prompt, get_model, make_feature_text

# ── 模型路径（相对于本文件的位置）──
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "Qwen2.5-7B-Instruct")

# ── 全局本地模型/tokenizer 实例 ──
tokenizer = None
model = None


# ══════════════════════════════════════════════════════════════════════
# 系统 Prompt — 九维安全研判框架
# ══════════════════════════════════════════════════════════════════════
SECURITY_SYSTEM_PROMPT = r"""你是 LLMHips 主机入侵防御系统的 AI 安全分析引擎，具备企业级 EDR/XDR 分析能力。
你的任务是对 Windows 进程事件进行深度威胁研判，并与安全分析员进行专业的交互式对话。

## 分析框架（九维研判）

进行完整研判时，**按以下九个维度逐一评估**，每个维度均需给出明确结论；无明显异常的维度可简述。

### 1. 进程身份核查
- **路径合法性**：是否位于 System32 / SysWOW64 / Program Files 等受信任路径
- **名称欺骗检测**：是否与系统进程高度相似（svchost→svch0st、lsass→lsas.exe、explorer→expl0rer）
- **执行位置异常**：从 %TEMP%、%APPDATA%、Downloads、Desktop 执行的"系统进程名"文件
- **文件签名状态**：未签名可执行文件在企业环境属高风险指标，已签名但路径异常同样可疑
- **完整性级别**：High / System 完整性运行的用户态进程须重点关注

### 2. 父子进程链分析
典型高风险进程继承关系（APT 攻击特征）：
- `Office/PDF阅读器 → cmd/powershell`（鱼叉攻击/恶意宏执行）
- `浏览器 → wscript/cscript/mshta/regsvr32`（网页挂马/驱动下载攻击）
- `winword/excel/outlook → regsvr32/rundll32/installutil`（宏代理执行 LOLBin）
- `svchost/lsass → 任意用户态子进程`（服务劫持/内存注入后的子进程）
- `合法系统进程 → 非系统目录子进程`（进程空洞化/孤儿注入痕迹）
- `werfault/dllhost/mmc → 可疑进程`（COM 劫持/进程替换）

### 3. 命令行深度解析
识别以下高危模式：
- **混淆/编码**：Base64（`-enc`/`-encodedcommand`）、XOR、字符串分割拼接、环境变量替换、`char()`函数
- **远程下载执行**：`IEX + DownloadString`、`Invoke-WebRequest`、`certutil -decode/-urlcache`、`bitsadmin /transfer`
- **横向移动**：`psexec`、`wmic /node:`、`net use \\远程路径`、`Enter-PSSession`、`Invoke-Command -ComputerName`
- **凭据操作**：`sekurlsa`、`lsadump`、`hashdump`、`reg save SAM/SYSTEM/SECURITY`、`comsvcs.dll MiniDump`
- **持久化**：`schtasks /create`、`reg add ...Run`、`sc create`、`New-ScheduledTask`、`Add-MpPreference -ExclusionPath`
- **防御规避**：`-windowstyle hidden`、`-executionpolicy bypass`、`Set-MpPreference -Disable*`、`wevtutil cl`、`auditpol /clear`
- **LOLBin 滥用**：`regsvr32 scrobj.dll`、`mshta vbscript:/javascript:`、`rundll32 comsvcs.dll`、`installutil /u`、`cmstp /au`

### 4. 进程注入与内存操纵
- **经典注入链**：`VirtualAllocEx → WriteProcessMemory → CreateRemoteThread`（远程线程注入）
- **进程空洞化**：合法路径进程但内存映像被替换（`NtUnmapViewOfSection + NtWriteVirtualMemory`）
- **反射 DLL 注入**：`mavinject`、`AppInit_DLLs`、`SetWindowsHookEx` 滥用
- **系统组件滥用**：`wuauclt /UpdateDeploymentProvider`、`PresentationHost`、`dfsvc.exe` 被用作注入载体
- **进程 Herpaderping/Doppelgänging**：写入磁盘时替换内容绕过 AV 扫描

### 5. 持久化与权限维持
- **注册表持久化**：`HKCU/HKLM\...\Run`、`Winlogon Userinit/Shell`、`AppInit_DLLs`、`IFEO`（映像劫持）
- **服务持久化**：`sc create/config` 修改 binPath 指向恶意载荷、替换合法服务 DLL
- **计划任务**：高频率触发任务、伪装成系统维护任务（如 `\Microsoft\Windows\...`）
- **启动项劫持**：`%APPDATA%\...\Start Menu\Programs\Startup`、`All Users\Startup`
- **COM 劫持**：`HKCU\Software\Classes\CLSID` 覆盖系统 COM 对象注册

### 6. 横向移动与凭据利用
- **哈希传递（PTH）**：`sekurlsa::pth`、`Invoke-TheHash`、`crackmapexec --ntlm`
- **票据传递（PTT）**：`Rubeus asktgt/ptt`、`mimikatz kerberos::ptt`
- **域控攻击**：DCSync（`DsGetNCChanges` API 无需登录 DC）、Golden Ticket、Silver Ticket
- **凭据转储**：lsass 内存（Task Manager/comsvcs/Dumpert）、NTDS.dit（ntdsutil/vssadmin）、SAM（reg save/esentutl）
- **Kerberoasting / AS-REP Roasting**：`Rubeus kerberoast`、`GetNPUsers.py`、`Invoke-Kerberoast`

### 7. 防御规避技术
- **LOLBin 白名单绕过**：利用微软签名二进制执行未签名代码（installutil、regsvr32、mshta、cmstp）
- **签名欺骗**：证书窃取/伪造、使用盗用代码签名证书的恶意软件
- **时间戳篡改**：`Timestomp` 修改文件 MACE 时间属性规避时间线分析
- **日志清除**：`wevtutil cl Security/System/Application`、`auditpol /clear`、注册表禁用 EventLog 服务
- **AMSI 绕过**：`patch AmsiScanBuffer`、`[Ref].Assembly.GetType(...).GetField('amsiInitFailed')`
- **ETW 绕过**：`patch EtwEventWrite`、禁用 ETW providers 消除遥测

### 8. MITRE ATT&CK 映射
精确标注战术（TA）和技术（T）编号，格式：`战术名(TA00xx) → T1xxx.yyy（技术名）`

常见映射参考：
| 技术 | ATT&CK |
|---|---|
| PowerShell 执行 | T1059.001 |
| Windows 命令 shell | T1059.003 |
| LOLBin 代理执行 | T1218.xxx |
| 进程注入 | T1055.xxx |
| lsass 内存转储 | T1003.001 |
| NTDS.dit 提取 | T1003.003 |
| DCSync | T1003.006 |
| 计划任务持久化 | T1053.005 |
| 注册表 Run 键 | T1547.001 |
| UAC 绕过 | T1548.002 |
| 防火墙禁用 | T1562.004 |
| 事件日志清除 | T1070.001 |
| 审计策略禁用 | T1562.002 |

### 9. 综合风险研判与处置建议
- **置信度评估**：基于命中 IOC 数量、行为严重性、上下文一致性综合打分
- **误报排查**：区分 IT 运维正常操作（合法管理员工具 vs 攻击者工具）
- **威胁归因**：行为模式是否与已知 APT 组织、工具集（Cobalt Strike/Empire/Metasploit）匹配
- **立即处置**：是否需要隔离主机、终止进程、封锁账号
- **取证保留**：建议保留的证据（内存镜像、日志文件、注册表快照）
- **排查建议**：提供具体可操作的 IOC 查询命令（注册表路径、日志查询、文件搜索）

---

## 输出格式规范

- 使用**中文**，语言专业、逻辑清晰
- 使用 Markdown 格式输出（加粗关键词、代码块展示命令、表格对比数据）
- 按上述九个维度分段输出，标注维度编号，无明显异常的维度可简述
- **完整研判结束后**，在最后单独输出以下三个标签，直接裸输出，不要用 Markdown 代码块包裹：

<risk_score>0到100的整数</risk_score>
<action>BLOCK或WATCH或ALLOW</action>
<summary>用一句话（30字以内）概括本次研判结论</summary>

**评分标准：**
- 75–100 → **BLOCK**（高置信度威胁，建议立即阻断）
- 40–74  → **WATCH**（可疑行为，建议持续监控）
- 0–39   → **ALLOW**（正常行为，建议允许）

---

## 对话规则

- **用户追问时**：直接回答，不重复输出评分标签
- **涉及具体 IOC**：提供可操作的排查命令（注册表路径、Sysmon 查询、PowerShell 检测脚本）
- **处置建议**：区分「立即处置」和「取证保留」两类动作
- **不确定时**：明确说明，给出可验证的排查步骤，建议人工复核"""


# ══════════════════════════════════════════════════════════════════════
# 启动/关闭：加载本地模型
# ══════════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    global tokenizer, model

    # 通过环境变量 LOAD_LOCAL_MODEL=1 控制是否加载本地模型
    # 默认不加载，云端 API 模式下不需要本地模型
    load_local = os.environ.get("LOAD_LOCAL_MODEL", "0") == "1"

    if load_local:
        print(f"[LLMHips] 正在加载本地模型: {MODEL_PATH}")
        print(f"[LLMHips] Metal (MPS) available: {torch.backends.mps.is_available()}")
        t0 = time.time()
        try:
            tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
            model = AutoModelForCausalLM.from_pretrained(
                MODEL_PATH,
                dtype=torch.float16,
                device_map="mps" if torch.backends.mps.is_available() else "cpu",
            )
            print(f"[LLMHips] 本地模型加载完成，耗时 {time.time() - t0:.1f}s，设备: {model.device}")
        except Exception as e:
            print(f"[LLMHips] ⚠️  本地模型加载失败（将以云端 API 模式运行）: {e}")
            tokenizer = None
            model = None
    else:
        print("[LLMHips] 本地模型未加载（云端 API 模式）。如需本地模型请设置环境变量 LOAD_LOCAL_MODEL=1")

    init_db()
    build_embeddings_if_needed()

    yield
    print("[LLMHips] 服务关闭")


app = FastAPI(title="LLMHips 推理服务", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════
# 数据模型
# ══════════════════════════════════════════════════════════════════════
class Message(BaseModel):
    role: str    # "system" | "user" | "assistant"
    content: str


class EngineConfig(BaseModel):
    """推理引擎配置，决定使用本地模型还是在线 API"""
    provider: str = "local"          # "local" | "openai" | "anthropic"
    api_key: Optional[str] = None    # 在线 API 密钥
    base_url: Optional[str] = None   # OpenAI 兼容接口地址（DeepSeek/自定义等）
    model: Optional[str] = None      # 模型名称，如 "gpt-4o"、"deepseek-chat"


class ChatRequest(BaseModel):
    messages: list[Message]              # 完整对话历史
    system_extra: Optional[str] = None   # 事件上下文（注入 system prompt）
    event_context: Optional[dict] = None # 用于少样本检索的进程字段
    engine: EngineConfig = EngineConfig() # 推理引擎配置，默认本地
    max_new_tokens: int = 1024
    temperature: float = 0.7
    top_p: float = 0.9


class WritebackRequest(BaseModel):
    event_context: dict
    verdict: str                          # "BLOCK" | "ALLOW" — 人工处置结果
    risk_score: int                       # 由人工动作推算
    summary: str                          # AI 生成的行为摘要
    attack_technique: Optional[str] = None


# ══════════════════════════════════════════════════════════════════════
# 远程 API 流式推理（OpenAI 兼容 / Anthropic）
# ══════════════════════════════════════════════════════════════════════

async def _stream_openai_compat(
    full_messages: list[dict],
    engine: EngineConfig,
    max_tokens: int,
    temperature: float,
    top_p: float,
) -> AsyncGenerator[str, None]:
    """
    向任何 OpenAI 兼容接口发起流式请求，逐 token yield 文本片段。
    兼容：OpenAI / DeepSeek / SiliconFlow / Moonshot / ZhipuAI 等。
    """
    base_url = (engine.base_url or "https://api.openai.com/v1").rstrip("/")
    model_name = engine.model or "gpt-4o"
    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {engine.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_name,
        "messages": full_messages,
        "stream": True,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise HTTPException(
                        status_code=resp.status_code,
                        detail=f"上游 API 错误 {resp.status_code}: {body.decode()[:300]}"
                    )
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                        content = chunk["choices"][0]["delta"].get("content", "")
                        if content:
                            yield content
                    except (json.JSONDecodeError, KeyError, IndexError):
                        pass
        except httpx.ConnectError as e:
            raise HTTPException(status_code=502, detail=f"无法连接到 API 服务：{e}")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="API 请求超时（120s）")


async def _stream_anthropic(
    full_messages: list[dict],
    engine: EngineConfig,
    max_tokens: int,
    temperature: float,
    top_p: float = 0.9,
) -> AsyncGenerator[str, None]:
    """
    向 Anthropic Claude API 发起流式请求，逐 token yield 文本片段。
    Anthropic 的消息格式与 OpenAI 不同：system 单独传参，messages 不含 system role。
    """
    model_name = engine.model or "claude-3-5-sonnet-20241022"
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": engine.api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    # 分离 system message 和对话消息
    system_content = ""
    conv_messages = []
    for msg in full_messages:
        if msg["role"] == "system":
            system_content = msg["content"]
        else:
            conv_messages.append(msg)

    payload = {
        "model": model_name,
        "system": system_content,
        "messages": conv_messages,
        "stream": True,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise HTTPException(
                        status_code=resp.status_code,
                        detail=f"Anthropic API 错误 {resp.status_code}: {body.decode()[:300]}"
                    )
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        data = json.loads(line[6:])
                        if data.get("type") == "content_block_delta":
                            text = data["delta"].get("text", "")
                            if text:
                                yield text
                    except (json.JSONDecodeError, KeyError):
                        pass
        except httpx.ConnectError as e:
            raise HTTPException(status_code=502, detail=f"无法连接到 Anthropic API：{e}")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Anthropic API 请求超时（120s）")


# ══════════════════════════════════════════════════════════════════════
# /health
# ══════════════════════════════════════════════════════════════════════
@app.get("/health")
async def health():
    return {
        "status": "online",
        "local_model": "Qwen2.5-7B-Instruct",
        "local_model_loaded": model is not None,
        "device": str(model.device) if model else "not_loaded",
    }


# ══════════════════════════════════════════════════════════════════════
# /chat — 主推理接口，SSE 流式响应
# 支持：本地 Qwen / OpenAI 兼容 API / Anthropic Claude
# ══════════════════════════════════════════════════════════════════════
@app.post("/chat")
async def chat(req: ChatRequest):
    provider = req.engine.provider if req.engine else "local"

    # 本地模型需要检查是否已加载
    if provider == "local" and (model is None or tokenizer is None):
        raise HTTPException(status_code=503, detail="本地模型尚未加载完成，请稍后重试")

    # ── 构建 System Prompt（所有引擎共用）──────────────────────────
    system_content = SECURITY_SYSTEM_PROMPT
    if req.system_extra:
        system_content += f"\n\n## 当前分析目标\n{req.system_extra}"

    # ── 少样本检索注入（所有引擎共用）──────────────────────────────
    few_shot_injected = False
    if req.event_context:
        similar_cases = retrieve_top_k(req.event_context, k=3)
        few_shot_text = format_cases_for_prompt(similar_cases)
        if few_shot_text:
            system_content += f"\n\n{few_shot_text}"
            few_shot_injected = True

    full_messages = [{"role": "system", "content": system_content}]
    for m in req.messages:
        full_messages.append({"role": m.role, "content": m.content})

    # ── 控制台日志 ─────────────────────────────────────────────────
    sep = "=" * 70
    print(f"\n{sep}")
    print(f"[LLMHips] 推理请求  provider={provider}  few_shot={few_shot_injected}")
    print(sep)
    for msg in full_messages:
        print(f"\n[{msg['role'].upper()}]\n{msg['content']}\n{'-'*40}")
    print(f"{sep}\n")

    # ══════════════════════════════════════════════════════════════
    # 分支：本地 Qwen 推理
    # ══════════════════════════════════════════════════════════════
    if provider == "local":
        prompt_text = tokenizer.apply_chat_template(
            full_messages, tokenize=False, add_generation_prompt=True,
        )
        inputs = tokenizer([prompt_text], return_tensors="pt").to(model.device)

        streamer = TextIteratorStreamer(
            tokenizer, skip_prompt=True, skip_special_tokens=True,
        )
        gen_kwargs = dict(
            **inputs,
            max_new_tokens=req.max_new_tokens,
            temperature=req.temperature,
            do_sample=True,
            top_p=req.top_p,
            repetition_penalty=1.1,
            streamer=streamer,
        )
        thread = Thread(target=model.generate, kwargs=gen_kwargs)
        thread.start()

        async def local_event_generator():
            try:
                for token_text in streamer:
                    if token_text:
                        yield f"data: {json.dumps({'text': token_text}, ensure_ascii=False)}\n\n"
                        await asyncio.sleep(0)
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
            finally:
                yield "data: [DONE]\n\n"
                thread.join()

        return StreamingResponse(
            local_event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ══════════════════════════════════════════════════════════════
    # 分支：远程 API 推理（OpenAI 兼容 / Anthropic）
    # ══════════════════════════════════════════════════════════════
    if not req.engine.api_key:
        raise HTTPException(status_code=400, detail="使用在线模型需要提供 API Key")

    if provider == "anthropic":
        token_source = _stream_anthropic(
            full_messages, req.engine, req.max_new_tokens, req.temperature, req.top_p,
        )
    else:  # "openai" 及所有 OpenAI 兼容服务（DeepSeek / 自定义等）
        token_source = _stream_openai_compat(
            full_messages, req.engine, req.max_new_tokens, req.temperature, req.top_p,
        )

    async def remote_event_generator():
        try:
            async for token_text in token_source:
                if token_text:
                    yield f"data: {json.dumps({'text': token_text}, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0)
        except HTTPException as e:
            yield f"data: {json.dumps({'error': e.detail})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        remote_event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ══════════════════════════════════════════════════════════════════════
# /writeback — 人工处置后写回案例库
# ══════════════════════════════════════════════════════════════════════
@app.post("/writeback")
async def writeback_case(req: WritebackRequest):
    """
    由前端在用户点击「阻断」或「放行」时调用。
    verdict / risk_score 来自人工处置动作，
    summary / attack_technique 来自 AI 分析输出。
    写入前做余弦相似度去重：最近邻 > 0.85 则跳过。
    """
    emb_model = get_model()
    feature_text = make_feature_text({
        "process_name":   req.event_context.get("processName", ""),
        "process_path":   req.event_context.get("processPath", ""),
        "parent_process": req.event_context.get("parentProcessName", ""),
        "cmd_line":       req.event_context.get("cmdLine", ""),
        "is_signed":      req.event_context.get("isSigned", False),
    })
    query_vec = emb_model.encode(feature_text).astype(np.float32)

    all_embeddings = get_all_embeddings()
    if all_embeddings:
        matrix = np.array([np.frombuffer(v, dtype=np.float32) for _, v in all_embeddings])
        sims = matrix @ query_vec / (
            np.linalg.norm(matrix, axis=1) * np.linalg.norm(query_vec) + 1e-8
        )
        max_sim = float(sims.max())
        if max_sim > 0.85:
            print(f"[LLMHips] ⏭  回写跳过（重复案例，相似度={max_sim:.3f}）")
            return {"status": "skipped", "reason": "duplicate", "similarity": max_sim}

    case_id = save_case(
        event=req.event_context,
        verdict=req.verdict,
        risk_score=req.risk_score,
        attack_technique=req.attack_technique,
        summary=req.summary,
    )
    save_embedding(case_id, query_vec.tobytes())
    print(f"[LLMHips] ✅ 回写完成 case_id={case_id}  verdict={req.verdict}  score={req.risk_score}")
    return {"status": "ok", "case_id": case_id}


# ══════════════════════════════════════════════════════════════════════
# 直接运行入口
# ══════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn
    print("[LLMHips] 启动推理服务，端口 8000 ...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
