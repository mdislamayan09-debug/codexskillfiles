import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/math';
import { EventBus } from '../core/Events';
import { GameClock } from '../core/GameClock';
import { Input, type ButtonAction } from '../core/Input';
import { SettingsStore } from '../core/Settings';
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
import { DeathScreen, Menu } from '../ui/Menu';
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
import { SaveSystem } from './SaveSystem';
import { Survival, type Climate } from './Survival';
import { viewpointByName, VIEWPOINTS } from './Viewpoints';

export type ProgressReporter = (stage: string, fraction: number) => void;
export type GameMode = 'play' | 'fly';

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
  player!: PlayerController;
  hud!: Hud;
  menu!: Menu;
  death!: DeathScreen;
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
  private debugEl: HTMLElement | null = null;
  private fpsEl: HTMLElement | null = null;
  private veilEl: HTMLElement | null = null;
  private deathCause: string | null = null;

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

    this.flyCam = new FlyCamera(this.camera, this.input, this.world);
    this.player = new PlayerController(this.createPlayerEnvironment(), this.survival);
    this.wirePlayerCallbacks();
    this.createUi();
    this.registerSaves();
    this.applySettings();
    this.settings.onChange(() => this.applySettings());

    const view = params.get('view');
    if (view && viewpointByName(view)) {
      this.applyViewpoint(view);
    } else {
      this.startPlay(SaveSystem.consumeResume() ? 'session' : null);
    }
    this.vegetation.prewarm(this.camera.position.x, this.camera.position.z, 260);

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
    document.addEventListener('pointerlockchange', () => {
      // Losing the pointer while playing (Esc) opens the pause menu.
      if (!this.input.pointerLocked && this.mode === 'play' && !this.menu.isOpen && this.survival.alive && this.running) this.openMenu();
    });
    progress('Ready', 1);
  }

  // -------------------------------------------------------------------------
  // Setup

  private createPlayerEnvironment(): PlayerEnvironment {
    const world = this.world;
    const waterOut: WaterAt = { surface: 0, depth: 0, frozen: false, flowX: 0, flowZ: 0 };
    return {
      groundHeight: (x, z) => world.heightAt(x, z),
      groundNormal: (x, z, out) => world.smoothNormalAt(x, z, out),
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
      detectedQuality: this.detectedQuality,
      activeQuality: this.quality.name,
      gpu: this.gpuName,
    });
    this.death = new DeathScreen(root, () => this.respawn());
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
    this.events.on('died', ({ cause }) => {
      this.deathCause = cause;
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
        const d = data as { x: number; z: number; yaw: number; pitch: number };
        this.player.spawn(d.x, d.z, d.yaw);
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
        return { health: s.health, stamina: s.stamina, food: s.food, water: s.water, bodyTemp: s.bodyTemp, wetness: s.wetness };
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
  }

  // -------------------------------------------------------------------------
  // Modes

  private startPlay(resumeSlot: string | null): void {
    this.mode = 'play';
    this.stateName = 'play';
    this.player.spawn(CAMP_SPAWN.x, CAMP_SPAWN.z, CAMP_SPAWN.yaw);
    this.clock.set(1, 7.6);
    // A fresh game starts with a clean pack and rested body.
    for (let i = 0; i < this.inventory.slots.length; i += 1) this.inventory.slots[i] = null;
    this.inventory.select(0);
    this.survival.revive();
    this.survival.health = this.survival.maxHealth;
    this.survival.food = 82;
    this.survival.water = 76;
    this.discovered.clear();
    this.seen.clear();
    if (resumeSlot && this.saves.load(resumeSlot)) {
      this.events.emit('notify', { text: `Graphics set to ${this.quality.name === 'extra' ? 'Extra High' : this.quality.name[0].toUpperCase() + this.quality.name.slice(1)}`, icon: 'gear', tone: 'info' });
    } else {
      this.inventory.add('berries', 4);
    }
    this.hud.setVisible(true);
    this.pipeline.resetExposure();
    this.view.update(0, this.player, this.camera, this.viewOptions());
  }

  private respawn(): void {
    this.death.hide();
    this.survival.revive();
    this.player.spawn(CAMP_SPAWN.x, CAMP_SPAWN.z, CAMP_SPAWN.yaw);
    this.deathCause = null;
    this.pipeline.post.damage = 0;
    this.hud.setVisible(true);
    this.events.emit('respawned', { x: CAMP_SPAWN.x, z: CAMP_SPAWN.z });
    this.pipeline.resetExposure();
    this.input.requestPointerLock();
  }

  private openMenu(): void {
    this.menu.show();
    this.menuPaused = true;
    this.input.gameplayEnabled = false;
    this.input.exitPointerLock();
  }

  private closeMenu(): void {
    this.menu.hide();
    this.menuPaused = false;
    this.input.gameplayEnabled = true;
    this.input.requestPointerLock();
  }

  private reloadWithQuality(): void {
    this.saveSession();
    SaveSystem.markResume();
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
    if (this.input.wasPressed('pause', true) && this.mode === 'play' && this.survival.alive) {
      if (this.menu.isOpen) this.closeMenu();
      else this.openMenu();
    }
    const frozen = this.paused || this.menuPaused;
    if (!frozen) {
      this.elapsed += dt;
      this.clock.update(dt);
      if (this.mode === 'fly') this.flyCam.update(dt);
      else this.updatePlay(dt);
    }
    this.veilEl?.classList.toggle('show', this.mode === 'play' && !this.input.pointerLocked && !this.menu.isOpen && this.survival.alive && this.frame > 30);
    this.input.endFrame();
  }

  private updatePlay(dt: number): void {
    this.playtime += dt;
    const input = this.input;
    const alive = this.survival.alive;
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

    this.updateDiscovery(dt);
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 60 && alive) {
      this.autosaveTimer = 0;
      this.saveSession('auto');
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
    const inWater = this.player.state === 'swim';
    return {
      airTemperature: base + diurnal - altitude,
      precipitation: 0,
      heat,
      inWater,
      waterTemperature: water.hot ? 38 : 9 + base * 0.35,
      sheltered: false,
      resting: false,
    };
  }

  private updateDiscovery(dt: number): void {
    const p = this.player.position;
    // Biome names announce themselves when you cross into a new region.
    this.biomeTimer -= dt;
    if (this.biomeTimer <= 0) {
      this.biomeTimer = 0.5;
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
    this.updateEnvironment(dt);
    this.terrain.update(this.camera, this.elapsed);
    if (this.mode === 'play') this.grass.setPusher(0, this.player.position, 0.6);
    this.grass.update(this.camera, this.reducedMotion ? 0 : this.elapsed);
    this.vegetationShared.uTime.value = this.reducedMotion ? 0 : this.elapsed;
    this.vegetation.update(this.camera);
    this.renderer.info.reset();
    const time = this.reducedMotion ? 0 : this.elapsed;
    this.water.update(this.renderer, this.camera, time, { color: this.pipeline.opaqueColor, depth: this.pipeline.opaqueDepth }, this.light);
    this.updateUnderwater();
    this.updatePostFeedback(dt);
    this.pipeline.render(
      dt,
      {
        sunDir: this.sunDir,
        moonDir: this.moonDir,
        moonPhaseLight: moonIllumination(moonPhase(this.clock.day, this.clock.hours)),
        mieScale: 2.2,
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

  private updatePostFeedback(dt: number): void {
    const post = this.pipeline.post;
    post.damage = damp(post.damage, 0, 3, dt);
    const hp = this.survival.health / this.survival.maxHealth;
    post.lowHealth = this.mode === 'play' ? smoothstep(0.35, 0.08, hp) : 0;
    post.fade = damp(post.fade, this.deathCause ? 0.85 : 0, 1.5, dt);
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
      },
      dt,
    );
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
