// Capture in-game screenshots for the gauntlet critic.
// usage: node scripts/shoot.mjs [url] [shot,shot,...] [frames] [WxH]   (CANVAS=1 reads the canvas instead of a page screenshot)
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/?capture';
const shots = (process.argv[3] || 'ranch,ride,swamp,town,forest,vista,gallop,camp,night,hud').split(',');
const frames = +(process.argv[4] || 6);
const [W, H] = (process.argv[5] || '1280x720').split('x').map(Number);
const outDir = process.env.OUT || 'shots';
fs.mkdirSync(outDir, { recursive: true });

const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 600000, polling: 1000 });
} catch (e) {
  console.log(logs.slice(-40).join('\n'));
  throw e;
}
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const s of shots) {
  const t1 = Date.now();
  await page.evaluate((s) => window.__game.setShot(s), s);
  // software-GL 4K frames can take many minutes each
  // software-GL cinematic frames can take 15+ minutes each
  await page.waitForFunction((n) => window.__game.frame >= n, frames, { timeout: W * H > 4e6 ? 3600000 : 2400000, polling: 500 });
  const info = await page.evaluate(() => {
    const r = window.__game.renderer.info;
    return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length };
  });
  await page.evaluate(() => (window.__game.hold = true));
  await page.waitForTimeout(500);
  if (process.env.CANVAS) {
    // read the WebGL canvas directly (capture mode preserves the drawing buffer); the compositor
    // screenshot path is too slow for 4K frames in software GL
    const url = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
    fs.writeFileSync(`${outDir}/${s}.png`, Buffer.from(url.split(',')[1], 'base64'));
  } else {
    await page.screenshot({ timeout: 300000, path: `${outDir}/${s}.png` });
  }
  console.log(`${s}: ${((Date.now() - t1) / 1000).toFixed(1)}s`, JSON.stringify(info));
}
const errs = logs.filter((l) => /error|warn/i.test(l));
if (errs.length) console.log('--- console ---\n' + [...new Set(errs)].slice(0, 30).join('\n'));
await browser.close();
