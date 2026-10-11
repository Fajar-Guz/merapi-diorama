import * as THREE from 'three';
import { BX, BZ, BASE, CEIL } from './terrain.js';
import { NOISE } from './glsl.js';
import { rng } from './noise.js';

export const GX = BX + 0.03, GZ = BZ + 0.03, GTOP = CEIL, GBOT = BASE;
export const PL = { x: GX + 0.42, z: GZ + 0.42, top: BASE, bot: BASE - 1.05 };

function woodTex(dark = false) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const c = cv.getContext('2d'); const r = rng(3);
  c.fillStyle = dark ? '#2a1a10' : '#4a2c18'; c.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 260; i++) { const y = r() * 256; c.strokeStyle = `rgba(${dark ? 10 : 30},${dark ? 5 : 14},0,${0.1 + r() * 0.25})`; c.lineWidth = 0.5 + r() * 2.2; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= 1024; x += 32) c.lineTo(x, y + Math.sin(x * 0.01 + i) * 3 + (r() - 0.5) * 1.5); c.stroke(); }
  for (let i = 0; i < 80; i++) { const y = r() * 256; c.strokeStyle = `rgba(150,90,50,${0.04 + r() * 0.06})`; c.lineWidth = 1 + r() * 3; c.beginPath(); c.moveTo(0, y); c.lineTo(1024, y + (r() - 0.5) * 8); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function plateTex() {
  const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 300; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 300); g.addColorStop(0, '#d9b66a'); g.addColorStop(0.5, '#b88f45'); g.addColorStop(1, '#8e6a2f'); c.fillStyle = g; c.fillRect(0, 0, 1600, 300);
  for (let i = 0; i < 600; i++) { c.fillStyle = `rgba(255,240,200,${Math.random() * 0.05})`; c.fillRect(0, Math.random() * 300, 1600, 1); }
  c.strokeStyle = 'rgba(70,45,10,0.75)'; c.lineWidth = 5; c.strokeRect(22, 22, 1556, 256);
  c.fillStyle = 'rgba(55,35,8,0.92)'; c.textAlign = 'center';
  c.font = '400 108px DMSerif, serif'; c.fillText('MERAPI SLOPE VILLAGE', 800, 150);
  c.font = '600 40px DMSans, sans-serif'; c.fillText('CENTRAL JAVA · YOGYAKARTA, INDONESIA   ·   7.54° S  110.45° E', 800, 228);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// env cube of a dark room with a warm lamp and a soft window
export function makeEnv(renderer) {
  const s = new THREE.Scene(); s.background = new THREE.Color('#0b0a09');
  const wall = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: '#17130f', side: THREE.BackSide })); s.add(wall);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 9, 6) })); lamp.position.set(-14, 9, 8); s.add(lamp);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.42, 0.4) })); win.position.set(18, 5, -10); win.lookAt(0, 0, 0); s.add(win);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(30, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.1) })); strip.position.set(0, 14.5, 0); strip.rotation.x = Math.PI / 2; s.add(strip);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: '#2a1a10' })); floor.rotation.x = -Math.PI / 2; floor.position.y = -6; s.add(floor);
  const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(0.1, 200, rt); cam.position.set(0, 2, 0); cam.update(renderer, s);
  return rt.texture;
}

export function buildVitrine(env) {
  const grp = new THREE.Group();
  // ---- glass ----
  const GU = { uEnv: { value: env }, uTime: { value: 0 }, uFog: { value: 0 }, uRain: { value: 0 }, uLamp: { value: new THREE.Vector3(-14, 9, 8) } };
  const gmat = new THREE.ShaderMaterial({
    uniforms: GU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec2 vSz; uniform float uTime; 
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform samplerCube uEnv; uniform vec3 uLamp; uniform float uTime; varying vec3 vW; varying vec3 vN; varying vec2 vUv; ${NOISE}
      void main(){
        vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN); if (dot(N,V) < 0.0) N = -N;
        // faint waviness
        N = normalize(N + 0.012*vec3(vn2(vW.xy*3.0)-0.5, vn2(vW.yz*3.0)-0.5, vn2(vW.zx*3.0)-0.5));
        float c = max(dot(N,V), 0.0);
        float fr = 0.04 + 0.96*pow(1.0-c, 5.0);
        vec3 R = reflect(-V, N);
        vec3 env = textureCube(uEnv, R).rgb;
        vec3 L = normalize(uLamp - vW); vec3 H = normalize(L+V); float sp = pow(max(dot(N,H),0.0), 600.0)*8.0 + pow(max(dot(N,H),0.0), 60.0)*0.25;
        // glass thickness edge tint near borders of pane
        vec2 e = min(vUv, 1.0-vUv); float edge = 1.0 - smoothstep(0.0, 0.012, min(e.x, e.y));
        float edge2 = 1.0 - smoothstep(0.0, 0.05, min(e.x, e.y));
        vec3 tint = vec3(0.35,0.85,0.75);
        float smudge = smoothstep(0.62, 0.95, fbm2(vW.xy*1.1 + vW.z*0.7)) * 0.018;
        vec3 col = env*fr*1.4 + vec3(sp) + tint*edge*0.55 + tint*edge2*0.04 + vec3(smudge);
        float a = clamp(fr*0.9 + 0.035 + edge*0.65 + edge2*0.03 + smudge + sp*0.5, 0.0, 1.0);
        gl_FragColor = vec4(col/max(a,0.001)*0.999, a);
        gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(20.0));
        #include <colorspace_fragment>
      }`,
  });
  const H = GTOP - GBOT, cy = (GTOP + GBOT) / 2;
  const pane = (w, h, pos, ry, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), gmat); m.position.copy(pos); m.rotation.set(rx, ry, 0); m.renderOrder = 10; grp.add(m); return m; };
  const panes = [
    pane(2 * GX, H, new THREE.Vector3(0, cy, GZ), 0), pane(2 * GX, H, new THREE.Vector3(0, cy, -GZ), Math.PI),
    pane(2 * GZ, H, new THREE.Vector3(GX, cy, 0), Math.PI / 2), pane(2 * GZ, H, new THREE.Vector3(-GX, cy, 0), -Math.PI / 2),
    pane(2 * GX, 2 * GZ, new THREE.Vector3(0, GTOP, 0), 0, -Math.PI / 2),
  ];
  // ---- brass frame ----
  const brass = new THREE.MeshStandardMaterial({ color: '#c49a52', metalness: 1.0, roughness: 0.32, envMap: env, envMapIntensity: 1.6 });
  const tealEdge = new THREE.MeshPhysicalMaterial({ color: '#5fbfa6', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.75, envMap: env, envMapIntensity: 1.2, emissive: '#0d2a24' });
  const t = 0.06;
  const bar = (sx, sy, sz, x, y, z, mat = brass) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.castShadow = true; grp.add(m); return m; };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bar(t, H, t, sx * GX, cy, sz * GZ);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), brass); fin.position.set(sx * GX, GTOP + 0.09, sz * GZ); grp.add(fin);
    const fb = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.05, 12), brass); fb.position.set(sx * GX, GTOP + 0.03, sz * GZ); grp.add(fb);
  }
  for (const s of [-1, 1]) {
    bar(2 * GX + t, t, t, 0, GTOP, s * GZ); bar(t, t, 2 * GZ + t, s * GX, GTOP, 0);
    bar(2 * GX + 0.1, 0.09, 0.09, 0, GBOT + 0.045, s * GZ); bar(0.09, 0.09, 2 * GZ + 0.1, s * GX, GBOT + 0.045, 0);
    // teal glass edges (thickness) along the top
    bar(2 * GX - t, 0.035, 0.035, 0, GTOP - 0.05, s * (GZ - 0.01), tealEdge); bar(0.035, 0.035, 2 * GZ - t, s * (GX - 0.01), GTOP - 0.05, 0, tealEdge);
  }
  // ---- plinth ----
  const wt = woodTex(); wt.repeat.set(1, 1);
  const wood = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.42, metalness: 0.0, envMap: env, envMapIntensity: 0.5 });
  const plH = PL.top - PL.bot;
  const steps = [[PL.x, PL.z, PL.top - 0.38, 0.38], [PL.x + 0.12, PL.z + 0.12, PL.top - 0.38 - 0.47, 0.47], [PL.x + 0.22, PL.z + 0.22, PL.bot, 0.2]];
  for (const [x, z, y0, h] of steps) { const m = new THREE.Mesh(new THREE.BoxGeometry(2 * x, h, 2 * z), wood); m.position.y = y0 + h / 2; m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  // brass trim on plinth
  bar(2 * PL.x + 0.02, 0.035, 2 * PL.z + 0.02, 0, PL.top - 0.02, 0); bar(2 * PL.x + 0.26, 0.03, 2 * PL.z + 0.26, 0, PL.top - 0.38 - 0.02, 0);
  // inner dark felt ring around the soil
  const felt = new THREE.Mesh(new THREE.BoxGeometry(2 * PL.x - 0.02, 0.01, 2 * PL.z - 0.02), new THREE.MeshStandardMaterial({ color: '#15100c', roughness: 1 })); felt.position.y = PL.top + 0.003; felt.receiveShadow = true; grp.add(felt);
  // nameplate
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.48, 0.03), [brass, brass, brass, brass, new THREE.MeshStandardMaterial({ map: plateTex(), metalness: 0.85, roughness: 0.35, envMap: env, envMapIntensity: 1.3 }), brass]);
  plate.position.set(0, PL.top - 0.38 - 0.24, PL.z + 0.12 + 0.016); grp.add(plate);
  for (const s of [-1, 1]) { const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 10), brass); sc.rotation.x = Math.PI / 2; sc.position.set(s * 1.2, plate.position.y, plate.position.z + 0.02); grp.add(sc); }
  return { grp, gmat, GU, brass, panes };
}

export function buildRoom(env) {
  const grp = new THREE.Group();
  // baked-light table: wood grain * warm pool of light around the vitrine
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024; const c = cv.getContext('2d'); const r = rng(5);
  c.fillStyle = '#2a1a10'; c.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 900; i++) { const y = r() * 1024; c.strokeStyle = `rgba(${12 + r() * 30},${6 + r() * 14},0,${0.15 + r() * 0.3})`; c.lineWidth = 0.6 + r() * 3; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= 2048; x += 64) c.lineTo(x, y + Math.sin(x * 0.004 + i) * 6 + (r() - 0.5) * 2); c.stroke(); }
  for (let k = 0; k < 14; k++) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, k * 74, 2048, 2); }
  const g = c.createRadialGradient(1024, 560, 30, 1024, 560, 900); g.addColorStop(0, 'rgba(255,200,140,0.28)'); g.addColorStop(0.35, 'rgba(255,190,130,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
  c.globalCompositeOperation = 'source-over'; c.fillStyle = g; c.fillRect(0, 0, 2048, 1024);
  const sh = c.createRadialGradient(1024, 512, 120, 1024, 512, 330); sh.addColorStop(0, 'rgba(0,0,0,0.85)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = sh; c.fillRect(0, 0, 2048, 1024);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.75, 0.68, 0.62) }));
  table.rotation.x = -Math.PI / 2; table.position.y = PL.bot + 0.002; grp.add(table);
  const wcv = document.createElement('canvas'); wcv.width = 512; wcv.height = 256; const w = wcv.getContext('2d'); const wg = w.createRadialGradient(150, 60, 10, 220, 120, 420); wg.addColorStop(0, '#3a2c20'); wg.addColorStop(0.5, '#17120e'); wg.addColorStop(1, '#090807'); w.fillStyle = wg; w.fillRect(0, 0, 512, 256);
  const wt = new THREE.CanvasTexture(wcv); wt.colorSpace = THREE.SRGBColorSpace;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(140, 60), new THREE.MeshBasicMaterial({ map: wt }));
  wall.position.set(0, 25, -15); grp.add(wall);
  return grp;
}
