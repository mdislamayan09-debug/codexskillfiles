#!/usr/bin/env node
// A meteor shower and a fallen star: streaks fan out across the night sky,
// a star comes down a few hundred metres away with a pillar of light over
// it, its metal is gathered, and a Starglass Lantern made from it lights a
// cave. Saves the sky and the find as pictures.
// Usage: node scripts/playtest-sky.mjs [--quality low]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest/sky');
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
const shot = async (name) => {
  await H('hideDebugUi');
  await H('renderFrames', 1, 1 / 30);
  await page.evaluate(() => window.game.pipeline.resetExposure());
  await H('renderFrames', 2, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
};

await H('setState', 'play');
await H('setWeather', 'clear');
await H('teleport', 60, 560, 0);
await H('setTime', 0.8);
const quiet = await H('sky');
check('no shower on the first night', !quiet.showering && quiet.streaks === 0, quiet);
await H('skyEvent', 'shower');
await H('renderFrames', 150, 1 / 30);
const sky = await H('sky');
check('a shower fills the sky with streaks', sky.showering && sky.streaks > 0, sky);
await H('aim', 60 + 40, 60, 560 - 120);
await shot('meteor-shower');

const fall = await H('skyEvent', 'fall');
const f = fall.fallen;
const d = f ? Math.hypot(f.x - 60, f.z - 560) : -1;
check('a star falls a few hundred metres away', f && d > 120 && d < 380 && !f.collected, { fallen: f, d });
await H('lookFrom', 60, (await page.evaluate(() => window.game.world.groundAt(60, 560))) + 6, 560, f.x, f.y + 30, f.z);
await shot('fallen-star-far');
await H('setState', 'play');
await H('teleport', f.x + 2.2, f.z + 2.2, 0);
await H('aim', f.x, f.y + 0.6, f.z);
await shot('fallen-star-near');
const got = await H('gatherStar');
check('its metal can be gathered, once', got.after === got.before + 3, got);
const again = await H('gatherStar');
check('and only once', again.after === again.before, again);

// A Starglass Lantern, at a workbench.
await H('give', 'workbench', 1);
await H('selectItem', 'workbench');
const g = await page.evaluate(({ x, z }) => window.game.world.groundAt(x, z), { x: f.x + 2.2, z: f.z - 0.8 });
await H('aim', f.x + 2.2, g, f.z - 0.8);
await H('act', 'place');
await H('give', 'glass_petal', 2);
await H('give', 'iron_ingot', 1);
const made = await H('craft', 'star_lantern');
const has = await page.evaluate(() => window.game.inventory.count('star_lantern'));
check('a Starglass Lantern made from it', has === 1, { made, has });

// An eclipse: the light fails at midday and the corona shows.
await H('setTime', 13.9);
await H('skyEvent', 'clear');
await H('renderFrames', 2, 1 / 30);
const bright = await H('probe');
await H('skyEvent', 'eclipse');
await H('renderFrames', 2, 1 / 30);
const dim = await H('probe');
check('an eclipse dims the sun', dim.lightIntensity < bright.lightIntensity * 0.2, { bright: bright.lightIntensity, dim: dim.lightIntensity });
const [sx, sy, sz] = dim.sunDir;
const eye = await page.evaluate(() => {
  const p = window.game.camera.position;
  return { x: p.x, y: p.y, z: p.z };
});
await H('aim', eye.x + sx * 100, eye.y + sy * 100, eye.z + sz * 100);
await shot('eclipse');
await H('skyEvent', 'clear');

check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
