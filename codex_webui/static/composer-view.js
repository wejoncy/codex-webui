import {$} from './dom.js';
import {renderAttachments as renderAttachmentList} from './attachment-view.js';
export function createComposerView({state, session, showChat, toast, onChange}) {
  $('prompt').addEventListener('input', onChange);
  function setDraft(text, attachments) {
    $('prompt').value = text;
    $('prompt').style.height = 'auto';
    $('prompt').style.height = `${Math.min($('prompt').scrollHeight,180)}px`;
    state.attachments = [...attachments]; renderAttachments();
  }
  function renderAttachments() {
    renderAttachmentList($('attachments'), state.attachments, index => {
      state.attachments.splice(index, 1); renderAttachments();
    });
    onChange();
  }
  function clearAttachments() { state.attachments = []; renderAttachments(); }
  async function addImages(files) {
    if (state.active && session().readOnly) return;
    const epoch = state.epoch;
    for (const file of files) {
      if (!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)) { toast('发送图片支持 PNG、JPEG、GIF 和 WebP'); continue; }
      if (file.size > 8 * 1024 * 1024) { toast('单张图片请控制在 8 MiB 以内'); continue; }
      if (state.attachments.length >= 4 || state.attachments.reduce((sum,a) => sum + a.size,0) + file.size > 12 * 1024 * 1024) { toast('每次最多 4 张图片，总计不超过 12 MiB'); break; }
      const url = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      if (epoch !== state.epoch || (state.active && session().readOnly)) return;
      state.attachments.push({url,name:file.name || '粘贴的图片',size:file.size});
    }
    showChat(); renderAttachments(); $('prompt').focus();
  }


  function readDraft() {return {text:$('prompt').value, attachments:[...state.attachments], model:$('model-select').value, effort:$('effort-select').value};}
  function clearDraft() {$('prompt').value=''; $('prompt').style.height=''; clearAttachments();}
  return {readDraft,clearDraft,setDraft,clearAttachments,addImages};
}
