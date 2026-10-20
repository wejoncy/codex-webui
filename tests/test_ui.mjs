// DOM state smoke test; does not measure browser layout, painting or XSS isolation.
import {parseHTML} from './vendor/linkedom.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../codex_webui/static', import.meta.url));
const workspace = fileURLToPath(new URL('..', import.meta.url));
const {window,document}=parseHTML(fs.readFileSync(`${root}/index.html`,'utf8'));
globalThis.window=window;globalThis.document=document;
window.HTMLElement.prototype.getBoundingClientRect=()=>({top:0});
for(const id of ['settings-dialog','login-dialog','image-dialog']){
 const el=document.getElementById(id);el.showModal=()=>el.open=true;el.close=()=>el.open=false;
}
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{
 get(){return [...this.children].find(o=>o.hasAttribute('selected'))?.value || this.children[0]?.value || ''},
 set(value){for(const o of this.children){if(o.value===value)o.setAttribute('selected','');else o.removeAttribute('selected')}}
});
globalThis.Option=function(text,value){const o=document.createElement('option');o.textContent=text;o.value=value;return o};
const storage=new Map([['codex-webui-model-defaults',JSON.stringify({model:'fixture-model',effort:'high'})]]);
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
window.HTMLElement.prototype.showPopover=function(){this.dataset.open='true';};
window.HTMLElement.prototype.hidePopover=function(){delete this.dataset.open;};
const confirmations=[];
let confirmDelete=true;
window.confirm=message=>{confirmations.push(message);return confirmDelete;};
let mobile=false;
globalThis.matchMedia=query=>({matches:query.includes('max-width')&&mobile});
globalThis.location=new URL('http://localhost/');
const visitedURLs=[];
globalThis.history={pushState:(_state,_title,url)=>{visitedURLs.push(url);globalThis.location=new URL(url)}};
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
let sizeObserver;
globalThis.ResizeObserver=class {
 constructor(callback){this.callback=callback;sizeObserver=this;}
 observe(){}
 unobserve(){}
 disconnect(){}
};
globalThis.DOMPurify={sanitize:value=>value}; // This checks UI state, not browser XSS behavior.
class Worker {
 constructor(){
  this.ctx={performance,console};this.ctx.self=this.ctx;
  this.ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(`${root}/${file.replace('/static/','')}`,'utf8'),this.ctx));
  vm.createContext(this.ctx);vm.runInContext(fs.readFileSync(`${root}/render-worker.js`,'utf8'),this.ctx);
  this.ctx.postMessage=data=>queueMicrotask(()=>this.onmessage({data}));
 }
 postMessage(data){queueMicrotask(()=>this.ctx.onmessage({data}))}
}
globalThis.Worker=Worker;
let socket,connected=false,threads=[
 {id:'locked-history',preview:'被占用的历史'},
 {id:'available-history',preview:'可继续的历史'},
 {id:'broken-history',preview:'读取失败的历史'},
 {id:'edit-history',preview:'编辑原会话'},
 {id:'paged-history',preview:'较长分页会话'},
 {id:'reasoning-history',preview:'思考摘要记录'},
];
const resumeCalls=[],turnCalls=[];
const accessStates=new Map();
const accessCalls=[];
let deferredAccess=null;
const rpcRequests=[],requests=[],pendingRevertEvents=[];
const history=new Map();
const imageInput={type:'localImage',path:'images/original.png'};
const makeTurn=(id,text,images=[])=>({id,status:'completed',items:[
 {id:`user-${id}`,type:'userMessage',content:[{type:'text',text},...images]},
 {id:`agent-${id}`,type:'agentMessage',text:`回复 ${text}`},
]});
history.set('edit-history',[
 makeTurn('edit-first','第一条'),makeTurn('edit-middle','第二条',[imageInput]),makeTurn('edit-last','第三条'),
]);
history.set('paged-history',Array.from({length:16},(_,i)=>makeTurn(`paged-${i}`,`分页消息 ${i}`)));
history.set('reasoning-history',[{id:'reasoning-turn',status:'completed',items:[
 {id:'empty-reasoning',type:'reasoning',summary:[],content:[],encryptedContent:'opaque'},
 {id:'blank-reasoning',type:'reasoning',summary:['  '],content:['\n']},
 {id:'text-reasoning',type:'reasoning',summary:['有内容的摘要'],content:['可见正文']},
]}]);
let turnSequence=0,revertError=false,turnError=false,delayRevertEvent=false;
let deferredRead=null,deferredResume=null,deferredTurns=null,deferredRevert=null,deferredTurn=null;
let deleteError=false,deferredDelete=null,deferredList=null,skipDeleteEvents=false;
const deleteChildren=new Map();
const events=message=>{
 if(message.method==='webui/threadAccess')accessStates.set(message.params.threadId,message.params.readOnly);
 socket.onmessage({data:JSON.stringify(message)});
};
class WS extends EventTarget{
 static OPEN=1;
 constructor(){super();socket=this;this.readyState=1;setTimeout(()=>{this.onopen?.();this.dispatchEvent(new Event('open'))},0)}
}
globalThis.WebSocket=WS;
globalThis.fetch=async (url,init)=>{
 const body=init?.body?JSON.parse(init.body):{},method=body.method,p=body.params||{};
 if(method)rpcRequests.push({method,permissionMode:body.permissionMode,allowNetwork:body.allowNetwork});
 if(method)requests.push({method,params:p});
 let data;
 if(url.endsWith('/health'))data={ok:true,authRequired:false};
 else if(url.endsWith('/status'))data={connected,workspace,transport:'stdio'};
 else if(url.endsWith('/connect')){connected=true;data={connected:true,workspace,transport:'stdio'}}
 else if(url.endsWith('/thread-access')){
  accessCalls.push(body.threadId);
  data={threadId:body.threadId,readOnly:!!accessStates.get(body.threadId)};
  if(deferredAccess && body.threadId===deferredAccess.threadId){
   const pending=deferredAccess;deferredAccess=null;
   return await new Promise(resolve=>{pending.resolve=()=>resolve({status:200,ok:true,json:async()=>data})});
  }
 }
 else if(method==='thread/list'){
  data={result:{data:threads,nextCursor:null}};
  if(deferredList){const pending=deferredList;deferredList=null;return await new Promise(resolve=>{pending.resolve=()=>resolve({status:200,ok:true,json:async()=>data})});}
 }
 else if(method==='model/list')data={result:{data:[]}};
 else if(method==='account/read')data={result:{account:null}};
 else if(method==='thread/read'){
  if(deferredRead && p.threadId==='broken-history')return await new Promise(resolve=>{deferredRead.resolve=resolve});
  if(p.threadId==='broken-history')return {status:502,ok:false,json:async()=>({error:{message:'fixture history read failed'}})};
  data={result:{thread:{id:p.threadId,status:{type:'notLoaded'}}}};
 } else if(method==='thread/turns/list'){
  const turns=history.get(p.threadId)||[{id:'history-turn',status:'completed',items:[{id:`history-${p.threadId}`,type:'agentMessage',text:'历史公式 $E=mc^2$'}]}];
  const offset=Number(p.cursor||0),limit=p.limit||12;
  data={result:{data:[...turns].reverse().slice(offset,offset+limit),nextCursor:offset+limit<turns.length?String(offset+limit):null}};
  if(deferredTurns && p.threadId===deferredTurns.threadId){
   const pending=deferredTurns;deferredTurns=null;
   return await new Promise(resolve=>{pending.resolve=()=>resolve({status:200,ok:true,json:async()=>data})});
  }
 }
 else if(method==='thread/resume'){
  resumeCalls.push(p.threadId);
  if(deferredResume && p.threadId==='locked-history')return await new Promise(resolve=>{deferredResume.resolve=resolve});
  if(p.threadId==='locked-history')return {status:502,ok:false,json:async()=>({error:{message:`thread ${p.threadId} already has an active writer`}})};
  data={result:{thread:{id:p.threadId}}};
 }
 else if(method==='thread/start'){
  const thread={id:'thread-1',preview:'UI test'};threads=[thread,...threads];events({method:'thread/started',params:{thread}});data={result:{thread}};
 } else if(method==='thread/revert'){
  if(deferredRevert)await new Promise(resolve=>{deferredRevert.resolve=resolve});
  if(revertError)return {status:502,ok:false,json:async()=>({error:{message:'fixture revert failed'}})};
  const turns=history.get(p.threadId)||[],index=turns.findIndex(t=>t.id===p.beforeTurnId);
  assert.ok(index>=0,'revert target must exist in the original thread');
  history.set(p.threadId,turns.slice(0,index));
  const notification={method:'thread/reverted',params:{threadId:p.threadId}};
  if(delayRevertEvent)pendingRevertEvents.push(notification);else events(notification);
  data={result:{thread:{id:p.threadId,turns:[]},turnsBackwardsCursor:null,itemsBackwardsCursor:null}};
 } else if(method==='thread/delete'){
  if(deferredDelete)await new Promise(resolve=>{deferredDelete.resolve=resolve});
  if(deleteError)return {status:502,ok:false,json:async()=>({error:{message:'fixture deletion failed'}})};
  for(const id of [p.threadId,...(deleteChildren.get(p.threadId)||[])]){
   threads=threads.filter(thread=>thread.id!==id);history.delete(id);
   if(!skipDeleteEvents)events({method:'thread/deleted',params:{threadId:id}});
  }
  data={result:{}};
 } else if(method==='turn/start'){
  turnCalls.push(p.threadId);
  if(deferredTurn)await new Promise(resolve=>{deferredTurn.resolve=resolve});
  if(turnError)return {status:502,ok:false,json:async()=>({error:{message:'fixture turn failed'}})};
  const threadId=p.threadId,turnId=`turn-${++turnSequence}`,itemId=`agent-${turnId}`;
  const user={id:`user-${turnId}`,clientId:p.clientUserMessageId,type:'userMessage',content:p.input};
  const agent={id:itemId,type:'agentMessage',text:'回答包含公式 $E=mc^2$ 和图片。\n\n![图片](/static/plot.svg)'};
  history.set(threadId,[...(history.get(threadId)||[]),{id:turnId,status:'completed',items:[user,agent]}]);
  events({method:'turn/started',params:{threadId,turn:{id:turnId,status:'inProgress'}}});
  events({method:'item/completed',params:{threadId,turnId,item:user}});
  events({method:'item/started',params:{threadId,turnId,item:{id:itemId,type:'agentMessage',text:''}}});
  for(const delta of ['回答包含公式 ','$E=mc^2$',' 和图片。\n\n![图片](/static/plot.svg)'])events({method:'item/agentMessage/delta',params:{threadId,turnId,itemId,delta}});
  events({method:'item/completed',params:{threadId,turnId,item:agent}});
  events({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
  data={result:{turn:{id:turnId,status:'inProgress'}}};
 }else throw new Error(`Unhandled ${url} ${method}`);
 return {status:200,ok:true,json:async()=>data};
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await import('../codex_webui/static/app.js');
await wait(50);
assert.equal(document.getElementById('connection-label').textContent,'Codex 已连接');
assert.equal(document.getElementById('permission-select').value,'ask');
assert.equal(document.getElementById('network-access').checked,false);
document.getElementById('prompt').value='解释一下这个公式';
await document.getElementById('send-button').onclick();
await wait(250);
assert.equal(document.querySelectorAll('.user-message').length,1,'optimistic message must reconcile');
assert.equal(document.querySelectorAll('.agent-message').length,1);
assert.ok(document.querySelector('.agent-message .katex'),'streamed math must render');
assert.ok(document.querySelector('.agent-message img'),'streamed image must render');
assert.equal(document.getElementById('stop-button').hidden,true,'completion before RPC response must remain completed');
assert.equal(document.getElementById('send-button').hidden,false);
assert.deepEqual(resumeCalls,[],'new threads must not need a separate resume');
assert.equal(requests.find(request=>request.method==='thread/start').params.model,'fixture-model');
assert.equal(requests.find(request=>request.method==='turn/start').params.model,'fixture-model');
assert.equal(requests.find(request=>request.method==='turn/start').params.effort,'high');
assert.deepEqual(JSON.parse(storage.get('codex-webui-model:thread-1')),{model:'fixture-model',effort:'high'},'a new thread remembers the captured send settings');
assert.ok(rpcRequests.filter(r=>['thread/start','turn/start'].includes(r.method)).every(r=>r.permissionMode==='ask'&&r.allowNetwork===false));
async function openHistory(title){
 const button=[...document.querySelectorAll('.thread-open')].find(el=>el.textContent.includes(title));
 assert.ok(button,`missing history ${title}`);
 await button.onclick();await wait(120);
}
accessStates.set('available-history',true);
await openHistory('可继续的历史');
assert.equal(document.getElementById('model-select').value,'','existing sessions do not inherit defaults for new sessions');
assert.equal(document.getElementById('prompt').disabled,true,'first opening detects writer without sending');
assert.deepEqual(resumeCalls,[],'access checks must not resume');
document.getElementById('prompt').value='只读草稿';
await document.getElementById('send-button').onclick();
assert.equal(turnCalls.length,1,'immediate read-only state blocks sending');
accessStates.set('available-history',false);
await openHistory('可继续的历史');
assert.equal(document.getElementById('prompt').disabled,false,'cached sessions must recheck released writer');
assert.equal(accessCalls.filter(id=>id==='available-history').length,2);
const pendingAccess={threadId:'available-history'};
deferredAccess=pendingAccess;
const opening=[...document.querySelectorAll('.thread-open')].find(el=>el.textContent.includes('可继续的历史')).onclick();
await wait(10);
assert.equal(document.getElementById('prompt').disabled,true,'writes stay disabled while access is checked');
await openHistory('较长分页会话');
assert.equal(document.getElementById('prompt').disabled,false);
pendingAccess.resolve();await opening;
assert.equal(document.getElementById('prompt').disabled,false,'stale access responses cannot disable another session');
assert.equal(new URL(location).searchParams.get('session'),'paged-history');
document.getElementById('prompt').value='';
await openHistory('被占用的历史');
assert.deepEqual(resumeCalls,[],'browsing a thread must never request a writer');
assert.equal(document.getElementById('notice').hidden,true);
assert.ok(document.querySelector('#messages .katex'),'locked history must still render math');
document.getElementById('prompt').value='继续这个对话';
await document.getElementById('send-button').onclick();
assert.deepEqual(resumeCalls,['locked-history']);
assert.deepEqual(turnCalls,['thread-1'],'failed resume must not start a turn');
assert.equal(document.getElementById('prompt').value,'继续这个对话','conflict must preserve the draft');
assert.ok(document.querySelector('#messages .katex'),'conflict must preserve rendered history');
assert.match(document.getElementById('toast-text').textContent,/另一个 Codex 实例/);
assert.equal(document.getElementById('notice').hidden,true,'errors must not use a persistent banner');
assert.equal(document.getElementById('send-button').disabled,true);
assert.equal(document.getElementById('prompt').disabled,true);
document.getElementById('toast-close').onclick();
assert.equal(document.getElementById('toast').hidden,true,'error toast must be dismissible');
await document.getElementById('send-button').onclick();
assert.equal(resumeCalls.length,1,'readonly sends must not retry or acquire writer');
assert.equal(document.getElementById('toast').hidden,true);
await openHistory('可继续的历史');
assert.equal(document.getElementById('toast').hidden,true,'switching threads must clear a previous error');
await document.getElementById('send-button').onclick();
assert.equal(resumeCalls.filter(id=>id==='available-history').length,1,'resume only when sending');
assert.equal(turnCalls.at(-1),'available-history');
document.getElementById('prompt').value='再继续';
await document.getElementById('send-button').onclick();
assert.equal(resumeCalls.filter(id=>id==='available-history').length,1,'reuse the resumed thread');
document.getElementById('permission-select').value='workspace-auto';
document.getElementById('permission-select').onchange();
document.getElementById('settings-network-access').checked=true;
document.getElementById('settings-network-access').onchange();
assert.equal(document.getElementById('settings-permission-select').value,'workspace-auto');
assert.equal(document.getElementById('network-access').checked,true);
assert.equal(storage.get('codex-webui-permission'),'workspace-auto');
assert.equal(storage.get('codex-webui-network'),'true');
document.getElementById('prompt').value='在工作区内自动执行并联网';
await document.getElementById('send-button').onclick();
assert.deepEqual(rpcRequests.filter(r=>r.method==='turn/start').at(-1),{method:'turn/start',permissionMode:'workspace-auto',allowNetwork:true});
assert.equal(resumeCalls.filter(id=>id==='available-history').length,1,'permissions change on an existing thread without resuming again');
document.getElementById('settings-permission-select').value='full-access';
document.getElementById('settings-permission-select').onchange();
assert.equal(document.getElementById('permission-select').value,'full-access');
assert.equal(document.getElementById('network-access').disabled,true);
assert.equal(document.getElementById('network-access').checked,true,'full access includes network');
document.getElementById('permission-select').value='ask';
document.getElementById('permission-select').onchange();
assert.equal(document.getElementById('network-access').disabled,false);
document.getElementById('network-access').checked=false;
document.getElementById('network-access').onchange();
assert.equal(document.getElementById('settings-network-access').checked,false);
await openHistory('读取失败的历史');
assert.equal(document.getElementById('toast').hidden,false);
assert.equal(document.getElementById('connection-label').textContent,'Codex 已连接','history errors must not disconnect the backend');
await document.getElementById('lab-nav').onclick();
await wait(30);
assert.equal(document.getElementById('lab').hidden,false);
assert.ok(document.querySelector('#lab-preview .katex'));
assert.equal(document.getElementById('toast').hidden,true,'lab navigation clears history errors');
await openHistory('读取失败的历史');
assert.equal(document.getElementById('toast').hidden,false);
document.getElementById('new-chat').onclick();
assert.equal(document.getElementById('welcome').hidden,false);
assert.equal(document.querySelectorAll('#messages .message').length,0);
assert.equal(document.getElementById('toast').hidden,true,'new chat must clear history errors');
await openHistory('读取失败的历史');
assert.equal(document.getElementById('toast').hidden,false);
await wait(1050);
assert.equal(document.getElementById('toast').hidden,true,'error toast must expire after one second');
assert.equal(document.getElementById('notice').hidden,true);
deferredRead={};
const oldRead=openHistory('读取失败的历史');
await wait(0);
document.getElementById('new-chat').onclick();
deferredRead.resolve({status:502,ok:false,json:async()=>({error:{message:'late history failure'}})});
await oldRead;deferredRead=null;
assert.equal(document.getElementById('toast').hidden,true,'late history errors must not leak into a new chat');
await openHistory('被占用的历史');
deferredResume={};
document.getElementById('prompt').value='旧会话中的草稿';
events({method:'webui/threadAccess',params:{threadId:'locked-history',readOnly:false}});
const oldSend=document.getElementById('send-button').onclick();
await wait(0);
document.getElementById('new-chat').onclick();
deferredResume.resolve({status:502,ok:false,json:async()=>({error:{message:'thread locked-history already has an active writer'}})});
await oldSend;deferredResume=null;
assert.equal(document.getElementById('toast').hidden,true,'late send errors must not leak into a new chat');
assert.equal(document.getElementById('prompt').value,'','late send errors must not replace a new draft');

// A history snapshot started before editing must never resurrect the removed suffix.
const staleTurns={threadId:'edit-history'};
deferredTurns=staleTurns;
document.getElementById('menu-toggle').onclick();
assert.equal(document.getElementById('menu-toggle').getAttribute('aria-expanded'),'true');
assert.equal(document.getElementById('sidebar').inert,false);
const oldHistory=openHistory('编辑原会话');
await wait(0);
assert.equal(document.getElementById('sidebar').classList.contains('collapsed'),true,'selecting a session automatically collapses the sidebar');
assert.equal(document.getElementById('menu-toggle').getAttribute('aria-expanded'),'false');
assert.equal(document.getElementById('sidebar-content').inert,true,'collapsed contents must not capture keyboard focus');
assert.equal(document.getElementById('sidebar').inert,false,'the collapsed rail remains interactive');
assert.equal(document.getElementById('sidebar-expand').hidden,false);
for(const turn of history.get('edit-history'))for(const item of turn.items)events({method:'item/completed',params:{threadId:'edit-history',turnId:turn.id,item}});
const editButton=id=>document.getElementById(`item-user-${id}`).querySelector('.message-edit');
const inlineEditor=()=>document.querySelector('.message-editor');
const editInput=()=>document.querySelector('.message-editor-input');
const setEdit=text=>{editInput().value=text;editInput().oninput();};
const saveEdit=()=>inlineEditor().onsubmit({preventDefault(){}});
document.getElementById('prompt').value='未发送草稿';
const sessionsBefore=threads.length,startCount=requests.filter(r=>r.method==='thread/start').length;
const originalTurns=structuredClone(history.get('edit-history'));
const revertsBefore=requests.filter(r=>r.method==='thread/revert').length;
editButton('edit-middle').onclick();
assert.ok(document.getElementById('item-user-edit-middle').contains(inlineEditor()),'edit in the original message');
assert.equal(editInput().value,'第二条');
assert.equal(document.getElementById('prompt').value,'未发送草稿','editing must not overwrite the bottom composer');
assert.equal(document.querySelectorAll('.message-editor img').length,1,'editing keeps the original image');
assert.equal(document.querySelectorAll('#attachments img').length,0,'original attachments stay in the inline editor');
assert.equal(document.getElementById('send-button').disabled,true,'only inline save submits an edit');
await document.getElementById('send-button').onclick();
assert.equal(requests.filter(r=>r.method==='thread/revert').length,revertsBefore);
setEdit('尚未保存的修改');
const originalInput=editInput();
events({method:'item/completed',params:{threadId:'edit-history',turnId:'edit-middle',item:originalTurns[1].items[0]}});
assert.equal(editInput(),originalInput,'live item updates must preserve focus and the edit draft');
assert.equal(editInput().value,'尚未保存的修改');
document.querySelector('.message-editor-cancel').onclick();
assert.equal(document.getElementById('prompt').value,'未发送草稿','cancel leaves the bottom draft intact');
assert.equal(inlineEditor(),null);
assert.match(document.getElementById('item-user-edit-middle').textContent,/第二条/);
assert.equal(requests.filter(r=>r.method==='thread/revert').length,revertsBefore,'cancel must not mutate history');
editButton('edit-middle').onclick();
setEdit('修改后的第二条');
revertError=true;
await saveEdit();
assert.deepEqual(history.get('edit-history'),originalTurns,'revert failure leaves backend history intact');
assert.equal(document.querySelectorAll('.user-message').length,3,'revert failure leaves displayed history intact');
assert.equal(editInput().value,'修改后的第二条');
assert.equal(document.getElementById('prompt').value,'未发送草稿');
assert.equal(document.querySelectorAll('.message-editor img').length,1);
revertError=false;delayRevertEvent=true;
await saveEdit();
assert.deepEqual(requests.filter(r=>r.method==='thread/revert').at(-1).params,{threadId:'edit-history',beforeTurnId:'edit-middle'});
assert.equal(history.get('edit-history').length,2,'middle edit truncates its own turn and all later turns');
assert.equal(history.get('edit-history')[0].id,'edit-first');
assert.deepEqual(history.get('edit-history')[1].items[0].content,[{type:'text',text:'修改后的第二条'},imageInput],'edited message resubmits the original local image input');
assert.equal(document.querySelectorAll('.user-message').length,2);
assert.equal(document.getElementById('item-user-edit-middle'),null);
assert.equal(document.getElementById('item-user-edit-last'),null);
assert.equal(inlineEditor(),null);
assert.equal(document.getElementById('prompt').value,'未发送草稿','successful inline editing preserves the bottom draft');
const editedTurnId=history.get('edit-history')[1].id;
events(pendingRevertEvents.shift());
assert.ok(document.getElementById(`item-user-${editedTurnId}`),'late revert notification must not erase the newly generated turn');
events({method:'item/agentMessage/delta',params:{threadId:'edit-history',turnId:'edit-last',itemId:'agent-edit-last',delta:'过期片段'}});
events({method:'turn/completed',params:{threadId:'edit-history',turn:{id:'edit-last',status:'completed',error:{message:'过期错误'}}}});
assert.equal(document.getElementById('item-agent-edit-last'),null,'late events from deleted turns are ignored');
staleTurns.resolve();await oldHistory;
assert.equal(document.querySelectorAll('.user-message').length,2,'late history response must not resurrect deleted turns');
await openHistory('可继续的历史');
await openHistory('编辑原会话');
assert.equal(document.querySelectorAll('.user-message').length,2,'cache must also stay truncated after navigation');
assert.equal(inlineEditor(),null);

// Editing the very first message empties the same thread; failed generation can retry without reverting twice.
delayRevertEvent=false;
editButton('edit-first').onclick();
setEdit('修改后的第一条');
turnError=true;
await saveEdit();
assert.deepEqual(history.get('edit-history'),[]);
assert.equal(document.querySelectorAll('#messages .message').length,1,'failed generation keeps an inline draft at the truncated position');
assert.equal(editInput().value,'修改后的第一条');
assert.equal(document.getElementById('prompt').value,'未发送草稿');
const revertsAfterFailure=requests.filter(r=>r.method==='thread/revert').length;
turnError=false;
await saveEdit();
assert.equal(requests.filter(r=>r.method==='thread/revert').length,revertsAfterFailure,'retry after successful truncation must not revert an already deleted turn');
assert.equal(history.get('edit-history').length,1);
assert.equal(history.get('edit-history')[0].items[0].content[0].text,'修改后的第一条');
assert.equal(document.querySelectorAll('.user-message').length,1);
assert.equal(threads.length,sessionsBefore,'editing never creates extra history sessions');
assert.equal(requests.filter(r=>r.method==='thread/start').length,startCount);
assert.equal(requests.some(r=>r.method==='thread/fork'),false);
assert.equal(turnCalls.at(-1),'edit-history');
assert.equal(resumeCalls.filter(id=>id==='edit-history').length,1,'editing resumes lazily and reuses the original writer');

// A delayed edit must not clear or restore a different session's composer.
const onlyTurn=history.get('edit-history')[0].id;
editButton(onlyTurn).onclick();
setEdit('后台编辑');
deferredRevert={};
const navigatingEdit=saveEdit();
await wait(0);
document.getElementById('new-chat').onclick();
document.getElementById('prompt').value='新会话草稿';
deferredRevert.resolve();await navigatingEdit;deferredRevert=null;
assert.equal(document.getElementById('prompt').value,'新会话草稿');
assert.equal(document.querySelectorAll('#messages .message').length,0);
assert.equal(inlineEditor(),null);

// The collapsed rail opens the original sidebar, including on mobile.
document.getElementById('sidebar-expand').onclick();
assert.equal(document.getElementById('sidebar').classList.contains('collapsed'),false);
assert.equal(document.getElementById('sidebar').classList.contains('open'),true);
assert.equal(document.getElementById('sidebar-content').inert,false);
assert.equal(document.getElementById('sidebar-expand').hidden,true);
document.getElementById('sidebar-shade').onclick();
assert.equal(document.getElementById('sidebar').classList.contains('open'),false);
mobile=true;
document.getElementById('sidebar-expand').onclick();
assert.equal(document.getElementById('menu-toggle').getAttribute('aria-expanded'),'true');
await openHistory('编辑原会话');
assert.equal(document.getElementById('sidebar').classList.contains('open'),false);
assert.equal(document.getElementById('menu-toggle').getAttribute('aria-expanded'),'false');
assert.equal(document.querySelectorAll('.user-message').length,1,'background generation must reconcile optimistic messages in the cache');

// Refreshing after a revert must keep already loaded older pages before the latest page.
await openHistory('较长分页会话');
assert.equal(document.querySelectorAll('.user-message').length,12);
// Question navigation uses existing pagination and stops following queued streams.
const scrollArea=document.getElementById('scroll-area'),messageList=document.getElementById('messages');
const elementPrototype=window.HTMLElement.prototype,originalBounds=elementPrototype.getBoundingClientRect;
Object.defineProperty(scrollArea,'scrollHeight',{configurable:true,get:()=>messageList.children.length*200});
Object.defineProperty(scrollArea,'clientHeight',{configurable:true,value:400});
elementPrototype.getBoundingClientRect=function(){
 if(this===scrollArea)return {top:0};
 if(this.parentElement===messageList)return {top:[...messageList.children].indexOf(this)*200+20-scrollArea.scrollTop};
 return originalBounds.call(this);
};
scrollArea.scrollTop=4600;
scrollArea.dispatchEvent(new window.Event('scroll'));
events({method:'item/agentMessage/delta',params:{threadId:'paged-history',turnId:'paged-15',itemId:'agent-paged-15',delta:' continued'}});
const previousQuestion=document.getElementById('previous-question');
await previousQuestion.onclick();
await wait(80);
assert.equal(document.getElementById('item-user-paged-15').getBoundingClientRect().top,12,'a queued stream must not undo question navigation');
const questionPosition=scrollArea.scrollTop;
sizeObserver.callback();sizeObserver.callback();
await wait(20);
assert.equal(scrollArea.scrollTop,questionPosition,
 'late layout respects navigation even within the bottom threshold');
for(let i=1;i<12;i++)await previousQuestion.onclick();
assert.equal(document.getElementById('item-user-paged-4').getBoundingClientRect().top,12,'each click reaches the preceding question');
await previousQuestion.onclick();
assert.equal(document.querySelectorAll('.user-message').length,16);
assert.equal(document.getElementById('item-user-paged-3').getBoundingClientRect().top,12,'navigation loads the preceding history page');
document.getElementById('jump-bottom').onclick();
await wait(20);
assert.equal(scrollArea.scrollTop,scrollArea.scrollHeight,'latest-message navigation still works');
messageList.append(document.createElement('article'));
sizeObserver.callback();await wait(20);
assert.equal(scrollArea.scrollTop,scrollArea.scrollHeight,
 'jumping to latest restores following for subsequent layout changes');
messageList.lastElementChild.remove();
elementPrototype.getBoundingClientRect=originalBounds;
delete scrollArea.scrollHeight;delete scrollArea.clientHeight;
editButton('paged-14').onclick();
setEdit('分页编辑');
await saveEdit();
assert.equal(document.querySelectorAll('.user-message').length,15);
assert.deepEqual([...document.querySelectorAll('.user-message')].slice(0,14).map(el=>el.id),Array.from({length:14},(_,i)=>`item-user-paged-${i}`),'older cached pages must precede refreshed recent turns');
editButton('paged-0').onclick();
setEdit('重发最早一条');
await saveEdit();
assert.equal(history.get('paged-history').length,1);
assert.equal(document.querySelectorAll('.user-message').length,1);

// A revert from another tab invalidates old reads and refreshes authoritative history.
document.getElementById('prompt').value='外部截断前的下一条';
await document.getElementById('send-button').onclick();
const externalRemoved=history.get('paged-history').at(-1);
history.set('paged-history',history.get('paged-history').slice(0,1));
events({method:'thread/reverted',params:{threadId:'paged-history'}});
await wait(100);
assert.equal(document.querySelectorAll('.user-message').length,1);
assert.equal(document.getElementById(`item-${externalRemoved.items[0].id}`),null);
events({method:'item/completed',params:{threadId:'paged-history',turnId:externalRemoved.id,item:externalRemoved.items[1]}});
assert.equal(document.getElementById(`item-${externalRemoved.items[1].id}`),null);
// Session URLs preserve other query parameters and browser navigation never resumes.
globalThis.location=new URL('http://localhost/?keep=value');
await openHistory('编辑原会话');
assert.equal(location.search,'?keep=value&session=edit-history');
const beforeResume=resumeCalls.length;
globalThis.location=new URL('http://localhost/?keep=value&session=paged-history');
window.dispatchEvent(new window.Event('popstate'));await wait(100);
assert.equal(document.querySelectorAll('.user-message').length,1);
assert.equal(location.search,'?keep=value&session=paged-history');
assert.equal(resumeCalls.length,beforeResume);
// Known access events apply only to their own session, including recovered access.
events({method:'webui/threadAccess',params:{threadId:'edit-history',readOnly:true}});
assert.equal(document.getElementById('prompt').disabled,false);
await openHistory('编辑原会话');
assert.equal(document.getElementById('prompt').disabled,true);
assert.equal(document.querySelector('.message-edit').disabled,true);
assert.equal(document.querySelector('#readonly-bar,#resume-editing'),null);
const writesBefore=requests.length;
document.getElementById('prompt').value='只读草稿';
await document.getElementById('send-button').onclick();
await document.getElementById('stop-button').onclick();
assert.equal(requests.length,writesBefore,'readonly actions must not send RPCs');
events({method:'webui/threadAccess',params:{threadId:'edit-history',readOnly:false}});
assert.equal(document.getElementById('prompt').disabled,false);
assert.equal(document.getElementById('prompt').value,'只读草稿');

// Empty protocol reasoning records occupy neither a disclosure nor a viewport placeholder.
await openHistory('思考摘要记录');
assert.equal(document.getElementById('item-empty-reasoning'),null);
assert.equal(document.getElementById('item-blank-reasoning'),null);
assert.equal(document.querySelectorAll('#messages .message').length,1);
let reasoning=document.getElementById('item-text-reasoning');
let details=reasoning.querySelector('details');
details.open=true;details.ontoggle();
assert.equal(reasoning.querySelector('.tool-output').textContent,'有内容的摘要\n\n可见正文');
const reasoningEvent=(method,extra)=>events({method,params:{threadId:'reasoning-history',turnId:'reasoning-turn',...extra}});
reasoningEvent('item/started',{item:{id:'live-reasoning',type:'reasoning',summary:[],content:[]}});
assert.equal(document.getElementById('item-live-reasoning'),null);
reasoningEvent('item/reasoning/summaryTextDelta',{itemId:'live-reasoning',summaryIndex:0,delta:'实时摘要'});
reasoning=document.getElementById('item-live-reasoning');
assert.ok(reasoning,'the first visible delta mounts a previously empty record');
details=reasoning.querySelector('details');details.open=true;details.ontoggle();
assert.equal(reasoning.querySelector('.tool-output').textContent,'实时摘要');
reasoningEvent('item/reasoning/textDelta',{itemId:'live-reasoning',contentIndex:0,delta:'实时正文'});
await wait(100);
assert.equal(reasoning.querySelector('.tool-output').textContent,'实时摘要\n\n实时正文');
assert.equal(document.querySelectorAll('#item-live-reasoning').length,1);
details.open=false;details.ontoggle();
assert.equal(reasoning.querySelector('.tool-output').textContent,'');
reasoningEvent('item/reasoning/summaryTextDelta',{itemId:'live-reasoning',summaryIndex:0,delta:'更新'});
details.open=true;details.ontoggle();
assert.equal(reasoning.querySelector('.tool-output').textContent,'实时摘要更新\n\n实时正文');
reasoningEvent('item/completed',{item:{id:'live-reasoning',type:'reasoning',summary:[],content:[]}});
assert.equal(document.getElementById('item-live-reasoning'),null,'empty completion removes the disclosure and viewport record');
// Image tools open initially, but completion updates respect an explicit collapse.
reasoningEvent('item/started',{item:{id:'image-preview',type:'imageView',path:'images/first.png'}});
const imagePreview=document.getElementById('item-image-preview');
assert.equal(imagePreview.classList.contains('image-message'),true);
const imageDetails=imagePreview.querySelector('details');
assert.equal(imageDetails.open,true);
imageDetails.open=false;imageDetails.ontoggle();
reasoningEvent('item/completed',{item:{id:'image-preview',type:'imageView',path:'images/final.png'}});
assert.equal(imageDetails.open,false,'image completion must not reopen a collapsed tool');
assert.equal(imagePreview.querySelector('img'),null);
imageDetails.open=true;imageDetails.ontoggle();
assert.match(imagePreview.querySelector('img').src,/path=images%2Ffinal.png$/,'reopening uses the latest image path');
document.getElementById('new-chat').onclick();
assert.equal(location.search,'?keep=value');
assert.equal(document.getElementById('prompt').disabled,false);

// One action menu handles rename/archive/delete without hidden text commands.
function threadRow(title){return [...document.querySelectorAll('.thread-row')].find(row=>row.querySelector('.thread-open').textContent.includes(title));}
function openMenu(title){threadRow(title).querySelector('.thread-action').onclick();return document.getElementById('thread-menu');}
const deleteAction=()=>document.querySelector('#thread-menu [data-action="delete"]');
await openHistory('可继续的历史');
assert.equal(openMenu('可继续的历史').dataset.open,'true');
assert.deepEqual([...document.querySelectorAll('#thread-menu button')].map(button=>button.textContent),['重命名','归档','永久删除…']);
const deleteCount=()=>requests.filter(request=>request.method==='thread/delete').length;
let beforeDelete=deleteCount();
confirmDelete=false;await deleteAction().onclick();
assert.equal(deleteCount(),beforeDelete,'cancel sends no deletion request');
assert.ok(threadRow('可继续的历史'));
confirmDelete=true;deleteError=true;
openMenu('可继续的历史');await deleteAction().onclick();deleteError=false;
assert.ok(threadRow('可继续的历史'),'failed deletion keeps the sidebar entry');
assert.equal(new URL(location).searchParams.get('session'),'available-history','failed deletion keeps the active URL');
assert.match(confirmations.at(-1),/子会话/);

// A delayed deletion of another session preserves the current draft and selection.
deferredDelete={};openMenu('可继续的历史');
const deleting=deleteAction().onclick();await wait(0);
beforeDelete=deleteCount();await deleteAction().onclick();
assert.equal(deleteCount(),beforeDelete,'double click never sends another delete');
await openHistory('编辑原会话');
document.getElementById('prompt').value='另一个会话的草稿';
deferredDelete.resolve();await deleting;deferredDelete=null;
assert.equal(document.getElementById('prompt').value,'另一个会话的草稿');
assert.equal(new URL(location).searchParams.get('session'),'edit-history');
assert.equal(threadRow('可继续的历史'),undefined);

// Response cleanup and deletion events share an idempotent path, including descendants.
storage.set('codex-webui-model:edit-history',JSON.stringify({model:'fixture-model',effort:'high'}));
storage.set('codex-webui-model:reasoning-history',JSON.stringify({model:'fixture-model',effort:'low'}));
deleteChildren.set('edit-history',['reasoning-history']);
openMenu('编辑原会话');await deleteAction().onclick();
assert.equal(location.search,'?keep=value');
assert.equal(document.querySelectorAll('#messages .message').length,0);
assert.equal(storage.has('codex-webui-model:edit-history'),false);
assert.equal(storage.has('codex-webui-model:reasoning-history'),false);
assert.equal(threadRow('编辑原会话'),undefined);
assert.equal(threadRow('思考摘要记录'),undefined);
events({method:'thread/deleted',params:{threadId:'edit-history'}});
events({method:'thread/started',params:{thread:{id:'edit-history',preview:'不应复活'}}});
events({method:'item/completed',params:{threadId:'edit-history',turnId:'late',item:{id:'late-item',type:'userMessage',content:[]}}});
assert.equal(threadRow('不应复活'),undefined,'late lifecycle events cannot resurrect deleted sessions');
assert.equal(document.getElementById('item-late-item'),null);

// Deleting while an old history page/list is in flight invalidates both responses.
const pendingHistory={threadId:'paged-history'};deferredTurns=pendingHistory;
// External changes invalidate the cached snapshot and trigger a refresh.
events({method:'thread/reverted',params:{threadId:'paged-history'}});
const openingDeleted=openHistory('较长分页会话');await wait(0);
const oldList={};deferredList=oldList;
const listingDeleted=document.getElementById('more-threads').onclick();await wait(0);
events({method:'thread/deleted',params:{threadId:'paged-history'}});
pendingHistory.resolve();oldList.resolve();await openingDeleted;await listingDeleted;
assert.equal(threadRow('较长分页会话'),undefined,'stale list cannot restore a deleted row');
assert.equal(document.querySelectorAll('#messages .message').length,0,'stale history cannot restore deleted messages');

console.log('UI state tests passed: streaming, same-session edit, navigation, menu, permanent deletion, failures and stale-event cleanup');
process.exit(0);
