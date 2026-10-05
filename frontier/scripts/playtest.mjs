// Smoke-test real gameplay input: start, ride, gallop, dismount, aim, fire, Dead Eye, map, mount.
// usage: node scripts/playtest.mjs [url]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/?q=low';
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 600000, polling: 1000 });
const frames = async (n) => { const f0 = await page.evaluate(() => window.__game.frame); await page.waitForFunction((t) => window.__game.frame >= t, f0 + n, { timeout: 600000, polling: 200 }); };
const state = () => page.evaluate(() => { const G = window.__game, p = G.player; return { mounted: p.mounted, hspeed: +p.hspeed.toFixed(2), pos: (p.mounted ? p.hpos : p.pos).toArray().map((v) => +v.toFixed(1)), ammo: G.ammo, deadEye: G.deadEye, health: +p.health.toFixed(0), gait: p.horse.gait }; });
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

await page.keyboard.press('Enter'); // leave title
await frames(2);
check(await page.evaluate(() => window.__game.started), 'title screen dismissed by key');
const s0 = await state();
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await frames(14);
const s1 = await state();
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
check(s1.hspeed > 3.5, `horse accelerates (speed ${s1.hspeed}, gait ${s1.gait})`);
check(Math.hypot(s1.pos[0] - s0.pos[0], s1.pos[2] - s0.pos[2]) > 1, 'horse moves through the world');
await page.keyboard.press('KeyE'); await frames(2);
check(!(await state()).mounted, 'E dismounts');
await page.keyboard.down('KeyW'); await frames(4); await page.keyboard.up('KeyW');
await page.mouse.move(320, 180);
await page.mouse.down({ button: 'right' }); await frames(2);
await page.mouse.down({ button: 'left' }); await frames(1); await page.mouse.up({ button: 'left' }); await frames(2);
await page.mouse.up({ button: 'right' });
check((await state()).ammo === 5, 'aiming + firing spends a round');
await page.keyboard.press('KeyQ'); await frames(2);
check((await state()).deadEye === true, 'Q toggles Dead Eye');
await page.keyboard.press('KeyQ'); await frames(1);
await page.keyboard.press('KeyR'); await frames(3);
await page.keyboard.press('KeyM'); await frames(1);
check(await page.evaluate(() => document.querySelector('#mapscreen').classList.contains('show')), 'M opens the map');
await page.keyboard.press('KeyM');
await page.keyboard.press('KeyH'); await frames(6);
await page.evaluate(() => { const p = window.__game.player; p.hpos.copy(p.pos).add({ x: 1, y: 0, z: 0 }); });
await page.keyboard.press('KeyE'); await frames(2);
check((await state()).mounted, 'E mounts the horse when close');
await page.evaluate(() => (window.__game.hold = true));
await page.screenshot({ path: process.env.OUT_PNG || '/tmp/playtest.png', timeout: 300000 });
check(errors.length === 0, `no runtime errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
