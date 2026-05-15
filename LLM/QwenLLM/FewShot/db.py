import sqlite3
import json
import uuid
import os
from datetime import datetime

# 数据库文件路径（和 db.py 在同一个文件夹）
DB_PATH = os.path.join(os.path.dirname(__file__), "case_library.db")
SEEDS_PATH = os.path.join(os.path.dirname(__file__), "seeds.json")


def get_conn():
    """获取数据库连接"""
    return sqlite3.connect(DB_PATH)


def init_db():
    """建表 + 导入种子数据（幂等，可以反复调用）"""
    conn = get_conn()
    c = conn.cursor()

    # 建 cases 表
    c.execute("""
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            process_name TEXT,
            process_path TEXT,
            parent_process TEXT,
            cmd_line TEXT,
            is_signed INTEGER,
            verdict TEXT,
            risk_score INTEGER,
            attack_technique TEXT,
            summary TEXT,
            network_info TEXT,
            file_ops TEXT,
            registry_ops TEXT,
            extra TEXT,
            created_at TEXT
        )
    """)

    # 建 embeddings 表
    c.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            case_id TEXT PRIMARY KEY,
            vector BLOB
        )
    """)

    conn.commit()

    # 如果 cases 表是空的，导入种子数据
    c.execute("SELECT COUNT(*) FROM cases")
    count = c.fetchone()[0]
    if count == 0:
        print("[FewShot] 案例库为空，正在导入种子数据...")
        with open(SEEDS_PATH, "r", encoding="utf-8") as f:
            seeds = json.load(f)
        for s in seeds:
            c.execute("""
                INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                str(uuid.uuid4()),
                s["process_name"], s["process_path"],
                s["parent_process"], s["cmd_line"],
                1 if s["is_signed"] else 0,
                s["verdict"], s["risk_score"],
                s.get("attack_technique"), s["summary"],
                s.get("network_info"), s.get("file_ops"),
                s.get("registry_ops"), s.get("extra"),
                datetime.now().isoformat()
            ))
        conn.commit()
        print(f"[FewShot] 导入完成，共 {len(seeds)} 条种子数据")
    
    conn.close()


def save_case(event: dict, verdict: str, risk_score: int,
              attack_technique: str, summary: str) -> str:
    """把一条新案例写进数据库，返回 case_id"""
    case_id = str(uuid.uuid4())
    conn = get_conn()
    conn.execute("""
        INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        case_id,
        event.get("processName"), event.get("processPath"),
        event.get("parentProcessName"), event.get("cmdLine"),
        1 if event.get("isSigned") else 0,
        verdict, risk_score, attack_technique, summary,
        None, None, None, None,
        datetime.now().isoformat()
    ))
    conn.commit()
    conn.close()
    return case_id


def get_all_cases() -> list[dict]:
    """读取所有案例（不含向量）"""
    conn = get_conn()
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM cases").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_embedding(case_id: str, vector_bytes: bytes):
    """保存某条案例的向量"""
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO embeddings VALUES (?,?)",
        (case_id, vector_bytes)
    )
    conn.commit()
    conn.close()


def get_all_embeddings() -> list[tuple[str, bytes]]:
    """读取所有 (case_id, vector_bytes)"""
    conn = get_conn()
    rows = conn.execute("SELECT case_id, vector FROM embeddings").fetchall()
    conn.close()
    return rows