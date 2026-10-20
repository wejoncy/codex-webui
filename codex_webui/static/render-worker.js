/* The parser and TeX engine run off the browser's main thread. */
importScripts('./vendor/markdown-it.min.js', './vendor/katex/katex.min.js', './vendor/katex/contrib/mhchem.min.js');

const formulaCache = new Map();
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function math(tex, display) {
  const key = `${display}:${tex}`;
  if (formulaCache.has(key)) return formulaCache.get(key);
  let html;
  try {
    html = katex.renderToString(tex, {
      displayMode: display, throwOnError: true, strict: 'ignore', trust: false,
      maxExpand: 1000, maxSize: 30, output: 'htmlAndMathml',
    });
  } catch {
    // Only uncommon TeX loads the larger MathJax engine, lazily on the main thread.
    html = `<span class="math-fallback" data-display="${display}" data-tex="${escape(tex)}">${escape(tex)}</span>`;
  }
  // A bounded LRU avoids accumulating every formula from every previous thread.
  if (formulaCache.size >= 512) formulaCache.delete(formulaCache.keys().next().value);
  formulaCache.set(key, html);
  return html;
}

const md = markdownit({html: false, linkify: true, breaks: true, typographer: false});
function inlineMath(state, silent) {
  const start = state.pos, src = state.src;
  let open, close, display = false;
  if (src.startsWith('\\(', start)) { open = '\\('; close = '\\)'; }
  else if (src.startsWith('\\[', start)) { open = '\\['; close = '\\]'; display = true; }
  else if (src[start] === '$') {
    if (src[start + 1] === '$') { open = close = '$$'; display = true; }
    else {
      if (/\s/.test(src[start + 1] || ' ') || /\d/.test(src[start - 1] || '')) return false;
      open = close = '$';
    }
  } else return false;
  let end = start + open.length;
  while ((end = src.indexOf(close, end)) !== -1) {
    let backslashes = 0;
    for (let j = end - 1; j >= 0 && src[j] === '\\'; j--) backslashes++;
    if (backslashes % 2) { end += close.length; continue; }
    if (close === '$' && (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || ''))) { end++; continue; }
    break;
  }
  if (end < 0 || end === start + open.length) return false;
  if (!silent) {
    const token = state.push('math_inline', '', 0);
    token.content = src.slice(start + open.length, end);
    token.meta = {display};
  }
  state.pos = end + close.length;
  return true;
}
md.inline.ruler.before('escape', 'math_inline', inlineMath);
md.renderer.rules.math_inline = (tokens, idx) => math(tokens[idx].content, tokens[idx].meta.display);

function blockMath(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(start, state.eMarks[startLine]).trim();
  let open, close, keep = false;
  if (line.startsWith('$$')) open = close = '$$';
  else if (line.startsWith('\\[')) { open = '\\['; close = '\\]'; }
  else {
    const env = line.match(/^\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|alignat\*?|eqnarray\*?)\}/);
    if (!env) return false;
    open = env[0]; close = `\\end{${env[1]}}`; keep = true;
  }
  let last = startLine;
  let end = state.src.indexOf(close, start + open.length);
  if (end < 0) return false;
  while (last < endLine && state.eMarks[last] < end + close.length) last++;
  if (last >= endLine || state.src.slice(end + close.length, state.eMarks[last]).trim()) return false;
  if (silent) return true;
  const token = state.push('math_block', '', 0);
  token.block = true;
  token.content = state.src.slice(keep ? start : start + open.length, keep ? end + close.length : end).trim();
  token.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}
md.block.ruler.before('fence', 'math_block', blockMath, {alt: ['paragraph', 'reference', 'blockquote', 'list']});
md.renderer.rules.math_block = (tokens, idx) => `<div class="math-display">${math(tokens[idx].content, true)}</div>\n`;

const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const source = token.attrGet('src') || '';
  // Carry the source as inert data. The shared image view resolves it after
  // sanitization and before insertion, avoiding premature relative-URL loads.
  token.attrSet('data-image-source', source);
  token.attrs = token.attrs.filter(([name]) => name !== 'src');
  return defaultImage(tokens, idx, options, env, self);
};
// Enable workspace file:// images without enabling arbitrary file:// links.
const validateLink = md.validateLink.bind(md);
md.validateLink = url => /^file:\/\/.*\.(png|jpe?g|webp|gif|svg|avif|bmp)(?:[?#].*)?$/i.test(url) || validateLink(url);
md.renderer.rules.fence = (tokens, idx, options, env) => {
  const token = tokens[idx];
  const language = token.info.trim().split(/\s+/)[0] || 'text';
  if (['math', 'latex', 'tex'].includes(language.toLowerCase())) return `<div class="math-display">${math(token.content, true)}</div>`;
  if (language.toLowerCase() === 'mermaid') {
    const lastLine = env.lines[token.map[1] - 1] || '';
    const closer = new RegExp(`^\\s*(?:>\\s*)*${token.markup[0]}{${token.markup.length},}\\s*$`);
    const ready = env.final || closer.test(lastLine);
    return `<figure class="mermaid-block" data-mermaid-ready="${ready}"><button class="code-copy" type="button">复制</button><div class="mermaid-output" role="img" aria-label="Mermaid 图表" hidden></div><details class="mermaid-source" open><summary>Mermaid · 源码</summary><pre><code>${escape(token.content)}</code></pre></details><span class="mermaid-status" role="status" hidden></span></figure>\n`;
  }
  // Small tokenizer: no expensive language detection on each streamed fragment.
  const code = token.content;
  const pattern = /(#[^\n]*|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:async|await|def|class|return|import|from|if|else|for|while|const|let|function|export|print|None|True|False|try|except|with|as|in|raise|pass|yield|new|throw)\b|\b\d+(?:\.\d+)?\b)/g;
  let result = '', position = 0;
  for (const match of code.matchAll(pattern)) {
    result += escape(code.slice(position, match.index));
    const value = match[0];
    const type = /^(#|\/\/)/.test(value) ? 'comment' : /^["']/.test(value) ? 'string' : /^\d/.test(value) ? 'number' : 'keyword';
    result += `<span class="tok-${type}">${escape(value)}</span>`;
    position = match.index + value.length;
  }
  result += escape(code.slice(position));
  return `<pre data-language="${escape(language)}"><button class="code-copy" type="button">复制</button><code>${result}</code></pre>`;
};
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, idx, options);
};

self.onmessage = ({data}) => {
  const start = performance.now();
  try {
    // Split large documents at Markdown headings (outside fences), so CSS can
    // skip off-screen layout while preserving all text for browser Find.
    let html;
    const renderSection = text => md.render(text, {lines:text.split('\n'), final:data.final !== false});
    if (data.text.length > 24000) {
      const sections = []; let section = [], fence = null;
      for (const line of data.text.split('\n')) {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = null; }
        if (!fence && /^#{1,3} /.test(line) && section.length > 0) { sections.push(section.join('\n')); section = []; }
        section.push(line);
      }
      sections.push(section.join('\n'));
      html = sections.map(s => `<section>${renderSection(s)}</section>`).join('');
    } else html = renderSection(data.text);
    self.postMessage({id: data.id, html, milliseconds: performance.now() - start, cacheSize: formulaCache.size});
  } catch (error) {
    self.postMessage({id: data.id, html: `<pre>${escape(data.text)}</pre>`, error: error.message, milliseconds: performance.now() - start});
  }
};
