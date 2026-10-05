import { chromium } from 'playwright';
const [url, code] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 600000, polling: 1000 });
console.log(JSON.stringify(await page.evaluate(code)));
await browser.close();
