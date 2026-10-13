// Material library with procedural (canvas) textures — no external assets.
import * as THREE from 'three';

const cache = new Map();

function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function woodTexture(base = '#c9a27a', dark = '#a77f57', seed = 7, planks = false) {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rand(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      const y = r() * h;
      g.strokeStyle = dark;
      g.globalAlpha = 0.03 + r() * 0.07;
      g.lineWidth = 0.5 + r() * 1.6;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / (40 + r() * 60) + i) * (2 + r() * 4));
      g.stroke();
    }
    g.globalAlpha = 1;
    if (planks) {
      g.strokeStyle = 'rgba(60,40,25,0.35)';
      g.lineWidth = 2;
      for (let y = 0; y < h; y += h / 4) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
        const off = r() * w;
        g.beginPath();
        g.moveTo(off, y);
        g.lineTo(off, y + h / 4);
        g.stroke();
      }
    }
  });
}

function noiseTexture(base, amp = 18, seed = 3, size = 256, speck = 0) {
  return canvasTex(size, size, (g, w, h) => {
    const r = rand(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * amp;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < speck; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(80,80,80,0.5)' : 'rgba(255,255,255,0.6)';
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
  });
}

function solarTexture() {
  return canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = '#0d1b33';
    g.fillRect(0, 0, w, h);
    const cols = 10, rows = 6;
    const cw = w / cols, ch = h / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const grd = g.createLinearGradient(i * cw, j * ch, (i + 1) * cw, (j + 1) * ch);
        grd.addColorStop(0, '#16305a');
        grd.addColorStop(1, '#0b1a36');
        g.fillStyle = grd;
        g.fillRect(i * cw + 2, j * ch + 2, cw - 4, ch - 4);
        g.strokeStyle = 'rgba(180,200,230,0.25)';
        g.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
          g.beginPath();
          g.moveTo(i * cw + (k * cw) / 4, j * ch + 2);
          g.lineTo(i * cw + (k * cw) / 4, (j + 1) * ch - 2);
          g.stroke();
        }
      }
    }
  });
}

function slatTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rand(11);
    g.fillStyle = '#d8c3a3';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      g.fillStyle = `hsl(32, ${28 + r() * 8}%, ${70 + r() * 8}%)`;
      g.fillRect(x + 2, 0, 28, h);
      g.fillStyle = 'rgba(40,30,20,0.55)';
      g.fillRect(x, 0, 2, h);
      for (let i = 0; i < 8; i++) {
        g.strokeStyle = 'rgba(120,90,60,0.12)';
        g.beginPath();
        const xx = x + 4 + r() * 24;
        g.moveTo(xx, 0);
        g.lineTo(xx + (r() - 0.5) * 6, h);
        g.stroke();
      }
    }
  });
}

function feltTexture() {
  return noiseTexture('#6b6f74', 16, 21, 256);
}

function treadTexture() {
  return canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#1b1b1b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0c0c0c';
    for (let y = 0; y < h; y += 16) {
      g.fillRect(0, y, w * 0.42, 6);
      g.fillRect(w * 0.58, y + 8, w * 0.42, 6);
    }
  });
}

function insulationTexture() {
  return noiseTexture('#e9e4d4', 40, 31, 128);
}

export function makeMaterials() {
  if (cache.size) return Object.fromEntries(cache);
  const M = {};
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M.paint = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f3, roughness: 0.32, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  M.paintInner = std({ color: 0xdcdcd8, roughness: 0.6 });
  M.trim = std({ color: 0x1d1f22, roughness: 0.75, metalness: 0.0 });
  M.trimGloss = std({ color: 0x15171a, roughness: 0.35, metalness: 0.2 });
  M.chrome = std({ color: 0xd8dde3, roughness: 0.18, metalness: 1.0 });
  M.alu = std({ color: 0xb9bec4, roughness: 0.38, metalness: 0.85 });
  M.aluDark = std({ color: 0x3a3f45, roughness: 0.5, metalness: 0.6 });
  M.steel = std({ color: 0xc6cbd0, roughness: 0.28, metalness: 0.9 });
  M.brushed = std({ color: 0xbfc4c9, roughness: 0.35, metalness: 0.85, map: noiseTexture('#c8ccd0', 26, 5, 256) });
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0x1a2430, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, envMapIntensity: 1.4 });
  M.glassClear = new THREE.MeshPhysicalMaterial({ color: 0xbfd8e6, roughness: 0.05, transparent: true, opacity: 0.22 });
  M.tire = std({ color: 0x1a1a1a, roughness: 0.92, map: treadTexture() });
  M.rubber = std({ color: 0x111111, roughness: 0.9 });
  M.rim = std({ color: 0xa9adb3, roughness: 0.3, metalness: 0.9 });
  M.headlight = new THREE.MeshPhysicalMaterial({ color: 0xe8eef5, roughness: 0.05, metalness: 0.3, clearcoat: 1, emissive: 0x222222 });
  M.tail = std({ color: 0x8a0f12, roughness: 0.25, emissive: 0x2a0000 });
  M.amber = std({ color: 0xd98a12, roughness: 0.3, emissive: 0x201000 });
  M.underbody = std({ color: 0x24272b, roughness: 0.9 });
  // Interior
  const oak = woodTexture('#d2b48c', '#a8865c', 7);
  M.oak = std({ color: 0xffffff, map: oak, roughness: 0.55 });
  M.walnut = std({ color: 0xffffff, map: woodTexture('#6b4a33', '#3e2a1c', 13), roughness: 0.5 });
  M.cabinet = std({ color: 0xf1eee8, roughness: 0.55 });
  M.cabinetEdge = std({ color: 0xffffff, map: oak, roughness: 0.5 });
  M.floor = std({ color: 0xffffff, map: woodTexture('#b48a5f', '#7e5c3c', 19, true), roughness: 0.6 });
  M.floor.map.repeat.set(3, 2);
  M.ceiling = std({ color: 0xffffff, map: slatTexture(), roughness: 0.6 });
  M.ceiling.map.repeat.set(1, 4);
  M.felt = std({ color: 0xffffff, map: feltTexture(), roughness: 0.95 });
  M.quartz = std({ color: 0xffffff, map: noiseTexture('#eceae4', 10, 9, 256, 600), roughness: 0.25 });
  M.fabric = std({ color: 0xffffff, map: noiseTexture('#8c8a86', 22, 17, 256), roughness: 0.95 });
  M.fabricDark = std({ color: 0xffffff, map: noiseTexture('#3c3f44', 18, 23, 256), roughness: 0.95 });
  M.leather = std({ color: 0x2f2b28, roughness: 0.55 });
  M.linen = std({ color: 0xffffff, map: noiseTexture('#e8e3d8', 12, 29, 256), roughness: 0.95 });
  M.blanket = std({ color: 0xffffff, map: noiseTexture('#5f7a8c', 20, 41, 256), roughness: 0.95 });
  M.ceramic = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.08, metalness: 0.1, clearcoat: 1 });
  M.screen = std({ color: 0x0b1420, roughness: 0.2, emissive: 0x08304a, emissiveIntensity: 0.8 });
  M.white = std({ color: 0xf6f6f4, roughness: 0.5 });
  M.grp = std({ color: 0xf2f2ef, roughness: 0.35 });
  M.red = std({ color: 0xc81e1e, roughness: 0.4 });
  M.victron = std({ color: 0x1f4f8f, roughness: 0.5, metalness: 0.2 });
  M.battery = std({ color: 0x232a33, roughness: 0.6 });
  M.truma = std({ color: 0xdedfe0, roughness: 0.55 });
  M.tankWater = new THREE.MeshPhysicalMaterial({ color: 0x3a8fd6, roughness: 0.1, transparent: true, opacity: 0.55 });
  M.tankShell = new THREE.MeshPhysicalMaterial({ color: 0xe9eef2, roughness: 0.4, transparent: true, opacity: 0.38, depthWrite: false });
  M.greyWater = new THREE.MeshPhysicalMaterial({ color: 0x7b7558, roughness: 0.2, transparent: true, opacity: 0.7 });
  M.solar = std({ color: 0xffffff, map: solarTexture(), roughness: 0.15, metalness: 0.3 });
  M.insulation = std({ color: 0xffffff, map: insulationTexture(), roughness: 1, transparent: true, opacity: 0.85 });
  M.xps = std({ color: 0x8fc6e8, roughness: 0.9 });
  M.cover = std({ color: 0xffffff, map: noiseTexture('#2c2f33', 14, 51, 128), roughness: 0.9 });
  M.coverSilver = std({ color: 0xcfd4d8, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
  M.awning = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.9, side: THREE.DoubleSide });
  M.ground = std({ color: 0x8a8f7a, roughness: 1 });
  M.lightOn = std({ color: 0xfff3dc, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
  M.ledStrip = std({ color: 0xfff1d6, emissive: 0xffc98a, emissiveIntensity: 0, roughness: 0.4 });
  M.cookZone = std({ color: 0x2a0a06, emissive: 0xff3a10, emissiveIntensity: 0, roughness: 0.3 });
  M.ghost = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.08, depthWrite: false, roughness: 1 });
  M.ghostEdge = new THREE.LineBasicMaterial({ color: 0x8796a5, transparent: true, opacity: 0.18 });
  M.xrayBody = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.1, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  for (const [k, v] of Object.entries(M)) {
    v.name = k;
    cache.set(k, v);
  }
  return M;
}

/** Bright system-colour material (for focus modes and generic components). */
const sysCache = new Map();
export function systemMaterial(hex, { emissive = 0.18, opacity = 1 } = {}) {
  const key = `${hex}-${emissive}-${opacity}`;
  if (!sysCache.has(key)) {
    const c = new THREE.Color(hex);
    sysCache.set(key, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: emissive, roughness: 0.5, metalness: 0.1, transparent: opacity < 1, opacity }));
  }
  return sysCache.get(key);
}

export const FLOW_COLORS = {
  cold: 0x2f8cff, hot: 0xff4d2e, drink: 0x7fe3ff, grey: 0x8b7d5a, fill: 0x5bb6ff, vent: 0x9aa0a6, fuel: 0xc28a2c, drain: 0x5a7fa0,
  dcmain: 0xff2d2d, dc: 0xffc21a, ac: 0xff7a1a, pv: 0x3ddc84, alt: 0x00d1ff, shore: 0xb070ff, data: 0x7a8aa0,
  heat: 0xff6a3d, acduct: 0x56b6ff, exhaust: 0xb0a090, fresh: 0x4ee08a,
  // air kinds
  stale: 0xb7a98c, cook: 0xffa94d, bath: 0x8fe0ff, acCold: 0x4dabff, heatWarm: 0xff6b3d, recirc: 0xb197fc, battery: 0xffd43b, hotOut: 0xff8c42,
};
