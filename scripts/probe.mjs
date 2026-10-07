// Debug probe: set up a shot, run a JS snippet against window.__game, print its result, save the canvas.
// usage: node scripts/probe.mjs <url> <shot> "<js expression using G>" [out.png] [WxH]
import { launch } from './launch.mjs';
import fs from 'node:fs';

const [url, shot, expr, out = 'probe.png', size = '960x540'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || /THREE\.WebGLProgram|ERROR:/.test(m.text())) errs.push(m.text().slice(0, 600)); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => (window.__game && window.__game.ready) || /^Error/.test(document.querySelector('#loading .status')?.textContent || ''), null, { timeout: 600000, polling: 1000 });
{ const st = await page.evaluate(() => (window.__game && window.__game.ready) ? '' : document.querySelector('#loading .status').textContent); if (st) { console.log('GAME FAILED TO START: ' + st); await browser.close(); process.exit(1); } }
await page.evaluate((s) => window.__game.setShot(s), shot);
await page.waitForFunction(() => window.__game.frame >= 2, null, { timeout: 600000, polling: 500 });
const res = await page.evaluate((e) => { const G = window.__game; return JSON.stringify(new Function('G', `return (${e});`)(G)); }, expr || 'null');
console.log(res);
const f0 = await page.evaluate(() => window.__game.frame);
await page.waitForFunction((n) => window.__game.frame >= n + 2, f0, { timeout: 600000, polling: 500 });
await page.evaluate(() => (window.__game.hold = true));
await page.waitForTimeout(300);
const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
if (errs.length) console.log('--- console errors ---\n' + [...new Set(errs)].slice(0, 8).join('\n'));
await browser.close();
