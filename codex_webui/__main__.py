import argparse
import os
from copy import deepcopy
from pathlib import Path

import uvicorn
from uvicorn.config import LOGGING_CONFIG

from .app import create_app
from .config import Settings


def main():
    parser = argparse.ArgumentParser(description="Python Codex Web UI")
    parser.add_argument("--host", default=os.getenv("CODEX_WEBUI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("CODEX_WEBUI_PORT", "8172")))
    parser.add_argument(
        "--workspace", type=Path,
        help="Codex 工作目录；优先于 CODEX_WEBUI_WORKSPACE，默认创建随服务退出自动清理的临时目录",
    )
    parser.add_argument(
        "--log-file", type=Path,
        default=Path.home() / ".codex-webui" / "logs" / "server.log",
    )
    args = parser.parse_args()
    log_file = args.log_file.expanduser().resolve()
    log_file.parent.mkdir(parents=True, exist_ok=True)
    log_config = deepcopy(LOGGING_CONFIG)
    log_config["formatters"]["default"]["fmt"] = "%(asctime)s %(levelprefix)s %(name)s: %(message)s"
    log_config["loggers"]["codex_webui"] = {
        "handlers": ["default", "file"], "level": "INFO", "propagate": False,
    }
    log_config["formatters"]["file"] = {
        "format": "%(asctime)s %(levelname)s %(name)s: %(message)s",
    }
    log_config["handlers"]["file"] = {
        "class": "logging.handlers.RotatingFileHandler",
        "formatter": "file", "filename": str(log_file),
        "maxBytes": 5 * 1024 * 1024, "backupCount": 3, "encoding": "utf-8",
    }
    log_config["loggers"]["uvicorn"]["handlers"].append("file")
    uvicorn.run(create_app(Settings.from_env(workspace=args.workspace)), host=args.host, port=args.port,
                log_config=log_config, access_log=False)


if __name__ == "__main__":
    main()
