"""Keep folded tool bodies out of browser history responses."""

import asyncio

from pydantic import BaseModel, Field, StrictStr

from .errors import RpcError
from .service import CodexService

_DETAIL_TYPES = {
    "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall",
}
_HEADER_FIELDS = ("id", "type", "command", "status", "tool")


class HistoryQuery(BaseModel):
    threadId: StrictStr
    cursor: StrictStr | None = None
    limit: int = Field(default=40, ge=1, le=100)


class ToolDetailQuery(BaseModel):
    threadId: StrictStr
    turnId: StrictStr
    itemId: StrictStr


class HistoryTurn(BaseModel):
    id: StrictStr
    status: StrictStr
    items: list[dict]


class HistoryPage(BaseModel):
    turns: list[HistoryTurn]
    nextCursor: str | None


class ToolDetailResponse(BaseModel):
    item: dict


async def read_history(service: CodexService, query: HistoryQuery) -> dict:
    request = service.request("thread/items/list", {
        **query.model_dump(exclude_none=True),
        "sortDirection": "desc",
    })
    if query.cursor:
        result, metadata = await request, {}
    else:
        result, latest = await asyncio.gather(request, service.request(
            "thread/turns/list", {
                "threadId": query.threadId, "limit": 1,
                "itemsView": "notLoaded", "sortDirection": "desc",
            }))
        metadata = {turn["id"]: turn for turn in latest["data"]}
    turns = {}
    for entry in result["data"]:
        ident, item = entry["turnId"], entry["item"]
        if ident not in turns:
            turns[ident] = {
                "id": ident,
                "status": metadata.get(ident, {}).get("status", "completed"),
                "items": [],
            }
        if (item["type"] in _DETAIL_TYPES
                and item.get("status") != "inProgress"):
            item = {key: item[key] for key in _HEADER_FIELDS if key in item}
            item["detailAvailable"] = True
        turns[ident]["items"].insert(0, item)
    return {
        "turns": list(turns.values()), "nextCursor": result.get("nextCursor"),
    }


async def read_tool(service: CodexService, query: ToolDetailQuery) -> dict:
    params = {
        "threadId": query.threadId, "turnId": query.turnId,
        "limit": 1,
    }
    # Item anchors are exclusive. Find the following item, then page backwards
    # to retrieve exactly the requested item without scanning the whole turn.
    following = await service.request("thread/items/list", {
        **params, "sortDirection": "asc",
        "cursor": {"type": "item", "itemId": query.itemId},
    })
    if following["data"]:
        params["cursor"] = {
            "type": "item", "itemId": following["data"][0]["item"]["id"],
        }
    result = await service.request("thread/items/list", {
        **params, "sortDirection": "desc",
    })
    for entry in result["data"]:
        if entry["item"]["id"] == query.itemId:
            return {"item": entry["item"]}
    raise RpcError("未找到这条工具记录，请刷新后重试", -32602)
