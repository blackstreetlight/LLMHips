/**
 * contracts/terminal.ts — Terminal_control 技能约定文档（Contract）
 *
 * 这份文档描述 Terminal_control 技能的完整使用规范。
 * 会与 Manifest 一起注入到 AI 系统提示中。
 *
 * 对应的执行实现：src/features/skills/handlers/terminalSkillHandler.ts
 * 对应的 C# 实现：SecurityBridge/Terminal/TerminalSession.cs（RunCommandAsync）
 */

export const TERMINAL_CONTRACT = `
## 技能约定：Terminal_control

### 用途
在受控端（目标 Windows 机器）执行单条 Shell 命令，获取完整的标准输出和标准错误输出。
适用于：实时取证、IOC 验证、行为确认、系统状态查询。

### Shell 环境
- **Windows**：PowerShell（powershell.exe -Command）
- **Linux/macOS**：Bash（bash -c）
- 命令在独立子进程中执行，不共享交互终端的状态（无法使用 cd 切换目录跨命令持久）

### Payload 格式（JSON）

\`\`\`json
{
  "cmd":     "string",   // 必填：要执行的命令
  "timeout": number      // 可选：超时秒数，默认 15，最大建议 60
}
\`\`\`

**简化格式**（仅命令字符串，使用默认 timeout）：
\`\`\`
<Terminal_control>whoami</Terminal_control>
\`\`\`

### 返回格式（系统注入到对话中）

执行成功：
\`\`\`
[Terminal_control 执行结果]
命令：<你发出的命令>
退出码：0
输出：
<stdout 内容>
\`\`\`

执行失败或有 stderr：
\`\`\`
[Terminal_control 执行结果]
命令：<你发出的命令>
退出码：<非0值>
输出：
<stdout 内容>
[stderr]
<stderr 内容>
\`\`\`

超时：
\`\`\`
[Terminal_control 执行结果]
命令：<你发出的命令>
退出码：-1
输出：[超时] 命令执行超过 N 秒被终止
\`\`\`

### 典型用法示例

**查询可疑进程的网络连接：**
\`\`\`
<Terminal_control>{"cmd":"netstat -ano | findstr 4444","timeout":10}</Terminal_control>
\`\`\`

**获取进程详细信息（PowerShell）：**
\`\`\`
<Terminal_control>{"cmd":"Get-Process -Id 1234 | Select-Object *","timeout":10}</Terminal_control>
\`\`\`

**检查注册表自启动项：**
\`\`\`
<Terminal_control>{"cmd":"reg query HKLM\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run","timeout":10}</Terminal_control>
\`\`\`

**计算可疑文件哈希（取证）：**
\`\`\`
<Terminal_control>{"cmd":"Get-FileHash 'C:\\\\Users\\\\Admin\\\\AppData\\\\Local\\\\Temp\\\\payload.bin' -Algorithm SHA256","timeout":20}</Terminal_control>
\`\`\`

**查看最近创建的文件：**
\`\`\`
<Terminal_control>{"cmd":"Get-ChildItem C:\\\\Windows\\\\Temp -File | Sort-Object CreationTime -Descending | Select-Object -First 10 Name,CreationTime,Length","timeout":15}</Terminal_control>
\`\`\`

**检查计划任务（常见持久化手段）：**
\`\`\`
<Terminal_control>{"cmd":"Get-ScheduledTask | Where-Object {$_.State -eq 'Ready'} | Select-Object TaskName,TaskPath | Format-Table -AutoSize","timeout":15}</Terminal_control>
\`\`\`

### 安全注意事项
- 命令在真实受控端执行，谨慎使用破坏性命令（rm、del、format 等）
- 分析场景下优先使用只读命令（查询、获取），避免修改系统状态
- 如需执行高危操作，应在回复中明确说明原因并警告用户
- 命令字符串中的双引号使用 \\\\ 转义（JSON 字符串规范）

### 常见错误与处理
| 现象 | 可能原因 | 建议操作 |
|------|---------|---------|
| 退出码非 0 | 命令语法错误或权限不足 | 检查命令拼写，或尝试以管理员方式运行 |
| 输出为空 | 命令无匹配结果（正常） | 说明未发现对应威胁指标 |
| 超时 | 命令耗时过长 | 增加 timeout 值，或缩小命令范围 |
| 乱码 | 编码问题 | 尝试 \`chcp 65001\` 或使用 PowerShell 替代 cmd |
`.trim();
