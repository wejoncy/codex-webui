export function createTurnController({state, session, rpc, connect, history, composer, editor, view, setThreadAccess}) {
  const {hydrateSession} = history;
  function upsert(threadId, item, turnId, streaming = false) {
    const s = session(threadId);
    if (s.deleted || s.removedTurns.has(turnId)) return;
    const record = {...s.items.get(item.id), ...item, turnId, _revision:++state.revision};
    if (item.clientId) s.items.delete(`local-${item.clientId}`);
    s.items.set(item.id, record);
    if (threadId === state.active) {
      view.upsertItem(record,streaming);
      view.scrollBottom();
    }
  }
  function applyRevert(id, operation) {
    if (operation.applied) return;
    operation.applied = true;
    operation.edit.reverted = true;
    const s = session(id), retained = new Map();
    if (s.deleted) return;
    let remove = false;
    for (const [key, item] of s.items) {
      if (item.turnId === operation.edit.turnId) remove = true;
      if (remove) { if (item.turnId) s.removedTurns.add(item.turnId); }
      else retained.set(key, item);
    }
    s.items = retained; s.historyVersion++; s.hydrated = false; s.cursor = null;
    s.running = false; s.turnId = [...retained.values()].at(-1)?.turnId || null;
    s.turnRevision = ++state.revision;
    for (const [key, request] of state.approvals) {
      if (request.params?.threadId === id && s.removedTurns.has(request.params.turnId)) state.approvals.delete(key);
    }
    if (state.active === id) view.renderSession();
    view.renderThreads();
  }

  let submitting = false;
  async function submit(edit = null) {
    const draft = composer.readDraft();
    const {text:rawText,attachments} = edit || draft;
    const {model,effort} = draft;
    const text = rawText.trim();
    if (submitting || (!text && !attachments.length && !edit?.extraInput.length) || (state.active && (session().running || session().readOnly))) return;
    submitting = true; view.updateRunning();
    const executionSettings = {permissionMode: state.permissionMode, allowNetwork: state.allowNetwork};
    const epoch = state.epoch;
    let started = false;
    let id = state.active, clientId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const isCurrent = () => epoch === state.epoch && id === state.active && state.view === 'chat';
    try {
      if (!state.connected) { await connect(); if (!state.connected) return; }
      const newThread = !id;
      if (newThread) {
        const result = await rpc('thread/start', {...(model ? {model} : {})}, executionSettings);
        id = result.thread.id; session(id).resumed = true;
      }
      const s = session(id);
      if (s.deleted) throw new Error('此会话已删除');
      view.rememberModel(id,{model,effort});
      if (newThread && epoch === state.epoch) view.activateThread(id);
      if (!s.resumed) {
        await rpc('thread/resume', {threadId: id, excludeTurns: true}, executionSettings);
        s.resumed = true;
      }
      if (s.running) throw new Error('请等当前回复结束后再发送');
      if (edit && !edit.reverted) {
        if (edit.threadId !== id || !s.items.has(edit.itemId)) throw new Error('对话历史已更新，请重新选择要编辑的消息');
        const operation = {edit, applied:false, notified:false, responded:false};
        s.pendingReverts.push(operation);
        try {
          await rpc('thread/revert', {threadId:id, beforeTurnId:edit.turnId});
        } catch (error) {
          if (!operation.applied) s.pendingReverts = s.pendingReverts.filter(pending => pending !== operation);
          throw error;
        }
        operation.responded = true;
        applyRevert(id, operation);
        if (operation.notified) s.pendingReverts = s.pendingReverts.filter(pending => pending !== operation);
      }
      if (edit && !s.hydrated) {
        if (!await hydrateSession(id)) throw new Error('对话历史已更新，请重试');
        if (isCurrent()) view.renderSession();
      }
      started = true;
      s.running = true; s.turnId = null; s.turnRevision = ++state.revision; view.updateRunning();
      const input = [...(text ? [{type:'text',text}] : []), ...attachments.map(a => a.input || {type:'image',url:a.url}), ...(edit?.extraInput || [])];
      upsert(id, {id:`local-${clientId}`,type:'userMessage',content:input}, null);
      if (isCurrent()) {
        if (edit) editor.cancelEdit(); else composer.clearDraft();
        view.notice(); view.scrollBottom(true);
      }
      const result = await rpc('turn/start', {threadId:id,clientUserMessageId:clientId,input,...(model ? {model} : {}),...(effort ? {effort} : {})}, executionSettings);
      if (!s.deleted && !s.removedTurns.has(result.turn.id)) {
        s.turnId = result.turn.id; s.running = !s.finished.has(result.turn.id) && result.turn.status === 'inProgress';
      }
      if (id === state.active) view.updateRunning();
    } catch (e) {
      if (id && (/already has an active writer/i.test(e.message || '') || e.data?.readOnly)) setThreadAccess(id,true);
      if (id) {
        if (started) session(id).running = false;
        session(id).items.delete(`local-${clientId}`);
        if (id === state.active) view.removeItem(`local-${clientId}`);
      }
      view.updateRunning();
      if (isCurrent()) {
        if (edit) {
          if (!state.edit) editor.restoreEdit(edit);
        } else if (!composer.readDraft().text && !state.attachments.length) {
          composer.setDraft(text, attachments);
        }
        view.notice(/already has an active writer/i.test(e.message || '')
          ? '该对话正由另一个 Codex 实例使用，已切换为只读。'
          : e.message, true);
      }
    } finally { submitting = false; view.updateRunning(); }
  }

  return {
    send:() => { if (!state.edit) return submit(); },
    sendEdit:() => { if (state.edit) return submit(state.edit); },
    upsert, applyRevert, get submitting() {return submitting;},
  };
}
