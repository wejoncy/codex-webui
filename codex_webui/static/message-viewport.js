// Keep expensive message contents only near the scroll viewport. Empty article
// placeholders retain measured heights, so unloading never collapses history.
export function createMessageViewport({root, render, release}) {
  const records = new Map();
  let following = true;
  let anchor = null;
  let scrollTop = root?.scrollTop;
  function rememberPosition() {
    scrollTop = root.scrollTop;
    following = root.scrollHeight - scrollTop - root.clientHeight < 110;
    if (following) { anchor = null; return; }
    if (!document.elementFromPoint) return;
    const bounds = root.getBoundingClientRect();
    for (const inset of [8, 32, 64]) {
      const hit = document.elementFromPoint(
        bounds.left + root.clientWidth / 2, bounds.top + inset);
      // An open modal may cover the reading area while media still loads.
      if (hit && !root.contains(hit)) return;
      const element = hit?.closest(
        'p, li, pre, tr, blockquote, .math-display, .mermaid-block, '
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
    if (following) root.scrollTop = root.scrollHeight;
    else if (anchor?.element.isConnected) {
      const top = anchor.element.getBoundingClientRect().top
        - root.getBoundingClientRect().top;
      root.scrollTop += top - anchor.top;
    }
    rememberPosition();
  }
  root?.addEventListener('scroll', rememberPosition, {passive:true});
  // Only mounted messages are measured, including late image/formula layouts.
  const sizes = typeof ResizeObserver === 'function'
    ? new ResizeObserver(stabilize) : null;
  if (root) sizes?.observe(root);
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
        entry.target.style.minHeight = `${Math.max(1, entry.boundingClientRect.height)}px`;
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
      element.style.minHeight = `${item.type === 'commandExecution' ? 48 : 160}px`;
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
    following = true;
    anchor = null;
    scrollTop = root?.scrollTop;
  }
  return {update, remove, clear};
}
