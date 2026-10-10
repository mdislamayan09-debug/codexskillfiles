// What each part of the frame costs in play: turn one thing off at a time and compare frame rates before and after.
// usage: node scripts/proftoggle.mjs <url>
import { launch } from './launch.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 });
await page.goto(process.argv[2], { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000, polling: 500 });
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const res = await page.evaluate(async () => {
  const G = window.__game, { sky, veg, post } = G.dbg;
  const fps = async (ms = 1800) => { await new Promise((r) => setTimeout(r, 350)); const f0 = G.frame, t0 = performance.now(); await new Promise((r) => setTimeout(r, ms)); return +((G.frame - f0) / ((performance.now() - t0) / 1000)).toFixed(1); };
  const vis = (list, v) => list.forEach((m) => (m.visible = v));
  const tests = {
    shadows: [() => { sky.sun.castShadow = false; }, () => { sky.sun.castShadow = true; }],
    volumetric: [() => { G.volK = 0; }, () => { G.volK = undefined; }],
    gtao: [() => { if (post.gtao) post.gtao.enabled = false; }, () => { if (post.gtao) post.gtao.enabled = true; }],
    sky: [() => { sky.mesh.visible = false; }, () => { sky.mesh.visible = true; }],
    grass: [() => vis(veg.grass, false), () => vis(veg.grass, true)],
    clutter: [() => vis(veg.clutter || [], false), () => vis(veg.clutter || [], true)],
    terrain: [() => vis(G.terrain.meshes, false), () => vis(G.terrain.meshes, true)],
    trees: [() => vis(veg.trees.meshes.flat(), false), () => vis(veg.trees.meshes.flat(), true)],
    impostors: [() => { if (veg.impostors) veg.impostors.visible = false; }, () => { if (veg.impostors) veg.impostors.visible = true; }],
    rocks: [() => vis([...veg.rocks.meshes.flat(), ...veg.crags.meshes.flat()], false), () => vis([...veg.rocks.meshes.flat(), ...veg.crags.meshes.flat()], true)],
    water: [() => { G.__wu = G.water.update; G.water.update = () => {}; G.water.mesh.visible = false; }, () => { G.water.update = G.__wu; G.water.mesh.visible = true; }],
    actors: [() => { G.npcs.__u = G.npcs.update; G.npcs.update = () => {}; G.npcs.actors.forEach((a) => (a.root.visible = false)); }, () => { G.npcs.update = G.npcs.__u; }],
    town: [() => vis(G.town.meshes, false), () => vis(G.town.meshes, true)],
  };
  const out = {};
  for (const [k, [off, on]] of Object.entries(tests)) { try { const b = await fps(); off(); const t = await fps(); on(); out[k] = `${b} -> ${t} fps (${(1000 / b - 1000 / t).toFixed(0)} ms)`; } catch (e) { out[k] = 'err ' + e.message; } }
  return out;
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(11), v);
await browser.close();
