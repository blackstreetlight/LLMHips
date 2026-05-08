# Copyright 2024 The Qwen Team and The HuggingFace Inc. team. All rights reserved.
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
ZLLM (LLMHips-LM) 模型包入口
================================
本文件是整个 ZLLM 模型包的 __init__.py，负责对外暴露模型的所有公开类。

采用"懒加载"（Lazy Import）策略：
- 在 TYPE_CHECKING 模式下（静态类型检查工具，如 mypy/pyright），直接 import 让类型注解生效。
- 在真正的运行时，用 _LazyModule 替换当前模块对象，做到"用到时才真正加载"，
  从而避免在 import transformers 时把所有子模块全部载入内存，提升启动速度。

外部使用方式示例：
    from transformers.models.zllm import ZLLMConfig, ZLLMForCausalLM
"""

from typing import TYPE_CHECKING

# _LazyModule：transformers 内部实现的懒加载模块包装器
# define_import_structure：自动扫描当前文件夹，生成 {模块名: [公开类名列表]} 的结构字典
from ...utils import _LazyModule
from ...utils.import_utils import define_import_structure


if TYPE_CHECKING:
    # ── 仅在静态类型检查阶段执行（不影响运行时）──
    # 让 IDE 和类型检查工具能够正确识别包内所有导出的符号
    from .configuration_ljz import *   # ZLLMConfig（模型超参数配置）
    from .modeling_ljz import *        # ZLLMModel / ZLLMForCausalLM 等核心模型类
    from .tokenization_ljz import *    # ZLLMTokenizer（慢速 BPE 分词器）
    from .tokenization_ljz_fast import *  # ZLLMTokenizerFast（基于 Rust 的快速分词器）
else:
    import sys

    # __file__ 是当前 __init__.py 的路径，_LazyModule 用它来定位子模块文件
    _file = globals()["__file__"]

    # 用懒加载模块对象替换 sys.modules 中的当前模块，
    # 之后 `from transformers.models.zllm import XxxClass` 时才真正触发对应子模块的加载
    sys.modules[__name__] = _LazyModule(
        __name__,
        _file,
        define_import_structure(_file),  # 自动生成导入结构（扫描 __all__ 等）
        module_spec=__spec__,
    )
