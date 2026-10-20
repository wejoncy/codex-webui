import assert from 'node:assert/strict';
import {parseHTML} from './vendor/linkedom.mjs';
import {createMessageEditor} from '../codex_webui/static/message-editor.js';

const {document}=parseHTML('<html><body><div id="scroll-area"><div id="messages"></div></div></body></html>');
globalThis.document=document;
globalThis.Worker=class {};
let observer;
globalThis.IntersectionObserver=class {
  constructor(callback) { this.callback=callback; observer=this; }
  observe() {}
  unobserve() {}
  disconnect() {}
  emit(target,isIntersecting) { this.callback([{target,isIntersecting,boundingClientRect:{height:240}}]); }
};
const {createMessageView}=await import('../codex_webui/static/message-view.js');
const original={id:'question',type:'userMessage',turnId:'original-turn',content:[
  {type:'text',text:'Original question'}, {type:'localImage',path:'images/attachment.png'},
]};
const s={items:new Map([[original.id,original]]),running:false,readOnly:false};
const state={active:'fixture-thread',autoScroll:true,edit:null};
let submitting=false,saves=0;
const editor=createMessageEditor({state,session:()=>s,isSubmitting:()=>submitting,
  onChange:id=>{const element=document.getElementById(`item-${id}`); view.updateItemElement(element,s.items.get(id)); return element;},
  onSubmit:()=>saves++,
});
const view=createMessageView({
  session:()=>s,isSubmitting:()=>submitting,editor,
  copyText:()=>{},onLayout:()=>{},
});
const element=view.mountItem(original);
observer.emit(element,true);
element.querySelector('.message-edit').onclick();
let input=element.querySelector('textarea');
assert.equal(input.value,'Original question');
assert.equal(state.autoScroll,false,'entering inline edit does not jump to the bottom');
input.value='Unsaved\n<script>literal text</script>'; input.oninput();
observer.emit(element,false);
assert.equal(element.childNodes.length,0,'offscreen editor DOM is released');
observer.emit(element,true);
input=element.querySelector('textarea');
assert.equal(input.value,'Unsaved\n<script>literal text</script>','draft survives viewport unloading');
assert.equal(element.querySelector('script'),null,'edit source is never interpreted as HTML');
assert.equal(element.querySelectorAll('img').length,1);
element.querySelector('.attachment-chip button').onclick();
observer.emit(element,false); observer.emit(element,true);
assert.equal(element.querySelectorAll('img').length,0,'attachment edits also survive unloading');
assert.equal(original.content.length,2,'editing never mutates authoritative history');
s.readOnly=true; editor.sync();
assert.equal(element.querySelector('textarea').disabled,true);
assert.equal(element.querySelector('.message-editor-save').disabled,true);
s.readOnly=false; submitting=true; editor.sync();
assert.equal(element.querySelector('.message-editor-cancel').disabled,true);
submitting=false; editor.sync();
input=element.querySelector('textarea');
input.onkeydown({key:'Enter',ctrlKey:false,metaKey:false,isComposing:false});
assert.equal(saves,0,'Enter stays a newline in a multiline editor');
input.onkeydown({key:'Enter',ctrlKey:true,isComposing:true});
assert.equal(saves,0,'IME composition cannot submit');
input.onkeydown({key:'Enter',ctrlKey:true,isComposing:false,preventDefault(){}});
assert.equal(saves,1);
input.onkeydown({key:'Escape',isComposing:false,preventDefault(){}});
assert.equal(state.edit,null);
assert.equal(element.querySelector('textarea'),null);
assert.match(element.textContent,/Original question/);
assert.equal(element.querySelectorAll('img').length,1,'cancel restores the original message and attachments');
s.readOnly=true; editor.beginEdit(original.id);
assert.equal(state.edit,null,'read-only sessions cannot enter editing');
view.clearMessages();
console.log('Inline editor tests passed: viewport draft retention, safe text, attachments, read-only guards, IME/keyboard and cancel');
