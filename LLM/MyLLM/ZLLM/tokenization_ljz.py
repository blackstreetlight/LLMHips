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
ZLLM (LLMHips-LM) 慢速分词器（纯 Python 实现）
================================================
本文件实现基于字节级 BPE（Byte-Pair Encoding）的分词器。

分词流程概览：
  原始文本
    → Unicode NFC 归一化（prepare_for_tokenization）
    → 预分词（regex 切分成粗粒度 token）
    → 每个粗 token 的字节序列映射到 Unicode 符号（bytes_to_unicode）
    → BPE 合并（bpe 函数，贪心地合并频率最高的相邻字符对）
    → 查词表得到 token ID（_convert_token_to_id）

文件依赖：
    vocab.json  ← 词表（token 字符串 → ID 的映射，约 15 万词条）
    merges.txt  ← BPE 合并规则（按优先级排序的字符对列表）

使用示例：
    tokenizer = Qwen2Tokenizer.from_pretrained("path/to/ZLLM-7B-Instruct")
    ids = tokenizer("你好，世界！")["input_ids"]
    text = tokenizer.decode(ids)
"""

import json
import os
import unicodedata
from functools import lru_cache
from typing import Optional

import regex as re  # 使用 regex 库而非标准 re，支持 \p{L}（Unicode 字母类）等扩展语法

from ...tokenization_utils import AddedToken, PreTrainedTokenizer
from ...utils import logging


logger = logging.get_logger(__name__)

# ── 分词器文件名映射（用于 from_pretrained 自动定位文件）──
VOCAB_FILES_NAMES = {
    "vocab_file":  "vocab.json",   # 词表：{"token": id, ...}
    "merges_file": "merges.txt",   # BPE 合并规则：每行一对 "A B"
}

# 不同检查点的最大输入长度限制（token 数）
MAX_MODEL_INPUT_SIZES = {"qwen/qwen-tokenizer": 32768}

# ── 预分词正则表达式 ──
# 在 BPE 之前，先用正则将原始文本切分为粗粒度的"单词"片段，
# 避免 BPE 跨越明显的词边界（如标点与单词之间）进行合并。
#
# 各分支含义（从左到右优先匹配）：
#   (?i:'s|'t|'re|'ve|'m|'ll|'d)  → 英语缩写（'s, n't, 're 等），大小写不敏感
#   [^\r\n\p{L}\p{N}]?\p{L}+       → 可选非字母/数字前缀 + 一个或多个 Unicode 字母
#   \p{N}                           → 单个 Unicode 数字
#   ?[^\s\p{L}\p{N}]+[\r\n]*       → 可选空格 + 标点/特殊符号序列（可带换行）
#   \s*[\r\n]+                      → 换行符（含前导空白）
#   \s+(?!\S)                       → 尾部空白（非贪婪，不匹配最后一个非空白前的空格）
#   \s+                             → 其余空白
PRETOKENIZE_REGEX = r"""(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+"""


@lru_cache  # 缓存结果，首次调用后直接复用，因为字节→Unicode 映射表是固定的
def bytes_to_unicode():
    """
    构建字节（0–255）到 Unicode 可打印字符的一一映射表。

    BPE 算法在 Unicode 字符串上操作，但实际上处理的是字节级别的内容
    （这样天然支持任意语言，不依赖语言特定的分词规则）。

    问题：部分字节值（如控制字符 0x00–0x20、0x7F 等）无法作为有效的
    Unicode 字符参与 BPE 合并（会破坏 BPE 合并规则的字符串比较）。

    解决方案：建立一个双射表，将所有 256 个字节映射到可打印的 Unicode 字符：
        - 已有可打印字符（!~、¡¬、®ÿ 三个区间，共 188 个）：直接映射到自身
        - 其余 68 个字节：映射到 256 开始的连续 Unicode 码点（Ā、ā 等）

    这样任意字节序列都能安全地表示为 Unicode 字符串，BPE 合并正常进行。

    返回：
        dict: {byte_int: unicode_char} 例如 {65: 'A', 0: 'Ā', ...}
    """
    # 三个"安全"字节区间（这些字节对应的字符可以直接用作 BPE 符号）
    bs = (
        list(range(ord("!"), ord("~") + 1))   # 0x21–0x7E：ASCII 可打印字符
        + list(range(ord("¡"), ord("¬") + 1)) # 0xA1–0xAC：Latin 扩展
        + list(range(ord("®"), ord("ÿ") + 1)) # 0xAE–0xFF：Latin 扩展续
    )
    cs = bs[:]  # 对应的 Unicode 码点（初始与字节值相同）

    # 对剩余的"不安全"字节，分配新的 Unicode 码点（从 256 开始）
    n = 0
    for b in range(2 ** 8):  # 遍历所有 256 个字节值
        if b not in bs:
            bs.append(b)          # 追加该字节
            cs.append(2 ** 8 + n) # 分配 256+n 号 Unicode 码点
            n += 1

    cs = [chr(n) for n in cs]  # 将整数码点转换为 Unicode 字符
    return dict(zip(bs, cs))   # 返回 {byte_int: unicode_char} 字典


def get_pairs(word):
    """
    返回词（元组形式的字符序列）中所有相邻字符对的集合。

    BPE 每一步都从所有可能的相邻对中选出在合并规则表中优先级最高的对进行合并。
    此函数用于生成候选合并对。

    参数：
        word: tuple of str，例如 ('h', 'e', 'l', 'l', 'o')

    返回：
        set of tuple，例如 {('h','e'), ('e','l'), ('l','l'), ('l','o')}

    示例：
        word = ('h', 'ello')  →  {('h', 'ello')}
    """
    pairs = set()
    prev_char = word[0]
    for char in word[1:]:
        pairs.add((prev_char, char))
        prev_char = char
    return pairs


class Qwen2Tokenizer(PreTrainedTokenizer):
    """
    ZLLM / Qwen2 慢速分词器（纯 Python BPE 实现）。

    基于字节级 BPE（Byte-Pair Encoding），词表大小约 151,936。

    关键特性：
    1. 字节级处理：任何 UTF-8 文本（中文、日文、代码、特殊符号）都能无损编码，
       不会产生 <unk>（除非显式使用未知 token）。

    2. 空格作为 token 的一部分：
       "Hello world" 与 " Hello world" 会产生不同的 token，
       这与 GPT-2 保持一致（空格归属下一个单词）。

    3. 特殊 token：
       <|im_start|>  → 对话轮次开始标记（instruct 版本用于标注角色）
       <|im_end|>    → 对话轮次结束标记
       <|endoftext|> → 文档结束（同时用作 eos / pad / unk token）

    文件：
        vocab_file  (vocab.json)  : {"token_str": token_id, ...}
        merges_file (merges.txt)  : 每行 "A B" 表示合并规则 A+B → AB

    参数：
        vocab_file  : vocab.json 路径
        merges_file : merges.txt 路径
        errors      : 解码字节序列时的错误处理策略（'replace'/'strict'/'ignore'）
        unk_token   : 未知 token 字符串
        bos_token   : 序列开始 token（Qwen 一般不使用，为 None）
        eos_token   : 序列结束 token
        pad_token   : 填充 token（批量处理不同长度序列时使用）
    """

    vocab_files_names = VOCAB_FILES_NAMES
    # 模型只接受 input_ids 和 attention_mask 作为输入（不使用 token_type_ids）
    model_input_names = ["input_ids", "attention_mask"]

    def __init__(
        self,
        vocab_file,
        merges_file,
        errors="replace",           # 字节解码失败时用替换字符（防止报错）
        unk_token="<|endoftext|>",
        bos_token=None,             # Qwen 无 BOS token
        eos_token="<|endoftext|>",
        pad_token="<|endoftext|>",  # 与 eos 相同，批量推理时用于填充
        clean_up_tokenization_spaces=False,  # 不清理分词后的多余空格
        split_special_tokens=False,          # 不拆分特殊 token（如 <|im_start|>）
        **kwargs,
    ):
        # ── 将特殊 token 字符串包装为 AddedToken 对象 ──
        # AddedToken 控制特殊 token 在分词时的处理方式：
        #   lstrip=False / rstrip=False：不剥离特殊 token 两侧的空格
        #   special=True：将其注册到特殊 token 集合，不参与 BPE 合并
        #   normalized=False：不对特殊 token 做 Unicode 归一化
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

        # ── 加载词表文件 ──
        with open(vocab_file, encoding="utf-8") as vocab_handle:
            self.encoder = json.load(vocab_handle)  # {"token": id} → 编码用
        # 构造反向映射：{id: "token"} → 解码用
        self.decoder = {v: k for k, v in self.encoder.items()}

        self.errors = errors  # 字节解码失败时的错误处理策略

        # ── 字节 ↔ Unicode 双向映射表 ──
        self.byte_encoder = bytes_to_unicode()         # {byte_int: unicode_char}
        self.byte_decoder = {v: k for k, v in self.byte_encoder.items()}  # 反向

        # ── 加载 BPE 合并规则 ──
        # merges.txt 每行格式：" A B"（两个子词，合并后得到 "AB"）
        # 行号即为合并优先级（行号越小，优先级越高）
        bpe_merges = []
        with open(merges_file, encoding="utf-8") as merges_handle:
            for i, line in enumerate(merges_handle):
                line = line.strip()
                # 跳过版本注释行（第一行可能是 "#version: 0.2"）和空行
                if (i == 0 and line.startswith("#version:")) or not line:
                    continue
                bpe_merges.append(tuple(line.split()))
        # bpe_ranks：{(A, B): priority_index}，用于 bpe() 中快速查询合并优先级
        self.bpe_ranks = dict(zip(bpe_merges, range(len(bpe_merges))))

        # BPE 结果缓存：避免重复计算同一子词的 BPE 分割
        # 注意：缓存无上限，对于中文等无空格语言可能增长很大
        self.cache = {}

        # 编译预分词正则（提前编译比每次调用 re.compile 快）
        self.pat = re.compile(PRETOKENIZE_REGEX)

        # add_prefix_space 在 Qwen 分词器中无效（空格已自然融入 token）
        if kwargs.get("add_prefix_space", False):
            logger.warning_once(
                f"{self.__class__.__name} does not support `add_prefix_space`, setting it to True has no effect."
            )

        super().__init__(
            errors=errors,
            bos_token=bos_token,
            eos_token=eos_token,
            pad_token=pad_token,
            unk_token=unk_token,
            clean_up_tokenization_spaces=clean_up_tokenization_spaces,
            split_special_tokens=split_special_tokens,
            **kwargs,
        )

    @property
    def vocab_size(self) -> int:
        """返回基础词表大小（不含后来添加的特殊 token）"""
        return len(self.encoder)

    def get_vocab(self):
        """
        返回完整词表（基础词表 + 添加的特殊 token）。
        返回格式：{"token_str": token_id, ...}
        """
        return dict(self.encoder, **self.added_tokens_encoder)

    def bpe(self, token):
        """
        对单个"预分词后的字节编码字符串"执行 BPE 合并，返回空格分隔的子词字符串。

        BPE 算法（贪心迭代合并）：
            1. 初始状态：每个字符作为独立的符号，形成初始对
            2. 找出当前所有相邻符号对中，在 bpe_ranks 里优先级最高的那对
            3. 将该对合并为新符号，更新 word 元组
            4. 重复步骤 2-3，直到没有可合并的对为止
            5. 返回合并后的符号序列，空格分隔

        结果被缓存（self.cache），相同 token 再次调用直接返回缓存。

        参数：
            token: str，已经过字节编码的字符串（每个字符是 bytes_to_unicode 输出的符号）

        返回：
            str，BPE 子词序列，例如 "hello" → "hello" 或 "he llo" 等

        示例（假设 merges.txt 中 'h e' 的优先级高于其他）：
            输入: "hello"
            初始: ('h', 'e', 'l', 'l', 'o')
            第1步: 合并 ('h','e') → ('he', 'l', 'l', 'o')
            第2步: 合并 ('l','l') → ('he', 'll', 'o')
            ...最终: "he ll o"
        """
        # 命中缓存直接返回
        if token in self.cache:
            return self.cache[token]

        # 将字符串拆分为单字符元组（BPE 的初始状态）
        word  = tuple(token)
        pairs = get_pairs(word)

        # 只有一个字符时无需合并
        if not pairs:
            return token

        while True:
            # ── 找出优先级最高（rank 最小）的相邻对 ──
            # bpe_ranks.get(pair, float("inf"))：不在合并表中的对优先级为无穷大
            bigram = min(pairs, key=lambda pair: self.bpe_ranks.get(pair, float("inf")))

            # 该对不在合并规则表中，说明没有可进行的合并，退出
            if bigram not in self.bpe_ranks:
                break

            first, second = bigram

            # ── 在 word 元组中找到并合并所有 first+second 对 ──
            new_word = []
            i = 0
            while i < len(word):
                try:
                    # 从当前位置 i 开始，找到下一个 first 的位置 j
                    j = word.index(first, i)
                except ValueError:
                    # 后面没有 first 了，直接将剩余部分追加
                    new_word.extend(word[i:])
                    break
                else:
                    # 将 i 到 j 之间的部分（first 之前的）追加
                    new_word.extend(word[i:j])
                    i = j

                # 检查 j 位置是否真的是 first+second 对
                if word[i] == first and i < len(word) - 1 and word[i + 1] == second:
                    new_word.append(first + second)  # 合并为新符号
                    i += 2
                else:
                    new_word.append(word[i])         # 不匹配，保留原符号
                    i += 1

            word = tuple(new_word)

            # 只剩一个符号时无需继续合并
            if len(word) == 1:
                break
            else:
                pairs = get_pairs(word)  # 重新计算相邻对

        # 将元组转为空格分隔字符串
        word = " ".join(word)
        # 存入缓存
        self.cache[token] = word
        return word

    def _tokenize(self, text):
        """
        将文本字符串分词为 BPE 子词列表（字符串形式，非 ID）。

        分词流程：
        1. 用 PRETOKENIZE_REGEX 将文本切分为粗粒度 token（英文单词、标点、数字等）
        2. 对每个粗 token，将其 UTF-8 字节序列映射到 Unicode 字符
           （通过 byte_encoder，避免 BPE 处理控制字符时出问题）
        3. 对映射后的字符串执行 BPE 合并
        4. 将 BPE 结果（空格分隔）拆分为子词列表

        参数：
            text: 原始文本字符串

        返回：
            list of str，BPE 子词列表，例如 ["hello", "Ġworld"] 等
            （Ġ 是空格 0x20 的字节编码符号）
        """
        bpe_tokens = []
        for token in re.findall(self.pat, text):
            # 将每个字符的 UTF-8 字节转换为对应的 Unicode 符号
            # 确保所有字节都能安全地参与 BPE 字符串操作
            token = "".join(
                self.byte_encoder[b] for b in token.encode("utf-8")
            )
            # 对编码后的字符串执行 BPE，将结果按空格切分追加到列表
            bpe_tokens.extend(bpe_token for bpe_token in self.bpe(token).split(" "))
        return bpe_tokens

    def _convert_token_to_id(self, token):
        """
        将 BPE 子词字符串转换为词表 ID。
        若 token 不在词表中，返回 unk_token 对应的 ID。
        """
        return self.encoder.get(token, self.encoder.get(self.unk_token))

    def _convert_id_to_token(self, index):
        """将词表 ID 转换为 BPE 子词字符串（解码时使用）。"""
        return self.decoder.get(index)

    def convert_tokens_to_string(self, tokens):
        """
        将 BPE 子词字符串列表解码回原始文本。

        过程：
        1. 将所有子词字符串拼接（此时还是字节编码的 Unicode 字符）
        2. 将每个 Unicode 字符通过 byte_decoder 转回字节值
        3. 将字节序列解码为 UTF-8 字符串

        参数：
            tokens: list of str，BPE 子词列表

        返回：
            str，解码后的原始文本
        """
        # 拼接所有子词（Unicode 字符序列）
        text = "".join(tokens)
        # Unicode 字符 → 字节 → UTF-8 字符串
        text = bytearray([self.byte_decoder[c] for c in text]).decode("utf-8", errors=self.errors)
        return text

    def decode(
        self,
        token_ids,
        skip_special_tokens: bool = False,
        clean_up_tokenization_spaces: Optional[bool] = False,
        spaces_between_special_tokens: bool = False,  # Qwen 默认不在特殊 token 间插入空格
        **kwargs,
    ) -> str:
        """
        将 token ID 列表解码为文本字符串。

        注意 spaces_between_special_tokens 默认为 False：
        慢速分词器基类默认会在特殊 token 之间插入空格，但 Qwen 不需要，
        所以这里显式传入 False 覆盖基类行为。
        """
        return super().decode(
            token_ids,
            skip_special_tokens=skip_special_tokens,
            clean_up_tokenization_spaces=clean_up_tokenization_spaces,
            spaces_between_special_tokens=spaces_between_special_tokens,
            **kwargs,
        )

    def save_vocabulary(self, save_directory: str, filename_prefix: Optional[str] = None) -> tuple[str]:
        """
        将词表和 BPE 合并规则保存到指定目录。

        保存两个文件：
            vocab.json  : 词表（token → ID 的 JSON 映射）
            merges.txt  : BPE 合并规则（按优先级排序）

        参数：
            save_directory   : 目标目录路径
            filename_prefix  : 文件名前缀（可选）

        返回：
            (vocab_file_path, merges_file_path)
        """
        if not os.path.isdir(save_directory):
            logger.error(f"Vocabulary path ({save_directory}) should be a directory")
            return

        # 构造输出文件路径
        vocab_file = os.path.join(
            save_directory,
            (filename_prefix + "-" if filename_prefix else "") + VOCAB_FILES_NAMES["vocab_file"]
        )
        merge_file = os.path.join(
            save_directory,
            (filename_prefix + "-" if filename_prefix else "") + VOCAB_FILES_NAMES["merges_file"]
        )

        # ── 保存词表 ──
        with open(vocab_file, "w", encoding="utf-8") as f:
            # indent=2：格式化输出便于阅读；sort_keys=True：按字母序排列；ensure_ascii=False：保留中文等字符
            f.write(json.dumps(self.encoder, indent=2, sort_keys=True, ensure_ascii=False) + "\n")

        # ── 保存 BPE 合并规则 ──
        index = 0
        with open(merge_file, "w", encoding="utf-8") as writer:
            writer.write("#version: 0.2\n")  # 文件版本标识
            # 按优先级（rank）从小到大写出所有合并规则
            for bpe_tokens, token_index in sorted(self.bpe_ranks.items(), key=lambda kv: kv[1]):
                if index != token_index:
                    # 发现索引不连续，说明词表可能已损坏，给出警告
                    logger.warning(
                        f"Saving vocabulary to {merge_file}: BPE merge indices are not consecutive."
                        " Please check that the tokenizer is not corrupted!"
                    )
                    index = token_index
                writer.write(" ".join(bpe_tokens) + "\n")
                index += 1

        return vocab_file, merge_file

    def prepare_for_tokenization(self, text, **kwargs):
        """
        分词前的文本预处理。

        执行 Unicode NFC 归一化：
        将不同 Unicode 编码形式的相同字符统一为标准组合形式。
        例如，"é"（e + 组合重音）→ "é"（单个预组合字符 U+00E9）。

        这确保同一文本在不同系统/来源下分词结果一致。

        参数：
            text: 原始文本

        返回：
            (normalized_text, kwargs)
        """
        text = unicodedata.normalize("NFC", text)
        return (text, kwargs)


# 对外导出的公开类
__all__ = ["Qwen2Tokenizer"]
