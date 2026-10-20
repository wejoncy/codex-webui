import sys
import os
import asyncio
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codex_webui.app import create_app
from codex_webui.config import Settings

PEER = str(Path(__file__).with_name("fake_app_server.py"))


def client_options():
    # Restricted CI sandboxes may suppress asyncio's cross-thread socket wakeup.
    # A test-only timer lets TestClient's portal make progress in that environment.
    if not os.getenv("CODEX_TEST_POLL_LOOP"):
        return {}
    def factory():
        loop = asyncio.new_event_loop()
        def tick():
            loop.call_later(.01, tick)
        tick()
        return loop
    return {"backend_options": {"loop_factory": factory}}


@pytest.fixture
def client(tmp_path):
    (tmp_path / "test.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    (tmp_path / "secret.txt").write_text("not an image")
    app = create_app(Settings(workspace=tmp_path, command=(sys.executable, "-u", PEER)))
    with TestClient(app, **client_options()) as client:
        yield client


def test_temporary_workspace_lives_until_codex_stops_and_is_fresh_on_restart():
    app = create_app(Settings(command=(sys.executable, "-u", PEER)))
    workspaces = []
    for _ in range(2):
        with TestClient(app, **client_options()) as client:
            workspace = app.state.settings.workspace
            workspaces.append(workspace)
            assert workspace.is_dir()
            assert client.post("/api/connect").json()["workspace"] == str(workspace)
            thread = client.post("/api/rpc", json={"method": "thread/start"}).json()["result"]["thread"]
            assert thread["cwd"] == str(workspace)
            (workspace / "generated").mkdir()
            (workspace / "generated" / "image.svg").write_text('<svg/>')
            assert client.get("/api/files", params={"path": "generated/image.svg"}).status_code == 200
            bridge = app.state.bridge
            original_close = bridge.close

            async def close():
                assert workspace.is_dir(), "the workspace must outlive the Codex process"
                await original_close()
                assert workspace.is_dir()

            bridge.close = close
        assert bridge.transport.process is None
        assert not workspace.exists()
    assert workspaces[0] != workspaces[1]


def test_temporary_workspace_is_cleaned_even_when_shutdown_raises():
    app = create_app(Settings())
    with pytest.raises(RuntimeError, match="shutdown fixture"):
        with TestClient(app, **client_options()):
            workspace = app.state.settings.workspace

            async def close():
                raise RuntimeError("shutdown fixture")

            app.state.bridge.close = close
    assert not workspace.exists()


def test_explicit_workspace_is_never_deleted(tmp_path):
    marker = tmp_path / "keep.txt"
    marker.write_text("user data")
    app = create_app(Settings(workspace=tmp_path))
    with TestClient(app, **client_options()):
        assert app.state.settings.workspace == tmp_path
    assert marker.read_text() == "user data"


def test_static_assets_and_headers(client):
    response = client.get("/")
    assert response.status_code == 200
    assert 'lang="zh-CN"' in response.text
    assert "worker-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"
    prefix = re.search(r'src="(/assets/[^/]+)/bootstrap.js"', response.text).group(1)
    for path in ["bootstrap.js", "app.js", "message-editor.js", "composer-view.js", "render-worker.js",
                 "vendor/markdown-it.min.js", "vendor/katex/katex.min.js"]:
        assert client.get(f"{prefix}/{path}").status_code == 200, path
    for path in ["app.js", "renderer.js", "render-worker.js", "style.css", "vendor/markdown-it.min.js", "vendor/katex/katex.min.js", "vendor/katex/katex.min.css", "vendor/purify.min.js", "vendor/mathjax/tex-svg-full.js", "landscape.svg", "plot.svg"]:
        assert client.get(f"/static/{path}").status_code == 200, path
    assert client.get("/api/status").headers["cache-control"] == "no-store"
    assert client.get("/static/app.js").headers["cache-control"] == "no-cache"


def test_browser_startup_failures_reach_standard_logging(client, caplog):
    response = client.post("/api/client-error", json={
        "message": "Cannot set properties of null", "source": "app.js:42",
    })
    assert response.status_code == 204
    assert "Cannot set properties of null" in caplog.text
    assert "app.js:42" in caplog.text
    assert client.post("/api/client-error", json={"message": "x" * 2001}).status_code == 422


def test_invalid_permission_mode_and_network_option_are_rejected(client):
    for options in [{"permissionMode": "unknown"}, {"allowNetwork": "false"}]:
        response = client.post("/api/rpc", json={"method": "thread/start", "params": {}, **options})
        assert response.status_code == 422
    assert not client.app.state.bridge.ready


def test_streamed_turn_and_workspace_boundary(client):
    assert client.post("/api/connect").json()["connected"]
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["method"] == "webui/status"
        response = client.post("/api/rpc", json={"method": "thread/start", "params": {"cwd": str(client.app.state.settings.workspace.parent)}})
        thread = response.json()["result"]["thread"]
        assert thread["cwd"] == str(client.app.state.settings.workspace)
        assert ws.receive_json()["method"] == "thread/started"
        response = client.post("/api/rpc", json={"method": "turn/start", "params": {"threadId": thread["id"], "input": [{"type": "text", "text": "你好"}]}})
        assert response.status_code == 200
        messages = []
        while True:
            event = ws.receive_json()
            messages.append(event)
            if event["method"] == "turn/completed":
                break
        deltas = [e["params"]["delta"] for e in messages if e["method"] == "item/agentMessage/delta"]
        assert "E=mc^2" in "".join(deltas)
        final = next(e for e in messages if e["method"] == "item/completed" and e["params"]["item"]["type"] == "agentMessage")
        assert final["params"]["item"]["text"] == "".join(deltas)
    assert client.post("/api/rpc", json={"method": "process/spawn", "params": {}}).status_code == 400


def test_image_path_traversal_and_symlink_boundary(client, tmp_path):
    response = client.get("/api/files", params={"path": "test.svg"})
    assert response.status_code == 200
    assert "sandbox" in response.headers["content-security-policy"]
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert client.get("/api/files", params={"path": "secret.txt"}).status_code == 415
    outside = tmp_path.parent / "outside.svg"
    outside.write_text('<svg/>')
    assert client.get("/api/files", params={"path": str(outside)}).status_code == 404
    (tmp_path / "symlink.svg").symlink_to(outside)
    assert client.get("/api/files", params={"path": "symlink.svg"}).status_code == 404
    assert client.get("/api/files", params={"path": "../outside.svg"}).status_code == 404


def test_referenced_external_images_load_before_history_or_events_are_delivered(client, tmp_path, monkeypatch):
    external = tmp_path.parent / f"{tmp_path.name}-conversation.svg"
    external.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    assert client.get("/api/files", params={"path": str(external)}).status_code == 404
    thread = client.post("/api/rpc", json={"method": "thread/start"}).json()["result"]["thread"]["id"]
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["method"] == "webui/status"
        # The deterministic peer echoes localImage as a typed user-message event.
        client.post("/api/rpc", json={"method": "turn/start", "params": {
            "threadId": thread, "input": [{"type": "localImage", "path": str(external)}],
        }})
        while True:
            message = ws.receive_json()
            if message["method"] == "item/completed" and message["params"]["item"]["type"] == "userMessage":
                break
        assert client.get("/api/files", params={"path": str(external)}).status_code == 200
        while ws.receive_json()["method"] != "turn/completed":
            pass
    # A previously unseen history image must be available as soon as RPC returns.
    history_image = external.with_name(f"{tmp_path.name}-history.svg")
    history_image.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    assert client.get("/api/files", params={"path": str(history_image)}).status_code == 404
    async def history_result(method, params):
        assert method == "thread/turns/list"
        return {"data": [{"items": [{"type": "imageView", "path": str(history_image)}]}]}
    monkeypatch.setattr(client.app.state.bridge, "request", history_result)
    response = client.post("/api/rpc", json={"method": "thread/turns/list", "params": {"threadId": thread}})
    assert response.status_code == 200
    assert client.get("/api/files", params={"path": str(history_image)}).status_code == 200


@pytest.mark.parametrize("edited_index", [0, 1])
def test_edit_truncates_original_thread_without_creating_sessions(client, edited_index):
    def rpc(method, **params):
        response = client.post("/api/rpc", json={"method": method, "params": params})
        assert response.status_code == 200, response.text
        return response.json()["result"]

    thread_id = rpc("thread/start")["thread"]["id"]
    assert rpc("thread/read", threadId=thread_id, includeTurns=False)["thread"]["historyMode"] == "paginated"
    turns = [rpc("turn/start", threadId=thread_id, input=[{"type": "text", "text": text}])["turn"]["id"]
             for text in ["first", "middle", "last"]]
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["method"] == "webui/status"
        result = rpc("thread/revert", threadId=thread_id, beforeTurnId=turns[edited_index])
        assert result["thread"]["id"] == thread_id
        assert result["thread"]["turns"] == []
        assert ws.receive_json() == {"method": "thread/reverted", "params": {"threadId": thread_id}}
    retained = rpc("thread/turns/list", threadId=thread_id)["data"]
    assert [turn["id"] for turn in retained] == turns[:edited_index]
    edited_input = [{"type": "text", "text": "edited"}, {"type": "image", "url": "data:image/png;base64,AA=="}]
    rpc("turn/start", threadId=thread_id, input=edited_input)
    history = rpc("thread/turns/list", threadId=thread_id)["data"]
    assert len(history) == edited_index + 1
    assert history[-1]["items"][0]["content"] == edited_input
    assert [t["id"] for t in rpc("thread/list")["data"]] == [thread_id]
    assert rpc("thread/read", threadId=thread_id, includeTurns=False)["thread"]["turns"] == []
    failed = client.post("/api/rpc", json={"method": "thread/revert", "params": {"threadId": thread_id, "beforeTurnId": "missing"}})
    assert failed.status_code == 502
    assert rpc("thread/turns/list", threadId=thread_id)["data"] == history


def test_auth_origin_and_websocket_auth(tmp_path):
    app = create_app(Settings(workspace=tmp_path, token="test-secret"))
    with TestClient(app, **client_options()) as client:
        assert client.get("/api/health").json()["authRequired"]
        assert client.get("/api/status").status_code == 401
        with pytest.raises(Exception):
            with client.websocket_connect("/ws") as ws:
                ws.receive_json()
        assert client.post("/api/login", json={"token": "bad"}).status_code == 401
        assert client.post("/api/login", json={"token": "test-secret"}, headers={"Origin": "https://evil.example"}).status_code == 403
        response = client.post("/api/login", json={"token": "test-secret"})
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "SameSite=strict" in response.headers["set-cookie"]
        assert client.get("/api/status").status_code == 200
        with client.websocket_connect("/ws") as ws:
            assert ws.receive_json()["method"] == "webui/status"
        assert client.post("/api/rpc", json={"method":"thread/start"}, headers={"Origin":"https://evil.example"}).status_code == 403
        assert client.post("/api/logout").status_code == 200
        assert client.get("/api/status").status_code == 401



def test_writer_conflict_survives_tabs_and_f5_recovers_when_released(tmp_path):
    lock = tmp_path / "writer.lock"
    app = create_app(Settings(workspace=tmp_path, command=(sys.executable, "-u", PEER, str(lock))))
    with TestClient(app, **client_options()) as client:
        assert client.post("/api/thread-access", json={"threadId": "unknown"}).json()["readOnly"] is False
        assert app.state.bridge.ready, "access checks initialize the transport without resuming a thread"
        assert client.post("/api/rpc", json={"method": "thread/start"}).status_code == 200
        lock.touch()
        conflict = client.post("/api/rpc", json={"method": "thread/resume", "params": {"threadId": "fixture-thread"}})
        assert conflict.status_code == 502
        assert conflict.json()["error"]["data"] == {"threadId": "fixture-thread", "readOnly": True}
        with client.websocket_connect("/ws") as ws:
            assert ws.receive_json()["method"] == "webui/status"
            assert ws.receive_json() == {"method": "webui/threadAccess", "params": {"threadId": "fixture-thread", "readOnly": True}}
            assert client.post("/api/rpc", json={"method": "thread/read", "params": {"threadId": "fixture-thread"}}).status_code == 200
            assert client.post("/api/rpc", json={"method": "turn/start", "params": {"threadId": "fixture-thread", "input": []}}).status_code == 502
            assert client.post("/api/thread-access", json={"threadId": "fixture-thread"}).json()["readOnly"] is True
            lock.unlink()
            access = client.post("/api/thread-access", json={"threadId": "fixture-thread", "permissionMode": "workspace-auto", "allowNetwork": True})
            assert access.json() == {"threadId": "fixture-thread", "readOnly": False}
            assert ws.receive_json() == {"method": "webui/threadAccess", "params": access.json()}
        assert client.post("/api/rpc", json={"method": "turn/start", "params": {"threadId": "fixture-thread", "input": [{"type": "text", "text": "released"}]}}).status_code == 200
