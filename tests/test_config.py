"""Workspace selection must survive relocation and paths containing spaces."""
import sys
from pathlib import Path

import pytest

from codex_webui import __main__
from codex_webui.config import Settings


def test_default_workspace_is_deferred_until_service_start(monkeypatch, tmp_path):
    monkeypatch.delenv("CODEX_WEBUI_WORKSPACE", raising=False)
    monkeypatch.chdir(tmp_path)
    assert Settings.from_env().workspace is None
    assert Settings().workspace is None


def test_relative_workspace_is_resolved_for_environment_and_embedding(monkeypatch, tmp_path):
    workspace = tmp_path / "项目 with spaces"
    workspace.mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CODEX_WEBUI_WORKSPACE", workspace.name)
    assert Settings.from_env().workspace == workspace.resolve()
    assert Settings(workspace=Path(workspace.name)).workspace == workspace.resolve()


def test_workspace_expands_home(monkeypatch, tmp_path):
    # Path.expanduser uses the platform's home-directory environment variables.
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    workspace = tmp_path / "项目 with spaces"
    workspace.mkdir()
    monkeypatch.setenv("CODEX_WEBUI_WORKSPACE", f"~/{workspace.name}")
    assert Settings.from_env().workspace == workspace.resolve()


def test_cli_workspace_overrides_environment_from_another_directory(monkeypatch, tmp_path):
    workspace = tmp_path / "项目 with spaces"
    workspace.mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CODEX_WEBUI_WORKSPACE", str(tmp_path / "missing"))
    monkeypatch.setenv("CODEX_WEBUI_TOKEN", "configured-secret")
    monkeypatch.setattr(sys, "argv", ["codex-webui", "--workspace", workspace.name, "--port", "0"])
    started = {}

    def run(app, **options):
        started.update(app=app, **options)

    monkeypatch.setattr(__main__.uvicorn, "run", run)
    __main__.main()
    assert started["app"].state.settings.workspace == workspace.resolve()
    assert started["app"].state.settings.token == "configured-secret"
    assert started["port"] == 0


def test_missing_workspace_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="工作目录不存在"):
        Settings.from_env(workspace=tmp_path / "missing").validate()


def test_remote_workspace_must_be_explicit():
    with pytest.raises(ValueError, match="远端工作目录"):
        Settings(server_url="wss://app-server.example/codex").validate()
