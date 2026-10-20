"""Application policy tests need neither FastAPI nor a running app-server."""
import asyncio

import pytest

from codex_webui.config import Settings
from codex_webui.errors import RpcError
from codex_webui.events import EventHub
from codex_webui.rpc import request_key
from codex_webui.service import CodexService, UnsupportedMethod


class RecordingBridge:
    def __init__(self):
        self.ready = False
        self.calls = []
        self.connects = 0
        self.events = EventHub()
        self.approvals = {}
        self.locked = set()
        self.loaded = []
        self.connection_info = {}

    def status(self):
        return {"connected": self.ready, **self.connection_info}

    async def connect(self):
        self.connects += 1
        self.ready = True
        return {"connected": True}

    async def request(self, method, params):
        self.calls.append((method, params))
        if method == "thread/resume" and params.get("threadId") in self.locked:
            raise RpcError(f"thread {params['threadId']} already has an active writer")
        if method == "thread/loaded/list":
            return {"data": self.loaded, "nextCursor": None}
        return params


def test_reading_history_does_not_resume_or_mutate_input(tmp_path):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        params = {"threadId": "external-writer", "includeTurns": False}
        await service.request("thread/read", params)
        await service.request("thread/turns/list", {"threadId": "external-writer"})
        assert [method for method, _ in bridge.calls] == ["thread/read", "thread/turns/list"]
        assert bridge.connects == 1
        assert params == {"threadId": "external-writer", "includeTurns": False}
    asyncio.run(check())


def test_execution_uses_configured_workspace_without_mutating_input(tmp_path):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        params = {"threadId": "fixture-thread", "cwd": "elsewhere"}
        for method in ["thread/start", "thread/resume"]:
            result = await service.request(method, params)
            assert result["cwd"] == str(tmp_path)
            assert result["sandbox"] == "workspace-write"
            assert result["approvalPolicy"] == "on-request"
        assert params == {"threadId": "fixture-thread", "cwd": "elsewhere"}
    asyncio.run(check())


def test_disallowed_method_is_rejected_before_connecting(tmp_path):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        with pytest.raises(UnsupportedMethod):
            await service.request("process/spawn", {"command": "anything"})
        assert bridge.connects == 0
        assert bridge.calls == []
    asyncio.run(check())


def test_same_thread_revert_is_forwarded_without_execution_options(tmp_path):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        params = {"threadId": "original-thread", "beforeTurnId": "edited-turn"}
        assert await service.request("thread/revert", params, permission_mode="full-access", allow_network=True) == params
        assert bridge.calls == [("thread/revert", params)]
    asyncio.run(check())


@pytest.mark.parametrize("mode,approval,sandbox,kind", [
    ("ask", "on-request", "workspace-write", "workspaceWrite"),
    ("workspace-auto", "never", "workspace-write", "workspaceWrite"),
    ("full-access", "never", "danger-full-access", "dangerFullAccess"),
])
@pytest.mark.parametrize("network", [False, True])
def test_execution_presets_apply_to_new_resumed_and_existing_threads(tmp_path, mode, approval, sandbox, kind, network):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        for method in ["thread/start", "thread/resume"]:
            result = await service.request(method, {}, permission_mode=mode, allow_network=network)
            assert result["approvalPolicy"] == approval
            assert result["sandbox"] == sandbox
        original = {"threadId": "already-resumed", "input": []}
        result = await service.request("turn/start", original, permission_mode=mode, allow_network=network)
        assert result["approvalPolicy"] == approval
        assert result["sandboxPolicy"]["type"] == kind
        if kind == "workspaceWrite":
            assert result["sandboxPolicy"]["networkAccess"] is network
            assert result["sandboxPolicy"]["writableRoots"] == [str(tmp_path)]
        assert original == {"threadId": "already-resumed", "input": []}
        read = await service.request("thread/read", {"threadId": "other-writer"},
                                     permission_mode=mode, allow_network=network)
        assert read == {"threadId": "other-writer"}
    asyncio.run(check())


def test_writer_conflict_is_scoped_replayed_and_blocks_all_writes(tmp_path):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        queue = service.subscribe()
        bridge.locked.add("locked")
        with pytest.raises(RpcError) as conflict:
            await service.request("thread/resume", {"threadId": "locked"})
        assert conflict.value.data == {"threadId": "locked", "readOnly": True}
        event = {"method": "webui/threadAccess", "params": conflict.value.data}
        assert queue.get_nowait() == event
        assert event in service.event_snapshot()
        before = len(bridge.calls)
        for method in ["turn/start", "turn/interrupt", "thread/revert", "thread/name/set", "thread/archive"]:
            with pytest.raises(RpcError):
                await service.request(method, {"threadId": "locked"})
        assert len(bridge.calls) == before
        bridge.approvals[request_key("approval")] = {"params": {"threadId": "locked"}}
        with pytest.raises(RpcError):
            await service.reply("approval", {}, None)
        assert await service.request("thread/read", {"threadId": "locked"}) == {"threadId": "locked"}
        assert await service.request("turn/start", {"threadId": "other"}) == {"threadId": "other"}
        assert (await service.refresh_access("locked"))["readOnly"] is True
        assert queue.empty(), "repeated conflicts must not flood subscribers"
        bridge.locked.clear()
        assert await service.refresh_access("locked") == {"threadId": "locked", "readOnly": False}
        assert queue.get_nowait() == {"method": "webui/threadAccess", "params": {"threadId": "locked", "readOnly": False}}
        assert event not in service.event_snapshot()
        await service.request("turn/start", {"threadId": "locked"})
        service.unsubscribe(queue)
    asyncio.run(check())


def test_access_check_connects_without_resuming_unknown_threads(tmp_path):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        assert await service.refresh_access("ordinary-history") == {"threadId": "ordinary-history", "readOnly": False}
        assert bridge.calls == []
        assert bridge.connects == 1
    asyncio.run(check())


def test_passive_access_check_distinguishes_external_own_and_released_writers(tmp_path, monkeypatch):
    locked = True
    probes = []

    def probe(home, ident):
        probes.append((home, ident))
        return locked

    monkeypatch.setattr("codex_webui.service.writer_is_locked", probe)

    async def check():
        nonlocal locked
        bridge = RecordingBridge()
        bridge.connection_info = {"transport": "stdio", "server": {"codexHome": str(tmp_path)}}
        service = CodexService(Settings(workspace=tmp_path), bridge)
        assert (await service.refresh_access("external"))["readOnly"] is True
        bridge.loaded = ["own"]
        assert (await service.refresh_access("own"))["readOnly"] is False
        assert (await service.refresh_access("external"))["readOnly"] is True
        locked = False
        assert (await service.refresh_access("external"))["readOnly"] is False
        locked = True
        # Reconnecting/unloading must not leave cached ownership behind.
        bridge.loaded.clear()
        assert (await service.refresh_access("own"))["readOnly"] is True
        assert all(method == "thread/loaded/list" for method, _ in bridge.calls)
        assert probes and all(home == str(tmp_path) for home, _ in probes)

    asyncio.run(check())


def test_remote_access_never_probes_local_disk(tmp_path, monkeypatch):
    def forbidden(*_):
        pytest.fail("remote server paths must never be inspected locally")

    monkeypatch.setattr("codex_webui.service.writer_is_locked", forbidden)

    async def check():
        bridge = RecordingBridge()
        bridge.connection_info = {"transport": "websocket", "server": {"codexHome": str(tmp_path)}}
        service = CodexService(Settings(workspace=tmp_path), bridge)
        assert (await service.refresh_access("remote"))["readOnly"] is False
        assert bridge.calls == []

    asyncio.run(check())


def test_delete_rechecks_unopened_writers_and_forwards_only_after_release(tmp_path, monkeypatch):
    locked = True
    monkeypatch.setattr("codex_webui.service.writer_is_locked", lambda *_: locked)

    async def check():
        nonlocal locked
        bridge = RecordingBridge()
        bridge.connection_info = {"transport": "stdio", "server": {"codexHome": str(tmp_path)}}
        service = CodexService(Settings(workspace=tmp_path), bridge)
        with pytest.raises(RpcError) as conflict:
            await service.request("thread/delete", {"threadId": "unopened"})
        assert conflict.value.data == {"threadId": "unopened", "readOnly": True}
        assert all(method != "thread/delete" for method, _ in bridge.calls)
        assert all(method != "thread/resume" for method, _ in bridge.calls)
        locked = False
        params = {"threadId": "unopened"}
        assert await service.request("thread/delete", params) == params
        assert bridge.calls[-1] == ("thread/delete", params)

    asyncio.run(check())


@pytest.mark.parametrize("params", [{}, {"threadId": None}, {"threadId": 7}, {"threadId": ""}])
def test_delete_requires_thread_id_before_connecting(tmp_path, params):
    async def check():
        bridge = RecordingBridge()
        service = CodexService(Settings(workspace=tmp_path), bridge)
        with pytest.raises(RpcError):
            await service.request("thread/delete", params)
        assert bridge.connects == 0 and bridge.calls == []

    asyncio.run(check())
