import {$} from './dom.js';
export function createMediaView({toast}) {
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); toast('已复制'); }
    catch { toast('浏览器未允许复制，请选中文本手动复制'); }
  }
  const image = $('viewer-image');
  const canvas = $('image-canvas');
  let zoom = 1, fitting = true;
  let diagramURL = null;
  function releaseDiagram() {
    if (diagramURL) URL.revokeObjectURL(diagramURL);
    diagramURL = null;
  }
  function showImage(source, caption) {
    $('viewer-image').src = source; $('image-original').href = source;
    $('image-caption').textContent = caption || '图片预览';
    image.hidden = true;
    $('image-dialog').showModal();
    if (image.complete) fit();
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
      canvas.clientWidth * .95 / image.naturalWidth,
      canvas.clientHeight * .95 / image.naturalHeight);
  }
  function fit() { setZoom(fitScale(), true); }
  function setZoom(value, fit = false) {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;
    zoom = Math.max(Math.min(.1, fitScale()), Math.min(6, value));
    fitting = fit;
    image.hidden = false;
    image.style.maxWidth = image.style.maxHeight = 'none';
    image.style.width = `${image.naturalWidth * zoom}px`;
    image.style.height = `${image.naturalHeight * zoom}px`;
    canvas.style.justifyContent = canvas.style.alignItems = 'safe center';
    $('zoom-reset').textContent = fitting
      ? '适合窗口' : `${Math.round(zoom * 100)}%`;
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
  image.addEventListener('load', fit);
  $('zoom-in').onclick = () => setZoom(zoom * 1.25);
  $('zoom-out').onclick = () => setZoom(zoom / 1.25);
  $('zoom-reset').onclick = fit;
  $('image-close').onclick = () => $('image-dialog').close();
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, {passive:false});
  window.addEventListener('resize', () => {
    if ($('image-dialog').open && fitting) fit();
  });
  $('image-dialog').addEventListener('close', () => {
    image.removeAttribute('src');
    $('image-original').removeAttribute('href');
    releaseDiagram();
  });
  return {copyText};
}
