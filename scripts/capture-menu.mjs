#!/usr/bin/env node
// Captures the pause menu (graphics tab) and an in-game HUD shot.
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const out = 'artifacts/captures';
mkdirSync(out, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5188/?quality=medium&capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
// In-game: walk a few steps up the camp trail, afternoon light.
await page.evaluate(() => {
  const h = window.__THREE_GAME_TEST_HOOKS__;
  h.setTime(16.2);
  h.drive({ moveY: 1 }, 1.5);
  h.drive({ moveY: 0, pitch: -0.05 }, 0.2);
  h.hideDebugUi();
});
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.renderFrames(3));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/gameplay-hud.png`, timeout: 300_000 });
// Pause menu, graphics tab.
await page.evaluate(() => window.game.openMenu());
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.renderFrames(1));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/settings-menu.png`, timeout: 300_000 });
await browser.close();
console.log('ok');
