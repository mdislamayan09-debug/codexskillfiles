#!/usr/bin/env node
// The survivors' own stories: Wren's field notes (a rook brought down, the
// Crystal Grotto reached), Ilyr's caves (listened to in any order), and
// Tock's workshop (a smelter and four ingots). Each is started from a save
// where the rescues are done, then played through and paid out.
// Usage: node scripts/playtest-sidestories.mjs [--quality low]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest/sidestories');
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
const step = (id) => page.evaluate((id) => window.game.quests.currentStep(id)?.step.id ?? (window.game.quests.isDone(id) ? 'done' : null), id);

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 11);
await page.evaluate(() => {
  const done = ['waking', 'shelter', 'stones', 'needle', 'rescue_tock', 'rescue_wren'];
  window.game.quests.load({ state: done.map((id) => [id, { status: 'done', step: 99, progress: 0 }]), flags: ['read_mural', 'stones_tuned', 'has_lantern', 'saw_stillheart', 'vault_open'], tracked: null });
  window.game.quests.refresh();
  window.game.survival.godMode = true;
});
const active = (await H('quest')).active;
check('the three side stories begin', ['field_notes', 'rock_remembers', 'tocks_workshop'].every((q) => active.includes(q)), active);

// Wren: a rook, with a bow.
await H('teleport', 60, 560, 0);
await H('give', 'shortbow', 1);
await H('give', 'flint_arrow', 6);
await H('selectItem', 'shortbow');
await H('spawnBirds', 'rook', 62, 534, 5, false);
await H('renderFrames', 2, 1 / 30);
const rook = (await H('birds')).find((b) => b.state === 'ground' && b.species === 'rook');
const range = Math.hypot(rook.x - 60, rook.z - 560);
await H('aim', rook.x, rook.y + 0.1 + 0.5 * 7.2 * (range / 47.2) ** 2, rook.z);
await H('shootBow', 1);
await H('renderFrames', 40, 1 / 30);
check('a rook brought down counts for Wren', (await step('field_notes')) === 'grotto', { step: await step('field_notes') });

// Ilyr's caves, out of order: the grotto first, then the rest.
const caves = await H('caves');
const stand = async (id) => {
  const c = caves.find((x) => x.id === id);
  await page.evaluate(({ c }) => window.game.player.spawn(c.chamber[0], c.chamber[2], 0, c.floor + 0.5), { c });
  await H('renderFrames', 3, 1 / 30);
};
await stand('crystal_grotto');
check('reaching the grotto chamber is heard', (await H('quest')).flags.includes('heard:crystal_grotto'), (await H('quest')).flags);
check('Wren wants to hear about it', (await step('field_notes')) === 'talk', { step: await step('field_notes') });
check('Ilyr still waits on the first cave', (await step('rock_remembers')) === 'whisper', { step: await step('rock_remembers') });
for (const id of ['whispering_cave', 'lava_tubes', 'ice_caves']) await stand(id);
check('all four caves heard, in any order', (await step('rock_remembers')) === 'talk', { step: await step('rock_remembers') });

// Talking it through: rewards.
const arrows0 = await count('iron_arrow');
await H('talk', 'wren');
check('Wren pays in iron arrows', (await step('field_notes')) === 'done' && (await count('iron_arrow')) >= arrows0 + 12, { arrows: await count('iron_arrow') });
const heart0 = await count('heartsong');
await H('talk', 'ilyr');
check('Ilyr gives a Heartsong', (await step('rock_remembers')) === 'done' && (await count('heartsong')) > heart0, { heartsong: await count('heartsong') });

// Tock: a smelter, four ingots.
await H('teleport', 30, 610, 0);
await H('give', 'smelter', 1);
await H('selectItem', 'smelter');
const ground = await page.evaluate(() => window.game.world.groundAt(30, 606.5));
await H('aim', 30, ground, 606.5);
const placed = await H('act', 'place');
await H('renderFrames', 2, 1 / 30);
check('a smelter at camp', placed.placed === 'smelter' && (await step('tocks_workshop')) === 'iron', { placed, step: await step('tocks_workshop') });
await H('give', 'iron_ingot', 4);
await H('renderFrames', 1, 1 / 30);
check('four ingots in hand', (await step('tocks_workshop')) === 'talk', { step: await step('tocks_workshop') });
const picks0 = await count('iron_pickaxe');
await H('talk', 'tock');
check('Tock hands over an iron pickaxe', (await step('tocks_workshop')) === 'done' && (await count('iron_pickaxe')) > picks0, { picks: await count('iron_pickaxe') });

check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
