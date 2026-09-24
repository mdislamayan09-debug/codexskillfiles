import * as THREE from 'three';
import type { EventBus } from '../core/Events';
import { createRng } from '../core/rng';
import { addPatch, replaceOnce } from '../render/materials/MaterialPatches';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import type { WorldData } from '../world/WorldData';
import { generateRock } from '../world/props/RockGenerator';
import type { ItemStack } from './Inventory';
import type { Station } from './recipes';

// Placed things: campfires, stations, beds, chests and utility pieces.
// Placement shows a ghost that turns red with a reason when invalid.
// A small pool of point lights follows the nearest lit fires and lanterns so
// the number of lights (and so every shader) never changes at runtime.

export type StructureType =
  | 'campfire'
  | 'bedroll'
  | 'workbench'
  | 'chest'
  | 'tanning_rack'
  | 'cooking_pot'
  | 'smelter'
  | 'farm_plot'
  | 'rain_collector'
  | 'lantern_post';

export interface StructureData {
  id: string;
  type: StructureType;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Campfire/smelter fuel in in-game hours. */
  fuel?: number;
  contents?: (ItemStack | null)[];
  /** Rain collector water (sips). */
  water?: number;
  /** Farm plot: crop and planting hour. */
  crop?: { planted: number; ready: number } | null;
}

interface Placed {
  data: StructureData;
  object: THREE.Group;
  flame?: THREE.Mesh;
}

const FOOTPRINT: Record<StructureType, number> = {
  campfire: 0.9,
  bedroll: 1.1,
  workbench: 1.1,
  chest: 0.6,
  tanning_rack: 1.0,
  cooking_pot: 0.6,
  smelter: 1.0,
  farm_plot: 1.4,
  rain_collector: 0.6,
  lantern_post: 0.3,
};

const STATION_OF: Partial<Record<StructureType, Station>> = {
  campfire: 'campfire',
  workbench: 'workbench',
  tanning_rack: 'tanning_rack',
  cooking_pot: 'cooking_pot',
  smelter: 'smelter',
};

const NAMES: Record<StructureType, string> = {
  campfire: 'Campfire',
  bedroll: 'Bedroll',
  workbench: 'Workbench',
  chest: 'Storage Chest',
  tanning_rack: 'Tanning Rack',
  cooking_pot: 'Cooking Pot',
  smelter: 'Smelter',
  farm_plot: 'Farm Plot',
  rain_collector: 'Rain Collector',
  lantern_post: 'Lantern Post',
};

const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uScale;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uScale;
  gl_Position = projectionMatrix * mv;
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  float t = uTime * 2.6 + uSeed;
  float turb = n(vec2(uv.x * 2.5 + uSeed, uv.y * 1.8 - t)) * 0.55 + n(vec2(uv.x * 5.0, uv.y * 3.5 - t * 1.6)) * 0.3;
  uv.x += (turb - 0.4) * 0.45 * (uv.y + 1.0) * 0.5;
  float width = max(0.2, 1.0 - (uv.y + 1.0) * 0.45);
  float shape = 1.0 - smoothstep(0.0, 1.0, length(vec2(uv.x * 1.6 / width, (uv.y + 0.4) * 0.9)));
  shape *= smoothstep(-1.0, -0.55, uv.y) * (0.75 + 0.5 * turb);
  float core = pow(max(shape, 0.0), 2.2);
  vec3 col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.78, 0.42), core) * (shape * 7.0 + core * 16.0);
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

function standard(color: THREE.ColorRepresentation, roughness = 0.85, metalness = 0, emissive: THREE.ColorRepresentation = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });
}

export class Structures {
  readonly group = new THREE.Group();
  readonly lights: THREE.PointLight[] = [];
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly placed: Placed[] = [];
  private readonly ghost = new THREE.Group();
  private ghostType: StructureType | null = null;
  private readonly ghostMaterial: THREE.MeshStandardMaterial;
  private readonly flameUniforms = { uTime: { value: 0 } };
  private nextId = 1;
  private readonly m = {
    stone: standard(0x77736b, 0.9),
    log: standard(0x5a3f26, 0.85),
    charred: standard(0x1d1714, 0.95, 0, 0x2a0800),
    plank: standard(0x8a6a44, 0.8),
    darkPlank: standard(0x5b4128, 0.85),
    rope: standard(0xa8946a, 0.95),
    cloth: standard(0x6d5a3f, 0.95),
    hide: standard(0x9a7a56, 0.8),
    clay: standard(0x9a6a4c, 0.85),
    soil: standard(0x3a2a1e, 1),
    iron: standard(0x5f6166, 0.45, 0.85),
    brass: standard(0xa88a4c, 0.35, 1),
    glass: standard(0xffd7a0, 0.2, 0, 0xffa050),
    glow: standard(0x2a1406, 0.9, 0, 0xff5a10),
  };
  /** Validity of the current ghost placement and why. */
  ghostValid = false;
  ghostReason = '';
  private readonly ghostPos = new THREE.Vector3();
  private ghostYaw = 0;

  constructor(
    private readonly world: WorldData,
    private readonly events: EventBus,
    lightCount = 4,
  ) {
    for (const mat of Object.values(this.m)) this.materials.push(mat);
    for (let i = 0; i < lightCount; i += 1) {
      const light = new THREE.PointLight(0xff9a50, 0, 22, 2);
      light.castShadow = false;
      this.lights.push(light);
      this.group.add(light);
    }
    this.ghostMaterial = new THREE.MeshStandardMaterial({ color: 0x9fe8c8, transparent: true, opacity: 0.45, roughness: 0.6, depthWrite: false });
    addPatch(this.ghostMaterial, {
      key: 'ghost',
      apply(shader) {
        shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb += diffuse * 0.35;', 'ghost-glow');
      },
    });
    this.ghost.visible = false;
    this.group.add(this.ghost);
  }

  // ---------------------------------------------------------------------------
  // Meshes

  private flame(scale: number, seed: number): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      uniforms: { uTime: this.flameUniforms.uTime, uIntensity: { value: 1 }, uSeed: { value: seed }, uScale: { value: scale } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.4), mat);
    mesh.layers.set(LAYER_TRANSPARENT);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return mesh;
  }

  private build(type: StructureType, seed: number): { group: THREE.Group; flame?: THREE.Mesh } {
    const g = new THREE.Group();
    const m = this.m;
    const rng = createRng(seed);
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      g.add(mesh);
      return mesh;
    };
    const cyl = (r0: number, r1: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0, seg = 8) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, 0, rz);
      g.add(mesh);
      return mesh;
    };
    let flame: THREE.Mesh | undefined;
    switch (type) {
      case 'campfire': {
        const stone = generateRock({ seed: 3100, kind: 'pebble', detail: 1 }).geometry;
        for (let i = 0; i < 9; i += 1) {
          const a = (i / 9) * Math.PI * 2;
          const s = new THREE.Mesh(stone, m.stone);
          s.position.set(Math.cos(a) * 0.48, 0.02, Math.sin(a) * 0.48);
          s.scale.setScalar(0.13 + rng() * 0.05);
          s.rotation.y = rng() * 6;
          g.add(s);
        }
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 4) * Math.PI * 2 + 0.3;
          const log = cyl(0.045, 0.05, 0.62, i % 2 ? m.log : m.charred, Math.cos(a) * 0.1, 0.13, Math.sin(a) * 0.1, 0, 0);
          log.rotation.set(Math.sin(a) * 1.05, 0, -Math.cos(a) * 1.05);
        }
        const embers = cyl(0.2, 0.26, 0.04, m.glow, 0, 0.02, 0, 0, 0, 10);
        void embers;
        flame = this.flame(0.62, seed * 0.13);
        flame.position.set(0, 0.42, 0);
        g.add(flame);
        break;
      }
      case 'bedroll': {
        const mat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.9), m.cloth);
        mat.position.y = 0.03;
        g.add(mat);
        const roll = cyl(0.12, 0.12, 0.8, m.hide, 0, 0.12, -0.85, 0, Math.PI / 2, 12);
        void roll;
        break;
      }
      case 'workbench': {
        box(1.6, 0.08, 0.75, m.plank, 0, 0.86, 0);
        for (const [x, z] of [
          [-0.7, -0.3],
          [0.7, -0.3],
          [-0.7, 0.3],
          [0.7, 0.3],
        ]) box(0.09, 0.84, 0.09, m.darkPlank, x, 0.42, z);
        box(1.4, 0.05, 0.08, m.darkPlank, 0, 0.25, -0.3);
        box(1.4, 0.05, 0.08, m.darkPlank, 0, 0.25, 0.3);
        box(0.3, 0.06, 0.2, m.stone, 0.45, 0.93, 0.1, 0.4);
        cyl(0.018, 0.018, 0.42, m.log, -0.3, 0.92, 0.12, 0, Math.PI / 2 - 0.2);
        box(0.12, 0.05, 0.08, m.stone, -0.1, 0.93, 0.15);
        break;
      }
      case 'chest': {
        box(0.9, 0.5, 0.55, m.plank, 0, 0.25, 0);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.9, 12, 1, false, 0, Math.PI), m.darkPlank);
        lid.rotation.set(0, 0, Math.PI / 2);
        lid.position.set(0, 0.5, 0);
        g.add(lid);
        box(0.94, 0.05, 0.6, m.iron, 0, 0.12, 0);
        box(0.94, 0.05, 0.6, m.iron, 0, 0.42, 0);
        box(0.08, 0.1, 0.03, m.brass, 0, 0.44, 0.29);
        break;
      }
      case 'tanning_rack': {
        cyl(0.04, 0.045, 1.8, m.log, -0.8, 0.9, 0);
        cyl(0.04, 0.045, 1.8, m.log, 0.8, 0.9, 0);
        cyl(0.035, 0.035, 1.75, m.log, 0, 1.7, 0, 0, Math.PI / 2);
        cyl(0.035, 0.035, 1.75, m.log, 0, 0.3, 0, 0, Math.PI / 2);
        box(1.3, 1.25, 0.02, m.hide, 0, 1.0, 0);
        break;
      }
      case 'cooking_pot': {
        for (let i = 0; i < 3; i += 1) {
          const a = (i / 3) * Math.PI * 2;
          const leg = cyl(0.02, 0.025, 1.1, m.log, Math.cos(a) * 0.3, 0.5, Math.sin(a) * 0.3);
          leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
        }
        const pot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0.4, Math.PI - 0.4), m.clay);
        pot.position.y = 0.55;
        g.add(pot);
        break;
      }
      case 'smelter': {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.3, 12), m.stone);
        body.position.y = 0.65;
        g.add(body);
        cyl(0.18, 0.24, 0.6, m.clay, 0, 1.55, 0);
        box(0.34, 0.3, 0.1, m.glow, 0, 0.35, 0.58);
        break;
      }
      case 'farm_plot': {
        box(2.4, 0.18, 2.4, m.soil, 0, 0.05, 0);
        for (const [x, z, w, d] of [
          [0, 1.22, 2.5, 0.1],
          [0, -1.22, 2.5, 0.1],
          [1.22, 0, 0.1, 2.5],
          [-1.22, 0, 0.1, 2.5],
        ]) box(w, 0.22, d, m.darkPlank, x, 0.1, z);
        break;
      }
      case 'rain_collector': {
        cyl(0.32, 0.28, 0.7, m.darkPlank, 0, 0.35, 0, 0, 0, 12);
        const funnel = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.35, 12, 1, true), m.cloth);
        funnel.rotation.x = Math.PI;
        funnel.position.y = 0.95;
        g.add(funnel);
        break;
      }
      case 'lantern_post': {
        cyl(0.05, 0.06, 2.2, m.log, 0, 1.1, 0);
        cyl(0.025, 0.025, 0.45, m.log, 0.2, 2.1, 0, 0, Math.PI / 2);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), m.glass);
        lamp.position.set(0.4, 1.95, 0);
        g.add(lamp);
        break;
      }
    }
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh !== flame) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { group: g, flame };
  }

  // ---------------------------------------------------------------------------
  // Placement

  /** Update the placement ghost from the camera's aim; returns the prompt text. */
  updateGhost(type: StructureType | null, camera: THREE.Camera, rotate: boolean): string | null {
    if (!type) {
      this.ghost.visible = false;
      this.ghostType = null;
      return null;
    }
    if (type !== this.ghostType) {
      this.ghost.clear();
      const { group } = this.build(type, 1);
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = this.ghostMaterial;
          mesh.castShadow = false;
        }
      });
      this.ghost.add(group);
      this.ghostType = type;
    }
    if (rotate) this.ghostYaw += Math.PI / 4;
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(origin);
    camera.getWorldDirection(dir);
    const hit = new THREE.Vector3();
    const t = this.world.raycast(origin, dir, 5.5, hit);
    this.ghost.visible = true;
    if (t < 0) {
      // Nothing in reach: hover at arm's length.
      hit.copy(origin).addScaledVector(dir, 3);
      hit.y = this.world.heightAt(hit.x, hit.z);
    }
    this.ghostPos.copy(hit);
    this.ghost.position.copy(hit);
    this.ghost.rotation.y = this.ghostYaw + Math.atan2(origin.x - hit.x, origin.z - hit.z);
    const valid = this.validate(type, hit.x, hit.z, origin);
    this.ghostValid = valid === '';
    this.ghostReason = valid;
    this.ghostMaterial.color.set(this.ghostValid ? 0x9fe8c8 : 0xff7a6a);
    return this.ghostValid ? `Place ${NAMES[type]}` : `${NAMES[type]} · ${valid}`;
  }

  private validate(type: StructureType, x: number, z: number, from: THREE.Vector3): string {
    const r = FOOTPRINT[type];
    if (Math.hypot(x - from.x, z - from.z) > 5) return 'too far';
    if (this.world.waterDepthAt(x, z) > -0.05) return 'in water';
    // Slope across the footprint.
    const h = [this.world.heightAt(x - r, z), this.world.heightAt(x + r, z), this.world.heightAt(x, z - r), this.world.heightAt(x, z + r)];
    if (Math.max(...h) - Math.min(...h) > r * 0.9) return 'too steep';
    for (const p of this.placed) {
      const min = r + FOOTPRINT[p.data.type] * 0.85;
      if ((p.data.x - x) ** 2 + (p.data.z - z) ** 2 < min * min) return 'blocked';
    }
    return '';
  }

  /** Place the ghosted structure; returns the new structure or null. */
  placeGhost(): StructureData | null {
    if (!this.ghostType || !this.ghostValid) return null;
    const data: StructureData = {
      id: `s${this.nextId++}`,
      type: this.ghostType,
      x: this.ghostPos.x,
      y: this.world.heightAt(this.ghostPos.x, this.ghostPos.z),
      z: this.ghostPos.z,
      yaw: this.ghost.rotation.y,
    };
    if (data.type === 'campfire') data.fuel = 6;
    if (data.type === 'chest') data.contents = new Array(24).fill(null);
    if (data.type === 'rain_collector') data.water = 0;
    this.add(data);
    this.events.emit('notify', { text: `${NAMES[data.type]} placed`, icon: data.type === 'campfire' ? 'campfire' : 'build', tone: 'good' });
    this.events.emit('crafted', { recipe: 'place', item: data.type, count: 1 });
    return data;
  }

  private add(data: StructureData): void {
    const { group, flame } = this.build(data.type, this.nextId * 7 + data.x);
    group.position.set(data.x, data.y, data.z);
    group.rotation.y = data.yaw;
    this.group.add(group);
    this.placed.push({ data, object: group, flame });
  }

  remove(id: string): StructureData | null {
    const i = this.placed.findIndex((p) => p.data.id === id);
    if (i < 0) return null;
    const [p] = this.placed.splice(i, 1);
    this.group.remove(p.object);
    return p.data;
  }

  // ---------------------------------------------------------------------------
  // Queries

  /** Structure the player is looking at (within reach). */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): StructureData | null {
    let best: StructureData | null = null;
    let bestT = reach;
    for (const p of this.placed) {
      const d = p.data;
      const r = FOOTPRINT[d.type];
      const cx = d.x - origin.x;
      const cy = d.y + 0.5 - origin.y;
      const cz = d.z - origin.z;
      const along = cx * dir.x + cy * dir.y + cz * dir.z;
      if (along < 0 || along > bestT + r) continue;
      const miss = Math.hypot(cx - dir.x * along, cy - dir.y * along, cz - dir.z * along);
      if (miss < r + 0.2 && along < bestT + r) {
        bestT = along;
        best = d;
      }
    }
    return best;
  }

  /** Stations available within reach of a point. */
  stationsNear(x: number, z: number, radius = 4): Set<Station> {
    const out = new Set<Station>(['hands']);
    let fire = false;
    let pot = false;
    for (const p of this.placed) {
      const d = p.data;
      if ((d.x - x) ** 2 + (d.z - z) ** 2 > radius * radius) continue;
      if (d.type === 'campfire' && (d.fuel ?? 0) > 0) fire = true;
      if (d.type === 'cooking_pot') pot = true;
      const s = STATION_OF[d.type];
      if (s && s !== 'campfire' && s !== 'cooking_pot') out.add(s);
    }
    if (fire) out.add('campfire');
    if (pot && fire) out.add('cooking_pot');
    return out;
  }

  /** Warmth (°C) from lit fires reaching a point. */
  heatAt(x: number, y: number, z: number): number {
    let heat = 0;
    for (const p of this.placed) {
      const d = p.data;
      if ((d.type !== 'campfire' && d.type !== 'smelter') || (d.fuel ?? 0) <= 0) continue;
      const dist = Math.hypot(d.x - x, d.y - y, d.z - z);
      heat += 16 * Math.max(0, 1 - dist / 6) ** 1.5;
    }
    return heat;
  }

  nearestOfType(type: StructureType, x: number, z: number): StructureData | null {
    let best: StructureData | null = null;
    let bestD = Infinity;
    for (const p of this.placed) {
      if (p.data.type !== type) continue;
      const d = (p.data.x - x) ** 2 + (p.data.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.data;
      }
    }
    return best;
  }

  get all(): StructureData[] {
    return this.placed.map((p) => p.data);
  }

  static label(type: StructureType): string {
    return NAMES[type];
  }

  // ---------------------------------------------------------------------------
  // Per-frame

  update(dt: number, hoursElapsed: number, time: number, camX: number, camZ: number, raining: number): void {
    this.flameUniforms.uTime.value = time;
    for (const p of this.placed) {
      const d = p.data;
      if (d.type === 'campfire') {
        if ((d.fuel ?? 0) > 0) d.fuel = Math.max(0, (d.fuel ?? 0) - hoursElapsed * (1 + raining));
        if (p.flame) p.flame.visible = (d.fuel ?? 0) > 0;
      }
      if (d.type === 'rain_collector' && raining > 0) d.water = Math.min(10, (d.water ?? 0) + hoursElapsed * raining * 4);
    }
    // Light pool: nearest lit fires and lanterns.
    const sources: { x: number; y: number; z: number; d: number; kind: number }[] = [];
    for (const p of this.placed) {
      const d = p.data;
      const lit = (d.type === 'campfire' && (d.fuel ?? 0) > 0) || d.type === 'lantern_post' || (d.type === 'smelter' && (d.fuel ?? 0) > 0);
      if (!lit) continue;
      const dist = (d.x - camX) ** 2 + (d.z - camZ) ** 2;
      const y = d.y + (d.type === 'lantern_post' ? 1.95 : 0.6);
      const x = d.x + (d.type === 'lantern_post' ? Math.cos(d.yaw) * 0.4 : 0);
      const z = d.z - (d.type === 'lantern_post' ? Math.sin(d.yaw) * 0.4 : 0);
      sources.push({ x, y, z, d: dist, kind: d.type === 'lantern_post' ? 1 : 0 });
    }
    sources.sort((a, b) => a.d - b.d);
    this.lights.forEach((light, i) => {
      const s = sources[i];
      if (!s || s.d > 160 * 160) {
        light.intensity = 0;
        return;
      }
      light.position.set(s.x, s.y, s.z);
      const flicker = s.kind === 0 ? 0.82 + 0.18 * Math.sin(time * 13.1 + i) * Math.sin(time * 5.3 + i * 2.1) : 1;
      light.color.setRGB(1, s.kind === 0 ? 0.55 : 0.72, s.kind === 0 ? 0.25 : 0.45);
      light.intensity = (s.kind === 0 ? 40 : 18) * flicker;
    });
    void dt;
  }

  // ---------------------------------------------------------------------------
  // Save

  serialize(): { next: number; items: StructureData[] } {
    return { next: this.nextId, items: this.placed.map((p) => ({ ...p.data })) };
  }

  load(data: { next: number; items: StructureData[] }): void {
    for (const p of this.placed) this.group.remove(p.object);
    this.placed.length = 0;
    this.nextId = data.next ?? 1;
    for (const item of data.items ?? []) this.add(item);
  }
}
