import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from './vendor/linkedom.mjs';
import {createSidebarView} from '../codex_webui/static/sidebar-view.js';
import {createEventHandler} from '../codex_webui/static/events.js';

const {window,document}=parseHTML(fs.readFileSync(new URL('../codex_webui/static/index.html',import.meta.url),'utf8'));
Object.assign(globalThis,{window,document,matchMedia:()=>({matches:false})});
window.HTMLElement.prototype.showPopover=function(){this.dataset.open='true';};
window.HTMLElement.prototype.hidePopover=function(){delete this.dataset.open;};
window.HTMLElement.prototype.getBoundingClientRect=()=>({right:200,bottom:30,width:100,height:120});
const state={threads:[],sessions:new Map(),listing:0,cursor:null,connected:true};
const calls=[],opened=[],errors=[];
let prompts=0;
window.prompt=()=>{prompts++;return 'Renamed question';};
let pages=[
 {data:[{id:'a',name:'Current question',updatedAt:20},{id:'a',name:'Old segment',updatedAt:10},
        {id:'b',name:'Other question',updatedAt:15},{id:'a',name:'Oldest segment',updatedAt:5}],nextCursor:'page2'},
 {data:[{id:'a',name:'Stale segment',updatedAt:7},{id:'c',name:'Third question',updatedAt:8},
        {id:'c',name:'Older third segment',updatedAt:4}],nextCursor:null},
];
let nextPage=0, pendingList=null;
const rpc=async(method,params)=>{
 calls.push({method,params});
 if(method==='thread/list'){
  const snapshot=structuredClone(pages[nextPage++]);
  if(pendingList)await new Promise(resolve=>{pendingList.resolve=resolve;});
  return snapshot;
 }
 if(method==='thread/name/set'){
  for(const page of pages)for(const thread of page.data)if(thread.id===params.threadId)thread.name=params.name;
  return {};
 }
 throw new Error(`Unexpected mutation ${method}`);
};
const sidebar=createSidebarView({state,rpc,onOpen:async id=>opened.push(id),onNewChat:()=>{},onDelete:()=>{},canDelete:()=>true,report:error=>errors.push(error)});
const labels=()=>[...document.querySelectorAll('.thread-open')].map(el=>el.textContent);
await sidebar.loadThreads();
assert.deepEqual(labels(),['Current question','Other question'],'initial page merges physical segments by logical ID');
assert.equal(document.getElementById('thread-count').textContent,'2');
await sidebar.loadThreads(true);
assert.deepEqual(labels(),['Current question','Other question','Third question'],'pagination merges within and across pages without older metadata replacing newer');
assert.equal(calls.at(-1).params.cursor,'page2');
await document.querySelector('.thread-open').onclick();
assert.deepEqual(opened,['a']);
document.querySelector('.thread-action').onclick();
assert.equal(prompts,0,'opening the menu must not open the rename prompt');
nextPage=0;
await document.querySelector('#thread-menu [data-action="rename"]').onclick();
assert.equal(prompts,1);
assert.deepEqual(calls.filter(call=>call.method==='thread/name/set'),[{method:'thread/name/set',params:{threadId:'a',name:'Renamed question'}}]);
assert.deepEqual(labels(),['Renamed question','Other question'],'renaming a segmented thread leaves one row');
const onEvent=createEventHandler({state,view:{renderThreads:sidebar.renderThreads}});
onEvent({method:'thread/name/updated',params:{threadId:'b',threadName:'Other renamed'}});
assert.deepEqual(labels(),['Renamed question','Other renamed'],'name notifications only affect their own ID');
nextPage=0;pendingList={};
const staleList=sidebar.loadThreads();
onEvent({method:'thread/name/updated',params:{threadId:'b',threadName:'Latest title'}});
pendingList.resolve();await staleList;pendingList=null;
assert.deepEqual(labels(),['Renamed question','Latest title'],'an older list response cannot undo a newer name notification');
assert.equal(calls.some(call=>call.method==='thread/start'),false,'rename never creates a session');
assert.deepEqual(errors,[]);
console.log('Sidebar tests passed: segment deduplication, pagination, newest metadata, menu and rename isolation');
