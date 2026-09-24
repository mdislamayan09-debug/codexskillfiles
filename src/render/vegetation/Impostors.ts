import * as THREE from 'three';
import { addPatch, replaceOnce } from '../materials/MaterialPatches';
import type { FoliageTextures } from './foliageTextures';

export const IMPOSTOR_VIEWS = 8;
const TILE = 256;
const ELEVATION = 0.12;

export interface ImpostorSource {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry | null;
  barkLayer: number;
  height: number;
  width: number;
}

const BAKE_VERT = /* glsl */ `
attribute float aLayer;
varying vec2 vUvB;
varying vec3 vNormalObj;
varying float vLayerB;
void main() {
  vUvB = uv;
  vNormalObj = normal;
  vLayerB = aLayer;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BAKE_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uLayer;
uniform float uUseAttrLayer;
uniform float uCutout;
uniform int uMode; // 0 albedo, 1 normal
varying vec2 vUvB;
varying vec3 vNormalObj;
varying float vLayerB;
void main() {
  float layer = uUseAttrLayer > 0.5 ? floor(vLayerB + 0.5) : uLayer;
  vec4 t = texture(uTex, vec3(vUvB, layer));
  if (uCutout > 0.5 && t.a < 0.5) discard;
  if (uMode == 0) gl_FragColor = vec4(t.rgb, 1.0);
  else gl_FragColor = vec4(normalize(vNormalObj) * 0.5 + 0.5, 1.0);
}
`;

/** Bakes views of each tree species and renders far trees as billboards. */
export class Impostors {
  readonly albedo: THREE.WebGLArrayRenderTarget;
  readonly normal: THREE.WebGLArrayRenderTarget;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly offsets: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  /** Billboard size (m) per kind at scale 1. */
  readonly sizes: number[] = [];
  count = 0;

  constructor(renderer: THREE.WebGLRenderer, sources: ImpostorSource[], textures: FoliageTextures, capacity: number, alphaToCoverage: boolean) {
    const layers = sources.length * IMPOSTOR_VIEWS;
    const opts: THREE.RenderTargetOptions = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    };
    this.albedo = new THREE.WebGLArrayRenderTarget(TILE, TILE, layers, opts);
    this.albedo.texture.colorSpace = THREE.SRGBColorSpace;
    this.normal = new THREE.WebGLArrayRenderTarget(TILE, TILE, layers, opts);
    this.bake(renderer, sources, textures);

    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    this.geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    this.geometry.setIndex([0, 1, 2, 1, 3, 2]);
    this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.offsets.setUsage(THREE.DynamicDrawUsage);
    this.params.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aImpOffset', this.offsets);
    this.geometry.setAttribute('aImpParams', this.params);
    this.geometry.instanceCount = 0;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    this.material = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, alphaToCoverage, side: THREE.DoubleSide });
    this.material.name = 'impostor';
    const uniforms = {
      uImpAlbedo: { value: this.albedo.texture },
      uImpNormal: { value: this.normal.texture },
      uImpA2C: { value: alphaToCoverage ? 1 : 0 },
    };
    addPatch(this.material, {
      key: 'impostor',
      apply(shader) {
        Object.assign(shader.uniforms, uniforms);
        let vs = shader.vertexShader;
        vs = replaceOnce(
          vs,
          '#include <common>',
          `#include <common>
attribute vec4 aImpOffset; // x, y, z, yaw
attribute vec4 aImpParams; // layer base, size, tint, unused
varying vec2 vImpUv;
varying float vImpYaw;
varying float vImpBase;
varying float vImpTint;
varying vec3 vImpCenter;`,
          'imp vpars',
        );
        vs = replaceOnce(
          vs,
          '#include <begin_vertex>',
          `vec3 center = aImpOffset.xyz;
vec3 toCam = cameraPosition - center;
toCam.y = 0.0;
toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
float size = aImpParams.y;
vec3 transformed = center + right * position.x * size + vec3(0.0, position.y * size - size * 0.02, 0.0);
vImpUv = uv;
vImpYaw = aImpOffset.w;
vImpBase = aImpParams.x;
vImpTint = aImpParams.z;
vImpCenter = center;`,
          'imp begin',
        );
        shader.vertexShader = vs;
        let fs = shader.fragmentShader;
        fs = replaceOnce(
          fs,
          '#include <common>',
          `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uImpAlbedo;
uniform sampler2DArray uImpNormal;
uniform float uImpA2C;
varying vec2 vImpUv;
varying float vImpYaw;
varying float vImpBase;
varying float vImpTint;
varying vec3 vImpCenter;`,
          'imp fpars',
        );
        fs = replaceOnce(
          fs,
          '#include <map_fragment>',
          `vec3 toCamW = cameraPosition - vImpCenter;
float rel = atan(toCamW.x, toCamW.z) - vImpYaw;
float frame = mod(rel / (6.2831853 / ${IMPOSTOR_VIEWS}.0) + ${IMPOSTOR_VIEWS * 4}.0, ${IMPOSTOR_VIEWS}.0);
float f0 = floor(frame);
float f1 = mod(f0 + 1.0, ${IMPOSTOR_VIEWS}.0);
float ft = frame - f0;
vec4 a0 = texture(uImpAlbedo, vec3(vImpUv, vImpBase + f0));
vec4 a1 = texture(uImpAlbedo, vec3(vImpUv, vImpBase + f1));
vec4 n0 = texture(uImpNormal, vec3(vImpUv, vImpBase + f0));
vec4 n1 = texture(uImpNormal, vec3(vImpUv, vImpBase + f1));
vec4 impAlb = mix(a0, a1, ft);
vec3 impN = normalize(mix(n0.xyz, n1.xyz, ft) * 2.0 - 1.0);
float impA = impAlb.a;
if (uImpA2C > 0.5) {
  impA = clamp((impA - 0.5) / max(fwidth(impA), 1e-4) + 0.5, 0.0, 1.0);
  if (impA < 0.01) discard;
} else if (impA < 0.5) discard;
diffuseColor.rgb = impAlb.rgb * vImpTint;
diffuseColor.a = impA;
float cy = cos(vImpYaw);
float sy = sin(vImpYaw);
vec3 impWorldN = vec3(impN.x * cy + impN.z * sy, impN.y, -impN.x * sy + impN.z * cy);`,
          'imp map',
        );
        fs = replaceOnce(
          fs,
          '#include <normal_fragment_begin>',
          `float faceDirection = 1.0;\nvec3 normal = normalize((viewMatrix * vec4(impWorldN, 0.0)).xyz);\nvec3 nonPerturbedNormal = normal;`,
          'imp normal',
        );
        fs = replaceOnce(fs, '#include <normal_fragment_maps>', '', 'imp nmaps');
        shader.fragmentShader = fs;
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'impostors';
  }

  private bake(renderer: THREE.WebGLRenderer, sources: ImpostorSource[], textures: FoliageTextures): void {
    const scene = new THREE.Scene();
    const makeMat = (tex: THREE.Texture, cutout: boolean, attrLayer: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: BAKE_VERT,
        fragmentShader: BAKE_FRAG,
        uniforms: {
          uTex: { value: tex },
          uLayer: { value: 0 },
          uUseAttrLayer: { value: attrLayer ? 1 : 0 },
          uCutout: { value: cutout ? 1 : 0 },
          uMode: { value: 0 },
        },
        side: THREE.DoubleSide,
      });
    const barkMat = makeMat(textures.bark.texture, false, false);
    const leafMat = makeMat(textures.foliage.texture, true, true);
    const previous = renderer.getRenderTarget();
    const clearColor = new THREE.Color();
    renderer.getClearColor(clearColor);
    const clearAlpha = renderer.getClearAlpha();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);

    sources.forEach((src, k) => {
      const size = Math.max(src.height, src.width) * 1.04;
      this.sizes[k] = size;
      scene.clear();
      const barkMesh = new THREE.Mesh(src.bark, barkMat);
      scene.add(barkMesh);
      if (src.leaves) scene.add(new THREE.Mesh(src.leaves, leafMat));
      camera.left = -size / 2;
      camera.right = size / 2;
      camera.top = size / 2;
      camera.bottom = -size / 2;
      camera.updateProjectionMatrix();
      barkMat.uniforms.uLayer.value = src.barkLayer;
      for (let v = 0; v < IMPOSTOR_VIEWS; v += 1) {
        const a = (v / IMPOSTOR_VIEWS) * Math.PI * 2;
        const dist = 200;
        const centerY = size / 2;
        camera.position.set(Math.sin(a) * dist, centerY + Math.sin(ELEVATION) * dist, Math.cos(a) * dist);
        camera.lookAt(0, centerY, 0);
        camera.updateMatrixWorld();
        for (const mode of [0, 1]) {
          barkMat.uniforms.uMode.value = mode;
          leafMat.uniforms.uMode.value = mode;
          const target = mode === 0 ? this.albedo : this.normal;
          renderer.setRenderTarget(target, k * IMPOSTOR_VIEWS + v);
          // Transparent black background; normals default to "up".
          renderer.setClearColor(mode === 0 ? 0x000000 : 0x80ff80, 0);
          renderer.clear(true, true, false);
          renderer.render(scene, camera);
        }
      }
    });
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColor, clearAlpha);
    barkMat.dispose();
    leafMat.dispose();
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, z: number, yaw: number, kind: number, scale: number, tint: number): void {
    if (this.count >= this.offsets.count) return;
    const o = this.offsets.array as Float32Array;
    const p = this.params.array as Float32Array;
    const i = this.count * 4;
    o[i] = x;
    o[i + 1] = y;
    o[i + 2] = z;
    o[i + 3] = yaw;
    p[i] = kind * IMPOSTOR_VIEWS;
    p[i + 1] = this.sizes[kind] * scale;
    p[i + 2] = tint;
    p[i + 3] = 0;
    this.count += 1;
  }

  end(): void {
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.offsets.clearUpdateRanges();
      this.offsets.addUpdateRange(0, this.count * 4);
      this.offsets.needsUpdate = true;
      this.params.clearUpdateRanges();
      this.params.addUpdateRange(0, this.count * 4);
      this.params.needsUpdate = true;
    }
  }

  dispose(): void {
    this.albedo.dispose();
    this.normal.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
