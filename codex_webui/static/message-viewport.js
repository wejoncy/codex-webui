// Keep expensive message contents only near the scroll viewport. Empty article
// placeholders retain measured heights, so unloading never collapses history.
export function createMessageViewport({root, render, release}) {
  const records = new Map();
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target);
      if (!record) continue;
      if (!entry.target.isConnected) { remove(entry.target); continue; }
      if (entry.isIntersecting) {
        if (!record.visible) { record.visible = true; draw(entry.target, record); }
      } else if (record.visible) {
        record.visible = false;
        entry.target.style.minHeight = `${Math.max(1, entry.boundingClientRect.height)}px`;
        release(entry.target);
        entry.target.replaceChildren();
        entry.target.dataset.placeholder = 'true';
      }
    }
  }, {root, rootMargin:'600px 0px'}) : null;

  function draw(element, record) {
    const scrollTop = root?.scrollTop;
    const atBottom = root && root.scrollHeight - scrollTop - root.clientHeight < 2;
    element.dataset.placeholder = 'false';
    render(element, record.item, record.streaming, () => {
      if (records.get(element) !== record || !record.visible) return;
      element.style.minHeight = '';
      // Expanding estimated placeholders at the end must not push the newest
      // message out of view. Respect a user who scrolled away while parsing.
      if (atBottom && root.scrollTop >= scrollTop - 1) root.scrollTop = root.scrollHeight;
    });
  }
  function update(element, item, streaming) {
    let record = records.get(element);
    if (!record) {
      record = {visible: !observer}; records.set(element, record);
      element.style.minHeight = `${item.type === 'commandExecution' ? 48 : 160}px`;
      element.dataset.placeholder = 'true';
      observer?.observe(element);
    }
    record.item = item; record.streaming = streaming;
    if (record.visible) draw(element, record);
  }
  function remove(element) {
    observer?.unobserve(element); records.delete(element); release(element);
  }
  function clear() {
    observer?.disconnect();
    for (const element of records.keys()) release(element);
    records.clear();
  }
  return {update, remove, clear};
}
