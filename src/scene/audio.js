// Synthesised drive sound (no audio files): 4-cylinder diesel firing note and sub-rumble, a
// throttle-dependent clatter, wind that grows with speed², and tyre noise off the track.
// Created on a user gesture (the Drive button), so browsers allow it to play.
export class EngineSound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.volume = 1;
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
  }

  /** Two-tone horn. */
  horn() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
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

  /** rpm, throttle 0..1, speed m/s, offroad 0..1, active (engine running), slip 0..1 (tyre squeal) */
  update(rpm, throttle, speed, offroad, active, slip = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.08;
    const f = (rpm / 60) * 2;
    this.fire.frequency.setTargetAtTime(f, t, k);
    this.sub.frequency.setTargetAtTime(f / 2, t, k);
    this.lp.frequency.setTargetAtTime(260 + throttle * 900 + rpm * 0.08, t, k);
    this.gClat.gain.setTargetAtTime(0.012 + throttle * 0.03, t, k);
    this.gWind.gain.setTargetAtTime(Math.min(0.22, speed * speed * 0.00018), t, 0.2);
    this.gTyre.gain.setTargetAtTime(Math.min(0.12, offroad * speed * 0.012), t, 0.15);
    this.gSqueal.gain.setTargetAtTime(Math.min(0.07, slip * Math.min(1, speed / 12) * 0.07), t, 0.08);
    this.master.gain.setTargetAtTime(active && this.on ? 0.5 * this.volume : 0, t, 0.25);
  }

  setOn(on) {
    this.on = on;
  }
}
