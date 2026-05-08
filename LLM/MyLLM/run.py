from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
import torch
import time
from threading import Thread

# 模型路径
model_path = "./Qwen2.5-7B-Instruct"

# 检查 Metal 是否可用
print(f"Metal available: {torch.backends.mps.is_available()}")
print(f"Built with Metal: {torch.backends.mps.is_built()}")

# 加载 tokenizer 和模型
print("正在加载模型...")
start_time = time.time()

tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForCausalLM.from_pretrained(
    model_path,
    dtype=torch.float16,
    device_map="mps"
)

load_time = time.time() - start_time
print(f"\n模型加载完成！耗时：{load_time:.2f} 秒")

# 打印模型信息（诊断）
print(f"Model device: {model.device}")
print(f"Model dtype: {model.dtype}")

# 测试 Metal 是否真的在工作
test_input = tokenizer("你好", return_tensors="pt").to(model.device)
with torch.no_grad():
    test_output = model.generate(**test_input, max_new_tokens=10)
print("✅ Metal 测试通过\n")

print("模型加载完成！你可以开始对话了（输入 quit 退出）\n")

while True:
    user_input = input("你：")
    if user_input.lower() in ["quit", "exit", "q"]:
        print("再见！")
        break

    # 构造对话格式
    messages = [
        {"role": "user", "content": user_input}
    ]

    # 生成回答
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True
    )
    inputs = tokenizer([text], return_tensors="pt").to(model.device)

    # 计时
    start_gen = time.time()
    
    print("AI：", end="", flush=True)

    # ✅ 使用流式输出
    streamer = TextIteratorStreamer(tokenizer, skip_special_tokens=True)
    
    # 在后台线程中运行 generate
    generation_kwargs = dict(
        **inputs,
        max_new_tokens=1024,  # ✅ 改回 1024 了
        temperature=0.7,
        do_sample=True,
        top_p=0.9,
        repetition_penalty=1.0,
        streamer=streamer
    )
    
    thread = Thread(target=model.generate, kwargs=generation_kwargs)
    thread.start()
    
    # 实时输出流
    for text in streamer:
        print(text, end="", flush=True)
    
    thread.join()  # 等待线程完成
    
    gen_time = time.time() - start_gen
    print(f"\n\n[生成耗时：{gen_time:.2f} 秒]\n")
