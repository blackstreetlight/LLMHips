# coding=utf-8
# Copyright 2024 The Qwen team, Alibaba Group and The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
ZLLM (LLMHips-LM) 快速分词器（Rust 实现后端）
================================================
本文件实现基于 HuggingFace tokenizers 库（Rust 编写）的快速分词器。

慢速 vs 快速分词器对比：
┌──────────────────┬─────────────────────────┬──────────────────────────────┐
│                  │ 慢速（tokenization_ljz） │   快速（本文件）             │
├──────────────────┼─────────────────────────┼──────────────────────────────┤
│ 实现语言         │ 纯 Python               │ Rust（tokenizers 库）        │
│ 分词速度         │ 较慢                    │ 快 10-100x（批量场景更明显）  │
│ 依赖文件         │ vocab.json + merges.txt │ tokenizer.json（含所有配置） │
│ 支持 offset 映射 │ 否                      │ 是（return_offsets_mapping）  │
│ 推荐场景         │ 研究/调试               │ 生产环境、批量推理            │
└──────────────────┴─────────────────────────┴──────────────────────────────┘

分词算法与慢速版本完全相同（字节级 BPE），只是后端换成了 Rust。
tokenizer.json 是 tokenizers 库的序列化格式，包含词表、合并规则和特殊 token 等全部信息。

使用示例：
    tokenizer = Qwen2TokenizerFast.from_pretrained("path/to/ZLLM-7B-Instruct")
    result = tokenizer("你好世界", return_tensors="pt")
    # result["input_ids"]: tensor([[...]])
"""

from typing import Optional

from ...tokenization_utils import AddedToken
from ...tokenization_utils_fast import PreTrainedTokenizerFast
from ...utils import logging

# 慢速版本（作为回退方案，当 tokenizer.json 不可用时使用）
from .tokenization_qwen2 import Qwen2Tokenizer


logger = logging.get_logger(__name__)

# ── 分词器文件名映射 ──
# from_pretrained 会按此映射查找对应文件
VOCAB_FILES_NAMES = {
    "vocab_file":     "vocab.json",      # 词表文件（慢速分词器需要）
    "merges_file":    "merges.txt",      # BPE 合并规则（慢速分词器需要）
    "tokenizer_file": "tokenizer.json",  # Rust 快速分词器的完整配置（推荐使用）
}

# 各检查点的最大输入长度（token 数）
MAX_MODEL_INPUT_SIZES = {"qwen/qwen-tokenizer": 32768}


class Qwen2TokenizerFast(PreTrainedTokenizerFast):
    """
    ZLLM / Qwen2 快速分词器。

    底层由 HuggingFace tokenizers（Rust 库）实现，比纯 Python 版快 10-100 倍，
    适合生产推理环境。分词结果与慢速版完全一致。

    主要特性（继承自 PreTrainedTokenizerFast）：
    - batch_encode_plus：批量并行编码，速度优势最明显
    - return_offsets_mapping：可返回每个 token 在原文中的字符偏移量（NER 等任务需要）
    - 自动 padding / truncation
    - apply_chat_template：支持 Qwen 对话模板格式化

    文件：
        tokenizer.json    ← 快速分词器的完整配置（Rust 后端读取）
        vocab.json        ← 仅慢速回退版本需要
        merges.txt        ← 仅慢速回退版本需要

    特殊 token：
        <|endoftext|>   → eos / pad / unk token（ID: 151643）
        <|im_start|>    → 对话轮次开始标记（ID: 151644，instruct 版本）
        <|im_end|>      → 对话轮次结束标记（ID: 151645，instruct 版本）

    参数：
        vocab_file      : vocab.json 路径（可选，仅慢速模式需要）
        merges_file     : merges.txt 路径（可选，仅慢速模式需要）
        tokenizer_file  : tokenizer.json 路径（推荐，快速模式使用）
        unk_token       : 未知 token
        bos_token       : 序列开始 token（Qwen 不使用，为 None）
        eos_token       : 序列结束 token
        pad_token       : 填充 token（批量处理时对齐序列长度）
    """

    vocab_files_names = VOCAB_FILES_NAMES
    # 模型只接受这两个张量作为输入（不使用 token_type_ids / special_tokens_mask 等）
    model_input_names = ["input_ids", "attention_mask"]
    # 对应的慢速分词器类，当 tokenizer.json 不可用时作为回退
    slow_tokenizer_class = Qwen2Tokenizer

    def __init__(
        self,
        vocab_file=None,          # vocab.json 路径（有 tokenizer.json 时可省略）
        merges_file=None,         # merges.txt 路径（有 tokenizer.json 时可省略）
        tokenizer_file=None,      # tokenizer.json 路径（推荐提供，快速模式必需）
        unk_token="<|endoftext|>",
        bos_token=None,           # Qwen 不使用 BOS token
        eos_token="<|endoftext|>",
        pad_token="<|endoftext|>",
        **kwargs,
    ):
        # ── 将特殊 token 字符串包装为 AddedToken 对象 ──
        # 与慢速版本保持一致：不剥离两侧空格，标记为 special，不做 Unicode 归一化
        # 这确保 <|im_start|> 等特殊 token 不会被 BPE 算法拆分处理
        bos_token = (
            AddedToken(bos_token, lstrip=False, rstrip=False, special=True, normalized=False)
            if isinstance(bos_token, str) else bos_token
        )
        eos_token = (
            AddedToken(eos_token, lstrip=False, rstrip=False, special=True, normalized=False)
            if isinstance(eos_token, str) else eos_token
        )
        unk_token = (
            AddedToken(unk_token, lstrip=False, rstrip=False, special=True, normalized=False)
            if isinstance(unk_token, str) else unk_token
        )
        pad_token = (
            AddedToken(pad_token, lstrip=False, rstrip=False, special=True, normalized=False)
            if isinstance(pad_token, str) else pad_token
        )

        # ── 调用父类初始化 ──
        # PreTrainedTokenizerFast 会根据 tokenizer_file 加载 Rust 后端；
        # 若 tokenizer_file 为 None，会尝试用 vocab_file + merges_file 初始化慢速版本
        super().__init__(
            vocab_file=vocab_file,
            merges_file=merges_file,
            tokenizer_file=tokenizer_file,
            unk_token=unk_token,
            bos_token=bos_token,
            eos_token=eos_token,
            pad_token=pad_token,
            **kwargs,
        )

    def save_vocabulary(self, save_directory: str, filename_prefix: Optional[str] = None) -> tuple[str]:
        """
        保存分词器词表文件（vocab.json 和 merges.txt）。

        内部调用 Rust tokenizers 库的 model.save() 方法，
        将底层 BPE 模型的词表和合并规则序列化到目标目录。

        参数：
            save_directory  : 目标目录路径
            filename_prefix : 文件名前缀（可选）

        返回：
            tuple of str，保存的文件路径列表
        """
        # self._tokenizer 是 Rust 侧的 tokenizers.Tokenizer 对象
        # .model.save() 将 BPE 模型参数保存为 vocab.json + merges.txt
        files = self._tokenizer.model.save(save_directory, name=filename_prefix)
        return tuple(files)


# 对外导出的公开类
__all__ = ["Qwen2TokenizerFast"]
