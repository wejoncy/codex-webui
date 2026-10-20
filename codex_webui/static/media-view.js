import {$} from './dom.js';
export function createMediaView({toast}) {
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); toast('已复制'); }
    catch { toast('浏览器未允许复制，请选中文本手动复制'); }
  }
  const dialog = $('image-dialog');
  const canvas = $('image-canvas');
  const image = $('viewer-image');
  const pointers = new Map();
  dialog.setAttribute('aria-labelledby', 'image-caption');
  let scale = 1;
  let fitting = true;
  let loaded = false;
  let diagramURL = null;
  function releaseDiagram() {
    if (diagramURL) URL.revokeObjectURL(diagramURL);
    diagramURL = null;
  }
  function showImage(source, caption) {
    loaded = false;
    fitting = true;
    image.hidden = true;
    image.src = source;
    image.alt = caption || '图片预览';
    $('image-original').href = source;
    $('image-caption').textContent = caption || '图片预览';
    updateControls();
    if (!dialog.open) dialog.showModal();
    if (image.complete && image.naturalWidth) imageReady();
  }
  function showDiagram(output) {
    const svg = output.querySelector('svg');
    if (!svg) return;
    releaseDiagram();
    diagramURL = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type:'image/svg+xml'}));
    showImage(diagramURL, 'Mermaid 图表');
  }
  function fitScale() {
    return Math.min(1,
      Math.max(1, canvas.clientWidth - 32) / image.naturalWidth,
      Math.max(1, canvas.clientHeight - 32) / image.naturalHeight);
  }
  function updateControls() {
    $('zoom-in').disabled = !loaded || scale >= 8;
    $('zoom-out').disabled = !loaded || scale <= minimumScale();
    $('zoom-reset').disabled = !loaded;
    $('zoom-reset').textContent = fitting
      ? '适合窗口' : `${Math.round(scale * 100)}%`;
  }
  function minimumScale() {
    return loaded ? Math.min(.1, fitScale()) : .1;
  }
  function sizeImage() {
    image.style.width = `${image.naturalWidth * scale}px`;
    image.style.height = `${image.naturalHeight * scale}px`;
    updateControls();
  }
  function fit() {
    if (!loaded) return;
    fitting = true;
    scale = fitScale();
    sizeImage();
    canvas.scrollLeft = canvas.scrollTop = 0;
  }
  function imageReady() {
    if (!dialog.open || !image.naturalWidth || !image.naturalHeight) return;
    loaded = true;
    image.hidden = false;
    fit();
  }
  function zoomAt(value, point) {
    if (!loaded) return;
    const bounds = canvas.getBoundingClientRect();
    point ||= {
      x: bounds.left + canvas.clientWidth / 2,
      y: bounds.top + canvas.clientHeight / 2,
    };
    const before = image.getBoundingClientRect();
    const x = (point.x - before.left) / scale;
    const y = (point.y - before.top) / scale;
    fitting = false;
    scale = Math.max(minimumScale(), Math.min(8, value));
    sizeImage();
    const after = image.getBoundingClientRect();
    canvas.scrollLeft += after.left + x * scale - point.x;
    canvas.scrollTop += after.top + y * scale - point.y;
  }
  function gesture() {
    const [a, b] = pointers.values();
    return {
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }
  document.addEventListener('click', event => {
    const copy = event.target.closest('.code-copy'); if (copy) copyText(copy.parentElement.querySelector('code')?.textContent || '');
    const image = event.target.closest('.content-image');
    if (image) { event.preventDefault(); releaseDiagram(); showImage(image.currentSrc || image.src, image.alt); }
    const diagram = event.target.closest('.mermaid-output');
    if (diagram) { event.preventDefault(); showDiagram(diagram); }
  });
  document.addEventListener('keydown', event => {
    const diagram = event.target.closest('.mermaid-output');
    if (diagram && ['Enter', ' '].includes(event.key)) { event.preventDefault(); showDiagram(diagram); }
  });
  image.draggable = false;
  image.addEventListener('load', imageReady);
  image.addEventListener('error', () => {
    if (dialog.open) toast('无法加载预览图片，可以尝试打开原图');
  });
  $('zoom-in').onclick = () => zoomAt(scale * 1.25);
  $('zoom-out').onclick = () => zoomAt(scale / 1.25);
  $('zoom-reset').onclick = fit;
  $('zoom-reset').title = '恢复适合窗口（0）；双击图片切换原始大小';
  $('image-close').onclick = () => dialog.close();
  canvas.addEventListener('wheel', event => {
    if (!loaded) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16
      : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const delta = Math.max(-120, Math.min(120, event.deltaY * unit));
    zoomAt(scale * Math.exp(-delta * .002), {
      x: event.clientX, y: event.clientY,
    });
  }, {passive:false});
  canvas.addEventListener('dblclick', event => {
    event.preventDefault();
    if (fitting) zoomAt(1, {x:event.clientX, y:event.clientY});
    else fit();
  });
  canvas.addEventListener('pointerdown', event => {
    if (!loaded || event.button !== 0 || pointers.size >= 2) return;
    event.preventDefault();
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY});
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('is-panning');
  });
  canvas.addEventListener('pointermove', event => {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    const previous = pointers.size === 2 ? gesture() : before;
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY});
    const next = pointers.size === 2 ? gesture()
      : pointers.get(event.pointerId);
    if (pointers.size === 2 && previous.distance > 0) {
      zoomAt(scale * next.distance / previous.distance, previous);
    }
    canvas.scrollLeft -= next.x - previous.x;
    canvas.scrollTop -= next.y - previous.y;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      pointers.delete(event.pointerId);
      canvas.classList.toggle('is-panning', pointers.size > 0);
    });
  }
  dialog.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (['+', '=', '-', '0', '1'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') fit();
      else zoomAt(event.key === '1' ? 1
        : scale * (event.key === '-' ? .8 : 1.25));
    }
  });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (loaded && dialog.open && fitting) fit();
    }).observe(canvas);
  }
  dialog.addEventListener('close', () => {
    loaded = false;
    pointers.clear();
    canvas.classList.remove('is-panning');
    image.removeAttribute('src');
    $('image-original').removeAttribute('href');
    releaseDiagram();
  });
  updateControls();
  return {copyText};
}
