"""
ZLLM (LLMHips-LM) 模块化定义文件
===================================
本文件是 modeling_ljz.py 的"源文件"（modular 版本）。

【重要说明】
modeling_ljz.py 是由构建工具从本文件自动生成的"展开版"。
  - 本文件（modular）：以"继承 + 覆盖"的方式描述 ZLLM 与 LLaMA/Mistral 的差异，
    代码简洁，只写改动的部分。
  - modeling_ljz.py（generated）：所有逻辑完全内联展开，无跨模型继承，
    可以独立运行，便于部署和调试。

修改规则：
  如需更改模型实现，请修改本文件（modular_ljz.py），
  再运行生成脚本更新 modeling_ljz.py，不要直接编辑 generated 文件。

ZLLM 与 LLaMA 的主要差异（本文件重点覆写的地方）：
  1. Q/K/V 投影层带 bias（LLaMA 无 bias）
  2. 支持滑动窗口注意力（SWA），每层可独立配置
  3. RMSNorm：PyTorch >= 2.3 使用内置 nn.RMSNorm，否则手动实现
  4. Qwen2Model 继承自 MistralModel（Mistral 已支持 SWA），
     而非 LlamaModel
"""

from typing import Callable, Optional

import torch
from packaging import version
from torch import nn

from ...cache_utils import Cache, DynamicCache
from ...integrations import use_kernel_forward_from_hub
from ...masking_utils import create_causal_mask, create_sliding_window_causal_mask
from ...modeling_flash_attention_utils import FlashAttentionKwargs
from ...modeling_outputs import BaseModelOutputWithPast
from ...modeling_utils import ALL_ATTENTION_FUNCTIONS
from ...processing_utils import Unpack
from ...utils import TransformersKwargs, auto_docstring, logging
from ...utils.deprecation import deprecate_kwarg
from ...utils.generic import check_model_inputs
from ...utils.import_utils import get_torch_version

# 从 LLaMA 导入公共基础组件（ZLLM 大部分逻辑与 LLaMA 相同，只覆写差异部分）
from ..llama.modeling_llama import (
    LlamaAttention,           # 多头注意力基类
    LlamaDecoderLayer,        # 解码器层基类
    LlamaForCausalLM,         # 因果 LM 基类（ZLLM 直接复用，无差异）
    LlamaForQuestionAnswering,
    LlamaForSequenceClassification,
    LlamaForTokenClassification,
    LlamaMLP,                 # 前馈网络基类
    LlamaPreTrainedModel,     # 预训练模型基类
    apply_rotary_pos_emb,     # RoPE 应用函数（完全复用 LLaMA 实现）
    eager_attention_forward,  # 标准注意力计算函数
)

# Qwen2Model 继承自 MistralModel，因为 Mistral 已实现了滑动窗口掩码逻辑
from ..mistral.modeling_mistral import MistralModel

from .configuration_qwen2 import Qwen2Config


logger = logging.get_logger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# 前馈网络（MLP）—— 仅覆写线性层维度，其余逻辑复用 LlamaMLP
# ══════════════════════════════════════════════════════════════════════════════

class Qwen2MLP(LlamaMLP):
    """
    ZLLM 的 SwiGLU 前馈网络。
    与 LlamaMLP 的唯一差异：显式重新定义三个线性层（维度由 config 决定）。
    激活函数、forward 逻辑等完全继承自 LlamaMLP。
    """
    def __init__(self, config):
        super().__init__(config)
        # 覆写线性层定义（父类也定义了这些，这里显式重声明以确保维度正确）
        # 三层均无 bias，符合大模型 FFN 的标准做法
        self.gate_proj = nn.Linear(self.hidden_size, self.intermediate_size, bias=False)
        self.up_proj   = nn.Linear(self.hidden_size, self.intermediate_size, bias=False)
        self.down_proj = nn.Linear(self.intermediate_size, self.hidden_size, bias=False)


# ══════════════════════════════════════════════════════════════════════════════
# 多头注意力层 —— 覆写 Q/K/V 投影（加 bias）及滑动窗口支持
# ══════════════════════════════════════════════════════════════════════════════

class Qwen2Attention(LlamaAttention):
    """
    ZLLM 的多头注意力层（继承 LlamaAttention）。

    与 LlamaAttention 的差异：
    1. Q/K/V 投影层带 bias=True（LLaMA 无 bias）
       原因：Qwen2 训练时 Q/K/V 均使用了 bias，不匹配会导致推理偏差
    2. 增加 sliding_window 属性
       根据当前层的配置决定是否使用滑动窗口注意力（SWA）
    """

    def __init__(self, config: Qwen2Config, layer_idx: int):
        super().__init__(config, layer_idx)

        # ── 覆写 Q/K/V 投影，加上 bias（这是与 LLaMA 的关键区别）──
        # LLaMA 的这三个投影是 bias=False；Qwen2 训练时加了 bias，必须保持一致
        self.q_proj = nn.Linear(config.hidden_size, config.num_attention_heads * self.head_dim, bias=True)
        self.k_proj = nn.Linear(config.hidden_size, config.num_key_value_heads * self.head_dim, bias=True)
        self.v_proj = nn.Linear(config.hidden_size, config.num_key_value_heads * self.head_dim, bias=True)
        # O 投影无 bias（与 LLaMA 一致）
        self.o_proj = nn.Linear(config.num_attention_heads * self.head_dim, config.hidden_size, bias=False)

        # 滑动窗口大小：仅当本层类型为 "sliding_attention" 时有效，否则为 None
        self.sliding_window = (
            config.sliding_window
            if config.layer_types[layer_idx] == "sliding_attention"
            else None
        )

    @deprecate_kwarg("past_key_value", new_name="past_key_values", version="4.58")
    def forward(
        self,
        hidden_states: torch.Tensor,
        position_embeddings: tuple[torch.Tensor, torch.Tensor],  # (cos, sin) from RoPE
        attention_mask: Optional[torch.Tensor],
        past_key_values: Optional[Cache] = None,
        cache_position: Optional[torch.LongTensor] = None,
        **kwargs: Unpack[FlashAttentionKwargs],
    ) -> tuple[torch.Tensor, Optional[torch.Tensor]]:
        """
        注意力前向传播（复用父类大部分逻辑，关键差异见注释）。

        与 LlamaAttention.forward 相比：
        - 传入 sliding_window 参数给 attention_interface（主要差异所在）
        - Q/K/V 投影权重不同（有 bias）
        """
        input_shape  = hidden_states.shape[:-1]
        hidden_shape = (*input_shape, -1, self.head_dim)

        # 线性投影 + reshape 为多头格式
        query_states = self.q_proj(hidden_states).view(hidden_shape).transpose(1, 2)
        key_states   = self.k_proj(hidden_states).view(hidden_shape).transpose(1, 2)
        value_states = self.v_proj(hidden_states).view(hidden_shape).transpose(1, 2)

        # 应用旋转位置编码到 Q 和 K（V 不需要）
        cos, sin = position_embeddings
        query_states, key_states = apply_rotary_pos_emb(query_states, key_states, cos, sin)

        # 更新 KV Cache（推理加速）
        if past_key_values is not None:
            # sin/cos 是 RoPE 特有参数，Static Cache 需要它们来正确放置 K/V
            cache_kwargs = {"sin": sin, "cos": cos, "cache_position": cache_position}
            key_states, value_states = past_key_values.update(
                key_states, value_states, self.layer_idx, cache_kwargs
            )

        # 选择注意力计算后端（eager / flash_attention_2 / sdpa）
        attention_interface: Callable = eager_attention_forward
        if self.config._attn_implementation != "eager":
            attention_interface = ALL_ATTENTION_FUNCTIONS[self.config._attn_implementation]

        attn_output, attn_weights = attention_interface(
            self,
            query_states,
            key_states,
            value_states,
            attention_mask,
            dropout=0.0 if not self.training else self.attention_dropout,
            scaling=self.scaling,
            sliding_window=self.sliding_window,  # ← 与 LLaMA 的主要差异：传入 SWA 窗口大小
            **kwargs,
        )

        # 整合多头输出并投影回 hidden_size
        attn_output = attn_output.reshape(*input_shape, -1).contiguous()
        attn_output = self.o_proj(attn_output)
        return attn_output, attn_weights


# ══════════════════════════════════════════════════════════════════════════════
# RMSNorm —— 根据 PyTorch 版本选择实现
# ══════════════════════════════════════════════════════════════════════════════

if version.parse(get_torch_version()) >= version.parse("2.3.0"):
    # PyTorch >= 2.3.0：直接使用官方内置的 nn.RMSNorm
    # 内置版本有更好的数值稳定性保证，且可能使用 CUDA kernel 加速
    class Qwen2RMSNorm(nn.RMSNorm):
        """
        ZLLM RMS 归一化（PyTorch >= 2.3 版本）。
        直接包装 nn.RMSNorm，保持接口与老版本一致。

        nn.RMSNorm 参数：
            normalized_shape  : 归一化的维度大小（即 hidden_size）
            eps               : 数值稳定项
            elementwise_affine: True 表示有可学习的缩放参数 γ（weight）
        """
        def __init__(self, hidden_size, eps: float = 1e-6) -> None:
            super().__init__(normalized_shape=hidden_size, eps=eps, elementwise_affine=True)

else:
    # PyTorch < 2.3.0：手动实现 RMSNorm
    # 计算流程：升精度 → 计算方差倒数 → 归一化 → 乘以可学习缩放参数
    @use_kernel_forward_from_hub("RMSNorm")  # 尝试加载更快的 Triton 实现
    class Qwen2RMSNorm(nn.Module):
        """
        ZLLM RMS 归一化（PyTorch < 2.3 兼容版本）。

        公式：RMSNorm(x) = x / √(mean(x²) + ε) × γ
        其中 γ 是可学习的逐元素缩放参数（初始化为全 1）。

        实现要点：
        - 使用 float32 精度计算方差（避免 float16 精度不足导致数值错误）
        - rsqrt 比先 sqrt 再除法数值更稳定，且通常有硬件加速
        """
        def __init__(self, hidden_size, eps: float = 1e-6) -> None:
            super().__init__()
            self.weight = nn.Parameter(torch.ones(hidden_size))  # 可学习缩放参数 γ
            self.variance_epsilon = eps

        def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
            input_dtype = hidden_states.dtype
            hidden_states = hidden_states.to(torch.float32)  # 升精度防溢出
            variance = hidden_states.pow(2).mean(-1, keepdim=True)
            hidden_states = hidden_states * torch.rsqrt(variance + self.variance_epsilon)
            return self.weight * hidden_states.to(input_dtype)  # 还原精度

        def extra_repr(self):
            return f"{tuple(self.weight.shape)}, eps={self.variance_epsilon}"


# ══════════════════════════════════════════════════════════════════════════════
# 解码器层 —— 仅添加 attention_type 属性
# ══════════════════════════════════════════════════════════════════════════════

class Qwen2DecoderLayer(LlamaDecoderLayer):
    """
    ZLLM 解码器层。
    与 LlamaDecoderLayer 的唯一差异：
    记录本层的注意力类型（"full_attention" 或 "sliding_attention"），
    供 Qwen2Model.forward 根据类型选择对应的因果掩码。
    """
    def __init__(self, config: Qwen2Config, layer_idx: int):
        super().__init__(config=config, layer_idx=layer_idx)
        # 本层注意力类型，由 config.layer_types[layer_idx] 决定
        self.attention_type = config.layer_types[layer_idx]


# ══════════════════════════════════════════════════════════════════════════════
# 预训练基类 —— 直接复用 LlamaPreTrainedModel
# ══════════════════════════════════════════════════════════════════════════════

class Qwen2PreTrainedModel(LlamaPreTrainedModel):
    """
    ZLLM 预训练基类。
    完全复用 LlamaPreTrainedModel 的能力（权重初始化、from_pretrained、save_pretrained 等）。
    """
    pass


# ══════════════════════════════════════════════════════════════════════════════
# 裸 Transformer 模型 —— 继承 MistralModel（支持 SWA）
# ══════════════════════════════════════════════════════════════════════════════

class Qwen2Model(MistralModel):
    """
    ZLLM 主干模型（继承 MistralModel 而非 LlamaModel）。

    为什么继承 MistralModel？
    Mistral 已经实现了滑动窗口注意力（SWA）相关的掩码逻辑，
    ZLLM 直接复用其 forward 结构，仅添加 has_sliding_layers 标志和
    混合注意力掩码（full_attention + sliding_attention 的 mapping）。
    """

    def __init__(self, config: Qwen2Config):
        super().__init__(config)
        # 标记是否存在使用滑动窗口的层，决定是否需要构建 sliding 掩码
        self.has_sliding_layers = "sliding_attention" in self.config.layer_types

    @check_model_inputs
    @auto_docstring
    def forward(
        self,
        input_ids: Optional[torch.LongTensor] = None,
        attention_mask: Optional[torch.Tensor] = None,
        position_ids: Optional[torch.LongTensor] = None,
        past_key_values: Optional[Cache] = None,
        inputs_embeds: Optional[torch.FloatTensor] = None,
        use_cache: Optional[bool] = None,
        cache_position: Optional[torch.LongTensor] = None,
        **kwargs: Unpack[TransformersKwargs],
    ) -> BaseModelOutputWithPast:
        """
        主干模型前向传播。

        关键逻辑（与 LlamaModel 的差异）：
        1. 构建 causal_mask_mapping 字典：
           - "full_attention"    → 标准下三角因果掩码
           - "sliding_attention" → 带滑动窗口限制的因果掩码（仅在 has_sliding_layers 时构建）
        2. 每个解码器层根据自身 attention_type 选取对应的掩码
        """
        # ── 互斥输入校验 ──
        if (input_ids is None) ^ (inputs_embeds is not None):
            raise ValueError("You must specify exactly one of input_ids or inputs_embeds")

        # ── Token Embedding ──
        if inputs_embeds is None:
            inputs_embeds = self.embed_tokens(input_ids)

        # ── KV Cache 初始化 ──
        if use_cache and past_key_values is None:
            past_key_values = DynamicCache(config=self.config)

        # ── 计算 cache_position（当前 token 在完整序列中的绝对位置）──
        if cache_position is None:
            past_seen_tokens = past_key_values.get_seq_length() if past_key_values is not None else 0
            cache_position = torch.arange(
                past_seen_tokens,
                past_seen_tokens + inputs_embeds.shape[1],
                device=inputs_embeds.device
            )

        # ── 计算 position_ids ──
        if position_ids is None:
            position_ids = cache_position.unsqueeze(0)

        # ── 构建注意力掩码字典 ──
        # 如果 attention_mask 已经是字典（由 generate() 预先构建），直接使用
        if not isinstance(causal_mask_mapping := attention_mask, dict):
            mask_kwargs = {
                "config":          self.config,
                "input_embeds":    inputs_embeds,
                "attention_mask":  attention_mask,
                "cache_position":  cache_position,
                "past_key_values": past_key_values,
                "position_ids":    position_ids,
            }
            # 全注意力掩码（所有模型都需要）
            causal_mask_mapping = {
                "full_attention": create_causal_mask(**mask_kwargs),
            }
            # 滑动窗口掩码（仅当存在 sliding 层时构建，避免不必要开销）
            if self.has_sliding_layers:
                causal_mask_mapping["sliding_attention"] = create_sliding_window_causal_mask(**mask_kwargs)

        hidden_states = inputs_embeds

        # ── 统一计算 RoPE 编码（所有层共享，避免重复计算）──
        position_embeddings = self.rotary_emb(hidden_states, position_ids)

        # ── 逐层通过解码器 ──
        for decoder_layer in self.layers[: self.config.num_hidden_layers]:
            # 根据本层注意力类型选取对应的因果掩码
            hidden_states = decoder_layer(
                hidden_states,
                attention_mask=causal_mask_mapping[decoder_layer.attention_type],
                position_ids=position_ids,
                past_key_values=past_key_values,
                use_cache=use_cache,
                cache_position=cache_position,
                position_embeddings=position_embeddings,
                **kwargs,
            )

        # ── 最终归一化 ──
        hidden_states = self.norm(hidden_states)

        return BaseModelOutputWithPast(
            last_hidden_state=hidden_states,
            past_key_values=past_key_values if use_cache else None,
        )


# ══════════════════════════════════════════════════════════════════════════════
# 任务头 —— 直接复用 LLaMA 实现（无差异）
# ══════════════════════════════════════════════════════════════════════════════

class Qwen2ForCausalLM(LlamaForCausalLM):
    """因果语言模型（文本生成），完全复用 LlamaForCausalLM 实现。"""
    pass


class Qwen2ForSequenceClassification(LlamaForSequenceClassification):
    """序列分类模型（如情感分类），完全复用 LlamaForSequenceClassification。"""
    pass


class Qwen2ForTokenClassification(LlamaForTokenClassification):
    """Token 分类模型（如 NER），完全复用 LlamaForTokenClassification。"""
    pass


class Qwen2ForQuestionAnswering(LlamaForQuestionAnswering):
    """抽取式问答模型（预测答案起止位置），完全复用 LlamaForQuestionAnswering。"""
    pass


# 对外导出的公开类列表
__all__ = [
    "Qwen2PreTrainedModel",
    "Qwen2Model",
    "Qwen2ForCausalLM",
    "Qwen2RMSNorm",
    "Qwen2ForSequenceClassification",
    "Qwen2ForTokenClassification",
    "Qwen2ForQuestionAnswering",
]
