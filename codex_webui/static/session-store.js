export function createSessionStore({cachedHistories = 3} = {}) {
  const sessions = new Map();
  const used = new WeakMap();
  let clock = 0;
  function session(id) {
    if (!sessions.has(id)) sessions.set(id, {
      items: new Map(), turnId: null, running: false, resumed: false, readOnly: false, cursor: null, hydrated: false,
      finished: new Set(), historyVersion: 0, removedTurns: new Set(), pendingReverts: [],
    });
    const value = sessions.get(id); used.set(value, ++clock);
    return value;
  }
  function trimHistory(active) {
    const idle = [...sessions].filter(([id, value]) => id !== active && !value.running && !value.pendingReverts.length && (value.hydrated || value.items.size));
    idle.sort((a,b) => (used.get(b[1]) || 0) - (used.get(a[1]) || 0));
    for (const [, value] of idle.slice(Math.max(0, cachedHistories - (active ? 1 : 0)))) {
      // Keep access/lifecycle metadata and stale-event guards, not old payloads.
      value.items.clear(); value.hydrated = false; value.cursor = null; value.historyVersion++;
    }
  }
  return {sessions, session, trimHistory};
}

export function mergeLatestItems(s, turns, revision) {
  const cached = new Map();
  for (const item of s.items.values()) {
    if (s.removedTurns.has(item.turnId)) continue;
    const key = item.turnId || item.id;
    if (!cached.has(key)) cached.set(key, new Map());
    cached.get(key).set(item.id, item);
  }
  const latest = new Map(turns.map(turn => [turn.id, new Map((turn.items || []).map(item => [item.id, {...item, turnId:turn.id}]))]));
  const older = new Map(), newer = new Map();
  const overlaps = [...cached.keys()].some(key => latest.has(key));
  let reachedLatest = false;
  for (const [key, items] of cached) {
    if (latest.has(key)) {
      reachedLatest = true;
      const target = latest.get(key);
      for (const [id, item] of items) if (!target.has(id) || item._revision > revision) target.set(id, item);
    } else {
      const afterSnapshot = [...items.values()].some(item => item._revision > revision);
      (reachedLatest || (!overlaps && afterSnapshot) ? newer : older).set(key, items);
    }
  }
  return new Map([...older.values(), ...latest.values(), ...newer.values()].flatMap(items => [...items]));
}
