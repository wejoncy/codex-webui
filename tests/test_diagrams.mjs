// Uses the existing DOM fixture and real Mermaid engine. SVG metrics are mocked;
// this verifies rendering/lifecycle logic, not browser layout or sanitizer security.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML} from './vendor/linkedom.mjs';
const {window,document}=parseHTML('<html><head></head><body><article id="preview"></article></body></html>');
globalThis.window=window;globalThis.document=document;globalThis.Event=window.Event;
window.Element.prototype.getBoundingClientRect=()=>({width:100,height:20,left:0,right:100,top:0,bottom:20});
window.Element.prototype.getBBox=()=>({x:0,y:0,width:100,height:20});
window.Element.prototype.getComputedTextLength=()=>100;
window.requestIdleCallback=callback=>setTimeout(callback,0);
const context=vm.createContext({
  window,document,console,setTimeout,clearTimeout,performance,TextEncoder,TextDecoder,
  URL,structuredClone,btoa,atob,navigator:{userAgent:'node'},
  matchMedia:()=>({matches:false,addListener(){},addEventListener(){}}),
  getComputedStyle:()=>({getPropertyValue:()=>'',fontFamily:'sans-serif',fontSize:'16px'}),
  CSS:{escape:source=>source},
  CSSStyleSheet:class {constructor(){return document.createElement('style').sheet;}},
});
const bundle=new URL('../codex_webui/static/vendor/mermaid/mermaid.min.js',import.meta.url);
vm.runInContext(fs.readFileSync(bundle,'utf8'),context);
window.mermaid=context.mermaid;
let renders=0;
const engineRender=window.mermaid.render;
window.mermaid.render=(...args)=>{renders++;return engineRender(...args);};
const sanitizeCalls=[];
globalThis.DOMPurify={sanitize:(svg,options)=>{sanitizeCalls.push(options);return svg;}};
const {renderDiagrams}=await import('../codex_webui/static/diagrams.js');
const root=document.getElementById('preview');
function figure(source,ready=true) {
  const node=document.createElement('figure');node.className='mermaid-block';
  node.dataset.mermaidReady=String(ready);
  node.innerHTML='<div class="mermaid-output" hidden></div><details class="mermaid-source" open><summary>源码</summary><pre><code></code></pre></details><span class="mermaid-status" hidden></span>';
  node.querySelector('code').textContent=source;root.append(node);return node;
}
async function settled(node,state='rendered') {
  for(let attempt=0;attempt<200;attempt++) {
    if(node.dataset.mermaidState===state)return;
    if(node.dataset.mermaidState==='error')throw new Error(node.querySelector('.mermaid-status').title);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('diagram did not settle: '+node.outerHTML.slice(0,600));
}
const source=`flowchart TB
    subgraph Browser["浏览器"]
        UI["app.js<br/>会话状态 · 编辑发送 · 事件处理 · 界面更新"]
        Renderer["renderer.js<br/>渲染调度 · HTML 清理"]
        Worker["Web Worker<br/>markdown-it · KaTeX · mhchem"]
        UI --> Renderer
        Renderer --> Worker
    end
    subgraph Python["Python 服务"]
        App["app.py<br/>组装依赖 · 管理生命周期"]
        API["api.py<br/>HTTP / WebSocket · 参数校验"]
        Service["service.py<br/>RPC 白名单 · 工作目录约束"]
        App -.-> API
        API --> Service
    end
    UI -->|"HTTP 请求"| API
    API -.->|"WebSocket 实时事件"| UI`;
const first=figure(source);renderDiagrams(root);await settled(first);
assert.match(first.querySelector('svg').textContent,/浏览器/);
assert.match(first.querySelector('svg').textContent,/会话状态/);
assert.doesNotMatch(first.querySelector('svg').textContent,/<br\/?\s*>/);
assert.equal(first.querySelectorAll('foreignObject').length,0,'uses SVG labels');
assert.equal(first.querySelector('.mermaid-source').open,false);
assert.equal(document.querySelectorAll('.mermaid-stage').length,0,'layout stage is always removed');
assert.ok(sanitizeCalls[0].FORBID_TAGS.includes('foreignObject'));
const second=figure(source);renderDiagrams(root);await settled(second);
assert.equal(renders,1,'identical diagrams reuse the bounded SVG cache');
const ids=[...root.querySelectorAll('[id]')].map(el=>el.id);
assert.equal(new Set(ids).size,ids.length,'cached SVG IDs are instance-local');
for(const node of [first,second]) {
  const localIDs=new Set([...node.querySelectorAll('[id]')].map(el=>el.id));
  for(const path of node.querySelectorAll('[marker-end]')) {
    const id=path.getAttribute('marker-end').match(/#([^\)]+)/)?.[1];
    if(id)assert.ok(localIDs.has(id),'marker references stay within the same SVG');
  }
}
renderDiagrams(root);await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(renders,1,'repeated streaming updates do not rerender completed diagrams');
document.documentElement.dataset.theme='dark';renderDiagrams(root);await new Promise(resolve=>setTimeout(resolve,100));
assert.equal(renders,2,'theme changes create a new cached SVG');
const pending=figure('flowchart TB\n A -->',false);renderDiagrams(root);
await new Promise(resolve=>setTimeout(resolve,20));assert.equal(pending.querySelector('svg'),null);
const invalid=figure('this is invalid mermaid');renderDiagrams(root);await settled(invalid,'error');
assert.equal(invalid.querySelector('.mermaid-source').open,true);
assert.equal(invalid.querySelector('code').textContent,'this is invalid mermaid');
const obsolete=figure('flowchart TB\n X --> Y');renderDiagrams(root);obsolete.remove();
await new Promise(resolve=>setTimeout(resolve,20));assert.equal(obsolete.querySelector('svg'),null,'detached diagram jobs are discarded');
assert.equal(document.querySelectorAll('.mermaid-stage').length,0);
// Exercise the actual Worker -> Markdown renderer -> diagram queue integration.
const staticRoot=new URL('../codex_webui/static/',import.meta.url);
class Worker {
  constructor() {
    this.context=vm.createContext({console,performance});this.context.self=this.context;
    this.context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(new URL(file.replace('/static/',''),staticRoot),'utf8'),this.context));
    vm.runInContext(fs.readFileSync(new URL('render-worker.js',staticRoot),'utf8'),this.context);
    this.context.postMessage=data=>queueMicrotask(()=>this.onmessage({data}));
  }
  postMessage(data) {queueMicrotask(()=>this.context.onmessage({data}));}
}
globalThis.Worker=Worker;
const {renderMarkdown}=await import('../codex_webui/static/renderer.js');
const fenced='```mermaid\n'+source+'\n```';
await renderMarkdown(root,fenced);
const integrated=root.querySelector('.mermaid-block');await settled(integrated);
await renderMarkdown(root,fenced+'\n\n流式后续 $E=mc^2$',false);
assert.equal(root.querySelector('.mermaid-block'),integrated,'streaming patch keeps the rendered diagram');
assert.ok(root.querySelector('.katex'));
console.log('Diagram tests passed: real Mermaid engine and Worker integration, Chinese SVG labels, cache/IDs, theme, incomplete stream, syntax failure and stale jobs');
