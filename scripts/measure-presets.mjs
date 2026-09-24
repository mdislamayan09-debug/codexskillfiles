#!/usr/bin/env node
// Frame cost of every graphics preset on this machine: for each preset, the
// same views are held and the game reports graphics-card milliseconds per
// stage (where the browser can time the GPU), CPU milliseconds per frame,
// draw calls and triangles, and the frame rate its own loop reaches.
// Writes artifacts/perf/presets-<size>.md and .json.
//
// Usage: node scripts/measure-presets.mjs [--size 1920x1080]
//          [--presets low,medium,high,extra,max] [--views crash-site,hollowpine]
//          [--seconds 4] [--url ...] [--gpu]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const size = arg('size', '1920x1080');
const [width, height] = size.split('x').map(Number);
const presets = arg('presets', 'low,medium,high,extra,max').split(',');
const views = arg('views', 'crash-site,hollowpine,beach,glasswood').split(',');
const seconds = Number(arg('seconds', '4'));
mkdirSync('artifacts/perf', { recursive: true });

const browser = await launchChromium();
const rows = [];
let gpuName = '';
for (const preset of presets) {
  // One page per preset: the preset is fixed at boot. The island is cached
  // after the first load, so later presets start quickly.
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${url}/?quality=${preset}&capture=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 300_000, polling: 500 });
  for (const view of views) {
    await page.evaluate((view) => {
      const H = window.__THREE_GAME_TEST_HOOKS__;
      H.freeze(true);
      H.setState(`view-${view}`);
      H.hideDebugUi();
      // Let streaming, shadows and exposure settle.
      H.renderFrames(40, 1 / 60);
      H.freeze(false);
    }, view);
    // Let the first frames (shader compiles, streaming) pass, then forget
    // them: the timer smooths, and a stall of seconds would colour the mean.
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.game.pipeline.gpu.reset());
    // The game's own loop, as a player would run it.
    const f0 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
    const t0 = Date.now();
    await page.waitForTimeout(seconds * 1000);
    const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    const fps = ((d.frame - f0) * 1000) / (Date.now() - t0);
    gpuName = d.world?.gpu ?? gpuName;
    const gpu = d.gpu ?? {};
    const row = {
      preset,
      view,
      fps: Math.round(fps * 10) / 10,
      gpuMs: Math.round((d.timings?.gpuMs ?? 0) * 10) / 10,
      cpuMs: Math.round((d.timings?.frameMs ?? 0) * 10) / 10,
      draws: d.renderer.calls,
      trisM: Math.round((d.renderer.triangles / 1e6) * 100) / 100,
      stages: Object.fromEntries(Object.entries(gpu).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    };
    rows.push(row);
    console.log(`${preset.padEnd(7)} ${view.padEnd(12)} ${String(row.fps).padStart(5)} fps  gpu ${String(row.gpuMs).padStart(5)} ms  cpu ${String(row.cpuMs).padStart(5)} ms  ${row.draws} draws  ${row.trisM}M tris  ${JSON.stringify(row.stages)}`);
  }
  await page.close();
}
await browser.close();

// A table per preset: the mean over the views, and each stage's share.
const stageNames = [...new Set(rows.flatMap((r) => Object.keys(r.stages)))];
const mean = (list, f) => Math.round((list.reduce((a, r) => a + f(r), 0) / list.length) * 10) / 10;
const lines = [
  `# Preset frame cost, ${size}`,
  '',
  `GPU: ${gpuName}. Views: ${views.join(', ')}. Means over the views; GPU ms from timer queries (0 where the browser cannot time the GPU).`,
  '',
  `| Preset | fps | GPU ms | CPU ms | Draws | Tris (M) | ${stageNames.join(' | ')} |`,
  `| --- | --- | --- | --- | --- | --- | ${stageNames.map(() => '---').join(' | ')} |`,
];
for (const preset of presets) {
  const list = rows.filter((r) => r.preset === preset);
  lines.push(`| ${preset} | ${mean(list, (r) => r.fps)} | ${mean(list, (r) => r.gpuMs)} | ${mean(list, (r) => r.cpuMs)} | ${Math.round(mean(list, (r) => r.draws))} | ${mean(list, (r) => r.trisM)} | ${stageNames.map((s) => mean(list, (r) => r.stages[s] ?? 0)).join(' | ')} |`);
}
const md = lines.join('\n');
writeFileSync(`artifacts/perf/presets-${size}.md`, `${md}\n`);
writeFileSync(`artifacts/perf/presets-${size}.json`, JSON.stringify({ gpu: gpuName, size, rows }, null, 2));
console.log(`\n${md}`);
