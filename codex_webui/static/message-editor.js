import {imageSource} from './image-view.js';
import {renderAttachments} from './attachment-view.js';

// Own the edit draft and its inline view. Revert/send RPCs stay in the turn controller.
export function createMessageEditor({state, session, isSubmitting, onChange, onSubmit}) {
  function beginEdit(itemId) {
    if (isSubmitting() || !state.active || session().running || session().readOnly) return;
    const item = session().items.get(itemId);
    if (item?.type !== 'userMessage' || !item.turnId) return;
    cancelEdit();
    const content = item.content || [];
    state.edit = {threadId:state.active, turnId:item.turnId, itemId, item, reverted:false,
      text:content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
      attachments:content.filter(part => ['image','localImage'].includes(part.type)).map((input,index) => ({
        input, url:imageSource(input), name:`图片 ${index+1}`, size:0,
      })),
      extraInput:content.filter(part => !['text','image','localImage'].includes(part.type))};
    state.autoScroll = false;
    onChange(itemId)?.querySelector('.message-editor-input')?.focus({preventScroll:true});
  }
  function cancelEdit() {
    const edit = state.edit;
    state.edit = null;
    if (edit) onChange(edit.itemId);
  }
  function restoreEdit(edit) {
    state.edit = edit;
    onChange(edit.itemId);
  }
  function isEditing(id) { return state.edit?.threadId === state.active && state.edit.itemId === id; }
  function sync() {
    const form = document.querySelector('.message-editor');
    if (!form || !state.edit) return;
    const blocked = isSubmitting() || session().running || session().readOnly;
    form.querySelector('textarea').disabled = blocked;
    form.querySelector('.message-editor-save').disabled = blocked || (!state.edit.text.trim() && !state.edit.attachments.length);
    form.querySelector('.message-editor-cancel').disabled = isSubmitting();
    form.querySelectorAll('.attachment-chip button').forEach(button => { button.disabled = blocked; });
  }
  function render(body, item) {
    if (!isEditing(item.id)) return false;
    if (body.querySelector('.message-editor')) { sync(); return true; }
    const edit = state.edit;
    const form = document.createElement('form'); form.className = 'message-editor';
    const input = document.createElement('textarea'); input.className = 'message-editor-input';
    input.setAttribute('aria-label', '编辑消息'); input.rows = 3; input.value = edit.text;
    const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.max(96,input.scrollHeight)}px`; };
    input.oninput = () => { edit.text = input.value; resize(); sync(); };
    input.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); if (!isSubmitting()) cancelEdit(); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSubmit(); }
    };
    const attachments = document.createElement('div'); attachments.className = 'attachments';
    const refreshAttachments = () => renderAttachments(attachments, edit.attachments, index => {
      edit.attachments.splice(index, 1); refreshAttachments(); sync();
    });
    refreshAttachments();
    const actions = document.createElement('div'); actions.className = 'message-editor-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary-button message-editor-cancel'; cancel.textContent = '取消'; cancel.onclick = cancelEdit;
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary-button message-editor-save'; save.textContent = '保存并发送';
    actions.append(cancel, save); form.append(input, attachments, actions);
    form.onsubmit = event => { event?.preventDefault(); return onSubmit(); };
    body.replaceChildren(form); resize(); sync();
    return true;
  }
  return {beginEdit, cancelEdit, restoreEdit, isEditing, render, sync};
}
