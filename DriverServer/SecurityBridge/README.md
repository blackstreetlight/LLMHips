# SecurityBridge

Windows 用户态桥接服务：通过 IOCTL 与内核驱动通信，经 WebSocket 将进程拦截事件实时推送至前端，并将前端控制指令转发给驱动执行。

---

## 快速开始

### macOS 开发环境编译

```bash
cd SecurityBridge
dotnet build
```

### Mock 模式运行（跨平台，无需驱动）

`appsettings.json` 中 `UseMockDriver` 默认为 `true`，直接运行即可：

```bash
dotnet run
```

服务启动后将在 `http://0.0.0.0:9527` 监听，Mock 驱动每隔约 500ms 有 30% 概率随机生成一条进程事件。

### Windows 正式运行（对接真实驱动）

1. 确认内核驱动已加载（设备名默认为 `\\.\SecurityDriver`）
2. 修改 `appsettings.json`：

```json
{
  "Bridge": {
    "UseMockDriver": false,
    "DriverDeviceName": "\\\\.\\SecurityDriver"
  }
}
```

3. 以管理员权限运行：

```powershell
dotnet run
# 或发布后以服务方式运行
dotnet publish -c Release -r win-x64
```

---

## WebSocket 连接地址

```
ws://localhost:9527/ws
```

---

## 消息协议速查

| 方向 | Type | 说明 |
|------|------|------|
| 服务端 → 前端 | `process_event` | 驱动拦截的进程事件 |
| 服务端 → 前端 | `heartbeat` | 每30秒心跳，含驱动在线状态 |
| 服务端 → 前端 | `command_ack` | 控制指令执行回执 |
| 服务端 → 前端 | `pong` | 响应前端 ping |
| 前端 → 服务端 | `driver_command` | kill / whitelist / blacklist / allow_once |
| 前端 → 服务端 | `ping` | 心跳探测 |

---

## IOCTL 控制码联调说明

`Driver/WindowsDriverClient.cs` 中的以下占位值需与驱动工程师对齐：

```csharp
private const uint IOCTL_GET_EVENT    = 0x220000; // 联调时替换为实际控制码
private const uint IOCTL_SEND_COMMAND = 0x220004; // 联调时替换为实际控制码
```

同时需确认 `DRIVER_EVENT_BUFFER` 和 `DRIVER_COMMAND_BUFFER` 结构体的字段顺序、
字段类型、字符串长度与驱动 C 代码中的定义完全一致，否则会导致内存错位。

---

## 与前端对接说明

前端项目中若存在 `services/mockSocket.ts` 或其他 Mock WebSocket 实现，
将其替换为真实 WebSocket 连接即可：

```typescript
// 替换 mock，连接到桥接服务
const ws = new WebSocket('ws://localhost:9527/ws');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'process_event':
      // 处理进程拦截事件
      break;
    case 'heartbeat':
      // 更新驱动在线状态
      break;
    case 'command_ack':
      // 处理指令执行回执
      break;
  }
};

// 下发控制指令
ws.send(JSON.stringify({
  type: 'driver_command',
  payload: { action: 'kill', pid: 1234, reason: '用户手动终止' }
}));
```

---

## 项目结构

```
SecurityBridge/
├── SecurityBridge.csproj
├── Program.cs                          # 服务入口，DI / WebSocket 中间件 / CORS
├── Worker.cs                           # 后台轮询主循环 + 心跳广播
├── Driver/
│   ├── IDriverClient.cs                # 驱动通信抽象接口
│   ├── WindowsDriverClient.cs          # 真实 IOCTL 实现（仅 Windows）
│   └── MockDriverClient.cs             # Mock 实现（跨平台开发用）
├── WebSocket/
│   ├── WebSocketConnectionManager.cs   # 连接池管理（广播）
│   └── WebSocketHandler.cs             # 单连接消息收发生命周期
├── Models/
│   ├── ProcessEvent.cs
│   ├── DriverCommand.cs
│   └── WsMessage.cs
└── appsettings.json
```
