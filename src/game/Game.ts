import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/math';
import { EventBus } from '../core/Events';
import { GameClock } from '../core/GameClock';
import { Input, type ButtonAction } from '../core/Input';
import { SettingsStore, type Difficulty } from '../core/Settings';
import { FlyCamera } from '../debug/FlyCamera';
import { PlayerController, type ControlIntent, type PlayerEnvironment, type WaterAt } from '../player/PlayerController';
import { PlayerView } from '../player/PlayerView';
import { MOON_ILLUMINANCE, SUN_ILLUMINANCE } from '../render/atmosphere/Atmosphere';
import { createFullscreenMaterial, FullscreenPass } from '../render/FullscreenPass';
import { Lighting } from '../render/Lighting';
import { qualityFromName, suggestQuality, type QualityName, type QualitySettings } from '../render/Quality';
import { RenderPipeline } from '../render/RenderPipeline';
import { TerrainMaterialBaker } from '../render/terrain/TerrainMaterialBaker';
import { FoliageTextures } from '../render/vegetation/foliageTextures';
import { createVegetationShared, type VegetationShared } from '../render/vegetation/treeMaterials';
import { WaterSystem, type WaterSample } from '../render/water/WaterSystem';
import { PropSystem, type PropOptions } from '../world/props/PropSystem';
import { Viewmodel } from '../player/Viewmodel';
import { AudioEngine, type AudioState } from '../audio/AudioEngine';
import { SPECIES, Wildlife } from '../creatures/Wildlife';
import { WardenSystem } from '../creatures/Warden';
import { Precipitation, WEATHER_LABELS, WeatherSystem, type WeatherKind } from '../world/Weather';
import { Gathering, type GatherContext } from './Gathering';
import { Structures, type StructureData, type StructureType } from './Structures';
import { Building, isPieceType, type Piece } from './Building';
import { InventoryScreen } from '../ui/InventoryScreen';
import { MapScreen, type MapPin } from '../ui/MapScreen';
import { QuestTracker } from '../story/Quests';
import { StoryWorld } from '../story/StoryWorld';
import { BELL_MEMORIES, DIALOGUE, TUNING_ORDER } from '../story/StoryData';
import { DialogueBox, Journal, QuestTrackerHud } from '../ui/StoryUi';
import { itemDef } from './items';
import { RECIPES } from './recipes';
import { craft } from '../ui/InventoryScreen';
import { DeathScreen, Menu } from '../ui/Menu';
import { TitleScreen } from '../ui/TitleScreen';
import { TitleCamera, type ShotStart } from './TitleCamera';
import { Hud, type CompassMarker } from '../ui/Hud';
import { bearingOf, MASK } from '../world/gen/generateWorld';
import { moonDirection, moonIllumination, moonPhase, starRotation, sunDirection } from '../world/Celestial';
import { TerrainRenderer } from '../world/terrain/TerrainRenderer';
import { GrassSystem } from '../world/vegetation/GrassSystem';
import { VegetationSystem, type TreeCollider } from '../world/vegetation/VegetationSystem';
import { BIOME_COUNT, BIOMES, VEIL_RADIUS } from '../world/WorldConfig';
import { WorldData } from '../world/WorldData';
import { loadWorld } from '../world/WorldLoader';
import { LANDMARKS } from '../world/WorldLayout';
import { Inventory, type ItemStack } from './Inventory';
import { SaveSystem, type SaveMeta } from './SaveSystem';
import { Survival, type Climate } from './Survival';
import { viewpointByName, VIEWPOINTS } from './Viewpoints';

export type ProgressReporter = (stage: string, fraction: number) => void;
export type GameMode = 'play' | 'fly' | 'title';

/** Where a new survivor wakes: beside the Meridian's crash camp. */
const CAMP_SPAWN = { x: 26, z: 614, yaw: 0.05 };
const HOTBAR_ACTIONS: ButtonAction[] = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8'];

/**
 * Top-level orchestrator. Owns the renderer, world, systems and the frame
 * loop; systems talk through the event bus or through the Game.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly clock = new GameClock();
  readonly input: Input;
  readonly events = new EventBus();
  readonly settings = new SettingsStore();
  readonly saves = new SaveSystem();
  readonly view = new PlayerView();
  readonly survival: Survival;
  readonly inventory: Inventory;
  quality: QualitySettings;
  readonly detectedQuality: QualityName;
  readonly gpuName: string;
  pipeline!: RenderPipeline;
  lighting!: Lighting;
  world!: WorldData;
  terrain!: TerrainRenderer;
  baker!: TerrainMaterialBaker;
  flyCam!: FlyCamera;
  grass!: GrassSystem;
  vegetation!: VegetationSystem;
  vegetationShared!: VegetationShared;
  foliageTextures!: FoliageTextures;
  water!: WaterSystem;
  props!: PropSystem;
  gathering!: Gathering;
  structures!: Structures;
  building!: Building;
  wildlife!: Wildlife;
  wardens!: WardenSystem;
  readonly weather = new WeatherSystem();
  precipitation!: Precipitation;
  inventoryScreen!: InventoryScreen;
  mapScreen!: MapScreen;
  quests!: QuestTracker;
  story!: StoryWorld;
  dialogue!: DialogueBox;
  journal!: Journal;
  questHud!: QuestTrackerHud;
  readonly viewmodel = new Viewmodel();
  readonly audio = new AudioEngine();
  private readonly audioState: AudioState = {
    listener: { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 },
    hours: 12,
    wind: 0,
    forest: 0,
    meadow: 0,
    sea: 0,
    river: 0,
    marsh: 0,
    snow: 0,
    fire: 0,
    surfPeriod: 0,
    underwater: false,
    lowHealth: 0,
    rain: 0,
    musicMode: 'lydian',
    musicRoot: 62,
    inDanger: false,
    combat: 0,
  };
  private audioProbeTimer = 0;
  player!: PlayerController;
  hud!: Hud;
  menu!: Menu;
  death!: DeathScreen;
  title!: TitleScreen;
  titleCam!: TitleCamera;
  mode: GameMode = 'play';

  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private frame = 0;
  private elapsed = 0;
  private playtime = 0;
  private paused = false;
  private menuPaused = false;
  private reducedMotion = false;
  private stateName = 'boot';
  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  private readonly starMatrix4 = new THREE.Matrix4();
  private readonly starMatrix = new THREE.Matrix3();
  private readonly errors: string[] = [];
  private debugTexturePass: FullscreenPass | null = null;
  private readonly timings: Record<string, number> = {};
  private readonly light = { direction: new THREE.Vector3(0, 1, 0), color: new THREE.Color(), intensity: 0 };
  private readonly waterSample: WaterSample = { surface: 0, depth: 0, kind: 0, flowX: 0, flowZ: 0, frozen: false, hot: false, turbidity: 0 };
  private readonly playerWater: WaterSample = { surface: 0, depth: 0, kind: 0, flowX: 0, flowZ: 0, frozen: false, hot: false, turbidity: 0 };
  private readonly move = { x: 0, y: 0 };
  private readonly look = { x: 0, y: 0 };
  private readonly intent: ControlIntent = { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, sprint: false, crouch: false };
  private readonly biomeScratch = new Float32Array(BIOME_COUNT);
  private readonly treeScratch: TreeCollider[] = [];
  private readonly markers: CompassMarker[] = [];
  private readonly gatherCtx = { camera: null as unknown as THREE.PerspectiveCamera, totalHours: 0, playerX: 0, playerZ: 0, inWater: false };
  private viewmodelSetupDone = new Set<string>();
  private readonly discovered = new Set<string>();
  private readonly seen = new Set<string>();
  private currentBiome = -1;
  private biomeTimer = 0;
  private drownTimer = 0;
  private autosaveTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private debugVisible = false;
  private hoursElapsed = 0;
  private spawnPoint = { ...CAMP_SPAWN };
  /** Test hooks drive input without pointer lock. */
  private testInput = false;
  private debugEl: HTMLElement | null = null;
  private fpsEl: HTMLElement | null = null;
  private veilEl: HTMLElement | null = null;
  private deathCause: string | null = null;
  /** Seconds into the wake-up after the opening narration (-1 when not waking). */
  private wake = -1;
  /** The world holds still while the opening narration plays. */
  private introHold = false;
  /** Container (chest, dropped pack) open in the inventory screen. */
  private openContainer: StructureData | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const params = new URLSearchParams(location.search);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: params.has('capture'),
    });
    this.gpuName = detectGpu(this.renderer);
    this.detectedQuality = suggestQuality(this.gpuName);
    const chosen = params.get('quality') ?? this.settings.get('quality');
    this.quality = qualityFromName(chosen === 'auto' ? this.detectedQuality : chosen);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov'), 1, 0.12, this.quality.farPlane);
    this.camera.position.set(0, 60, 700);
    this.input = new Input(canvas);
    this.survival = new Survival(this.events);
    this.inventory = new Inventory(this.events);
    window.addEventListener('error', (e) => this.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(String(e.reason)));
  }

  async boot(progress: ProgressReporter): Promise<void> {
    const params = new URLSearchParams(location.search);
    const t0 = performance.now();
    const { fields, cached } = await loadWorld(progress, !params.has('nocache'));
    this.timings.worldMs = performance.now() - t0;
    this.timings.worldCached = cached ? 1 : 0;
    this.world = new WorldData(fields);

    progress('Mixing pigments', 0.2);
    await nextFrame();
    const t1 = performance.now();
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, this.quality);
    this.baker = new TerrainMaterialBaker(512);
    this.baker.bake(this.renderer);
    this.timings.bakeMs = performance.now() - t1;

    progress('Lighting the sky', 0.5);
    await nextFrame();
    this.lighting = new Lighting(this.scene, this.camera, this.quality);
    this.terrain = new TerrainRenderer(this.world, this.baker, {
      gridN: this.quality.terrainGrid,
      detailDistance: this.quality.terrainDetailDistance,
    });
    this.terrain.setCullDistance(this.quality.shadowDistance);
    this.lighting.setupMaterial(this.terrain.material);
    this.scene.add(this.terrain.mesh);

    const atmo = this.pipeline.atmosphere.uniforms;
    this.grass = new GrassSystem(this.world, { dir: atmo.uSunDir.value, color: atmo.uSunColor.value }, {
      radius: this.quality.grassRadius,
      density: this.quality.grassDensity,
    });
    for (const material of this.grass.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.grass.group);

    progress('Growing the forests', 0.65);
    await nextFrame();
    const t3 = performance.now();
    this.foliageTextures = new FoliageTextures(this.renderer, 512);
    this.vegetationShared = createVegetationShared(atmo.uSunDir.value, atmo.uSunColor.value);
    this.vegetation = new VegetationSystem(this.renderer, this.world, this.vegetationShared, this.foliageTextures, this.vegetationOptions());
    for (const material of this.vegetation.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.vegetation.group);
    this.timings.vegetationMs = performance.now() - t3;

    progress('Filling the seas', 0.2);
    await nextFrame();
    const t4 = performance.now();
    this.water = new WaterSystem(this.renderer, this.world, this.quality);
    this.lighting.setupMaterial(this.water.material);
    this.lighting.setupMaterial(this.water.iceMaterial);
    this.scene.add(this.water.group);
    this.timings.waterMs = performance.now() - t4;

    progress('Scattering stones', 0.5);
    await nextFrame();
    const t5 = performance.now();
    this.props = new PropSystem(this.world, this.baker, this.vegetation, this.propOptions());
    for (const material of this.props.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.props.group);
    this.gathering = new Gathering(this.events, this.world, this.props, this.vegetation, this.inventory, this.survival);
    this.structures = new Structures(this.world, this.events, 4);
    this.wildlife = new Wildlife(
      this.world,
      this.events,
      {
        player: () => {
          const p = this.player.position;
          const noise = this.player.sprinting ? 1 : this.player.crouching ? 0.2 : this.player.speed > 0.5 ? 0.6 : 0.15;
          return { x: p.x, y: p.y, z: p.z, crouching: this.player.crouching, sprinting: this.player.sprinting, noise };
        },
        damagePlayer: (amount, source) => {
          if (this.mode !== 'play' || !this.survival.alive) return;
          this.survival.damage(amount, source);
        },
        isNight: () => this.clock.isNight,
        cameraFacing: (x, z) => {
          const dir = this.camera.getWorldDirection(this.tmpDir);
          const dx = x - this.camera.position.x;
          const dz = z - this.camera.position.z;
          const d = Math.hypot(dx, dz) || 1;
          return (dx * dir.x + dz * dir.z) / d > 0.35;
        },
      },
      (x, z, r) => this.vegetation.collidersNear(x, z, r, this.treeScratch),
    );
    this.wildlife.cap = this.quality.name === 'low' ? 8 : this.quality.name === 'medium' ? 12 : this.quality.name === 'high' ? 16 : 22;
    for (const material of this.wildlife.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.wildlife.group);
    this.quests = new QuestTracker(this.events, this.inventory);
    this.quests.isSatisfied = (step) => {
      if (step.kind === 'place') return this.structures.nearestOfType(step.target as StructureType, this.player.position.x, this.player.position.z) !== null;
      if (step.kind === 'discover') return this.discovered.has(step.target);
      if (step.kind === 'flag') return this.quests.flags.has(step.target);
      return false;
    };
    this.story = new StoryWorld(this.world, this.events, this.quests, {
      heldItem: () => this.inventory.held?.id ?? null,
      give: (item, count) => this.inventory.add(item, count),
      playTone: (index, correct) => this.audio.stoneTone(index, correct),
      say: (speaker, text, seconds = 6) => this.events.emit('subtitle', { speaker, text, duration: seconds }),
      talk: (npc) => this.talkTo(npc),
      playerPosition: () => this.player.position,
      ringBell: (id) => this.ringBell(id),
    });
    for (const material of this.story.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.story.group);
    const obstacleScratch: TreeCollider[] = [];
    this.wardens = new WardenSystem(this.world, this.events, {
      player: () => {
        const p = this.player.position;
        return { x: p.x, y: p.y, z: p.z, grounded: this.player.grounded, alive: this.mode === 'play' && this.survival.alive };
      },
      damagePlayer: (amount, source) => {
        if (this.mode !== 'play' || !this.survival.alive) return;
        this.survival.damage(amount, source);
      },
      knockPlayer: (x, y, z) => this.player.knock(x, y, z),
      shake: (amount) => this.view.addTrauma(amount),
      sound: (kind, x, y, z, strength) => this.audio.warden(kind, x, y, z, strength),
      say: (speaker, text, seconds = 6) => this.events.emit('subtitle', { speaker, text, duration: seconds }),
      obstacles: (x, z, r) => this.vegetation.collidersNear(x, z, r, obstacleScratch),
    });
    for (const material of this.wardens.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.wardens.group);
    this.events.on('wardenCalmed', ({ flag }) => {
      this.quests.setFlag(flag);
      this.saveSession('auto');
    });
    this.events.on('killed', ({ species }) => this.quests.progress('kill', species));
    this.precipitation = new Precipitation({ low: 2500, medium: 4500, high: 7000, extra: 10000, max: 14000 }[this.quality.name]);
    this.scene.add(this.precipitation.mesh);
    for (const material of this.structures.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.structures.group);
    this.building = new Building(this.world, this.events);
    for (const material of this.building.materials) this.lighting.setupMaterial(material);
    this.scene.add(this.building.group);
    // Campfires, chests and benches can stand on built floors.
    this.structures.surfaceAt = (x, z, y) => this.building.surfaceAt(x, z, y);
    this.structures.raycast = (o, d, max, out) => {
      const t = this.world.raycast(o, d, max, out);
      const b = this.building.raycast(o, d, max);
      if (b && (t < 0 || b.t < t)) {
        if (b.normal.y < 0.5) return -1;
        out.copy(b.point);
        return b.t;
      }
      return t;
    };
    this.gathering.creatureHit = (origin, dir, reach, damage) => {
      const w = this.wardens.hit(origin, dir, reach, damage);
      if (w.hit) {
        this.view.addTrauma(w.weak ? 0.22 : 0.08);
        return true;
      }
      const hit = this.wildlife.pick(origin, dir, reach);
      if (!hit || hit.creature.state === 'dead') return false;
      const p = this.player.position;
      this.wildlife.damage(hit.creature, damage, hit.weak, p.x, p.z, this.elapsed);
      this.view.addTrauma(hit.weak ? 0.25 : 0.12);
      if (hit.weak) this.events.emit('notify', { text: 'Weak point!', icon: 'quest', tone: 'good' });
      return true;
    };
    this.scene.add(this.camera);
    this.camera.add(this.viewmodel.root);
    this.viewmodel.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).type === 'MeshStandardMaterial') this.lighting.setupMaterial(mesh.material as THREE.Material);
    });
    this.viewmodelSetupDone = new Set();
    this.timings.propsMs = performance.now() - t5;

    this.flyCam = new FlyCamera(this.camera, this.input, this.world);
    this.player = new PlayerController(this.createPlayerEnvironment(), this.survival);
    this.wirePlayerCallbacks();
    this.createUi();
    this.registerSaves();
    this.applySettings();
    this.settings.onChange(() => this.applySettings());

    this.titleCam = new TitleCamera(this.world);
    const view = params.get('view');
    if (view && viewpointByName(view)) {
      this.applyViewpoint(view);
    } else if (SaveSystem.consumeResume()) {
      this.startPlay('session');
    } else if (params.has('capture') && !params.has('title')) {
      // Automated tests and captures go straight into play.
      this.startPlay(null);
    } else {
      this.enterTitle();
    }
    this.vegetation.prewarm(this.camera.position.x, this.camera.position.z, 260);
    this.props.prewarm(this.camera.position.x, this.camera.position.z);

    progress('Compiling shaders', 0.8);
    await nextFrame();
    const t2 = performance.now();
    this.updateEnvironment(0);
    this.terrain.update(this.camera, 0);
    this.renderer.compile(this.scene, this.camera);
    this.timings.compileMs = performance.now() - t2;

    this.installTestHooks();
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'play' && !this.menu.isOpen && this.survival.alive) this.input.requestPointerLock();
    });
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('pagehide', () => {
      // Closing the tab keeps the journey.
      if (this.mode === 'play' && this.survival.alive && !this.introHold && this.playtime > 5) this.saveSession('auto');
    });
    document.addEventListener('pointerlockchange', () => {
      // Losing the pointer while playing (Esc) opens the pause menu.
      if (!this.input.pointerLocked && this.mode === 'play' && !this.menu.isOpen && !this.inventoryScreen.isOpen && !this.mapScreen.isOpen && !this.journal.isOpen && this.survival.alive && this.running) this.openMenu();
    });
    progress('Ready', 1);
  }

  // -------------------------------------------------------------------------
  // Setup

  private createPlayerEnvironment(): PlayerEnvironment {
    const world = this.world;
    const waterOut: WaterAt = { surface: 0, depth: 0, frozen: false, flowX: 0, flowZ: 0 };
    return {
      groundHeight: (x, z, y) => {
        const natural = Math.max(world.heightAt(x, z), this.props.heightAt(x, z));
        return y === undefined ? natural : Math.max(natural, this.building.surfaceAt(x, z, y));
      },
      groundNormal: (x, z, out, y) => {
        // Standing on a built floor or stair: level footing.
        if (y !== undefined && this.building.count > 0) {
          const deck = this.building.surfaceAt(x, z, y);
          if (deck > world.heightAt(x, z) && deck >= this.props.heightAt(x, z)) return out.set(0, 1, 0);
        }
        const rock = this.props.heightAt(x, z);
        if (rock <= world.heightAt(x, z)) return world.smoothNormalAt(x, z, out);
        // On a boulder: numeric normal of the combined ground.
        const e = 0.15;
        const h = (px: number, pz: number) => Math.max(world.heightAt(px, pz), this.props.heightAt(px, pz));
        out.set(h(x - e, z) - h(x + e, z), 2 * e, h(x, z - e) - h(x, z + e)).normalize();
        return out;
      },
      water: (x, z) => {
        const s = this.water.sample(x, z, this.playerWater);
        waterOut.surface = s.surface;
        waterOut.depth = s.depth;
        waterOut.frozen = s.frozen;
        waterOut.flowX = s.flowX;
        waterOut.flowZ = s.flowZ;
        return waterOut;
      },
      colliders: (x, z, r, out) => {
        this.vegetation.collidersNear(x, z, r, this.treeScratch);
        out.length = 0;
        for (const c of this.treeScratch) out.push(c);
        // The Warden is solid, and so are walls.
        for (const c of this.wardens.colliders()) if (Math.hypot(c.x - x, c.z - z) < r + c.radius) out.push(c);
        this.building.collidersNear(x, z, r, out);
        return out;
      },
      surface: (x, z) => this.surfaceAt(x, z),
      boundary: VEIL_RADIUS + 60,
    };
  }

  private surfaceAt(x: number, z: number): string {
    const w = this.world;
    if (w.waterDepthAt(x, z) > 0.05) return 'water';
    if (w.maskAt(x, z, MASK.snow) > 0.4) return 'snow';
    if (w.maskAt(x, z, MASK.sand) > 0.45) return 'sand';
    if (w.maskAt(x, z, MASK.path) > 0.4) return 'gravel';
    if (w.maskAt(x, z, MASK.wet) > 0.55) return 'mud';
    if (w.slopeAt(x, z) > 0.45) return 'rock';
    const biome = w.dominantBiome(x, z);
    if (biome === 4) return 'ash';
    if (biome === 1) return 'forest';
    return 'grass';
  }

  private wirePlayerCallbacks(): void {
    this.player.callbacks = {
      onLand: (speed, height, damage, intoWater) => {
        this.view.impact(intoWater ? speed * 0.4 : speed);
        if (damage > 0) {
          this.survival.damage(damage, 'fall');
          this.view.addTrauma(Math.min(1, damage / 60));
        }
        this.events.emit('landed', { speed, height });
      },
      onJump: () => this.events.emit('jumped', {}),
      onFootstep: (surface, speed, left) => this.events.emit('footstep', { surface, speed, left }),
      onEnterWater: (speed) => {
        const p = this.player.position;
        this.events.emit('splash', { strength: Math.min(1, speed / 10 + 0.2), x: p.x, y: p.y, z: p.z });
        this.events.emit('enterWater', { depth: 0 });
      },
      onExitWater: () => this.events.emit('exitWater', {}),
      onClimb: (climbing) => this.events.emit(climbing ? 'climbStart' : 'climbEnd', {}),
      onDrowning: (dt) => {
        this.drownTimer += dt;
        if (this.drownTimer > 1) {
          this.drownTimer = 0;
          this.survival.damage(6, 'drowning');
        }
      },
    };
  }

  private createUi(): void {
    const root = document.querySelector<HTMLElement>('#ui-root') ?? document.body;
    this.hud = new Hud(root, this.events);
    this.menu = new Menu(root, this.settings, {
      onResume: () => this.closeMenu(),
      onApplyQuality: () => this.reloadWithQuality(),
      onRespawn: () => {
        this.closeMenu();
        this.respawn();
      },
      onQuitToTitle: () => this.quitToTitle(),
      detectedQuality: this.detectedQuality,
      activeQuality: this.quality.name,
      gpu: this.gpuName,
    });
    this.death = new DeathScreen(root, () => this.respawn());
    this.title = new TitleScreen(root, {
      continueMeta: () => this.latestSave(),
      onContinue: () => {
        const save = this.latestSave();
        this.title.hide();
        this.startPlay(save?.slot ?? null);
        this.pipeline.post.fade = 1;
        this.input.requestPointerLock();
      },
      onNewGame: (difficulty) => this.newGame(difficulty),
      onBegin: () => {
        this.introHold = false;
        this.wake = 0;
        this.pipeline.post.fade = 1;
        this.input.requestPointerLock();
      },
      onSettings: () => this.openMenu(),
    });
    this.mapScreen = new MapScreen(root, this.world, () => this.closeMap());
    this.dialogue = new DialogueBox(root);
    this.journal = new Journal(root, () => this.closeJournal());
    this.questHud = new QuestTrackerHud(this.hud.root);
    this.inventoryScreen = new InventoryScreen(root, this.inventory, this.events, {
      stations: () => this.structures.stationsNear(this.player.position.x, this.player.position.z),
      onUse: (slot) => {
        const previous = this.inventory.selected;
        if (slot < 8) this.inventory.select(slot);
        else {
          this.inventory.swap(slot, previous);
        }
        this.gathering.use(this.gatherContext());
        if (slot < 8) this.inventory.select(previous);
      },
      onClose: () => this.closeInventory(),
    });
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'hud-debug';
    this.hud.root.appendChild(this.debugEl);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'hud-fps';
    this.hud.root.appendChild(this.fpsEl);
    this.veilEl = document.createElement('div');
    this.veilEl.className = 'click-veil';
    this.veilEl.textContent = 'Click to look around';
    root.appendChild(this.veilEl);

    this.events.on('damage', ({ amount }) => {
      this.pipeline.post.damage = Math.min(1, this.pipeline.post.damage + amount / 22);
      this.view.addTrauma(Math.min(0.6, amount / 40));
    });
    this.events.on('footstep', ({ surface, speed, left }) => this.audio.footstep(surface, speed, left));
    this.events.on('landed', ({ speed }) => {
      if (speed > 3) this.audio.land(speed);
    });
    this.events.on('jumped', () => this.audio.jump());
    this.events.on('splash', ({ strength }) => this.audio.splash(strength));
    this.events.on('swing', () => this.audio.swing());
    this.events.on('hit', ({ material }) => this.audio.hit(material));
    this.events.on('gathered', () => this.audio.pickup());
    this.events.on('crafted', () => this.audio.craft());
    this.events.on('consumed', ({ kind }) => (kind === 'eat' ? this.audio.eat() : this.audio.drink()));
    this.events.on('damage', ({ amount }) => this.audio.hurt(amount));
    this.events.on('discovered', ({ id, kind }) => {
      this.audio.stinger(kind !== 'biome');
      // Lore pages fill the journal.
      if (kind === 'lore') this.discovered.add(id);
    });
    this.events.on('died', ({ cause }) => {
      this.deathCause = cause;
      this.dropPack();
      this.input.exitPointerLock();
      this.death.show(cause);
      this.hud.setVisible(false);
    });
  }

  private registerSaves(): void {
    this.saves.register('player', {
      save: () => {
        const p = this.player.position;
        return { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw, pitch: this.player.pitch };
      },
      load: (data) => {
        const d = data as { x: number; y?: number; z: number; yaw: number; pitch: number };
        this.player.spawn(d.x, d.z, d.yaw, d.y);
        this.player.pitch = d.pitch ?? 0;
      },
    });
    this.saves.register('clock', {
      save: () => ({ day: this.clock.day, hours: this.clock.hours }),
      load: (data) => {
        const d = data as { day: number; hours: number };
        this.clock.set(d.day, d.hours);
      },
    });
    this.saves.register('survival', {
      save: () => {
        const s = this.survival;
        return { health: s.health, maxHealth: s.maxHealth, baseMaxStamina: s.baseMaxStamina, stamina: s.stamina, food: s.food, water: s.water, bodyTemp: s.bodyTemp, wetness: s.wetness };
      },
      load: (data) => Object.assign(this.survival, data as object),
    });
    this.saves.register('inventory', {
      save: () => ({ slots: this.inventory.serialize(), selected: this.inventory.selected }),
      load: (data) => {
        const d = data as { slots: (ItemStack | null)[]; selected: number };
        this.inventory.load(d.slots);
        this.inventory.select(d.selected ?? 0);
      },
    });
    this.saves.register('discoveries', {
      save: () => [...this.discovered],
      load: (data) => {
        this.discovered.clear();
        for (const id of data as string[]) this.discovered.add(id);
      },
    });
    this.saves.register('structures', {
      save: () => ({ ...this.structures.serialize(), spawn: this.spawnPoint }),
      load: (data) => {
        const d = data as ReturnType<Structures['serialize']> & { spawn?: { x: number; z: number; yaw: number } };
        this.structures.load(d);
        if (d.spawn) this.spawnPoint = d.spawn;
      },
    });
    this.saves.register('quests', {
      save: () => this.quests.serialize(),
      load: (data) => this.quests.load(data),
    });
    this.saves.register('map', {
      save: () => this.mapScreen.serialize(),
      load: (data) => this.mapScreen.load(data as { fog: string; pins: MapPin[] }),
    });
    this.saves.register('weather', {
      save: () => this.weather.serialize(),
      load: (data) => this.weather.load(data),
    });
    this.saves.register('harvest', {
      save: () => ({ trees: this.vegetation.serializeHarvest(), props: this.props.serialize() }),
      load: (data) => {
        const d = data as { trees: [string, number][]; props: [string, number][] };
        this.vegetation.loadHarvest(d.trees ?? []);
        this.props.load(d.props ?? []);
      },
    });
    this.saves.register('building', {
      save: () => this.building.serialize(),
      load: (data) => this.building.load(data as ReturnType<Building['serialize']>),
    });
    this.saves.register('wardens', {
      save: () => ({ mossback: this.wardens.serialize() }),
      load: (data) => this.wardens.load((data as { mossback?: { calmed?: boolean } }).mossback ?? null),
    });
    this.saves.register('meta', {
      save: () => ({ playtime: this.playtime }),
      load: (data) => {
        this.playtime = (data as { playtime: number }).playtime ?? 0;
      },
    });
  }

  private applySettings(): void {
    const s = this.settings.all;
    this.input.settings.mouseSensitivity = s.mouseSensitivity;
    this.input.settings.padSensitivity = s.padSensitivity;
    this.input.settings.invertY = s.invertY;
    this.input.settings.toggleSprint = s.toggleSprint;
    this.input.settings.toggleCrouch = s.toggleCrouch;
    this.reducedMotion = s.reducedMotion;
    this.survival.difficulty = s.difficulty;
    this.pipeline.post.colorblind = s.colorblind;
    this.pipeline.post.manualExposure = s.brightness;
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    this.hud?.setOpacity(s.hudOpacity);
    document.documentElement.dataset.subtitles = s.subtitles ? s.subtitleSize : 'off';
    this.fpsEl?.classList.toggle('show', s.showFps);
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.ambienceVolume);
  }

  // -------------------------------------------------------------------------
  // Modes

  private startPlay(resumeSlot: string | null, intro = false): void {
    this.mode = 'play';
    this.stateName = 'play';
    this.title?.hide();
    this.menu?.hide();
    this.menuPaused = false;
    this.input.gameplayEnabled = true;
    this.wake = -1;
    this.player.spawn(CAMP_SPAWN.x, CAMP_SPAWN.z, CAMP_SPAWN.yaw);
    this.clock.set(1, 7.6);
    this.weather.set('clear', true);
    this.weather.groundWetness = 0;
    this.spawnPoint = { ...CAMP_SPAWN };
    this.playtime = 0;
    // A fresh game starts with a clean pack and rested body.
    for (let i = 0; i < this.inventory.slots.length; i += 1) this.inventory.slots[i] = null;
    this.inventory.select(0);
    this.survival.maxHealth = 100;
    this.survival.baseMaxStamina = 100;
    this.survival.revive();
    this.survival.health = this.survival.maxHealth;
    this.survival.food = 82;
    this.survival.water = 76;
    this.discovered.clear();
    this.seen.clear();
    this.quests?.reset();
    this.wardens?.load(null);
    this.building?.load(null);
    const loaded = resumeSlot ? this.saves.load(resumeSlot) : null;
    if (loaded) {
      if (resumeSlot === 'session') this.events.emit('notify', { text: `Graphics set to ${this.quality.name === 'extra' ? 'Extra High' : this.quality.name[0].toUpperCase() + this.quality.name.slice(1)}`, icon: 'gear', tone: 'info' });
      else this.events.emit('notify', { text: `Day ${loaded.day} · ${loaded.location}`, icon: 'moon', tone: 'info' });
      // Never wake a dead survivor.
      if (this.survival.health <= 0) this.survival.revive();
    } else {
      this.inventory.add('berries', 4);
    }
    this.hud.setVisible(!intro);
    this.pipeline.resetExposure();
    this.view.update(0, this.player, this.camera, this.viewOptions());
    this.vegetation.prewarm(this.player.position.x, this.player.position.z, 260);
    this.props.prewarm(this.player.position.x, this.player.position.z);
    if (!intro) this.quests?.refresh();
  }

  /** The title: a slow drift through the island behind the menu. */
  private enterTitle(): void {
    this.mode = 'title';
    this.stateName = 'title';
    this.hud.setVisible(false);
    this.input.gameplayEnabled = false;
    this.input.exitPointerLock();
    this.cutTo(this.titleCam.reset());
    this.titleCam.update(0, this.camera);
    this.title.show();
  }

  private cutTo(shot: ShotStart): void {
    this.clock.set(1, shot.hour);
    this.weather.set(shot.weather, true);
    this.vegetation.prewarm(shot.x, shot.z, 260);
    this.props.prewarm(shot.x, shot.z);
    this.pipeline.resetExposure();
  }

  private updateTitle(dt: number): void {
    this.hoursElapsed = 0;
    const cut = this.titleCam.update(dt, this.camera);
    if (cut) this.cutTo(cut);
    this.clock.set(1, this.titleCam.hour);
  }

  /** A new journey: set the difficulty and wake at the crash site. */
  private newGame(difficulty: Difficulty): void {
    this.settings.set('difficulty', difficulty);
    this.startPlay(null, true);
    this.introHold = true;
    this.pipeline.post.fade = 1;
  }

  /** Newest of the autosave and the quality-reload session save. */
  private latestSave(): SaveMeta | null {
    const auto = this.saves.meta('auto');
    const session = this.saves.meta('session');
    if (!auto) return session;
    if (!session) return auto;
    return auto.savedAt >= session.savedAt ? auto : session;
  }

  private quitToTitle(): void {
    if (this.survival.alive) this.saveSession('auto');
    // A fresh boot guarantees a clean world behind the title (the world data is cached).
    this.stop();
    location.reload();
  }

  /** On death: explorer keeps everything, survivor drops the pack, harsh loses it. */
  private dropPack(): void {
    const difficulty = this.settings.get('difficulty');
    if (difficulty === 'explorer') return;
    const items = this.inventory.slots.map((s) => (s ? { ...s } : null));
    if (!items.some(Boolean)) return;
    for (let i = 0; i < this.inventory.slots.length; i += 1) this.inventory.slots[i] = null;
    this.events.emit('inventoryChanged', {});
    if (difficulty === 'harsh') return;
    // The pack comes to rest on dry ground: in deep water, the nearest shore.
    const p = this.player.position;
    let x = p.x;
    let z = p.z;
    if (this.world.waterDepthAt(x, z) > 0.6) {
      search: for (let r = 4; r <= 160; r += 4) {
        for (let k = 0; k < 24; k += 1) {
          const a = (k / 24) * Math.PI * 2;
          const qx = p.x + Math.cos(a) * r;
          const qz = p.z + Math.sin(a) * r;
          if (this.world.waterDepthAt(qx, qz) < -0.05) {
            x = qx;
            z = qz;
            break search;
          }
        }
      }
    }
    this.structures.drop('satchel', x, z, this.player.yaw, { contents: items });
  }

  private respawn(): void {
    this.death.hide();
    this.survival.revive();
    const sp = this.spawnPoint;
    this.player.spawn(sp.x, sp.z, sp.yaw);
    this.deathCause = null;
    this.pipeline.post.damage = 0;
    this.hud.setVisible(true);
    this.events.emit('respawned', { x: sp.x, z: sp.z });
    if (this.structures.all.some((d) => d.type === 'satchel')) this.events.emit('notify', { text: 'Your pack lies where you fell', icon: 'bag', tone: 'warn' });
    this.pipeline.resetExposure();
    this.input.requestPointerLock();
  }

  private openInventory(chest: StructureData | null = null): void {
    this.openContainer = chest;
    this.inventoryScreen.show(chest?.contents ?? null, chest ? Structures.label(chest.type) : '');
    this.input.gameplayEnabled = false;
    this.input.exitPointerLock();
  }

  /** Conversation with a survivor: quest lines first, small talk otherwise. */
  private talkTo(npc: string): void {
    const step = this.quests.talkStepFor(npc);
    const key = step ? `${npc}:${step.quest.id}:${step.step.id}` : `${npc}:idle`;
    const lines = DIALOGUE[key] ?? DIALOGUE[`${npc}:idle`] ?? [];
    this.dialogue.show(lines, () => {
      if (step) this.quests.progress('talk', npc);
    });
  }

  private openJournal(): void {
    this.journal.show(this.quests, this.discovered);
    this.input.gameplayEnabled = false;
    this.input.exitPointerLock();
    this.audio.ui('open');
  }

  private closeJournal(): void {
    this.journal.hide();
    this.input.gameplayEnabled = true;
    this.input.requestPointerLock();
    this.audio.ui('close');
  }

  private openMap(): void {
    const p = this.player.position;
    this.mapScreen.show({ x: p.x, z: p.z, yaw: this.player.yaw }, this.discovered, this.seen);
    this.input.gameplayEnabled = false;
    this.input.exitPointerLock();
    this.audio.ui('open');
  }

  private closeMap(): void {
    this.mapScreen.hide();
    this.input.gameplayEnabled = true;
    this.input.requestPointerLock();
    this.audio.ui('close');
  }

  private closeInventory(): void {
    const container = this.openContainer;
    this.openContainer = null;
    if (container?.type === 'satchel' && (container.contents ?? []).every((s) => !s)) {
      this.structures.remove(container.id);
      this.events.emit('notify', { text: 'Pack recovered', icon: 'bag', tone: 'good' });
    }
    this.inventoryScreen.hide();
    this.input.gameplayEnabled = true;
    this.input.requestPointerLock();
  }

  private openMenu(): void {
    const onTitle = this.mode === 'title';
    this.menu.show(onTitle ? 'title' : 'pause');
    // The title keeps drifting behind its settings; play pauses.
    this.menuPaused = !onTitle;
    this.input.gameplayEnabled = false;
    this.input.exitPointerLock();
    if (onTitle) this.title.hide();
  }

  private closeMenu(): void {
    this.menu.hide();
    this.menuPaused = false;
    if (this.mode === 'title') {
      this.title.show();
      return;
    }
    this.input.gameplayEnabled = true;
    this.input.requestPointerLock();
  }

  private reloadWithQuality(): void {
    // From the title, simply come back to the title.
    if (this.mode === 'play') {
      this.saveSession();
      SaveSystem.markResume();
    }
    const url = new URL(location.href);
    url.searchParams.delete('quality');
    location.replace(url.toString());
  }

  private saveSession(slot = 'session'): void {
    if (this.mode !== 'play') return;
    const p = this.player.position;
    this.saves.save(slot, {
      day: this.clock.day,
      hours: this.clock.hours,
      location: BIOMES[this.world.dominantBiome(p.x, p.z)].name,
      playtime: this.playtime,
    });
  }

  private propOptions(): PropOptions {
    const q = this.quality.name;
    const pick = <T,>(values: [T, T, T, T, T]): T => values[['low', 'medium', 'high', 'extra', 'max'].indexOf(q)];
    return {
      largeRadius: pick([260, 380, 520, 700, 900]),
      smallRadius: pick([45, 60, 75, 90, 110]),
      lod0: pick([30, 40, 50, 62, 78]),
      lod1: pick([110, 140, 180, 220, 280]),
    };
  }

  private skinCorpse(corpse: import('../creatures/Wildlife').Creature): void {
    const knife = this.inventory.held ? itemDef(this.inventory.held.id).tool?.kind === 'knife' : false;
    for (const [item, n] of this.wildlife.loot(corpse, knife)) this.inventory.add(item, n);
    this.events.emit('gathered', { resource: `corpse:${corpse.species.id}`, x: corpse.pos.x, y: corpse.pos.y, z: corpse.pos.z });
  }

  /** Where the tracked objective points on the compass. */
  private questTargetPosition(): { x: number; z: number } | null {
    const id = this.quests.tracked;
    if (!id) return null;
    const cur = this.quests.currentStep(id);
    if (!cur) return null;
    const step = cur.step;
    const lmPos = (lid: string) => {
      const l = LANDMARKS.find((d) => d.id === lid);
      return l ? { x: l.x, z: l.z } : null;
    };
    if (step.kind === 'discover') return lmPos(step.target);
    if (step.kind === 'talk') {
      const p = this.story.npcPosition(step.target);
      return p ? { x: p.x, z: p.z } : lmPos('crash_camp');
    }
    const byFlag: Record<string, string> = {
      read_mural: 'singing_stones',
      stones_tuned: 'singing_stones',
      vault_open: 'tocks_vault',
      found_log: 'meridian_tail',
      saw_stillheart: 'rim_lookout',
      echo_lantern: 'singing_stones',
      duskhound: 'hollow_elder',
      warden_hollowpine: 'bell_hollowpine',
      rung_bell_hollowpine: 'bell_hollowpine',
    };
    const lid = byFlag[step.target];
    return lid ? lmPos(lid) : null;
  }

  private readonly tmpOrigin = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private dismantleTimer = 0;
  private dismantleTarget: Piece | null = null;

  private targetDistance(): number {
    const t = this.gathering.target;
    if (!t) return Infinity;
    const p = this.camera.position;
    if (t.kind === 'water') return Math.hypot(t.x - p.x, t.z - p.z);
    return Math.hypot(t.hit.x - p.x, t.hit.z - p.z);
  }

  private structurePrompt(d: StructureData): { key: string | null; text: string } {
    const name = Structures.label(d.type);
    switch (d.type) {
      case 'campfire': {
        const fuel = d.fuel ?? 0;
        if (fuel <= 0) return this.inventory.has('wood') ? { key: 'E', text: 'Light Campfire (1 wood)' } : { key: null, text: 'Campfire · needs wood' };
        return this.inventory.has('wood') ? { key: 'E', text: `Add Wood · burns ${fuel.toFixed(1)} h` } : { key: null, text: `Campfire · burns ${fuel.toFixed(1)} h` };
      }
      case 'bedroll': {
        const night = this.clock.hours > 18.5 || this.clock.hours < 5.5;
        return night ? { key: 'E', text: 'Sleep until morning' } : { key: 'E', text: 'Set as camp' };
      }
      case 'chest':
        return { key: 'E', text: 'Open Storage Chest' };
      case 'rain_collector':
        return (d.water ?? 0) >= 1 ? { key: 'E', text: `Drink · ${Math.floor(d.water ?? 0)} sips` } : { key: null, text: 'Rain Collector · empty' };
      case 'farm_plot': {
        if (!d.crop) return this.inventory.has('seeds') ? { key: 'E', text: 'Plant Seeds' } : { key: null, text: 'Farm Plot · needs seeds' };
        const left = d.crop.ready - this.clock.totalHours;
        return left <= 0 ? { key: 'E', text: 'Harvest' } : { key: null, text: `Growing · ${Math.ceil(left)} h` };
      }
      case 'lantern_post':
        return { key: null, text: name };
      case 'satchel':
        return { key: 'E', text: 'Recover your pack' };
      default:
        return { key: 'E', text: `Use ${name}` };
    }
  }

  private useStructure(d: StructureData): void {
    switch (d.type) {
      case 'campfire':
        if (this.inventory.remove('wood', 1)) {
          d.fuel = (d.fuel ?? 0) + 2.5;
          this.events.emit('notify', { text: 'The fire takes', icon: 'campfire', tone: 'good' });
        }
        break;
      case 'bedroll': {
        this.spawnPoint = { x: d.x + 1.2, z: d.z, yaw: this.player.yaw };
        const night = this.clock.hours > 18.5 || this.clock.hours < 5.5;
        if (night) this.sleep();
        else this.events.emit('notify', { text: 'You will wake here', icon: 'bedroll', tone: 'info' });
        break;
      }
      case 'chest':
      case 'satchel':
        this.openInventory(d);
        break;
      case 'rain_collector':
        if ((d.water ?? 0) >= 1) {
          d.water = (d.water ?? 0) - 1;
          this.survival.drink(20);
        }
        break;
      case 'farm_plot':
        if (!d.crop && this.inventory.remove('seeds', 1)) {
          d.crop = { planted: this.clock.totalHours, ready: this.clock.totalHours + 36 };
          this.events.emit('notify', { text: 'Seeds planted · ready in a day and a half', icon: 'seed', tone: 'good' });
        } else if (d.crop && d.crop.ready <= this.clock.totalHours) {
          d.crop = null;
          this.inventory.add('berries', 6);
          this.inventory.add('seeds', 2);
          this.inventory.add('fiber', 3);
        }
        break;
      default:
        this.openInventory();
    }
  }

  /** A freed Bellstone tolls: a memory plays through it and the grove gives thanks. */
  private ringBell(id: string): void {
    this.audio.bellToll();
    this.view.addTrauma(0.3);
    this.pipeline.post.flash = 0.7;
    const lines = BELL_MEMORIES[id] ?? [];
    lines.forEach((line, i) => {
      window.setTimeout(() => this.events.emit('subtitle', { speaker: line.speaker, text: line.text, duration: 6.5 }), 1800 + i * 7000);
    });
    if (id === 'bell_hollowpine') {
      this.events.emit('discovered', { id: 'lore:mossback', name: 'Mossback', kind: 'lore' });
      this.inventory.add('warden_antler', 1);
      this.inventory.add('songstone', 3);
    }
    this.saveSession('auto');
  }

  /**
   * Built pieces under the aim can be taken down by holding interact; half
   * the wood comes back. Returns the prompt (null when not aiming at one).
   */
  private dismantlePrompt(origin: THREE.Vector3, dir: THREE.Vector3, gatherDist: number, act: boolean, dt: number): { key: string | null; text: string } | null {
    const piece = this.building.pick(origin, dir, 3.4);
    if (!piece) {
      if (act) this.dismantleTimer = 0;
      return null;
    }
    const hit = this.building.raycast(origin, dir, 3.4);
    if (!hit || hit.t > gatherDist) return null;
    const name = Building.label(piece.type);
    if (!this.building.canRemove(piece)) return { key: null, text: `${name} · holding up other pieces` };
    if (act) {
      if (this.input.isDown('interact') && this.dismantleTarget === piece) this.dismantleTimer += dt;
      else this.dismantleTimer = 0;
      this.dismantleTarget = piece;
      if (this.dismantleTimer > 0.9) {
        this.dismantleTimer = 0;
        const wood = this.building.remove(piece);
        this.inventory.add('wood', wood);
        this.audio.hit('timber');
        this.events.emit('notify', { text: `${name} taken down`, icon: 'build', tone: 'info' });
      }
    }
    const progress = this.dismantleTimer > 0 ? ` ${Math.round((this.dismantleTimer / 0.9) * 100)}%` : '';
    return { key: 'E', text: `Hold to dismantle ${name}${progress}` };
  }

  /** Sleep through the night: time jumps to dawn, body recovers, needs drop. */
  private sleep(): void {
    const target = 6.25;
    const hours = (target - this.clock.hours + 24) % 24;
    this.clock.set(this.clock.day + (this.clock.hours > target ? 1 : 0), target);
    this.hoursElapsed = hours;
    this.survival.food = Math.max(5, this.survival.food - hours * 1.6);
    this.survival.water = Math.max(5, this.survival.water - hours * 2);
    this.survival.heal(40);
    this.survival.stamina = this.survival.maxStamina;
    this.survival.bodyTemp = Math.max(this.survival.bodyTemp, 36.6);
    this.pipeline.post.fade = 1;
    this.pipeline.resetExposure();
    this.events.emit('notify', { text: `You slept ${Math.round(hours)} hours`, icon: 'moon', tone: 'info' });
    this.saveSession('auto');
  }

  private gatherContext(): GatherContext {
    const p = this.player.position;
    this.gatherCtx.camera = this.camera;
    this.gatherCtx.totalHours = this.clock.totalHours;
    this.gatherCtx.playerX = p.x;
    this.gatherCtx.playerZ = p.z;
    this.gatherCtx.inWater = this.player.state === 'swim';
    return this.gatherCtx;
  }

  private viewOptions() {
    const s = this.settings.all;
    return { fov: s.fov, headBob: s.headBob, shake: s.cameraShake, reducedMotion: s.reducedMotion || this.reducedMotion };
  }

  // -------------------------------------------------------------------------
  // Loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (time: number) => {
      if (!this.running) return;
      const dt = Math.min(Math.max((time - this.lastTime) / 1000, 0), 0.1);
      this.lastTime = time;
      try {
        this.update(dt);
        this.render(dt);
      } catch (error) {
        this.errors.push(error instanceof Error ? error.message : String(error));
        console.error(error);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private update(dt: number): void {
    this.frame += 1;
    this.input.poll();
    if (this.input.wasPressed('debug', true)) {
      this.debugVisible = !this.debugVisible;
      this.debugEl?.classList.toggle('show', this.debugVisible);
    }
    if (this.title.isIntroPlaying) {
      // Narration: Esc skips it, E / Space / click move to the next line.
      if (this.input.wasPressed('pause', true)) this.title.skipIntro();
      else if (this.input.wasPressed('interact', true) || this.input.wasPressed('jump', true)) this.title.skipIntroLine();
    } else if (this.mode === 'title') {
      if (this.menu.isOpen && this.input.wasPressed('pause', true)) this.closeMenu();
    } else if (this.mode === 'play' && this.survival.alive && !this.menu.isOpen && !this.inventoryScreen.isOpen && !this.mapScreen.isOpen && (this.input.wasPressed('journal', true) || (this.journal.isOpen && this.input.wasPressed('pause', true)))) {
      if (this.journal.isOpen) this.closeJournal();
      else this.openJournal();
    } else if (this.mode === 'play' && this.survival.alive && !this.menu.isOpen && !this.inventoryScreen.isOpen && !this.journal.isOpen && (this.input.wasPressed('map', true) || (this.mapScreen.isOpen && this.input.wasPressed('pause', true)))) {
      if (this.mapScreen.isOpen) this.closeMap();
      else this.openMap();
    } else if (this.mode === 'play' && this.survival.alive && !this.menu.isOpen && !this.mapScreen.isOpen && (this.input.wasPressed('inventory', true) || (this.inventoryScreen.isOpen && this.input.wasPressed('pause', true)))) {
      if (this.inventoryScreen.isOpen) this.closeInventory();
      else this.openInventory();
    } else if (this.input.wasPressed('pause', true) && this.mode === 'play' && this.survival.alive) {
      if (this.menu.isOpen) this.closeMenu();
      else this.openMenu();
    }
    const frozen = this.paused || this.menuPaused || this.introHold;
    if (!frozen) {
      this.elapsed += dt;
      if (this.mode === 'title') this.updateTitle(dt);
      else {
        this.hoursElapsed = this.clock.update(dt);
        if (this.mode === 'fly') this.flyCam.update(dt);
        else this.updatePlay(dt);
      }
    }
    this.veilEl?.classList.toggle('show', this.mode === 'play' && !this.input.pointerLocked && !this.menu.isOpen && !this.inventoryScreen.isOpen && !this.mapScreen.isOpen && !this.journal.isOpen && this.survival.alive && this.frame > 30);
    this.input.endFrame();
  }

  private updatePlay(dt: number): void {
    this.playtime += dt;
    const input = this.input;
    const alive = this.survival.alive;
    if (this.wake >= 0) {
      this.updateWake(dt);
      return;
    }
    this.dialogue.update(dt);
    if (this.dialogue.isOpen) {
      if (input.wasPressed('interact') || input.wasPressed('attack') || input.wasPressed('jump')) this.dialogue.advance();
      input.look(dt, this.look);
      this.player.yaw -= this.look.x * 0.3;
      this.player.update(dt, { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, sprint: false, crouch: false });
      this.survival.update(dt, this.climate());
      this.story.update(dt);
      return;
    }
    if (alive) {
      input.look(dt, this.look);
      this.player.yaw -= this.look.x;
      this.player.pitch = clamp(this.player.pitch - this.look.y, -1.52, 1.52);
      input.movement(this.move);
      this.intent.moveX = this.move.x;
      this.intent.moveY = this.move.y;
      this.intent.jumpPressed = input.wasPressed('jump');
      this.intent.jumpHeld = input.isDown('jump');
      this.intent.sprint = input.isDown('sprint');
      this.intent.crouch = input.isDown('crouch');
    } else {
      this.intent.moveX = 0;
      this.intent.moveY = 0;
      this.intent.jumpPressed = false;
      this.intent.jumpHeld = false;
      this.intent.sprint = false;
      this.intent.crouch = false;
    }
    this.player.update(dt, this.intent);
    this.survival.update(dt, this.climate());

    // Hotbar.
    for (let i = 0; i < HOTBAR_ACTIONS.length; i += 1) if (input.wasPressed(HOTBAR_ACTIONS[i])) this.inventory.select(i);
    if (input.wasPressed('hotbarNext')) this.inventory.select(this.inventory.selected + 1);
    if (input.wasPressed('hotbarPrev')) this.inventory.select(this.inventory.selected - 1);

    // Looking at things and working them.
    const ctx = this.gatherContext();
    const canAct = alive && (input.pointerLocked || this.testInput);
    const held = this.inventory.held;
    const places = held ? itemDef(held.id).places : undefined;
    const pieceType = isPieceType(places) ? places : null;
    const placeType = places && !pieceType ? (places as StructureType) : undefined;
    let prompt: { key: string | null; text: string } | null = null;
    const rotate = canAct && input.wasPressed('rotate');
    const ghostText = this.structures.updateGhost(alive && placeType ? placeType : null, this.camera, rotate);
    const pieceText = this.building.updateGhost(alive && pieceType ? pieceType : null, this.camera, rotate, (o, d, max, out) => this.world.raycast(o, d, max, out));
    if (pieceText) {
      prompt = { key: this.building.ghostValid ? 'LMB' : null, text: pieceText };
      if (canAct && input.wasPressed('attack') && this.building.placeGhost()) {
        this.inventory.consumeSlot(this.inventory.selected, 1);
        this.audio.hit('wood');
      }
    } else if (ghostText) {
      prompt = { key: this.structures.ghostValid ? 'LMB' : null, text: ghostText };
      if (canAct && input.wasPressed('attack') && this.structures.placeGhost()) this.inventory.consumeSlot(this.inventory.selected, 1);
    } else if (alive) {
      prompt = this.gathering.updateTarget(ctx);
      const origin = this.camera.getWorldPosition(this.tmpOrigin);
      const dir = this.camera.getWorldDirection(this.tmpDir);
      const structure = this.structures.pick(origin, dir, 3.2);
      const gatherDist = this.gathering.target ? this.targetDistance() : Infinity;
      const corpse = this.wildlife.corpseNear(origin, dir, 2.8);
      const storyTarget = this.story.pick(origin, dir, 3.2);
      if (storyTarget) {
        prompt = storyTarget.prompt();
        if (canAct && input.wasPressed('interact') && prompt?.key) storyTarget.use();
        if (canAct && input.wasPressed('attack')) this.gathering.use(ctx);
      } else if (corpse) {
        const knife = this.inventory.held ? itemDef(this.inventory.held.id).tool?.kind === 'knife' : false;
        prompt = { key: 'E', text: `${knife ? 'Skin' : 'Butcher'} ${corpse.species.name}` };
        if (canAct && input.wasPressed('interact')) this.skinCorpse(corpse);
        if (canAct && input.wasPressed('attack')) this.gathering.use(ctx);
      } else if (structure && Math.hypot(structure.x - origin.x, structure.z - origin.z) < gatherDist) {
        prompt = this.structurePrompt(structure);
        if (canAct && input.wasPressed('interact')) this.useStructure(structure);
      } else if (this.dismantlePrompt(origin, dir, gatherDist, canAct, dt)) {
        prompt = this.dismantlePrompt(origin, dir, gatherDist, false, 0);
      } else {
        if (canAct && input.wasPressed('interact')) this.gathering.interact(ctx);
        if (canAct && input.wasPressed('attack')) this.gathering.use(ctx);
      }
    }
    this.gathering.update(dt, ctx);
    this.hud.setPrompt(prompt ? (prompt.key === 'LMB' ? this.input.bindingLabel('attack') : prompt.key === 'E' ? this.input.bindingLabel('interact') : null) : null, prompt ? prompt.text : null);
    this.structures.update(dt, this.hoursElapsed, this.elapsed, this.player.position.x, this.player.position.z, 0);
    this.wildlife.update(dt, this.elapsed, this.camera);
    this.wardens.update(dt);
    this.story.update(dt);
    this.quests.refresh();
    this.vegetation.tick(dt, this.clock.totalHours);
    this.props.tick(this.clock.totalHours);

    this.updateDiscovery(dt);
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 60 && alive) {
      this.autosaveTimer = 0;
      this.saveSession('auto');
    }
  }

  /**
   * Coming to after the crash: eyes open on the sky through the birches, a
   * slow blink, then the head comes down to the camp and control returns.
   */
  private updateWake(dt: number): void {
    const before = this.wake;
    this.wake += dt;
    const w = this.wake;
    const lower = smoothstep(2.6, 5.4, w);
    this.player.pitch = 1.05 * (1 - lower) - 0.06 * lower;
    this.player.yaw = CAMP_SPAWN.yaw + 0.35 * (1 - lower);
    this.intent.moveX = 0;
    this.intent.moveY = 0;
    this.intent.jumpPressed = false;
    this.intent.jumpHeld = false;
    this.intent.sprint = false;
    this.intent.crouch = w < 4.2;
    this.player.update(dt, this.intent);
    this.story.update(dt);
    if (before < 3.2 && w >= 3.2) this.events.emit('subtitle', { speaker: '', text: 'Woodsmoke on the wind. Voices, not far off.', duration: 5 });
    if (w >= 5.6) {
      this.wake = -1;
      this.hud.setVisible(true);
      this.quests.refresh();
    }
  }

  /** Felt climate at the player (weather joins in with the weather system). */
  private climate(): Climate {
    const p = this.player.position;
    const weights = this.world.biomeWeights(p.x, p.z, this.biomeScratch);
    let base = 0;
    let total = 0;
    for (let b = 0; b < BIOME_COUNT; b += 1) {
      base += weights[b] * BIOMES[b].temperature;
      total += weights[b];
    }
    base /= Math.max(total, 1e-3);
    const hours = this.clock.hours;
    const diurnal = 3.2 * Math.sin(((hours - 9) / 24) * Math.PI * 2) - 1.8;
    const altitude = Math.max(0, p.y - 25) * 0.075;
    const water = this.playerWater;
    let heat = 0;
    for (const lake of this.world.lakes) {
      if (!lake.hot) continue;
      const d = Math.hypot(p.x - lake.x, p.z - lake.z);
      heat += 10 * (1 - smoothstep(lake.radius, lake.radius + 18, d));
    }
    heat += this.structures.heatAt(p.x, p.y + 1, p.z);
    const inWater = this.player.state === 'swim';
    const ws = this.weather.state;
    const sheltered = this.building.sheltered(p.x, p.y, p.z);
    return {
      airTemperature: base + diurnal - altitude + ws.chill - ws.wind * (sheltered ? 0.5 : 2),
      precipitation: sheltered ? 0 : Math.min(1, ws.rain + ws.snow * 0.6),
      heat,
      inWater,
      waterTemperature: water.hot ? 38 : 9 + base * 0.35,
      sheltered,
      resting: false,
    };
  }

  private updateDiscovery(dt: number): void {
    const p = this.player.position;
    // Biome names announce themselves when you cross into a new region.
    this.biomeTimer -= dt;
    if (this.biomeTimer <= 0) {
      this.biomeTimer = 0.5;
      this.mapScreen.reveal(p.x, p.z);
      const biome = this.world.dominantBiome(p.x, p.z);
      if (biome !== this.currentBiome) {
        const first = this.currentBiome === -1;
        this.currentBiome = biome;
        this.events.emit('biomeChanged', { biome, name: BIOMES[biome].name });
        if (!first) this.events.emit('discovered', { id: `biome:${biome}`, name: BIOMES[biome].name, kind: 'biome' });
      }
      // Landmarks: seen from afar adds them to the compass; walking up discovers them.
      for (const lm of LANDMARKS) {
        const d = Math.hypot(lm.x - p.x, lm.z - p.z);
        if (!this.seen.has(lm.id) && d < 260) this.seen.add(lm.id);
        if (!this.discovered.has(lm.id) && d < Math.max(28, (lm.pad?.radius ?? 16) + 10)) {
          this.discovered.add(lm.id);
          this.seen.add(lm.id);
          this.events.emit('discovered', { id: lm.id, name: lm.name, kind: 'landmark' });
        }
      }
    }
  }

  private updateEnvironment(dt: number): void {
    const hours = this.clock.hours;
    const day = this.clock.day;
    sunDirection(hours, this.sunDir);
    moonDirection(day, hours, this.moonDir);
    const phase = moonPhase(day, hours);
    const moonLight = moonIllumination(phase);
    starRotation(day, hours, this.starMatrix4);
    this.starMatrix.setFromMatrix4(this.starMatrix4);

    this.pipeline.atmosphere.uniforms.uSunDir.value.copy(this.sunDir);
    const a = this.pipeline.atmosphere.uniforms;
    // Dominant light for shadows: whichever of sun/moon is brighter here.
    const sunI = SUN_ILLUMINANCE * THREE.MathUtils.smoothstep(this.sunDir.y, -0.04, 0.06);
    const moonI = MOON_ILLUMINANCE * (0.25 + 0.75 * moonLight) * THREE.MathUtils.smoothstep(this.moonDir.y, -0.02, 0.1);
    const useSun = sunI >= moonI;
    this.light.direction.copy(useSun ? this.sunDir : this.moonDir);
    this.light.color.copy(useSun ? a.uSunColor.value : a.uMoonColor.value);
    this.light.intensity = useSun ? sunI : moonI;
    this.lighting.update(this.light.direction, this.light.color, this.light.intensity);
    void dt;
  }

  private render(dt: number): void {
    const t = performance.now();
    if (this.mode === 'play') this.view.update(dt, this.player, this.camera, this.viewOptions());
    this.updateWeather(dt);
    this.updateEnvironment(dt);
    this.terrain.update(this.camera, this.elapsed);
    if (this.mode === 'play') this.grass.setPusher(0, this.player.position, 0.6);
    this.grass.update(this.camera, this.reducedMotion ? 0 : this.elapsed);
    this.vegetationShared.uTime.value = this.reducedMotion ? 0 : this.elapsed;
    this.vegetation.update(this.camera);
    this.props.update(this.camera);
    // Hands come up once the survivor is on their feet.
    this.viewmodel.root.visible = this.mode === 'play' && this.survival.alive && this.wake < 0 && !this.introHold;
    if (this.mode === 'play') {
      const held = this.inventory.held;
      this.viewmodel.update(dt, {
        held: held ? held.id : null,
        swing: this.gathering.swingProgress,
        speed: this.player.speed,
        sprinting: this.player.sprinting,
        lookX: this.look.x,
        lookY: this.look.y,
        grounded: this.player.grounded,
        reducedMotion: this.viewOptions().reducedMotion,
        climbing: this.player.state === 'climb',
        swimming: this.player.state === 'swim',
      });
      // New tool meshes need CSM shadow setup once.
      this.viewmodel.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.Material;
        if (m.type === 'MeshStandardMaterial' && !this.viewmodelSetupDone.has(m.uuid)) {
          this.viewmodelSetupDone.add(m.uuid);
          this.lighting.setupMaterial(m);
        }
      });
    }
    this.renderer.info.reset();
    const time = this.reducedMotion ? 0 : this.elapsed;
    this.water.update(this.renderer, this.camera, time, { color: this.pipeline.opaqueColor, depth: this.pipeline.opaqueDepth }, this.light);
    this.updateUnderwater();
    this.updatePostFeedback(dt);
    this.updateAudio(dt);
    this.pipeline.render(
      dt,
      {
        sunDir: this.sunDir,
        moonDir: this.moonDir,
        moonPhaseLight: moonIllumination(moonPhase(this.clock.day, this.clock.hours)),
        mieScale: this.weather.state.haze,
        cameraAltitude: this.camera.position.y,
      },
      {
        time,
        moonPhaseLight: moonIllumination(moonPhase(this.clock.day, this.clock.hours)),
        starRotation: this.starMatrix,
        aurora: 0,
        cloudCover: THREE.MathUtils.smoothstep(this.pipeline.cloudParams.coverage, 0.62, 0.95),
        resonance: 0,
      },
    );
    if (this.debugTexturePass) this.debugTexturePass.render(this.renderer, null);
    this.timings.frameMs = performance.now() - t;
    this.updateUi(dt);
    this.publishDiagnostics();
  }

  private updateWeather(dt: number): void {
    const cam = this.camera.position;
    const weights = this.world.biomeWeights(cam.x, cam.z, this.weatherWeights);
    const w = this.weather.update(dt, this.paused || this.menuPaused ? 0 : this.hoursElapsed, weights);
    const wind = this.weather.windDir;
    const cp = this.pipeline.cloudParams;
    cp.coverage = w.coverage;
    cp.type = w.cloudType;
    cp.windX = wind.x;
    cp.windZ = wind.y;
    cp.windSpeed = 10 + w.wind * 26;
    const atmo = this.pipeline.atmosphere.uniforms;
    atmo.uFogDensity.value = w.fog;
    atmo.uFogHeight.value = Math.max(0, this.world.heightAt(cam.x, cam.z)) + (w.fog > 0.006 ? 6 : 25);
    atmo.uFogFalloff.value = w.fog > 0.006 ? 0.05 : 0.02;
    this.terrain.uniforms.uWetness.value = this.weather.groundWetness;
    this.vegetationShared.uWindStrength.value = 0.25 + w.wind * 0.95;
    this.vegetationShared.uWindDir.value.set(wind.x, 0, wind.y);
    this.grass.setWind(wind.x, wind.y, 0.35 + w.wind * 1.1);
    this.water.seaState = damp(this.water.seaState, 0.6 + w.wind * 1.9, 0.2, dt);
    this.pipeline.post.flash = Math.max(this.pipeline.post.flash * 0.9, this.weather.flash * 0.35);
    if (this.weather.thunderIn > 0) this.audio.thunder(this.weather.thunderIn, 0.8);
    // Drops catch the light of the sky around them: roughly scene brightness.
    const ambient = this.tmpColor.copy(this.light.color).multiplyScalar(this.light.intensity * 0.3).addScalar(0.04);
    this.precipitation.update(this.elapsed, cam, w, wind.x, wind.y, ambient);
  }

  private readonly weatherWeights = new Float32Array(BIOME_COUNT);
  private readonly tmpColor = new THREE.Color();

  private updateAudio(dt: number): void {
    if (!this.audio.running) return;
    const a = this.audioState;
    const cam = this.camera.position;
    const fwd = this.camera.getWorldDirection(this.tmpDir);
    a.listener.x = cam.x;
    a.listener.y = cam.y;
    a.listener.z = cam.z;
    a.listener.fx = fwd.x;
    a.listener.fy = fwd.y;
    a.listener.fz = fwd.z;
    a.hours = this.clock.hours;
    a.underwater = this.pipeline.post.underwater > 0;
    a.lowHealth = this.mode === 'play' ? this.pipeline.post.lowHealth : 0;
    a.rain = Math.min(1, this.weather.state.rain + this.weather.state.snow * 0.15);
    a.combat = damp(a.combat, this.mode === 'play' && this.wardens.active ? 1 : 0, this.wardens.active ? 2 : 0.35, dt);
    // Surroundings change slowly: probe a few times a second.
    this.audioProbeTimer -= dt;
    if (this.audioProbeTimer <= 0) {
      this.audioProbeTimer = 0.4;
      const w = this.world.biomeWeights(cam.x, cam.z, this.biomeScratch);
      const B = BIOMES;
      a.forest = Math.min(1, w[1] * 1 + w[2] * 0.7 + w[0] * 0.3 + w[6] * 0.4 + w[7] * 0.2);
      a.meadow = Math.min(1, w[0] * 1 + w[7] * 0.7 + w[3] * 0.2);
      a.marsh = w[6];
      a.snow = w[5];
      const altitude = Math.max(0, cam.y - 40) / 160;
      a.wind = Math.min(1, 0.2 + altitude * 0.6 + w[5] * 0.35 + w[3] * 0.25 + w[7] * 0.2 + this.weather.state.wind * 0.5);
      const shore = this.water.shoreDistance(cam.x, cam.z);
      a.sea = shore > 0 ? 1 : 1 - smoothstep(8, 220, -shore);
      a.surfPeriod = a.sea > 0.05 ? 9.5 : 0;
      let river = Infinity;
      for (const r of this.world.rivers) {
        const pts = r.points;
        for (let i = 0; i < r.count; i += 4) {
          const d = Math.hypot(pts[i * 6] - cam.x, pts[i * 6 + 1] - cam.z) - pts[i * 6 + 3];
          if (d < river) river = d;
        }
      }
      a.river = 1 - smoothstep(4, 90, river);
      a.fire = Math.min(1, this.structures.heatAt(cam.x, cam.y - 1, cam.z) / 10);
      const biome = this.world.dominantBiome(cam.x, cam.z);
      a.musicMode = B[biome].musicMode;
      a.musicRoot = [62, 57, 64, 55, 61, 53, 58, 60][biome];
    }
    this.audio.update(dt, a);
  }

  private updatePostFeedback(dt: number): void {
    const post = this.pipeline.post;
    post.damage = damp(post.damage, 0, 3, dt);
    const hp = this.survival.health / this.survival.maxHealth;
    post.lowHealth = this.mode === 'play' ? smoothstep(0.35, 0.08, hp) : 0;
    if (this.mode === 'title') post.fade = this.titleCam.fade;
    else if (this.introHold) post.fade = 1;
    else if (this.wake >= 0) {
      // Eyes opening, then one slow blink.
      const w = this.wake;
      const open = 1 - smoothstep(0.3, 1.6, w);
      const blink = Math.max(0, 1 - Math.abs(w - 2.2) / 0.28) * 0.8;
      post.fade = Math.max(open, blink);
    } else post.fade = damp(post.fade, this.deathCause ? 0.85 : 0, 1.5, dt);
  }

  private updateUi(dt: number): void {
    this.fpsFrames += 1;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (this.fpsEl && this.settings.get('showFps')) this.fpsEl.textContent = `${this.fps.toFixed(0)} fps · ${this.quality.name}`;
    }
    if (this.mode !== 'play') return;
    const p = this.player.position;
    this.markers.length = 0;
    for (const lm of LANDMARKS) {
      if (!this.seen.has(lm.id)) continue;
      const dx = lm.x - p.x;
      const dz = lm.z - p.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 12 || distance > 900) continue;
      this.markers.push({ id: lm.id, bearing: bearingOf(dx, dz), distance, kind: 'landmark', label: this.discovered.has(lm.id) ? lm.name : undefined });
    }
    for (const d of this.structures.all) {
      if (d.type !== 'satchel') continue;
      const dx = d.x - p.x;
      const dz = d.z - p.z;
      this.markers.push({ id: d.id, bearing: bearingOf(dx, dz), distance: Math.hypot(dx, dz), kind: 'satchel', label: 'Your pack' });
    }
    const target = this.questTargetPosition();
    if (target) {
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      this.markers.push({ id: 'quest', bearing: bearingOf(dx, dz), distance: Math.hypot(dx, dz), kind: 'quest', label: this.quests.trackedObjective()?.title });
    }
    const heading = (-this.player.yaw * 180) / Math.PI;
    this.hud.update(
      {
        heading,
        markers: this.markers,
        survival: this.survival.snapshot(),
        inventory: this.inventory,
        hours: this.clock.hours,
        day: this.clock.day,
        underwater: this.pipeline.post.underwater > 0,
        weather: WEATHER_LABELS[this.weather.transition > 0.5 ? this.weather.next : this.weather.current],
      },
      dt,
    );
    this.questHud.update(this.quests);
    this.hud.setBoss(this.wardens.status(), dt);
    if (this.debugVisible && this.debugEl) {
      const s = this.survival.snapshot();
      const info = this.renderer.info.render;
      this.debugEl.textContent = [
        `${this.fps.toFixed(0)} fps  ${this.timings.frameMs?.toFixed(1)} ms cpu  ${this.quality.name}`,
        `draws ${info.calls}  tris ${(info.triangles / 1e6).toFixed(2)}M`,
        `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  ${this.player.state}  ${this.player.speed.toFixed(1)} m/s`,
        `biome ${BIOMES[this.world.dominantBiome(p.x, p.z)].name}  surface ${this.surfaceAt(p.x, p.z)}`,
        `felt ${s.feltTemp.toFixed(1)}°C  body ${s.bodyTemp.toFixed(2)}°C  wet ${(s.wetness * 100).toFixed(0)}%`,
        `food ${s.food.toFixed(0)}  water ${s.water.toFixed(0)}  stamina ${s.stamina.toFixed(0)}/${s.maxStamina}`,
        `time day ${this.clock.day} ${this.clock.hours.toFixed(2)}h`,
      ].join('\n');
    }
  }

  /** Underwater post effects when the camera dips below a water surface. */
  private updateUnderwater(): void {
    const cam = this.camera.position;
    const w = this.water.sample(cam.x, cam.z, this.waterSample);
    const below = Number.isFinite(w.surface) && !w.frozen && cam.y < w.surface - 0.05;
    const post = this.pipeline.post;
    post.underwater = below ? 1 : 0;
    if (below) {
      const murk = w.turbidity;
      post.underwaterColor.setRGB(0.01 + 0.02 * murk, 0.05 + 0.01 * murk, 0.06 - 0.03 * murk);
    }
  }

  /** Debug: draw a baked texture (array layer) over the frame (null to clear). */
  showTexture(name: string | null, layer = 0): void {
    this.debugTexturePass?.dispose();
    this.debugTexturePass = null;
    if (!name) return;
    const sources: Record<string, THREE.Texture> = {
      bark: this.foliageTextures.bark.texture,
      barkNormal: this.foliageTextures.barkNormal.texture,
      foliage: this.foliageTextures.foliage.texture,
      foliageNormal: this.foliageTextures.foliageNormal.texture,
      ground: this.baker.albedoHeight.texture,
      groundNormal: this.baker.normalRough.texture,
      impostor: this.vegetation.impostors.albedo.texture,
      impostorNormal: this.vegetation.impostors.normal.texture,
      foam: this.water.foamTarget.texture,
      waveDisp: this.water.waves.displacement(0),
      waveDeriv: this.water.waves.derivatives(1),
    };
    const tex = sources[name];
    if (!tex) throw new Error(`Unknown texture ${name}`);
    const srgb = tex.colorSpace === THREE.SRGBColorSpace;
    const isArray = (tex as THREE.DataArrayTexture).isDataArrayTexture === true;
    const sampler = isArray ? 'sampler2DArray' : 'sampler2D';
    const fetch = isArray ? 'texture(uTex, vec3(f, uLayer))' : 'texture(uTex, f) * uScale + uBias';
    this.debugTexturePass = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: /* glsl */ `
          precision highp sampler2DArray;
          uniform ${sampler} uTex;
          uniform float uLayer;
          uniform float uSrgb;
          uniform float uScale;
          uniform float uBias;
          varying vec2 vUv;
          void main() {
            vec2 uv = vUv * vec2(1.7778, 1.0);
            vec2 cell = floor(uv);
            vec2 f = fract(uv);
            vec4 t = ${fetch};
            vec3 c = mix(vec3(0.5) + 0.1 * mod(floor(f.x * 16.0) + floor(f.y * 16.0), 2.0), t.rgb, t.a > 0.0 ? t.a : 1.0);
            if (uSrgb > 0.5) c = pow(c, vec3(1.0 / 2.2));
            gl_FragColor = vec4(cell.x > 0.5 ? vec3(t.a) : c, 1.0);
          }`,
        uniforms: {
          uTex: { value: tex },
          uLayer: { value: layer },
          uSrgb: { value: srgb ? 1 : 0 },
          // Signed float data (waves) is remapped around mid-grey.
          uScale: { value: tex.type === THREE.HalfFloatType ? 0.5 : 1 },
          uBias: { value: tex.type === THREE.HalfFloatType ? 0.5 : 0 },
        },
      }),
    );
  }

  private vegetationOptions() {
    const q = this.quality;
    return {
      lod0Distance: q.name === 'low' ? 30 : q.name === 'medium' ? 38 : q.name === 'high' ? 45 : q.name === 'extra' ? 58 : 75,
      lod1Distance: q.impostorDistance,
      maxDistance: q.vegetationDistance,
      alphaToCoverage: q.msaa > 0,
      shadowDistance: q.name === 'low' ? 35 : q.name === 'medium' ? 55 : q.name === 'high' ? 80 : q.name === 'extra' ? 115 : 160,
    };
  }

  applyViewpoint(name: string): boolean {
    const vp = viewpointByName(name);
    if (!vp) return false;
    this.mode = 'fly';
    this.hud?.setVisible(false);
    const ground = this.world.heightAt(vp.x, vp.z);
    const water = this.world.waterLevelAt(vp.x, vp.z);
    const pos = new THREE.Vector3(vp.x, Math.max(ground, water) + vp.height, vp.z);
    const [tx, tz, th] = vp.target;
    const target = new THREE.Vector3(tx, this.world.heightAt(tx, tz) + th, tz);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.flyCam.setPose(pos, 0, 0);
    this.flyCam.lookAt(target);
    this.clock.set(this.clock.day, vp.hour);
    this.pipeline.resetExposure();
    this.vegetation?.prewarm(pos.x, pos.z, 260);
    this.stateName = `view:${vp.name}`;
    return true;
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: () => undefined,
      setState: (name: string) => {
        if (name === 'play') {
          this.startPlay(null);
          this.render(0);
          return { state: name };
        }
        if (name === 'title') {
          this.enterTitle();
          this.render(0);
          return { state: name };
        }
        const view = name.startsWith('view-') ? name.slice(5) : name;
        if (!this.applyViewpoint(view)) throw new Error(`Unknown test state: ${name}`);
        this.render(0);
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.paused = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => {
        this.debugVisible = false;
        this.debugEl?.classList.remove('show');
        this.veilEl?.classList.remove('show');
      },
      /** Stop/restart the frame loop entirely (for slow software-rendered captures). */
      freeze: (frozen: boolean) => {
        if (frozen) this.stop();
        else this.start();
      },
      /** Run exactly n update+render cycles synchronously. */
      renderFrames: (n: number, dt = 1 / 60) => {
        for (let i = 0; i < n; i += 1) {
          this.update(dt);
          this.render(dt);
        }
        return this.frame;
      },
      /** Drive the player without a keyboard: {moveX, moveY, sprint, jump, crouch, yaw, pitch}. */
      drive: (intent: { moveX?: number; moveY?: number; sprint?: boolean; jump?: boolean; crouch?: boolean; yaw?: number; pitch?: number }, seconds = 1, dt = 1 / 30) => {
        if (this.mode !== 'play') this.startPlay(null);
        const steps = Math.max(1, Math.round(seconds / dt));
        for (let i = 0; i < steps; i += 1) {
          if (intent.yaw !== undefined) this.player.yaw = intent.yaw;
          if (intent.pitch !== undefined) this.player.pitch = intent.pitch;
          this.intent.moveX = intent.moveX ?? 0;
          this.intent.moveY = intent.moveY ?? 0;
          this.intent.sprint = Boolean(intent.sprint);
          this.intent.crouch = Boolean(intent.crouch);
          this.intent.jumpPressed = Boolean(intent.jump) && i === 0;
          this.intent.jumpHeld = Boolean(intent.jump);
          this.elapsed += dt;
          this.clock.update(dt);
          this.player.update(dt, this.intent);
          this.survival.update(dt, this.climate());
          this.updateDiscovery(dt);
        }
        this.render(dt);
        const p = this.player.position;
        return { x: p.x, y: p.y, z: p.z, state: this.player.state, speed: this.player.speed, stamina: this.survival.stamina, health: this.survival.health };
      },
      teleport: (x: number, z: number, yaw = 0) => {
        if (this.mode !== 'play') this.startPlay(null);
        this.player.spawn(x, z, yaw);
        this.vegetation.prewarm(x, z, 200);
        this.render(0);
        return { x, z };
      },
      give: (id: string, count = 1) => this.inventory.add(id, count),
      /** Point the view at a world position. */
      aim: (x: number, y: number, z: number) => {
        const eye = this.player.position.clone();
        eye.y += this.player.eyeHeight;
        this.player.yaw = Math.atan2(-(x - eye.x), -(z - eye.z));
        this.player.pitch = Math.atan2(y - eye.y, Math.hypot(x - eye.x, z - eye.z));
        this.view.update(0, this.player, this.camera, this.viewOptions());
        const ctx = this.gatherContext();
        const prompt = this.gathering.updateTarget(ctx);
        const origin = this.camera.getWorldPosition(new THREE.Vector3());
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        const structure = this.structures.pick(origin, dir, 3.2);
        return { prompt, structure: structure ? this.structurePrompt(structure) : null };
      },
      /** Perform an action as if the button was pressed: interact | use | place. */
      act: (action: 'interact' | 'use' | 'place', seconds = 1) => {
        this.testInput = true;
        const ctx = this.gatherContext();
        const origin = this.camera.getWorldPosition(new THREE.Vector3());
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        if (action === 'place') {
          const held = this.inventory.held;
          const places = held ? itemDef(held.id).places : undefined;
          if (isPieceType(places)) {
            const text = this.building.updateGhost(places, this.camera, false, (o, d, max, out) => this.world.raycast(o, d, max, out));
            const piece = this.building.placeGhost();
            if (piece) this.inventory.consumeSlot(this.inventory.selected, 1);
            this.building.updateGhost(null, this.camera, false, () => -1);
            return { placed: piece ? piece.type : null, reason: piece ? '' : (text ?? this.building.ghostReason) };
          }
          const type = places as StructureType | undefined;
          this.structures.updateGhost(type ?? null, this.camera, false);
          const placed = this.structures.placeGhost();
          if (placed) this.inventory.consumeSlot(this.inventory.selected, 1);
          this.structures.updateGhost(null, this.camera, false);
          return { placed: placed ? placed.type : null, reason: this.structures.ghostReason };
        }
        this.gathering.updateTarget(ctx);
        const structure = this.structures.pick(origin, dir, 3.2);
        let result = false;
        const corpse = action === 'interact' ? this.wildlife.corpseNear(origin, dir, 2.8) : null;
        if (corpse) {
          this.skinCorpse(corpse);
          result = true;
        } else if (action === 'interact') {
          if (structure) {
            this.useStructure(structure);
            result = true;
          } else result = this.gathering.interact(ctx);
        } else result = this.gathering.use(ctx);
        const steps = Math.round(seconds * 30);
        for (let i = 0; i < steps; i += 1) {
          this.gathering.update(1 / 30, ctx);
          this.vegetation.tick(1 / 30, this.clock.totalHours);
        }
        return { result, target: this.gathering.target ? this.gathering.target.kind : null };
      },
      craft: (recipeId: string) => {
        const recipe = RECIPES.find((r) => r.id === recipeId);
        if (!recipe) throw new Error(`Unknown recipe ${recipeId}`);
        return craft(recipe, this.inventory, this.structures.stationsNear(this.player.position.x, this.player.position.z), this.events);
      },
      inventory: () => this.inventory.slots.filter(Boolean).map((s) => `${s!.id}x${s!.count}`),
      selectItem: (id: string) => {
        const i = this.inventory.slots.findIndex((s) => s?.id === id);
        if (i < 0) return false;
        if (i >= 8) this.inventory.swap(i, this.inventory.selected);
        else this.inventory.select(i);
        this.render(0);
        return true;
      },
      nearestProp: (kind: string, radius = 120) => this.props.findNearest(kind as never, this.player.position.x, this.player.position.z, radius),
      nearestTree: (radius = 60) => {
        const p = this.player.position;
        const out: { x: number; z: number; radius: number; height: number }[] = [];
        this.vegetation.collidersNear(p.x, p.z, radius, out as never);
        let best: { x: number; z: number; height: number } | null = null;
        let bestD = Infinity;
        for (const c of out) {
          if (c.height < 3) continue;
          const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: c.x, z: c.z, height: c.height };
          }
        }
        return best;
      },
      openInventory: () => {
        this.openInventory();
        return true;
      },
      closeInventory: () => this.closeInventory(),
      quest: () => ({ tracked: this.quests.tracked, objective: this.quests.trackedObjective(), active: this.quests.activeQuests().map((q) => q.id), done: this.quests.doneQuests().map((q) => q.id), flags: [...this.quests.flags] }),
      talk: (npc: string) => {
        this.talkTo(npc);
        let guard = 0;
        while (this.dialogue.isOpen && guard < 50) {
          this.dialogue.advance();
          guard += 1;
        }
        return this.quests.trackedObjective();
      },
      useStory: (id: string) => {
        const ia = this.story.interactables.find((i) => i.id === id);
        if (!ia) throw new Error(`Unknown interactable ${id}`);
        const prompt = ia.prompt();
        if (prompt?.key) ia.use();
        return { prompt, flags: [...this.quests.flags] };
      },
      tuningOrder: () => TUNING_ORDER.slice(),
      npcPosition: (id: string) => this.story.npcPosition(id)?.toArray() ?? null,
      openMap: () => {
        this.openMap();
        return this.mapScreen.revealedFraction();
      },
      closeMap: () => this.closeMap(),
      setWeather: (kind: string) => {
        this.weather.set(kind as WeatherKind, true);
        this.render(0);
        return kind;
      },
      spawnCreature: (id: string, dx = 0, dz = -8) => {
        const species = SPECIES.find((sp) => sp.id === id);
        if (!species) throw new Error(`Unknown species ${id}`);
        const p = this.player.position;
        const c = this.wildlife.spawn(species, p.x + dx, p.z + dz, 999);
        c.yaw = Math.atan2(dx, dz);
        this.render(0);
        return { id: c.id, x: c.pos.x, y: c.pos.y, z: c.pos.z };
      },
      creatures: () => this.wildlife.creatures.map((c) => ({ id: c.id, species: c.species.id, state: c.state, hp: Math.round(c.hp), x: c.pos.x, z: c.pos.z, dist: Math.hypot(c.pos.x - this.player.position.x, c.pos.z - this.player.position.z) })),
      tickWorld: (seconds: number, dt = 1 / 30) => {
        const steps = Math.round(seconds / dt);
        for (let i = 0; i < steps; i += 1) {
          this.elapsed += dt;
          this.clock.update(dt);
          this.player.update(dt, { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, sprint: false, crouch: false });
          this.survival.update(dt, this.climate());
          this.wildlife.update(dt, this.elapsed, this.camera);
          this.wardens.update(dt);
          this.gathering.update(dt, this.gatherContext());
        }
        this.render(dt);
        return this.survival.health;
      },
      /** Built pieces, and whether the player stands sheltered. */
      building: () => {
        const p = this.player.position;
        return { pieces: this.building.debugPieces(), sheltered: this.building.sheltered(p.x, p.y, p.z), surface: this.building.surfaceAt(p.x, p.z, p.y), player: { x: p.x, y: p.y, z: p.z } };
      },
      /** Take down the piece under the aim (as holding E would). */
      dismantle: () => {
        const origin = this.camera.getWorldPosition(new THREE.Vector3());
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        const piece = this.building.pick(origin, dir, 3.4);
        if (!piece) return { removed: null, reason: 'nothing aimed at' };
        if (!this.building.canRemove(piece)) return { removed: null, reason: 'supports other pieces' };
        const wood = this.building.remove(piece);
        this.inventory.add('wood', wood);
        return { removed: piece.type, wood };
      },
      /** Mossback: state, or a debug action (wake | calm | reset | stagger | hurt). */
      warden: (action?: 'wake' | 'calm' | 'reset' | 'stagger' | 'hurt' | 'hold' | 'release', amount = 0) => {
        if (action) this.wardens.debug(action, amount);
        return { ...this.wardens.debugState, knotPositions: this.wardens.knotPositions(), boss: this.wardens.status() };
      },
      setTime: (hours: number) => {
        this.clock.set(this.clock.day, hours);
      },
      viewpoints: () => VIEWPOINTS.map((v) => v.name),
      showTexture: (name: string | null, layer = 0) => this.showTexture(name, layer),
      probe: () => {
        const a = this.pipeline.atmosphere.uniforms;
        const light = this.lighting.csm.lights[0];
        return {
          ...this.pipeline.probeExposure(),
          sunDir: a.uSunDir.value.toArray(),
          sunColor: a.uSunColor.value.toArray(),
          lightIntensity: light.intensity,
          lightColor: light.color.toArray(),
          hours: this.clock.hours,
        };
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const canvas = this.canvas;
    const pos = this.mode === 'play' ? this.player.position : this.camera.position;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      state: this.stateName,
      score: this.discovered.size,
      targetScore: LANDMARKS.length,
      complete: false,
      player: {
        position: { x: pos.x, y: pos.y, z: pos.z },
        speed: this.mode === 'play' ? this.player.speed : 0,
        state: this.mode === 'play' ? this.player.state : 'fly',
        health: this.survival.health,
        stamina: this.survival.stamina,
        food: this.survival.food,
        water: this.survival.water,
        bodyTemp: this.survival.bodyTemp,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      },
      canvas: {
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        width: canvas.width,
        height: canvas.height,
        dpr: this.renderer.getPixelRatio(),
      },
      world: {
        hours: this.clock.hours,
        terrainNodes: this.terrain?.selectedNodes ?? 0,
        trees: this.vegetation ? { ...this.vegetation.stats } : null,
        water: this.water ? this.water.stats : null,
        quality: this.quality.name,
        gpu: this.gpuName,
        discovered: this.discovered.size,
      },
      timings: { ...this.timings },
      errors: this.errors.slice(-10),
    };
  }
}

function detectGpu(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return '';
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
