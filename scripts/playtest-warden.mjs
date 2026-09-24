#!/usr/bin/env node
// Warden playtest: walk into Mossback's grove, survive its opening moves,
// shatter a leg knot, strike the heart while it reels, calm it, ring the
// Bellstone. Captures the dormant hillside, the fight and the bloom.
import { existsSync, mkdirSync } from 'node:fs';
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
const shot = async (name) => {
  await H('hideDebugUi');
  await H('renderFrames', 2, 1 / 60);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
  console.log(`${out}/${name}.png`);
};

await H('setState', 'play');
await H('setTime', 15.2);
await H('setWeather', 'clear');
await H('give', 'iron_spear', 1);
await H('selectItem', 'iron_spear');

// 1. Approach: the Warden sleeps like a mossy hill beside its Bellstone.
let w = await H('warden', 'hold');
check('mossback starts dormant', w.mode === 'dormant', w.mode);
const bed = { x: w.x, y: w.y, z: w.z };
await H('teleport', bed.x + 15, bed.z + 9, 0);
await H('aim', bed.x, bed.y + 1.6, bed.z);
await shot('20-mossback-dormant');
await H('warden', 'release');

// 2. Step into the grove: it wakes.
await H('teleport', bed.x + 40, bed.z + 4, Math.PI / 2);
await H('tickWorld', 0.5);
w = await H('warden');
check('wakes when the player enters the grove', w.mode === 'waking' || w.mode === 'stalk', w.mode);
await H('tickWorld', 3.4);
w = await H('warden');
check('boss bar shows', Boolean(w.boss) && w.boss.fraction === 1, w.boss);
check('boss bar visible in HUD', await page.evaluate(() => document.querySelector('.hud-boss').classList.contains('show')));
w = await H('warden');
{
  const fx0 = -Math.sin(w.yaw);
  const fz0 = -Math.cos(w.yaw);
  await H('teleport', w.x + fx0 * 13 + fz0 * 6, w.z + fz0 * 13 - fx0 * 6, 0);
  await H('aim', w.x, w.y + 3, w.z);
  await shot('21-mossback-awake');
  // 3. Stand in the open in front of it: it attacks, and it hurts.
  await H('teleport', w.x + fx0 * 13, w.z + fz0 * 13, 0);
}
const hp0 = await H('tickWorld', 0.05);
let hp = hp0;
let attacked = false;
for (let i = 0; i < 16 && !attacked; i += 1) {
  const state = (await H('warden')).mode;
  if (state === 'stompWindup' || state === 'chargeWindup' || state === 'roots') {
    const ww = await H('warden');
    await H('aim', ww.x, ww.y + 3.2, ww.z);
    await shot(`21-mossback-${state}`);
  }
  hp = await H('tickWorld', 0.6);
  attacked = hp < hp0 - 5;
}
check('Mossback lands a hit on a player who stands still', attacked, { before: hp0, after: hp });
// Back on your feet with a spear in hand for the rest.
await page.evaluate(() => {
  const g = window.game;
  if (!g.survival.alive) g.respawn();
  g.survival.health = g.survival.maxHealth;
});
await H('give', 'iron_spear', 1);
await H('selectItem', 'iron_spear');

// 4. Break a leg knot: it staggers.
await H('warden', 'reset');
await H('warden', 'wake');
await H('tickWorld', 0.1);
w = await H('warden');
const leg = w.knotPositions.find((k) => k.name === 'left');
const fx = -Math.sin(w.yaw);
const fz = -Math.cos(w.yaw);
// Stand beside the left foreleg, just outside it.
const sideX = Math.cos(w.yaw);
const sideZ = -Math.sin(w.yaw);
await H('teleport', leg.x - sideX * 2.2 + fx * 0.6, leg.z - sideZ * 2.2 + fz * 0.6, 0);
let broke = false;
for (let i = 0; i < 10 && !broke; i += 1) {
  w = await H('warden');
  const k = w.knotPositions.find((kk) => kk.name === 'left');
  await H('aim', k.x, k.y, k.z);
  await H('act', 'use', 1.1);
  w = await H('warden');
  broke = w.knots.some((s) => s.startsWith('left:broken'));
}
check('leg knot shatters under spear blows', broke, w.knots);
check('Mossback reels when a knot breaks', w.mode === 'stagger', w.mode);
// Let it sink to its knees, then step in front of the chest.
await H('tickWorld', 0.8);
w = await H('warden');
const heart = w.knotPositions.find((k) => k.name === 'heart');
check('heart knot opens while it reels', heart.open, heart);
const hfx = -Math.sin(w.yaw);
const hfz = -Math.cos(w.yaw);
await H('teleport', heart.x + hfx * 2.4, heart.z + hfz * 2.4, 0);
await H('aim', heart.x, heart.y, heart.z);
await shot('22-mossback-stagger');
const hpBefore = w.hp;
await H('aim', heart.x, heart.y, heart.z);
await H('act', 'use', 1.1);
w = await H('warden');
check('heart strike deals heavy damage', hpBefore - w.hp >= 60, { before: hpBefore, after: w.hp });

// 5. Calm it; ring the Bellstone.
await H('warden', 'calm');
await H('tickWorld', 6);
w = await H('warden');
check('Mossback kneels calmed', w.mode === 'calmed', w.mode);
const q = await H('quest');
check('quest flag set', q.flags.includes('warden_hollowpine'), q.flags);
await H('teleport', w.x + 10, w.z + 7, 0);
await H('setTime', 17.6);
await H('aim', w.x, w.y + 1.6, w.z);
await shot('23-mossback-calmed');
const bell = await H('useStory', 'bell:bell_hollowpine');
check('bellstone rings once freed', bell.flags.includes('rung_bell_hollowpine'), bell.flags);
const inv = await H('inventory');
check('the grove gives an antler', inv.some((s) => s.startsWith('warden_antler')), inv);
check('no page errors', logs.filter((l) => l.includes('pageerror')).length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
