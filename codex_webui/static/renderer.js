import {renderDiagrams, releaseDiagrams} from './diagrams.js';
import {prepareImages} from './image-view.js';
export {renderDiagrams as refreshRenderTheme} from './diagrams.js';

const worker = new Worker(new URL('./render-worker.js', import.meta.url));
let nextId = 0;
const jobs = new Map();
const targets = new WeakMap();
const dirty = new Map();
let timer = null;
let mathJaxLoading = null;
let mathJaxChain = Promise.resolve();
let inFlight = null;

function pump() {
  if (inFlight !== null) return;
  for (const [id, job] of jobs) {
    if (!job.element.isConnected) { jobs.delete(id); job.resolve(null); continue; }
    inFlight = id;
    worker.postMessage({id, text:job.text, final:job.final});
    return;
  }
}

function loadMathJax() {
  if (!mathJaxLoading) mathJaxLoading = new Promise((resolve, reject) => {
    window.MathJax = {
      loader: {paths: {mathjax: new URL('./vendor/mathjax', import.meta.url).href}, load: ['ui/safe']},
      startup: {typeset: false},
      tex: {packages: {'[+]': ['ams', 'newcommand', 'configmacros', 'color']}, maxBuffer: 100000},
      svg: {fontCache: 'local'},
      options: {enableMenu: false},
    };
    const script = document.createElement('script');
    script.src = new URL('./vendor/mathjax/tex-svg-full.js', import.meta.url).href;
    script.onload = () => window.MathJax.startup.promise.then(resolve, reject);
    script.onerror = () => reject(new Error('备用公式引擎加载失败'));
    document.head.append(script);
  });
  return mathJaxLoading;
}

function fallbackMath(element) {
  const fallbacks = [...element.querySelectorAll('.math-fallback')];
  if (!fallbacks.length) return;
  // A serialized, idle queue prevents competing MathJax global document passes.
  mathJaxChain = mathJaxChain.catch(() => {}).then(async () => {
    await new Promise(resolve => (window.requestIdleCallback || (fn => setTimeout(fn, 16)))(resolve));
    if (!fallbacks.some(node => node.isConnected)) return;
    await loadMathJax();
    for (const node of fallbacks) {
      if (!node.isConnected) continue;
      try {
        const svg = await window.MathJax.tex2svgPromise(node.dataset.tex, {display: node.dataset.display === 'true'});
        node.replaceChildren(DOMPurify.sanitize(svg, {
          RETURN_DOM_FRAGMENT: true, USE_PROFILES: {html: true, svg: true, mathMl: true},
          ADD_TAGS: ['mjx-container'],
        }));
      } catch {
        node.classList.add('math-error');
        node.title = '此公式无法解析，已保留原始 LaTeX';
      }
    }
  }).catch(() => { for (const node of fallbacks) node.classList.add('math-error'); });
}

function patchChildren(parent, incoming) {
  const existing = [...parent.childNodes];
  for (let i = 0; i < Math.max(incoming.length, existing.length); i++) {
    const before = existing[i], after = incoming[i];
    if (!after) { before?.remove(); continue; }
    if (!before) { parent.append(after); continue; }
    if (before.isEqualNode(after)) continue;
    if (before.nodeType === 1 && after.nodeType === 1) {
      if (before.classList.contains('mermaid-block') && after.classList.contains('mermaid-block')) {
        if (before.querySelector('.mermaid-source code')?.textContent === after.querySelector('.mermaid-source code')?.textContent && before.dataset.mermaidReady === after.dataset.mermaidReady) continue;
      } else if (before.localName === after.localName && before.attributes.length === after.attributes.length && [...before.attributes].every(attr => after.getAttribute(attr.name) === attr.value)) {
        patchChildren(before, [...after.childNodes]); continue;
      }
    }
    before.replaceWith(after);
  }
}

worker.onmessage = ({data}) => {
  if (inFlight === data.id) inFlight = null;
  const job = jobs.get(data.id);
  jobs.delete(data.id);
  // Yield between completed messages so input/scroll events can run.
  setTimeout(pump, 0);
  if (!job) return;
  const {element, resolve} = job;
  if (targets.get(element) !== data.id || !element.isConnected) { resolve(null); return; }
  const clean = DOMPurify.sanitize(data.html, {
    USE_PROFILES: {html: true, mathMl: true, svg: true},
    ADD_ATTR: ['target', 'loading', 'decoding', 'referrerpolicy', 'aria-hidden'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style'],
    FORBID_ATTR: ['srcdoc'],
  });
  // Reuse identical top-level blocks. Completed formulas/images retain their DOM
  // and decoded pixels when a later paragraph receives another delta.
  const template = document.createElement('template');
  template.innerHTML = clean;
  prepareImages(template.content);
  patchChildren(element, [...template.content.childNodes]);
  fallbackMath(element);
  renderDiagrams(element);
  resolve(data);
};
worker.onerror = error => {
  for (const {element, resolve, text} of jobs.values()) {
    element.textContent = text;
    resolve({error: error.message, milliseconds: 0});
  }
  jobs.clear();
  inFlight = null;
};

export function renderMarkdown(element, text, final = true) {
  const previous = targets.get(element);
  if (jobs.has(previous)) { jobs.get(previous).resolve(null); jobs.delete(previous); }
  const id = ++nextId;
  targets.set(element, id);
  return new Promise(resolve => {
    jobs.set(id, {element, resolve, text, final});
    pump();
  });
}

export function scheduleMarkdown(element, text, callback = () => {}) {
  dirty.set(element, {text, callback});
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    for (const [element, {text, callback}] of dirty) {
      // At most one render per target is in flight. Subsequent deltas coalesce.
      if (jobs.has(targets.get(element))) continue;
      dirty.delete(element);
      renderMarkdown(element, text, false).then(result => { if (result && element.isConnected) callback(); });
    }
    if (dirty.size) {
      const [element, value] = dirty.entries().next().value;
      scheduleMarkdown(element, value.text, value.callback);
    }
  }, 80);
}

export function flushMarkdown(element, text, callback = () => {}) {
  dirty.delete(element);
  renderMarkdown(element, text).then(result => { if (result && element.isConnected) callback(); });
}

export function cancelMarkdown(element) {
  dirty.delete(element);
  const id = targets.get(element);
  targets.delete(element);
  if (jobs.has(id)) { jobs.get(id).resolve(null); jobs.delete(id); }
  releaseDiagrams(element);
}
