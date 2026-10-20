"""JSON-RPC session: handshake, correlation, approvals and connection state."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from time import monotonic
from typing import Any

from . import __version__
from .config import Settings
from .errors import RpcError
from .events import EventHub
from .transport import Transport, create_transport

log = logging.getLogger(__name__)


def request_key(value: Any) -> str:
    # JSON-RPC permits both 7 and "7". They must never share an identity.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class CodexBridge:
    def __init__(self, settings: Settings, transport: Transport | None = None):
        self.settings = settings
        self.transport = transport if transport is not None else create_transport(settings)
        self.events = EventHub()
        self.reader: asyncio.Task | None = None
        self.pending: dict[str, asyncio.Future] = {}
        self.approvals: dict[str, dict] = {}
        self.connect_lock = asyncio.Lock()
        self.write_lock = asyncio.Lock()
        self.reply_lock = asyncio.Lock()
        self.next_id = 0
        self.ready = False
        self.info: dict = {}
        self.last_error: str | None = None
        self.closing = False

    def status(self) -> dict:
        return {
            "connected": self.ready,
            "transport": self.transport.name,
            "workspace": str(self.settings.workspace),
            "error": self.last_error,
            "server": self.info,
        }

    async def connect(self) -> dict:
        async with self.connect_lock:
            if self.ready:
                return self.status()
            await self._cleanup()
            self.closing = False
            self.last_error = None
            log.info("Connecting to Codex app-server (transport=%s)", self.transport.name)
            try:
                await self.transport.open()
                self.reader = asyncio.create_task(self._read())
                self.info = await self.request("initialize", {
                    "clientInfo": {"name": "codex_webui_python", "title": "Codex Web UI", "version": __version__},
                    "capabilities": {"experimentalApi": True},
                })
                await self._write({"method": "initialized", "params": {}})
                if self.reader.done():
                    raise RpcError("app-server 在初始化期间断开")
                self.ready = True
                log.info("Codex app-server connected (transport=%s)", self.transport.name)
            except asyncio.CancelledError:
                self.closing = True
                await self._cleanup()
                raise
            except Exception as exc:
                log.exception("Codex app-server connection failed")
                self.last_error = str(exc)
                await self._cleanup()
                raise RpcError(f"无法连接 Codex app-server：{exc}") from exc
            self.events.publish({"method": "webui/status", "params": self.status()})
            return self.status()

    async def request(self, method: str, params: dict | None = None) -> Any:
        self.next_id += 1
        ident = f"webui-{self.next_id}"
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        started = monotonic()
        try:
            if method == "thread/name/set":
                log.info("Thread rename requested: thread_id=%s request_id=%s", (params or {}).get("threadId"), ident)
            await self._write({"id": ident, "method": method, "params": params or {}})
            async with asyncio.timeout(self.settings.rpc_timeout):
                return await future
        except TimeoutError as exc:
            log.warning("RPC timed out: method=%s elapsed_ms=%.0f", method, (monotonic() - started) * 1000)
            raise RpcError(f"{method} 请求超时", -32001) from exc
        except RpcError as exc:
            log.warning("RPC failed: method=%s code=%s elapsed_ms=%.0f", method, exc.code,
                        (monotonic() - started) * 1000)
            raise
        finally:
            self.pending.pop(ident, None)

    async def reply(self, ident: str | int, result: dict | None, error: dict | None = None) -> None:
        async with self.reply_lock:
            key = request_key(ident)
            if key not in self.approvals:
                raise RpcError("此请求已处理或已失效", -32004)
            message = {"id": ident}
            message.update({"error": error} if error else {"result": result or {}})
            await self._write(message)
            self.approvals.pop(key, None)
            self.events.publish({"method": "webui/requestResolved", "params": {"requestId": ident}})

    async def _write(self, message: dict) -> None:
        data = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        async with self.write_lock:
            try:
                await self.transport.send(data)
            except Exception as exc:
                raise RpcError(f"app-server 写入失败：{exc}") from exc

    async def _read(self) -> None:
        try:
            while (raw := await self.transport.receive()) is not None:
                self._dispatch(raw)
            raise RpcError("app-server 连接已关闭")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.last_error = str(exc)
            if not self.closing:
                log.exception("Codex app-server connection lost")
        finally:
            self.ready = False
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(RpcError(self.last_error or "app-server 已停止"))
            self.approvals.clear()
            if not self.closing:
                self.events.publish({"method": "webui/status", "params": self.status()})

    def _dispatch(self, raw: str | bytes) -> None:
        try:
            message = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            log.warning("Ignoring a non-JSON app-server line")
            return
        if not isinstance(message, dict):
            return
        if "method" in message:
            if message["method"] == "thread/name/updated":
                log.info("Thread name update received: thread_id=%s", message.get("params", {}).get("threadId"))
            if "id" in message:
                self.approvals[request_key(message["id"])] = message
            elif message["method"] == "serverRequest/resolved":
                self.approvals.pop(request_key(message.get("params", {}).get("requestId")), None)
            self.events.publish(message)
        elif "id" in message:
            future = self.pending.get(message["id"])
            if future is not None and not future.done():
                if "error" in message:
                    e = message["error"]
                    future.set_exception(RpcError(e.get("message", "RPC error"), e.get("code", -32000), e.get("data")))
                else:
                    future.set_result(message.get("result", {}))

    async def _cleanup(self) -> None:
        self.ready = False
        if self.reader and self.reader is not asyncio.current_task():
            self.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.reader
        self.reader = None
        with contextlib.suppress(Exception):
            await self.transport.close()
        self.approvals.clear()

    async def close(self) -> None:
        log.info("Closing Codex app-server")
        self.closing = True
        await self._cleanup()
