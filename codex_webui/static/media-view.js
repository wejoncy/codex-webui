import {$} from './dom.js';
export function createMediaView({toast}) {
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); toast('已复制'); }
    catch { toast('浏览器未允许复制，请选中文本手动复制'); }
  }
  let zoom = 1;
  let diagramURL = null;
  function releaseDiagram() {
    if (diagramURL) URL.revokeObjectURL(diagramURL);
    diagramURL = null;
  }
  function showImage(source, caption) {
    $('viewer-image').src = source; $('image-original').href = source;
    $('image-caption').textContent = caption || '图片预览';
    setZoom(1); $('image-dialog').showModal();
  }
  function showDiagram(output) {
    const svg = output.querySelector('svg');
    if (!svg) return;
    releaseDiagram();
    diagramURL = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type:'image/svg+xml'}));
    showImage(diagramURL, 'Mermaid 图表');
  }
  function setZoom(value) {
    zoom = Math.max(.2,Math.min(6,value));
    const image = $('viewer-image');
    image.style.maxWidth = zoom === 1 ? '95%' : 'none'; image.style.maxHeight = zoom === 1 ? '95%' : 'none';
    image.style.width = zoom === 1 ? '' : `${image.naturalWidth * zoom}px`;
    $('image-canvas').style.justifyContent = zoom > 1 ? 'safe center' : 'center';
    $('image-canvas').style.alignItems = zoom > 1 ? 'safe center' : 'center';
    $('zoom-reset').textContent = zoom === 1 ? '适合窗口' : `${Math.round(zoom*100)}%`;
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
  $('zoom-in').onclick = () => setZoom(zoom + .25);
  $('zoom-out').onclick = () => setZoom(zoom - .25);
  $('zoom-reset').onclick = () => setZoom(1);
  $('image-close').onclick = () => $('image-dialog').close();
  $('image-canvas').addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? .1 : -.1)); }, {passive:false});
  $('image-dialog').addEventListener('close', () => { $('viewer-image').removeAttribute('src'); $('image-original').removeAttribute('href'); releaseDiagram(); });



  return {copyText};
}
