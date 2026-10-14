// Distant ridgeline profiles (pure, deterministic): the silhouette of the real terrain on rings far beyond
// the streamed land, so mountains and buttes show through the haze. Heights come from the same season-
// independent raw terrain as the ground the van drives on; only the shading changes with the season.
export const RINGS = [
  { r: 2900, haze: 0.5, ex: 2.2 },
  { r: 4800, haze: 0.72, ex: 2.8 },
];
export const RIDGE_BASE = -220;

/**
 * Ridge heights on a ring of n samples around (cx, cz): { top: exaggerated height (m), elev: real height }.
 * The exaggeration stands in for the much larger relief a real horizon has at this distance.
 */
export function ridgeProfile(W, cx, cz, ring, n) {
  const top = new Float32Array(n), elev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const h = W.rawHeight(cx + Math.cos(a) * ring.r, cz + Math.sin(a) * ring.r);
    elev[i] = h;
    top[i] = Math.max(RIDGE_BASE + 40, h * ring.ex + (h > 60 ? (h - 60) * 0.8 : 0));
  }
  return { top, elev };
}
