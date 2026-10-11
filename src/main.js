import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, DepthOfFieldEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, HueSaturationEffect, BrightnessContrastEffect } from 'postprocessing';
import { BX, BZ, CEIL, CONE, PYRO, PYRO_L, RIVER, RIVER_L, ASSEMBLY, buildTerrain, buildSides, buildWater, buildRiver, makeMaps, mapUniforms, hFast } from './terrain.js';
import { buildProps, buildSigns, buildVegetation, buildVillagers, buildTruck, ROAD, ROAD_L } from './props.js';
import { makeEnv, buildVitrine, buildRoom, PL } from './box.js';
import { Puffs, makeAtlas, makeCloud, makeDome, makeRain, makeAshFall, makeEmbers, makeBolts, boltPoints } from './fx.js';
import { Sim, DT } from './sim.js';
import * as S from './script.js';
import { polyAt, smooth, clamp, lerp } from './noise.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const W = RENDER ? +(params.get('w') || 1920) : innerWidth, H = RENDER ? +(params.get('h') || 1080) : innerHeight;
if (RENDER) document.body.classList.add('render');
const UIS = RENDER ? W / 1920 : 1;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: RENDER, stencil: false });
renderer.setPixelRatio(RENDER ? 1 : Math.min(devicePixelRatio, 1.75));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a0908');
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 400);
const env = makeEnv(renderer);

// ---------- world ----------
const maps = makeMaps(); mapUniforms.uAshMap.value = maps.tex; mapUniforms.uWindMap.value = maps.wtex;
const box = new THREE.Group(); scene.add(box);
const terrain = buildTerrain(); box.add(terrain);
const sides = buildSides(); box.add(sides);
const water = buildWater(env); box.add(water.lake); box.add(water.sec);
const river = buildRiver(water.U); box.add(river.mesh);
const props = buildProps(); box.add(props.mesh); box.add(props.wmesh);
const signs = buildSigns(); box.add(signs.grp);
const veg = buildVegetation(); box.add(veg.grp);
const vil = buildVillagers(); box.add(vil.bm, vil.hm, vil.tm);
const truck = buildTruck(); box.add(truck);
const dome = makeDome(); dome.mesh.position.set(CONE[0], 3.2, CONE[1]); box.add(dome.mesh);
const vit = buildVitrine(env); box.add(vit.grp);
scene.add(buildRoom(env));
// clouds
const clouds = [makeCloud(3, 1.0), makeCloud(8, 1.05), makeCloud(13, 0.85)]; clouds.forEach((c) => box.add(c.grp));
// fx
const atlas = makeAtlas();
const smoke = new Puffs(1400, atlas); smoke.mesh.renderOrder = 5; box.add(smoke.mesh);
const rain = makeRain(2600); rain.mesh.renderOrder = 6; box.add(rain.mesh);
const ashf = makeAshFall(2600); ashf.mesh.renderOrder = 6; box.add(ashf.mesh);
const embers = makeEmbers(400); embers.mesh.renderOrder = 6; box.add(embers.mesh);
const streaks = makeRain(300); streaks.mesh.material.color.set('#ffffff'); streaks.mesh.material.opacity = 0.5; box.add(streaks.mesh);
const bolts = makeBolts(W, H); bolts.lines.forEach((l) => { l.renderOrder = 7; box.add(l); });
// glare sprite (room lamp)
const glare = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d'); const g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,240,215,1)'); g.addColorStop(0.08, 'rgba(255,225,180,0.85)'); g.addColorStop(0.3, 'rgba(255,200,140,0.18)'); g.addColorStop(1, 'rgba(255,200,140,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 256); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), color: new THREE.Color(2.2, 2.0, 1.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.set(5, 5, 1); sp.position.set(-13, 10.5, -16); return sp; })();
scene.add(glare);

// ---------- lights ----------
const sun = new THREE.DirectionalLight('#ffffff', 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7.5, right: 7.5, top: 7.5, bottom: -7.5, near: 1, far: 50 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2.5;
box.add(sun); box.add(sun.target);
const hemi = new THREE.HemisphereLight('#cfe0ff', '#6b5a40', 1); scene.add(hemi);
const lamp = new THREE.SpotLight('#ffd9a8', 900, 0, 0.5, 0.7, 2); lamp.position.set(-12, 11, 12); lamp.target.position.set(0, 0, 0); scene.add(lamp, lamp.target);
const rim = new THREE.DirectionalLight('#9fb7d9', 0.35); rim.position.set(10, 6, -12); scene.add(rim);
const lavaL = new THREE.PointLight('#ff6a22', 0, 9, 2); lavaL.position.set(CONE[0], 3.7, CONE[1]); box.add(lavaL);
const flashL = new THREE.PointLight('#c9d4ff', 0, 14, 1.5); box.add(flashL);
const villageL = new THREE.PointLight('#ffb466', 0, 3.5, 2); villageL.position.set(3.0, 0.9, 1.0); box.add(villageL);

// ---------- post ----------
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: Math.min(4, renderer.capabilities.maxSamples || 4) });
composer.addPass(new RenderPass(scene, camera));
const dof = new DepthOfFieldEffect(camera, { focusDistance: 20, focusRange: 6, bokehScale: 2.2, resolutionScale: 0.6 });
const bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 0.78, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
const sat = new HueSaturationEffect({ saturation: 0.06 });
const bc = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.06 });
composer.addPass(new EffectPass(camera, dof));
composer.addPass(new EffectPass(camera, bloom, vignette, tone, sat, bc));

// ---------- sim ----------
let sim; function resetSim() { maps.ash.fill(0); maps.wind.fill(0); sim = new Sim(maps, vil); sim.frame = -1; }
resetSim();

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = { cursor: $('cursor'), cs: { arrow: $('c-arrow'), open: $('c-open'), grab: $('c-grab'), brush: $('c-brush') }, ripple: $('ripple'), ring: $('brushring'), knob: $('knob'), slider: $('slider'), seasonv: $('seasonv'), end: $('end'), fade: $('fade'), stxt: $('stxt'), sdot: $('sdot'), bar: $('bar'), title: $('title'), status: $('status'), ann: { pyro: $('a-pyro'), assembly: $('a-assembly'), lahar: $('a-lahar') } };
if (RENDER) { document.getElementById('ui').style.transform = `scale(${UIS})`; document.getElementById('ui').style.transformOrigin = '0 0'; document.getElementById('ui').style.width = 1920 + 'px'; document.getElementById('ui').style.height = 1080 + 'px'; }
S.ANNOT.forEach((a) => (ui.ann[a.key].textContent = a.text));
const STAT = [['Normal', '#58c47a'], ['Advisory', '#e8c547'], ['Alert', '#ef8a3a'], ['Warning', '#e5483b']];

// ---------- helpers ----------
const V3 = new THREE.Vector3(), tmpC = new THREE.Color();
const toWorld = (x, y, z) => box.localToWorld(new THREE.Vector3(x, y, z));
const project = (w) => { const p = w.clone().project(camera); return [(p.x * 0.5 + 0.5) * (RENDER ? 1920 : W), (-p.y * 0.5 + 0.5) * (RENDER ? 1080 : H), p.z]; };
const elCenter = (id) => { const r = $(id).getBoundingClientRect(); return [(r.left + r.width / 2) / UIS, (r.top + r.height / 2) / UIS]; };
const C = (r, g, b) => new THREE.Color(r, g, b);
const LK = [
  { el: 52, az: 40, col: C(1, 0.95, 0.88), I: 3.1, sky: C(0.72, 0.82, 1.0), gr: C(0.42, 0.36, 0.27), hI: 1.05, lamp: 900 },
  { el: 9, az: 75, col: C(1, 0.58, 0.32), I: 2.3, sky: C(0.75, 0.52, 0.5), gr: C(0.3, 0.22, 0.18), hI: 0.6, lamp: 800 },
  { el: 46, az: -50, col: C(0.5, 0.64, 1.0), I: 0.28, sky: C(0.16, 0.22, 0.42), gr: C(0.05, 0.05, 0.07), hI: 0.24, lamp: 380 },
];
function lightAt(tod) {
  const k = clamp(tod, 0, 1) * 2; const i = Math.min(1, Math.floor(k)); const u = k - i; const a = LK[i], b = LK[i + 1];
  const dir = (o) => { const e = THREE.MathUtils.degToRad(o.el), z = THREE.MathUtils.degToRad(o.az); return new THREE.Vector3(Math.sin(z) * Math.cos(e), Math.sin(e), Math.cos(z) * Math.cos(e)); };
  return { dir: dir(a).lerp(dir(b), u).normalize(), col: a.col.clone().lerp(b.col, u), I: lerp(a.I, b.I, u), sky: a.sky.clone().lerp(b.sky, u), gr: a.gr.clone().lerp(b.gr, u), hI: lerp(a.hI, b.hI, u), lamp: lerp(a.lamp, b.lamp, u) };
}

// ---------- per-frame visual update ----------
const camLocal = new THREE.Vector3(); const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
let flashPos = new THREE.Vector3();
function updateVisuals(t, cl, tod, season, shakeOff) {
  const night = smooth(0.45, 0.95, tod);
  const Lt = lightAt(tod);
  mapUniforms.uTime.value = t; mapUniforms.uSeason.value = season; mapUniforms.uNight.value = night;
  mapUniforms.uBreeze.value.set(sim.windAvg.x * 0.5, sim.windAvg.y * 0.5);
  maps.upload();
  box.position.set(shakeOff, 0, 0); box.rotation.z = shakeOff * 0.02; box.updateMatrixWorld(true);
  // lights
  sun.position.copy(Lt.dir).multiplyScalar(22); sun.target.position.set(0, 0, 0); sun.color.copy(Lt.col); sun.intensity = Lt.I;
  hemi.color.copy(Lt.sky); hemi.groundColor.copy(Lt.gr); hemi.intensity = Lt.hI; lamp.intensity = Lt.lamp;
  const heat = sim.heat; dome.U.uHeat.value = heat; dome.U.uTime.value = t; mapUniforms.uHeat.value = heat;
  lavaL.intensity = (0.4 + 2.6 * night) * smooth(0.12, 1, heat) * 9 * (0.85 + 0.15 * Math.sin(t * 7));
  flashL.intensity = sim.flash * 35; flashL.position.copy(flashPos);
  villageL.intensity = night * 1.2;
  props.wmat.color.copy(C(0.2, 0.13, 0.08)).lerp(C(3.2, 1.9, 0.8), night);
  signs.plates.forEach((p) => (p.material.emissiveIntensity = night * 0.5));
  // water
  water.U.uMud.value = sim.mud; water.U.uAmb.value = lerp(1.0, 0.16, night); water.U.uSun.value.copy(Lt.dir); water.U.uSunCol.value.copy(Lt.col).multiplyScalar(Lt.I * 0.35);
  river.RU.uFront.value = sim.front; river.RU.uLahar.value = sim.lahar;
  // clouds
  cl.forEach((c, i) => {
    const cg = clouds[i]; cg.grp.position.set(c.x, c.y, c.z);
    const sq = c.sq; const wob = Math.sin(t * 13 + i) * 0.03 * sq;
    cg.inner.scale.set((1 - 0.16 * sq + wob) * c.s, (1 - 0.24 * sq - wob) * c.s, (1 - 0.14 * sq) * c.s);
    cg.mat.color.copy(C(1, 1, 1)).lerp(C(0.55, 0.6, 0.68), sq * 0.9).multiplyScalar(lerp(1, 0.55, night));
    cg.mat.emissive.copy(C(1, 1, 1)).multiplyScalar(lerp(0.12, 0.02, night)); cg.mat.emissive.lerp(C(1, 0.4, 0.15), night * heat * 0.25);
  });
  // smoke
  camLocal.copy(camera.position); box.worldToLocal(camLocal);
  smoke.U.uLight.value.copy(Lt.col).multiplyScalar(Lt.I * 0.2 + 0.05); smoke.U.uAmb.value.copy(Lt.sky).multiplyScalar(Lt.hI * 0.32).add(C(0.04, 0.035, 0.03));
  const fl = sim.flash;
  smoke.p = sim.smoke;
  smoke.write(camLocal, (p, i, off, col, glow, sr) => {
    off[i * 3] = p.x; off[i * 3 + 1] = p.y; off[i * 3 + 2] = p.z;
    let r, g, b, gr = 0, gg = 0, gb = 0;
    if (p.k === 0) { r = 0.95; g = 0.94; b = 0.93; }
    else if (p.k === 1) { const f = p.age / p.life; const nb = (1 + night * 0.9) * (0.72 + 0.56 * p.br); r = lerp(0.4, 0.6, f) * nb; g = lerp(0.37, 0.57, f) * nb; b = lerp(0.35, 0.54, f) * nb; const hg = heat * (1 - smooth(3.5, 4.9, p.y)) * (0.25 + 1.1 * night) * Math.max(0, 1 - f * 1.6) * 2.2; gr = hg; gg = hg * 0.36; gb = hg * 0.08; }
    else { r = 0.86 * (1 + night); g = 0.82 * (1 + night); b = 0.77 * (1 + night); const hg = (1 - smooth(0.08, 0.6, p.s)) * (0.3 + 1.0 * night) * heat * 1.7; gr = hg; gg = hg * 0.4; gb = hg * 0.1; }
    if (fl > 0.02) { const d2 = (p.x - flashPos.x) ** 2 + (p.y - flashPos.y) ** 2 + (p.z - flashPos.z) ** 2; const f2 = fl * 2.2 * Math.exp(-d2 / 1.6); gr += f2 * 0.8; gg += f2 * 0.85; gb += f2 * 1.0; }
    col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = p.alpha;
    glow[i * 3] = gr; glow[i * 3 + 1] = gg; glow[i * 3 + 2] = gb;
    sr[i * 3] = p.size; sr[i * 3 + 1] = p.rot; sr[i * 3 + 2] = p.v + 0.5;
  });
  // rain
  { const P = rain.pos; const R = sim.rain; const n = Math.min(R.length, rain.N); for (let i = 0; i < n; i++) { const d = R[i]; P[i * 6] = d.x; P[i * 6 + 1] = d.y; P[i * 6 + 2] = d.z; P[i * 6 + 3] = d.x - 0.004; P[i * 6 + 4] = d.y + 0.085; P[i * 6 + 5] = d.z; } rain.g.attributes.position.needsUpdate = true; rain.g.setDrawRange(0, n * 2); rain.mesh.material.opacity = lerp(0.5, 0.3, night); }
  { const P = ashf.pos; const A = sim.ashf; const n = Math.min(A.length, ashf.N); for (let i = 0; i < n; i++) { P[i * 3] = A[i].x; P[i * 3 + 1] = A[i].y; P[i * 3 + 2] = A[i].z; } ashf.g.attributes.position.needsUpdate = true; ashf.g.setDrawRange(0, n); ashf.mat.color.copy(C(0.55, 0.52, 0.49)).multiplyScalar(lerp(1, 0.35, night)); }
  { const P = embers.pos; const Em = sim.embers; const n = Math.min(Em.length, embers.N); for (let i = 0; i < n; i++) { const e = Em[i]; const q = polyAt(PYRO, PYRO_L, e.s); const x = q.x - q.tz * e.off, z = q.z + q.tx * e.off; P[i * 3] = x; P[i * 3 + 1] = hFast(x, z) + 0.03 + Math.abs(Math.sin(e.age * 8 + e.b * 6)) * 0.04; P[i * 3 + 2] = z; } embers.g.attributes.position.needsUpdate = true; embers.g.setDrawRange(0, n); embers.mat.opacity = 0.35 + 0.65 * night; }
  { const P = streaks.pos; const Sx = sim.streaks; const n = Math.min(Sx.length, streaks.N); for (let i = 0; i < n; i++) { const s = Sx[i]; const k = Math.sin(Math.PI * s.age / s.life); P[i * 6] = s.x; P[i * 6 + 1] = s.y; P[i * 6 + 2] = s.z; P[i * 6 + 3] = s.x - s.vx * 0.12 * k; P[i * 6 + 4] = s.y; P[i * 6 + 5] = s.z - s.vz * 0.12 * k; } streaks.g.attributes.position.needsUpdate = true; streaks.g.setDrawRange(0, n * 2); }
  // bolts
  bolts.lines.forEach((l) => (l.visible = false));
  sim.bolts.forEach((b, bi) => {
    if (bi > 1) return; const vis = b.age < 0.07 || (b.age > 0.12 && b.age < 0.2) || (b.age > 0.24 && b.age < 0.28);
    const main = bolts.lines[bi * 2], br = bolts.lines[bi * 2 + 1];
    const pts = boltPoints(b.a, b.b, b.seed, 16, 0.3); main.geometry.dispose(); main.geometry = new (main.geometry.constructor)(); main.geometry.setPositions(pts); main.computeLineDistances(); main.visible = vis;
    const mid = Math.floor(pts.length / 3 / 2) * 3; const a2 = { x: pts[mid], y: pts[mid + 1], z: pts[mid + 2] }; const b2 = { x: a2.x + 0.6, y: a2.y - 0.5, z: a2.z + 0.3 };
    br.geometry.dispose(); br.geometry = new (br.geometry.constructor)(); br.geometry.setPositions(boltPoints(a2, b2, b.seed + 7, 8, 0.15)); br.visible = vis && b.age < 0.2;
    flashPos.set((b.a.x + b.b.x) / 2, (b.a.y + b.b.y) / 2, (b.a.z + b.b.z) / 2);
  });
  // villagers
  const VP = sim.vpos || [];
  VP.forEach((v, i) => {
    q4.setFromEuler(e4.set(0, v.a, 0)); m4.compose(p3.set(v.x, v.y, v.z), q4, s3.set(1, 1, 1));
    vil.bm.setMatrixAt(i, m4); vil.hm.setMatrixAt(i, m4); m4.compose(p3.set(v.x, v.y, v.z), q4, s3.setScalar(v.hat ? 1 : 0)); vil.tm.setMatrixAt(i, m4);
  });
  vil.bm.instanceMatrix.needsUpdate = vil.hm.instanceMatrix.needsUpdate = vil.tm.instanceMatrix.needsUpdate = true;
  // truck along road
  { const u = 0.2 + sim.truck.s * 0.74; const q = polyAt(ROAD, ROAD_L, u); truck.position.set(q.x, hFast(q.x, q.z) + 0.004, q.z); truck.rotation.y = Math.atan2(-q.tz, q.tx); }
  // glass pane sort: far panes before interior transparents
  vit.panes.forEach((p) => { p.getWorldPosition(V3); const n = new THREE.Vector3(0, 0, 1).applyQuaternion(p.getWorldQuaternion(new THREE.Quaternion())); const facing = n.dot(camera.position.clone().sub(V3)) > 0; p.renderOrder = facing ? 10 : 0.5; });
  vit.GU.uTime.value = t;
}

function setCamera(cs, t, rumble) {
  const a = THREE.MathUtils.degToRad(cs.az), e = THREE.MathUtils.degToRad(cs.el);
  camera.position.set(cs.tg[0] + Math.sin(a) * Math.cos(e) * cs.d, cs.tg[1] + Math.sin(e) * cs.d, cs.tg[2] + Math.cos(a) * Math.cos(e) * cs.d);
  camera.position.x += Math.sin(t * 0.7) * 0.05 + (Math.sin(t * 37) + Math.sin(t * 51)) * 0.01 * rumble; camera.position.y += Math.sin(t * 0.9 + 1) * 0.04 + Math.sin(t * 43) * 0.012 * rumble;
  camera.lookAt(cs.tg[0], cs.tg[1], cs.tg[2]);
  if (camera.fov !== cs.fov) { camera.fov = cs.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld(true);
  const fd = camera.position.distanceTo(V3.set(...cs.tg));
  dof.cocMaterial.focusDistance = fd; dof.cocMaterial.focusRange = Math.max(2.5, fd * 0.3); dof.bokehScale = cs.d < 12 ? 3.0 : 2.2;
}

// ---------- scripted (video) ----------
function scriptInputs(t) {
  const cl = S.cloudsAt(t);
  const wind = [];
  if (t >= S.BRUSH_T[0] && t <= S.BRUSH_T[1]) { const a = S.brushAt(t), b = S.brushAt(t - DT); const dx = (a[0] - b[0]) / DT, dz = (a[1] - b[1]) / DT; const sp = Math.hypot(dx, dz) || 1; const k = Math.min(1.6, sp * 0.6); wind.push([a[0], a[1], (dx / sp) * k, (dz / sp) * k]); }
  const bolt = S.BOLTS.some((b) => t >= b && t < b + DT * 0.999);
  return { clouds: cl, wind, shake: S.shakeAt(t), tod: S.todAt(t), season: S.seasonAt(t), recover: t >= S.CLICKS.recover, bolt, calm: t > 33.5 };
}
function stepTo(f) {
  if (f < sim.frame) resetSim();
  while (sim.frame < f) { sim.frame++; const t = sim.frame / S.FPS; sim.step(scriptInputs(t)); }
}
function resolveTarget(tg, t) {
  if (tg.screen) return tg.screen;
  if (tg.el) return elCenter(tg.el);
  if (tg.slider) { const r = ui.knob.getBoundingClientRect(); return [(r.left + r.width / 2) / UIS, (r.top + r.height / 2) / UIS]; }
  if (tg.cloud !== undefined) { const c = clouds[tg.cloud].grp; c.updateMatrixWorld(); const w = c.getWorldPosition(new THREE.Vector3()); w.y -= 0.05; return project(w); }
  if (tg.brush) { const [x, z] = S.brushAt(t); return project(toWorld(x, hFast(x, z) + 0.32, z)); }
  if (tg.world) return project(toWorld(...tg.world));
  if (tg.shake) return project(toWorld(...S.SHAKE_PT));
  return [960, 540];
}
function updateUI(t, tod, season) {
  // slider knob
  ui.knob.style.left = (tod * 100).toFixed(2) + '%';
  ui.seasonv.textContent = season > 0.5 ? 'Dry' : 'Rainy';
  const on = (id, v) => $(id).classList.toggle('on', !!v);
  on('p-wind', t >= S.CLICKS.wind && t < 17.8); on('p-shake', t >= S.SHAKE_T[0] && t < S.SHAKE_T[1]); on('p-squeeze', (t > 9.1 && t < 12.4) || (t > 39.4 && t < 44.5));
  on('p-recover', t >= S.CLICKS.recover && t < 49); on('p-season', (t >= 18.3 && t < 19.3) || (t >= 46.9 && t < 47.9)); on('p-day', (t >= 20.75 && t < 23.3) || (t >= 34.6 && t < 36.7));
  // cursor
  const mode = S.cursorMode(t); const alpha = S.cursorAlpha(t);
  const ct = S.curTargetAt(t); const A = resolveTarget(ct.a, t), B = resolveTarget(ct.b, t);
  let x = lerp(A[0], B[0], ct.k), y = lerp(A[1], B[1], ct.k);
  if (t >= S.SHAKE_T[0] && t < S.SHAKE_T[1]) { x += S.shakeOsc(t) * 70; y += Math.sin(t * 31) * 6 * S.shakeAt(t); }
  for (const k of Object.keys(ui.cs)) ui.cs[k].style.display = k === (mode === 'hidden' ? 'arrow' : mode) ? 'block' : 'none';
  const sq = Math.max(...S.cloudsAt(t).map((c) => c.sq));
  const sc = mode === 'grab' ? 1 - 0.12 * sq : 1;
  const off = mode === 'arrow' ? [11.7, 6.5] : [26, 23];
  ui.cursor.style.opacity = mode === 'hidden' ? 0 : alpha;
  ui.cursor.style.transform = `translate(${x - off[0]}px, ${y - off[1]}px) scale(${sc})`;
  ui.ring.style.opacity = mode === 'brush' ? alpha : 0; ui.ring.style.left = x + 'px'; ui.ring.style.top = y + 'px';
  // ripples
  const clicks = [S.CLICKS.wind, S.CLICKS.season, S.CLICKS.slider1[0], S.CLICKS.slider2[0], S.CLICKS.recover, 6.95, 37.6, 24.3];
  let rp = 0; for (const c of clicks) { const d = t - c; if (d >= 0 && d < 0.5) rp = d / 0.5; }
  ui.ripple.style.opacity = rp > 0 ? (1 - rp) * 0.9 : 0; ui.ripple.style.left = x + 'px'; ui.ripple.style.top = y + 'px'; ui.ripple.style.transform = `scale(${0.4 + rp})`;
  // annotations
  for (const a of S.ANNOT) {
    const el = ui.ann[a.key]; const k = clamp((t - a.t0) / 0.4, 0, 1) * clamp((a.t1 - t) / 0.4, 0, 1); el.style.opacity = k;
    if (k <= 0) continue;
    let w;
    if (a.key === 'pyro') { const q = polyAt(PYRO, PYRO_L, 0.6); w = toWorld(q.x, hFast(q.x, q.z) + 1.05, q.z); }
    else if (a.key === 'assembly') w = toWorld(ASSEMBLY.x, hFast(ASSEMBLY.x, ASSEMBLY.z) + 0.42, ASSEMBLY.z);
    else { const q = polyAt(RIVER, RIVER_L, clamp(sim.front - 0.06, 0.05, 0.9)); w = toWorld(q.x, hFast(q.x, q.z) + 0.55, q.z); }
    const [sx, sy] = project(w); el.style.transform = `translate(${sx}px, ${sy - 26}px) translate(-50%,-100%)`;
  }
  // status
  const st = sim.recoverT >= 0 && sim.erupt < 0.15 ? 0 : S.statusAt(Math.max(sim.erupt, sim.pyroT >= 0 && sim.recoverT < 0 ? 0.6 : 0));
  ui.stxt.textContent = STAT[st][0]; ui.sdot.style.background = STAT[st][1]; ui.sdot.style.color = STAT[st][1];
  // end card
  const ek = clamp((t - 52.3) / 1.0, 0, 1); ui.end.style.opacity = ek;
  for (const el of [ui.bar, ui.title, ui.status]) el.style.opacity = 1 - ek;
  ui.fade.style.opacity = clamp((t - 56.3) / 0.7, 0, 1) + clamp(1 - t / 0.6, 0, 1);
}
function renderScripted(f) {
  stepTo(f); const t = f / S.FPS;
  const cs = S.camAt(t); const cl = S.cloudsAt(t);
  const rumble = S.shakeAt(t) + sim.erupt * 0.5 * (t < 34 ? 1 : 0.4);
  setCamera(cs, t, rumble);
  updateVisuals(t, cl, S.todAt(t), S.seasonAt(t), S.shakeOsc(t) * 0.07 + (Math.sin(t * 41) * 0.004) * sim.erupt);
  updateUI(t, S.todAt(t), S.seasonAt(t));
  composer.render(DT);
}

const ready = document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 50)));
if (RENDER) {
  window.renderAt = async (f) => { await ready; renderScripted(f); return true; };
  window.ready = ready.then(() => true);
  window.DURATION = S.DURATION; window.FPS = S.FPS;
  window.renderStill = async (f) => { await ready; renderScripted(f); return true; };
} else {
  ready.then(() => import('./live.js').then((m) => m.startLive({ THREE, renderer, composer, camera, scene, box, clouds, terrain, sides, sim: () => sim, resetSim, updateVisuals, dof, ui, $, project, toWorld, vit, OrbitControls, bolts, STAT })));
}
