// Live dashboard tabs: Inspect, Energy, Climate, Water.
import { COMPONENTS, byId, SYSTEMS, STATUS, CERT, fmtDims } from '../data/components.js';
import { LOADS, loadById, BANK, INVERTER, SOURCES } from '../data/electrical.js';
import { PIPES, WATER, FREEZE_PROTECTION } from '../data/plumbing.js';
import { WIRES, CIRCUITS } from '../data/electrical.js';
import { DUCTS, HEATER, AC, acCapacityW, acCOP, VENT_RATES } from '../data/climate.js';
import { ACTUATORS, FEATURES } from '../data/mechanisms.js';
import { VAN } from '../data/vehicle.js';
import { CATEGORIES } from '../sim/model.js';
import { designHeatLoss, designCoolingLoad, envelopeUA, steadyCO2, nightVentM3h } from '../sim/thermal.js';
import { W, Wh, C, L, kg, usd, mm, dur, esc, binder } from './fmt.js';
import { stackBar } from './charts.js';

const CAT_COLORS = { hvac: '#ef6c3a', cooking: '#f2a33a', fridge: '#5ab0ff', vent: '#3fc9a5', lights: '#f7d65a', devices: '#a98bff', water: '#3b7ddd', base: '#8d9aab', losses: '#5b6878' };
export { CAT_COLORS };

const statusPill = (s) => `<span class="pill ${s === 'verified' ? 'good' : s === 'conceptual' ? 'warn' : s === 'typical' ? 'info' : 'muted'}" title="${esc(STATUS[s] || '')}">${s}</span>`;

// ───────────────────────── Inspector ─────────────────────────
export function renderInspector(app, sel) {
  if (!sel) return introHTML();
  if (sel.feature) {
    const f = sel.feature;
    const a = ACTUATORS.find((x) => x.id === f.act);
    return `<div class="eyebrow">Mechanism hardware · ${f.type}</div><h2 class="title">${esc(f.label)}</h2>
      <p class="prose">Part of <b>${esc(a?.name || f.act)}</b>. ${a?.interlock ? 'Interlock: ' + esc(a.interlock) : ''}</p>
      <div class="flex"><button class="btn primary" data-act-toggle="${f.act}">Operate ${esc(a?.name || '')}</button></div>
      <p class="note">Position (x from rear axle, height, lateral): ${f.p.map((v) => mm(v)).join(' · ')}</p>`;
  }
  if (sel.route) return routeHTML(sel.route);
  if (sel.cid === 'van-body' || sel.cid === 'roof-rack' && false) return vehicleHTML();
  if (sel.cid === 'occupant') return `<div class="eyebrow">Daily living</div><h2 class="title">Occupant</h2><p class="prose">One of two occupants assumed by every simulation (sensible heat, moisture, CO₂, water and power use follow the daily schedule).</p>`;
  const c = byId[sel.cid];
  if (!c) return vehicleHTML();
  const sys = SYSTEMS[c.system];
  const usedBy = COMPONENTS.filter((o) => (o.depends || []).includes(c.id));
  const loads = LOADS.filter((l) => l.comp === c.id || (c.id === 'rooftop-ac' && l.id === 'ac'));
  const acts = ACTUATORS.filter((a) => FEATURES.some((f) => f.act === a.id) && actuatorComponents(a.id).includes(c.id));
  const cen = [(c.box.x[0] + c.box.x[1]) / 2, (c.box.y[0] + c.box.y[1]) / 2, (c.box.z[0] + c.box.z[1]) / 2];
  const side = cen[2] > 0.05 ? 'passenger side' : cen[2] < -0.05 ? 'driver side' : 'centreline';
  return `<div class="sys"><i style="background:${sys?.color}"></i>${esc(sys?.name || c.system)} · ${esc(c.zone)}</div>
    <h2 class="title">${esc(c.name)}</h2>
    <div class="badges">${statusPill(c.status)}${c.cert ? `<span class="pill crit" title="${esc(CERT[c.cert])}">${c.cert === 'engineering' ? 'licensed engineering' : c.cert === 'electrician' ? 'qualified electrician' : 'certified installer'}</span>` : ''}${c.model ? `<span class="pill muted">${esc(c.model)}</span>` : ''}</div>
    <div class="card"><div class="subhead">Specification</div><p class="prose">${esc(c.spec || '—')}</p></div>
    <div class="card"><div class="subhead">How it works</div><p class="prose">${esc(c.principle || '—')}</p>${c.notes ? `<p class="prose note">${esc(c.notes)}</p>` : ''}</div>
    <div class="card"><dl class="kv">
      <dt>Envelope</dt><dd>${fmtDims(c.box)}</dd>
      <dt>Mass</dt><dd>${c.mass ? kg(c.mass) : 'OEM / negligible'}</dd>
      <dt>Est. cost</dt><dd>${c.cost ? usd(c.cost) : 'OEM'}</dd>
      <dt>Location</dt><dd>${esc(side)}, ${esc(c.placement)}</dd>
      <dt>From rear axle</dt><dd>${mm(cen[0])}</dd><dt>Height above ground</dt><dd>${mm(c.box.y[0])}–${mm(c.box.y[1])}</dd>
    </dl></div>
    <div class="card"><div class="subhead">Service & access</div><p class="prose">${esc(c.service || '—')}</p><p class="prose note">Access: ${esc(c.access || '—')}</p></div>
    ${loads.length ? `<div class="card"><div class="subhead">Live power</div><dl class="kv" data-live-loads="${loads.map((l) => l.id).join(',')}">${loads.map((l) => `<dt>${esc(l.name)}</dt><dd data-b="ld-${l.id}">—</dd>`).join('')}</dl></div>` : ''}
    ${c.capacityL ? `<div class="card"><div class="subhead">Level</div><div class="bar tall"><i data-b="lvl-${c.id}"></i></div><p class="note" data-b="lvlt-${c.id}"></p></div>` : ''}
    ${acts.length ? `<div class="flex">${acts.map((a) => `<button class="btn" data-act-toggle="${a.id}">Operate: ${esc(a.name)}</button>`).join('')}</div>` : ''}
    <div><div class="subhead">Depends on</div><div class="deps">${(c.depends || []).map((d) => `<button data-sel="${d}">${esc(byId[d]?.name || d)}</button>`).join('') || '<span class="note">—</span>'}</div></div>
    <div><div class="subhead">Required by</div><div class="deps">${usedBy.map((d) => `<button data-sel="${d.id}">${esc(d.name)}</button>`).join('') || '<span class="note">—</span>'}</div></div>
    <p class="note">${esc(STATUS[c.status] || '')}.${c.cert ? ' ' + esc(CERT[c.cert]) + '.' : ''}</p>`;
}

function actuatorComponents(act) {
  const m = {
    slidingDoor: ['sliding-door'], rearDoors: ['rear-doors'], table: ['lagun-table'], seatSwivel: ['seat-driver', 'seat-passenger'], bedLounge: ['mattress', 'bed-platform'],
    wetbathDoor: ['wetbath'], sinkCover: ['sink'], bedStep: ['bed-step'], covers: ['window-covers'], slideOut: ['slideout-pod'], awning: ['awning'],
    outdoorKitchen: ['outdoor-kitchen'], rearTable: ['rear-door-table', 'rear-door-bench', 'rear-doors'], drawers: ['galley-drawers'], fridgeDrawers: ['fridge'],
    microwaveDoor: ['microwave'], prepBoard: ['prep-board'], overheads: ['oh-galley-1', 'oh-galley-2', 'oh-galley-3', 'oh-bed-pass', 'oh-bed-drv', 'tower', 'wardrobe'],
    trashPullout: ['trash-bins'], toilet: ['toilet', 'wetbath'], laundry: ['laundry'], deckHatches: ['bed-platform', 'combi-heater'], garageHatch: ['bed-platform', 'fresh-tank'], outdoorShower: ['outdoor-shower'],
  };
  return m[act] || [];
}
export { actuatorComponents };

function routeHTML(id) {
  const p = PIPES.find((x) => x.id === id);
  const w = WIRES.find((x) => x.id === id);
  const d = DUCTS.find((x) => x.id === id);
  const r = p || w || d;
  if (!r) return '';
  let len = 0;
  for (let i = 1; i < r.pts.length; i++) len += Math.hypot(...r.pts[i].map((v, k) => v - r.pts[i - 1][k]));
  const kindName = { cold: 'Cold water (PEX)', hot: 'Hot water (PEX)', drink: 'Filtered drinking water', grey: 'Grey-water drain', fill: 'Fill hose', vent: 'Vent', fuel: 'Diesel line', drain: 'Low-point / winterising drain',
    dcmain: 'Battery cable', dc: '12 V DC circuit', ac: '120 V AC circuit', pv: 'PV string cable', alt: 'Alternator feed', shore: 'Shore-power cable', data: 'Control / data cable', heat: 'Warm-air duct (65 mm)', ac_: 'AC supply duct', exhaust: 'Exhaust duct', fresh: 'Fresh-air duct' }[r.kind] || r.kind;
  const circ = w?.circuit ? CIRCUITS.find((c) => c.id === w.circuit) : null;
  return `<div class="eyebrow">${p ? 'Plumbing' : w ? 'Wiring' : 'Ducting'} route</div><h2 class="title">${esc(kindName)}</h2>
    <div class="card"><dl class="kv"><dt>From</dt><dd>${esc(byId[r.from]?.name || r.from)}</dd><dt>To</dt><dd>${esc(byId[r.to]?.name || r.to)}</dd><dt>Routed length</dt><dd>${len.toFixed(2)} m</dd>
    ${p ? `<dt>Bore</dt><dd>${Math.round(p.d * 1000)} mm</dd>` : ''}${circ ? `<dt>Conductor</dt><dd>${circ.awg} AWG</dd><dt>Protection</dt><dd>${circ.fuseA ?? circ.breakerA} A ${circ.fuseA ? 'fuse' : 'breaker'}</dd><dt>Design current</dt><dd>${circ.maxA.toFixed(0)} A</dd>` : ''}
    ${d?.r ? `<dt>Diameter</dt><dd>${Math.round(d.r * 2000)} mm</dd>` : ''}</dl></div>
    <div class="deps"><button data-sel="${r.from}">${esc(byId[r.from]?.name || r.from)}</button><button data-sel="${r.to}">${esc(byId[r.to]?.name || r.to)}</button></div>`;
}

function vehicleHTML() {
  const rows = [
    ['Wheelbase', VAN.wheelbase], ['Overall length', VAN.overallLength], ['Body width', VAN.bodyWidth], ['Overall height (unladen)', VAN.overallHeight],
    ['Cargo length at floor', VAN.cargoLength], ['Max load width', VAN.loadWidth], ['Between wheel arches', VAN.wheelArchGap], ['Interior height', VAN.interiorHeight], ['Load floor height', VAN.loadFloorHeight],
  ];
  const masses = [['GVWR', VAN.gvwr], ['Front GAWR', VAN.gawrFront], ['Rear GAWR', VAN.gawrRear], ['Unladen front axle', VAN.curbFront], ['Unladen rear axle', VAN.curbRear]];
  return `<div class="eyebrow">Base vehicle</div><h2 class="title">${esc(VAN.model)}</h2>
    <div class="card"><table class="t"><tr><th>Dimension</th><th></th><th>Source</th></tr>${rows.map(([n, d]) => `<tr><td>${n}</td><td class="n">${mm(d.v)}</td><td>${statusPill(d.src)}</td></tr>`).join('')}</table></div>
    <div class="card"><table class="t"><tr><th>Mass rating</th><th></th><th>Source</th></tr>${masses.map(([n, d]) => `<tr><td>${n}</td><td class="n">${kg(d.v)}</td><td>${statusPill(d.src)}</td></tr>`).join('')}</table>
    <p class="note">${esc(VAN.curbFront.note)}. The dealer listing's unladen split (2,232 lb front / 3,082 lb rear) looks transposed for a front-engine van, so a typical split is used — weigh the real van before finalising the layout.</p></div>`;
}

function introHTML() {
  return `<div class="eyebrow">Inspect</div><h2 class="title">Click any part of the van</h2>
  <p class="prose">Every cabinet, appliance, tank, pipe, cable and hinge is a real object with dimensions, mass, cost, operating principle, service needs and dependencies. Use X-ray or a simulation mode to click through the body.</p>
  <div class="card"><div class="subhead">Try this</div><div class="list">
    <button data-sel="combi-heater">Diesel heater & boiler <span>climate</span></button>
    <button data-sel="rooftop-ac">12 V rooftop AC <span>climate</span></button>
    <button data-sel="battery-a">House battery <span>electrical</span></button>
    <button data-sel="toilet">Drawer toilet <span>water</span></button>
    <button data-sel="slideout-pod">Slide-out bed pod <span>mechanical</span></button>
    <button data-sel="cooktop">Induction cooktop <span>kitchen</span></button>
    <button data-sel="van-body">Base vehicle data <span>OEM</span></button>
  </div></div>
  <p class="note">Labels: <b>verified</b> = published manufacturer or dealer spec; <b>typical</b> = typical for the product class; <b>assumption</b> = design assumption; <b>conceptual</b> = custom design that needs prototyping. Red pills flag work that needs a licensed engineer, electrician or certified installer.</p>`;
}

// ───────────────────────── Energy ─────────────────────────
export function buildEnergy(app) {
  const html = `
  <div class="card">
    <div class="row" style="align-items:flex-end">
      <div class="big"><span data-b="soc">--</span><small> %</small></div>
      <div style="margin-left:auto;text-align:right"><div data-b="state"></div><div class="num" style="font-size:12px;color:var(--muted)" data-b="va"></div></div>
    </div>
    <div class="bar tall" style="margin:8px 0 6px"><i data-b="socbar"></i><span class="mark" style="left:20%" title="Load-shedding 20 %"></span><span class="mark" style="left:10%" title="BMS cut-off 10 %"></span></div>
    <dl class="kv"><dt>House bank</dt><dd>${(BANK.capacityWh / 1000).toFixed(2)} kWh LiFePO4 (600 Ah)</dd><dt>Net battery power</dt><dd data-b="net"></dd><dt data-b="ttl-l">Time to 20 %</dt><dd data-b="ttl"></dd><dt>Usable energy left</dt><dd data-b="left"></dd><dt>DC current (peak limit 400 A)</dt><dd data-b="amps"></dd></dl>
  </div>
  <div class="tiles">
    <div class="tile"><span>Solar ${SOURCES.solar.wp} Wp</span><b data-b="solar">0 W</b><span data-b="ghi"></span></div>
    <div class="tile"><span>Alternator</span><b data-b="alt">0 W</b><label class="row" style="font-size:11px"><input type="checkbox" id="drive"> driving</label></div>
    <div class="tile"><span>Shore power</span><b data-b="shore">0 W</b><label class="row" style="font-size:11px"><input type="checkbox" id="shore"> <select id="shoreA" style="height:22px;font-size:11px"><option value="15">15 A</option><option value="30">30 A</option></select></label></div>
  </div>
  <div class="card">
    <div class="row"><div class="subhead" style="margin:0">Inverter · 120 V AC bus</div><span style="margin-left:auto" data-b="invpill"></span></div>
    <div class="bar tall" style="margin:7px 0 4px"><i data-b="invbar"></i><span class="mark" style="left:${(INVERTER.continuousW25 / INVERTER.peakW) * 100}%" title="Continuous rating"></span></div>
    <p class="note"><span data-b="invtxt"></span> · continuous ${INVERTER.continuousW25} W, surge ${INVERTER.peakW} W</p>
  </div>
  <div class="card">
    <div class="row"><div class="subhead" style="margin:0">Loads — switch them on</div><label class="row" style="margin-left:auto;font-size:12px"><input type="checkbox" id="sched"> follow daily routine</label></div>
    <div class="loads" style="margin-top:6px">${LOADS.filter((l) => !['monitor', 'toiletFan', 'slideout'].includes(l.id)).map(loadRow).join('')}</div>
    <dl class="kv" style="margin-top:8px"><dt>12 V DC loads</dt><dd data-b="dcw"></dd><dt>120 V AC loads (via inverter)</dt><dd data-b="acw"></dd><dt>Total from battery side</dt><dd data-b="totw"></dd></dl>
  </div>
  <div class="alerts" data-b="alerts"></div>
  <div class="card"><div class="subhead">24-hour energy budget · <span data-b="bscn"></span></div><div data-b="budget"><p class="note">Calculating…</p></div></div>`;
  return html;
}

function loadRow(l) {
  return `<div class="load" data-load="${l.id}"><span class="nm" title="${esc(l.name)}">${esc(l.name)}${l.bus === 'ac' ? ' <em>120 V</em>' : ''}</span>
    <span class="lv">${l.levels.map((lv, i) => `<button data-lv="${i}" title="${typeof lv.w === 'number' ? lv.w + ' W' : 'thermostat / auto'}">${esc(lv.n)}</button>`).join('')}</span>
    <output data-b="w-${l.id}">0 W</output></div>`;
}

export function updateEnergy(app, b, snap) {
  if (!snap) return;
  const soc = snap.soc;
  b.t('soc', Math.round(soc * 100));
  b.w('socbar', soc, soc < 0.2 ? 'var(--crit)' : soc < 0.4 ? 'var(--warn)' : 'var(--good)');
  const charging = snap.batW > 5;
  b.h('state', snap.dead ? '<span class="pill crit">BMS cut-off</span>' : snap.shed ? '<span class="pill warn">Load-shedding</span>' : charging ? '<span class="pill good">Charging</span>' : '<span class="pill info">Discharging</span>');
  b.t('va', `${snap.V.toFixed(2)} V · ${snap.batA >= 0 ? '+' : ''}${snap.batA.toFixed(0)} A`);
  b.t('net', `${snap.batW >= 0 ? '+' : ''}${W(snap.batW)}`);
  const usable = Math.max(0, (soc - BANK.shedSoc) * BANK.capacityWh);
  if (charging) {
    b.t('ttl-l', 'Time to full');
    b.t('ttl', dur(((1 - soc) * BANK.capacityWh) / snap.batW));
  } else {
    b.t('ttl-l', 'Time to 20 % at this load');
    b.t('ttl', snap.batW < -1 ? dur(usable / -snap.batW) : '∞');
  }
  b.t('left', Wh(Math.max(0, (soc - BANK.minSoc) * BANK.capacityWh)));
  b.t('amps', `${Math.round(Math.max(0, snap.peakDcA))} A`);
  b.t('solar', W(snap.solarW));
  b.t('ghi', `${Math.round(snap.wx.ghi)} W/m² sun`);
  b.t('alt', W(snap.altW));
  b.t('shore', W(snap.shoreCharge + snap.shoreToLoads));
  const invFrac = snap.invOut / INVERTER.peakW;
  b.w('invbar', invFrac, snap.trip ? 'var(--crit)' : snap.overload ? 'var(--warn)' : 'var(--info)');
  b.h('invpill', snap.trip ? '<span class="pill crit">Overload trip</span>' : snap.overload ? '<span class="pill warn">Over continuous</span>' : snap.invOut > 0 ? '<span class="pill good">Inverting</span>' : '<span class="pill muted">Search mode 4 W</span>');
  b.t('invtxt', `${W(snap.invOut)} out · ${W(snap.invIn)} drawn from battery`);
  for (const l of LOADS) {
    const w = snap.byLoad[l.id] || 0;
    b.t(`w-${l.id}`, W(w));
    b.t(`ld-${l.id}`, W(w));
  }
  b.t('dcw', W(snap.dcW));
  b.t('acw', W(snap.acBusW));
  b.t('totw', W(snap.loadW));
  // level buttons
  const root = b.el('soc')?.closest('.tabbody');
  if (root) {
    for (const row of root.querySelectorAll('[data-load]')) {
      const id = row.dataset.load;
      const man = app.ctrl.manualLoads[id];
      let cur = man ?? snap.levels[id] ?? 0;
      if (id === 'ac' && man === undefined) cur = 2;
      if (id === 'heater' && man === undefined) cur = 1;
      if (id === 'fridge' && man === undefined) cur = 1;
      if (id === 'greyHeat' && man === undefined) cur = 1;
      if (id === 'heatPump' && man === undefined) cur = app.ctrl.climate.heaterSource === 'heatpump' ? 1 : 0;
      for (const btn of row.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(Number(btn.dataset.lv) === cur));
    }
  }
  const alerts = [];
  if (snap.trip) alerts.push(['crit', `AC demand ${W(snap.invOut)} exceeds the ${INVERTER.peakW} W surge rating — the inverter would trip.`]);
  else if (snap.overload) alerts.push(['warn', `AC demand ${W(snap.invOut)} is above the ${snap.invCont} W continuous rating — allowed for minutes only.`]);
  if ((snap.levels.microwave || 0) > 0 && (snap.levels.induction || 0) > 1) alerts.push(['info', 'Load manager: microwave running, cooktop limited to 600 W so the inverter stays within 2.4 kW.']);
  if ((snap.levels.outlets || 0) === 2) alerts.push(['info', 'Load manager: kettle on the outlets — cooktop capped at 1.2 kW and microwave locked out.']);
  if (snap.shed) alerts.push(['warn', 'Battery below 20 %: GX load-shedding has switched off the AC compressor and cooking until you charge.']);
  if (snap.dead) alerts.push(['crit', 'Battery at 10 %: the BMS has disconnected the house loads to protect the cells.']);
  if (app.ctrl.heatPumpInstalled && app.ctrl.climate.heaterSource === 'heatpump' && snap.wx.T < -5) alerts.push(['warn', 'Below −5 °C the heat-pump option cannot extract heat — the diesel heater takes over.']);
  if (snap.solarW < 30 && snap.wx.ghi > 300) alerts.push(['info', 'Solar is curtailed — battery full and loads are low.']);
  b.h('alerts', alerts.map(([k, t]) => `<div class="alert ${k}">${esc(t)}</div>`).join(''));
}

export function budgetHTML(run) {
  const pd = run.perDay;
  const cats = Object.entries(pd.byCat).map(([k, v]) => ({ k, name: CATEGORIES[k], v, color: CAT_COLORS[k] }));
  const tot = Math.max(pd.loadWh, pd.solarWh + pd.altWh, 1);
  return `${stackBar(cats.map((c) => ({ ...c })), tot, ' Wh')}
    <div class="stack" style="margin-top:4px">${[['Solar', pd.solarWh, '#49c98b'], ['Alternator', pd.altWh, '#00b8d9'], ['Shore', pd.byCat ? 0 : 0, '#b070ff']].filter((p) => p[1] > 0).map(([n, v, c]) => `<span title="${n}: ${Math.round(v)} Wh" style="width:${(100 * v) / tot}%;background:${c}"></span>`).join('')}</div>
    <div class="legend" style="margin-top:6px">${cats.filter((c) => c.v > 5).map((c) => `<span><i style="background:${c.color}"></i>${c.name} ${Wh(c.v)}</span>`).join('')}<span><i style="background:#49c98b"></i>Solar ${Wh(pd.solarWh)}</span></div>
    <dl class="kv" style="margin-top:6px"><dt>Consumed per day</dt><dd>${Wh(pd.loadWh)}</dd><dt>Harvested per day</dt><dd>${Wh(pd.solarWh + pd.altWh)}</dd><dt>Net</dt><dd>${Wh(pd.solarWh + pd.altWh - pd.loadWh)}</dd><dt>Lowest battery</dt><dd>${Math.round(run.minSoc * 100)} %</dd></dl>`;
}

// ───────────────────────── Climate ─────────────────────────
export function buildClimate(app) {
  const hl = designHeatLoss({ Tout: -20, Tin: 20, covers: 1, ventM3h: nightVentM3h() });
  const cl = designCoolingLoad({ Tout: 38, Tin: 26, ghi: 920, covers: 1 });
  const ua = envelopeUA({ covers: 1 });
  const stepper = (key, label) => `<span>${label}</span><span class="stepper"><button data-sp="${key}" data-d="-0.5" aria-label="Lower ${label}">−</button><output data-b="sp-${key}">--</output><button data-sp="${key}" data-d="0.5" aria-label="Raise ${label}">+</button></span>`;
  return `
  <div class="card">
    <div class="row" style="align-items:flex-end"><div class="big"><span data-b="tin">--</span><small> °C inside</small></div><div style="margin-left:auto;text-align:right" data-b="cpill"></div></div>
    <div class="tiles" style="margin-top:8px">
      <div class="tile"><span>Outside</span><b data-b="tout"></b><span data-b="rhout"></span></div>
      <div class="tile"><span>Humidity</span><b data-b="rh"></b><span data-b="dp"></span></div>
      <div class="tile"><span>CO₂</span><b data-b="co2"></b><span data-b="vent"></span></div>
    </div>
    <p class="note" style="margin-top:6px" data-b="glass"></p>
  </div>
  <div class="card">
    <div class="subhead">Thermostat</div>
    <div class="seg three" style="grid-template-columns:repeat(5,1fr)" id="cmode">${['auto', 'heat', 'cool', 'vent', 'off'].map((m) => `<button data-mode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
    <div class="setp" style="margin-top:8px">${stepper('heatDay', 'Heat · day')}${stepper('heatNight', 'Heat · night (22:30–06:30)')}${stepper('coolDay', 'Cool · day')}${stepper('coolNight', 'Cool · night')}</div>
    <div class="subhead" style="margin-top:10px">Heat source</div>
    <div class="seg three" id="hsrc"><button data-src="diesel">Diesel</button><button data-src="electric">Electric</button><button data-src="heatpump">Heat pump</button></div>
    <label class="row" style="margin-top:6px;font-size:12.5px"><input type="checkbox" id="hpInst"> Heat-pump roof unit installed (optional, 120 V — conceptual)</label>
    <label class="row" style="font-size:12.5px"><input type="checkbox" id="quiet"> Quiet AC at night (≤ 55 % compressor)</label>
    <label class="row" style="font-size:12.5px"><input type="checkbox" id="autovent"> Automatic ventilation (CO₂ & humidity)</label>
  </div>
  <div class="card"><div class="subhead">Heat balance now (W into cabin)</div><div data-b="balance"></div></div>
  <div class="card"><dl class="kv">
    <dt>Heater output</dt><dd data-b="hout"></dd><dt>Diesel use</dt><dd data-b="diesel"></dd>
    <dt>AC cooling</dt><dd data-b="cool"></dd><dt>AC electrical input</dt><dd data-b="acw"></dd><dt>AC capacity at this ambient</dt><dd data-b="accap"></dd><dt>AC runtime on battery (to 20 %)</dt><dd data-b="acrt"></dd>
    <dt>Air exchange</dt><dd data-b="ach"></dd>
  </dl></div>
  <div class="card"><div class="subhead">Design calculations</div><dl class="kv">
    <dt>Envelope UA (covers on)</dt><dd>${ua.total.toFixed(1)} W/K</dd>
    <dt>Heat loss −20 °C → 20 °C</dt><dd>${W(hl.total)}</dd>
    <dt>&nbsp;· conduction / air</dt><dd>${W(hl.cond)} / ${W(hl.inf + hl.vent)}</dd>
    <dt>Heater capacity</dt><dd>${W(Math.max(...HEATER.dieselStagesW))} (${(Math.max(...HEATER.dieselStagesW) / hl.total).toFixed(1)}×)</dd>
    <dt>Cooling load 38 °C, full sun</dt><dd>${W(cl.total)}</dd>
    <dt>&nbsp;· solar / conduction / people</dt><dd>${W(cl.solar.total)} / ${W(cl.cond)} / ${W(cl.people)}</dd>
    <dt>AC capacity at 38 °C</dt><dd>${W(cl.capacity)} (${Math.round((100 * cl.capacity) / cl.total)} %)</dd>
    <dt>Night CO₂ (2 asleep, sealed)</dt><dd>${Math.round(steadyCO2(2, nightVentM3h() + 5.4))} ppm</dd>
  </dl><p class="note" style="margin-top:6px">Walls U ≈ 1.1, roof 1.0, floor 0.9 W/m²K (Thinsulate SM600L, 25 mm XPS, thermal-break tape). Single-glazed OEM windows drop from U 5.7 to 1.6 with the insulated covers.</p></div>`;
}

export function updateClimate(app, b, snap) {
  if (!snap) return;
  const cl = app.ctrl.climate;
  b.t('tin', snap.Tin.toFixed(1));
  b.h('cpill', snap.Qheat > 0 ? `<span class="pill warn">Heating · ${esc(cl.heaterSource)}</span>` : snap.Qcool > 0 ? '<span class="pill info">Cooling</span>' : '<span class="pill muted">Idle</span>');
  b.t('tout', C(snap.wx.T));
  b.t('rhout', `${Math.round(snap.wx.rh)} % RH`);
  b.t('rh', `${Math.round(snap.rhIn)} %`);
  b.t('dp', `dew point ${snap.dewPoint.toFixed(1)} °C`);
  b.t('co2', `${Math.round(snap.co2)} ppm`);
  b.t('vent', `${Math.round(snap.ventM3h)} m³/h`);
  b.h('glass', `${snap.covers > 0.5 ? 'Window covers on' : 'Window covers off'} · coldest glass surface ${snap.glassT.toFixed(1)} °C ${snap.condensation ? '<span class="pill warn">condensation forming</span>' : '<span class="pill good">no condensation</span>'}`);
  for (const k of ['heatDay', 'heatNight', 'coolDay', 'coolNight']) b.t(`sp-${k}`, `${cl[k].toFixed(1)}°`);
  const items = [['Conduction', snap.Qcond], ['Air exchange', snap.Qair], ['Solar', snap.Qsolar], ['People', snap.Qpeople], ['Equipment & cooking', snap.Qequip], ['Heater', snap.Qheat], ['Air conditioner', -snap.Qcool]];
  const mx = Math.max(300, ...items.map(([, v]) => Math.abs(v)));
  b.h('balance', items.map(([n, v]) => `<div class="row" style="font-size:12px;margin:2px 0"><span style="width:118px">${n}</span><div style="flex:1;position:relative;height:10px;background:var(--grid);border-radius:3px"><i style="position:absolute;top:0;bottom:0;${v >= 0 ? 'left:50%' : `right:50%`};width:${(50 * Math.abs(v)) / mx}%;background:${v >= 0 ? '#ef6c3a' : '#5aa9ff'};border-radius:3px"></i><i style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--muted)"></i></div><span class="num" style="width:62px;text-align:right">${v >= 0 ? '+' : ''}${Math.round(v)}</span></div>`).join(''));
  b.t('hout', W(snap.Qheat));
  b.t('diesel', snap.dieselLh > 0 ? `${(snap.dieselLh * 1000).toFixed(0)} mL/h (${(snap.dieselLh * 24).toFixed(1)} L/day at this rate)` : '0');
  b.t('cool', W(snap.Qcool));
  const acw = snap.byLoad.ac || 0;
  b.t('acw', acw ? `${W(acw)} · COP ${(snap.Qcool / acw).toFixed(1)}` : '0 W');
  b.t('accap', W(acCapacityW(snap.wx.T)));
  const usable = Math.max(0, (snap.soc - 0.2) * BANK.capacityWh);
  b.t('acrt', acw ? dur(usable / Math.max(1, acw + 60 - snap.solarW * 0)) : '—');
  b.t('ach', `${Math.round(snap.ventM3h)} m³/h · ${(snap.ventM3h / 13.4).toFixed(1)} air changes/h`);
  const root = b.el('tin')?.closest('.tabbody');
  if (root) {
    for (const btn of root.querySelectorAll('[data-mode]')) btn.setAttribute('aria-pressed', String(btn.dataset.mode === cl.mode));
    for (const btn of root.querySelectorAll('[data-src]')) btn.setAttribute('aria-pressed', String(btn.dataset.src === cl.heaterSource));
  }
}

// ───────────────────────── Water ─────────────────────────
export function buildWater(app) {
  const comps = COMPONENTS.filter((c) => c.system === 'water' || ['combi-heater', 'drinking-filter'].includes(c.id));
  return `
  <div class="card">
    <div class="subhead">Tanks & levels</div>
    ${[['fresh', 'Fresh water', `${WATER.freshUsableL} L usable`], ['boiler', 'Hot-water boiler', `${WATER.boilerL} L at ≤ 60 °C`], ['grey', 'Grey water', `${WATER.greyL} L, heated`], ['urine', 'Toilet urine bottle', `${WATER.urineL} L`], ['solids', 'Toilet solids bin', `${WATER.solidsUses} uses`]].map(([k, n, s]) => `
      <div style="margin:6px 0"><div class="row" style="font-size:12.5px"><span>${n} <span class="note">· ${s}</span></span><span class="num" style="margin-left:auto" data-b="t-${k}"></span></div><div class="bar"><i data-b="b-${k}"></i></div></div>`).join('')}
    <p class="note" data-b="wdays"></p>
  </div>
  <div class="card"><div class="subhead">Try it</div><div class="flex">
    <button class="btn" data-water="tap">Run tap 30 s (2 L)</button><button class="btn" data-water="shower">Navy shower (12 L)</button><button class="btn" data-water="dishes">Wash dishes (6 L)</button>
    <button class="btn" data-water="refill">Refill fresh</button><button class="btn" data-water="dump">Dump grey</button><button class="btn" data-water="toilet">Empty toilet</button>
    <button class="btn" data-water="leak">Simulate a leak</button><button class="btn" data-water="winter">Winterise</button>
  </div><div class="alerts" style="margin-top:8px" data-b="walerts"></div></div>
  <div class="card"><dl class="kv"><dt>Pump</dt><dd data-b="pump"></dd><dt>System pressure</dt><dd data-b="press"></dd><dt>Hot water at the tap</dt><dd data-b="hot"></dd><dt>Hot water ready for</dt><dd data-b="hotrdy"></dd></dl></div>
  <div class="card"><div class="subhead">Freeze protection at <span data-b="ft"></span></div><div class="list" data-b="freeze"></div></div>
  <div class="card"><div class="subhead">Plumbing components — click to locate</div><div class="list">${comps.map((c) => `<button data-sel="${c.id}">${esc(c.name)}<span>${c.capacityL ? c.capacityL + ' L' : esc(c.zone)}</span></button>`).join('')}</div></div>
  <div class="card"><div class="subhead">Routed pipework</div><div class="legend">${[['#2f6fd6', 'cold'], ['#d6402f', 'hot'], ['#54c6e8', 'drinking'], ['#5c5f63', 'grey drain'], ['#e9ecef', 'fill'], ['#9aa0a6', 'vent'], ['#111', 'diesel']].map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>
  <p class="note" style="margin-top:6px">${PIPES.length} routed runs. Drains fall continuously to the under-floor grey tank; every branch isolates at the garage manifold; low-point drains and an air blow-out fitting make winterising a 15-minute job.</p></div>`;
}

export function updateWater(app, b, snap) {
  if (!snap) return;
  const st = app.simState;
  const lv = [['fresh', st.freshL / WATER.freshUsableL, `${st.freshL.toFixed(0)} L`], ['boiler', Math.max(0, (st.boilerT - 12) / 48), `${st.boilerT.toFixed(0)} °C`], ['grey', st.greyL / WATER.greyL, `${st.greyL.toFixed(0)} L`], ['urine', st.urineL / WATER.urineL, `${st.urineL.toFixed(1)} L`], ['solids', st.solidsUses / WATER.solidsUses, `${Math.round(st.solidsUses)} uses`]];
  for (const [k, f, t] of lv) {
    b.t(`t-${k}`, t);
    const bad = k === 'fresh' || k === 'boiler' ? f < 0.2 : f > 0.8;
    b.w(`b-${k}`, f, bad ? 'var(--warn)' : k === 'grey' || k === 'urine' || k === 'solids' ? '#8b7d5a' : k === 'boiler' ? '#ff6b3d' : 'var(--info)');
  }
  b.t('wdays', `At ~39 L/day (2 people, showers every other day): fresh lasts ${(st.freshL / 39).toFixed(1)} days, grey fills in ${((WATER.greyL - st.greyL) / 33).toFixed(1)} days, urine bottle in ${((WATER.urineL - st.urineL) / 1.6).toFixed(1)} days.`);
  b.t('pump', app.waterFlags.leak ? 'Locked out by leak alarm' : snap.drawL > 0 ? `Running · ${W(snap.byLoad.pump || 80)}` : 'Idle (pressure switch)');
  b.t('press', snap.drawL > 0 ? '≈ 40 psi dynamic' : app.waterFlags.winter ? '0 (drained)' : '55 psi static (accumulator)');
  b.t('hot', `${Math.min(st.boilerT, 60).toFixed(0)} °C boiler → 40 °C thermostatic mix`);
  const mix = (40 - 12) / Math.max(1, st.boilerT - 12);
  b.t('hotrdy', st.boilerT > 40 ? `≈ ${(10 / Math.max(0.3, mix) / 5.7).toFixed(1)} min of 40 °C shower before reheat` : 'reheating…');
  b.t('ft', C(snap.wx.T));
  b.h('freeze', FREEZE_PROTECTION.map((f) => {
    const ok = f.minC === undefined ? snap.Tin > 2 : snap.wx.T > f.minC;
    return `<div class="row" style="align-items:flex-start;gap:8px"><span class="pill ${ok ? 'good' : 'crit'}" style="flex:none">${ok ? 'OK' : 'risk'}</span><span>${esc(byId[f.id]?.name || f.id)} — <span class="note">${esc(f.method)}</span></span></div>`;
  }).join(''));
  const al = [];
  if (app.waterFlags.leak) al.push(['crit', 'Leak probe under the shower pan is wet — the Cerbo relay has cut power to the pump and the alarm is sounding. Clear the leak, then press again to reset.']);
  if (app.waterFlags.winter) al.push(['info', 'Winterised: fresh tank, boiler (FrostControl valve) and lines drained and blown out; grey dumped; RV antifreeze in the traps. Press again to recommission.']);
  if (st.greyL > WATER.greyL * 0.9) al.push(['warn', 'Grey tank almost full — sink and shower draws are blocked until you dump it.']);
  if (st.freshL < 10) al.push(['warn', 'Fresh water nearly empty.']);
  if (st.urineL > WATER.urineL * 0.85) al.push(['warn', 'Urine bottle nearly full — empty into a toilet.']);
  b.h('walerts', al.map(([k, t]) => `<div class="alert ${k}">${esc(t)}</div>`).join(''));
}
