// Drive HUD, settings and help. Owns every drive-mode control: pedals, steering zone, D/R selector,
// cruise / limiter badges, reset-to-road, horn, speed-limit sign, driver-aid and season pickers.
// Settings persist in localStorage. Other drive features (map, GPS, services, passport) attach to
// `ui.modules` and get a tick() each frame while driving.
import { ASSISTS } from '../scene/drive.js';
import { SEASON_KEYS, SEASONS } from '../scene/season.js';
import { SCENARIOS } from '../data/scenarios.js';
import { drawWorldMap } from './mapview.js';
import { MapScreen } from './mapscreen.js';
import { Services } from './services.js';
import { Passport } from './passport.js';
import { SPEC, TRAILER_CARGO } from '../sim/truck.js';

const KEY = 'sprinter-drive-v2';
const DEFAULTS = () => ({
  assist: 'standard', steerSens: 1, units: /^en-US/i.test(navigator.language || '') ? 'mph' : 'kmh', camShake: 1, sound: true, volume: 0.8,
  haptics: true, tilt: false, tiltInvert: false, season: 'auto', seenHelp: false,
  vehicle: 'camper', trailer: 'dryvan', cargoPct: 0.6, manual: false,
});
const ASSIST_TEXT = {
  easy: 'Lane keeping, traction and stability control, soft pedals. Hard to get into trouble.',
  standard: 'Speed-sensitive steering and traction control. You hold your own lane.',
  pro: 'Raw physics: no aids, quick pedals, loose ground really is loose.',
};
const TRAILER_NAMES = { none: 'Bobtail', dryvan: 'Dry van', reefer: 'Reefer', flatbed: 'Flatbed', tanker: 'Tanker', logs: 'Log trailer', container: 'Container' };
const cargoKg = (trailer, pct) => {
  const r = TRAILER_CARGO[trailer];
  return r ? Math.round((r[0] + (r[1] - r[0]) * pct) / 100) * 100 : 0;
};
const mph = (kmh) => Math.round(kmh * 0.621371);
const limitSignValue = (kmh, units) => (units === 'mph' ? Math.round(mph(kmh) / 5) * 5 : Math.round(kmh / 5) * 5);

export class DriveUI {
  constructor(app) {
    this.app = app;
    this.world = app.world;
    this.D = app.world.driver;
    this.root = app.root.querySelector('#driveHud');
    this.s = DEFAULTS();
    try {
      Object.assign(this.s, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch {
      /* private mode: defaults */
    }
    this.modules = [];
    this.t = 0;
    this.build();
    this.bind();
    this.mapScreen = new MapScreen(this);
    this.services = new Services(this);
    this.passport = new Passport(this);
    this.D.onSight = () => this.passport.sawAnimal();
    this.apply(true);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* per-visit only */
    }
  }

  $(sel) {
    return this.root.querySelector(sel);
  }

  // ── Markup ─────────────────────────────────────────────────────────────────
  build() {
    this.root.innerHTML = `
    <canvas class="dh-map" id="dhMap" width="264" height="264" role="button" tabindex="0" aria-label="Map around the van. Tap for the full map."></canvas>
    <div class="dh-slot" id="dhSlot"></div>
    <button class="dh-menubtn" id="dhMenu" aria-label="Menu" aria-expanded="false">☰</button>
    <div class="dh-top">
      <button class="dh-btn dh-only-menu" id="dhCruiseM">Cruise control</button>
      <button class="dh-btn dh-only-menu" id="dhLimiterM">Speed limiter</button>
      <button class="dh-btn dh-only-menu" id="dhAssistM">Driving assist</button>
      <button class="dh-btn" id="dhCam" title="C">Camera · Chase</button>
      <button class="dh-btn" id="dhLights" title="L">Lights · auto</button>
      <button class="dh-btn" id="dhMapBtn" title="M">Map</button>
      <button class="dh-btn" id="dhSettings" title="Settings" aria-label="Driving settings">⚙</button>
      <button class="dh-btn primary" id="dhExit">Park · Esc</button>
    </div>
    <div class="dh-status" id="dhStatus" hidden></div>
    <div class="dh-warn" id="dhWarn" hidden role="alert"></div>
    <div class="dh-cluster">
      <div class="dh-speed"><b id="dhSpeed">0</b><button id="dhUnit" class="dh-unit" aria-label="Switch units">mph</button></div>
      <div class="dh-limit" id="dhLimit" hidden aria-label="Posted speed limit"><i>SPEED<br>LIMIT</i><b id="dhLimitV">65</b></div>
      <div class="dh-gear" id="dhGear">P</div>
      <span class="dh-fuelchip" id="dhFuelChip" title="Fuel">⛽ <b>75</b>%</span>
      <div class="dh-badges">
        <button id="dhCruise" title="V" aria-pressed="false">Cruise</button>
        <button id="dhLimiter" title="B" aria-pressed="false">Limiter</button>
        <button id="dhAssist" title="Driving assist">Standard</button>
      </div>
      <div class="dh-meters">
        <div class="dh-m"><span>Fuel</span><i class="bar"><i id="dhFuel"></i></i><em id="dhFuelT"></em></div>
        <div class="dh-m dh-semi-only"><span>Air</span><i class="bar"><i id="dhAir"></i></i><em id="dhAirT"></em></div>
        <div class="dh-m dh-semi-only"><span>Trailer angle</span><i class="bar"><i id="dhJack"></i></i><em id="dhJackT"></em></div>
        <div class="dh-m dh-semi-only"><span>Brakes</span><i class="bar"><i id="dhBrk"></i></i><em id="dhBrkT"></em></div>
        <div class="dh-m dh-semi-only"><span>Damage</span><i class="bar"><i id="dhDmg"></i></i><em id="dhDmgT"></em></div>
        <div class="dh-m dh-van-only"><span>House battery</span><i class="bar"><i id="dhBat"></i></i><em id="dhBatT"></em></div>
        <div class="dh-m"><span>Engine</span><i class="bar"><i id="dhRpm"></i></i><em id="dhRpmT"></em></div>
      </div>
      <div class="dh-info"><span id="dhRoad">Track</span><span id="dhSurface">Grass</span><span id="dhSlope">0°</span><span id="dhOdo">0.00 km</span></div>
    </div>
    <div class="dh-steer" id="dhSteer" aria-label="Steering: touch and drag left or right"><div class="dh-wheel" id="dhWheel"></div></div>
    <div class="dh-aux">
      <button id="dhReset" title="T" aria-label="Reset to the nearest road">⤺<small>Road</small></button>
      <button id="dhHorn" title="Q" aria-label="Horn">📯<small>Horn</small></button>
      <button id="dhPark" class="dh-semi-only" title="P" aria-label="Parking brake" aria-pressed="false">P<small>Park</small></button>
      <button id="dhEngBrk" class="dh-semi-only" title="K" aria-label="Engine brake" aria-pressed="false">K<small>Jake</small></button>
      <button id="dhShiftUp" class="dh-semi-only dh-manual" title="X" aria-label="Shift up">▲<small>Up</small></button>
      <button id="dhShiftDn" class="dh-semi-only dh-manual" title="Z" aria-label="Shift down">▼<small>Down</small></button>
    </div>
    <div class="dh-pedals">
      <button id="dhGearBtn" class="dh-gearbtn" title="R" aria-label="Drive or reverse"><b>D</b><small>R</small></button>
      <button id="dhBrake" aria-label="Brake">Brake</button>
      <button id="dhGas" aria-label="Accelerate">Go</button>
    </div>
    <p class="dh-hint">W / ↑ go · S / ↓ brake · A D steer · Space handbrake · R reverse · V cruise · B limiter · T back on road · Q horn · C camera · M map</p>
    <div class="dh-sheet" id="dhSheet" hidden role="dialog" aria-label="Driving settings">
      <div class="dh-sh-top"><b>Driving</b><button class="dh-x" id="dhSheetX" aria-label="Close">×</button></div>
      <div class="dh-row"><label>Vehicle</label>
        <div class="dh-seg" id="sVehicle"><button data-v="camper">Camper van</button><button data-v="semi">Semi truck</button></div>
        <div class="dh-semi-only" id="sSemiBox">
          <label class="dh-sub">Trailer</label>
          <div class="dh-seg four" id="sTrailer">${Object.entries(TRAILER_NAMES).map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</div>
          <label class="dh-sub">Load <em id="sCargoV"></em></label><input type="range" id="sCargo" min="0" max="1" step="0.05">
          <label class="dh-chk"><input type="checkbox" id="sManual"> Manual 10-speed (X / Z shift)</label>
          <p class="dh-note">Changing the vehicle puts it down where you are, stopped.</p>
        </div></div>
      <div class="dh-row"><label>Driving assist</label>
        <div class="dh-seg three" id="sAssist">${Object.entries(ASSISTS).map(([k, a]) => `<button data-v="${k}">${a.label}</button>`).join('')}</div>
        <p class="dh-note" id="sAssistNote"></p></div>
      <div class="dh-row"><label>Steering sensitivity <em id="sSensV"></em></label><input type="range" id="sSens" min="0.6" max="1.6" step="0.05"></div>
      <div class="dh-row"><label>Camera shake <em id="sShakeV"></em></label><input type="range" id="sShake" min="0" max="1.5" step="0.1"></div>
      <div class="dh-row"><label>Units</label><div class="dh-seg" id="sUnits"><button data-v="mph">mph</button><button data-v="kmh">km/h</button></div></div>
      <div class="dh-row"><label>Time of day <em id="sHourV"></em></label><input type="range" id="sHour" min="0" max="23.75" step="0.25"></div>
      <div class="dh-row"><label>Weather scenario</label>
        <div class="dh-seg" id="sScn">${SCENARIOS.map((c) => `<button data-v="${c.id}">${c.icon} ${c.short}</button>`).join('')}</div>
        <p class="dh-note">The scenario sets the weather and restarts the camper's simulation.</p></div>
      <div class="dh-row"><label>Scenery season</label>
        <div class="dh-seg five" id="sSeason"><button data-v="auto">Auto</button>${SEASON_KEYS.map((k) => `<button data-v="${k}">${SEASONS[k].label}</button>`).join('')}</div>
        <p class="dh-note">The land is identical in every season — only its dressing changes. Auto follows the scenario. Temperatures and weather in the simulation still follow the scenario.</p></div>
      <div class="dh-row"><label>Engine sound <em id="sVolV"></em></label><input type="range" id="sVol" min="0" max="1" step="0.05"><label class="dh-chk"><input type="checkbox" id="sSound"> Sound on</label></div>
      <div class="dh-row dh-two"><label class="dh-chk"><input type="checkbox" id="sHaptics"> Vibrate on bumps</label><label class="dh-chk"><input type="checkbox" id="sTilt"> Tilt to steer (phones)</label></div>
      <div class="dh-row"><label>Graphics</label><div class="dh-seg four" id="sQual"><button data-v="high">High</button><button data-v="medium">Med</button><button data-v="low">Low</button><button data-v="lite">Lite</button></div></div>
      <div class="dh-row"><button class="dh-btn" id="sHelp">Controls &amp; tips</button></div>
    </div>
    <div class="dh-sheet dh-help" id="dhHelp" hidden role="dialog" aria-label="Driving controls">
      <div class="dh-sh-top"><b>Controls &amp; tips</b><button class="dh-x" id="dhHelpX" aria-label="Close">×</button></div>
      <table class="dh-keys">
        <tr><td><kbd>W</kbd> <kbd>↑</kbd></td><td>Go</td></tr><tr><td><kbd>S</kbd> <kbd>↓</kbd></td><td>Brake · hold at a stop to back up</td></tr>
        <tr><td><kbd>A</kbd> <kbd>D</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>Steer</td></tr><tr><td><kbd>Space</kbd></td><td>Handbrake</td></tr>
        <tr><td><kbd>R</kbd></td><td>Drive / Reverse (at a standstill)</td></tr><tr><td><kbd>V</kbd></td><td>Cruise control · <kbd>+</kbd> <kbd>−</kbd> to adjust</td></tr>
        <tr><td><kbd>B</kbd></td><td>Speed limiter (holds the posted limit)</td></tr><tr><td><kbd>T</kbd></td><td>Back on the nearest road</td></tr>
        <tr><td><kbd>Q</kbd></td><td>Horn (air horn in the semi)</td></tr>
        <tr><td><kbd>P</kbd> <kbd>K</kbd></td><td>Semi: parking brake · engine brake (use it on long downhills)</td></tr>
        <tr><td><kbd>G</kbd> <kbd>X</kbd> <kbd>Z</kbd></td><td>Semi: auto / manual gearbox · shift up · shift down</td></tr><tr><td><kbd>C</kbd> <kbd>L</kbd> <kbd>M</kbd></td><td>Camera · lights · map</td></tr>
        <tr><td><kbd>E</kbd></td><td>Use a service (fuel, water, dump, shop) when stopped at one</td></tr><tr><td><kbd>Esc</kbd></td><td>Park</td></tr>
      </table>
      <p class="dh-note">Touch: drag anywhere on the left half to steer, hold Go or Brake on the right. Gamepad works too: stick steers, triggers go and brake, A handbrake, B drive/reverse, Y camera, X lights, bumpers cruise and limiter, Start back on road.</p>
      <p class="dh-note">Tips: slow down on gravel and snow — grip is far lower than on pavement. Stop at a fuel pump, water tap or dump station to use it. Tap the map for the big map, tap anywhere on it to set a GPS destination.</p>
    </div>`;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  bind() {
    const D = this.D, A = this.app;
    const $ = (s) => this.$(s);
    const seg0 = (id, fn) => $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) fn(b.dataset.v);
    });
    $('#dhExit').addEventListener('click', () => A.exitDrive());
    $('#dhCam').addEventListener('click', () => ($('#dhCam').textContent = `Camera · ${D.cycleCamera()}`));
    $('#dhLights').addEventListener('click', () => ($('#dhLights').textContent = `Lights · ${D.cycleLights()}`));
    $('#dhSettings').addEventListener('click', () => this.sheet('#dhSheet'));
    $('#dhSheetX').addEventListener('click', () => this.sheet(null));
    $('#dhHelpX').addEventListener('click', () => this.sheet(null));
    $('#sHelp').addEventListener('click', () => this.sheet('#dhHelp'));
    $('#dhMapBtn').addEventListener('click', () => this.openMap());
    $('#dhMap').addEventListener('click', () => this.openMap());
    $('#dhMap').addEventListener('keydown', (e) => e.key === 'Enter' && this.openMap());
    $('#dhUnit').addEventListener('click', () => this.set({ units: this.s.units === 'mph' ? 'kmh' : 'mph' }));
    const cruise = () => {
      const on = D.toggleCruise();
      if (!on && D.v < 2.5) A.toast('Cruise control needs a little speed first.');
      this.menu(false);
    };
    const limiter = () => {
      D.toggleLimiter();
      this.menu(false);
    };
    const assist = () => {
      const keys = Object.keys(ASSISTS);
      this.set({ assist: keys[(keys.indexOf(this.s.assist) + 1) % keys.length] });
      A.toast(`${ASSISTS[this.s.assist].label} driving. ${ASSIST_TEXT[this.s.assist]}`);
    };
    $('#dhCruise').addEventListener('click', cruise);
    $('#dhCruiseM').addEventListener('click', cruise);
    $('#dhLimiter').addEventListener('click', limiter);
    $('#dhLimiterM').addEventListener('click', limiter);
    $('#dhAssist').addEventListener('click', assist);
    $('#dhAssistM').addEventListener('click', assist);
    $('#dhMenu').addEventListener('click', () => this.menu());
    // choosing anything from the phone menu closes it again
    $('.dh-top').addEventListener('click', (e) => {
      if (e.target.closest('button') && !e.target.closest('#dhCruiseM, #dhLimiterM, #dhAssistM')) this.menu(false);
    });
    $('#sHour').addEventListener('input', (e) => A.setHour(parseFloat(e.target.value)));
    $('#dhReset').addEventListener('click', () => D.resetToRoad());
    const semiKey = (id, k) => $(id).addEventListener('click', () => {
      D.semiKey(k);
      this.syncSemi();
    });
    semiKey('#dhPark', 'p');
    semiKey('#dhEngBrk', 'k');
    semiKey('#dhShiftUp', 'x');
    semiKey('#dhShiftDn', 'z');
    seg0('#sVehicle', (v) => this.set({ vehicle: v }));
    seg0('#sTrailer', (v) => this.set({ trailer: v }));
    $('#sCargo').addEventListener('input', (e) => this.set({ cargoPct: parseFloat(e.target.value) }));
    $('#sManual').addEventListener('change', (e) => this.set({ manual: e.target.checked }));
    $('#dhHorn').addEventListener('pointerdown', () => D.honk());
    $('#dhGearBtn').addEventListener('click', () => {
      if (Math.abs(D.v) > 1.5) A.toast('Come to a stop before changing between Drive and Reverse.');
      else D.toggleGear();
    });
    // pedals: hold buttons (multi-touch safe via pointer capture)
    const pad = D.pad;
    const hold = (el, key) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        pad[key] = 1;
        el.classList.add('down');
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => {
        pad[key] = 0;
        el.classList.remove('down');
      });
    };
    hold($('#dhGas'), 'throttle');
    hold($('#dhBrake'), 'brake');
    // steering zone: the whole lower-left of the screen; a floating origin at the first touch
    const zone = $('#dhSteer'), wheel = $('#dhWheel');
    let x0 = null, pid = null;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      zone.setPointerCapture?.(e.pointerId);
      pid = e.pointerId;
      x0 = e.clientX;
      zone.classList.add('down');
    });
    zone.addEventListener('pointermove', (e) => {
      if (x0 === null || e.pointerId !== pid) return;
      const dx = e.clientX - x0;
      const v = Math.abs(dx) < 4 ? 0 : Math.sign(dx) * Math.min(1, (Math.abs(dx) - 4) / 78);
      pad.steer = -(Math.sign(v) * Math.abs(v) ** 1.15);
      wheel.style.transform = `rotate(${-pad.steer * 115}deg)`;
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, () => {
      x0 = null;
      pad.steer = 0;
      wheel.style.transform = '';
      zone.classList.remove('down');
    });
    // settings
    const seg = (id, fn) => $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) fn(b.dataset.v);
    });
    seg('#sAssist', (v) => this.set({ assist: v }));
    seg('#sUnits', (v) => this.set({ units: v }));
    seg('#sSeason', (v) => this.set({ season: v }));
    seg('#sScn', (v) => A.setScenario(v));
    seg('#sQual', (v) => A.setQuality(v, true));
    $('#sSens').addEventListener('input', (e) => this.set({ steerSens: parseFloat(e.target.value) }));
    $('#sShake').addEventListener('input', (e) => this.set({ camShake: parseFloat(e.target.value) }));
    $('#sVol').addEventListener('input', (e) => this.set({ volume: parseFloat(e.target.value) }));
    $('#sSound').addEventListener('change', (e) => this.set({ sound: e.target.checked }));
    $('#sHaptics').addEventListener('change', (e) => this.set({ haptics: e.target.checked }));
    $('#sTilt').addEventListener('change', async (e) => {
      if (e.target.checked && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        try {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== 'granted') {
            e.target.checked = false;
            return A.toast('Motion access was not granted, so tilt steering stays off.');
          }
        } catch {
          e.target.checked = false;
          return;
        }
      }
      this.set({ tilt: e.target.checked });
      if (e.target.checked) A.toast('Tilt steering on — hold the phone in landscape and turn it like a wheel.');
    });
    // events from the driver
    D.onKeyAction = (k) => {
      if (k === 'm') this.openMap();
      else if (k === 'e') this.modules.forEach((m) => m.onUse?.());
      else if (k === 'cruise') A.toast(D.cruise.on ? `Cruise set to ${this.fmtSpeed(D.cruise.v * 3.6)} — brake to cancel, + / − to adjust.` : 'Cruise off.');
      else if (k === 'limiter') A.toast(D.limiter ? 'Limiter on — the van will hold the posted limit.' : 'Limiter off.');
      else if (k === 'gear') A.toast(D.gearSel === 'R' ? 'Reverse — Go now backs up.' : 'Drive.');
      else if (k === 'park') A.toast(D.parkBrake ? 'Parking brake set.' : 'Parking brake released.');
      else if (k === 'enginebrake') A.toast(D.rig.engineBrake ? 'Engine brake on — it slows the rig on downhills when you lift off.' : 'Engine brake off.');
      else if (k === 'auto') A.toast(D.rig.auto ? 'Automatic shifting.' : 'Manual — X shifts up, Z shifts down.');
      this.syncSemi();
      $('#dhCam').textContent = `Camera · ${D.camLabel()}`;
      $('#dhLights').textContent = `Lights · ${D.lights}`;
    };
    D.onHorn = () => A.sound?.horn();
    D.onEvent = (kind) => this.onEvent(kind);
    window.addEventListener('gamepadconnected', () => A.drivingMode && A.toast('Gamepad connected — stick steers, triggers go and brake.'));
  }

  onEvent(kind) {
    const A = this.app;
    const msg = {
      tree: 'Bump — you hit a tree. Back up and steer around it.', boulder: 'Bump — boulder. Find another line.', building: 'Crunch — that is a building. Back up and go around.',
      deep: 'Too deep to ford: the van stops before the water reaches the sills (≈ 0.6 m).', slide: 'Sliding — not enough grip for that speed on this surface.',
      stuck: 'Wheelspin — this rear-wheel-drive van cannot climb that slope on this surface. Back down and take the track, or press T to get back on the road.',
      animal: 'Thump — you hit a wildlife. The van is dented but drivable; repairs cost cash. Slow down at dusk and watch the road edges.', crash: 'Crunch — you hit another vehicle. Keep your distance and use the horn.', reset: `Back on the road${this.D.road ? ` — ${this.D.road.edge.name}` : ''}.`, noRoad: 'No road within 1.4 km — try the map and drive toward a town.', cruiseLow: 'Cruise control needs a little speed first.', curve: 'Curve ahead — easing off the throttle.',
      jackknife: 'Jack-knife! Ease off and straighten the wheel — never brake hard while the trailer is folding.', tipping: 'Tipping! Slow down — a loaded trailer rolls in a fast turn.', recovered: 'Recovery crew has stood the rig back up on the road.', rollover: 'Rolled over. Press T to get the rig upright back on the road (it costs a recovery fee).',
    }[kind];
    if (msg) A.toast(msg);
    if (this.s.haptics && navigator.vibrate) {
      if (kind === 'building' || kind === 'tree' || kind === 'boulder') navigator.vibrate([70, 30, 40]);
      else if (kind === 'slide') navigator.vibrate(25);
    }
    if (kind === 'animal') this.services?.penalty(120, 'repairs');
    if (kind === 'crash') this.services?.penalty(60, 'a fender-bender');
    if (kind === 'recovered') {
      this.services?.penalty(900, 'the tow and recovery');
      this.D.rig.damage = Math.min(100, this.D.rig.damage + 15);
    }
    this.modules.forEach((m) => m.onDriveEvent?.(kind));
  }

  /** Change settings, apply and persist. */
  set(patch) {
    Object.assign(this.s, patch);
    this.apply();
    this.save();
  }

  apply(initial = false) {
    const s = this.s, D = this.D, A = this.app;
    D.setConfig({ assist: s.assist, steerSens: s.steerSens, tilt: s.tilt, tiltInvert: s.tiltInvert, camShake: s.camShake, units: s.units });
    this.world.land.setSeasonOverride(s.season === 'auto' ? null : s.season);
    A.soundVolume = s.volume;
    A.soundOn = s.sound;
    if (A.sound) {
      A.sound.volume = s.volume;
      A.sound.setOn(s.sound);
    }
    const mark = (id, v) => this.root.querySelectorAll(`${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
    mark('#sAssist', s.assist);
    mark('#sUnits', s.units);
    mark('#sSeason', s.season);
    mark('#sQual', A.quality);
    this.$('#sAssistNote').textContent = ASSIST_TEXT[s.assist];
    this.$('#sSens').value = s.steerSens;
    this.$('#sSensV').textContent = `${Math.round(s.steerSens * 100)} %`;
    this.$('#sShake').value = s.camShake;
    this.$('#sShakeV').textContent = `${Math.round(s.camShake * 100)} %`;
    this.$('#sVol').value = s.volume;
    this.$('#sVolV').textContent = `${Math.round(s.volume * 100)} %`;
    this.$('#sSound').checked = s.sound;
    this.$('#sHaptics').checked = s.haptics;
    this.$('#sTilt').checked = s.tilt;
    this.$('#dhAssist').textContent = ASSISTS[s.assist].label;
    this.applyVehicle();
    this.$('#dhUnit').textContent = s.units === 'mph' ? 'mph' : 'km/h';
    void initial;
  }

  /** Choose the van or a semi (with trailer and load) from the settings. */
  applyVehicle() {
    const s = this.s, D = this.D;
    const semi = s.vehicle === 'semi';
    const kg = cargoKg(s.trailer, s.cargoPct);
    const key = `${s.vehicle}|${semi ? s.trailer : ''}`;
    if (key !== this.vkey) {
      this.vkey = key;
      D.setVehicle(s.vehicle, { trailer: s.trailer, cargo: kg });
    } else if (semi && kg !== D.semi.cargo) {
      D.semi.cargo = kg;
      D.rig.setLoad(s.trailer, kg);
    }
    D.rig.auto = !s.manual;
    this.root.classList.toggle('semi', semi);
    this.root.classList.toggle('manual', semi && s.manual);
    this.root.querySelectorAll('#sVehicle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.vehicle)));
    this.root.querySelectorAll('#sTrailer button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.trailer)));
    this.$('#sCargo').value = s.cargoPct;
    this.$('#sCargo').disabled = s.trailer === 'none';
    this.$('#sCargoV').textContent = s.trailer === 'none' ? '—' : `${(kg / 1000).toFixed(1)} t`;
    this.$('#sManual').checked = s.manual;
    this.syncSemi();
  }

  syncSemi() {
    const D = this.D;
    this.$('#dhPark').setAttribute('aria-pressed', String(D.parkBrake));
    this.$('#dhEngBrk').setAttribute('aria-pressed', String(D.rig.engineBrake));
  }

  /** Phone layouts keep the road clear: every button lives in a drop-down menu. */
  menu(open = !this.root.classList.contains('menu')) {
    this.root.classList.toggle('menu', open);
    this.$('#dhMenu').setAttribute('aria-expanded', String(open));
    this.$('#dhMenu').textContent = open ? '×' : '☰';
  }

  sheet(sel) {
    for (const id of ['#dhSheet', '#dhHelp']) this.$(id).hidden = id !== sel;
    if (sel && this.passport) this.passport.sheet.hidden = true;
    if (sel === '#dhSheet') this.apply();
  }

  /** Esc closes whatever is open on top of the HUD before it parks the van. */
  escape() {
    if (!this.$('#dhSheet').hidden || !this.$('#dhHelp').hidden) {
      this.sheet(null);
      return true;
    }
    return this.modules.some((m) => m.escape?.());
  }

  openMap() {
    const m = this.mapScreen;
    if (m.open) m.closeMap();
    else m.openMap();
  }

  fmtSpeed(kmh) {
    return this.s.units === 'mph' ? `${mph(kmh)} mph` : `${Math.round(kmh)} km/h`;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  show() {
    this.root.hidden = false;
    this.menu(false);
    this.sheet(null);
    this.$('#dhCam').textContent = `Camera · ${this.D.camLabel()}`;
    this.$('#dhLights').textContent = `Lights · ${this.D.lights}`;
    this.apply();
    this.t = 0;
    this.hintT = 16;
    this.$('.dh-hint').classList.remove('gone');
    for (const m of this.modules) m.onShow?.();
    if (!this.s.seenHelp) {
      this.s.seenHelp = true;
      this.save();
      this.app.toast('Tip: ⚙ opens the driving settings (Easy mode keeps you in your lane). Press T any time to get back on the road.');
    }
  }

  hide() {
    this.root.hidden = true;
    for (const m of this.modules) m.onHide?.();
  }

  // ── Per-frame ──────────────────────────────────────────────────────────────
  tick(dt) {
    const A = this.app, D = this.D;
    const stowing = A.master > 0.002 || Object.keys(A.overrides).length > 0;
    D.ready = !stowing;
    const st = this.$('#dhStatus');
    st.hidden = !stowing;
    if (stowing) st.textContent = `Stowing for travel — awning, pod, doors, table and seats lock before the van can move (${Math.round(A.master * 100)} %)`;
    const kmh = Math.abs(D.v) * 3.6;
    this.$('#dhSpeed').textContent = String(this.s.units === 'mph' ? mph(kmh) : Math.round(kmh));
    const g = D.gear();
    const gEl = this.$('#dhGear');
    gEl.textContent = g;
    gEl.classList.toggle('rev', g === 'R');
    this.$('#dhGearBtn').firstElementChild.textContent = D.gearSel;
    this.$('#dhGearBtn').classList.toggle('rev', D.gearSel === 'R');
    const thr = Math.max(0, D.lastInput?.throttle || 0);
    const semi = D.vehicle === 'semi';
    const rpm = D.rpm(thr);
    this.$('#dhRpm').style.width = `${Math.min(100, (rpm / (semi ? 2200 : 4200)) * 100)}%`;
    this.$('#dhRpmT').textContent = `${Math.round(rpm / 10) * 10} rpm`;
    A.sound?.setTruck?.(semi);
    if (semi) {
      const bp = D.rig.brakeP;
      if (this.lastBrakeP > 0.35 && bp < 0.08) A.sound?.hiss(Math.min(1, this.lastBrakeP));
      this.lastBrakeP = bp;
    }
    A.sound?.update(rpm, thr, Math.abs(D.v), D.surface.kind === 'road' || D.surface.kind === 'street' ? 0 : 1, true, Math.max(D.slip * 0.8, D.lock, D.spinning * 0.5));
    // badges
    this.$('#dhCruise').setAttribute('aria-pressed', String(D.cruise.on));
    this.$('#dhCruise').textContent = D.cruise.on ? `Cruise ${this.s.units === 'mph' ? mph(D.cruise.v * 3.6) : Math.round(D.cruise.v * 3.6)}` : 'Cruise';
    this.$('#dhLimiter').setAttribute('aria-pressed', String(D.limiter));
    // posted limit sign
    const sign = this.$('#dhLimit');
    sign.hidden = D.limitKmh == null;
    if (D.limitKmh != null) {
      this.$('#dhLimitV').textContent = String(limitSignValue(D.limitKmh, this.s.units));
      sign.classList.toggle('over', kmh > D.limitKmh * 1.1 + 4);
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.25;
      const s = A.snap;
      const fuelL = semi ? D.rig.fuel : A.simState.fuelL;
      const fuelPct = semi ? D.rig.fuel / SPEC.fuelTank : (s && A.simState.fuelL / A.fuelCap) || 0;
      this.$('#dhFuel').style.width = `${Math.round(Math.min(1, fuelPct) * 100)}%`;
      this.$('#dhFuelT').textContent = `${fuelL.toFixed(0)} L`;
      if (semi) this.tickSemi();
      const fc = this.$('#dhFuelChip');
      fc.firstElementChild.textContent = String(Math.round(Math.min(1, fuelPct) * 100));
      fc.classList.toggle('low', fuelPct < 0.15);
      this.$('#dhCruiseM').setAttribute('aria-pressed', String(D.cruise.on));
      this.$('#dhLimiterM').setAttribute('aria-pressed', String(D.limiter));
      if (!this.$('#dhSheet').hidden) {
        const h = A.hour();
        this.$('#sHour').value = String(h);
        this.$('#sHourV').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
        this.root.querySelectorAll('#sScn button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === A.scnId)));
      }
      this.$('#dhBat').style.width = `${Math.round((s?.soc ?? 0) * 100)}%`;
      this.$('#dhBatT').textContent = `${Math.round((s?.soc ?? 0) * 100)} %${s?.altW > 0 ? ` · +${Math.round(s.altW)} W` : ''}`;
      this.$('#dhSurface').textContent = D.surface.label;
      this.$('#dhSlope').textContent = `${((D.slope * 180) / Math.PI).toFixed(1)}° slope`;
      this.$('#dhOdo').textContent = `${(D.trip / 1000).toFixed(2)} km`;
      this.$('#dhRoad').textContent = this.placeLabel();
      this.drawMap();
    }
    this.root.classList.toggle('orbit', D.camMode === 'orbit');
    if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.$('.dh-hint').classList.add('gone');
    for (const m of this.modules) m.tick?.(dt, this);
  }

  /** Truck gauges and warnings (4 Hz). */
  tickSemi() {
    const D = this.D, r = D.rig;
    const set = (id, f, t) => {
      this.$(`#${id}`).style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
      this.$(`#${id}T`).textContent = t;
    };
    set('dhAir', r.air / 125, `${Math.round(r.air)} psi`);
    set('dhJack', r.trailer === 'none' ? 0 : r.jack, r.trailer === 'none' ? 'bobtail' : `${Math.round(Math.abs((Math.atan2(Math.sin(r.theta - r.thetaT), Math.cos(r.theta - r.thetaT)) * 180) / Math.PI))}°`);
    set('dhBrk', (r.brakeTemp - 40) / 420, `${Math.round(r.brakeTemp)} °C`);
    set('dhDmg', r.damage / 100, `${Math.round(r.damage)} %`);
    let w = '';
    if (r.rolled) w = 'ROLLED OVER — press T';
    else if (r.jack > 0.8) w = 'JACK-KNIFE';
    else if (r.rollRisk > 0.75) w = 'TIPPING — SLOW DOWN';
    else if (r.air < 70) w = 'LOW AIR PRESSURE';
    else if (r.fade > 0.2) w = 'BRAKES FADING — USE ENGINE BRAKE';
    else if (r.fuel / SPEC.fuelTank < 0.12) w = 'LOW FUEL';
    else if (D.parkBrake) w = 'PARKING BRAKE';
    const el = this.$('#dhWarn');
    el.hidden = !w;
    el.textContent = w;
    this.syncSemi();
  }

  placeLabel() {
    const D = this.D, W = this.world.gen;
    const n = W.settlementAt(D.x, D.z, 0);
    const road = D.road && D.road.d < D.road.edge.P.width / 2 + 3 ? D.road.edge.name : null;
    if (n && n.kind !== 'junction') return road ? `${road} · ${n.name}` : `${n.name} · ${n.kind === 'city' ? 'city' : n.kind === 'town' ? 'town' : n.kind}`;
    return road || 'Off the road';
  }

  /** North-up minimap (1 km across). Modules may add a route/waypoint through `ui.mapExtras`. */
  drawMap() {
    const cv = this.$('#dhMap');
    const g = cv.getContext('2d');
    const D = this.D, W = this.world.gen;
    drawWorldMap(g, W, {
      w: cv.width, h: cv.height, cx: D.x, cz: D.z, mpp: 4, van: { x: D.x, z: D.z, yaw: D.yaw }, trail: D.trail, home: W.home,
      frozen: this.world.terrain.season.u.uIce.value > 0.5, accent: getComputedStyle(this.app.root).getPropertyValue('--accent') || '#ff8a3d', ...(this.mapExtras?.() || {}),
    });
  }
}
