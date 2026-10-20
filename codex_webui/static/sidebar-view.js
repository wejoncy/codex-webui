import {$,icon} from './dom.js';
export function threadTitle(thread) { return thread.name || thread.preview?.replace(/\s+/g, ' ').slice(0,65) || '新的对话'; }
export function createSidebarView({state,rpc,onOpen,onNewChat,onDelete,canDelete,report}) {
  const settings = $('sidebar-settings');
  const pending = new Set();
  let selected = null, menuOpen = false;
  const menu = document.createElement('div');
  menu.id = 'thread-menu'; menu.className = 'thread-menu'; menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '会话操作');
  function closeMenu() { if (menuOpen) menu.hidePopover(); menuOpen = false; selected = null; }
  for (const [action, label] of [['rename','重命名'],['archive','归档'],['delete','永久删除…']]) {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.action = action; button.textContent = label;
    button.onclick = async () => {
      const thread = selected;
      if (!thread || pending.has(thread.id) || state.sessions.get(thread.id)?.readOnly) return;
      closeMenu();
      if (action === 'delete' && (!canDelete(thread.id) || state.sessions.get(thread.id)?.running)) return;
      const name = action === 'rename' ? window.prompt('输入新名称', threadTitle(thread))?.trim() : null;
      if (action === 'rename' && !name) return;
      if (action === 'delete' && !window.confirm(`永久删除“${threadTitle(thread)}”及其创建的子会话？此操作无法撤销。`)) return;
      pending.add(thread.id); renderThreads();
      try {
        if (action === 'delete') await onDelete(thread.id);
        else {
          await rpc(action === 'rename' ? 'thread/name/set' : 'thread/archive', {threadId:thread.id, ...(name ? {name} : {})});
          if (action === 'archive' && state.active === thread.id) onNewChat();
          await loadThreads();
        }
      } catch (error) { report(error); }
      finally { pending.delete(thread.id); renderThreads(); }
    };
    menu.append(button);
  }
  menu.addEventListener('toggle', event => { menuOpen = event.newState === 'open'; });
  $('sidebar-content').append(menu);
  function setSidebar(open) {
    closeMenu();
    const sidebar = $('sidebar');
    const content = $('sidebar-content');
    const rail = $('sidebar-expand');
    const focused = document.activeElement;
    settings.open = false;
    sidebar.classList.toggle('open', open);
    sidebar.classList.toggle('collapsed', !open);
    sidebar.inert = false;
    content.inert = !open;
    rail.hidden = open;
    $('menu-toggle').setAttribute('aria-expanded', String(open));
    $('menu-toggle').setAttribute('aria-label', open ? '收起侧栏' : '展开侧栏');
    $('menu-toggle').title = open ? '收起侧栏' : '展开侧栏';
    if (!open && focused && content.contains(focused)) rail.focus();
    else if (open && focused === rail) $('search').focus();
  }

  async function loadThreads(append = false) {
    const version = ++state.listing;
    const term = $('search').value.trim();
    const result = await rpc('thread/list', {limit: 40, sortKey: 'updated_at', ...(append && state.cursor ? {cursor: state.cursor} : {}), ...(term ? {searchTerm: term} : {})});
    if (version !== state.listing) return;
    // Paginated history can return several rollout segments for one thread.
    // Own list identity here, across both a single page and successive pages.
    const threads = new Map((append ? state.threads : []).map(thread => [thread.id, thread]));
    for (const thread of result.data) {
      if (state.sessions.get(thread.id)?.deleted) continue;
      const previous = threads.get(thread.id);
      if (!previous || (thread.updatedAt ?? 0) > (previous.updatedAt ?? 0)) threads.set(thread.id, thread);
    }
    state.threads = [...threads.values()];
    state.cursor = result.nextCursor;
    renderThreads();
  }
  function renderThreads() {
    closeMenu();
    const fragment = document.createDocumentFragment();
    for (const thread of state.threads) {
      const row = document.createElement('div'); row.className = `thread-row${thread.id === state.active && state.view === 'chat' ? ' active' : ''}`;
      const open = document.createElement('button'); open.className = 'thread-open'; open.innerHTML = icon('chat');
      const label = document.createElement('span'); label.textContent = threadTitle(thread); open.append(label); open.title = label.textContent;
      open.onclick = () => onOpen(thread.id).catch(report);
      row.append(open);
      if (state.sessions.get(thread.id)?.running) { const dot = document.createElement('span'); dot.className = 'thread-running'; row.append(dot); }
      const actions = document.createElement('button'); actions.className = 'thread-action'; actions.textContent = '⋯'; actions.title = '会话操作'; actions.setAttribute('aria-label', `管理对话：${label.textContent}`);
      actions.disabled = pending.has(thread.id) || !!state.sessions.get(thread.id)?.readOnly;
      actions.setAttribute('aria-controls', 'thread-menu'); actions.setAttribute('aria-haspopup', 'true');
      actions.onclick = () => {
        closeMenu(); selected = thread;
        menu.querySelector('[data-action="delete"]').disabled = !canDelete(thread.id) || !!state.sessions.get(thread.id)?.running;
        menu.showPopover(); menuOpen = true;
        const anchor = actions.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(anchor.right-bounds.width, window.innerWidth-bounds.width-8))}px`;
        menu.style.top = `${Math.max(8, Math.min(anchor.bottom+4, window.innerHeight-bounds.height-8))}px`;
      };
      row.append(actions); fragment.append(row);
    }
    if (!state.threads.length) { const empty = document.createElement('p'); empty.className = 'sidebar-empty'; empty.textContent = state.connected ? '还没有对话。从一个想法开始吧。' : '连接后，你的对话会出现在这里。'; fragment.append(empty); }
    $('thread-list').replaceChildren(fragment);
    $('thread-count').textContent = state.threads.length;
    $('more-threads').hidden = !state.cursor;
  }

  $('search').oninput = () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { if (state.connected) loadThreads().catch(report); },250); };
  $('more-threads').onclick = () => loadThreads(true).catch(report);
  $('menu-toggle').onclick = () => setSidebar($('sidebar').classList.contains('collapsed'));
  $('sidebar-expand').onclick = () => setSidebar(true);
  $('sidebar-shade').onclick = () => setSidebar(false);
  document.addEventListener('pointerdown', event => {
    if (!settings.contains(event.target)) settings.open = false;
  });
  settings.addEventListener('keydown', event => {
    if (event.key === 'Escape' && settings.open) {
      event.preventDefault();
      event.stopPropagation();
      settings.open = false;
      $('settings-toggle').focus();
    }
  });
  settings.addEventListener('focusout', event => {
    if (event.relatedTarget && !settings.contains(event.relatedTarget)) settings.open = false;
  });
  setSidebar(!matchMedia('(max-width:760px)').matches);
  return {setSidebar,loadThreads,renderThreads};
}
