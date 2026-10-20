"""Application policy for allowed RPCs and execution workspace confinement."""
from __future__ import annotations

import asyncio
from typing import Any

from .config import Settings
from .errors import RpcError
from .image_references import ImageReferences
from .permissions import PermissionMode, permission_for
from .rpc import CodexBridge, request_key
from .thread_access import writer_is_locked

ALLOWED_METHODS = frozenset({
    "thread/list", "thread/read", "thread/start", "thread/resume", "thread/archive",
    "thread/name/set", "thread/turns/list", "thread/items/list", "thread/revert",
    "turn/start", "turn/interrupt", "model/list", "account/read",
})


class UnsupportedMethod(ValueError):
    pass


class CodexService:
    def __init__(self, settings: Settings, bridge: CodexBridge, image_references: ImageReferences | None = None):
        self.settings = settings
        self.bridge = bridge
        self._read_only: set[str] = set()
        self.image_references = image_references

    def _access_event(self, thread_id: str, read_only: bool) -> dict:
        return {"method": "webui/threadAccess", "params": {"threadId": thread_id, "readOnly": read_only}}

    def _set_read_only(self, thread_id: str, read_only: bool) -> None:
        if (thread_id in self._read_only) == read_only:
            return
        if read_only:
            self._read_only.add(thread_id)
        else:
            self._read_only.discard(thread_id)
        self.bridge.events.publish(self._access_event(thread_id, read_only))

    def status(self) -> dict:
        return self.bridge.status()

    async def connect(self) -> dict:
        return await self.bridge.connect()

    async def request(
        self, method: str, params: dict, *,
        permission_mode: PermissionMode | None = None, allow_network: bool | None = None,
    ) -> Any:
        if method not in ALLOWED_METHODS:
            raise UnsupportedMethod("不支持的 RPC 方法")
        thread_id = params.get("threadId")
        if not isinstance(thread_id, str):
            thread_id = None
        if thread_id in self._read_only and method in {
            "turn/start", "turn/interrupt", "thread/revert", "thread/archive", "thread/name/set",
        }:
            raise RpcError("此对话为只读，请在其他 Codex 释放后刷新页面", data={"threadId": thread_id, "readOnly": True})
        if not self.bridge.ready:
            await self.bridge.connect()
        params = dict(params)
        if (permission_mode is not None or allow_network is not None) and method in {"thread/start", "thread/resume", "turn/start"}:
            permission = permission_for(permission_mode or "ask")
            params.update(permission.turn_params(self.settings.workspace, allow_network=bool(allow_network)) if method == "turn/start"
                          else permission.thread_params())
        if method in {"thread/start", "thread/resume"}:
            params["cwd"] = str(self.settings.workspace)
            params.setdefault("sandbox", "workspace-write")
            params.setdefault("approvalPolicy", "on-request")
        elif "cwd" in params:
            params["cwd"] = str(self.settings.workspace)
        # Reads are forwarded directly and never acquire a writer via resume.
        try:
            result = await self.bridge.request(method, params)
        except RpcError as exc:
            if thread_id and "already has an active writer" in str(exc).lower():
                self._set_read_only(thread_id, True)
                raise RpcError(str(exc), exc.code, {"threadId": thread_id, "readOnly": True}) from exc
            raise
        if method == "thread/resume" and thread_id:
            self._set_read_only(thread_id, False)
        if (self.image_references is not None and method in ImageReferences.RESULT_METHODS
                and self.bridge.status().get("transport") == "stdio"):
            await asyncio.to_thread(self.image_references.observe_result, method, result)
        return result

    async def observe_event(self, message: dict) -> None:
        if (self.image_references is not None and message.get("method") in ImageReferences.EVENT_METHODS
                and self.bridge.status().get("transport") == "stdio"):
            await asyncio.to_thread(self.image_references.observe_event, message)

    async def refresh_access(
        self, thread_id: str, *, permission_mode: PermissionMode | None = None,
        allow_network: bool | None = None,
    ) -> dict:
        if not self.bridge.ready:
            await self.bridge.connect()
        status = self.bridge.status()
        locked = None
        # A remote app-server's filesystem belongs to the remote machine.
        if status.get("transport") == "stdio":
            locked = await asyncio.to_thread(writer_is_locked, status.get("server", {}).get("codexHome"), thread_id)
        if locked:
            # A lock held by our own app-server remains writable. Ask the server
            # rather than caching ownership across disconnects or thread unloads.
            cursor = None
            try:
                while True:
                    loaded = await self.bridge.request("thread/loaded/list", {"cursor": cursor, "limit": 100})
                    if thread_id in loaded["data"]:
                        locked = False
                        break
                    cursor = loaded.get("nextCursor")
                    if not cursor:
                        break
            except RpcError:
                # Without ownership evidence, a live OS lock stays read-only.
                pass
        if locked is not None:
            self._set_read_only(thread_id, locked)
        # When passive checks are unavailable, a refresh can retry a known
        # conflict. Never resume an unknown thread merely to browse its history.
        elif thread_id in self._read_only:
            try:
                await self.request("thread/resume", {"threadId": thread_id, "excludeTurns": True},
                                   permission_mode=permission_mode, allow_network=allow_network)
            except RpcError as exc:
                if "already has an active writer" not in str(exc).lower():
                    raise
        return {"threadId": thread_id, "readOnly": thread_id in self._read_only}

    async def reply(self, ident: str | int, result: dict | None, error: dict | None) -> None:
        request = self.bridge.approvals.get(request_key(ident))
        if request and request.get("params", {}).get("threadId") in self._read_only:
            raise RpcError("此对话为只读")
        await self.bridge.reply(ident, result, error)

    def subscribe(self) -> asyncio.Queue:
        return self.bridge.events.subscribe()

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self.bridge.events.unsubscribe(queue)

    def event_snapshot(self) -> list[dict]:
        return [
            {"method": "webui/status", "params": self.status()},
            *(self._access_event(ident, True) for ident in sorted(self._read_only)),
            *self.bridge.approvals.values(),
        ]
