#!/usr/bin/env node
// The Veyr Sunwells: three paved courts where a lens throws sunlight across
// the flagstones and turnable prisms steer it to a sun disc on the vault
// door. Checks each court starts unsolved, that turning its prisms to the
// answer lights the disc and sinks the door, that the sealed cache opens
// only then, that Tock's "Burning Glass" pays out a spyglass, and that the
// spyglass narrows the view.
// Usage: node scripts/playtest-sunwells.mjs [--quality low]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest/sunwells');
mkdirSync(out, { recursive: true });
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : { channel: 'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) logs.push(`[console] ${m.text()}`);
});
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
  await H('renderFrames', 2, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
};
const count = (id) => page.evaluate((id) => window.game.inventory.count(id), id);
const step = (id) => page.evaluate((id) => window.game.quests.currentStep(id)?.step.id ?? (window.game.quests.isDone(id) ? 'done' : null), id);

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 11);
const wells = await H('sunwells');
check('three Sunwells stand on the island', wells.length === 3 && wells.every((w) => !w.solved && w.end !== 'receptor'), wells.map((w) => ({ id: w.id, end: w.end })));

// The Dawnwell as it is found: the beam held by a prism, the door shut.
// (Leaving the camera tour starts play afresh, so this comes first.)
const dawn = wells.find((w) => w.id === 'dawnwell');
const vantage = () => H('lookFrom', dawn.x - 15, dawn.y + 7, dawn.z + 13, dawn.x + 2, dawn.y + 1, dawn.z - 1);
await vantage();
await shot('dawnwell-found');
await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 11);

await page.evaluate(() => {
  const done = ['waking', 'shelter', 'stones', 'needle', 'rescue_tock', 'rescue_wren', 'tocks_workshop'];
  window.game.quests.load({ state: done.map((id) => [id, { status: 'done', step: 99, progress: 0 }]), flags: ['read_mural', 'stones_tuned', 'has_lantern', 'saw_stillheart', 'vault_open'], tracked: null });
  window.game.quests.refresh();
  window.game.survival.godMode = true;
});
check("Tock's Burning Glass begins after his workshop", (await step('burning_glass')) === 'dawn', { step: await step('burning_glass') });

const sealed = await H('useStory', 'cache:dawnwell');
check('the vault cache is sealed until the light arrives', sealed.prompt === null && !sealed.flags.includes('looted:dawnwell'), sealed.prompt);

// Solve each court by turning its prisms to the answer.
const heart0 = await count('heartsong');
for (const w of wells) {
  for (let i = 0; i < w.prisms.length; i += 1) {
    const times = (w.answer[i] - w.prisms[i].facing + 4) % 4;
    if (times > 0) await H('turnPrism', w.id, i, times);
  }
  await H('renderFrames', 60, 1 / 8);
  const after = (await H('sunwells')).find((x) => x.id === w.id);
  check(`${w.id}: the beam reaches the door and it sinks`, after.solved && after.end === 'receptor' && after.open >= 1, { end: after.end, open: after.open });
}
const flags = (await H('quest')).flags;
check('each court sets its flag', ['dawnwell', 'noonwell', 'duskwell'].every((id) => flags.includes(`lit:${id}`)), flags.filter((f) => f.startsWith('lit:')));
const opened = await H('useStory', 'cache:dawnwell');
check('the vault cache opens once lit', opened.flags.includes('looted:dawnwell') && (await count('heartsong')) > heart0, { heartsong: await count('heartsong') });
check('turning stops once a court is solved', (await H('useStory', 'sunwell:dawnwell:0')).prompt === null);

// Tock pays out.
check('the quest waits on Tock', (await step('burning_glass')) === 'talk', { step: await step('burning_glass') });
await H('talk', 'tock');
check('Tock hands over a spyglass', (await step('burning_glass')) === 'done' && (await count('spyglass')) === 1, { spyglass: await count('spyglass') });

// Looking through it.
await H('teleport', dawn.x - 30, dawn.z + 30, 0);
await H('selectItem', 'spyglass');
await H('raiseSpyglass', true);
await H('renderFrames', 30, 1 / 30);
const spy = await H('spyglass');
const fov = await page.evaluate(() => window.game.camera.fov);
check('the spyglass narrows the view', spy.zoom > 0.9 && fov < 30, { spy, fov });
await shot('spyglass');
await H('raiseSpyglass', false);
await H('renderFrames', 30, 1 / 30);
check('and lowers again', (await H('spyglass')).zoom < 0.05 && (await page.evaluate(() => window.game.camera.fov)) > 50);

// The Dawnwell lit: the beam carried round to the open vault.
await vantage();
await shot('dawnwell-lit');

check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
