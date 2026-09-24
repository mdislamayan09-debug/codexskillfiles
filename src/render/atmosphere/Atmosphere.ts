import * as THREE from 'three';
import { createFullscreenMaterial, createHdrTarget, FullscreenPass } from '../FullscreenPass';
import { AERIAL_FRAG, MULTISCATTER_FRAG, SKYVIEW_FRAG, TRANSMITTANCE_FRAG } from './atmosphereGlsl';

/** Irradiance scale of a zenith sun, in renderer light units. */
export const SUN_ILLUMINANCE = 3.2;
/** Moonlight is far brighter than reality so nights stay readable. */
export const MOON_ILLUMINANCE = 0.055;

const GROUND_RADIUS_MM = 6.36;
const ATMOSPHERE_RADIUS_MM = 6.46;

export interface AtmosphereState {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** 0..1 moon brightness from its phase. */
  moonPhaseLight: number;
  /** Extra Mie haze (1 = clear day, >1 hazy/foggy). */
  mieScale: number;
  cameraAltitude: number;
  /** 0..1 of the sun covered by the moon. */
  eclipse?: number;
}

/**
 * Owns the atmosphere look-up tables and the uniforms every material and the
 * sky share. All radiance is in "per unit solar irradiance" and scaled by the
 * light intensity uniforms so sun, sky and haze always agree.
 */
export class Atmosphere {
  readonly transmittanceRT = createHdrTarget(256, 64);
  readonly multiScatterRT = createHdrTarget(32, 32);
  readonly skyViewSunRT = createHdrTarget(192, 108, { wrapS: THREE.RepeatWrapping });
  readonly skyViewMoonRT = createHdrTarget(192, 108, { wrapS: THREE.RepeatWrapping });
  readonly aerialRT = createHdrTarget(1024, 32);

  /** Uniform objects shared by reference with every patched material. */
  readonly uniforms = {
    uTransmittanceLUT: { value: this.transmittanceRT.texture as THREE.Texture },
    uMultiScatterLUT: { value: this.multiScatterRT.texture as THREE.Texture },
    uSkyViewLUT: { value: this.skyViewSunRT.texture as THREE.Texture },
    uSkyViewMoonLUT: { value: this.skyViewMoonRT.texture as THREE.Texture },
    uAerialLUT: { value: this.aerialRT.texture as THREE.Texture },
    uAerialMaxDistance: { value: 4200 },
    uAerialIntensity: { value: SUN_ILLUMINANCE },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunIntensity: { value: SUN_ILLUMINANCE },
    uEclipse: { value: 0 },
    uMoonIntensity: { value: MOON_ILLUMINANCE },
    uViewPosMM: { value: new THREE.Vector3(0, GROUND_RADIUS_MM + 0.0002, 0) },
    uMieScale: { value: 1 },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uMoonColor: { value: new THREE.Color(0.6, 0.7, 1) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    // Exponential height fog (weather / valley mist), meters.
    uFogDensity: { value: 0.0 },
    uFogHeight: { value: 30 },
    uFogFalloff: { value: 0.045 },
    uFogColorAmbient: { value: new THREE.Color(0.5, 0.55, 0.6) },
    uFogColorSun: { value: new THREE.Color(1, 0.9, 0.7) },
  };

  private readonly skyViewPass: FullscreenPass;
  private readonly aerialPass: FullscreenPass;
  private readonly invViewProj = new THREE.Matrix4();
  private readonly staticDirty = { value: true };
  private readonly transmittancePass: FullscreenPass;
  private readonly multiScatterPass: FullscreenPass;
  private lastMieScale = -1;

  constructor() {
    this.transmittancePass = new FullscreenPass(
      createFullscreenMaterial({ fragmentShader: TRANSMITTANCE_FRAG, uniforms: { uMieScale: this.uniforms.uMieScale } }),
    );
    this.multiScatterPass = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: MULTISCATTER_FRAG,
        uniforms: { uTransmittanceLUT: this.uniforms.uTransmittanceLUT, uMieScale: this.uniforms.uMieScale },
      }),
    );
    this.skyViewPass = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: SKYVIEW_FRAG,
        uniforms: {
          uTransmittanceLUT: this.uniforms.uTransmittanceLUT,
          uMultiScatterLUT: this.uniforms.uMultiScatterLUT,
          uMieScale: this.uniforms.uMieScale,
          uViewPos: this.uniforms.uViewPosMM,
          uSunDir: { value: new THREE.Vector3() },
        },
      }),
    );
    this.aerialPass = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: AERIAL_FRAG,
        uniforms: {
          uTransmittanceLUT: this.uniforms.uTransmittanceLUT,
          uMultiScatterLUT: this.uniforms.uMultiScatterLUT,
          uMieScale: this.uniforms.uMieScale,
          uViewPos: this.uniforms.uViewPosMM,
          uSunDir: { value: new THREE.Vector3() },
          uInvViewProj: { value: this.invViewProj },
          uCameraWorld: { value: new THREE.Vector3() },
          uMaxDistance: this.uniforms.uAerialMaxDistance,
          uDistanceScale: { value: 11 },
        },
      }),
    );
  }

  /** Haze thickness for aerial perspective (distance multiplier). */
  setHaze(distanceScale: number): void {
    this.aerialPass.material.uniforms.uDistanceScale.value = distanceScale;
  }

  update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, state: AtmosphereState): void {
    const u = this.uniforms;
    const mie = Math.round(state.mieScale * 20) / 20;
    if (mie !== this.lastMieScale) {
      u.uMieScale.value = mie;
      this.lastMieScale = mie;
      this.staticDirty.value = true;
    }
    if (this.staticDirty.value) {
      this.transmittancePass.render(renderer, this.transmittanceRT);
      this.multiScatterPass.render(renderer, this.multiScatterRT);
      this.staticDirty.value = false;
    }
    u.uSunDir.value.copy(state.sunDir);
    u.uMoonDir.value.copy(state.moonDir);
    // Treat the playable valley as sitting ~200 m above sea level.
    u.uViewPosMM.value.set(0, GROUND_RADIUS_MM + (200 + Math.max(0, state.cameraAltitude)) * 1e-6, 0);

    const skyUniforms = this.skyViewPass.material.uniforms;
    skyUniforms.uSunDir.value.copy(state.sunDir);
    this.skyViewPass.render(renderer, this.skyViewSunRT);
    skyUniforms.uSunDir.value.copy(state.moonDir);
    this.skyViewPass.render(renderer, this.skyViewMoonRT);

    // Light colors from the same transmittance model (evaluated on the CPU).
    // transmittanceToSpace returns a shared scratch array: consume each result immediately.
    const sunT = transmittanceToSpace(state.sunDir.y, state.cameraAltitude, mie);
    u.uSunColor.value.setRGB(sunT[0], sunT[1], sunT[2]);
    const moonT = transmittanceToSpace(state.moonDir.y, state.cameraAltitude, mie);
    u.uMoonColor.value.setRGB(moonT[0] * 0.78, moonT[1] * 0.86, moonT[2] * 1.0);
    const eclipse = state.eclipse ?? 0;
    u.uSunIntensity.value = SUN_ILLUMINANCE * (1 - 0.97 * eclipse);
    u.uEclipse.value = eclipse;
    u.uMoonIntensity.value = MOON_ILLUMINANCE * (0.25 + 0.75 * state.moonPhaseLight);

    // Aerial perspective from the dominant light.
    const sunUp = state.sunDir.y;
    const useMoon = sunUp < -0.08;
    const aerial = this.aerialPass.material.uniforms;
    aerial.uSunDir.value.copy(useMoon ? state.moonDir : state.sunDir);
    u.uAerialIntensity.value = useMoon ? u.uMoonIntensity.value : SUN_ILLUMINANCE;
    camera.updateMatrixWorld();
    this.invViewProj.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    aerial.uCameraWorld.value.setFromMatrixPosition(camera.matrixWorld);
    this.aerialPass.render(renderer, this.aerialRT);
  }

  dispose(): void {
    for (const rt of [this.transmittanceRT, this.multiScatterRT, this.skyViewSunRT, this.skyViewMoonRT, this.aerialRT]) rt.dispose();
    for (const pass of [this.transmittancePass, this.multiScatterPass, this.skyViewPass, this.aerialPass]) pass.dispose();
  }
}

// ---------------------------------------------------------------------------
// CPU evaluation of transmittance toward a light (same model as the shaders).

const RAYLEIGH = [5.802, 13.558, 33.1];
const MIE_SCAT = 3.996;
const MIE_ABS = 4.4;
const OZONE = [0.65, 1.881, 0.085];
const out3 = [1, 1, 1];

export function transmittanceToSpace(cosZenith: number, altitudeMeters: number, mieScale: number): number[] {
  const height = GROUND_RADIUS_MM + (200 + Math.max(0, altitudeMeters)) * 1e-6;
  const sinZ = Math.sqrt(Math.max(0, 1 - cosZenith * cosZenith));
  // Ray from (0, height, 0) toward (0, cos, -sin).
  const dx = 0;
  const dy = cosZenith;
  const dz = -sinZ;
  const b = height * dy;
  const cGround = height * height - GROUND_RADIUS_MM * GROUND_RADIUS_MM;
  const discGround = b * b - cGround;
  // Below the horizon: soft falloff instead of a hard cut so twilight glows.
  let horizonFade = 1;
  if (b < 0 && discGround > 0) horizonFade = Math.max(0, 1 + cosZenith * 12);
  const cTop = height * height - ATMOSPHERE_RADIUS_MM * ATMOSPHERE_RADIUS_MM;
  const tMax = -b + Math.sqrt(Math.max(0, b * b - cTop));
  const steps = 32;
  const od = [0, 0, 0];
  let t = 0;
  for (let i = 0; i < steps; i += 1) {
    const newT = ((i + 0.3) / steps) * tMax;
    const dt = newT - t;
    t = newT;
    const px = dx * t;
    const py = height + dy * t;
    const pz = dz * t;
    const alt = (Math.sqrt(px * px + py * py + pz * pz) - GROUND_RADIUS_MM) * 1000;
    const rd = Math.exp(-alt / 8);
    const md = Math.exp(-alt / 1.2) * mieScale;
    const oz = Math.max(0, 1 - Math.abs(alt - 25) / 15);
    for (let c = 0; c < 3; c += 1) {
      od[c] += dt * (RAYLEIGH[c] * rd + (MIE_SCAT + MIE_ABS) * md + OZONE[c] * oz);
    }
  }
  for (let c = 0; c < 3; c += 1) out3[c] = Math.exp(-od[c]) * horizonFade;
  return out3;
}
