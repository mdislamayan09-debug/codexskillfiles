import * as THREE from 'three';
import { GameClock } from '../core/GameClock';
import { Input } from '../core/Input';
import { FlyCamera } from '../debug/FlyCamera';
import { MOON_ILLUMINANCE, SUN_ILLUMINANCE } from '../render/atmosphere/Atmosphere';
import { Lighting } from '../render/Lighting';
import { qualityFromName, type QualitySettings } from '../render/Quality';
import { RenderPipeline } from '../render/RenderPipeline';
import { TerrainMaterialBaker } from '../render/terrain/TerrainMaterialBaker';
import { moonDirection, moonIllumination, moonPhase, starRotation, sunDirection } from '../world/Celestial';
import { TerrainRenderer } from '../world/terrain/TerrainRenderer';
import { GrassSystem } from '../world/vegetation/GrassSystem';
import { WorldData } from '../world/WorldData';
import { loadWorld } from '../world/WorldLoader';
import { viewpointByName, VIEWPOINTS } from './Viewpoints';

export type ProgressReporter = (stage: string, fraction: number) => void;

/**
 * Top-level orchestrator. Owns the renderer, world, systems and the frame
 * loop; systems never talk to each other except through the Game.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly clock = new GameClock();
  readonly input: Input;
  quality: QualitySettings;
  pipeline!: RenderPipeline;
  lighting!: Lighting;
  world!: WorldData;
  terrain!: TerrainRenderer;
  baker!: TerrainMaterialBaker;
  flyCam!: FlyCamera;
  grass!: GrassSystem;

  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private frame = 0;
  private elapsed = 0;
  private paused = false;
  private reducedMotion = false;
  private stateName = 'boot';
  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  private readonly starMatrix4 = new THREE.Matrix4();
  private readonly starMatrix = new THREE.Matrix3();
  private readonly errors: string[] = [];
  private readonly timings: Record<string, number> = {};

  constructor(readonly canvas: HTMLCanvasElement) {
    const params = new URLSearchParams(location.search);
    this.quality = qualityFromName(params.get('quality'));
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: params.has('capture'),
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.2, this.quality.farPlane);
    this.camera.position.set(0, 60, 700);
    this.input = new Input(canvas);
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
      detailDistance: 420,
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

    this.flyCam = new FlyCamera(this.camera, this.input, this.world);
    const start = viewpointByName(params.get('view') ?? 'crash-site') ?? VIEWPOINTS[0];
    this.applyViewpoint(start.name);

    progress('Compiling shaders', 0.8);
    await nextFrame();
    const t2 = performance.now();
    this.updateEnvironment(0);
    this.terrain.update(this.camera, 0);
    this.renderer.compile(this.scene, this.camera);
    this.timings.compileMs = performance.now() - t2;

    this.installTestHooks();
    this.canvas.addEventListener('click', () => this.input.requestPointerLock());
    progress('Ready', 1);
  }

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
    if (!this.paused) {
      this.elapsed += dt;
      this.clock.update(dt);
      this.flyCam.update(dt);
    }
    this.input.endFrame();
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
    if (sunI >= moonI) this.lighting.update(this.sunDir, a.uSunColor.value, sunI);
    else this.lighting.update(this.moonDir, a.uMoonColor.value, moonI);
    void dt;
  }

  private render(dt: number): void {
    const t = performance.now();
    this.updateEnvironment(dt);
    this.terrain.update(this.camera, this.elapsed);
    this.grass.update(this.camera, this.reducedMotion ? 0 : this.elapsed);
    this.renderer.info.reset();
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
        time: this.reducedMotion ? 0 : this.elapsed,
        moonPhaseLight: moonIllumination(moonPhase(this.clock.day, this.clock.hours)),
        starRotation: this.starMatrix,
        aurora: 0,
        cloudCover: 0,
        resonance: 0,
      },
    );
    this.timings.frameMs = performance.now() - t;
    this.publishDiagnostics();
  }

  applyViewpoint(name: string): boolean {
    const vp = viewpointByName(name);
    if (!vp) return false;
    const ground = this.world.heightAt(vp.x, vp.z);
    const water = this.world.waterLevelAt(vp.x, vp.z);
    const pos = new THREE.Vector3(vp.x, Math.max(ground, water) + vp.height, vp.z);
    const [tx, tz, th] = vp.target;
    const target = new THREE.Vector3(tx, this.world.heightAt(tx, tz) + th, tz);
    this.flyCam.setPose(pos, 0, 0);
    this.flyCam.lookAt(target);
    this.clock.set(this.clock.day, vp.hour);
    this.pipeline.resetExposure();
    this.stateName = `view:${vp.name}`;
    return true;
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: () => undefined,
      setState: (name: string) => {
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
      hideDebugUi: () => undefined,
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
      setTime: (hours: number) => {
        this.clock.set(this.clock.day, hours);
      },
      viewpoints: () => VIEWPOINTS.map((v) => v.name),
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
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      state: this.stateName,
      score: 0,
      targetScore: 0,
      complete: false,
      player: {
        position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        speed: 0,
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
        quality: this.quality.name,
      },
      timings: { ...this.timings },
      errors: this.errors.slice(-10),
    };
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
