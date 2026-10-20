import {createNotifications} from './notifications.js';
import {createSettingsView} from './settings-view.js';
import {createSidebarView,threadTitle} from './sidebar-view.js';
import {createLabView} from './lab-view.js';
import {createMediaView} from './media-view.js';
import {createComposerView} from './composer-view.js';
import {createMessageEditor} from './message-editor.js';
import {createMessageNavigation} from './message-navigation.js';
import {createHistory} from './history.js';
import {createTurnController} from './turn-controller.js';
import {createEventHandler} from './events.js';
import {createClient} from './client.js';
import {createApprovalView} from './approval-view.js';
import {createMessageView, itemDomId} from './message-view.js';
import {createSessionStore} from './session-store.js';
import {$, icon, icons} from './dom.js';
import {refreshRenderTheme} from './renderer.js';
import {sessionFromURL, setSessionURL} from './navigation.js';

const store = createSessionStore();
const session = (id = state.active) => store.session(id);
const state = {
  connected: false, connecting: false, view: 'chat', active: null, threads: [], cursor: null,
  sessions: store.sessions, approvals: new Map(), models: [], attachments: [],
  permissionMode: 'ask', allowNetwork: false, edit: null,
  searchTimer: null,
  epoch: 0, historyBusy: false, autoScroll: true, status: {}, listing: 0, revision: 0,
};
const {clearToast,toast,notice,report} = createNotifications();
const client = createClient({onUnauthorized: () => { if (!$('login-dialog').open) $('login-dialog').showModal(); }});
const api = client.api;
const rpc = (method, params = {}, executionSettings = {permissionMode:state.permissionMode, allowNetwork:state.allowNetwork}) => client.rpc(method, params, executionSettings);

function updateStatus(status) {
  state.status = status;
  state.connected = status.connected;
  const label = state.connecting ? '正在连接…' : status.connected ? 'Codex 已连接' : '尚未连接';
  $('connection-label').textContent = label;
  $('settings-status').textContent = label;
  for (const id of ['status-dot', 'settings-status-dot']) {
    $(id).classList.toggle('connected', status.connected);
    $(id).classList.toggle('connecting', state.connecting);
  }
  if (status.workspace) {
    $('settings-workspace').textContent = status.workspace;
  }
  $('transport-label').textContent = status.transport === 'websocket' ? '远程 WebSocket · JSON-RPC' : '本地 stdio · JSON-RPC';
  if (!status.connected) {
    state.approvals.clear();
    for (const s of state.sessions.values()) { s.running = false; s.resumed = false; }
    document.querySelectorAll('.approval-card').forEach(el => el.remove());
    updateRunning();
  }
}

async function connect(eventStream) {
  if (state.connecting) return;
  state.connecting = true;
  updateStatus(state.status);
  try {
    const [status] = await Promise.all([api('connect', {}), eventStream]);
    state.connecting = false;
    updateStatus(status);
    notice();
    await Promise.allSettled([
      loadThreads(), loadModels(), loadAccount(),
      state.active && openThread(state.active, true),
    ]);
    if (state.view === 'chat' && state.active) {
      const thread = state.threads.find(t => t.id === state.active);
      $('page-detail').textContent = threadTitle(thread || {});
    }
  } catch (error) {
    state.connecting = false;
    updateStatus({...state.status, connected: false});
    notice(`${error.message}。可以先打开「渲染实验室」体验公式与图片。`, true);
  }
}

function setView(view) {
  if (view !== 'chat') cancelEdit();
  clearToast();
  notice();
  state.view = view;
  $('lab').hidden = view !== 'lab';
  $('welcome').hidden = view === 'lab' || !!state.active;
  $('conversation').hidden = view === 'lab' || !state.active;
  $('composer-area').hidden = view === 'lab';
  $('message-navigation').hidden = view !== 'chat' || !state.active;
  $('lab-nav').classList.toggle('active', view === 'lab');
  $('page-title').textContent = view === 'lab' ? '渲染实验室' : '工作台';
  $('page-detail').textContent = view === 'lab' ? '公式、图片与代码的试验场' : state.active ? threadTitle(state.threads.find(t => t.id === state.active) || {}) : '新的可能，从这里开始';
  setSidebar(false);
  if (view === 'lab') { $('jump-bottom').hidden = true; $('scroll-area').scrollTop = 0; }
}
function newChat() {
  cancelEdit();
  state.epoch++;
  state.active = null;
  settingsView.selectSession(null);
  if (!turns.submitting) store.trimHistory(null);
  setSessionURL(null);
  clearMessages();
  $('thinking').hidden = true;
  $('more-history').hidden = true;
  $('prompt').value = '';
  $('prompt').style.height = '';
  clearAttachments();
  setView('chat');
  updateRunning();
  renderThreads();
  $('prompt').focus();
}
async function openThread(id, refresh = false) {
  if (state.sessions.get(id)?.deleted) { newChat(); return; }
  if (id !== state.active) cancelEdit();
  const epoch = ++state.epoch;
  state.active = id;
  settingsView.selectSession(id);
  setSessionURL(id);
  setView('chat');
  renderThreads();
  const s = session(id);
  if (!turns.submitting) store.trimHistory(id);
  // Keep all existing write guards closed until this opening's access check
  // completes, including cached history and navigation between sessions.
  s.readOnly = true;
  const historyVersion = s.historyVersion;
  clearMessages();
  for (const item of s.items.values()) mountItem(item);
  updateRunning();
  $('more-history').hidden = true;
  try {
    const access = await api('thread-access',{threadId:id,permissionMode:state.permissionMode,allowNetwork:state.allowNetwork});
    if (epoch !== state.epoch) return;
    setThreadAccess(id,access.readOnly);
    if (s.hydrated && !refresh) { renderSession(); scrollBottom(true); return; }
    if (!await hydrateSession(id) || epoch !== state.epoch) return;
    renderSession(); scrollBottom(true);
  } catch (e) { if (epoch === state.epoch && historyVersion === s.historyVersion) notice(`无法加载对话：${e.message}`, true); }
}

function renderSession() {
  clearMessages();
  for (const item of session().items.values()) mountItem(item);
  if (state.edit?.threadId === state.active && !session().items.has(state.edit.itemId)) mountItem(state.edit.item);
  renderApprovals();
  $('more-history').hidden = !session().cursor;
  updateRunning();
}

function updateRunning() {
  const readOnly = !!state.active && session().readOnly;
  $('composer').classList.toggle('read-only', readOnly);
  $('prompt').disabled = readOnly;
  $('send-button').disabled = turns.submitting || readOnly || !!state.edit;
  $('stop-button').disabled = readOnly;
  $('attach-button').disabled = readOnly;
  const running = state.active && session().running;
  $('send-button').hidden = !!running;
  $('stop-button').hidden = !running;
  $('thinking').hidden = !running;
  $('thinking-label').textContent = state.active && [...state.approvals.values()].some(r => r.params?.threadId === state.active) ? '等待你的回复' : 'Codex 正在处理';
  document.querySelectorAll('.message-edit').forEach(button => { button.disabled = turns.submitting || !!running || readOnly; });
  editor.sync();
  messageNavigation.refresh();
}
function scrollBottom(force = false) {
  if (state.view !== 'chat') return;
  if (force) state.autoScroll = true;
  if (!state.autoScroll) return;
  const epoch = state.epoch;
  requestAnimationFrame(() => {
    if (epoch === state.epoch && state.view === 'chat' && state.autoScroll)
      $('scroll-area').scrollTop = $('scroll-area').scrollHeight;
  });
}

function setThreadAccess(id, readOnly) {
  const s = session(id);
  if (s.deleted) return;
  s.readOnly = !!readOnly;
  if (readOnly) s.resumed = false;
  if (id === state.active) { renderApprovals(); updateRunning(); }
  renderThreads();
}

function removeThread(id) {
  if (!id || !store.remove(id)) return;
  settingsView.forgetSession(id);
  state.listing++;
  state.threads = state.threads.filter(thread => thread.id !== id);
  for (const [key, request] of state.approvals) if (request.params?.threadId === id) state.approvals.delete(key);
  if (state.active === id) newChat();
  else { renderThreads(); renderApprovals(); }
}
async function deleteThread(id) {
  const s = session(id);
  if (s.deleted || s.readOnly || s.running || turns.submitting) return;
  await rpc('thread/delete', {threadId:id});
  removeThread(id);
}
const settingsView = createSettingsView({state,rpc});
const {loadModels,loadAccount} = settingsView;
const {setSidebar,loadThreads,renderThreads} = createSidebarView({state,rpc,onOpen:id => openThread(id),onNewChat:() => newChat(),
  onDelete:deleteThread,canDelete:() => !turns.submitting,report});
const {showExample} = createLabView({setView});
const {copyText} = createMediaView({toast});

const composer = createComposerView({state,session,showChat:() => setView('chat'),toast});
const {clearAttachments,addImages} = composer;
const editor = createMessageEditor({state,session,isSubmitting:() => turns.submitting,
  onSubmit:() => turns.sendEdit(),
  onChange:id => {
    let element = document.getElementById(itemDomId(id));
    const item = session().items.get(id) || (state.edit?.itemId === id ? state.edit.item : null);
    if (item) {
      if (element) updateItemElement(element,item); else element = mountItem(item);
    } else removeMessage(id);
    updateRunning();
    return element;
  },
});
const {cancelEdit} = editor;
const historyController = createHistory({state,session,api,view:{
  report,setHistoryBusy:busy => {$('more-history').disabled=busy;},
  prependHistory:(items,cursor) => {
    const area=$('scroll-area'),anchor=$('messages').firstElementChild,top=anchor?.getBoundingClientRect().top;
    for (const item of items.reverse()) if (!document.getElementById(itemDomId(item.id))) mountItem(item,true);
    if (anchor) area.scrollTop += anchor.getBoundingClientRect().top-top;
    $('more-history').hidden = !cursor;
  },
}});
const {hydrateSession,loadHistory} = historyController;
const messageNavigation = createMessageNavigation({
  root:$('scroll-area'), messages:$('messages'), button:$('previous-question'),
  context:() => state.view === 'chat' && state.active ? {
    key:`${state.epoch}:${session().historyVersion}`, cursor:session().cursor, loading:state.historyBusy,
  } : null,
  loadOlder:loadHistory, pauseFollowing:() => { state.autoScroll = false; }, report,
});
const turns = createTurnController({state,session,rpc,connect,history:historyController,composer,editor,setThreadAccess,view:{
  updateRunning,renderSession,renderThreads,scrollBottom,notice,
  rememberModel:settingsView.rememberModel,
  activateThread:id => {state.active=id;settingsView.selectSession(id);setSessionURL(id);setView('chat');renderThreads();},
  removeItem:id => removeMessage(id),
  upsertItem:(item,streaming) => {
    if (item.clientId) removeMessage(`local-${item.clientId}`);
    const element=document.getElementById(itemDomId(item.id));
    if (element) updateItemElement(element,item,streaming); else mountItem(item);
  },
}});
const {send} = turns;
const onEvent = createEventHandler({state,session,turns,editor,setThreadAccess,view:{
  renderApprovals:() => renderApprovals(),updateRunning,updateStatus,notice,toast,renderThreads,openThread,loadThreads,removeThread,report,
}});
icons();
const {mountItem, updateItemElement, clearMessages, removeMessage}
  = createMessageView({
  session, isSubmitting: () => turns.submitting, editor, copyText,
  loadItem:historyController.loadItem,
  onLayout:offset => {
    if (state.view !== 'chat') return;
    if (state.autoScroll) scrollBottom();
    else if (offset) $('scroll-area').scrollTop += offset;
  },
});
const {renderApprovals} = createApprovalView({
  requests:state.approvals, active:() => state.active, isReadOnly:() => !!state.active && session().readOnly,
  respond:body => api('respond',body), updateRunning, scrollBottom, report, toast,
});
const socketHandlers = {
  onEvent:message => onEvent(message),
  onReconnect:async () => { if (state.connected && state.active) { notice(); await openThread(state.active,true); } },
  onDisconnect:() => { if (state.connected) notice('实时连接已断开，正在重连。恢复后会重新读取当前对话。'); },
  onError:report,
};

function setTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem('codex-webui-theme',theme); $('theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun':'moon'); $('theme-toggle').setAttribute('aria-label',theme === 'dark' ? '切换浅色主题':'切换深色主题'); refreshRenderTheme(document); }
setTheme(localStorage.getItem('codex-webui-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light'));
$('theme-toggle').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light':'dark');
$('new-chat').onclick = newChat;
$('notice-close').onclick = () => notice();
$('toast-close').onclick = clearToast;
$('connect-button').onclick = () => state.connected ? $('settings-dialog').showModal() : connect();
$('reconnect').onclick = () => connect();
$('settings-nav').onclick = () => { $('settings-dialog').showModal(); setSidebar(false); };
$('send-button').onclick = send;
$('stop-button').onclick = async () => { const s = session(); if (!s.turnId || s.readOnly) return; try { await rpc('turn/interrupt',{threadId:state.active,turnId:s.turnId}); } catch (e) { report(e); } };
document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => { if (state.active && session().readOnly) return; $('prompt').value = b.dataset.prompt; $('prompt').focus(); });
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$('prompt').addEventListener('input', () => { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min($('prompt').scrollHeight,180)}px`; });
$('prompt').addEventListener('paste', e => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addImages(files).catch(report); } });
$('attach-button').onclick = () => $('image-input').click();
$('image-suggestion').onclick = () => $('image-input').click();
$('image-input').onchange = e => { addImages([...e.target.files]).catch(report); e.target.value = ''; };
$('composer').addEventListener('dragover', e => { e.preventDefault(); $('composer').classList.add('drag-over'); });
$('composer').addEventListener('dragleave', () => $('composer').classList.remove('drag-over'));
$('composer').addEventListener('drop', e => { e.preventDefault(); $('composer').classList.remove('drag-over'); addImages([...e.dataTransfer.files]).catch(report); });
$('more-history').onclick = loadHistory;
$('scroll-area').addEventListener('scroll', () => {
  const area = $('scroll-area'); state.autoScroll = area.scrollHeight-area.scrollTop-area.clientHeight < 110;
  $('jump-bottom').hidden = state.view !== 'chat' || !state.active || state.autoScroll;
  messageNavigation.refresh();
}, {passive:true});
$('jump-bottom').onclick = () => scrollBottom(true);
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); } });
$('login-dialog').addEventListener('cancel', e => e.preventDefault());
$('login-form').onsubmit = async e => {
  e.preventDefault();
  try { await api('login',{token:$('login-token').value}); $('login-token').value = ''; $('login-error').textContent = ''; $('login-dialog').close(); client.openSocket(socketHandlers); await connect(); }
  catch (e) { $('login-error').textContent = e.message; }
};
$('logout-button').onclick = async () => { await api('logout',{}); location.reload(); };
window.addEventListener('popstate', () => {
  const id = sessionFromURL();
  if (id) openThread(id).catch(report);
  else newChat();
});

async function bootstrap() {
  state.active = sessionFromURL();
  if (state.active) { session().readOnly = true; setView('chat'); updateRunning(); }
  if (new URLSearchParams(location.search).has('demo')) showExample('math');
  try {
    const health = await api('health'); $('logout-button').hidden = !health.authRequired;
    client.openSocket(socketHandlers);
    const eventStream = new Promise(resolve => {
      if (client.socket.readyState === WebSocket.OPEN) resolve();
      else {
        client.socket.addEventListener('open', resolve, {once:true});
        setTimeout(resolve, 2000);
      }
    });
    // Connect Codex in parallel; wait for events before opening a thread.
    await connect(eventStream);
  } catch (error) { if (!$('login-dialog').open) notice(error.message,true); }
}
bootstrap();
