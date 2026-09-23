import * as THREE from 'three';
import { createFullscreenMaterial, FullscreenPass } from '../FullscreenPass';
import { BAKE_ALBEDO_FRAG, BAKE_NORMAL_FRAG, LAYER_COUNT, LAYER_NORMAL_STRENGTH } from './terrainLayers';

/**
 * Bakes the procedural ground materials into two texture arrays once at
 * startup: albedo (sRGB) + height, and tangent normal + roughness + cavity.
 */
export class TerrainMaterialBaker {
  readonly albedoHeight: THREE.WebGLArrayRenderTarget;
  readonly normalRough: THREE.WebGLArrayRenderTarget;

  constructor(readonly size = 512) {
    const options: THREE.RenderTargetOptions = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      anisotropy: 8,
    };
    this.albedoHeight = new THREE.WebGLArrayRenderTarget(size, size, LAYER_COUNT, options);
    this.albedoHeight.texture.colorSpace = THREE.SRGBColorSpace;
    this.normalRough = new THREE.WebGLArrayRenderTarget(size, size, LAYER_COUNT, options);
  }

  bake(renderer: THREE.WebGLRenderer): void {
    const previous = renderer.getRenderTarget();
    const albedoPass = new FullscreenPass(createFullscreenMaterial({ fragmentShader: BAKE_ALBEDO_FRAG, uniforms: { uLayer: { value: 0 } } }));
    const normalPass = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: BAKE_NORMAL_FRAG,
        uniforms: {
          uAlbedoHeight: { value: this.albedoHeight.texture },
          uLayer: { value: 0 },
          uStrength: { value: 1 },
          uSize: { value: this.size },
        },
      }),
    );
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      albedoPass.material.uniforms.uLayer.value = layer;
      renderer.setRenderTarget(this.albedoHeight, layer);
      renderer.render(albedoPass.mesh, FULLSCREEN_CAMERA);
    }
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      normalPass.material.uniforms.uLayer.value = layer;
      normalPass.material.uniforms.uStrength.value = LAYER_NORMAL_STRENGTH[layer];
      renderer.setRenderTarget(this.normalRough, layer);
      renderer.render(normalPass.mesh, FULLSCREEN_CAMERA);
    }
    renderer.setRenderTarget(previous);
    albedoPass.dispose();
    normalPass.dispose();
  }

  dispose(): void {
    this.albedoHeight.dispose();
    this.normalRough.dispose();
  }
}

const FULLSCREEN_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
