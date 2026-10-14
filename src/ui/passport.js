// Passport: stamps for every settlement you reach, roadside discoveries, achievements and a trip log.
// Everything persists in localStorage; rewards pay into the wallet.
import { KIND_LABEL } from '../world/gen.js';
import { poisNear, POI_TYPES } from '../world/poi.js';
import { money } from './services.js';

const KEY = 'sprinter-passport';
const STAMP_REWARD = { city: 80, town: 50, village: 30, truckstop: 15, lodge: 25, camp: 20, farm: 10 };
const GRAVEL = new Set(['gravel', 'dirt', 'mud', 'sand', 'grass', 'forest', 'rock']);
const SNOW = new Set(['snow', 'packed', 'plowed']);

// id, name, description, value(state) → current, goal, reward
const ACH = [
  ['first', 'First stamp', 'Reach any town or village.', (s) => s.visited.length, 1, 20],
  ['five', 'Small-town circuit', 'Stamp 5 different places.', (s) => s.visited.length, 5, 60],
  ['fifteen', 'Montana explorer', 'Stamp 15 different places.', (s) => s.visited.length, 15, 200],
  ['city', 'Big city lights', 'Drive into a city.', (s) => s.cities, 1, 50],
  ['km10', 'Getting going', 'Drive 10 km.', (s) => s.km, 10, 25],
  ['km50', 'Long hauler', 'Drive 50 km.', (s) => s.km, 50, 80],
  ['km150', 'Cross-country', 'Drive 150 km.', (s) => s.km, 150, 200],
  ['gravel', 'Gravel warrior', 'Drive 5 km off the pavement.', (s) => s.offKm, 5, 60],
  ['snow', 'Snow day', 'Drive 2 km on snow.', (s) => s.snowKm, 2, 40],
  ['ice', 'Ice road trucker', 'Drive 300 m across a frozen lake.', (s) => s.iceM, 300, 60],
  ['night', 'Night owl', 'Drive 5 km after dark.', (s) => s.nightKm, 5, 40],
  ['seeker', 'Sightseer', 'Find 3 roadside discoveries.', (s) => s.found.length, 3, 60],
  ['seeker10', 'Roadside regular', 'Find 10 roadside discoveries.', (s) => s.found.length, 10, 220],
  ['refuel', 'Fill ’er up', 'Buy diesel.', (s) => (s.flags.refuel ? 1 : 0), 1, 15],
  ['camp', 'Off the grid, on the books', 'Check in at a campground.', (s) => (s.flags.camp ? 1 : 0), 1, 20],
  ['high', 'Higher ground', 'Reach 1,300 m elevation.', (s) => s.maxElev, 1300, 60],
  ['job1', 'First delivery', 'Complete a freight job in the semi.', (s) => s.jobs?.n || 0, 1, 100],
  ['job10', 'Regular route', 'Complete 10 freight deliveries.', (s) => s.jobs?.n || 0, 10, 400],
  ['job50', 'Owner-operator', 'Complete 50 freight deliveries.', (s) => s.jobs?.n || 0, 50, 1500],
  ['haul100', 'Long haul', 'Haul freight 100 km.', (s) => s.jobs?.km || 0, 100, 300],
  ['haul1000', 'Million-mile mindset', 'Haul freight 1,000 km.', (s) => s.jobs?.km || 0, 1000, 2500],
  ['perfect', 'White-glove service', 'Deliver on time with no damage and no tickets.', (s) => s.jobs?.perfect || 0, 1, 150],
  ['hazmat', 'Hazmat certified', 'Deliver 3 hazmat loads.', (s) => s.jobs?.hazmat || 0, 3, 300],
  ['freight5k', 'Freight baron', 'Earn $5,000 from freight.', (s) => s.jobs?.earned || 0, 5000, 600],
  ['wild', 'Wildlife watcher', 'Spot 5 animals from the road.', (s) => s.animals, 5, 50],
];

const fresh = () => ({ visited: [], names: {}, found: [], ach: {}, flags: {}, km: 0, offKm: 0, snowKm: 0, iceM: 0, nightKm: 0, cities: 0, maxElev: 0, animals: 0, log: [], jobs: { n: 0, km: 0, earned: 0, perfect: 0, hazmat: 0, late: 0 } });

export class Passport {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.D = ui.D;
    this.W = ui.world.gen;
    this.st = fresh();
    try {
      Object.assign(this.st, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch {
      /* new passport */
    }
    this.visited = new Set(this.st.visited);
    this.found = new Set(this.st.found);
    this.t = 0;
    this.lastOdo = this.D.odo;
    this.saveT = 0;
    this.lastNode = null;
    this.build();
    ui.passport = this;
    ui.modules.push(this);
    const prev = ui.mapExtras;
    ui.mapExtras = () => ({ ...(prev?.() || {}), visited: this.visited, pois: this.mapPois() });
  }

  build() {
    const ui = this.ui;
    const btn = document.createElement('button');
    btn.className = 'dh-btn';
    btn.id = 'dhPassBtn';
    btn.textContent = 'Passport';
    ui.root.querySelector('.dh-top').insertBefore(btn, ui.root.querySelector('#dhSettings'));
    btn.addEventListener('click', () => this.toggle());
    const sh = document.createElement('div');
    sh.className = 'dh-sheet dh-pass';
    sh.id = 'dhPass';
    sh.hidden = true;
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-label', 'Passport');
    ui.root.appendChild(sh);
    this.sheet = sh;
  }

  toggle() {
    const open = this.sheet.hidden;
    this.ui.sheet(null);
    this.sheet.hidden = !open;
    if (open) this.renderSheet();
  }

  escape() {
    if (!this.sheet.hidden) {
      this.sheet.hidden = true;
      return true;
    }
    return false;
  }

  onHide() {
    this.sheet.hidden = true;
    this.save();
  }

  save() {
    this.st.visited = [...this.visited];
    this.st.found = [...this.found];
    try {
      localStorage.setItem(KEY, JSON.stringify(this.st));
    } catch {
      /* per-visit only */
    }
  }

  log(text) {
    this.st.log.unshift({ text, km: +this.st.km.toFixed(1) });
    if (this.st.log.length > 60) this.st.log.pop();
  }

  achieve(flag) {
    this.st.flags[flag] = true;
    this.check();
  }

  /** Animals seen from the road (called by the wildlife module). */
  sawAnimal() {
    this.st.animals++;
    this.check();
  }

  /** A freight delivery finished (called by the jobs module). */
  freightDone({ km, earned, clean, onTime, hazmat, company, cargo, town }) {
    const j = (this.st.jobs ||= fresh().jobs);
    j.n++;
    j.km += km;
    j.earned += earned;
    if (clean) j.perfect++;
    if (hazmat) j.hazmat++;
    if (!onTime) j.late++;
    this.log(`Delivered ${cargo} to ${company}, ${town}`);
    this.check();
    this.save();
  }

  mapPois() {
    const D = this.D;
    return poisNear(this.W, D.x, D.z, 2600).map((p) => ({ x: p.x, z: p.z, found: this.found.has(p.id), icon: POI_TYPES[p.type].icon }));
  }

  // ── Per frame ──────────────────────────────────────────────────────────────
  tick(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const D = this.D, st = this.st;
    // distance by surface
    const d = D.odo - this.lastOdo;
    this.lastOdo = D.odo;
    if (d > 0 && d < 400) {
      const km = d / 1000;
      st.km += km;
      const k = D.surfaceKey;
      if (GRAVEL.has(k)) st.offKm += km;
      if (SNOW.has(k)) st.snowKm += km;
      if (k === 'ice') st.iceM += d;
      if (this.ui.world.terrain.season.u.uNight.value > 0.6) st.nightKm += km;
    }
    st.maxElev = Math.max(st.maxElev, Math.round(1100 + (D.groundH ?? 0)));
    // settlements
    const n = this.W.settlementAt(D.x, D.z, 0);
    const inside = n && n.kind !== 'junction' && Math.hypot((D.x - n.x) / n.Rp, (D.z - n.z) / n.Rz) < 0.92 ? n : null;
    if (inside && inside !== this.lastNode) {
      this.lastNode = inside;
      if (!this.visited.has(inside.key)) this.stamp(inside);
      else this.app.toast(`${inside.name} · ${KIND_LABEL[inside.kind] || inside.kind}${inside.pop ? ` · pop. ${inside.pop.toLocaleString('en-US')}` : ''} · ${Math.round(inside.elevM * 3.281).toLocaleString('en-US')} ft`);
    } else if (!inside) this.lastNode = null;
    // discoveries
    if (Math.abs(D.v) < 9) {
      for (const p of poisNear(this.W, D.x, D.z, 34)) {
        if (this.found.has(p.id)) continue;
        this.found.add(p.id);
        const T = POI_TYPES[p.type];
        this.app.toast(`${T.icon} Discovery: ${p.name} — ${T.blurb} (+${money(p.reward)})`);
        this.ui.services?.earn(p.reward);
        this.log(`Found ${p.name}`);
        this.check();
        this.save();
      }
    }
    this.check();
    this.saveT += 0.5;
    if (this.saveT > 8) {
      this.saveT = 0;
      this.save();
    }
  }

  stamp(n) {
    this.visited.add(n.key);
    this.st.names[n.key] = { name: n.name, kind: n.kind };
    if (n.kind === 'city') this.st.cities++;
    const r = STAMP_REWARD[n.kind] || 10;
    this.app.toast(`📕 Passport stamped: ${n.name} (${KIND_LABEL[n.kind] || n.kind}${n.pop ? `, pop. ${n.pop.toLocaleString('en-US')}` : ''}) · +${money(r)}`);
    this.ui.services?.earn(r);
    this.log(`Stamped ${n.name}`);
    this.check();
    this.save();
  }

  check() {
    const st = this.st;
    st.visited = [...this.visited];
    st.found = [...this.found];
    for (const [id, name, , val, goal, reward] of ACH) {
      if (st.ach[id] || val(st) < goal) continue;
      st.ach[id] = true;
      this.app.toast(`🏆 Achievement: ${name} · +${money(reward)}`);
      this.ui.services?.earn(reward);
      this.log(`Achievement: ${name}`);
      this.save();
    }
  }

  // ── Sheet ──────────────────────────────────────────────────────────────────
  renderSheet() {
    const st = this.st, units = this.ui.s.units;
    const dist = (km) => (units === 'mph' ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`);
    const stamps = [...this.visited].map((k) => st.names[k] || { name: k, kind: 'town' });
    const done = ACH.filter((a) => st.ach[a[0]]).length;
    this.sheet.innerHTML = `
      <div class="dh-sh-top"><b>Passport</b><button class="dh-x" id="psX" aria-label="Close">×</button></div>
      <div class="ps-stats">
        <div><b>${stamps.length}</b><span>stamps</span></div><div><b>${st.found.length}</b><span>discoveries</span></div><div><b>${dist(st.km)}</b><span>driven</span></div>
        <div><b>${done}/${ACH.length}</b><span>achievements</span></div></div>
      ${st.jobs?.n ? `<p class="dh-note">Freight: <b>${st.jobs.n}</b> deliveries · ${dist(st.jobs.km)} hauled · ${money(st.jobs.earned)} earned · ${st.jobs.perfect} perfect</p>` : ''}
      <h4>Stamps</h4>
      <div class="ps-stamps">${stamps.length ? stamps.map((s) => `<span class="ps-st ${s.kind}">${s.name}<small>${KIND_LABEL[s.kind] || s.kind}</small></span>`).join('') : '<p class="dh-note">No stamps yet — drive into a town, village or campground.</p>'}</div>
      <h4>Achievements</h4>
      <div class="ps-ach">${ACH.map(([id, name, desc, val, goal, reward]) => {
        const v = Math.min(goal, val(st)), ok = st.ach[id];
        return `<div class="${ok ? 'ok' : ''}"><b>${ok ? '🏆 ' : ''}${name}</b><span>${desc} · ${money(reward)}</span><i class="bar"><i style="width:${Math.round((v / goal) * 100)}%"></i></i></div>`;
      }).join('')}</div>
      <h4>Trip log</h4>
      <ul class="ps-log">${st.log.length ? st.log.slice(0, 14).map((l) => `<li><em>${dist(l.km)}</em>${l.text}</li>`).join('') : '<li class="dh-note">Nothing yet.</li>'}</ul>
      <p class="dh-note"><button class="dh-btn" id="psReset">Start a new passport</button></p>`;
    this.sheet.querySelector('#psX').addEventListener('click', () => (this.sheet.hidden = true));
    this.sheet.querySelector('#psReset').addEventListener('click', () => {
      if (!confirm('Erase all stamps, discoveries, achievements and the trip log?')) return;
      this.st = fresh();
      this.visited = new Set();
      this.found = new Set();
      this.save();
      this.renderSheet();
    });
  }
}
