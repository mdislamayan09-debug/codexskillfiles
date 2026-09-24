#!/usr/bin/env node
// Captures screenshots of named viewpoints from a running dev/preview server.
// Usage: node scripts/capture.mjs [--url http://127.0.0.1:5188] [--views a,b] [--quality high]
//        [--size 1280x720] [--out artifacts/captures] [--wait 2500] [--params extra=1]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'high');
const [width, height] = arg('size', '1280x720').split('x').map(Number);
const out = arg('out', 'artifacts/captures');
const wait = Number(arg('wait', '2500'));
const extra = arg('params', '');
const viewsArg = arg('views', 'crash-site');
const frames = Number(arg('frames', '3'));

mkdirSync(out, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const first = viewsArg.split(',')[0];
const started = Date.now();
await page.goto(`${url}/?quality=${quality}&view=${first}&capture=1${extra ? `&${extra}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
console.log(`boot ${(Date.now() - started) / 1000}s`);

const views = viewsArg === 'all' ? await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.viewpoints()) : viewsArg.split(',');
for (const view of views) {
  const t = Date.now();
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
  await page.evaluate((v) => window.__THREE_GAME_TEST_HOOKS__.setState(v), view);
  await page.evaluate((n) => window.__THREE_GAME_TEST_HOOKS__.renderFrames(n), frames);
  await page.waitForTimeout(wait);
  const file = `${out}/${view}-${quality}.png`;
  await page.screenshot({ path: file, timeout: 300_000 });
  const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  const probe = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.probe?.());
  if (probe) console.log('  probe', JSON.stringify(probe));
  console.log(`${view}: ${file} (${(Date.now() - t) / 1000}s) calls=${diag?.renderer?.calls} tris=${diag?.renderer?.triangles} frameMs=${diag?.timings?.frameMs?.toFixed?.(0)} nodes=${diag?.world?.terrainNodes}`);
  writeFileSync(`${out}/${view}-${quality}.json`, JSON.stringify(diag, null, 2));
}
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
