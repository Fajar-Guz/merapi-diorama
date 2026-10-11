import * as THREE from 'three';
import { rng, vnoise, smooth, clamp, lerp, polyAt, polyLen } from './noise.js';
import { BX, BZ, CEIL, CONE, PYRO, PYRO_L, RIVER, RIVER_L, MAPW, MAPH, hFast, bedAt } from './terrain.js';
import { ROAD, ROAD_L } from './props.js';

export const DT = 1 / 30;
const CRATER = { x: CONE[0], y: 3.42, z: CONE[1] };

export class Sim {
  constructor(maps, villagers) {
    this.maps = maps; this.v = villagers; this.r = rng(1234); this.t = 0;
    this.erupt = 0; this.ignited = false; this.shakeE = 0; this.heat = 0.12; this.pyroT = -1; this.evacT = -1; this.retT = -1; this.recoverT = -1;
    this.lahar = 0; this.front = 0; this.mud = 0; this.laharOn = false;
    this.smoke = []; this.embers = []; this.rain = []; this.ashf = []; this.streaks = [];
    this.bolts = []; this.flash = 0; this.nextBolt = 0;
    this.season = 0; this.tod = 0; this.box = new THREE.Vector3();
    this.windAvg = new THREE.Vector2();
    this.noiseCell = new Float32Array(MAPW * MAPH);
    for (let j = 0; j < MAPH; j++) for (let i = 0; i < MAPW; i++) this.noiseCell[j * MAPW + i] = vnoise(i * 0.09, j * 0.09) * 0.7 + vnoise(i * 0.31, j * 0.31) * 0.3;
    this.truck = { s: 0 };
    this.forceBolts = [];
  }
  cellXZ(i, j) { return [-BX + ((i + 0.5) / MAPW) * 2 * BX, -BZ + ((j + 0.5) / MAPH) * 2 * BZ]; }
  paint(ch, x, z, rad, amt, max = 1) {
    const A = this.maps.ash; const ci = ((x + BX) / (2 * BX)) * MAPW, cj = ((z + BZ) / (2 * BZ)) * MAPH; const rr = (rad / (2 * BX)) * MAPW;
    const i0 = Math.max(0, Math.floor(ci - rr * 2)), i1 = Math.min(MAPW - 1, Math.ceil(ci + rr * 2)), j0 = Math.max(0, Math.floor(cj - rr * 2)), j1 = Math.min(MAPH - 1, Math.ceil(cj + rr * 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (rr * rr); if (d2 > 4) continue; const k = (j * MAPW + i) * 4 + ch; A[k] = clamp(A[k] + amt * Math.exp(-d2), 0, max); }
  }
  windStamp(x, z, dx, dz, rad = 0.7) {
    const W = this.maps.wind, WW = this.maps.WW, WH = this.maps.WH; const ci = ((x + BX) / (2 * BX)) * WW, cj = ((z + BZ) / (2 * BZ)) * WH; const rr = (rad / (2 * BX)) * WW;
    for (let j = 0; j < WH; j++) for (let i = 0; i < WW; i++) { const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (rr * rr); if (d2 > 4) continue; const k = (j * WW + i) * 2; const f = Math.exp(-d2) * 0.5; W[k] = clamp(W[k] + dx * f, -2, 2); W[k + 1] = clamp(W[k + 1] + dz * f, -2, 2); }
    const r = this.r; for (let n = 0; n < 3; n++) this.streaks.push({ x: x + (r() - 0.5) * rad, y: hFast(x, z) + 0.15 + r() * 0.5, z: z + (r() - 0.5) * rad, vx: dx * 1.6, vz: dz * 1.6, age: 0, life: 0.7 + r() * 0.5 });
  }
  windAt(x, z) { const WW = this.maps.WW, WH = this.maps.WH; const i = clamp(Math.floor(((x + BX) / (2 * BX)) * WW), 0, WW - 1), j = clamp(Math.floor(((z + BZ) / (2 * BZ)) * WH), 0, WH - 1); const k = (j * WW + i) * 2; return [this.maps.wind[k], this.maps.wind[k + 1]]; }

  // inp: { clouds:[{x,y,z,sq}], wind:[[x,z,dx,dz]], shake, tod, season, recover(bool trigger), bolts(bool force) }
  step(inp) {
    const dt = DT, r = this.r; this.t += dt; const t = this.t;
    this.tod = inp.tod; this.season = inp.season;
    const A = this.maps.ash, Wm = this.maps.wind;
    // wind map decay
    for (let i = 0; i < Wm.length; i++) Wm[i] *= Math.exp(-dt * 0.9);
    for (const w of inp.wind || []) this.windStamp(w[0], w[1], w[2], w[3]);
    let wx = 0, wz = 0; for (let i = 0; i < Wm.length; i += 2) { wx += Wm[i]; wz += Wm[i + 1]; } const nW = Wm.length / 2;
    this.windAvg.set(0.12 + (wx / nW) * 6, 0.03 + (wz / nW) * 6);
    const [cwx, cwz] = this.windAt(CRATER.x + 0.6, CRATER.z + 0.6);
    // ---- eruption ----
    const sh = inp.shake || 0; this.shakeE = lerp(this.shakeE, sh, 0.25);
    if (inp.recover && this.recoverT < 0) { this.recoverT = t; this.retT = t; }
    const recovering = this.recoverT >= 0;
    if (!recovering) {
      this.erupt = clamp(this.erupt + sh * dt * 0.22, 0, 1);
      if (this.erupt > 0.22) this.ignited = true;
      if (this.ignited && !inp.calm) this.erupt = clamp(this.erupt + dt * 0.2 * (sh > 0.1 ? 1 : 0.6), 0, 1);
      if (inp.calm) this.erupt = clamp(this.erupt - dt * 0.09, 0, 1);
    } else { this.erupt = clamp(this.erupt - dt * 0.5, 0, 1); }
    const E = this.erupt;
    this.heat = lerp(this.heat, 0.14 + 0.86 * smooth(0.05, 0.6, E) + sh * 0.25, 0.08);
    if (this.ignited && this.evacT < 0 && !recovering) this.evacT = t;
    if (E > 0.55 && this.pyroT < 0 && !recovering) this.pyroT = t;
    // smoke spawning
    const spawn = (o) => { if (this.smoke.length > 1300) this.smoke.shift(); this.smoke.push(o); };
    // quiet fumarole
    const fum = recovering ? 2 : 3 + E * 4;
    if (r() < fum * dt) spawn({ k: 0, x: CRATER.x + (r() - 0.5) * 0.25, y: CRATER.y + 0.1, z: CRATER.z + (r() - 0.5) * 0.25, vx: 0, vy: 0.32 + r() * 0.15, vz: 0, s0: 0.16 + r() * 0.1, age: 0, life: 6 + r() * 2, rot: r() * 6.28, vr: (r() - 0.5) * 0.3, v: Math.floor(r() * 4) });
    const pr = 95 * smooth(0.12, 0.55, E) * (recovering ? 0 : 1);
    let nsp = pr * dt; while (nsp > 0) { if (r() < nsp) { const a = r() * 6.28, rd = r() * 0.14;
      spawn({ k: 1, br: r(), x: CRATER.x + Math.cos(a) * rd, y: CRATER.y + 0.05, z: CRATER.z + Math.sin(a) * rd, vx: Math.cos(a) * 0.12, vy: (2.2 + r() * 1.4) * (0.6 + 0.4 * E), vz: Math.sin(a) * 0.12, s0: 0.42 + r() * 0.32, age: 0, life: 9 + r() * 4, rot: r() * 6.28, vr: (r() - 0.5) * 0.4, v: Math.floor(r() * 4) }); } nsp -= 1; }
    // pyroclastic flow
    if (this.pyroT >= 0 && t - this.pyroT < 5.0 && !recovering) {
      let n = 26 * dt; while (n > 0) { if (r() < n) spawn({ k: 2, s: 0.02 + r() * 0.03, off: (r() - 0.5) * 0.22, x: 0, y: 0, z: 0, s0: 0.3 + r() * 0.16, age: 0, life: 99, rot: r() * 6.28, vr: (r() - 0.5) * 0.8, v: Math.floor(r() * 4), rise: 0, sp: 0.85 + r() * 0.35 }); n -= 1; }
    }
    const L = PYRO_L[PYRO_L.length - 1];
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i]; p.age += dt; p.rot += p.vr * dt;
      if (p.k === 2) {
        const v = (2.3 * Math.pow(Math.max(0.02, 1 - p.s), 0.6) + 0.15) * p.sp; p.s += (v * dt) / L;
        if (p.s > 0.97) { p.rise += dt; }
        const q = polyAt(PYRO, PYRO_L, Math.min(p.s, 0.99)); const nx = -q.tz, nz = q.tx;
        const sz = p.s0 * (1 + p.s * 2.4) * (1 + p.rise * 0.15);
        p.x = q.x + nx * p.off * (1 + p.s * 2); p.z = q.z + nz * p.off * (1 + p.s * 2);
        p.x = clamp(p.x, -BX + sz * 0.35, BX - sz * 0.35);
        p.y = hFast(p.x, p.z) + sz * 0.3 + p.rise * 0.12 + Math.sin(p.age * 3 + p.rot) * 0.02;
        p.size = sz; p.alpha = Math.min(1, p.age * 3) * (p.rise > 0 ? Math.max(0, 1 - p.rise / 2.5) : 1) * 0.8;
        if (r() < 0.3) this.paint(1, p.x, p.z, 0.25 + p.s * 0.2, 0.06);
        if (p.rise > 2.5) this.smoke.splice(i, 1);
        continue;
      }
      const f = p.age / p.life; if (f >= 1) { this.smoke.splice(i, 1); continue; }
      const drift = p.k === 0 ? 1.0 : 0.45 * (0.3 + p.y / CEIL);
      p.vx += ((this.windAvg.x + cwx * 1.5) * drift - p.vx * 0.5) * dt; p.vz += ((this.windAvg.y + cwz * 1.5) * drift - p.vz * 0.5) * dt;
      if (p.k === 1) { p.vy = Math.max(0.12, p.vy * Math.exp(-dt * 0.42)); }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const g = p.k === 1 ? 3.4 : 2.6; p.size = p.s0 * (1 + g * Math.sqrt(f) + (p.k === 1 ? 0.6 * f : 0));
      const ceil = CEIL - 0.12 - p.size * 0.28;
      if (p.y > ceil) { p.y = ceil; p.vy = 0; const dx = p.x - CRATER.x, dz = p.z - CRATER.z, d = Math.hypot(dx, dz) + 0.1; p.vx += (dx / d) * dt * 0.7; p.vz += (dz / d) * dt * 0.7; }
      const mx = BX - p.size * 0.3, mz = BZ - p.size * 0.3; if (Math.abs(p.x) > mx) { p.x = Math.sign(p.x) * mx; p.vx *= -0.2; } if (Math.abs(p.z) > mz) { p.z = Math.sign(p.z) * mz; p.vz *= -0.2; }
      const fin = Math.min(1, p.age / 0.4), fout = 1 - smooth(0.7, 1.0, f);
      p.alpha = fin * fout * (p.k === 0 ? 0.38 : 0.8) * (recovering && p.k === 1 ? Math.max(0, 1 - (t - this.recoverT) / 3) : 1);
    }
    // ---- embers / incandescent avalanche ----
    const er = (this.heat > 0.35 && !recovering ? 10 + 40 * E : 0);
    if (r() < er * dt * 2) this.embers.push({ s: 0.0, off: (r() - 0.5) * 0.12, v: 0.5 + r() * 0.6, age: 0, b: r() });
    for (let i = this.embers.length - 1; i >= 0; i--) { const e = this.embers[i]; e.age += dt; e.s += (e.v * dt) / L; if (e.s > 0.35 + e.b * 0.2) this.embers.splice(i, 1); }
    if (this.embers.length > 400) this.embers.splice(0, this.embers.length - 400);
    // ---- lightning ----
    this.flash *= Math.exp(-dt * 9);
    const plumeN = this.smoke.reduce((a, p) => a + (p.k === 1 ? 1 : 0), 0); this.plumeN = plumeN;
    let strike = inp.bolt || (inp.autoBolt && plumeN > 160 && E > 0.5 && t > this.nextBolt && !recovering);
    if (strike) {
      this.nextBolt = t + 0.7 + r() * 1.3;
      const hi = this.smoke.filter((p) => p.k === 1 && p.y > 4.3); const a = hi.length ? hi[Math.floor(r() * hi.length)] : { x: CRATER.x, y: 5.4, z: CRATER.z };
      const b = r() < 0.55 ? { x: CRATER.x + (r() - 0.5) * 0.5, y: CRATER.y + 0.25, z: CRATER.z + (r() - 0.5) * 0.5 } : { x: a.x + (r() - 0.5) * 2.2, y: a.y - 0.6 - r() * 0.9, z: a.z + (r() - 0.5) * 1.5 };
      this.bolts.push({ a: { x: a.x, y: a.y, z: a.z }, b, seed: Math.floor(r() * 1e6), age: 0 }); this.flash = 1;
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) { this.bolts[i].age += dt; if (this.bolts[i].age > 0.32) this.bolts.splice(i, 1); }
    // ---- ash fall + accumulation ----
    let hiN = 0; for (const p of this.smoke) if (p.k === 1 && p.y > 4.6) hiN++;
    const dens = Math.min(1, hiN / 250) * (recovering ? 0 : 1); this.ashDens = dens;
    let na = 260 * dens * dt; while (na > 0) { if (r() < na) this.ashf.push({ x: (r() * 2 - 1) * (BX - 0.1), y: CEIL - 0.5 - r() * 0.6, z: (r() * 2 - 1) * (BZ - 0.1), vy: -(0.45 + r() * 0.35) }); na -= 1; }
    for (let i = this.ashf.length - 1; i >= 0; i--) { const a = this.ashf[i]; a.y += a.vy * dt; a.x += (this.windAvg.x * 0.4 + Math.sin(t * 2 + i) * 0.05) * dt; a.z += this.windAvg.y * 0.4 * dt; if (a.y < hFast(a.x, a.z) || Math.abs(a.x) > BX) this.ashf.splice(i, 1); }
    if (this.ashf.length > 2600) this.ashf.splice(0, this.ashf.length - 2600);
    if (dens > 0.01) {
      for (let j = 0; j < MAPH; j++) for (let i = 0; i < MAPW; i++) {
        const [x, z] = this.cellXZ(i, j); const dc = Math.hypot(x - CRATER.x, z - CRATER.z);
        const dw = (x - CRATER.x) * this.windAvg.x + (z - CRATER.z) * this.windAvg.y;
        const w = 0.55 + 0.9 * Math.exp(-(dc * dc) / 6) + clamp(dw * 0.8, -0.3, 0.6);
        const k = (j * MAPW + i) * 4; A[k] = clamp(A[k] + dt * 0.075 * dens * w * (0.5 + 0.9 * this.noiseCell[j * MAPW + i]), 0, 0.9);
      }
    }
    // ---- rain ----
    this.rainOn = 0;
    for (const c of inp.clouds) {
      if (c.sq < 0.04) continue; this.rainOn = Math.max(this.rainOn, c.sq);
      let n = 520 * c.sq * dt; while (n > 0) { if (r() < n) { const a = r() * 6.28, rd = Math.sqrt(r()) * 0.42 * (c.s || 1); this.rain.push({ x: c.x + Math.cos(a) * rd * 1.4, y: c.y - 0.2 - r() * 0.15, z: c.z + Math.sin(a) * rd, vy: -(4.5 + r() * 1.5) }); } n -= 1; }
      const gx = c.x, gz = c.z; const k = c.sq * dt;
      // wash: remove ash under cloud, add wetness
      const ci = ((gx + BX) / (2 * BX)) * MAPW, cj = ((gz + BZ) / (2 * BZ)) * MAPH, rr = (0.75 / (2 * BX)) * MAPW;
      let load = 0;
      for (let j = Math.max(0, Math.floor(cj - rr * 2)); j <= Math.min(MAPH - 1, Math.ceil(cj + rr * 2)); j++) for (let i = Math.max(0, Math.floor(ci - rr * 2)); i <= Math.min(MAPW - 1, Math.ceil(ci + rr * 2)); i++) {
        const d2 = ((i - ci) ** 2 + ((j - cj) * 1.2) ** 2) / (rr * rr); if (d2 > 4) continue; const f = Math.exp(-d2); const q = (j * MAPW + i) * 4;
        load += A[q] + A[q + 1]; A[q] = clamp(A[q] - k * 0.75 * f, 0, 1); A[q + 1] = clamp(A[q + 1] - k * 0.2 * f, 0, 1); A[q + 2] = clamp(A[q + 2] + k * 1.6 * f, 0, 1);
      }
      const dh = Math.hypot(gx - RIVER[0][0], gz - RIVER[0][1]);
      if (!this.laharOn && c.sq > 0.4 && dh < 2.3 && load > 25 && !recovering) { this.laharOn = true; this.laharT = t; }
    }
    for (let i = this.rain.length - 1; i >= 0; i--) { const d = this.rain[i]; d.y += d.vy * dt; d.x += this.windAvg.x * 0.25 * dt; if (d.y < hFast(d.x, d.z)) this.rain.splice(i, 1); }
    if (this.rain.length > 2500) this.rain.splice(0, this.rain.length - 2500);
    // ---- lahar ----
    if (this.laharOn && !recovering) {
      this.lahar = Math.min(1, this.lahar + dt * 2);
      this.front = Math.min(1.02, this.front + dt * (0.17 + 0.08 * (1 - this.front)));
      if (r() < 0.6) { const q = polyAt(RIVER, RIVER_L, Math.min(1, this.front * r())); this.paint(1, q.x, q.z, 0.18, 0.05, 0.75); }
      if (this.front > 0.7) this.mud = Math.min(1, this.mud + dt * 0.42);
    }
    // ---- recovery ----
    if (recovering) {
      const rt = t - this.recoverT;
      for (let j = 0; j < MAPH; j++) for (let i = 0; i < MAPW; i++) {
        const q = (j * MAPW + i) * 4; const nz = this.noiseCell[j * MAPW + i]; const rate = dt * (0.12 + 0.5 * smooth(nz * 3.5, nz * 3.5 + 1.2, rt));
        A[q] = Math.max(0, A[q] - rate); A[q + 1] = Math.max(0, A[q + 1] - rate * 0.8);
      }
      if (rt > 1.5) { this.lahar = Math.max(0, this.lahar - dt * 0.2); this.mud = Math.max(0, this.mud - dt * 0.13); }
      if (this.lahar <= 0) { this.laharOn = false; this.front = 0; }
    }
    for (let q = 2; q < A.length; q += 4) A[q] = Math.max(0, A[q] - dt * 0.03);
    // ---- streaks ----
    for (let i = this.streaks.length - 1; i >= 0; i--) { const s = this.streaks[i]; s.age += dt; s.x += s.vx * dt; s.z += s.vz * dt; if (s.age > s.life) this.streaks.splice(i, 1); }
    // villagers
    this.updateVillagers();
  }
  updateVillagers() {
    const t = this.t; const V = this.v; const out = []; const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    for (let i = 0; i < V.N; i++) {
      const p = V.paths[i]; const Lt = p.L[p.L.length - 1];
      let s = 0, walking = false;
      if (this.evacT >= 0) { s = clamp((t - this.evacT - p.delay) * p.speed, 0, Lt); walking = s > 0 && s < Lt; }
      if (this.retT >= 0) { const back = clamp((t - this.retT - p.delay * 0.5 - 0.8) * p.speed * 0.8, 0, Lt); const s0 = clamp((this.retT - this.evacT - p.delay) * p.speed, 0, Lt); s = Math.max(0, s0 - back); walking = back > 0 && s > 0; }
      const at = polyAt(p.P, p.L, s / Lt);
      const ang = Math.atan2(at.tx, at.tz) + (this.retT >= 0 && walking ? Math.PI : 0);
      const bob = walking ? Math.abs(Math.sin((t + p.phase) * 9)) * 0.008 : 0;
      const idle = walking ? 0 : Math.sin(t * 0.8 + p.phase) * 0.3;
      out.push({ x: at.x, y: hFast(at.x, at.z) + bob, z: at.z, a: ang + idle, hat: p.hat, walking });
    }
    this.vpos = out;
    // truck
    if (this.evacT >= 0) { const s = clamp((t - this.evacT - 1.0) * 0.22, 0, 1) * 0.86; this.truck.s = this.retT >= 0 ? Math.max(0.0, this.truck.s - DT * 0.08) : s; }
  }
}
