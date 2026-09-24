#!/usr/bin/env node
// A look book for judging realism: the island's wide views, trees, grass and
// rock up close, the major buildings, a survivor face to face and the
// first-person hands, all at one preset. Pictures go to
// artifacts/review/<quality>/ with a list in index.json.
// Usage: node scripts/capture-review.mjs [--quality high] [--size 1600x900]
//          [--only forest,varga] [--profile artifacts/tmp/profile] [--url ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'high');
const [width, height] = arg('size', '1600x900').split('x').map(Number);
const only = arg('only', '');
const out = arg('out', `artifacts/review/${quality}`);
mkdirSync(out, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(`${url}/?quality=${quality}&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 300_000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
const H = (fn, ...a) => page.evaluate(({ fn, a }) => window.__THREE_GAME_TEST_HOOKS__[fn](...a), { fn, a });
const index = [];
const want = (name) => !only || only.split(',').includes(name);
const shot = async (name, what) => {
  await H('hideDebugUi');
  // Streaming, shadows and exposure settle over a second or two.
  await H('renderFrames', 50, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png` });
  index.push({ name, file: `${name}.png`, what });
  console.log(`${out}/${name}.png`);
};
const ground = (x, z) => page.evaluate(([x, z]) => window.game.world.groundAt(x, z), [x, z]);
/**
 * A camera spot about `dist` from (tx, tz), preferring `bearing` (radians),
 * that is out of rock, set pieces and tree trunks, above water, and has a
 * clear line to the subject `look` metres above its ground.
 */
const clearSpot = (tx, tz, dist, eye, look, bearing = 0) =>
  page.evaluate(
    ([tx, tz, dist, eye, look, bearing]) => {
      const g = window.game;
      const V = g.camera.position.constructor;
      const target = new V(tx, g.world.groundAt(tx, tz) + look, tz);
      const trees = [];
      for (let k = 0; k < 24; k += 1) {
        const a = bearing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        for (const d of [dist, dist * 0.8, dist * 1.25]) {
          const x = tx + Math.cos(a) * d;
          const z = tz + Math.sin(a) * d;
          const y = Math.max(g.world.groundAt(x, z), g.world.waterLevelAt(x, z)) + eye;
          if (g.landmarks.solids.blocked(x, z, y - 1.2, y + 0.3)) continue;
          g.vegetation.collidersNear(x, z, 2.5, trees);
          if (trees.length > 0) continue;
          const from = new V(x, y, z);
          const to = target.clone().sub(from);
          const len = to.length();
          to.divideScalar(len);
          if (g.world.raycast(from, to, len - 2) >= 0) continue;
          const hit = g.landmarks.solids.raycast(from, to, len);
          if (hit && hit.t < len * 0.7) continue;
          return [x, y, z];
        }
      }
      return [tx + Math.cos(bearing) * dist, g.world.groundAt(tx, tz) + eye + 10, tz + Math.sin(bearing) * dist];
    },
    [tx, tz, dist, eye, look, bearing],
  );
const marks = Object.fromEntries((await H('landmarks')).map((l) => [l.id, l]));

await H('setState', 'play');
await H('setWeather', 'clear');

// Wide views from the named viewpoints (each sets its own hour).
for (const [view, what] of [
  ['crash-site', 'Morning meadow by the crash site: grass, birches, the wreck'],
  ['hollowpine', 'Inside the dark pine forest at mid-morning'],
  ['peaks', 'The snow peaks of the Frostveil at midday'],
  ['meadow-golden', 'Meadows at golden hour'],
  ['coast-cliffs', 'Sea cliffs and ocean in late afternoon'],
  ['volcano', 'The volcanic Cinderreach'],
]) {
  if (!want(view)) continue;
  await H('setState', `view-${view}`);
  await shot(view, what);
}

// Close studies at eye height, late morning.
await H('setState', 'play');
await H('setTime', 10.5);
const close = async (name, what, x, z, tx, tz, eye = 1.65, look = 1.2) => {
  if (!want(name)) return;
  const [cx, cy, cz] = await clearSpot(tx, tz, Math.hypot(tx - x, tz - z), eye, look, Math.atan2(z - tz, x - tx));
  await H('lookFrom', cx, cy, cz, tx, (await ground(tx, tz)) + look, tz);
  await shot(name, what);
};
await close('forest-floor', 'Standing among pine trunks: bark, undergrowth, forest floor', -560, 30, -540, 10, 1.65, 2.5);
await close('meadow-grass', 'Crouched in the meadow grass', 40, 700, 70, 690, 0.9, 0.4);
await close('birch-edge', 'The edge of a birch grove', -10, 640, 20, 600, 1.65, 4);
await close('rock-slope', 'Rock and scree on a mountain slope', -300, -520, -330, -600, 1.8, 8);

// Buildings from a walker's distance.
const building = async (id, what, dx, dz, eye = 1.8, look = 5) => {
  if (!want(id)) return;
  const l = marks[id];
  const [cx, cy, cz] = await clearSpot(l.x, l.z, Math.hypot(dx, dz), eye, look, Math.atan2(dz, dx));
  await H('lookFrom', cx, cy, cz, l.x, l.y + look, l.z);
  await shot(id, what);
};
await building('monastery', 'The Monastery of Hush: stone hall, belfry, court', 22, 26, 2, 5);
await building('ziggurat', 'The Sunken Ziggurat and its grand stair', 4, 40, 2, 7);
await building('lighthouse', 'The Lamplight lighthouse and keeper’s cottage', -18, 20, 2, 10);
await building('galleon', 'The wrecked galleon on the beach', -20, 22, 2, 4);
await building('stilt_village', 'Huts on stilts over the fen', 14, 18, 3, 2);

// A survivor, face to face.
if (want('varga')) {
  const v = await page.evaluate(() => {
    window.game.quests.refresh();
    window.game.story.update(0.1);
    const f = window.game.story.npcFigure('varga');
    return f?.present ? [...f.group.position.toArray(), f.group.rotation.y] : null;
  });
  if (v) {
    // Figures face their local +z: stand in front, a little to one side.
    const [x, y, z, ry] = v;
    const fx = Math.sin(ry + 0.35);
    const fz = Math.cos(ry + 0.35);
    await H('lookFrom', x + fx * 1.7, y + 1.6, z + fz * 1.7, x, y + 1.5, z);
    await shot('varga', 'Captain Ilse Varga, a survivor, from a conversation’s distance');
    await H('lookFrom', x + fx * 4, y + 1.3, z + fz * 4, x, y + 0.95, z);
    await shot('varga-full', 'Captain Varga, full figure');
  }
}

// The survivor's own hands, holding an axe.
if (want('hands')) {
  await H('teleport', 40, 700, -0.6);
  await H('give', 'stone_axe', 1);
  await H('selectItem', 'stone_axe');
  await H('drive', {}, 0.3);
  await shot('hands', 'First person: the survivor’s hands and a stone axe');
}

writeFileSync(`${out}/index.json`, JSON.stringify({ quality, width, height, shots: index }, null, 2));
await browser.close();
