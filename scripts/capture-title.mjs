#!/usr/bin/env node
// Title flow: title over the drifting world, difficulty choice, opening
// narration, the wake-up, then Continue after a save.
// Usage: node scripts/capture-title.mjs [quality]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const quality = process.argv[2] ?? 'medium';
const out = 'artifacts/captures';
mkdirSync(out, { recursive: true });
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : { channel: 'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:5188/?quality=${quality}&capture=1&title=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
const hooks = (fn, arg) => page.evaluate(fn, arg);
await hooks(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
const frames = (n, dt = 1 / 30) => hooks(([n, dt]) => window.__THREE_GAME_TEST_HOOKS__.renderFrames(n, dt), [n, dt]);
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
  console.log(`${out}/${name}.png`);
};
const state = () => hooks(() => window.__THREE_GAME_DIAGNOSTICS__.state);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

// 1. Title, a few seconds into the first shot (the shot clock is jumped
// ahead: software rendering is far too slow to play it out).
const jump = (t) => hooks((t) => {
  window.game.titleCam.t = t;
}, t);
await frames(2);
check('boots to title', (await state()) === 'title');
check('title visible', await hooks(() => document.querySelector('.title').classList.contains('open')));
await jump(6);
await frames(6, 0.25);
await shot('title-1');
// Through a cut into the next shot.
await jump(30);
await frames(1);
await jump(7);
await frames(6, 0.25);
await shot('title-2');

// 2. Difficulty.
await page.click('.title-button:has-text("New Journey")');
await shot('title-difficulty');

// 3. Opening narration.
await page.click('.title-choice.recommended');
await page.waitForTimeout(900);
check('narration playing', await hooks(() => document.querySelector('.title-intro').classList.contains('open')));
await frames(1);
check('world holds during narration', (await state()) === 'play' && (await hooks(() => window.game.introHold)) === true);
await shot('title-intro');

// 4. Skip → wake-up.
await page.click('.title-skip');
await frames(10, 0.1);
await shot('wake-1');
await frames(24, 0.1);
await shot('wake-2');
await frames(26, 0.1);
check('wake finished, HUD back', await hooks(() => !document.querySelector('.hud')?.classList.contains('hidden')));
const q = await hooks(() => window.__THREE_GAME_TEST_HOOKS__.quest());
check('first quest started after waking', q.active.includes('waking'), JSON.stringify(q.active));
await shot('wake-3');

// 5. Save, back to the title: Continue shows the save.
await hooks(() => {
  window.__THREE_GAME_TEST_HOOKS__.drive({ moveY: 1 }, 2);
  window.game.playtime = 600;
  window.game.saveSession('auto');
  window.__THREE_GAME_TEST_HOOKS__.setState('title');
});
await frames(3);
const cont = await hooks(() => document.querySelector('.title-button.primary')?.textContent ?? '');
check('continue offered', cont.startsWith('Continue'), cont);
await shot('title-continue');
await page.click('.title-button.primary');
await frames(3);
check('continue resumes play', (await state()) === 'play');
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
