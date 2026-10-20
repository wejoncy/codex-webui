// Test viewer interactions with deterministic geometry, without a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from './vendor/linkedom.mjs';

const html = fs.readFileSync(new URL(
  '../codex_webui/static/index.html', import.meta.url), 'utf8');
const {window, document} = parseHTML(html);
globalThis.window = window;
globalThis.document = document;
const observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(node) { this.node = node; }
};
const {createMediaView} = await import(
  '../codex_webui/static/media-view.js');
const dialog = document.getElementById('image-dialog');
const canvas = document.getElementById('image-canvas');
const image = document.getElementById('viewer-image');
dialog.showModal = () => { dialog.open = true; };
dialog.close = () => {
  dialog.open = false;
  dialog.dispatchEvent(new window.Event('close'));
};
let width = 640, height = 480, naturalWidth = 0, naturalHeight = 0;
let scrollLeft = 0, scrollTop = 0;
const imageWidth = () => parseFloat(image.style.width) || 0;
const imageHeight = () => parseFloat(image.style.height) || 0;
Object.defineProperties(canvas, {
  clientWidth: {get:() => width}, clientHeight: {get:() => height},
  scrollLeft: {
    get:() => scrollLeft,
    set:value => { scrollLeft = Math.max(0,
      Math.min(value, Math.max(0, imageWidth() + 32 - width))); },
  },
  scrollTop: {
    get:() => scrollTop,
    set:value => { scrollTop = Math.max(0,
      Math.min(value, Math.max(0, imageHeight() + 32 - height))); },
  },
});
Object.defineProperties(image, {
  naturalWidth: {get:() => naturalWidth},
  naturalHeight: {get:() => naturalHeight},
  complete: {get:() => naturalWidth > 0},
});
canvas.getBoundingClientRect = () => ({left:10, top:20});
image.getBoundingClientRect = () => ({
  left:26 + Math.max(0, (width - 32 - imageWidth()) / 2) - scrollLeft,
  top:36 + Math.max(0, (height - 32 - imageHeight()) / 2) - scrollTop,
});
const notices = [];
createMediaView({toast:message => notices.push(message)});
function emit(target, type, properties = {}) {
  const event = new window.Event(type, {bubbles:true, cancelable:true});
  Object.assign(event, properties);
  target.dispatchEvent(event);
  return event;
}
const source = document.createElement('img');
source.className = 'content-image';
source.src = '/static/plot.svg';
source.alt = '测试图片';
document.body.append(source);
emit(source, 'click');
assert.equal(dialog.open, true);
assert.equal(image.hidden, true, 'old pixels are hidden while loading');
assert.equal(document.getElementById('zoom-in').disabled, true);
naturalWidth = 2000; naturalHeight = 1000;
emit(image, 'load');
assert.equal(imageWidth(), 608, 'fit waits for intrinsic dimensions');
assert.equal(imageHeight(), 304, 'fit preserves the aspect ratio');
assert.equal(image.hidden, false);
assert.equal(image.alt, '测试图片');
document.getElementById('zoom-in').onclick();
assert.equal(imageWidth(), 760, 'first zoom step starts from fitted size');
assert.equal(scrollLeft, 76, 'button zoom preserves the center');
emit(dialog, 'keydown', {key:'1'});
assert.equal(imageWidth(), 2000, '1 selects actual pixel size');
const point = {clientX:400, clientY:260, deltaY:-120, deltaMode:0};
function sourcePoint() {
  const bounds = image.getBoundingClientRect();
  const scale = imageWidth() / naturalWidth;
  return [(point.clientX - bounds.left) / scale,
    (point.clientY - bounds.top) / scale];
}
const before = sourcePoint();
assert.equal(emit(canvas, 'wheel', point).defaultPrevented, true);
const after = sourcePoint();
assert.ok(before.every((value, i) => Math.abs(value - after[i]) < .001),
  'wheel zoom preserves the image point under the pointer');
const panStart = [scrollLeft, scrollTop];
emit(canvas, 'pointerdown', {
  pointerId:1, button:0, clientX:300, clientY:200,
});
emit(canvas, 'pointermove', {
  pointerId:1, clientX:280, clientY:170,
});
assert.deepEqual([scrollLeft, scrollTop],
  [panStart[0] + 20, panStart[1] + 30]);
assert.equal(canvas.classList.contains('is-panning'), true);
emit(canvas, 'pointercancel', {pointerId:1});
assert.equal(canvas.classList.contains('is-panning'), false);
const pinchStart = imageWidth();
emit(canvas, 'pointerdown', {
  pointerId:2, button:0, clientX:200, clientY:200,
});
emit(canvas, 'pointerdown', {
  pointerId:3, button:0, clientX:400, clientY:200,
});
emit(canvas, 'pointermove', {
  pointerId:3, clientX:500, clientY:200,
});
assert.ok(Math.abs(imageWidth() / pinchStart - 1.5) < .001,
  'two touch pointers scale by their relative distance');
emit(canvas, 'pointerup', {pointerId:2});
emit(canvas, 'pointerup', {pointerId:3});
emit(dialog, 'keydown', {key:'0'});
assert.equal(imageWidth(), 608);
width = 360; height = 300;
observers[0].callback();
assert.equal(imageWidth(), 328, 'fitted media adapts to viewport resizing');
emit(canvas, 'dblclick', {clientX:190, clientY:170});
assert.equal(imageWidth(), 2000);
width = 640; height = 480;
observers[0].callback();
assert.equal(imageWidth(), 2000, 'resize respects manual zoom');
emit(canvas, 'dblclick', {clientX:330, clientY:260});
assert.equal(imageWidth(), 608, 'double click restores fit');
emit(dialog, 'keydown', {key:'+', ctrlKey:true});
assert.equal(imageWidth(), 608, 'browser shortcuts are preserved');
for (let i = 0; i < 30; i++) document.getElementById('zoom-in').onclick();
assert.equal(imageWidth(), 16000, 'zoom has a finite upper bound');
assert.equal(document.getElementById('zoom-in').disabled, true);
dialog.close();
assert.equal(image.hasAttribute('src'), false);
assert.equal(document.getElementById('image-original').hasAttribute('href'),
  false);

const revoked = [];
const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
URL.createObjectURL = () => 'blob:test-diagram';
URL.revokeObjectURL = value => revoked.push(value);
globalThis.XMLSerializer = class {
  serializeToString(node) { return node.outerHTML; }
};
try {
  const diagram = document.createElement('div');
  diagram.className = 'mermaid-output';
  diagram.innerHTML = '<svg viewBox="0 0 900 1800"></svg>';
  document.body.append(diagram);
  naturalWidth = 0; naturalHeight = 0;
  emit(diagram, 'click');
  naturalWidth = 900; naturalHeight = 1800;
  emit(image, 'load');
  assert.equal(imageHeight(), 448, 'tall SVG fits by height');
  assert.equal(document.getElementById('image-caption').textContent,
    'Mermaid 图表');
  document.getElementById('zoom-in').onclick();
  assert.ok(Math.abs(imageHeight() - 560) < .001,
    'Mermaid uses the same relative zoom as raster images');
  dialog.close();
  assert.deepEqual(revoked, ['blob:test-diagram']);
} finally {
  URL.createObjectURL = createURL;
  URL.revokeObjectURL = revokeURL;
}
naturalWidth = 0; naturalHeight = 0;
emit(source, 'click');
emit(image, 'error');
assert.match(notices.at(-1), /无法加载/);
dialog.close();
console.log('Media tests passed: delayed fit, pointer-centered zoom, drag, '
  + 'pinch, resize, keyboard, shared SVG viewer, failure and cleanup');
