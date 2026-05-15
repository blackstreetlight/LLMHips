import numpy as np
from sentence_transformers import SentenceTransformer
from db import get_all_cases, get_all_embeddings, save_embedding

# 模型只加载一次
_model = None

def get_model():
    global _model
    if _model is None:
        print("[FewShot] 加载 embedding 模型...")
        _model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
        print("[FewShot] embedding 模型加载完成")
    return _model


def make_feature_text(case: dict) -> str:
    """把案例的字段拼成一段文字，用于向量化"""
    signed = "已签名" if case.get("is_signed") else "未签名"
    return (
        f"进程 {case.get('process_name', '')} "
        f"路径 {case.get('process_path', '')} "
        f"父进程 {case.get('parent_process', '')} "
        f"命令行 {case.get('cmd_line', '')} "
        f"{signed}"
    )


def build_embeddings_if_needed():
    """
    检查 embeddings 表，把还没有向量的案例补全
    每次服务启动时调用一次
    """
    model = get_model()
    cases = get_all_cases()
    existing = {row[0] for row in get_all_embeddings()}  # 已有向量的 case_id 集合

    missing = [c for c in cases if c['id'] not in existing]
    if not missing:
        print(f"[FewShot] 所有 {len(cases)} 条案例已有向量，跳过")
        return

    print(f"[FewShot] 正在为 {len(missing)} 条案例生成向量...")
    for case in missing:
        text = make_feature_text(case)
        vector = model.encode(text)
        save_embedding(case['id'], vector.astype(np.float32).tobytes())
    print("[FewShot] 向量生成完成")


def retrieve_top_k(event: dict, k: int = 3) -> list[dict]:
    """
    输入一个进程事件，返回最相似的 Top-K 历史案例
    event 的字段和 cases 表一致（processName → process_name 注意转换）
    """
    model = get_model()

    # 把当前进程特征转成向量
    query_text = make_feature_text({
        'process_name': event.get('processName', ''),
        'process_path': event.get('processPath', ''),
        'parent_process': event.get('parentProcessName', ''),
        'cmd_line': event.get('cmdLine', ''),
        'is_signed': event.get('isSigned', False),
    })
    query_vec = model.encode(query_text).astype(np.float32)

    # 加载所有案例和向量
    cases = {c['id']: c for c in get_all_cases()}
    all_embeddings = get_all_embeddings()  # [(case_id, vector_bytes), ...]

    if not all_embeddings:
        return []

    # 计算余弦相似度
    ids = []
    matrix = []
    for case_id, vec_bytes in all_embeddings:
        ids.append(case_id)
        matrix.append(np.frombuffer(vec_bytes, dtype=np.float32))

    matrix = np.array(matrix)  # shape: (N, D)

    # 余弦相似度 = 点积 / (范数相乘)
    sims = matrix @ query_vec / (
        np.linalg.norm(matrix, axis=1) * np.linalg.norm(query_vec) + 1e-8
    )

    # 取 Top-K
    top_k_idx = np.argsort(sims)[-k:][::-1]
    return [cases[ids[i]] for i in top_k_idx if ids[i] in cases]


def format_cases_for_prompt(cases: list[dict]) -> str:
    """把检索到的案例格式化成注入 Prompt 的文字"""
    if not cases:
        return ""

    lines = ["【历史相似案例参考】\n"]
    for i, c in enumerate(cases, 1):
        signed = "已签名" if c.get("is_signed") else "未签名"
        lines.append(
            f"案例{i}：\n"
            f"- 进程：{c['process_name']}（{signed}）\n"
            f"- 路径：{c['process_path']}\n"
            f"- 父进程：{c['parent_process']}\n"
            f"- 命令行：{c['cmd_line']}\n"
            f"- 研判结论：{c['verdict']}（{c['risk_score']}分）"
            + (f"  ATT&CK: {c['attack_technique']}" if c.get('attack_technique') else "")
            + f"\n- 摘要：{c['summary']}\n"
        )
    lines.append("请参考以上案例对当前进程进行研判。")
    return "\n".join(lines)