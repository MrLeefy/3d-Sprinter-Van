// Sample-based sound effects and ambience (CC0 recordings from Kenney and OpenGameArt, see
// public/audio/CREDITS.md) layered over the synthesised engines in audio.js. Everything is loaded
// lazily; if a file is missing the layer simply stays silent. Ambience is mixed live from the
// scene: wind with speed, birdsong by day, crickets at night, rain, and impacts scaled by speed.
const BASE = 'audio/';
const FILES = ['wind', 'birds', 'crickets', 'rain', 'morning', 'blinker', 'parkbrake', 'doorclose', 'start', 'stop', 'glass0', 'plate0',
  'crashHeavy0', 'crashHeavy1', 'crashHeavy2', 'crashMed0', 'crashMed1', 'wood0', 'wood1', 'thud0', 'thud1'];
const LOOPS = ['wind', 'birds', 'crickets', 'rain', 'morning'];
const IMPACT = {
  tree: ['wood0', 'wood1', 'thud0'], boulder: ['crashMed0', 'plate0'], building: ['crashHeavy0', 'crashHeavy1', 'crashHeavy2'],
  crash: ['crashHeavy1', 'crashMed1', 'glass0'], animal: ['thud0', 'thud1'], pole: ['thud1', 'wood1'], sign: ['plate0', 'thud1'], rollover: ['crashHeavy2', 'crashHeavy0', 'glass0'], jackknife: ['crashMed0'],
};
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

export class Sfx {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(out);
    this.buf = new Map();
    this.loops = new Map();
    this.loading = false;
    this.last = new Map();
  }

  async load() {
    if (this.loading) return;
    this.loading = true;
    await Promise.all(FILES.map(async (n) => {
      try {
        const r = await fetch(`${BASE}${n}.ogg`);
        if (!r.ok) return;
        const b = await this.ctx.decodeAudioData(await r.arrayBuffer());
        this.buf.set(n, b);
        if (LOOPS.includes(n)) this.startLoop(n);
      } catch {
        /* silent layer */
      }
    }));
  }

  startLoop(n) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf.get(n);
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.out);
    src.start(0, Math.random() * src.buffer.duration);
    this.loops.set(n, g);
  }

  /** One-shot sample; `rate` shifts pitch, `gain` is linear, throttled per name. */
  play(name, gain = 1, rate = 1, minGap = 0.05) {
    const b = this.buf.get(name);
    if (!b) return;
    const t = this.ctx.currentTime;
    if (t - (this.last.get(name) || -9) < minGap) return;
    this.last.set(name, t);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(this.out);
    s.start();
  }

  /** Impact by event kind; `speed` in m/s scales loudness and pitch (bigger rigs sound lower). */
  impact(kind, speed = 5, heavy = false) {
    const list = IMPACT[kind];
    if (!list) return;
    const g = Math.min(1, 0.2 + speed / 16);
    // a hard hit is deeper (lower playback rate) and brings crumpling metal and glass with it
    const rate = (heavy ? 0.78 : 1) * (0.92 + Math.random() * 0.16) * (1 - Math.min(0.2, speed / 90));
    this.play(rnd(list), g, rate, 0.12);
    if (speed > 9 && (kind === 'crash' || kind === 'building' || kind === 'rollover')) this.play('glass0', Math.min(1, g * 0.8), 0.9 + Math.random() * 0.2, 0.3);
    if ((heavy && speed > 8) || speed > 16) this.play(rnd(IMPACT.building), g * 0.7, 0.7, 0.2);
  }

  setLoop(name, target, t = 0.6) {
    const g = this.loops.get(name);
    if (g) g.gain.setTargetAtTime(target, this.ctx.currentTime, t);
  }

  /**
   * Mix the ambience. env: { speed m/s, day 0..1, rain 0..1, snow 0..1, town 0..1, offroad 0..1, cab 0..1 (windows up,
   * cockpit view), summer 0..1 }. Wind rises with speed; birds need daylight, calm and no rain; crickets are a warm night.
   */
  ambience(env) {
    const calm = Math.max(0, 1 - env.speed / 22);
    const dry = 1 - Math.max(env.rain, env.snow * 0.7);
    const cab = 1 - 0.55 * (env.cab || 0);
    this.setLoop('wind', Math.min(0.5, 0.05 + env.speed * env.speed * 0.00042 + env.rain * 0.05) * cab);
    this.setLoop('birds', env.day * dry * calm * (1 - env.town * 0.7) * env.summer * 0.55 * cab, 1.2);
    this.setLoop('morning', env.day * dry * calm * (1 - env.town) * env.summer * 0.22 * cab, 1.2);
    this.setLoop('crickets', (1 - env.day) * dry * (1 - env.town * 0.8) * env.summer * Math.min(1, 0.4 + calm) * 0.4 * cab, 1.5);
    this.setLoop('rain', env.rain * 0.55 * cab, 1);
  }

  setVolume(v, tc = 0.05) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }
}
