#!/usr/bin/env node
// Pictures of the three Sunwells for judging the look: each court as found
// and lit from above its lens, a prism and the beam up close, and the light
// resting in the open vault.
// Usage: node scripts/capture-sunwells.mjs [--quality high] [--hours 10]
//          [--only dawnwell] [--profile artifacts/tmp/profile] [--url ...]
import { mkdirSync } from 'node:fs';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'high');
const hours = Number(arg('hours', '10'));
const only = arg('only', '');
const out = arg('out', 'artifacts/captures/sunwells');
mkdirSync(out, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text());
});
await page.goto(`${url}/?quality=${quality}&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
const H = (fn, ...a) => page.evaluate(({ fn, a }) => window.__THREE_GAME_TEST_HOOKS__[fn](...a), { fn, a });
const shot = async (name, frames = 24) => {
  await H('hideDebugUi');
  // Let exposure, shadows and streaming settle on the new view.
  await H('renderFrames', frames, 1 / 30);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
};

await H('setState', 'play');
await H('setWeather', 'clear');
await H('setTime', hours);
for (const w of await H('sunwells')) {
  if (only && !only.split(',').includes(w.id)) continue;
  // The lens stands at the start of the beam; look across the court from
  // behind and above it, toward the door.
  const [lx, , lz] = w.path[0];
  const ax = w.x - lx;
  const az = w.z - lz;
  const al = Math.hypot(ax, az) || 1;
  const side = { x: -az / al, z: ax / al };
  const vantage = () => H('lookFrom', lx - (ax / al) * 7 + side.x * 6, w.y + 8, lz - (az / al) * 7 + side.z * 6, w.x + (ax / al) * 3, w.y, w.z + (az / al) * 3);
  await vantage();
  await shot(`${w.id}-found`, 40);
  for (let i = 0; i < w.prisms.length; i += 1) {
    const times = (w.answer[i] - w.prisms[i].facing + 4) % 4;
    if (times > 0) await H('turnPrism', w.id, i, times);
  }
  // The door takes a few seconds to sink.
  await H('renderFrames', 60, 1 / 8);
  await vantage();
  await shot(`${w.id}-lit`);
  // Up close: the first prism the light reaches, from beside the beam.
  const lit = (await H('sunwells')).find((s) => s.id === w.id);
  const [p0x, p0y, p0z] = lit.path[1];
  await H('lookFrom', p0x + side.x * 2.6 - (ax / al) * 2.2, p0y + 0.5, p0z + side.z * 2.6 - (az / al) * 2.2, p0x, p0y - 0.1, p0z);
  await shot(`${w.id}-prism`);
  // The open vault, from the court, looking along the last of the light.
  const door = lit.door;
  const dx = door.x - w.x;
  const dz = door.z - w.z;
  const dl = Math.hypot(dx, dz) || 1;
  await H('lookFrom', door.x - (dx / dl) * 6 + (dz / dl) * 1.5, w.y + 2.2, door.z - (dz / dl) * 6 - (dx / dl) * 1.5, door.x + (dx / dl) * 3, w.y + 1, door.z + (dz / dl) * 3);
  await shot(`${w.id}-vault`);
}
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
