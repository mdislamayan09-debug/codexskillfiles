#!/usr/bin/env node
// A character studio: every survivor in daylight, turned to face the camera,
// as a head-and-shoulders portrait, a three-quarter full figure and a
// profile, plus the survivor's own hands in first person. For judging and
// iterating on the people of the island.
// Usage: node scripts/capture-characters.mjs [--quality high] [--only varga]
//          [--profile artifacts/tmp/profile] [--url ...] [--out dir]
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'high');
const only = arg('only', '');
const out = arg('out', 'artifacts/review/characters');
mkdirSync(out, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${url}/?quality=${quality}&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 300_000, polling: 500 });
const H = (fn, ...a) => page.evaluate(({ fn, a }) => window.__THREE_GAME_TEST_HOOKS__[fn](...a), { fn, a });
await H('freeze', true);
await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', 10);
// Everyone found: Tock and Wren back at camp, Ilyr at the Singing Stones.
const people = await page.evaluate(() => {
  const g = window.game;
  const done = ['waking', 'shelter', 'stones', 'rescue_tock', 'rescue_wren'];
  g.quests.load({ state: done.map((id) => [id, { status: 'done', step: 99, progress: 0 }]), flags: ['stones_tuned', 'vault_open', 'read_mural', 'has_lantern'], tracked: null });
  // Stand the player well away, so no one turns to look at them.
  g.player.position.set(g.player.position.x + 400, g.player.position.y, g.player.position.z + 400);
  g.story.update(0.1);
  return ['varga', 'tock', 'wren', 'ilyr'].map((id) => {
    const p = g.story.npcPosition(id);
    return p ? { id, x: p.x, y: p.y, z: p.z } : { id, x: 0, y: 0, z: 0, missing: true };
  });
});
const shot = async (name) => {
  await H('hideDebugUi');
  await H('renderFrames', 40, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
};
/** Look at `id` from `yaw` radians round its front, `dist` away, lens `fov`. */
const pose = (id, yaw, dist, eye, look, fov) =>
  page.evaluate(
    ([id, yaw, dist, eye, look, fov]) => {
      const g = window.game;
      const f = g.story.npcFigure(id);
      // Figures face their local -z; turn this one so its front faces +x.
      f.group.rotation.y = -Math.PI / 2;
      const p = f.group.position;
      // The camera sits round the figure from its front (+x), by `yaw`.
      const x = p.x + Math.cos(yaw) * dist;
      const z = p.z + Math.sin(yaw) * dist;
      g.camera.fov = fov;
      g.camera.updateProjectionMatrix();
      window.__THREE_GAME_TEST_HOOKS__.lookFrom(x, p.y + eye, z, p.x, p.y + look, p.z);
    },
    [id, yaw, dist, eye, look, fov],
  );
for (const p of people) {
  if (p.missing || (only && !only.split(',').includes(p.id))) continue;
  await pose(p.id, 0.25, 1.35, 1.62, 1.55, 30);
  await shot(`${p.id}-portrait`);
  await pose(p.id, 0.55, 4.2, 1.35, 0.95, 32);
  await shot(`${p.id}-figure`);
  await pose(p.id, Math.PI / 2, 1.6, 1.6, 1.52, 30);
  await shot(`${p.id}-profile`);
}
if (!only || only.split(',').includes('hands')) {
  await page.evaluate(() => {
    const g = window.game;
    g.camera.fov = 74;
    g.camera.updateProjectionMatrix();
  });
  await H('teleport', 40, 700, -0.6);
  await H('give', 'stone_axe', 1);
  await H('selectItem', 'stone_axe');
  await H('drive', {}, 0.3);
  await shot('hands-axe');
  await H('give', 'torch', 1);
  await H('selectItem', 'torch');
  await H('setTime', 21);
  await H('drive', {}, 0.3);
  await shot('hands-torch');
}
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
