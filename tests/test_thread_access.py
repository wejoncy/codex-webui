"""Exercise real OS locks with an independent writer, without running Codex."""
import asyncio
import subprocess
import sys
from uuid import uuid4

from codex_webui.config import Settings
from codex_webui.service import CodexService
from codex_webui.thread_access import writer_is_locked
from test_service import RecordingBridge


def test_external_writer_detected_on_first_open_and_released_without_resume(tmp_path):
    ident = str(uuid4())
    lock_dir = tmp_path / "thread-writer-locks"
    lock_dir.mkdir()
    lock = lock_dir / f"{ident}.lock"
    lock.write_bytes(b"0")
    code = """
import os, sys
with open(sys.argv[1], 'r+b') as file:
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    print('locked', flush=True)
    sys.stdin.readline()
"""
    writer = subprocess.Popen([sys.executable, "-u", "-c", code, str(lock)],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        assert writer.stdout.readline().strip() == "locked"
        assert writer_is_locked(str(tmp_path), ident) is True

        async def check():
            bridge = RecordingBridge()
            bridge.connection_info = {"transport": "stdio", "server": {"codexHome": str(tmp_path)}}
            service = CodexService(Settings(workspace=tmp_path), bridge)
            assert await service.refresh_access(ident) == {"threadId": ident, "readOnly": True}
            assert [method for method, _ in bridge.calls] == ["thread/loaded/list"]
            writer.communicate("release\n", timeout=5)
            assert lock.exists(), "a stale file must not imply a live writer"
            assert writer_is_locked(str(tmp_path), ident) is False
            assert await service.refresh_access(ident) == {"threadId": ident, "readOnly": False}
            assert all(method != "thread/resume" for method, _ in bridge.calls)

        asyncio.run(check())
    finally:
        if writer.poll() is None:
            writer.kill()
            writer.communicate(timeout=5)


def test_probe_does_not_create_locks_and_rejects_invalid_ids(tmp_path):
    ident = str(uuid4())
    assert writer_is_locked(None, ident) is None
    assert writer_is_locked(str(tmp_path), ident) is None
    assert writer_is_locked(str(tmp_path), "../anything") is None
    directory = tmp_path / "thread-writer-locks"
    directory.mkdir()
    assert writer_is_locked(str(tmp_path), ident) is False
    assert list(directory.iterdir()) == []
