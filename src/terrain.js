import * as THREE from 'three';
import { fbm, vnoise, smooth, lerp, clamp, polyLen, polyAt, polyDist, smoothPoly } from './noise.js';
import { NOISE, MAPUV } from './glsl.js';

export const BX = 5, BZ = 3.5, BASE = -2.0, CEIL = 6.0, WL = 0.02;
export const CONE = [-1.4, -1.3];
export const RIVER = smoothPoly([[-0.62, 0.3], [-0.2, 0.72], [0.3, 1.02], [0.42, 1.5], [0.25, 1.95], [0.55, 2.4], [0.95, 2.9]], 10);
export const RIVER_L = polyLen(RIVER);
export const PYRO = smoothPoly([[-1.45, -1.12], [-1.95, -0.62], [-2.7, -0.05], [-3.5, 0.45], [-4.3, 0.78], [-4.85, 0.92]], 10);
export const PYRO_L = polyLen(PYRO);
export const LAKE = { x: 1.05, z: 3.2, rx: 1.25, rz: 0.78 };
export const VILLAGE = { x0: 1.55, x1: 4.65, z0: -0.4, z1: 2.55, h: 0.34 };
export const ASSEMBLY = { x: 4.05, z: 2.85 };
const BREACH = (() => { const dx = -0.6, dz = 0.6, l = Math.hypot(dx, dz); return [dx / l, dz / l]; })();

const rect = (x, z, x0, x1, z0, z1, f) => smooth(x0 - f, x0 + f, x) * (1 - smooth(x1 - f, x1 + f, x)) * smooth(z0 - f, z0 + f, z) * (1 - smooth(z1 - f, z1 + f, z));

function natural(x, z) {
  const dx = x - CONE[0], dz = z - CONE[1]; const r = Math.hypot(dx, dz); const th = Math.atan2(dz, dx);
  let cone = 4.4 * Math.pow(Math.max(0, 1 - r / 4.7), 1.9);
  cone = Math.min(cone, 3.62 + 0.04 * vnoise(Math.cos(th) * 5, Math.sin(th) * 5));
  let h = cone + 0.55 * Math.exp(-(r * r) / 16);
  const rid = vnoise(Math.cos(th) * 6 + r * 0.45 + 3, Math.sin(th) * 6 + 7) * 0.5 + vnoise(Math.cos(th) * 13 + r * 0.9, Math.sin(th) * 13) * 0.32 + vnoise(Math.cos(th) * 27 + r * 2, Math.sin(th) * 27 - r) * 0.18;
  h += (rid - 0.5) * 0.62 * smooth(0.5, 1.15, r) * smooth(4.6, 2.0, r);
  h += 0.16 + 0.16 * (fbm(x * 0.45 + 3, z * 0.45 - 2) - 0.5) + 0.04 * (fbm(x * 2.2, z * 2.2) - 0.5);
  // back gentle rise (other ridge behind)
  h += 0.35 * smooth(-1.6, -3.5, z) * (0.6 + 0.4 * fbm(x * 0.6, 1.3));
  // crater
  if (r < 0.62) {
    const br = (dx * BREACH[0] + dz * BREACH[1]) / Math.max(r, 1e-4);
    h -= 0.42 * (1 - (r / 0.62) ** 2);
    h -= 0.22 * smooth(0.25, 1.0, br) * smooth(0.2, 0.62, r) * (1 - smooth(0.5, 0.62, r));
  }
  return h;
}
// monotonic river bed table
const BED = (() => {
  const N = 240; const t = new Float32Array(N + 1); let m = 1e9;
  for (let i = 0; i <= N; i++) { const p = polyAt(RIVER, RIVER_L, i / N); const h = natural(p.x, p.z) - 0.1; m = Math.min(m, h); t[i] = m; }
  for (let i = 0; i <= N; i++) { const u = i / N; t[i] = lerp(t[i], WL - 0.08, smooth(0.6, 1.0, u)); t[i] = Math.min(t[i], i ? t[i - 1] : 9); }
  return t;
})();
export function bedAt(u) { const f = clamp(u, 0, 1) * (BED.length - 1); const i = Math.floor(f), k = f - i; return lerp(BED[i], BED[Math.min(BED.length - 1, i + 1)], k); }
export const riverW = (u) => 0.12 + 0.12 * u;

export function terrainInfo(x, z) {
  let h = natural(x, z);
  // pyro gully
  const pg = polyDist(PYRO, PYRO_L, x, z);
  h -= 0.24 * Math.exp(-((pg.d / 0.33) ** 2)) * (1 - 0.45 * pg.u) * smooth(0.0, 0.08, pg.u);
  // village flatten
  const vm = rect(x, z, VILLAGE.x0, VILLAGE.x1, VILLAGE.z0, VILLAGE.z1, 0.35);
  h = lerp(h, VILLAGE.h + 0.03 * (fbm(x * 1.3, z * 1.3) - 0.5), vm);
  // terraces
  const tm = Math.max(rect(x, z, 0.9, 4.75, -3.35, -0.75, 0.22), rect(x, z, -4.75, -0.85, 1.35, 3.38, 0.22) * 0.999) * (1 - vm);
  const pyroFree = smooth(0.35, 0.65, pg.d);
  const s = 0.062; const q = Math.floor(h / s), f = h / s - q;
  const hq = (q + smooth(0.8, 1.0, f)) * s;
  const tmm = tm * pyroFree;
  h = lerp(h, hq, tmm);
  // river channel
  const rv = polyDist(RIVER, RIVER_L, x, z);
  const w = riverW(rv.u); const bed = bedAt(rv.u);
  const ch = bed + 0.36 * Math.min(1, (rv.d / (w * 2.3)) ** 2) * 1.0 + (rv.d > w * 2.3 ? 1 : 0);
  const rivMask = 1 - smooth(w * 0.9, w * 1.7, rv.d);
  if (rv.u > 0.001 || rv.d < 0.4) h = Math.min(h, rv.d < w * 2.3 ? ch : 99);
  // lake
  const lx = (x - LAKE.x) / LAKE.rx, lz = (z - LAKE.z) / LAKE.rz; const lr = Math.hypot(lx, lz);
  const lakeBed = -0.36 + 0.5 * lr * lr;
  h = Math.min(h, lr < 1.25 ? lakeBed : 99);
  return { h, tm: tmm, vm, rv: rivMask, ru: rv.u, rd: rv.d, pg: pg.d, pu: pg.u, lr };
}
export const heightAt = (x, z) => terrainInfo(x, z).h;

// ------- fast grid lookup -------
const GX = 200, GZ = 140; const HG = new Float32Array((GX + 1) * (GZ + 1));
for (let j = 0; j <= GZ; j++) for (let i = 0; i <= GX; i++) HG[j * (GX + 1) + i] = heightAt(-BX + (i / GX) * 2 * BX, -BZ + (j / GZ) * 2 * BZ);
export function hFast(x, z) {
  const fx = clamp((x + BX) / (2 * BX), 0, 1) * GX, fz = clamp((z + BZ) / (2 * BZ), 0, 1) * GZ;
  const i = Math.min(GX - 1, Math.floor(fx)), j = Math.min(GZ - 1, Math.floor(fz)), a = fx - i, b = fz - j;
  const r = GX + 1; return lerp(lerp(HG[j * r + i], HG[j * r + i + 1], a), lerp(HG[(j + 1) * r + i], HG[(j + 1) * r + i + 1], a), b);
}

// ------- shared dynamic maps -------
export const MAPW = 160, MAPH = 112;
export function makeMaps() {
  const ash = new Float32Array(MAPW * MAPH * 4);
  const data = new Uint8Array(MAPW * MAPH * 4);
  const tex = new THREE.DataTexture(data, MAPW, MAPH, THREE.RGBAFormat); tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const WW = 40, WH = 28; const wind = new Float32Array(WW * WH * 2); const wdata = new Uint8Array(WW * WH * 4).fill(128);
  const wtex = new THREE.DataTexture(wdata, WW, WH, THREE.RGBAFormat); wtex.magFilter = THREE.LinearFilter; wtex.minFilter = THREE.LinearFilter; wtex.needsUpdate = true;
  const upload = () => {
    for (let i = 0; i < MAPW * MAPH * 4; i++) data[i] = clamp(ash[i], 0, 1) * 255;
    tex.needsUpdate = true;
    for (let i = 0; i < WW * WH; i++) { wdata[i * 4] = clamp(128 + wind[i * 2] * 60, 0, 255); wdata[i * 4 + 1] = clamp(128 + wind[i * 2 + 1] * 60, 0, 255); }
    wtex.needsUpdate = true;
  };
  return { ash, tex, wind, wtex, WW, WH, upload };
}
export const mapUniforms = { uAshMap: { value: null }, uWindMap: { value: null }, uTime: { value: 0 }, uSeason: { value: 0 }, uNight: { value: 0 }, uBreeze: { value: new THREE.Vector2(0.15, 0.05) }, uHeat: { value: 0 } };

// ------- terrain mesh -------
const C = (h) => new THREE.Color(h);
const COL = {
  grass: [C('#3e6a25'), C('#86803f')], forest: [C('#2a4b1c'), C('#4f5228')], rice: [C('#6a9a32'), C('#c79c40')], bund: [C('#4f5b28'), C('#735f35')],
  rock: [C('#5d5853'), C('#655e57')], rockDark: [C('#3b3735'), C('#423c38')], village: [C('#8b7c5f'), C('#9b8a66')], sand: [C('#7c766d'), C('#888076')],
  sulfur: [C('#b5a36a'), C('#b8a46c')], lakebed: [C('#7a8a6c'), C('#8a8a70')], gully: [C('#77706a'), C('#857c72')],
};
export function buildTerrain() {
  const NX = 330, NZ = 231;
  const g = new THREE.PlaneGeometry(2 * BX, 2 * BZ, NX, NZ); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position; const n = pos.count;
  const cR = new Float32Array(n * 3), cD = new Float32Array(n * 3), aT = new Float32Array(n);
  const info = [];
  for (let i = 0; i < n; i++) { const x = pos.getX(i), z = pos.getZ(i); const t = terrainInfo(x, z); pos.setY(i, t.h); info.push(t); }
  g.computeVertexNormals(); const nor = g.attributes.normal;
  const tmp = [new THREE.Color(), new THREE.Color()];
  for (let i = 0; i < n; i++) {
    const t = info[i], x = pos.getX(i), z = pos.getZ(i), h = t.h; const ny = nor.getY(i);
    const r = Math.hypot(x - CONE[0], z - CONE[1]);
    const nz = fbm(x * 3.1, z * 3.1), nz2 = vnoise(x * 11, z * 11);
    for (let s = 0; s < 2; s++) {
      const c = tmp[s];
      c.copy(COL.grass[s]).lerp(COL.forest[s], smooth(0.9, 1.5, h) * 0.9);
      c.lerp(COL.grass[s], 0.25 * nz);
      const rockM = Math.max(smooth(2.0, 2.6, h + (nz - 0.5) * 0.6), smooth(0.8, 0.55, ny) * smooth(1.2, 2.0, h));
      c.lerp(COL.rock[s], rockM);
      if (rockM > 0.01) { const th = Math.atan2(z - CONE[1], x - CONE[0]); c.multiplyScalar(1 - rockM * 0.25 + rockM * 0.45 * vnoise(Math.cos(th) * 30 + r * 3, Math.sin(th) * 30)); }
      c.lerp(COL.rockDark[s], smooth(3.1, 3.45, h) * 0.8 + smooth(0.75, 0.5, ny) * rockM * 0.4);
      if (r < 0.7) c.lerp(COL.sulfur[s], (1 - smooth(0.2, 0.62, r)) * 0.35 * nz2);
      const gully = Math.exp(-((t.pg / 0.18) ** 2)) * smooth(0.02, 0.1, t.pu);
      c.lerp(COL.gully[s], gully * 0.85);
      // terraces: flat = rice, steep = bund
      if (t.tm > 0.01) { const flat = smooth(0.94, 0.985, ny); const rc = COL.rice[s].clone().lerp(COL.grass[s], 0.18 * nz2); const bc = COL.bund[s]; const tc = bc.clone().lerp(rc, flat); c.lerp(tc, t.tm); }
      c.lerp(COL.village[s], t.vm * (0.55 + 0.25 * nz));
      c.lerp(COL.sand[s], t.rv * 0.9);
      if (h < WL + 0.04) c.lerp(COL.lakebed[s], smooth(WL + 0.04, WL - 0.05, h));
      c.multiplyScalar(0.92 + 0.16 * nz2);
      const arr = s ? cD : cR; arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    aT[i] = t.tm * smooth(0.95, 0.99, ny);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cR, 3));
  g.setAttribute('aDry', new THREE.BufferAttribute(cD, 3));
  g.setAttribute('aTer', new THREE.BufferAttribute(aT, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mapUniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 aDry; attribute float aTer; varying vec3 vDry; varying float vTer; varying vec3 vLoc;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vDry = aDry; vTer = aTer; vLoc = position;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uAshMap; uniform float uSeason; uniform float uTime; varying vec3 vDry; varying float vTer; varying vec3 vLoc;
      ${NOISE} ${MAPUV}`)
      .replace('#include <color_fragment>', `
      vec3 base = mix(vColor.rgb, vDry, uSeason);
      vec4 am = texture2D(uAshMap, mapUV(vLoc.xz));
      float gn = fbm2(vLoc.xz*9.0);
      float gn2 = vn2(vLoc.xz*45.0);
      base *= 0.9 + 0.2*gn2;
      float ash = smoothstep(0.15, 0.95, am.r + (gn-0.5)*0.6) * 0.85;
      vec3 ashC = vec3(0.3,0.29,0.275) * (0.82+0.36*gn2);
      float dep = smoothstep(0.1, 0.6, am.g + (gn-0.5)*0.3);
      vec3 depC = vec3(0.42,0.39,0.36) * (0.85+0.3*gn2);
      vec3 col = mix(base, ashC, ash*0.92);
      col = mix(col, depC, dep);
      col *= 1.0 - 0.38*am.b;
      diffuseColor.rgb = col;
      float paddy = vTer * (1.0-uSeason) * (1.0-ash) * (1.0-dep);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.28, max(paddy*0.9, am.b*0.55));`);
  };
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}

// ------- cutaway side walls -------
export function buildSides() {
  const verts = [], tops = [], along = [], idx = [];
  const ROWS = 36;
  const edge = (pts, nrm) => {
    const base = verts.length / 3; const cols = pts.length; const TT = pts.map(([x, z]) => Math.max(heightAt(x, z), BASE + 0.05));
    for (let r = 0; r <= ROWS; r++) for (let c = 0; c < cols; c++) {
      const [x, z, s] = pts[c]; const top = TT[c]; const k = r / ROWS; const y = lerp(top, BASE, k);
      verts.push(x, y, z); tops.push(top); along.push(s);
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols - 1; c++) {
      const a = base + r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      if (nrm) idx.push(a, d, b, b, d, e); else idx.push(a, b, d, b, e, d);
    }
  };
  const N = 300;
  const front = [], back = [], left = [], right = [];
  for (let i = 0; i <= N; i++) { const x = -BX + (2 * BX * i) / N; front.push([x, BZ, x]); back.push([x, -BZ, x + 20]); }
  for (let i = 0; i <= 210; i++) { const z = -BZ + (2 * BZ * i) / 210; left.push([-BX, z, z + 40]); right.push([BX, z, z + 60]); }
  edge(front, true); edge(back, false); edge(left, false); edge(right, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aTop; attribute float aAlong; varying float vTop; varying float vAlong; varying float vY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vTop = aTop; vAlong = aAlong; vY = position.y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vTop; varying float vAlong; varying float vY; ${NOISE}`)
      .replace('#include <color_fragment>', `
      vec2 p = vec2(vAlong, vY);
      float w = (fbm2(vec2(vAlong*0.35, 0.0))-0.5)*0.35 + (vn2(vec2(vAlong*1.7, 3.0))-0.5)*0.08;
      float yy = vY + w; float d = vTop - vY;
      float g1 = vn2(p*vec2(30.0,60.0)); float g2 = fbm2(p*vec2(6.0,10.0));
      vec3 col = vec3(0.42,0.32,0.23);
      // layers bottom->top
      vec3 bed = vec3(0.17,0.16,0.155) * (0.8+0.4*g2);
      vec3 lava = vec3(0.24,0.23,0.22);
      vec3 ashb = vec3(0.66,0.63,0.58);
      vec3 tuff = vec3(0.45,0.36,0.27);
      vec3 soil = vec3(0.30,0.22,0.15);
      col = bed;
      vec2 wr = worley(p*vec2(9.0,11.0));
      float peb = smoothstep(0.0,0.18,wr.y-wr.x);
      vec3 lavaP = mix(vec3(0.10,0.095,0.09), lava*(0.75+0.6*h21(floor(p*vec2(9.0,11.0)))), peb);
      col = mix(col, lavaP, step(-1.42, yy));
      col = mix(col, ashb*(0.85+0.2*g1), step(-1.02, yy));
      col = mix(col, tuff*(0.8+0.35*g2), step(-0.9, yy));
      col = mix(col, ashb*(0.9+0.15*g1), step(-0.5, yy));
      col = mix(col, soil*(0.8+0.4*g2), step(-0.44, yy));
      col = mix(col, ashb*0.9, step(-0.12, yy) * step(0.3, vTop+w));
      col = mix(col, tuff*(0.85+0.3*g1), step(-0.08, yy));
      // topsoil follows surface
      col = mix(col, vec3(0.22,0.16,0.11)*(0.8+0.4*g1), 1.0-smoothstep(0.1,0.16,d));
      col = mix(col, vec3(0.18,0.24,0.1), 1.0-smoothstep(0.0,0.035,d));
      // speckles + darken toward bottom
      col *= 0.82 + 0.3*g1;
      col *= mix(0.55, 1.0, smoothstep(-2.0, -1.2, vY));
      diffuseColor.rgb = col;`);
  };
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true;
  // base slab under
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2 * BX, 0.02, 2 * BZ), new THREE.MeshStandardMaterial({ color: '#141210' })); slab.position.y = BASE + 0.01;
  mesh.add(slab);
  return mesh;
}

// ------- lake + front water section -------
export function buildWater(env) {
  const U = { uTime: mapUniforms.uTime, uEnv: { value: env }, uMud: { value: 0 }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uNight: mapUniforms.uNight, uAmb: { value: 1 } };
  // height texture for depth
  const HW = 128, HH = 90; const hd = new Uint8Array(HW * HH * 4);
  for (let j = 0; j < HH; j++) for (let i = 0; i < HW; i++) { const x = -BX + (i + 0.5) / HW * 2 * BX, z = -BZ + (j + 0.5) / HH * 2 * BZ; const d = clamp((WL - heightAt(x, z)) / 0.4, 0, 1); hd[(j * HW + i) * 4] = d * 255; hd[(j * HW + i) * 4 + 3] = 255; }
  const ht = new THREE.DataTexture(hd, HW, HH); ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
  U.uDepth = { value: ht };
  const g = new THREE.PlaneGeometry(2.9, 1.8, 1, 1); g.rotateX(-Math.PI / 2); g.translate(LAKE.x, WL, LAKE.z - 0.38);
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vW; varying vec3 vL; void main(){ vL = position; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform samplerCube uEnv; uniform sampler2D uDepth; uniform float uMud; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uNight; uniform float uAmb;
      varying vec3 vW; varying vec3 vL; ${NOISE} ${MAPUV}
      void main(){
        if (vL.z > ${BZ.toFixed(2)} || abs(vL.x) > ${BX.toFixed(2)}) discard;
        float dep = texture2D(uDepth, mapUV(vL.xz)).r;
        if (dep < 0.002) discard;
        vec2 q = vL.xz*14.0; float t = uTime;
        float n1 = vn2(q + vec2(t*0.6, t*0.3)); float n2 = vn2(q*1.9 - vec2(t*0.4, -t*0.5));
        vec3 N = normalize(vec3((n1-0.5)*0.22 + (n2-0.5)*0.12, 1.0, (vn2(q.yx+t*0.5)-0.5)*0.22));
        vec3 V = normalize(cameraPosition - vW);
        float fr = 0.03 + 0.97*pow(1.0-max(dot(N,V),0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 env = textureCube(uEnv, R).rgb;
        vec3 deep = vec3(0.04,0.28,0.30), shallow = vec3(0.32,0.62,0.55);
        vec3 mud = mix(vec3(0.30,0.24,0.17), vec3(0.36,0.34,0.31), n2*0.6);
        vec3 c = mix(shallow, deep, smoothstep(0.0, 0.8, dep));
        float din = length((vL.xz - vec2(0.95, 2.85)) / vec2(1.25, 0.78));
        float mk = clamp(uMud * 2.6 - din * 1.05, 0.0, 1.0) * smoothstep(0.0, 0.06, uMud);
        mk = mk * mk * (3.0 - 2.0 * mk);
        c = mix(c, mud*(0.82+0.3*n1), mk);
        c *= uAmb;
        vec3 H = normalize(normalize(uSun)+V); float sp = pow(max(dot(N,H),0.0), 180.0);
        c = mix(c, env, fr*mix(0.8, 0.35, mk)) + uSunCol*sp*mix(1.6, 0.6, mk);
        float a = mix(0.45, 0.92, smoothstep(0.0, 0.5, dep));
        a = max(a, mk*0.96);
        float edge = 1.0 - smoothstep(0.0, 0.05, dep);
        c += vec3(0.5)*edge*0.25*(1.0-mk);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
  const lake = new THREE.Mesh(g, mat); lake.renderOrder = 2;
  // front cross-section
  const verts = [], idx = []; const N = 120; let cols = 0;
  for (let i = 0; i <= N; i++) { const x = LAKE.x - 1.6 + (3.2 * i) / N; const h = heightAt(x, BZ); verts.push(x, Math.min(h, WL), BZ + 0.002, x, WL, BZ + 0.002); cols++; }
  for (let i = 0; i < cols - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); sg.setIndex(idx);
  const smat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uMud; uniform float uAmb; uniform float uTime; varying vec3 vL; ${NOISE}
      void main(){ float d = clamp((${WL.toFixed(3)} - vL.y)/0.4, 0.0, 1.0);
        vec3 c = mix(vec3(0.22,0.62,0.58), vec3(0.03,0.2,0.24), d);
        c += vec3(0.08)*vn2(vec2(vL.x*20.0+uTime*0.3, vL.y*40.0));
        c = mix(c, vec3(0.27,0.22,0.16) + vec3(0.05)*vn2(vec2(vL.x*9.0, vL.y*25.0)), smoothstep(0.15, 0.85, uMud) * smoothstep(-0.6, 0.6, uMud*2.6 - abs(vL.x - 0.95)*1.4));
        float top = 1.0 - smoothstep(0.0, 0.012, ${WL.toFixed(3)} - vL.y);
        c += vec3(0.6,0.8,0.8)*top*0.6;
        gl_FragColor = vec4(c*uAmb, 0.82); 
        #include <colorspace_fragment>
      }`,
  });
  const sec = new THREE.Mesh(sg, smat); sec.renderOrder = 2;
  return { lake, sec, U };
}

// ------- river ribbon -------
export function buildRiver(U) {
  const S = 220, verts = [], uvs = [], idx = [];
  for (let i = 0; i <= S; i++) {
    const u = i / S; const p = polyAt(RIVER, RIVER_L, u); const w = riverW(u) * 1.25; const nx = -p.tz, nz = p.tx; const y = bedAt(u) + 0.038;
    for (let k = -1; k <= 1; k += 2) { verts.push(p.x + nx * w * k, y, p.z + nz * w * k); uvs.push(u, (k + 1) / 2); }
  }
  for (let i = 0; i < S; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  const RU = { uFront: { value: 0 }, uLahar: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...RU }, transparent: true, depthWrite: false,
    vertexShader: `uniform float uFront; uniform float uLahar; varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec3 p = position;
      float bulge = exp(-pow((uv.x-uFront)/0.03,2.0))*uLahar; float body = step(uv.x, uFront)*uLahar;
      p.y += bulge*0.05 + body*0.025; vec4 w = modelMatrix*vec4(p,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform float uFront; uniform float uLahar; uniform samplerCube uEnv; uniform float uAmb; uniform vec3 uSunCol; uniform vec3 uSun;
      varying vec2 vUv; varying vec3 vW; ${NOISE}
      void main(){
        float side = abs(vUv.y-0.5)*2.0;
        float flow = vn2(vec2(vUv.x*90.0 - uTime*3.0, vUv.y*6.0)); float flow2 = vn2(vec2(vUv.x*200.0 - uTime*5.0, vUv.y*12.0+3.0));
        vec3 c = mix(vec3(0.30,0.58,0.56), vec3(0.12,0.38,0.40), 1.0-side);
        c += vec3(0.85)*smoothstep(0.62,0.9,flow2)*0.35;
        float mud = step(vUv.x, uFront + (flow-0.5)*0.02) * uLahar;
        vec3 mc = mix(vec3(0.30,0.23,0.16), vec3(0.20,0.15,0.10), flow) ;
        mc += vec3(0.25,0.22,0.18)*smoothstep(0.7,0.95,flow2)*0.6;
        float frontFoam = exp(-pow((vUv.x-uFront)/0.015,2.0))*uLahar;
        c = mix(c, mc, mud); c += vec3(0.35,0.3,0.25)*frontFoam;
        vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vec3((flow-0.5)*0.3,1.0,(flow2-0.5)*0.3));
        vec3 env = textureCube(uEnv, reflect(-V,N)).rgb; float fr = 0.04 + 0.96*pow(1.0-max(dot(N,V),0.0),5.0);
        c *= uAmb; c = mix(c, env, fr*0.6*(1.0-mud*0.85));
        vec3 H = normalize(normalize(uSun)+V); c += uSunCol*pow(max(dot(N,H),0.0),120.0)*(1.0-mud*0.6);
        float a = (1.0 - smoothstep(0.75, 1.0, side)) * mix(0.85, 1.0, mud);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(g, mat); m.renderOrder = 1;
  return { mesh: m, RU };
}
