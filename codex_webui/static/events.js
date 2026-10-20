export function createEventHandler({state, session, turns, editor, setThreadAccess, view}) {
  function onEvent(message) {
    const p = message.params || {}, method = message.method;
    if (method === 'thread/deleted') { view.removeThread(p.threadId); return; }
    if (state.sessions.get(p.threadId || p.thread?.id)?.deleted) return;
    if (method === 'webui/threadAccess') { setThreadAccess(p.threadId, p.readOnly); return; }
    if (message.id !== undefined) { state.approvals.set(JSON.stringify(message.id), message); view.renderApprovals(); view.updateRunning(); return; }
    if (method === 'webui/status') { view.updateStatus(p); return; }
    if (method === 'webui/resyncRequired') { view.notice('正在重新同步对话…'); return; }
    if (method === 'webui/requestResolved' || method === 'serverRequest/resolved') {
      state.approvals.delete(JSON.stringify(p.requestId)); view.renderApprovals(); view.updateRunning(); return;
    }
    if (method === 'thread/started') {
      session(p.thread.id).resumed = true;
      if (!state.threads.some(t => t.id === p.thread.id)) state.threads.unshift(p.thread);
      view.renderThreads(); return;
    }
    if (method === 'thread/name/updated') {
      const thread = state.threads.find(t => t.id === p.threadId);
      if (thread) { state.listing++; thread.name = p.threadName ?? p.name; }
      view.renderThreads(); return;
    }
    if (!p.threadId) return;
    const s = session(p.threadId);
    if (method === 'thread/reverted') {
      const pending = s.pendingReverts.find(operation => !operation.notified);
      if (pending) {
        pending.notified = true;
        turns.applyRevert(p.threadId, pending);
        if (pending.responded) s.pendingReverts = s.pendingReverts.filter(operation => operation !== pending);
      } else {
        // Another tab/client changed this thread. Invalidate both cache and in-flight reads.
        s.historyVersion++;
        for (const item of s.items.values()) if (item.turnId) s.removedTurns.add(item.turnId);
        s.items.clear(); s.hydrated = false; s.cursor = null; s.running = false; s.turnId = null;
        if (state.edit?.threadId === p.threadId) editor.cancelEdit();
        if (p.threadId === state.active) view.openThread(p.threadId, true).catch(view.report);
      }
      return;
    }
    if (s.removedTurns.has(p.turnId || p.turn?.id)) return;
    if (method === 'turn/started') {
      s.turnRevision = ++state.revision;
      s.turnId = p.turn.id; s.running = !s.finished.has(p.turn.id);
      if (p.threadId === state.active) view.updateRunning(); view.renderThreads();
    } else if (method === 'turn/completed') {
      s.turnRevision = ++state.revision;
      s.finished.add(p.turn.id); s.running = false; s.turnId = p.turn.id;
      if (p.threadId === state.active) {
        view.updateRunning();
        if (p.turn.error) view.notice(p.turn.error.message || '本次回复出错', true);
        else if (p.turn.status === 'interrupted') view.toast('已停止生成');
      }
      if (state.connected) view.loadThreads().catch(console.error);
    } else if (method === 'item/started' || method === 'item/completed') {
      turns.upsert(p.threadId, p.item, p.turnId);
    } else if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
      const item = s.items.get(p.itemId) || {id:p.itemId, type:method.includes('/plan/') ? 'plan' : 'agentMessage', text:''};
      turns.upsert(p.threadId, {...item, text:(item.text || '') + p.delta}, p.turnId, true);
    } else if (method === 'item/commandExecution/outputDelta') {
      const item = s.items.get(p.itemId); if (item) turns.upsert(p.threadId, {...item, aggregatedOutput:(item.aggregatedOutput || '') + p.delta}, p.turnId, true);
    } else if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      const item = s.items.get(p.itemId) || {id:p.itemId,type:'reasoning',summary:[],content:[]};
      const key = method.includes('summary') ? 'summary' : 'content';
      const index = p.summaryIndex ?? p.contentIndex ?? 0;
      const parts = [...(item[key] || [])]; parts[index] = (parts[index] || '') + p.delta;
      turns.upsert(p.threadId, {...item,[key]:parts}, p.turnId, true);
    } else if (method === 'error' && p.threadId === state.active) view.notice(p.error?.message || p.message || 'Codex 返回错误', true);
  }

  return onEvent;
}
