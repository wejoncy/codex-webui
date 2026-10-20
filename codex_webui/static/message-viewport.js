// Keep expensive message contents only near the scroll viewport. Empty article
// placeholders retain measured heights, so unloading never collapses history.
export function createMessageViewport({root, render, release, onLayout}) {
  const records = new Map();
  const estimatedHeight = 'var(--message-placeholder-height, 160px)';
  let anchor = null;
  let scrollTop = root?.scrollTop;
  function rememberPosition() {
    scrollTop = root.scrollTop;
    if (!document.elementFromPoint) return;
    const bounds = root.getBoundingClientRect();
    for (const inset of [8, 32, 64]) {
      const hit = document.elementFromPoint(
        bounds.left + root.clientWidth / 2, bounds.top + inset);
      // An open modal may cover the reading area while media still loads.
      if (hit && !root.contains(hit)) return;
      const element = hit?.closest(
        'p, li, pre, tr, blockquote, summary, .math-display, .mermaid-block, '
        + '.message-header, .message-body, .tool-output');
      if (element && root.contains(element)) {
        anchor = {
          element, top:element.getBoundingClientRect().top - bounds.top,
        };
        return;
      }
    }
    anchor = null;
  }
  function stabilize() {
    if (!root?.clientHeight) return;
    // Respect navigation or native anchoring before its scroll event arrives.
    if (Math.abs(root.scrollTop - scrollTop) > 1) {
      rememberPosition();
      return;
    }
    const offset = anchor?.element.isConnected
      ? anchor.element.getBoundingClientRect().top
        - root.getBoundingClientRect().top - anchor.top : 0;
    onLayout(offset);
    rememberPosition();
  }
  root?.addEventListener('scroll', rememberPosition, {passive:true});
  // Only mounted messages are measured, including late image/formula layouts.
  const sizes = typeof ResizeObserver === 'function'
    ? new ResizeObserver(stabilize) : null;
  if (root) sizes?.observe(root);
  if (!sizes) root?.addEventListener('diagram-rendered', stabilize);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target);
      if (!record) continue;
      if (!entry.target.isConnected) { remove(entry.target); continue; }
      if (entry.isIntersecting) {
        if (!record.visible) {
          record.visible = true;
          sizes?.observe(entry.target);
          draw(entry.target, record);
        }
      } else if (record.visible) {
        record.visible = false;
        sizes?.unobserve(entry.target);
        const height = entry.boundingClientRect.height;
        entry.target.style.minHeight = height ? `${height}px` : estimatedHeight;
        release(entry.target);
        entry.target.replaceChildren();
        entry.target.dataset.placeholder = 'true';
      }
    }
  }, {root, rootMargin:'600px 0px'}) : null;

  function draw(element, record) {
    element.dataset.placeholder = 'false';
    render(element, record.item, record.streaming, () => {
      if (records.get(element) !== record || !record.visible) return;
      element.style.minHeight = '';
      stabilize();
    });
  }
  function update(element, item, streaming) {
    let record = records.get(element);
    if (!record) {
      record = {visible: !observer}; records.set(element, record);
      element.style.minHeight = estimatedHeight;
      element.dataset.placeholder = 'true';
      observer?.observe(element);
      if (record.visible) sizes?.observe(element);
    }
    record.item = item; record.streaming = streaming;
    if (record.visible) draw(element, record);
  }
  function remove(element) {
    observer?.unobserve(element); sizes?.unobserve(element);
    records.delete(element); release(element);
  }
  function clear() {
    observer?.disconnect();
    sizes?.disconnect();
    if (root) sizes?.observe(root);
    for (const element of records.keys()) release(element);
    records.clear();
    anchor = null;
    scrollTop = root?.scrollTop;
  }
  return {update, remove, clear};
}
