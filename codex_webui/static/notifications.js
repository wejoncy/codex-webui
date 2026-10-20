import {$} from './dom.js';
export function createNotifications() {
  let toastTimer;
  function clearToast() { clearTimeout(toastTimer); $('toast').hidden = true; $('toast-text').textContent = ''; }
  function toast(message, error = false) { $('toast-text').textContent = message; $('toast').hidden = false; $('toast').classList.toggle('error', error); clearTimeout(toastTimer); toastTimer = setTimeout(clearToast, 1000); }
  function notice(message = '', error = false) {
    $('notice-text').textContent = error ? '' : message;
    $('notice').hidden = error || !message;
    if (error && message) toast(message, true);
  }
  function report(error) { console.error(error); toast(error.message || String(error), true); }

  return {clearToast,toast,notice,report};
}
