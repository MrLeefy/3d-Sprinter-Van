// Conversion cost estimate (USD, 2026 retail, excluding tax). Labelled as an estimate.
import { COMPONENTS, SYSTEMS } from '../data/components.js';
import { DISTRIBUTED } from './weight.js';

export const BASE_VAN_USD = 64000; // assumption: 2025 Sprinter 2500 HR 170 RWD cargo, typical transaction price
export const LABOR = { proHours: 720, proRate: 110, diyHours: 1100, certifiedInstalls: 2200 };

export function costReport() {
  const bySystem = {};
  let parts = 0;
  for (const c of COMPONENTS) {
    if (!c.cost) continue;
    parts += c.cost;
    bySystem[c.system] = (bySystem[c.system] || 0) + c.cost;
  }
  for (const d of DISTRIBUTED) {
    parts += d.cost;
    bySystem.envelope = (bySystem.envelope || 0) + d.cost;
  }
  const contingency = Math.round(parts * 0.1);
  const pro = parts + contingency + LABOR.proHours * LABOR.proRate + LABOR.certifiedInstalls;
  const diy = parts + contingency + LABOR.certifiedInstalls;
  const rows = Object.entries(bySystem)
    .map(([k, v]) => ({ system: k, name: SYSTEMS[k]?.name || k, cost: v }))
    .sort((a, b) => b.cost - a.cost);
  return { parts, contingency, rows, diy, pro, baseVan: BASE_VAN_USD, totalPro: pro + BASE_VAN_USD, totalDiy: diy + BASE_VAN_USD, labor: LABOR };
}
