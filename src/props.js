import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm, vnoise, smooth, lerp, clamp, polyLen, polyAt, polyDist, smoothPoly } from './noise.js';
import { NOISE, MAPUV } from './glsl.js';
import { BX, BZ, CONE, RIVER, RIVER_L, PYRO, PYRO_L, VILLAGE, ASSEMBLY, LAKE, WL, terrainInfo, hFast, heightAt, bedAt, riverW, mapUniforms } from './terrain.js';

// ---------- geometry helpers ----------
function prep(g, color, roof = 0, leaf = 0) {
  g = g.index ? g.toNonIndexed() : g;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count; const c = new THREE.Color(color); const ca = new Float32Array(n * 3), ra = new Float32Array(n), la = new Float32Array(n);
  for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; ra[i] = roof; la[i] = leaf; }
  g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); g.setAttribute('aRoof', new THREE.BufferAttribute(ra, 1)); g.setAttribute('aLeaf', new THREE.BufferAttribute(la, 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aRoof', 'aLeaf'].includes(k)) g.deleteAttribute(k);
  return g;
}
const M = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
// frustum roof between rect (w0,d0) at y0 and (w1,d1) at y1 (centered)
function roofGeo(w0, d0, w1, d1, y0, y1, under = true) {
  const b = [[-w0 / 2, y0, -d0 / 2], [w0 / 2, y0, -d0 / 2], [w0 / 2, y0, d0 / 2], [-w0 / 2, y0, d0 / 2]];
  const t = [[-w1 / 2, y1, -d1 / 2], [w1 / 2, y1, -d1 / 2], [w1 / 2, y1, d1 / 2], [-w1 / 2, y1, d1 / 2]];
  const p = []; const quad = (a, bb, c, d) => { p.push(...a, ...bb, ...c, ...a, ...c, ...d); };
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[j], b[i], t[i], t[j]); }
  if (w1 > 0 && d1 > 0) quad(t[0], t[3], t[2], t[1]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
  return g;
}
function underGeo(w, d, y) { const g = new THREE.PlaneGeometry(w, d); g.rotateX(Math.PI / 2); g.translate(0, y, 0); return g; }

export const ROAD = smoothPoly([[-1.5, 2.25], [-0.8, 2.02], [0.0, 1.88], [0.62, 1.78], [1.25, 1.62], [1.75, 1.45], [2.4, 1.25], [2.85, 1.2], [3.35, 1.55], [3.68, 2.15], [3.95, 2.65]], 8);
export const ROAD_L = polyLen(ROAD);
const ROAD2 = smoothPoly([[2.85, 1.2], [2.95, 0.65], [3.15, 0.1], [3.5, -0.3]], 6);
export const BRIDGE_U = 0.535;

export const HOUSES = [
  [2.05, 0.78, 0.08, 'L'], [2.42, 0.2, -0.04, 'J'], [2.2, 1.9, 0.0, 'L'], [2.95, 1.78, 0.06, 'L'], [3.55, 0.82, 0.0, 'J'],
  [3.95, 1.45, -0.1, 'L'], [4.32, 0.55, 0.05, 'L'], [3.85, -0.12, 0.02, 'L'], [4.38, 2.0, 0.1, 'L'], [1.9, -0.25, 0.0, 'L'], [2.62, 2.35, 0.04, 'L'], [4.4, -0.65, 0.0, 'L'],
];
export const PRAYER_HOUSE = [3.02, 0.35, 0.0];
export const TOWER = [1.78, 0.32];
export const SIGN = [3.5, 1.95];

export function buildProps(shadowMeshes) {
  const parts = []; const wins = [];
  const add = (g, col, m, roof = 0) => { g = prep(g, col, roof); g.applyMatrix4(m); parts.push(g); };
  const ROOF = '#9b4b2e', ROOF2 = '#8a3f27', WALL = '#e4dccb', WOOD = '#6b4a30', UMPAK = '#8b8680';
  const winQuad = (m, w, h, x, y, z, ry) => { const g = new THREE.PlaneGeometry(w, h); g.rotateY(ry); g.translate(x, y, z); g.applyMatrix4(m); wins.push(g); };
  for (const [x, z, ry, type] of HOUSES) {
    const y = hFast(x, z) - 0.01; const m = M(x, y, z, ry);
    const J = type === 'J'; const w = J ? 0.34 : 0.3, d = J ? 0.3 : 0.2, wh = J ? 0.1 : 0.095;
    add(new THREE.BoxGeometry(w + 0.04, 0.03, d + 0.04), UMPAK, m.clone().multiply(M(0, 0.015, 0)));
    add(new THREE.BoxGeometry(w, wh, d), J ? '#cdb08a' : WALL, m.clone().multiply(M(0, 0.03 + wh / 2, 0)));
    // wooden trims
    add(new THREE.BoxGeometry(w + 0.004, 0.012, d + 0.004), WOOD, m.clone().multiply(M(0, 0.03 + wh - 0.006, 0)));
    const y0 = 0.03 + wh;
    if (J) {
      add(roofGeo(0.5, 0.46, 0.25, 0.21, y0, y0 + 0.06), ROOF, M(x, y, z, ry), 1);
      add(roofGeo(0.25, 0.21, 0.09, 0.0, y0 + 0.06, y0 + 0.215), ROOF2, M(x, y, z, ry), 1);
      add(underGeo(0.5, 0.46, y0 + 0.001), '#4a3526', M(x, y, z, ry));
      add(new THREE.BoxGeometry(0.1, 0.012, 0.012), '#6e3420', M(x, y, z, ry).multiply(M(0, y0 + 0.218, 0)), 1);
    } else {
      add(roofGeo(0.42, 0.32, 0.17, 0.0, y0, y0 + 0.14), ROOF, M(x, y, z, ry), 1);
      add(underGeo(0.42, 0.32, y0 + 0.001), '#4a3526', M(x, y, z, ry));
      add(new THREE.BoxGeometry(0.18, 0.01, 0.01), '#6e3420', M(x, y, z, ry).multiply(M(0, y0 + 0.143, 0)), 1);
    }
    // door + windows on +z face
    winQuad(m, 0.045, 0.07, 0, 0.03 + 0.035, d / 2 + 0.002, 0);
    winQuad(m, 0.04, 0.03, -w * 0.3, 0.03 + wh * 0.6, d / 2 + 0.002, 0);
    winQuad(m, 0.04, 0.03, w * 0.3, 0.03 + wh * 0.6, d / 2 + 0.002, 0);
    winQuad(m, 0.04, 0.03, 0, 0.03 + wh * 0.6, -d / 2 - 0.002, Math.PI);
  }
  // prayer house (langgar) with a pyramid roof
  {
    const [x, z, ry] = PRAYER_HOUSE; const y = hFast(x, z) - 0.01; const m = M(x, y, z, ry);
    add(new THREE.BoxGeometry(0.36, 0.035, 0.36), '#9a958d', m.clone().multiply(M(0, 0.017, 0)));
    add(new THREE.BoxGeometry(0.28, 0.12, 0.28), '#f1ede4', m.clone().multiply(M(0, 0.095, 0)));
    add(new THREE.BoxGeometry(0.29, 0.014, 0.29), '#2f6a4c', m.clone().multiply(M(0, 0.15, 0)));
    const y0 = 0.155;
    add(roofGeo(0.44, 0.44, 0.24, 0.24, y0, y0 + 0.06), '#3d5f52', m, 1);
    add(new THREE.BoxGeometry(0.2, 0.03, 0.2), '#f1ede4', m.clone().multiply(M(0, y0 + 0.075, 0)));
    add(roofGeo(0.3, 0.3, 0.14, 0.14, y0 + 0.09, y0 + 0.14), '#3d5f52', m, 1);
    add(new THREE.BoxGeometry(0.11, 0.02, 0.11), '#f1ede4', m.clone().multiply(M(0, y0 + 0.15, 0)));
    add(roofGeo(0.17, 0.17, 0.0, 0.0, y0 + 0.16, y0 + 0.25), '#3d5f52', m, 1);
    add(new THREE.SphereGeometry(0.014, 10, 8), '#d8b04a', m.clone().multiply(M(0, y0 + 0.262, 0)));
    add(new THREE.ConeGeometry(0.006, 0.04, 6), '#d8b04a', m.clone().multiply(M(0, y0 + 0.29, 0)));
    add(underGeo(0.44, 0.44, y0 + 0.001), '#3b3a36', m);
    for (const s of [-1, 1]) winQuad(m, 0.05, 0.075, s * 0.06, 0.035 + 0.04, 0.142, 0);
    winQuad(m, 0.06, 0.08, 0, 0.075, -0.142, Math.PI);
  }
  // kentongan (bamboo slit-drum alarm) watch tower
  {
    const [x, z] = TOWER; const y = hFast(x, z) - 0.01; const m = M(x, y, z, 0.3);
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(new THREE.BoxGeometry(0.014, 0.42, 0.014), WOOD, m.clone().multiply(M(px * 0.055, 0.21, pz * 0.055)));
    add(new THREE.BoxGeometry(0.15, 0.012, 0.15), '#7a5636', m.clone().multiply(M(0, 0.28, 0)));
    for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.15, 0.03, 0.006), '#7a5636', m.clone().multiply(M(0, 0.305, s * 0.072))); add(new THREE.BoxGeometry(0.006, 0.03, 0.15), '#7a5636', m.clone().multiply(M(s * 0.072, 0.305, 0))); }
    add(roofGeo(0.2, 0.2, 0.0, 0.0, 0.42, 0.5), ROOF, m, 1);
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.07, 8).rotateZ(0), '#8a6a3a', m.clone().multiply(M(0.0, 0.37, 0)));
    // ladder
    add(new THREE.BoxGeometry(0.004, 0.3, 0.004), WOOD, m.clone().multiply(M(-0.02, 0.14, 0.085)));
    add(new THREE.BoxGeometry(0.004, 0.3, 0.004), WOOD, m.clone().multiply(M(0.02, 0.14, 0.085)));
    for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.04, 0.003, 0.003), WOOD, m.clone().multiply(M(0, 0.03 + k * 0.045, 0.085)));
  }
  // bridge
  {
    const p = polyAt(RIVER, RIVER_L, BRIDGE_U); const ang = Math.atan2(p.tx, p.tz); const y = Math.max(hFast(p.x - p.tz * 0.4, p.z + p.tx * 0.4), hFast(p.x + p.tz * 0.4, p.z - p.tx * 0.4));
    const m = M(p.x, y + 0.01, p.z, ang + Math.PI / 2);
    add(new THREE.BoxGeometry(0.11, 0.022, 0.7), '#a7a39b', m);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.008, 0.035, 0.7), '#c9c3b6', m.clone().multiply(M(s * 0.052, 0.03, 0)));
      for (let k = -3; k <= 3; k++) add(new THREE.BoxGeometry(0.012, 0.05, 0.012), '#d8d2c4', m.clone().multiply(M(s * 0.052, 0.025, k * 0.1)));
    }
    add(new THREE.BoxGeometry(0.1, 0.25, 0.05), '#8f8a80', m.clone().multiply(M(0, -0.13, 0)));
  }
  // road ribbon
  const roadRibbon = (P, L, w, col) => {
    const S = Math.ceil(L[L.length - 1] / 0.03); const pos = [], nor = [];
    let prev = null;
    for (let i = 0; i <= S; i++) {
      const p = polyAt(P, L, i / S); const nx = -p.tz, nz = p.tx; const row = [];
      for (const k of [-1, 1]) { const x = p.x + nx * w * k, z = p.z + nz * w * k; const tinfo = terrainInfo(x, z); row.push([x, Math.max(tinfo.h, bedAt(tinfo.ru) + 0.05) + 0.008, z]); }
      if (prev) { const [a, b] = prev, [c, d] = row; pos.push(...a, ...c, ...b, ...b, ...c, ...d); for (let q = 0; q < 6; q++) nor.push(0, 1, 0); }
      prev = row;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    parts.push(prep(g, col));
  };
  roadRibbon(ROAD, ROAD_L, 0.045, '#8f8169');
  roadRibbon(ROAD2, polyLen(ROAD2), 0.035, '#8f8169');
  // sand piles & mining spot
  for (const [x, z, s] of [[-0.42, 1.32, 1], [-0.25, 1.05, 0.7], [-0.6, 1.55, 0.8]]) add(new THREE.ConeGeometry(0.12 * s, 0.09 * s, 14), '#a69c8b', M(x, hFast(x, z) + 0.035 * s, z));
  // assembly point marker: flag pole
  { const x = ASSEMBLY.x + 0.35, z = ASSEMBLY.z - 0.15, y = hFast(x, z); add(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 6), '#dddddd', M(x, y + 0.15, z)); add(new THREE.BoxGeometry(0.07, 0.035, 0.002), '#d23b32', M(x + 0.035, y + 0.28, z)); add(new THREE.BoxGeometry(0.07, 0.035, 0.002), '#f4f4f4', M(x + 0.035, y + 0.245, z)); }
  // fences along terraces (small)
  const geo = mergeGeometries(parts, false);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mapUniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aRoof; varying float vRoof; varying vec3 vLoc; varying vec3 vNl;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      vRoof = aRoof; vLoc = position; vNl = normal;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uAshMap; varying float vRoof; varying vec3 vLoc; varying vec3 vNl; ${NOISE} ${MAPUV}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (vRoof > 0.5) { float row = fract(vLoc.y*190.0); float col = fract((vLoc.x*0.7+vLoc.z*0.7)*140.0 + floor(vLoc.y*190.0)*0.5);
        diffuseColor.rgb *= (0.78 + 0.3*smoothstep(0.0,0.35,row)) * (0.9+0.1*smoothstep(0.0,0.2,col)) * (0.85+0.3*h21(floor(vec2(vLoc.x+vLoc.z, vLoc.y)*vec2(140.0,190.0)))); }
      vec4 am = texture2D(uAshMap, mapUV(vLoc.xz));
      float up = smoothstep(0.2, 0.8, normalize(vNl).y);
      float ash = smoothstep(0.12, 0.8, am.r + (vn2(vLoc.xz*40.0)-0.5)*0.25) * (0.35 + 0.65*up);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38,0.37,0.35)*(0.9+0.2*vn2(vLoc.xz*80.0)), ash*0.8);
      diffuseColor.rgb *= 1.0 - 0.3*am.b*up;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  const wgeo = mergeGeometries(wins, false);
  const wmat = new THREE.MeshBasicMaterial({ color: '#3a2a1c' });
  const wmesh = new THREE.Mesh(wgeo, wmat);
  return { mesh, wmesh, wmat };
}

// ---------- signs (canvas textures) ----------
function signTex(lines, icon) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160; const c = cv.getContext('2d');
  c.fillStyle = '#0f7a3c'; c.fillRect(0, 0, 256, 160); c.strokeStyle = '#ffffff'; c.lineWidth = 7; c.strokeRect(8, 8, 240, 144);
  c.fillStyle = '#fff'; c.font = '700 30px DMSans, sans-serif'; c.textAlign = 'center';
  let fs = lines.length > 1 ? 27 : 30; c.font = `700 ${fs}px DMSans, sans-serif`; while (Math.max(...lines.map((l) => c.measureText(l).width)) > 220 && fs > 14) { fs--; c.font = `700 ${fs}px DMSans, sans-serif`; }
  const lh = fs + 2, by = lines.length > 1 ? 118 : 112; lines.forEach((l, i) => c.fillText(l, 128, by + i * lh - (lines.length - 1) * lh / 2));
  if (icon === 'arrow') { c.beginPath(); c.moveTo(60, 50); c.lineTo(170, 50); c.lineTo(170, 30); c.lineTo(205, 58); c.lineTo(170, 86); c.lineTo(170, 66); c.lineTo(60, 66); c.closePath(); c.fill(); }
  else { for (let k = 0; k < 3; k++) { const x = 88 + k * 40; c.beginPath(); c.arc(x, 36, 9, 0, 7); c.fill(); c.fillRect(x - 9, 48, 18, 30); } }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function buildSigns() {
  const grp = new THREE.Group();
  const mk = (x, z, ry, lines, icon) => {
    const y = hFast(x, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 6), new THREE.MeshStandardMaterial({ color: '#cfcfcf', roughness: 0.5, metalness: 0.5 }));
    post.position.set(x, y + 0.1, z); post.castShadow = true; grp.add(post);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.094), new THREE.MeshStandardMaterial({ map: signTex(lines, icon), roughness: 0.5, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.0 }));
    pl.material.emissiveMap = pl.material.map;
    pl.position.set(x, y + 0.2, z); pl.rotation.y = ry; pl.castShadow = true; grp.add(pl);
    return pl;
  };
  const s1 = mk(SIGN[0], SIGN[1], -0.5, ['EVACUATION', 'ROUTE'], 'arrow');
  const s2 = mk(ASSEMBLY.x - 0.3, ASSEMBLY.z + 0.28, -0.25, ['ASSEMBLY', 'POINT'], 'ppl');
  const s3 = mk(1.35, 1.75, 0.2, ['EVACUATION', 'ROUTE'], 'arrow');
  return { grp, plates: [s1, s2, s3] };
}

// ---------- vegetation ----------
function lumpy(r, det, seed, sy = 1) {
  let g = new THREE.IcosahedronGeometry(r, det); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = vnoise(v.x * 40 + seed, v.y * 40 + v.z * 30) * 0.6 + vnoise(v.x * 90, v.z * 90 + seed) * 0.4; v.multiplyScalar(0.8 + 0.4 * n); v.y *= sy; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
function vprep(g, col, leaf) { return prep(g, col, 0, leaf); }
function treeGeos() {
  const T = {};
  // broadleaf
  {
    const P = [];
    P.push(vprep(new THREE.CylinderGeometry(0.008, 0.013, 0.12, 6).translate(0, 0.06, 0), '#5a4330', 0));
    P.push(vprep(lumpy(0.075, 2, 1, 0.85).translate(0, 0.15, 0), '#ffffff', 1));
    P.push(vprep(lumpy(0.058, 2, 2, 0.85).translate(0.05, 0.12, 0.02), '#e8eee0', 1));
    P.push(vprep(lumpy(0.055, 2, 3, 0.85).translate(-0.045, 0.125, -0.025), '#f3f6ee', 1));
    T.broad = { g: mergeGeometries(P), H: 0.22 };
  }
  // casuarina trees
  {
    const P = [];
    P.push(vprep(new THREE.CylinderGeometry(0.004, 0.007, 0.08, 5).translate(0, 0.04, 0), '#4d3a2a', 0));
    P.push(vprep(new THREE.ConeGeometry(0.045, 0.12, 9).translate(0, 0.1, 0), '#ffffff', 1));
    P.push(vprep(new THREE.ConeGeometry(0.034, 0.1, 9).translate(0, 0.16, 0), '#eef3ea', 1));
    P.push(vprep(new THREE.ConeGeometry(0.022, 0.08, 8).translate(0, 0.215, 0), '#f6f8f2', 1));
    T.casuarina = { g: mergeGeometries(P), H: 0.26 };
  }
  // coconut
  {
    const P = []; const H = 0.3;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 0.12, 0), new THREE.Vector3(0.05, 0.22, 0), new THREE.Vector3(0.065, H, 0)]);
    P.push(vprep(new THREE.TubeGeometry(curve, 10, 0.0065, 6, false), '#7a6a55', 0));
    const top = new THREE.Vector3(0.065, H, 0);
    for (let k = 0; k < 9; k++) {
      const fg = new THREE.PlaneGeometry(0.2, 0.04, 10, 2); const p = fg.attributes.position;
      for (let i = 0; i < p.count; i++) { let x = p.getX(i) + 0.1, y = p.getY(i); const t = x / 0.2; const w = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.5); p.setXYZ(i, x, -0.12 * t * t + 0.04 * t, y * w); }
      // fold leaflets: V shape
      for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) + Math.abs(z) * 0.4); }
      fg.computeVertexNormals();
      const a = (k / 9) * Math.PI * 2 + (k % 2) * 0.2; fg.rotateZ(0.25 + (k % 3) * 0.1); fg.rotateY(a); fg.translate(top.x, top.y, top.z);
      P.push(vprep(fg, k % 2 ? '#ffffff' : '#e6edd8', 1));
    }
    P.push(vprep(new THREE.SphereGeometry(0.015, 8, 6).translate(top.x, top.y - 0.01, top.z), '#6b5a2a', 0));
    T.coco = { g: mergeGeometries(P), H: H };
  }
  // bamboo clump
  {
    const P = []; const r = rng(9);
    for (let k = 0; k < 9; k++) {
      const h = 0.28 + r() * 0.16; const a = r() * 6.28, lean = 0.12 + r() * 0.22;
      const c = new THREE.CylinderGeometry(0.0035, 0.0045, h, 5, 4).translate(0, h / 2, 0); c.rotateZ(lean); c.rotateY(a);
      P.push(vprep(c, '#8f9a4a', 0));
      for (let j = 0; j < 3; j++) { const t = 0.55 + j * 0.18; const lg = lumpy(0.03 + r() * 0.01, 1, k * 3 + j, 0.5); const dx = Math.sin(lean) * h * t, dy = Math.cos(lean) * h * t; lg.translate(dx, dy, 0); lg.rotateY(a); P.push(vprep(lg, '#f2f5e6', 1)); }
    }
    T.bamboo = { g: mergeGeometries(P), H: 0.42 };
  }
  // salak: spiky low palm
  {
    const P = []; const r = rng(21);
    for (let k = 0; k < 11; k++) { const c = new THREE.ConeGeometry(0.008, 0.11, 4).translate(0, 0.055, 0); c.rotateZ(0.5 + r() * 0.5); c.rotateY(r() * 6.28); P.push(vprep(c, '#ffffff', 1)); }
    T.salak = { g: mergeGeometries(P), H: 0.1 };
  }
  // shrub
  { T.shrub = { g: mergeGeometries([vprep(lumpy(0.035, 1, 7, 0.7).translate(0, 0.02, 0), '#ffffff', 1), vprep(lumpy(0.028, 1, 8, 0.7).translate(0.03, 0.015, 0.01), '#eeeeee', 1)]), H: 0.05 } }
  // big banyan tree at the assembly point
  {
    const P = [];
    P.push(vprep(new THREE.CylinderGeometry(0.018, 0.03, 0.2, 8).translate(0, 0.1, 0), '#5a4636', 0));
    for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28; P.push(vprep(lumpy(0.09, 2, 30 + k, 0.7).translate(Math.cos(a) * 0.09, 0.24 + (k % 2) * 0.03, Math.sin(a) * 0.09), '#ffffff', 1)); }
    P.push(vprep(lumpy(0.11, 2, 40, 0.7).translate(0, 0.3, 0), '#f0f0f0', 1));
    T.banyan = { g: mergeGeometries(P), H: 0.38 };
  }
  return T;
}

function vegMaterial(H, sway) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mapUniforms, { uH: { value: H }, uSway: { value: sway } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      uniform sampler2D uAshMap; uniform sampler2D uWindMap; uniform float uTime; uniform vec2 uBreeze; uniform float uH; uniform float uSway;
      attribute float aLeaf; varying float vLeaf; varying float vAsh; varying float vWet; varying vec3 vIP; ${MAPUV}`)
      .replace('#include <project_vertex>', `
      vec3 ip = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz; vIP = ip; vLeaf = aLeaf;
      vec4 am = texture2D(uAshMap, mapUV(ip.xz)); vAsh = am.r; vWet = am.b;
      vec2 wv = (texture2D(uWindMap, mapUV(ip.xz)).rg - 0.5) * (255.0/60.0);
      vec4 wp = instanceMatrix * vec4(transformed, 1.0);
      float hh = clamp((wp.y - ip.y) / uH, 0.0, 1.5); float k = hh*hh;
      float ph = uTime*1.7 + ip.x*3.1 + ip.z*2.3;
      vec2 sw = uBreeze * (0.6 + 0.4*sin(ph)) + wv * (0.75 + 0.25*sin(ph*2.3));
      wp.xz += sw * k * uSway * uH; wp.y -= dot(sw,sw)*k*uSway*uH*0.25;
      wp.xz += vec2(sin(ph*1.3), cos(ph*1.1)) * 0.004 * k * (1.0 + 2.5*length(wv));
      vec4 mvPosition = modelViewMatrix * wp; gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uSeason; varying float vLeaf; varying float vAsh; varying float vWet; varying vec3 vIP; ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (vLeaf > 0.5) { vec3 dry = diffuseColor.rgb * vec3(1.18, 1.0, 0.62) + vec3(0.05,0.03,0.0); diffuseColor.rgb = mix(diffuseColor.rgb, dry, uSeason*0.75); }
      float a = smoothstep(0.15, 0.85, vAsh + (h21(vIP.xz*13.0)-0.5)*0.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36,0.35,0.33)*(0.85+0.3*h21(vIP.xz*7.0)), a*(vLeaf>0.5?0.6:0.35));
      diffuseColor.rgb *= 1.0 - 0.25*vWet;`);
  };
  return mat;
}

export function buildVegetation() {
  const T = treeGeos(); const r = rng(77); const grp = new THREE.Group();
  const lists = { broad: [], casuarina: [], coco: [], bamboo: [], salak: [], shrub: [], banyan: [] };
  const okBase = (x, z, t) => Math.abs(x) < BX - 0.12 && Math.abs(z) < BZ - 0.12 && t.rd > riverW(t.ru) * 2.1 && t.lr > 1.12 && polyDist(ROAD, ROAD_L, x, z).d > 0.09;
  const nearHouse = (x, z, d) => HOUSES.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < d) || Math.hypot(PRAYER_HOUSE[0] - x, PRAYER_HOUSE[1] - z) < d + 0.05 || Math.hypot(TOWER[0] - x, TOWER[1] - z) < 0.14;
  const sample = (n, tries, test, list) => { let k = 0; for (let i = 0; i < tries && k < n; i++) { const x = (r() * 2 - 1) * BX, z = (r() * 2 - 1) * BZ; const t = terrainInfo(x, z); if (!okBase(x, z, t)) continue; if (!test(x, z, t)) continue; list.push([x, t.h, z, 0.75 + r() * 0.5, r() * 6.28]); k++; } };
  const cr = (x, z) => Math.hypot(x - CONE[0], z - CONE[1]);
  // forest belt on the cone (sparser on the pyro side)
  sample(520, 30000, (x, z, t) => t.h > 0.95 && t.h < 2.35 && t.tm < 0.2 && t.vm < 0.1 && t.pg > 0.32 && fbm(x * 1.2, z * 1.2) > 0.38, lists.casuarina);
  sample(220, 20000, (x, z, t) => t.h > 0.55 && t.h < 1.6 && t.tm < 0.15 && t.vm < 0.2 && t.pg > 0.3 && fbm(x * 0.9 + 4, z * 0.9) > 0.4, lists.broad);
  // lowland trees
  sample(130, 20000, (x, z, t) => t.h < 0.9 && t.tm < 0.1 && t.pg > 0.28 && !nearHouse(x, z, 0.24) && Math.hypot(x - ASSEMBLY.x, z - ASSEMBLY.z) > 0.5, lists.broad);
  sample(36, 20000, (x, z, t) => ((t.vm > 0.3 && !nearHouse(x, z, 0.22)) || (t.rd < 0.55 && t.h < 1.0) || (t.lr < 1.5)) && Math.hypot(x - ASSEMBLY.x, z - ASSEMBLY.z) > 0.45, lists.coco);
  sample(16, 20000, (x, z, t) => t.rd < 0.5 && t.h < 1.4 && t.ru > 0.15, lists.bamboo);
  sample(90, 30000, (x, z, t) => (t.vm > 0.2 || (t.rd < 0.7 && t.h < 1.2)) && !nearHouse(x, z, 0.2) && Math.hypot(x - ASSEMBLY.x, z - ASSEMBLY.z) > 0.45, lists.salak);
  sample(380, 30000, (x, z, t) => t.h < 2.0 && t.tm < 0.3 && t.pg > 0.25 && !nearHouse(x, z, 0.19) && Math.hypot(x - ASSEMBLY.x, z - ASSEMBLY.z) > 0.4, lists.shrub);
  lists.banyan.push([ASSEMBLY.x + 0.42, hFast(ASSEMBLY.x + 0.42, ASSEMBLY.z + 0.32), ASSEMBLY.z + 0.32, 1.0, 0.3]);
  const cols = { broad: ['#3f7a2c', '#4f8a31', '#356b28', '#5d8f36'], casuarina: ['#2d5a2a', '#2a5233', '#365f2d'], coco: ['#5f8f2f', '#6d9a35'], bamboo: ['#6f9a3a', '#7aa340'], salak: ['#3a5f26', '#44692b'], shrub: ['#466f2a', '#557d2f', '#3b6324'], banyan: ['#2f5f26'] };
  const sways = { broad: 0.5, casuarina: 0.45, coco: 0.9, bamboo: 1.0, salak: 0.3, shrub: 0.25, banyan: 0.35 };
  const meshes = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  for (const k of Object.keys(lists)) {
    const L = lists[k]; if (!L.length) continue;
    const im = new THREE.InstancedMesh(T[k].g, vegMaterial(T[k].H, sways[k]), L.length);
    L.forEach(([x, y, z, s, a], i) => { q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.08, a, (r() - 0.5) * 0.08)); m4.compose(new THREE.Vector3(x, y - 0.005, z), q, new THREE.Vector3(s, s * (0.9 + r() * 0.25), s)); im.setMatrixAt(i, m4); c.set(cols[k][i % cols[k].length]).multiplyScalar(0.9 + r() * 0.2); im.setColorAt(i, c); });
    im.castShadow = true; im.receiveShadow = true; grp.add(im); meshes.push(im);
  }
  return { grp, lists };
}

// ---------- villagers ----------
export function buildVillagers() {
  const r = rng(5);
  const homes = [];
  HOUSES.forEach(([x, z, ry], i) => { const n = i % 3 === 0 ? 3 : 2; for (let k = 0; k < n; k++) homes.push([x + Math.sin(ry) * 0.17 + (k - 0.5) * 0.07, z + Math.cos(ry) * 0.17 + (r() - 0.5) * 0.04, 'v']); });
  // farmers in west terraces
  for (const [x, z] of [[-1.4, 2.4], [-2.1, 2.7], [-1.0, 2.9], [-2.6, 2.3]]) homes.push([x, z, 'f']);
  const N = homes.length;
  const VS = 2.2; const body = new THREE.CylinderGeometry(0.011 * VS, 0.014 * VS, 0.045 * VS, 7).translate(0, 0.0225 * VS, 0);
  const head = new THREE.SphereGeometry(0.009 * VS, 8, 6).translate(0, 0.054 * VS, 0);
  const hat = new THREE.ConeGeometry(0.02 * VS, 0.012 * VS, 10).translate(0, 0.066 * VS, 0);
  const bm = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.8 }), N);
  const hm = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: '#b07a52', roughness: 0.7 }), N);
  const tm = new THREE.InstancedMesh(hat, new THREE.MeshStandardMaterial({ color: '#c8ab6e', roughness: 0.9 }), N);
  const shirts = ['#d8443a', '#2f6fb3', '#f2c14e', '#ffffff', '#3d9a5a', '#e07b39', '#7c4fb0', '#2a2a2a', '#c43b6b'];
  for (let i = 0; i < N; i++) bm.setColorAt(i, new THREE.Color(shirts[i % shirts.length]));
  [bm, hm, tm].forEach((m) => { m.castShadow = true; m.frustumCulled = false; });
  // evacuation paths
  const westPath = [[-0.8, 2.02], [0.0, 1.88], [0.62, 1.78], [1.25, 1.62], [1.75, 1.45], [2.4, 1.25], [2.85, 1.2], [3.35, 1.55], [3.68, 2.15], [3.95, 2.65]];
  const paths = homes.map(([x, z, type], i) => {
    const slotA = (i * 2.399) % 6.283, slotR = 0.08 + 0.2 * Math.sqrt((i + 0.5) / N);
    const slot = [ASSEMBLY.x + Math.cos(slotA) * slotR * 1.2, ASSEMBLY.z + Math.sin(slotA) * slotR * 0.8];
    let P;
    if (type === 'f') P = [[x, z], [x + 0.2, 2.15], ...westPath, slot];
    else {
      // join main road at nearest point after the village center
      const join = z > 1.4 || x > 3.2 ? [[3.35, 1.55], [3.68, 2.15], [3.95, 2.65]] : [[2.85, 1.2], [3.35, 1.55], [3.68, 2.15], [3.95, 2.65]];
      const near = [Math.min(Math.max(x, 2.7), 3.4), Math.min(Math.max(z, 1.1), 1.6)];
      P = [[x, z], near, ...join, slot];
    }
    return { P, L: polyLen(P), delay: r() * 2.2 + (type === 'f' ? 0 : 0.6), speed: 0.17 + r() * 0.05, hat: type === 'f' || r() < 0.35, phase: r() * 6 };
  });
  return { bm, hm, tm, homes, paths, N };
}

// ---------- sand truck ----------
export function buildTruck() {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: '#2f6e9a', roughness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.8 }), bed = new THREE.MeshStandardMaterial({ color: '#c9a53a', roughness: 0.7 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.065), yellow); cab.position.set(0.055, 0.045, 0); g.add(cab);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.02, 0.06), new THREE.MeshStandardMaterial({ color: '#9fc4d6', roughness: 0.2, metalness: 0.3 })); win.position.set(0.058, 0.058, 0); g.add(win);
  const bx = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.07), bed); bx.position.set(-0.03, 0.045, 0); g.add(bx);
  const sand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 6, 0, 6.3, 0, 1.4), new THREE.MeshStandardMaterial({ color: '#a69c8b', roughness: 1 })); sand.scale.set(1.15, 0.4, 0.8); sand.position.set(-0.03, 0.062, 0); g.add(sand);
  for (const [x, z] of [[0.05, 0.035], [0.05, -0.035], [-0.05, 0.035], [-0.05, -0.035]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10), dark); w.rotation.x = Math.PI / 2; w.position.set(x, 0.014, z); g.add(w); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
