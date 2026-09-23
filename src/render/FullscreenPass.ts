import * as THREE from 'three';

// One oversized triangle covering clip space; uv spans [0,1] over the screen.
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export interface FullscreenMaterialOptions {
  fragmentShader: string;
  uniforms?: Record<string, THREE.IUniform>;
  defines?: Record<string, string | number | boolean>;
  blending?: THREE.Blending;
  transparent?: boolean;
  depthTest?: boolean;
  depthFunc?: THREE.DepthModes;
  vertexShader?: string;
}

export function createFullscreenMaterial(options: FullscreenMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: options.vertexShader ?? FULLSCREEN_VERT,
    fragmentShader: options.fragmentShader,
    uniforms: options.uniforms ?? {},
    defines: options.defines ?? {},
    depthTest: options.depthTest ?? false,
    depthWrite: false,
    depthFunc: options.depthFunc ?? THREE.LessEqualDepth,
    blending: options.blending ?? THREE.NoBlending,
    transparent: options.transparent ?? false,
    toneMapped: false,
    fog: false,
  });
}

/** Renders a single material over the whole target. */
export class FullscreenPass {
  readonly mesh: THREE.Mesh;

  constructor(readonly material: THREE.ShaderMaterial) {
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, clear = false): void {
    renderer.setRenderTarget(target);
    if (clear) renderer.clear(true, false, false);
    renderer.render(this.mesh, camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

export function createHdrTarget(width: number, height: number, options: Partial<THREE.RenderTargetOptions> = {}): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    ...options,
  });
}
