import {updateTurn} from './session-store.js';

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
    updateTurn(s, {
      id:[...retained.values()].at(-1)?.turnId, status:'completed',
    }, s.turnRevision);
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
    const hasInput = text || attachments.length || edit?.extraInput.length;
    if (submitting || !hasInput) return;
    if (state.active && session().readOnly) return;
    submitting = true; view.updateRunning();
    const executionSettings = {permissionMode: state.permissionMode, allowNetwork: state.allowNetwork};
    const epoch = state.epoch;
    let startRevision, cleared = false;
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
      if (edit && s.running) throw new Error('请等当前回复结束后再编辑');
      if (edit && !edit.reverted) {
        if (edit.threadId !== id || !s.items.has(edit.itemId)) throw new Error('对话历史已更新，请重新选择要编辑的消息');
        // Revert is turn-granular. Check canonical history, including items
        // outside the loaded page, before any destructive request.
        const first = await rpc('thread/items/list', {
          threadId:id, turnId:edit.turnId, sortDirection:'asc', limit:1,
        });
        if (first.data[0]?.item.id !== edit.itemId) {
          throw new Error(
            'Codex 只能按整轮回退，暂时无法单独编辑这一轮的追加消息。原对话已保留。',
          );
        }
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
      const expectedTurnId = s.running ? s.turnId : null;
      if (s.running && !expectedTurnId)
        throw new Error('正在同步当前回复，请稍后发送');
      if (!expectedTurnId) {
        updateTurn(s, {status:'inProgress'});
        startRevision = s.turnRevision;
        view.updateRunning();
      }
      const input = [...(text ? [{type:'text',text}] : []), ...attachments.map(a => a.input || {type:'image',url:a.url}), ...(edit?.extraInput || [])];
      upsert(id, {
        id:`local-${clientId}`, type:'userMessage', content:input,
      }, expectedTurnId);
      if (isCurrent()) {
        if (edit) editor.cancelEdit();
        else { composer.clearDraft(); cleared = true; }
        view.notice(); view.scrollBottom(true);
      }
      const params = {threadId:id, clientUserMessageId:clientId, input};
      const result = expectedTurnId
        ? await rpc('turn/steer', {...params, expectedTurnId})
        : await rpc('turn/start', {
          ...params, ...(model ? {model} : {}), ...(effort ? {effort} : {}),
        }, executionSettings);
      if (startRevision !== undefined)
        updateTurn(s, result.turn, startRevision);
      if (id === state.active) view.updateRunning();
    } catch (e) {
      if (id && (/already has an active writer/i.test(e.message || '') || e.data?.readOnly)) setThreadAccess(id,true);
      if (id) {
        if (startRevision !== undefined)
          updateTurn(session(id), null, startRevision);
        session(id).items.delete(`local-${clientId}`);
        if (id === state.active) view.removeItem(`local-${clientId}`);
      }
      view.updateRunning();
      if (isCurrent()) {
        if (edit) {
          if (!state.edit) editor.restoreEdit(edit);
        } else if (cleared) {
          const current = composer.readDraft();
          composer.setDraft(
            [rawText, current.text].filter(Boolean).join('\n\n'),
            [...attachments, ...current.attachments],
          );
        }
        view.notice(/already has an active writer/i.test(e.message || '')
          ? '该对话正由另一个 Codex 实例使用，已切换为只读。'
          : e.message, true);
      }
    } finally { submitting = false; view.updateRunning(); }
  }

  async function stop() {
    const id = state.active;
    if (!id) return;
    const s = session(id);
    if (!s.running || !s.turnId || s.readOnly) return;
    await rpc('turn/interrupt', {threadId:id, turnId:s.turnId});
  }

  return {
    stop,
    send:() => { if (!state.edit) return submit(); },
    sendEdit:() => { if (state.edit) return submit(state.edit); },
    upsert, applyRevert, get submitting() {return submitting;},
  };
}
