// All content images share source resolution and DOM attributes. Parsing and
// protocol adapters supply data; this module owns the browser image element.
export function imageURL(source, {encodedPath = false} = {}) {
  if (typeof source !== 'string' || !source) return '';
  if (/^(https?:|data:image\/|blob:)/i.test(source) || source.startsWith('/static/') || source.startsWith('/api/files?')) return source;
  let path = source.replace(/^(file:\/\/|sandbox:)/i, '');
  if (encodedPath) {
    path = path.split(/[?#]/)[0];
    try { path = decodeURIComponent(path); } catch { /* Preserve literal percent signs. */ }
  }
  return `/api/files?path=${encodeURIComponent(path)}`;
}

export function imageSource(item) {
  const source = item.url || item.savedPath || item.path || item.result || '';
  if (item.type === 'imageGeneration' && !item.url && !item.savedPath && !item.path
      && typeof source === 'string' && /^[\w+/=]+$/.test(source)) return `data:image/png;base64,${source}`;
  return imageURL(source);
}

function configureImage(image, source) {
  image.classList.add('content-image');
  image.setAttribute('loading', 'lazy');
  image.setAttribute('decoding', 'async');
  image.setAttribute('referrerpolicy', 'no-referrer');
  image.setAttribute('src', source);
  return image;
}

export function createImage(item, alt = '图片') {
  const image = document.createElement('img');
  image.alt = alt;
  return configureImage(image, imageSource(item));
}

export function prepareImages(fragment) {
  for (const link of fragment.querySelectorAll('a[href]')) {
    const path = link.getAttribute('href');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|[?#])/i.test(path)) continue;
    if (!/\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)(?:[?#].*)?$/i.test(path)
        || link.querySelector('img')) continue;
    const image = document.createElement('img');
    image.alt = link.textContent;
    image.dataset.imageSource = path;
    link.replaceWith(image);
  }
  for (const image of fragment.querySelectorAll('img')) {
    const source = image.getAttribute('data-image-source') ?? image.getAttribute('src') ?? '';
    configureImage(image, imageURL(source, {encodedPath:true}));
    image.removeAttribute('data-image-source');
  }
}
