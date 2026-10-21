"""Read bounded file previews within the workspace or explicit references."""
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

    def resolve_path(self, path: str) -> Path:
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
            raise ImageNotFound("文件不存在，或尚未由当前工作区或对话引用")
        return target

    def resolve(self, path: str) -> ImageFile:
        target = self.resolve_path(path)
        media_type = IMAGE_TYPES.get(target.suffix.lower())
        if not media_type:
            raise UnsupportedImage("此接口只提供图片预览")
        return ImageFile(target, media_type)

    def read_text(self, path: str) -> dict:
        target = self.resolve_path(path)
        limit = 128 * 1024
        try:
            with target.open(encoding="utf-8-sig") as stream:
                text = stream.read(limit + 1)
        except UnicodeError as exc:
            raise UnsupportedImage("此文件不支持文本预览") from exc
        except OSError as exc:
            raise ImageNotFound("无法读取此文件") from exc
        if "\0" in text:
            raise UnsupportedImage("此文件不支持文本预览")
        if self.references is not None:
            self.references.observe_text(text[:limit], parent=target.parent)
        return {
            "path": str(target), "text": text[:limit],
            "markdown": target.suffix.lower() in {".md", ".markdown", ".mdown"},
            "truncated": len(text) > limit,
        }
