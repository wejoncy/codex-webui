// Transport only: callers supply authentication and connection UI callbacks.
export function createClient({onUnauthorized}) {
  let socket, timer, delay = 1000, generation = 0;
  async function api(path, body) {
    const response = await fetch(`/api/${path}`, {
      method:body === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json'},
      body:body === undefined ? undefined : JSON.stringify(body),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`服务返回了无效响应 (${response.status})`); }
    if (response.status === 401) { onUnauthorized(); throw new Error('需要访问密钥'); }
    if (!response.ok) {
      const error = new Error(data.error?.message || data.detail || `请求失败 (${response.status})`);
      error.data = data.error?.data;
      throw error;
    }
    return data;
  }
  async function rpc(method, params = {}, executionSettings = {}) {
    const execution = ['thread/start','thread/resume','turn/start'].includes(method);
    return (await api('rpc', {method, params, ...(execution ? executionSettings : {})})).result;
  }
  function openSocket(handlers) {
    clearTimeout(timer);
    const current = ++generation;
    if (socket) { socket.onclose = null; socket.close?.(); }
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket.onopen = async () => {
      const reconnecting = delay > 1000; delay = 1000;
      if (reconnecting) { try { await handlers.onReconnect(); } catch (error) { handlers.onError(error); } }
    };
    socket.onmessage = ({data}) => {
      if (current !== generation) return;
      try { handlers.onEvent(JSON.parse(data)); } catch (error) { handlers.onError(error); }
    };
    socket.onclose = event => {
      if (current !== generation) return;
      if (event.code === 1008) { onUnauthorized(); return; }
      delay = Math.min(delay * 1.7,15000);
      timer = setTimeout(() => openSocket(handlers),delay);
      handlers.onDisconnect();
    };
  }
  return {api, rpc, openSocket, get socket() { return socket; }};
}
