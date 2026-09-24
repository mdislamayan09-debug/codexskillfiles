import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { VEIL_RADIUS } from '../world/WorldConfig';
import type { WorldData } from '../world/WorldData';

// The two walls of light that define the island, and what they hold.
//
// The Veil stands on the sea all the way around the Stillwild: the shimmer
// the Meridian flew into. The Hush is the smaller wall over the crater at
// the island's heart, where Hallowmere, the Veyr city, lies held beneath
// it. Above the crater turns the Crown, a set of vast stone rings inlaid
// with songstone: a landmark you can see from anywhere on the island.
// Until the five bells ring, the Hush is solid; after, it thins and lets
// you walk down into the city, and when the note resolves it fades away
// and the city's lamps come on.

const HUSH_RADIUS = 146;
const HUSH_HEIGHT = 520;
const CROWN_HEIGHT = 250;

const CURTAIN_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Curtains of light: slow vertical bands, brighter where seen edge-on. */
const CURTAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uBands;
uniform float uFadeTop;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
void main() {
  float a = vUv.x * uBands;
  float y = vUv.y;
  // Broad folded curtains that drift sideways and ripple upward.
  float fold = n1(a + uTime * 0.04) * 0.6 + n1(a * 2.3 - uTime * 0.06 + y * 1.5) * 0.4;
  float rays = n1(a * 4.1 + y * 0.6 + uTime * 0.02);
  float shimmer = 0.88 + 0.12 * sin(y * 36.0 - uTime * 1.1 + a * 2.0);
  float band = pow(fold, 1.7) * (0.65 + 0.35 * rays) * shimmer;
  // Rising from mist at the foot, fading long before the top.
  float foot = smoothstep(0.0, 0.03, y);
  float top = 1.0 - smoothstep(uFadeTop * 0.15, uFadeTop, y);
  vec3 toEye = normalize(cameraPosition - vWorld);
  float edge = 1.0 - abs(dot(toEye, normalize(vNormalW)));
  float glow = band * foot * top * (0.2 + 1.1 * pow(edge, 2.5));
  vec3 color = mix(uColorA, uColorB, fold);
  gl_FragColor = vec4(color * glow * uIntensity, 1.0);
}`;

function curtain(radius: number, height: number, bands: number, colorA: number, colorB: number, fadeTop: number): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    vertexShader: CURTAIN_VERT,
    fragmentShader: CURTAIN_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uBands: { value: bands },
      uFadeTop: { value: fadeTop },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 256, 1, true);
  geometry.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.layers.set(LAYER_TRANSPARENT);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, material };
}

export class Stillheart {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly veil: { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  private readonly hush: { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  private readonly crown = new THREE.Group();
  private readonly rings: THREE.Object3D[] = [];
  private readonly windowMaterial: THREE.MeshStandardMaterial;
  private readonly inlayMaterial: THREE.MeshStandardMaterial;
  private time = 0;
  /** Solid towers, piers and the Heart (circles for the player's collision). */
  private readonly solids: { x: number; z: number; radius: number; height: number; baseY: number }[] = [];
  /** 0 solid .. 1 open: the Hush thins once all five bells ring. */
  private thin = 0;
  /** 0 .. 1 after the ending: the Hush gone, the city lit. */
  private resolved = 0;
  readonly floorY: number;

  constructor(private readonly world: WorldData) {
    const stone = new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.86, metalness: 0 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x6f6a61, roughness: 0.9, metalness: 0 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x3f6f68, roughness: 0.5, metalness: 0.6 });
    this.windowMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0xffc46a, emissiveIntensity: 0.05, roughness: 0.6 });
    this.inlayMaterial = new THREE.MeshStandardMaterial({ color: 0x1b6f64, emissive: 0x2bd6c0, emissiveIntensity: 1.6, roughness: 0.25 });
    const crownStone = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.7, metalness: 0.05 });
    this.materials.push(stone, darkStone, roof, this.windowMaterial, this.inlayMaterial, crownStone);
    this.floorY = world.heightAt(0, 0);

    this.buildCity(stone, darkStone, roof);
    this.buildCrown(crownStone);

    this.veil = curtain(VEIL_RADIUS, 900, 240, 0x9fe8ff, 0xffe0b0, 0.45);
    this.group.add(this.veil.mesh);
    this.hush = curtain(HUSH_RADIUS, HUSH_HEIGHT, 70, 0xffe6b0, 0x7ff0dc, 0.85);
    this.hush.mesh.position.y = this.floorY - 6;
    this.group.add(this.hush.mesh);
  }

  // ---------------------------------------------------------------------------
  // Hallowmere: a circular city of pale towers on the crater floor.

  private buildCity(stone: THREE.Material, darkStone: THREE.Material, roof: THREE.Material): void {
    const rng = createRng(0x4a110e);
    const parts = { stone: [] as THREE.BufferGeometry[], dark: [] as THREE.BufferGeometry[], roof: [] as THREE.BufferGeometry[], window: [] as THREE.BufferGeometry[] };
    const at = (x: number, z: number) => this.world.heightAt(x, z);
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => {
      g.rotateY(ry);
      g.translate(x, y, z);
      return g;
    };
    // Towers in three concentric rings, leaving avenues toward the centre.
    const rings = [
      { r: 44, count: 7, h: [26, 40], w: [5, 7] },
      { r: 78, count: 12, h: [16, 30], w: [5, 8] },
      { r: 112, count: 16, h: [10, 22], w: [4, 7] },
    ];
    for (const ring of rings) {
      for (let k = 0; k < ring.count; k += 1) {
        const a = (k / ring.count) * Math.PI * 2 + rng() * 0.2;
        // Avenues: skip towers near the four processional ways.
        const quarter = ((a / (Math.PI / 2)) % 1 + 1) % 1;
        if (quarter < 0.06 || quarter > 0.94) continue;
        const r = ring.r + (rng() - 0.5) * 10;
        const x = Math.sin(a) * r;
        const z = -Math.cos(a) * r;
        const y = at(x, z) - 1;
        const h = ring.h[0] + rng() * (ring.h[1] - ring.h[0]);
        const w = ring.w[0] + rng() * (ring.w[1] - ring.w[0]);
        const round = rng() < 0.55;
        // Broken tops: some towers stop short and jagged.
        const broken = rng() < 0.3;
        const body = round ? new THREE.CylinderGeometry(w * 0.45, w * 0.55, h, 14) : new THREE.BoxGeometry(w, h, w);
        this.solids.push({ x, z, radius: w * (round ? 0.55 : 0.62), height: h + 2, baseY: y - 1 });
        parts.stone.push(place(body, x, y + h / 2, z, a));
        parts.dark.push(place(round ? new THREE.CylinderGeometry(w * 0.6, w * 0.62, 1.4, 14) : new THREE.BoxGeometry(w * 1.1, 1.4, w * 1.1), x, y + 0.7, z, a));
        if (!broken) {
          const cap = round ? new THREE.ConeGeometry(w * 0.55, w * 0.9, 14) : new THREE.ConeGeometry(w * 0.75, w * 1.1, 4);
          parts.roof.push(place(cap, x, y + h + (round ? w * 0.45 : w * 0.55), z, a + (round ? 0 : Math.PI / 4)));
        } else {
          for (let s = 0; s < 4; s += 1) {
            const shard = new THREE.BoxGeometry(w * 0.25, 2 + rng() * 4, w * 0.25);
            parts.stone.push(place(shard, x + (rng() - 0.5) * w * 0.6, y + h + 1, z + (rng() - 0.5) * w * 0.6, rng()));
          }
        }
        // Rows of windows (dark until the note resolves).
        const rows = Math.floor(h / 5);
        for (let row = 1; row < rows; row += 1) {
          for (let s = 0; s < 4; s += 1) {
            const wa = a + (s * Math.PI) / 2 + 0.3;
            const wr = round ? w * 0.5 : w * 0.51;
            const win = new THREE.BoxGeometry(0.7, 1.4, 0.3);
            parts.window.push(place(win, x + Math.sin(wa) * wr, y + row * 5, z - Math.cos(wa) * wr, wa));
          }
        }
      }
    }
    // Bridges between the middle ring's towers: arches on piers.
    for (let k = 0; k < 10; k += 1) {
      const a = (k / 10) * Math.PI * 2 + 0.31;
      const x = Math.sin(a) * 62;
      const z = -Math.cos(a) * 62;
      const y = at(x, z);
      parts.dark.push(place(new THREE.BoxGeometry(3, 12, 3), x, y + 6, z, a));
      this.solids.push({ x, z, radius: 1.9, height: 12, baseY: y - 1 });
      parts.stone.push(place(new THREE.BoxGeometry(22, 1.6, 4), x, y + 12.5, z, a + Math.PI / 2));
    }
    // The Heart: a tall central spire with a great bell cage near its top.
    const cy = at(0, 0);
    parts.stone.push(place(new THREE.CylinderGeometry(6, 11, 70, 20), 0, cy + 35, 0));
    this.solids.push({ x: 0, z: 0, radius: 11.5, height: 110, baseY: cy - 2 });
    parts.dark.push(place(new THREE.CylinderGeometry(13, 14, 4, 20), 0, cy + 2, 0));
    parts.stone.push(place(new THREE.CylinderGeometry(2.5, 6, 30, 16), 0, cy + 85, 0));
    parts.roof.push(place(new THREE.ConeGeometry(3.5, 14, 16), 0, cy + 107, 0));
    for (let s = 0; s < 8; s += 1) {
      const a = (s / 8) * Math.PI * 2;
      parts.dark.push(place(new THREE.BoxGeometry(1.2, 14, 1.2), Math.sin(a) * 6.4, cy + 78, -Math.cos(a) * 6.4, a));
    }
    const merge = (list: THREE.BufferGeometry[], material: THREE.Material, shadow = true) => {
      const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    merge(parts.stone, stone);
    merge(parts.dark, darkStone);
    merge(parts.roof, roof);
    merge(parts.window, this.windowMaterial, false);
    // The great bell hanging in the cage.
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.2, 6, 20, 1, true), this.inlayMaterial);
    bell.position.set(0, cy + 76, 0);
    this.group.add(bell);
  }

  // ---------------------------------------------------------------------------
  // The Crown: nested stone rings turning above the crater.

  private buildCrown(stone: THREE.Material): void {
    // An armillary of slender bands, each turning on its own axis: from
    // far off it should read as a slow, luminous instrument, not a disc.
    const specs = [
      { r: 80, tube: 1.5, tilt: 0.34, yaw: 0 },
      { r: 62, tube: 1.25, tilt: 0.95, yaw: 1.1 },
      { r: 44, tube: 1.05, tilt: 1.35, yaw: 2.3 },
      { r: 28, tube: 0.85, tilt: 0.6, yaw: 3.7 },
    ];
    for (const spec of specs) {
      const ring = new THREE.Group();
      // Twin bands with a gap, bound together by the inlays.
      const band = new THREE.TorusGeometry(spec.r, spec.tube, 10, 200);
      const pair = mergeGeometries([band.clone().translate(0, 0, spec.tube * 1.6), band.translate(0, 0, -spec.tube * 1.6)], false) as THREE.BufferGeometry;
      const body = new THREE.Mesh(pair, stone);
      body.castShadow = true;
      ring.add(body);
      // Songstone inlays set into the ring at intervals.
      const inlays: THREE.BufferGeometry[] = [];
      const count = Math.round(spec.r / 3);
      for (let k = 0; k < count; k += 1) {
        const a = (k / count) * Math.PI * 2;
        const g = new THREE.BoxGeometry(spec.tube * 0.7, spec.tube * 0.7, spec.tube * 4.4);
        g.rotateZ(a);
        g.translate(Math.cos(a) * spec.r, Math.sin(a) * spec.r, 0);
        inlays.push(g);
      }
      ring.add(new THREE.Mesh(mergeGeometries(inlays, false) as THREE.BufferGeometry, this.inlayMaterial));
      // Each band sits in a gimbal: tilted, then turning about its own axis.
      const gimbal = new THREE.Group();
      gimbal.rotation.set(Math.PI / 2 + spec.tilt, spec.yaw, 0);
      gimbal.add(ring);
      ring.userData.spin = (0.025 + spec.tilt * 0.02) * (spec.yaw > 2 ? -1 : 1);
      this.crown.add(gimbal);
      this.rings.push(ring);
    }
    this.crown.position.set(0, this.world.heightAt(0, 0) + CROWN_HEIGHT, 0);
    this.group.add(this.crown);
  }

  // ---------------------------------------------------------------------------

  /**
   * `open`: all five bells rung (the Hush thins). `resolved`: the ending has
   * played (the Hush is gone and the city is lit). `night`: 0 day .. 1 night.
   */
  update(dt: number, open: boolean, resolved: boolean, night: number, camera: THREE.Vector3): void {
    this.time += dt;
    this.thin += ((open ? 1 : 0) - this.thin) * Math.min(1, dt * 0.3);
    this.resolved += ((resolved ? 1 : 0) - this.resolved) * Math.min(1, dt * 0.15);
    for (const ring of this.rings) ring.rotation.z += dt * (ring.userData.spin as number) * (1 - this.resolved * 0.7);
    this.crown.rotation.y += dt * 0.01;
    // The Veil: faint by day, luminous at night; strongest when you're near it.
    const toVeil = Math.max(0, VEIL_RADIUS - Math.hypot(camera.x, camera.z));
    const near = 1 - Math.min(1, toVeil / 350);
    this.veil.material.uniforms.uTime.value = this.time;
    this.veil.material.uniforms.uIntensity.value = (0.025 + 0.07 * night) * (1 + 2.2 * near * near) * (1 - this.resolved * 0.5);
    this.hush.material.uniforms.uTime.value = this.time;
    this.hush.material.uniforms.uIntensity.value = (0.14 + 0.22 * night) * (1 - 0.65 * this.thin) * (1 - this.resolved);
    this.hush.mesh.visible = this.resolved < 0.99;
    this.windowMaterial.emissiveIntensity = 0.05 + this.resolved * (1.2 + 1.6 * night);
    this.inlayMaterial.emissiveIntensity = 1.4 + 0.6 * Math.sin(this.time * 0.7) + this.resolved * 1.2;
  }

  /**
   * Keep the player out of the Hush until it thins: returns the corrected
   * position (or null when there's nothing to push against).
   */
  barrier(x: number, z: number): { x: number; z: number } | null {
    if (this.thin > 0.5) return null;
    const r = Math.hypot(x, z);
    const inside = HUSH_RADIUS - 1;
    if (r >= inside || r < 1) return null;
    // Came from outside: back out to the wall.
    const s = (HUSH_RADIUS + 0.6) / r;
    return { x: x * s, z: z * s };
  }

  /** City walls near a point, for the player's collision. */
  collidersNear(x: number, z: number, r: number, out: { x: number; z: number; radius: number; height: number; baseY?: number }[]): void {
    if (x * x + z * z > (HUSH_RADIUS + r) ** 2) return;
    for (const c of this.solids) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (r + c.radius) ** 2) out.push(c);
  }

  get hushRadius(): number {
    return HUSH_RADIUS;
  }
}
