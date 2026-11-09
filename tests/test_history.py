import asyncio
from copy import deepcopy

import pytest

from codex_webui.history import HistoryPage, HistoryQuery, ToolDetailQuery, read_history, read_tool


@pytest.mark.parametrize('cursor', [None, 'older-page'])
def test_history_preserves_recorded_item_times_without_mutating_source(cursor):
    result = {'data': [
        {'turnId': 'turn', 'startedAtMs': 2000, 'completedAtMs': 3000,
         'item': {'id': 'tool', 'type': 'commandExecution', 'status': 'completed',
                  'command': 'echo test', 'aggregatedOutput': 'large body'}},
        {'turnId': 'turn', 'startedAtMs': 1500, 'completedAtMs': 1900,
         'item': {'id': 'agent', 'type': 'agentMessage', 'text': 'progress',
                  'startedAtMs': 1600, 'completedAtMs': None}},
        {'turnId': 'turn', 'startedAtMs': 1000,
         'item': {'id': 'user', 'type': 'userMessage', 'content': []}},
        {'turnId': 'old', 'item': {'id': 'unknown', 'type': 'agentMessage', 'text': 'old'}},
    ], 'nextCursor': None}
    original = deepcopy(result)
    calls = []

    class Service:
        async def request(self, method, params):
            calls.append(method)
            if method == 'thread/items/list':
                return result
            assert method == 'thread/turns/list'
            return {'data': [{'id': 'turn', 'status': 'completed'}]}

    page = asyncio.run(read_history(Service(), HistoryQuery(threadId='thread', cursor=cursor)))
    page = HistoryPage.model_validate(page).model_dump()
    user, agent, tool = page['turns'][0]['items']
    assert user['startedAtMs'] == 1000
    assert agent['startedAtMs'] == 1600
    assert agent['completedAtMs'] == 1900
    assert tool['startedAtMs'] == 2000
    assert tool['completedAtMs'] == 3000
    assert tool['detailAvailable']
    assert 'aggregatedOutput' not in tool
    assert 'startedAtMs' not in page['turns'][1]['items'][0]
    assert result == original
    assert sorted(calls) == (['thread/items/list', 'thread/turns/list'] if cursor is None else ['thread/items/list'])


def test_expanding_tool_details_retains_entry_times_using_only_read_requests():
    entry = {'turnId': 'turn', 'startedAtMs': 2000, 'completedAtMs': 3000,
             'item': {'id': 'tool', 'type': 'commandExecution', 'aggregatedOutput': 'test'}}
    original = deepcopy(entry)
    calls = []

    class Service:
        async def request(self, method, params):
            assert method == 'thread/items/list'
            calls.append(params)
            return {'data': [] if params.get('sortDirection') == 'asc' else [entry]}

    response = asyncio.run(read_tool(Service(), ToolDetailQuery(threadId='thread', turnId='turn', itemId='tool')))
    assert response['item']['startedAtMs'] == 2000
    assert response['item']['completedAtMs'] == 3000
    assert response['item']['aggregatedOutput'] == 'test'
    assert entry == original
    assert len(calls) == 2
