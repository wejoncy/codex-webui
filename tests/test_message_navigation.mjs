import assert from 'node:assert/strict';
import {parseHTML} from './vendor/linkedom.mjs';
import {createMessageNavigation} from '../codex_webui/static/message-navigation.js';

const {window, document} = parseHTML('<html><body><div id="scroll"><div id="messages"></div></div><button id="previous"></button></body></html>');
const root = document.getElementById('scroll'), messages = document.getElementById('messages');
const button = document.getElementById('previous');
let frame, layoutReads = 0, paused = 0, loadCalls = 0;
let current = {key:'session-1:0', cursor:null, loading:false}, load = async () => {};
const errors = [];
globalThis.requestAnimationFrame = callback => { frame = callback; };
root.scrollTop = 0;
root.getBoundingClientRect = () => ({top:80});
window.HTMLElement.prototype.getBoundingClientRect = function () {
  layoutReads++;
  return {top:80 + Number(this.dataset.top) - root.scrollTop};
};
function user(id, top) {
  const node = document.createElement('article');
  node.id = id; node.className = 'user-message'; node.dataset.top = top;
  node.dataset.placeholder = 'true'; messages.append(node);
  return node;
}
function update() { navigation.refresh(); const callback = frame; frame = null; callback(); }
const navigation = createMessageNavigation({
  root, messages, button, context:() => current,
  loadOlder:async () => { loadCalls++; await load(); },
  pauseFollowing:() => paused++, report:error => errors.push(error),
});
user('first',20); user('second',1000); user('third',2000);
root.scrollTop = 9000;
update();
assert.equal(button.hidden,false);
assert.equal(button.disabled,false);
await button.onclick();
assert.equal(root.scrollTop,1988,'from a long answer, jump to the latest question start');
await button.onclick();
assert.equal(root.scrollTop,988,'the next click skips the aligned question');
await button.onclick();
assert.equal(root.scrollTop,8,'repeated clicks reach the first question');
update();
assert.equal(button.disabled,true,'stop at the earliest question');
assert.equal(loadCalls,0,'loaded questions require no network calls');
assert.equal(messages.textContent,'','placeholder navigation never renders message contents');

root.scrollTop = 1700;
await button.onclick();
assert.equal(root.scrollTop,988,'manual scrolling changes the navigation starting point');
root.scrollTop = 1100;
await button.onclick();
assert.equal(root.scrollTop,988,'inside a long question, return to that question start');

root.scrollTop = 8;
current.cursor = 'page-2';
load = async () => {
  // History prepend preserves the current visual anchor, as the real view does.
  for (const node of messages.children) node.dataset.top = Number(node.dataset.top) + 200;
  root.scrollTop += 200;
  messages.prepend(user('older',20));
  current.cursor = null;
};
await button.onclick();
assert.equal(root.scrollTop,8,'the previous question can come from an unloaded page');
assert.equal(loadCalls,1);
assert.equal(messages.firstElementChild.id,'older');

current.cursor = 'empty-page';
load = async () => {
  if (current.cursor === 'empty-page') { current.cursor = 'question-page'; return; }
  for (const node of messages.children) node.dataset.top = Number(node.dataset.top) + 200;
  root.scrollTop += 200;
  messages.prepend(user('oldest',20)); current.cursor = null;
};
await button.onclick();
assert.equal(root.scrollTop,8);
assert.equal(messages.firstElementChild.id,'oldest');
assert.equal(loadCalls,3,'skip pages that contain only assistant or tool messages');

current.cursor = 'failed-page';
load = async () => {}; // Existing history controller reports errors and keeps its cursor.
await button.onclick();
assert.equal(loadCalls,4,'a failed or busy page cannot cause a retry loop');
load = async () => { throw new Error('network unavailable'); };
await button.onclick();
assert.equal(errors.length,1);
update(); assert.equal(button.disabled,false,'failure allows a later retry');

let release;
load = () => new Promise(resolve => { release = resolve; });
const pending = button.onclick();
const callsBefore = loadCalls;
await button.onclick();
assert.equal(loadCalls,callsBefore,'rapid repeated clicks share the pending navigation');
current = {key:'another-session:0', cursor:null, loading:false};
root.scrollTop = 123;
release(); await pending;
assert.equal(root.scrollTop,123,'late history results never scroll another session');

current.cursor = 'pending-revert';
root.scrollTop = 8;
const reverting = button.onclick();
current = {...current, key:'another-session:1'};
root.scrollTop = 456;
release(); await reverting;
assert.equal(root.scrollTop,456,'history truncation invalidates a pending jump');

messages.replaceChildren();
for (let i = 0; i < 5000; i++) user(`many-${i}`,i * 200);
root.scrollTop = 987654;
layoutReads = 0;
await button.onclick();
assert.ok(layoutReads <= 16,'5,000 question positions are searched without a full layout scan');
assert.ok(paused > 0,'question navigation suspends following streamed output');
current = null;
update();
assert.equal(button.hidden,true,'hide navigation outside a session');
console.log('Message navigation passed: repeated jumps, manual scrolling, pagination, failures, stale responses and 5,000 placeholders');
