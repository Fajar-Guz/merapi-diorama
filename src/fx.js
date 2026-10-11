import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, vnoise } from './noise.js';
import { NOISE } from './glsl.js';

// puff atlas: 2x2 variants, R = shading, A = density
function puffAtlas() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S * 2; const c = cv.getContext('2d'); const r = rng(11);
  const img = c.createImageData(S * 2, S * 2);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S, oy = Math.floor(v / 2) * S;
    const blobs = []; for (let k = 0; k < 9; k++) { const a = r() * 6.28, d = r() * 0.24; blobs.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d * 0.8, 0.16 + r() * 0.14]); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, w = y / S; let dens = 0, sh = 0;
      for (const [bx, by, br] of blobs) { const dx = (u - bx) / br, dy = (w - by) / br; const d2 = dx * dx + dy * dy; if (d2 < 1) { const f = (1 - d2) ** 1.5; dens += f; sh += f * (0.5 - dy * 0.5 - dx * 0.15); } }
      const n = vnoise(u * 9 + v * 3, w * 9) * 0.6 + vnoise(u * 23, w * 23 + v) * 0.4;
      const R2 = ((u - 0.5) ** 2 + (w - 0.5) ** 2) * 4; const fall = Math.max(0, 1 - R2);
      let a = Math.min(1, dens * 0.9) * (0.6 + 0.6 * n) * fall; a = Math.max(0, Math.min(1, a));
      const s = Math.max(0, Math.min(1, 0.4 + (sh / Math.max(dens, 1e-3)) * 1.1 + (n - 0.5) * 0.55));
      const i = ((oy + y) * S * 2 + ox + x) * 4; img.data[i] = s * 255; img.data[i + 1] = s * 255; img.data[i + 2] = s * 255; img.data[i + 3] = a * 255;
    }
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; return t;
}

export class Puffs {
  constructor(cap, atlas, additive = false) {
    this.cap = cap; this.n = 0;
    this.p = []; // particle objects
    const g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    this.aOff = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aGlow = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iOff', this.aOff); g.setAttribute('iCol', this.aCol); g.setAttribute('iGlow', this.aGlow); g.setAttribute('iSR', this.aSR);
    g.instanceCount = 0;
    this.U = { uTex: { value: atlas }, uLight: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.5) } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec3 iOff; attribute vec4 iCol; attribute vec3 iGlow; attribute vec3 iSR; varying vec2 vUv; varying vec4 vCol; varying vec3 vGlow; varying float vVar;
        void main(){ vec4 mv = modelViewMatrix*vec4(iOff,1.0); float c = cos(iSR.y), s = sin(iSR.y); vec2 p = position.xy; p = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
          mv.xy += p*iSR.x; vUv = uv; vCol = iCol; vGlow = iGlow; vVar = iSR.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uLight; uniform vec3 uAmb; varying vec2 vUv; varying vec4 vCol; varying vec3 vGlow; varying float vVar;
        void main(){ float v = floor(vVar); vec2 o = vec2(mod(v,2.0), floor(v/2.0))*0.5; vec4 t = texture2D(uTex, o + vUv*0.5);
          if (t.a*vCol.a < 0.004) discard;
          vec3 c = vCol.rgb * (uAmb + uLight*t.r) + vGlow*(1.15 - t.r*0.8);
          gl_FragColor = vec4(c, t.a*vCol.a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.g = g;
  }
  spawn(o) { if (this.p.length >= this.cap) { this.p.shift(); } this.p.push(o); }
  // write buffers sorted back-to-front for camera (local-space camera position)
  write(camLocal, fill) {
    const P = this.p; const n = P.length;
    for (const q of P) { const dx = q.x - camLocal.x, dy = q.y - camLocal.y, dz = q.z - camLocal.z; q._d = dx * dx + dy * dy + dz * dz; }
    const order = P.slice().sort((a, b) => b._d - a._d);
    const off = this.aOff.array, col = this.aCol.array, glow = this.aGlow.array, sr = this.aSR.array;
    for (let i = 0; i < n; i++) { const q = order[i]; fill(q, i, off, col, glow, sr); }
    this.g.instanceCount = n;
    for (const a of [this.aOff, this.aCol, this.aGlow, this.aSR]) a.needsUpdate = true;
  }
}

export function makeAtlas() { return puffAtlas(); }

// clouds: lumpy merged spheres
export function makeCloud(seed, scale = 1) {
  const r = rng(seed); const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0.12 });
  const inner = new THREE.Group(); grp.add(inner);
  const blobs = [[0, 0, 0, 0.36], [0.33, -0.04, 0.05, 0.28], [-0.32, -0.06, -0.02, 0.27], [0.12, 0.17, -0.05, 0.27], [-0.15, 0.13, 0.08, 0.25], [0.55, -0.1, -0.05, 0.18], [-0.55, -0.12, 0.04, 0.17], [0.05, -0.08, 0.22, 0.22], [0.0, -0.06, -0.24, 0.22]];
  for (const [x, y, z, rr] of blobs) {
    let g = new THREE.IcosahedronGeometry(rr * scale, 4); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    const p = g.attributes.position; const v = new THREE.Vector3(); const s0 = r() * 50;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = vnoise(v.x * 9 + s0, v.y * 9 + v.z * 7) * 0.7 + vnoise(v.x * 25, v.z * 25 + s0) * 0.3; v.multiplyScalar(0.88 + 0.22 * n); if (v.y < -rr * 0.35 * scale) v.y = -rr * 0.35 * scale + (v.y + rr * 0.35 * scale) * 0.25; p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.position.set(x * scale, y * scale, z * scale); m.castShadow = true; inner.add(m);
  }
  return { grp, inner, mat };
}

// lava dome: bumpy rock with glowing cracks
export function makeDome() {
  let g = new THREE.IcosahedronGeometry(0.3, 4); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(0.85 + 0.3 * vnoise(v.x * 14, v.z * 14 + v.y * 8)); v.y *= 0.55; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  const U = { uHeat: { value: 0.1 }, uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: '#2a2522', roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uHeat; uniform float uTime; varying vec3 vP; ${NOISE}`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec2 w = worley(vP.xz*18.0 + vP.y*6.0); float crack = 1.0 - smoothstep(0.0, 0.09, w.y - w.x);
      float pulse = 0.75 + 0.25*sin(uTime*3.0 + vP.x*20.0);
      float hot = crack*(0.4+0.6*uHeat) + smoothstep(0.08,0.17,vP.y)*uHeat*0.6;
      totalEmissiveRadiance += vec3(1.0,0.32,0.06)*hot*pulse*(0.6+5.0*uHeat);`);
  };
  const m = new THREE.Mesh(g, mat);
  return { mesh: m, U };
}

export function makeRain(N) {
  const pos = new Float32Array(N * 6); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#cfe2f0', transparent: true, opacity: 0.55, depthWrite: false }));
  m.frustumCulled = false; g.setDrawRange(0, 0);
  return { mesh: m, pos, g, N };
}
export function makeAshFall(N) {
  const pos = new Float32Array(N * 3); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({ color: '#8a847d', size: 0.028, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
  const m = new THREE.Points(g, mat); m.frustumCulled = false; g.setDrawRange(0, 0);
  return { mesh: m, pos, g, mat, N };
}
export function makeEmbers(N) {
  const pos = new Float32Array(N * 3); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({ color: new THREE.Color(4, 1.4, 0.3), size: 0.03, sizeAttenuation: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Points(g, mat); m.frustumCulled = false; g.setDrawRange(0, 0);
  return { mesh: m, pos, g, mat, N };
}

export function makeBolts(W, H) {
  const mats = [new LineMaterial({ color: 0xffffff, linewidth: 3.2, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }), new LineMaterial({ color: 0xffffff, linewidth: 1.6, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending })];
  mats.forEach((m) => { m.resolution.set(W, H); m.color.setRGB(3.5, 3.2, 4.2); });
  const lines = [];
  for (let i = 0; i < 4; i++) { const l = new Line2(new LineGeometry(), mats[i ? 1 : 0]); l.visible = false; l.frustumCulled = false; lines.push(l); }
  return { lines, mats };
}
// jagged bolt points between a and b
export function boltPoints(a, b, seed, segs = 14, jag = 0.18) {
  const r = rng(seed); const pts = [];
  for (let i = 0; i <= segs; i++) { const t = i / segs; const k = Math.sin(Math.PI * t); pts.push(a.x + (b.x - a.x) * t + (r() - 0.5) * jag * 2 * k, a.y + (b.y - a.y) * t + (r() - 0.5) * jag * 0.5 * k, a.z + (b.z - a.z) * t + (r() - 0.5) * jag * 2 * k); }
  return pts;
}
