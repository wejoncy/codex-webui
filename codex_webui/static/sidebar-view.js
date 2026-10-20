import {$,icon} from './dom.js';
export function threadTitle(thread) { return thread.name || thread.preview?.replace(/\s+/g, ' ').slice(0,65) || '新的对话'; }
export function createSidebarView({state,rpc,onOpen,onNewChat,report}) {
  const settings = $('sidebar-settings');
  function setSidebar(open) {
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
    state.threads = append ? [...state.threads, ...result.data.filter(t => !state.threads.some(old => old.id === t.id))] : result.data;
    state.cursor = result.nextCursor;
    renderThreads();
  }
  function renderThreads() {
    const fragment = document.createDocumentFragment();
    for (const thread of state.threads) {
      const row = document.createElement('div'); row.className = `thread-row${thread.id === state.active && state.view === 'chat' ? ' active' : ''}`;
      const open = document.createElement('button'); open.className = 'thread-open'; open.innerHTML = icon('chat');
      const label = document.createElement('span'); label.textContent = threadTitle(thread); open.append(label); open.title = label.textContent;
      open.onclick = () => onOpen(thread.id).catch(report);
      row.append(open);
      if (state.sessions.get(thread.id)?.running) { const dot = document.createElement('span'); dot.className = 'thread-running'; row.append(dot); }
      const rename = document.createElement('button'); rename.className = 'thread-action'; rename.textContent = '⋯'; rename.title = '重命名或归档'; rename.setAttribute('aria-label', `管理对话：${label.textContent}`);
      rename.disabled = !!state.sessions.get(thread.id)?.readOnly;
      rename.onclick = async () => {
        if (state.sessions.get(thread.id)?.readOnly) return;
        const name = window.prompt('输入新名称；输入 /archive 归档此对话', threadTitle(thread));
        if (!name?.trim()) return;
        try {
          if (name.trim() === '/archive') { await rpc('thread/archive', {threadId: thread.id}); if (state.active === thread.id) onNewChat(); }
          else await rpc('thread/name/set', {threadId: thread.id, name: name.trim()});
          await loadThreads();
        } catch (e) { report(e); }
      };
      row.append(rename); fragment.append(row);
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
