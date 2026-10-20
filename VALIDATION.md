# 验证记录

本次在 Python 3.12 / Node.js 22 / Codex CLI 0.163.0 环境验证。

- Python 测试：20 项通过。覆盖 stdio 握手与请求复用、CLI 启动器路径解析、RPC 错误/超时、审批 ID 和单次回复、进程退出/重连、慢客户端重同步、远程连接参数与 Bearer 头、HTTP/WebSocket 登录、流式输出、图片访问边界，以及独立服务层的白名单、工作目录、只读历史和三种执行预设、联网策略、无效配置验证。
- 渲染 Worker：6 项通过。使用项目内实际 Markdown/KaTeX/mhchem 资源验证常见公式、转义、代码/价格、图片 URL、化学表达式、备用引擎标记和长文缓存。
- 页面状态验证：LinkeDOM 模拟 DOM 中通过连接、发送、流式公式/图片、乐观消息去重、完成事件先于 RPC 响应、只读历史加载、发送时延迟恢复、写入冲突保留历史与草稿、提示 1 秒自动消失/手动关闭/导航清除、迟到的历史与发送错误隔离、权限与联网控件同步/浏览器保存/已有会话更新、实验室和新建对话。
- 实际 Codex CLI：在独立临时 `CODEX_HOME` 内完成 `initialize → initialized → thread/list`，并验证子进程清理。未读取用户凭据，也未发起付费模型推理。
- 实际写入冲突：用两个 Codex app-server 和合成历史复现 `already has an active writer`，并在写入权仍被占用时验证 `thread/read` 和 `thread/turns/list` 正常返回历史。可用 `CODEX_TEST_POLL_LOOP=1 PYTHONPATH=. python tests/check_real_writer.py` 重现；该检查不发起模型推理。
- 包构建：`0.1.1` 的 `py3-none-any` wheel 构建成功，167 个条目，其中包含全部 148 个静态资源；逐字节核对包内代码与资源。安装到独立目录后验证模块入口、`codex-webui` 命令、页面/健康/API 路由、公式字体和 MathJax 静态资源，以及图片访问边界。安装检查复用已有后端依赖，未进行离线依赖打包。
- 本地前端依赖：SHA-256 清单核对通过。

沙箱测试命令：

```bash
CODEX_TEST_POLL_LOOP=1 python -m pytest -q
node tests/test_render.cjs
node tests/test_ui.mjs
python -m build --wheel --no-isolation
```

一次 Node Worker 测量中，含 200 段重复公式的 27,889 字符文档解析约 11 ms；这是本机后台解析样本，不代表浏览器绘制耗时或所有硬件上的性能保证。

本次未进行真实浏览器的视觉/布局验收、真实模型完整对话、远程网络端到端连接或 Docker 镜像构建。MathJax 备用路径具备本地资源与安全配置，其浏览器执行仍需实际浏览器验收。页面状态测试使用消毒 API 的测试替身，不代替真实浏览器的 DOMPurify 安全测试。

跨平台发行使用纯 Python 的 `py3-none-any` wheel，最低 Python 3.11。Windows 下 CLI 启动器经 PATH/PATHEXT 解析；Windows、macOS 尚未实机验证。当前沙箱禁止绑定 TCP 端口且用户 Codex 配置目录只读；HTTP 验证使用进程内 ASGI 客户端，真实 CLI 检查使用临时配置目录，不代表已启动可从浏览器访问的服务或验证了用户实际登录状态。

执行权限的三种预设 × 联网开关两种状态，共六种参数组合，均已通过当前 Codex CLI 导出的 `TurnStartParams` JSON Schema 验证。
