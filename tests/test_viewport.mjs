import assert from 'node:assert/strict';
import {parseHTML} from './vendor/linkedom.mjs';
const {document}=parseHTML('<html><body><div id="scroll"><div id="messages"></div></div></body></html>');
globalThis.document=document;
const observers=[];
const sizeObservers=[];
globalThis.ResizeObserver=class {
  constructor(callback) {
    this.callback=callback;this.nodes=new Set();sizeObservers.push(this);
  }
  observe(node) {this.nodes.add(node);}
  unobserve(node) {this.nodes.delete(node);}
  disconnect() {this.nodes.clear();}
};
globalThis.IntersectionObserver=class {
  constructor(callback, options) { this.callback=callback;this.options=options;this.nodes=new Set();observers.push(this); }
  observe(node) {this.nodes.add(node);}
  unobserve(node) {this.nodes.delete(node);}
  disconnect() {this.nodes.clear();}
  emit(nodes, visible) {this.callback(nodes.map(target=>({target,isIntersecting:visible,boundingClientRect:{height:240}})));}
};
const {createMessageViewport}=await import('../codex_webui/static/message-viewport.js');
const root=document.getElementById('messages');
const released=[];
const viewport=createMessageViewport({root:document.getElementById('scroll'),
  render:(element,item,streaming,ready)=>{element.innerHTML='<p></p>';element.firstChild.textContent=item.text;ready();},
  release:element=>released.push(element),
  onLayout:offset=>{scroll.scrollTop+=offset;},
});
const observer=observers[0];
const nodes=Array.from({length:5000},(_,i)=>{
  const node=document.createElement('article');root.append(node);
  viewport.update(node,{type:'agentMessage',text:`message ${i}`},false);return node;
});
assert.equal(root.querySelectorAll('p').length,0,'offscreen messages do not build contents');
observer.emit(nodes.slice(0,8),true);
assert.equal(root.querySelectorAll('p').length,8);
assert.equal(sizeObservers[0].nodes.size,9,
  'only the scroll root and mounted messages are measured');
viewport.update(nodes[4999],{type:'agentMessage',text:'latest streamed text'},true);
observer.emit(nodes.slice(0,8),false);
observer.emit(nodes.slice(-8),true);
assert.equal(root.querySelectorAll('p').length,8,'rendered bodies stay bounded after scrolling');
assert.equal(nodes[0].style.minHeight,'240px','unloaded messages preserve scroll height');
assert.equal(nodes[4999].textContent,'latest streamed text','offscreen updates are shown on entry');
observer.emit([nodes[0]],true);
assert.equal(nodes[0].textContent,'message 0','scrolling back restores content');
viewport.clear();root.replaceChildren();
observer.emit([nodes[0]],true);
assert.equal(root.textContent,'','old observer callbacks cannot restore a cleared session');
assert.equal(observer.nodes.size,0);
assert.equal(sizeObservers[0].nodes.size,1,
  'clearing a session releases all message size observations');
console.log('Viewport tests passed: 5,000 placeholders, bounded live contents, retained heights, latest stream state, scroll-back and cleanup');

// The viewport reports anchor shifts; its caller owns following decisions.
const scroll=document.getElementById('scroll');
scroll.clientWidth=800;scroll.clientHeight=600;
scroll.scrollHeight=2400;
let position=1800;
Object.defineProperty(scroll,'scrollTop',{
  get:()=>position,
  set:value=>{position=Math.max(0,
    Math.min(value,scroll.scrollHeight-scroll.clientHeight));},
});
scroll.getBoundingClientRect=()=>({left:0,top:0});
const paragraph=document.createElement('p');root.append(paragraph);
let contentY=1000;
paragraph.getBoundingClientRect=()=>({top:contentY-position});
document.elementFromPoint=()=>paragraph;
scroll.dispatchEvent(new document.defaultView.Event('scroll'));
scroll.scrollHeight=3000;
sizeObservers[0].callback();
assert.equal(position,1800,'layout reports do not enable bottom following');
position=1000;
scroll.dispatchEvent(new document.defaultView.Event('scroll'));
scroll.scrollHeight=3300;contentY+=300;
sizeObservers[0].callback();
assert.equal(position,1300,'growth above preserves the visible paragraph');
sizeObservers[0].callback();
assert.equal(position,1300,'repeated resize delivery does not drift');
position=700;
sizeObservers[0].callback();
assert.equal(position,700,'navigation before a scroll event is respected');
scroll.dispatchEvent(new document.defaultView.Event('scroll'));
scroll.scrollHeight+=200;
sizeObservers[0].callback();
assert.equal(position,700,'content growing below does not move the reader');
contentY+=100;scroll.scrollHeight+=100;position+=100;
sizeObservers[0].callback();
assert.equal(position,800,'native scroll anchoring is not applied twice');
const cover=document.createElement('dialog');document.body.append(cover);
document.elementFromPoint=()=>cover;
contentY+=50;scroll.scrollHeight+=50;
sizeObservers[0].callback();
contentY+=50;scroll.scrollHeight+=50;
sizeObservers[0].callback();
assert.equal(position,900,
  'a modal covering the viewport does not discard the reading anchor');
cover.remove();document.elementFromPoint=()=>paragraph;
viewport.clear();
paragraph.remove();
sizeObservers[0].callback();
assert.equal(position,900,
  'clearing history discards its anchor without changing scroll policy');
console.log('Reading position tests passed: late media, visible anchors, '
  + 'navigation, native anchoring and session cleanup');

// Worker admission must remain bounded even while messages are replaced/removed.
const sent=[];
globalThis.window={};
globalThis.Worker=class {constructor(){globalThis.testWorker=this;}postMessage(job){sent.push(job);}};
globalThis.DOMPurify={sanitize:html=>html};
const {renderMarkdown,cancelMarkdown}=await import('../codex_webui/static/renderer.js');
const a=document.createElement('div'),b=document.createElement('div');root.append(a,b);
const first=renderMarkdown(a,'old text');
const queued=renderMarkdown(b,'invisible text');
const newest=renderMarkdown(a,'new text');
assert.equal(sent.length,1,'only one job enters the worker at a time');
assert.equal(await first,null,'superseded result is invalidated');
cancelMarkdown(b);assert.equal(await queued,null);
testWorker.onmessage({data:{id:sent[0].id,html:'<p>old text</p>'}});
await new Promise(resolve=>setTimeout(resolve,5));
assert.equal(sent.length,2,'canceled queued work is never parsed');
assert.equal(sent[1].text,'new text');
testWorker.onmessage({data:{id:sent[1].id,html:'<p>new text</p>'}});
await newest;
assert.equal(a.textContent,'new text');
assert.equal(b.textContent,'');
console.log('Render queue tests passed: one in flight, superseded work coalesced, canceled work skipped, stale output discarded');

const {createSessionStore}=await import('../codex_webui/static/session-store.js');
const store=createSessionStore();
for(let i=0;i<100;i++) {
  const s=store.session(`session-${i}`);s.hydrated=true;s.items.set('item',{text:'payload'});
  store.trimHistory(`session-${i}`);
}
assert.equal([...store.sessions.values()].filter(s=>s.items.size).length,3,'visited histories do not accumulate indefinitely');
assert.equal(store.session('session-0').hydrated,false,'evicted history is reloaded on demand');
const busy=store.session('busy');busy.items.set('stream',{text:'in progress'});busy.running=true;
store.trimHistory('session-99');
assert.equal(busy.items.size,1,'active generation is never evicted');
console.log('Session cache tests passed: visited histories bounded, metadata retained, live generation protected');
