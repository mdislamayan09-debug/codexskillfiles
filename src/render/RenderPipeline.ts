import * as THREE from 'three';
import { Atmosphere, type AtmosphereState } from './atmosphere/Atmosphere';
import { createCloudUniforms, VolumetricClouds, type CloudParams, type CloudUniforms } from './clouds/VolumetricClouds';
import { createFullscreenMaterial, createHdrTarget, FullscreenPass } from './FullscreenPass';
import { GpuTimer } from './GpuTimer';
import { installAtmosphereChunks } from './materials/MaterialPatches';
import { COMPOSITE_FRAG, RESTORE_FRAG } from './post/compositeGlsl';
import { BloomPass, ExposurePass, GodRaysPass, SSAOPass } from './post/PostPasses';
import { TemporalAA } from './post/TemporalAA';
import type { QualitySettings } from './Quality';
import { SkyRenderer, type SkyState } from './sky/SkyRenderer';

/** Layer 0: opaque + alpha-tested world (MSAA pass 1). Layer 1: water/transparent (pass 2). */
export const LAYER_MAIN = 0;
export const LAYER_TRANSPARENT = 1;
/** Layer 2: shadow-only casters (cheap proxies), rendered only into shadow maps. */
export const LAYER_SHADOW_PROXY = 2;

/**
 * Three tests shadow casters against the *main* camera's layers. The main
 * render list is built before shadows render, so enabling the proxy layer only
 * inside the shadow pass makes those objects shadow-only.
 */
function installShadowProxyLayer(renderer: THREE.WebGLRenderer, layer: number): void {
  const shadowMap = renderer.shadowMap as THREE.WebGLShadowMap & { __proxyPatched?: boolean };
  if (shadowMap.__proxyPatched) return;
  const original = shadowMap.render.bind(shadowMap);
  shadowMap.render = (lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => {
    const mask = camera.layers.mask;
    camera.layers.enable(layer);
    detailCull.shadowPass = true;
    try {
      original(lights, scene, camera);
    } finally {
      camera.layers.mask = mask;
      detailCull.shadowPass = false;
    }
  };
  shadowMap.__proxyPatched = true;
}

/**
 * Detail culling. Three draws every mesh whose bounds touch the view, however
 * small it is on screen: a survivor's buttons at 200 m, a Sunwell's
 * flagstones from across the island, each drawn again into every shadow
 * cascade. A mesh is skipped when its bounding sphere would cover less than
 * a pixel or two from the eye, and it stops casting shadows once it is too
 * small for its shadow to matter. Meshes with `frustumCulled = false` (the
 * sky, instanced forests, the held tool) are never culled.
 */
export const detailCull = {
  /** On only while the pipeline draws the frame (not for bakes and probes). */
  enabled: false,
  shadowPass: false,
  eye: new THREE.Vector3(),
  /** Smallest radius/distance drawn: about 1.5 px across at 1080 lines. */
  minRatio: 0.0011,
  /** Smallest radius/distance that still casts a shadow. */
  minShadowRatio: 0.012,
};

/**
 * Pools of instanced meshes (arrows, building pieces, birds) sit empty most
 * of the time, yet three still sets up a program and draws zero instances,
 * in every pass and shadow cascade.
 */
function skipEmptyDraws(renderer: THREE.WebGLRenderer): void {
  const r = renderer as THREE.WebGLRenderer & { __emptyPatched?: boolean };
  if (r.__emptyPatched) return;
  r.__emptyPatched = true;
  const direct = renderer.renderBufferDirect.bind(renderer);
  renderer.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
    if ((object as THREE.InstancedMesh).isInstancedMesh && (object as THREE.InstancedMesh).count === 0) return;
    if ((geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry && (geometry as THREE.InstancedBufferGeometry).instanceCount === 0) return;
    direct(camera, scene, geometry, material, object, group);
  };
}

function installDetailCulling(): void {
  const proto = THREE.Frustum.prototype as THREE.Frustum & { __detailPatched?: boolean };
  if (proto.__detailPatched) return;
  proto.__detailPatched = true;
  const original = proto.intersectsObject;
  const sphere = new THREE.Sphere();
  proto.intersectsObject = function intersectsObject(this: THREE.Frustum, object: THREE.Object3D): boolean {
    if (!original.call(this, object)) return false;
    if (!detailCull.enabled) return true;
    const mesh = object as THREE.Mesh;
    const bounds = mesh.geometry?.boundingSphere;
    if (!bounds || (object as THREE.InstancedMesh).isInstancedMesh) return true;
    sphere.copy(bounds).applyMatrix4(object.matrixWorld);
    const d = sphere.center.distanceTo(detailCull.eye) - sphere.radius;
    if (d <= 0) return true;
    return sphere.radius > d * (detailCull.shadowPass ? detailCull.minShadowRatio : detailCull.minRatio);
  };
}

export interface GradeSettings {
  whiteBalance: THREE.Color;
  saturation: number;
  contrast: number;
  lift: THREE.Color;
  gamma: THREE.Color;
  gain: THREE.Color;
}

export interface PostSettings {
  toneMapper: 0 | 1;
  manualExposure: number;
  autoExposure: boolean;
  bloomStrength: number;
  vignette: number;
  grain: number;
  fringe: number;
  aoStrength: number;
  godRayStrength: number;
  colorblind: 0 | 1 | 2 | 3;
  damage: number;
  lowHealth: number;
  flash: number;
  fade: number;
  underwater: number;
  underwaterColor: THREE.Color;
  grade: GradeSettings;
}

/** How the frame's resolution is chosen (live; from Settings → Graphics). */
export interface ResolutionSettings {
  /** Lower the scene's resolution when frames run long, raise it when there is room. */
  dynamic: boolean;
  targetFps: number;
  /** 0..1: how much the final image is sharpened. */
  sharpness: number;
}

export function defaultGrade(): GradeSettings {
  return {
    whiteBalance: new THREE.Color(1, 1, 1),
    saturation: 1.05,
    contrast: 1.06,
    lift: new THREE.Color(0, 0, 0),
    gamma: new THREE.Color(1, 1, 1),
    gain: new THREE.Color(1, 1, 1),
  };
}

export class RenderPipeline {
  readonly atmosphere = new Atmosphere();
  readonly sky: SkyRenderer;
  readonly cloudUniforms: CloudUniforms = createCloudUniforms();
  /** Direction toward the dominant light (sun by day, moon by night). */
  readonly lightDir = { value: new THREE.Vector3(0, 1, 0) };
  clouds: VolumetricClouds | null = null;
  cloudParams: CloudParams = { coverage: 0.42, type: 0.45, windX: 1, windZ: 0.35, windSpeed: 14 };
  readonly post: PostSettings = {
    toneMapper: 0,
    manualExposure: 1,
    autoExposure: true,
    bloomStrength: 0.045,
    vignette: 0.22,
    grain: 0.018,
    fringe: 0.0,
    aoStrength: 0.75,
    godRayStrength: 0.35,
    colorblind: 0,
    damage: 0,
    lowHealth: 0,
    flash: 0,
    fade: 0,
    underwater: 0,
    underwaterColor: new THREE.Color(0.02, 0.07, 0.08),
    grade: defaultGrade(),
  };

  readonly resolution: ResolutionSettings = { dynamic: true, targetFps: 60, sharpness: 0.5 };
  /** The detail-culling thresholds (shared module state; here for tests and tuning). */
  readonly detailCull = detailCull;

  private sceneTarget!: THREE.WebGLRenderTarget;
  private finalTarget!: THREE.WebGLRenderTarget;
  private readonly bloom = new BloomPass(6);
  private readonly exposure = new ExposurePass();
  private readonly ssao = new SSAOPass();
  private readonly godRays = new GodRaysPass();
  private readonly taa: TemporalAA;
  private readonly restoreMesh: THREE.Mesh;
  private readonly composite: FullscreenPass;
  private readonly whiteTexture: THREE.DataTexture;
  private readonly blackTexture: THREE.DataTexture;
  /** Scene (internal) resolution. */
  private width = 1;
  private height = 1;
  /** Display resolution: temporal AA, bloom and the composite run here. */
  private outWidth = 1;
  private outHeight = 1;
  /** Dynamic resolution: the share of the preset's resolution in use. */
  private dynamicScale = 1;
  private scaleTimer = 0;
  private scaleFrames = 0;
  private frameMs = 16.7;
  /** Frame time the GPU timer cannot see, learnt from missed frames. */
  private overheadMs = 0;
  private time = 0;
  private readonly sunUv = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp4 = new THREE.Vector4();
  readonly stats = { passes: 0 };
  /** Graphics-card time for each stage of the frame. */
  readonly gpu: GpuTimer;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    public quality: QualitySettings,
  ) {
    this.gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
    this.taa = new TemporalAA(quality.budget < 1);
    const dummyWeather = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    dummyWeather.needsUpdate = true;
    this.cloudUniforms.uCloudWeather.value = dummyWeather;
    installAtmosphereChunks({ ...this.atmosphere.uniforms, ...this.cloudUniforms, uLightDir: this.lightDir });
    installShadowProxyLayer(renderer, LAYER_SHADOW_PROXY);
    installDetailCulling();
    skipEmptyDraws(renderer);
    // Any Fog instance turns on USE_FOG; the chunks it enables are replaced by
    // aerial perspective, height fog and cloud-shadow visibility.
    scene.fog = new THREE.Fog(0xffffff, 1, 2);
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    this.sky = new SkyRenderer(renderer, this.atmosphere);
    this.sky.mesh.layers.set(LAYER_MAIN);
    scene.add(this.sky.mesh);

    this.whiteTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.whiteTexture.needsUpdate = true;
    this.blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blackTexture.needsUpdate = true;

    const restoreMaterial = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: RESTORE_FRAG,
      uniforms: {
        uColor: { value: null },
        uDepth: { value: null },
        uAO: { value: this.whiteTexture },
        uAOStrength: { value: 0.75 },
      },
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      fog: false,
      toneMapped: false,
    });
    const fsGeometry = new THREE.BufferGeometry();
    fsGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    fsGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.restoreMesh = new THREE.Mesh(fsGeometry, restoreMaterial);
    this.restoreMesh.frustumCulled = false;
    this.restoreMesh.renderOrder = -1_000_000;
    this.restoreMesh.layers.set(LAYER_TRANSPARENT);
    this.restoreMesh.name = 'restore';
    scene.add(this.restoreMesh);

    this.composite = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: COMPOSITE_FRAG,
        uniforms: {
          uColor: { value: null },
          uBloom: { value: this.blackTexture },
          uGodRays: { value: this.blackTexture },
          uExposure: { value: this.whiteTexture },
          uDepth: { value: null },
          uBloomStrength: { value: 0.045 },
          uGodRayStrength: { value: 0 },
          uGodRayColor: { value: new THREE.Color(1, 0.9, 0.75) },
          uManualExposure: { value: 1 },
          uAutoExposure: { value: 1 },
          uToneMapper: { value: 0 },
          uWhiteBalance: { value: new THREE.Color(1, 1, 1) },
          uSaturation: { value: 1 },
          uContrast: { value: 1 },
          uLift: { value: new THREE.Color(0, 0, 0) },
          uGamma: { value: new THREE.Color(1, 1, 1) },
          uGain: { value: new THREE.Color(1, 1, 1) },
          uVignette: { value: 0.2 },
          uGrain: { value: 0.02 },
          uFringe: { value: 0 },
          uTime: { value: 0 },
          uColorblind: { value: 0 },
          uDamage: { value: 0 },
          uLowHealth: { value: 0 },
          uFlash: { value: 0 },
          uFade: { value: 0 },
          uUnderwater: { value: 0 },
          uUnderwaterColor: { value: new THREE.Color() },
          uNear: { value: 0.1 },
          uFar: { value: 1000 },
          uResolution: { value: new THREE.Vector2() },
          uSharpen: { value: 0 },
        },
      }),
    );
    this.createTargets(1, 1);
    this.configureClouds();
  }

  private configureClouds(): void {
    if (this.quality.cloudSteps > 0 && !this.clouds) {
      this.clouds = new VolumetricClouds(this.renderer, this.atmosphere, this.cloudUniforms, this.quality.cloudSteps >= 72 ? 128 : 64);
    }
    if (this.clouds) {
      this.clouds.steps = this.quality.cloudSteps;
      this.clouds.setSize(this.width, this.height, this.quality.cloudDivisor);
    }
  }

  /** Pass-1 color after the opaque world + sky (for water refraction). */
  get opaqueColor(): THREE.Texture {
    return this.sceneTarget.texture;
  }

  get opaqueDepth(): THREE.DepthTexture {
    return this.sceneTarget.depthTexture as THREE.DepthTexture;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private createTargets(width: number, height: number): void {
    this.sceneTarget?.dispose();
    this.finalTarget?.dispose();
    const samples = this.quality.msaa;
    const depthTexture = () => {
      const d = new THREE.DepthTexture(width, height, THREE.FloatType);
      d.minFilter = THREE.NearestFilter;
      d.magFilter = THREE.NearestFilter;
      return d;
    };
    this.sceneTarget = createHdrTarget(width, height, { depthBuffer: true, samples });
    this.sceneTarget.depthTexture = depthTexture();
    this.finalTarget = createHdrTarget(width, height, { depthBuffer: true, samples });
    // Without MSAA the second pass keeps its depth (water, the held tool) for
    // the temporal resolve; with it, the resolve falls back to the opaque depth.
    if (samples === 0) this.finalTarget.depthTexture = depthTexture();
    else this.finalTarget.resolveDepthBuffer = false;
  }

  setQuality(quality: QualitySettings): void {
    const msaaChanged = quality.msaa !== this.quality.msaa;
    this.quality = quality;
    this.dynamicScale = 1;
    if (msaaChanged) this.createTargets(this.width, this.height);
    this.resize(true);
    this.configureClouds();
  }

  /** Share of the preset's scene resolution in use (dynamic resolution). */
  get resolutionScale(): number {
    return this.dynamicScale;
  }

  /**
   * Matches the targets to the canvas (call every frame; cheap when
   * unchanged). The canvas and the final passes run at the display's own
   * resolution; the scene renders at the preset's share of it, scaled down
   * further by dynamic resolution, and temporal AA rebuilds the full image.
   */
  resize(force = false): boolean {
    const canvas = this.renderer.domElement;
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    const deviceDpr = window.devicePixelRatio || 1;
    const outDpr = Math.min(deviceDpr, 3);
    const sceneDpr = Math.min(deviceDpr, this.quality.maxDpr) * this.quality.renderScale * this.dynamicScale;
    const w = Math.max(1, Math.floor(cssW * sceneDpr));
    const h = Math.max(1, Math.floor(cssH * sceneDpr));
    const canvasW = Math.floor(cssW * outDpr);
    const canvasH = Math.floor(cssH * outDpr);
    if (!force && w === this.width && h === this.height && canvas.width === canvasW && canvas.height === canvasH) return false;
    const outChanged = canvasW !== this.outWidth || canvasH !== this.outHeight || force;
    this.renderer.setPixelRatio(outDpr);
    this.renderer.setSize(cssW, cssH, false);
    this.outWidth = canvas.width;
    this.outHeight = canvas.height;
    this.width = w;
    this.height = h;
    this.sceneTarget.setSize(w, h);
    this.finalTarget.setSize(w, h);
    this.ssao.setSize(w, h);
    this.godRays.setSize(w, h);
    // Bloom is a wide blur: it reads the scene-resolution frame.
    this.bloom.setSize(w, h);
    this.atmosphere.uniforms.uResolution.value.set(w, h);
    if (outChanged) {
      this.taa.setSize(this.outWidth, this.outHeight);
      // Clouds follow the preset's resolution, not dynamic resolution: their
      // history would be thrown away at every step.
      const base = Math.min(deviceDpr, this.quality.maxDpr) * this.quality.renderScale;
      this.clouds?.setSize(Math.floor(cssW * base), Math.floor(cssH * base), this.quality.cloudDivisor);
      this.camera.aspect = cssW / cssH;
      this.camera.updateProjectionMatrix();
      this.exposure.forceReset();
    }
    return true;
  }

  /**
   * Dynamic resolution: every half second (after the graphics card's timings
   * for the new size have come in), compare the frame's cost with the
   * target's budget and move the scene resolution toward it. Cost scales
   * roughly with pixel count, so the step is the square root of the ratio.
   */
  private updateDynamicResolution(dt: number): void {
    this.frameMs += (Math.min(dt, 0.25) * 1000 - this.frameMs) * 0.1;
    this.scaleTimer += dt;
    this.scaleFrames += 1;
    const floor = Math.min(1, this.quality.minRenderScale / this.quality.renderScale);
    if (!this.resolution.dynamic) {
      if (this.dynamicScale !== 1) {
        this.dynamicScale = 1;
        this.resize();
      }
      return;
    }
    if (this.scaleTimer < 0.5 || this.scaleFrames < 12) return;
    this.scaleTimer = 0;
    this.scaleFrames = 0;
    const budget = 1000 / Math.max(15, this.resolution.targetFps);
    // Graphics-card time where the browser can measure it; otherwise the
    // frame interval (which cannot see headroom under vsync).
    const gpuMs = this.gpu.available ? this.gpu.total : 0;
    const measured = gpuMs > 0 ? gpuMs : this.frameMs;
    // The browser and driver spend time the timer cannot see (handing the
    // frame over, compositing the page). While frames still miss the target
    // with the card's time inside it, grow an allowance for that; shrink it
    // slowly once they fit, so resolution can creep back up.
    if (gpuMs > 0) {
      const missing = this.frameMs > budget * 1.06;
      this.overheadMs = Math.min(budget * 0.45, Math.max(0, this.overheadMs + (missing ? 1.5 : -0.3)));
    }
    const target = gpuMs > 0 ? budget * 0.92 - this.overheadMs : budget * 0.97;
    const ratio = Math.max(target, budget * 0.4) / Math.max(measured, 0.1);
    let next = this.dynamicScale;
    if (ratio < 0.95) next *= Math.max(0.7, Math.sqrt(ratio));
    else if (ratio > 1.2) next *= Math.min(1.08, Math.sqrt(ratio));
    next = Math.min(1, Math.max(floor, Math.round(next * 40) / 40));
    if (Math.abs(next - this.dynamicScale) < 0.02) return;
    this.dynamicScale = next;
    this.resize();
    // Timings from before the change would steer the next step.
    this.gpu.reset();
  }

  render(dt: number, atmosphereState: AtmosphereState, skyState: SkyState): void {
    const renderer = this.renderer;
    const camera = this.camera;
    this.time += dt;
    this.updateDynamicResolution(dt);
    this.resize();
    const gpu = this.gpu;
    gpu.poll();

    gpu.begin('sky');
    this.atmosphere.update(renderer, camera, atmosphereState);
    const sunDir = this.atmosphere.uniforms.uSunDir.value;
    this.lightDir.value.copy(sunDir.y > -0.06 ? sunDir : this.atmosphere.uniforms.uMoonDir.value);
    if (this.clouds && this.quality.cloudSteps > 0) {
      gpu.begin('clouds');
      this.clouds.update(renderer, camera, dt, this.time, this.cloudParams);
      this.sky.setClouds(this.clouds.texture);
    } else {
      this.cloudUniforms.uCloudCoverage.value = 0;
      this.sky.setClouds(null);
    }
    gpu.begin('env');
    this.sky.update(camera, skyState);
    const env = this.sky.updateEnvironment(dt);
    if (env) this.scene.environment = env;

    // Pass 1: opaque world + sky into the HDR target, seen through this
    // frame's sub-pixel jitter.
    gpu.begin('scene');
    renderer.shadowMap.needsUpdate = true;
    camera.getWorldPosition(detailCull.eye);
    // About 1.5 px across at 1080 lines for this field of view (fixed, so
    // dynamic resolution never makes things pop in and out).
    detailCull.minRatio = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (1.5 / 1080);
    // Thinner budgets drop small shadow casters sooner.
    detailCull.minShadowRatio = 0.012 / Math.max(0.25, this.quality.budget);
    this.taa.jitterCamera(camera, this.width, this.height);
    detailCull.enabled = true;
    camera.layers.set(LAYER_MAIN);
    renderer.setRenderTarget(this.sceneTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, camera);

    const colorA = this.sceneTarget.texture;
    const depthA = this.sceneTarget.depthTexture as THREE.Texture;

    // Screen-space AO from the opaque depth.
    const restoreUniforms = (this.restoreMesh.material as THREE.ShaderMaterial).uniforms;
    if (this.quality.ssao && this.post.aoStrength > 0) {
      gpu.begin('ssao');
      this.ssao.render(renderer, depthA, camera, this.width, this.height);
      restoreUniforms.uAO.value = this.ssao.texture;
    } else {
      restoreUniforms.uAO.value = this.whiteTexture;
    }
    restoreUniforms.uColor.value = colorA;
    restoreUniforms.uDepth.value = depthA;
    restoreUniforms.uAOStrength.value = this.post.aoStrength;

    // Pass 2: restore opaque color/depth, then water and transparent effects.
    gpu.begin('water');
    camera.layers.set(LAYER_TRANSPARENT);
    renderer.setRenderTarget(this.finalTarget);
    renderer.clear(true, true, false);
    // The first pass already brought every world matrix up to date.
    this.scene.matrixWorldAutoUpdate = false;
    renderer.render(this.scene, camera);
    this.scene.matrixWorldAutoUpdate = true;
    camera.layers.set(LAYER_MAIN);
    detailCull.enabled = false;
    this.taa.restoreCamera(camera);

    // Temporal resolve up to the display's resolution.
    gpu.begin('taa');
    const exposureTexture = this.post.autoExposure ? this.exposure.texture : this.whiteTexture;
    this.taa.resolve(renderer, this.finalTarget.texture, (this.finalTarget.depthTexture ?? depthA) as THREE.Texture, exposureTexture, this.post.manualExposure);
    const color = this.taa.texture;
    const cu = this.composite.material.uniforms;
    gpu.begin('post');

    if (this.quality.bloom) {
      this.bloom.render(renderer, this.finalTarget.texture, this.width, this.height);
      cu.uBloom.value = this.bloom.texture;
    } else {
      cu.uBloom.value = this.blackTexture;
    }

    // Crepuscular rays when the sun is on screen and above the horizon.
    let godStrength = 0;
    if (this.quality.godRays && sunDir.y > -0.02) {
      this.tmp.copy(camera.position).addScaledVector(sunDir, 1000);
      this.tmp4.set(this.tmp.x, this.tmp.y, this.tmp.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (this.tmp4.w > 0) {
        this.sunUv.set(this.tmp4.x / this.tmp4.w * 0.5 + 0.5, this.tmp4.y / this.tmp4.w * 0.5 + 0.5);
        const onScreen = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(this.sunUv.x - 0.5), Math.abs(this.sunUv.y - 0.5)), 0.55, 0.95);
        godStrength = onScreen * this.post.godRayStrength * THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.1);
        if (godStrength > 0.001) {
          this.godRays.render(renderer, colorA, depthA, this.sunUv, this.width / this.height);
          cu.uGodRays.value = this.godRays.texture;
        }
      }
    }
    if (godStrength <= 0.001) cu.uGodRays.value = this.blackTexture;

    if (this.post.autoExposure) this.exposure.render(renderer, this.finalTarget.texture, dt);

    const p = this.post;
    cu.uColor.value = color;
    cu.uDepth.value = depthA;
    cu.uExposure.value = this.exposure.texture;
    cu.uBloomStrength.value = p.bloomStrength;
    cu.uGodRayStrength.value = godStrength;
    (cu.uGodRayColor.value as THREE.Color).copy(this.atmosphere.uniforms.uSunColor.value);
    cu.uManualExposure.value = p.manualExposure;
    cu.uAutoExposure.value = p.autoExposure ? 1 : 0;
    cu.uToneMapper.value = p.toneMapper;
    (cu.uWhiteBalance.value as THREE.Color).copy(p.grade.whiteBalance);
    cu.uSaturation.value = p.grade.saturation;
    cu.uContrast.value = p.grade.contrast;
    (cu.uLift.value as THREE.Color).copy(p.grade.lift);
    (cu.uGamma.value as THREE.Color).copy(p.grade.gamma);
    (cu.uGain.value as THREE.Color).copy(p.grade.gain);
    cu.uVignette.value = p.vignette;
    cu.uGrain.value = p.grain;
    cu.uFringe.value = p.fringe;
    cu.uTime.value = this.time;
    cu.uColorblind.value = p.colorblind;
    cu.uDamage.value = p.damage;
    cu.uLowHealth.value = p.lowHealth;
    cu.uFlash.value = p.flash;
    cu.uFade.value = p.fade;
    cu.uUnderwater.value = p.underwater;
    (cu.uUnderwaterColor.value as THREE.Color).copy(p.underwaterColor);
    cu.uNear.value = camera.near;
    cu.uFar.value = camera.far;
    (cu.uResolution.value as THREE.Vector2).set(this.outWidth, this.outHeight);
    // Sharpen more the further the scene is scaled up to the display.
    const upscale = this.outWidth / Math.max(1, this.width);
    cu.uSharpen.value = this.resolution.sharpness * (0.35 + 0.35 * Math.min(1, Math.max(0, upscale - 1)));
    this.composite.render(renderer, null);
    gpu.finishFrame();
  }

  /** Snap eye adaptation to the next frame's target (camera cuts, loads). */
  resetExposure(): void {
    this.exposure.forceReset();
    this.clouds?.reset();
    this.taa.reset();
  }

  /** Debug probe (stalls the GPU): exposure state. */
  probeExposure(): { exposure: number; luminance: number } {
    return this.exposure.probe(this.renderer);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.finalTarget.dispose();
    this.bloom.dispose();
    this.exposure.dispose();
    this.ssao.dispose();
    this.godRays.dispose();
    this.taa.dispose();
    this.composite.dispose();
    this.sky.dispose();
    this.atmosphere.dispose();
  }
}

export { createFullscreenMaterial };
