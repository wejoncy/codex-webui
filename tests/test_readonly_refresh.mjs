import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from './vendor/linkedom.mjs';

const {window, document} = parseHTML(fs.readFileSync(new URL('../codex_webui/static/index.html', import.meta.url), 'utf8'));
Object.assign(globalThis, {window, document});
for (const id of ['settings-dialog', 'login-dialog', 'image-dialog']) {
  const dialog = document.getElementById(id);
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
}
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
  get() { return [...this.children].find(option => option.hasAttribute('selected'))?.value || this.children[0]?.value || ''; },
  set(value) { for (const option of this.children) option.toggleAttribute('selected', option.value === value); },
});
window.HTMLElement.prototype.getBoundingClientRect = () => ({top:0});
globalThis.Option = function(text, value) {
  const option = document.createElement('option'); option.textContent = text; option.value = value; return option;
};
const storage = new Map();
globalThis.localStorage = {getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value), removeItem:key => storage.delete(key)};
globalThis.location = new URL('http://localhost/?session=readonly');
globalThis.history = {pushState:(_state, _title, url) => { globalThis.location = new URL(url); }};
globalThis.matchMedia = () => ({matches:false});
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
globalThis.Worker = class {postMessage() {}};
let socket, sockets = 0;
globalThis.WebSocket = class extends EventTarget {
  static OPEN = 1;
  constructor() { super(); sockets++; socket = this; this.readyState = 1; }
};
const item = (id, text) => ({id, type:'userMessage', content:[{type:'text', text}], startedAtMs:1794225600000});
const pages = new Map([
  ['readonly', [item('first', '原有消息')]],
  ['other', [item('other', '另一个对话')]],
]);
const calls = [];
let pending = null, fail = false;
const response = data => ({status:200, ok:true, json:async () => data});
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init?.body || '{}'); calls.push({url, body});
  if (url === '/api/connect') return response({connected:true, transport:'stdio', workspace:'/tmp'});
  if (url === '/api/thread-access') return response({readOnly:body.threadId === 'readonly'});
  if (url === '/api/history') {
    if (fail) return {status:502, ok:false, json:async () => ({error:{message:'fixture refresh failed'}})};
    const page = {turns:[{id:'turn', status:'completed', items:structuredClone(pages.get(body.threadId))}], nextCursor:null};
    if (pending && body.threadId === 'readonly') {
      const operation = pending; pending = null;
      return await new Promise(resolve => { operation.resolve = () => resolve(response(page)); });
    }
    return response(page);
  }
  if (url === '/api/rpc' && body.method === 'thread/list') return response({result:{data:[{id:'readonly', name:'只读对话'}, {id:'other', name:'其他对话'}], nextCursor:null}});
  if (url === '/api/rpc' && body.method === 'model/list') return response({result:{data:[]}});
  if (url === '/api/rpc' && body.method === 'account/read') return response({result:{account:null}});
  throw Error(`Unexpected request: ${url} ${body.method || ''}`);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await import('../codex_webui/static/app.js');
await wait(50);
const button = document.getElementById('send-button'), prompt = document.getElementById('prompt');
const messageText = () => document.getElementById('messages').textContent;
const historyCalls = () => calls.filter(call => call.url === '/api/history').length;
assert.equal(button.dataset.action, 'refresh');
assert.equal(button.disabled, false);
assert.equal(button.getAttribute('aria-label'), '刷新最新消息');
assert.ok(!button.title.includes('Enter'));
assert.equal(prompt.disabled, true);
assert.equal(document.getElementById('attach-button').disabled, true);

prompt.value = '保留的草稿'; prompt.dispatchEvent(new window.Event('input'));
pages.get('readonly').push(item('latest', '最新消息'));
const previousCalls = calls.length, previousURL = location.href;
await button.onclick();
assert.match(messageText(), /最新消息/);
assert.equal(prompt.value, '保留的草稿');
assert.equal(prompt.disabled, true);
assert.equal(location.href, previousURL);
assert.equal(sockets, 1, 'refresh keeps the existing page and event connection');
assert.deepEqual(calls.slice(previousCalls).map(call => call.url), ['/api/history'], 'refresh reads history without checking/resuming writer ownership');

const operation = {}; pending = operation;
const beforeRefresh = historyCalls(), refreshing = button.onclick();
assert.equal(button.disabled, true);
assert.equal(button.getAttribute('aria-busy'), 'true');
await button.onclick();
assert.equal(historyCalls(), beforeRefresh + 1, 'repeated clicks do not duplicate requests');
operation.resolve(); await refreshing;
assert.equal(button.disabled, false);
assert.equal(button.getAttribute('aria-busy'), 'false');

const previousMessages = messageText(), originalError = console.error;
console.error = () => {};
try { fail = true; await button.onclick(); }
finally { fail = false; console.error = originalError; }
assert.equal(messageText(), previousMessages, 'failed refresh keeps the displayed history');
assert.equal(button.disabled, false, 'failed refresh can be retried');
assert.match(document.getElementById('toast-text').textContent, /fixture refresh failed/);
document.getElementById('toast-close').onclick();

pages.get('readonly').push(item('late', '迟到的只读消息'));
const late = {}; pending = late;
const staleRefresh = button.onclick();
await [...document.querySelectorAll('.thread-open')].find(node => node.textContent.includes('其他对话')).onclick();
late.resolve(); await staleRefresh;
assert.match(messageText(), /另一个对话/);
assert.ok(!messageText().includes('迟到的只读消息'), 'late refresh results stay in their original thread');
assert.equal(prompt.disabled, false);
assert.equal(button.dataset.action, 'send');
assert.equal(button.getAttribute('aria-busy'), 'false');

await [...document.querySelectorAll('.thread-open')].find(node => node.textContent.includes('只读对话')).onclick();
socket.onmessage({data:JSON.stringify({method:'turn/started', params:{threadId:'readonly', turn:{id:'running', status:'inProgress'}}})});
assert.equal(button.dataset.action, 'refresh', 'a running read-only thread still offers refresh');
assert.equal(button.disabled, false);
await button.onclick();
assert.ok(calls.every(call => call.url !== '/api/rpc' || ['thread/list', 'model/list', 'account/read'].includes(call.body.method)), 'refresh never sends input or changes a Codex session');
console.log('Read-only refresh passed: existing history read, latest messages, draft retention, duplicate prevention, retry, navigation isolation and unchanged writer/session state');
