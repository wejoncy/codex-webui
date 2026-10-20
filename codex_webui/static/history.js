import {mergeLatestItems} from './session-store.js';
export function createHistory({state, session, rpc, view}) {
  async function hydrateSession(id) {
    const s = session(id), historyVersion = s.historyVersion;
    // Browsing history must not acquire a writer held by another Codex client.
    await rpc('thread/read', {threadId: id, includeTurns: false});
    if (historyVersion !== s.historyVersion) return false;
    const revision = state.revision;
    const result = await rpc('thread/turns/list', {threadId: id, limit: 12, sortDirection: 'desc', itemsView: 'full'});
    if (historyVersion !== s.historyVersion) return false;
    s.cursor = result.nextCursor;
    const turns = [...result.data].reverse();
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
      const result = await rpc('thread/turns/list', {threadId: id, cursor: s.cursor, limit: 12, sortDirection: 'desc', itemsView: 'full'});
      if (historyVersion !== s.historyVersion) return;
      s.cursor = result.nextCursor;
      const older = new Map();
      for (const turn of [...result.data].reverse()) if (!s.removedTurns.has(turn.id)) for (const item of turn.items || []) older.set(item.id, {...item, turnId: turn.id});
      s.items = new Map([...older, ...s.items]);
      if (epoch !== state.epoch) return;
      view.prependHistory([...older.values()],s.cursor);
    } catch (e) { if (epoch === state.epoch && historyVersion === s.historyVersion) view.report(e); }
    finally { state.historyBusy = false; view.setHistoryBusy(false); }
  }

  return {hydrateSession,loadHistory};
}
