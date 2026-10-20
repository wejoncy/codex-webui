"""FastAPI adapter: validation, HTTP responses and browser event delivery."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field, StrictBool, StrictInt, StrictStr
from starlette.requests import HTTPConnection

from .files import ImageNotFound, UnsupportedImage
from .history import (
    HistoryPage, HistoryQuery, ToolDetailQuery, ToolDetailResponse,
    read_history, read_tool,
)
from .permissions import PermissionMode
from .security import AccessPolicy
from .service import CodexService, UnsupportedMethod

log = logging.getLogger(__name__)


class ExecutionOptions(BaseModel):
    permissionMode: PermissionMode | None = None
    allowNetwork: StrictBool | None = None


class RpcBody(ExecutionOptions):
    method: str
    params: dict = Field(default_factory=dict)


class ThreadAccessBody(ExecutionOptions):
    threadId: StrictStr


class ReplyBody(BaseModel):
    id: StrictStr | StrictInt
    result: dict | None = None
    error: dict | None = None


class LoginBody(BaseModel):
    token: str


class ClientErrorBody(BaseModel):
    message: StrictStr = Field(max_length=2000)
    source: StrictStr = Field(default="", max_length=500)


async def current_service(connection: HTTPConnection) -> CodexService:
    return connection.app.state.service


ServiceDependency = Annotated[CodexService, Depends(current_service)]


def create_router(access: AccessPolicy) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health")
    async def health():
        return {"ok": True, "authRequired": access.required}

    @router.post("/api/login")
    async def login(body: LoginBody, request: Request):
        if not access.valid_token(body.token):
            raise HTTPException(401, "访问密钥不正确")
        response = JSONResponse({"ok": True})
        response.set_cookie(access.cookie_name, body.token, httponly=True,
                            secure=request.url.scheme == "https", samesite="strict", max_age=86400)
        return response

    @router.post("/api/logout")
    async def logout():
        response = JSONResponse({"ok": True})
        response.delete_cookie(access.cookie_name)
        return response

    @router.get("/api/status")
    async def status(service: ServiceDependency):
        return service.status()

    @router.post("/api/client-error", status_code=204)
    async def client_error(body: ClientErrorBody):
        log.error("Browser error: message=%r source=%r", body.message, body.source)
        return Response(status_code=204)

    @router.post("/api/connect")
    async def connect(service: ServiceDependency):
        return await service.connect()

    @router.post("/api/rpc")
    async def rpc(body: RpcBody, service: ServiceDependency):
        try:
            result = await service.request(body.method, body.params,
                                           permission_mode=body.permissionMode, allow_network=body.allowNetwork)
            return {"result": result}
        except UnsupportedMethod as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.post("/api/thread-access")
    async def refresh_access(body: ThreadAccessBody, service: ServiceDependency):
        return await service.refresh_access(body.threadId, permission_mode=body.permissionMode,
                                            allow_network=body.allowNetwork)

    @router.post("/api/history", response_model=HistoryPage)
    async def history(body: HistoryQuery, service: ServiceDependency):
        return await read_history(service, body)

    @router.post("/api/history/item", response_model=ToolDetailResponse)
    async def history_item(body: ToolDetailQuery, service: ServiceDependency):
        return await read_tool(service, body)

    @router.post("/api/respond")
    async def respond(body: ReplyBody, service: ServiceDependency):
        await service.reply(body.id, body.result, body.error)
        return {"ok": True}

    @router.get("/api/files")
    def image(path: str, request: Request):
        try:
            image = request.app.state.images.resolve(path)
        except ImageNotFound as exc:
            raise HTTPException(404, str(exc)) from exc
        except UnsupportedImage as exc:
            raise HTTPException(415, str(exc)) from exc
        return FileResponse(image.path, media_type=image.media_type, headers={
            "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        })

    @router.websocket("/ws")
    async def events(websocket: WebSocket, service: ServiceDependency):
        if not access.same_origin(websocket) or not access.authenticated(websocket):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        queue = service.subscribe()

        async def sender():
            for message in service.event_snapshot():
                await websocket.send_json(message)
            while True:
                message = await queue.get()
                await service.observe_event(message)
                await websocket.send_json(message)
                if message.get("method") == "webui/resyncRequired":
                    await websocket.close(code=1013)
                    return

        async def receiver():
            while True:
                await websocket.receive_text()

        tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            service.unsubscribe(queue)
            for task in tasks:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError, OSError):
                    await task

    return router
