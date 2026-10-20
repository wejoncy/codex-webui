// Run with `node --test tests/test_render.cjs`. Tests the actual worker bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const root = path.join(__dirname, '../codex_webui/static');
const context = {console, performance};
context.self = context;
context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file.replace('/static/','')), 'utf8'), context));
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'render-worker.js'),'utf8'),context);
function render(text,final=true) {
  let result;
  context.postMessage = data => result = data;
  context.onmessage({data:{id:1,text,final}});
  assert.equal(result.error, undefined);
  return result;
}
test('inline, display, aligned, matrix and fenced TeX all render', () => {
  const cases = ['$E=mc^2$', '\\(a^2+b^2=c^2\\)', '$$\\int_0^1 x^2 dx=\\frac{1}{3}$$', '\\[\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\]', '$$\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n$$','```math\n\\sum_{k=0}^n k\n```','\\begin{align}a&=b\\\\c&=d\\end{align}'];
  for (const source of cases) {
    const html = render(source).html;
    assert.match(html,/class="katex/);
    assert.doesNotMatch(html,/math-fallback/);
  }
});
test('currency, escaped delimiters, code and malicious HTML remain text', () => {
  for (const source of ['价格 $20 和 $30。', '\\$not math\\$', '`$a+b$`','```python\nprice = "$a+b$"\n```']) assert.doesNotMatch(render(source).html,/class="katex/);
  assert.doesNotMatch(render('<script>alert(1)</script>').html,/<script>/);
  assert.doesNotMatch(render('[click](javascript:alert(1))').html,/href="javascript/);
  assert.doesNotMatch(render('$\\href{javascript:alert(1)}{x}$').html,/href="javascript/);
});
test('image sources remain inert until the shared image view prepares them', () => {
  const html = render('![a](figures/test.png)\n\n![b](https://example.com/image.webp)\n\n![c](/static/plot.svg)').html;
  assert.match(html,/data-image-source="figures\/test.png"/);
  assert.match(html,/data-image-source="https:\/\/example.com\/image.webp"/);
  assert.match(html,/data-image-source="\/static\/plot.svg"/);
  assert.doesNotMatch(html,/\ssrc=/,'parser output must not trigger relative-URL requests');
});
test('unknown TeX is preserved for lazy MathJax fallback', () => {
  const html = render('$\\notARealCommand{a}$').html;
  assert.match(html,/math-fallback/);
  assert.match(html,/data-tex="\\notARealCommand/);
});
test('chemical notation and percent-encoded image paths work', () => {
  assert.match(render('$\\ce{H2O + CO2 -> H2CO3}$').html,/class="katex/);
  assert.match(render('![plot](<figures/my plot.png>)').html,/data-image-source="figures\/my%20plot.png"/);
});
test('long documents split into layout-skippable sections and hit the cache', () => {
  const text = Array.from({length:200},(_,i)=>`## Section ${i}\n\n$E=mc^2$ and a paragraph with enough content to make this a representative long document.\n\n$$\\int_0^1 x^2 dx=\\frac{1}{3}$$\n`).join('\n');
  const result = render(text);
  assert.equal((result.html.match(/<section>/g)||[]).length,200);
  assert.ok(result.cacheSize < 30);
  console.log(`Long document: ${text.length} characters, ${result.milliseconds.toFixed(1)} ms, ${result.cacheSize} cached formulas`);
});

test('Mermaid stays escaped and waits for a complete fence during streaming', () => {
  const source = 'flowchart TB\n  A["浏览器<br/>$E=mc^2$"] --> B["<script>alert(1)</script>"]';
  const closed = render('```mermaid\n'+source+'\n```',false).html;
  assert.match(closed,/class="mermaid-block"/);
  assert.match(closed,/data-mermaid-ready="true"/);
  assert.match(closed,/&lt;script&gt;/);
  assert.doesNotMatch(closed,/data-mermaid-source=/,'markup-bearing source must not rely on a sanitized attribute');
  assert.doesNotMatch(closed,/<script|class="katex/);
  assert.match(render('```mermaid\n'+source,false).html,/data-mermaid-ready="false"/);
  assert.match(render('```mermaid\n'+source,true).html,/data-mermaid-ready="true"/);
  assert.match(render('~~~mermaid\nflowchart TB\n A --> B\n~~~',false).html,/data-mermaid-ready="true"/);
  assert.match(render('> ```mermaid\n> flowchart TB\n>  A --> B\n> ```',false).html,/data-mermaid-ready="true"/);
});
