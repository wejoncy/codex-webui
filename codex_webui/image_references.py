"""Bounded references to local images reported by the app-server."""
from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
import re
from threading import Lock
from urllib.parse import unquote


class ImageReferences:
    RESULT_METHODS = frozenset({
        "thread/turns/list", "thread/items/list", "thread/read", "thread/start",
        "thread/resume", "thread/revert", "turn/start",
    })
    EVENT_METHODS = frozenset({
        "item/started", "item/completed", "turn/started", "turn/completed", "thread/started",
    })

    def __init__(self, capacity: int = 4096):
        if capacity < 1:
            raise ValueError("Image reference capacity must be positive")
        self.capacity = capacity
        self._paths: OrderedDict[Path, None] = OrderedDict()
        self._lock = Lock()

    def allows(self, path: Path) -> bool:
        with self._lock:
            if path not in self._paths:
                return False
            self._paths.move_to_end(path)
            return True

    def _add(self, path: object) -> None:
        if not isinstance(path, str) or not path:
            return
        try:
            # Relative paths use the workspace resolver; never use process cwd
            # to grant access to files referenced by another working directory.
            requested = Path(path).expanduser()
            if not requested.is_absolute():
                return
            resolved = requested.resolve()
        except (OSError, ValueError, RuntimeError):
            return
        with self._lock:
            self._paths[resolved] = None
            self._paths.move_to_end(resolved)
            while len(self._paths) > self.capacity:
                self._paths.popitem(last=False)

    def _items(self, items: list) -> None:
        for item in items:
            kind = item.get("type")
            if kind in {"imageView", "imageGeneration"}:
                self._add(item.get("savedPath") or item.get("path"))
            elif kind == "agentMessage":
                for path in re.findall(
                    r"\]\(<?(/[^)\n>]+)>?\)", item.get("text", ""),
                ):
                    self._add(unquote(path.split("?")[0].split("#")[0]))
            elif kind == "userMessage":
                for part in item.get("content", []):
                    if part.get("type") == "localImage":
                        self._add(part.get("path"))

    def _turns(self, turns: list) -> None:
        for turn in turns:
            self._items(turn.get("items", []))

    def observe_result(self, method: str, result: dict) -> None:
        if method == "thread/turns/list":
            self._turns(result.get("data", []))
        elif method == "thread/items/list":
            self._items([entry["item"] for entry in result.get("data", [])])
        elif method in {"thread/read", "thread/start", "thread/resume", "thread/revert"}:
            self._turns(result.get("thread", {}).get("turns", []))
        elif method == "turn/start":
            self._items(result.get("turn", {}).get("items", []))

    def observe_event(self, message: dict) -> None:
        method, params = message.get("method"), message.get("params", {})
        if method in {"item/started", "item/completed"}:
            self._items([params.get("item", {})])
        elif method in {"turn/started", "turn/completed"}:
            self._turns([params.get("turn", {})])
        elif method == "thread/started":
            self._turns(params.get("thread", {}).get("turns", []))
