// Dust & Redemption — bootstrap, game rules and main loop.
import './style.css';
import * as THREE from 'three';
import { setCreatureDetail, loadHumanModel } from './creatures.js';
import { World, TOWN, CAMP, RANCH, CHURCH, CABIN, PINE_TRAIL, RES, setWorldResolution, loadRealTerrain } from './world.js';
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
// cinematic (the default) is tuned for an Apple-silicon laptop and favours image quality over frame rate;
// high/med/low remain for older machines
const QUALITY = { low: 0.45, med: 0.75, high: 1, ultra: 1.5, cinematic: 2 }[params.get('q') || 'cinematic'] ?? 2;
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
  setWorldResolution(QUALITY >= 2 ? 4096 : QUALITY > 1 ? 3072 : QUALITY >= 1 ? 2560 : 2048);
  setCreatureDetail(QUALITY);
  U.uRes.value = RES;
  await Promise.all([loadRealTerrain(), loadHumanModel()]);
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
  const snowfall = new Snowfall(scene, QUALITY >= 2 ? 32000 : QUALITY > 1 ? 22000 : 15000);
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
    pines: () => { const [x, z, yaw] = G.denseOnRoad(PINE_TRAIL, true); return { time: 16.6, player: [x, z, yaw], camRel: [0.75, 2.85, -3.9], lookRel: [0.2, 3.0, 22], trailDress: true }; },
    snowride: () => { const [x, z, yaw] = G.findCanyonRide() || G.alongValley(0.5); return { time: 13.0, player: [x, z, yaw], camRel: [-0.7, 2.8, -4.0], lookRel: [-0.6, 1.9, 18], weather: 'snow' }; },
    snowvista: () => { const v = G.findVista(); return { foreground: true, weather: { storm: 0.78, blizzard: 0.0 }, time: 15.4, player: [CABIN.x - 40, CABIN.z - 30, 0], cam: [v.cx, null, v.cz, 3.2], look: [v.tx, null, v.tz, v.th] }; },
    jungle: () => { const v = G.findCoastVista(); return { clearView: true, time: 15.8, player: [v.px, v.pz, v.yaw], cam: [v.cx, null, v.cz, 2.2], look: [v.tx, null, v.tz, v.th] }; },
    autumn: () => { const [x, z, yaw] = G.onRoad(0, 0.08, true); return { time: 16.2, player: [x, z, yaw], camRel: [0.7, 2.4, -6.2], lookRel: [0, 2.0, 14] }; },
    desert: () => { sky.time = 17.6; sky.update(0, camera.position); const [x, z, yaw] = G.findButte(); return { time: 17.6, player: [x, z, yaw], camRel: [0.9, 2.2, -5.8], lookRel: [0, 6.0, 30] }; },
  };
  // an outcrop above the trapper's cabin with a clear line of sight over it and down Frostwater Valley
  G.findVista = () => {
    // A lookout above the cabin, looking straight over it and on down the valley: the cabin sits in the lower
    // third, the creek and the valley floor lead the eye away, the ranges and the storm fill the top
    const cabY = world.heightAt(CABIN.x, CABIN.z) + 3;
    const vh = world.valley[Math.floor(world.valley.length * 0.06)];
    const upDir = Math.atan2(vh[0] - CABIN.x, vh[1] - CABIN.z);
    let best = null, bs = -1e9;
    for (let r = 110; r <= 420; r += 15) for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
      const cx = CABIN.x + Math.sin(a) * r, cz = CABIN.z + Math.cos(a) * r;
      const ch = world.heightAt(cx, cz) + 3.2, above = ch - cabY;
      if (above < 25 || above > 160) continue;
      const va = Math.atan2(CABIN.x - cx, CABIN.z - cz);
      // looking up-valley, toward the head of the valley and its peaks
      let dv = va - upDir; dv = Math.atan2(Math.sin(dv), Math.cos(dv));
      if (Math.abs(dv) > 0.75) continue;
      let clear = true;
      for (let k = 1; k < 30 && clear; k++) { const t = k / 30; if (world.heightAt(cx + (CABIN.x - cx) * t, cz + (CABIN.z - cz) * t) > ch + (cabY - ch) * t - 1.5) clear = false; }
      if (!clear) continue;
      // depth beyond the cabin: the valley floor stays well below the lens for a long way
      let depth = 0;
      for (let d = r + 150; d <= r + 2400; d += 150) for (const b of [-0.25, 0, 0.25]) {
        if (world.heightAt(cx + Math.sin(va + b) * d, cz + Math.cos(va + b) * d) < ch - 25) depth++;
      }
      // nothing near the lens rising into the frame
      let blocked = 0;
      for (let b = -0.5; b <= 0.51; b += 0.1) for (let d = 15; d <= Math.min(r, 160); d += 15) {
        if (world.heightAt(cx + Math.sin(va + b) * d, cz + Math.cos(va + b) * d) > ch - 3 - d * 0.15) blocked++;
      }
      const score = depth * 3 - blocked * 4 - Math.abs(above - 55) * 0.4 - Math.abs(r - 180) * 0.06;
      if (score > bs) { bs = score; best = { cx, cz, ch, va, cab: r }; }
    }
    if (!best) { const cx = CABIN.x + 200, cz = CABIN.z + 150; best = { cx, cz, ch: world.heightAt(cx, cz) + 3.2, va: Math.atan2(CABIN.x - cx, CABIN.z - cz), cab: 250 }; }
    // pitch so the cabin sits in the lower third with the valley and the sky above it
    const pitch = Math.atan2(cabY - best.ch, best.cab) + 0.2;
    const D = 1200, lx = best.cx + Math.sin(best.va) * D, lz = best.cz + Math.cos(best.va) * D;
    return { cx: best.cx, cz: best.cz, tx: lx, tz: lz, th: best.ch + Math.tan(pitch) * D - world.heightAt(lx, lz) };
  };
  // desert: a rider on the flat valley floor with a tall butte standing 500-1400 m ahead, sun low behind the camera
  G.findButte = () => {
    let best = [-2700, 2480, 0], bs = -1e9;
    const sun = U.uSunDir.value;
    for (let z = 1700; z < 3750; z += 60) for (let x = -3800; x < -1700; x += 60) {
      const h = world.heightAt(x, z);
      if (world.climateAt(x, z).desert < 0.8 || world.normalAt(x, z).y < 0.985) continue;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        let peak = 0;
        let outside = false;
        for (let d = 500; d <= 1400; d += 100) {
          const qx = x + Math.sin(a) * d, qz = z + Math.cos(a) * d;
          if (qx < -3980 || qx > -1520 || qz < 1440 || qz > 3960 || world.climateAt(qx, qz).desert < 0.75) { outside = true; break; }
          peak = Math.max(peak, world.heightAt(qx, qz) - h);
        }
        if (outside) continue;
        // a desert view all the way to the horizon: no jungle, snow or forest anywhere in the frame
        let foreign = false;
        for (const b of [-0.5, -0.25, 0, 0.25, 0.5]) for (let d = 800; d <= 6000 && !foreign; d += 400) {
          const qx = x + Math.sin(a + b) * d, qz = z + Math.cos(a + b) * d;
          if (Math.abs(qx) > 4096 || Math.abs(qz) > 4096) break;
          const cq = world.climateAt(qx, qz);
          if (cq.jungle > 0.25 || cq.snow > 0.3 || cq.autumn > 0.3 || (cq.desert < 0.3 && world.heightAt(qx, qz) > 150)) foreign = true;
        }
        if (foreign) continue;
        // nothing blocking the near view
        let block = 0; for (let d = 20; d < 400; d += 40) block = Math.max(block, world.heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d) - h);
        // golden light on the faces: the low sun behind the camera, a little to one side
        const back = -(Math.sin(a) * sun.x + Math.cos(a) * sun.z) / Math.hypot(sun.x, sun.z);
        const score = Math.min(peak, 300) - block * 3 - Math.abs(peak - 240) * 0.2 + 80 * Math.min(back, 0.85);
        if (score > bs) { bs = score; best = [x, z, a]; }
      }
    }
    return best;
  };
  // jungle coast: on the cliff tops near the sea, looking along the coast (the classic Na Pali view): ridges
  // marching away on one side, the sea on the other
  G.findCoastVista = () => {
    let best = null, bs = -1e9;
    for (let z = 1900; z < 3400; z += 40) for (let x = -500; x < 2500; x += 40) {
      const h = world.heightAt(x, z);
      if (h < 90 || h > 320 || world.normalAt(x, z).y < 0.85) continue;
      // the sea within 700 m to the south
      let seaD = 1e9; for (let d = 60; d <= 700; d += 40) if (world.heightAt(x, z + d) < 0) { seaD = d; break; }
      if (seaD > 700) continue;
      for (const a of [Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4]) {
        let land = 0, block = 0, sea = 0;
        for (let d = 300; d <= 2400; d += 150) for (const b of [-0.3, 0, 0.3]) {
          const q = world.heightAt(x + Math.sin(a + b) * d, z + Math.cos(a + b) * d);
          if (q < 0) sea++; else if (q > 60) land++;
        }
        for (let d = 15; d < 200; d += 15) block = Math.max(block, world.heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d) - h + d * 0.08);
        if (sea < 4 || land < 6) continue;
        const score = land + sea * 0.6 - Math.max(0, block) * 0.6 - seaD * 0.01;
        if (score > bs) { bs = score; best = { x, z, a, h }; }
      }
    }
    if (!best) return { px: 900, pz: 2600, yaw: 0, cx: 900, cz: 2600, tx: 900, tz: 3600, th: 0 };
    const D = 1500, tx = best.x + Math.sin(best.a) * D, tz = best.z + Math.cos(best.a) * D;
    const th = best.h + 2.2 - D * 0.08 - world.heightAt(tx, tz);
    return { px: best.x - Math.sin(best.a) * 30, pz: best.z - Math.cos(best.a) * 30, yaw: best.a, cx: best.x, cz: best.z, tx, tz, th };
  };
  // the canyon: a rider on the flat floor looking along it, sheer walls rising close on both sides
  G.findCanyonRide = () => {
    const lo = Math.min(...[-3600, -3300, -3000, -2700, -2400].flatMap((z) => [-3800, -3400, -3000, -2600, -2200].map((x) => world.heightAt(x, z))));
    let best = null, bs = -1e9;
    for (let z = -3900; z < -2150; z += 30) for (let x = -3950; x < -1900; x += 30) {
      const h = world.heightAt(x, z);
      if (h > lo + 30 || world.normalAt(x, z).y < 0.975 || world.splatAt(x, z).wet > 0.1 || world.climateAt(x, z).snow < 0.7) continue;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const f = [Math.sin(a), Math.cos(a)], rt = [Math.cos(a), -Math.sin(a)];
        let ahead = 0, sides = 0;
        for (let d = 150; d <= 900; d += 150) ahead = Math.max(ahead, world.heightAt(x + f[0] * d, z + f[1] * d) - h);
        for (const sd of [-1, 1]) {
          let wall = 0;
          for (let d = 150; d <= 700; d += 110) for (const fw of [100, 350]) wall = Math.max(wall, world.heightAt(x + rt[0] * sd * d + f[0] * fw, z + rt[1] * sd * d + f[1] * fw) - h);
          sides += Math.min(wall, 450);
        }
        const score = sides - ahead * 0.8;
        if (score > bs && G.treesNear(x, z, 6) === 0 && G.treesNear(x - f[0] * 6, z - f[1] * 6, 5) === 0) { bs = score; best = [x, z, a]; }
      }
    }
    return best;
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
    for (let t = 0.15; t < 0.9; t += 0.01) {
      const [x, z, yaw] = G.onRoad(ri, t, reverse);
      let f = 0, lo = 1e9, hi = -1e9;
      for (let k = 0; k < 12; k++) {
        const a = k * 0.5236;
        for (const rr of [18, 40]) {
          const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
          f += world.splatAt(px, pz).forest;
          const h = world.heightAt(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
      }
      // deep in the trees on level ground: no crest with the view opening out over the canopy
      const fwd = [Math.sin(yaw), Math.cos(yaw)];
      for (const d of [25, 50, 80]) f += 2 * world.splatAt(x + fwd[0] * d + fwd[1] * 12, z + fwd[1] * d - fwd[0] * 12).forest + 2 * world.splatAt(x + fwd[0] * d - fwd[1] * 12, z + fwd[1] * d + fwd[0] * 12).forest;
      const score = f - 0.35 * Math.max(0, hi - lo - 6);
      if (score > bs) { bs = score; best = [x, z, yaw]; }
    }
    return best;
  };
  // a point on the Frostwater Valley floor, heading up-valley
  G.alongValley = (t) => {
    const v = world.valley;
    // the most dramatic stretch of the valley: steep walls rising close on both sides and ahead (a cliff-walled
    // trough, as in the reference ride), with a clear spot on dry snow for the rider and the camera
    let best = null, bs = -1e9;
    for (let i = 2; i < v.length - 3; i++) {
      const [ax, az] = v[i + 1], [bx, bz] = v[i];
      const yaw = Math.atan2(bx - ax, bz - az);
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const fl = world.heightAt(ax, az);
      if (az < -3500 || az > -2250 || world.climateAt(ax, az).snow < 0.7) continue;   // deep in the snow country, not the closing ridge
      if (world.heightAt(ax + fx * 80, az + fz * 80) - fl > 8) continue;   // level floor ahead of the rider
      // wall rise and steepness within the view cone, 120-700 m out
      let wall = 0;
      for (const side of [-1, 1]) for (let d = 120; d <= 700; d += 60) for (let a = 0.25; a <= 0.85; a += 0.2) {
        const px = ax + (fx * Math.cos(a) + side * rx * Math.sin(a)) * d, pz = az + (fz * Math.cos(a) + side * rz * Math.sin(a)) * d;
        const rise = world.heightAt(px, pz) - fl;
        wall += Math.min(rise / d, 0.9) * (1 - world.normalAt(px, pz).y > 0.25 ? 1.5 : 1);
      }
      if (wall > bs) { bs = wall; best = i; }
    }
    // search outward from the best stretch for a clear, dry spot
    for (let off = 0; off < v.length; off++) for (const i of [best + off, best - off]) {
      if (i < 1 || i > v.length - 2) continue;
      const [ax, az] = v[i + 1], [bx, bz] = v[i];
      const yaw = Math.atan2(bx - ax, bz - az);
      for (const side of [12, -12, 25, -25, 40, -40]) {
        const x = ax + Math.cos(yaw) * side, z = az - Math.sin(yaw) * side;
        const cx = x - Math.sin(yaw) * 6.5, cz = z - Math.cos(yaw) * 6.5;
        const dry = [[x, z], [cx, cz], [x + Math.sin(yaw) * 8, z + Math.cos(yaw) * 8]].every(([qx, qz]) => world.splatAt(qx, qz).wet < 0.12 && world.normalAt(qx, qz).y > 0.96);
        if (dry && world.climateAt(x, z).snow > 0.7 && G.treesNear(x, z, 6) === 0 && G.treesNear(cx, cz, 5) === 0 && G.treesNear(x + Math.sin(yaw) * 12, z + Math.cos(yaw) * 12, 4) === 0) return [x, z, yaw];
      }
    }
    const [ax, az] = v[v.length - 2]; return [ax, az, 0];
  };
  G.clearTreesNear = (x, z, r, L = veg.trees) => {
    const cx = Math.floor(x / L.cell), cz = Math.floor(z / L.cell), gone = new Set();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = (cx + dx) + ',' + (cz + dz), list = L.grid.get(k);
      if (!list) continue;
      L.grid.set(k, list.filter((it) => { const keep = Math.hypot(it.x - x, it.z - z) >= r; if (!keep) gone.add(it); return keep; }));
    }
    if (gone.size) { L.items = L.items.filter((it) => !gone.has(it)); veg.update(camera.position, true); }
    return gone.size;
  };
  G.clearTreesAlong = (ax, az, bx, bz, w, upto = 1) => {
    const L = veg.trees, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const near = (it) => { const t = Math.max(0, Math.min(upto, ((it.x - ax) * dx + (it.z - az) * dz) / L2)); return Math.hypot(ax + dx * t - it.x, az + dz * t - it.z) < w + 2 * it.s; };
    for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !near(it)));
    L.items = L.items.filter((it) => !near(it));
    veg.update(camera.position, true);
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
    player.setOutfit(world.climateAt(px, pz).snow > 0.5 ? 'winter' : 'arthur');
    player.hspeed = s.gallop ? 13 : 0;
    G.forceGallop = !!s.gallop;
    G.camOverride = null;
    G.weatherOverride = s.weather && typeof s.weather === 'object' ? s.weather : null;
    if (s.cam) {
      const [cx, cy, cz, ch] = s.cam, [lx, ly, lz, lh] = s.look;
      G.camOverride = { pos: new THREE.Vector3(cx, world.heightAt(cx, cz) + ch, cz), look: new THREE.Vector3(lx, world.heightAt(lx, lz) + lh, lz) };
      if (s.clearView) { G.clearTreesNear(cx, cz, 30); G.clearTreesNear(cx, cz, 9, veg.bushes); G.clearTreesAlong(cx, cz, lx, lz, 16, 0.15); }
    } else if (s.camRel) {
      const rel = s.camRel.slice();
      if (s.water) {
        // put the camera over open water, on whichever side of the horse is deeper
        const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const hp = world.heightAt(px + r.x * rel[0], pz + r.z * rel[0]), hm = world.heightAt(px - r.x * rel[0], pz - r.z * rel[0]);
        if (hm < hp) rel[0] = -rel[0];
      }
      G.camOverride = { rel, lookRel: s.lookRel };
      // keep the lens clear: no boughs between the camera and the rider
      const f = [Math.sin(yaw), Math.cos(yaw)], rt = [Math.cos(yaw), -Math.sin(yaw)];
      const camX = px + rt[0] * rel[0] + f[0] * rel[2], camZ = pz + rt[1] * rel[0] + f[1] * rel[2];
      G.clearTreesNear(camX, camZ, 5);
      G.clearTreesAlong(camX, camZ, px, pz, 2.5);
    }
    // trailside anchors, as a set dresser would place them: a mossy boulder and a fallen trunk off the left verge,
    // ferns and scrub around them
    if (s.trailDress && !G.trailDressed) {
      G.trailDressed = true;
      // (cos, -sin) points to the rider's left, so negative side offsets land on the right
      const f = [Math.sin(yaw), Math.cos(yaw)], lt = [Math.cos(yaw), -Math.sin(yaw)];
      const at = (ahead, side) => [px + f[0] * ahead - lt[0] * side, pz + f[1] * ahead - lt[1] * side];
      const [bx, bz] = at(9, -4.6); veg.rocks.add(bx, world.heightAt(bx, bz) - 0.5, bz, 1.1, 1.5, 1);
      const [lx, lz] = at(10.5, -6.5); veg.logs.add(lx, world.heightAt(lx, lz) - 0.05, lz, yaw + 1.25, 1.35, 0);
      const [rx, rz] = at(15, 5.2); veg.rocks.add(rx, world.heightAt(rx, rz) - 0.4, rz, 2.4, 1.1, 3);
      for (let i = 0; i < 14; i++) {
        const [ux, uz] = at(3 + i * 1.3, (i % 2 ? 1 : -1) * (2.4 + (i * 0.37) % 1.6));
        veg.bushes.add(ux, world.heightAt(ux, uz) - 0.05, uz, i * 1.3, 0.55 + (i % 3) * 0.2, i % 4 === 3 ? 7 : 3 + (i % 2));
      }
      veg.update(player.hpos, true);
    }
    // a frosted rock outcrop at the camera's feet to anchor a vista, as a location artist would place one
    if (s.foreground && G.camOverride && G.camOverride.pos && !G.fgPlaced) {
      G.fgPlaced = true;
      const c = G.camOverride.pos, l = G.camOverride.look;
      // clear the lookout itself, and a sightline down to the cabin, as a location artist would
      G.clearTreesNear(c.x, c.z, 40);
      G.clearTreesAlong(c.x, c.z, CABIN.x, CABIN.z, 10, 0.8);
      const d = new THREE.Vector3(l.x - c.x, 0, l.z - c.z).normalize(), rt = new THREE.Vector3(-d.z, 0, d.x);
      const g0 = world.heightAt(c.x, c.z);
      // only on the lookout's own ground: a boulder past the lip would hang in the air over the drop
      const put = (f, sideOff, scale, v) => { const x = c.x + d.x * f + rt.x * sideOff, z = c.z + d.z * f + rt.z * sideOff, gh = world.heightAt(x, z); if (gh > g0 - 12) veg.rocks.add(x, gh - 0.35 * scale, z, f * 1.3, scale, v); };
      put(9.0, -7.5, 3.2, 0); put(11.5, -4.0, 2.2, 1); put(8.0, 6.8, 2.6, 3); put(13.0, 9.5, 2.0, 2); put(7.0, -11.0, 3.6, 1); put(15.0, -10.0, 2.4, 2);
      for (let i = 0; i < 24; i++) { const x = c.x + d.x * (6 + (i % 8) * 1.1) + rt.x * (-11 + i * 0.95), z = c.z + d.z * (6 + (i % 8) * 1.1) + rt.z * (-11 + i * 0.95); veg.bushes.add(x, world.heightAt(x, z) - 0.05, z, i, 0.6 + (i % 3) * 0.2, 7 + (i % 2)); }
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
      G.mistK = 1 + (fo * 0.85 + morning * 1.5) * low;
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
      // two rings: the near one keeps forest haze around the rider, the far one lets the layer settle onto a valley
      // floor far below a lookout, so the valley holds haze instead of an opaque white bowl
      for (const rr of [220, 800]) for (let k = 0; k < 8; k++) { const a = k * 0.785 + rr; gmin = Math.min(gmin, world.heightAt(camera.position.x + Math.cos(a) * rr, camera.position.z + Math.sin(a) * rr)); }
      const fb = Math.max(0, gmin - 10);
      U.uFogBase.value += (fb - U.uFogBase.value) * (G.frame < 3 ? 1 : Math.min(1, rdt * 0.5));
      U.uMist.value = sky.weather.storm * (1 - sky.weather.blizzard) * THREE.MathUtils.smoothstep(cc.snow, 0.4, 0.8);
    }
    const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd); camFwd.y = 0; camFwd.normalize();
    const shadowFocus = camera.position.clone().addScaledVector(camFwd, 95);
    shadowFocus.y = world.heightAt(shadowFocus.x, shadowFocus.z);
    sky.update(!G.freezeTime && G.started ? dt : 0, shadowFocus);
    sky.mesh.position.copy(camera.position);
    U.uFogDensity.value *= G.mistK || 1;
    // eye adaptation: stop down when looking into a low sun, open up a little in deep forest shade
    {
      const f3 = new THREE.Vector3(); camera.getWorldDirection(f3);
      const into = THREE.MathUtils.smoothstep(f3.dot(U.uSunDir.value), 0.55, 0.95) * (1 - U.uNight.value);
      // (under a canopy the eye opens up even looking toward the sun: the hotspot is small)
      const target = 1.12 * (1 - 0.3 * into * (1 - 0.6 * (G.forestK || 0))) * (1 + 0.32 * (G.forestK || 0));
      renderer.toneMappingExposure += (target - renderer.toneMappingExposure) * (G.frame < 3 ? 1 : Math.min(1, rdt * 1.5));
    }
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
    const coldGrade = Math.max(sky.weather.blizzard, 0.75 * sky.weather.storm * THREE.MathUtils.smoothstep(world.climateAt(camera.position.x, camera.position.z).snow, 0.4, 0.8));
    post.render(rdt, { storm: coldGrade, forest: (G.forestK || 0) * (1 - U.uNight.value), shaftK: 1 + (G.forestK || 0) * 2.4 - sky.weather.storm * 0.8, deadEye: G.deadEyeK, damage: G.damage, letterbox: player.cinematic * 0.11, fade: player.dead ? Math.min(1, (4 - G.dieT) / 2) : 0 });
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
