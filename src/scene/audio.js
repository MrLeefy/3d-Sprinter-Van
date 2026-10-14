// Synthesised drive sound (no audio files): a muffled diesel firing note built from a soft harmonic
// series (no saw or square edges), a low engine-order rumble, a faint intake whoosh and a damped
// clatter, all behind two 12 dB/oct low-passes and a cabin filter that closes further in the
// cockpit view. Wind grows with speed², tyre noise comes off the track. Created on a user gesture
// (the Drive button), so browsers allow it to play.
import { Sfx } from './sfx.js';

/** Soft firing pulse: harmonic amplitudes fall off steeply so the note is round, not buzzy. */
const FIRE_HARMONICS = [0, 0.9, 1, 0.8, 0.55, 0.36, 0.22, 0.13, 0.08, 0.05];
const ROUND_HARMONICS = [0, 1, 0.12];

export class EngineSound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.volume = 1;
    this.truck = false; // 6-cylinder heavy diesel with air-brake hiss and an air horn
    this.cab = 0.35; // 0 = heard from outside, 1 = inside the closed cab
  }

  setTruck(on) {
    this.truck = !!on;
  }

  /**
   * Build the audio graph. `ctx` may be supplied (an OfflineAudioContext in tests); `opts.sfx`
   * false skips the recorded effects layer.
   */
  start(ctx = null, opts = {}) {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    this.ctx = ctx;
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      n.start();
      return n;
    };
    const filt = (type, f, q = 0.5) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const wave = (h) => ctx.createPeriodicWave(new Float32Array(h.length), Float32Array.from(h));
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // everything the engine makes goes through the same body/low-pass/cabin chain, so no stage can ring
    this.eng = ctx.createGain();
    this.body = filt('peaking', 135, 0.8);
    this.body.gain.value = 4;
    this.boom = filt('peaking', 210, 0.9); // cabin boom that keeps a low idle audible on small speakers
    this.boom.gain.value = 3;
    this.lp1 = filt('lowpass', 300, 0.5);
    this.lp2 = filt('lowpass', 300, 0.5);
    this.cabin = filt('lowpass', 1400, 0.5);
    this.eng.connect(this.body).connect(this.boom).connect(this.lp1).connect(this.lp2).connect(this.cabin).connect(this.master);
    this.fire = ctx.createOscillator();
    this.fire.setPeriodicWave(wave(FIRE_HARMONICS));
    this.lump = ctx.createOscillator(); // a hair off the firing order: the slow beat of a 4-cylinder's imbalance
    this.lump.setPeriodicWave(wave(FIRE_HARMONICS));
    this.sub = ctx.createOscillator(); // crankshaft order, rounded
    this.sub.setPeriodicWave(wave(ROUND_HARMONICS));
    const gFire = ctx.createGain(), gLump = ctx.createGain(), gSub = ctx.createGain();
    gFire.gain.value = 0.62;
    gLump.gain.value = 0.2;
    gSub.gain.value = 0.28;
    this.fire.connect(gFire).connect(this.eng);
    this.lump.connect(gLump).connect(this.eng);
    this.sub.connect(gSub).connect(this.eng);
    this.fire.start();
    this.lump.start();
    this.sub.start();
    // diesel clatter: low-passed so only a soft tick remains, and mostly at light load
    this.gClat = ctx.createGain();
    this.gClat.gain.value = 0;
    noise().connect(filt('bandpass', 650, 0.7)).connect(this.gClat).connect(this.eng);
    // intake whoosh under load
    this.gIntake = ctx.createGain();
    this.gIntake.gain.value = 0;
    noise().connect(filt('bandpass', 420, 0.6)).connect(this.gIntake).connect(this.eng);
    // damaged engine: a loose, irregular rattle
    this.gRattle = ctx.createGain();
    this.gRattle.gain.value = 0;
    const rat = ctx.createGain();
    rat.gain.value = 0.5;
    this.rattleLfo = ctx.createOscillator();
    this.rattleLfo.type = 'triangle';
    const ratDepth = ctx.createGain();
    ratDepth.gain.value = 0.5;
    this.rattleLfo.connect(ratDepth).connect(rat.gain);
    this.rattleLfo.start();
    noise().connect(filt('bandpass', 520, 1.1)).connect(rat).connect(this.gRattle).connect(this.eng);
    // wind
    this.gWind = ctx.createGain();
    this.gWind.gain.value = 0;
    noise().connect(filt('lowpass', 520)).connect(this.gWind).connect(this.master);
    // tyres on loose ground
    this.gTyre = ctx.createGain();
    this.gTyre.gain.value = 0;
    noise().connect(filt('bandpass', 260, 0.8)).connect(this.gTyre).connect(this.master);
    // tyre squeal on a slide or a locked-up stop
    this.gSqueal = ctx.createGain();
    this.gSqueal.gain.value = 0;
    noise().connect(filt('bandpass', 1700, 5)).connect(this.gSqueal).connect(this.master);
    // paved-road tyre hum
    this.gRoad = ctx.createGain();
    this.gRoad.gain.value = 0;
    noise().connect(filt('lowpass', 380)).connect(this.gRoad).connect(this.master);
    // heavy diesel: exhaust rumble, turbo whistle and compression-release (engine brake) chatter
    this.gRumble = ctx.createGain();
    this.gRumble.gain.value = 0;
    noise().connect(filt('lowpass', 150)).connect(this.gRumble).connect(this.eng);
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.gTurbo = ctx.createGain();
    this.gTurbo.gain.value = 0;
    this.turbo.connect(this.gTurbo).connect(this.master);
    this.turbo.start();
    const jakeMod = ctx.createGain();
    jakeMod.gain.value = 0.5;
    this.jakeLfo = ctx.createOscillator();
    this.jakeLfo.type = 'square';
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    this.jakeLfo.connect(depth).connect(jakeMod.gain);
    this.jakeLfo.start();
    this.gJake = ctx.createGain();
    this.gJake.gain.value = 0;
    noise().connect(filt('bandpass', 700, 1.0)).connect(jakeMod).connect(this.gJake).connect(this.eng);
    // recorded effects and ambience
    if (opts.sfx !== false) {
      this.sfx = new Sfx(ctx, ctx.destination);
      this.sfx.load();
    }
  }

  /** Two-tone horn. */
  horn() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (this.truck) return this.airHorn();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * this.volume, t + 0.03);
    g.gain.setValueAtTime(0.22 * this.volume, t + 0.38);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    g.connect(ctx.destination);
    for (const f of [392, 311]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      o.connect(lp).connect(g);
      o.start(t);
      o.stop(t + 0.52);
    }
  }

  /** Three-chime air horn. */
  airHorn() {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.26 * this.volume, t + 0.05);
    g.gain.setValueAtTime(0.26 * this.volume, t + 0.85);
    g.gain.linearRampToValueAtTime(0, t + 1.0);
    g.connect(ctx.destination);
    for (const f of [220, 277, 330]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      o.connect(lp).connect(g);
      o.start(t);
      o.stop(t + 1.02);
    }
  }

  /** Air-brake release: a short burst of filtered noise. */
  hiss(strength = 1) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.7, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * strength * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    n.connect(hp).connect(g).connect(ctx.destination);
    n.start(t);
  }

  /**
   * rpm, throttle 0..1, speed m/s, offroad 0..1, active (engine running), slip 0..1 (tyre squeal).
   * extra: { jake 0..1 engine brake, cab 0..1 how closed-in the listener is, dead engine out of action,
   * dmg 0..1 engine damage (rattle) }
   */
  update(rpm, throttle, speed, offroad, active, slip = 0, extra = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.08;
    const T = this.truck;
    const f = (rpm / 60) * (T ? 3 : 2);
    const cab = extra.cab ?? this.cab;
    this.cab = cab;
    this.fire.frequency.setTargetAtTime(f, t, k);
    this.lump.frequency.setTargetAtTime(f * 1.006, t, k);
    this.sub.frequency.setTargetAtTime(f / 2, t, k);
    // a throttle opens the muffler a little; the cabin closes the sound in
    const cut = (T ? 150 : 200) + throttle * (T ? 240 : 300) + rpm * 0.04;
    this.lp1.frequency.setTargetAtTime(cut, t, k);
    this.lp2.frequency.setTargetAtTime(cut * 1.15, t, k);
    this.cabin.frequency.setTargetAtTime(1900 - cab * 1250, t, 0.25);
    const run = extra.dead ? 0 : 1;
    this.eng.gain.setTargetAtTime(run * (1.15 - 0.2 * cab), t, 0.12);
    this.gClat.gain.setTargetAtTime(T ? 0.012 + throttle * 0.02 : 0.006 + Math.max(0, 0.5 - throttle) * 0.01, t, k);
    this.gIntake.gain.setTargetAtTime(Math.max(0, throttle - 0.15) * 0.05 * Math.min(1, rpm / 2500), t, 0.15);
    const dmg = extra.dmg || 0;
    this.gRattle.gain.setTargetAtTime(run * dmg * 0.09, t, 0.3);
    this.rattleLfo.frequency.setTargetAtTime(7 + (rpm / 60) * 0.35, t, 0.2);
    this.gWind.gain.setTargetAtTime(Math.min(0.2, speed * speed * 0.00016) * (1 - 0.4 * cab), t, 0.2);
    this.gTyre.gain.setTargetAtTime(Math.min(0.1, offroad * speed * 0.01), t, 0.15);
    this.gSqueal.gain.setTargetAtTime(Math.min(0.06, slip * Math.min(1, speed / 12) * 0.06), t, 0.08);
    this.gRoad.gain.setTargetAtTime(Math.min(0.1, (1 - Math.min(1, offroad)) * speed * (T ? 0.004 : 0.0024)), t, 0.2);
    this.gRumble.gain.setTargetAtTime(T ? 0.05 + throttle * 0.12 : 0, t, 0.15);
    this.turbo.frequency.setTargetAtTime(1500 + rpm * 1.9, t, 0.1);
    this.gTurbo.gain.setTargetAtTime(T ? Math.max(0, throttle - 0.25) * 0.01 * Math.min(1, rpm / 1500) * (1 - 0.6 * cab) : 0, t, 0.2);
    this.jakeLfo.frequency.setTargetAtTime(Math.max(8, f / 2), t, 0.05);
    this.gJake.gain.setTargetAtTime(T ? (extra.jake || 0) * 0.14 : 0, t, 0.08);
    this.sfx?.setVolume(active && this.on ? this.volume : 0, active ? 0.25 : 1.4);
    this.master.gain.setTargetAtTime(active && this.on ? 0.4 * this.volume : 0, t, 0.25);
  }

  /** Crash, park brake, door and similar one-shots. */
  fx(kind, a, b, c) {
    if (!this.on) return;
    if (kind === 'impact') this.sfx?.impact(a, b, c);
    else this.sfx?.play(kind, a ?? 1, b ?? 1);
  }

  setOn(on) {
    this.on = on;
  }
}
