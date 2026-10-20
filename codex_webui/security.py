"""HTTP/WebSocket access policy and security headers; no Codex protocol logic."""
from __future__ import annotations

import hmac
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.requests import HTTPConnection

CSP = (
    "default-src 'self'; script-src 'self'; worker-src 'self'; "
    "style-src 'self' 'unsafe-inline'; font-src 'self'; "
    "img-src 'self' data: blob: https: http:; connect-src 'self'; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)


class AccessPolicy:
    cookie_name = "codex_webui_token"

    def __init__(self, token: str):
        self.token = token

    @property
    def required(self) -> bool:
        return bool(self.token)

    def valid_token(self, supplied: str) -> bool:
        return hmac.compare_digest(supplied.encode(), self.token.encode())

    def authenticated(self, connection: HTTPConnection) -> bool:
        if not self.required:
            return True
        supplied = connection.cookies.get(self.cookie_name, "")
        bearer = connection.headers.get("authorization", "")
        if bearer.startswith("Bearer "):
            supplied = bearer[7:]
        return self.valid_token(supplied)

    def same_origin(self, connection: HTTPConnection) -> bool:
        origin = connection.headers.get("origin")
        if not origin:
            return True  # CLI clients don't set Origin.
        parsed = urlparse(origin)
        return parsed.scheme in {"http", "https"} and parsed.netloc == connection.headers.get("host")


def install_security(app: FastAPI, access: AccessPolicy) -> None:
    @app.middleware("http")
    async def guards(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if not access.same_origin(request):
                return JSONResponse({"detail": "不允许跨站请求"}, status_code=403)
            if request.url.path not in {"/api/login", "/api/health"} and not access.authenticated(request):
                return JSONResponse({"detail": "请先输入访问密钥"}, status_code=401)
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return JSONResponse({"detail": "无效的 Content-Length"}, status_code=400)
            if length > 24 * 1024 * 1024:
                return JSONResponse({"detail": "请求超过 24 MiB"}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path == "/":
            response.headers["Content-Security-Policy"] = CSP
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        elif request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response
