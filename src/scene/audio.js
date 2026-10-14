// Synthesised drive sound (no audio files): 4-cylinder diesel firing note and sub-rumble, a
// throttle-dependent clatter, wind that grows with speed², and tyre noise off the track.
// Created on a user gesture (the Drive button), so browsers allow it to play.
import { Sfx } from './sfx.js';

export class EngineSound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.volume = 1;
    this.truck = false; // 6-cylinder heavy diesel with air-brake hiss and an air horn
  }

  setTruck(on) {
    this.truck = !!on;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
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
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // engine: firing note + sub-octave through a throttle-opened low-pass
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 320;
    this.lp.Q.value = 3;
    this.lp.connect(this.master);
    this.fire = ctx.createOscillator();
    this.fire.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    const gFire = ctx.createGain(), gSub = ctx.createGain();
    gFire.gain.value = 0.5;
    gSub.gain.value = 0.32;
    this.fire.connect(gFire).connect(this.lp);
    this.sub.connect(gSub).connect(this.lp);
    this.fire.start();
    this.sub.start();
    // diesel clatter: band-passed noise
    const clat = ctx.createBiquadFilter();
    clat.type = 'bandpass';
    clat.frequency.value = 1400;
    clat.Q.value = 1.4;
    this.gClat = ctx.createGain();
    this.gClat.gain.value = 0;
    noise().connect(clat).connect(this.gClat).connect(this.master);
    // wind
    const wind = ctx.createBiquadFilter();
    wind.type = 'lowpass';
    wind.frequency.value = 520;
    this.gWind = ctx.createGain();
    this.gWind.gain.value = 0;
    noise().connect(wind).connect(this.gWind).connect(this.master);
    // tyres on loose ground
    const tyre = ctx.createBiquadFilter();
    tyre.type = 'bandpass';
    tyre.frequency.value = 260;
    tyre.Q.value = 0.8;
    this.gTyre = ctx.createGain();
    this.gTyre.gain.value = 0;
    noise().connect(tyre).connect(this.gTyre).connect(this.master);
    // tyre squeal on a slide or a locked-up stop
    const squeal = ctx.createBiquadFilter();
    squeal.type = 'bandpass';
    squeal.frequency.value = 1900;
    squeal.Q.value = 5;
    this.gSqueal = ctx.createGain();
    this.gSqueal.gain.value = 0;
    noise().connect(squeal).connect(this.gSqueal).connect(this.master);
    // paved-road tyre hum
    const road = ctx.createBiquadFilter();
    road.type = 'lowpass';
    road.frequency.value = 420;
    this.gRoad = ctx.createGain();
    this.gRoad.gain.value = 0;
    noise().connect(road).connect(this.gRoad).connect(this.master);
    // heavy diesel: exhaust rumble, turbo whistle and compression-release (engine brake) chatter
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 160;
    this.gRumble = ctx.createGain();
    this.gRumble.gain.value = 0;
    noise().connect(rumble).connect(this.gRumble).connect(this.master);
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.gTurbo = ctx.createGain();
    this.gTurbo.gain.value = 0;
    this.turbo.connect(this.gTurbo).connect(this.master);
    this.turbo.start();
    const jake = ctx.createBiquadFilter();
    jake.type = 'bandpass';
    jake.frequency.value = 850;
    jake.Q.value = 1.1;
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
    noise().connect(jake).connect(jakeMod).connect(this.gJake).connect(this.master);
    // recorded effects and ambience
    this.sfx = new Sfx(ctx, ctx.destination);
    this.sfx.load();
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

  /** rpm, throttle 0..1, speed m/s, offroad 0..1, active (engine running), slip 0..1 (tyre squeal) */
  update(rpm, throttle, speed, offroad, active, slip = 0, extra = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.08;
    const f = (rpm / 60) * (this.truck ? 3 : 2);
    this.fire.frequency.setTargetAtTime(f, t, k);
    this.sub.frequency.setTargetAtTime(f / 2, t, k);
    this.lp.frequency.setTargetAtTime((this.truck ? 200 : 260) + throttle * (this.truck ? 650 : 900) + rpm * (this.truck ? 0.12 : 0.08), t, k);
    this.gClat.gain.setTargetAtTime(this.truck ? 0.02 + throttle * 0.045 : 0.012 + throttle * 0.03, t, k);
    this.gWind.gain.setTargetAtTime(Math.min(0.22, speed * speed * 0.00018), t, 0.2);
    this.gTyre.gain.setTargetAtTime(Math.min(0.12, offroad * speed * 0.012), t, 0.15);
    this.gSqueal.gain.setTargetAtTime(Math.min(0.07, slip * Math.min(1, speed / 12) * 0.07), t, 0.08);
    const T = this.truck;
    this.gRoad.gain.setTargetAtTime(Math.min(0.12, (1 - Math.min(1, offroad)) * speed * (T ? 0.0045 : 0.0028)), t, 0.2);
    this.gRumble.gain.setTargetAtTime(T ? 0.05 + throttle * 0.12 : 0, t, 0.15);
    this.turbo.frequency.setTargetAtTime(1500 + rpm * 1.9, t, 0.1);
    this.gTurbo.gain.setTargetAtTime(T ? Math.max(0, throttle - 0.25) * 0.012 * Math.min(1, rpm / 1500) : 0, t, 0.2);
    this.jakeLfo.frequency.setTargetAtTime(Math.max(8, f / 2), t, 0.05);
    this.gJake.gain.setTargetAtTime(T ? (extra.jake || 0) * 0.16 : 0, t, 0.08);
    this.sfx?.setVolume(active && this.on ? this.volume : 0, active ? 0.25 : 1.4);
    this.master.gain.setTargetAtTime(active && this.on ? 0.5 * this.volume : 0, t, 0.25);
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
