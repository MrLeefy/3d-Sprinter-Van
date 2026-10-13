// Resource simulation and engineering acceptance tabs.
import { SCENARIOS, scenarioById } from '../data/scenarios.js';
import { runScenario, endurance, CATEGORIES } from '../sim/model.js';
import { runAcceptance } from '../sim/acceptance.js';
import { weightReport } from '../sim/weight.js';
import { costReport } from '../sim/cost.js';
import { spaceReport } from '../sim/space.js';
import { designHeatLoss, designCoolingLoad, envelopeUA, nightVentM3h } from '../sim/thermal.js';
import { COMPONENTS, CERT, STATUS, SYSTEMS } from '../data/components.js';
import { BANK, SOURCES } from '../data/electrical.js';
import { WATER } from '../data/plumbing.js';
import { VAN } from '../data/vehicle.js';
import { HEATER, acCapacityW } from '../data/climate.js';
import { lineChart, legend } from './charts.js';
import { CAT_COLORS } from './tabs.js';
import { W, Wh, kg, lb, usd, esc, mm } from './fmt.js';

const LIMIT_NAMES = { battery: 'Battery at 20 % (load-shedding)', fresh: 'Fresh water empty', grey: 'Grey tank full', urine: 'Urine bottle full', solids: 'Toilet solids bin full', fuel: 'Fuel at ¼ (heater standpipe)' };

export function buildResources(app) {
  const r = app.res;
  return `
  <div class="card">
    <div class="setp">
      <span>Scenario</span><select id="r-scn">${SCENARIOS.map((s) => `<option value="${s.id}" ${s.id === r.scn ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span>Duration</span><select id="r-days">${[1, 2, 3, 5, 7].map((d) => `<option value="${d}" ${d === r.days ? 'selected' : ''}>${d} day${d > 1 ? 's' : ''}</option>`).join('')}</select>
      <span>Driving per day</span><select id="r-drive">${[0, 1, 2].map((d) => `<option value="${d}" ${d === r.drive ? 'selected' : ''}>${d ? d + ' h (alternator)' : 'scenario default'}</option>`).join('')}</select>
      <span>Rooftop solar</span><select id="r-solar"><option value="1" ${r.solar ? 'selected' : ''}>1020 Wp installed</option><option value="0" ${!r.solar ? 'selected' : ''}>not fitted</option></select>
      <span>Shore power</span><select id="r-shore"><option value="0" ${!r.shore ? 'selected' : ''}>none (off-grid)</option><option value="1" ${r.shore ? 'selected' : ''}>15 A hook-up</option></select>
    </div>
    <p class="note" style="margin-top:8px" data-b="story"></p>
  </div>
  <div class="tiles" data-b="rtiles"></div>
  <div class="card"><canvas class="chart" id="ch-soc"></canvas>${legend([['#49c98b', 'Battery %'], ['#f7d65a', 'Solar W'], ['#ef6c3a', 'Load W']])}</div>
  <div class="card"><canvas class="chart" id="ch-temp"></canvas>${legend([['#ff8a3d', 'Inside °C'], ['#5aa9ff', 'Outside °C']])}</div>
  <div class="card"><canvas class="chart" id="ch-water"></canvas>${legend([['#5aa9ff', 'Fresh L'], ['#8b7d5a', 'Grey L'], ['#ff6b3d', 'Diesel used L ×10']])}</div>
  <div class="card"><canvas class="chart" id="ch-air"></canvas>${legend([['#a98bff', 'CO₂ ppm'], ['#3fc9a5', 'RH % ×10']])}</div>
  <div class="card"><div class="subhead">Daily averages by use</div><div data-b="rcats"></div></div>
  <div class="card"><div class="subhead">Endurance without any resupply</div><div data-b="rend"><p class="note">Calculating…</p></div></div>`;
}

export function runResources(app, b) {
  const r = app.res;
  const base = scenarioById[r.scn];
  const scn = { ...base, driveHours: r.drive ? Array(7).fill(r.drive) : base.driveHours };
  const ctrl = { solar: r.solar, shore: { connected: r.shore, limitA: 15 } };
  const run = runScenario(scn, ctrl, { days: r.days, sampleMin: 15 });
  b.t('story', base.story);
  const pd = run.perDay;
  const tiles = [
    ['Lowest battery', `${Math.round(run.minSoc * 100)} %`],
    ['Energy used / day', Wh(pd.loadWh)],
    ['Solar + alternator / day', Wh(pd.solarWh + pd.altWh)],
    ['Water / day', `${pd.waterL.toFixed(0)} L`],
    ['Diesel (heater) / day', `${pd.dieselL.toFixed(2)} L`],
    ['AC condensate / day', `${pd.condensateL.toFixed(1)} L`],
    ['Cabin range (occupied)', `${run.minT.toFixed(1)}–${run.maxT.toFixed(1)} °C`],
    ['Peak CO₂', `${Math.round(run.maxCO2)} ppm`],
    ['Inverter overload', `${Math.round(run.overloadMin)} min`],
  ];
  b.h('rtiles', tiles.map(([n, v]) => `<div class="tile"><span>${n}</span><b>${v}</b></div>`).join(''));
  const S = run.samples;
  const xMax = r.days * 24;
  const nights = [];
  for (let d = 0; d < r.days; d++) {
    const w = base.weather[Math.min(d, base.weather.length - 1)];
    const st = base.startHour ?? 0;
    nights.push({ x0: Math.max(0, d * 24 - st), x1: Math.max(0, d * 24 + w.sunrise - st), color: 'rgba(90,120,170,0.10)' });
    nights.push({ x0: Math.max(0, d * 24 + w.sunset - st), x1: Math.min(xMax, d * 24 + 24 - st), color: 'rgba(90,120,170,0.10)' });
  }
  const markers = Object.entries(run.limits).map(([k, t]) => ({ x: t, label: LIMIT_NAMES[k].split(' (')[0], color: k === 'battery' ? '#ef5a5a' : '#f2c14e' }));
  const maxW = Math.max(1000, ...S.map((s) => Math.max(s.solarW, s.loadW)));
  lineChart(document.getElementById('ch-soc'), {
    title: 'Battery state of charge (left) & power (scaled)', xMax, yMin: 0, yMax: 100, yFmt: (v) => `${v}%`, bands: nights, markers,
    series: [
      { pts: S.map((s) => [s.t, (s.solarW / maxW) * 100]), color: '#f7d65a', fill: 'rgba(247,214,90,0.18)', width: 1 },
      { pts: S.map((s) => [s.t, (s.loadW / maxW) * 100]), color: '#ef6c3a', width: 1 },
      { pts: S.map((s) => [s.t, s.soc * 100]), color: '#49c98b', width: 2.2 },
    ],
  });
  const tmin = Math.floor(Math.min(...S.map((s) => Math.min(s.Tin, s.Tout))) / 5) * 5;
  const tmax = Math.ceil(Math.max(...S.map((s) => Math.max(s.Tin, s.Tout))) / 5) * 5;
  lineChart(document.getElementById('ch-temp'), {
    title: 'Temperature °C', xMax, yMin: tmin, yMax: tmax, yFmt: (v) => `${v}°`, bands: nights,
    series: [{ pts: S.map((s) => [s.t, s.Tout]), color: '#5aa9ff' }, { pts: S.map((s) => [s.t, s.Tin]), color: '#ff8a3d', width: 2.2 }],
  });
  lineChart(document.getElementById('ch-water'), {
    title: 'Water (L)', xMax, yMin: 0, yMax: 130, yFmt: (v) => `${v}`, bands: nights, markers: markers.filter((m) => m.label !== 'Battery at 20 %'),
    series: [{ pts: S.map((s) => [s.t, s.fresh]), color: '#5aa9ff', width: 2 }, { pts: S.map((s) => [s.t, s.grey]), color: '#8b7d5a', width: 2 }, { pts: S.map((s) => [s.t, s.diesel * 10]), color: '#ff6b3d', dash: [4, 3] }],
  });
  lineChart(document.getElementById('ch-air'), {
    title: 'Air quality', xMax, yMin: 400, yMax: 1400, yFmt: (v) => `${v}`, bands: nights,
    series: [{ pts: S.map((s) => [s.t, s.co2]), color: '#a98bff', width: 1.8 }, { pts: S.map((s) => [s.t, Math.min(1400, s.rh * 10)]), color: '#3fc9a5' }],
  });
  const cats = Object.entries(pd.byCat).sort((a, b2) => b2[1] - a[1]);
  const tot = cats.reduce((s, [, v]) => s + v, 0) || 1;
  b.h('rcats', `<div class="stack">${cats.map(([k, v]) => `<span title="${CATEGORIES[k]}" style="width:${(100 * v) / tot}%;background:${CAT_COLORS[k]}"></span>`).join('')}</div>
    <table class="t" style="margin-top:6px"><tr><th>Use</th><th style="text-align:right">per day</th><th style="text-align:right">share</th></tr>${cats.filter(([, v]) => v > 1).map(([k, v]) => `<tr><td><span class="sys"><i style="background:${CAT_COLORS[k]}"></i>${CATEGORIES[k]}</span></td><td class="n">${Wh(v)}</td><td class="n">${Math.round((100 * v) / tot)} %</td></tr>`).join('')}</table>`);
  setTimeout(() => {
    const e = endurance(scn, ctrl, 10);
    b.h('rend', e.all.length
      ? `<table class="t">${e.all.map((x, i) => `<tr><td>${i === 0 ? '<b>' : ''}${esc(LIMIT_NAMES[x.id])}${i === 0 ? '</b> — first limit' : ''}</td><td class="n">${x.days.toFixed(1)} days</td></tr>`).join('')}</table>
         <p class="note" style="margin-top:6px">Assumes the same weather repeating, no refills, dumps or shore power. Nothing here is infinite: battery, water, grey capacity, the toilet and fuel each set a limit.</p>`
      : '<p class="note">No limit reached in 10 days with this configuration.</p>');
  }, 30);
  return run;
}

// ───────────────────────── Engineering ─────────────────────────
export function buildEngineering() {
  return `
  <div class="card"><div class="row"><div><div class="subhead" style="margin:0">Acceptance tests</div><p class="note">Run against the model geometry, wiring, plumbing and simulations.</p></div><div style="margin-left:auto;text-align:right" data-b="acc-sum"></div></div></div>
  <div data-b="acc-list"><p class="note">Running checks…</p></div>
  <div class="card"><div class="subhead">Weight & axle loads</div><div data-b="e-weight"></div></div>
  <div class="card"><div class="subhead">Capacities & endurance</div><div data-b="e-cap"></div></div>
  <div class="card"><div class="subhead">Daily energy budget by scenario</div><div data-b="e-budget"><p class="note">Simulating six scenarios…</p></div></div>
  <div class="card"><div class="subhead">Heating & cooling demand</div><div data-b="e-hvac"></div></div>
  <div class="card"><div class="subhead">Space utilisation</div><div data-b="e-space"></div></div>
  <div class="card"><div class="subhead">Estimated conversion cost</div><div data-b="e-cost"></div></div>
  <div class="card"><div class="subhead">Needs licensed sign-off</div><div data-b="e-cert"></div></div>
  <div class="card"><div class="subhead">Labels & key assumptions</div><div data-b="e-assume"></div></div>`;
}

export function runEngineering(app, b) {
  // fast static figures first
  const w = weightReport();
  const bar = (v, max, warnAt = 0.9) => `<div class="bar" style="margin:3px 0 7px"><i style="width:${Math.min(100, (100 * v) / max)}%;background:${v > max ? 'var(--crit)' : v > max * warnAt ? 'var(--warn)' : 'var(--good)'}"></i></div>`;
  b.h('e-weight', `<dl class="kv"><dt>Conversion (dry build)</dt><dd>${kg(w.build)}</dd><dt>+ fluids, 2 people, gear</dt><dd>${kg(w.fluids + w.occupants + w.gear)}</dd>
    <dt>Gross weight / GVWR</dt><dd>${kg(w.gvw)} / ${kg(w.gvwr)}</dd></dl>${bar(w.gvw, w.gvwr)}
    <dl class="kv"><dt>Front axle / GAWR</dt><dd>${kg(w.front)} / ${kg(w.gawrFront)}</dd></dl>${bar(w.front, w.gawrFront)}
    <dl class="kv"><dt>Rear axle / GAWR</dt><dd>${kg(w.rear)} / ${kg(w.gawrRear)}</dd></dl>${bar(w.rear, w.gawrRear)}
    <dl class="kv"><dt>Payload remaining</dt><dd>${kg(w.payloadLeft)} (${lb(w.payloadLeft)})</dd><dt>Front-axle share</dt><dd>${w.frontPct.toFixed(1)} %</dd><dt>Centre of gravity</dt><dd>${mm(w.cg[0])} fwd of rear axle, ${mm(w.cg[1])} high, ${w.lateralOffsetMm.toFixed(0)} mm lateral</dd></dl>
    <p class="note" style="margin-top:4px">Curb weight ${kg(w.curb)} (${lb(w.curb)}) includes full fuel. Heaviest systems: ${Object.entries(w.bySystem).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, v]) => `${SYSTEMS[k]?.name || k} ${kg(v)}`).join(', ')}.</p>`);
  b.h('e-cap', `<dl class="kv"><dt>Fresh water</dt><dd>${WATER.freshL} L (+10 L boiler)</dd><dt>Grey water</dt><dd>${WATER.greyL} L heated</dd><dt>Toilet</dt><dd>${WATER.urineL} L urine · ~${WATER.solidsUses} solids uses</dd>
    <dt>House battery</dt><dd>${(BANK.capacityWh / 1000).toFixed(2)} kWh (${((BANK.capacityWh * 0.9) / 1000).toFixed(1)} kWh usable)</dd><dt>Solar</dt><dd>${SOURCES.solar.wp} Wp · MPPT 70 A</dd><dt>Alternator charging</dt><dd>100 A (≈ 1.4 kW)</dd><dt>Inverter</dt><dd>2.4 kW continuous / 5.5 kW surge</dd>
    <dt>Diesel for heating</dt><dd>${(VAN.fuelTank.v * 0.75).toFixed(0)} L above the ¼-tank standpipe (full tank)</dd></dl>`);
  const hl = designHeatLoss({ Tout: -20, Tin: 20, covers: 1, ventM3h: nightVentM3h() });
  const hl0 = designHeatLoss({ Tout: -20, Tin: 20, covers: 0, ventM3h: nightVentM3h() });
  const cl = designCoolingLoad({ Tout: 38, Tin: 26, ghi: 920, covers: 1 });
  const cl0 = designCoolingLoad({ Tout: 38, Tin: 26, ghi: 920, covers: 0 });
  const ua = envelopeUA({ covers: 1 });
  b.h('e-hvac', `<table class="t"><tr><th>Design case</th><th style="text-align:right">covers on</th><th style="text-align:right">covers off</th></tr>
    <tr><td>Heat loss −20 °C / 20 °C</td><td class="n">${W(hl.total)}</td><td class="n">${W(hl0.total)}</td></tr>
    <tr><td>Cooling load 38 °C sun / 26 °C</td><td class="n">${W(cl.total)}</td><td class="n">${W(cl0.total)}</td></tr></table>
    <dl class="kv" style="margin-top:6px"><dt>Heater capacity (diesel)</dt><dd>${W(HEATER.dieselStagesW[2])} → ${(HEATER.dieselStagesW[2] / hl.total).toFixed(1)}× margin</dd><dt>AC capacity at 38 °C</dt><dd>${W(acCapacityW(38))} → ${Math.round((100 * acCapacityW(38)) / cl.total)} % of load</dd>
    <dt>Diesel at −20 °C (continuous)</dt><dd>${((hl.total / 1000) * 0.11 * 24).toFixed(1)} L/day</dd><dt>Largest UA items</dt><dd>${ua.items.sort((a, c) => c.UA - a.UA).slice(0, 3).map((i) => `${i.name.split(' ')[0]} ${i.UA.toFixed(1)}`).join(', ')} W/K</dd></dl>`);
  const sp = spaceReport();
  b.h('e-space', `<dl class="kv"><dt>Cargo floor (finished)</dt><dd>${sp.grossFloor.toFixed(2)} m²</dd><dt>Built-in footprint</dt><dd>${sp.builtFloor.toFixed(2)} m² (${Math.round((100 * sp.builtFloor) / sp.grossFloor)} %)</dd><dt>Clear standing floor</dt><dd>${sp.standing.toFixed(2)} m² at ${mm(sp.standingHeight)} headroom</dd>
    <dt>Enclosed storage</dt><dd>${Math.round(sp.storageL)} L + garage gear space</dd><dt>Bed</dt><dd>1.33 m × ${sp.bed.retracted.toFixed(2)} m → ${sp.bed.deployed.toFixed(2)} m with pod</dd><dt>Volume built-in</dt><dd>${Math.round(sp.utilisation * 100)} % of interior</dd><dt>Seats</dt><dd>2 travel · 2 dining · 2 sleeping</dd></dl>`);
  const c = costReport();
  b.h('e-cost', `<table class="t">${c.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${usd(r.cost)}</td></tr>`).join('')}
    <tr><td>Contingency 10 %</td><td class="n">${usd(c.contingency)}</td></tr><tr><td>Certified installs (heater, electrical inspection)</td><td class="n">${usd(c.labor.certifiedInstalls)}</td></tr>
    <tr><th>DIY build (parts)</th><th style="text-align:right">${usd(c.diy)}</th></tr><tr><th>Professional build (${c.labor.proHours} h × $${c.labor.proRate})</th><th style="text-align:right">${usd(c.pro)}</th></tr>
    <tr><td>+ base van (est.)</td><td class="n">${usd(c.baseVan)}</td></tr><tr><th>Turn-key total</th><th style="text-align:right">${usd(c.totalPro)}</th></tr></table>
    <p class="note" style="margin-top:4px">2026 US retail estimates, excluding tax and shipping.</p>`);
  const certs = COMPONENTS.filter((x) => x.cert);
  b.h('e-cert', `<div class="list">${certs.map((x) => `<button data-sel="${x.id}">${esc(x.name)}<span>${x.cert}</span></button>`).join('')}</div>
    <p class="note" style="margin-top:4px">${Object.values(CERT).map(esc).join('. ')}. Body cut-outs (pod, roof fans, AC) need the Mercedes-Benz body-builder guidelines; all 120 V work follows NFPA 1192 / NEC; DC work follows ABYC E-11.</p>`);
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, COMPONENTS.filter((x) => x.status === k).length]));
  b.h('e-assume', `<dl class="kv">${Object.entries(STATUS).map(([k, v]) => `<dt>${k} · ${esc(v)}</dt><dd>${counts[k]}</dd>`).join('')}</dl>
    <ul class="note" style="margin:6px 0 0;padding-left:18px;line-height:1.5">
      <li>Unladen axle split assumed 56 % front (published listing appears transposed) — weigh the van.</li>
      <li>Interior finished dimensions assume 25 mm XPS floor and Thinsulate in rib depth; verify on the actual body.</li>
      <li>Weather profiles are idealised daily curves; solar uses a 0.78 system derate for a flat roof mount.</li>
      <li>Water use follows a conservative two-person van-life profile (≈ 39 L/day).</li>
      <li>Slide-out pod, drawer toilet, outdoor kitchen and rear-door table are custom designs that need prototypes and load tests.</li>
    </ul>`);
  // acceptance + scenario budgets (slower) after a frame
  setTimeout(() => {
    const acc = runAcceptance();
    const s = acc.summary;
    b.h('acc-sum', `<span class="pill good">${s.pass} pass</span> <span class="pill warn">${s.warn} warn</span> <span class="pill ${s.fail ? 'crit' : 'muted'}">${s.fail} fail</span>`);
    const cats = [...new Set(acc.checks.map((x) => x.cat))];
    b.h('acc-list', cats.map((cat) => {
      const list = acc.checks.filter((x) => x.cat === cat);
      const worst = list.some((x) => x.status === 'fail') ? 'fail' : list.some((x) => x.status === 'warn') ? 'warn' : 'pass';
      return `<details class="card" ${worst !== 'pass' ? 'open' : ''}><summary style="cursor:pointer"><span class="subhead" style="display:inline">${esc(cat)}</span> <span class="pill ${worst === 'pass' ? 'good' : worst === 'warn' ? 'warn' : 'crit'}">${list.filter((x) => x.status === 'pass').length}/${list.length}</span></summary>
        <div style="margin-top:6px">${list.map((x) => `<div class="chk"><span class="dot ${x.status}"></span><span>${esc(x.name)}</span><span class="v">${esc(String(x.value))} · limit ${esc(String(x.limit))}</span>${x.detail ? `<details><summary>details</summary>${esc(x.detail)}</details>` : ''}</div>`).join('')}</div></details>`;
    }).join(''));
    const rows = SCENARIOS.map((sc) => {
      const run = runScenario(sc, {}, { days: 1, dt: 120, sampleMin: 60 });
      const e = endurance(sc, {}, 10);
      return `<tr><td>${esc(sc.name)}</td><td class="n">${(run.perDay.loadWh / 1000).toFixed(1)}</td><td class="n">${((run.perDay.solarWh + run.perDay.altWh) / 1000).toFixed(1)}</td><td class="n">${run.perDay.dieselL.toFixed(1)}</td><td>${e.first ? `${esc(LIMIT_NAMES[e.first.id].split(' (')[0])} · ${e.first.days.toFixed(1)} d` : '—'}</td></tr>`;
    });
    b.h('e-budget', `<div class="scroll-x"><table class="t"><tr><th>Scenario</th><th style="text-align:right">use kWh</th><th style="text-align:right">harvest kWh</th><th style="text-align:right">diesel L</th><th>first limit</th></tr>${rows.join('')}</table></div>
      <p class="note" style="margin-top:4px">Per 24 h with the default daily routine; endurance repeats that day with no resupply.</p>`);
  }, 60);
}
