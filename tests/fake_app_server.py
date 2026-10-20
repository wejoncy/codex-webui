"""A deterministic app-server peer; never invokes a model or accesses credentials."""
import json
import sys
import time
from pathlib import Path

writer_lock = Path(sys.argv[1]) if len(sys.argv) > 1 else None

initialized = False
handshake = False
threads = {}
latest_turn = "turn-1"


def send(message):
    print(json.dumps(message), flush=True)


def event(method, params):
    send({"method": method, "params": params})


for raw in sys.stdin:
    message = json.loads(raw)
    method, ident = message.get("method"), message.get("id")
    params = message.get("params", {})
    if method is None:
        event("fixture/response", message)
        continue
    if method == "initialize":
        handshake = True
        send({"id": ident, "result": {"userAgent": "fixture/1.0", "platformFamily": "unix"}})
        continue
    if method == "initialized":
        initialized = handshake
        continue
    if not initialized:
        send({"id": ident, "error": {"code": -32600, "message": "Not initialized"}})
        continue
    result = {}
    if method == "fixture/echo":
        result = params
    elif method == "fixture/error":
        send({"id": ident, "error": {"code": -32602, "message": "fixture failure", "data": {"field": "x"}}})
        continue
    elif method == "fixture/approval":
        for request_id in [7, "7"]:
            send({"id": request_id, "method": "item/commandExecution/requestApproval", "params": {"threadId": "fixture-thread", "turnId": "turn-1", "itemId": "cmd-1", "command": "python --version", "reason": "协议测试", "availableDecisions": ["accept", "decline", "cancel"]}})
    elif method == "fixture/exit":
        sys.exit(0)
    elif method == "fixture/stall":
        continue
    elif method == "thread/list":
        result = {"data": list(threads.values()), "nextCursor": None}
    elif method == "thread/start":
        thread = {"id": "fixture-thread", "name": None, "preview": "测试会话", "cwd": params.get("cwd"), "status": {"type": "idle"}, "turns": [], "historyMode": "paginated"}
        threads[thread["id"]] = thread
        event("thread/started", {"thread": thread})
        result = {"thread": thread, "cwd": params.get("cwd")}
    elif method == "thread/resume":
        if writer_lock and writer_lock.exists():
            send({"id": ident, "error": {"code": -32000, "message": f"thread {params['threadId']} already has an active writer"}})
            continue
        result = {"thread": threads.get(params["threadId"], {"id": params["threadId"], "turns": []}), "cwd": params.get("cwd")}
    elif method == "thread/read":
        thread = threads[params["threadId"]]
        result = {"thread": {**thread, "turns": thread["turns"] if params.get("includeTurns") else []}}
    elif method == "thread/turns/list":
        turns = threads.get(params["threadId"], {}).get("turns", [])
        result = {"data": list(reversed(turns)) if params.get("sortDirection") == "desc" else turns, "nextCursor": None}
    elif method == "thread/revert":
        thread = threads[params["threadId"]]
        index = next((i for i, turn in enumerate(thread["turns"]) if turn["id"] == params["beforeTurnId"]), None)
        if index is None:
            send({"id": ident, "error": {"code": -32602, "message": "Turn not found"}})
            continue
        thread["turns"] = thread["turns"][:index]
        event("thread/reverted", {"threadId": thread["id"]})
        result = {"thread": {**thread, "turns": []}, "turnsBackwardsCursor": None, "itemsBackwardsCursor": None}
    elif method == "model/list":
        result = {"data": [{"id": "fixture-model", "model": "fixture-model", "displayName": "Fixture Model", "isDefault": True, "supportedReasoningEfforts": [{"reasoningEffort": "high", "description": "High"}]}]}
    elif method == "account/read":
        result = {"account": {"type": "apiKey"}, "requiresOpenaiAuth": False}
    elif method == "turn/start":
        thread_id = params["threadId"]
        latest_turn = f"turn-{time.monotonic_ns()}"
        turn = {"id": latest_turn, "items": [], "status": "inProgress"}
        event("turn/started", {"threadId": thread_id, "turn": turn.copy()})
        user = {"id": f"user-{latest_turn}", "clientId": params.get("clientUserMessageId"), "type": "userMessage", "content": params["input"]}
        event("item/completed", {"threadId": thread_id, "turnId": latest_turn, "item": user})
        item = {"id": f"agent-{latest_turn}", "type": "agentMessage", "text": ""}
        event("item/started", {"threadId": thread_id, "turnId": latest_turn, "item": item.copy()})
        for chunk in ["这是流式回复。\n\n", "公式 $E=mc^2$。\n\n", "$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n\n", "![图片](/static/plot.svg)\n"]:
            item["text"] += chunk
            event("item/agentMessage/delta", {"threadId": thread_id, "turnId": latest_turn, "itemId": item["id"], "delta": chunk})
        event("item/completed", {"threadId": thread_id, "turnId": latest_turn, "item": item})
        turn["status"], turn["items"] = "completed", [user, item]
        threads[thread_id]["turns"].append(turn)
        event("turn/completed", {"threadId": thread_id, "turn": turn})
        # Deliberately finish before the request response to catch UI ordering races.
        result = {"turn": {"id": latest_turn, "status": "inProgress", "items": []}}
    elif method == "turn/interrupt":
        event("turn/completed", {"threadId": params["threadId"], "turn": {"id": params["turnId"], "status": "interrupted", "items": []}})
    elif method == "thread/name/set":
        threads[params["threadId"]]["name"] = params["name"]
    elif method == "thread/archive":
        threads.pop(params["threadId"], None)
    else:
        send({"id": ident, "error": {"code": -32601, "message": "Method not found"}})
        continue
    send({"id": ident, "result": result})
