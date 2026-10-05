// Dust & Redemption — bootstrap, game rules and main loop.
import './style.css';
import * as THREE from 'three';
import { World, TOWN, CAMP, RANCH, CHURCH, CABIN, PINE_TRAIL, RES, setWorldResolution } from './world.js';
import { U, patchMaterial } from './shared.js';
import { Terrain } from './terrain.js';
import { loadSurfaces } from './assets.js';
import { Sky } from './sky.js';
import { Vegetation } from './vegetation.js';
import { Water } from './water.js';
import { Town } from './town.js';
import { Player } from './player.js';
import { NPCs } from './npc.js';
import { Particles, Campfire, Tracers, Snowfall, SnowTrail } from './fx.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Post } from './post.js';

const params = new URLSearchParams(location.search);
const QUALITY = { low: 0.45, med: 0.75, high: 1, ultra: 1.5 }[params.get('q') || 'high'] ?? 1;
const CAPTURE = params.has('capture');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
// ?ss=2 forces the render scale (supersampling): a 1920x1080 window renders a 3840x2160 frame
const SS = Math.min(4, Math.max(0, parseFloat(params.get('ss')) || 0));
renderer.setPixelRatio(SS || Math.min(devicePixelRatio, QUALITY > 1 ? 2 : QUALITY >= 1 ? 1.5 : 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.25, 12000);
camera.layers.enable(1);

const loadingBar = document.querySelector('#loading .fill');
const loadingStatus = document.querySelector('#loading .status');
const setLoad = (p, s) => { loadingBar.style.width = `${Math.round(p * 100)}%`; if (s) loadingStatus.textContent = s; };
const tick = () => new Promise((r) => setTimeout(r, 0));

const G = (window.__game = {
  ready: false, frame: 0, money: 12.5, ammo: 6, reserve: 48, wanted: 0, bounty: 0,
  deadEye: false, deadEyeK: 0, timeScale: 1, reloadT: 0, fireCD: 0, damage: 0, started: false,
  camOverride: null, freezeTime: false, paused: false, lootTarget: null, reticleEnemy: false,
});

async function init() {
  setLoad(0.02, 'Surveying the territory…');
  await Promise.all([document.fonts.load('40px Rye'), document.fonts.load('40px "IM Fell English"'), document.fonts.load('40px "IM Fell English SC"')]).catch(() => {});
  // heightmap detail per preset: 3.2 m (high), 2.7 m (ultra), 4 m (low/med) over the 8 km map
  setWorldResolution(QUALITY > 1 ? 3072 : QUALITY >= 1 ? 2560 : 2048);
  U.uRes.value = RES;
  const world = new World(1899);
  await world.generate((p) => setLoad(0.02 + p * 0.5, 'Raising mountains and cutting rivers…'));
  console.log(`world ${RES}² generated in ${Math.round(world.genMs)} ms`);
  U.uHeight.value = world.heightTex;
  U.uSplat.value = world.splatTex;
  U.uClimate.value = world.climateTex;
  setLoad(0.55, 'Painting the sky…'); await tick();
  const sky = new Sky(scene, renderer, QUALITY);
  setLoad(0.57, 'Loading photographic surfaces…'); await tick();
  const surf = await loadSurfaces(renderer);
  const terrain = new Terrain(world, scene, surf, QUALITY);
  setLoad(0.6, 'Raising Copper Hollow…'); await tick();
  const town = new Town(world, scene, surf);
  setLoad(0.7, 'Planting forests…'); await tick();
  const veg = new Vegetation(world, scene, renderer, QUALITY, surf);
  for (const g of veg.grass) g.layers.set(1);
  setLoad(0.82, 'Filling the rivers…'); await tick();
  const water = new Water(scene, renderer, { reflections: QUALITY >= 0.7, resScale: QUALITY > 1 ? 0.75 : QUALITY >= 1 ? 0.5 : 0.35, normals: surf.water });
  if (QUALITY > 1 && renderer.capabilities.maxTextureSize >= 8192) { sky.sun.shadow.mapSize.set(8192, 8192); sky.sun.shadow.map?.dispose(); sky.sun.shadow.map = null; }
  const particles = new Particles(scene, 4000);
  const tracers = new Tracers(scene);
  const snowfall = new Snowfall(scene, QUALITY > 1 ? 22000 : 15000);
  const snowTrail = new SnowTrail(scene, world);
  const campfires = town.campfires.map((p) => new Campfire(scene, p, particles));
  // lily pads drifting on shallow bayou water
  {
    const padTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      g.fillStyle = '#3e5a22'; g.beginPath(); g.moveTo(64, 64); g.arc(64, 64, 60, 0.25, Math.PI * 2 - 0.05); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120,150,70,0.6)'; g.lineWidth = 2;
      for (let a = 0.4; a < 6.2; a += 0.45) { g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const pads = [];
    for (let i = 0; i < 9000 && pads.length < 2600; i++) {
      const x = 560 + Math.random() * 1400, z = 640 + Math.random() * 900;
      const h = world.heightAt(x, z);
      if (h > -0.15 || h < -1.6 || world.splatAt(x, z).wet < 0.5) continue;
      if (world.splatAt(x, z).forest < 0.15 && Math.random() < 0.5) continue;
      for (let k = 0; k < 4; k++) pads.push([x + (Math.random() - 0.5) * 3, z + (Math.random() - 0.5) * 3, Math.random() * 6.28, 0.25 + Math.random() * 0.35]);
    }
    const padMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2), patchMaterial(new THREE.MeshStandardMaterial({ map: padTex, alphaTest: 0.5, roughness: 0.5 })), pads.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    pads.forEach(([x, z, r, sc], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); m4.compose(new THREE.Vector3(x, 0.02, z), q, new THREE.Vector3(sc, 1, sc)); padMesh.setMatrixAt(i, m4); });
    padMesh.receiveShadow = true;
    scene.add(padMesh);
  }
  const audio = new Audio();
  const input = new Input(canvas);
  setLoad(0.88, 'Saddling up…'); await tick();
  const npcs = new NPCs({ world, town, veg, scene, fx: particles, tracers, audio });
  const player = new Player({ world, town, veg, scene, camera, input });
  const hud = new HUD(world);
  const post = new Post(renderer, scene, camera, { ao: QUALITY >= 0.7, bloom: true });
  // pooled lamp lights for night
  const lamps = Array.from({ length: 6 }, () => { const l = new THREE.PointLight(0xffa850, 0, 18, 1.8); scene.add(l); return l; });

  Object.assign(G, { world, sky, terrain, town, veg, water, particles, tracers, npcs, player, hud, audio, input, post, scene, camera, renderer, snowTrail });
  player.onStep = (kind, v) => (kind === 'hoof' ? audio.hoof(v) : audio.step());
  npcs.onAlert = () => { hud.feed('The Cutter Gang has spotted you', 'bad'); hud.subtitle('"There he is! Kill him!"', 3); };
  npcs.onPlayerHit = (dmg) => { if (player.dead) return; player.health -= dmg; G.damage = 1; if (player.health <= 0) die(); };
  npcs.onCrime = () => { G.wanted = 60; G.bounty += 25; hud.feed('Murder witnessed — <b>$25</b> bounty', 'bad'); };

  // opening: east of town on the trail at golden hour
  player.spawn(250, -20, -Math.PI / 2 - 0.15);
  sky.time = 17.4;
  sky.update(0, player.hpos);
  veg.update(player.hpos, true);
  hud.setObjective('Ride to the Cutter Gang hideout and collect the bounty');

  function die() {
    player.dead = true;
    hud.subtitle('You died.', 4);
    G.dieT = 4;
  }

  function fire() {
    if (G.fireCD > 0 || G.reloadT > 0) return;
    if (G.ammo <= 0) { audio.click(); G.fireCD = 0.3; if (G.reserve > 0) startReload(); return; }
    G.ammo--; G.fireCD = G.deadEye ? 0.12 : 0.38;
    const ray = player.aimRay();
    // Dead Eye aim assist: snap to the nearest living target inside the cone
    if (G.deadEye) {
      let best = null, bestAng = 0.12;
      for (const a of npcs.actors) {
        if (a.dead || a.kind === 'towns' || a.kind === 'sheep' || a.kind === 'horse') continue;
        const tgt = a.pos.clone().add(new THREE.Vector3(0, a.kind === 'outlaw' ? 1.6 : 1.0, 0));
        const dir = tgt.clone().sub(ray.origin);
        const ang = dir.angleTo(ray.direction);
        if (ang < bestAng && dir.length() < 200) { bestAng = ang; best = dir.normalize(); }
      }
      if (best) ray.direction.copy(best);
    }
    // terrain hit
    let tDist = 400;
    for (let t = 1; t < 400; t += 0.75) {
      const p = ray.at(t, new THREE.Vector3());
      if (p.y < world.heightAt(p.x, p.z)) { tDist = t; break; }
    }
    const hit = npcs.raycast(ray, tDist);
    const muzzle = new THREE.Vector3();
    if (player.rider.gun.visible) player.rider.muzzle.getWorldPosition(muzzle);
    else muzzle.copy(player.mounted ? player.hpos : player.pos).add(new THREE.Vector3(0, player.mounted ? 2.3 : 1.4, 0));
    const end = ray.at(hit ? hit.dist : tDist, new THREE.Vector3());
    tracers.shot(muzzle, end);
    particles.burst(muzzle, 6, { color: [0.8, 0.78, 0.74], alpha: 0.5, size: 0.3, life: 2, grow: 1.4, drag: 2 }, 0.5, 0.3);
    audio.gunshot(null, 1);
    npcs.noise(muzzle, 140);
    if (hit) {
      const a = hit.actor;
      const killed = npcs.damage(a, hit.head ? 200 : 55, muzzle);
      hud.hitmarker(killed);
      if (killed) {
        if (a.kind === 'outlaw') { G.money += 15; audio.cash(); hud.feed(`${hit.head ? 'Headshot · ' : ''}Outlaw killed <b>+$15.00</b>`); }
        if (a.kind === 'deer') hud.feed('Clean kill · <b>[F]</b> to skin');
        if (npcs.outlaws.every((o) => o.dead) && !G.campCleared) {
          G.campCleared = true;
          G.money += 120; audio.cash();
          hud.feed('Cutter Gang wiped out · Bounty <b>+$120.00</b>');
          hud.banner('Hideout Cleared', 'The valley breathes easier');
          hud.setObjective('Loot the strongbox, then return to Copper Hollow');
        }
      }
    } else if (tDist < 400) {
      const sp = world.splatAt(end.x, end.z);
      const col = end.y < 0.2 ? [0.7, 0.75, 0.75] : sp.road > 0.3 ? [0.62, 0.52, 0.4] : [0.45, 0.42, 0.3];
      particles.burst(end, 10, { color: col, alpha: 0.7, size: 0.25, life: 1.2, grow: 1.5, drag: 3, grav: 3 }, 1.5, 2.5);
    }
  }
  function startReload() { if (G.reserve <= 0 || G.ammo >= 6) return; G.reloadT = 1.6; audio.reload(); }

  function handleInput(dt) {
    const k = input;
    if (k.hit('KeyE')) { const r = player.toggleMount(); if (r) audio.notify(); }
    if (k.hit('KeyH') && !player.mounted) { player.whistled = true; audio.whistle(); hud.subtitle('*whistles*', 1.5); }
    if (k.hit('KeyV') && player.mounted) player.cinematicOn = !player.cinematicOn;
    if (k.hit('KeyM')) hud.el('#mapscreen').classList.toggle('show');
    if (k.hit('F1') || k.hit('Slash')) hud.el('#help').classList.toggle('show');
    if (k.hit('KeyP')) G.snap = true;
    if (k.hit('KeyT')) { sky.time = (sky.time + 1) % 24; sky.lastEnvTime = -100; hud.feed('An hour passes…'); }
    if (k.hit('KeyR')) startReload();
    if (k.hit('KeyQ')) {
      if (!G.deadEye && player.deadEye > 10) { G.deadEye = true; audio.deadEye(true); }
      else if (G.deadEye) { G.deadEye = false; audio.deadEye(false); }
    }
    if (k.hit('KeyF')) {
      const p = player.mounted ? player.hpos : player.pos;
      const a = npcs.nearestLootable(p);
      if (a && !player.mounted) {
        a.looted = true;
        let v = a.kind === 'deer' ? 4.5 : a.kind === 'outlaw' ? 2 + Math.random() * 6 : 1 + Math.random() * 3;
        G.money += v; audio.cash();
        hud.feed(a.kind === 'deer' ? `Skinned deer · pelt sold <b>+$${v.toFixed(2)}</b>` : `Looted body <b>+$${v.toFixed(2)}</b>${a.kind === 'outlaw' ? ' · 6 rounds' : ''}`);
        if (a.kind === 'outlaw') G.reserve += 6;
      } else {
        for (const it of town.interactables) {
          if (it.type === 'loot' && !it.taken && it.pos.distanceTo(p) < 3 && !player.mounted) {
            it.taken = true; G.money += it.value; audio.cash();
            hud.feed(`Opened the strongbox <b>+$${it.value.toFixed(2)}</b>`);
            if (G.campCleared) hud.setObjective('Spend your earnings in Copper Hollow');
          }
        }
      }
    }
    if (player.aiming || k.mouse.left) {
      if (k.mouse.leftPressed) fire();
    }
  }

  // ---------------------------------------------------------------- shots for capture / critique
  G.shots = {
    ranch: () => ({ time: 16.4, player: [RANCH.x - 22, RANCH.z + 46, Math.PI - 0.3], cam: [RANCH.x - 12, null, RANCH.z + 66, 7.5], look: [RANCH.x + 2, null, RANCH.z - 70, 14] }),
    ride: () => ({ time: 17.35, player: [-330, -140, -1.2], camRel: [3.6, 1.6, -0.6], lookRel: [0, 1.7, 0.3], sideShot: true }),
    swamp: () => { const f = G.findSwamp(); return { time: 7.3, player: [f[0], f[1], f[2]], camRel: [4.0, 1.5, 0.6], lookRel: [0, 1.6, 0.2], water: true }; },
    town: () => ({ time: 17.2, player: [60, 1, -Math.PI / 2], cam: [80, null, 9.4, 2.15], look: [-60, null, -4, 3.2] }),
    forest: () => { const f = G.findForest(-200, -650); return { time: 8.4, player: [f[0], f[1], 0.4], camRel: [-3.2, 1.5, -4.2], lookRel: [0, 1.6, 0] }; },
    vista: () => ({ time: 17.8, player: [-60, 280, -0.2], cam: [-60, null, 330, 30], look: [40, null, -700, 120] }),
    gallop: () => ({ time: 17.2, player: [62, -330, Math.PI], camRel: [7.5, 1.8, 2.5], lookRel: [0, 1.6, 0.6], gallop: true }),
    camp: () => ({ time: 20.4, player: [CAMP.x - 52, CAMP.z + 44, 2.2], // behind the camera and outside the gang's 48 m alert radius
      cam: [CAMP.x - 7.5, null, CAMP.z + 6.5, 1.55], look: [CAMP.x + 2, null, CAMP.z - 2, 1.1] }),
    night: () => ({ time: 21.5, player: [-20, 2, Math.PI / 2], cam: [-46, null, -1, 2.4], look: [60, null, -3, 4] }),
    portrait: () => ({ time: 15.2, player: [-260, 40, 0.9], camRel: [2.4, 2.1, 3.0], lookRel: [0, 1.85, 0.2] }),
    hud: () => ({ time: 17.3, player: [300, -40, -Math.PI / 2 + 0.1], hud: true }),
    // --- world v2 biomes (references: forest trail ride, snowy valley ride, snowy valley vista)
    // heading west-south-west down the logging trail, into the low afternoon sun as in the reference
    pines: () => { const [x, z, yaw] = G.denseOnRoad(PINE_TRAIL, true); return { time: 16.6, player: [x, z, yaw], camRel: [0.6, 2.3, -5.6], lookRel: [0, 3.6, 22] }; },
    snowride: () => { const [x, z, yaw] = G.alongValley(0.5); return { time: 13.0, player: [x, z, yaw], camRel: [0.6, 2.6, -6.5], lookRel: [0, 2.2, 16], weather: 'snow' }; },
    snowvista: () => { const v = G.findVista(); return { foreground: true, weather: { storm: 0.9, blizzard: 0.0 }, time: 15.4, player: [CABIN.x - 40, CABIN.z - 30, 0], cam: [v.cx, null, v.cz, 2.6], look: [v.tx, null, v.tz, v.th] }; },
    jungle: () => { const [x, z, yaw] = G.onRoad(2, 0.83); return { time: 10.5, player: [x, z, yaw], camRel: [0.8, 2.4, -6.0], lookRel: [0, 2.0, 14] }; },
    autumn: () => { const [x, z, yaw] = G.onRoad(0, 0.08, true); return { time: 16.2, player: [x, z, yaw], camRel: [0.7, 2.4, -6.2], lookRel: [0, 2.0, 14] }; },
    desert: () => { const [x, z, yaw] = G.onRoad(3, 0.86); return { time: 17.4, player: [x, z, yaw], camRel: [0.8, 2.3, -6.0], lookRel: [0, 2.2, 14] }; },
  };
  // an outcrop above the trapper's cabin with a clear line of sight over it and down Frostwater Valley
  G.findVista = () => {
    const tx = -700, tz = -1750;  // far down-valley: out past the mouth over the pine belt
    const toT = Math.atan2(tx - CABIN.x, tz - CABIN.z);
    let best = null, bs = -1e9;
    for (let r = 60; r <= 300; r += 20) for (let da = -0.9; da <= 0.9; da += 0.15) {
      const a = toT + Math.PI + da; // behind the cabin, looking past it
      const cx = CABIN.x + Math.sin(a) * r, cz = CABIN.z + Math.cos(a) * r;
      const ch = world.heightAt(cx, cz) + 2.6;
      if (ch < world.heightAt(CABIN.x, CABIN.z) + 25) continue;
      // line of sight to the cabin and 1.5 km down-valley must clear the ground
      let clear = 1;
      for (const [px, pz, ph] of [[CABIN.x, CABIN.z, world.heightAt(CABIN.x, CABIN.z) + 3], [tx, tz, world.heightAt(tx, tz) + 20]]) {
        for (let k = 1; k < 40; k++) {
          const t = k / 40, x = cx + (px - cx) * t, z = cz + (pz - cz) * t, y = ch + (ph - ch) * t;
          if (world.heightAt(x, z) > y - 1.5) { clear = 0; break; }
        }
      }
      if (!clear) continue;
      const above = ch - world.heightAt(CABIN.x, CABIN.z);
      const score = -Math.abs(above - 45) - Math.abs(da) * 30 - r * 0.05;
      if (score > bs) { bs = score; best = { cx, cz }; }
    }
    best = best || { cx: CABIN.x + 120, cz: CABIN.z - 60 };
    // aim between the cabin and the valley floor beyond it
    // aim far down the valley so the horizon and storm sky fill the top of the frame, cabin below
    return { ...best, tx, tz, th: 40 };
  };
  // a point a fraction t along a road, facing along it (reverse = facing back toward its start)
  G.onRoad = (ri, t, reverse = false) => {
    const pts = world.roads[ri];
    const i = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = (bx - ax) * (reverse ? -1 : 1), dz = (bz - az) * (reverse ? -1 : 1);
    return [ax, az, Math.atan2(dx, dz)];
  };
  // the point along a road deepest inside forest (trees close on both sides)
  G.denseOnRoad = (ri, reverse = false) => {
    let best = G.onRoad(ri, 0.5, reverse), bs = -1;
    for (let t = 0.15; t < 0.9; t += 0.02) {
      const [x, z, yaw] = G.onRoad(ri, t, reverse);
      let f = 0;
      for (let k = 0; k < 12; k++) { const a = k * 0.5236; f += world.splatAt(x + Math.cos(a) * 30, z + Math.sin(a) * 30).forest; }
      if (f > bs) { bs = f; best = [x, z, yaw]; }
    }
    return best;
  };
  // a point on the Frostwater Valley floor, heading up-valley
  G.alongValley = (t) => {
    const v = world.valley;
    // walk up-valley from t until the rider and the camera behind them have no trees in the way
    for (let tt = t; tt < 0.95; tt += 0.01) {
      const i = Math.min(v.length - 2, Math.floor((1 - tt) * (v.length - 1)));
      const [ax, az] = v[i + 1], [bx, bz] = v[i];
      const yaw = Math.atan2(bx - ax, bz - az);
      for (const side of [12, -12, 25, -25]) {
        const x = ax + Math.cos(yaw) * side, z = az - Math.sin(yaw) * side;
        const cx = x - Math.sin(yaw) * 6.5, cz = z - Math.cos(yaw) * 6.5;
        if (G.treesNear(x, z, 6) === 0 && G.treesNear(cx, cz, 5) === 0 && G.treesNear(x + Math.sin(yaw) * 12, z + Math.cos(yaw) * 12, 4) === 0) return [x, z, yaw];
      }
    }
    const [ax, az] = v[v.length - 2]; return [ax, az, 0];
  };
  G.treesNear = (x, z, r) => {
    let n = 0;
    const L = veg.trees, cx = Math.floor(x / L.cell), cz = Math.floor(z / L.cell);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const it of L.grid.get((cx + dx) + ',' + (cz + dz)) || []) if (Math.hypot(it.x - x, it.z - z) < r + 3 * it.s) n++;
    return n;
  };
  G.findForest = (x0, z0) => {
    let best = [x0, z0], bs = -1;
    for (let r = 0; r < 600 && bs < 0.95; r += 12) for (let a = 0; a < 6.28; a += 0.3) {
      const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      const f = world.splatAt(x, z).forest * (world.heightAt(x, z) > 2 ? 1 : 0) * (world.normalAt(x, z).y > 0.85 ? 1 : 0);
      if (f > bs) { bs = f; best = [x, z]; }
    }
    return best;
  };
  // shallow bayou water (0.3–0.9 m) with the densest swamp forest around it
  G.findSwamp = () => {
    let best = [940, 1090, 0.6], bs = -1;
    for (let z = 700; z < 1500; z += 9) for (let x = 650; x < 1900; x += 9) {
      const h = world.heightAt(x, z);
      if (h > -0.3 || h < -0.9) continue;
      let f = 0;
      for (let k = 0; k < 8; k++) { const a = k * 0.785; f += world.splatAt(x + Math.cos(a) * 18, z + Math.sin(a) * 18).forest; }
      if (f > bs) { bs = f; best = [x, z, 0.6]; }
    }
    return best;
  };
  G.setShot = (name) => {
    const s = G.shots[name]();
    G.freezeTime = true;
    sky.time = s.time; sky.lastEnvTime = -100;
    const [px, pz, yaw] = s.player;
    player.spawn(px, pz, yaw);
    player.hspeed = s.gallop ? 13 : 0;
    G.forceGallop = !!s.gallop;
    G.camOverride = null;
    G.weatherOverride = s.weather && typeof s.weather === 'object' ? s.weather : null;
    if (s.cam) {
      const [cx, cy, cz, ch] = s.cam, [lx, ly, lz, lh] = s.look;
      G.camOverride = { pos: new THREE.Vector3(cx, world.heightAt(cx, cz) + ch, cz), look: new THREE.Vector3(lx, world.heightAt(lx, lz) + lh, lz) };
    } else if (s.camRel) {
      const rel = s.camRel.slice();
      if (s.water) {
        // put the camera over open water, on whichever side of the horse is deeper
        const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const hp = world.heightAt(px + r.x * rel[0], pz + r.z * rel[0]), hm = world.heightAt(px - r.x * rel[0], pz - r.z * rel[0]);
        if (hm < hp) rel[0] = -rel[0];
      }
      G.camOverride = { rel, lookRel: s.lookRel };
    }
    // a frosted rock outcrop at the camera's feet to anchor a vista, as a location artist would place one
    if (s.foreground && G.camOverride && G.camOverride.pos && !G.fgPlaced) {
      G.fgPlaced = true;
      const c = G.camOverride.pos, l = G.camOverride.look;
      const d = new THREE.Vector3(l.x - c.x, 0, l.z - c.z).normalize(), rt = new THREE.Vector3(-d.z, 0, d.x);
      const put = (f, sideOff, scale, v) => { const x = c.x + d.x * f + rt.x * sideOff, z = c.z + d.z * f + rt.z * sideOff; veg.rocks.add(x, world.heightAt(x, z) - 0.4 * scale, z, f * 1.3, scale, v); };
      put(4.5, -3.2, 2.6, 0); put(6.0, 2.8, 2.1, 1); put(3.2, 0.6, 1.3, 2); put(7.5, -6.5, 3.2, 3); put(5.5, 6.8, 1.7, 2);
      for (let i = 0; i < 9; i++) { const x = c.x + d.x * (2.5 + i * 0.7) + rt.x * (-4 + i), z = c.z + d.z * (2.5 + i * 0.7) + rt.z * (-4 + i); veg.bushes.add(x, world.heightAt(x, z) - 0.05, z, i, 0.6 + (i % 3) * 0.2, 7 + (i % 2)); }
    }
    hud.root.classList.toggle('on', !!s.hud);
    document.getElementById('title').classList.remove('show');
    document.getElementById('loading').classList.add('done');
    veg.update(player.hpos, true);
    // pre-warm campfire smoke columns that would already be hanging in the air
    for (const cp of town.chimneys || []) {
      for (let i = 0; i < 70; i++) {
        const h = Math.random() * 14;
        particles.emit(cp.clone().add(new THREE.Vector3(h * 0.35 + (Math.random() - 0.5) * (0.3 + h * 0.2), h, (Math.random() - 0.5) * (0.3 + h * 0.2))),
          new THREE.Vector3(0.2, 0.5, 0), { color: [0.72, 0.72, 0.74], alpha: 0.3 * (1 - h / 16), size: 0.7 + h * 0.4, life: 6, grow: 0.25, drag: 0.4 });
      }
    }
    for (const c of campfires) {
      if (c.pos.distanceTo(player.hpos) > 120) continue;
      for (let i = 0; i < 45; i++) {
        const h = Math.random() * 7;
        particles.emit(c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * (0.3 + h * 0.25) + h * 0.15, 0.8 + h, (Math.random() - 0.5) * (0.3 + h * 0.25))),
          new THREE.Vector3(0, 0.6, 0), { color: [0.75, 0.62, 0.52], alpha: 0.38 * (1 - h / 8), size: 0.8 + h * 0.35, life: 4, grow: 0.3, drag: 0.4 });
      }
    }
    if (s.gallop) {
      // pre-warm the dust trail a galloping horse would already have kicked up
      const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      for (let i = 0; i < 70; i++) {
        const t = Math.random() * 14;
        const p = player.hpos.clone().addScaledVector(back, 0.8 + t).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.2 + Math.random() * t * 0.12, (Math.random() - 0.5) * 1.5));
        particles.emit(p, new THREE.Vector3(0, 0.3, 0), { color: [0.55, 0.46, 0.36], alpha: 0.22 * (1 - t / 16), size: 0.7 + t * 0.08, life: 2.2, grow: 0.5, drag: 1 });
      }
    }
    // a ride through deep snow has already ploughed a trench behind the horse
    if (world.climateAt(px, pz).snow > 0.5) snowTrail.prefill(px, pz, yaw); else snowTrail.clear();
    G.started = true;
    G.frame = 0;
    G.hold = false;
  };

  G.ready = true;
  setLoad(1, 'Ready');
  document.getElementById('loading').classList.add('done');
  if (!CAPTURE) {
    const title = document.getElementById('title');
    title.classList.add('show');
    const go = () => {
      if (G.started) return;
      G.started = true;
      title.classList.remove('show');
      hud.root.classList.add('on');
      audio.start();
      canvas.requestPointerLock?.();
      hud.feed('Press <b>F1</b> for controls');
    };
    title.addEventListener('click', go);
    addEventListener('keydown', go, { once: true });
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
    particles.setScale(innerHeight); snowfall.setScale(innerHeight);
  });
  particles.setScale(innerHeight); snowfall.setScale(innerHeight);
  post.setSize(innerWidth, innerHeight);

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let titleT = 0;
  const lampPos = town.lights;
  function frame() {
    requestAnimationFrame(frame);
    if (G.hold) { clock.getDelta(); return; }
    const rdt = Math.min(clock.getDelta(), 0.1);
    G.deadEyeK = THREE.MathUtils.lerp(G.deadEyeK, G.deadEye ? 1 : 0, Math.min(1, rdt * 6));
    G.timeScale = THREE.MathUtils.lerp(1, 0.3, G.deadEyeK);
    const dt = rdt * G.timeScale;
    U.uTime.value += dt;

    if (G.started && !G.camOverride) {
      if (!player.dead) handleInput(dt);
      player.update(dt);
    } else if (G.started && G.camOverride) {
      player.update(dt);
      if (G.forceGallop) player.hspeed = 13;
      const o = G.camOverride;
      if (o.pos) { camera.position.copy(o.pos); camera.lookAt(o.look); }
      else {
        const yaw = player.hyaw;
        const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const base = player.hpos;
        camera.position.copy(base).addScaledVector(r, o.rel[0]).addScaledVector(f, o.rel[2]).add(new THREE.Vector3(0, o.rel[1], 0));
        camera.position.y = Math.max(camera.position.y, world.heightAt(camera.position.x, camera.position.z) + 0.4);
        camera.lookAt(base.clone().addScaledVector(r, o.lookRel[0]).addScaledVector(f, o.lookRel[2]).add(new THREE.Vector3(0, o.lookRel[1], 0)));
      }
      camera.fov = 50; camera.updateProjectionMatrix();
    } else {
      // title flyover
      titleT += rdt * 0.03;
      const c = new THREE.Vector3(Math.cos(titleT) * 120 - 40, 0, Math.sin(titleT) * 120 + 60);
      c.y = world.heightAt(c.x, c.z) + 22;
      camera.position.copy(c);
      camera.lookAt(0, 30, -400);
      player.update(0);
    }

    // stats
    if (G.deadEye) { player.deadEye -= rdt * 14; if (player.deadEye <= 0) { G.deadEye = false; audio.deadEye(false); } }
    else player.deadEye = Math.min(100, player.deadEye + rdt * 1.5);
    G.fireCD -= dt;
    if (G.reloadT > 0) { G.reloadT -= dt; if (G.reloadT <= 0) { const n = Math.min(6 - G.ammo, G.reserve); G.ammo += n; G.reserve -= n; } }
    G.damage = Math.max(0, G.damage - rdt * 1.5);
    if (G.wanted > 0) G.wanted -= rdt;
    if (player.dead) {
      G.dieT -= rdt;
      if (G.dieT <= 0) {
        player.dead = false; player.health = 100;
        player.mounted = true; player.attachRider();
        player.spawn(-20, 30, Math.PI);
        G.money *= 0.9;
        hud.feed('You wake in Copper Hollow, lighter in the pocket', 'bad');
      }
    }

    const focus = player.mounted ? player.hpos : player.pos;
    U.uPlayerPos.value.copy(focus);
    const wind = U.uWind.value; const wa = Math.sin(U.uTime.value * 0.02) * 0.6 + 0.4; wind.set(Math.cos(wa), Math.sin(wa));
    U.uWindStrength.value = 0.8 + Math.sin(U.uTime.value * 0.11) * 0.3;
    // local mist: denser among trees and in the early morning
    {
      const fo = world.splatAt(camera.position.x, camera.position.z).forest;
      const morning = Math.max(0, 1 - Math.abs(sky.time - 7.5) / 2.5);
      const low = 1 - THREE.MathUtils.smoothstep(camera.position.y - world.heightAt(camera.position.x, camera.position.z), 6, 20);
      G.mistK = 1 + (fo * 1.1 + morning * 1.5) * low;
      G.forestK = fo * low;
      // regional weather from the climate under the camera (snapped on the first frames of a capture shot)
      const cc = world.climateAt(camera.position.x, camera.position.z);
      const swampy = world.splatAt(camera.position.x, camera.position.z).wet * (camera.position.x > 500 && camera.position.z > 600 ? 1 : 0);
      sky.setWeather({
        storm: THREE.MathUtils.smoothstep(cc.snow, 0.35, 0.8),
        humid: Math.max(cc.jungle, swampy * 0.7),
        dry: cc.desert,
        ...(G.weatherOverride || {}),
      }, G.frame < 3 ? 1 : rdt * 0.2);
      snowfall.update(camera.position, sky.weather.blizzard * (U.uNight.value < 0.9 ? 1 : 0.6));
      if (player.mounted && player.hspeed > 0.5 && (player.snowDepth || 0) > 0.3) snowTrail.add(player.hpos.x, player.hpos.z);
      // the fog layer rests on the ground beneath the camera (low points win: it settles into valleys)
      let gmin = world.heightAt(camera.position.x, camera.position.z);
      for (let k = 0; k < 8; k++) { const a = k * 0.785; gmin = Math.min(gmin, world.heightAt(camera.position.x + Math.cos(a) * 220, camera.position.z + Math.sin(a) * 220)); }
      const fb = Math.max(0, gmin - 10);
      U.uFogBase.value += (fb - U.uFogBase.value) * (G.frame < 3 ? 1 : Math.min(1, rdt * 0.5));
    }
    const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd); camFwd.y = 0; camFwd.normalize();
    const shadowFocus = camera.position.clone().addScaledVector(camFwd, 95);
    shadowFocus.y = world.heightAt(shadowFocus.x, shadowFocus.z);
    sky.update(!G.freezeTime && G.started ? dt : 0, shadowFocus);
    sky.mesh.position.copy(camera.position);
    U.uFogDensity.value *= G.mistK || 1;
    town.update(dt, U.uNight.value);
    veg.update(camera.position);
    terrain.update(camera);
    npcs.update(dt, player);
    particles.update(dt);
    tracers.update(dt);
    for (const c of campfires) { c.lastCam = camera.position; c.update(dt, c.pos.distanceTo(camera.position) < 200); }
    // chimney smoke from homesteads
    for (const cp of town.chimneys || []) {
      if (cp.distanceToSquared(camera.position) > 400 * 400 || Math.random() > dt * 9) continue;
      particles.emit(cp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)),
        new THREE.Vector3(U.uWind.value.x * 0.6, 1.1 + Math.random() * 0.4, U.uWind.value.y * 0.6), { color: [0.72, 0.72, 0.74], alpha: 0.32, size: 0.7, life: 9, grow: 0.55, drag: 0.25 });
    }
    // sunlit motes / insects drifting around the camera
    if (U.uNight.value < 0.6 && Math.random() < rdt * 6) {
      const p = camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.3) * 4, (Math.random() - 0.5) * 16));
      particles.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.3), { color: [2.2, 1.8, 1.2], alpha: 0.7, size: 0.025, life: 6, grow: 0, drag: 0.2, add: 1 });
    }
    // hoof dust
    if (player.hspeed > 6) {
      const sp = world.splatAt(player.hpos.x, player.hpos.z);
      const dry = Math.max(sp.road, 0.25);
      if (Math.random() < rdt * player.hspeed * 2.2 * dry) {
        const back = new THREE.Vector3(-Math.sin(player.hyaw), 0, -Math.cos(player.hyaw));
        particles.emit(player.hpos.clone().addScaledVector(back, 0.8).add(new THREE.Vector3((Math.random() - 0.5), 0.15, (Math.random() - 0.5))),
          back.multiplyScalar(1.5).add(new THREE.Vector3(0, 0.6, 0)), { color: [0.72, 0.62, 0.48], alpha: 0.45, size: 0.9, life: 2.2, grow: 0.9, drag: 1.2 });
      }
    }
    // night lamps: assign pooled lights to nearest lamp posts
    if (G.frame % 30 === 0) {
      const sorted = lampPos.slice().sort((a, b) => a.distanceToSquared(camera.position) - b.distanceToSquared(camera.position));
      lamps.forEach((l, i) => { if (sorted[i]) l.position.copy(sorted[i]); });
    }
    for (const l of lamps) l.intensity = U.uNight.value * 14;

    // loot prompt & reticle
    G.lootTarget = null;
    if (!player.mounted) {
      const a = npcs.nearestLootable(player.pos);
      if (a) G.lootTarget = a.kind === 'deer' ? 'Skin Deer' : 'Loot Body';
      for (const it of town.interactables) if (it.type === 'loot' && !it.taken && it.pos.distanceTo(player.pos) < 3) G.lootTarget = 'Open Strongbox';
    }
    if (player.aiming) { const h = npcs.raycast(player.aimRay(), 200); G.reticleEnemy = h && h.actor.kind === 'outlaw'; } else G.reticleEnemy = false;

    // ripples for whoever is standing or moving in water near the camera
    {
      const rip = [];
      const add = (pos, k) => { if (rip.length < 6 && world.heightAt(pos.x, pos.z) < -0.05 && pos.distanceTo(camera.position) < 120) rip.push([pos.x, pos.z, k]); };
      add(player.hpos, 0.45 + Math.min(player.hspeed, 8) * 0.07);
      if (!player.mounted) add(player.pos, 0.35 + player.speed * 0.08);
      for (const a of npcs.actors) { if (rip.length >= 6) break; if (!a.dead) add(a.pos, 0.3 + a.speed * 0.08); }
      water.setRipples(rip);
    }
    water.update(camera);
    if (G.started) hud.update(rdt, G);
    audio.update(rdt, { night: U.uNight.value, speed: player.mounted ? player.hspeed : player.speed, nearWater: Math.max(0, 1 - Math.max(0, world.heightAt(focus.x, focus.z)) / 4), riding: player.mounted && player.hspeed > 4, listener: focus, deadEye: G.deadEyeK });
    post.render(rdt, { storm: sky.weather.blizzard, shaftK: 1 + (G.forestK || 0) * 0.8 - sky.weather.storm * 0.8, deadEye: G.deadEyeK, damage: G.damage, letterbox: player.cinematic * 0.11, fade: player.dead ? Math.min(1, (4 - G.dieT) / 2) : 0 });
    if (G.snap) {
      // photo mode: save the frame at full render resolution, without the HUD (it is DOM, not canvas)
      G.snap = false;
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `dust-and-redemption-${canvas.width}x${canvas.height}-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }, 'image/png');
      hud.feed(`Photo saved <b>${canvas.width}×${canvas.height}</b>`);
    }
    input.endFrame();
    G.frame++;
  }
  frame();
}

init().catch((e) => {
  console.error(e);
  loadingStatus.textContent = 'Error: ' + e.message;
});
