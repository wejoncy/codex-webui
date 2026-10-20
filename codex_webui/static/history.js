import {mergeLatestItems} from './session-store.js';
export function createHistory({state, session, api, view}) {
  const itemLoads = new WeakMap();
  async function readPage(params) {
    const result = await api('history', params);
    const details = new Map(result.toolDetails.map(ref => [ref.itemId, ref]));
    for (const turn of result.turns) for (const item of turn.items || []) {
      if (details.has(item.id)) item._historyDetail = details.get(item.id);
    }
    return result;
  }
  function loadItem(item) {
    if (itemLoads.has(item)) return itemLoads.get(item);
    const id = state.active, s = session(id), version = s.historyVersion;
    const loading = api('history/item', {
      threadId:id, ...item._historyDetail,
    }).then(result => {
      if (version !== s.historyVersion || s.items.get(item.id) !== item)
        return null;
      const full = {...result.item, turnId:item.turnId};
      s.items.set(item.id, full);
      return full;
    }).finally(() => itemLoads.delete(item));
    itemLoads.set(item, loading);
    return loading;
  }
  async function hydrateSession(id) {
    const s = session(id), historyVersion = s.historyVersion;
    const revision = state.revision;
    const result = await readPage({threadId:id});
    if (historyVersion !== s.historyVersion) return false;
    s.cursor = result.nextCursor;
    const turns = [...result.turns].reverse();
    for (const turn of turns) s.removedTurns.delete(turn.id);
    if ((s.turnRevision || 0) <= revision) {
      const activeTurn = turns.find(turn => turn.status === 'inProgress' && !s.finished.has(turn.id));
      s.running = !!activeTurn;
      s.turnId = activeTurn?.id || turns.at(-1)?.id || null;
    }
    s.items = mergeLatestItems(s, turns, revision);
    s.hydrated = true;
    return true;
  }
  async function loadHistory() {
    if (state.historyBusy || !state.active) return;
    const id = state.active, s = session(id), epoch = state.epoch, historyVersion = s.historyVersion;
    if (!s.cursor) return;
    state.historyBusy = true; view.setHistoryBusy(true);
    try {
      const result = await readPage({threadId:id, cursor:s.cursor});
      if (historyVersion !== s.historyVersion) return;
      s.cursor = result.nextCursor;
      const older = new Map();
      for (const turn of [...result.turns].reverse()) {
        if (s.removedTurns.has(turn.id)) continue;
        for (const item of turn.items || [])
          older.set(item.id, {...item, turnId:turn.id});
      }
      s.items = new Map([...older, ...s.items]);
      if (epoch !== state.epoch) return;
      view.prependHistory([...older.values()],s.cursor);
    } catch (e) { if (epoch === state.epoch && historyVersion === s.historyVersion) view.report(e); }
    finally { state.historyBusy = false; view.setHistoryBusy(false); }
  }

  return {hydrateSession,loadHistory,loadItem};
}
