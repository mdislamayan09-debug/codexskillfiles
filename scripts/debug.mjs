// Debug harness: run JS snippets in the page and screenshot.
import { launch } from './launch.mjs';
import fs from 'node:fs';
const [url, shot, code, out] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 600000, polling: 1000 });
await page.evaluate((s) => window.__game.setShot(s), shot);
if (code) console.log('eval:', JSON.stringify(await page.evaluate(code)));
await page.waitForFunction(() => window.__game.frame >= 3, null, { timeout: 600000, polling: 500 });
if (process.env.AFTER) console.log('after:', JSON.stringify(await page.evaluate(process.env.AFTER)));
if (process.env.SAVE) { const d = await page.evaluate(() => window.__atlas); fs.writeFileSync(process.env.SAVE, Buffer.from(d.split(',')[1], 'base64')); }
await page.evaluate(() => (window.__game.hold = true));
  await page.waitForTimeout(500);
  await page.screenshot({ timeout: 300000, ...{ path: out || 'shots/debug.png' } });
console.log(logs.filter((l) => !/deprecated/.test(l)).slice(0, 40).join('\n'));
await browser.close();
