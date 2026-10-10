// Load a shot and print every console error and page error for a few seconds (finds what stalls a capture).
// usage: node scripts/errlog.mjs <url> [shot]
import { launch } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text().slice(0, 500)); });
page.on('pageerror', (e) => errs.push('pageerror ' + (e.stack || e.message).slice(0, 700)));
await page.goto(process.argv[2], { waitUntil: 'load' });
try { await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: +(process.env.WAIT || 60000), polling: 500 }); }
catch (e) {
  console.log('never ready; loading status:', await page.evaluate(() => document.querySelector('#loading .status')?.textContent));
  console.log([...new Set(errs)].slice(0, 8).join('\n') || 'no errors logged');
  await browser.close(); process.exit(1);
}
if (process.argv[3]) await page.evaluate((s) => { try { window.__game.setShot(s); } catch (e) { console.error('setShot threw: ' + (e.stack || e.message)); } }, process.argv[3]);
await page.waitForTimeout(5000);
console.log('frame', await page.evaluate(() => window.__game.frame));
console.log([...new Set(errs)].slice(0, 8).join('\n') || 'no errors');
await browser.close();
