// Navigate article placeholders without rendering or indexing message bodies.
export function createMessageNavigation({root, messages, button, context, loadOlder, pauseFollowing, report}) {
  const inset = 12;
  let busy = false, scheduled = false;

  function previousMessage() {
    const users = messages.getElementsByClassName('user-message');
    const top = root.getBoundingClientRect().top + inset - 2;
    let low = 0, high = users.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (users[middle].getBoundingClientRect().top < top) low = middle + 1;
      else high = middle;
    }
    return users[low - 1] || null;
  }

  function refresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const current = context();
      button.hidden = !current;
      button.disabled = !current || busy || current.loading || (!current.cursor && !previousMessage());
    });
  }

  async function previous() {
    const start = context();
    if (busy || !start || start.loading) return;
    const isCurrent = () => context()?.key === start.key;
    busy = true;
    pauseFollowing();
    refresh();
    try {
      let target = previousMessage();
      while (!target && isCurrent() && context().cursor) {
        const cursor = context().cursor;
        await loadOlder();
        if (!isCurrent()) return;
        target = previousMessage();
        if (context().cursor === cursor) break;
      }
      if (target?.isConnected && isCurrent()) {
        root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - inset;
      }
    } catch (error) {
      if (isCurrent()) report(error);
    } finally {
      busy = false;
      refresh();
    }
  }

  button.onclick = previous;
  return {refresh};
}
