export const $ = id => document.getElementById(id);
const iconPaths = {
  plus:'M12 5v14M5 12h14', search:'m21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  flask:'M9 3h6M10 3v6L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3M8 14h8',
  settings:'m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3H9M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  folder:'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  moon:'M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z',
  sun:'M12 3V1m0 22v-2M3 12H1m22 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4m0-12.8 1.4-1.4M4.2 19.8l1.4-1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  code:'m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16',
  sigma:'M18 4H6l7 8-7 8h12', image:'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 14 5-5 4 4 4-6 5 7M9 7h.01',
  'arrow-up-right':'M6 18 18 6M6 6h12v12', 'arrow-right':'M4 12h16m-6-6 6 6-6 6',
  'arrow-up':'M12 20V4m-6 6 6-6 6 6', 'arrow-down':'M12 4v16m-6-6 6 6 6-6',
  sparkles:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  shield:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6',
  'shield-question':'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4ZM9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01',
  'lock-open':'M8 10V7a4 4 0 0 1 7.5-2M5 10h14v11H5V10Zm7 5v2',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z',
  'globe-off':'m3 3 18 18M10 3.2A9 9 0 0 1 20.8 14M6 5.3A9 9 0 0 0 18.7 18M3 12h9m4 0h5M10 6a17 17 0 0 0 2 15 17 17 0 0 0 2.3-5',
  x:'m6 6 12 12M6 18 18 6', zap:'m13 2-9 12h7l-1 8 10-12h-7l1-8Z',
  menu:'M4 6h16M4 12h16M4 18h16', copy:'M8 8h12v12H8zM4 16H3V3h13v1',
  edit:'m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5',
  'external-link':'M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6',
  chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z',
  terminal:'m5 7 5 5-5 5m8 0h6', file:'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 13h8M8 17h6',
};
export function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPaths[name] || iconPaths.sparkles}"/></svg>`; }
export function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
