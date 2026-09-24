#!/usr/bin/env node
// Scripted playtest: boots into play mode, drives the survivor through core
// movement (walk, sprint, jump, swim, climb), asserts on the results and
// saves HUD screenshots. Usage: node scripts/playtest.mjs [--quality low] [--size 960x540]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const [width, height] = arg('size', '960x540').split('x').map(Number);
const out = arg('out', 'artifacts/playtest');
const only = arg('only', '');
mkdirSync(out, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('ERR_CERT')) logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const started = Date.now();
await page.goto(`${url}/?quality=${quality}&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
console.log(`boot ${(Date.now() - started) / 1000}s`);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));

const hooks = (fn, ...a) => page.evaluate(({ fn, a }) => window.__THREE_GAME_TEST_HOOKS__[fn](...a), { fn, a });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ? JSON.stringify(detail) : ''}`);
};
const shot = async (name) => {
  await hooks('renderFrames', 2);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
};
const want = (name) => !only || only.split(',').includes(name);

await hooks('setState', 'play');
const spawn = await hooks('drive', {}, 0.2);
check('spawn on ground', spawn.state === 'ground', spawn);
if (want('spawn')) await shot('01-spawn');

// Walk forward 3 s, east across the meadow (north of the spawn, the camp's
// crates stand in the way, and they are solid).
const EAST = -Math.PI / 2;
const walk = await hooks('drive', { moveY: 1, yaw: EAST }, 3);
const walked = Math.hypot(walk.x - spawn.x, walk.z - spawn.z);
check('walk ~4.6 m/s', walked > 10 && walked < 15.5, { walked: walked.toFixed(2), state: walk.state });

// Sprint 2 s.
const before = walk;
const sprint = await hooks('drive', { moveY: 1, sprint: true, yaw: EAST }, 2);
const sprinted = Math.hypot(sprint.x - before.x, sprint.z - before.z);
check('sprint faster than walk', sprinted > 11, { sprinted: sprinted.toFixed(2), stamina: sprint.stamina.toFixed(1) });
check('sprint drains stamina', sprint.stamina < 90, { stamina: sprint.stamina });

// Jump.
await hooks('drive', {}, 1.5);
const jump = await hooks('drive', { jump: true }, 0.2);
check('jump leaves ground', jump.state === 'air', jump);
const landed = await hooks('drive', {}, 1.2);
check('lands again', landed.state === 'ground', landed);
if (want('walk')) await shot('02-after-walk');

// Swim: walk from the beach into the sea (south coast).
await hooks('teleport', 2, 880, Math.PI);
const swim = await hooks('drive', { moveY: 1 }, 10);
check('enters swimming', swim.state === 'swim', swim);
if (want('swim')) await shot('03-swimming');

// Climb: find a steep face near the volcano rim and push into it.
const climbStart = await page.evaluate(() => {
  const g = window.game;
  const w = g.world;
  for (let r = 150; r < 420; r += 3) {
    for (let a = 0; a < 360; a += 7) {
      const x = 560 + Math.cos((a * Math.PI) / 180) * r;
      const z = -640 + Math.sin((a * Math.PI) / 180) * r;
      const s = w.slopeAt(x, z);
      if (s > 0.1) continue;
      // Steep face 2 m ahead toward the volcano centre.
      const dx = 560 - x;
      const dz = -640 - z;
      const l = Math.hypot(dx, dz);
      const ax = x + (dx / l) * 2.5;
      const az = z + (dz / l) * 2.5;
      const n = new g.camera.position.constructor();
      w.smoothNormalAt(ax, az, n);
      if (n.y < 0.55 && w.heightAt(ax, az) - w.heightAt(x, z) > 1.5 && w.waterDepthAt(x, z) < 0) {
        return { x, z, yaw: Math.atan2(-dx, -dz) };
      }
    }
  }
  return null;
});
if (climbStart) {
  await hooks('teleport', climbStart.x, climbStart.z, climbStart.yaw);
  const pushed = await hooks('drive', { moveY: 1 }, 1.2);
  check('starts climbing a steep face', pushed.state === 'climb', { ...pushed, from: climbStart });
  const climbed = await hooks('drive', { moveY: 1 }, 2);
  check('climbing gains height', climbed.y > pushed.y + 1 || climbed.state === 'ground', { before: pushed.y, after: climbed.y, state: climbed.state, stamina: climbed.stamina });
  if (want('climb')) await shot('04-climbing');
} else check('found a climbable face', false, null);

const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
writeFileSync(`${out}/results.json`, JSON.stringify({ results, diag, logs }, null, 2));
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
