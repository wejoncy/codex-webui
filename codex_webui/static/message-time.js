// Persisted lifecycle times are authoritative. The local time is only for
// optimistic messages and live events whose recorded time has not arrived.
export function renderMessageTime(element, item) {
  const timestamp = [item.startedAtMs, item.completedAtMs, item._timestampMs].find(
    value => typeof value === 'number' && value >= 0
      && Number.isFinite(new Date(value).getTime()));
  if (timestamp === undefined) {
    element.textContent = '时间未知';
    element.removeAttribute('datetime');
    element.title = '这条消息没有可用的时间记录';
    return;
  }
  const date = new Date(timestamp), pad = value => String(value).padStart(2, '0');
  element.textContent = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  element.setAttribute('datetime', date.toISOString());
  element.title = `${element.textContent}（本地时间）`;
}
