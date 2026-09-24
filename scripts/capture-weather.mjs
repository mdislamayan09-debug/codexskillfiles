#!/usr/bin/env node
// Captures weather states at viewpoints: node scripts/capture-weather.mjs [quality]
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const quality = process.argv[2] ?? 'medium';
const out = 'artifacts/captures';
mkdirSync(out, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://127.0.0.1:5188/?quality=${quality}&capture=1&view=crash-site`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
const shots = [
  ['crash-site', 'rain', 13],
  ['meadow-golden', 'fog', 7.2],
  ['peaks', 'snow', 13],
];
for (const [view, weather, hour] of shots) {
  await page.evaluate(({ view, weather, hour }) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.setState(view);
    h.setWeather(weather);
    h.setTime(hour);
    h.renderFrames(6, 1 / 10);
  }, { view, weather, hour });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/weather-${weather}.png`, timeout: 300_000 });
  console.log('shot', weather);
}
await browser.close();
