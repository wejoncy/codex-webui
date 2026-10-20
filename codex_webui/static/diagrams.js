// Mermaid needs DOM measurements. Keep its lazy engine and serialized layout
// queue separate from Markdown parsing, which continues to run in a Worker.
const records = new WeakMap();
const waiting = new Set();
const cache = new Map();
let cacheBytes = 0;
let loading = null;
let chain = Promise.resolve();
let sequence = 0;

function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/mermaid/mermaid.min.js', import.meta.url).href;
    script.onload = () => resolve(window.mermaid);
    script.onerror = () => { script.remove(); loading = null; reject(new Error('Mermaid 加载失败')); };
    document.head.append(script);
  });
  return loading;
}

function remember(key, svg) {
  const bytes = svg.length * 2;
  if (bytes > 8 * 1024 * 1024) return;
  while (cache.size && (cache.size >= 32 || cacheBytes + bytes > 8 * 1024 * 1024)) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).length * 2; cache.delete(oldest);
  }
  cache.set(key, svg); cacheBytes += bytes;
}

function insertSVG(node, source) {
  const template = document.createElement('template');
  template.innerHTML = source;
  const svg = template.content.querySelector('svg');
  if (!svg) throw new Error('Mermaid 未生成 SVG');
  // Cached diagrams may occur several times in the same page. Scope every ID
  // and reference so their markers, styles and accessibility labels stay local.
  const ids = new Map(), prefix = `diagram-${++sequence}`;
  for (const element of template.content.querySelectorAll('[id]')) {
    ids.set(element.id, `${prefix}-${ids.size}`); element.id = ids.get(element.id);
  }
  const remap = text => text.replace(/#([\w-]+)/g, (match, id) => ids.has(id) ? `#${ids.get(id)}` : match);
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (['aria-labelledby','aria-describedby'].includes(attribute.name)) {
        element.setAttribute(attribute.name, attribute.value.split(/\s+/).map(id => ids.get(id) || id).join(' '));
      } else if (attribute.name !== 'id') element.setAttribute(attribute.name, remap(attribute.value));
    }
    if (element.localName === 'style') element.textContent = remap(element.textContent);
  }
  const [, , width, height] = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)) {
    svg.setAttribute('width', width); svg.setAttribute('height', height);
  }
  for (const property of ['width', 'height', 'max-width', 'max-height']) svg.style.removeProperty(property);
  const output = node.querySelector('.mermaid-output');
  output.replaceChildren(template.content); output.hidden = false;
  output.setAttribute('role', 'button'); output.tabIndex = 0;
  output.setAttribute('aria-label', '放大查看图表'); output.title = '点击放大图表';
  node.querySelector('.mermaid-source').open = false;
  node.querySelector('.mermaid-status').hidden = true;
  node.dataset.mermaidState = 'rendered';
  node.dispatchEvent(new Event('diagram-rendered', {bubbles:true}));
}

function enqueue(node, record) {
  chain = chain.catch(() => {}).then(async () => {
    const current = () => node.isConnected && records.get(node) === record;
    if (!current()) return;
    const status = node.querySelector('.mermaid-status');
    status.textContent = '正在绘图…'; status.hidden = false;
    let stage;
    try {
      if (record.source.length > 50000) throw new Error('图表源码超过 50,000 字符');
      await new Promise(resolve => (window.requestIdleCallback || (fn => setTimeout(fn, 16)))(resolve, {timeout:300}));
      if (!current()) return;
      let clean = cache.get(record.key);
      if (clean) { cache.delete(record.key); cache.set(record.key, clean); }
      else {
        const mermaid = await loadMermaid();
        if (!current()) return;
        mermaid.initialize({
          startOnLoad:false, securityLevel:'strict', suppressErrorRendering:true,
          theme:record.theme === 'dark' ? 'dark' : 'default', htmlLabels:false,
          flowchart:{htmlLabels:false, useMaxWidth:false},
          maxTextSize:50000, maxEdges:500,
          secure:['secure','securityLevel','startOnLoad','suppressErrorRendering','maxTextSize','maxEdges',
            'htmlLabels','flowchart','theme','themeCSS','themeVariables','fontFamily'],
        });
        stage = document.createElement('div'); stage.className = 'mermaid-stage';
        stage.setAttribute('aria-hidden', 'true'); document.body.append(stage);
        const result = await mermaid.render(`mermaid-${++sequence}`, record.source, stage);
        clean = DOMPurify.sanitize(result.svg, {
          USE_PROFILES:{svg:true, svgFilters:true},
          FORBID_TAGS:['script','foreignObject','iframe','object','embed','image','animate','set'],
          FORBID_ATTR:['onload','onclick'],
        });
        remember(record.key, clean);
      }
      if (current()) insertSVG(node, clean);
    } catch (error) {
      if (!current()) return;
      node.dataset.mermaidState = 'error';
      node.querySelector('.mermaid-source').open = true;
      status.textContent = '图表无法渲染，源码已保留'; status.title = error.message; status.hidden = false;
    } finally { stage?.remove(); }
  });
}

const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const {target, isIntersecting} of entries) if (isIntersecting) {
    observer.unobserve(target); waiting.delete(target);
    const record = records.get(target);
    if (record) enqueue(target, record);
  }
}, {rootMargin:'300px'}) : null;

export function renderDiagrams(root) {
  for (const node of waiting) if (!node.isConnected) { observer.unobserve(node); waiting.delete(node); }
  const theme = document.documentElement.dataset.theme || 'light';
  for (const node of root.querySelectorAll('.mermaid-block[data-mermaid-ready="true"]')) {
    // HTML sanitizers may remove data attributes containing markup such as
    // Mermaid's <br/> labels. The escaped code node is the source of truth.
    const source = node.querySelector('.mermaid-source code')?.textContent || '', key = `${theme}\0${source}`;
    if (records.get(node)?.key === key) continue;
    const record = {source, theme, key}; records.set(node, record);
    if (observer) { waiting.add(node); observer.observe(node); }
    else enqueue(node, record);
  }
}

export function releaseDiagrams(root) {
  for (const node of root.querySelectorAll('.mermaid-block')) {
    observer?.unobserve(node); waiting.delete(node); records.delete(node);
  }
}
