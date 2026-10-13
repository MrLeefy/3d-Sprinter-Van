export const W = (w) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`);
export const Wh = (w) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kWh` : `${Math.round(w)} Wh`);
export const pct = (v) => `${Math.round(v * 100)} %`;
export const C = (t) => `${t.toFixed(1)} °C`;
export const L = (l) => `${l.toFixed(l < 10 ? 1 : 0)} L`;
export const kg = (m) => `${Math.round(m).toLocaleString('en-US')} kg`;
export const lb = (m) => `${Math.round(m * 2.20462).toLocaleString('en-US')} lb`;
export const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
export const mm = (m) => `${Math.round(m * 1000).toLocaleString('en-US')} mm`;
export const hhmm = (h) => {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const m = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
export const dur = (h) => {
  if (!isFinite(h)) return '∞';
  if (h > 72) return `${(h / 24).toFixed(1)} days`;
  if (h >= 1) return `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} m`;
  return `${Math.round(h * 60)} min`;
};
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Bind elements carrying data-b="key" for fast in-place updates. */
export function binder(root) {
  const map = {};
  for (const el of root.querySelectorAll('[data-b]')) map[el.dataset.b] = el;
  return {
    t(k, v) {
      const el = map[k];
      if (el && el.textContent !== String(v)) el.textContent = v;
    },
    h(k, v) {
      const el = map[k];
      if (el && el._h !== v) {
        el.innerHTML = v;
        el._h = v;
      }
    },
    w(k, frac, color) {
      const el = map[k];
      if (!el) return;
      el.style.width = `${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%`;
      if (color) el.style.background = color;
    },
    s(k, prop, v) {
      const el = map[k];
      if (el) el.style[prop] = v;
    },
    el: (k) => map[k],
  };
}
