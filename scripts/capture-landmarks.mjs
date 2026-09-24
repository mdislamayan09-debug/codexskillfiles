#!/usr/bin/env node
// A tour of the island's landmarks: a picture of each set piece from a clear
// vantage, then a cache searched (items and a journal page) and one of Jonah
// Reed's traps stepped in.
// Usage: node scripts/capture-landmarks.mjs [--quality low] [--only galleon,lighthouse]
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
const out = arg('out', 'artifacts/playtest/landmarks');
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

// Height of interest per place (what to aim the camera at, above its ground).
const focus = {
  old_aqueduct: [9, 45], lighthouse: [14, 55], hollow_elder: [18, 60], floating_isle: [28, 70], frozen_titan: [16, 60], galleon: [6, 45],
  sunken_face: [4, 45], monastery: [8, 45], ziggurat: [6, 50], stilt_village: [3, 35], trapper_cabin: [2, 18], sled_camp: [1, 18],
  old_persistence: [3, 22], whispering_cave: [2, 20], crystal_grotto: [2, 20], ice_caves: [2, 22], lava_tubes: [2, 22], echo_garden: [2, 22],
  fungus_ring: [1, 22], duskhound_den: [2, 24], tide_pools: [1, 24], hot_springs: [1, 28], poppy_hill: [1, 20], aurora_overlook: [1, 20], lanternfly_hollow: [2, 26],
};
const high = { hollow_elder: 44, duskhound_den: 26, trapper_cabin: 18, lanternfly_hollow: 24, fungus_ring: 20, floating_isle: 26, echo_garden: 16 };
const hours = { lighthouse: 20.6, fungus_ring: 20.8, lanternfly_hollow: 20.4, aurora_overlook: 22.5, monastery: 19.6, galleon: 19.2 };
await H('setState', 'play');
await H('setWeather', 'clear');
const places = (await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.landmarks())).filter((l) => focus[l.id] && (!only || only.split(',').includes(l.id)));
for (const lm of places) {
  const [lift, dist] = focus[lm.id];
  await H('setTime', hours[lm.id] ?? 15.5);
  // A free camera a little above head height, on the side with the clearest
  // line of sight over the ground and between the trunks.
  const v = await page.evaluate(({ lm, dist, lift, high }) => {
    const world = window.game.world;
    const veg = window.game.vegetation;
    const ty = lm.y + lift * 0.55;
    let best = null;
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      const x = lm.x + Math.cos(a) * dist;
      const z = lm.z + Math.sin(a) * dist;
      const ground = Math.max(world.groundAt(x, z), world.waterLevelAt(x, z));
      // Places in deep forest are seen from above the canopy.
      const y = ground + (high[lm.id] ?? 2.2 + dist * 0.07 + lift * 0.25);
      let blocked = 0;
      for (let i = 1; i < 30; i += 1) {
        const t = i / 30;
        const sx = x + (lm.x - x) * t;
        const sz = z + (lm.z - z) * t;
        const sy = y + (ty - y) * t;
        if (world.groundAt(sx, sz) > sy - 0.3) blocked += 3;
        if (t < 0.85) blocked += veg.collidersNear(sx, sz, 1.4, []).length;
      }
      const score = blocked + (k % 4) * 0.01;
      if (!best || score < best.score) best = { x, y, z, score, ty };
    }
    return best;
  }, { lm, dist, lift, high });
  // Caves are seen from in front of their mouths, not the top of their hills.
  const cave = (await H('caves')).find((c) => c.id === lm.id);
  if (cave) {
    const [mx, my, mz] = cave.mouth;
    const [dx, dz] = cave.dir;
    await H('lookFrom', mx - dx * 13 + dz * 3, my + 3.5, mz - dz * 13 - dx * 3, mx + dx * 2, my + 1.4, mz + dz * 2);
  } else await H('lookFrom', v.x, v.y, v.z, lm.x, v.ty, lm.z);
  await H('renderFrames', 3, 1 / 30);
  await page.screenshot({ path: `${out}/${lm.id}.png`, timeout: 300_000 });
  console.log(`${out}/${lm.id}.png blocked=${v.score.toFixed(1)}`);
}
await H('setState', 'play');

// A cache: search it, get items and a page.
const cache = await page.evaluate(() => {
  const h = window.__THREE_GAME_TEST_HOOKS__;
  const before = h.inventory().length;
  const r = h.useStory('cache:galleon');
  const journal = [...window.game.discovered].filter((id) => id.startsWith('lore:'));
  const again = h.useStory('cache:galleon');
  return { before, after: h.inventory().length, flags: r.flags.filter((f) => f.startsWith('looted')), journal, again: again.prompt };
});
check('searching a cache pays out once', cache.after > cache.before && cache.flags.includes('looted:galleon') && cache.again === null, cache);
check('the cache adds a journal page', cache.journal.includes('lore:galleon'), cache.journal);

// One of Jonah Reed's traps.
const trapped = await page.evaluate(() => {
  const h = window.__THREE_GAME_TEST_HOOKS__;
  const lm = h.landmarks().find((l) => l.id === 'trapper_cabin');
  window.game.survival.health = window.game.survival.maxHealth;
  const before = window.game.survival.health;
  h.teleport(lm.x + 8, lm.z - 4, 0);
  h.renderFrames(2, 1 / 30);
  return { before, after: window.game.survival.health };
});
check('an old trap still bites', trapped.after < trapped.before, trapped);
check('no page errors', logs.length === 0, logs.slice(0, 4));
await browser.close();
const passed = results.filter((x) => x.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
