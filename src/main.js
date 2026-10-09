// Dust & Redemption — bootstrap, game rules and main loop.
import './style.css';
import * as THREE from 'three';
import { setCreatureDetail, loadHumanModel } from './creatures.js';
import { World, TOWN, CAMP, RANCH, CHURCH, CABIN, PINE_TRAIL, RES, HALF, setWorldResolution, loadRealTerrain } from './world.js';
import { U, patchMaterial, cloudLight } from './shared.js';
import { Terrain } from './terrain.js';
import { Backdrop } from './backdrop.js';
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
  const terrain = new Terrain(world, scene, surf, CAPTURE ? QUALITY : 1);   // (stills keep the densest ground mesh; in play 2 m cells to 240 m, 4 m to 640 m)
  const backdrop = new Backdrop(world, scene, QUALITY);   // the country beyond the map edge, out to the horizon
  setLoad(0.6, 'Raising Copper Hollow…'); await tick();
  const town = new Town(world, scene, surf);
  setLoad(0.7, 'Planting forests…'); await tick();
  const veg = new Vegetation(world, scene, renderer, QUALITY, surf);
  for (const g of veg.grass) g.layers.set(1);
  setLoad(0.82, 'Filling the rivers…'); await tick();
  const water = new Water(scene, renderer, { reflections: QUALITY >= 0.7, resScale: QUALITY > 1 ? 0.75 : QUALITY >= 1 ? 0.5 : 0.35, normals: surf.water });
  // (stills take an 8192 shadow map; in play 4096 over the same 300 m is 7 cm a texel and a quarter of the fill)
  if (QUALITY > 1 && CAPTURE && renderer.capabilities.maxTextureSize >= 8192) { sky.sun.shadow.mapSize.set(8192, 8192); sky.sun.shadow.map?.dispose(); sky.sun.shadow.map = null; }
  else if (!CAPTURE) { sky.sun.shadow.mapSize.set(2048, 2048); sky.sun.shadow.map?.dispose(); sky.sun.shadow.map = null; }
  const particles = new Particles(scene, 4000);
  const tracers = new Tracers(scene);
  const snowfall = new Snowfall(scene, QUALITY >= 2 ? 150000 : QUALITY > 1 ? 70000 : 30000);
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
  // in play the shadow map and the water's mirror are each redrawn on alternate frames; stills take both every frame
  sky.shadowEvery = CAPTURE ? 1 : 3; water.every = CAPTURE ? 1 : 2;
  const post = new Post(renderer, scene, camera, { ao: QUALITY >= 0.7, bloom: true, volSteps: CAPTURE ? (QUALITY >= 2 ? 150 : 64) : (QUALITY >= 2 ? 22 : 16), volDust: CAPTURE,   /* (stills march the air finely; in play a third of the steps, dithered, costs a few ms not twenty) */ samples: params.has('msaa') ? +params.get('msaa') : 4, smaa: params.get('msaa') === '0' });
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
    // a plain patch of open prairie under an early-afternoon sun, for looking at the rider and horse (scripts/turntable.mjs)
    studio: () => ({ time: 14.2, player: [1700, -420, 2.2], camRel: [2.6, 1.8, -3.4], lookRel: [0, 1.3, 0.1] }),
    // --- world v2 biomes (references: forest trail ride, snowy valley ride, snowy valley vista)
    // heading west-south-west down the logging trail, into the low afternoon sun as in the reference
    // both rides as the references frame them: camera close behind and to the left (+x of the frame is screen left),
    // the horse bearing right so its neck and ears show past the rider's shoulder, the rider filling the lower centre
    pines: () => { const [x, z, yaw] = G.denseOnRoad(PINE_TRAIL, true); // (a longer lens from further back, as the reference's: close in on a wide lens the horse's quarters swelled to
    // half again the rider's width and he read as a toy on its back)
    // (a high afternoon sun, as the reference's: it comes down steeply through the gaps between the crowns in separate
    // beams and lies on the floor in hard patches; low and dead ahead it lit all the air in the lane as one wash)
    // (back to a sun low ahead, as the reference's, now that the roof's gaps break its light into shafts and pools:
    // without them the same sun lit all the air in the lane as one wash)
    // (round 86: the horse turned further from the lens and the lens lower and level, so its neck, head and ears stand
    // clear to the right of the rider as in the reference: square behind, the animal ended at the saddle)
    // (round 79: framed as the reference is: the lens above the rider's shoulder looking down the trail, the rider left of
    // centre with the hat a third down and the frame cutting the horse at the croup, the trail running up to the right;
    // ?pinesold is the level, right-of-centre framing of rounds 50-78)
    return { time: 16.35, fov: 35, sunGap: params.has('pinesold') || params.has('nogap') ? null : [48, 190, 7.5], volDensity: params.has('pinesold') ? 0.0036 : 0.0026, volFalloff: 0.016, expK: params.has('pinesold') ? 1.18 : 1.32, keyShaft: 1.9, player: [x, z, yaw], camRel: params.has('pinesold') ? [1.25, 2.15, -5.0] : [-0.35, 2.3, -4.95], lookRel: params.has('pinesold') ? [-0.45, 1.8, 22] : [-0.35, 2.4, 22], turn: params.has('pt') ? +params.get('pt') : -0.62, stride: 0.16, trailDress: true }; },
    // (a falling-snow storm, not a total white-out: the reference keeps its cloud deck and ridges readable through it)
    snowride: () => {
      // scouted, as a location manager would: the canyon floor below the north-west massif, the lens looking
      // north-east up the valley with the massif's banded cliffs on the left and the spire standing in the gap
      // (round 77: the main valley's floor, looking north up it: timbered flanks with rock on them either side and
      // a notch at its head, where the canyon had sheer pale walls a kilometre off that read as painted slabs;
      // ?canyonride brings the canyon back)
      const [x, z, yaw] = (params.has('canyonride') ? G.clearNear(-3300, -2700, 1.78) : G.clearNear(-620, -2700, params.has('rideold') ? 2.83 : 2.59)) || G.findCanyonRide() || G.alongValley(0.5); // (framed as the reference: the whole horse, its feet near the bottom edge and the rider's hat four-tenths down)
      // (round 79: measured off the reference: the lens six metres back and near three up, the horse seen three-quarters
      // from behind with its feet at the bottom edge and the rider's hat just under half way down; ?rideold is the close
      // three-quarter framing of rounds 50-78)
      if (params.has('rideold')) return { time: 13.0, fov: 46, coat: 'redbay', player: [x, z, yaw], camRel: [0.7, 2.3, -4.6], lookRel: [-2.4, 0.75, 18], turn: -0.56, weather: { storm: 1, blizzard: 0.8 }, snowDress: true };
      return { time: 13.0, fov: 46, coat: 'redbay', player: [x, z, yaw], stride: 0.16, expK: 1.07, camRel: [0.45, 2.5, -5.4], lookRel: [-3.4, 1.6, 18], turn: -0.8, weather: { storm: 1, blizzard: 0.62 }, snowDress: true }; },
    // close look at the winter rider and tack from behind (costume detail checks)
    riderback: () => { const [x, z, yaw] = G.findCanyonRide() || G.alongValley(0.5); return { time: 13.0, player: [x, z, yaw], camRel: [0.7, 2.45, -2.9], lookRel: [0, 1.95, 1.5], turn: -0.45, weather: 'snow' }; },
    // the reference frame: a summit lookout high above the valley, looking up its length over the homestead
    snowvista: () => { const v = G.findVista(); return { fov: 40, foreground: true, home: v.home, weather: { storm: 0.86, blizzard: 0.0 }, time: 8.6, player: [CABIN.x - 40, CABIN.z - 30, 0], cam: [v.cx, null, v.cz, v.ch - world.heightAt(v.cx, v.cz)], look: [v.tx, null, v.tz, v.th] }; },
    jungle: () => { const v = G.findCoastVista(); return { clearView: true, time: 15.8, player: [v.px, v.pz, v.yaw], cam: [v.cx, null, v.cz, 2.2], look: [v.tx, null, v.tz, v.th] }; },
    autumn: () => { const [x, z, yaw] = G.onRoad(0, 0.08, true); return { time: 16.2, player: [x, z, yaw], camRel: [0.7, 2.4, -6.2], lookRel: [0, 2.0, 14] }; },
    desert: () => { sky.time = 17.6; sky.update(0, camera.position); const [x, z, yaw] = G.findButte(); return { time: 17.6, player: [x, z, yaw], camRel: [0.9, 2.2, -5.8], lookRel: [0, 6.0, 30] }; },
  };
  // handles for the capture/probe tooling
  G.dbg = { world, veg, sky, backdrop, scene, camera, U, THREE, CABIN, renderer, post, town };
  // The summit lookout the reference is taken from: a ledge high on a valley side, the valley receding to the
  // horizon through the middle of the frame, a homestead on a bench a few hundred metres below the lens. Searched
  // over the snowy north by marching rays through a trial frame from every ledge.
  G.findVista = () => {
    if (G.vistaCache) return G.vistaCache;
    // Scouted, as a location manager would (rounds 66-67): the west shoulder above the mouth of the main valley,
    // looking north-east up its length. The valley floor lies across the right of the frame with its river
    // winding away, timbered slopes either side and the range across it. The summit lookout the search below
    // finds looks into a side notch with no floor in view. The lens stands on a rock knob built up from the
    // shoulder (see the lookout's dressing), high enough to see over the timber below it.
    if (!params.has('vistasearch')) {
      // (round 76: higher, on the west ridge five hundred metres above the floor, looking north-north-east over the
      // valley's length to the ranges beyond the map: from the shoulder a dome two kilometres off closed the view
      // like a bowl; from here the eye runs down into the valley and out over ridge after ridge to the horizon)
      // (round 77: over the valley's mouth, looking straight up its axis, as the reference looks up its valley: the
      // floor and its river run away from below the lens to a notch in the ranges, a flank either side. The ridge
      // lookout of round 76 (?vistaridge) had depth but no valley in it: a fog void and a wall.)
      const S = params.has('vistalow') ? { cx: -1060, cz: -1990, lift: 85, tx: -600, tz: -3500 } : params.has('vistaridge') ? { cx: -1800, cz: -2500, lift: 6, tx: -620, tz: -4000 } : { cx: -560, cz: -1980, lift: 150, tx: -760, tz: -4000 };
      const PITCH0 = params.has('vistalow') ? -0.12 : params.has('vistaridge') ? -0.15 : -0.13, D0 = 1200;
      const az0 = Math.atan2(S.tx - S.cx, S.tz - S.cz), ch0 = world.heightAt(S.cx, S.cz) + S.lift;
      const lx0 = S.cx + Math.sin(az0) * D0, lz0 = S.cz + Math.cos(az0) * D0;
      G.vistaCache = { cx: S.cx, cz: S.cz, ch: ch0, tx: lx0, tz: lz0, th: ch0 + Math.tan(PITCH0) * D0 - world.heightAt(lx0, lz0), home: null, knob: true };
      return G.vistaCache;
    }
    const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 1e5), rc = new THREE.Raycaster(), n2 = new THREE.Vector2();
    const E = HALF - 12, PITCH = -0.12;
    const march = (o, r, max = 9000) => {
      for (let t = 25; t < max; t += t < 400 ? 8 : 30) {
        const x = o.x + r.x * t, z = o.z + r.z * t;
        if (Math.abs(x) > E || Math.abs(z) > E) return t + 1500;   // out past the edge: the backdrop's far ranges
        if (o.y + r.y * t < world.heightAt(x, z)) return t;
      }
      return 1e5;
    };
    const frame = (c) => { cam.position.set(c.cx, c.ch, c.cz); cam.lookAt(c.cx + Math.sin(c.az) * 1000, c.ch + Math.tan(PITCH) * 1000, c.cz + Math.cos(c.az) * 1000); cam.updateMatrixWorld(); };
    // the valley floor's own line, to check the frame actually looks down onto it (not over a shoulder that hides it)
    const VP = world.valley.filter((p) => p[1] < -1950).map((p) => [p[0], world.heightAt(p[0], p[1]) + 2, p[1]]);
    const v3 = new THREE.Vector3();
    const cands = [];
    for (let cz = -3800; cz <= -1850; cz += 50) for (let cx = -2300; cx <= 1100; cx += 50) {
      if (world.climateAt(cx, cz).snow < 0.6) continue;
      const g0 = world.heightAt(cx, cz);
      if (g0 < 330) continue;                                  // well above the valley floor
      // looking north up the valley, into the ranges (south it opens onto the green lowlands)
      for (let az = Math.PI - 0.85; az < Math.PI + 0.86; az += 0.105) {
        const fx = Math.sin(az), fz = Math.cos(az);
        // a ledge: the ground just ahead dips gently, so the lookout's own rock is in shot, then falls away
        const lip = g0 - world.heightAt(cx + fx * 16, cz + fz * 16);
        if (lip < -1 || lip > 9) continue;
        const drop = g0 - Math.max(world.heightAt(cx + fx * 60, cz + fz * 60), world.heightAt(cx + fx * 90, cz + fz * 90));
        if (drop < 22) continue;
        const c = { cx, cz, ch: g0 + 3.2, az };
        frame(c);
        // open below the ledge: the lower middle of the frame looks down past it onto the valley, not onto the
        // mountain's own shoulder a few tens of metres out
        let open = true;
        for (const sx of [-0.25, 0, 0.25]) { n2.set(sx, -0.42); rc.setFromCamera(n2, cam); if (march(rc.ray.origin, rc.ray.direction, 200) < 160) { open = false; break; } }
        if (!open) continue;
        let vis = 0;
        for (const [px2, py2, pz2] of VP) {
          v3.set(px2, py2, pz2).project(cam);
          if (!(v3.z < 1 && Math.abs(v3.x) < 0.85 && v3.y > -0.9 && v3.y < 0.3)) continue;
          let ok = true;
          const L = Math.hypot(px2 - cx, pz2 - cz);
          for (let t = 0.04; t < 0.98 && ok; t += 12 / L) if (world.heightAt(cx + (px2 - cx) * t, cz + (pz2 - cz) * t) > c.ch + (py2 - c.ch) * t) ok = false;
          if (ok) vis++;
        }
        if (vis < VP.length * 0.2) continue;
        // the ranges stand well back at the horizon line, no near wall across the middle of the frame
        let far = 0;
        for (const sx of [-0.25, 0, 0.25]) for (const sy of [0.33, 0.45]) { n2.set(sx, sy); rc.setFromCamera(n2, cam); if (march(rc.ray.origin, rc.ray.direction) > 4000) far++; }
        // (the valley's axis runs north: a lens turned across it looks at the far wall rather than up the valley)
        c.score = far * 1.2 + vis / VP.length * 12 - Math.abs(lip - 3) * 0.2 - 4 * Math.max(0, Math.abs(az - Math.PI) - 0.5);
        c.vis = vis; c.far = far;
        cands.push(c);
      }
    }
    cands.sort((p, q) => q.score - p.score);
    // a spot for the homestead in the lower middle of the frame, close enough to read as buildings (the
    // reference's cluster spans about a tenth of the frame: ~180 m out); the yard is levelled into the slope
    const homeSpot = () => {
      // the ledge's own rim across the lower middle: the homestead must stand clear above it
      let rim = -0.95;
      for (let sy = -0.95; sy < 0.0; sy += 0.03) { n2.set(0, sy); rc.setFromCamera(n2, cam); if (march(rc.ray.origin, rc.ray.direction, 120) > 100) { rim = sy; break; } }
      let hb = null, hs = -1e9;
      for (let sx = -0.36; sx <= 0.37; sx += 0.04) for (let sy = Math.max(-0.7, rim + 0.07); sy <= -0.15; sy += 0.03) {
        n2.set(sx, sy); rc.setFromCamera(n2, cam);
        const t = march(rc.ray.origin, rc.ray.direction, 950);
        if (t < 120 || t > 900) continue;
        const x = rc.ray.origin.x + rc.ray.direction.x * t, z = rc.ray.origin.z + rc.ray.direction.z * t, h = world.heightAt(x, z), ny = world.normalAt(x, z).y;
        if (ny < 0.75 || world.climateAt(x, z).snow < 0.5 || h < 3 || world.splatAt(x, z).wet > 0.2) continue;
        const sc = -Math.abs(sx - 0.04) * 2 - Math.abs(sy + 0.3) * 3 - Math.abs(t - 260) * 0.004 - (1 - ny) * 6;
        if (sc > hs) { hs = sc; hb = [x, z]; }
      }
      return [hb, hs];
    };
    // and the lookout's own rock to the left of the lens, as the reference's outcrop: the lens is nudged about the
    // summit (a few metres aside or back) until there is ground near it on the left
    let best = null, bs = -1e9;
    for (const c0 of cands.slice(0, 60)) {
      const fx = Math.sin(c0.az), fz = Math.cos(c0.az), rx = -fz, rz = fx;
      for (const side of [0, -4, 4, -8, 8, -12]) for (const back of [0, -6, -12]) {
        const cx = c0.cx + rx * side + fx * back, cz = c0.cz + rz * side + fz * back;
        const c = { ...c0, cx, cz, ch: world.heightAt(cx, cz) + 4.2 };   // (standing on the ledge's highest block: lower, the summit's own flat filled the bottom of the frame)
        frame(c);
        let open = true;
        for (const sx of [-0.25, 0, 0.25]) { n2.set(sx, -0.42); rc.setFromCamera(n2, cam); if (march(rc.ray.origin, rc.ray.direction, 200) < 160) { open = false; break; } }
        if (!open) continue;
        n2.set(-0.95, -0.72); rc.setFromCamera(n2, cam);
        const leftRock = march(rc.ray.origin, rc.ray.direction, 30) < 30 ? 1 : 0;
        const [hb, hs] = homeSpot();
        const sc = c.score + leftRock * 2.5 + (hb ? 3 + hs : 0) - (Math.abs(side) + Math.abs(back)) * 0.02;
        (G.vistaDbg = G.vistaDbg || []).push([+sc.toFixed(2), Math.round(cx), Math.round(cz), +c.az.toFixed(2), +c.score.toFixed(2), c.vis, c.far, leftRock, hb ? +hs.toFixed(2) : null]);
        if (sc > bs) { bs = sc; best = { ...c, home: hb }; }
      }
    }
    if (!best) {
      // no bench in shot: fall back to looking over the trapper's own cabin
      const c = cands[0] || { cx: CABIN.x + 260, cz: CABIN.z + 320, ch: world.heightAt(CABIN.x + 260, CABIN.z + 320) + 3.2, az: Math.atan2(-260, -320) };
      best = { ...c, home: null };
    }
    const D = 1200, lx = best.cx + Math.sin(best.az) * D, lz = best.cz + Math.cos(best.az) * D;
    // the homestead turned three-quarters on to the lens
    const home = best.home && [best.home[0], best.home[1], Math.atan2(best.cx - best.home[0], best.cz - best.home[1]) + 0.55];
    G.vistaCache = { cx: best.cx, cz: best.cz, ch: best.ch, tx: lx, tz: lz, th: best.ch + Math.tan(PITCH) * D - world.heightAt(lx, lz), home, n: cands.length };
    return G.vistaCache;
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
        // the frozen creek winding away through the middle of the lens's view, 40-220 m out, leading the eye up the
        // valley as in the reference (the lens looks 0.56 rad left of the horse's heading)
        let creek = 0;
        const va = a + 0.56;
        for (let d = 40; d <= 220; d += 20) for (const b of [-0.18, 0, 0.18]) if (world.splatAt(x + Math.sin(va + b) * d, z + Math.cos(va + b) * d).wet > 0.4) { creek++; break; }
        const score = sides - ahead * 0.8 + creek * 45;
        if (score > bs && G.treesNear(x, z, 6) === 0 && G.treesNear(x - f[0] * 6, z - f[1] * 6, 5) === 0) { bs = score; best = [x, z, a]; }
      }
    }
    return best;
  };
  // the nearest dry, level spot to a scouted position (a ride starts on open snow, not in a creek or on a boulder slope)
  G.clearNear = (x0, z0, yaw) => {
    for (let r = 0; r < 120; r += 6) for (let a = 0; a < 6.28; a += 0.52) {
      const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      if (world.normalAt(x, z).y > 0.97 && world.splatAt(x, z).wet < 0.1 && world.climateAt(x, z).snow > 0.7) return [x, z, yaw];
      if (r === 0) break;
    }
    return null;
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
    player.horse.setCoat(s.coat || 'bay');
    player.horse.pose = s.stride ?? null;
    player.hspeed = s.gallop ? 13 : 0;
    G.forceGallop = !!s.gallop;
    G.camOverride = null;
    G.weatherOverride = s.weather && typeof s.weather === 'object' ? s.weather : null;
    // a shot's own air and exposure (thick lit dust under a closed stand washes out open country, so it is asked for)
    G.volDensity = s.volDensity; G.volFalloff = s.volFalloff; G.expK = s.expK; G.keyShaft = s.keyShaft || 0;
    if (s.cam) {
      const [cx, cy, cz, ch] = s.cam, [lx, ly, lz, lh] = s.look;
      G.camOverride = { pos: new THREE.Vector3(cx, world.heightAt(cx, cz) + ch, cz), look: new THREE.Vector3(lx, world.heightAt(lx, lz) + lh, lz), fov: s.fov };
      if (s.clearView) { G.clearTreesNear(cx, cz, 30); G.clearTreesNear(cx, cz, 9, veg.bushes); G.clearTreesAlong(cx, cz, lx, lz, 16, 0.15); }
    } else if (s.camRel) {
      const rel = s.camRel.slice();
      if (s.water) {
        // put the camera over open water, on whichever side of the horse is deeper
        const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const hp = world.heightAt(px + r.x * rel[0], pz + r.z * rel[0]), hm = world.heightAt(px - r.x * rel[0], pz - r.z * rel[0]);
        if (hm < hp) rel[0] = -rel[0];
      }
      // turn: the horse heads off at an angle to the lens, so its neck and head show beside the rider
      G.camOverride = { rel, lookRel: s.lookRel, turn: s.turn || 0, fov: s.fov };
      // keep the lens clear: no boughs between the camera and the rider
      const cy = yaw - (s.turn || 0);
      const f = [Math.sin(cy), Math.cos(cy)], rt = [Math.cos(cy), -Math.sin(cy)];
      const camX = px + rt[0] * rel[0] + f[0] * rel[2], camZ = pz + rt[1] * rel[0] + f[1] * rel[2];
      G.clearTreesNear(camX, camZ, 5);
      G.clearTreesNear(camX, camZ, 9, veg.rocks);   // and no boulder half-in the lens
      G.clearTreesNear(camX, camZ, 30, veg.crags);
      G.clearTreesAlong(camX, camZ, px, pz, 2.5);
    }
    // trailside anchors, as a set dresser would place them: a mossy boulder and a fallen trunk off the left verge,
    // ferns and scrub around them
    // the reference's snowfield: dark boulders half-buried in drift and frosted sage in loose groups either side
    // of the open ground ahead, thinning toward the line the rider is taking
    if (s.snowDress && !G.snowDressed) {
      G.snowDressed = true;
      // The ground itself, built as a set before anything is stood on it (what already grows there is lifted with
      // it): wind drifts over the open floor; a rock-walled bench on the left of the lens with timber on its top,
      // the reference's dark cliff band; and a frozen creek winding away up the middle of the view.
      {
        const cy = yaw - (s.turn || 0), f = [Math.sin(cy), Math.cos(cy)], lt = [Math.cos(cy), -Math.sin(cy)];
        const P = (ahead, side) => [px + f[0] * ahead + lt[0] * side, pz + f[1] * ahead + lt[1] * side];
        const layers = [veg.trees, veg.bushes, veg.rocks, veg.crags, veg.logs];
        const near = (it) => (it.x - px) ** 2 + (it.z - pz) ** 2 < 1300 * 1300;
        const before = layers.map((L) => L.items.filter(near).map((it) => [it, world.heightAt(it.x, it.z)]));
        // the rider on the brow of a low rise, the floor falling gently away ahead of him (from a hollow the ground
        // in front hid the whole middle distance)
        {
          const [m0x, m0z] = P(-40, 0), [m1x, m1z] = P(6, 0), mh = world.heightAt(px, pz) + 6.5;
          world.raiseSpur(m0x, m0z, mh - 0.5, m1x, m1z, mh, { side: 0.11, round: 0.0005, top: 16, flat0: 12, reach: 170, rough: 0.25, sag: 0 });
        }
        world.sculptDrifts(px + f[0] * 90, pz + f[1] * 90, 240, 1.5);   // (deep enough to see under an overcast)
        const [b0x, b0z] = P(62, 50), [b1x, b1z] = P(215, 66);
        const bh = Math.max(world.heightAt(b0x, b0z), world.heightAt(b1x, b1z)) + 30;
        world.raiseSpur(b0x, b0z, bh, b1x, b1z, bh + 6, { side: 1.5, round: 0, top: 26, flat0: 20, reach: 80, rough: 1.4, sag: 0 });
        // its face cut into rock risers and snow ledges, as the reference's cliff band is (a single smooth ramp shaded
        // as one dark hump, whatever was stood against it)
        // (only for the bare slope: with the face built of outcrops the cut ledges showed at its foot as a flat pale strip)
        if (params.has('nocliff')) world.ledgeBox(Math.min(b0x, b1x) - 90, Math.min(b0z, b1z) - 90, Math.max(b0x, b1x) + 90, Math.max(b0z, b1z) + 90, 7.5);
        G.benchBox = [Math.min(b0x, b1x) - 90, Math.min(b0z, b1z) - 90, Math.max(b0x, b1x) + 90, Math.max(b0z, b1z) + 90];
        // The middle distance. The canyon's own walls stand a kilometre off, pale in the falling snow, with nothing
        // between them and the lens. The reference's valley is closed in by spurs coming down from either side one
        // behind another, dark rock on their flanks and timber along their crests, each a tone paler than the last.
        // Three are raised here: left at 330 m, right at 560 m, left again at 820 m.
        const spurs = [[520, 520, 190, 330, 115, 26], [770, -560, 240, 560, -95, 30], [1060, 600, 270, 830, 70, 42]].map(([a0, s0, h0, a1, s1, h1]) => {
          const [ax2, az2] = P(a0, s0), [bx2, bz2] = P(a1, s1), fl = world.heightAt(px, pz);
          world.raiseSpur(ax2, az2, fl + h0, bx2, bz2, fl + h1, { side: 1.05, round: 0.0005, top: 16, flat0: 9, reach: 330, rough: 3.2, sag: 0 });
          return [ax2, az2, bx2, bz2];
        });
        const creek = [];
        for (let k = 0; k <= 14; k++) { const a = 38 + k * 30; creek.push(P(a, -19 - 13 * Math.sin(k * 0.62) * Math.min(1, k / 2) - k * 0.3)); }   // (right of the rider, as the reference's: dead ahead he hides it)
        world.paintCreek(creek, 6.5, 0.9);
        G.snowCreek = creek;
        for (const list of before) for (const [it, h0] of list) it.y += world.heightAt(it.x, it.z) - h0;
        // (and no loose boulders left hanging on the bench's face: lifted with it, each sat on the cliff like a brick stuck on)
        // (anything standing above the floor goes: on a cut ledge a boulder's own ground is level, so slope does not find it)
        for (const L of [veg.rocks, veg.crags]) { const [x0, z0, x1, z1] = G.benchBox, flr = world.heightAt(px, pz) + 3, onFace = (it) => it.x > x0 && it.x < x1 && it.z > z0 && it.z < z1 && world.heightAt(it.x, it.z) > flr; for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !onFace(it))); L.items = L.items.filter((it) => !onFace(it)); }
        // nothing left standing in the creek's bed
        for (const L of [veg.trees, veg.rocks, veg.bushes]) { const wetIt = (it) => near(it) && world.splatAt(it.x, it.z).wet > 0.35; for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !wetIt(it))); L.items = L.items.filter((it) => !wetIt(it)); }
        // the bench's wall: broken rock standing along its face, and spruce along its rim
        let sd2 = 77;
        const r2 = () => ((sd2 = (sd2 * 16807) % 2147483647) / 2147483647);
        // (in three tiers from foot to rim, standing proud of the face and close enough to hide the ground behind them:
        // buried in the slope, each showed one flat side like a panel let into a smooth dome)
        // (now only talus at the foot: the face itself is rock)
        // (round 82) The face is built of rock again, now that the big outcrops are weathered masses with level tops and
        // joints drawn on them: three tiers of them stood up the bench's face from foot to rim, shoulder to shoulder,
        // each tier's tops carrying snow. The slope alone, however it is shaded, is a smooth ramp with ledges painted on.
        if (!params.has('nocliff')) {
          const flr = world.heightAt(px, pz), big = [6, 7, 8];
          for (let a = 40; a <= 240; a += 8 + r2() * 4) {
            // the face at this station: where the ground leaves the floor, and where it reaches the rim
            let foot = null, rim = null;
            for (let sd3 = 4; sd3 < 90; sd3 += 1.5) { const [x, z] = P(a, sd3), h = world.heightAt(x, z) - flr; if (foot === null && h > 2.5) foot = sd3; if (h > bh - flr - 4) { rim = sd3; break; } }
            if (foot === null || rim === null) continue;
            for (const [t, s0, s1] of [[0.02, 13, 5], [0.28, 13, 5], [0.54, 12, 5], [0.8, 11, 4]]) {
              const sd3 = foot + (rim - foot) * t + (r2() - 0.5) * 3, [x, z] = P(a + (r2() - 0.5) * 6, sd3), sc = (s0 + r2() * s1) * Math.min(1, 0.62 + a / 260);   // (a little smaller toward the lens: full size, the nearest stood over the frame)
              veg.rocks.add(x, world.heightAt(x, z) - 0.2 * sc, z, r2() * 6.28, sc, big[Math.floor(r2() * 3)]);
            }
          }
          G.cliffBuilt = true;
        }
        for (const [out, s0, s1, lift] of []) for (let a = 50; a <= 230; a += 9 + r2() * 14) {
          const side = 50 + (a - 62) * 0.105 - out - r2() * 2.5, [x, z] = P(a, side), sc = s0 + r2() * s1;
          veg.crags.add(x, world.heightAt(x, z) - sc * (0.93 - lift), z, r2() * 6.28, sc, Math.floor(r2() * 3));
        }
        // willow and dead brush crowding the creek's banks in clumps, and stones along its edge: from the saddle it is
        // the dark broken line of the banks that draws the creek across the snow
        for (let k = 0; k < creek.length - 1; k++) {
          const [ax, az] = creek[k], [bx, bz] = creek[k + 1], L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / L, nz = (bx - ax) / L;
          for (let t = 0; t < 1; t += 5 / L) for (const sgn of [-1, 1]) {
            if (r2() > 0.62) continue;
            const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
            for (let q = 0, nq = 1 + Math.floor(r2() * 4); q < nq; q++) {
              const off = sgn * (7.5 + r2() * 4.5), x = cx + nx * off + (r2() - 0.5) * 3, z = cz + nz * off + (r2() - 0.5) * 3;
              veg.bushes.add(x, world.heightAt(x, z) - 0.06, z, r2() * 6.28, 0.6 + r2() * 0.9, [7, 8, 7, 8, 9][Math.floor(r2() * 5)]);
            }
            if (r2() < 0.18) { const off = sgn * (6.5 + r2() * 2.5), x = cx + nx * off, z = cz + nz * off, sc = 0.7 + r2() * 1.3; veg.rocks.add(x, world.heightAt(x, z) - 0.45 * sc, z, r2() * 6.28, sc, 2 + Math.floor(r2() * 2)); }
          }
        }
        // timber along the spurs' crests and down their gentler ground, ragged pines among the spruce
        {
          const firs2 = veg.groups.fir, tl2 = veg.groups.tall;
          if (firs2.length) for (const [ax2, az2, bx2, bz2] of spurs) for (let i = 0; i < 150; i++) {
            const t = r2(), off = (r2() - 0.5) * 2 * (25 + 150 * r2());
            const dx2 = bx2 - ax2, dz2 = bz2 - az2, L2 = Math.hypot(dx2, dz2), x = ax2 + dx2 * t - dz2 / L2 * off, z = az2 + dz2 * t + dx2 / L2 * off;
            if (world.normalAt(x, z).y < 0.72 || world.splatAt(x, z).wet > 0.3) continue;
            const old = tl2.length && r2() < 0.3;
            veg.trees.add(x, world.heightAt(x, z) - 0.3, z, r2() * 6.28, old ? 0.45 + r2() * 0.5 : 0.4 + r2() * r2() * 1.3, old ? tl2[Math.floor(r2() * tl2.length)] : firs2[Math.floor(r2() * firs2.length)]);
          }
        }
        const firs = veg.groups.fir;
        if (firs.length) for (let i = 0; i < 26; i++) {
          const a = 58 + r2() * 165, [x, z] = P(a, 50 + (a - 62) * 0.105 - 14 + r2() * 30);
          veg.trees.add(x, world.heightAt(x, z) - 0.3, z, r2() * 6.28, 0.5 + r2() * 1.0, firs[Math.floor(r2() * firs.length)]);
        }
      }
      {
        const sn = new Set(veg.groups.snag), L = veg.trees, near = (it) => sn.has(it.v) && Math.hypot(it.x - px, it.z - pz) < 400;
        for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !near(it)));
        L.items = L.items.filter((it) => !near(it));
      }
      const cy = yaw - (s.turn || 0);
      const f = [Math.sin(cy), Math.cos(cy)], lt = [Math.cos(cy), -Math.sin(cy)];
      let sd = 191;
      const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let gi = 0; gi < 18; gi++) {
        const ahead = 14 + rr() * 90, side = (rr() < 0.5 ? -1 : 1) * (6 + ahead * 0.25 + rr() * 24);
        const gx = px + f[0] * ahead + lt[0] * side, gz = pz + f[1] * ahead + lt[1] * side;
        const n = 2 + Math.floor(rr() * 4);
        for (let k = 0; k < n; k++) {
          // (boulders a metre or two through, bedded deep, each under its cap of snow: the reference's dark shapes
          // in the snowfield, not pebbles)
          const x = gx + (rr() - 0.5) * 9, z = gz + (rr() - 0.5) * 9, sc = (k === 0 ? 2.2 : 0.8) + rr() * 1.6;
          veg.rocks.add(x, world.heightAt(x, z) - 0.5 * sc, z, rr() * 6.28, sc, 2 + Math.floor(rr() * 2));
        }
        // brush in a tight clump against the rocks' lee side, not sprinkled
        for (let k = 0; k < 9; k++) { const a = rr() * 6.28, d = 1.5 + rr() * rr() * 6, x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d; veg.bushes.add(x, world.heightAt(x, z) - 0.05, z, rr() * 6.28, 0.55 + rr() * 0.7, [7, 8, 7, 9][Math.floor(rr() * 4)]); }
      }
      // the midground the reference's valley is built from: split granite outcrops breaking the snow either side
      // of the open lane, and clusters of snow-laden spruce of mixed sizes stepping back up the valley
      // (none now: the bench's cliff and the spurs are the valley's rock, and these jointed blocks, standing alone on
      // the snow, were pale boxes)
      for (let gi = 0; gi < 0; gi++) {
        // (inside the lens's field: at 40-170 m out a crag 40 m aside was already past the frame edge)
        const ahead = 40 + rr() * 130, side = (gi % 2 ? 1 : -1) * (9 + ahead * 0.12 + rr() * 18);
        const x = px + f[0] * ahead + lt[0] * side, z = pz + f[1] * ahead + lt[1] * side, sc = 2.5 + rr() * 4.5;
        veg.crags.add(x, world.heightAt(x, z) - sc * 0.45, z, rr() * 6.28, sc, Math.floor(rr() * 3));
      }
      // the near snowfield: frosted sage and small rocks poking through out to forty metres, either side of the
      // horse's line (the lower half of the frame was one blank plane)
      for (let i = 0; i < 26; i++) {
        const ahead = 6 + rr() * 34, side = (rr() < 0.5 ? -1 : 1) * (3.5 + rr() * (6 + ahead * 0.55));
        const x = px + f[0] * ahead + lt[0] * side, z = pz + f[1] * ahead + lt[1] * side, gh = world.heightAt(x, z);
        if (rr() < 0.3) veg.rocks.add(x, gh - 0.25, z, rr() * 6.28, 0.3 + rr() * 0.6, 2 + Math.floor(rr() * 2));
        else for (let k = 0; k < 1 + Math.floor(rr() * 3); k++) { const bx = x + (rr() - 0.5) * 2, bz = z + (rr() - 0.5) * 2; veg.bushes.add(bx, world.heightAt(bx, bz) - 0.08, bz, rr() * 6.28, 0.4 + rr() * 0.5, [7, 8, 9][Math.floor(rr() * 3)]); }
      }
      // and a few dead snags among the living stands, as the reference's valley has
      const snags = veg.groups.snag;
      // (no bare snags here: tall and limbless against the snow they read as telephone poles)
      if (snags.length) for (let i = 0; i < 0; i++) {
        const ahead = 30 + rr() * 110, side = (rr() < 0.5 ? -1 : 1) * (10 + ahead * 0.25 + rr() * 25);
        const x = px + f[0] * ahead + lt[0] * side, z = pz + f[1] * ahead + lt[1] * side;
        veg.trees.add(x, world.heightAt(x, z) - 0.3, z, rr() * 6.28, 0.6 + rr() * 0.5, snags[Math.floor(rr() * snags.length)]);
      }
      const firs = veg.groups.fir;
      if (firs.length) for (let gi = 0; gi < 12; gi++) {
        // (out toward the sides: a clump in the middle walled off the valley's vanishing point)
        const ahead = 40 + rr() * 150, side = (rr() < 0.5 ? -1 : 1) * (20 + ahead * 0.38 + rr() * 30);
        const gx = px + f[0] * ahead + lt[0] * side, gz = pz + f[1] * ahead + lt[1] * side;
        for (let k = 0, n = 2 + Math.floor(rr() * 5); k < n; k++) {
          const x = gx + (rr() - 0.5) * 16, z = gz + (rr() - 0.5) * 16;
          // (tall, ragged pines of every height among the spruce, not one cone model over and over)
          const tl = veg.groups.tall, old = tl.length && rr() < 0.45;
          veg.trees.add(x, world.heightAt(x, z) - 0.3, z, rr() * 6.28, old ? 0.45 + rr() * 0.55 : 0.3 + rr() * rr() * 1.6, old ? tl[Math.floor(rr() * tl.length)] : firs[Math.floor(rr() * firs.length)]);
        }
      }
      // (round 83) Timber on the valley's sides, stepping back into the snowfall: stands and single trees of every height
      // scattered up both walls from 120 m out to a kilometre, thicker in the gullies, with old ragged pines among the
      // spruce. One row of spruce along one contour was a hedge, and gave the walls behind it no size.
      if (firs.length) {
        const tl = veg.groups.tall, n3 = world.n3;
        let sdt = 5501;
        const rt3 = () => ((sdt = (sdt * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 5200; i++) {
          const ahead = 110 + rt3() * rt3() * 1100, side = (rt3() - 0.5) * 2 * (60 + ahead * 0.75);
          if (Math.abs(side) < 26 + ahead * 0.06) continue;   // the open lane up the floor
          const x = px + f[0] * ahead + lt[0] * side, z = pz + f[1] * ahead + lt[1] * side;
          const mass = n3.noise(x / 140 + 3.1, z / 140 - 7.7) + 0.5 * n3.noise(x / 45 - 1.2, z / 45 + 4.4);
          if (rt3() > 0.25 + 0.75 * Math.min(1, Math.max(0, (mass + 0.25) / 0.5))) continue;
          const nrm = world.normalAt(x, z);
          if (nrm.y < 0.58 || world.splatAt(x, z).wet > 0.3) continue;
          const old = tl.length && rt3() < 0.28;
          veg.trees.add(x, world.heightAt(x, z) - 0.3, z, rt3() * 6.28, old ? 0.45 + rt3() * 0.5 : 0.55 + rt3() * rt3() * 1.5, old ? tl[Math.floor(rt3() * tl.length)] : firs[Math.floor(rt3() * firs.length)]);
        }
      }
      // half-buried boulders under caps of snow in the near field, either side of the horse's line: the dark shapes the
      // reference's snowfield is broken with
      {
        let sdb = 6311;
        const rb2 = () => ((sdb = (sdb * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 12; i++) {
          const ahead = 7 + rb2() * 40, side = (i % 2 ? -1 : 1) * (3.5 + ahead * 0.22 + rb2() * (4 + ahead * 0.3));
          const x = px + f[0] * ahead + lt[0] * side, z = pz + f[1] * ahead + lt[1] * side, sc = 0.7 + rb2() * rb2() * 1.6;
          veg.rocks.add(x, world.heightAt(x, z) - 0.2 * sc, z, rb2() * 6.28, sc * 1.25, 4 + Math.floor(rb2() * 2));   // (standing well out of the snow, dark-sided: sunk to their caps they were white on white)
        }
      }
      // and single old pines standing out on the floor at every distance, dark boles and ragged crowns against the
      // snow: they are what gives the middle ground its depth
      {
        const tl = veg.groups.tall;
        let sdl = 811;
        const rl2 = () => ((sdl = (sdl * 16807) % 2147483647) / 2147483647);
        if (tl.length) for (let i = 0; i < 16; i++) {
          const ahead = 45 + rl2() * 260, side = (rl2() < 0.5 ? -1 : 1) * (9 + ahead * 0.07 + rl2() * (10 + ahead * 0.3));
          const x = px + f[0] * ahead + lt[0] * side, z = pz + f[1] * ahead + lt[1] * side;
          if (world.splatAt(x, z).wet > 0.3 || world.normalAt(x, z).y < 0.8) continue;
          veg.trees.add(x, world.heightAt(x, z) - 0.3, z, rl2() * 6.28, 0.42 + rl2() * 0.4, tl[Math.floor(rl2() * tl.length)]);
        }
      }
      // (the boulder groups above are thrown wide enough to land on the bench: taken off its face again)
      if (G.benchBox) {
        const [x0, z0, x1, z1] = G.benchBox, flr = world.heightAt(px, pz) + 3;
        const onFace = (it) => it.x > x0 && it.x < x1 && it.z > z0 && it.z < z1 && world.heightAt(it.x, it.z) > flr && !(it.s > 9 && it.v >= 6);   // (the cliff's own outcrops stay)
        for (const L of [veg.rocks, veg.crags, veg.bushes]) {
          for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !onFace(it)));
          L.items = L.items.filter((it) => !onFace(it));
        }
      }
      veg.update(player.hpos, true);
    }
    if (s.trailDress && !G.trailDressed) {
      G.trailDressed = true;
      // the reference's trail runs between tall high-crowned trunks with scrub at their feet: no full-skirted young
      // fir walling it in near the lens, and nothing standing between the lens and the rider
      {
        const firs = new Set(veg.groups.fir), L = veg.trees;
        const near = (it) => firs.has(it.v) && Math.hypot(it.x - px, it.z - pz) < 34;
        for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !near(it)));
        L.items = L.items.filter((it) => !near(it));
        const cy = yaw - (s.turn || 0), rel = s.camRel;
        const camX = px + Math.cos(cy) * rel[0] + Math.sin(cy) * rel[2], camZ = pz - Math.sin(cy) * rel[0] + Math.cos(cy) * rel[2];
        // and the trail runs on from the lens as an open corridor into the light: no crown standing across the
        // vanishing point (a full fir on the outside of the bend had walled the sun and the distance off)
        G.clearTreesAlong(camX, camZ, camX + Math.sin(cy) * 90, camZ + Math.cos(cy) * 90, 2.2);
        const B = veg.bushes, dx = px - camX, dz = pz - camZ, L2 = dx * dx + dz * dz;
        const inLine = (it) => { const t = Math.max(0, Math.min(1.3, ((it.x - camX) * dx + (it.z - camZ) * dz) / L2)); return Math.hypot(camX + dx * t - it.x, camZ + dz * t - it.z) < 1.6 + it.s; };
        for (const [k, list] of B.grid) B.grid.set(k, list.filter((it) => !inLine(it)));
        B.items = B.items.filter((it) => !inLine(it));
      }
      // The light. The reference's floor is a patchwork of hard, warm sun and cool shade, and its shafts stand between
      // the trunks with dark air between them. A low sun reaches the floor only down a lane open towards it, so, as a
      // forester's eye would pick the spot: a lane lies open from the rider towards the sun, and the stand round about
      // is an old, open one with gaps (a third of the trees within eighty metres are gone, whole and at random).
      {
        sky.time = s.time; sky.update(0, camera.position);
        const sd = U.uSunDir.value, sl = Math.hypot(sd.x, sd.z) || 1, sx = sd.x / sl, sz = sd.z / sl;
        // (no lane cut toward the sun: under a high sun the crowns over the trail are what dapple the floor)
        const L = veg.trees, gap = (it) => { const d2 = (it.x - px) ** 2 + (it.z - pz) ** 2; if (d2 > 6400 || d2 < 36) return false; const h = Math.sin(it.x * 12.9898 + it.z * 78.233) * 43758.5453; return h - Math.floor(h) < 0.16; };
        for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !gap(it)));
        L.items = L.items.filter((it) => !gap(it));
        // the fern beds give way to low leafy scrub and bunchgrass near the trail (one big fern rosette repeated
        // everywhere read as a single prop stamped across the floor)
        for (const it of veg.bushes.items) {
          if ((it.v === 3 || it.v === 4) && (it.x - px) ** 2 + (it.z - pz) ** 2 < 2500) {
            const h = Math.sin(it.x * 39.346 + it.z * 11.135) * 24634.6345, q = h - Math.floor(h);
            if (q < 0.8) { it.v = q < 0.45 ? Math.floor(q / 0.15) : 9; it.s *= q < 0.45 ? 0.55 : 0.8; }
          }
        }
      }
      // (cos, -sin) points to the rider's left, so negative side offsets land on the right
      const f = [Math.sin(yaw), Math.cos(yaw)], lt = [Math.cos(yaw), -Math.sin(yaw)];
      const at = (ahead, side) => [px + f[0] * ahead - lt[0] * side, pz + f[1] * ahead - lt[1] * side];
      const [bx, bz] = at(9, -4.6); veg.rocks.add(bx, world.heightAt(bx, bz) - 0.5, bz, 1.1, 1.5, 1);
      const [lx, lz] = at(10.5, -6.5); veg.logs.add(lx, world.heightAt(lx, lz) - 0.05, lz, yaw + 1.25, 1.35, 0);
      const [rx, rz] = at(15, 5.2); veg.rocks.add(rx, world.heightAt(rx, rz) - 0.4, rz, 2.4, 1.1, 3);
      for (let i = 0; i < 14; i++) {
        const [ux, uz] = at(3 + i * 1.3, (i % 2 ? 1 : -1) * (2.4 + (i * 0.37) % 1.6));
        veg.bushes.add(ux, world.heightAt(ux, uz) - 0.05, uz, i * 1.3, 0.4 + (i % 3) * 0.14, i % 4 === 3 ? 7 : i % 4 === 1 ? 9 : i % 3);
      }
      // The floor (round 86). Seen from the saddle the reference's floor is never bare: leafy scrub to the knee and waist
      // in clumps, deadfall lying every few paces, stones half sunk in the duff. Ours had flat litter and a few tufts.
      // Set across the lens's field out to thirty metres, off the tread, as things with height that cast shadows.
      {
        const cyF = yaw - (s.turn || 0), cfF = [Math.sin(cyF), Math.cos(cyF)], clF = [Math.cos(cyF), -Math.sin(cyF)], relF = s.camRel || [0, 0, -5];
        const cxF = px + clF[0] * relF[0] + cfF[0] * relF[2], czF = pz + clF[1] * relF[0] + cfF[1] * relF[2];
        let sdF = 4243;
        const rF = () => ((sdF = (sdF * 16807) % 2147483647) / 2147483647);
        const spot = (fMin, fMax) => {
          for (let tries = 0; tries < 8; tries++) {
            const fwd = fMin + rF() * (fMax - fMin), lat = (rF() - 0.5) * 2 * (1.5 + fwd * 0.52);
            const x = cxF + cfF[0] * fwd + clF[0] * lat, z = czF + cfF[1] * fwd + clF[1] * lat;
            if (world.splatAt(x, z).road > 0.22 || Math.hypot(x - px, z - pz) < 2.2) continue;
            return [x, z];
          }
          return null;
        };
        for (let i = 0; i < 26; i++) {   // scrub
          const q = spot(4.5, 32); if (!q) continue;
          const big = rF() < 0.4;
          for (let k = 0, n = 3 + Math.floor(rF() * 3); k < n; k++) {
            const x = q[0] + (rF() - 0.5) * 1.5, z = q[1] + (rF() - 0.5) * 1.5;
            veg.bushes.add(x, world.heightAt(x, z) - 0.06, z, rF() * 6.28, (big ? 0.7 : 0.4) + rF() * 0.45, Math.floor(rF() * 3));
          }
        }
        for (let i = 0; i < 20; i++) {   // deadfall: limbs and poles a hand or two thick
          const q = spot(9, 34); if (!q) continue;   // (none under the lens: a snag a pace away was a row of spikes across the frame's corner)
          const sc = 0.2 + rF() * rF() * 0.34;
          veg.logs.add(q[0], world.heightAt(q[0], q[1]) + 0.1 * sc, q[1], rF() * 6.28, sc, Math.floor(rF() * 3));
        }
        for (let i = 0; i < 30; i++) {   // stones
          const q = spot(3.5, 28); if (!q) continue;
          const sc = 0.12 + rF() * rF() * 0.4;
          veg.rocks.add(q[0], world.heightAt(q[0], q[1]) - 0.3 * sc, q[1], rF() * 6.28, sc, Math.floor(rF() * 2));
        }
      }
      // two old pines standing close by the lens, one either side, their lower boughs hanging into the top of the
      // frame (the reference is framed under such boughs; ours had bare sky across the top)
      {
        const pines = veg.groups.pine, cy = yaw - (s.turn || 0), cf = [Math.sin(cy), Math.cos(cy)], cr = [Math.cos(cy), -Math.sin(cy)];
        const rel = s.camRel, camX = px + cr[0] * rel[0] + cf[0] * rel[2], camZ = pz + cr[1] * rel[0] + cf[1] * rel[2];
        // The stand itself, as the reference's: big old pines close on both sides of the trail, their boles bare for
        // ten metres and more, so that trunks run up out of the top of the frame, crowns close overhead, the sun comes
        // through between them in separate beams and their shadows lie in bars across the floor. (The scattered stand
        // has a tree every twelve metres or so, and the whole of each one sits inside the frame like a model.)
        const talls = veg.groups.tall;
        if (talls.length) for (const [fw, sd2, sc] of [[9, -5.6, 1.15], [15, -9.5, 1.3], [20, -4.4, 0.95], [28, -8, 1.2], [37, -5.2, 1.05], [47, -10.5, 1.25], [59, -6.2, 1.1], [72, -9, 1.2],
          [11, 5.2, 1.2], [18, 9, 1.0], [25, 4.6, 1.3], [34, 9.5, 1.1], [43, 5.6, 1.25], [53, 11.5, 1.0], [65, 6.8, 1.2], [78, 10, 1.1],
          [31, -15, 1.3], [44, -17, 1.1], [29, 16, 1.25], [48, 18, 1.15], [62, -16, 1.2], [70, 17, 1.3]]) {
          const x = camX + cf[0] * fw + cr[0] * sd2, z = camZ + cf[1] * fw + cr[1] * sd2;
          veg.trees.add(x, world.heightAt(x, z) - 0.25, z, fw * 2.3 + sd2, sc, talls[Math.abs(Math.round(fw + sd2)) % talls.length]);
        }
        // and full-crowned pines standing back among them, their lower boughs reaching across the top of the frame:
        // dark layered branches against the bright air, as the reference is roofed (bare poles alone ran up into fog)
        {
          const sdr = U.uSunDir.value, sl2 = Math.hypot(sdr.x, sdr.z) || 1;
        }
        // The canopy. The stand of tall boles alone had none in frame: their crowns begin fifteen metres up, and the
        // upper half of the picture was bare poles in haze. The reference's wood has needle boughs at every height,
        // dark against the light. So among the old boles stand full-crowned pines and spruce of every age, their
        // boughs coming down to head height, fifteen metres and more from the lens (nearer, a spray is plainly a
        // card), with the lane toward the sun left open between them. Inside a stand their crowns do not write the
        // shadow map, so they hang in the light without shutting it out.
        const firsC = veg.groups.fir;
        // (a few, standing back and to the sides: a dozen close in roofed the lane over, hid the shafts behind a wall of
        // green and took a stop and a half off the frame)
        if (pines.length) for (const [fw, sd2, sc, v] of [[30, 13, 1.15, 1], [26, -15, 1.45, 3], [38, 15, 1.5, 0], [44, -13, 1.35, 3], [54, -9, 1.6, 0], [58, 14, 1.4, 2], [66, -15, 1.55, 1], [72, 9, 1.5, 3]]) {
          const x = camX + cf[0] * fw + cr[0] * sd2, z = camZ + cf[1] * fw + cr[1] * sd2;
          veg.trees.add(x, world.heightAt(x, z) - 0.2, z, fw * 1.7, sc, pines[v % pines.length]);
        }
        if (firsC.length) for (const [fw, sd2, sc] of [[31, -10.5, 0.95], [36, 10, 0.7], [46, -18, 1.1], [50, 13, 0.9], [60, -12, 0.8], [68, 12, 1.0]]) {
          const x = camX + cf[0] * fw + cr[0] * sd2, z = camZ + cf[1] * fw + cr[1] * sd2;
          veg.trees.add(x, world.heightAt(x, z) - 0.25, z, fw * 2.9 + sd2, sc, firsC[Math.abs(Math.round(fw * 3 + sd2)) % firsC.length]);
        }
      }
      // the floor the reference rides through: drifts of knee-high shrub, fern and backlit bunchgrass either side of
      // the trail out to forty metres, in clumps with bare duff between, and young pines among them (the floor had
      // read as a bare plane with grass tufts stamped on it)
      {
        let sd = 4242;
        const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
        for (let gi = 0; gi < 26; gi++) {
          const ahead = 2 + rr() * 38, side = (rr() < 0.5 ? -1 : 1) * (4.6 + rr() * (5 + ahead * 0.5));   // (clear of the trail itself)
          const [gx, gz] = at(ahead, side), kind = rr();
          for (let k = 0, n = 3 + Math.floor(rr() * 6); k < n; k++) {
            const x = gx + (rr() - 0.5) * 4.5, z = gz + (rr() - 0.5) * 4.5;
            const v = kind < 0.72 ? Math.floor(rr() * 3) : kind < 0.9 ? 3 + Math.floor(rr() * 2) : 9;
            veg.bushes.add(x, world.heightAt(x, z) - 0.05, z, rr() * 6.28, (v === 9 ? 0.6 : v < 3 ? 0.4 : 0.5) + rr() * 0.45, v);
          }
        }
        // seedlings and low leafy plants scattered over the duff, a hand or two high (the reference's floor is green
        // with them in the shade between the grass)
        for (let i = 0; i < 130; i++) {
          const ahead = -3 + rr() * 30, side = (rr() < 0.5 ? -1 : 1) * (1.6 + rr() * rr() * 14);
          const [x, z] = at(ahead, side);
          veg.bushes.add(x, world.heightAt(x, z) - 0.02, z, rr() * 6.28, 0.07 + rr() * 0.09, Math.floor(rr() * 3));
        }
        // stones bedded in the verges, a few of them boulders, and fallen branches lying where they dropped
        for (let i = 0; i < 34; i++) {
          const [x, z] = at(-2 + rr() * 34, (rr() < 0.5 ? -1 : 1) * (1.5 + rr() * rr() * 12)), sc = 0.16 + rr() * rr() * 0.5;
          veg.rocks.add(x, world.heightAt(x, z) - 0.3 * sc, z, rr() * 6.28, sc, Math.floor(rr() * 2));
        }
        for (let i = 0; i < 14; i++) {
          const [x, z] = at(1 + rr() * 30, (rr() < 0.5 ? -1 : 1) * (2.2 + rr() * 11));
          veg.logs.add(x, world.heightAt(x, z) - 0.02, z, rr() * 6.28, 0.16 + rr() * 0.2, Math.floor(rr() * 3));
        }
        const pines = veg.groups.pine;
        if (pines.length) for (let i = 0; i < 5; i++) {
          const [x, z] = at(8 + rr() * 30, (rr() < 0.5 ? -1 : 1) * (5 + rr() * 12));
          veg.trees.add(x, world.heightAt(x, z) - 0.1, z, rr() * 6.28, 0.18 + rr() * 0.16, pines[Math.floor(rr() * pines.length)]);
        }
      }
      veg.update(player.hpos, true);
    }
    // a frosted rock outcrop at the camera's feet to anchor a vista, as a location artist would place one
    if (s.foreground && G.camOverride && G.camOverride.pos && !G.fgPlaced) {
      G.fgPlaced = true;
      const c = G.camOverride.pos, l = G.camOverride.look;
      // the lookout's own knob: the shoulder built up into a rock summit under the lens (what grows there lifted with it)
      if (G.vistaCache && G.vistaCache.knob && !G.knobBuilt) {
        G.knobBuilt = true;
        const kd = new THREE.Vector3(l.x - c.x, 0, l.z - c.z).normalize();
        const layers = [veg.trees, veg.bushes, veg.rocks, veg.crags, veg.logs];
        const nearK = (it) => (it.x - c.x) ** 2 + (it.z - c.z) ** 2 < 330 * 330;
        const before = layers.map((L) => L.items.filter(nearK).map((it) => [it, world.heightAt(it.x, it.z)]));
        world.raiseSpur(c.x - kd.x * 70, c.z - kd.z * 70, c.y - 2.2, c.x, c.z, c.y - 4.2, { side: 0.66, round: 0.0012, top: 9, flat0: 12, reach: 280, rough: 0.7, sag: 0 });
        for (const list of before) for (const [it, h0] of list) it.y += world.heightAt(it.x, it.z) - h0;
        // (the lens stands a man's height and a half above whatever the knob's top came out at)
        { const dy = world.heightAt(c.x, c.z) + 4.2 - c.y; c.y += dy; l.y += dy; }
        // (and no timber on the knob's own upper slopes: a summit of rock and snow; nor the brush, boulders and logs
        // that stood on the shoulder before, which would now sit against the lens)
        G.clearTreesNear(c.x, c.z, 64);
        G.clearTreesNear(c.x, c.z, 40, veg.bushes); G.clearTreesNear(c.x, c.z, 40, veg.rocks); G.clearTreesNear(c.x, c.z, 60, veg.logs);
      }
      // clear the lookout itself, as a location artist would
      G.clearTreesNear(c.x, c.z, 40);
      G.clearTreesNear(c.x, c.z, 60, veg.crags);       // no crag looming in front of the lens
      // the frame as the lens will see it
      camera.position.copy(c); camera.fov = s.fov || camera.fov; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      camera.lookAt(l); camera.updateMatrixWorld();
      const d0 = new THREE.Vector3(l.x - c.x, 0, l.z - c.z).normalize(), rt0 = new THREE.Vector3(-d0.z, 0, d0.x);
      // The homestead's knoll, as the reference has it: a spur running out from under the lookout and ending in a
      // broad top a couple of hundred metres off and some sixty metres below the lens, in the lower middle of the
      // frame a little right of centre, the valley dropping away behind it. Built as a set: the ground is raised
      // (only ever raised), what grows there is lifted with it, and the yard is levelled on its crown.
      if (!G.homePlaced) {
        G.homePlaced = true;
        // The valley's timber. The reference looks down on a valley whose floor and lower slopes are dark with
        // spruce up to a treeline, broken by open snowfields; ours had a thin scatter that read as specks on
        // white. As a forester would have it: closed stands planted over the whole view below the treeline, in
        // broad masses with meadows left between, the ground beneath them shaded as forest floor.
        {
          const firs = veg.groups.fir, n = world.n3;
          let sdf = 2027, added = 0;
          const rf = () => ((sdf = (sdf * 16807) % 2147483647) / 2147483647);
          // how thick the timber stands at a point: full below the treeline, thinning out through it, in broad
          // masses with meadows between
          // (in masses with crisp edges and open snow between, thick in the drainages and running up every gully, as
          // timber grows on a mountainside: thinned evenly it stood on the slopes as a sprinkle of dots)
          const SS = THREE.MathUtils.smoothstep;
          const stand = (x, z, h) => {
            const alt = 1 - SS(h + 40 * n.noise(x / 170, z / 170), 440, 585);
            if (alt <= 0) return 0;
            const mass = SS(n.noise(x / 300 + 11.3, z / 300 - 4.1) + 0.45 * n.noise(x / 95 - 2.7, z / 95 + 8.2), -0.3, -0.12);
            const lap = (world.heightAt(x + 18, z) + world.heightAt(x - 18, z) + world.heightAt(x, z + 18) + world.heightAt(x, z - 18)) / 4 - h;   // > 0 in a drainage
            return alt * Math.max(mass * (0.6 + 0.4 * SS(lap, -0.7, 0.8)), 0.95 * SS(lap, 0.7, 2.0));
          };
          // the base scatter's lone trees over the same ground are taken out: the stands are planted whole below
          {
            const L = veg.trees, wx = (it) => (it.x - c.x) * d0.x + (it.z - c.z) * d0.z, wr = (it) => (it.x - c.x) * rt0.x + (it.z - c.z) * rt0.z;
            const inWedge = (it) => { const f = wx(it); return f > 150 && f < 3700 && Math.abs(wr(it)) < 260 + f * 0.5; };
            for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !inWedge(it)));
            L.items = L.items.filter((it) => !inWedge(it));
          }
          // the ground under the stands first, as one continuous field (stamped round each tree it came out in blocks)
          for (let f = 150; f < 3700; f += 4) {
            const half = 260 + f * 0.5;
            for (let r = -half; r < half; r += 4) {
              const x = c.x + d0.x * f + rt0.x * r, z = c.z + d0.z * f + rt0.z * r;
              if (Math.abs(x) > HALF - 60 || Math.abs(z) > HALF - 60) continue;
              const D = stand(x, z, world.heightAt(x, z));
              // (set, not only raised: the survey's own forest tint, left where no stand is planted, lay on the open snow
              // as dark blotches)
              world.setForest(x, z, 2.2, D > 0.3 && world.normalAt(x, z).y > 0.45 ? Math.round(235 * THREE.MathUtils.smoothstep(D, 0.3, 0.62)) : 0);
            }
          }
          // (close-grown: at one tree to nine metres the stands were a third canopy and read as speckle)
          // (and grown timber, twenty metres and more: a floor of ten-metre saplings was a sprinkle of black spikes
          // under which the homestead's buildings stood like warehouses)
          if (firs.length) for (let f = 150; f < 3700; f += 5.8) {
            const half = 260 + f * 0.5;
            for (let r = -half; r < half; r += 5.8) {
              const jx = (rf() - 0.5) * 12, jz = (rf() - 0.5) * 12;   // (thrown well off the grid: half a cell's jitter left rows showing on thin slopes)
              const x = c.x + d0.x * (f + jx) + rt0.x * (r + jz), z = c.z + d0.z * (f + jx) + rt0.z * (r + jz), pick = rf(), sc = rf() * rf();
              if (Math.abs(x) > HALF - 60 || Math.abs(z) > HALF - 60) continue;
              const h = world.heightAt(x, z);
              // (closed canopy on the valley's floor and lower slopes, thinning with height to the treeline)
              const st = stand(x, z, h);
              if (world.climateAt(x, z).snow < 0.5 || pick > st * (0.5 + 0.48 * (1 - THREE.MathUtils.smoothstep(h, 320, 500)))) continue;
              const sp = world.splatAt(x, z);
              if (world.normalAt(x, z).y < 0.5 || sp.wet > 0.25 || sp.road > 0.2) continue;   // (spruce hold on ground too steep to walk)
              veg.trees.add(x, h - 0.3, z, pick * 62.8, 0.75 + sc * 1.9, firs[Math.floor(pick * 977) % firs.length]);   // (saplings to old giants)
              added++;
            }
          }
          world.touchSplat();
          G.vistaTimber = added;
        }
        // the river: the valley's creek widened to a frozen river winding down its floor, as the reference's (a
        // creek a few metres across cannot be seen from a summit)
        {
          const axis = world.valley.filter((q) => q[1] < c.z - 260 && q[1] > -4060).map((q) => [q[0], q[1]]).sort((p, q) => q[1] - p[1]);
          // (it meanders across the flat floor, as a river on a glacial flat does: laid on the survey's own thalweg it
          // ran as straight as a canal)
          const line = [];
          let run = 0;
          for (let k = 0; k < axis.length - 1; k++) {
            const [ax2, az2] = axis[k], [bx2, bz2] = axis[k + 1], L = Math.hypot(bx2 - ax2, bz2 - az2), nx = -(bz2 - az2) / L, nz = (bx2 - ax2) / L;
            for (let t = 0; t < 1; t += 36 / L) {
              const x0 = ax2 + (bx2 - ax2) * t, z0 = az2 + (bz2 - az2) * t, h0 = world.heightAt(x0, z0);
              let off = 62 * Math.sin((run + t * L) / 115) + 26 * Math.sin((run + t * L) / 47 + 1.3);
              while (Math.abs(off) > 4 && world.heightAt(x0 + nx * off, z0 + nz * off) > h0 + 3.5) off *= 0.6;   // (kept on the flat)
              line.push([x0 + nx * off, z0 + nz * off]);
            }
            run += L;
          }
          if (line.length > 2) {
            const xs = line.map((q) => q[0]), zs = line.map((q) => q[1]);
            world.eraseWet(Math.min(...xs) - 260, Math.min(...zs) - 40, Math.max(...xs) + 260, Math.max(...zs) + 40);
            world.paintCreek(line, 11, 1.2);
            for (const L of [veg.trees, veg.rocks]) { const wetIt = (it) => it.z < -1850 && world.splatAt(it.x, it.z).wet > 0.4; for (const [k, list] of L.grid) L.grid.set(k, list.filter((it) => !wetIt(it))); L.items = L.items.filter((it) => !wetIt(it)); }
          }
        }
        // (three hundred metres off: at two hundred the buildings were a third again the size of the reference's cabin)
        const KD = 300, kx = c.x + d0.x * KD + rt0.x * 48, kz = c.z + d0.z * KD + rt0.z * 48;
        const kTop = c.y - KD * Math.tan(0.12 + Math.atan(0.44 * Math.tan(THREE.MathUtils.degToRad((s.fov || 40) / 2))));
        const ax = c.x + d0.x * 34 + rt0.x * 10, az = c.z + d0.z * 34 + rt0.z * 10, aTop = Math.min(world.heightAt(ax, az) + 2, c.y - 24);
        const layers = [veg.trees, veg.bushes, veg.rocks, veg.crags, veg.logs];
        const R = 260, inBox = (it) => it.x > Math.min(ax, kx) - R && it.x < Math.max(ax, kx) + R && it.z > Math.min(az, kz) - R && it.z < Math.max(az, kz) + R;
        const before = layers.map((L) => L.items.filter(inBox).map((it) => [it, world.heightAt(it.x, it.z)]));
        // (a broad, level crown: on a narrow dome every tree round the yard stood on the flanks, below it and out of sight)
        if (kTop > world.heightAt(kx, kz)) world.raiseSpur(ax, az, aTop, kx, kz, kTop, { top: 50, side: 0.36, round: 0.0011 });   // (gentle flanks that hold their snow: steeper, the knoll stood on dark rock walls like a pedestal)
        for (const list of before) for (const [it, h0] of list) it.y += world.heightAt(it.x, it.z) - h0;
        world.stampPad(kx, kz, 27, 24);
        U.uSnowPad.value.set(kx, kz, 135, 1);
        const hr = Math.atan2(c.x - kx, c.z - kz) + 0.6;
        town.addHomestead(kx, kz, hr);
        // the yard trodden to dirty snow between the buildings, and a sled track leaving it down the back of the knoll
        {
          const K = (f, r) => [kx + d0.x * f + rt0.x * r, kz + d0.z * f + rt0.z * r];
          world.paintTrack([K(-6, -16), K(2, -4), K(-2, 10), K(6, 18)], 7);
          world.paintTrack([K(2, -4), K(26, 2), K(52, -8), K(84, 4), K(120, -6), K(170, 10), K(230, 0)], 2.4);
        }
        s.home = [kx, kz, hr];
        G.clearTreesNear(kx, kz, 38); G.clearTreesNear(kx, kz, 42, veg.rocks); G.clearTreesNear(kx, kz, 60, veg.crags); G.clearTreesNear(kx, kz, 30, veg.bushes);
        G.clearTreesAlong(c.x, c.z, kx, kz, 16, 0.9);
        // tall spruce standing round the yard, as the reference's homestead sits among its pines: a group either
        // side of the buildings and a stand behind, none between the lens and the roofs
        let sdk = 913;
        const rk = () => ((sdk = (sdk * 16807) % 2147483647) / 2147483647);
        const firs = veg.groups.fir, talls = veg.groups.tall;
        const plant = (f, r, sc, tall) => {
          const x = kx + d0.x * f + rt0.x * r, z = kz + d0.z * f + rt0.z * r, list = tall && talls.length ? talls : firs;
          if (list.length) veg.trees.add(x, world.heightAt(x, z) - 0.3, z, rk() * 6.28, sc, list[Math.floor(rk() * list.length)]);
        };
        // (to scale with the cabin: at twice this size the buildings were toys under them)
        for (const [f, r, sc, tall] of [[6, -34, 1.5, 0], [-4, -40, 1.15, 0], [14, -44, 1.8, 0], [22, -30, 1.3, 0], [-10, -52, 0.9, 0],
          [2, 33, 1.7, 0], [12, 40, 1.25, 0], [-6, 44, 1.45, 0], [20, 30, 1.0, 0], [-14, 36, 0.8, 0],
          [36, -12, 1.6, 0], [42, 6, 1.9, 0], [34, 18, 1.2, 0], [48, -24, 1.4, 0], [52, 26, 1.1, 0], [30, 2, 0.9, 0]]) plant(f, r, sc * 1.35, tall);
        // and a broken ring of spruce on the crown itself, close round the buildings on three sides (open toward the lens)
        // (thick, of every height, a few old pines standing over them: a ring of thin spires round a bald top was a toy)
        for (let i = 0; i < 80; i++) {
          const a = rk() * 6.28, rr4 = 24 + rk() * 36, f = Math.cos(a) * rr4, r = Math.sin(a) * rr4;
          if (f < -4 && Math.abs(r) < 24) continue;
          plant(f, r, i % 6 === 0 ? 0.7 + rk() * 0.3 : 0.9 + rk() * rk() * 1.5, i % 6 === 0 ? 1 : 0);
        }
        // the knoll's own slopes broken with rock and brush, so it is ground and not an iced dome
        for (let i = 0; i < 70; i++) {
          const a = rk() * 6.28, rr3 = 30 + rk() * 55, x = kx + Math.cos(a) * rr3, z = kz + Math.sin(a) * rr3, gh = world.heightAt(x, z);
          if (rk() < 0.35) { const sc = 0.8 + rk() * 2.2; veg.rocks.add(x, gh - 0.4 * sc, z, rk() * 6.28, sc, 2 + Math.floor(rk() * 2)); }
          else for (let q = 0; q < 3; q++) { const bx = x + (rk() - 0.5) * 4, bz = z + (rk() - 0.5) * 4; veg.bushes.add(bx, world.heightAt(bx, bz) - 0.06, bz, rk() * 6.28, 0.6 + rk() * 0.9, [7, 8, 9][Math.floor(rk() * 3)]); }
        }
        for (let i = 0; i < 190; i++) {
          // and timber thick down the knoll's far and side slopes: the cabin nestles in dark spruce, as the reference's
          const a = rk() * 6.28, rr2 = 36 + rk() * 120, f = Math.cos(a) * rr2, r = Math.sin(a) * rr2;
          if (f < 6 && Math.abs(r) < 40 + Math.max(0, -f) * 0.25) continue;   // (the lens's sight of the yard kept clear)
          plant(f, r, 0.8 + rk() * 1.3, 0);
        }
        // (the stand's shaded-floor tint taken off the knoll and the sightline to it: left under cleared ground it lay on the
        // snow as dark blotches)
        for (let f = -150; f <= 150; f += 5) for (let r = -150; r <= 150; r += 5) if (f * f + r * r < 150 * 150) world.setForest(kx + f, kz + r, 3.2, 0);
        for (let t = 0; t <= 1; t += 0.012) world.setForest(c.x + (kx - c.x) * t, c.z + (kz - c.z) * t, 26, 0);
        world.touchSplat();
      }
      // and the light: the shot waits for a break in the deck to lie on the homestead and the ledge, with cloud
      // shade on the slopes beyond (the offset of the deck's shadow field is searched for that)
      if (s.home) {
        sky.time = s.time; sky.update(0, c);
        let bo = null, bs = -1e9, sdl = 4711;
        const rl = () => ((sdl = (sdl * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 400; i++) {
          const off = new THREE.Vector2(rl() * 40, rl() * 40);
          const home = cloudLight(s.home[0], c.y - 58, s.home[1], off), near = cloudLight(c.x + d0.x * 8, c.y, c.z + d0.z * 8, off);
          let far = 0;
          for (const [f, r] of [[900, -500], [1300, 300], [700, 600], [1800, -200], [2400, 500], [1500, -900]]) far += cloudLight(c.x + d0.x * f + rt0.x * r, c.y - 250, c.z + d0.z * f + rt0.z * r, off) / 6;
          const sc = home * 2 + near * 1.4 - Math.abs(far - 0.45) * 1.5;
          if (sc > bs) { bs = sc; bo = off; }
        }
        U.uCloudShadowOff.value.copy(bo);
      }
      const rc = new THREE.Raycaster(), n2 = new THREE.Vector2();
      // the ground under a point of the frame, within maxD metres of the lens
      const groundAt = (nx, ny, maxD) => {
        n2.set(nx, ny); rc.setFromCamera(n2, camera);
        const o = rc.ray.origin, r = rc.ray.direction;
        for (let t = 0.6; t < maxD; t += 0.2) { const x = o.x + r.x * t, z = o.z + r.z * t, g = world.heightAt(x, z); if (o.y + r.y * t <= g) return [x, g, z, t]; }
        return null;
      };
      let sd = 77;
      const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      // The lookout's own rock, set against the frame as the reference's: a split granite outcrop standing up the
      // left side from the bottom corner to above the middle, broken slabs along the bottom edge, and a boulder
      // shouldering in at the lower right; the lower middle is left open for the drop to the homestead. Each block is
      // given the point of the frame its crown should reach and how far off it stands, and is grown from the ground
      // under that point up to it.
      const block = (nx, ny, dist, rot, v = 5, wide = 1) => {
        n2.set(nx, ny); rc.setFromCamera(n2, camera);
        const r = rc.ray.direction, x = c.x + r.x * dist, z = c.z + r.z * dist, top = c.y + r.y * dist, g = world.heightAt(x, z);
        const sc = Math.min(11, Math.max(1.3, (top - g) / 0.62)) * wide;
        veg.rocks.add(x, Math.max(g - 0.14 * sc, top - 0.76 * sc), z, rot, sc, v);
        // frosted grass and dead brush rooted in the block's top and shoulders (bare, the outcrop was a quarry face)
        const by = Math.max(g - 0.14 * sc, top - 0.76 * sc) + 0.62 * sc;
        // (round 83: the blocks have level tops now, so what grows there stands on them instead of being buried in a
        // dome's shoulder: russet brush in low dense clumps and fine frosted tufts, a dozen or so to a block)
        for (let q = 0; q < 5; q++) {
          const a = rr() * 6.28, rad = (0.05 + rr() * 0.3) * sc, cx3 = x + Math.cos(a) * rad, cz3 = z + Math.sin(a) * rad, yy = by - 0.05 * sc - (rad / (0.35 * sc)) ** 2 * 0.1 * sc;
          // (tufts only on the blocks: the twig brush, seen from a pace away against the sky, was a white cut-out over a black hole)
          for (let k = 0; k < 5; k++) veg.bushes.add(cx3 + (rr() - 0.5) * 0.8, yy - 0.03, cz3 + (rr() - 0.5) * 0.8, rr() * 6.28, 0.14 + rr() * 0.14, 9);
        }
      };
      // the ledge itself: the summit's ground built out into a shoulder under the left-hand outcrop and a lower one
      // on the right, so the blocks stand on rock rather than hang over the drop
      {
        const P = (f, r, dy) => [c.x + d0.x * f + rt0.x * r, c.z + d0.z * f + rt0.z * r, c.y + dy];
        const [l0x, l0z, l0y] = P(1, -5.5, -3.2), [l1x, l1z, l1y] = P(12, -4.8, -4.6);
        world.raiseSpur(l0x, l0z, l0y, l1x, l1z, l1y, { side: 1.5, round: 0.02, top: 3.5, reach: 30, rough: 0.12, sag: 0 });
        const [r0x, r0z, r0y] = P(4, 5.5, -5.2), [r1x, r1z, r1y] = P(11, 6.5, -6.4);
        world.raiseSpur(r0x, r0z, r0y, r1x, r1z, r1y, { side: 1.5, round: 0.02, top: 3, reach: 30, rough: 0.12, sag: 0 });
      }
      // (the outcrop climbs the left edge to two-thirds of the frame's height and steps down toward the middle: lower,
      // the lens looked straight down on the timbered slope below it, every tree a dot on white)
      for (const b of [[-1.0, 0.56, 7.2, 5.1, 7, 1], [-0.84, 0.36, 8.3, 2.7, 8, 1], [-0.62, 0.12, 9.4, 0.9, 6, 1], [-0.96, 0.12, 8.5, 0.4, 6, 1], [-0.72, -0.1, 9.5, 1.9, 7, 1], [-0.5, -0.34, 10, 3.1, 8, 1], [-0.9, -0.4, 6.5, 4.4, 7, 1], [-0.34, -0.6, 8.5, 2.2, 6, 1], [-0.64, -0.7, 6.8, 5.3, 8, 1],
        [-0.12, -0.84, 7.5, 0.9, 4, 1.2], [0.16, -0.9, 7.8, 3.7, 5, 1.2], [0.42, -0.84, 8.2, 1.4, 4, 1.1],
        [0.8, -0.52, 9.5, 2.6, 7, 1], [0.98, -0.68, 7.2, 5.9, 6, 1], [0.62, -0.8, 8.6, 4.1, 8, 1]]) block(...b);
      // and loose slabs bedded in whatever of the ledge's own ground still shows between them
      for (let i = 0; i < 22; i++) {
        const nx = -1.06 + rr() * 2.12, ny = -1.0 + rr() * (Math.abs(nx - 0.1) < 0.3 ? 0.14 : 0.36);
        const hit = groundAt(nx, ny, 24);
        if (!hit) continue;
        const [x, g, z, t] = hit, sc = (0.45 + rr() * 0.55) * (0.3 + t * 0.085);
        veg.rocks.add(x, g - sc * 0.42, z, rr() * 6.28, sc, 4 + Math.floor(rr() * 2));
      }
      // the homestead's place in the frame, kept clear of the ledge's dressing (bushes had hidden it)
      let hNdc = null;
      if (s.home) { const hp = new THREE.Vector3(s.home[0], world.heightAt(s.home[0], s.home[1]) + 3, s.home[1]).project(camera); if (hp.z < 1) hNdc = hp; }
      const hidesHome = (nx, ny) => hNdc && Math.abs(nx - hNdc.x) < 0.16 && ny > hNdc.y - 0.3;
      // dry ochre bunchgrass, tall frosted stalks and a little frosted brush in the cracks of the ledge, in
      // mixed sizes
      // (scattered through depth in clumps, not one even row along the bottom edge)
      for (let i = 0; i < 60; i++) {
        const cl2 = Math.floor(i / 5), cx2 = -1.0 + ((cl2 * 0.37) % 1) * 2.0, cy2 = -0.98 + ((cl2 * 0.61) % 1) * 0.5;
        const bnx = cx2 + (rr() - 0.5) * 0.18, bny = cy2 + (rr() - 0.5) * 0.12;
        if (hidesHome(bnx, bny)) continue;
        const hit = groundAt(bnx, bny, 24);
        if (!hit) continue;
        const [x, g, z] = hit, k = rr();
        veg.bushes.add(x, g - 0.05, z, rr() * 6.28, (0.25 + rr() * 0.5) * (k < 0.92 ? 1 : 0.6), k < 0.66 ? 9 : 7 + Math.floor(rr() * 2));   // (no dead stalks: they stood about the ledge as stakes)
      }
      // (round 79) and what the reference's ledge is thick with: russet brush in dense low domes (three or four plants
      // grown into one another) and frosted grass in fine tufts (many small ones together, not one broad fan), in the
      // pockets between the rocks all across the bottom of the frame
      for (let i = 0; i < 34; i++) {
        const bnx = -1.02 + rr() * 2.04, bny = -0.98 + rr() * 0.5;
        if (hidesHome(bnx, bny)) continue;
        const hit = groundAt(bnx, bny, 26);
        if (!hit) continue;
        const [x, g, z, t] = hit;
        if (t < 2.4) continue;
        if (i % 3 === 0) {
          const s0 = 0.34 + rr() * 0.3;
          for (let q = 0; q < 4; q++) { const bx = x + (rr() - 0.5) * 0.5 * s0 * 2, bz = z + (rr() - 0.5) * 0.5 * s0 * 2; veg.bushes.add(bx, world.heightAt(bx, bz) - 0.08, bz, rr() * 6.28, s0 * (0.75 + rr() * 0.4), 7 + Math.floor(rr() * 2)); }
        } else for (let q = 0; q < 7; q++) {
          const bx = x + (rr() - 0.5) * 0.9, bz = z + (rr() - 0.5) * 0.9;
          veg.bushes.add(bx, world.heightAt(bx, bz) - 0.03, bz, rr() * 6.28, 0.14 + rr() * 0.16, 9);
        }
      }
      // the slope falling away below the lookout: broken rock and frosted brush poking through the snow all the
      // way down the near ground, so it reads as a mountainside rather than a blank white wedge
      const d = new THREE.Vector3(l.x - c.x, 0, l.z - c.z).normalize(), rt = new THREE.Vector3(-d.z, 0, d.x);
      for (let i = 0; i < 90; i++) {
        const f = 10 + rr() * 90, side = (rr() - 0.5) * (14 + f * 1.2);
        const x = c.x + d.x * f + rt.x * side, z = c.z + d.z * f + rt.z * side, gh = world.heightAt(x, z);
        if (hNdc) { const q = new THREE.Vector3(x, gh + 1, z).project(camera); if (hidesHome(q.x, q.y)) continue; }
        if (rr() < 0.4) veg.rocks.add(x, gh - 0.3, z, rr() * 6.28, 0.5 + rr() * 1.6, 4 + Math.floor(rr() * 2));
        else for (let k = 0; k < 3; k++) { const bx = x + (rr() - 0.5) * 2.5, bz = z + (rr() - 0.5) * 2.5; veg.bushes.add(bx, world.heightAt(bx, bz) - 0.05, bz, rr() * 6.28, 0.5 + rr() * 0.6, [9, 9, 7, 8][Math.floor(rr() * 4)]); }
      }
    }
    // (nothing growing within arm's reach of a lookout's lens: a tuft there is a grey fan across the frame's edge)
    if (s.foreground && G.camOverride && G.camOverride.pos) G.clearTreesNear(G.camOverride.pos.x, G.camOverride.pos.z, 2.6, veg.bushes);
    // a break in the timber toward the sun (round 84): a lane a few trees wide felled along the sun's bearing, well
    // ahead of the lens, so the bright sky stands between the trunks where the light comes from and the shafts have
    // a source. Under an unbroken roof the frame had no highlight in it at all.
    if (s.sunGap && !G.sunGapCut) {
      G.sunGapCut = true;
      sky.time = s.time; sky.update(0, camera.position);
      const sd = U.uSunDir.value, hh = Math.hypot(sd.x, sd.z) || 1, dx = sd.x / hh, dz = sd.z / hh, [g0, g1, gw] = s.sunGap;
      // (from the lens, not the horse: three metres aside is the width of the lane)
      // (worked out from the shot: the camera itself has not been moved to it yet)
      const cyG = yaw - (s.turn || 0), relG = s.camRel || [0, 0, 0];
      const cp = { x: px + Math.cos(cyG) * relG[0] + Math.sin(cyG) * relG[2], z: pz - Math.sin(cyG) * relG[0] + Math.cos(cyG) * relG[2] };
      G.clearTreesAlong(cp.x + dx * g0, cp.z + dz * g0, cp.x + dx * g1, cp.z + dz * g1, gw, 1);
    }
    veg.refreshImpostors();
    hud.root.classList.toggle('on', !!s.hud);
    document.getElementById('title').classList.remove('show');
    document.getElementById('loading').classList.add('done');
    veg.update(player.hpos, true);
    // pre-warm campfire smoke columns that would already be hanging in the air
    for (const cp of town.chimneys || []) {
      for (let i = 0; i < 70; i++) {
        const h = Math.random() * 14;
        // the column leans and bends downwind as it rises (a straight vertical plume read as rigid)
        const wv = U.uWind.value, lean = 0.25 + h * 0.07;
        particles.emit(cp.clone().add(new THREE.Vector3(wv.x * h * lean + (Math.random() - 0.5) * (0.3 + h * 0.2), h, wv.y * h * lean + (Math.random() - 0.5) * (0.3 + h * 0.2))),
          new THREE.Vector3(0.2, 0.5, 0), { color: [0.5, 0.5, 0.53], alpha: 0.38 * (1 - h / 16), size: 0.8 + h * 0.45, life: 6, grow: 0.25, drag: 0.4 });
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
    // (only a few metres of it: run back under a chase camera it reads as a grey board lying in the snow)
    if (world.climateAt(px, pz).snow > 0.5) snowTrail.prefill(px, pz, yaw); else snowTrail.clear();
    // and the powder it kicks up: a low haze of it round each leg where it goes into the snow, thinning out behind
    // (clean legs entering a clean surface read as a model stood on a sheet)
    if (s.snowDress && world.climateAt(px, pz).snow > 0.5) {
      const fw = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), rt2 = new THREE.Vector3(fw.z, 0, -fw.x);
      for (let i = 0; i < 52; i++) {
        const leg = i % 4, lf = (leg < 2 ? 0.55 : -0.74) + (Math.random() - 0.5) * 0.3, ls = (leg % 2 ? 0.2 : -0.2) + (Math.random() - 0.5) * 0.25;
        const back = i < 32 ? 0 : Math.random() * 2.4;
        const p = player.hpos.clone().addScaledVector(fw, lf - back).addScaledVector(rt2, ls).add(new THREE.Vector3(0, 0.04 + Math.random() * 0.26, 0));
        particles.emit(p, new THREE.Vector3(0, 0.04, 0), { color: [0.86, 0.9, 0.96], alpha: 0.26 * (1 - back / 3.2), size: 0.3 + Math.random() * 0.35 + back * 0.14, life: 5, grow: 0.15, drag: 1 });
      }
    }
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
  // Frame governor. The world is drawn at the display's full pixel density when the machine can hold a playable
  // rate at it and at a lower render scale when it cannot (the image is the same, a little softer), stepping back up
  // when there is headroom. ?ss= pins the scale and capture mode never changes it.
  const gov = { t: performance.now(), n: 0, scale: renderer.getPixelRatio(), max: renderer.getPixelRatio(), min: 0.5, on: !CAPTURE && !SS && !params.has('nogov') };
  G.gov = gov;
  function govern() {
    if (!gov.on || !G.started) { gov.t = performance.now(); gov.n = 0; return; }
    if (++gov.n < 24) return;
    const now = performance.now(), ms = (now - gov.t) / gov.n;
    gov.t = now; gov.n = 0; gov.ms = ms;
    let ns = gov.scale;
    if (ms > 40) ns = Math.max(gov.min, gov.scale * (ms > 80 ? 0.72 : ms > 55 ? 0.82 : 0.9));
    else if (ms < 27 && gov.scale < gov.max) ns = Math.min(gov.max, gov.scale * 1.08);
    if (Math.abs(ns - gov.scale) > 0.015) {
      gov.scale = ns;
      renderer.setPixelRatio(ns); renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight);
      gov.t = performance.now();
    }
  }
  function frame() {
    requestAnimationFrame(frame);
    if (G.hold) { clock.getDelta(); return; }
    govern();
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
        const yaw = player.hyaw - (o.turn || 0);
        const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const base = player.hpos;
        camera.position.copy(base).addScaledVector(r, o.rel[0]).addScaledVector(f, o.rel[2]).add(new THREE.Vector3(0, o.rel[1], 0));
        camera.position.y = Math.max(camera.position.y, world.heightAt(camera.position.x, camera.position.z) + 0.4);
        camera.lookAt(base.clone().addScaledVector(r, o.lookRel[0]).addScaledVector(f, o.lookRel[2]).add(new THREE.Vector3(0, o.lookRel[1], 0)));
      }
      camera.fov = o.fov || 50; camera.updateProjectionMatrix();
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
      // forest around the camera, not just under it (a trail through deep woods has no forest on the trail itself)
      let fo = world.splatAt(camera.position.x, camera.position.z).forest;
      for (const rr of [12, 30]) for (let k = 0; k < 8; k++) { const a = k * 0.785 + rr; fo = Math.max(fo, 0.85 * world.splatAt(camera.position.x + Math.cos(a) * rr, camera.position.z + Math.sin(a) * rr).forest); }
      // (the sunlit forest haze, shafts and warm forest grade belong to the woods below the snow line: on a snowy
      // lookout with spruce about, they milked out the storm vista)
      fo *= 1 - THREE.MathUtils.smoothstep(world.climateAt(camera.position.x, camera.position.z).snow, 0.4, 0.8);
      const morning = Math.max(0, 1 - Math.abs(sky.time - 7.5) / 2.5);
      const low = 1 - THREE.MathUtils.smoothstep(camera.position.y - world.heightAt(camera.position.x, camera.position.z), 6, 20);
      // (the forest haze once read as milk at 1.7x the reference's exposure; with the canopy now closed by full
      // crowns the woods went the other way, 0.6x in their upper two-thirds, and want the sunlit haze back)
      // (the reference's woods are full of warm backlit haze: trunks 150 m off fade to pale gold-grey)
      // (the sunlit part of that haze is now marched against the sun's shadow map in the post stack, so shaded air stays
      // clear: only a little even haze is left here)
      G.mistK = 1 + (fo * 0.2 + morning * 1.5) * low;
      G.forestK = fo * low;
      // regional weather from the climate under the camera (snapped on the first frames of a capture shot)
      const cc = world.climateAt(camera.position.x, camera.position.z);
      const swampy = world.splatAt(camera.position.x, camera.position.z).wet * (camera.position.x > 500 && camera.position.z > 600 ? 1 : 0);
      {
        // ground under the camera for the ambient bounce: snow, sand, rainforest, autumn litter or ordinary ground
        const fo2 = world.splatAt(camera.position.x, camera.position.z).forest;
        const g = new THREE.Color(0.22, 0.2, 0.13).multiplyScalar(1 - 0.45 * fo2);
        g.lerp(new THREE.Color(0.52, 0.34, 0.2), cc.desert).lerp(new THREE.Color(0.1, 0.14, 0.06), cc.jungle * 0.8)
          .lerp(new THREE.Color(0.3, 0.2, 0.1), cc.autumn * 0.6).lerp(new THREE.Color(0.7, 0.75, 0.82), THREE.MathUtils.smoothstep(cc.snow, 0.35, 0.75));
        sky.groundAlbedo = g;
      }
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
      // (fog banks stack down the valley in falling snow too: the reference's ridges separate by value through it)
      U.uMist.value = sky.weather.storm * (1 - 0.55 * sky.weather.blizzard) * (G.weatherOverride ? 1 : THREE.MathUtils.smoothstep(cc.snow, 0.4, 0.8));
      // the valley fog lies on the floor ahead of the lens (the lowest snow-country ground in a fan out to 2.4 km):
      // taken all round, a lookout above a valley's mouth took the lowlands behind it for the floor
      if (U.uMist.value > 0.01 && (G.frame < 3 || G.frame % 20 === 0)) {
        const fw = new THREE.Vector3(); camera.getWorldDirection(fw);
        const fa = Math.atan2(fw.x, fw.z);
        let lo = 1e9;
        for (const da of [-0.6, -0.3, 0, 0.3, 0.6]) for (const dd of [150, 400, 800, 1300, 1900, 2400]) {
          const x = camera.position.x + Math.sin(fa + da) * dd, z = camera.position.z + Math.cos(fa + da) * dd;
          if (Math.abs(x) > HALF - 20 || Math.abs(z) > HALF - 20 || world.climateAt(x, z).snow < 0.5) continue;
          lo = Math.min(lo, world.heightAt(x, z));
        }
        if (lo > 1e8) lo = world.heightAt(camera.position.x, camera.position.z);
        U.uBankBase.value += (lo - U.uBankBase.value) * (G.frame < 3 ? 1 : 0.2);
      }
      // and the height fog rests on that floor too: from a ridge five hundred metres above the valley the layer was
      // taken to lie at the ridge's own foot, and everything below it filled to a white bowl
      if (U.uMist.value > 0.01) U.uFogBase.value = Math.min(U.uFogBase.value, U.uBankBase.value);
    }
    const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd); camFwd.y = 0; camFwd.normalize();
    const shadowFocus = camera.position.clone().addScaledVector(camFwd, 95);
    shadowFocus.y = world.heightAt(shadowFocus.x, shadowFocus.z);
    sky.ambientK = 1 - 0.25 * (G.forestK || 0) * (1 - U.uNight.value);
    sky.update(!G.freezeTime && G.started ? dt : 0, shadowFocus);
    sky.mesh.position.copy(camera.position);
    U.uFogDensity.value *= G.mistK || 1;
    // eye adaptation: stop down when looking into a low sun, open up a little in deep forest shade
    {
      const f3 = new THREE.Vector3(); camera.getWorldDirection(f3);
      const into = THREE.MathUtils.smoothstep(f3.dot(U.uSunDir.value), 0.55, 0.95) * (1 - U.uNight.value);
      // (under a canopy the eye opens up even looking toward the sun: the hotspot is small)
      // (the open, sun-shafted canopy is bright enough now: no extra lift in the woods; snow under a storm sky in clear
      // air reads brighter than the eye wants it, so stop down a little there)
      const W = sky.weather;
      // (a storm with clear air under it is not dim; the woods open up a little under their canopy)
      // (falling snow under a heavy deck is dim: the reference's snowfield sits a stop under paper white)
      const target = 1.12 * (1 - 0.3 * into * (1 - 0.3 * (G.forestK || 0))) * (1 - 0.3 * W.storm * (1 - W.blizzard)) * (1 - 0.1 * W.blizzard) * (1 + 0.45 * (G.forestK || 0));   // (the eye opens up under a canopy, where half the sky's light is shut out)
      renderer.toneMappingExposure += (target * (G.expK ?? 1) - renderer.toneMappingExposure) * (G.frame < 3 ? 1 : Math.min(1, rdt * 1.5));
    }
    U.uCanopy.value = (G.canopyK ?? 1) * (G.forestK || 0) * (1 - U.uNight.value);
    U.uCharFill.value = 0.05 + 0.22 * (G.forestK || 0) * (1 - U.uNight.value);
    if (G.keyShaft) U.uCanopySpot.value.set(player.hpos.x, player.hpos.y + 1.7, player.hpos.z, G.keyShaft); else U.uCanopySpot.value.w = 0;
    town.update(dt, U.uNight.value, sky.weather.storm);
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
        new THREE.Vector3(U.uWind.value.x * 0.6, 1.1 + Math.random() * 0.4, U.uWind.value.y * 0.6), { color: [0.5, 0.5, 0.53], alpha: 0.4, size: 0.8, life: 9, grow: 0.6, drag: 0.25 });   // wood smoke: a grey that reads against snow
    }
    // breath smoking from the horse's nostrils in the cold
    if (player.mounted && world.climateAt(player.hpos.x, player.hpos.z).snow > 0.5) {
      G.breathT = (G.breathT || 0) + rdt;
      if (G.breathT > 2.4) {
        G.breathT = 0;
        const hp = new THREE.Vector3(0, -0.36, 0.42); player.horse.head.localToWorld(hp);
        const fw = new THREE.Vector3(Math.sin(player.hyaw), -0.35, Math.cos(player.hyaw));
        for (let k = 0; k < 8; k++) particles.emit(hp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.06)),
          fw.clone().multiplyScalar(0.5 + Math.random() * 0.4), { color: [0.86, 0.88, 0.92], alpha: 0.2, size: 0.14, life: 1.8, grow: 0.7, drag: 0.7 });
      }
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
    // is there water for the mirror pass to show? (looked for now and then: the sea, the lake, the river in reach)
    if (G.frame % 30 === 0) {
      let wet = camera.position.y < 260 && world.heightAt(camera.position.x, camera.position.z) < 1.5;
      for (const d of [80, 200, 400, 800, 1400]) { if (wet || camera.position.y > 260) break; for (let k = 0; k < 12; k++) { const a = k * 0.5236 + d; if (world.heightAt(camera.position.x + Math.cos(a) * d, camera.position.z + Math.sin(a) * d) < 0.3) { wet = true; break; } } }
      water.needed = wet;
    }
    water.update(camera);
    if (G.started) hud.update(rdt, G);
    audio.update(rdt, { night: U.uNight.value, speed: player.mounted ? player.hspeed : player.speed, nearWater: Math.max(0, 1 - Math.max(0, world.heightAt(focus.x, focus.z)) / 4), riding: player.mounted && player.hspeed > 4, listener: focus, deadEye: G.deadEyeK });
    // (in clear air under a storm the cold grade is lighter: warm rock and dry grass keep some colour against the snow)
    // (a clear-air storm keeps more colour: warm rock and dry grass against the cool snow, as the reference's vista)
    const coldGrade = Math.max(sky.weather.blizzard, 0.42 * sky.weather.storm * THREE.MathUtils.smoothstep(world.climateAt(camera.position.x, camera.position.z).snow, 0.4, 0.8));
    post.render(rdt, { sun: sky.sun, vol: G.volK ?? ((G.forestK || 0) * (1 - U.uNight.value) * (1 - sky.weather.storm)), volDensity: G.volDensity, volFalloff: G.volFalloff, volDist: G.volDist, volAmbient: G.volAmbient, storm: coldGrade, forest: (G.forestK || 0) * (1 - U.uNight.value), shaftK: 1 - (G.forestK || 0) * 0.85 - sky.weather.storm * 0.8, deadEye: G.deadEyeK, damage: G.damage, letterbox: player.cinematic * 0.11, fade: player.dead ? Math.min(1, (4 - G.dieT) / 2) : 0 });
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
