#!/usr/bin/env node
// Steady frame rate on this machine, as a player would see it: stands at a
// few places in real play, waits for streaming to settle, then counts frames
// for a while with dynamic resolution on. Prints fps, graphics-card time per
// stage and the resolution dynamic resolution settled on.
//
// Usage: node scripts/bench.mjs [--preset max] [--fps 30] [--spots camp,forest]
//          [--settle 12] [--seconds 8] [--url http://127.0.0.1:4188]
//          [--profile artifacts/profiles/perf]
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const preset = arg('preset', 'max');
const settle = Number(arg('settle', '12'));
const seconds = Number(arg('seconds', '8'));
const SPOTS = {
  camp: [28, 596, 0],
  meadow: [120, 560, 2.4],
  forest: [-400, 170, 0.3],
  lake: [-250, 60, 1.2],
  coast: [760, 250, -1.57],
};
const spots = arg('spots', 'camp,forest,lake,coast').split(',');

const browser = await launchChromium(args);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}/?quality=${preset}&dynres=1&fps=${arg('fps', '30')}${arg('query', '')}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 300_000, polling: 500 });
await page.evaluate(() => {
  window.__THREE_GAME_TEST_HOOKS__.setState('play');
  window.__THREE_GAME_TEST_HOOKS__.hideDebugUi();
  window.game.clock.set(1, 10);
});
if (arg('eval', '')) await page.evaluate(arg('eval', ''));
const results = [];
for (const spot of spots) {
  const [x, z, yaw] = SPOTS[spot];
  await page.evaluate(([x, z, yaw]) => window.__THREE_GAME_TEST_HOOKS__.teleport(x, z, yaw), [x, z, yaw]);
  await page.waitForTimeout(settle * 1000);
  await page.evaluate(() => window.game.pipeline.gpu.reset());
  await page.evaluate(() => {
    window.__dts = [];
    let last = performance.now();
    const tick = (t) => {
      window.__dts.push(t - last);
      last = t;
      if (window.__dts.length < 100000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const f0 = await page.evaluate(() => window.game.frame);
  const t0 = Date.now();
  await page.waitForTimeout(seconds * 1000);
  const d = await page.evaluate(() => ({ frame: window.game.frame, gpu: window.game.pipeline.gpu.total, stages: { ...window.game.pipeline.gpu.ms }, res: window.game.quality.renderScale * window.game.pipeline.resolutionScale, cpu: window.__THREE_GAME_DIAGNOSTICS__.timings.frameMs }));
  const fps = ((d.frame - f0) * 1000) / (Date.now() - t0);
  const dts = (await page.evaluate(() => window.__dts.splice(0))).slice(2).sort((a, b) => a - b);
  const pct = (q) => dts[Math.min(dts.length - 1, Math.floor(q * dts.length))]?.toFixed(1);
  console.log(`        frame ms p10 ${pct(0.1)} p50 ${pct(0.5)} p90 ${pct(0.9)} p99 ${pct(0.99)} max ${dts.at(-1)?.toFixed(1)}`);
  results.push(fps);
  const st = Object.entries(d.stages).filter(([, v]) => v > 0.4).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
  console.log(`${spot.padEnd(7)} ${fps.toFixed(1).padStart(5)} fps  gpu ${d.gpu.toFixed(1).padStart(5)} ms  cpu ${(d.cpu ?? 0).toFixed(1).padStart(5)} ms  res ${Math.round(d.res * 100)}%  [${st}]`);
}
console.log(`min ${Math.min(...results).toFixed(1)} fps, mean ${(results.reduce((a, b) => a + b, 0) / results.length).toFixed(1)} fps`);
await browser.close();
