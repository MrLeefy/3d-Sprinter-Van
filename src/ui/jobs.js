// Freight jobs: a job board for the semi (Euro/American Truck Simulator style). Accept a load, the GPS
// routes you to the pickup depot, stop in the yard with the right trailer to load, then drive to the
// drop-off before the deadline. Payout goes to the wallet minus penalties for lateness, damage and
// speeding. Offers come from the pure generator in world/jobs.js; the active job is saved in
// localStorage like the other modules.
import { TRAILER_CARGO } from '../sim/truck.js';
import { TRAILERS, TRAILER_LABEL, generateJobs, inDepot, isSpeeding, speedingFine, settleJob } from '../world/jobs.js';
import { fmtDistance, fmtTime } from './mapscreen.js';
import { money } from './services.js';

const KEY = 'sprinter-jobs';
const STOP_V = 1.5; // m/s: "stopped" inside the yard
const FINE_AFTER = 4; // s of sustained speeding before a citation
const FINE_COOLDOWN = 25; // s between citations
const TAG = { hazmat: ['☣', 'Hazmat'], fragile: ['🥚', 'Fragile'], urgent: ['⏱', 'Urgent'] };

const clock = (s) => {
  const a = Math.abs(Math.round(s));
  return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
};
const tons = (kg) => `${(kg / 1000).toFixed(1)} t`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const fresh = () => ({ active: null, board: 0, history: [], last: null });

export class Jobs {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.D = ui.D;
    this.W = ui.world.gen;
    this.st = fresh();
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') Object.assign(this.st, s);
    } catch {
      /* new job book */
    }
    this.filter = 'all';
    this.offers = null;
    this.t = 0;
    this.saveT = 0;
    this.over = 0;
    this.fineCd = 0;
    this.warnT = 0;
    this.build();
    ui.jobs = this;
    ui.modules.push(this);
    const prev = ui.mapExtras;
    ui.mapExtras = () => {
      const e = prev?.() || {};
      const tgt = this.mapTarget();
      return { ...e, waypoint: e.waypoint || tgt, pois: [...(e.pois || []), ...this.mapPois()] };
    };
    this.paintCard();
  }

  get a() {
    return this.st.active;
  }

  get semi() {
    return this.D.vehicle === 'semi';
  }

  get passport() {
    return this.ui.passport;
  }

  // ── Markup ─────────────────────────────────────────────────────────────────
  build() {
    const ui = this.ui, root = ui.root;
    const btn = document.createElement('button');
    btn.className = 'dh-btn';
    btn.id = 'dhJobsBtn';
    btn.textContent = 'Jobs';
    btn.title = 'Freight job board';
    const top = root.querySelector('.dh-top');
    top.insertBefore(btn, root.querySelector('#dhPassBtn') || root.querySelector('#dhSettings'));
    btn.addEventListener('click', () => this.toggle());
    this.btn = btn;
    const sh = document.createElement('div');
    sh.className = 'dh-sheet dh-jobs';
    sh.id = 'dhJobs';
    sh.hidden = true;
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-label', 'Freight jobs');
    root.appendChild(sh);
    this.sheet = sh;
    const sum = document.createElement('div');
    sum.className = 'dh-sheet dh-jobsum';
    sum.id = 'dhJobSum';
    sum.hidden = true;
    sum.setAttribute('role', 'dialog');
    sum.setAttribute('aria-label', 'Delivery summary');
    root.appendChild(sum);
    this.sum = sum;
    const card = document.createElement('div');
    card.className = 'dh-job';
    card.hidden = true;
    card.innerHTML = '<div class="jb-ic" id="jbIc">📦</div><div class="jb-tx"><b id="jbMain"></b><span id="jbSub"></span></div><em class="jb-t" id="jbT"></em>';
    card.addEventListener('click', () => this.toggle(true));
    root.querySelector('#dhSlot').appendChild(card);
    this.card = card;
  }

  toggle(force) {
    const open = force ?? this.sheet.hidden;
    this.ui.sheet(null);
    this.sum.hidden = true;
    if (open && this.ui.passport) this.ui.passport.sheet.hidden = true;
    this.sheet.hidden = !open;
    if (open) {
      if (!this.offers && this.semi && !this.a) this.refreshOffers(false);
      else this.render();
    }
  }

  escape() {
    if (!this.sum.hidden) {
      this.sum.hidden = true;
      return true;
    }
    if (!this.sheet.hidden) {
      this.sheet.hidden = true;
      return true;
    }
    return false;
  }

  onShow() {
    // resume the GPS after a reload
    if (this.a && this.ui.mapScreen && !this.ui.mapScreen.route) this.navigateTo(this.a.phase === 'pickup' ? this.a.job.from : this.a.job.to, true);
  }

  onHide() {
    this.sheet.hidden = true;
    this.sum.hidden = true;
    this.save();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.st));
    } catch {
      /* per-visit only */
    }
  }

  // ── Map hooks ──────────────────────────────────────────────────────────────
  target() {
    const a = this.a;
    return a ? (a.phase === 'pickup' ? a.job.from : a.job.to) : null;
  }

  mapTarget() {
    const t = this.target();
    return t ? { x: t.x, z: t.z, name: t.company } : null;
  }

  mapPois() {
    const t = this.target();
    return t ? [{ x: t.x, z: t.z, found: true, icon: t.icon }] : [];
  }

  nodeOf(d) {
    const [i, j] = d.id.split(',').map(Number);
    return this.W.node(i, j);
  }

  navigateTo(d, quiet = false) {
    const ms = this.ui.mapScreen;
    if (!ms) return;
    ms.navigate(this.nodeOf(d), quiet);
  }

  // ── Offers ─────────────────────────────────────────────────────────────────
  refreshOffers(bump = true) {
    if (bump) this.st.board++;
    this.offers = null;
    this.render();
    clearTimeout(this.genT);
    this.genT = setTimeout(() => {
      const D = this.D;
      this.offers = generateJobs(this.W, { x: D.x, z: D.z }, { seed: this.st.board, count: 12, radius: 14000 });
      this.save();
      if (!this.sheet.hidden) this.render();
    }, 30);
  }

  accept(id) {
    const job = this.offers?.find((j) => j.id === id);
    if (!job || this.a) return;
    const ui = this.ui, D = this.D;
    if (!this.semi) ui.set({ vehicle: 'semi' });
    // pick the trailer for this load; the yard loads the cargo when you get there
    if (D.rig.trailer !== job.trailer || ui.s.trailer !== job.trailer) ui.set({ trailer: job.trailer, cargoPct: 0 });
    this.unload(job.trailer);
    this.st.active = { job, phase: 'pickup', elapsed: 0, dmg0: 0, fines: 0, tickets: 0 };
    this.over = 0;
    this.fineCd = 0;
    this.navigateTo(job.from);
    this.app.toast(`Job accepted: ${job.cargoName}, ${job.from.company} → ${job.to.company}. ${TRAILER_LABEL[job.trailer]} hooked up; follow the GPS to the pickup.`);
    this.save();
    this.sheet.hidden = true;
    this.paintCard();
  }

  abandon() {
    const a = this.a;
    if (!a) return;
    const fee = a.phase === 'transit' ? Math.round(a.job.pay * 0.15) : 0;
    if (!confirm(fee ? `Abandon this load? The shipper charges a ${money(fee)} cancellation fee.` : 'Cancel this job?')) return;
    if (fee) this.ui.services?.penalty(fee, 'Load abandoned');
    this.end();
    this.app.toast('Job abandoned.');
    this.render();
  }

  end() {
    const a = this.a;
    if (a) this.unload(a.job.trailer);
    this.st.active = null;
    this.ui.mapScreen?.clear(true);
    this.paintCard();
    this.save();
  }

  /** Set the rig's load without touching the settings sliders (kg = 0 empties the trailer). */
  setLoad(trailer, kg) {
    const D = this.D;
    D.semi.cargo = kg;
    D.rig.setLoad(trailer, kg);
    const r = TRAILER_CARGO[trailer];
    if (kg > 0 && r) this.ui.s.cargoPct = Math.min(1, Math.max(0, (kg - r[0]) / (r[1] - r[0])));
  }

  unload(trailer) {
    if (this.D.rig.trailer === trailer && this.D.rig.cargo !== 0) this.setLoad(trailer, 0);
  }

  matchTrailer() {
    const a = this.a;
    if (!a) return;
    this.ui.set({ vehicle: 'semi', trailer: a.job.trailer, cargoPct: 0 });
    if (a.phase === 'transit') this.setLoad(a.job.trailer, a.job.kg);
    else this.unload(a.job.trailer);
    this.render();
  }

  // ── Per frame ──────────────────────────────────────────────────────────────
  tick(dt) {
    const a = this.a, D = this.D;
    if (!a) return;
    this.warnT -= dt;
    this.fineCd -= dt;
    if (this.semi) {
      const rig = D.rig, job = a.job;
      // keep the load consistent with the job phase (settings changes re-apply a slider load)
      if (rig.trailer === job.trailer) {
        const want = a.phase === 'transit' ? job.kg : 0;
        if (rig.cargo !== want) this.setLoad(job.trailer, want);
      }
      if (a.phase === 'transit') a.elapsed += dt;
      // speeding
      const kmh = Math.abs(D.v) * 3.6;
      if (isSpeeding(kmh, D.limitKmh)) {
        this.over += dt;
        if (this.over > FINE_AFTER && this.fineCd <= 0) {
          const fine = speedingFine(kmh - D.limitKmh);
          a.fines += fine;
          a.tickets++;
          this.fineCd = FINE_COOLDOWN;
          this.over = 0;
          this.app.toast(`🚓 Speeding ticket ${money(fine)} (${Math.round(kmh)} in a ${Math.round(D.limitKmh)} km/h zone). Deducted from the payout.`);
        }
      } else this.over = Math.max(0, this.over - dt);
    }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    if (this.semi) this.zones();
    this.paintCard();
    this.saveT += 0.25;
    if (this.saveT > 6) {
      this.saveT = 0;
      this.save();
    }
  }

  zones() {
    const a = this.a, D = this.D, t = this.target();
    if (!a || !t || !inDepot(t, D.x, D.z) || Math.abs(D.v) > STOP_V) return;
    const need = a.job.trailer;
    if (D.rig.trailer !== need) {
      if (this.warnT <= 0) {
        this.warnT = 8;
        this.app.toast(`Wrong trailer: this load needs a ${TRAILER_LABEL[need]}. Open Jobs and tap “Match trailer”.`);
      }
      return;
    }
    if (a.phase === 'pickup') this.pickup();
    else this.deliver();
  }

  pickup() {
    const a = this.a, job = a.job;
    this.setLoad(job.trailer, job.kg);
    a.phase = 'transit';
    a.elapsed = 0;
    a.dmg0 = this.D.rig.damage;
    this.navigateTo(job.to, true);
    const dl = this.ui.s.units === 'mph' ? `${(job.km * 0.621371).toFixed(1)} mi` : `${job.km.toFixed(1)} km`;
    this.app.toast(`Loaded ${tons(job.kg)} of ${job.cargoName}${job.hazmat ? ' (hazmat: take it easy)' : ''}. Deliver to ${job.to.company}, ${job.to.town} (${dl}) within ${fmtTime(job.allowedSec)}.`);
    this.passport?.log(`Picked up ${job.cargoName} at ${job.from.town}`);
    this.save();
  }

  deliver() {
    const a = this.a, job = a.job, rig = this.D.rig;
    const res = settleJob(job, { elapsed: a.elapsed, damageDelta: Math.max(0, rig.damage - a.dmg0), fines: a.fines });
    const sum = { ...res, job, tickets: a.tickets, elapsed: Math.round(a.elapsed), at: Date.now() };
    this.unload(job.trailer);
    this.st.active = null;
    this.ui.mapScreen?.clear(true);
    if (res.total > 0) this.ui.services?.earn(res.total);
    this.st.last = sum;
    this.st.history.unshift({ cargo: job.cargoName, from: job.from.town, to: job.to.town, km: job.km, total: res.total, clean: res.clean });
    this.st.history.length = Math.min(this.st.history.length, 8);
    this.passport?.freightDone?.({ km: job.km, earned: res.total, clean: res.clean, onTime: res.onTime, hazmat: job.hazmat, company: job.to.company, cargo: job.cargoName, town: job.to.town });
    this.offers = null;
    this.paintCard();
    this.save();
    this.showSummary(sum);
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  paintCard() {
    const a = this.a, c = this.card;
    c.hidden = !a;
    this.btn.classList.toggle('active', !!a);
    if (!a) return;
    const job = a.job, D = this.D, t = this.target();
    const units = this.ui.s.units;
    const d = Math.hypot(t.x - D.x, t.z - D.z);
    const left = job.allowedSec - a.elapsed;
    const q = (s) => c.querySelector(s);
    c.classList.toggle('late', a.phase === 'transit' && left < 0);
    c.classList.toggle('paused', !this.semi);
    q('#jbIc').textContent = a.phase === 'pickup' ? '🏭' : '📦';
    if (!this.semi) {
      q('#jbMain').textContent = 'Job on hold';
      q('#jbSub').textContent = 'Switch to the semi to continue (settings → Vehicle).';
      q('#jbT').textContent = '';
      return;
    }
    const inYard = inDepot(t, D.x, D.z);
    q('#jbMain').textContent = a.phase === 'pickup' ? `Pick up · ${job.cargoName}` : `Deliver · ${job.cargoName}`;
    q('#jbSub').textContent = `${t.company}, ${t.town} · ${inYard ? (D.rig.trailer !== job.trailer ? `need a ${TRAILER_LABEL[job.trailer]}` : 'stop in the yard') : `${fmtDistance(d, units)} away`}`;
    q('#jbT').textContent = a.phase === 'transit' ? clock(left) : tons(job.kg);
  }

  chips() {
    const types = ['all', ...TRAILERS];
    return `<div class="jb-chips">${types.map((t) => `<button class="dh-btn" data-f="${t}" aria-pressed="${this.filter === t}">${t === 'all' ? 'All' : TRAILER_LABEL[t]}</button>`).join('')}</div>`;
  }

  jobCard(j, units, active) {
    const tags = ['hazmat', 'fragile', 'urgent'].filter((k) => j[k]).map((k) => `<span class="jb-tag ${k}" title="${TAG[k][1]}">${TAG[k][0]} ${TAG[k][1]}</span>`).join('');
    return `<div class="jb-job" data-id="${esc(j.id)}">
      <div class="jb-h"><b>${esc(j.cargoName)}</b><span class="jb-pay">${money(j.pay)}</span></div>
      <p class="jb-route"><span>${j.from.icon} ${esc(j.from.company)}<small>${esc(j.from.town)}</small></span><i>→</i><span>${j.to.icon} ${esc(j.to.company)}<small>${esc(j.to.town)}</small></span></p>
      <p class="jb-meta"><span>${TRAILER_LABEL[j.trailer]}</span><span>${tons(j.kg)}</span><span>${fmtDistance(j.lenM, units)}</span><span>${fmtTime(j.allowedSec)}</span>${tags}</p>
      ${active ? '' : `<div class="jb-b"><button class="dh-btn primary" data-act="accept">Accept</button></div>`}
    </div>`;
  }

  render() {
    const sh = this.sheet, units = this.ui.s.units, P = this.passport?.st.jobs;
    let body = '';
    const a = this.a;
    if (a) {
      const t = this.target(), job = a.job;
      const mismatch = this.D.rig.trailer !== job.trailer;
      body += `<h4>Active job</h4>${this.jobCard(job, units, true)}
        <p class="jb-state">${this.semi ? '' : '<b>On hold:</b> switch back to the semi to continue. '}${a.phase === 'pickup' ? `Go to <b>${esc(t.company)}</b> in ${esc(t.town)} and stop inside the yard to load.` : `Deliver to <b>${esc(t.company)}</b> in ${esc(t.town)}. Time left <b>${clock(job.allowedSec - a.elapsed)}</b>.`}${a.fines ? ` Fines so far ${money(a.fines)}.` : ''}</p>
        <div class="jb-b"><button class="dh-btn primary" data-act="nav">Show route</button>${mismatch || !this.semi ? '<button class="dh-btn" data-act="match">Match trailer</button>' : ''}<button class="dh-btn" data-act="abandon">${a.phase === 'transit' ? 'Abandon' : 'Cancel job'}</button></div>`;
    } else if (!this.semi) {
      body += `<p class="dh-note">Freight jobs are for the semi. Hook up a trailer and take a load.</p><div class="jb-b"><button class="dh-btn primary" data-act="semi">Switch to the semi</button></div>`;
    } else {
      body += `<div class="jb-top"><h4>Offers near you</h4><button class="dh-btn" data-act="refresh">New offers</button></div>${this.chips()}`;
      if (!this.offers) body += '<p class="dh-note">Checking the dispatch board…</p>';
      else {
        const list = this.offers.filter((j) => this.filter === 'all' || j.trailer === this.filter);
        body += list.length
          ? `<div class="jb-list">${list.map((j) => this.jobCard(j, units, false)).join('')}</div>`
          : `<p class="dh-note">No ${this.filter === 'all' ? '' : `${TRAILER_LABEL[this.filter].toLowerCase()} `}loads posted nearby. Try “New offers”, another trailer, or drive to a bigger town.</p>`;
      }
    }
    if (P && P.n) body += `<h4>Your record</h4><p class="jb-rec"><b>${P.n}</b> deliveries · <b>${fmtDistance(P.km * 1000, units)}</b> hauled · <b>${money(P.earned)}</b> earned · ${P.perfect} clean</p>`;
    if (this.st.history.length && !a) body += `<ul class="ps-log jb-hist">${this.st.history.slice(0, 5).map((h) => `<li><em>${money(h.total)}</em>${esc(h.cargo)}: ${esc(h.from)} → ${esc(h.to)}${h.clean ? ' ✓' : ''}</li>`).join('')}</ul>`;
    sh.innerHTML = `<div class="dh-sh-top"><b>Freight jobs</b><button class="dh-x" id="jbX" aria-label="Close">×</button></div>${body}`;
    sh.querySelector('#jbX').addEventListener('click', () => (sh.hidden = true));
    sh.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => ((this.filter = b.dataset.f), this.render())));
    sh.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'accept') this.accept(b.closest('.jb-job').dataset.id);
      else if (act === 'refresh') this.refreshOffers(true);
      else if (act === 'abandon') this.abandon();
      else if (act === 'match') this.matchTrailer();
      else if (act === 'nav') {
        this.navigateTo(this.target());
        sh.hidden = true;
      } else if (act === 'semi') {
        this.ui.set({ vehicle: 'semi' });
        this.refreshOffers(false);
      }
    }));
  }

  showSummary(s) {
    const units = this.ui.s.units, j = s.job;
    const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td>${v}</td></tr>`;
    this.sum.innerHTML = `<div class="dh-sh-top"><b>Delivery complete</b><button class="dh-x" id="jsX" aria-label="Close">×</button></div>
      <p class="jb-sumh">${esc(j.cargoName)} · ${tons(j.kg)}<br><small>${esc(j.from.company)}, ${esc(j.from.town)} → ${esc(j.to.company)}, ${esc(j.to.town)} · ${fmtDistance(j.lenM, units)} in ${fmtTime(s.elapsed)}</small></p>
      <table class="jb-tbl">
        ${row('Freight charge', money(s.gross))}
        ${s.lateFee ? row(`Late delivery (${fmtTime(s.lateSec)} over)`, `−${money(s.lateFee)}`, 'neg') : row('On time', '✓', 'pos')}
        ${s.damageFee ? row(`Cargo damage (${s.damage}%)`, `−${money(s.damageFee)}`, 'neg') : row('No cargo damage', '✓', 'pos')}
        ${s.fines ? row(`Speeding fines (${s.tickets})`, `−${money(s.fines)}`, 'neg') : row('No speeding tickets', '✓', 'pos')}
        ${s.tip ? row('Clean-run tip', `+${money(s.tip)}`, 'pos') : ''}
        ${row('Paid to you', money(s.total), 'tot')}
      </table>
      <div class="jb-b"><button class="dh-btn primary" id="jsOk">Done</button><button class="dh-btn" id="jsNext">Find the next load</button></div>`;
    this.sum.hidden = false;
    const close = () => (this.sum.hidden = true);
    this.sum.querySelector('#jsX').addEventListener('click', close);
    this.sum.querySelector('#jsOk').addEventListener('click', close);
    this.sum.querySelector('#jsNext').addEventListener('click', () => {
      close();
      this.toggle(true);
      this.refreshOffers(true);
    });
  }
}
