import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { adoptCsmHook, patchDirectionalLightVisibility } from './materials/MaterialPatches';
import type { QualitySettings } from './Quality';

/**
 * Sun/moon directional lighting with cascaded shadow maps. Ambient light
 * comes from the sky's PMREM environment (image-based lighting), so there is
 * no hemisphere/ambient light fighting the physically based sky.
 */
export class Lighting {
  csm: CSM;
  private readonly materials = new Set<THREE.Material>();
  private readonly lightDir = new THREE.Vector3(0, -1, 0);
  private readonly color = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: QualitySettings,
  ) {
    this.csm = this.createCsm(quality);
  }

  private createCsm(quality: QualitySettings): CSM {
    const csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: quality.shadowCascades,
      maxFar: quality.shadowDistance,
      mode: 'practical',
      shadowMapSize: quality.shadowMapSize,
      lightDirection: this.lightDir,
      lightIntensity: 1,
      lightNear: 1,
      lightFar: 2400,
      lightMargin: 700,
      shadowBias: -0.00018,
    });
    csm.fade = true;
    // CSM (re)injects its lights chunk; layer cloud visibility on top.
    patchDirectionalLightVisibility();
    for (const light of csm.lights) {
      light.shadow.normalBias = 0.035;
      light.layers.enableAll();
    }
    return csm;
  }

  /** Registers a lit material for cascaded shadows (chains existing patches). */
  setupMaterial(material: THREE.Material): void {
    if (this.materials.has(material)) return;
    this.materials.add(material);
    this.csm.setupMaterial(material);
    adoptCsmHook(material);
  }

  setQuality(quality: QualitySettings): void {
    this.csm.remove();
    this.csm.dispose();
    this.csm = this.createCsm(quality);
    const materials = [...this.materials];
    this.materials.clear();
    for (const material of materials) this.setupMaterial(material);
    this.csm.updateFrustums();
  }

  /**
   * @param direction unit vector toward the dominant light (sun or moon)
   * @param color light color (transmittance-tinted)
   * @param intensity light intensity
   */
  update(direction: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.lightDir.copy(direction).negate();
    this.csm.lightDirection.copy(this.lightDir);
    this.color.copy(color);
    // Fade shadows as the light approaches the horizon (long smeared cascades).
    const elevation = direction.y;
    const shadowStrength = THREE.MathUtils.smoothstep(elevation, 0.02, 0.12);
    for (const light of this.csm.lights) {
      light.color.copy(this.color);
      light.intensity = intensity;
      light.shadow.intensity = shadowStrength;
      light.castShadow = elevation > 0.01;
    }
    this.csm.update();
  }

  dispose(): void {
    this.csm.remove();
    this.csm.dispose();
  }
}
