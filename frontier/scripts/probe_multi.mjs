// usage: node probe_multi.mjs <url> <shot> <views.json> <outprefix> [WxH]
// views: [{cx,cz,above(m over ground),az,pitch}] -> sets camOverride and saves one png per view
import { chromium } from 'playwright';
import fs from 'node:fs';
const [url, shot, viewsFile, prefix, size = '960x540'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 900000, polling: 1000 });
await page.evaluate((s) => window.__game.setShot(s), shot);
await page.waitForFunction(() => window.__game.frame >= 2, null, { timeout: 900000, polling: 500 });
for (let i = 0; i < views.length; i++) {
  const v = views[i];
  const info = await page.evaluate((v) => { const G = window.__game, { world, THREE } = G.dbg; const y = world.heightAt(v.cx, v.cz) + (v.above ?? 3.2);
    G.camOverride.pos = new THREE.Vector3(v.cx, y, v.cz); const dx = -Math.sin(v.az), dz = -Math.cos(v.az);
    G.camOverride.look = new THREE.Vector3(v.cx + dx * 1000, y + Math.tan(v.pitch) * 1000, v.cz + dz * 1000); if (v.fov) { G.dbg.camera.fov = v.fov; G.dbg.camera.updateProjectionMatrix(); }
    G.hold = false; return { y }; }, v);
  const f0 = await page.evaluate(() => window.__game.frame);
  await page.waitForFunction((n) => window.__game.frame >= n + 3, f0, { timeout: 900000, polling: 500 });
  await page.evaluate(() => (window.__game.hold = true));
  await page.waitForTimeout(300);
  const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  fs.writeFileSync(`${prefix}${i}.png`, Buffer.from(data.split(',')[1], 'base64'));
  console.log(i, JSON.stringify(v), JSON.stringify(info));
}
await browser.close();
