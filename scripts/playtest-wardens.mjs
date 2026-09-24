#!/usr/bin/env node
// All five Wardens: for each, a portrait asleep and awake, a leg knot broken,
// a heart strike while it reels, calmed, its Bellstone rung and its trophy.
// Usage: node scripts/playtest-wardens.mjs [--quality low] [--only tidemother]
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
const out = arg('out', 'artifacts/playtest');
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
  if (m.type() === 'error' && !m.text().includes('ERR_CERT')) logs.push(`[error] ${m.text()}`);
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
  await H('renderFrames', 2, 1 / 60);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
  console.log(`${out}/${name}.png`);
};
const heal = () =>
  page.evaluate(() => {
    const g = window.game;
    if (!g.survival.alive) g.respawn();
    g.survival.health = g.survival.maxHealth;
    g.survival.food = 90;
    g.survival.water = 90;
    g.survival.bodyTemp = 37;
    // Swings cost stamina; a long test would otherwise run dry.
    g.survival.stamina = g.survival.maxStamina;
    g.survival.exhausted = false;
  });

await H('setState', 'play');
await H('give', 'iron_spear', 1);
await H('selectItem', 'iron_spear');
const list = (await H('wardens')).filter((w) => !only || w.id === only);
const hours = { mossback: 15.5, tidemother: 16.8, emberjaw: 11, rimebrow: 13.5, oldcroak: 17.4 };
/** A clear, dry spot about `dist` from the Warden, near its ground height, preferring its front. */
const vantage = (w, dist) =>
  page.evaluate(({ w, dist }) => {
    const world = window.game.world;
    let best = null;
    for (let k = 0; k < 24; k += 1) {
      const a = w.yaw + Math.PI + (k / 24) * Math.PI * 2;
      // Offsets from the Warden's facing: 0 = straight in front.
      const fx = -Math.sin(a + Math.PI);
      const fz = -Math.cos(a + Math.PI);
      const x = w.x + fx * dist;
      const z = w.z + fz * dist;
      const g = world.groundAt(x, z);
      if (world.waterDepthAt(x, z) > 0.2 && !Number.isFinite(world.iceAt(x, z))) continue;
      const front = Math.abs(((k / 24) * 360 + 180) % 360 - 180) / 180;
      const score = Math.abs(g - w.y) + front * 3;
      if (!best || score < best.score) best = { x, z, score };
    }
    return best ?? { x: w.x + dist, z: w.z };
  }, { w, dist });
for (const info of list) {
  const id = info.id;
  await heal();
  await H('setWeather', 'clear');
  await H('setTime', hours[id] ?? 14);
  let w = await H('warden', 'hold', 0, id);
  check(`${id}: sleeps by its bell`, w.mode === 'dormant', { mode: w.mode, x: Math.round(w.x), y: Math.round(w.y), z: Math.round(w.z) });
  const fx = -Math.sin(w.yaw);
  const fz = -Math.cos(w.yaw);
  // A clear view from in front (or the nearest open side).
  let v = await vantage(w, 24);
  await H('teleport', v.x, v.z, 0);
  await H('aim', w.x, w.y + 2.5, w.z);
  await shot(`40-${id}-asleep`);
  await H('warden', 'release', 0, id);
  await H('warden', 'wake', 0, id);
  await H('tickWorld', 0.6);
  w = await H('warden', undefined, 0, id);
  v = await vantage(w, 20);
  await H('teleport', v.x, v.z, 0);
  await H('aim', w.x, w.y + 4, w.z);
  await shot(`41-${id}-awake`);
  check(`${id}: fights`, Boolean(w.boss), w.boss);

  // Break the left foreleg knot.
  await heal();
  w = await H('warden', undefined, 0, id);
  const sx = Math.cos(w.yaw);
  const sz = -Math.sin(w.yaw);
  let leg = w.knotPositions.find((k) => k.name === 'left');
  await H('teleport', leg.x - sx * 2.4 + fx * 0.8, leg.z - sz * 2.4 + fz * 0.8, 0);
  let broke = false;
  for (let i = 0; i < 14 && !broke; i += 1) {
    await heal();
    w = await H('warden', undefined, 0, id);
    leg = w.knotPositions.find((k) => k.name === 'left');
    await H('aim', leg.x, leg.y, leg.z);
    await H('act', 'use', 1.1);
    w = await H('warden', undefined, 0, id);
    broke = w.knots.some((s) => s.startsWith('left:broken'));
  }
  check(`${id}: foreleg knot shatters`, broke && w.mode === 'stagger', { knots: w.knots, mode: w.mode });
  await H('tickWorld', 0.8);
  w = await H('warden', undefined, 0, id);
  const heart = w.knotPositions.find((k) => k.name === 'heart');
  const hfx = -Math.sin(w.yaw);
  const hfz = -Math.cos(w.yaw);
  await H('teleport', heart.x + hfx * 2.4, heart.z + hfz * 2.4, 0);
  await H('aim', heart.x, heart.y, heart.z);
  await shot(`42-${id}-reeling`);
  const before = w.hp;
  await heal();
  await H('act', 'use', 1.1);
  w = await H('warden', undefined, 0, id);
  check(`${id}: heart strike lands`, before - w.hp >= 60, { before, after: w.hp, heart });

  // Calm it and ring the bell.
  await H('warden', 'calm', 0, id);
  await H('tickWorld', 6);
  w = await H('warden', undefined, 0, id);
  check(`${id}: calmed`, w.mode === 'calmed', w.mode);
  v = await vantage(w, 17);
  await H('teleport', v.x, v.z, 0);
  await H('aim', w.x, w.y + 1.5, w.z);
  await shot(`43-${id}-calmed`);
  const bell = (await H('wardens')).find((x) => x.id === id).bell;
  const rung = await H('useStory', `bell:${bell}`);
  check(`${id}: its bell rings`, rung.flags.includes(`rung_${bell}`), rung.flags.filter((f) => f.startsWith('rung_') || f.startsWith('warden_')));
}
const inv = await H('inventory');
check('trophies collected', ['warden_antler', 'tide_pearl', 'ember_core', 'rime_horn', 'choir_bell'].filter((t) => list.some((w) => ({ mossback: 'warden_antler', tidemother: 'tide_pearl', emberjaw: 'ember_core', rimebrow: 'rime_horn', oldcroak: 'choir_bell' })[w.id] === t)).every((t) => inv.some((s) => s.startsWith(t))), inv);
check('no page errors', logs.length === 0, logs.slice(0, 4));
await browser.close();
const passed = results.filter((x) => x.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
