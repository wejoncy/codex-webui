import {imageURL} from './image-view.js';

export function prepareLinks(fragment, {basePath, render, cancel}) {
  for (const link of fragment.querySelectorAll('a[href]')) {
    const source = link.getAttribute('href');
    if (!source || link.querySelector('img')
        || /^(?:\/\/|[?#])/.test(source)) continue;
    if (/^[a-z][\w+.-]*:/i.test(source)
        && !/^[a-z]:[\\/]/i.test(source)) continue;
    const url = imageURL(source, {encodedPath:true, basePath});
    const details = document.createElement('details');
    details.className = 'file-preview';
    details.dataset.renderKey = JSON.stringify([url, link.textContent]);
    details.innerHTML = '<summary></summary><div class="file-content"></div>';
    const [summary, body] = details.children;
    summary.textContent = link.textContent || source;
    summary.title = source;
    link.replaceWith(details);
    let controller;
    details.ontoggle = async () => {
      if (!details.open || !details.isConnected) {
        controller?.abort();
        cancel(body);
        body.replaceChildren();
        return;
      }
      const current = controller = new AbortController();
      body.textContent = '正在加载…';
      try {
        const response = await fetch(`${url}&preview=true`, {
          signal:current.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '无法加载文件');
        if (!details.isConnected || !details.open || controller !== current) {
          return;
        }
        body.replaceChildren();
        if (data.markdown) await render(body, data.text, true, data.path);
        else {
          const pre = document.createElement('pre');
          pre.textContent = data.text;
          body.append(pre);
        }
        if (data.truncated && details.open && controller === current) {
          body.append('内容较长，仅显示部分内容。');
        }
      } catch (error) {
        if (error.name !== 'AbortError' && controller === current) {
          body.textContent = error.message;
        }
      }
    };
  }
}

export function releaseLinks(root) {
  for (const preview of root.querySelectorAll('.file-preview[open]')) {
    preview.open = false;
  }
}
