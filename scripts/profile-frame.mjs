#!/usr/bin/env node
// Where a preset's frame goes. Stands the player at a few places in real
// play, holds the scene resolution fixed, measures the frame, then hides
// one thing at a time (grass, each tree level of detail, the trees' shadow
// casters, props, landmarks, terrain, water, all shadows) and measures
// again. The difference is what that thing costs on this graphics card.
//
// Usage: node scripts/profile-frame.mjs [--preset max] [--spots camp,forest]
//          [--scale 0.6] [--only base,grass] [--seconds 3] [--shot] [--url ...]
//          [--profile artifacts/profiles/perf]
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const preset = arg('preset', 'max');
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const seconds = Number(arg('seconds', '3'));
const scale = Number(arg('scale', '1'));
const only = arg('only', '');
const tag = arg('tag', '');
const SPOTS = {
  camp: [28, 596, 0],
  meadow: [120, 560, 2.4],
  forest: [-400, 170, 0.3],
  coast: [760, 250, -1.57],
};
const spots = arg('spots', 'camp,forest').split(',');
mkdirSync('artifacts/perf/shots', { recursive: true });

const browser = await launchChromium(args);
const page = await browser.newPage({ viewport: { width, height } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}/?quality=${preset}&capture=1&gpustages${arg('query', '')}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 300_000, polling: 500 });
await page.evaluate((scale) => {
  const H = window.__THREE_GAME_TEST_HOOKS__;
  H.setState('play');
  H.hideDebugUi();
  window.game.clock.set(1, 10);
  const p = window.game.pipeline;
  p.resolution.dynamic = false;
  // Hold the scene at a fixed share of the preset's resolution.
  p.quality.renderScale *= scale;
  p.resize(true);
}, scale);

// Things to hide, as expressions returning a list of objects.
const groups = {
  grass: 'g.grass.group',
  lod0: 'g.vegetation.kinds.flatMap((k) => [k.bark0, k.leaves0])',
  lod1: 'g.vegetation.kinds.flatMap((k) => [k.bark1, k.leaves1])',
  impostors: 'g.vegetation.impostors.mesh',
  treeShadows: 'g.vegetation.kinds.flatMap((k) => [k.shadowBark, k.shadowLeaves])',
  props: 'g.props.group',
  landmarks: 'g.landmarks.group',
  story: 'g.story.group',
  terrain: 'g.terrain.mesh',
  water: 'g.water.group',
  creatures: '[g.wildlife.group, g.birds.group]',
};

async function hide(expr, hidden) {
  await page.evaluate(
    ([expr, hidden]) => {
      const g = window.game;
      const list = [eval(expr)].flat().filter(Boolean);
      for (const root of list) {
        root.traverse((o) => {
          if (hidden) {
            o.userData.__mask = o.layers.mask;
            o.layers.mask = 1 << 30;
          } else if (o.userData.__mask !== undefined) {
            o.layers.mask = o.userData.__mask;
            delete o.userData.__mask;
          }
        });
      }
    },
    [expr, hidden],
  );
}

async function measure() {
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.game.pipeline.gpu.reset());
  const f0 = await page.evaluate(() => window.game.frame);
  const t0 = Date.now();
  await page.waitForTimeout(seconds * 1000);
  const d = await page.evaluate(() => ({
    frame: window.game.frame,
    gpu: { ...window.game.pipeline.gpu.ms },
    total: window.game.pipeline.gpu.total,
    calls: window.__THREE_GAME_DIAGNOSTICS__.renderer.calls,
    tris: window.__THREE_GAME_DIAGNOSTICS__.renderer.triangles,
    size: window.game.pipeline.size,
  }));
  const fps = ((d.frame - f0) * 1000) / (Date.now() - t0);
  const r1 = (v) => Math.round(v * 10) / 10;
  return { fps: r1(fps), gpu: r1(d.total), stages: Object.fromEntries(Object.entries(d.gpu).map(([k, v]) => [k, r1(v)])), calls: d.calls, trisM: Math.round(d.tris / 1e5) / 10, size: d.size };
}

function line(spot, name, r) {
  const st = Object.entries(r.stages)
    .filter(([, v]) => v >= 0.5)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  console.log(`${spot.padEnd(7)} -${name.padEnd(11)} ${String(r.fps).padStart(5)} fps  gpu ${String(r.gpu).padStart(6)} ms  ${String(r.calls).padStart(4)} draws ${String(r.trisM).padStart(4)}M tris  ${r.size.width}x${r.size.height}  [${st}]`);
}

for (const spot of spots) {
  const [x, z, yaw] = SPOTS[spot] ?? spot.split(':').map(Number);
  await page.evaluate(([x, z, yaw]) => window.__THREE_GAME_TEST_HOOKS__.teleport(x, z, yaw), [x, z, yaw]);
  await page.waitForTimeout(2500);
  const base = await measure();
  line(spot, 'base', base);
  if (args.includes('--shot')) await page.screenshot({ path: `artifacts/perf/shots/${preset}-${spot}${tag ? `-${tag}` : ''}.png` });
  for (const [name, expr] of Object.entries(groups)) {
    if (only && !only.split(',').includes(name)) continue;
    await hide(expr, true);
    const r = await measure();
    await hide(expr, false);
    line(spot, name, r);
  }
  if (!only || only.includes('shadows')) {
    await page.evaluate(() => {
      const sm = window.game.renderer.shadowMap;
      sm.__render = sm.__render ?? sm.render;
      sm.render = () => {};
    });
    const r = await measure();
    await page.evaluate(() => {
      const sm = window.game.renderer.shadowMap;
      sm.render = sm.__render;
    });
    line(spot, 'shadows', r);
  }
}
await browser.close();
