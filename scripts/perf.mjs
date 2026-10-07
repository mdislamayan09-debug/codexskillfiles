// Frame-rate check of the playable game (not capture mode) on this machine's GPU.
// usage: node scripts/perf.mjs <url> [WxH] [deviceScaleFactor] [seconds]
import { launch } from './launch.mjs';
const [url, size = '1512x982', dsf = '2', secs = '6'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +dsf });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => (window.__game && window.__game.ready) || /^Error/.test(document.querySelector('#loading .status')?.textContent || ''), null, { timeout: 600000, polling: 500 });
{ const st = await page.evaluate(() => (window.__game && window.__game.ready) ? '' : document.querySelector('#loading .status').textContent); if (st) { console.log('GAME FAILED TO START: ' + st); await browser.close(); process.exit(1); } }
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const res = await page.evaluate(async (secs) => {
  const G = window.__game, f0 = G.frame, t0 = performance.now();
  await new Promise((r) => setTimeout(r, secs * 1000));
  const c = document.querySelector('canvas');
  return { fps: (G.frame - f0) / ((performance.now() - t0) / 1000), canvas: [c.width, c.height], started: G.started, calls: G.renderer.info.render.calls, tris: G.renderer.info.render.triangles };
}, +secs);
console.log(JSON.stringify(res));
if (errs.length) console.log('--- errors ---\n' + [...new Set(errs)].slice(0, 10).join('\n'));
await browser.close();
