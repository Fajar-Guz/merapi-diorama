import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import fs from 'fs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const W = +(args.w || 1920), H = +(args.h || 1080);
const url = `http://127.0.0.1:${args.port || 5297}/?render=1&w=${W}&h=${H}`;
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }, protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|WebGL/.test(t)) console.log('[page]', t); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction('window.ready !== undefined', { timeout: 120000 });
await page.evaluate(() => window.ready);
const shot = async (file) => { const buf = await page.screenshot({ type: file.endsWith('.png') ? 'png' : 'jpeg', quality: file.endsWith('.png') ? undefined : 94 }); if (file !== '-') fs.writeFileSync(file, buf); return buf; };
if (args.custom) {
  const views = JSON.parse(fs.readFileSync(args.custom, 'utf8'));
  for (let i = 0; i < views.length; i++) { const v = views[i]; await page.evaluate((v) => window.renderCustom(v.m, v.t, v.pos, v.tg, v.fov), v); await page.evaluate((v) => window.renderCustom(v.m, v.t, v.pos, v.tg, v.fov), v); await shot(`${args.out}_${i}.png`); }
} else if (args.stills) {
  const fs_ = args.stills.split(',').map(Number);
  for (let i = 0; i < fs_.length; i++) { const t0 = Date.now(); await page.evaluate((f) => window.renderAt(f), fs_[i]); await shot(`${args.out || 'test'}_${fs_[i]}.${args.ext || 'jpg'}`); console.log('still', fs_[i], Date.now() - t0, 'ms'); }
} else {
  const f0 = +(args.from || 0), f1 = +(args.to || 1080);
  const dir = args.dir || 'frames'; fs.mkdirSync(dir, { recursive: true });
  const T = Date.now();
  for (let f = f0; f < f1; f++) {
    const file = `${dir}/f${String(f).padStart(5, '0')}.jpg`;
    if (fs.existsSync(file) && !args.force) continue;
    await page.evaluate((f) => window.renderAt(f), f);
    await shot(file);
    if (f % 10 === 0) console.log('frame', f, ((Date.now() - T) / (f - f0 + 1)).toFixed(0), 'ms/f');
  }
}
await browser.close();
