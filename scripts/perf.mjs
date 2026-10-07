// Frame-rate check of the playable game (not capture mode) on this machine's GPU, sampled every two seconds.
// usage: node scripts/perf.mjs <url> [WxH] [deviceScaleFactor] [seconds]
import { launch } from './launch.mjs';
const [url, size = '1512x982', dsf = '2', secs = '12'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +dsf });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if ((m.type() === 'error' && !/404/.test(m.text())) || /THREE\.WebGLProgram|ERROR:/.test(m.text())) errs.push(m.text().slice(0, 400)); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => (window.__game && window.__game.ready) || /^Error/.test(document.querySelector('#loading .status')?.textContent || ''), null, { timeout: 120000, polling: 500 });
{ const st = await page.evaluate(() => (window.__game && window.__game.ready) ? '' : document.querySelector('#loading .status').textContent); if (st) { console.log('GAME FAILED TO START: ' + st); await browser.close(); process.exit(1); } }
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.keyboard.press('Enter');
const res = await page.evaluate(async (secs) => {
  const G = window.__game, out = [];
  for (let i = 0; i < secs / 2; i++) { const f0 = G.frame, t0 = performance.now(); await new Promise((r) => setTimeout(r, 2000)); const c = document.querySelector('canvas'); out.push([+((G.frame - f0) / ((performance.now() - t0) / 1000)).toFixed(1), +(G.gov ? G.gov.scale : 0).toFixed(2), c.width + 'x' + c.height]); }
  return out;
}, +secs);
console.log(JSON.stringify(res));
if (errs.length) console.log('--- errors ---\n' + [...new Set(errs)].slice(0, 8).join('\n'));
await browser.close();
