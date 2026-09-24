#!/usr/bin/env node
// The heart of the island: the Hush over Hallowmere and the Crown above it,
// seen from the Rim at dusk and at night; the Crown from camp; the Veil from
// the beach. Then the ending: the Hush turns you back until five bells ring,
// lets you in after, and walking to the Heart plays the epilogue.
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
const shot = async (name, frames = 3) => {
  await H('hideDebugUi');
  await H('renderFrames', frames, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
  console.log(`${out}/${name}.png`);
};
const floor = await page.evaluate(() => window.game.world.heightAt(0, 0));

await H('setState', 'play');
await H('setWeather', 'clear');
// 1. From the Rim Lookout at dusk, then at night.
await H('teleport', -30, 262, 0);
await H('setTime', 19.1);
await H('aim', 0, floor + 90, 0);
await shot('50-hush-dusk');
await H('setTime', 22.6);
await shot('51-hush-night');
// 2. The Crown on the skyline from the crash camp.
await H('setTime', 16.8);
await H('teleport', 26, 600, 0);
await H('aim', 0, floor + 240, 0);
await shot('52-crown-from-camp');
// 3. The Veil from the southern beach at dusk.
await H('setTime', 19.4);
await H('teleport', 6, 872, 0);
await H('aim', 60, 20, 990);
await shot('53-veil-beach');

// 4. The Hush is solid until the bells ring.
await H('setTime', 12);
await H('teleport', 0, 160, 0);
const pushed = await H('drive', { moveY: 1, yaw: 0 }, 3);
const r = Math.hypot(pushed.x, pushed.z);
check('the Hush turns you back', r >= 145, { r });

// 5. Five bells rung: the Hush thins; walk to the Heart; the epilogue plays.
await page.evaluate(() => {
  const g = window.game;
  const done = (step) => ({ status: 'done', step, progress: 0 });
  g.quests.load({
    state: [
      ['waking', done(1)],
      ['shelter', done(4)],
      ['stones', done(5)],
      ['needle', done(3)],
      ['grove_warden', done(4)],
      ['coast_warden', done(3)],
      ['cinder_warden', done(3)],
      ['frost_warden', done(3)],
      ['fen_warden', done(3)],
      ['held_note', { status: 'active', step: 1, progress: 0 }],
    ],
    flags: ['stones_tuned', 'rung_bell_hollowpine', 'rung_bell_coast', 'rung_bell_cinder', 'rung_bell_frost', 'rung_bell_fen'],
    tracked: 'held_note',
  });
});
await H('renderFrames', 40, 0.25);
await H('teleport', 0, 160, 0);
await H('aim', 0, floor + 40, 0);
await shot('54-hush-open');
const walked = await H('drive', { moveY: 1, yaw: 0, sprint: true }, 6);
check('walks through the thinned Hush', Math.hypot(walked.x, walked.z) < 140, walked);
// Straight to the Heart.
await H('teleport', 0, 30, 0);
await H('drive', { moveY: 1, yaw: 0 }, 1);
await H('renderFrames', 2, 1 / 30);
const q = await H('quest');
check('reaching the Heart completes the Held Note', q.done.includes('held_note'), q);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(false));
await page.waitForTimeout(3500);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
check('the epilogue plays', await page.evaluate(() => window.game.title.isIntroPlaying));
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/55-epilogue.png`, timeout: 300_000 });
await page.evaluate(() => window.game.title.skipIntro());
// The city lights up as the note resolves.
await H('setTime', 21.5);
await H('renderFrames', 60, 0.25);
await H('teleport', 30, 150, 0);
await H('aim', 0, floor + 30, 0);
await shot('56-hallowmere-lit');
check('play resumes after the epilogue', await page.evaluate(() => !window.game.title.isIntroPlaying && !window.game.introHold));
check('no page errors', logs.length === 0, logs.slice(0, 4));
await browser.close();
const passed = results.filter((x) => x.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
