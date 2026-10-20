"""Protocol errors shared by the RPC client and the HTTP adapter."""
from __future__ import annotations

from typing import Any


class RpcError(Exception):
    def __init__(self, message: str, code: int = -32000, data: Any = None):
        super().__init__(message)
        self.code, self.data = code, data

    def as_dict(self) -> dict:
        return {"code": self.code, "message": str(self), "data": self.data}
