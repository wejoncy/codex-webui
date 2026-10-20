"""A content-versioned static bundle keeps HTML and module imports consistent."""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from starlette.staticfiles import StaticFiles


class StaticAssets(StaticFiles):
    def __init__(self, root: Path):
        super().__init__(directory=root)
        digest = sha256()
        for path in sorted(root.rglob("*")):
            if path.is_file():
                digest.update(path.relative_to(root).as_posix().encode())
                digest.update(b"\0")
                digest.update(path.read_bytes())
        self.prefix = f"/assets/{digest.hexdigest()[:16]}"
        self.index_html = (root / "index.html").read_text(encoding="utf-8").replace(
            '"/static/', f'"{self.prefix}/',
        )

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in {200, 304}:
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable"
            )
        return response
