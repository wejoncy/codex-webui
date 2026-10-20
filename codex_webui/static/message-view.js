import {$, icon} from './dom.js';
import {scheduleMarkdown, flushMarkdown, cancelMarkdown} from './renderer.js';
import {createMessageViewport} from './message-viewport.js';
import {createImage} from './image-view.js';
export const itemDomId = id => `item-${id}`;
const hasReasoningText = item => ['summary','content'].some(key =>
  (item[key] || []).some(part => typeof part === 'string' && /\S/.test(part)));
export function createMessageView({
  session, isSubmitting, editor, copyText, onLayout, loadItem,
}) {
  const markdownTypes = new Set(['agentMessage','plan']);
  const toolUpdates = new Map();
  function cancelToolUpdate(element) {
    const pending = toolUpdates.get(element);
    if (pending) clearTimeout(pending.timer);
    toolUpdates.delete(element);
  }
  function release(element) {
    const body = element.querySelector('.markdown-body');
    if (body) cancelMarkdown(body);
    cancelToolUpdate(element);
  }
  const viewport = createMessageViewport({
    root:$('scroll-area'), render:renderItem, release, onLayout,
  });
  function commandGroup(prepend) {
    const messages = $('messages');
    const edge = prepend
      ? messages.firstElementChild : messages.lastElementChild;
    if (edge?.classList.contains('command-group')) return edge;
    const group = document.createElement('details');
    group.className = 'tool-message command-group';
    const summary = document.createElement('summary');
    summary.innerHTML = `${icon('terminal')}<span></span>`;
    group.append(summary, document.createElement('div'));
    if (prepend) messages.prepend(group);
    else messages.append(group);
    return group;
  }
  function updateCommandGroup(group) {
    if (!group) return;
    const count = group.lastElementChild.childElementCount;
    if (!count) { group.remove(); return; }
    const failed = !!group.querySelector('[data-status="failed"]');
    const running = !!group.querySelector('[data-status="inProgress"]');
    group.dataset.status = failed ? 'failed' : running ? 'inProgress' : '';
    group.firstElementChild.lastElementChild.textContent =
      `执行记录 · ${count} 项`
      + (failed ? ' · 有失败' : running ? ' · 执行中' : '');
  }
  function mountItem(item, {prepend = false, streaming = false} = {}) {
    if (item.type === 'reasoning' && !hasReasoningText(item)) {
      removeMessage(item.id);
      return null;
    }
    let element = document.getElementById(itemDomId(item.id));
    if (!element) {
      element = document.createElement('article');
      element.id = itemDomId(item.id);
      element.dataset.itemId = item.id;
      const role = item.type === 'userMessage' ? 'user-message'
        : markdownTypes.has(item.type) ? 'agent-message' : 'tool-message';
      element.className = `message viewport-message ${role}`;
      element.classList.toggle('image-message',
        item.type === 'imageView' || item.type === 'imageGeneration');
      const parent = item.type === 'commandExecution'
        ? commandGroup(prepend).lastElementChild : $('messages');
      if (prepend) parent.prepend(element);
      else parent.append(element);
    }
    updateItemElement(element, item, streaming);
    return element;
  }
  function ensureStructure(element, item) {
    if (element.firstElementChild) return;
    const user = item.type === 'userMessage';
    if (user || markdownTypes.has(item.type)) {
      const header = document.createElement('div'); header.className = 'message-header';
      header.innerHTML = `<span class="message-avatar">${user ? '你' : '✳'}</span><span class="message-role">${user ? '你' : 'Codex'}</span><span class="message-phase"></span>`;
      const copy = document.createElement('button'); copy.className = 'icon-button message-copy'; copy.innerHTML = icon('copy'); copy.title = '复制消息'; copy.setAttribute('aria-label', '复制消息');
      copy.onclick = () => { const latest = session().items.get(item.id) || item; copyText(latest.text || (latest.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n')); };
      header.append(copy);
      if (user) {
        const edit = document.createElement('button'); edit.className = 'icon-button message-edit'; edit.innerHTML = icon('edit');
        edit.title = '编辑并重新发送，移除此条及后续消息'; edit.setAttribute('aria-label', '编辑并重新发送');
        edit.onclick = () => editor.beginEdit(item.id); header.append(edit);
      }
      const body = document.createElement('div'); body.className = `message-body${user ? '' : ' markdown-body'}`;
      element.append(header, body);
    } else {
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.innerHTML = `${icon(item.type === 'commandExecution' ? 'terminal' : item.type === 'fileChange' ? 'file' : 'sparkles')}<span></span><span class="tool-status"></span>`;
      const output = document.createElement('div'); output.className = 'tool-output'; details.append(summary, output); element.append(details);
      details.open = element.dataset.toolOpen === undefined
        ? item.type === 'imageView' || item.type === 'imageGeneration'
        : element.dataset.toolOpen === 'true';
      details.ontoggle = () => {
        if (!element.isConnected || !details.isConnected) return;
        element.dataset.toolOpen = String(details.open);
        if (details.open) updateItemElement(element, session().items.get(item.id) || item);
        else output.replaceChildren();
      };
    }
  }
  function updateItemElement(element, item, streaming = false) {
    if (item.type === 'reasoning' && !hasReasoningText(item)) {
      removeMessage(item.id);
      return;
    }
    const status = item.status || '';
    if (element.dataset.status !== status) {
      element.dataset.status = status;
      updateCommandGroup(element.closest('.command-group'));
    }
    viewport.update(element, item, streaming);
  }
  function renderItem(element, item, streaming, ready) {
    ensureStructure(element, item);
    const user = item.type === 'userMessage';
    if (user) {
      const edit = element.querySelector('.message-edit');
      edit.hidden = !item.turnId || editor.isEditing(item.id);
      edit.disabled = isSubmitting() || !!session().running || session().readOnly;
      const body = element.querySelector('.message-body');
      if (editor.render(body, item)) { ready(); return; }
      body.replaceChildren();
      for (const part of item.content || []) {
        if (part.type === 'text') { const span = document.createElement('span'); span.textContent = part.text; body.append(span); }
        else if (part.type === 'image' || part.type === 'localImage') {
          body.append(createImage(part, '图片附件'));
        }
      }
    } else if (markdownTypes.has(item.type)) {
      element.querySelector('.message-phase').textContent = item.type === 'plan' ? '计划' : item.phase === 'commentary' ? '进展' : '';
      const target = element.querySelector('.message-body');
      (streaming ? scheduleMarkdown : flushMarkdown)(
        target, item.text || '', ready);
      return;
    } else {
      const names = {commandExecution: '执行命令', fileChange:'修改文件', reasoning:'思考摘要', mcpToolCall:'调用工具', dynamicToolCall:'调用工具', webSearch:'搜索网页', imageView:'查看图片', imageGeneration:'生成图片', contextCompaction:'上下文已压缩', collabAgentToolCall:'协作任务'};
      element.querySelector('summary>span:first-of-type').textContent =
        `${names[item.type] || item.type}`
        + `${item.tool ? ` · ${item.tool}` : ''}`
        + `${item.query ? ` · ${item.query}` : ''}`;
      element.querySelector('.tool-status').textContent = ({inProgress:'进行中',completed:'已完成',failed:'失败',declined:'已拒绝'})[item.status] || '';
      const details = element.querySelector('details');
      if (!details.open) { ready(); return; }
      if (item.detailAvailable) {
        const output = element.querySelector('.tool-output');
        output.textContent = '加载中…';
        loadItem(item).then(full => {
          if (full && element.isConnected && details.open)
            updateItemElement(element, full);
        }).catch(error => {
          if (output.isConnected) output.textContent = error.message;
        });
        ready();
        return;
      }
      if (streaming) {
        let pending = toolUpdates.get(element);
        if (!pending) {
          pending = {timer:setTimeout(() => {
            const latest = toolUpdates.get(element); toolUpdates.delete(element);
            if (latest && element.isConnected && details.open) {
              renderToolContent(element, latest.item);
              ready();
            }
          }, 80)};
          toolUpdates.set(element, pending);
        }
        pending.item = item;
        return;
      }
      cancelToolUpdate(element);
      renderToolContent(element, item);
    }
    ready();
  }
  function renderToolContent(element, item) {
    const output = element.querySelector('.tool-output');
    output.classList.toggle('image-output', item.type === 'imageView' || item.type === 'imageGeneration');
    if (item.type === 'imageView' || item.type === 'imageGeneration') {
      output.replaceChildren(createImage(item, 'Codex 图片'));
    } else if (item.type === 'commandExecution') {
      output.textContent = `$ ${item.command || ''}\n\n`
        + (item.aggregatedOutput || '');
    } else if (item.type === 'fileChange') {
      output.textContent = (item.changes || []).map(c => `${c.kind?.type || 'update'} ${c.path}\n${c.diff || ''}`).join('\n\n');
    } else if (item.type === 'reasoning') output.textContent = [...(item.summary || []), ...(item.content || [])].filter(part => typeof part === 'string' && /\S/.test(part)).join('\n\n');
    else output.textContent = item.aggregatedOutput ?? (typeof item.output === 'string' ? item.output : JSON.stringify(item.result || item.contentItems || item.error || item.arguments || item, null, 2));
  }
  function clearMessages() { viewport.clear(); $('messages').replaceChildren(); }
  function removeMessage(id) {
    const element = document.getElementById(itemDomId(id));
    if (element) {
      const group = element.closest('.command-group');
      viewport.remove(element);
      element.remove();
      updateCommandGroup(group);
    }
  }
  return {mountItem, updateItemElement, clearMessages, removeMessage};
}
