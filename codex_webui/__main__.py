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
    args = parser.parse_args()
    log_config = deepcopy(LOGGING_CONFIG)
    log_config["formatters"]["default"]["fmt"] = "%(asctime)s %(levelprefix)s %(name)s: %(message)s"
    log_config["formatters"]["access"]["fmt"] = (
        '%(asctime)s %(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s'
    )
    log_config["loggers"]["codex_webui"] = {
        "handlers": ["default"], "level": "INFO", "propagate": False,
    }
    uvicorn.run(create_app(Settings.from_env(workspace=args.workspace)), host=args.host, port=args.port,
                log_config=log_config)


if __name__ == "__main__":
    main()
