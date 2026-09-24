#!/usr/bin/env node
// Building playtest: raise a two-room timber cabin on the Greensward
// (foundations, walls, a doorway, roofs), walk on it, bump into its walls,
// shelter under it, save and reload it, and take a wall down again.
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest');
mkdirSync(out, { recursive: true });
const browser = await launchChromium();
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
  await H('renderFrames', 2, 1 / 60);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
  console.log(`${out}/${name}.png`);
};
const place = async (item, x, y, z) => {
  await H('selectItem', item);
  await H('aim', x, y, z);
  return H('act', 'place');
};

await H('setState', 'play');
await H('setTime', 11);
for (const [id, n] of [['wood_foundation', 4], ['wood_wall', 8], ['wood_doorway', 2], ['wood_roof', 4], ['wood_floor', 2], ['wood_stairs', 1]]) await H('give', id, n);

// 1. Two foundations side by side on open ground east of camp.
const x0 = 64;
const z0 = 640;
await H('teleport', x0, z0, 0);
const me = await H('drive', {}, 0.05);
let r = await place('wood_foundation', x0, me.y, z0 - 4.5);
check('first foundation starts a building', r.placed === 'wood_foundation', r);
let b = await H('building');
const f1 = b.pieces[0];
r = await place('wood_foundation', f1.x, f1.y, f1.z - 1.2);
b = await H('building');
check('second foundation snaps beside the first', r.placed === 'wood_foundation' && b.pieces.length === 2, { r, pieces: b.pieces.map((p) => [p.type, p.i, p.j]) });
const f2 = b.pieces.find((p) => p.id !== f1.id) ?? f1;
check('snapped foundation shares the grid line', Math.abs(Math.hypot(f2.x - f1.x, f2.z - f1.z) - 3) < 0.05, { f1, f2 });

// 2. Walls from the inside: stand on the deck, aim at each outer edge.
const ex = f2.x - f1.x;
const ez = f2.z - f1.z;
const len = Math.hypot(ex, ez) || 1;
// Along the building (a) and across it (c), unit vectors.
const ax = ex / len;
const az = ez / len;
const cx = -az;
const cz = ax;
await page.evaluate(({ x, y, z }) => {
  const g = window.game;
  g.player.spawn(x, z, 0, y + 0.1);
}, { x: f1.x, y: f1.y, z: f1.z });
b = await H('building');
check('standing on the deck', Math.abs(b.player.y - f1.y) < 0.05, b.player);
const edges = [
  ['wood_wall', f1, -1, 0],
  ['wood_wall', f1, 0, 1],
  ['wood_wall', f1, 0, -1],
  ['wood_wall', f2, 0, 1],
  ['wood_wall', f2, 0, -1],
  ['wood_doorway', f2, 1, 0],
];
let walls = 0;
for (const [item, f, along, across] of edges) {
  await page.evaluate(({ x, y, z }) => window.game.player.spawn(x, z, 0, y + 0.1), { x: f.x, y: f.y, z: f.z });
  const px = f.x + ax * along * 1.15 + cx * across * 1.15;
  const pz = f.z + az * along * 1.15 + cz * across * 1.15;
  r = await place(item, px, f.y, pz);
  if (r.placed) walls += 1;
  else console.log('  wall failed', item, along, across, r);
}
check('six walls and a doorway raised', walls === 6, walls);

// 3. Roofs over both rooms, placed by looking up at a wall top from inside.
let roofs = 0;
for (const f of [f1, f2]) {
  await page.evaluate(({ x, y, z }) => window.game.player.spawn(x, z, 0, y + 0.1), { x: f.x, y: f.y, z: f.z });
  r = await place('wood_roof', f.x + cx * 1.45, f.y + 2.85, f.z + cz * 1.45);
  if (r.placed) roofs += 1;
  else console.log('  roof failed', r);
}
check('both rooms roofed', roofs === 2, roofs);
await page.evaluate(({ x, y, z }) => window.game.player.spawn(x, z, 0, y + 0.1), { x: f1.x, y: f1.y, z: f1.z });
b = await H('building');
check('sheltered under the roof', b.sheltered === true, b.player);

// 4. Walls are solid: walk at the side wall and stop short of it.
const yawAcross = Math.atan2(-cx, -cz);
const walked = await H('drive', { moveY: 1, yaw: yawAcross, pitch: 0 }, 2.5);
const acrossDist = (walked.x - f1.x) * cx + (walked.z - f1.z) * cz;
check('the wall stops you', acrossDist < 1.45, { acrossDist, walked });
check('still on the deck after walking', Math.abs(walked.y - f1.y) < 0.1, walked);

// 5. Pictures: inside, and outside at golden hour.
await H('setTime', 18.3);
await page.evaluate(({ x, y, z }) => window.game.player.spawn(x, z, 0, y + 0.1), { x: f2.x, y: f2.y, z: f2.z });
await H('aim', f1.x - ax * 1.5, f1.y + 1.6, f1.z - az * 1.5);
await shot('30-cabin-inside');
await H('teleport', f1.x + (f2.x - f1.x) * 0.5 + cx * 9 + ax * 7, f1.z + (f2.z - f1.z) * 0.5 + cz * 9 + az * 7, 0);
await H('aim', f1.x + (f2.x - f1.x) * 0.5, f1.y + 1.8, f1.z + (f2.z - f1.z) * 0.5);
await shot('31-cabin-outside');

// 6. Save and reload keep the cabin.
const count = (await H('building')).pieces.length;
await page.evaluate(() => {
  window.game.playtime = 30;
  window.game.saveSession('auto');
  window.game.startPlay('auto');
});
b = await H('building');
check('cabin survives save and load', b.pieces.length === count, { before: count, after: b.pieces.length });

// 7. Take a wall down: the roof above still has other walls, so it may go.
await page.evaluate(({ x, y, z }) => window.game.player.spawn(x, z, 0, y + 0.1), { x: f1.x, y: f1.y, z: f1.z });
await H('selectItem', 'berries');
await H('aim', f1.x - ax * 1.45, f1.y + 1.4, f1.z - az * 1.45);
const d = await H('dismantle');
check('a wall can be taken down for wood', d.removed === 'wood_wall' && d.wood > 0, d);
check('no page errors', logs.length === 0, logs.slice(0, 3));
await browser.close();
const passed = results.filter((x) => x.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
