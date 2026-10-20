"""Nonblocking checks of local Codex writer locks; never resumes a thread."""
from __future__ import annotations

import errno
import os
from pathlib import Path
from uuid import UUID


def writer_is_locked(codex_home: str | None, thread_id: str) -> bool | None:
    """Return None when the local lock protocol is unavailable or unreadable.

    A leftover file is not a live writer. Check the OS lock, release immediately
    when available, and never create, remove or write a lock file.
    """
    if not codex_home:
        return None
    try:
        ident = str(UUID(thread_id))
    except ValueError:
        return None
    path = Path(codex_home) / "thread-writer-locks" / f"{ident}.lock"
    try:
        if path.is_symlink():
            return None
        with path.open("rb") as file:
            if os.name == "nt":
                import msvcrt

                try:
                    msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
                except OSError as exc:
                    if exc.errno in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                        return True
                    raise
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                try:
                    fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return True
                fcntl.flock(file.fileno(), fcntl.LOCK_UN)
        return False
    except FileNotFoundError:
        return False if path.parent.is_dir() else None
    except OSError:
        return None
