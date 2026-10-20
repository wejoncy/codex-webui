import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from './vendor/linkedom.mjs';
import {createSettingsView} from '../codex_webui/static/settings-view.js';

const {window,document}=parseHTML(fs.readFileSync(new URL('../codex_webui/static/index.html',import.meta.url),'utf8'));
Object.assign(globalThis,{window,document});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{
 get(){return [...this.children].find(o=>o.hasAttribute('selected'))?.value || this.children[0]?.value || '';},
 set(value){for(const o of this.children)o.toggleAttribute('selected',o.value===value);},
});
globalThis.Option=function(text,value){const o=document.createElement('option');o.textContent=text;o.value=value;return o;};
const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const catalog=[
 {id:'model-a',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},
 {id:'model-b',supportedReasoningEfforts:[{reasoningEffort:'medium'}]},
];
const state={active:null,models:[]};
const rpc=async()=>({data:catalog});
const value=id=>document.getElementById(id).value;
function change(id,value){const el=document.getElementById(id);el.value=value;el.onchange();}
let settings=createSettingsView({state,rpc});
await settings.loadModels();
change('settings-model-select','model-a');change('settings-effort-select','high');
assert.equal(value('model-select'),'model-a');assert.equal(value('effort-select'),'high');
state.active='existing-a';settings.selectSession(state.active);
assert.equal(value('model-select'),'','new-session defaults do not override an existing session');
change('model-select','model-a');change('effort-select','low');
state.active='existing-b';settings.selectSession(state.active);
change('model-select','model-b');change('effort-select','medium');
change('settings-model-select','model-b');change('settings-effort-select','medium');
assert.equal(value('model-select'),'model-b');assert.equal(value('effort-select'),'medium');
state.active='existing-a';settings.selectSession(state.active);
assert.equal(value('model-select'),'model-a');assert.equal(value('effort-select'),'low');
settings=createSettingsView({state,rpc});await settings.loadModels();
assert.equal(value('model-select'),'model-a');assert.equal(value('effort-select'),'low','session settings survive refresh');
change('model-select','model-b');assert.equal(value('effort-select'),'','changing model clears unsupported effort');
state.active=null;settings.selectSession(null);
assert.equal(value('model-select'),'model-b');assert.equal(value('effort-select'),'medium','new sessions restore saved defaults');
settings.rememberModel('custom',{model:'external-model',effort:'high'});
state.active='custom';settings.selectSession(state.active);await settings.loadModels();
assert.equal(value('model-select'),'external-model');assert.equal(value('effort-select'),'high','custom model settings are preserved');
settings.forgetSession('existing-a');assert.equal(storage.has('codex-webui-model:existing-a'),false);
assert.equal(storage.has('codex-webui-model-defaults'),true);
storage.set('codex-webui-model:invalid','{');state.active='invalid';settings.selectSession(state.active);
assert.equal(value('model-select'),'');
storage.set('codex-webui-model-defaults',JSON.stringify({model:42,effort:[]}));
state.active=null;settings=createSettingsView({state,rpc});await settings.loadModels();
assert.equal(value('model-select'),'','invalid preferences cannot break startup');
console.log('Settings tests passed: defaults, per-session isolation, refresh, custom models, supported efforts and corrupt preferences');
