# Codex Web UI · Python

一个用 **Python + FastAPI** 开发的 Codex app-server Web 工作台。中文界面，支持流式对话、LaTeX 公式、图片与代码混排。参考 [LimLLL/codex-webui](https://github.com/LimLLL/codex-webui) 的连接架构，界面和实现独立编写。

前端是原生 HTML/CSS/JavaScript，**无需 Node 构建、无需公共 CDN**。Node.js 仅用于安装/运行 Codex CLI，以及运行可选的渲染测试。

## 启动

需要 Python 3.11+，以及已安装、已登录的 Codex CLI。连接协议已用 **Codex CLI 0.163.0** 的实际握手与生成的 JSON Schema 核对；其他版本可能需要适配。

```bash
cd codex-webui
python -m venv .venv
source .venv/bin/activate
pip install -e .

# 尚未安装或登录 Codex 时执行：
npm install -g @openai/codex
codex login

# 将当前目录作为 Codex 的工作目录
python -m codex_webui --workspace .
```

打开 **http://127.0.0.1:8172**。也可以运行 `codex-webui --port 8172`。

打开 **http://127.0.0.1:8172/?demo=1** 直接进入渲染实验室，即使未安装或登录 Codex，也能预览公式、图片、代码、表格和长文。实验室不会发起模型请求。

Windows 使用 `.venv\Scripts\activate`，启动参数相同。

工作目录按 `--workspace` → `CODEX_WEBUI_WORKSPACE` → 自动临时目录选择，支持相对路径、空格和 `~`。自动临时目录在服务关闭、Codex 子进程退出后清理；显式指定的目录不会删除。远程 app-server 需要显式指定远端工作目录。前端资源按 Python 包的实际位置加载，Codex 命令默认从 PATH 查找，也可通过 `CODEX_BIN` 指定。项目移动目录后无需改代码；安装 wheel 后可从任意目录启动。

## Wheel 安装（Windows / Linux / macOS）

发行包为 `codex_webui_python-0.1.1-py3-none-any.whl`，包含 Python 后端和完整 HTML、JavaScript、CSS、公式字体及第三方前端资源。同一个 wheel 可在 Windows、Linux、macOS 上安装，无需为各系统重新编译，也不需要 Node 构建前端。

在安装了 Python 3.11+ 的终端执行（将路径替换为下载的 wheel 路径）：

```bash
python -m pip install ./codex_webui_python-0.1.1-py3-none-any.whl
# 切换到要操作的项目目录后启动
python -m codex_webui --port 8172
```

也可以使用安装生成的 `codex-webui --port 8172` 命令，访问 **http://127.0.0.1:8172**。系统只有 `python3` 命令时，用 `python3` 替换上面的 `python`；Windows 也可以使用 `py -3.11` 等已安装版本的 Python 启动器。

`py3-none-any` 表示本项目是纯 Python、无特定系统或 CPU 架构的二进制扩展；最低 Python 版本仍为 3.11。Python、后端依赖和 Codex CLI 不内嵌在 wheel 中，pip 会按本机平台安装依赖（其中可能含有平台专用的二进制包），因此这不是离线依赖包或双击运行的 exe/app。

默认 stdio 模式需要在本机另行安装并登录可用的 Codex CLI，且 `codex` 位于 PATH 中；Windows 下会通过 PATH/PATHEXT 查找 `codex.cmd` 等启动器，也可以设置 `CODEX_BIN` 为 CLI 的绝对路径。连接远程 WebSocket app-server 时，Web UI 所在机器不需要安装 Codex CLI。

目前仅在 Linux / Python 3.12 环境实际验证构建、安装和运行逻辑；Windows、macOS 的安装及 Codex 子进程交互尚未实机验证。Codex CLI 自身的平台、架构和登录要求也需要满足。

重新构建 wheel：

```bash
python -m pip install build
python -m build --wheel
```

## 连接方式

默认由 Python 启动 `codex app-server` 子进程，经 stdio 交换逐行 JSON-RPC。多个浏览器标签共用一个 app-server 连接，不会为每次请求重复创建进程。

浏览历史只调用只读接口，不会争抢其他 Codex 实例的会话写入权。发送消息时才恢复会话；若该会话仍被另一个实例占用，保留历史与输入草稿并给出提示。错误提示在 1 秒后消失，切换会话、新建对话或进入实验室时立即清除。

也可以连接已运行的 WebSocket app-server：

```bash
# 在 app-server 所在机器上启动（鉴权参数以该版本 CLI --help 为准）
codex app-server --listen ws://127.0.0.1:4500

# 在 Web UI 所在机器设置
export CODEX_APP_SERVER_URL=ws://127.0.0.1:4500
# 若 app-server 启用了 Bearer token 鉴权：
export CODEX_APP_SERVER_TOKEN=your-app-server-token
python -m codex_webui
```

`CODEX_WEBUI_WORKSPACE` 会作为新建和恢复线程的 `cwd`，远程模式下该路径也必须存在于 app-server 机器上。远程生成的本地图片需要共享文件系统或改用 HTTP 图片地址。

应用使用 Codex 自己的账户与模型配置，不需要在网页中填写 OpenAI API Key。`CODEX_APP_SERVER_TOKEN` 和网页访问密钥是两个独立的配置。

## 执行权限与联网

输入框上方和「连接与设置」提供相同的权限选项，选择保存在当前浏览器中，并从下一条消息生效。新建、恢复和已有会话都应用当前选择；不会改变已经运行中的任务。

| 选项 | 行为 |
| --- | --- |
| 默认询问 | 工作区写入，使用 `on-request` 审批 |
| 工作区自动 | 工作区写入，使用 `never` 审批，超出权限的操作会失败 |
| 完整访问 | 使用 `danger-full-access` 和 `never`，可操作服务端账户可访问的文件与网络 |

「允许联网」开关独立控制工作区模式下 Codex 命令的外部网络访问；可以组合为「工作区自动 + 允许联网」，无需开放完整文件系统。完整访问模式已包含联网，此时开关显示为开启且不可单独关闭。默认询问模式下也可以允许联网。

后端在每次 `turn/start` 设置 `approvalPolicy` 和 `sandboxPolicy.networkAccess`，因此已有会话切换选项也会生效；这些设置仍受 app-server、宿主操作系统和外部沙箱策略约束。联网开关控制执行命令的网络访问，不改变 Web UI 的 HTTP 监听地址。用户问题和 MCP 工具需要填写的内容仍需回答。

API 的 `POST /api/rpc` 支持可选的顶层 `permissionMode`（`ask` / `workspace-auto` / `full-access`）和布尔值 `allowNetwork`；这些 UI 选项由服务层转为 Codex 字段，不会作为额外参数透传给 app-server。省略时保留原始 RPC 参数行为。

## 已实现

- 历史会话列表、搜索、分页、继续对话、重命名与归档。
- 流式回复、模型与推理强度选择、停止生成、命令和文件变更展示。
- 命令执行、文件变更和权限审批，以及用户问题回复。审批由用户在页面上明确操作；不支持的服务端请求显示详情并提供拒绝按钮。
- 粘贴、选择或拖入图片；每次最多 4 张，每张最多 8 MiB，总计最多 12 MiB。
- Markdown、表格、代码高亮与复制；LaTeX 行内/独立公式、矩阵、对齐、分段函数、化学公式。
- PNG、JPEG、WebP、GIF、SVG、AVIF 等浏览器支持的图片；点击预览、缩放和打开原图。
- 深浅主题、手机布局、`Ctrl/⌘ + K` 新建对话。
- 可选访问密钥、同源请求校验、HTML 消毒、受工作目录限制的图片读取。

会话与历史由 Codex 持久化。主题保存在浏览器中；输入草稿和未发送的附件保存在当前页面内存中。

## 渲染设计

```text
浏览器：HTML / CSS / ES Modules
  ├─ Web Worker：Markdown 解析 → KaTeX 公式渲染 → 有界公式缓存
  ├─ 主线程：DOMPurify → 按块更新 DOM → 按需 MathJax 补充渲染
  └─ 图片：lazy loading / async decoding / 原图预览
             ↕ REST + WebSocket
Python：FastAPI → JSON-RPC 请求复用 / 审批管理 / 慢客户端重同步
             ↕ stdio 或 WebSocket
Codex app-server
```

- **后台排版**：Markdown 与常见公式在 Web Worker 内解析，避免阻塞输入。
- **流式合并**：文本增量以 80 ms 窗口合并；同一个渲染目标只保留最新待渲染内容，结束时立即刷新。
- **局部更新**：保留相同顶层块的 DOM，减少重复构建已显示的公式与图片。
- **长文布局**：历史按页读取；消息使用 `content-visibility: auto`。超过 24,000 字符的文档按标题分段，减少屏外布局。
- **公式缓存**：最多缓存 512 个公式。KaTeX 无法解析的公式才加载 MathJax，减少普通页面的首屏开销。
- **网络解耦**：慢标签页的事件队列有上限，溢出会断开并重新读取当前会话，而不是静默丢弃增量。

支持的公式分隔符：`$…$`、`$$…$$`、`\(…\)`、`\[…\]`，以及 `math` / `latex` / `tex` 代码块和独立的 `equation` / `align` 等环境。代码里的美元符号和常见价格文本不会作为公式处理。

KaTeX + MathJax 覆盖常用数学表达，**不等同于完整 TeX 编译器**：自定义宏包、TikZ、任意 LaTeX 文档、损坏的表达式不能保证渲染；无法解析时保留源公式。图片格式受浏览器解码能力限制，TIFF/PSD/HEIC 等需要先转换为 PNG/WebP。

本地图片示例：

```markdown
![结果](plots/result.png)
![带空格的文件](<plots/my result.png>)
```

也支持位于当前工作目录内的绝对图片路径。文件读取只允许当前工作目录下的图片，也会检查符号链接指向。SVG 通过图片元素显示，文件响应添加 sandbox CSP。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `CODEX_WEBUI_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `CODEX_WEBUI_PORT` | `8172` | HTTP 端口 |
| `CODEX_WEBUI_WORKSPACE` | 自动临时目录 | Codex 工作目录与图片访问根目录 |
| `CODEX_BIN` | `codex` | Codex CLI 路径 |
| `CODEX_APP_SERVER_URL` | 空 | 使用远程 `ws://` / `wss://` 连接 |
| `CODEX_APP_SERVER_TOKEN` | 空 | app-server 的 Bearer token |
| `CODEX_WEBUI_TOKEN` | 空 | 网页访问密钥 |
| `CODEX_HOME` | Codex 自身默认值 | 由 Codex CLI 读取的配置和会话目录 |

`.env.example` 提供配置示例；Python 启动不会自动读取 `.env`，需要导出变量。

网页密钥登录后通过 HttpOnly、SameSite Cookie 维持会话，HTTPS 时启用 Secure。也支持 API 客户端传入 `Authorization: Bearer <CODEX_WEBUI_TOKEN>`。

对外提供访问时设置访问密钥并使用 HTTPS 反向代理，代理需保留 Host、Origin 和 WebSocket 升级头。当前项目按单用户工作台设计；同一实例的标签页共享会话和审批权限。

## 检查与测试

```bash
pip install -e '.[test]'
python -m pytest -q
node tests/test_render.cjs
node tests/test_ui.mjs
```

Python 测试使用独立的模拟 app-server，覆盖握手、并发请求、错误/超时、进程退出与重连、审批 ID、慢客户端、流式事件、访问密钥、跨站请求、图片路径穿越与符号链接。

Node 测试执行实际渲染 Worker，覆盖公式、化学表达式、价格与代码、不可信 HTML/链接、图片 URL、备用引擎标记及长文缓存。渲染实验室的耗时显示区分后台解析耗时和提交到 DOM 的耗时，后者包含消息传输与 HTML 消毒，但不代表完整浏览器绘制耗时。

`test_ui.mjs` 使用 LinkeDOM 和模拟事件验证页面状态：连接、发送、流式公式/图片、乐观消息去重、完成事件先于 RPC 响应、实验室和新建对话。它使用测试替身代替浏览器消毒 API，不验证真实浏览器布局、绘制或隔离行为。

在限制 asyncio 跨线程 socket 唤醒的沙箱中，可用 `CODEX_TEST_POLL_LOOP=1 python -m pytest -q` 启用测试专用的轮询计时器；正常环境不需要。

## 目录

```text
codex_webui/
  app.py                 应用组装与生命周期
  api.py                 HTTP / WebSocket 适配与请求验证
  security.py            访问密钥 / 同源校验 / 安全响应头
  service.py             RPC 白名单 / 工作目录与执行参数策略
  permissions.py         审批与沙箱预设 / 命令联网策略
  rpc.py                 JSON-RPC 握手 / 请求匹配 / 审批 / 超时
  transport.py           stdio 与 WS 传输 / 子进程与连接资源
  events.py              有界事件广播 / 慢消费者重同步
  files.py               工作目录内图片解析与边界校验
  errors.py              RPC 错误数据
  config.py              环境配置
  static/
    index.html           界面
    style.css            主题与响应式布局
    app.js               对话与审批交互
    renderer.js          Worker 调度、HTML 消毒、备用公式引擎
    render-worker.js     Markdown、KaTeX、代码高亮
    examples.js          渲染实验室
    vendor/              本地前端依赖、许可证与校验清单
tests/                     协议、API 与渲染测试
```

依赖方向为 `API → Service → RPC → Transport`，服务、RPC、传输和图片解析层不依赖 FastAPI。传输通过 Protocol 接口隔离，可注入测试实现。职责、资源所有权与测试边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

协议入口可参考 [OpenAI app-server 文档](https://developers.openai.com/codex/app-server/)，并以所用 CLI 的 `codex app-server generate-json-schema --out ./schema` 为准。

项目代码采用 Apache-2.0 许可证；前端第三方依赖保留各自许可证，见 `static/vendor/`。
