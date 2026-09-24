#!/usr/bin/env node
// The small finds between named places: enough of them, spread over the
// island, one of each kind visited, used once, and remembered.
// Usage: node scripts/playtest-curiosities.mjs [--quality low]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest/curiosities');
mkdirSync(out, { recursive: true });
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : { channel: 'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${url}/?quality=${quality}&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
const H = (fn, ...a) => page.evaluate(({ fn, a }) => window.__THREE_GAME_TEST_HOOKS__[fn](...a), { fn, a });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`);
};
const count = (id) => page.evaluate((id) => window.game.inventory.count(id), id);

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 15);
const all = await H('curiosities');
const kinds = new Set(all.map((c) => c.kind));
const quadrants = new Set(all.map((c) => `${Math.sign(c.x)}${Math.sign(c.z)}`));
check('plenty of curiosities, of every kind, all over the island', all.length >= 60 && kinds.size === 4 && quadrants.size === 4, { n: all.length, kinds: [...kinds], quadrants: [...quadrants] });

for (const kind of ['cairn', 'pack', 'shrine', 'echo']) {
  const c = all.find((x) => x.kind === kind);
  await H('teleport', c.x + 2.4, c.z + 2.4, 0);
  await H('aim', c.x, c.y + (kind === 'shrine' ? 1.2 : 0.4), c.z);
  await H('hideDebugUi');
  await H('renderFrames', 2, 1 / 30);
  await page.screenshot({ path: `${out}/${kind}.png`, timeout: 300_000 });
  const heart = await count('heartsong');
  const song = await count('songstone');
  const inv = (await H('inventory')).length;
  const r = await H('useStory', `curio:${c.id}`);
  const again = await H('useStory', `curio:${c.id}`);
  const ok = r.flags.includes(`found:${c.id}`) && again.prompt === null;
  const reward = kind === 'shrine' ? (await count('heartsong')) === heart + 1 : kind === 'echo' ? (await count('songstone')) === song + 1 : kind === 'pack' ? (await H('inventory')).length > inv : true;
  check(`a ${kind} is found once and rewards`, ok && reward, { id: c.id, prompt: r.prompt });
}
check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((x) => x.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
