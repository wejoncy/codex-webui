"""HTTP request timing, separate from routing and access policy."""

import logging
from time import perf_counter
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)


class RequestLoggingMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        ident = uuid4().hex
        user_session = scope["state"]["user_session_id"]
        method, path = scope.get("method", "WS"), scope["path"]
        started = perf_counter()
        status, headers_ms = 500, 0.0
        log.info(
            "user_session_id=%s request=%s started %s %s",
            user_session, ident, method, path,
        )

        async def timed_send(message: Message):
            nonlocal status, headers_ms
            if message["type"] == "http.response.start":
                status = message["status"]
                headers_ms = (perf_counter() - started) * 1000
            elif message["type"] == "websocket.accept":
                status = 101
                headers_ms = (perf_counter() - started) * 1000
                log.info(
                    "user_session_id=%s request=%s accepted WS %s "
                    "handshake_ms=%.2f",
                    user_session, ident, path, headers_ms,
                )
            elif message["type"] == "websocket.close":
                status = message.get("code", 1000)
            await send(message)

        try:
            await self.app(scope, receive, timed_send)
        finally:
            log.info(
                "user_session_id=%s request=%s completed %s %s status=%d "
                "headers_ms=%.2f total_ms=%.2f",
                user_session, ident, method, path, status, headers_ms,
                (perf_counter() - started) * 1000,
            )
