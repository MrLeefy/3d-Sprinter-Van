// Full-screen map and GPS. The map is pannable and zoomable; tapping a settlement offers
// "Navigate", tapping empty ground drops a waypoint. A route is planned over the road network and
// followed with turn-by-turn guidance in the HUD card and a blue line on both maps.
import { drawWorldMap } from './mapview.js';
import { KIND_LABEL, S } from '../world/gen.js';
import { layoutOf } from '../world/layout.js';
import { planRoute, bearing } from '../world/route.js';

const ICON = { fuel: '⛽', water: '🚰', dump: '♻', camp: '⛺', shop: '🛒' };
const TURN_ICON = { left: '↰', right: '↱', straight: '↑', arrive: '⚑', depart: '↑', enter: '⌂' };

export function fmtDistance(m, units) {
  if (units === 'mph') {
    const mi = m / 1609.34;
    return mi >= 9.95 ? `${Math.round(mi)} mi` : mi >= 0.19 ? `${mi.toFixed(1)} mi` : `${Math.round((m * 3.281) / 50) * 50} ft`;
  }
  return m >= 9950 ? `${Math.round(m / 1000)} km` : m >= 190 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

export function fmtTime(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export class MapScreen {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.W = ui.world.gen;
    this.D = ui.D;
    this.open = false;
    this.cx = 0;
    this.cz = 0;
    this.mpp = 12;
    this.route = null;
    this.dst = null;
    this.waypoint = null;
    this.routeIdx = 0;
    this.off = 0;
    this.sel = null;
    this.dirty = true;
    this.t = 0;
    this.pts = [];
    this.ptsN = 0;
    this.build();
    ui.modules.push(this);
    ui.mapExtras = () => ({ route: this.pts, waypoint: this.waypoint, visited: ui.passport?.visited });
    // restore the last destination so a reload does not lose the trip
  }

  get units() {
    return this.ui.s.units;
  }

  build() {
    const root = this.ui.root;
    const el = document.createElement('div');
    el.className = 'dh-mapscreen';
    el.hidden = true;
    el.innerHTML = `
      <canvas id="msCanvas" aria-label="World map"></canvas>
      <div class="ms-top"><b>Map</b><button class="dh-btn" id="msFuel">⛽ Nearest fuel</button><button class="dh-btn" id="msWater">🚰 Water</button><span class="ms-hint">Drag to pan · pinch or scroll to zoom · tap a town to navigate · tap empty ground for a waypoint</span><button class="dh-btn primary" id="msClose">Close · M</button></div>
      <div class="ms-ctl"><button id="msIn" aria-label="Zoom in">＋</button><button id="msOut" aria-label="Zoom out">−</button><button id="msVan" aria-label="Centre on the van">◎</button><button id="msHome" aria-label="Show the starting camp">⌂</button></div>
      <div class="ms-card" id="msCard" hidden></div>
      <div class="ms-legend"><span><i style="background:#fff"></i>Interstate</span><span><i style="background:#ffd966"></i>Highway</span><span><i style="background:#e8e8e8"></i>County</span><span><i style="background:#c9b48c"></i>Gravel</span><span><i style="background:#8f7552"></i>Track</span><span class="b"><i style="background:#3aa0ff"></i>Route</span></div>`;
    root.appendChild(el);
    this.el = el;
    this.cv = el.querySelector('#msCanvas');
    this.card = el.querySelector('#msCard');
    // GPS card in the HUD slot
    const gps = document.createElement('div');
    gps.className = 'dh-gps';
    gps.hidden = true;
    gps.innerHTML = '<div class="gp-ic" id="gpIc">↑</div><div class="gp-tx"><b id="gpMain"></b><span id="gpSub"></span></div><button class="gp-x" id="gpX" aria-label="End navigation">×</button>';
    root.querySelector('#dhSlot').appendChild(gps);
    this.gps = gps;
    gps.querySelector('#gpX').addEventListener('click', () => this.clear());
    gps.addEventListener('click', (e) => e.target.id !== 'gpX' && this.openMap());
    el.querySelector('#msClose').addEventListener('click', () => this.closeMap());
    const quick = (id, type, label) => el.querySelector(id).addEventListener('click', () => {
      const r = this.ui.services?.nearest(type, this.D.x, this.D.z);
      if (!r) return this.app.toast(`No ${label} found within 40 km.`);
      this.navigate(r.node);
      this.closeMap();
    });
    quick('#msFuel', 'fuel', 'fuel');
    quick('#msWater', 'water', 'water');
    el.querySelector('#msIn').addEventListener('click', () => this.zoom(0.6));
    el.querySelector('#msOut').addEventListener('click', () => this.zoom(1.67));
    el.querySelector('#msVan').addEventListener('click', () => this.centreOnVan());
    el.querySelector('#msHome').addEventListener('click', () => {
      this.cx = this.W.home.x;
      this.cz = this.W.home.z;
      this.dirty = true;
    });
    this.bindPointer();
    window.addEventListener('resize', () => this.open && this.resize());
  }

  bindPointer() {
    const cv = this.cv;
    const ptrs = new Map();
    let moved = 0, t0 = 0, pinch = 0;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture?.(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        moved = 0;
        t0 = performance.now();
      }
      pinch = 0;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (ptrs.size === 1) {
        this.cx -= dx * this.mpp;
        this.cz -= dy * this.mpp;
        moved += Math.abs(dx) + Math.abs(dy);
        this.dirty = true;
      } else if (ptrs.size === 2) {
        const o = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
        const d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        if (d0 > 10) this.zoom(d0 / d1);
        moved += 20;
      }
      p.x = e.clientX;
      p.y = e.clientY;
    });
    const up = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0 && moved < 8 && performance.now() - t0 < 450 && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2;
      const f = Math.exp(e.deltaY * 0.0015);
      const wx = this.cx + px * this.mpp, wz = this.cz + py * this.mpp;
      this.zoom(f);
      this.cx = wx - px * this.mpp;
      this.cz = wz - py * this.mpp;
    }, { passive: false });
    void pinch;
  }

  zoom(f) {
    this.mpp = Math.max(2.5, Math.min(90, this.mpp * f));
    this.dirty = true;
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  openMap() {
    this.open = true;
    this.el.hidden = false;
    this.card.hidden = true;
    this.sel = null;
    this.resize();
    this.centreOnVan();
    if (this.mpp < 6) this.mpp = 12;
  }

  closeMap() {
    this.open = false;
    this.el.hidden = true;
  }

  escape() {
    if (!this.open) return false;
    if (!this.card.hidden) this.card.hidden = true;
    else this.closeMap();
    return true;
  }

  onKeyOpen() {
    this.open ? this.closeMap() : this.openMap();
  }

  centreOnVan() {
    this.cx = this.D.x;
    this.cz = this.D.z;
    this.dirty = true;
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.max(200, Math.round(r.width * dpr));
    this.cv.height = Math.max(200, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.dirty = true;
  }

  onShow() {
    if (!this.cx && !this.cz) this.centreOnVan();
  }

  onHide() {
    this.closeMap();
  }

  // ── Interaction ────────────────────────────────────────────────────────────
  worldAt(clientX, clientY) {
    const r = this.cv.getBoundingClientRect();
    return { x: this.cx + (clientX - r.left - r.width / 2) * this.mpp, z: this.cz + (clientY - r.top - r.height / 2) * this.mpp };
  }

  tap(clientX, clientY) {
    const p = this.worldAt(clientX, clientY);
    const W = this.W;
    let best = null, bd = 1e18;
    const reach = 26 * this.mpp;
    for (let i = Math.floor((p.x - reach) / S) - 1; i <= Math.floor((p.x + reach) / S) + 1; i++) {
      for (let j = Math.floor((p.z - reach) / S) - 1; j <= Math.floor((p.z + reach) / S) + 1; j++) {
        const n = W.node(i, j);
        if (n.kind === 'junction') continue;
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
    }
    if (best && bd < reach) this.showNode(best);
    else this.showPoint(p);
  }

  services(n) {
    const types = [...new Set(layoutOf(this.W, n).zones.map((z) => z.type))];
    return types.map((t) => `${ICON[t] || ''} ${{ fuel: 'Diesel', water: 'Fresh water', dump: 'Dump station', camp: 'Camping', shop: 'Groceries' }[t] || t}`);
  }

  showNode(n) {
    this.sel = { node: n };
    const D = this.D;
    const dist = Math.hypot(n.x - D.x, n.z - D.z);
    const ft = Math.round(n.elevM * 3.281).toLocaleString('en-US');
    const sv = this.services(n);
    const visited = this.ui.passport?.visited?.has(n.key);
    this.card.hidden = false;
    this.card.innerHTML = `<div class="mc-h"><b>${n.name}</b><span>${KIND_LABEL[n.kind] || n.kind}${visited ? ' · visited ✓' : ''}</span></div>
      <p>${n.pop ? `Pop. ${n.pop.toLocaleString('en-US')} · ` : ''}elev. ${ft} ft · ${fmtDistance(dist, this.units)} as the crow flies</p>
      ${sv.length ? `<p class="mc-sv">${sv.join(' &nbsp; ')}</p>` : ''}
      <div class="mc-b"><button class="dh-btn primary" id="mcGo">Navigate</button><button class="dh-btn" id="mcWp">Waypoint</button><button class="dh-btn" id="mcX">Close</button></div>`;
    this.card.querySelector('#mcGo').addEventListener('click', () => {
      this.navigate(n);
      this.card.hidden = true;
    });
    this.card.querySelector('#mcWp').addEventListener('click', () => {
      this.setWaypoint({ x: n.x, z: n.z, name: n.name });
      this.card.hidden = true;
    });
    this.card.querySelector('#mcX').addEventListener('click', () => (this.card.hidden = true));
    this.dirty = true;
  }

  showPoint(p) {
    const D = this.D;
    this.sel = { point: p };
    this.card.hidden = false;
    this.card.innerHTML = `<div class="mc-h"><b>Drop a waypoint here?</b></div>
      <p>${fmtDistance(Math.hypot(p.x - D.x, p.z - D.z), this.units)} away. A waypoint shows a bearing arrow and distance in the HUD.</p>
      <div class="mc-b"><button class="dh-btn primary" id="mcWp">Set waypoint</button><button class="dh-btn" id="mcX">Cancel</button></div>`;
    this.card.querySelector('#mcWp').addEventListener('click', () => {
      this.setWaypoint({ x: p.x, z: p.z, name: 'Waypoint' });
      this.card.hidden = true;
    });
    this.card.querySelector('#mcX').addEventListener('click', () => (this.card.hidden = true));
  }

  setWaypoint(w) {
    this.clear(true);
    this.waypoint = w;
    this.app.toast(`Waypoint set: ${w.name}. Follow the arrow in the HUD.`);
    this.dirty = true;
  }

  navigate(n) {
    const D = this.D;
    const t0 = performance.now();
    const r = planRoute(this.W, { x: D.x, z: D.z }, n);
    if (!r) {
      this.app.toast(`No road route found to ${n.name}.`);
      return;
    }
    this.clear(true);
    this.route = r;
    this.dst = n;
    this.waypoint = null;
    this.routeIdx = 0;
    this.off = 0;
    r.step(2);
    this.pts = [];
    this.ptsN = 0;
    this.syncPts();
    const dist = r.length || Math.hypot(n.x - D.x, n.z - D.z) * 1.2;
    this.app.toast(`Route to ${n.name}: about ${fmtDistance(Math.max(dist, r.time * 20), this.units)}, ${fmtTime(r.time)}. Follow the blue line.`);
    void t0;
    this.dirty = true;
  }

  clear(silent = false) {
    if (this.route && !silent) this.app.toast('Navigation ended.');
    this.route = null;
    this.dst = null;
    this.waypoint = null;
    this.pts = [];
    this.ptsN = 0;
    this.gps.hidden = true;
    this.dirty = true;
  }

  syncPts() {
    const r = this.route;
    if (!r) return;
    for (let i = this.ptsN; i < r.xs.length; i += 3) this.pts.push({ x: r.xs[i], z: r.zs[i] });
    if (r.done) this.pts.push({ x: r.xs[r.xs.length - 1], z: r.zs[r.zs.length - 1] });
    this.ptsN = r.xs.length - (r.xs.length % 3);
  }

  // ── Per frame ──────────────────────────────────────────────────────────────
  tick(dt) {
    const D = this.D;
    this.t -= dt;
    const r = this.route;
    if (r && !r.done) {
      r.step(1);
      this.syncPts();
    }
    if (this.t > 0) return;
    this.t = this.open ? 0.2 : 0.3;
    if (r) this.guide();
    else if (this.waypoint) this.pointer();
    else this.gps.hidden = true;
    if (this.open && (this.dirty || r || true)) this.draw();
    void D;
  }

  guide() {
    const D = this.D, r = this.route, units = this.units;
    const p = r.locate(D.x, D.z, this.routeIdx);
    this.routeIdx = p.i;
    if (p.d > 140) this.off += 0.3;
    else this.off = 0;
    if (this.off > 4 && r.done) {
      this.off = 0;
      const dst = this.dst;
      this.app.toast('Off route — recalculating…');
      const nr = planRoute(this.W, { x: D.x, z: D.z }, dst);
      if (nr) {
        this.route = nr;
        this.routeIdx = 0;
        this.pts = [];
        this.ptsN = 0;
        nr.step(2);
      }
      return;
    }
    const remain = Math.max(0, r.length - p.s);
    if (r.done && remain < 45) {
      this.app.toast(`You have arrived in ${this.dst.name}.`);
      this.clear(true);
      return;
    }
    const m = r.nextManeuver(p.s);
    const speed = Math.max(10, Math.min(30, Math.abs(D.v) * 0.8 + 6));
    this.gps.hidden = false;
    const ic = this.gps.querySelector('#gpIc'), main = this.gps.querySelector('#gpMain'), sub = this.gps.querySelector('#gpSub');
    if (!r.done) {
      ic.textContent = '…';
      main.textContent = 'Planning the route…';
      sub.textContent = `to ${this.dst.name || 'the junction'}`;
      return;
    }
    if (m) {
      const dm = Math.max(0, m.s - p.s);
      ic.textContent = TURN_ICON[m.kind] || '↑';
      ic.className = `gp-ic ${m.kind}`;
      main.textContent = m.kind === 'arrive' ? `${fmtDistance(dm, units)} to ${this.dst.name}` : dm < 60 ? m.text : `In ${fmtDistance(dm, units)}: ${m.text}`;
    }
    sub.textContent = `${this.dst.name} · ${fmtDistance(remain, units)} · ${fmtTime(remain / speed)}`;
  }

  pointer() {
    const D = this.D, w = this.waypoint;
    const dx = w.x - D.x, dz = w.z - D.z, d = Math.hypot(dx, dz);
    if (d < 25) {
      this.app.toast(`Waypoint reached: ${w.name}.`);
      this.clear(true);
      return;
    }
    const rel = ((bearing(D.x, D.z, w.x, w.z) - D.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // + = to the left
    this.gps.hidden = false;
    const ic = this.gps.querySelector('#gpIc');
    ic.textContent = '➤';
    ic.className = 'gp-ic arrow';
    ic.style.transform = `rotate(${-(rel * 180) / Math.PI}deg)`;
    this.gps.querySelector('#gpMain').textContent = `${w.name} · ${fmtDistance(d, this.units)}`;
    this.gps.querySelector('#gpSub').textContent = Math.abs(rel) < 0.3 ? 'Straight ahead' : rel > 0 ? 'Bear left' : 'Bear right';
  }

  draw() {
    const cv = this.cv, g = cv.getContext('2d');
    const D = this.D, W = this.W;
    if (!cv.width) this.resize();
    const dpr = this.dpr || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWorldMap(g, W, {
      w: cv.width / dpr, h: cv.height / dpr, cx: this.cx, cz: this.cz, mpp: this.mpp, van: { x: D.x, z: D.z, yaw: D.yaw }, trail: D.trail, home: W.home, labels: true,
      frozen: this.ui.world.terrain.season.u.uIce.value > 0.5, accent: getComputedStyle(this.app.root).getPropertyValue('--accent') || '#ff8a3d',
      route: this.pts, waypoint: this.waypoint, visited: this.ui.passport?.visited, pois: this.ui.passport?.mapPois(), bg: '#26362a',
    });
    this.dirty = false;
  }

  onUse() {}
  onDriveEvent() {}
}
