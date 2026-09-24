#!/usr/bin/env node
// Story playtest: plays Act I end to end through test hooks and captures
// the key beats (camp, Singing Stones with Ilyr, journal).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const quality = process.argv[2] ?? 'low';
const out = 'artifacts/playtest';
mkdirSync(out, { recursive: true });
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : { channel: 'chromium' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('ERR_CERT')) logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:5188/?quality=${quality}&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 240_000, polling: 500 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.freeze(true));
const H = (fn, ...a) => page.evaluate(({ fn, a }) => window.__THREE_GAME_TEST_HOOKS__[fn](...a), { fn, a });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`);
};
const lm = (id) => page.evaluate((id) => {
  const g = window.game;
  const l = g.world.landmarks.find((d) => d.id === id);
  return { x: l.x, z: l.z };
}, id);

await H('setState', 'play');
await H('setTime', 9);
await H('drive', {}, 0.3);
let q = await H('quest');
check('Waking starts', q.active.includes('waking'), q);
await H('talk', 'varga');
q = await H('quest');
check('Shelter starts after Varga', q.active.includes('shelter') && q.done.includes('waking'), q);

for (const [id, n] of [['stick', 6], ['flint', 2], ['fiber', 20], ['stone', 8], ['wood', 6]]) await H('give', id, n);
await H('craft', 'rope');
await H('craft', 'stone_axe');
await H('craft', 'campfire');
await H('craft', 'bedroll');
const here = await H('drive', {}, 0.05);
await H('selectItem', 'campfire');
await H('aim', here.x + 2.5, here.y, here.z - 1);
const fire = await H('act', 'place');
await H('selectItem', 'bedroll');
await H('aim', here.x - 2.5, here.y, here.z - 2);
const bed = await H('act', 'place');
check('fire and bed placed', fire.placed === 'campfire' && bed.placed === 'bedroll', { fire, bed });
q = await H('quest');
check('Shelter reaches report step', q.objective && q.objective.text.includes('Varga'), q.objective);
await H('talk', 'varga');
q = await H('quest');
check('Singing Stones starts', q.active.includes('stones'), q);

const stones = await lm('singing_stones');
await H('teleport', stones.x + 3, stones.z + 3, 0);
await H('drive', {}, 1);
q = await H('quest');
check('Reached the stones', q.objective && q.objective.text.includes('mural'), q.objective);
await H('useStory', 'mural');
const order = await H('tuningOrder');
// A wrong strike resets; then the right order.
await H('useStory', `tuning_${order[1]}`);
for (const i of order) await H('useStory', `tuning_${i}`);
q = await H('quest');
check('Stones tuned', q.flags.includes('stones_tuned'), q.flags);
await H('useStory', 'lantern_pedestal');
q = await H('quest');
check('Echo Lantern taken', q.flags.includes('has_lantern') && (await H('inventory')).some((s) => s.startsWith('echo_lantern')), q.objective);
await H('selectItem', 'echo_lantern');
const ilyr = await H('npcPosition', 'ilyr');
check('Ilyr appears', Boolean(ilyr), ilyr);
if (ilyr) {
  await H('teleport', ilyr[0] + 2.6, ilyr[2] + 2.6, 0);
  await H('setTime', 19.2);
  const pos = await H('drive', {}, 0.05);
  await H('aim', ilyr[0], pos.y + 1.4, ilyr[2]);
  await H('hideDebugUi');
  await H('renderFrames', 3);
  await page.screenshot({ path: `${out}/10-ilyr-singing-stones.png`, timeout: 300_000 });
}
await H('talk', 'ilyr');
q = await H('quest');
check('Needle starts after Ilyr', q.active.includes('needle') && q.active.includes('rescue_tock'), q);

const rim = await lm('rim_lookout');
await H('teleport', rim.x + 1.5, rim.z + 1.5, 0);
await H('drive', {}, 1);
await H('useStory', 'lookout');
q = await H('quest');
check('Saw the Stillheart', q.flags.includes('saw_stillheart'), q.objective);
await H('talk', 'varga');
q = await H('quest');
check('The Five Bells begins', q.active.includes('bells'), q);

// Rescue Tock with the lantern.
const vault = await lm('tocks_vault');
await H('teleport', vault.x + 4, vault.z + 4, 0);
await H('drive', {}, 1);
const door = await H('useStory', 'vault_door');
q = await H('quest');
check('Vault opens with the lantern', q.flags.includes('vault_open'), door);
await H('talk', 'tock');
q = await H('quest');
check('Tock rescued', q.done.includes('rescue_tock'), q.done);

// Back at camp with the crew.
const camp = await lm('crash_camp');
await H('teleport', camp.x + 1, camp.z + 6, Math.PI);
await H('setTime', 17.8);
const cpos = await H('drive', {}, 0.05);
await H('aim', camp.x + 2, cpos.y + 1.2, camp.z - 2);
await H('renderFrames', 3);
await page.screenshot({ path: `${out}/11-camp-crew.png`, timeout: 300_000 });
await page.evaluate(() => window.game.openJournal());
await H('renderFrames', 1);
await page.screenshot({ path: `${out}/12-journal.png`, timeout: 300_000 });

writeFileSync(`${out}/story-results.json`, JSON.stringify({ results, logs }, null, 2));
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
