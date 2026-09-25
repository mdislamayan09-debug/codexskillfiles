import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { adoptCsmHook, patchDirectionalLightVisibility } from './materials/MaterialPatches';
import type { QualitySettings } from './Quality';

/**
 * Sun/moon directional lighting with cascaded shadow maps. Ambient light
 * comes from the sky's PMREM environment (image-based lighting), so there is
 * no hemisphere/ambient light fighting the physically based sky.
 */
/**
 * Far cascades are drawn a little wider than the view needs, so they can be
 * redrawn less often: the slack covers the camera's movement in between.
 */
const CASCADE_SLACK = 1.16;

export class Lighting {
  csm: CSM;
  private readonly materials = new Set<THREE.Material>();
  private readonly lightDir = new THREE.Vector3(0, -1, 0);
  private readonly color = new THREE.Color();
  private frame = 0;
  /** Where each cascade's shadow camera stood when its map was last drawn. */
  private drawnAt: THREE.Vector3[] = [];
  private fittedAspect = 0;
  private fittedFov = 0;
  private readonly offset = new THREE.Vector3();
  /**
   * On a thin budget exactly one cascade is redrawn each frame, in turn:
   * every frame then costs the same, instead of a heavy one every other
   * frame missing the display's refresh.
   */
  private alternate = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: QualitySettings,
  ) {
    this.csm = this.createCsm(quality);
  }

  private createCsm(quality: QualitySettings): CSM {
    this.alternate = quality.budget < 1;
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
      light.shadow.autoUpdate = false;
      light.layers.enableAll();
    }
    // Widen the cascades that are not redrawn every frame whenever CSM fits
    // them to the view.
    const internals = csm as unknown as { _updateShadowBounds(): void };
    const fit = internals._updateShadowBounds.bind(csm);
    internals._updateShadowBounds = () => {
      fit();
      for (let i = this.alternate ? 0 : 1; i < csm.lights.length; i += 1) {
        const cam = csm.lights[i].shadow.camera;
        cam.left *= CASCADE_SLACK;
        cam.right *= CASCADE_SLACK;
        cam.top *= CASCADE_SLACK;
        cam.bottom *= CASCADE_SLACK;
        cam.updateProjectionMatrix();
      }
    };
    csm.updateFrustums();
    this.drawnAt = csm.lights.map(() => new THREE.Vector3(Number.NaN, 0, 0));
    this.fittedAspect = this.camera.aspect;
    this.fittedFov = this.camera.fov;
    return csm;
  }

  /**
   * The nearest cascade is redrawn every frame; the others take turns
   * (every 2nd, 4th and 8th frame), so a frame draws at most two shadow
   * maps instead of four. A cascade is also redrawn at once when the view
   * has drifted far enough to use up its slack.
   */
  private scheduleCascades(): void {
    const lights = this.csm.lights;
    const frame = this.frame;
    this.frame += 1;
    for (let i = 0; i < lights.length; i += 1) {
      const light = lights[i];
      const cam = light.shadow.camera;
      const period = 1 << i;
      const due = this.alternate ? frame % lights.length === i : i === 0 || frame % period === period >> 1;
      // How far the cascade CSM wants now sits from the one on the map.
      this.offset.copy(light.position).sub(this.drawnAt[i]);
      this.offset.addScaledVector(this.lightDir, -this.offset.dot(this.lightDir));
      const width = cam.right - cam.left;
      const slack = (width * (1 - 1 / CASCADE_SLACK)) / 2;
      const drifted = !(this.offset.length() < slack * 0.8);
      if (due || drifted) {
        light.shadow.needsUpdate = true;
        this.drawnAt[i].copy(light.position);
      }
    }
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
    // Refit the cascades when the view's shape changes (window size, field
    // of view, the spyglass): they were sized for the view at boot.
    if (this.camera.aspect !== this.fittedAspect || this.camera.fov !== this.fittedFov) {
      this.fittedAspect = this.camera.aspect;
      this.fittedFov = this.camera.fov;
      this.csm.updateFrustums();
      for (const p of this.drawnAt) p.set(Number.NaN, 0, 0);
    }
    this.csm.update();
    this.scheduleCascades();
  }

  dispose(): void {
    this.csm.remove();
    this.csm.dispose();
  }
}
