"""Optional real-CLI check; uses synthetic history and never starts model inference.

Run from the source directory: PYTHONPATH=. python tests/check_real_writer.py
"""
import asyncio
import json
import os
import tempfile
import uuid
from pathlib import Path

from codex_webui.config import Settings
from codex_webui.errors import RpcError
from codex_webui.rpc import CodexBridge
from codex_webui.service import CodexService


def seed_history(home: Path, turns: int = 1) -> tuple[str, Path]:
    ident = str(uuid.uuid4())
    path = home / "sessions/2026/10/19" / f"rollout-2026-10-19T11-00-00-{ident}.jsonl"
    path.parent.mkdir(parents=True)
    records = [
        ("session_meta", {"id": ident, "timestamp": "2026-10-19T11:00:00Z", "cwd": str(home),
                          "originator": "codex_cli_rs", "cli_version": "0.163.0",
                          "source": "cli", "model_provider": "openai", "history_mode": "paginated"}),
        ("event_msg", {"type": "task_started", "turn_id": "fixture-turn"}),
        ("response_item", {"type": "message", "role": "user",
                           "content": [{"type": "input_text", "text": "fixture question"}]}),
        ("event_msg", {"type": "user_message", "message": "fixture question", "images": []}),
        ("response_item", {"type": "message", "role": "assistant", "phase": "final_answer",
                           "content": [{"type": "output_text", "text": "fixture answer $E=mc^2$"}]}),
        ("event_msg", {"type": "agent_message", "message": "fixture answer $E=mc^2$", "phase": "final_answer"}),
        ("event_msg", {"type": "task_complete", "turn_id": "fixture-turn"}),
    ]
    expanded = [records[0]]
    for _ in range(turns):
        turn_id = str(uuid.uuid4())
        for kind, data in records[1:]:
            data = dict(data)
            if "turn_id" in data:
                data["turn_id"] = turn_id
            if data.get("type") == "task_complete":
                for item in [
                    {"type": "UserMessage", "id": f"user-{turn_id}", "client_id": None,
                     "content": [{"type": "text", "text": "fixture question", "text_elements": []}]},
                    {"type": "AgentMessage", "id": f"agent-{turn_id}", "phase": "final_answer",
                     "content": [{"type": "Text", "text": "fixture answer $E=mc^2$"}]},
                ]:
                    expanded.append(("event_msg", {"type": "item_completed", "thread_id": ident,
                                                  "turn_id": turn_id, "item": item,
                                                  "started_at_ms": 0, "completed_at_ms": 1}))
            expanded.append((kind, data))
    path.write_text("".join(json.dumps({"timestamp": "2026-10-19T11:00:00Z", "ordinal": index,
                                       "type": kind, "payload": data}) + "\n"
                            for index, (kind, data) in enumerate(expanded)), encoding="utf-8")
    return ident, path


async def main():
    if os.getenv("CODEX_TEST_POLL_LOOP"):
        loop = asyncio.get_running_loop()
        def tick():
            loop.call_later(.05, tick)
        tick()
    previous_home = os.environ.get("CODEX_HOME")
    try:
        with tempfile.TemporaryDirectory(prefix="codex-writer-check-") as directory:
            home = Path(directory)
            os.environ["CODEX_HOME"] = directory
            ident, path = seed_history(home, turns=3)
            settings = Settings(workspace=home, rpc_timeout=10)
            owner, viewer = CodexBridge(settings), CodexBridge(settings)
            service = CodexService(settings, viewer)
            try:
                await owner.connect()
                await owner.request("thread/resume", {"threadId": ident, "path": str(path), "excludeTurns": True})
                try:
                    await service.request("thread/resume", {"threadId": ident, "excludeTurns": True})
                except RpcError as exc:
                    assert "already has an active writer" in str(exc), str(exc)
                else:
                    raise AssertionError("expected a competing writer to be rejected")
                result = await service.request("thread/read", {"threadId": ident, "includeTurns": False})
                assert result["thread"]["id"] == ident
                assert result["thread"]["historyMode"] == "paginated"
                history = await service.request("thread/turns/list", {
                    "threadId": ident, "limit": 12, "sortDirection": "asc", "itemsView": "full",
                })
                assert len(history["data"]) == 3
                assert any(item.get("text") == "fixture answer $E=mc^2$"
                           for turn in history["data"] for item in turn["items"])
                assert owner.ready and viewer.ready
                await owner.close()
                assert not (await service.refresh_access(ident))["readOnly"]
                await service.request("thread/resume", {"threadId": ident, "excludeTurns": True})
                reverted = await service.request("thread/revert", {
                    "threadId": ident, "beforeTurnId": history["data"][1]["id"],
                })
                assert reverted["thread"]["id"] == ident
                remaining = await service.request("thread/turns/list", {
                    "threadId": ident, "limit": 12, "sortDirection": "asc", "itemsView": "full",
                })
                assert [turn["id"] for turn in remaining["data"]] == [history["data"][0]["id"]]
                loaded = await viewer.request("thread/loaded/list", {"limit": 100})
                assert ident in loaded["data"], "the reverted thread must remain loaded for resending"
                await service.request("thread/revert", {
                    "threadId": ident, "beforeTurnId": remaining["data"][0]["id"],
                })
                assert not (await service.request("thread/turns/list", {
                    "threadId": ident, "limit": 12, "itemsView": "full",
                }))["data"], "editing the first message must remove the entire suffix"
            finally:
                await viewer.close()
                await owner.close()
            reopened = CodexBridge(settings)
            try:
                await reopened.connect()
                remaining = await reopened.request("thread/turns/list", {
                    "threadId": ident, "limit": 12, "itemsView": "full",
                })
                assert not remaining["data"], "truncation must survive app-server restart"
                listed = await reopened.request("thread/list", {"limit": 10})
                assert [thread["id"] for thread in listed["data"]] == [ident], "editing must never fork"
            finally:
                await reopened.close()
        print("Real Codex check passed: writer conflict, read-only history, release, same-session truncation and resend readiness")
    finally:
        if previous_home is None:
            os.environ.pop("CODEX_HOME", None)
        else:
            os.environ["CODEX_HOME"] = previous_home


if __name__ == "__main__":
    asyncio.run(main())
