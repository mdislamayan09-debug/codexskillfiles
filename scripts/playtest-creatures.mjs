#!/usr/bin/env node
// Creature playtest: spawn wildlife, hunt with a spear (weak points),
// skin the corpse, get attacked by a duskhound at night.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest');
mkdirSync(out, { recursive: true });
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : { channel: 'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('ERR_CERT')) logs.push(`[${m.type()}] ${m.text()}`);
});
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
const count = async (id) => (await H('inventory')).filter((s) => s.startsWith(`${id}x`)).reduce((n, s) => n + Number(s.split('x').pop()), 0);

await H('setState', 'play');
await H('setTime', 10.5);
await H('drive', {}, 0.2);

// A small herd grazing in front of the player.
const deer = await H('spawnCreature', 'sprigbuck', 1.5, -9);
await H('spawnCreature', 'sprigbuck', -2.5, -11);
await H('spawnCreature', 'boar', 4, -12);
const me = await H('drive', {}, 0.05);
await H('aim', deer.x, deer.y + 0.8, deer.z);
await H('hideDebugUi');
await H('renderFrames', 3);
await page.screenshot({ path: `${out}/08-wildlife.png`, timeout: 300_000 });
check('creatures spawned', (await H('creatures')).length >= 3, (await H('creatures')).map((c) => c.species));

// Hunt: spear to the neck.
await H('give', 'flint_spear', 1);
await H('selectItem', 'flint_spear');
await H('teleport', deer.x, deer.z + 2.6, 0);
let target = (await H('creatures')).find((c) => c.id === deer.id);
let hits = 0;
for (let i = 0; i < 8 && target && target.state !== 'dead'; i += 1) {
  const pos = await H('drive', {}, 0.02);
  await H('aim', target.x, pos.y + 1.1, target.z);
  await H('act', 'use', 0.9);
  hits += 1;
  target = (await H('creatures')).find((c) => c.id === deer.id);
  if (target && target.state === 'flee') {
    // Chase it down by teleporting next to it (tests only).
    await H('teleport', target.x, target.z + 2.2, 0);
  }
}
check('sprigbuck can be killed', target && target.state === 'dead', { hits, target });
if (target) {
  await H('teleport', target.x + 1.2, target.z + 1.2, 0);
  const pos = await H('drive', {}, 0.02);
  await H('aim', target.x, pos.y + 0.3, target.z);
  const meatBefore = await count('raw_meat');
  const r = await H('act', 'interact', 0.1);
  // Interact on a corpse happens in the play loop; emulate via key path.
  await page.keyboard.press('KeyE').catch(() => {});
  await H('renderFrames', 1);
  const meat = await count('raw_meat');
  check('skinning yields meat', meat > meatBefore, { meatBefore, meat, r });
}

// Night: a duskhound attacks.
await H('setTime', 23.5);
const before = await H('tickWorld', 0.1);
await H('spawnCreature', 'duskhound', 0, -6);
const after = await H('tickWorld', 6);
check('duskhound attacks at night', after < before, { before, after, creatures: (await H('creatures')).filter((c) => c.species === 'duskhound') });
const hound = (await H('creatures')).find((c) => c.species === 'duskhound');
if (hound) {
  const pos = await H('drive', {}, 0.02);
  await H('aim', hound.x, pos.y + 0.6, hound.z);
}
await H('renderFrames', 2);
await page.screenshot({ path: `${out}/09-duskhound-night.png`, timeout: 300_000 });

writeFileSync(`${out}/creature-results.json`, JSON.stringify({ results, logs }, null, 2));
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
