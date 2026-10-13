// Synthesised drive sound (no audio files): 4-cylinder diesel firing note and sub-rumble, a
// throttle-dependent clatter, wind that grows with speed², and tyre noise off the track.
// Created on a user gesture (the Drive button), so browsers allow it to play.
export class EngineSound {
  constructor() {
    this.ctx = null;
    this.on = true;
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
  }

  /** rpm, throttle 0..1, speed m/s, offroad 0..1, active (engine running) */
  update(rpm, throttle, speed, offroad, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.08;
    const f = (rpm / 60) * 2;
    this.fire.frequency.setTargetAtTime(f, t, k);
    this.sub.frequency.setTargetAtTime(f / 2, t, k);
    this.lp.frequency.setTargetAtTime(260 + throttle * 900 + rpm * 0.08, t, k);
    this.gClat.gain.setTargetAtTime(0.012 + throttle * 0.03, t, k);
    this.gWind.gain.setTargetAtTime(Math.min(0.22, speed * speed * 0.00018), t, 0.2);
    this.gTyre.gain.setTargetAtTime(Math.min(0.12, offroad * speed * 0.012), t, 0.15);
    this.master.gain.setTargetAtTime(active && this.on ? 0.5 : 0, t, 0.25);
  }

  setOn(on) {
    this.on = on;
  }
}
