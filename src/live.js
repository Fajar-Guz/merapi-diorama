import { DT } from './sim.js';
import { CLOUD_BASE, ANNOT, statusAt } from './script.js';
import { BX, BZ, PYRO, PYRO_L, RIVER, RIVER_L, ASSEMBLY, hFast } from './terrain.js';
import { polyAt, clamp, lerp } from './noise.js';

export function startLive(ctx) {
  const { THREE, renderer, composer, camera, box, clouds, terrain, sides, updateVisuals, dof, ui, $, project, toWorld, vit, OrbitControls, bolts, STAT } = ctx;
  const sim = () => ctx.sim();
  const el = renderer.domElement;
  ui.cursor.style.display = 'none'; ui.ring.style.display = 'block';
  camera.fov = 30; camera.updateProjectionMatrix();
  const controls = new OrbitControls(camera, el);
  controls.target.set(0, 1.5, 0); camera.position.set(-15, 10.5, 20); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 7; controls.maxDistance = 42; controls.maxPolarAngle = Math.PI * 0.53; controls.enablePan = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  // ---- state ----
  const cl = CLOUD_BASE.map((p, i) => ({ x: p[0], y: p[1], z: p[2], sq: 0, s: [1, 1.05, 0.85][i], grab: false, home: p.slice() }));
  let tool = 'hand', tod = 0, todTarget = 0, season = 0, seasonT = 0, recover = false, recoverAt = -1, autoShake = 0, lastShakeT = -99;
  let drag = null; let shakeOff = 0, shakeVel = 0, shakeIn = 0; const windQ = [];
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const cloudMeshes = clouds.map((c, i) => { const ms = []; c.inner.traverse((o) => { if (o.isMesh) { o.userData.cloud = i; ms.push(o); } }); return ms; }).flat();
  const boxMeshes = [terrain, sides]; vit.grp.traverse((o) => { if (o.isMesh) boxMeshes.push(o); });
  const setNdc = (e) => { const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  const planeHit = (y) => { const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y); const w = new THREE.Vector3(); return ray.ray.intersectPlane(pl, w) ? box.worldToLocal(w) : null; };
  const now = () => sim().t;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; setNdc(e);
    const hc = ray.intersectObjects(cloudMeshes, false)[0];
    if (hc && tool === 'hand') { const i = hc.object.userData.cloud; drag = { kind: 'cloud', i, lastX: e.clientX, lastY: e.clientY, still: 0, lastMove: performance.now() }; cl[i].grab = true; }
    else {
      const hb = ray.intersectObjects(boxMeshes, false)[0];
      if (hb && tool === 'wind') { const p = box.worldToLocal(hb.point.clone()); drag = { kind: 'wind', last: p, lt: performance.now() }; }
      else if (hb) drag = { kind: 'shake', x0: e.clientX, lastX: e.clientX, lt: performance.now() };
    }
    if (drag) { controls.enabled = false; el.setPointerCapture(e.pointerId); e.stopPropagation(); }
  }, true);
  el.addEventListener('pointermove', (e) => {
    ui.ring.style.left = e.clientX + 'px'; ui.ring.style.top = e.clientY + 'px';
    if (!drag) { el.style.cursor = tool === 'wind' ? 'none' : 'grab'; return; }
    setNdc(e);
    if (drag.kind === 'cloud') {
      const c = cl[drag.i]; const p = planeHit(c.y); const mv = Math.hypot(e.clientX - drag.lastX, e.clientY - drag.lastY);
      if (p) { c.x = clamp(p.x, -BX + 0.8, BX - 0.8); c.z = clamp(p.z, -BZ + 0.6, BZ - 0.6); }
      if (mv > 3) drag.lastMove = performance.now(); drag.lastX = e.clientX; drag.lastY = e.clientY;
    } else if (drag.kind === 'wind') {
      const hb = ray.intersectObject(terrain, false)[0]; if (!hb) return; const p = box.worldToLocal(hb.point.clone());
      const tt = performance.now(); const dt = Math.max(0.016, (tt - drag.lt) / 1000); const dx = (p.x - drag.last.x) / dt, dz = (p.z - drag.last.z) / dt; const sp = Math.hypot(dx, dz);
      if (sp > 0.05) { const k = Math.min(1.6, sp * 0.5); windQ.push([p.x, p.z, (dx / sp) * k, (dz / sp) * k]); }
      drag.last = p; drag.lt = tt;
    } else if (drag.kind === 'shake') {
      const tt = performance.now(); const dt = Math.max(0.008, (tt - drag.lt) / 1000); const v = Math.abs(e.clientX - drag.lastX) / dt;
      shakeIn = Math.max(shakeIn, clamp(v / 1400, 0, 1)); shakeOff = clamp((e.clientX - drag.x0) * 0.0006, -0.12, 0.12); drag.lastX = e.clientX; drag.lt = tt; lastShakeT = now();
    }
  });
  const up = () => { if (drag && drag.kind === 'cloud') cl[drag.i].grab = false; drag = null; controls.enabled = true; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  // ---- pills ----
  const pill = (id, fn) => $(id).addEventListener('click', fn);
  pill('p-shake', () => { autoShake = 2.6; });
  pill('p-squeeze', () => { const c = cl[0]; c.autoSq = 3.5; });
  pill('p-wind', () => { tool = tool === 'wind' ? 'hand' : 'wind'; $('p-wind').classList.toggle('on', tool === 'wind'); });
  pill('p-season', () => { seasonT = seasonT > 0.5 ? 0 : 1; });
  pill('p-recover', () => { if (recoverAt < 0) { recover = true; recoverAt = now(); $('p-recover').classList.add('on'); } });
  const slider = $('slider'); let sdrag = false;
  const setTod = (e) => { const r = slider.getBoundingClientRect(); todTarget = clamp((e.clientX - r.left) / r.width, 0, 1); };
  $('p-day').addEventListener('pointerdown', (e) => { sdrag = true; setTod(e); $('p-day').setPointerCapture(e.pointerId); });
  $('p-day').addEventListener('pointermove', (e) => { if (sdrag) setTod(e); });
  $('p-day').addEventListener('pointerup', () => (sdrag = false));
  addEventListener('keydown', (e) => { if (e.key === 's') autoShake = 2.6; if (e.key === 'w') $('p-wind').click(); if (e.key === 'r') $('p-recover').click(); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); bolts.mats.forEach((m) => m.resolution.set(innerWidth, innerHeight)); });
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); bolts.mats.forEach((m) => m.resolution.set(innerWidth, innerHeight));
  // ---- loop ----
  let acc = 0, last = performance.now();
  const V = new THREE.Vector3();
  const loop = () => {
    const tnow = performance.now(); acc += Math.min(0.1, (tnow - last) / 1000); last = tnow;
    while (acc >= DT) {
      acc -= DT; const s = sim();
      tod = lerp(tod, todTarget, 0.06); season += clamp(seasonT - season, -DT / 2, DT / 2);
      if (autoShake > 0) { autoShake -= DT; shakeIn = Math.max(shakeIn, 0.9); lastShakeT = s.t; shakeOff = Math.sin(s.t * Math.PI * 2 * 4.2) * 0.07; }
      for (const c of cl) {
        if (c.autoSq > 0) { c.autoSq -= DT; c.grab = true; }
        const holding = (drag && drag.kind === 'cloud' && cl[drag.i] === c && performance.now() - drag.lastMove > 220) || c.autoSq > 0;
        c.sq = clamp(c.sq + (holding ? 2.2 : -3) * DT, 0, 1); if (c.autoSq <= 0 && !(drag && drag.kind === 'cloud' && cl[drag.i] === c)) c.grab = false;
        if (!c.grab) { c.x += Math.sin(s.t * 0.3 + c.home[0]) * 0.002 + s.windAvg.x * 0.004; c.z += s.windAvg.y * 0.004; c.x = clamp(c.x, -BX + 0.8, BX - 0.8); c.z = clamp(c.z, -BZ + 0.6, BZ - 0.6); }
      }
      const calm = s.ignited && s.t - lastShakeT > 9;
      s.step({ clouds: cl, wind: windQ.splice(0), shake: shakeIn, tod, season, recover, autoBolt: true, calm });
      shakeIn *= 0.8; if (!drag || drag.kind !== 'shake') shakeOff *= 0.82;
      if (recoverAt >= 0 && s.t - recoverAt > 11) { recover = false; recoverAt = -1; $('p-recover').classList.remove('on'); ctx.resetSim(); sim().t = s.t; }
    }
    controls.update();
    const s = sim(); const t = s.t;
    updateVisuals(t, cl, tod, season, shakeOff + Math.sin(t * 41) * 0.004 * s.erupt);
    const fd = camera.position.distanceTo(controls.target); dof.cocMaterial.focusDistance = fd; dof.cocMaterial.focusRange = Math.max(2.5, fd * 0.3); dof.bokehScale = 2.0;
    // UI
    ui.knob.style.left = (tod * 100).toFixed(1) + '%'; ui.seasonv.textContent = season > 0.5 ? 'Dry' : 'Rainy';
    ui.ring.style.opacity = tool === 'wind' ? 1 : 0;
    $('p-shake').classList.toggle('on', shakeIn > 0.3 || autoShake > 0); $('p-squeeze').classList.toggle('on', cl.some((c) => c.sq > 0.2));
    const st = s.recoverT >= 0 && s.erupt < 0.15 ? 0 : statusAt(Math.max(s.erupt, s.pyroT >= 0 && s.recoverT < 0 ? 0.6 : 0));
    ui.stxt.textContent = STAT[st][0]; ui.sdot.style.background = STAT[st][1];
    const ann = { pyro: s.pyroT >= 0 && t - s.pyroT < 7 && s.recoverT < 0, assembly: s.evacT >= 0 && t - s.evacT > 3 && t - s.evacT < 12 && s.recoverT < 0, lahar: s.laharOn && s.front < 1 };
    for (const a of ANNOT) {
      const e = ui.ann[a.key]; e.style.opacity = ann[a.key] ? 1 : 0; if (!ann[a.key]) continue;
      let w; if (a.key === 'pyro') { const q = polyAt(PYRO, PYRO_L, 0.6); w = toWorld(q.x, hFast(q.x, q.z) + 1.05, q.z); } else if (a.key === 'assembly') w = toWorld(ASSEMBLY.x, hFast(ASSEMBLY.x, ASSEMBLY.z) + 0.42, ASSEMBLY.z); else { const q = polyAt(RIVER, RIVER_L, clamp(s.front - 0.06, 0.05, 0.9)); w = toWorld(q.x, hFast(q.x, q.z) + 0.55, q.z); }
      const [sx, sy] = project(w); e.style.transform = `translate(${sx}px, ${sy - 26}px) translate(-50%,-100%)`;
    }
    composer.render(DT);
    requestAnimationFrame(loop);
  };
  loop();
}
