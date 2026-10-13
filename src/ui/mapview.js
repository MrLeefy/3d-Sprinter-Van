// 2-D map drawing shared by the minimap and the full-screen map (north is up; +x east, +z south).
import { S, ROAD } from '../world/gen.js';

const ROAD_COL = { interstate: '#ffffff', highway: '#ffd966', county: '#e8e8e8', gravel: '#c9b48c', dirt: '#8f7552' };
const ROAD_W = { interstate: 4, highway: 3, county: 2, gravel: 1.4, dirt: 1 };
const KIND_COL = { city: '#ff6b5e', town: '#ffa23d', village: '#ffe14d', farm: '#9be37a', lodge: '#7cc7ff', truckstop: '#e78bff', camp: '#4ed39a', junction: '#c8c8c8' };

/**
 * o: { w, h, cx, cz, mpp, van:{x,z,yaw}, trail, home, frozen, labels, route:[{x,z}], waypoint:{x,z}, visited:Set, accent }
 */
export function drawWorldMap(g, W, o) {
  const { w, h, cx, cz, mpp } = o;
  const X = (x) => w / 2 + (x - cx) / mpp, Y = (z) => h / 2 + (z - cz) / mpp;
  const rx = (w / 2) * mpp, rz = (h / 2) * mpp;
  g.clearRect(0, 0, w, h);
  g.fillStyle = o.bg || '#2a3a2c';
  g.fillRect(0, 0, w, h);
  // lakes
  const a0 = Math.floor((cx - rx - 1500) / 3600), a1 = Math.floor((cx + rx + 1500) / 3600), b0 = Math.floor((cz - rz - 1500) / 3600), b1 = Math.floor((cz + rz + 1500) / 3600);
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      const l = W.lakeCell(a, b);
      if (!l) continue;
      g.fillStyle = o.frozen ? 'rgba(196,222,238,0.95)' : 'rgba(62,128,186,0.95)';
      g.beginPath();
      g.ellipse(X(l.cx), Y(l.cz), Math.max(1.5, (l.R * l.asp) / mpp), Math.max(1.5, l.R / mpp), l.ang, 0, Math.PI * 2);
      g.fill();
    }
  }
  // settlements: footprints
  const i0 = Math.floor((cx - rx) / S) - 1, i1 = Math.floor((cx + rx) / S) + 1, j0 = Math.floor((cz - rz) / S) - 1, j1 = Math.floor((cz + rz) / S) + 1;
  const nodes = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) nodes.push(W.node(i, j));
  for (const n of nodes) {
    if (n.kind === 'junction') continue;
    g.fillStyle = n.kind === 'city' || n.kind === 'town' ? 'rgba(170,160,140,0.55)' : 'rgba(150,140,120,0.45)';
    g.beginPath();
    g.ellipse(X(n.x), Y(n.z), Math.max(2, n.Rp / mpp), Math.max(2, n.Rz / mpp), 0, 0, Math.PI * 2);
    g.fill();
  }
  // roads: real paths where built, straight links elsewhere
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const cls of ['dirt', 'gravel', 'county', 'highway', 'interstate']) {
    g.strokeStyle = ROAD_COL[cls];
    g.lineWidth = Math.max(1, ROAD_W[cls] * Math.min(1.6, 5 / Math.sqrt(mpp)));
    g.beginPath();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (let dir = 0; dir < 2; dir++) {
          if (!W.edgeExists(i, j, dir) || W.edgeClass(i, j, dir) !== cls) continue;
          const e = W.edges.get(`${i},${j},${dir}`);
          if (e) {
            const st = Math.max(1, Math.round((mpp * 1.5) / 8));
            g.moveTo(X(e.xs[0]), Y(e.zs[0]));
            for (let k = st; k < e.n; k += st) g.lineTo(X(e.xs[k]), Y(e.zs[k]));
            g.lineTo(X(e.xs[e.n - 1]), Y(e.zs[e.n - 1]));
          } else {
            const a = W.node(i, j), b = dir === 0 ? W.node(i + 1, j) : W.node(i, j + 1);
            const pa = dir === 0 ? a.portE : a.portS, pb = dir === 0 ? b.portW : b.portN;
            g.moveTo(X(pa[0]), Y(pa[1]));
            g.lineTo(X(pb[0]), Y(pb[1]));
          }
        }
      }
    }
    g.stroke();
  }
  // GPS route
  if (o.route && o.route.length > 1) {
    g.strokeStyle = '#3aa0ff';
    g.lineWidth = Math.max(3, 6 / Math.sqrt(Math.max(1, mpp / 6)));
    g.globalAlpha = 0.85;
    g.beginPath();
    o.route.forEach((p, k) => (k ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
    g.stroke();
    g.globalAlpha = 1;
  }
  // settlement dots and names
  const showAll = mpp < 14;
  for (const n of nodes) {
    if (n.kind === 'junction') continue;
    const px = X(n.x), py = Y(n.z);
    if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
    const big = n.kind === 'city' || n.kind === 'town';
    g.fillStyle = KIND_COL[n.kind];
    g.strokeStyle = o.visited?.has(n.key) ? '#ffffff' : 'rgba(0,0,0,0.6)';
    g.lineWidth = o.visited?.has(n.key) ? 2 : 1;
    g.beginPath();
    g.arc(px, py, n.kind === 'city' ? 5 : big ? 4 : 3, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (o.labels && (big || (showAll && n.kind === 'village'))) {
      g.font = `${n.kind === 'city' ? 700 : 600} ${n.kind === 'city' ? 13 : 11}px system-ui, sans-serif`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(n.name, px + 7, py + 4);
      g.fillStyle = '#fff';
      g.fillText(n.name, px + 7, py + 4);
    }
  }
  // trail, home, waypoint, van
  if (o.trail?.length > 1) {
    g.strokeStyle = o.accent || '#ff8a3d';
    g.lineWidth = 1.6;
    g.beginPath();
    o.trail.forEach(([x, z], k) => (k ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))));
    g.stroke();
  }
  if (o.home) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(X(o.home.x), Y(o.home.z), 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    g.font = '700 8px system-ui';
    g.fillText('⌂', X(o.home.x) - 3, Y(o.home.z) + 3);
  }
  if (o.waypoint) {
    const px = X(o.waypoint.x), py = Y(o.waypoint.z);
    g.fillStyle = '#3aa0ff';
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - 6, py - 14);
    g.lineTo(px + 6, py - 14);
    g.closePath();
    g.fill();
  }
  if (o.van) {
    g.save();
    g.translate(X(o.van.x), Y(o.van.z));
    g.rotate(-o.van.yaw);
    g.fillStyle = o.accent || '#ff8a3d';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-6, -5.5);
    g.lineTo(-3, 0);
    g.lineTo(-6, 5.5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = '700 11px system-ui, sans-serif';
  g.fillText('N', w / 2 - 4, 13);
}

export { ROAD };
