"""Composition root: construct dependencies, register adapters, own lifespan."""
from __future__ import annotations

from contextlib import ExitStack, asynccontextmanager
from dataclasses import replace
import logging
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from .api import create_router
from .assets import StaticAssets
from .config import Settings
from .errors import RpcError
from .files import WorkspaceImages
from .image_references import ImageReferences
from .rpc import CodexBridge
from .security import AccessPolicy, install_security
from .service import CodexService

STATIC = Path(__file__).resolve().parent / "static"
log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()
    access = AccessPolicy(settings.token)
    assets = StaticAssets(STATIC)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        with ExitStack() as resources:
            runtime_settings = settings
            if settings.workspace is None:
                directory = resources.enter_context(TemporaryDirectory(prefix="codex-webui-workspace-"))
                runtime_settings = replace(settings, workspace=Path(directory))
            bridge = CodexBridge(runtime_settings)
            try:
                image_references = ImageReferences()
                app.state.settings = runtime_settings
                app.state.bridge = bridge
                app.state.service = CodexService(runtime_settings, bridge, image_references)
                app.state.images = WorkspaceImages(runtime_settings.workspace, image_references)
                log.info("Web UI started (temporary_workspace=%s)", settings.workspace is None)
                yield
            finally:
                await bridge.close()

    app = FastAPI(title="Codex Web UI", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=4)
    app.state.settings = settings
    install_security(app, access)
    app.include_router(create_router(access))

    @app.exception_handler(RpcError)
    async def rpc_error(request, exc: RpcError):
        return JSONResponse({"error": exc.as_dict()}, status_code=502)

    @app.get("/")
    async def index():
        return HTMLResponse(
            assets.index_html, headers={"Cache-Control": "no-store"},
        )

    app.mount(assets.prefix, assets, name="assets")
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app
