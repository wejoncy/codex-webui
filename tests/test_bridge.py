import asyncio
import json
import sys
from pathlib import Path

import pytest

from codex_webui.config import Settings
from codex_webui.events import EventHub
from codex_webui.transport import WebSocketTransport
from codex_webui.rpc import CodexBridge, RpcError, request_key

PEER = str(Path(__file__).with_name("fake_app_server.py"))


def run(coro):
    return asyncio.run(coro)


def test_handshake_concurrent_requests_and_errors(tmp_path):
    async def check():
        bridge = CodexBridge(Settings(workspace=tmp_path, command=(sys.executable, "-u", PEER)))
        try:
            results = await asyncio.gather(bridge.connect(), bridge.connect())
            assert all(r["connected"] for r in results)
            process = bridge.transport.process
            assert process
            replies = await asyncio.gather(*(bridge.request("fixture/echo", {"n": n}) for n in range(30)))
            assert replies == [{"n": n} for n in range(30)]
            assert bridge.transport.process is process
            with pytest.raises(RpcError, match="fixture failure") as error:
                await bridge.request("fixture/error")
            assert error.value.code == -32602
            assert error.value.data == {"field": "x"}
            assert not bridge.pending
        finally:
            await bridge.close()
        assert process.returncode is not None
    run(check())


def test_cli_path_resolution_starts_real_subprocess(tmp_path, monkeypatch):
    # A resolved launcher may have an extension (e.g. codex.cmd on Windows).
    # Use a real Python peer to verify the resolved path is used for spawning.
    (tmp_path / "app-server").write_text(Path(PEER).read_text(encoding="utf-8"), encoding="utf-8")
    launcher = str(tmp_path / "codex-launcher")

    def which(command):
        assert command == launcher
        return sys.executable

    monkeypatch.setattr("codex_webui.transport.shutil.which", which)

    async def check():
        bridge = CodexBridge(Settings(workspace=tmp_path, codex_bin=launcher))
        try:
            assert (await bridge.connect())["connected"]
            assert await bridge.request("fixture/echo", {"resolved": True}) == {"resolved": True}
        finally:
            await bridge.close()

    run(check())


def test_approval_identity_reply_once_and_pending_replay(tmp_path):
    async def check():
        bridge = CodexBridge(Settings(workspace=tmp_path, command=(sys.executable, "-u", PEER)))
        try:
            await bridge.connect()
            queue = bridge.events.subscribe()
            await bridge.request("fixture/approval")
            assert set(bridge.approvals) == {request_key(7), request_key("7")}
            assert (await queue.get())["id"] == 7
            assert (await queue.get())["id"] == "7"
            await bridge.reply(7, {"decision": "accept"})
            assert request_key(7) not in bridge.approvals
            assert request_key("7") in bridge.approvals
            with pytest.raises(RpcError, match="已处理"):
                await bridge.reply(7, {"decision": "accept"})
            await bridge.reply("7", {"decision": "decline"})
            assert not bridge.approvals
        finally:
            await bridge.close()
    run(check())


def test_timeout_exit_reconnect_and_cleanup(tmp_path):
    async def check():
        bridge = CodexBridge(Settings(workspace=tmp_path, command=(sys.executable, "-u", PEER), rpc_timeout=.2))
        try:
            await bridge.connect()
            with pytest.raises(RpcError, match="超时"):
                await bridge.request("fixture/stall")
            assert not bridge.pending
            with pytest.raises(RpcError, match="已关闭"):
                await bridge.request("fixture/exit")
            assert not bridge.ready
            assert not bridge.pending
            await bridge.connect()
            assert await bridge.request("fixture/echo", {"reconnected": True}) == {"reconnected": True}
        finally:
            await bridge.close()
    run(check())


def test_backpressure_requires_resync_and_does_not_block():
    hub = EventHub()
    queue = hub.subscribe()
    for i in range(600):
        hub.publish({"method": "delta", "params": {"i": i}})
    assert queue.qsize() == 1
    assert queue.get_nowait()["method"] == "webui/resyncRequired"
    hub.publish({"method": "delta", "params": {}})
    assert queue.empty()


def test_remote_transport_handshake_and_bearer_header(tmp_path, monkeypatch):
    import websockets.asyncio.client

    class Socket:
        def __init__(self):
            self.queue = asyncio.Queue()
            self.sent = []
            self.closed = False

        async def recv(self):
            return await self.queue.get()

        async def send(self, raw):
            message = json.loads(raw)
            self.sent.append(message)
            if "id" in message:
                result = {"userAgent": "remote-fixture"} if message["method"] == "initialize" else message["params"]
                await self.queue.put(json.dumps({"id": message["id"], "result": result}))

        async def close(self):
            self.closed = True

    async def check():
        socket = Socket()
        async def connect(uri, **kwargs):
            assert uri == "wss://app-server.example/codex"
            assert kwargs["additional_headers"] == {"Authorization": "Bearer server-secret"}
            return socket
        monkeypatch.setattr(websockets.asyncio.client, "connect", connect)
        bridge = CodexBridge(Settings(workspace=tmp_path, server_url="wss://app-server.example/codex", server_token="server-secret"))
        try:
            assert (await bridge.connect())["transport"] == "websocket"
            assert [m["method"] for m in socket.sent] == ["initialize", "initialized"]
            assert await bridge.request("fixture/echo", {"remote": True}) == {"remote": True}
            assert isinstance(bridge.transport, WebSocketTransport)
            assert bridge.transport.socket is socket
        finally:
            await bridge.close()
        assert socket.closed
    run(check())
