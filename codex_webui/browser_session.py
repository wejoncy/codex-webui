"""Browser correlation cookies; independent of authentication and Codex."""

import re
from uuid import uuid4

from starlette.requests import HTTPConnection
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class BrowserSessionMiddleware:
    cookie_name = "codex_webui_session"

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        connection = HTTPConnection(scope)
        ident = connection.cookies.get(self.cookie_name, "")
        new_session = not re.fullmatch(r"[a-f0-9]{32}", ident)
        if new_session:
            ident = uuid4().hex
        scope.setdefault("state", {})["user_session_id"] = ident
        cookie = None
        if new_session and scope["type"] == "http":
            response = Response()
            response.set_cookie(
                self.cookie_name, ident, httponly=True, samesite="lax",
                secure=connection.url.scheme == "https",
            )
            cookie = response.headers["set-cookie"].encode("latin-1")

        async def send_with_session(message: Message):
            if cookie and message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"set-cookie", cookie))
            await send(message)

        await self.app(scope, receive, send_with_session)
