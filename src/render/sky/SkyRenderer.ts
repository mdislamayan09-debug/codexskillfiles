import * as THREE from 'three';
import type { Atmosphere } from '../atmosphere/Atmosphere';
import { SKY_DOME_FRAG, SKY_DOME_VERT, SKY_VIEW_FRAG, SKY_VIEW_VERT } from './skyGlsl';

const fullscreenGeometry = new THREE.BufferGeometry();
fullscreenGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fullscreenGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

export interface SkyState {
  time: number;
  moonPhaseLight: number;
  starRotation: THREE.Matrix3;
  aurora: number;
  cloudCover: number;
  resonance: number;
}

/**
 * The sky is drawn inside the main opaque pass as the last opaque object at
 * the far plane (so covered pixels are skipped), and captured into a PMREM
 * environment for image-based lighting whenever the sun has moved enough.
 */
export class SkyRenderer {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly domeScene = new THREE.Scene();
  private readonly cubeTarget = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: false });
  private readonly cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastEnvSun = new THREE.Vector3(9, 9, 9);
  private lastEnvCover = -1;
  private envAge = 1e9;
  private readonly invViewProj = new THREE.Matrix4();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly atmosphere: Atmosphere,
  ) {
    const a = atmosphere.uniforms;
    this.uniforms = {
      uTransmittanceLUTSky: a.uTransmittanceLUT,
      uSkyViewLUT: a.uSkyViewLUT,
      uSkyViewMoonLUT: a.uSkyViewMoonLUT,
      uViewPosMM: a.uViewPosMM,
      uSunDir: a.uSunDir,
      uMoonDir: a.uMoonDir,
      uSunIntensity: a.uSunIntensity,
      uMoonIntensity: a.uMoonIntensity,
      uMoonPhaseLight: { value: 1 },
      uStarRotation: { value: new THREE.Matrix3() },
      uTime: { value: 0 },
      uAurora: { value: 0 },
      uCloudCover: { value: 0 },
      uResonanceTint: { value: new THREE.Color(0.37, 0.95, 0.84) },
      uResonance: { value: 0 },
      uInvViewProj: { value: this.invViewProj },
      uCamPos: { value: new THREE.Vector3() },
      uCloudTex: { value: null },
      uCloudsEnabled: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: SKY_VIEW_VERT,
      fragmentShader: SKY_VIEW_FRAG,
      uniforms: this.uniforms,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(fullscreenGeometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1_000_000;
    this.mesh.name = 'sky';

    const domeMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      uniforms: {
        ...this.uniforms,
        uGroundAlbedo: { value: new THREE.Color(0.16, 0.17, 0.12) },
        uSunColorIBL: a.uSunColor,
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), domeMaterial);
    dome.frustumCulled = false;
    this.domeScene.add(dome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  update(camera: THREE.PerspectiveCamera, state: SkyState): void {
    const u = this.uniforms;
    u.uTime.value = state.time;
    u.uMoonPhaseLight.value = state.moonPhaseLight;
    u.uStarRotation.value.copy(state.starRotation);
    u.uAurora.value = state.aurora;
    u.uCloudCover.value = state.cloudCover;
    u.uResonance.value = state.resonance;
    camera.updateMatrixWorld();
    this.invViewProj.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
  }

  setClouds(texture: THREE.Texture | null): void {
    this.uniforms.uCloudTex.value = texture;
    this.uniforms.uCloudsEnabled.value = texture ? 1 : 0;
  }

  /** Re-captures the sky into a PMREM environment when lighting changed enough. Returns the env texture. */
  updateEnvironment(dt: number, force = false): THREE.Texture | null {
    this.envAge += dt;
    const sun = this.atmosphere.uniforms.uSunDir.value;
    const cover = this.uniforms.uCloudCover.value as number;
    const moved = sun.angleTo(this.lastEnvSun) > 0.012 || Math.abs(cover - this.lastEnvCover) > 0.05;
    if (!force && !(moved && this.envAge > 0.5) && this.envTarget) return null;
    this.envAge = 0;
    this.lastEnvSun.copy(sun);
    this.lastEnvCover = cover;
    const previous = this.renderer.getRenderTarget();
    this.cubeCamera.update(this.renderer, this.domeScene);
    this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget ?? undefined);
    this.renderer.setRenderTarget(previous);
    return this.envTarget.texture;
  }

  get environment(): THREE.Texture | null {
    return this.envTarget?.texture ?? null;
  }

  dispose(): void {
    this.cubeTarget.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
