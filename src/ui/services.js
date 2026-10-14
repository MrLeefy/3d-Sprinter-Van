// Services and wallet. Stop at a pump, tap, dump station, campground or shop and a card offers what
// the place sells. Purchases change the live simulation state (diesel, fresh and grey water, shore
// power), so the data panels and the drive HUD react immediately. Cash is saved in localStorage.
import { SPEC } from '../sim/truck.js';
import { VAN } from '../data/vehicle.js';
import { WATER } from '../data/plumbing.js';
import { hash2 } from '../world/noise.js';
import { layoutOf } from '../world/layout.js';
import { S } from '../world/gen.js';

const KEY = 'sprinter-wallet';
const GAL = 3.78541;
const ICON = { fuel: '⛽', water: '🚰', dump: '♻', camp: '⛺', shop: '🛒' };

export const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

export class Services {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.D = ui.D;
    this.W = ui.world.gen;
    this.cash = 500;
    try {
      const w = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (w && Number.isFinite(w.cash)) this.cash = w.cash;
    } catch {
      /* default wallet */
    }
    this.t = 0;
    this.shown = '';
    this.camp = null;
    this.campGone = 0;
    this.lowWarned = false;
    this.stats = { fuelL: 0, spent: 0, water: 0, dumps: 0, nights: 0 };
    this.el = document.createElement('div');
    this.el.className = 'dh-svc';
    ui.root.querySelector('#dhSlot').appendChild(this.el);
    ui.modules.push(this);
    ui.services = this;
    // wallet chip in the top row
    const chip = document.createElement('span');
    chip.className = 'dh-wallet';
    chip.id = 'dhWallet';
    chip.title = 'Cash';
    ui.root.querySelector('.dh-top').prepend(chip);
    this.chip = chip;
    this.paint();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ cash: this.cash }));
    } catch {
      /* per-visit only */
    }
  }

  paint() {
    this.chip.textContent = `${money(this.cash)}`;
  }

  /** Spend money if there is enough; otherwise say so. */
  pay(v, what) {
    if (v > this.cash + 1e-6) {
      this.app.toast(`Not enough cash for ${what} (${money(v)}, you have ${money(this.cash)}). Stamp new towns and find discoveries to earn more.`);
      return false;
    }
    this.cash -= v;
    this.stats.spent += v;
    this.paint();
    this.save();
    return true;
  }

  /** An unavoidable cost (never blocks; takes what the wallet has). */
  penalty(v, why) {
    const c = Math.min(v, this.cash);
    if (c <= 0) return;
    this.cash -= c;
    this.stats.spent += c;
    this.paint();
    this.save();
    this.app.toast(`-${money(c)} · ${why}`);
  }

  earn(v, why) {
    this.cash += v;
    this.paint();
    this.save();
    if (why) this.app.toast(`+${money(v)} · ${why}`);
  }

  // ── Prices (deterministic per place) ───────────────────────────────────────
  dieselPrice(z) {
    const f = hash2(Math.round(z.x), Math.round(z.z), 5);
    const base = 3.79 + f * 0.85;
    return z.trucks ? base - 0.18 : z.node.kind === 'village' ? base + 0.3 : base;
  }

  waterPrice(z) {
    return z.node.kind === 'camp' ? 0 : hash2(Math.round(z.x), Math.round(z.z), 6) < 0.5 ? 0 : 2;
  }

  // ── Zone detection ─────────────────────────────────────────────────────────
  tick(dt) {
    const D = this.D, A = this.app;
    this.t -= dt;
    // out of diesel
    const semi = D.vehicle === 'semi';
    const fuel = semi ? D.rig.fuel : A.simState.fuelL;
    const tank = semi ? SPEC.fuelTank : VAN.fuelTank.v;
    D.noFuel = fuel <= 0.05;
    if (D.noFuel && !this.empty) {
      this.empty = true;
      A.toast('Out of diesel! Coast to a stop. Tap Map → Nearest fuel for the closest pump (or press T to get back on a road).');
    } else if (!D.noFuel) this.empty = false;
    if (!this.lowWarned && fuel < tank * 0.15) {
      this.lowWarned = true;
      A.toast(`Fuel low (${fuel.toFixed(0)} L). Open the map and tap “Nearest fuel”.`);
    } else if (fuel > tank * 0.3) this.lowWarned = false;
    if (this.t > 0) return;
    this.t = 0.3;
    const slow = Math.abs(D.v) < 5;
    const zs = slow ? this.ui.world.terrain.towns.zonesNear(D.x, D.z, 30).filter((z) => z.d <= z.r + 6) : [];
    const sig = zs.map((z) => `${z.type}${Math.round(z.x)}${Math.round(z.z)}`).join('|');
    if (sig !== this.shown) {
      this.shown = sig;
      this.render(zs);
    } else this.refresh();
    // leaving a campground ends the hookup
    if (this.camp && !zs.some((z) => z.type === 'camp')) {
      this.campGone += 0.3;
      if (this.campGone > 3) {
        if (this.camp.hookups) A.ctrl.shore.connected = false;
        A.toast(`Left ${this.camp.name}${this.camp.hookups ? ' — shore power unplugged' : ''}.`);
        this.camp = null;
      }
    } else this.campGone = 0;
  }

  /** The nearest settlements' services within r of a point (used by the map's quick buttons). */
  nearest(type, x, z, maxKm = 40) {
    let best = null, bd = 1e18;
    const r = maxKm * 1000;
    for (let i = Math.floor((x - r) / S); i <= Math.floor((x + r) / S); i++) {
      for (let j = Math.floor((z - r) / S); j <= Math.floor((z + r) / S); j++) {
        const n = this.W.node(i, j);
        if (n.kind === 'junction') continue;
        const L = layoutOf(this.W, n);
        const zn = L.zones.find((q) => q.type === type);
        if (!zn) continue;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bd) {
          bd = d;
          best = { node: n, zone: zn, d };
        }
      }
    }
    return best;
  }

  // ── Cards ──────────────────────────────────────────────────────────────────
  render(zs) {
    this.zs = zs;
    this.el.innerHTML = zs
      .map((z, i) => {
        const hdr = `<div class="sv-h"><span>${ICON[z.type] || ''}</span><b>${z.name || z.type}</b><em>${z.node.name}</em></div>`;
        return `<div class="sv-card" data-i="${i}">${hdr}<div class="sv-b">${this.body(z)}</div></div>`;
      })
      .join('');
    this.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.act(this.zs[+b.closest('.sv-card').dataset.i], b.dataset.act)));
    this.refresh();
  }

  body(z) {
    if (z.type === 'fuel') {
      const p = this.dieselPrice(z);
      return `<p>Diesel $${p.toFixed(2)}/gal <small>($${(p / GAL).toFixed(2)}/L)</small> · tank <span data-k="fuel"></span></p>
        <div class="sv-btns"><button class="dh-btn primary" data-act="fill">Fill up</button><button class="dh-btn" data-act="fill20">+ 20 L</button></div>`;
    }
    if (z.type === 'water') {
      const p = this.waterPrice(z);
      return `<p>Potable water ${p ? money(p) : 'free'} · fresh tank <span data-k="fresh"></span></p><div class="sv-btns"><button class="dh-btn primary" data-act="water">Fill fresh tank</button></div>`;
    }
    if (z.type === 'dump') {
      return `<p>Grey tank <span data-k="grey"></span> · toilet <span data-k="urine"></span></p><div class="sv-btns"><button class="dh-btn primary" data-act="dump">Dump &amp; rinse · $10</button></div>`;
    }
    if (z.type === 'camp') {
      const fee = z.fee || 24, paid = this.camp && this.camp.key === `${z.x},${z.z}`;
      return paid
        ? `<p>Checked in${z.hookups ? ' — shore power connected' : ' — dry camping'}. Sleep well; the master slider deploys the camp.</p>`
        : `<p>${money(fee)}/night${z.hookups ? ' with electric hookup (shore power)' : ' · dry camping, no hookups'}.</p><div class="sv-btns"><button class="dh-btn primary" data-act="camp">Check in · ${money(fee)}</button></div>`;
    }
    if (z.type === 'shop') {
      return `<p>Stock up for the road.</p><div class="sv-btns"><button class="dh-btn primary" data-act="groceries">Groceries · $65</button><button class="dh-btn" data-act="coffee">Coffee · $4</button></div>`;
    }
    return '';
  }

  refresh() {
    const s = this.app.simState;
    const set = (k, v) => this.el.querySelectorAll(`[data-k="${k}"]`).forEach((e) => (e.textContent = v));
    const semi = this.D.vehicle === 'semi';
    set('fuel', semi ? `${this.D.rig.fuel.toFixed(0)} / ${SPEC.fuelTank} L` : `${s.fuelL.toFixed(0)} / ${VAN.fuelTank.v.toFixed(0)} L`);
    set('fresh', `${s.freshL.toFixed(0)} / ${WATER.freshUsableL} L`);
    set('grey', `${s.greyL.toFixed(0)} / ${WATER.greyL} L`);
    set('urine', `${s.urineL.toFixed(1)} / ${WATER.urineL} L`);
  }

  onUse() {
    const z = this.zs?.[0];
    if (!z) return;
    const a = { fuel: 'fill', water: 'water', dump: 'dump', camp: 'camp', shop: 'groceries' }[z.type];
    if (a) this.act(z, a);
  }

  act(z, a) {
    const A = this.app, s = A.simState;
    const semi = this.D.vehicle === 'semi';
    const cap = semi ? SPEC.fuelTank : VAN.fuelTank.v;
    const have = semi ? this.D.rig.fuel : s.fuelL;
    if (a === 'fill' || a === 'fill20') {
      const want = a === 'fill' ? cap - have : Math.min(semi ? 100 : 20, cap - have);
      if (want < 0.5) return A.toast('The tank is already full.');
      const price = this.dieselPrice(z) / GAL;
      const cost = want * price;
      if (!this.pay(cost, `${want.toFixed(0)} L of diesel`)) return;
      if (semi) this.D.rig.fuel += want;
      else s.fuelL += want;
      this.stats.fuelL += want;
      this.ui.passport?.log(`Bought ${want.toFixed(0)} L of diesel in ${z.node.name} (${money(cost)})`);
      this.ui.passport?.achieve?.('refuel');
      A.toast(`Pump: ${want.toFixed(1)} L of diesel for ${money(cost)}. Safe travels.`);
    } else if (a === 'water') {
      const p = this.waterPrice(z);
      if (s.freshL > WATER.freshUsableL - 1) return A.toast('The fresh tank is already full.');
      if (p && !this.pay(p, 'water')) return;
      this.stats.water += WATER.freshUsableL - s.freshL;
      s.freshL = WATER.freshUsableL;
      A.toast('Fresh tank filled through the hidden jamb inlet (115 L usable).');
    } else if (a === 'dump') {
      if (!this.pay(10, 'the dump station')) return;
      s.greyL = 0;
      s.urineL = 0;
      s.solidsUses = 0;
      this.stats.dumps++;
      this.ui.passport?.log(`Dumped and rinsed the tanks in ${z.node.name}`);
      A.toast('Grey tank dumped, toilet emptied and rinsed.');
    } else if (a === 'camp') {
      const fee = z.fee || 24;
      if (!this.pay(fee, 'the campsite')) return;
      this.camp = { key: `${z.x},${z.z}`, name: z.name || z.node.name, hookups: !!z.hookups };
      if (z.hookups) A.ctrl.shore.connected = true;
      this.stats.nights++;
      this.ui.passport?.log(`Camped at ${this.camp.name} (${money(fee)})`);
      this.ui.passport?.achieve?.('camp');
      A.toast(z.hookups ? `Checked in. Shore power connected — the battery will top up and the heat pump or heater can run on the grid.` : 'Checked in for dry camping — solar and the alternator are your power.');
      this.shown = '';
    } else if (a === 'groceries') {
      if (!this.pay(65, 'groceries')) return;
      A.toast('The pantry and fridge are stocked for a week.');
      this.ui.passport?.log(`Bought groceries in ${z.node.name}`);
    } else if (a === 'coffee') {
      if (!this.pay(4, 'coffee')) return;
      A.toast('Strong, hot and slightly burnt. Perfect.');
    }
    this.refresh();
  }

  onShow() {
    this.shown = '';
  }

  onHide() {
    this.el.innerHTML = '';
    this.shown = '';
  }
}
