flowchart LR
    %% 定义样式 柔和学术配色
    classDef client fill:#d6eaf8,stroke:#2874a6,stroke-width:2px
    classDef server fill:#d5f5e3,stroke:#1e8449,stroke-width:2px
    classDef conn fill:#f9e79f,stroke:#d68910,stroke-width:2px
    classDef data fill:#f5b7b1,stroke:#922b21,stroke-width:2px

    A[客户端<br/>Browser/Application]:::client
    B[WebSocket 握手升级<br/>HTTP 初次握手]:::conn
    C[WebSocket 长连接通道<br/>双向持久TCP通道]:::conn
    D[服务端]:::server

    %% 流程箭头
    A -->|1. HTTP发起握手请求| B
    B -->|2. 协议升级成功| C
    C <-->|3. 全双工双向实时数据传输| D

    %% 补充标注
    note over A,D: 建立一次连接后，双方可随时主动收发消息<br/>无需重复建立HTTP请求，低延迟、低开销