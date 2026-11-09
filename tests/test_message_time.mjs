import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from './vendor/linkedom.mjs';

Object.defineProperty(globalThis, 'localStorage', {
  get() { throw Error('timestamps must not depend on browser storage'); },
});
const {renderMessageTime} = await import('../codex_webui/static/message-time.js');
const {createSessionStore} = await import('../codex_webui/static/session-store.js');
const {createTurnController} = await import('../codex_webui/static/turn-controller.js');
const {createEventHandler} = await import('../codex_webui/static/events.js');
const {createHistory} = await import('../codex_webui/static/history.js');
const store = createSessionStore();
const state = {active:'thread', sessions:store.sessions, revision:0, epoch:0};
const session = (id = state.active) => store.session(id);
const turns = createTurnController({state, session, history:{}, view:{upsertItem() {}, scrollBottom() {}}});
const onEvent = createEventHandler({state, session, turns, view:{}});
const realNow = Date.now;
let now = Date.parse('2026-11-09T12:34:56Z');
Date.now = () => now;
try {
  const sent = now;
  turns.upsert('thread', {id:'local-client', type:'userMessage', content:[{type:'text', text:'private question'}], _timestampMs:sent}, 'turn');
  now += 5000;
  onEvent({method:'item/completed', params:{threadId:'thread', turnId:'turn', completedAtMs:now,
    item:{id:'user', clientId:'client', type:'userMessage', startedAtMs:sent, content:[{type:'text', text:'private question'}]}}});
  assert.equal(session().items.has('local-client'), false);
  assert.equal(session().items.get('user').startedAtMs, sent, 'server acknowledgement carries the original send time');

  const started = now - 500;
  onEvent({method:'item/started', params:{threadId:'thread', turnId:'turn', startedAtMs:started,
    item:{id:'agent', type:'agentMessage', text:'', phase:'commentary'}}});
  for (const delta of ['first', ' second']) {
    now += 1000;
    onEvent({method:'item/agentMessage/delta', params:{threadId:'thread', turnId:'turn', itemId:'agent', delta}});
  }
  onEvent({method:'item/completed', params:{threadId:'thread', turnId:'turn', completedAtMs:now,
    item:{id:'agent', type:'agentMessage', text:'first second', startedAtMs:null, phase:'commentary'}}});
  assert.equal(session().items.get('agent').startedAtMs, started, 'completion keeps the item start time');
  assert.equal(session().items.get('agent').completedAtMs, now);

  session().items.clear();
  const snapshot = {turns:[{id:'turn', status:'completed', items:[
    {id:'user', type:'userMessage', content:[], startedAtMs:sent},
    {id:'agent', type:'agentMessage', phase:'commentary', text:'history', startedAtMs:started},
    {id:'unknown', type:'userMessage', content:[]},
  ]}], nextCursor:'older'};
  const original = structuredClone(snapshot);
  const history = createHistory({state, session, api:async (_method, query) => query.cursor
    ? {turns:[{id:'old-turn', status:'completed', items:[{id:'old', type:'userMessage', content:[], startedAtMs:sent - 86400000}]}], nextCursor:null}
    : snapshot, view:{setHistoryBusy() {}, prependHistory() {}}});
  await history.hydrateSession('thread');
  assert.equal(session().items.get('user').startedAtMs, sent, 'reload restores the recorded send time');
  assert.equal(session().items.get('agent').startedAtMs, started);
  assert.equal(session().items.get('unknown')._timestampMs, undefined, 'old history is never stamped with the reload time');
  assert.deepEqual(snapshot, original, 'history payloads are not mutated');
  await history.loadHistory();
  assert.equal(session().items.get('old').startedAtMs, sent - 86400000, 'older history pages retain authoritative times');

  const {window, document} = parseHTML(fs.readFileSync(new URL('../codex_webui/static/index.html', import.meta.url), 'utf8'));
  Object.assign(globalThis, {window, document, Worker:class {postMessage() {}}});
  const {createMessageView} = await import('../codex_webui/static/message-view.js');
  const view = createMessageView({session, isSubmitting:() => false,
    editor:{isEditing:() => false, render:() => false}, copyText() {}, onLayout() {}});
  const user = view.mountItem(session().items.get('user'));
  const agent = view.mountItem(session().items.get('agent'));
  assert.equal(user.querySelector('time').getAttribute('datetime'), new Date(sent).toISOString());
  assert.equal(agent.querySelector('time').getAttribute('datetime'), new Date(started).toISOString());
  assert.equal(agent.querySelector('.message-phase').textContent, '进展');
  assert.match(agent.querySelector('time').textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const unknown = view.mountItem(session().items.get('unknown')).querySelector('time');
  assert.equal(unknown.textContent, '时间未知');
  assert.equal(unknown.hasAttribute('datetime'), false);
  renderMessageTime(unknown, {startedAtMs:NaN, completedAtMs:-1});
  assert.equal(unknown.textContent, '时间未知', 'invalid source times are not displayed');
  renderMessageTime(unknown, {completedAtMs:sent, _timestampMs:now});
  assert.equal(unknown.getAttribute('datetime'), new Date(sent).toISOString(), 'recorded completion takes precedence over temporary local time');
  renderMessageTime(unknown, {_timestampMs:now});
  assert.equal(unknown.getAttribute('datetime'), new Date(now).toISOString(), 'optimistic messages can show their local send time');
  view.clearMessages();
  const remounted = view.mountItem(session().items.get('agent')).querySelector('time');
  assert.equal(remounted.getAttribute('datetime'), new Date(started).toISOString(), 'viewport remount keeps the original time');
  view.clearMessages();

  state.connected = true; state.view = 'chat'; session().resumed = true;
  const requests = [];
  const sender = createTurnController({state, session, history:{}, editor:{},
    rpc:async (method, params) => { requests.push({method, params}); return {turn:{id:'new-turn', status:'inProgress'}}; },
    composer:{readDraft:() => ({text:'new question', attachments:[]}), clearDraft() {}},
    view:{updateRunning() {}, rememberModel() {}, upsertItem() {}, scrollBottom() {}, notice() {}},
  });
  await sender.send();
  assert.equal(requests[0].method, 'turn/start');
  assert.deepEqual(Object.keys(requests[0].params).sort(), ['clientUserMessageId', 'input', 'threadId'],
    'display timestamps never alter the Codex request or session protocol');
  assert.deepEqual(requests[0].params.input, [{type:'text', text:'new question'}]);

} finally { Date.now = realNow; }
console.log('Message time tests passed: recorded send/start times, stable streaming, reload, pagination, unknown history, optimistic display, viewport remount and unchanged Codex requests; no browser storage');
