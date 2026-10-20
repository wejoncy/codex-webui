"""A content-versioned static bundle keeps HTML and module imports consistent."""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path


class StaticAssets:
    def __init__(self, root: Path):
        self.root = root
        digest = sha256()
        for path in sorted(root.rglob("*")):
            if path.is_file():
                digest.update(path.relative_to(root).as_posix().encode())
                digest.update(b"\0")
                digest.update(path.read_bytes())
        self.prefix = f"/assets/{digest.hexdigest()[:16]}"
        self.html = (root / "index.html").read_text(encoding="utf-8").replace(
            '"/static/', f'"{self.prefix}/',
        )
