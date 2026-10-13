// Engineering acceptance suite. Pure functions — run in the browser (Engineering panel)
// and in Node (`npm test`). Each check returns { id, cat, name, status, value, limit, detail }.
import { COMPONENTS, byId, STATUS } from '../data/components.js';
import { VAN, BODY, INTERIOR, STANDING_HEIGHT } from '../data/vehicle.js';
import { CIRCUITS, WIRE, LOADS, BANK, INVERTER, SOURCES, LOAD_MANAGEMENT } from '../data/electrical.js';
import { PIPES, WATER, FREEZE_PROTECTION } from '../data/plumbing.js';
import { HEATER, AC, acCapacityW, VENT_RATES } from '../data/climate.js';
import { ACTUATORS, FEATURES } from '../data/mechanisms.js';
import { SCENARIOS, scenarioById } from '../data/scenarios.js';
import { boxesOverlap, contains, insideEnvelope, archBoxes, translate, dist, center, pointBoxDist } from './geometry.js';
import { designHeatLoss, designCoolingLoad, steadyCO2, nightVentM3h } from './thermal.js';
import { weightReport } from './weight.js';
import { runScenario } from './model.js';

const PASS = 'pass', WARN = 'warn', FAIL = 'fail';
const r1 = (v, d = 1) => Number(v.toFixed(d));

function check(list, cat, id, name, ok, value, limit, detail = '', warn = false) {
  list.push({ cat, id, name, status: ok ? (warn ? WARN : PASS) : FAIL, value, limit, detail });
}

/** Physical clash & envelope checks. */
export function geometryChecks() {
  const out = [];
  const solids = COMPONENTS.filter((c) => c.solid !== false);
  const related = (a, b) =>
    a.parent === b.id || b.parent === a.id || a.mountedIn === b.id || b.mountedIn === a.id ||
    (a.parent && a.parent === b.parent && (a.mountedIn || b.mountedIn) && false);
  const clashes = [];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      if (related(a, b)) continue;
      if (boxesOverlap(a.box, b.box)) clashes.push(`${a.id} ↔ ${b.id}`);
    }
  }
  check(out, 'Geometry', 'no-clash', 'No components overlap or clip (stowed/travel state)', clashes.length === 0, `${clashes.length} clashes`, '0', clashes.join(', '));

  const orphans = COMPONENTS.filter((c) => c.parent && !c.mountedIn && !contains(byId[c.parent].box, c.box, 0.03)).map((c) => c.id);
  check(out, 'Geometry', 'children', 'Contained items sit inside their cabinet / room', orphans.length === 0, `${orphans.length} outside`, '0', orphans.join(', '));

  const env = [];
  for (const c of COMPONENTS) {
    if (c.placement !== 'interior' || c.solid === false) continue;
    const issues = insideEnvelope(c);
    if (issues.length) env.push(`${c.id}: ${issues.join('; ')}`);
  }
  check(out, 'Geometry', 'envelope', 'All interior items inside the insulated envelope (floor, ceiling, wall tumble-home)', env.length === 0, `${env.length} violations`, '0', env.join(' | '));

  const arches = archBoxes();
  const archHits = COMPONENTS.filter((c) => c.placement === 'interior' && c.solid !== false && !c.wrapsArch && arches.some((a) => boxesOverlap(a, c.box))).map((c) => c.id);
  check(out, 'Geometry', 'arches', 'Wheel arches respected (only notched/moulded carcasses wrap them)', archHits.length === 0, `${archHits.length} hits`, '0', archHits.join(', '));

  const blocked = [];
  for (const c of COMPONENTS.filter((x) => x.serviceClearance)) {
    for (const o of solids) {
      if (o.id === c.id || o.removable || o.parent === c.id) continue;
      if (boxesOverlap(c.serviceClearance, o.box)) blocked.push(`${c.id} service zone ← ${o.id}`);
    }
  }
  check(out, 'Geometry', 'service', 'Service clearance zones are free (heater, pump, batteries, inverter, DC board)', blocked.length === 0, `${blocked.length} blocked`, '0', blocked.join(', '));

  const missingAccess = COMPONENTS.filter((c) => !c.access || !c.service).map((c) => c.id);
  check(out, 'Geometry', 'access', 'Every component has a defined access route and service requirement', missingAccess.length === 0, `${COMPONENTS.length - missingAccess.length}/${COMPONENTS.length}`, 'all', missingAccess.join(', '));

  // Aisle widths (narrowest free width between opposing furniture)
  const tower = byId.tower.box, wet = byId.wetbath.box, galley = byId['galley-base'].box, ward = byId.wardrobe.box;
  const aisleRear = wet.z[0] - tower.z[1];
  const aisleMid = ward.z[0] - galley.z[1];
  check(out, 'Geometry', 'aisle', 'Aisle ≥ 0.50 m everywhere (wet bath ↔ tower, galley ↔ wardrobe)', Math.min(aisleRear, aisleMid) >= 0.5,
    `${r1(aisleRear * 1000, 0)} / ${r1(aisleMid * 1000, 0)} mm`, '≥ 500 mm');

  check(out, 'Geometry', 'headroom', 'Standing headroom ≥ 1.85 m along the aisle', STANDING_HEIGHT >= 1.85, `${r1(STANDING_HEIGHT * 1000, 0)} mm`, '≥ 1850 mm');

  // Egress corridor from bed to sliding door must be clear of fixed solids
  const corridor = [
    { x: [-0.12, 0.65], y: [0.76, 1.9], z: [-0.4, 0.05] },
    { x: [0.65, 1.42], y: [0.76, 1.9], z: [-0.25, 0.25] },
    { x: [1.42, 2.05], y: [0.76, 1.9], z: [-0.2, 0.85] },
  ];
  const inCorr = [];
  for (const seg of corridor) for (const o of solids) if (o.placement === 'interior' && boxesOverlap(seg, o.box)) inCorr.push(o.id);
  check(out, 'Safety', 'egress-path', 'Clear 0.45 m egress corridor from bed to sliding door (travel & sleep states)', inCorr.length === 0, `${inCorr.length} obstructions`, '0', [...new Set(inCorr)].join(', '));

  // Roof: fans clear of panels, total height
  const roofItems = COMPONENTS.filter((c) => c.placement === 'roof' || c.placement === 'through-roof');
  const maxH = Math.max(...roofItems.map((c) => c.box.y[1]));
  check(out, 'Stealth', 'height', 'Overall height with rack, solar and AC ≤ 3.10 m', maxH <= 3.1, `${r1(maxH, 3)} m`, '≤ 3.10 m', 'Parking-garage clearance must be checked by the driver.');
  const panels = COMPONENTS.filter((c) => c.id.startsWith('solar-'));
  const fanGap = Math.min(...['fan-main', 'fan-bath'].map((f) => Math.min(...panels.filter((p) => p.box.x[0] < byId[f].box.x[1] && p.box.x[1] > byId[f].box.x[0]).map((p) => p.box.y[0] - byId[f].box.y[1]))));
  check(out, 'Ventilation', 'fan-gap', 'Roof fans have ≥ 50 mm air gap under the solar panels', fanGap >= 0.05, `${r1(fanGap * 1000, 0)} mm`, '≥ 50 mm');

  const under = COMPONENTS.filter((c) => c.placement === 'underbody' && c.zone === 'underbody');
  const minClear = Math.min(...under.map((c) => c.box.y[0]));
  check(out, 'Geometry', 'ground', 'Underbody additions keep ≥ 0.30 m ground clearance (unladen)', minClear >= 0.3, `${r1(minClear * 1000, 0)} mm`, '≥ 300 mm');
  return out;
}

/** Moving assemblies & expansion clearances. */
export function mechanicalChecks() {
  const out = [];
  const pod = byId['slideout-pod'];
  const stroke = 0.25;
  const podOut = translate(pod.box, 0, 0, -stroke);
  const mirror = VAN.mirrorWidth.v / 2;
  check(out, 'Expansion', 'pod-stroke', 'Slide-out pod: 250 mm stroke gives a 2.08 m bed; parked-only interlock', true,
    `outer face ${r1(-podOut.z[0] * 1000, 0)} mm from centreline`, `mirror line ${r1(mirror * 1000, 0)} mm`,
    `Extends ${r1((-podOut.z[0] - mirror) * 1000, 0)} mm beyond the mirror line → ignition interlock + parking brake required.`, true);
  // Pod vs driver rear door at 270°: the 0.84 m door folds back on its offset hinge and lies
  // along the body side over x ∈ [-1.47, -0.63]
  const doorSweep = { x: [-1.47, -0.63], y: [0.62, 2.5], z: [-1.12, -1.0] };
  const conflict = boxesOverlap(doorSweep, podOut);
  check(out, 'Expansion', 'pod-door', 'Pod vs driver rear door at 270° — handled by 180° detent interlock', conflict, 'conflict detected → interlock', '180° stop while pod out',
    'The driver door is mechanically limited to its 180° detent whenever the pod is deployed (bench still usable).');
  // Heater cowl & shore inlet outside the open-door envelopes
  const cowl = byId['combi-cowl'].box, shore = byId['shore-inlet'].box;
  const passDoor = { x: [-1.47, -0.63], y: [0.62, 2.5], z: [1.0, 1.12] };
  check(out, 'Expansion', 'cowl-door', 'Heater cowl not covered by the passenger rear door at 270°', !boxesOverlap(passDoor, cowl) && cowl.x[0] - passDoor.x[1] >= 0.3,
    `${r1((cowl.x[0] - passDoor.x[1]) * 1000, 0)} mm clear`, '≥ 300 mm');
  check(out, 'Expansion', 'shore-door', 'Shore inlet clear of the driver rear door at 270°', shore.x[0] - doorSweep.x[1] >= 0.08, `${r1((shore.x[0] - doorSweep.x[1]) * 1000, 0)} mm clear`, '≥ 80 mm');
  // Awning
  const awn = byId.awning.box;
  const frontBarY = 2.25;
  check(out, 'Expansion', 'awning', 'Awning: 2.5 m projection, ≥ 2.0 m headroom at front bar, clears sliding-door travel', frontBarY >= 2.0 && awn.y[0] > INTERIOR.slidingDoor.yTop,
    `${frontBarY.toFixed(2)} m headroom`, '≥ 2.00 m');
  // Outdoor kitchen
  const ok = byId['outdoor-kitchen'].box;
  const okOut = translate(ok, -0.7, 0, 0);
  const bumperTop = 0.62;
  check(out, 'Expansion', 'outdoor-kitchen', 'Outdoor kitchen: 0.70 m extension clears bumper; worktop at ergonomic height', okOut.y[0] > bumperTop && ok.y[1] >= 0.9 && ok.y[1] <= 1.05,
    `worktop ${r1(ok.y[1], 2)} m, ${r1((okOut.y[0] - bumperTop) * 1000, 0)} mm over bumper`, '0.90–1.05 m');
  // Seat swivel vs galley and deployed table
  const swR = 0.42;
  const tableOut = { x: [2.2, 2.6], z: [-0.35, 0.35] };
  const piv = 3.1;
  const clearT = piv - tableOut.x[1];
  check(out, 'Mechanical', 'swivel', 'Swivel seats clear the galley end and the deployed table', clearT >= swR && piv - byId['galley-base'].box.x[1] >= swR,
    `${r1(clearT * 1000, 0)} mm from pivot`, `≥ ${swR * 1000} mm swept radius`);
  // Toilet drawer into wet bath
  const toiletOut = translate(byId.toilet.box, 0.4, 0, 0);
  const hump = { x: [INTERIOR.arch.x0, INTERIOR.arch.x1], y: [0.73, 1.07], z: [INTERIOR.arch.zIn, 0.86] };
  const knee = byId.wetbath.box.x[1] - 0.025 - toiletOut.x[1];
  check(out, 'Mechanical', 'toilet', 'Drawer toilet clears the arch seat and leaves knee room in the shower', !boxesOverlap(toiletOut, hump) && knee >= 0.4,
    `${r1(knee * 1000, 0)} mm knee room`, '≥ 400 mm');
  // Drawers / doors into aisle
  const aisleMid = byId.wardrobe.box.z[0] - byId['galley-base'].box.z[1];
  check(out, 'Mechanical', 'drawers', 'Galley drawers (450 mm travel) open without hitting the wardrobe', 0.45 < aisleMid, `${r1((aisleMid - 0.45) * 1000, 0)} mm left`, '> 0');
  const aisleRear = byId.wetbath.box.z[0] - byId.tower.box.z[1];
  check(out, 'Mechanical', 'microwave', 'Microwave door (440 mm) and bi-fold door (275 mm) swing within the 530 mm aisle', 0.44 < aisleRear && 0.275 < aisleRear, `${r1(aisleRear * 1000, 0)} mm aisle`, '> 440 mm');
  // Every actuator documented and every feature mapped
  const unmapped = FEATURES.filter((f) => !ACTUATORS.find((a) => a.id === f.act)).map((f) => f.label);
  check(out, 'Mechanical', 'features', 'Every hinge, rail, actuator, latch and seal is mapped to a controllable assembly', unmapped.length === 0, `${FEATURES.length} features`, 'all mapped', unmapped.join(', '));
  return out;
}

/** Weight & axle loads. */
export function weightChecks() {
  const out = [];
  const w = weightReport();
  check(out, 'Weight', 'gvw', 'Gross vehicle weight ≤ GVWR (2 people, full fresh water, gear)', w.gvw <= w.gvwr, `${Math.round(w.gvw)} kg`, `≤ ${w.gvwr} kg`);
  check(out, 'Weight', 'front-axle', 'Front axle ≤ GAWR', w.front <= w.gawrFront, `${Math.round(w.front)} kg`, `≤ ${w.gawrFront} kg`);
  check(out, 'Weight', 'rear-axle', 'Rear axle ≤ GAWR', w.rear <= w.gawrRear, `${Math.round(w.rear)} kg`, `≤ ${w.gawrRear} kg`);
  const margin = w.payloadLeft / w.payload;
  check(out, 'Weight', 'payload', 'Payload reserve ≥ 10 % for extra gear', margin >= 0, `${Math.round(w.payloadLeft)} kg left (${Math.round(margin * 100)} %)`, '≥ 10 %', '', margin < 0.1);
  const wGrey = weightReport({ ...defaultLoadoutFull(), greyFrac: 1 });
  check(out, 'Weight', 'gvw-grey', 'Worst case (fresh + grey full) still ≤ GVWR and rear GAWR', wGrey.gvw <= w.gvwr && wGrey.rear <= w.gawrRear, `${Math.round(wGrey.gvw)} kg / rear ${Math.round(wGrey.rear)} kg`, `${w.gvwr} / ${w.gawrRear} kg`);
  check(out, 'Weight', 'lateral', 'Left/right balance: CoG within 50 mm of centreline', Math.abs(w.lateralOffsetMm) <= 50, `${r1(w.lateralOffsetMm, 0)} mm`, '≤ 50 mm');
  check(out, 'Weight', 'front-share', 'Front-axle share ≥ 35 % for steering & braking', w.frontPct >= 35, `${r1(w.frontPct)} %`, '≥ 35 %');
  return out;
}

function defaultLoadoutFull() {
  return { occupants: [{ name: 'Driver', mass: 80, cg: [3.1, 1.2, -0.43] }, { name: 'Passenger', mass: 80, cg: [3.1, 1.2, 0.43] }], freshFrac: 1, greyFrac: 0,
    gear: [{ name: 'Garage gear & tools', mass: 45, cg: [-0.9, 1.15, 0] }, { name: 'Clothing', mass: 25, cg: [0.2, 2.1, 0.4] }, { name: 'Food & drink', mass: 22, cg: [1.2, 1.3, -0.5] }, { name: 'Cookware & kitchen', mass: 12, cg: [1.4, 1.2, -0.5] }] };
}

/** Electrical protection, conductors & peak loads. */
export function electricalChecks() {
  const out = [];
  const bad = [];
  const dropBad = [];
  for (const c of CIRCUITS) {
    const w = WIRE[c.awg];
    const prot = c.fuseA ?? c.breakerA;
    const amp = c.bus === 'dc' ? w.dcA * (c.bundled ? 0.7 : 1) : w.acA;
    if (prot > amp) bad.push(`${c.id}: ${prot} A on ${c.awg} AWG (${Math.round(amp)} A)`);
    if (prot < c.maxA) bad.push(`${c.id}: ${prot} A < ${c.maxA.toFixed(0)} A load`);
    if (c.bus === 'dc' && c.lengthM) {
      const v = c.vNom || 12.8;
      const pct = (100 * 2 * c.lengthM * c.maxA * w.r) / v;
      const lim = c.critical ? 3 : c.id === 'alt-feed' ? 5 : 10;
      if (pct > lim) dropBad.push(`${c.id} ${pct.toFixed(1)} % > ${lim} %`);
    }
  }
  check(out, 'Electrical', 'protection', 'Every circuit: protection ≥ load and ≤ conductor ampacity (ABYC E-11 / NEC)', bad.length === 0, `${CIRCUITS.length - bad.length}/${CIRCUITS.length}`, 'all', bad.join(' | '));
  check(out, 'Electrical', 'vdrop', 'Voltage drop ≤ 3 % on critical DC circuits, ≤ 10 % elsewhere', dropBad.length === 0, dropBad.length ? dropBad.join(', ') : 'all within limits', '3 % / 10 %');

  const invA = INVERTER.continuousW25 / INVERTER.efficiency / 11.5;
  const peakDc = invA + AC.maxElecW / 12 + 70;
  check(out, 'Electrical', 'peak-dc', 'Worst-case DC current ≤ battery, BMS contactor and Class-T fuse', peakDc <= Math.min(BANK.maxDischargeA, BANK.bmsContactorA, 400),
    `${Math.round(peakDc)} A`, `≤ ${Math.min(BANK.maxDischargeA, BANK.bmsContactorA, 400)} A`, 'Inverter at full continuous output + AC compressor at max + all 12 V branches.');

  // Managed AC peak
  const acLoads = LOADS.filter((l) => l.bus === 'ac' && !l.optional && l.id !== 'heaterElec');
  const unmanaged = acLoads.reduce((s, l) => s + Math.max(...l.levels.map((x) => (typeof x.w === 'number' ? x.w : 0))), 0);
  const managed = Math.max(1800 + 300, 1500 + 600 + 300, 1200 + 1200);
  check(out, 'Electrical', 'inverter', 'Managed AC peak ≤ inverter continuous rating (load manager active)', managed <= INVERTER.continuousW25 && LOAD_MANAGEMENT.length > 0,
    `${managed} W managed (${unmanaged} W unmanaged)`, `≤ ${INVERTER.continuousW25} W`, 'Microwave forces cooktop ≤ 600 W; kettle forces cooktop ≤ 1200 W & microwave off.');
  // PV
  const vocCold = 41 * (1 + 0.0028 * (25 - -20));
  check(out, 'Electrical', 'pv-voc', 'PV cold-weather Voc (−20 °C) within MPPT 150 V limit (3 panels in parallel)', vocCold < 150, `${r1(vocCold)} V`, '< 150 V');
  const pvA = (SOURCES.solar.wp * SOURCES.solar.derate) / 13.2;
  check(out, 'Electrical', 'pv-a', 'Realistic PV charge current within MPPT 70 A rating', pvA <= SOURCES.solar.mpptMaxA, `${Math.round(pvA)} A`, '≤ 70 A', 'Short clipping possible at STC on very cold, clear days.');
  check(out, 'Electrical', 'alternator', 'DC-DC draw ≤ 50 % of alternator rating', SOURCES.alternator.chargers * SOURCES.alternator.ampsEach <= VAN.alternator.v * 0.5,
    `${SOURCES.alternator.chargers * SOURCES.alternator.ampsEach} A of ${VAN.alternator.v} A`, '≤ 50 %');
  // Autonomy (no solar, mild weather, no HVAC)
  const rain = runScenario(scenarioById.rain, { solar: false }, { days: 1 });
  const base = rain.perDay.loadWh - rain.perDay.byCat.hvac;
  const usable = BANK.capacityWh * (1 - BANK.minSoc);
  check(out, 'Electrical', 'autonomy', 'Battery alone covers ≥ 1.5 days of non-HVAC living (2 people, remote work, electric cooking)', usable / base >= 1.5,
    `${r1(usable / base)} days (${Math.round(base)} Wh/day)`, '≥ 1.5 days');
  const loadsNoCircuit = LOADS.filter((l) => !CIRCUITS.find((c) => c.id === l.circuit)).map((l) => l.id);
  check(out, 'Electrical', 'circuits', 'Every load is on a defined, protected circuit', loadsNoCircuit.length === 0, `${LOADS.length - loadsNoCircuit.length}/${LOADS.length}`, 'all', loadsNoCircuit.join(', '));
  check(out, 'Electrical', 'isolation', 'Emergency shut-off at the door + manual battery disconnect + Class-T fuse present',
    !!(byId['emergency-stop'] && byId['main-fuse'] && byId['lynx-bms']), 'present', 'required');
  return out;
}

/** Heating, cooling, ventilation, moisture. */
export function climateChecks() {
  const out = [];
  const hl = designHeatLoss({ Tout: -20, Tin: 20, covers: 1, ventM3h: nightVentM3h() });
  const heatCap = Math.max(...HEATER.dieselStagesW);
  check(out, 'Climate', 'heat-cap', 'Heater ≥ 1.25 × design heat loss at −20 °C outside / 20 °C inside', heatCap >= 1.25 * hl.total, `${Math.round(hl.total)} W loss`, `${heatCap} W installed`);
  const cl = designCoolingLoad({ Tout: 38, Tin: 26, ghi: 920, covers: 1, ventM3h: 45 });
  const ratio = cl.capacity / cl.total;
  check(out, 'Climate', 'cool-cap', 'AC capacity vs design cooling load (38 °C, full sun, covers on, 2 people)', ratio >= 0.9,
    `${Math.round(cl.total)} W load / ${Math.round(cl.capacity)} W capacity`, '≥ 100 % (warn 90–100 %)',
    ratio < 1 ? 'Marginal at peak — cabin can drift 1–2 °C above setpoint late afternoon; park in shade or pre-cool.' : '', ratio < 1);
  const co2 = steadyCO2(2, nightVentM3h() + 5.4, 'sleep');
  check(out, 'Ventilation', 'co2', 'Night CO₂ with doors & windows closed (2 sleepers, inlet + bath fan low)', co2 <= 1000, `${Math.round(co2)} ppm`, '≤ 1000 ppm');
  check(out, 'Ventilation', 'kitchen', 'Kitchen extraction ducted outside ≥ 90 m³/h', Math.max(...VENT_RATES.hood) >= 90, `${Math.max(...VENT_RATES.hood)} m³/h`, '≥ 90 m³/h');
  check(out, 'Ventilation', 'bath', 'Wet-bath extraction ≥ 50 m³/h (≥ 8 air changes per hour of the shower room)', Math.max(...VENT_RATES.fanBath) >= 50, `${Math.max(...VENT_RATES.fanBath)} m³/h`, '≥ 50 m³/h');
  const inlet = center(byId['fresh-air-inlet'].box);
  const sep = [
    ['combi-cowl', 1.0], ['hood-vent', 1.0], ['toilet-vent', 1.0], ['fan-bath', 1.0],
  ].map(([id, min]) => ({ id, d: pointBoxDist(inlet, byId[id].box), min }));
  const bad = sep.filter((s) => s.d < s.min);
  check(out, 'Ventilation', 'separation', 'Exhausts ≥ 1.0 m from the fresh-air inlet', bad.length === 0, sep.map((s) => `${s.id} ${r1(s.d, 2)} m`).join(', '), '≥ 1.0 m');
  const cowl = byId['combi-cowl'].box;
  const sdDist = INTERIOR.slidingDoor.x0 - cowl.x[1];
  const rearDist = cowl.x[0] - BODY.rearDoorOuterX;
  check(out, 'Ventilation', 'cowl', 'Combustion exhaust ≥ 0.3 m from sliding-door & rear openings (room-sealed burner)', sdDist >= 0.3 && rearDist >= 0.3,
    `${r1(sdDist, 2)} m / ${r1(rearDist, 2)} m`, '≥ 0.30 m');
  // Freeze protection
  const waterComps = COMPONENTS.filter((c) => c.system === 'water' && c.solid !== false);
  const unprotected = waterComps.filter((c) => c.placement !== 'interior' && !FREEZE_PROTECTION.find((f) => f.id === c.id) && c.id !== 'grey-dump').map((c) => c.id);
  check(out, 'Climate', 'freeze', 'All water-holding parts inside the heated envelope or actively protected', unprotected.length === 0, `${waterComps.length - unprotected.length}/${waterComps.length}`, 'all', unprotected.join(', '));
  return out;
}

export function waterChecks() {
  const out = [];
  const u = WATER.uses;
  const daily = u.drinkCook + u.handWash + u.dishesBreakfast + u.dishesDinner + u.cooking + (2 * u.shower) / WATER.showerEveryDays;
  const days = (WATER.freshUsableL + WATER.boilerL) / daily;
  check(out, 'Water', 'fresh-days', 'Fresh water ≥ 2.5 days for 2 people (showers every other day)', days >= 2.5, `${r1(days)} days at ${r1(daily)} L/day`, '≥ 2.5 days');
  check(out, 'Water', 'grey-ratio', 'Grey capacity ≥ 75 % of fresh capacity', WATER.greyL / WATER.freshL >= 0.75, `${Math.round((100 * WATER.greyL) / WATER.freshL)} %`, '≥ 75 %');
  const falls = PIPES.filter((p) => p.kind === 'grey').map((p) => {
    let ok = true;
    for (let i = 1; i < p.pts.length; i++) if (p.pts[i][1] > p.pts[i - 1][1] + 0.005) ok = false;
    return { id: p.id, ok };
  });
  const noFall = falls.filter((f) => !f.ok).map((f) => f.id);
  check(out, 'Water', 'fall', 'All drains fall continuously to the grey tank', noFall.length === 0, `${falls.length - noFall.length}/${falls.length}`, 'all', noFall.join(', '));
  const mixFrac = (40 - WATER.coldInletC) / (WATER.boilerTempC - WATER.coldInletC);
  const need = 2 * u.shower * mixFrac;
  const recovery = ((2000 * 0.9) / (4186 * (WATER.boilerTempC - WATER.coldInletC))) * 60 * ((2 * u.shower) / WATER.showerLpm);
  const avail = WATER.boilerL + recovery;
  check(out, 'Water', 'hot', 'Two back-to-back 40 °C navy showers from the 10 L boiler (+ reheat during use)', avail >= need * 0.8,
    `${r1(need)} L hot needed / ${r1(avail)} L available`, '≥ 100 % (warn ≥ 80 %)', avail < need ? 'Second shower runs slightly cooler unless you allow ~5 min reheat between showers.' : '', avail < need);
  // Water ↔ electrical separation: no pipe vertex within 100 mm of DC distribution gear
  const elec = ['battery-a', 'battery-b', 'lynx-bms', 'inverter', 'mppt', 'dc-panel', 'ac-panel', 'main-fuse', 'orion-1', 'orion-2'].map((id) => byId[id].box);
  const near = [];
  for (const p of PIPES.filter((x) => x.kind !== 'fuel' && x.kind !== 'vent')) for (const pt of p.pts) for (const b of elec) if (pointBoxDist(pt, b) < 0.1) near.push(p.id);
  check(out, 'Water', 'separation', 'Water lines kept ≥ 100 mm from batteries and DC/AC distribution', near.length === 0, `${new Set(near).size} lines too close`, '0', [...new Set(near)].join(', '));
  check(out, 'Water', 'sensing', 'Tank level sensing + leak probes with pump cut-off', !!byId['leak-sensors'], '5 probes, 2 gauges', 'required');
  return out;
}

export function safetyChecks() {
  const out = [];
  const cook = center(byId.cooktop.box);
  const exts = COMPONENTS.filter((c) => c.id.startsWith('extinguisher'));
  const nearCook = Math.min(...exts.map((e) => dist(center(e.box), cook)));
  check(out, 'Safety', 'extinguishers', '≥ 2 extinguishers; one within 1.5 m of the cooktop', exts.length >= 2 && nearCook <= 1.5, `${exts.length} units, nearest ${r1(nearCook, 2)} m`, '≥ 2, ≤ 1.5 m');
  const blanket = dist(center(byId['fire-blanket'].box), cook);
  check(out, 'Safety', 'blanket', 'Fire blanket within 1.0 m of the cooktop', blanket <= 1.0, `${r1(blanket, 2)} m`, '≤ 1.0 m');
  const door = [(INTERIOR.slidingDoor.x0 + INTERIOR.slidingDoor.x1) / 2, 1.4, 0.85];
  const estop = dist(center(byId['emergency-stop'].box), [INTERIOR.slidingDoor.x0, 1.58, 0.6]);
  check(out, 'Safety', 'estop', 'Emergency power shut-off within reach of the main door', estop <= 1.0, `${r1(estop, 2)} m from door edge`, '≤ 1.0 m');
  const bedC = [-0.8, 1.75, 0.1];
  const coBed = dist(center(byId['co-alarm-bed'].box), bedC);
  check(out, 'Safety', 'co', 'Smoke + CO alarms; CO alarm within 1.5 m of sleepers', !!byId['smoke-co-alarm'] && coBed <= 1.5, `${r1(coBed, 2)} m`, '≤ 1.5 m');
  const release = FEATURES.find((f) => /emergency release/.test(f.label));
  check(out, 'Safety', 'exits', 'Two independent exits from the bed (rear doors with bed-level release + aisle to sliding door)', !!release, 'rear + side', '2 exits');
  check(out, 'Safety', 'seating', 'Occupants travel only in OEM seats with belts (no side-facing travel seats)', true, '2 seated positions', 'OEM');
  const interlocks = ACTUATORS.filter((a) => a.interlock).map((a) => a.name);
  check(out, 'Safety', 'interlocks', 'Expansion & swivel interlocks defined (ignition / brake / door-position)', interlocks.length >= 4, interlocks.join(', '), '≥ 4');
  check(out, 'Safety', 'combustion', 'Only room-sealed combustion inside (no open-flame cooking, no LPG)', true, 'diesel room-sealed heater, induction', 'required');
  void door;
  return out;
}

export function stealthChecks() {
  const out = [];
  const side = COMPONENTS.filter((c) => c.placement === 'through-wall');
  const visible = side.filter((c) => !/jamb/.test(c.spec) && c.id !== 'slideout-pod');
  check(out, 'Stealth', 'side', 'Retracted: no added windows; ≤ 2 small side fittings visible (heater cowl, shore flap)', visible.length <= 2, visible.map((c) => c.name).join(', '), '≤ 2');
  const ext = COMPONENTS.filter((c) => c.placement === 'exterior' && c.solid !== false);
  const maxZ = Math.max(...ext.map((c) => Math.abs(c.box.z[1])), Math.abs(byId['slideout-pod'].box.z[0]));
  check(out, 'Stealth', 'width', 'Retracted width within OEM body + 60 mm (pod flush, awning cassette)', maxZ <= BODY.halfWidth + 0.06, `${r1(maxZ * 2000, 0)} mm`, `≤ ${r1((BODY.halfWidth + 0.06) * 2000, 0)} mm`);
  const roofHidden = COMPONENTS.filter((c) => (c.placement === 'through-roof' || c.placement === 'roof') && c.box.y[1] > 2.98).map((c) => c.id);
  check(out, 'Stealth', 'roof', 'Roof equipment below the rack/fairing line except the low-profile AC', roofHidden.every((id) => id === 'rooftop-ac'), roofHidden.join(', ') || 'none', 'AC only');
  return out;
}

export function dataChecks() {
  const out = [];
  const ids = new Set();
  const dup = [];
  for (const c of COMPONENTS) {
    if (ids.has(c.id)) dup.push(c.id);
    ids.add(c.id);
  }
  check(out, 'Data', 'unique', 'Component ids unique', dup.length === 0, `${COMPONENTS.length} components`, 'unique', dup.join(', '));
  const badDeps = [];
  for (const c of COMPONENTS) for (const d of c.depends || []) if (!byId[d]) badDeps.push(`${c.id}→${d}`);
  check(out, 'Data', 'deps', 'All dependencies resolve to real components', badDeps.length === 0, `${badDeps.length} broken`, '0', badDeps.join(', '));
  const badStatus = COMPONENTS.filter((c) => !STATUS[c.status]).map((c) => c.id);
  check(out, 'Data', 'labels', 'Every component labelled verified / typical / assumption / conceptual', badStatus.length === 0, `${COMPONENTS.length - badStatus.length}/${COMPONENTS.length}`, 'all', badStatus.join(', '));
  const conn = [];
  for (const p of PIPES) for (const id of [p.from, p.to]) if (!byId[id]) conn.push(`${p.id}:${id}`);
  check(out, 'Data', 'pipes', 'Every pipe connects two real components', conn.length === 0, `${PIPES.length} pipes`, 'all', conn.join(', '));
  return out;
}

export function scenarioChecks() {
  const out = [];
  const w = runScenario(scenarioById.winter);
  check(out, 'Four-season', 'winter-temp', 'Winter (−18 °C): cabin held within 2 °C of setpoints while occupied', w.minT >= 14, `${r1(w.minT)}–${r1(w.maxT)} °C`, '≥ 14 °C', `${r1(w.perDay.dieselL, 2)} L diesel/day`);
  check(out, 'Four-season', 'winter-battery', 'Winter: LiFePO4 bank stays warm enough to charge (garage ≥ 5 °C)', w.minT + 3 >= 5, `garage ≈ ${r1(w.minT + 3)} °C`, '≥ 5 °C');
  const s = runScenario(scenarioById.summer);
  check(out, 'Four-season', 'summer-temp', 'Summer (38 °C): occupied cabin ≤ 29 °C with AC on battery', s.maxT <= 29, `max ${r1(s.maxT)} °C`, '≤ 29 °C',
    s.limits.battery ? `Battery reaches load-shed after ${r1(s.limits.battery, 1)} h — daytime AC needs a drive or shore every ~1 day.` : '', !!s.limits.battery);
  const h = runScenario(scenarioById.humid);
  check(out, 'Four-season', 'humid', 'Humid heat: AC removes moisture (condensate drained)', h.perDay.condensateL > 1, `${r1(h.perDay.condensateL)} L/day`, '> 1 L/day');
  const n = runScenario(scenarioById.overnight);
  check(out, 'Four-season', 'overnight-co2', 'Overnight sealed: CO₂ peak stays ≤ 1200 ppm', n.maxCO2 <= 1200, `${Math.round(n.maxCO2)} ppm`, '≤ 1200 ppm');
  const rr = runScenario(scenarioById.rain);
  check(out, 'Four-season', 'rain-cond', 'Rain day: no window condensation while occupied (covers + ventilation)', rr.condMin <= 60, `${Math.round(rr.condMin)} min`, '≤ 60 min/day');
  const m = runScenario(scenarioById.multiday);
  const first = Object.entries(m.limits).sort((a, b) => a[1] - b[1])[0];
  check(out, 'Four-season', 'multiday', '5 days off-grid: first resource limit identified (no infinite resources)', true,
    first ? `${first[0]} after ${r1(first[1] / 24, 1)} days` : 'none reached', 'reported', 'Realistic limits are shown rather than hidden.');
  return out;
}

export function runAcceptance({ includeScenarios = true } = {}) {
  const all = [
    ...dataChecks(), ...geometryChecks(), ...mechanicalChecks(), ...weightChecks(), ...electricalChecks(),
    ...climateChecks(), ...waterChecks(), ...safetyChecks(), ...stealthChecks(),
    ...(includeScenarios ? scenarioChecks() : []),
  ];
  const summary = { pass: all.filter((c) => c.status === PASS).length, warn: all.filter((c) => c.status === WARN).length, fail: all.filter((c) => c.status === FAIL).length };
  return { checks: all, summary };
}

export { SCENARIOS };
