// Roadside discoveries (pure, deterministic): every built road edge carries a few points of interest
// a short way off the carriageway — overlooks, historical markers, hot springs, odd statues, ghost
// mines. They are found by driving close; the renderer draws a marker sign and a type-specific prop.
import { hash2, hashStr } from './noise.js';

export const POI_TYPES = {
  overlook: { label: 'Scenic overlook', icon: '🏞', reward: 25, blurb: 'The whole valley opens up below the guard rail.' },
  lakeview: { label: 'Lake viewpoint', icon: '🌊', reward: 25, blurb: 'A turnout with a bench and a very good view of the water.' },
  marker: { label: 'Historical marker', icon: '📜', reward: 15, blurb: 'A weathered plaque about something that happened here, probably.' },
  mine: { label: 'Abandoned mine', icon: '⛏', reward: 30, blurb: 'A timber headframe and a lot of rust. Look, do not enter.' },
  spring: { label: 'Hot spring', icon: '♨', reward: 40, blurb: 'A steaming pool just off the road. Bring a towel.' },
  oddity: { label: 'Roadside oddity', icon: '🗿', reward: 35, blurb: 'It is exactly as big as the billboards promised.' },
  barn: { label: 'Old barn', icon: '🏚', reward: 15, blurb: 'A leaning barn with a faded painted advertisement.' },
  tree: { label: 'Giant tree', icon: '🌲', reward: 20, blurb: 'It has been standing here since before the road.' },
  rest: { label: 'Rest area', icon: '🪑', reward: 10, blurb: 'Picnic tables, a map board and a very cold water fountain.' },
};

const ADJ = ['Lone', 'Windy', 'Copper', 'Old', 'Big', 'Silver', 'Eagle', 'Lost', 'Red', 'Sunrise', 'Painted', 'Crooked', 'Quiet', 'Dry', 'Golden'];
const NOUN = {
  overlook: ['Overlook', 'Vista', 'Point', 'Lookout'], lakeview: ['Lake View', 'Shore Turnout', 'Bay Overlook'], marker: ['Crossing Marker', 'Trail Marker', 'Homestead Plaque'],
  mine: ['Mine', 'Diggings', 'Shaft', 'Claim'], spring: ['Hot Springs', 'Warm Pool', 'Steam Hollow'], oddity: ['Prairie Dog', 'Bison Statue', 'Cowboy Boot', 'Trout', 'Sasquatch'],
  barn: ['Barn', 'Homestead', 'Granary'], tree: ['Cottonwood', 'Pine', 'Aspen Grove'], rest: ['Rest Area', 'Picnic Stop', 'Wayside'],
};
const ODDITY = { 'Prairie Dog': "World's Largest Prairie Dog", 'Bison Statue': 'Big Bison (fibreglass)', 'Cowboy Boot': 'Giant Cowboy Boot', Trout: 'Trout Fit For A Billboard', Sasquatch: 'Sasquatch Crossing' };

/** Points of interest along one built edge (cached on the edge). */
export function poisOf(W, e) {
  if (e._pois) return e._pois;
  const out = [];
  const count = Math.min(3, Math.floor((e.len / 1800) * (0.4 + 1.2 * hash2(hashStr(e.id), 3, 91))));
  for (let q = 0; q < count; q++) {
    const h = (k) => hash2(hashStr(e.id), q * 7 + k, 92);
    const s = e.len * (0.12 + 0.76 * ((q + 0.15 + 0.7 * h(1)) / count));
    let k = Math.min(e.n - 2, Math.max(1, Math.round((s / e.len) * (e.n - 1))));
    const tx = e.xs[k + 1] - e.xs[k - 1], tz = e.zs[k + 1] - e.zs[k - 1], l = Math.hypot(tx, tz) || 1;
    const side = h(2) < 0.7 ? 1 : -1; // mostly on the right of the direction of travel
    const off = side * (e.P.width / 2 + 18 + h(3) * 26);
    const x = e.xs[k] + (-tz / l) * off, z = e.zs[k] + (tx / l) * off;
    if (W.settlementAt(x, z, 60)) continue;
    const lakes = W.lakesNear(x, z);
    if (lakes.some((lk) => W.lakeRn(lk, x, z) < 1.12)) continue;
    const y = W.heightAt(x, z);
    let type;
    const near = lakes.some((lk) => W.lakeRn(lk, x, z) < 1.9);
    if (near && h(4) < 0.8) type = 'lakeview';
    else if (y > e.hs[k] + 9 && h(4) < 0.85) type = 'overlook';
    else type = ['marker', 'marker', 'mine', 'spring', 'oddity', 'oddity', 'barn', 'tree', 'rest', 'rest'][Math.floor(h(5) * 10)];
    const noun = NOUN[type][Math.floor(h(6) * NOUN[type].length)];
    const name = type === 'oddity' ? ODDITY[noun] : `${ADJ[Math.floor(h(7) * ADJ.length)]} ${noun}`;
    // the marker faces the road: its normal points from the POI toward the carriageway
    const yaw = Math.atan2(side * (tz / l), -side * (tx / l));
    out.push({ id: `${e.id}#${q}`, type, name, x, z, y, yaw, edge: e.id, reward: POI_TYPES[type].reward, side, k });
  }
  e._pois = out;
  return out;
}

function bboxOf(e) {
  if (e.minx === undefined) {
    let a = 1e18, b = -1e18, c = 1e18, d = -1e18;
    for (let k = 0; k < e.n; k++) {
      a = Math.min(a, e.xs[k]);
      b = Math.max(b, e.xs[k]);
      c = Math.min(c, e.zs[k]);
      d = Math.max(d, e.zs[k]);
    }
    e.minx = a;
    e.maxx = b;
    e.minz = c;
    e.maxz = d;
  }
  return e;
}

/** Every POI within r of a point among the road edges built so far. */
export function poisNear(W, x, z, r) {
  const out = [];
  for (const e0 of W.edges.values()) {
    const e = bboxOf(e0);
    if (x < e.minx - r - 60 || x > e.maxx + r + 60 || z < e.minz - r - 60 || z > e.maxz + r + 60) continue;
    for (const p of poisOf(W, e)) if (Math.hypot(p.x - x, p.z - z) <= r) out.push(p);
  }
  return out;
}
