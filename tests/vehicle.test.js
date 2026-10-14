import test from 'node:test';
import assert from 'node:assert/strict';
import { AY_TIP, KUS, VAN_DYN, brush, kickRoll, makeVanDyn, steadySteer, steadyYaw, steerLock, stepRolled, stepVanDyn } from '../src/sim/vehicle.js';
import { SURFACES, WET_GRIP } from '../src/scene/land.js';
import { ASSISTS } from '../src/scene/drive.js';

const G = 9.81;
const ROAD = { dry: { mu: SURFACES.asphalt.mu, crr: 0.012, key: 'asphalt' }, wet: { mu: SURFACES.asphalt.mu * WET_GRIP, crr: 0.012, key: 'asphalt' }, gravel: { mu: SURFACES.gravel.mu, crr: 0.03, key: 'gravel' }, grass: { mu: SURFACES.grass.mu, crr: 0.045, key: 'grass' }, snow: { mu: SURFACES.snow.mu, crr: 0.04, key: 'snow' }, ice: { mu: SURFACES.ice.mu, crr: 0.012, key: 'ice' } };
const aid = (name) => {
  const a = ASSISTS[name];
  return { tc: a.tc, stab: a.stab, rsc: a.rsc, abs: a.abs, cap: a.cap };
};
const H = 0.01;
const hold = (d, k = 1) => (t) => (t < d ? k : 0);
const seq = (segs) => (t) => {
  let acc = 0;
  for (const [d, k] of segs) {
    acc += d;
    if (t < acc) return k;
  }
  return 0;
};

/** Keyboard-style run: the stick (−1..1, + = left) ramps and the wheels move at a limited rate, like the Driver. */
function drive({ v0 = 25, surface = 'dry', assist = 'standard', keys = () => 0, T = 5, brake = () => 0, hand = () => false, cruise = true }) {
  const S = makeVanDyn();
  S.u = v0;
  const env = { ...ROAD[surface], grade: 0, sideG: 0, ...aid(assist) };
  const cap = ASSISTS[assist].cap;
  const out = { S, flippedAt: null, maxAy: 0, maxZ: 0, maxLock: 0, maxR: 0, maxTip: 0, x: 0, t: 0, dist: 0 };
  let steerIn = 0, delta = 0, yaw = 0;
  for (let t = 0; t < T; t += H) {
    const k = keys(t);
    const rate = k * steerIn < 0 || Math.abs(k) < Math.abs(steerIn) ? 5.5 : 2.4;
    steerIn += Math.max(-rate * H, Math.min(rate * H, k - steerIn));
    delta += Math.max(-1.7 * H, Math.min(1.7 * H, steerIn * steerLock(S.u, cap) - delta));
    const resist = env.crr * VAN_DYN.m * G + 0.5 * 1.2 * VAN_DYN.cda * S.u * S.u;
    const b = brake(t);
    const drive = cruise && b === 0 ? Math.max(0, resist + 800 * (v0 - S.u)) : 0;
    stepVanDyn(S, { drive, brake: b, hand: hand(t), delta }, env, H);
    yaw += S.r * H;
    out.dist += S.u * H;
    out.t = t + H;
    out.maxAy = Math.max(out.maxAy, Math.abs(S.ay));
    out.maxZ = Math.max(out.maxZ, S.zf, S.zr);
    out.maxLock = Math.max(out.maxLock, S.lock);
    out.maxR = Math.max(out.maxR, Math.abs(S.r));
    out.maxTip = Math.max(out.maxTip, S.tip);
    if (S.rolled && out.flippedAt === null) {
      out.flippedAt = out.t;
      break;
    }
    if (b > 0 && Math.abs(S.u) < 0.05) break;
  }
  out.yaw = yaw;
  return out;
}

test('tyre: force rises with slip, peaks at the grip limit and eases off sliding; sign is the caller’s', () => {
  const Fz = 20000, mu = 1, C = 14 * Fz, fmax = mu * Fz;
  assert.equal(brush(0, fmax, C).f, 0);
  const small = brush(0.01, fmax, C);
  assert.ok(Math.abs(small.f - C * 0.01) / (C * 0.01) < 0.15, 'linear at small slip');
  let prev = 0, peak = 0;
  for (let s = 0.002; s < 0.8; s += 0.002) {
    const f = brush(s, fmax, C).f;
    peak = Math.max(peak, f);
    if (s < 0.05) assert.ok(f >= prev - 1e-6, 'still rising');
    prev = f;
  }
  assert.ok(peak <= fmax * 1.001 && peak > fmax * 0.97, `peak ${peak / fmax}`);
  const sliding = brush(0.8, fmax, C, 0.9);
  assert.ok(sliding.z > 1 && sliding.f < peak && sliding.f > 0.85 * fmax);
  assert.ok(brush(0.8, fmax, C, 0.9, 0.5).f > sliding.f * 1.3, 'soil piling up against a sliding tyre adds force');
  assert.equal(brush(0.1, 0, C).f, 0, 'no grip, no force');
});

test('grip: tarmac gives a loaded van a bit over 1 g, loose ground less, snow and ice very little', () => {
  assert.ok(SURFACES.asphalt.mu >= 1 && SURFACES.county.mu >= 0.95 && SURFACES.street.mu >= 0.95);
  assert.ok(SURFACES.asphalt.mu * WET_GRIP > 0.75 && SURFACES.asphalt.mu * WET_GRIP < 0.9, 'wet tarmac ≈ 0.8');
  for (const k of ['gravel', 'dirt', 'grass', 'forest', 'sand']) assert.ok(SURFACES[k].mu >= 0.6 && SURFACES[k].mu <= 0.75, `${k} ${SURFACES[k].mu}`);
  assert.ok(SURFACES.rock.mu > SURFACES.gravel.mu);
  assert.ok(SURFACES.snow.mu <= 0.4 && SURFACES.packed.mu <= 0.4 && SURFACES.ice.mu <= 0.15);
});

test('steering lock: full lock when parking, then it follows speed so that full stick asks for a set share of the tipping acceleration', () => {
  assert.equal(steerLock(2, 1.4), 0.5);
  assert.ok(steerLock(6, 1.4) > 0.3);
  let prev = 1;
  for (let v = 2; v <= 38; v += 1) {
    const d = steerLock(v, 1.4);
    assert.ok(d <= prev + 1e-3, 'does not grow with speed (it levels off where the cap opens)');
    prev = d;
  }
  const ay = (v, cap) => (v * v * steerLock(v, cap)) / (VAN_DYN.L + KUS * v * v);
  assert.ok(ay(14, 1.4) < 0.9 * AY_TIP, 'in town and on the back roads full stick stays well below tipping');
  assert.ok(ay(30, 0.85) < 0.9 * AY_TIP, 'Easy never asks for the tipping acceleration');
  assert.ok(ay(30, 1.4) > AY_TIP && ay(30, 2.2) > 1.7 * AY_TIP, 'Standard and Pro can');
  assert.ok(steerLock(30, 2.2) > steerLock(30, 0.85));
  // and the lane assist can invert it
  const r = 0.12, d = steadySteer(25, r);
  assert.ok(Math.abs(steadyYaw(25, d) - r) < 1e-9);
});

test('braking: ABS stops from 100 km/h in about 40 m on dry tarmac; wet, gravel and ice take longer', () => {
  const stop = (surface, assist = 'standard') => drive({ v0: 27.8, surface, assist, brake: () => 1, T: 40 });
  const dry = stop('dry');
  assert.ok(dry.dist > 33 && dry.dist < 48, `dry ${dry.dist.toFixed(1)} m`);
  assert.ok(dry.maxZ < 1.2 && Math.abs(dry.yaw) < 0.02, 'straight');
  const wet = stop('wet'), gravel = stop('gravel'), ice = stop('ice');
  assert.ok(wet.dist > dry.dist * 1.15 && wet.dist < dry.dist * 1.6, `wet ${wet.dist.toFixed(1)}`);
  assert.ok(gravel.dist > wet.dist * 0.95, `gravel ${gravel.dist.toFixed(1)}`);
  assert.ok(ice.dist > dry.dist * 5, `ice ${ice.dist.toFixed(0)}`);
  // without ABS the wheels lock (Pro): it still stops in a similar distance but the tyres are screaming
  const pro = stop('dry', 'pro');
  assert.ok(pro.maxLock > 0.5, `lock ${pro.maxLock}`);
  assert.ok(pro.dist >= dry.dist * 0.95 && pro.dist < dry.dist * 1.3, `pro ${pro.dist.toFixed(1)}`);
  assert.ok(stop('dry', 'easy').maxLock < 0.5, 'ABS does not lock the wheels');
});

test('cornering: a steady turn follows the textbook response and holds 0.7 g on dry tarmac without sliding', () => {
  // slow: the steady yaw rate follows the steering angle
  const slow = drive({ v0: 15, keys: hold(6, 0.5), T: 6 });
  const S = slow.S;
  const want = steadyYaw(S.u, steerLock(S.u, 1.4) * 0.5);
  assert.ok(Math.abs(S.r - want) / want < 0.12, `r ${S.r.toFixed(3)} vs ${want.toFixed(3)}`);
  assert.ok(slow.maxZ < 0.5, 'far from the limit');
  // hard: full stick at 20 m/s gives most of the grip
  const hard = drive({ v0: 20, keys: hold(4), T: 4, assist: 'standard' });
  assert.ok(hard.maxAy > 0.55 * G && hard.maxAy < 1.1 * G, `ay ${(hard.maxAy / G).toFixed(2)} g`);
  assert.equal(hard.flippedAt, null);
  assert.ok(hard.maxZ < 1.5, 'the tyres are working but not far into the slide');
});

test('limit handling: the van understeers first (the front gives up before the rear), it does not snap into a spin', () => {
  // a corner too fast for the grip on a wet road: lots of steering at speed
  const run = drive({ v0: 27, surface: 'wet', assist: 'pro', keys: hold(4), T: 4 });
  assert.ok(run.maxZ > 1, 'the tyres were pushed past their peak');
  assert.ok(run.maxR < 0.9, `yaw rate stays moderate (${run.maxR.toFixed(2)} rad/s)`);
  const S = run.S;
  assert.ok(S.zf >= S.zr - 0.05, `front ${S.zf.toFixed(2)} ≥ rear ${S.zr.toFixed(2)}`);
  assert.equal(run.flippedAt, null, 'a wet road slides, it does not trip the van');
});

test('straight line: a disturbance dies out at motorway speed and the van tracks straight', () => {
  const S = makeVanDyn();
  S.u = 35;
  S.r = 0.15;
  S.vy = 1;
  const env = { ...ROAD.dry, grade: 0, sideG: 0, ...aid('standard') };
  for (let t = 0; t < 4; t += H) stepVanDyn(S, { drive: env.crr * VAN_DYN.m * G + 0.5 * 1.2 * VAN_DYN.cda * S.u * S.u, brake: 0, hand: false, delta: 0 }, env, H);
  assert.ok(Math.abs(S.r) < 0.01 && Math.abs(S.vy) < 0.15, `r ${S.r}, vy ${S.vy}`);
  assert.ok(S.u > 33, 'and it kept its speed');
});

test('normal driving never tips the van: lane changes, slalom and curves at any speed with any aid', () => {
  const lane = seq([[0.35, 1], [0.15, 0], [0.35, -1], [0.2, 0]]);
  const slalom = seq([[0.6, 1], [0.6, -1], [0.6, 1], [0.6, -1]]);
  const curve = hold(5, 0.3);
  for (const assist of ['easy', 'standard', 'pro']) {
    for (const v0 of [8, 15, 22, 30, 36]) {
      for (const [name, keys] of [['lane change', lane], ['slalom', slalom], ['curve', curve]]) {
        const r = drive({ v0, assist, keys, T: 6 });
        assert.equal(r.flippedAt, null, `${assist} ${name} at ${v0} m/s rolled`);
        assert.ok(r.maxTip === 0 || r.maxTip < 0.05, `${assist} ${name} at ${v0} m/s lifted a wheel (${(r.maxTip * 57.3).toFixed(0)}°)`);
      }
    }
  }
});

test('stupid steering at speed rolls the van: a held hard turn at 100 km/h+ on dry tarmac (Standard and Pro), never Easy', () => {
  const hard = (assist, v0, d = 2) => drive({ v0, assist, keys: hold(d), T: 6 });
  for (const v0 of [27, 30, 35]) {
    assert.ok(hard('standard', v0).flippedAt !== null, `Standard at ${v0} m/s holds the stick and rolls`);
    assert.ok(hard('pro', v0).flippedAt !== null, `Pro at ${v0} m/s rolls`);
  }
  for (const v0 of [20, 27, 30, 35]) assert.equal(hard('easy', v0, 4).flippedAt, null, `Easy at ${v0} m/s stays upright`);
  // a quick stab at the wheel is forgiven; a long one is not
  assert.equal(drive({ v0: 30, assist: 'standard', keys: hold(0.4), T: 6 }).flippedAt, null);
  // lots of back and forth with the wrong rhythm: a half period of about a second builds up the roll
  const zig = drive({ v0: 32, assist: 'pro', keys: seq([[1.2, 1], [1.2, -1], [1.2, 1], [1.2, -1]]), T: 7 });
  assert.ok(zig.flippedAt !== null, 'the zig-zag rolled it');
  // a rolled van ploughs to a stop
  const S = zig.S;
  for (let i = 0; i < 600; i++) stepRolled(S, H, 0.5);
  assert.ok(Math.hypot(S.u, S.vy) < 0.05 && Math.abs(S.r) < 0.01);
});

test('slow speeds are safe: even a held full lock at 40 km/h cannot tip it', () => {
  for (const assist of ['easy', 'standard', 'pro']) for (const v0 of [4, 8, 11]) {
    const r = drive({ v0, assist, keys: hold(5), T: 6 });
    assert.equal(r.flippedAt, null, `${assist} at ${v0} m/s`);
    assert.ok(r.maxTip < 0.02, `${assist} at ${v0} m/s lifted a wheel`);
  }
});

test('slippery surfaces slide instead of rolling: wet tarmac, snow and ice take the grip away before the wheels lift', () => {
  for (const surface of ['wet', 'snow', 'ice']) for (const assist of ['standard', 'pro']) {
    const r = drive({ v0: 25, surface, assist, keys: hold(3), T: 5 });
    assert.equal(r.flippedAt, null, `${surface} ${assist}`);
    assert.ok(r.maxZ > 1, `${surface} ${assist} slid`);
  }
});

test('a slide that digs in: sliding sideways at speed rolls the van on tarmac and soft ground, not on ice, snow or wet roads', () => {
  const slide = (surface, u, vy) => {
    const S = makeVanDyn();
    S.u = u;
    S.vy = vy;
    const env = { ...ROAD[surface], grade: 0, sideG: 0, ...aid('standard') };
    let flipped = false, tip = 0;
    for (let t = 0; t < 5 && !flipped; t += H) {
      stepVanDyn(S, { drive: 0, brake: 0, hand: false, delta: 0 }, env, H);
      tip = Math.max(tip, S.tip);
      flipped = S.rolled;
    }
    return { flipped, tip };
  };
  assert.ok(slide('dry', 18, 8).flipped, 'tarmac at 8 m/s sideways');
  assert.ok(!slide('dry', 18, 4.5).flipped, 'a 4.5 m/s slide on tarmac is survivable');
  assert.ok(slide('grass', 18, 11).flipped, 'grass at 11 m/s sideways');
  for (const s of ['ice', 'snow', 'wet']) assert.ok(!slide(s, 25, 12).flipped, s);
});

test('shove: a hard side impact lifts the wheels and can tip the van; a bump only rocks it', () => {
  const tipOver = (dvy) => {
    const S = makeVanDyn();
    S.u = 8;
    kickRoll(S, dvy);
    const env = { ...ROAD.dry, grade: 0, sideG: 0, ...aid('standard') };
    let max = 0;
    for (let t = 0; t < 3 && !S.rolled; t += H) {
      stepVanDyn(S, { drive: env.crr * VAN_DYN.m * G, brake: 0, hand: false, delta: 0 }, env, H);
      max = Math.max(max, S.tip);
    }
    return { rolled: S.rolled, max, side: S.tipSide };
  };
  assert.ok(!tipOver(0.8).rolled && tipOver(0.8).max < 0.05);
  const hit = tipOver(-6);
  assert.ok(hit.rolled && hit.side === -1, 'pushed to the left, the roof goes left');
  assert.ok(tipOver(6).rolled && tipOver(6).side === 1);
});

test('reverse: the van backs up under negative drive, steering follows the back of the car, braking stops it', () => {
  const S = makeVanDyn();
  const env = { ...ROAD.dry, grade: 0, sideG: 0, ...aid('standard') };
  for (let t = 0; t < 4; t += H) stepVanDyn(S, { drive: -9000, brake: 0, hand: false, delta: 0.3 }, env, H);
  assert.ok(S.u < -3, `u ${S.u}`);
  assert.ok(S.r < 0, 'left lock in reverse swings the nose to the right');
  for (let t = 0; t < 4; t += H) stepVanDyn(S, { drive: 0, brake: 1, hand: false, delta: 0 }, env, H);
  assert.ok(Math.abs(S.u) < 0.05, 'brakes stop a reversing van without pushing it forward');
});

test('handbrake: Pro locks the rear wheels and the tail swings out; the aids just brake', () => {
  const swing = (assist) => drive({ v0: 18, assist, keys: seq([[0.8, 0.6]]), hand: (t) => t > 0.4 && t < 1.4, brake: () => 0, T: 3 });
  const pro = swing('pro'), easy = swing('easy');
  assert.ok(pro.maxLock > 0.9, 'rear tyres locked');
  assert.ok(pro.maxR > easy.maxR * 1.1 || Math.abs(pro.yaw) > Math.abs(easy.yaw), `pro ${pro.maxR.toFixed(2)} vs easy ${easy.maxR.toFixed(2)}`);
});

test('traction: flooring it in a corner on snow with the aids off spins the wheels and pushes the tail wide; traction control keeps it in line', () => {
  const run = (assist) => {
    const S = makeVanDyn();
    S.u = 10;
    const env = { ...ROAD.snow, grade: 0, sideG: 0, ...aid(assist) };
    let spin = 0;
    for (let t = 0; t < 3; t += H) {
      stepVanDyn(S, { drive: 9000, brake: 0, hand: false, delta: t > 0.3 ? 0.1 : 0 }, env, H);
      spin = Math.max(spin, S.spin);
    }
    return { spin, slipAngle: Math.abs(Math.atan2(S.vy, S.u)) };
  };
  const pro = run('pro'), easy = run('easy');
  assert.ok(pro.spin > 0.2, 'wheelspin without traction control');
  assert.ok(pro.slipAngle > easy.slipAngle, `pro ${pro.slipAngle.toFixed(2)} easy ${easy.slipAngle.toFixed(2)}`);
});

test('load transfer: braking hard loads the front axle, accelerating the rear', () => {
  const env = { ...ROAD.dry, grade: 0, sideG: 0, ...aid('standard') };
  const S = makeVanDyn();
  S.u = 25;
  for (let i = 0; i < 100; i++) stepVanDyn(S, { drive: 0, brake: 1, hand: false, delta: 0 }, env, H);
  assert.ok(S.ax < -0.85 * G, `ax ${S.ax / G}`);
  // a van stopped on full brake sits level again
  const T = makeVanDyn();
  T.u = 3;
  stepVanDyn(T, { drive: 0, brake: 1, hand: false, delta: 0 }, env, H);
  assert.ok(T.lam < 0.05);
});
