#!/usr/bin/env node
// Walk into every cave: the mouth opens in the hillside, the tunnel floor
// carries you down under the rock, the walls hold you in, the chamber is
// dark until a torch comes out, and the cache at the back pays out.
// Usage: node scripts/playtest-caves.mjs [--quality low] [--only crystal_grotto]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const only = arg('only', '');
const out = arg('out', 'artifacts/playtest/caves');
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
  // Network hiccups from the sandbox proxy are not the game's.
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) logs.push(`[console] ${m.text()}`);
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
  await H('renderFrames', 1, 1 / 30);
  // Let the eye adjust (as it would over a few seconds) before the picture.
  await page.evaluate(() => window.game.pipeline.resetExposure());
  await H('renderFrames', 2, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
};
const terrain = (x, z) => page.evaluate(({ x, z }) => window.game.world.heightAt(x, z), { x, z });
const yawFor = (dx, dz) => Math.atan2(-dx, -dz);
const pos = () => page.evaluate(() => {
  const p = window.game.player.position;
  return { x: p.x, y: p.y, z: p.z };
});

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 12.5);
await page.evaluate(() => {
  window.game.survival.godMode = true;
});
const caves = (await H('caves')).filter((c) => !only || only.split(',').includes(c.id));
check('four caves planned', caves.length === (only ? caves.length : 4), caves.map((c) => c.id));
for (const cave of caves) {
  const [mx, my, mz] = cave.mouth;
  const [dx, dz] = cave.dir;
  // From outside: the mouth opens in the hillside.
  await H('lookFrom', mx - dx * 14 - dz * 4, my + 4, mz - dz * 14 + dx * 4, mx + dx * 2, my + 1.2, mz + dz * 2);
  await shot(`${cave.id}-mouth`);
  // Walk in from the doorstep.
  await H('setState', 'play');
  await H('teleport', mx - dx * 4, mz - dz * 4, 0);
  const yaw = yawFor(dx, dz);
  await H('drive', { yaw, pitch: 0 }, 0.2);
  let walked = null;
  for (let k = 0; k < 10; k += 1) {
    walked = await H('drive', { moveY: 1, yaw, pitch: 0 }, 1.2);
    const state = await H('inCave');
    if (state.inCave && state.depth > 0.9) break;
    // Follow the tunnel as it bends: steer toward the chamber.
    const p = await pos();
    const [cx, , cz] = cave.chamber;
    const ty = yawFor(cx - p.x, cz - p.z);
    await H('drive', { moveY: 1, yaw: ty, pitch: 0 }, 1.2);
  }
  const p = await pos();
  const top = await terrain(p.x, p.z);
  const state = await H('inCave');
  check(`${cave.id}: walking in takes you under the rock`, state.inCave && top > p.y + 3, { p, top, state });
  // Push into a wall: the rock holds.
  const beforeWall = await pos();
  await H('drive', { moveX: 1, yaw, pitch: 0 }, 3);
  const afterWall = await pos();
  const stillIn = await H('inCave');
  check(`${cave.id}: the walls hold`, stillIn.inCave && Math.abs(afterWall.y - beforeWall.y) < 2.5, { beforeWall, afterWall, stillIn });
  // The chamber: dark, then a torch.
  const [cx, cy, cz] = cave.chamber;
  const spot = (await H('caveSpots')).find((c) => c.id === cave.id);
  await page.evaluate(({ x, z, y }) => window.game.player.spawn(x, z, 0, y + 0.5), { x: cx, z: cz, y: cave.floor });
  await H('renderFrames', 2, 1 / 30);
  const inChamber = await pos();
  check(`${cave.id}: the chamber floor holds you`, Math.abs(inChamber.y - cave.floor) < 0.6, { inChamber, floor: cave.floor });
  await H('aim', spot.x, spot.y + 0.4, spot.z);
  await page.evaluate(() => {
    const inv = window.game.inventory;
    inv.select(7);
  });
  await shot(`${cave.id}-chamber-dark`);
  await H('give', 'torch', 1);
  await H('selectItem', 'torch');
  await H('aim', spot.x, spot.y + 0.4, spot.z);
  await shot(`${cave.id}-chamber-torch`);
  // Search the cache at the back.
  await page.evaluate(({ x, z, y }) => window.game.player.spawn(x, z, 0, y + 0.5), { x: spot.x - (spot.x - cx) * 0.25, z: spot.z - (spot.z - cz) * 0.25, y: cave.floor });
  await H('aim', spot.x, spot.y + 0.4, spot.z);
  const before = (await H('inventory')).length;
  const r = await H('useStory', `cache:${cave.id}`);
  const after = (await H('inventory')).length;
  check(`${cave.id}: the cache pays out`, after > before && r.flags.includes(`looted:${cave.id}`), { before, after, flags: r.flags.filter((f) => f.startsWith('looted')) });
  void cy;
}
check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((x) => x.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
