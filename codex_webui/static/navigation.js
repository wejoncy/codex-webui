export function sessionFromURL() {
  return new URL(location.href).searchParams.get('session') || null;
}

export function setSessionURL(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('session', id);
  else url.searchParams.delete('session');
  if (url.href !== location.href) history.pushState(null, '', url.href);
}
