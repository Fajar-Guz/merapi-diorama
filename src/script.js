// Video timeline: camera, cursor and sim inputs as functions of time
export const FPS = 30, DURATION = 57;
const easeIO = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));
const cl = (x, a, b) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => easeIO((t - a) / (b - a));
const L = (a, b, k) => a + (b - a) * k;
const L3 = (a, b, k) => [L(a[0], b[0], k), L(a[1], b[1], k), L(a[2], b[2], k)];

// camera keys: t, target, az, el, dist, fov
export const CAM = [
  [0, [0, 1.3, 0], -40, 21, 31, 30],
  [5.5, [0, 1.5, 0], -16, 19, 25, 30],
  [9.5, [-1.5, 2.1, 1.0], -14, 17, 19.5, 30],
  [12.6, [-1.1, 2.0, 1.0], -6, 19, 18.5, 30],
  [14.6, [2.3, 1.2, 0.9], 14, 23, 18, 30],
  [17.6, [2.5, 1.0, 1.0], 24, 21, 16.5, 30],
  [20.5, [0.5, 1.6, 0], 8, 18, 22.5, 30],
  [23.6, [0.0, 1.9, 0], -4, 15, 23.5, 30],
  [27.3, [-0.9, 3.0, -0.5], -12, 12, 22, 30],
  [30.6, [-1.5, 3.7, -0.6], -24, 9, 17.5, 30],
  [32.3, [3.2, 0.7, 2.0], 12, 30, 8.2, 30],
  [34.2, [3.3, 0.6, 2.35], 16, 33, 6.6, 30],
  [36.8, [0.5, 1.7, 0], 16, 21, 22.5, 30],
  [39.4, [-0.4, 2.2, 0.3], 6, 20, 18.5, 30],
  [42.4, [0.4, 1.0, 1.6], 22, 23, 12.5, 30],
  [45.2, [0.9, 0.45, 2.5], 16, 13, 10.5, 30],
  [47.6, [0.5, 1.4, 0.4], 0, 20, 21.5, 30],
  [51.8, [0, 1.5, 0], 22, 18, 24, 30],
  [57.0, [0, 1.5, 0], 40, 16, 28, 30],
];
const CR = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
const flat = (k) => [...k[1], k[2], k[3], k[4], k[5]];
export function camAt(t) {
  t = cl(t, 0, CAM[CAM.length - 1][0]);
  let i = 0; while (i < CAM.length - 2 && t >= CAM[i + 1][0]) i++;
  const a = CAM[i], b = CAM[i + 1]; let u = cl((t - a[0]) / (b[0] - a[0]), 0, 1);
  if (i === 0) u = 0.5 * u * u + 0.5 * u; // ease in from rest
  if (i === CAM.length - 2) u = 1.5 * u - 0.5 * u * u; // ease out
  const P0 = flat(CAM[Math.max(0, i - 1)]), P1 = flat(a), P2 = flat(b), P3 = flat(CAM[Math.min(CAM.length - 1, i + 2)]);
  // time-normalised tangents (avoid overshoot on uneven spacing)
  const dt1 = b[0] - a[0], dt0 = a[0] - CAM[Math.max(0, i - 1)][0] || dt1, dt2 = CAM[Math.min(CAM.length - 1, i + 2)][0] - b[0] || dt1;
  const v = P1.map((_, j) => {
    const m1 = ((P2[j] - P0[j]) / (dt0 + dt1)) * dt1, m2 = ((P3[j] - P1[j]) / (dt1 + dt2)) * dt1;
    const t2 = u * u, t3 = t2 * u;
    return (2 * t3 - 3 * t2 + 1) * P1[j] + (t3 - 2 * t2 + u) * m1 + (-2 * t3 + 3 * t2) * P2[j] + (t3 - t2) * m2;
  });
  return { tg: [v[0], v[1], v[2]], az: v[3], el: v[4], d: v[5], fov: v[6] };
}

export const CLOUD_BASE = [[-2.4, 4.85, 0.9], [0.7, 5.05, -1.7], [3.1, 4.8, -0.5]];
export function cloudsAt(t) {
  const bob = (i) => [Math.sin(t * 0.3 + i * 2) * 0.12, Math.sin(t * 0.5 + i) * 0.05, Math.cos(t * 0.27 + i) * 0.08];
  const A0 = CLOUD_BASE[0], A1 = [-2.55, 4.45, 2.25];
  const B0 = CLOUD_BASE[1], B1 = [-0.75, 4.35, 0.05];
  const kA = seg(t, 7.1, 9.0), kB = seg(t, 37.7, 39.3);
  const a = L3(A0, A1, kA), b = L3(B0, B1, kB); const c = CLOUD_BASE[2];
  const ba = bob(0), bb = bob(1), bc = bob(2);
  const gA = t > 7.0 && t < 12.5, gB = t > 37.6 && t < 44.6;
  const sqA = t > 9.1 && t < 12.4 ? cl((t - 9.1) * 2.5, 0, 1) * cl((12.4 - t) * 3, 0, 1) * (0.78 + 0.22 * Math.sin((t - 9.1) * 5.5)) : 0;
  const sqB = t > 39.4 && t < 44.5 ? cl((t - 39.4) * 2.5, 0, 1) * cl((44.5 - t) * 3, 0, 1) * (0.88 + 0.12 * Math.sin((t - 39.4) * 5)) : 0;
  return [
    { x: a[0] + (gA ? 0 : ba[0]) , y: a[1] + (gA ? 0 : ba[1]), z: a[2] + (gA ? 0 : ba[2]), sq: sqA, s: 1.0, grab: gA },
    { x: b[0] + (gB ? 0 : bb[0]), y: b[1] + (gB ? 0 : bb[1]), z: b[2] + (gB ? 0 : bb[2]), sq: sqB, s: 1.05, grab: gB },
    { x: c[0] + bc[0], y: c[1] + bc[1], z: c[2] + bc[2], sq: 0, s: 0.85, grab: false },
  ];
}
// wind brush path (world xz + hover height)
const BR = [[13.7, [0.0, 1.25]], [14.6, [1.3, 0.95]], [15.4, [2.7, 0.55]], [16.0, [3.9, 0.95]], [16.4, [4.3, 1.7]], [16.8, [3.6, 2.15]], [17.3, [2.2, 2.05]], [17.7, [1.0, 2.2]]];
export function brushAt(t) {
  let i = 0; while (i < BR.length - 2 && t >= BR[i + 1][0]) i++;
  const a = BR[i], b = BR[i + 1]; const u = cl((t - a[0]) / (b[0] - a[0]), 0, 1);
  return [L(a[1][0], b[1][0], u), L(a[1][1], b[1][1], u)];
}
export const BRUSH_T = [13.7, 17.7];
export const SHAKE_T = [24.4, 27.4];
export const BOLTS = [27.8, 28.7, 29.6, 30.2, 31.1, 32.5, 33.3];
export const CLICKS = { wind: 13.4, season: 18.3, slider1: [20.8, 23.3], slider2: [34.7, 36.7], recover: 46.6 };
export function todAt(t) { return t < 30 ? L(0, 1, seg(t, CLICKS.slider1[0], CLICKS.slider1[1])) : L(1, 0.12, seg(t, CLICKS.slider2[0], CLICKS.slider2[1])); }
export function seasonAt(t) { return t < 40 ? seg(t, 18.4, 20.4) : 1 - seg(t, 47.2, 50.4); }
export function shakeAt(t) { if (t < SHAKE_T[0] || t > SHAKE_T[1]) return 0; const u = (t - SHAKE_T[0]) / (SHAKE_T[1] - SHAKE_T[0]); return Math.sin(Math.PI * u) ** 0.5; }
export function shakeOsc(t) { return Math.sin((t - SHAKE_T[0]) * Math.PI * 2 * 4.2) * shakeAt(t); }
export const SHAKE_PT = [4.15, 3.2, 3.53];

// cursor: [arrive time, target, moveDur]
export const CUR = [
  [5.6, { screen: [1500, 760] }, 0],
  [6.9, { cloud: 0 }, 1.2],
  [12.5, { cloud: 0 }, 0],
  [13.3, { el: 'p-wind' }, 0.8],
  [13.7, { brush: 1 }, 0.35],
  [17.7, { brush: 1 }, 0],
  [18.25, { el: 'p-season' }, 0.55],
  [20.75, { slider: 1 }, 0.6],
  [23.3, { slider: 1 }, 0],
  [24.3, { world: SHAKE_PT }, 0.9],
  [27.4, { shake: 1 }, 0],
  [28.2, { screen: [1750, 980] }, 0.8],
  [34.6, { slider: 1 }, 1.0],
  [36.7, { slider: 1 }, 0],
  [37.6, { cloud: 1 }, 0.85],
  [44.6, { cloud: 1 }, 0],
  [46.55, { el: 'p-recover' }, 1.2],
  [48.2, { screen: [1560, 760] }, 1.2],
];
export function cursorMode(t) {
  if (t < 5.6 || (t > 28.3 && t < 33.8) || t > 48.4) return 'hidden';
  if (t >= 6.95 && t < 12.5) return 'grab';
  if (t >= 13.65 && t < 17.75) return 'brush';
  if (t >= 20.75 && t < 23.3) return 'grab';
  if (t >= 24.3 && t < 27.4) return 'grab';
  if (t >= 34.6 && t < 36.7) return 'grab';
  if (t >= 37.6 && t < 44.6) return 'grab';
  if ((t > 5.6 && t < 6.95) || (t > 36.7 && t < 37.6) || (t > 23.3 && t < 24.3)) return 'open';
  return 'arrow';
}
export function cursorAlpha(t) { const fin = (a) => cl((t - a) / 0.3, 0, 1), fout = (b) => cl((b - t) / 0.3, 0, 1); if (t < 28.5) return fin(5.6) * (t > 28.0 ? fout(28.5) : 1); if (t < 48.5) return fin(33.8) * (t > 48.0 ? fout(48.5) : 1); return 0; }
export function curTargetAt(t) {
  let i = 0; while (i < CUR.length - 1 && t >= CUR[i + 1][0]) i++;
  if (i >= CUR.length - 1) return { a: CUR[CUR.length - 1][1], b: CUR[CUR.length - 1][1], k: 1 };
  const p = CUR[i], n = CUR[i + 1]; const start = Math.max(p[0], n[0] - n[2]);
  const k = t < start ? 0 : easeIO((t - start) / Math.max(1e-3, n[0] - start));
  return { a: p[1], b: n[1], k };
}
export const ANNOT = [
  { t0: 28.9, t1: 33.0, key: 'pyro', text: 'pyroclastic flow (locals call it wedhus gembel)' },
  { t0: 30.9, t1: 34.6, key: 'assembly', text: 'villagers evacuate to the assembly point' },
  { t0: 41.2, t1: 46.4, key: 'lahar', text: 'cold lahar (volcanic mudflow)' },
];
export function statusAt(E) { return E < 0.02 ? 0 : E < 0.22 ? 1 : E < 0.55 ? 2 : 3; }
