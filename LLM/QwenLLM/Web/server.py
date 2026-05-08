"""
LLMHips 安全研判推理服务
FastAPI + Qwen2.5-7B-Instruct + MPS (Apple Silicon)
提供流式 SSE 接口供前端实时对话
"""

import json
import asyncio
import time
import os
from threading import Thread
from contextlib import asynccontextmanager
from typing import Optional

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── 模型路径（相对于本文件的位置）──
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "Qwen2.5-7B-Instruct")


# ── 全局模型/tokenizer 实例 ──
tokenizer = None
model = None

# ──────────────────────────────────────────────
# 系统 Prompt：让模型专注于安全研判任务
# ──────────────────────────────────────────────
SECURITY_SYSTEM_PROMPT = """你是 LLMHips 主机入侵防御系统的 AI 安全分析引擎，具备企业级 EDR 分析能力。
你的任务是对 Windows 进程事件进行深度威胁研判，并与安全分析员进行专业的交互式对话。

【分析框架】
进行完整研判时，请按以下维度逐一评估：

1. 进程溯源
   - 路径合法性：是否位于系统目录（System32/SysWOW64）或受信任的安装路径
   - 名称欺骗：是否仿冒系统进程（如 svch0st.exe、lsas.exe）
   - 文件签名：未签名的可执行文件在企业环境中属于高风险指标

2. 父子进程链分析
   - 异常的进程继承关系是 APT 攻击的典型特征：
     * Office/PDF 阅读器 → cmd/powershell（鱼叉攻击）
     * 浏览器 → wscript/cscript（网页挂马）
     * svchost → 非系统进程（服务劫持）

3. 命令行行为分析
   - 高危特征：Base64 编码、-enc/-encodedcommand、IEX/Invoke-Expression
   - 横向移动：psexec、wmic、net use、\\远程路径
   - 凭据窃取：sekurlsa、mimikatz、lsass 相关操作
   - 持久化：注册表 Run 键、计划任务、服务创建

4. MITRE ATT&CK 映射
   - 尽量指出可能对应的战术（TA）和技术（T）编号
   - 例如：T1059.001（PowerShell）、T1003（凭据转储）、T1027（混淆）

5. 综合风险研判
   - 结合以上维度给出置信度评估
   - 区分"真实威胁"与"误报"（如 IT 运维工具被触发）

【输出格式】
- 使用中文，语言专业、逻辑清晰
- 按上述维度分段输出，结论明确
- 完整研判结束后，在最后一行单独输出以下两个标签，直接裸输出，不要用 Markdown 代码块（```）包裹：
<risk_score>0到100的整数</risk_score>
<action>BLOCK或WATCH或ALLOW</action>

评分标准：
- 75-100 → BLOCK（高置信度威胁，建议立即阻断）
- 40-74  → WATCH（可疑行为，建议持续监控）
- 0-39   → ALLOW（正常行为，建议允许）

【对话规则】
- 用户追问时：直接回答问题，不重复输出评分标签
- 涉及具体 IOC 时：提供可操作的排查建议
- 不确定时：明确说明并建议人工复核"""


# ──────────────────────────────────────────────
# 启动/关闭：加载模型
# ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global tokenizer, model
    print(f"[LLMHips] 正在加载模型: {MODEL_PATH}")
    print(f"[LLMHips] Metal (MPS) available: {torch.backends.mps.is_available()}")
    t0 = time.time()

    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.float16,
        device_map="mps" if torch.backends.mps.is_available() else "cpu",
    )

    print(f"[LLMHips] 模型加载完成，耗时 {time.time() - t0:.1f}s，设备: {model.device}")
    yield
    print("[LLMHips] 服务关闭")


app = FastAPI(title="LLMHips 推理服务", lifespan=lifespan)

# ── CORS：允许前端跨域访问 ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# 数据模型
# ──────────────────────────────────────────────
class Message(BaseModel):
    role: str   # "system" | "user" | "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: list[Message]          # 完整对话历史
    system_extra: Optional[str] = None  # 事件上下文（注入到 system prompt）
    max_new_tokens: int = 1024
    temperature: float = 0.7
    top_p: float = 0.9



# ──────────────────────────────────────────────
# /health  ── 前端状态检测用
# ──────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "online",
        "model": "Qwen2.5-7B-Instruct",
        "device": str(model.device) if model else "loading",
    }


# ──────────────────────────────────────────────
# /chat  ── 主推理接口，返回 SSE 流式响应
# ──────────────────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="模型尚未加载完成，请稍后重试")

    # 构建完整消息列表，注入安全 system prompt
    system_content = SECURITY_SYSTEM_PROMPT
    if req.system_extra:
        system_content += f"\n\n【当前分析目标】\n{req.system_extra}"

    full_messages = [{"role": "system", "content": system_content}]
    for m in req.messages:
        full_messages.append({"role": m.role, "content": m.content})

    # 应用 Qwen chat template
    prompt_text = tokenizer.apply_chat_template(
        full_messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer([prompt_text], return_tensors="pt").to(model.device)

    # TextIteratorStreamer：在子线程里推理，主线程读取 token 流
    streamer = TextIteratorStreamer(
        tokenizer,
        skip_prompt=True,
        skip_special_tokens=True,
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

    async def event_generator():
        """将 token 流转换为 SSE 数据帧"""
        try:
            for token_text in streamer:
                if token_text:
                    data = json.dumps({"text": token_text}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                    await asyncio.sleep(0)  # 让出事件循环，避免阻塞
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"
            thread.join()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # 关闭 nginx 缓冲，保证实时
        },
    )


# ──────────────────────────────────────────────
# 直接运行入口
# ──────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("[LLMHips] 启动推理服务，端口 8000 ...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
