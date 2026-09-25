#!/usr/bin/env node
// Solid set pieces: walls stop you, doorways and arches let you through,
// the ziggurat's stair climbs to its shrine, the stilt village's steps lead
// up out of the fen and along its boardwalks, and every landmark's cache can
// still be walked up to.
// Usage: node scripts/playtest-landmarks.mjs [--quality low] [--only ziggurat]
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

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
const browser = await launchChromium();
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
const want = (id) => !only || only.split(',').includes(id);
const shot = async (name) => {
  await H('hideDebugUi');
  await H('renderFrames', 2, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png` });
};
const r2 = (v) => Math.round(v * 100) / 100;

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 11);
await page.evaluate(() => {
  window.game.survival.godMode = true;
});
const marks = Object.fromEntries((await H('landmarks')).map((l) => [l.id, l]));
const solids = await page.evaluate(() => window.game.landmarks.solids.size);
const buildMs = await page.evaluate(() => Math.round(window.__THREE_GAME_DIAGNOSTICS__?.timings?.landmarksMs ?? -1));
check('set pieces are solid', solids > 10000, { spans: solids, buildMs });

/** Stand at (x, z) facing (tx, tz) and walk `seconds` toward it. */
const walk = async (x, z, tx, tz, seconds, extra = {}) => {
  await H('teleport', x, z, Math.atan2(-(tx - x), -(tz - z)));
  return H('drive', { moveY: 1, yaw: Math.atan2(-(tx - x), -(tz - z)), ...extra }, seconds);
};
/** Walk on toward (tx, tz), re-aiming every tenth of a second; stop on arrival. */
const follow = (tx, tz, seconds, extra = {}) =>
  page.evaluate(
    ([tx, tz, seconds, extra]) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      const p = window.game.player.position;
      let r = null;
      for (let t = 0; t < seconds; ) {
        const d = Math.hypot(tx - p.x, tz - p.z);
        if (d < 0.25) break;
        // Shorter steps near the mark, so the walk does not run past it.
        const step = Math.max(1 / 30, Math.min(0.1, (d - 0.2) / 5));
        r = hooks.drive({ moveY: 1, yaw: Math.atan2(-(tx - p.x), -(tz - p.z)), ...extra }, step);
        t += step;
      }
      // Stop on the spot, as a walker would before turning.
      if (r) r = hooks.drive({}, 0.3);
      return r ?? { x: p.x, y: p.y, z: p.z, state: window.game.player.state };
    },
    [tx, tz, seconds, extra],
  );

// Walls: the monastery hall, the lighthouse tower, the galleon's hull.
if (want('monastery')) {
  const m = marks.monastery;
  // The hall is 9 m deep; its long walls face north and south.
  const p = await walk(m.x, m.z + 9, m.x, m.z, 4);
  check('the monastery wall stops you', p.z - m.z > 4.5 + 0.2, { z: r2(p.z - m.z) });
}
if (want('lighthouse')) {
  const l = marks.lighthouse;
  const p = await walk(l.x - 9, l.z, l.x, l.z, 4);
  check('the lighthouse tower stops you', Math.hypot(p.x - l.x, p.z - l.z) > 3.4, { d: r2(Math.hypot(p.x - l.x, p.z - l.z)) });
}
if (want('galleon')) {
  const g = marks.galleon;
  // Across the hull amidships, from the port side: she lies along the
  // beach listing to seaward, so port is uphill (the breach is to starboard).
  const port = await page.evaluate(([x, z]) => {
    const w = window.game.world;
    const gx = w.groundAt(x + 3, z) - w.groundAt(x - 3, z);
    const gz = w.groundAt(x, z + 3) - w.groundAt(x, z - 3);
    const l = Math.hypot(gx, gz) || 1;
    return { x: gx / l, z: gz / l };
  }, [g.x, g.z]);
  const p = await walk(g.x + port.x * 10, g.z + port.z * 10, g.x, g.z, 5);
  check('the galleon hull stops you', Math.hypot(p.x - g.x, p.z - g.z) > 2.5, { d: r2(Math.hypot(p.x - g.x, p.z - g.z)) });
}

// Ways through: the cabin door, the aqueduct's arches.
if (want('trapper_cabin')) {
  const c = marks.trapper_cabin;
  const p = await walk(c.x + 7, c.z, c.x - 1, c.z, 4);
  check("Jonah Reed's door lets you in", p.x - c.x < 1.2, { x: r2(p.x - c.x) });
  await shot('cabin');
}
if (want('old_aqueduct')) {
  const a = marks.old_aqueduct;
  // Under the arch of the middle bay (the arcade runs north to south).
  const p = await walk(a.x - 8, a.z, a.x + 8, a.z, 4);
  check('you can walk under the aqueduct', p.x - a.x > 5, { x: r2(p.x - a.x) });
}

// Climbing: the ziggurat's grand stair to the shrine and its cache.
if (want('ziggurat')) {
  const z = marks.ziggurat;
  const start = await walk(z.x, z.z + 24, z.x, z.z, 1);
  const top = await follow(z.x, z.z, 26, { sprint: false });
  check('the ziggurat stair climbs to the shrine', top.y - start.y > 12 && Math.hypot(top.x - z.x, top.z - z.z) < 3, { rise: r2(top.y - start.y), d: r2(Math.hypot(top.x - z.x, top.z - z.z)), state: top.state });
  await shot('ziggurat-top');
  const cache = await page.evaluate(() => window.game.story.interactables.find((i) => i.id === 'cache:ziggurat').position.toArray());
  check('its cache waits in the shrine', Math.abs(cache[1] - top.y) < 0.6 && Math.hypot(cache[0] - top.x, cache[2] - top.z) < 3, { cacheY: r2(cache[1]), you: r2(top.y) });
}

// The stilt village: up the steps from the punt, along the boardwalks.
if (want('stilt_village')) {
  const s = marks.stilt_village;
  const water = await page.evaluate(([x, z]) => window.game.world.waterLevelAt(x, z), [s.x, s.z]);
  // Wade in to the foot of the steps and climb to the first hut's ledge.
  const foot = await walk(s.x + 2, s.z + 9, s.x + 2, s.z, 0.1);
  const up = await follow(s.x + 2, s.z + 2.4, 8);
  check('the steps lead up out of the fen', up.y > water + 1.7 && up.state === 'ground', { from: r2(foot.y - water), to: r2(up.y - water), state: up.state });
  // In at the door (on the south wall, just east of the middle).
  await follow(s.x + 0.5, s.z + 2.4, 3);
  const inside = await follow(s.x + 0.5, s.z - 0.3, 3);
  check('and in at the door of the first hut', Math.hypot(inside.x - s.x - 0.5, inside.z - s.z) < 1 && inside.y > water + 1.7, { x: r2(inside.x - s.x), z: r2(inside.z - s.z), y: r2(inside.y - water) });
  await shot('stilt-hut');
  // Out again, round the ledge and along the boardwalk to the hut at (9, 4).
  const route = [];
  for (const [wx, wz] of [[0.5, 2.4], [2.4, 2.4], [2.4, 1.1]]) {
    const q = await follow(s.x + wx, s.z + wz, 3);
    route.push([r2(q.x - s.x), r2(q.y - water), r2(q.z - s.z)]);
  }
  const along = await follow(s.x + 9, s.z + 4, 8);
  console.log('stilt route', JSON.stringify(route));
  check('the boardwalk carries you dry to the next hut', along.state !== 'swim' && along.y > water + 1.5 && Math.hypot(along.x - s.x - 9, along.z - s.z - 4) < 3.2, { state: along.state, y: r2(along.y - water), d: r2(Math.hypot(along.x - s.x - 9, along.z - s.z - 4)) });
}

// Every cache can still be walked up to, from at least one side.
const caches = await page.evaluate(() =>
  window.game.story.interactables.filter((i) => i.id.startsWith('cache:')).map((i) => ({ id: i.id.slice(6), p: i.position.toArray() })),
);
const skip = new Set(['ziggurat', 'stilt_village', 'floating_isle', 'dawnwell', 'noonwell', 'duskwell', 'whispering_cave', 'crystal_grotto', 'lava_tubes', 'ice_caves', 'tocks_vault']);
const unreachable = [];
for (const c of caches) {
  if (skip.has(c.id) || !want(c.id)) continue;
  const [cx, cy, cz] = c.p;
  let best = Infinity;
  for (let k = 0; k < 8 && best > 1.9; k += 1) {
    const a = (k / 8) * Math.PI * 2;
    await H('teleport', cx + Math.cos(a) * 7, cz + Math.sin(a) * 7, 0);
    const p = await follow(cx, cz, 4);
    // Near enough to reach from where you stand (or tread water).
    if (Math.abs(p.y + 1.6 - cy) < 2.2 || p.state === 'swim') best = Math.min(best, Math.hypot(p.x - cx, p.z - cz));
  }
  if (best > 1.9) {
    // What stands in the way: solid at body height round the crate.
    const map = await page.evaluate(([cx, cy, cz]) => {
      const f = window.game.landmarks.solids;
      const rows = [];
      for (let dz = -5; dz <= 5; dz += 0.5) {
        let row = '';
        for (let dx = -5; dx <= 5; dx += 0.5) row += Math.abs(dx) < 0.3 && Math.abs(dz) < 0.3 ? 'C' : f.blocked(cx + dx, cz + dz, cy - 1.2, cy + 0.9) ? '#' : '.';
        rows.push(row);
      }
      return rows.join('\n');
    }, [cx, cy, cz]);
    console.log(`${c.id} (best ${r2(best)} m):\n${map}`);
    unreachable.push({ id: c.id, best: r2(best) });
  }
}
check('every cache can be walked up to', unreachable.length === 0, unreachable);

check('no page errors', logs.length === 0, logs.slice(0, 5));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
