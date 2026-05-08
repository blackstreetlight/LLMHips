/*
 * RuleEngine.h
 *
 * 驱动层简单规则预判引擎声明。
 *
 * 定位：
 *   本模块不是最终的安全决策者，只是在事件入队前做快速的启发式风险评分，
 *   将结果填入 DRIVER_EVENT_BUFFER.RiskLevel 字段，供中间层和 LLM 参考。
 *   最终放行 / 拦截决策由前端 LLM 或用户手动完成。
 *
 * 规则优先级（从高到低，命中即停止）：
 *   RISK_HIGH   → 进程名命中危险工具黑名单
 *               → 命令行包含高危关键词（base64 编码执行、远程下载等）
 *               → 未签名 + 路径位于临时目录 / 用户目录
 *   RISK_LOW    → 路径位于受信任系统目录（System32 / SysWOW64 / WinSxS）
 *               → 父进程是已知可信的系统进程（explorer / services / svchost 等）
 *   RISK_MEDIUM → 以上规则均未命中（默认值）
 */

#pragma once
#include "Common.h"

/*
 * EvaluateRiskLevel
 * 对一个待入队的进程事件进行规则预判，返回风险等级。
 *
 * 在 ProcessCallback.c 的回调末尾调用，此时 EventData 中的路径、
 * 命令行、父进程名、签名状态等字段已经填充完毕。
 *
 * @param EventData  已采集完毕的进程事件数据（只读）
 * @return ULONG     RISK_LOW(0) / RISK_MEDIUM(1) / RISK_HIGH(2)
 */
ULONG EvaluateRiskLevel(
    _In_ PDRIVER_EVENT_BUFFER EventData
);
