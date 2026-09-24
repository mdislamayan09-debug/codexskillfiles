import * as THREE from 'three';
import type { Atmosphere } from '../atmosphere/Atmosphere';
import { createFullscreenMaterial, createHdrTarget, FullscreenPass } from '../FullscreenPass';
import { CLOUD_MARCH_FRAG, DETAIL_NOISE_FRAG, SHAPE_NOISE_FRAG, WEATHER_MAP_FRAG } from './cloudGlsl';

const FS_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export interface CloudUniforms {
  uCloudWeather: { value: THREE.Texture | null };
  uCloudOffset: { value: THREE.Vector2 };
  uCloudWeatherScale: { value: number };
  uCloudCoverage: { value: number };
  uCloudBottom: { value: number };
  uCloudTop: { value: number };
  uCloudType: { value: number };
}

export function createCloudUniforms(): CloudUniforms {
  return {
    uCloudWeather: { value: null },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudWeatherScale: { value: 1 / 24000 },
    uCloudCoverage: { value: 0 },
    uCloudBottom: { value: 1500 },
    uCloudTop: { value: 3300 },
    uCloudType: { value: 0.45 },
  };
}

export interface CloudParams {
  coverage: number;
  type: number;
  windX: number;
  windZ: number;
  windSpeed: number;
}

/**
 * Raymarched cloud layer rendered at 1/16 of the scene resolution with a
 * per-frame sub-pixel jitter and temporal reprojection. Also owns the weather
 * map uniforms that ground materials use for moving cloud shadows.
 */
export class VolumetricClouds {
  readonly shape: THREE.WebGL3DRenderTarget;
  readonly detail: THREE.WebGL3DRenderTarget;
  readonly weather: THREE.WebGLRenderTarget;
  /** Shared by reference with every lit material (cloud shadows). */
  readonly uniforms: CloudUniforms;
  private targets: THREE.WebGLRenderTarget[] = [];
  private current = 0;
  private readonly march: FullscreenPass;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly viewProj = new THREE.Matrix4();
  private readonly invViewProj = new THREE.Matrix4();
  private frame = 0;
  private hasHistory = false;
  private width = 1;
  private height = 1;
  private readonly offset = new THREE.Vector2(3100, -1700);
  steps = 48;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly atmosphere: Atmosphere,
    uniforms: CloudUniforms,
    private readonly shapeSize = 64,
  ) {
    this.uniforms = uniforms;
    const opts3d = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    } as const;
    this.shape = new THREE.WebGL3DRenderTarget(shapeSize, shapeSize, shapeSize, opts3d);
    this.shape.texture.wrapR = THREE.RepeatWrapping;
    this.detail = new THREE.WebGL3DRenderTarget(32, 32, 32, opts3d);
    this.detail.texture.wrapR = THREE.RepeatWrapping;
    this.weather = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
    });
    this.uniforms.uCloudWeather.value = this.weather.texture;
    this.bakeNoise(renderer);

    const a = atmosphere.uniforms;
    this.march = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: CLOUD_MARCH_FRAG,
        uniforms: {
          ...this.uniforms,
          uShapeNoise: { value: this.shape.texture },
          uDetailNoise: { value: this.detail.texture },
          uHistory: { value: null },
          uSkyViewLUT: a.uSkyViewLUT,
          uTransmittanceLUT: a.uTransmittanceLUT,
          uInvViewProj: { value: this.invViewProj },
          uPrevViewProj: { value: this.prevViewProj },
          uCamPos: { value: new THREE.Vector3() },
          uSunDir: { value: new THREE.Vector3() },
          uSunColor: { value: new THREE.Color() },
          uSunIntensity: { value: 1 },
          uAmbientTop: { value: new THREE.Color() },
          uAmbientBottom: { value: new THREE.Color() },
          uTime: { value: 0 },
          uFrame: { value: 0 },
          uJitter: { value: new THREE.Vector2() },
          uSteps: { value: 48 },
          uHistoryWeight: { value: 0 },
          uDensityScale: { value: 1 },
          uWind: { value: new THREE.Vector2(1, 0) },
        },
      }),
    );
  }

  private bakeNoise(renderer: THREE.WebGLRenderer): void {
    const previous = renderer.getRenderTarget();
    const size = this.shapeSize;
    const shapePass = new FullscreenPass(createFullscreenMaterial({ fragmentShader: SHAPE_NOISE_FRAG, uniforms: { uSlice: { value: 0 }, uSize: { value: size } } }));
    for (let z = 0; z < size; z += 1) {
      shapePass.material.uniforms.uSlice.value = z;
      renderer.setRenderTarget(this.shape, z);
      renderer.render(shapePass.mesh, FS_CAMERA);
    }
    const detailPass = new FullscreenPass(createFullscreenMaterial({ fragmentShader: DETAIL_NOISE_FRAG, uniforms: { uSlice: { value: 0 }, uSize: { value: 32 } } }));
    for (let z = 0; z < 32; z += 1) {
      detailPass.material.uniforms.uSlice.value = z;
      renderer.setRenderTarget(this.detail, z);
      renderer.render(detailPass.mesh, FS_CAMERA);
    }
    const weatherPass = new FullscreenPass(createFullscreenMaterial({ fragmentShader: WEATHER_MAP_FRAG }));
    weatherPass.render(renderer, this.weather);
    renderer.setRenderTarget(previous);
    shapePass.dispose();
    detailPass.dispose();
    weatherPass.dispose();
  }

  get texture(): THREE.Texture {
    return this.targets[this.current]?.texture ?? null!;
  }

  setSize(sceneWidth: number, sceneHeight: number, divisor = 4): void {
    const w = Math.max(1, Math.ceil(sceneWidth / divisor));
    const h = Math.max(1, Math.ceil(sceneHeight / divisor));
    if (w === this.width && h === this.height && this.targets.length) return;
    this.width = w;
    this.height = h;
    for (const t of this.targets) t.dispose();
    this.targets = [createHdrTarget(w, h), createHdrTarget(w, h)];
    this.hasHistory = false;
  }

  /** Invalidate history after a camera cut. */
  reset(): void {
    this.hasHistory = false;
  }

  update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, dt: number, time: number, params: CloudParams): void {
    const u = this.uniforms;
    u.uCloudCoverage.value = params.coverage;
    u.uCloudType.value = params.type;
    this.offset.x += params.windX * params.windSpeed * dt;
    this.offset.y += params.windZ * params.windSpeed * dt;
    u.uCloudOffset.value.copy(this.offset);
    if (!this.targets.length) return;

    const m = this.march.material.uniforms;
    const a = this.atmosphere.uniforms;
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.invViewProj.copy(this.viewProj).invert();
    (m.uCamPos.value as THREE.Vector3).copy(camera.position);
    // Clouds are lit by whichever body dominates.
    const sunUp = a.uSunDir.value.y > -0.06;
    (m.uSunDir.value as THREE.Vector3).copy(sunUp ? a.uSunDir.value : a.uMoonDir.value);
    (m.uSunColor.value as THREE.Color).copy(sunUp ? a.uSunColor.value : a.uMoonColor.value);
    m.uSunIntensity.value = sunUp ? a.uSunIntensity.value : a.uMoonIntensity.value;
    // Ambient from the sky dome brightness (irradiance proxy).
    const skyAmb = a.uSunColor.value;
    const day = THREE.MathUtils.smoothstep(a.uSunDir.value.y, -0.12, 0.25);
    const night = 1 - day;
    const ambTop = m.uAmbientTop.value as THREE.Color;
    const ambBottom = m.uAmbientBottom.value as THREE.Color;
    ambTop.setRGB(0.22 + 0.2 * skyAmb.r, 0.28 + 0.22 * skyAmb.g, 0.38 + 0.24 * skyAmb.b).multiplyScalar(day * 0.85);
    ambTop.r += 0.004 * night;
    ambTop.g += 0.005 * night;
    ambTop.b += 0.009 * night;
    ambBottom.copy(ambTop).multiplyScalar(0.45);
    m.uTime.value = time;
    this.frame += 1;
    m.uFrame.value = this.frame % 64;
    // Sub-pixel jitter within the low-resolution texel (R2 sequence).
    const jx = (this.frame * 0.7548776662) % 1 - 0.5;
    const jy = (this.frame * 0.5698402909) % 1 - 0.5;
    (m.uJitter.value as THREE.Vector2).set(jx / this.width, jy / this.height);
    m.uSteps.value = this.steps;
    m.uWind.value.set(params.windX, params.windZ);
    m.uHistoryWeight.value = this.hasHistory ? 0.88 : 0;
    const next = 1 - this.current;
    m.uHistory.value = this.targets[this.current].texture;
    this.march.render(renderer, this.targets[next]);
    this.current = next;
    this.prevViewProj.copy(this.viewProj);
    this.hasHistory = true;
  }

  dispose(): void {
    this.shape.dispose();
    this.detail.dispose();
    this.weather.dispose();
    for (const t of this.targets) t.dispose();
    this.march.dispose();
  }
}
