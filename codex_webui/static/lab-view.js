import {$} from './dom.js';
import {renderMarkdown} from './renderer.js';
import {examples} from './examples.js';
export function createLabView({setView}) {
  let version = 0;
  async function showExample(name = 'math') {
    setView('lab');
    document.querySelectorAll('[data-example]').forEach(b => { const active = b.dataset.example === name; b.classList.toggle('active',active); b.setAttribute('aria-selected',String(active)); });
    $('lab-source').value = examples[name];
    await renderLab();
  }
  async function renderLab() {
    const current = ++version;
    $('render-stats').textContent = '正在后台排版…';
    const start = performance.now();
    const result = await renderMarkdown($('lab-preview'), $('lab-source').value);
    if (current !== version || !result) return;
    $('render-stats').textContent = result.error ? `渲染失败：${result.error}` : `解析 ${result.milliseconds.toFixed(0)} ms · 显示 ${(performance.now()-start).toFixed(0)} ms · ${$('lab-source').value.length.toLocaleString()} 字符`;
  }

  $('lab-nav').onclick = () => showExample('math');
  $('lab-invitation').onclick = () => showExample('math');
  document.querySelectorAll('[data-example]').forEach(b => b.onclick = () => showExample(b.dataset.example));
  $('toggle-source').onclick = () => { $('lab-source').hidden = !$('lab-source').hidden; if (!$('lab-source').hidden) $('lab-source').focus(); };
  let sourceTimer;
  $('lab-source').addEventListener('input', () => { clearTimeout(sourceTimer); sourceTimer = setTimeout(renderLab, 200); });
  return {showExample};
}
