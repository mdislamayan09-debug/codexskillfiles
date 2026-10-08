// Turntable of the rider and horse: one page load, several chase-camera views, one contact sheet.
// usage: node scripts/turntable.mjs <url> <shot> <out prefix> [WxH]     views are [right, up, forward] offsets from the horse
import { launch } from './launch.mjs';
import fs from 'node:fs';
const [url, shot, prefix, size = '800x600'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const VIEWS = [
  { rel: [0.0, 1.9, -4.2], look: [0, 1.3, 0.2] },      // from behind
  { rel: [2.6, 1.8, -3.4], look: [0, 1.3, 0.1] },      // rear three-quarter
  { rel: [4.6, 1.5, 0.2], look: [0, 1.25, 0.1] },      // side
  { rel: [3.0, 1.7, 3.4], look: [0, 1.35, 0.2] },      // front three-quarter
  { rel: [1.1, 2.2, -2.2], look: [0, 1.75, 0.3] },     // close on the rider's back
  { rel: [1.6, 0.9, -2.0], look: [0, 0.8, -0.6] },     // close on the quarters and hind legs
];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => (window.__game && window.__game.ready) || /^Error/.test(document.querySelector('#loading .status')?.textContent || ''), null, { timeout: 120000, polling: 500 });
{ const st = await page.evaluate(() => (window.__game && window.__game.ready) ? '' : document.querySelector('#loading .status').textContent); if (st) { console.log('GAME FAILED TO START: ' + st); await browser.close(); process.exit(1); } }
await page.evaluate((s) => window.__game.setShot(s), shot);
await page.waitForFunction(() => window.__game.frame >= 3, null, { timeout: 120000, polling: 300 });
for (let i = 0; i < VIEWS.length; i++) {
  await page.evaluate((v) => { const G = window.__game; G.camOverride = { rel: v.rel, lookRel: v.look, turn: 0, fov: 38 }; G.hold = false; }, VIEWS[i]);
  const f0 = await page.evaluate(() => window.__game.frame);
  await page.waitForFunction((n) => window.__game.frame >= n + 4, f0, { timeout: 120000, polling: 300 });
  await page.evaluate(() => (window.__game.hold = true));
  await page.waitForTimeout(250);
  const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  fs.writeFileSync(`${prefix}${i}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
