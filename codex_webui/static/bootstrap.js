// Capture startup failures before loading the application module graph.
let reports = 0;
function report(error, source = '') {
  console.error(error);
  if (reports++ >= 5) return;
  fetch('/api/client-error', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:String(error?.message || error).slice(0,2000), source:String(error?.stack || source).slice(0,500)}),
  }).catch(() => {});
}
window.addEventListener('error', event => report(event.error || event.message, event.filename));
window.addEventListener('unhandledrejection', event => report(event.reason));
import('./app.js').catch(error => {
  report(error, 'app.js');
  const label = document.getElementById('connection-label');
  label.textContent = '页面启动失败'; label.title = error.message;
});
