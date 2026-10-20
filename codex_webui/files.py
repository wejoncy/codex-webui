"""Resolve workspace images and explicit conversation references; no HTTP/RPC."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .image_references import ImageReferences

IMAGE_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
    ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
}


class ImageNotFound(FileNotFoundError):
    pass


class UnsupportedImage(ValueError):
    pass


@dataclass(frozen=True)
class ImageFile:
    path: Path
    media_type: str


class WorkspaceImages:
    def __init__(self, workspace: Path, references: ImageReferences | None = None):
        self.workspace = workspace.resolve()
        self.references = references

    def resolve(self, path: str) -> ImageFile:
        try:
            requested = Path(path).expanduser()
            target = (requested if requested.is_absolute() else self.workspace / requested).resolve()
            permitted = target.is_relative_to(self.workspace) or (
                self.references is not None and self.references.allows(target)
            )
            valid = permitted and target.is_file()
        except (OSError, ValueError, RuntimeError):
            valid = False
        if not valid:
            raise ImageNotFound("图片不存在，或尚未由当前工作区或对话引用")
        media_type = IMAGE_TYPES.get(target.suffix.lower())
        if not media_type:
            raise UnsupportedImage("此接口只提供图片预览")
        return ImageFile(target, media_type)
