#!/usr/bin/env node
// Survival-loop playtest: gather by hand, craft tools, chop a tree, mine a
// rock, build and light a campfire. Asserts on inventory counts and saves
// screenshots. Usage: node scripts/playtest-survival.mjs [--quality low]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', 'http://127.0.0.1:5188');
const quality = arg('quality', 'low');
const [width, height] = arg('size', '960x540').split('x').map(Number);
const out = arg('out', 'artifacts/playtest');
const shots = arg('shots', '1') === '1';
mkdirSync(out, { recursive: true });

const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : { channel: 'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('ERR_CERT')) logs.push(`[${m.type()}] ${m.text()}`);
});
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
const count = async (id) => {
  const inv = await H('inventory');
  return inv.filter((s) => s.startsWith(`${id}x`)).reduce((n, s) => n + Number(s.split('x').pop()), 0);
};
const shot = async (name) => {
  if (!shots) return;
  await H('hideDebugUi');
  await H('renderFrames', 2);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300_000 });
};

await H('setState', 'play');
await H('drive', {}, 0.2);

// Walk up to a prop and use it.
async function approach(target, standoff = 1.5) {
  const pos = (await H('drive', {}, 0.05));
  let dx = pos.x - target.x;
  let dz = pos.z - target.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  await H('teleport', target.x + dx * standoff, target.z + dz * standoff, 0);
  await H('drive', {}, 0.1);
}

async function gather(kind, id, want, attempts = 12) {
  let got = await count(id);
  for (let i = 0; i < attempts && got < want; i += 1) {
    const target = await H('nearestProp', kind, 220);
    if (!target) break;
    await approach(target);
    const aim = await H('aim', target.x, target.y + Math.max(0.05, target.top * 0.5), target.z);
    const r = await H('act', 'interact', 0.1);
    if (!r.result) console.log('  miss', kind, JSON.stringify(aim.prompt), JSON.stringify(r));
    got = await count(id);
  }
  return got;
}

check('gather sticks', (await gather('stick', 'stick', 5)) >= 5, await count('stick'));
check('gather stones', (await gather('stone', 'stone', 3)) >= 3, await count('stone'));
check('gather flint', (await gather('flint', 'flint', 4, 16)) >= 4, await count('flint'));
check('gather fiber', (await gather('fiber_plant', 'fiber', 6)) >= 6, await count('fiber'));

check('craft rope', (await H('craft', 'rope')) && (await H('craft', 'rope')), await count('rope'));
check('craft stone axe', await H('craft', 'stone_axe'), await count('stone_axe'));
check('craft stone pickaxe', await H('craft', 'stone_pickaxe'), await count('stone_pickaxe'));

// Chop a tree.
await H('selectItem', 'stone_axe');
const tree = await H('nearestTree', 80);
if (tree) {
  await approach(tree, 1.3);
  const aim = await H('aim', tree.x, (await H('drive', {}, 0.05)).y + 1.3, tree.z);
  check('axe prompt on tree', Boolean(aim.prompt && aim.prompt.text.startsWith('Chop')), aim.prompt);
  if (shots) await shot('05-axe-at-tree');
  const before = await count('wood');
  for (let i = 0; i < 9; i += 1) await H('act', 'use', 0.9);
  const wood = await count('wood');
  check('felling a tree yields wood', wood > before, { before, wood });
  await H('act', 'use', 2.5);
} else check('found a tree', false, null);

// Mine a rock node.
await H('selectItem', 'stone_pickaxe');
const node = await H('nearestProp', 'rock_node', 400);
if (node) {
  await approach(node, 1.6);
  const aim = await H('aim', node.x, node.y + node.top * 0.5, node.z);
  check('pickaxe prompt on rock', Boolean(aim.prompt && aim.prompt.key === 'LMB'), aim.prompt);
  const before = (await count('stone')) + (await count('iron_ore')) + (await count('songstone')) + (await count('coal'));
  for (let i = 0; i < 6; i += 1) await H('act', 'use', 0.9);
  const after = (await count('stone')) + (await count('iron_ore')) + (await count('songstone')) + (await count('coal'));
  check('mining yields', after > before, { before, after });
} else check('found a rock node', false, null);

// Build a campfire at dusk.
await H('give', 'stone', 6);
await H('give', 'wood', 3);
check('craft campfire', await H('craft', 'campfire'), await count('campfire'));
await H('selectItem', 'campfire');
const here = await H('drive', {}, 0.05);
await H('setTime', 19.4);
await H('aim', here.x + 2.2, here.y + 0.2, here.z);
const placed = await H('act', 'place');
check('place campfire', placed.placed === 'campfire', placed);
await H('drive', { moveY: -1 }, 0.6);
await H('aim', here.x + 2.2, here.y + 0.4, here.z);
if (shots) await shot('06-campfire-dusk');

await H('openInventory');
if (shots) await shot('07-inventory');
await H('closeInventory');

const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
writeFileSync(`${out}/survival-results.json`, JSON.stringify({ results, diag, logs, inventory: await H('inventory') }, null, 2));
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
