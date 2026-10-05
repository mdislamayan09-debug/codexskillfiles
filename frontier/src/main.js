// Dust & Redemption — bootstrap, game rules and main loop.
import './style.css';
import * as THREE from 'three';
import { World, TOWN, CAMP, RANCH, CHURCH } from './world.js';
import { U, patchMaterial } from './shared.js';
import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Vegetation } from './vegetation.js';
import { Water } from './water.js';
import { Town } from './town.js';
import { Player } from './player.js';
import { NPCs } from './npc.js';
import { Particles, Campfire, Tracers } from './fx.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Post } from './post.js';

const params = new URLSearchParams(location.search);
const QUALITY = { low: 0.45, med: 0.75, high: 1 }[params.get('q') || 'high'] ?? 1;
const CAPTURE = params.has('capture');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY >= 1 ? 1.5 : 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
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
  const world = new World(1899);
  await world.generate((p) => setLoad(0.02 + p * 0.5, 'Raising mountains and cutting rivers…'));
  U.uHeight.value = world.heightTex;
  U.uSplat.value = world.splatTex;
  setLoad(0.55, 'Painting the sky…'); await tick();
  const sky = new Sky(scene, renderer);
  const terrain = new Terrain(world, scene);
  setLoad(0.6, 'Raising Copper Hollow…'); await tick();
  const town = new Town(world, scene);
  setLoad(0.7, 'Planting forests…'); await tick();
  const veg = new Vegetation(world, scene, renderer, QUALITY);
  for (const g of veg.grass) g.layers.set(1);
  setLoad(0.82, 'Filling the rivers…'); await tick();
  const water = new Water(scene, renderer, { reflections: QUALITY >= 0.7, resScale: QUALITY >= 1 ? 0.5 : 0.35 });
  const particles = new Particles(scene, 4000);
  const tracers = new Tracers(scene);
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

  Object.assign(G, { world, sky, terrain, town, veg, water, particles, tracers, npcs, player, hud, audio, input, post, scene, camera, renderer });
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
    ride: () => ({ time: 18.0, player: [-330, -140, -1.2], camRel: [3.6, 1.6, -0.6], lookRel: [0, 1.7, 0.3], sideShot: true }),
    swamp: () => ({ time: 7.1, player: [940, 1090, 0.6], camRel: [4.2, 1.5, 0.5], lookRel: [0, 1.6, 0.2], water: true }),
    town: () => ({ time: 17.2, player: [70, 2, -Math.PI / 2], cam: [95, null, 3, 2.2], look: [-60, null, -2, 3] }),
    forest: () => { const f = G.findForest(-200, -650); return { time: 8.4, player: [f[0], f[1], 0.4], camRel: [-3.2, 1.5, -4.2], lookRel: [0, 1.6, 0] }; },
    vista: () => ({ time: 17.8, player: [-60, 280, -0.2], cam: [-60, null, 330, 30], look: [40, null, -700, 120] }),
    gallop: () => ({ time: 17.6, player: [-380, -2, Math.PI / 2], camRel: [-2.6, 2.2, -6.5], lookRel: [0, 1.8, 3], gallop: true }),
    camp: () => ({ time: 20.4, player: [CAMP.x - 18, CAMP.z + 14, 2.2], cam: [CAMP.x - 14, null, CAMP.z + 16, 2.2], look: [CAMP.x, null, CAMP.z, 1] }),
    night: () => ({ time: 21.5, player: [-20, 4, Math.PI / 2], cam: [-40, null, 6, 2.5], look: [60, null, -4, 4] }),
    portrait: () => ({ time: 15.2, player: [-260, 40, 0.9], camRel: [2.4, 2.1, 3.0], lookRel: [0, 1.85, 0.2] }),
    hud: () => ({ time: 17.3, player: [300, -40, -Math.PI / 2 + 0.1], hud: true }),
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
  G.setShot = (name) => {
    const s = G.shots[name]();
    G.freezeTime = true;
    sky.time = s.time; sky.lastEnvTime = -100;
    const [px, pz, yaw] = s.player;
    player.spawn(px, pz, yaw);
    player.hspeed = s.gallop ? 13 : 0;
    G.forceGallop = !!s.gallop;
    G.camOverride = null;
    if (s.cam) {
      const [cx, cy, cz, ch] = s.cam, [lx, ly, lz, lh] = s.look;
      G.camOverride = { pos: new THREE.Vector3(cx, world.heightAt(cx, cz) + ch, cz), look: new THREE.Vector3(lx, world.heightAt(lx, lz) + lh, lz) };
    } else if (s.camRel) G.camOverride = { rel: s.camRel, lookRel: s.lookRel };
    hud.root.classList.toggle('on', !!s.hud);
    document.getElementById('title').classList.remove('show');
    document.getElementById('loading').classList.add('done');
    veg.update(player.hpos, true);
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
    particles.setScale(innerHeight);
  });
  particles.setScale(innerHeight);
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
    const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd); camFwd.y = 0; camFwd.normalize();
    const shadowFocus = camera.position.clone().addScaledVector(camFwd, 95);
    shadowFocus.y = world.heightAt(shadowFocus.x, shadowFocus.z);
    sky.update(!G.freezeTime && G.started ? dt : 0, shadowFocus);
    sky.mesh.position.copy(camera.position);
    town.update(dt, U.uNight.value);
    veg.update(camera.position);
    terrain.update(camera);
    npcs.update(dt, player);
    particles.update(dt);
    tracers.update(dt);
    for (const c of campfires) c.update(dt, c.pos.distanceTo(camera.position) < 200);
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

    water.update(camera);
    if (G.started) hud.update(rdt, G);
    audio.update(rdt, { night: U.uNight.value, speed: player.mounted ? player.hspeed : player.speed, nearWater: Math.max(0, 1 - Math.max(0, world.heightAt(focus.x, focus.z)) / 4), riding: player.mounted && player.hspeed > 4, listener: focus, deadEye: G.deadEyeK });
    post.render(rdt, { deadEye: G.deadEyeK, damage: G.damage, letterbox: player.cinematic * 0.11, fade: player.dead ? Math.min(1, (4 - G.dieT) / 2) : 0 });
    input.endFrame();
    G.frame++;
  }
  frame();
}

init().catch((e) => {
  console.error(e);
  loadingStatus.textContent = 'Error: ' + e.message;
});
