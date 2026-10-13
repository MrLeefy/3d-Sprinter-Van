// Application controller: layout, state, live simulation loop and interaction.
import * as THREE from 'three';
import { World, CAMERAS } from '../scene/world.js';
import { ACTUATORS, STAGES, resolveActuators, actuatorById } from '../data/mechanisms.js';
import { SCENARIOS, scenarioById, weatherAt, scheduleAt, DAY_SCHEDULE } from '../data/scenarios.js';
import { initialState, step, defaultControls, runScenario } from '../sim/model.js';
import { humidityRatio } from '../sim/thermal.js';
import { byId, SYSTEMS, COMPONENTS } from '../data/components.js';
import { WATER } from '../data/plumbing.js';
import { VAN } from '../data/vehicle.js';
import { renderInspector, buildEnergy, updateEnergy, budgetHTML, buildClimate, updateClimate, buildWater, updateWater } from './tabs.js';
import { buildResources, runResources, buildEngineering, runEngineering } from './analysis.js';
import { binder, hhmm, esc } from './fmt.js';
import { FLOW_COLORS } from '../scene/materials.js';

const SIM_MODES = [
  ['none', 'Off', '#8d9aab'], ['thermal', 'Thermal', '#ef6c3a'], ['electrical', 'Electrical', '#f2c418'], ['water', 'Water', '#3b8ff0'],
  ['ventilation', 'Ventilation', '#3fc9a5'], ['mechanical', 'Mechanical', '#a98bff'], ['living', 'Daily living', '#ff8a3d'], ['resources', 'Resources', '#49c98b'],
];
const VIEWS = [['normal', 'Normal'], ['xray', 'X-ray'], ['cutaway', 'Cutaway'], ['exploded', 'Exploded']];
const TABS = [['inspect', 'Inspect'], ['energy', 'Energy'], ['climate', 'Climate'], ['water', 'Water'], ['resources', 'Resources'], ['engineering', 'Engineering']];
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const LEGENDS = {
  thermal: [['#e8452a', 'heat escaping (length = W/m²)'], ['#ffa94d', 'heat entering'], ['#ffd43b', 'solar radiation'], [hex(FLOW_COLORS.heatWarm), 'heater warm air'], [hex(FLOW_COLORS.acCold), 'AC cold air'], [hex(FLOW_COLORS.recirc), 'return air'], ['#e9e4d4', 'insulation']],
  electrical: [[hex(FLOW_COLORS.dcmain), 'battery cables (4/0)'], [hex(FLOW_COLORS.dc), '12 V DC'], [hex(FLOW_COLORS.ac), '120 V AC'], [hex(FLOW_COLORS.pv), 'solar PV'], [hex(FLOW_COLORS.alt), 'alternator'], [hex(FLOW_COLORS.shore), 'shore power'], ['#7a8aa0', 'control']],
  water: [[hex(FLOW_COLORS.cold), 'cold'], [hex(FLOW_COLORS.hot), 'hot'], [hex(FLOW_COLORS.drink), 'drinking'], [hex(FLOW_COLORS.grey), 'grey drain'], [hex(FLOW_COLORS.fill), 'fill'], [hex(FLOW_COLORS.fuel), 'diesel'], [hex(FLOW_COLORS.drain), 'winterising drain']],
  ventilation: [[hex(FLOW_COLORS.fresh), 'filtered fresh air'], [hex(FLOW_COLORS.stale), 'stale air out'], [hex(FLOW_COLORS.cook), 'cooking extraction'], [hex(FLOW_COLORS.bath), 'shower steam'], [hex(FLOW_COLORS.acCold), 'AC supply'], [hex(FLOW_COLORS.heatWarm), 'heater air'], [hex(FLOW_COLORS.exhaust), 'sealed combustion exhaust']],
  mechanical: [['#b197fc', 'hinge'], ['#22b8cf', 'rail / slide'], ['#ff922b', 'actuator / strut'], ['#fa5252', 'latch'], ['#222222', 'seal'], ['#51cf66', 'support']],
};
const LEGEND_NOTE = {
  thermal: 'Arrows sit on each envelope element; the cabin volume is tinted by air temperature.',
  electrical: 'Particle speed is proportional to current. Switch loads on in the Energy tab.',
  water: 'Fast particles = water actually flowing. Use the Water tab to run taps and showers.',
  ventilation: 'Only running fans and appliances show moving air. Labels name each stream.',
  mechanical: 'Every hinge, rail, actuator, latch and seal. Hover a marker for its name; click it (or move a Systems slider) to label and operate that assembly.',
};

export class App {
  constructor(root) {
    this.root = root;
    root.innerHTML = layoutHTML();
    const q = new URLSearchParams(location.search);
    this.world = new World(root.querySelector('#viewport'), { lite: q.has('lite') });
    window.__app = this;
    // state
    this.master = 0;
    this.playing = false;
    this.playDir = 1;
    this.overrides = {};
    this.targets = {};
    this.values = resolveActuators(0).values;
    this.scnId = 'summer';
    this.clockRunning = false;
    this.speed = 10; // simulated minutes per real second
    this.simAcc = 0;
    this.ctrl = defaultControls();
    this.ctrl.useSchedule = false;
    this.followRoutine = false;
    this.living = false;
    this.livingActs = {};
    this.lastActivity = null;
    this.waterFlags = { leak: false, winter: false };
    this.selection = null;
    this.tab = 'inspect';
    this.res = { scn: 'summer', days: 1, drive: 0, solar: true, shore: false };
    this.blockedShown = new Set();
    this.resetSim(13);
    this.bindStatic();
    this.setScenario(q.get('scn') || 'summer', true);
    if (q.get('master')) this.master = parseFloat(q.get('master'));
    this.world.modes.apply();
    if (q.get('view')) this.setView(q.get('view'));
    if (q.get('sim')) this.setSim(q.get('sim'));
    if (q.get('hour')) this.setHour(parseFloat(q.get('hour')));
    this.setTab(q.get('tab') || (location.hash ? location.hash.slice(1) : 'inspect'));
    this.world.flyTo(q.get('cam') || 'exterior', 0.01);
    this.last = performance.now();
    this.snapT = 0;
    this.uiT = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  scn() {
    return scenarioById[this.scnId];
  }

  resetSim(hour = 13) {
    const scn = this.scn();
    const wx = weatherAt(scn, 0, hour);
    this.simState = initialState({ startHour: hour, soc: 0.86, Tin: Math.min(scn.climate.coolDay, Math.max(scn.climate.heatDay, wx.T)), x: Math.min(12, humidityRatio(wx.T, wx.rh) + 1.2) });
    this.snap = step(structuredClone(this.simState), scn, this.ctrlEff(), 1);
  }

  // ── Static bindings ─────────────────────────────────────
  bindStatic() {
    const R = this.root;
    const $ = (s) => R.querySelector(s);
    this.$ = $;
    // scenarios
    $('#scn').addEventListener('click', (e) => {
      const b = e.target.closest('[data-scn]');
      if (b) this.setScenario(b.dataset.scn);
    });
    // clock
    $('#hour').addEventListener('input', (e) => this.setHour(parseFloat(e.target.value)));
    $('#clockPlay').addEventListener('click', () => this.setClock(!this.clockRunning));
    $('#speed').addEventListener('change', (e) => (this.speed = parseFloat(e.target.value)));
    // views / sims / cameras
    $('#views').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) this.setView(b.dataset.view);
    });
    $('#sims').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sim]');
      if (b) this.setSim(b.dataset.sim);
    });
    $('#cams').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cam]');
      if (b) this.world.flyTo(b.dataset.cam);
    });
    $('#cutType').addEventListener('change', () => this.updateCut());
    $('#cutPos').addEventListener('input', () => this.updateCut());
    $('#services').addEventListener('change', (e) => {
      this.world.modes.showServices = e.target.checked;
      this.world.modes.apply();
    });
    // actuators
    $('#acts').addEventListener('input', (e) => {
      const id = e.target.dataset.act;
      if (!id) return;
      this.overrides[id] = parseFloat(e.target.value);
      delete this.targets[id];
      this.setActiveAct(id);
    });
    $('#resetActs').addEventListener('click', () => {
      this.overrides = {};
      this.targets = {};
      this.toast('All systems follow the master slider again.');
    });
    // master rail
    $('#master').addEventListener('input', (e) => {
      this.master = parseFloat(e.target.value);
      this.playing = false;
    });
    $('#play').addEventListener('click', () => {
      if (!this.playing) this.playDir = this.master >= 0.999 ? -1 : 1;
      this.playing = !this.playing;
    });
    // tabs
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.setTab(b.dataset.tab);
    });
    // delegated clicks inside the right panel
    $('#right').addEventListener('click', (e) => this.onPanelClick(e));
    $('#right').addEventListener('change', (e) => this.onPanelChange(e));
    // mobile sheets
    $('#mLeft').addEventListener('click', () => this.toggleSheet('left'));
    $('#mRight').addEventListener('click', () => this.toggleSheet('right'));
    // picking
    const cv = this.world.stage.renderer.domElement;
    let down = null;
    cv.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const hit = this.pickEvent(e);
      if (hit) this.select(hit);
    });
    let tipT = 0;
    cv.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - tipT < 90 || e.buttons) return;
      tipT = now;
      const hit = this.pickEvent(e);
      const tip = $('#tip');
      const name = hit ? (hit.feature ? hit.feature.label : hit.cid === 'van-body' ? 'Base vehicle' : hit.cid === 'occupant' ? 'Occupant' : byId[hit.cid]?.name) : null;
      if (name) {
        tip.textContent = name;
        tip.hidden = false;
        tip.style.left = `${e.clientX + 14}px`;
        tip.style.top = `${e.clientY + 12}px`;
      } else tip.hidden = true;
    });
    cv.addEventListener('pointerleave', () => ($('#tip').hidden = true));
    $('#timeline').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (b) this.setHour(parseFloat(b.dataset.t) + 0.02);
    });
  }

  pickEvent(e) {
    const r = this.world.stage.renderer.domElement.getBoundingClientRect();
    return this.world.pickAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  toggleSheet(which) {
    const L = this.$('#left'), Rt = this.$('#right');
    const el = which === 'left' ? L : Rt;
    const other = which === 'left' ? Rt : L;
    const open = el.dataset.open !== 'true';
    el.dataset.open = String(open);
    if (open) other.dataset.open = 'false';
  }

  // ── State setters ────────────────────────────────────────
  setScenario(id, initial = false) {
    if (!scenarioById[id]) return;
    this.scnId = id;
    const scn = this.scn();
    this.ctrl.climate = { ...this.ctrl.climate, ...scn.climate };
    delete this.ctrl.climate.covers;
    for (const b of this.root.querySelectorAll('[data-scn]')) b.setAttribute('aria-pressed', String(b.dataset.scn === id));
    const hour = initial ? (scn.id === 'overnight' ? 21 : 13) : scn.id === 'overnight' ? 21 : scn.id === 'winter' ? 8.5 : this.hour();
    this.resetSim(hour);
    this.setHour(hour);
    this.res.scn = id;
    if (this.tab === 'resources') this.renderTab();
    if (this.tab === 'energy') this.refreshBudget();
    if (!initial) this.toast(`${scn.name}: ${scn.story.split('. ')[0]}.`);
  }

  hour() {
    return this.simState.t - Math.floor(this.simState.t / 24) * 24;
  }

  setHour(h) {
    const day = Math.floor(this.simState.t / 24);
    this.simState.t = day * 24 + Math.max(0, Math.min(23.99, h));
    this.$('#hour').value = String(h);
    this.applyWeather();
    if (this.living) this.syncLiving(true);
  }

  setClock(on) {
    this.clockRunning = on;
    this.$('#clockPlay').setAttribute('aria-pressed', String(on));
    this.$('#clockPlay').textContent = on ? '❚❚' : '▶';
    this.$('#clockPlay').setAttribute('aria-label', on ? 'Pause simulated time' : 'Run simulated time');
  }

  applyWeather() {
    const scn = this.scn();
    const day = Math.floor(this.simState.t / 24);
    const h = this.hour();
    this.world.weather(scn, weatherAt(scn, day, h), h);
  }

  setView(v) {
    this.world.modes.view = v;
    for (const b of this.root.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
    this.$('#cutBox').hidden = v !== 'cutaway';
    this.updateCut();
  }

  updateCut() {
    const type = this.$('#cutType').value;
    const pos = parseFloat(this.$('#cutPos').value);
    this.world.modes.cut = { type, z: 0.95 - pos * 1.0, y: 2.7 - pos * 1.0 };
    this.world.modes.apply();
  }

  setSim(s) {
    const prev = this.world.modes.sim;
    if (prev === 'living' && s !== 'living') this.exitLiving();
    this.world.modes.sim = s;
    for (const b of this.root.querySelectorAll('[data-sim]')) b.setAttribute('aria-pressed', String(b.dataset.sim === s));
    const tabFor = { thermal: 'climate', electrical: 'energy', water: 'water', ventilation: 'climate', mechanical: 'inspect', resources: 'resources', living: 'energy' };
    if (tabFor[s]) this.setTab(tabFor[s]);
    if (s === 'living') this.enterLiving();
    if (['thermal', 'electrical', 'water', 'ventilation'].includes(s) && this.world.modes.view === 'normal') this.setView('xray');
    if (s === 'mechanical' && this.master < 0.2) this.master = 0.5;
    this.world.modes.apply();
    this.renderLegend();
  }

  setTab(t) {
    if (!TABS.find(([k]) => k === t)) t = 'inspect';
    this.tab = t;
    for (const b of this.root.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    this.renderTab();
    try {
      history.replaceState(null, '', `#${t}`);
    } catch (e) {
      /* sandboxed */
    }
  }

  renderTab() {
    const body = this.$('#tabbody');
    const t = this.tab;
    if (t === 'inspect') body.innerHTML = renderInspector(this, this.selection);
    else if (t === 'energy') body.innerHTML = buildEnergy(this);
    else if (t === 'climate') body.innerHTML = buildClimate(this);
    else if (t === 'water') body.innerHTML = buildWater(this);
    else if (t === 'resources') body.innerHTML = buildResources(this);
    else if (t === 'engineering') body.innerHTML = buildEngineering(this);
    this.b = binder(body);
    if (t === 'energy') {
      body.querySelector('#sched').checked = this.followRoutine;
      body.querySelector('#drive').checked = this.ctrl.driving;
      body.querySelector('#shore').checked = this.ctrl.shore.connected;
      body.querySelector('#shoreA').value = String(this.ctrl.shore.limitA);
      this.refreshBudget();
    }
    if (t === 'climate') {
      body.querySelector('#hpInst').checked = this.ctrl.heatPumpInstalled;
      body.querySelector('#quiet').checked = this.ctrl.climate.quietNight;
      body.querySelector('#autovent').checked = this.ctrl.climate.autoVent;
    }
    if (t === 'resources') requestAnimationFrame(() => runResources(this, this.b));
    if (t === 'engineering') requestAnimationFrame(() => runEngineering(this, this.b));
    this.updateTab(true);
  }

  refreshBudget() {
    const b = this.b;
    if (!b) return;
    clearTimeout(this.budgetT);
    this.budgetT = setTimeout(() => {
      const scn = this.scn();
      const run = runScenario(scn, { solar: this.ctrl.solar, shore: this.ctrl.shore, heatPumpInstalled: this.ctrl.heatPumpInstalled, climate: this.ctrl.climate }, { days: 1, dt: 120, sampleMin: 60 });
      b.t('bscn', scn.name);
      b.h('budget', budgetHTML(run));
    }, 50);
  }

  setActiveAct(id) {
    if (this.world.modes.activeAct === id) return;
    this.world.modes.activeAct = id;
    this.world.viz.setMechVisible(this.world.modes.sim === 'mechanical', id);
  }

  select(hit) {
    this.selection = hit;
    if (hit?.feature) this.setActiveAct(hit.feature.act);
    if (hit?.feature) {
      this.world.modes.setSelection(null);
    } else this.world.modes.setSelection(hit?.cid && byId[hit.cid] ? hit.cid : null);
    this.world.modes.apply();
    if (this.tab !== 'inspect') this.setTab('inspect');
    else this.renderTab();
    if (window.innerWidth < 900) this.$('#right').dataset.open = 'true';
  }

  focus(cid) {
    const c = byId[cid];
    if (!c) {
      if (cid === 'van-body') this.select({ cid });
      return;
    }
    this.select({ cid });
    const cen = new THREE.Vector3((c.box.x[0] + c.box.x[1]) / 2, (c.box.y[0] + c.box.y[1]) / 2, (c.box.z[0] + c.box.z[1]) / 2);
    const cam = this.world.stage.camera;
    const dir = cam.position.clone().sub(this.world.stage.controls.target).normalize();
    const size = Math.max(c.box.x[1] - c.box.x[0], c.box.y[1] - c.box.y[0], c.box.z[1] - c.box.z[0]);
    const dist = Math.min(7, Math.max(1.6, size * 3.2));
    this.world.camTween = { t: 0, dur: 1.0, p0: cam.position.clone(), t0: this.world.stage.controls.target.clone(), p1: cen.clone().addScaledVector(dir, dist), t1: cen };
    if (this.world.modes.view === 'normal' && c.placement !== 'roof' && c.placement !== 'exterior') this.setView('xray');
  }

  onPanelClick(e) {
    const sel = e.target.closest('[data-sel]');
    if (sel) return this.focus(sel.dataset.sel);
    const at = e.target.closest('[data-act-toggle]');
    if (at) {
      const id = at.dataset.actToggle;
      this.setActiveAct(id);
      const cur = this.values[id] ?? 0;
      this.targets[id] = cur > 0.5 ? 0 : 1;
      this.overrides[id] = cur;
      return;
    }
    const lvb = e.target.closest('[data-lv]');
    if (lvb) {
      const id = lvb.closest('[data-load]').dataset.load;
      const lv = Number(lvb.dataset.lv);
      if (id === 'heatPump') {
        this.ctrl.heatPumpInstalled = lv > 0 || this.ctrl.heatPumpInstalled;
        this.ctrl.climate.heaterSource = lv > 0 ? 'heatpump' : 'diesel';
      } else this.ctrl.manualLoads[id] = lv;
      if (id === 'lights') this.overrides.lightsOn = lv > 0 ? 1 : 0;
      this.snapT = 0;
      return;
    }
    const mode = e.target.closest('[data-mode]');
    if (mode) {
      this.ctrl.climate.mode = mode.dataset.mode;
      if (mode.dataset.mode === 'off') this.ctrl.manualLoads.ac = 0;
      else delete this.ctrl.manualLoads.ac;
      this.snapT = 0;
      return;
    }
    const sp = e.target.closest('[data-sp]');
    if (sp) {
      const k = sp.dataset.sp;
      this.ctrl.climate[k] = Math.max(5, Math.min(32, this.ctrl.climate[k] + parseFloat(sp.dataset.d)));
      this.snapT = 0;
      return;
    }
    const src = e.target.closest('[data-src]');
    if (src) {
      if (src.dataset.src === 'heatpump' && !this.ctrl.heatPumpInstalled) {
        this.ctrl.heatPumpInstalled = true;
        const cb = this.$('#hpInst');
        if (cb) cb.checked = true;
        this.toast('Heat-pump option enabled (conceptual 120 V roof unit, COP ≈ 2–3 above 0 °C, useless below −5 °C).');
      }
      this.ctrl.climate.heaterSource = src.dataset.src;
      this.snapT = 0;
      return;
    }
    const w = e.target.closest('[data-water]');
    if (w) return this.waterAction(w.dataset.water);
  }

  onPanelChange(e) {
    const id = e.target.id;
    if (id === 'sched') {
      this.followRoutine = e.target.checked;
      if (!this.followRoutine) this.ctrl.manualLoads = {};
    }
    if (id === 'drive') this.ctrl.driving = e.target.checked;
    if (id === 'shore') this.ctrl.shore.connected = e.target.checked;
    if (id === 'shoreA') this.ctrl.shore.limitA = parseInt(e.target.value, 10);
    if (id === 'hpInst') {
      this.ctrl.heatPumpInstalled = e.target.checked;
      if (!e.target.checked && this.ctrl.climate.heaterSource === 'heatpump') this.ctrl.climate.heaterSource = 'diesel';
    }
    if (id === 'quiet') this.ctrl.climate.quietNight = e.target.checked;
    if (id === 'autovent') this.ctrl.climate.autoVent = e.target.checked;
    if (id && id.startsWith('r-')) {
      const v = e.target.value;
      if (id === 'r-scn') this.res.scn = v;
      if (id === 'r-days') this.res.days = parseInt(v, 10);
      if (id === 'r-drive') this.res.drive = parseFloat(v);
      if (id === 'r-solar') this.res.solar = v === '1';
      if (id === 'r-shore') this.res.shore = v === '1';
      runResources(this, this.b);
    }
    if (['drive', 'shore', 'shoreA', 'hpInst'].includes(id) && this.tab === 'energy') this.refreshBudget();
    this.snapT = 0;
  }

  waterAction(a) {
    const s = this.simState;
    const draw = (L, hotFrac) => {
      if (this.waterFlags.leak || this.waterFlags.winter) return this.toast(this.waterFlags.leak ? 'Pump is locked out by the leak alarm.' : 'System is winterised — recommission first.');
      if (s.greyL + L > WATER.greyL) return this.toast('Grey tank is full — dump it first.');
      const got = Math.min(L, s.freshL);
      s.freshL -= got;
      s.greyL += got;
      const hot = got * hotFrac;
      s.boilerT = (s.boilerT * (WATER.boilerL - Math.min(hot, WATER.boilerL)) + 12 * Math.min(hot, WATER.boilerL)) / WATER.boilerL;
      this.pumpPulse = 2.5;
      if (got < L) this.toast('Fresh tank ran dry.');
    };
    if (a === 'tap') draw(2, 0.3);
    if (a === 'shower') draw(12, 0.58);
    if (a === 'dishes') draw(6, 0.5);
    if (a === 'refill') {
      s.freshL = WATER.freshUsableL;
      this.toast('Fresh tank filled through the hidden jamb inlet (120 L).');
    }
    if (a === 'dump') {
      s.greyL = 0;
      this.toast('Grey tank dumped at a dump station.');
    }
    if (a === 'toilet') {
      s.urineL = 0;
      s.solidsUses = 0;
      this.toast('Toilet emptied: urine bottle rinsed, solids bag sealed for the trash.');
    }
    if (a === 'leak') this.waterFlags.leak = !this.waterFlags.leak;
    if (a === 'winter') {
      this.waterFlags.winter = !this.waterFlags.winter;
      if (this.waterFlags.winter) {
        s.freshL = 0;
        s.greyL = 0;
        s.boilerT = Math.min(s.boilerT, 12);
      } else s.freshL = WATER.freshUsableL;
    }
    this.snapT = 0;
  }

  // ── Daily living ───────────────────────────────────────
  enterLiving() {
    this.living = true;
    this.lastActivity = null;
    this.setView('cutaway');
    this.$('#cutType').value = 'dollhouse';
    this.$('#cutPos').value = '0.4';
    this.updateCut();
    this.world.flyTo('dollhouse');
    this.speed = 6;
    this.$('#speed').value = '6';
    this.setClock(true);
    this.syncLiving(true);
    this.$('#caption').hidden = false;
    this.$('#timelineBox').hidden = false;
  }

  exitLiving() {
    this.living = false;
    this.livingActs = {};
    this.setClock(false);
    this.world.person.root.visible = false;
    this.$('#caption').hidden = true;
    this.$('#timelineBox').hidden = true;
  }

  syncLiving(force) {
    const h = this.hour();
    const act = scheduleAt(h);
    if (!force && this.lastActivity === act.id) return;
    this.lastActivity = act.id;
    // replay the day's actuator states up to this activity so time jumps stay consistent
    const acts = { slidingDoor: 0, rearDoors: 0, lightsOn: 0, table: 0, seatSwivel: 1, bedLounge: 0, wetbathDoor: 0, sinkCover: 0, bedStep: 1, covers: 1, slideOut: 1, awning: 0, outdoorKitchen: 0, rearTable: 0, drawers: 0, fridgeDrawers: 0, microwaveDoor: 0, prepBoard: 0, toilet: 0, overheads: 0 };
    for (const s of DAY_SCHEDULE) {
      if (s.t > h) break;
      Object.assign(acts, s.acts);
    }
    acts.lightsOn = (act.loads?.lights || 0) > 0 ? 1 : 0;
    if (act.id === 'away') acts.covers = 1;
    this.livingActs = acts;
    this.world.person.go(act.person.at, act.person.pose);
    if (act.person.at === 'outdoorKitchen' || act.person.at === 'rear') this.world.flyTo('rear');
    else if (this.world.camTween === null && force !== true) this.world.flyTo('dollhouse');
    this.$('#caption').innerHTML = `<b>${hhmm(h)}</b><span>${esc(act.label)}</span>`;
    for (const b of this.root.querySelectorAll('#timeline [data-t]')) b.setAttribute('aria-current', String(b.dataset.id === act.id));
  }

  ctrlEff() {
    const c = { ...this.ctrl, manualLoads: { ...this.ctrl.manualLoads } };
    const v = this.values || {};
    c.useSchedule = this.living || this.followRoutine;
    if (!c.useSchedule) {
      c.covers = v.covers ?? 0;
      c.podOut = (v.slideOut ?? 0) > 0.5;
      if (c.manualLoads.lights === undefined) c.manualLoads.lights = (v.lightsOn ?? 0) > 0.5 ? (this.hour() > 19 || this.hour() < 7 ? 1 : 2) : 0;
    } else {
      c.covers = null;
      c.podOut = undefined;
    }
    c.doorsOpen = Math.max(v.slidingDoor ?? 0, v.rearDoors ?? 0);
    if (this.waterFlags.leak || this.waterFlags.winter) c.manualLoads.pump = 0;
    if (this.pumpPulse > 0) c.manualLoads.pump = 1;
    return c;
  }

  // ── Frame loop ─────────────────────────────────────────
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.playing) {
      this.master = Math.max(0, Math.min(1, this.master + (this.playDir * dt) / 14));
      if (this.master <= 0 || this.master >= 1) this.playing = false;
    }
    if (this.pumpPulse > 0) this.pumpPulse -= dt;
    // actuator targets (smooth operation of individual systems)
    for (const [id, tgt] of Object.entries(this.targets)) {
      const a = actuatorById[id];
      const rate = 1 / Math.max(0.8, Math.min(4, (a?.seconds || 2) / 2));
      const cur = this.overrides[id] ?? 0;
      const next = cur + Math.sign(tgt - cur) * Math.min(Math.abs(tgt - cur), rate * dt);
      this.overrides[id] = next;
      if (next === tgt) delete this.targets[id];
    }
    const ov = this.living ? { ...this.livingActsSmooth(dt), ...this.overrides } : this.overrides;
    const res = resolveActuators(this.master, ov);
    this.values = res.values;
    for (const b of res.blocked) {
      if (!this.blockedShown.has(b.id)) {
        this.blockedShown.add(b.id);
        this.toast(`${actuatorById[b.id].name}: ${b.reason}`);
      }
    }
    if (!res.blocked.length) this.blockedShown.clear();
    // simulation
    const scn = this.scn();
    if (this.clockRunning) {
      this.simAcc += dt * this.speed * 60;
      let n = 0;
      while (this.simAcc >= 60 && n < 200) {
        this.snap = step(this.simState, scn, this.ctrlEff(), 60);
        this.simAcc -= 60;
        n++;
      }
      if (n) {
        this.applyWeather();
        this.$('#hour').value = String(this.hour());
        if (this.living) this.syncLiving(false);
      }
    } else {
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 0.25;
        this.snap = step(structuredClone(this.simState), scn, this.ctrlEff(), 1);
      }
    }
    this.world.update(dt, this.values, this.snap);
    this.uiT -= dt;
    if (this.uiT <= 0) {
      this.uiT = 0.2;
      this.updateUI();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  livingActsSmooth(dt) {
    this.livingCur = this.livingCur || {};
    for (const [k, v] of Object.entries(this.livingActs)) {
      const cur = this.livingCur[k] ?? v;
      const sec = actuatorById[k]?.seconds || 2;
      this.livingCur[k] = cur + Math.sign(v - cur) * Math.min(Math.abs(v - cur), (dt * 1.6) / Math.min(4, Math.max(0.6, sec / 3)));
    }
    return this.livingCur;
  }

  updateUI() {
    const h = this.hour();
    const day = Math.floor(this.simState.t / 24) + 1;
    this.$('#clockTxt').textContent = `Day ${day} · ${hhmm(h)}`;
    // rail
    const st = [...STAGES].reverse().find((s) => this.master >= s.at - 0.04) || STAGES[0];
    this.$('#stageName').textContent = st.name;
    this.$('#stageDesc').textContent = st.desc;
    this.$('#pct').textContent = `${Math.round(this.master * 100)} %`;
    if (document.activeElement !== this.$('#master')) this.$('#master').value = String(this.master);
    this.$('#play').textContent = this.playing ? '❚❚' : '▶';
    this.$('#play').setAttribute('aria-label', this.playing ? 'Pause transformation' : 'Play transformation');
    // actuator rows
    for (const row of this.root.querySelectorAll('#acts .act')) {
      const id = row.dataset.id;
      const v = this.values[id] ?? 0;
      const inp = row.querySelector('input');
      if (document.activeElement !== inp) inp.value = String(v);
      row.querySelector('output').textContent = `${Math.round(v * 100)}%`;
      row.classList.toggle('auto', this.overrides[id] === undefined && !!actuatorById[id].master);
    }
    this.updateTab(false);
    this.updateScreen();
  }

  updateTab() {
    const b = this.b;
    if (!b || !this.snap) return;
    if (this.tab === 'energy') updateEnergy(this, b, this.snap);
    if (this.tab === 'climate') updateClimate(this, b, this.snap);
    if (this.tab === 'water') updateWater(this, b, this.snap);
    if (this.tab === 'inspect' && this.selection) {
      for (const [k, v] of Object.entries(this.snap.byLoad)) b.t(`ld-${k}`, `${Math.round(v)} W`);
      const st = this.simState;
      b.w('lvl-fresh-tank', st.freshL / WATER.freshUsableL, 'var(--info)');
      b.t('lvlt-fresh-tank', `${st.freshL.toFixed(0)} L of ${WATER.freshUsableL} L`);
      b.w('lvl-grey-tank', st.greyL / WATER.greyL, '#8b7d5a');
      b.t('lvlt-grey-tank', `${st.greyL.toFixed(0)} L of ${WATER.greyL} L`);
    }
  }

  updateScreen() {
    const s = this.world.reg.screen;
    if (!s || !this.snap) return;
    const g = s.ctx, sn = this.snap;
    g.fillStyle = '#0b1420';
    g.fillRect(0, 0, 512, 384);
    g.fillStyle = '#1f4f8f';
    g.fillRect(0, 0, 512, 46);
    g.fillStyle = '#fff';
    g.font = 'bold 24px sans-serif';
    g.fillText(`House battery ${Math.round(sn.soc * 100)}%`, 16, 32);
    g.font = '22px sans-serif';
    const rows = [['Solar', `${Math.round(sn.solarW)} W`], ['Loads', `${Math.round(sn.loadW)} W`], ['Inside', `${sn.Tin.toFixed(1)} °C  ${Math.round(sn.rhIn)}%`], ['CO2', `${Math.round(sn.co2)} ppm`], ['Fresh', `${Math.round(this.simState.freshL)} L`], ['Grey', `${Math.round(this.simState.greyL)} L`]];
    rows.forEach(([k, v], i) => {
      g.fillStyle = '#8fb1d9';
      g.fillText(k, 16, 86 + i * 48);
      g.fillStyle = '#fff';
      g.fillText(v, 220, 86 + i * 48);
    });
    s.tex.needsUpdate = true;
  }

  renderLegend() {
    const s = this.world.modes.sim;
    const box = this.$('#legendbox');
    const items = LEGENDS[s];
    if (!items) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<div class="subhead">${esc(SIM_MODES.find((m) => m[0] === s)[1])} mode</div><div class="legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('')}</div><p class="note" style="margin-top:4px">${esc(LEGEND_NOTE[s])}</p>`;
  }

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    this.$('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
}

function layoutHTML() {
  const groups = [...new Set(ACTUATORS.map((a) => a.group))];
  const ticks = STAGES.map((s) => `<i style="left:calc(${s.at * 100}% - ${s.at * 14 - 7}px)"></i>`).join('');
  const tl = DAY_SCHEDULE.map((s) => `<button data-t="${s.t}" data-id="${s.id}" title="${hhmm(s.t)} ${esc(s.label)}" style="flex:${s.end - s.t};background:${actColor(s.id)}"></button>`).join('');
  return `
  <div id="viewport"></div>
  <header class="topbar">
    <div class="brand"><h1>Stealth Sprinter</h1><small>${esc(VAN.shortName)} · four-season off-grid camper · interactive engineering model</small></div>
    <div class="scn" id="scn" role="group" aria-label="Environment">${SCENARIOS.map((s) => `<button class="chip" data-scn="${s.id}" aria-pressed="false" title="${esc(s.name)}">${esc(s.short)}</button>`).join('')}</div>
    <div class="clock"><span class="time" id="clockTxt">Day 1 · 13:00</span><input type="range" id="hour" min="0" max="23.99" step="0.05" value="13" aria-label="Time of day">
      <button class="iconbtn" id="clockPlay" aria-pressed="false" aria-label="Run simulated time">▶</button>
      <select id="speed" aria-label="Simulation speed"><option value="1">1 min/s</option><option value="6">6 min/s</option><option value="10" selected>10 min/s</option><option value="30">30 min/s</option><option value="60">1 h/s</option></select></div>
  </header>
  <aside class="panel left" id="left" data-open="false">
    <section class="sect"><h3>View</h3><div class="seg" id="views">${VIEWS.map(([k, n]) => `<button data-view="${k}" aria-pressed="${k === 'normal'}">${n}</button>`).join('')}</div>
      <div id="cutBox" hidden style="margin-top:7px"><div class="row"><select id="cutType" aria-label="Cutaway type"><option value="dollhouse">Dollhouse</option><option value="side">Side wall</option><option value="roof">Roof off</option></select><input type="range" id="cutPos" min="0" max="1" step="0.01" value="0.4" aria-label="Cut depth" style="flex:1"></div></div>
      <label class="row" style="margin-top:7px;font-size:12.5px"><input type="checkbox" id="services"> Show concealed pipes, cables & ducts</label></section>
    <section class="sect"><h3>Simulation mode</h3><div class="seg" id="sims">${SIM_MODES.map(([k, n, c]) => `<button data-sim="${k}" aria-pressed="${k === 'none'}"><span class="k" style="background:${c}"></span>${n}</button>`).join('')}</div></section>
    <section class="sect"><h3>Camera</h3><div class="seg three" id="cams">${Object.keys(CAMERAS).map((k) => `<button data-cam="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></section>
    <section class="sect"><div class="row"><h3 style="margin:0">Systems</h3><button class="btn" id="resetActs" style="margin-left:auto;padding:2px 8px">Follow master</button></div>
      <p class="note" style="margin:4px 0 2px">Each system can be operated on its own; "auto" means it follows the master slider.</p>
      <div class="acts" id="acts">${groups.map((g) => `<div class="grp">${g}</div>${ACTUATORS.filter((a) => a.group === g).map((a) => `<div class="act" data-id="${a.id}"><span class="n" title="${esc(a.interlock || a.name)}">${esc(a.name)}</span><input type="range" min="0" max="1" step="0.01" value="0" data-act="${a.id}" aria-label="${esc(a.name)}"><output>0%</output></div>`).join('')}`).join('')}</div></section>
  </aside>
  <aside class="panel right" id="right" data-open="false">
    <nav class="tabs" id="tabs" role="tablist">${TABS.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="false">${n}</button>`).join('')}</nav>
    <div class="tabbody" id="tabbody"></div>
  </aside>
  <div class="rail" role="group" aria-label="Master transformation">
    <button class="play" id="play" aria-label="Play transformation">▶</button>
    <div class="top"><b id="stageName">Closed cargo van</b><span id="stageDesc"></span><span class="pct" id="pct">0 %</span></div>
    <div class="track"><input type="range" id="master" min="0" max="1" step="0.001" value="0" aria-label="Master transformation"><div class="ticks">${ticks}</div></div>
  </div>
  <div class="legendbox" id="legendbox" hidden></div>
  <div class="caption" id="caption" hidden></div>
  <div class="caption" id="timelineBox" hidden style="top:auto;bottom:104px;flex-direction:column;align-items:stretch;width:min(560px,calc(100% - 32px))"><div class="timeline" id="timeline">${tl}</div><div class="legend"><span><i style="background:#3d4f7a"></i>sleep</span><span><i style="background:#f2a33a"></i>cooking</span><span><i style="background:#a98bff"></i>work</span><span><i style="background:#3b8ff0"></i>shower</span><span><i style="background:#49c98b"></i>outside</span><span><i style="background:#8d9aab"></i>other</span></div></div>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <div class="tip" id="tip" hidden></div>
  <div class="mobile-toggles"><button id="mLeft">Controls</button><button id="mRight">Data</button></div>`;
}

function actColor(id) {
  if (id.startsWith('sleep')) return '#3d4f7a';
  if (id.startsWith('cook') || id === 'lunch' || id === 'outdoor') return '#f2a33a';
  if (id.startsWith('work') || id === 'relax') return '#a98bff';
  if (id === 'shower' || id === 'toilet') return '#3b8ff0';
  if (id === 'away' || id === 'store') return '#49c98b';
  return '#8d9aab';
}
