"""Conversation images grant exact local paths without opening neighboring files."""
import asyncio

import pytest

from codex_webui.config import Settings
from codex_webui.files import ImageNotFound, WorkspaceImages
from codex_webui.image_references import ImageReferences
from codex_webui.service import CodexService
from test_service import RecordingBridge


@pytest.mark.parametrize("method", sorted(ImageReferences.RESULT_METHODS))
def test_history_results_register_typed_images(tmp_path, method):
    paths = [tmp_path / f"{i}.png" for i in range(3)]
    items = [
        {"type": "imageView", "path": str(paths[0])},
        {"type": "imageGeneration", "savedPath": str(paths[1])},
        {"type": "userMessage", "content": [{"type": "localImage", "path": str(paths[2])}]},
    ]
    turns = [{"items": items}]
    result = {"thread": {"turns": turns}, "turn": turns[0]}
    result["data"] = items if method == "thread/items/list" else turns
    references = ImageReferences()
    references.observe_result(method, result)
    assert all(references.allows(path) for path in paths)


def test_only_exact_observed_images_escape_workspace(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    image = tmp_path / "view.png"
    image.write_bytes(b"image fixture")
    neighbor = tmp_path / "neighbor.png"
    neighbor.write_bytes(b"not referenced")
    references = ImageReferences()
    images = WorkspaceImages(workspace, references)
    with pytest.raises(ImageNotFound):
        images.resolve(str(image))
    references.observe_event({"method": "item/completed", "params": {
        "item": {"type": "imageView", "path": str(image)},
    }})
    assert images.resolve(str(image)).path == image
    for path in [str(neighbor), "../neighbor.png"]:
        with pytest.raises(ImageNotFound):
            images.resolve(path)
    link = workspace / "link.png"
    link.symlink_to(neighbor)
    with pytest.raises(ImageNotFound):
        images.resolve(str(link))
    # Replacing an observed symlink cannot redirect a grant to another file.
    external_link = tmp_path / "external.png"
    external_link.symlink_to(image)
    references.observe_event({"method": "item/started", "params": {
        "item": {"type": "imageView", "path": str(external_link)},
    }})
    external_link.unlink()
    external_link.symlink_to(neighbor)
    with pytest.raises(ImageNotFound):
        images.resolve(str(external_link))


def test_relative_markdown_and_untyped_paths_never_grant_access(tmp_path):
    references = ImageReferences()
    path = tmp_path / "not-referenced.png"
    references.observe_result("thread/items/list", {"data": [
        {"type": "imageView", "path": "relative.png"},
        {"type": "agentMessage", "text": f"![image]({path})", "path": str(path)},
        {"type": "commandExecution", "path": str(path)},
    ]})
    assert not references.allows(path)
    assert not references._paths


def test_reference_cache_is_bounded_and_keeps_recently_used_paths(tmp_path):
    references = ImageReferences(capacity=2)
    paths = [tmp_path / f"{i}.png" for i in range(3)]
    for path in paths[:2]:
        references.observe_result("thread/items/list", {"data": [{"type": "imageView", "path": str(path)}]})
    assert references.allows(paths[0])
    references.observe_result("thread/items/list", {"data": [{"type": "imageView", "path": str(paths[2])}]})
    assert references.allows(paths[0]) and references.allows(paths[2])
    assert not references.allows(paths[1])


@pytest.mark.parametrize("transport", ["stdio", "websocket"])
def test_service_registers_local_history_and_live_images_only(tmp_path, transport):
    async def check():
        references = ImageReferences()
        bridge = RecordingBridge()
        bridge.connection_info = {"transport": transport}
        service = CodexService(Settings(workspace=tmp_path), bridge, references)
        history_image, live_image = tmp_path / "history.png", tmp_path / "live.png"
        await service.request("thread/items/list", {"data": [{"type": "imageView", "path": str(history_image)}]})
        await service.observe_event({"method": "item/completed", "params": {
            "item": {"type": "imageView", "path": str(live_image)},
        }})
        assert references.allows(history_image) == (transport == "stdio")
        assert references.allows(live_image) == (transport == "stdio")
    asyncio.run(check())


def test_text_deltas_do_not_schedule_filesystem_work(tmp_path, monkeypatch):
    async def check():
        bridge = RecordingBridge()
        bridge.connection_info = {"transport": "stdio"}
        service = CodexService(Settings(workspace=tmp_path), bridge, ImageReferences())
        def unexpected(*args, **kwargs):
            pytest.fail("Text deltas must not use the filesystem threadpool")
        monkeypatch.setattr("codex_webui.service.asyncio.to_thread", unexpected)
        await service.observe_event({"method": "item/agentMessage/delta", "params": {"delta": "hello"}})
    asyncio.run(check())
