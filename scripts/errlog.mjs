import { launch } from './launch.mjs';
const url = process.argv[2];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 600000, polling: 1000 });
await page.evaluate(() => window.__game.setShot('ride'));
await page.waitForFunction(() => window.__game.frame >= 2, null, { timeout: 600000, polling: 500 });
for (const e of errs) { if (/404/.test(e)) continue; const lines = e.split('\n'); console.log(lines.filter((l) => /ERROR|error|Error/.test(l)).slice(0, 8).join('\n')); console.log('---'); }
await browser.close();
