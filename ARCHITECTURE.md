# Python 后端边界

依赖方向是 `API → Service → RPC → Transport`。`app.py` 是组装入口，集中创建对象并管理生命周期；模块间通过构造参数传递依赖，没有全局连接实例或隐式服务定位器。

| 模块 | 负责 | 不承担的工作 |
| --- | --- | --- |
| `app.py` | 组装依赖、注册路由与静态资源、应用关闭时清理连接 | 请求业务逻辑 |
| `api.py` | HTTP 参数验证、状态码、Cookie、浏览器 WebSocket 事件发送 | 启动进程、拼装执行策略 |
| `security.py` | HTTP/WS 的访问密钥与同源检查、安全响应头 | Codex 账户或 RPC 协议 |
| `service.py` | RPC 白名单、执行工作目录、默认审批与沙箱参数、浏览器事件快照 | HTTP 类型与传输细节 |
| `permissions.py` | 将命名权限预设与联网选项转换为 Codex 的线程/回合参数 | 浏览器存储与 HTTP 验证 |
| `rpc.py` | 初始化握手、请求 ID、并发响应匹配、超时、审批、连接状态 | 进程信号、WS 连接参数、HTTP 状态码 |
| `transport.py` | stdio 子进程或 WS 的打开、收发、关闭 | JSON-RPC 解析、会话业务 |
| `events.py` | 有界广播队列、慢消费者重同步 | 浏览器网络与会话执行 |
| `files.py` | 工作目录内的图片路径校验、类型识别 | HTTP 文件响应 |
| `config.py` / `errors.py` | 配置与校验 / RPC 错误数据 | 连接与 UI 状态 |

`Transport` 是一个仅有 `open/send/receive/close` 的 Protocol；stdio 与 WS 两种实现共享这个接口。`CodexBridge(settings, transport=...)` 可注入其他实现，协议测试无需模拟 FastAPI。服务、RPC、传输和图片解析层均不依赖 FastAPI/Pydantic。

应用拥有 RPC 连接；RPC 连接拥有读任务与请求状态；传输对象拥有其子进程或 WS 以及 stderr 读取任务；HTTP/WS 适配器拥有浏览器的发送/接收任务与订阅。各自创建的资源由各自关闭，浏览器标签关闭不会停止正在运行的 Codex。

读取历史调用 `thread/read` 与分页接口，不隐式调用 `thread/resume`。只有用户发送消息时，前端才恢复尚未恢复的会话；被其他 Codex 实例占用的会话仍可读取，不自动抢占或复制。UI 错误以 1 秒提示呈现，切换视图立即清除，迟到的旧会话错误不进入新会话。

接口保持 `create_app(settings)`、`python -m codex_webui` 与现有 HTTP/WS 路径不变。内部资源改为由 `bridge.transport` 和 `bridge.events` 持有，便于独立修改传输、广播或 HTTP 适配器。

回归重点是边界行为：真实子进程握手与清理、并发/超时/断线、远程鉴权、工作目录限制、图片越界、浏览器事件与审批、只读历史、写入冲突、提示消失与异步错误隔离。`tests/check_real_writer.py` 可使用真实 Codex CLI 在临时目录内验证写入冲突，全程使用合成历史，不发起模型推理。

权限选择由浏览器保存，通过 API 顶层字段传入服务层，再由 `permissions.py` 转成 Codex 协议数据。每个回合明确设置当前审批与网络策略，避免仅在线程创建时设置而导致已有会话无法切换权限；协议层与传输层不需要理解产品权限选项。
