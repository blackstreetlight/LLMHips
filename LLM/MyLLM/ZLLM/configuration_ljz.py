# coding=utf-8
# Copyright 2024 The Qwen team, Alibaba Group and the HuggingFace Inc. team. All rights reserved.
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
ZLLM (LLMHips-LM) 模型配置
============================
本文件定义 ZLLMConfig 类，用于存储和管理模型的所有超参数。
配置对象是实例化模型的"图纸"——模型的层数、维度、注意力头数等
所有结构参数都集中在这里，方便序列化（保存为 config.json）和反序列化。

使用示例：
    config = ZLLMConfig(hidden_size=3584, num_hidden_layers=28)
    model  = ZLLMModel(config)
"""

# layer_type_validation：校验每层注意力类型列表的合法性
# PretrainedConfig：HuggingFace 所有配置类的基类，提供 from_pretrained / save_pretrained 等能力
from ...configuration_utils import PretrainedConfig, layer_type_validation

# rope_config_validation：校验 RoPE（旋转位置编码）配置字典的字段合法性
from ...modeling_rope_utils import rope_config_validation
from ...utils import logging


logger = logging.get_logger(__name__)


class Qwen2Config(PretrainedConfig):
    r"""
    ZLLMConfig / Qwen2Config —— 模型超参数配置类
    ==============================================
    继承自 PretrainedConfig，实例化后传入模型构造函数，决定模型的完整结构。

    核心参数说明（LLMHips-LM 默认值参考 7B 规格）：

    vocab_size (int, 默认 151936)：
        词表大小，即模型能表示的不同 token 总数。
        词表越大覆盖的语言越广，但 Embedding 层参数量也越大。

    hidden_size (int, 默认 4096)：
        每个 token 在模型内部的向量维度（隐藏层宽度）。
        7B 模型通常为 4096，LLMHips-LM 7B 规格设为 3584。

    intermediate_size (int, 默认 22016)：
        前馈网络（FFN/MLP）中间层维度，通常是 hidden_size 的 ~2.67 倍。
        SwiGLU 激活下实际参数量约为 2 × intermediate_size × hidden_size。

    num_hidden_layers (int, 默认 32)：
        Transformer 解码器堆叠的层数，层数越多模型容量越大，推理也越慢。

    num_attention_heads (int, 默认 32)：
        多头注意力的头数（Q 头数）。
        每个头的维度 = hidden_size // num_attention_heads。

    num_key_value_heads (int, 默认 32)：
        GQA（分组查询注意力）中 K/V 的头数。
        - num_key_value_heads == num_attention_heads → 标准 MHA（多头注意力）
        - num_key_value_heads == 1                  → MQA（多查询注意力）
        - 其他值                                    → GQA（分组查询注意力）
        GQA 通过让多个 Q 头共享同一组 KV 来节省 KV Cache 显存。
        LLMHips-LM 7B 规格：num_attention_heads=28, num_key_value_heads=4。

    hidden_act (str, 默认 "silu")：
        前馈网络的激活函数，"silu" 即 SiLU(x) = x·σ(x)，
        配合 gate_proj 构成 SwiGLU 门控结构。

    max_position_embeddings (int, 默认 32768)：
        模型支持的最大序列长度（上下文窗口）。
        LLMHips-LM 设为 8192，覆盖大多数安全分析场景。

    initializer_range (float, 默认 0.02)：
        权重矩阵初始化时截断正态分布的标准差，影响训练早期的梯度稳定性。

    rms_norm_eps (float, 默认 1e-6)：
        RMSNorm 中的数值稳定项 ε，防止方差为 0 时出现除零错误。

    use_cache (bool, 默认 True)：
        推理时是否启用 KV Cache。
        启用后每步只计算新 token 的注意力，大幅加速自回归生成；
        训练时通常设为 False（不需要逐步生成）。

    tie_word_embeddings (bool, 默认 False)：
        是否将输入 Embedding 层与输出 lm_head 的权重共享（绑定）。
        共享权重可减少参数量，但大模型通常不做此绑定以保留表达能力。

    rope_theta (float, 默认 10000.0)：
        RoPE（旋转位置编码）的基础频率 θ。
        θ 越大，模型对更长序列的位置感知越好；
        LLaMA3 / Qwen2.5 通常将其调大至 500000 以支持更长上下文。

    rope_scaling (dict, 可选)：
        RoPE 扩展配置字典，用于突破预训练时的最大上下文长度限制。
        常用类型：
          - "default"：不扩展，直接用原始 RoPE
          - "linear"：线性插值（YaRN 前的简单方案）
          - "dynamic"：动态 NTK 扩展（推理时自动调整）
          - "yarn"：YaRN 方案，插值与外推结合，精度更高

    use_sliding_window (bool, 默认 False)：
        是否对部分层启用滑动窗口注意力（SWA）。
        SWA 让每个 token 只关注最近 sliding_window 个 token，
        降低长序列时的注意力计算复杂度（从 O(n²) 降至 O(n·w)）。

    sliding_window (int, 默认 4096)：
        滑动窗口的大小（仅在 use_sliding_window=True 时有效）。

    max_window_layers (int, 默认 28)：
        前 max_window_layers 层使用完整注意力（full attention），
        超过此数的层使用滑动窗口注意力。
        早期层负责局部特征提取，适合 SWA；深层负责全局推理，需要全注意力。

    layer_types (list, 可选)：
        长度为 num_hidden_layers 的列表，显式指定每层的注意力类型
        （"full_attention" 或 "sliding_attention"）。
        若不指定，由 use_sliding_window / max_window_layers 自动推导。

    attention_dropout (float, 默认 0.0)：
        注意力权重矩阵上的 Dropout 比例，训练时用于正则化，推理时无效。
    """

    # transformers 注册表中该配置对应的 model_type 标识符
    # config.json 里会写 "model_type": "qwen2"，用于自动路由到正确的类
    model_type = "qwen2"

    # 推理时不需要序列化（保存）到输出中的键
    keys_to_ignore_at_inference = ["past_key_values"]

    # ── 张量并行（Tensor Parallelism）切分方案 ──
    # 定义每个权重矩阵应按"列切分"还是"行切分"分布到多张 GPU 上
    # colwise：按列切分，适合 Q/K/V/gate/up 投影（输出可直接拼接）
    # rowwise：按行切分，适合 O/down 投影（输出需要 all-reduce 求和）
    base_model_tp_plan = {
        "layers.*.self_attn.q_proj": "colwise",
        "layers.*.self_attn.k_proj": "colwise",
        "layers.*.self_attn.v_proj": "colwise",
        "layers.*.self_attn.o_proj": "rowwise",
        "layers.*.mlp.gate_proj":    "colwise",
        "layers.*.mlp.up_proj":      "colwise",
        "layers.*.mlp.down_proj":    "rowwise",
    }

    # ── 流水线并行（Pipeline Parallelism）阶段划分方案 ──
    # 描述模型各子模块的输入/输出张量名，供流水线调度器切割模型
    base_model_pp_plan = {
        "embed_tokens": (["input_ids"],                      ["inputs_embeds"]),
        "layers":       (["hidden_states", "attention_mask"], ["hidden_states"]),
        "norm":         (["hidden_states"],                   ["hidden_states"]),
    }

    def __init__(
        self,
        vocab_size=151936,            # 词表大小
        hidden_size=4096,             # 隐藏层维度
        intermediate_size=22016,      # FFN 中间层维度
        num_hidden_layers=32,         # Transformer 层数
        num_attention_heads=32,       # Q 注意力头数
        num_key_value_heads=32,       # KV 注意力头数（GQA 核心参数）
        hidden_act="silu",            # FFN 激活函数
        max_position_embeddings=32768,# 最大序列长度
        initializer_range=0.02,       # 权重初始化标准差
        rms_norm_eps=1e-6,            # RMSNorm 稳定项
        use_cache=True,               # 是否启用 KV Cache
        tie_word_embeddings=False,    # 是否绑定 Embedding 与 lm_head 权重
        rope_theta=10000.0,           # RoPE 基础频率
        rope_scaling=None,            # RoPE 扩展配置（支持长上下文）
        use_sliding_window=False,     # 是否启用滑动窗口注意力
        sliding_window=4096,          # 滑动窗口大小
        max_window_layers=28,         # 前 N 层使用全注意力，之后层用 SWA
        layer_types=None,             # 显式指定每层注意力类型（可选）
        attention_dropout=0.0,        # 注意力 Dropout 比例
        **kwargs,                     # 传递给基类 PretrainedConfig 的其他参数
    ):
        # ── 基础结构参数 ──
        self.vocab_size = vocab_size
        self.max_position_embeddings = max_position_embeddings
        self.hidden_size = hidden_size
        self.intermediate_size = intermediate_size
        self.num_hidden_layers = num_hidden_layers
        self.num_attention_heads = num_attention_heads

        # ── 滑动窗口注意力相关 ──
        self.use_sliding_window = use_sliding_window
        # 若未启用 SWA，sliding_window 强制为 None，避免误用
        self.sliding_window = sliding_window if self.use_sliding_window else None
        self.max_window_layers = max_window_layers

        # ── GQA 兼容处理 ──
        # 历史兼容：早期版本某些 checkpoint 未指定 num_key_value_heads，
        # 此时退回到标准 MHA（KV 头数 = Q 头数）
        if num_key_value_heads is None:
            num_key_value_heads = num_attention_heads
        self.num_key_value_heads = num_key_value_heads

        # ── 其他超参数 ──
        self.hidden_act = hidden_act
        self.initializer_range = initializer_range
        self.rms_norm_eps = rms_norm_eps
        self.use_cache = use_cache
        self.rope_theta = rope_theta
        self.rope_scaling = rope_scaling
        self.attention_dropout = attention_dropout

        # ── RoPE 配置校验 ──
        # 历史兼容：旧版本用 "type" 字段，新版本统一改为 "rope_type"
        if self.rope_scaling is not None and "type" in self.rope_scaling:
            self.rope_scaling["rope_type"] = self.rope_scaling["type"]
        # 校验 rope_scaling 字典中所有必填字段的合法性（类型/取值范围等）
        rope_config_validation(self)

        # ── 每层注意力类型列表 ──
        self.layer_types = layer_types
        if self.layer_types is None:
            # 未显式指定时，自动根据 sliding_window / max_window_layers 推导：
            # 第 i 层（i >= max_window_layers 且启用了 SWA）→ "sliding_attention"
            # 否则 → "full_attention"
            self.layer_types = [
                "sliding_attention"
                if self.sliding_window is not None and i >= self.max_window_layers
                else "full_attention"
                for i in range(self.num_hidden_layers)
            ]
        # 验证 layer_types 长度与 num_hidden_layers 一致，且取值合法
        layer_type_validation(self.layer_types, self.num_hidden_layers)

        # 调用基类构造，处理 pad_token_id / bos_token_id / eos_token_id 等通用参数
        super().__init__(
            tie_word_embeddings=tie_word_embeddings,
            **kwargs,
        )


# 声明本模块对外导出的公开符号
__all__ = ["Qwen2Config"]
