"""Raw app-server I/O and resource ownership, without JSON-RPC or HTTP logic."""
from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import signal
from collections import deque
from typing import Any, Protocol

from .config import Settings


class Transport(Protocol):
    name: str

    async def open(self) -> None: ...
    async def send(self, data: str) -> None: ...
    async def receive(self) -> str | bytes | None: ...
    async def close(self) -> None: ...


class StdioTransport:
    name = "stdio"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.process: asyncio.subprocess.Process | None = None
        self.stderr: deque[str] = deque(maxlen=30)
        self._stderr_task: asyncio.Task | None = None

    async def open(self) -> None:
        # Resolve PATH/PATHEXT so npm's codex.cmd is found on Windows.
        argv = self.settings.command or (
            shutil.which(self.settings.codex_bin) or self.settings.codex_bin,
            "app-server",
        )
        self.stderr.clear()
        self.process = await asyncio.create_subprocess_exec(
            *argv, cwd=self.settings.workspace,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, limit=self.settings.max_message,
            start_new_session=os.name == "posix",
        )
        self._stderr_task = asyncio.create_task(self._read_stderr())

    async def send(self, data: str) -> None:
        if not self.process or self.process.returncode is not None or not self.process.stdin:
            raise ConnectionError("app-server 未连接")
        self.process.stdin.write((data + "\n").encode())
        await self.process.stdin.drain()

    async def receive(self) -> bytes | None:
        if not self.process or not self.process.stdout:
            raise ConnectionError("app-server 未连接")
        return await self.process.stdout.readline() or None

    async def _read_stderr(self) -> None:
        assert self.process and self.process.stderr
        while line := await self.process.stderr.readline():
            self.stderr.append(line.decode(errors="replace").rstrip())

    async def close(self) -> None:
        if self._stderr_task:
            self._stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._stderr_task
            self._stderr_task = None
        if not self.process:
            return
        process = self.process

        def stop(force: bool = False) -> None:
            with contextlib.suppress(ProcessLookupError):
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
                elif process.returncode is None:
                    process.kill() if force else process.terminate()

        stop()
        try:
            async with asyncio.timeout(3):
                await process.wait()
        except TimeoutError:
            stop(force=True)
            with contextlib.suppress(TimeoutError):
                async with asyncio.timeout(3):
                    await process.wait()
        self.process = None


class WebSocketTransport:
    name = "websocket"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.socket: Any = None

    async def open(self) -> None:
        from websockets.asyncio.client import connect

        headers = {}
        if self.settings.server_token:
            headers["Authorization"] = f"Bearer {self.settings.server_token}"
        self.socket = await connect(
            self.settings.server_url, additional_headers=headers,
            max_size=self.settings.max_message, open_timeout=15,
        )

    async def send(self, data: str) -> None:
        if self.socket is None:
            raise ConnectionError("app-server 未连接")
        await self.socket.send(data)

    async def receive(self) -> str | bytes:
        if self.socket is None:
            raise ConnectionError("app-server 未连接")
        return await self.socket.recv()

    async def close(self) -> None:
        if self.socket is not None:
            try:
                await self.socket.close()
            finally:
                self.socket = None


def create_transport(settings: Settings) -> Transport:
    return WebSocketTransport(settings) if settings.server_url else StdioTransport(settings)
