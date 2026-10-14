// Roadside discoveries (pure, deterministic): every built road edge carries a few points of interest
// a short way off the carriageway — overlooks, historical markers, hot springs, odd statues, ghost
// mines. They are found by driving close; the renderer draws a marker sign and a type-specific prop.
import { hash2, hashStr, clamp } from './noise.js';

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
  canyon_overlook: { label: 'Canyon overlook', icon: '🏜', reward: 35, blurb: 'A dizzying drop into carved sandstone and layered red strata.' },
  mountain_pass: { label: 'Mountain pass summit', icon: '⛰', reward: 40, blurb: 'The highest elevation on this route with a panoramic pass summit marker.' },
  fire_tower: { label: 'Lookout fire tower', icon: '🔭', reward: 35, blurb: 'A tall timber fire watchtower overlooking miles of pine forest.' },
  hoodoo_vista: { label: 'Hoodoo vista', icon: '🗿', reward: 30, blurb: 'A natural amphitheater of towering sandstone hoodoos and spires.' },
  boondock_spot: { label: 'Scenic boondock camp', icon: '🚐', reward: 45, blurb: 'A prime dispersed off-grid camper pullout rated for solar, wind, and levelness.' },
  boondock: { label: 'Scenic boondock camp', icon: '🚐', reward: 45, blurb: 'A prime dispersed off-grid camper pullout rated for solar, wind, and levelness.' },
};

const ADJ = ['Lone', 'Windy', 'Copper', 'Old', 'Big', 'Silver', 'Eagle', 'Lost', 'Red', 'Sunrise', 'Painted', 'Crooked', 'Quiet', 'Dry', 'Golden'];
const NOUN = {
  overlook: ['Overlook', 'Vista', 'Point', 'Lookout'], lakeview: ['Lake View', 'Shore Turnout', 'Bay Overlook'], marker: ['Crossing Marker', 'Trail Marker', 'Homestead Plaque'],
  mine: ['Mine', 'Diggings', 'Shaft', 'Claim'], spring: ['Hot Springs', 'Warm Pool', 'Steam Hollow'], oddity: ['Prairie Dog', 'Bison Statue', 'Cowboy Boot', 'Trout', 'Sasquatch'],
  barn: ['Barn', 'Homestead', 'Granary'], tree: ['Cottonwood', 'Pine', 'Aspen Grove'], rest: ['Rest Area', 'Picnic Stop', 'Wayside'],
  canyon_overlook: ['Canyon Rim', 'Gorge Overlook', 'Chasm Point', 'Sandstone Vista'],
  mountain_pass: ['Pass Summit', 'Divide', 'High Notch', 'Ridge Gap'],
  fire_tower: ['Fire Tower', 'Lookout Station', 'Ridge Watch'],
  hoodoo_vista: ['Hoodoo Spires', 'Red Pinnacles', 'Goblin Valley', 'Needle Vista'],
  boondock_spot: ['Boondock Haven', 'Dispersed Camp', 'Ridge Pullout', 'Van Camp', 'Stargazer Spot'],
  boondock: ['Boondock Haven', 'Dispersed Camp', 'Ridge Pullout', 'Van Camp', 'Stargazer Spot'],
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
    const bio = W.biome ? W.biome(x, z, y) : {};
    let type;
    const near = lakes.some((lk) => W.lakeRn(lk, x, z) < 1.9);
    if (near && h(4) < 0.8) type = 'lakeview';
    else if (bio.bad > 0.38) type = h(4) < 0.5 ? 'canyon_overlook' : 'hoodoo_vista';
    else if (y > 170 || bio.alpine > 0.3) type = 'mountain_pass';
    else if (bio.forest > 0.52 && h(4) < 0.55) type = 'fire_tower';
    else if (y > e.hs[k] + 9 && h(4) < 0.85) type = 'overlook';
    else if (h(4) < 0.22) type = 'boondock_spot';
    else type = ['marker', 'marker', 'mine', 'spring', 'oddity', 'oddity', 'barn', 'tree', 'rest', 'rest', 'boondock_spot'][Math.floor(h(5) * 11)];
    const noun = NOUN[type][Math.floor(h(6) * NOUN[type].length)];
    const name = type === 'oddity' ? ODDITY[noun] : `${ADJ[Math.floor(h(7) * ADJ.length)]} ${noun}`;
    // the marker faces the road: its normal points from the POI toward the carriageway
    const yaw = Math.atan2(side * (tz / l), -side * (tx / l));
    const poi = { id: `${e.id}#${q}`, type, name, x, z, y, yaw, edge: e.id, reward: POI_TYPES[type].reward, side, k };
    if (type === 'boondock_spot' || type === 'boondock') {
      const solar = clamp(Math.round(85 - (bio.forest || 0) * 45), 25, 100);
      const wind = clamp(Math.round(20 + (bio.alpine || 0) * 50 + (y > e.hs[k] ? 15 : 0)), 10, 95);
      const levelness = clamp(Math.round(96 - Math.abs(y - e.hs[k]) * 9), 30, 98);
      poi.solar = solar;
      poi.wind = wind;
      poi.levelness = levelness;
      poi.solarRating = solar / 100;
      poi.windRating = wind / 100;
      poi.levelnessRating = levelness / 100;
    }
    out.push(poi);
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
