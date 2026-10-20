"""Named execution presets mapped to Codex protocol fields, without HTTP state."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

PermissionMode = Literal["ask", "workspace-auto", "full-access"]


@dataclass(frozen=True)
class ExecutionPermission:
    approval: str
    sandbox: str
    sandbox_type: str

    def thread_params(self) -> dict:
        return {"approvalPolicy": self.approval, "sandbox": self.sandbox}

    def turn_params(self, workspace: Path, *, allow_network: bool = False) -> dict:
        policy: dict = {"type": self.sandbox_type}
        if self.sandbox == "workspace-write":
            policy.update(writableRoots=[str(workspace)], networkAccess=allow_network)
        return {"approvalPolicy": self.approval, "sandboxPolicy": policy}


PERMISSIONS: dict[PermissionMode, ExecutionPermission] = {
    "ask": ExecutionPermission("on-request", "workspace-write", "workspaceWrite"),
    "workspace-auto": ExecutionPermission("never", "workspace-write", "workspaceWrite"),
    "full-access": ExecutionPermission("never", "danger-full-access", "dangerFullAccess"),
}


def permission_for(mode: PermissionMode) -> ExecutionPermission:
    try:
        return PERMISSIONS[mode]
    except KeyError as exc:
        raise ValueError("不支持的权限模式") from exc
