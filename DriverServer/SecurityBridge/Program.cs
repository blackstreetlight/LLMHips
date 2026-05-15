// Program.cs
using System.Runtime.InteropServices;
using SecurityBridge.Driver;
using SecurityBridge.ETW;
using SecurityBridge.WebSocket;

var builder = WebApplication.CreateBuilder(args);

// ── 读取桥接服务配置 ──────────────────────────────────────────────────────────
var bridgeConfig = builder.Configuration.GetSection("Bridge");
bool useMock = bridgeConfig.GetValue<bool>("UseMockDriver", true);

// ── 注册驱动通信客户端 ────────────────────────────────────────────────────────
// 根据配置决定使用 Mock 还是真实 Windows 驱动客户端
// 非 Windows 平台强制使用 Mock，防止误配置导致崩溃
if (useMock || !RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
{
    builder.Services.AddSingleton<IDriverClient, MockDriverClient>();
}
else
{
#pragma warning disable CA1416 // 仅在 Windows 上运行
    builder.Services.AddSingleton<IDriverClient, WindowsDriverClient>();
#pragma warning restore CA1416
}

// ── 注册 WebSocket 连接池（单例，全局共享）────────────────────────────────────
builder.Services.AddSingleton<WebSocketConnectionManager>();

// ── 注册 ETW 监控器（单例，由 Worker 持有并驱动）─────────────────────────────
// EtwMonitor 本身只在 Windows + 管理员权限下生效；其他平台自动跳过
builder.Services.AddSingleton<EtwMonitor>();

// ── 注册后台轮询工作线程 ──────────────────────────────────────────────────────
builder.Services.AddHostedService<Worker>();

// ── 配置 CORS ─────────────────────────────────────────────────────────────────
// 允许前端发起 WebSocket 握手：
//   - 本地开发：http://localhost:5173
//   - 远程访问：前端可能从 Mac 的 IP 发起请求，使用 AllowAnyOrigin 简化配置
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.SetIsOriginAllowed(_ => true)  // 允许任意来源
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// ── 指定监听端口 ──────────────────────────────────────────────────────────────
int port = bridgeConfig.GetValue<int>("WebSocketPort", 9527);
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var app = builder.Build();

app.UseCors();

// ── 启用 ASP.NET Core 内置 WebSocket 中间件 ───────────────────────────────────
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(30)
});

// ── 将 /ws 路径映射到 WebSocket 处理器 ───────────────────────────────────────
app.Map("/ws", async context =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        var handler = new WebSocketHandler(
            context.RequestServices.GetRequiredService<WebSocketConnectionManager>(),
            context.RequestServices.GetRequiredService<IDriverClient>(),
            context.RequestServices.GetRequiredService<ILogger<WebSocketHandler>>()
        );
        await handler.HandleAsync(context);
    }
    else
    {
        // 非 WebSocket 请求直接返回 400
        context.Response.StatusCode = 400;
        await context.Response.WriteAsync("WebSocket connections only.");
    }
});

app.Run();
