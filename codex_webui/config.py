from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class Settings:
    workspace: Path | None = None
    codex_bin: str = "codex"
    server_url: str = ""
    server_token: str = ""
    token: str = ""
    rpc_timeout: float = 45.0
    max_message: int = 32 * 1024 * 1024
    # Explicit argv is useful for embedding and for protocol integration tests.
    command: tuple[str, ...] | None = None

    def __post_init__(self) -> None:
        if self.workspace is not None:
            object.__setattr__(self, "workspace", Path(self.workspace).expanduser().resolve())

    @classmethod
    def from_env(cls, *, workspace: str | Path | None = None) -> Settings:
        selected_workspace = workspace if workspace is not None else os.getenv("CODEX_WEBUI_WORKSPACE") or None
        return cls(
            workspace=Path(selected_workspace) if selected_workspace is not None else None,
            codex_bin=os.getenv("CODEX_BIN", "codex"),
            server_url=os.getenv("CODEX_APP_SERVER_URL", ""),
            server_token=os.getenv("CODEX_APP_SERVER_TOKEN", ""),
            token=os.getenv("CODEX_WEBUI_TOKEN", ""),
        )

    def validate(self) -> None:
        if self.workspace is not None and not self.workspace.is_dir():
            raise ValueError(f"工作目录不存在：{self.workspace}")
        if self.server_url and urlparse(self.server_url).scheme not in {"ws", "wss"}:
            raise ValueError("CODEX_APP_SERVER_URL 必须是 ws:// 或 wss:// 地址")
        if self.server_url and self.workspace is None:
            raise ValueError("远程 app-server 需要显式指定远端工作目录")
