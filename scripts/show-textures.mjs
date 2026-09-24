#!/usr/bin/env node
// Renders baked texture-array layers to PNGs for inspection.
// Usage: node scripts/show-textures.mjs foliage:2,bark:0 [--url http://127.0.0.1:5188]
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';
const list = (process.argv[2] ?? 'foliage:2').split(',');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:5188';
mkdirSync('artifacts/captures/textures', { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.goto(`${url}/?quality=low&capture=1`);
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
for (const item of list) {
  const [name, layer] = item.split(':');
  await page.evaluate(([n, l]) => { window.__THREE_GAME_TEST_HOOKS__.showTexture(n, Number(l)); window.__THREE_GAME_TEST_HOOKS__.renderFrames(1); }, [name, layer ?? '0']);
  await page.screenshot({ path: `artifacts/captures/textures/${name}-${layer ?? 0}.png`, timeout: 120000 });
  console.log(`artifacts/captures/textures/${name}-${layer ?? 0}.png`);
}
await browser.close();
