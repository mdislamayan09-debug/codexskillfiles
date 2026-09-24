#!/usr/bin/env node
// Defence, end to end: a dodge carries you clear and blows pass through
// you mid-dodge; a raised guard blocks blows from the front for stamina, a
// guard raised just in time parries and staggers the attacker, nothing
// guards your back; lock-on keeps a boar under the crosshair.
// Usage: node scripts/playtest-combat.mjs [--quality low]
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const out = arg('out', 'artifacts/playtest/combat');
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
const pos = () => page.evaluate(() => {
  const p = window.game.player.position;
  return { x: p.x, y: p.y, z: p.z, yaw: window.game.player.yaw };
});
const heal = () => page.evaluate(() => {
  const s = window.game.survival;
  s.health = s.maxHealth;
  s.stamina = s.maxStamina;
});

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 11);
await H('teleport', 60, 560, 0);
await H('give', 'stone_axe', 1);
await H('selectItem', 'stone_axe');
await H('drive', {}, 0.3);

// A dodge.
await heal();
const start = await pos();
const dodge = await H('defend', 'dodge', 1, 0);
const during = await H('combat');
const hitMid = await H('strikePlayer', 20, start.x, start.z - 2);
await H('drive', {}, 0.4);
const end = await pos();
const moved = Math.hypot(end.x - start.x, end.z - start.z);
check('a dodge carries you clear', dodge.ok && moved > 1.4, { moved });
check('blows pass through you mid-dodge', during.iframes > 0 && hitMid.after === hitMid.before, { during, hitMid });

// Blocking and parrying (facing -z at yaw 0: the front is -z).
await H('drive', { yaw: 0, pitch: 0 }, 0.8);
await heal();
const p0 = await pos();
await H('defend', 'guard', 0.5);
const stamina0 = await page.evaluate(() => window.game.survival.stamina);
const blocked = await H('strikePlayer', 20, p0.x, p0.z - 2);
const stamina1 = await page.evaluate(() => window.game.survival.stamina);
check('a held guard blocks most of a blow, for stamina', blocked.before - blocked.after > 3 && blocked.before - blocked.after < 8 && stamina1 < stamina0, { blocked, stamina0, stamina1 });
await heal();
const behind = await H('strikePlayer', 20, p0.x, p0.z + 2);
check('nothing guards your back', behind.before - behind.after > 15, behind);
// A boar right in front, parried.
await heal();
const boar = await H('spawnCreature', 'boar', 0, -1.6);
await H('defend', 'lower');
await H('defend', 'guard', 0);
const parried = await H('strikePlayer', 20, boar.x, boar.z);
const reel = await page.evaluate((id) => window.game.wildlife.creatures.find((c) => c.id === id)?.stagger ?? -1, boar.id);
check('a guard raised just in time parries and staggers the boar', parried.after === parried.before && reel > 1, { parried, reel });
await H('defend', 'guard', 0.5);
await H('aim', boar.x, boar.y + 0.6, boar.z);
await H('hideDebugUi');
await H('renderFrames', 1, 1 / 30);
await page.evaluate(() => window.game.combat.update(0, true));
await page.screenshot({ path: `${out}/guard.png`, timeout: 300_000 });
await H('defend', 'lower');

// Lock-on: aim roughly at a boar, lock, look away; the view comes back round.
await H('teleport', 60, 560, 0);
const target = await H('spawnCreature', 'boar', 1.5, -12);
await page.evaluate((id) => {
  const c = window.game.wildlife.creatures.find((x) => x.id === id);
  c.state = 'graze';
  c.speed = 0;
}, target.id);
await H('aim', target.x + 1, target.y + 0.5, target.z);
const lock = await H('defend', 'lock');
check('lock-on finds the boar', lock.ok && lock.lock && lock.lock.kind === 'creature', lock);
await H('drive', { yaw: (await pos()).yaw + 0.8 }, 0.05);
await H('renderFrames', 30, 1 / 30);
const after = await pos();
const want = Math.atan2(-(target.x - after.x), -(target.z - after.z));
let off = Math.abs(after.yaw - want);
while (off > Math.PI) off = Math.abs(off - Math.PI * 2);
check('the view swings back to the locked target', off < 0.2, { off, yaw: after.yaw, want });
await H('hideDebugUi');
await H('renderFrames', 1, 1 / 30);
await page.screenshot({ path: `${out}/lock-on.png`, timeout: 300_000 });

check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
