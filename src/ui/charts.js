// Minimal canvas line/area charts for time series (no dependencies).

export function lineChart(canvas, { series, xMax, xLabel = 'h', yMin = 0, yMax = 1, yFmt = (v) => v, bands = [], markers = [], title = '' }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 140;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--muted').trim() || '#8b97a5';
  const grid = css.getPropertyValue('--grid').trim() || 'rgba(255,255,255,0.08)';
  const L = 38, R = 8, T = title ? 16 : 6, B = 18;
  const X = (x) => L + ((w - L - R) * x) / xMax;
  const Y = (y) => T + (h - T - B) * (1 - (y - yMin) / (yMax - yMin || 1));
  g.font = '10px system-ui, sans-serif';
  if (title) {
    g.fillStyle = fg;
    g.fillText(title, L, 11);
  }
  for (const b of bands) {
    g.fillStyle = b.color;
    g.fillRect(X(b.x0), T, X(b.x1) - X(b.x0), h - T - B);
  }
  g.strokeStyle = grid;
  g.fillStyle = fg;
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    g.beginPath();
    g.moveTo(L, Y(v));
    g.lineTo(w - R, Y(v));
    g.stroke();
    g.fillText(yFmt(v), 2, Y(v) + 3);
  }
  const step = xMax > 48 ? 24 : xMax > 24 ? 12 : 6;
  for (let x = 0; x <= xMax; x += step) {
    g.fillText(`${x}${xLabel}`, X(x) - 8, h - 4);
  }
  for (const s of series) {
    if (!s.pts.length) continue;
    g.beginPath();
    s.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    if (s.fill) {
      g.lineTo(X(s.pts[s.pts.length - 1][0]), Y(yMin));
      g.lineTo(X(s.pts[0][0]), Y(yMin));
      g.closePath();
      g.fillStyle = s.fill;
      g.fill();
      g.beginPath();
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    }
    g.strokeStyle = s.color;
    g.lineWidth = s.width || 1.6;
    g.setLineDash(s.dash || []);
    g.stroke();
    g.setLineDash([]);
  }
  for (const m of markers) {
    g.strokeStyle = m.color;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(X(m.x), T);
    g.lineTo(X(m.x), h - B);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = m.color;
    g.fillText(m.label, Math.min(X(m.x) + 3, w - 60), T + 10);
  }
}

export function legend(items) {
  return `<div class="legend">${items.map(([c, t, dash]) => `<span><i style="background:${c};${dash ? 'opacity:.6' : ''}"></i>${t}</span>`).join('')}</div>`;
}

/** Horizontal stacked bar (HTML) */
export function stackBar(parts, total, unit = '') {
  const sum = total ?? parts.reduce((s, p) => s + p.v, 0);
  return `<div class="stack">${parts
    .filter((p) => p.v > 0)
    .map((p) => `<span title="${p.name}: ${Math.round(p.v)}${unit}" style="width:${(100 * p.v) / sum}%;background:${p.color}"></span>`)
    .join('')}</div>`;
}
