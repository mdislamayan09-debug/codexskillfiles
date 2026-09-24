import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { angleDelta, clamp, damp, smoothstep } from '../core/math';
import { createRng } from '../core/rng';
import type { EventBus } from '../core/Events';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { generateRock } from '../world/props/RockGenerator';
import type { WorldData } from '../world/WorldData';
import { LANDMARKS } from '../world/WorldLayout';
import { BONE, CreatureBuilder, type CreatureLook, type CreatureRig } from './CreatureModel';

// The Wardens: vast guardians the Held Note will not let die, each bound to
// a Bellstone. They are not killed. Break the songstone knots grown into
// them, wear them down, and they kneel, the note loosens, and the grove
// blooms. Every attack is telegraphed (a roar, a rear, a pawed hoof, a
// glowing ring on the ground); a fair fight you learn by watching.
//
// Mossback, Warden of Hollowpine: an elk the size of a house with a forest
// on its back. Charges (stand before a big tree and it crashes into it),
// stomps a ring of force you jump over, sweeps its antlers at anyone close,
// and past half strength calls roots up from the ground under you.

export type WardenSound = 'roar' | 'stomp' | 'step' | 'charge' | 'crash' | 'roots' | 'rootsWarn' | 'crack' | 'calm';

export interface WardenHooks {
  player(): { x: number; y: number; z: number; grounded: boolean; alive: boolean };
  damagePlayer(amount: number, source: string, fromX: number, fromZ: number): void;
  knockPlayer(x: number, y: number, z: number): void;
  shake(amount: number): void;
  sound(kind: WardenSound, x: number, y: number, z: number, strength?: number): void;
  say(speaker: string, text: string, seconds?: number): void;
  /** Trees and rocks a charge can crash into. */
  obstacles(x: number, z: number, radius: number): { x: number; z: number; radius: number }[];
}

type Mode =
  | 'dormant'
  | 'waking'
  | 'stalk'
  | 'chargeWindup'
  | 'charge'
  | 'winded'
  | 'stompWindup'
  | 'stomp'
  | 'sweepWindup'
  | 'sweep'
  | 'roots'
  | 'stagger'
  | 'return'
  | 'calmed';

interface Knot {
  name: 'left' | 'right' | 'heart';
  bone: number;
  mesh: THREE.Group;
  material: THREE.MeshStandardMaterial;
  maxHp: number;
  hp: number;
  broken: boolean;
  radius: number;
  readonly world: THREE.Vector3;
}

interface Pose {
  phase: number;
  gait: number;
  rear: number;
  lower: number;
  sweep: number;
  kneel: number;
  lie: number;
  paw: number;
  flinch: number;
  bloom: number;
}

interface Wave {
  x: number;
  y: number;
  z: number;
  r: number;
  max: number;
  hit: boolean;
  ring: THREE.Mesh;
  dust: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dustMaterial: THREE.ShaderMaterial;
}

interface RootStrike {
  x: number;
  y: number;
  z: number;
  t: number;
  fuse: number;
  hit: boolean;
  decal: THREE.Mesh;
  decalMaterial: THREE.ShaderMaterial;
  spikes: THREE.Group;
}

export interface BossStatus {
  name: string;
  title: string;
  fraction: number;
  phaseAt: number;
}

const MAX_HP = 900;
const WAKE_RADIUS = 46;
const LEASH_RADIUS = 95;

const DECAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Ground telegraph: a pulsing ring that fills as the fuse burns. */
const DECAL_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float edge = smoothstep(0.86, 0.95, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float fill = step(r, uProgress) * (0.18 + 0.12 * sin(uTime * 18.0));
  float veins = pow(abs(sin(atan(p.y, p.x) * 7.0 + r * 9.0)), 24.0) * (1.0 - r) * 0.8;
  float a = edge * 1.4 + fill + veins * uProgress;
  gl_FragColor = vec4(uColor * a * 2.2, 1.0);
}`;

/** Shockwave: a ring of dust and force rolling outward. */
const WAVE_FRAG = /* glsl */ `
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // RingGeometry uv: x along the ring's angle is not provided; use radial y.
  float band = 1.0 - abs(vUv.y * 2.0 - 1.0);
  gl_FragColor = vec4(uColor * band * uFade * 1.6, 1.0);
}`;

const DUST_FRAG = /* glsl */ `
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float h = vUv.y;
  float a = (1.0 - h) * smoothstep(0.0, 0.15, h) * uFade;
  float grain = fract(sin(dot(floor(vUv * vec2(90.0, 12.0)), vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(uColor * a * (0.55 + 0.45 * grain), 1.0);
}`;

function additive(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.DoubleSide): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DECAL_VERT,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    toneMapped: false,
    fog: false,
  });
}

/** Vertex colours for merged decorative parts (no uvs: all share one material). */
function paint(g: THREE.BufferGeometry, color: (i: number, x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  // Merged parts must share attributes: keep only position and normal.
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const c = color(i, pos.getX(i), pos.getY(i), pos.getZ(i));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** A lumpy cap of moss (upper part of an ellipsoid) with lighter tufts. */
function mossMantle(rx: number, ry: number, rz: number, rng: () => number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 30, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const blobs = Array.from({ length: 26 }, () => {
    const a = rng() * Math.PI * 2;
    const b = rng() * 1.8;
    return { x: Math.sin(b) * Math.cos(a), y: Math.cos(b), z: Math.sin(b) * Math.sin(a), h: 0.06 + rng() * 0.16, w: 0.04 + rng() * 0.1 };
  });
  const lump = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let h = 0;
    for (const b of blobs) h += b.h * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2 + (z - b.z) ** 2) / b.w);
    // Fine tufts.
    h += 0.025 * Math.sin(x * 23 + z * 17) * Math.sin(y * 19 - x * 11);
    lump[i] = h;
    const s = 1 + h;
    pos.setXYZ(i, x * s * rx, y * s * ry, z * s * rz);
  }
  g.computeVertexNormals();
  const dark = new THREE.Color(0.1, 0.16, 0.05);
  const light = new THREE.Color(0.3, 0.4, 0.12);
  const lichen = new THREE.Color(0.46, 0.48, 0.36);
  const c = new THREE.Color();
  // Colour per vertex before de-indexing (indices map 1:1 in toNonIndexed order).
  const index = g.index as THREE.BufferAttribute;
  return paint(g, (i) => {
    const src = index.getX(i);
    const h = lump[src];
    c.copy(dark).lerp(light, clamp(h * 3.2 + 0.2, 0, 1));
    const speck = Math.sin(src * 12.9898) * 43758.5453;
    if (speck - Math.floor(speck) > 0.93) c.lerp(lichen, 0.7);
    return c;
  });
}

export class WardenSystem {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly builder = new CreatureBuilder();
  private readonly rig: CreatureRig;
  private readonly knots: Knot[] = [];
  private readonly attachMaterial: THREE.MeshStandardMaterial;
  private readonly flowerMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly flowers: THREE.Mesh[] = [];
  private readonly waves: Wave[] = [];
  private readonly strikes: RootStrike[] = [];
  private readonly rng = createRng(0x3055bac);
  private readonly pose: Pose = { phase: 0, gait: 0, rear: 0, lower: 0, sweep: 0, kneel: 0, lie: 1, paw: 0, flinch: 0, bloom: 0 };
  private readonly target: Pose = { phase: 0, gait: 0, rear: 0, lower: 0, sweep: 0, kneel: 0, lie: 1, paw: 0, flinch: 0, bloom: 0 };

  readonly id = 'mossback';
  readonly name = 'Mossback';
  readonly title = 'Warden of Hollowpine';
  readonly flag = 'warden_hollowpine';
  mode: Mode = 'dormant';
  hp = MAX_HP;
  /** Tests/photo mode: keep sleeping even with the player close. */
  holdDormant = false;
  /** Seconds in the current mode. */
  private t = 0;
  private time = 0;
  private cooldown = 0;
  private phase2 = false;
  private readonly pos = new THREE.Vector3();
  private yaw = -Math.PI / 2;
  private speed = 0;
  private readonly bed = new THREE.Vector3();
  private readonly bedYaw = -Math.PI / 2;
  private readonly arena = new THREE.Vector3();
  private readonly chargeDir = new THREE.Vector2();
  private chargeDistance = 0;
  private chargeHit = false;
  private sweepSide = 1;
  private sweepHit = false;
  private stompCount = 0;
  private rootsCast = 0;
  private stepTimer = 0;
  private attackCount = 0;
  private readonly bodyColliders = [
    { x: 0, z: 0, radius: 1.5, height: 4.5 },
    { x: 0, z: 0, radius: 1.5, height: 4.5 },
    { x: 0, z: 0, radius: 1.1, height: 4 },
  ];
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly world: WorldData,
    private readonly events: EventBus,
    private readonly hooks: WardenHooks,
  ) {
    const bell = LANDMARKS.find((l) => l.id === 'bell_hollowpine');
    if (!bell) throw new Error('Mossback needs the Hollowpine Bellstone');
    this.arena.set(bell.x, world.heightAt(bell.x, bell.z), bell.z);
    // The Warden sleeps beside its Bellstone, facing the way strangers come.
    this.bed.set(bell.x + 15, 0, bell.z + 5);
    this.bed.y = world.heightAt(this.bed.x, this.bed.z);
    this.pos.copy(this.bed);
    this.yaw = this.bedYaw;

    this.attachMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.flowerMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xfff2d8, emissiveIntensity: 0.12 });
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x1a0c02, emissive: 0xffa53a, emissiveIntensity: 3, roughness: 0.3 });
    this.rig = this.build();
    this.materials.push(...(this.builder.materials as THREE.MeshStandardMaterial[]), this.attachMaterial, this.flowerMaterial, this.eyeMaterial);
    for (const k of this.knots) this.materials.push(k.material);
    this.group.add(this.rig.mesh);
    this.place();
    this.applyPose(0);
  }

  // ---------------------------------------------------------------------------
  // Model

  private build(): CreatureRig {
    const look: CreatureLook = {
      plan: 'quadruped',
      length: 6.4,
      height: 4.4,
      bulk: 1.35,
      neck: 0.72,
      headSize: 1.08,
      snout: 1.0,
      legThickness: 0.24,
      tail: 0.1,
      ears: 'small',
      horns: 'antlers',
      coat: new THREE.Color(0.14, 0.2, 0.08),
      belly: new THREE.Color(0.2, 0.16, 0.12),
      accent: new THREE.Color(0.6, 0.56, 0.46),
      roughness: 0.95,
    };
    const rig = this.builder.build(look);
    rig.mesh.updateMatrixWorld(true);
    const rest = rig.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    const rng = createRng(0x5eed1);
    const L = look.length;
    const H = look.height;
    const legLen = H * 0.62;
    const hipY = legLen + look.legThickness;
    const bodyR = (H - legLen) * 0.55 * look.bulk + 0.02;

    // Decorative parts per bone, merged so the whole forest is a few draws.
    const perBone = new Map<number, THREE.BufferGeometry[]>();
    const put = (bone: number, g: THREE.BufferGeometry, world: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3) => {
      if (scale) g.scale(scale.x, scale.y, scale.z);
      if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
      g.translate(world.x - rest[bone].x, world.y - rest[bone].y, world.z - rest[bone].z);
      const list = perBone.get(bone) ?? [];
      list.push(g);
      perBone.set(bone, list);
    };
    const solid = (color: THREE.Color, jitter = 0.08) => (i: number) => {
      const n = Math.sin(i * 7.31) * 0.5 + 0.5;
      return color.clone().multiplyScalar(1 - jitter + n * jitter * 2);
    };
    // Moss mantles over the hindquarters and the shoulders.
    put(BONE.spine, mossMantle(bodyR * 1.1, bodyR * 0.78, L * 0.36, rng), new THREE.Vector3(0, hipY + bodyR * 0.32, L * 0.1));
    put(BONE.chest, mossMantle(bodyR * 1.16, bodyR * 0.85, L * 0.3, rng), new THREE.Vector3(0, hipY + bodyR * 0.42, -L * 0.22));
    put(BONE.neck, mossMantle(bodyR * 0.62, bodyR * 0.5, bodyR * 0.8, rng), new THREE.Vector3(0, hipY + bodyR * 0.95, -L * 0.47), new THREE.Euler(-0.5, 0, 0));
    // Saplings and ferns rooted in the moss.
    const bark = new THREE.Color(0.27, 0.21, 0.15);
    const leaf = [new THREE.Color(0.2, 0.33, 0.1), new THREE.Color(0.28, 0.4, 0.12), new THREE.Color(0.35, 0.36, 0.1)];
    const backY = (z: number) => hipY + bodyR * (z > -L * 0.05 ? 1.02 : 1.2);
    for (let i = 0; i < 5; i += 1) {
      const z = -L * 0.3 + i * L * 0.13 + (rng() - 0.5) * 0.4;
      const x = (rng() - 0.5) * bodyR * 1.1;
      const bone = z < -L * 0.05 ? BONE.chest : BONE.spine;
      const h = 1.1 + rng() * 1.3;
      const base = new THREE.Vector3(x, backY(z) - 0.15, z);
      const lean = new THREE.Euler((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.5);
      const trunk = new THREE.CylinderGeometry(0.035, 0.07, h, 5);
      trunk.translate(0, h / 2, 0);
      put(bone, paint(trunk, solid(bark)), base, lean);
      for (let k = 0; k < 3; k += 1) {
        const crown = new THREE.IcosahedronGeometry(0.34 + rng() * 0.26, 0);
        crown.translate((rng() - 0.5) * 0.4, h * (0.7 + k * 0.14), (rng() - 0.5) * 0.4);
        put(bone, paint(crown, solid(leaf[(i + k) % 3], 0.15)), base.clone(), lean, new THREE.Vector3(1, 0.8, 1));
      }
    }
    for (let i = 0; i < 9; i += 1) {
      const z = -L * 0.4 + rng() * L * 0.72;
      const x = (rng() - 0.5) * bodyR * 1.5;
      const bone = z < -L * 0.05 ? BONE.chest : BONE.spine;
      const base = new THREE.Vector3(x, backY(z) - 0.2, z);
      for (let f = 0; f < 5; f += 1) {
        const frond = new THREE.PlaneGeometry(0.22, 0.95, 1, 3);
        const fp = frond.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < fp.count; v += 1) {
          const y = fp.getY(v) + 0.475;
          fp.setY(v, y);
          fp.setZ(v, -y * y * 0.35);
          fp.setX(v, fp.getX(v) * (1 - y * 0.8));
        }
        put(bone, paint(frond, solid(leaf[f % 3], 0.2)), base.clone(), new THREE.Euler(-0.5, (f / 5) * Math.PI * 2 + rng(), 0, 'YXZ'));
      }
    }
    // Stones carried up in the moss.
    for (let i = 0; i < 3; i += 1) {
      const rock = generateRock({ seed: 9100 + i, kind: 'boulder', detail: 1 }).geometry.clone();
      const z = -L * 0.15 + i * L * 0.16;
      put(i === 0 ? BONE.chest : BONE.spine, paint(rock, solid(new THREE.Color(0.42, 0.41, 0.38), 0.12)), new THREE.Vector3((rng() - 0.5) * bodyR, backY(z) - 0.1, z), undefined, new THREE.Vector3(0.45, 0.35, 0.45));
    }
    // A beard of hanging moss under the neck and chest.
    for (let i = 0; i < 26; i += 1) {
      const len = 0.25 + rng() * 0.55;
      const strand = new THREE.ConeGeometry(0.025 + rng() * 0.03, len, 4);
      strand.rotateX(Math.PI);
      strand.translate(0, -len / 2, 0);
      const onNeck = i < 12;
      const world = onNeck
        ? new THREE.Vector3((rng() - 0.5) * bodyR * 0.8, hipY + bodyR * 0.25, -L * 0.48 - rng() * 0.5)
        : new THREE.Vector3((rng() - 0.5) * bodyR * 1.4, hipY - bodyR * 0.55, -L * 0.1 - rng() * L * 0.3);
      put(onNeck ? BONE.neck : BONE.chest, paint(strand, solid(new THREE.Color(0.17, 0.22, 0.1), 0.25)), world, new THREE.Euler((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3));
    }
    for (const [bone, list] of perBone) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.attachMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rig.bones[bone].add(mesh);
    }

    // Flowers that open when the Warden is calmed (hidden until then).
    const flowerColors = [new THREE.Color(0.95, 0.93, 0.86), new THREE.Color(0.95, 0.7, 0.78), new THREE.Color(0.98, 0.86, 0.45)];
    for (const bone of [BONE.spine, BONE.chest]) {
      const waves: THREE.BufferGeometry[][] = [[], [], []];
      for (let i = 0; i < 30; i += 1) {
        const z = bone === BONE.chest ? -L * 0.4 + rng() * L * 0.34 : -L * 0.05 + rng() * L * 0.42;
        const x = (rng() - 0.5) * bodyR * 1.7;
        const petal = new THREE.IcosahedronGeometry(0.07 + rng() * 0.05, 0);
        petal.scale(1, 0.45, 1);
        petal.translate(x - rest[bone].x, backY(z) + 0.05 - rest[bone].y, z - rest[bone].z);
        waves[i % 3].push(paint(petal, solid(flowerColors[(i >> 1) % 3], 0.05)));
      }
      // Three waves of blossom open one after another.
      waves.forEach((parts, k) => {
        const mesh = new THREE.Mesh(mergeGeometries(parts, false) as THREE.BufferGeometry, this.flowerMaterial);
        mesh.visible = false;
        mesh.userData.bloomAt = 0.12 + k * 0.3;
        rig.bones[bone].add(mesh);
        this.flowers.push(mesh);
      });
    }

    // Songstone knots: the weak points.
    const knot = (name: Knot['name'], bone: number, world: THREE.Vector3, radius: number, maxHp: number) => {
      const material = new THREE.MeshStandardMaterial({ color: 0x1b6f64, emissive: 0x2bd6c0, emissiveIntensity: 2.4, roughness: 0.2, metalness: 0 });
      const group = new THREE.Group();
      for (let i = 0; i < 4; i += 1) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(radius * 0.55, 0), material);
        shard.scale.set(0.8, 1.9, 0.8);
        shard.position.set((rng() - 0.5) * radius * 0.7, (rng() - 0.3) * radius * 0.5, (rng() - 0.5) * radius * 0.7);
        shard.rotation.set((rng() - 0.5) * 1.2, rng() * 3, (rng() - 0.5) * 1.2);
        group.add(shard);
      }
      group.position.copy(world).sub(rest[bone]);
      rig.bones[bone].add(group);
      this.knots.push({ name, bone, mesh: group, material, maxHp, hp: maxHp, broken: false, radius, world: new THREE.Vector3() });
    };
    const lt = look.legThickness;
    const frontLegZ = -L * 0.34;
    const bodyX = bodyR * 0.62;
    knot('left', BONE.legs + 1, new THREE.Vector3(-bodyX - lt * 0.9, hipY - legLen * 0.5 + 0.1, frontLegZ - lt * 0.4), 0.42, 120);
    knot('right', BONE.legs + 3, new THREE.Vector3(bodyX + lt * 0.9, hipY - legLen * 0.5 + 0.1, frontLegZ - lt * 0.4), 0.42, 120);
    knot('heart', BONE.chest, new THREE.Vector3(0, hipY - bodyR * 0.3, -L * 0.47), 0.62, Infinity);

    // Amber eyes that watch you.
    const hs = look.headSize;
    const headPos = rest[BONE.head];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024 * L * hs, 8, 6), this.eyeMaterial);
      eye.position.set(side * 0.088 * hs * L, 0.03 * L, -0.085 * hs * L);
      rig.bones[BONE.head].add(eye);
    }
    void headPos;
    return rig;
  }

  // ---------------------------------------------------------------------------
  // Public queries

  get active(): boolean {
    return this.mode !== 'dormant' && this.mode !== 'calmed' && this.mode !== 'return';
  }

  get calmed(): boolean {
    return this.mode === 'calmed';
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }

  status(): BossStatus | null {
    if (!this.active) return null;
    return { name: this.name, title: this.title, fraction: Math.max(0, this.hp / MAX_HP), phaseAt: 0.5 };
  }

  /** Body circles for the player's collision (the Warden is solid). */
  colliders(): { x: number; z: number; radius: number; height: number }[] {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const offsets = [1.9, -0.4, -2.4];
    this.bodyColliders.forEach((c, i) => {
      c.x = this.pos.x + fx * offsets[i];
      c.z = this.pos.z + fz * offsets[i];
      c.height = 4.5 * (1 - this.pose.lie * 0.55);
    });
    return this.bodyColliders;
  }

  /** The player's swing: knots first, then the body (thick moss and bark). */
  hit(origin: THREE.Vector3, dir: THREE.Vector3, reach: number, damage: number): { hit: boolean; weak: boolean; broke: boolean } {
    if (this.mode === 'calmed' || this.mode === 'return') return { hit: false, weak: false, broke: false };
    let best: Knot | null = null;
    let bestT = reach + 0.6;
    for (const k of this.knots) {
      if (k.broken) continue;
      if (k.name === 'heart' && !this.heartOpen) continue;
      const t = raySphere(origin, dir, k.world, k.radius + 0.25);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = k;
      }
    }
    let bodyT = Infinity;
    for (const s of this.bodySpheres()) {
      const t = raySphere(origin, dir, s.center, s.radius);
      if (t >= 0 && t < bodyT) bodyT = t;
    }
    if (best && bestT <= bodyT + 0.4) {
      const dealt = damage * 3;
      best.hp -= dealt;
      let broke = false;
      if (best.hp <= 0 && Number.isFinite(best.maxHp)) {
        best.broken = true;
        broke = true;
        best.material.emissiveIntensity = 0.05;
        best.material.color.setHex(0x2a2f2d);
        this.hooks.sound('crack', best.world.x, best.world.y, best.world.z, 1);
        this.hooks.shake(0.35);
        this.events.emit('notify', { text: 'The knot shatters. Mossback stumbles!', icon: 'songstone', tone: 'good' });
        this.enter('stagger');
      }
      this.applyDamage(dealt);
      this.pose.flinch = 1;
      this.events.emit('hit', { target: 'warden', material: 'songstone', x: best.world.x, y: best.world.y, z: best.world.z });
      return { hit: true, weak: true, broke };
    }
    if (bodyT <= reach + 0.3) {
      const dealt = damage * 0.25;
      this.applyDamage(dealt);
      this.pose.flinch = Math.max(this.pose.flinch, 0.35);
      const p = this.tmp.copy(origin).addScaledVector(dir, bodyT);
      this.events.emit('hit', { target: 'warden', material: 'wood', x: p.x, y: p.y, z: p.z });
      return { hit: true, weak: false, broke: false };
    }
    return { hit: false, weak: false, broke: false };
  }

  private get heartOpen(): boolean {
    return this.mode === 'winded' || this.mode === 'stagger';
  }

  private bodySpheres(): { center: THREE.Vector3; radius: number }[] {
    const b = this.rig.bones;
    const out: { center: THREE.Vector3; radius: number }[] = [];
    const add = (bone: number, radius: number) => out.push({ center: b[bone].getWorldPosition(new THREE.Vector3()), radius });
    add(BONE.spine, 1.7);
    add(BONE.chest, 1.8);
    add(BONE.neck, 1.1);
    add(BONE.head, 0.9);
    for (let k = 0; k < 4; k += 1) add(BONE.legs + k * 2 + 1, 0.45);
    return out;
  }

  private applyDamage(amount: number): void {
    if (!this.active) return;
    this.hp -= amount;
    if (!this.phase2 && this.hp < MAX_HP * 0.5) {
      this.phase2 = true;
      this.hooks.sound('roar', this.pos.x, this.pos.y + 4, this.pos.z, 1.2);
      this.hooks.shake(0.4);
      this.hooks.say('', 'Roots stir under the grove. Mossback’s moss darkens and bristles.', 5);
    }
    if (this.hp <= 0) this.calm();
  }

  // ---------------------------------------------------------------------------
  // Simulation

  private enter(mode: Mode): void {
    this.mode = mode;
    this.t = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.t += dt;
    const player = this.hooks.player();
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toArena = Math.hypot(player.x - this.arena.x, player.z - this.arena.z);
    const tg = this.target;
    tg.gait = 0;
    tg.rear = 0;
    tg.lower = 0;
    tg.sweep = 0;
    tg.kneel = 0;
    tg.lie = 0;
    tg.paw = 0;

    // Leave the grove or fall, and the Warden goes back to its bed.
    if (this.active && this.mode !== 'waking' && (!player.alive || toArena > LEASH_RADIUS)) this.enter('return');

    switch (this.mode) {
      case 'dormant': {
        tg.lie = 1;
        if (!this.holdDormant && player.alive && Math.hypot(player.x - this.bed.x, player.z - this.bed.z) < WAKE_RADIUS) {
          this.enter('waking');
          this.hooks.sound('roar', this.pos.x, this.pos.y + 3, this.pos.z, 1);
          this.hooks.shake(0.3);
          this.hooks.say('', 'The hillside breathes. Moss splits, and something vast rises out of the grove.', 6);
          this.events.emit('notify', { text: 'Mossback, Warden of Hollowpine', icon: 'songstone', tone: 'bad' });
          this.events.emit('wardenAwake', { id: this.id, name: this.name });
        }
        break;
      }
      case 'waking': {
        tg.lie = 1 - smoothstep(0.4, 2.6, this.t);
        tg.lower = this.t > 2.4 ? 0.3 : 0;
        this.turnToward(dx, dz, dt, 0.6);
        if (this.t > 3.4) {
          this.enter('stalk');
          this.cooldown = 1.2;
          this.hooks.sound('roar', this.pos.x, this.pos.y + 4, this.pos.z, 1);
        }
        break;
      }
      case 'stalk':
        this.updateStalk(dt, dx, dz, dist, player);
        break;
      case 'chargeWindup': {
        tg.lower = 0.85;
        tg.paw = 1;
        // Tracks you while it paws the ground, then commits.
        if (this.t < 1.0) this.turnToward(dx, dz, dt, 1.6);
        if (this.t > (this.phase2 ? 1.15 : 1.45)) {
          this.chargeDir.set(-Math.sin(this.yaw), -Math.cos(this.yaw));
          this.chargeDistance = 0;
          this.chargeHit = false;
          this.enter('charge');
          this.hooks.sound('charge', this.pos.x, this.pos.y + 2, this.pos.z, 1);
        }
        break;
      }
      case 'charge':
        this.updateCharge(dt, player);
        break;
      case 'winded': {
        tg.lower = 1;
        tg.kneel = 0.35;
        if (this.t > 2.8) this.enter('stalk');
        break;
      }
      case 'stagger': {
        tg.kneel = 1;
        tg.lower = 0.8;
        if (this.t > 3.8) {
          this.enter('stalk');
          this.cooldown = 0.6;
          this.hooks.sound('roar', this.pos.x, this.pos.y + 3, this.pos.z, 0.8);
        }
        break;
      }
      case 'stompWindup': {
        tg.rear = smoothstep(0, 0.9, this.t);
        this.turnToward(dx, dz, dt, 0.8);
        if (this.t > 1.0) {
          this.enter('stomp');
          this.stomp();
        }
        break;
      }
      case 'stomp': {
        tg.rear = 0;
        tg.lower = 0.3;
        if (this.phase2 && this.stompCount < 2 && this.t > 0.55) {
          this.enter('stompWindup');
          this.t = 0.45;
        } else if (this.t > 1.0) {
          this.enter('stalk');
          this.cooldown = 1.1;
        }
        break;
      }
      case 'sweepWindup': {
        tg.sweep = -0.85 * this.sweepSide;
        tg.lower = 0.35;
        if (this.t > 0.62) {
          this.enter('sweep');
          this.sweepHit = false;
        }
        break;
      }
      case 'sweep': {
        tg.sweep = 0.95 * this.sweepSide;
        tg.lower = 0.35;
        if (!this.sweepHit && this.t > 0.14) {
          this.sweepHit = true;
          const facing = this.facingDot(dx, dz, dist);
          if (dist < 7.8 && facing > 0.25 && player.alive) {
            this.hooks.damagePlayer(24, 'Mossback', this.pos.x, this.pos.z);
            const rx = Math.cos(this.yaw) * this.sweepSide;
            const rz = -Math.sin(this.yaw) * this.sweepSide;
            this.hooks.knockPlayer(-rx * 7, 3.5, -rz * 7);
            this.hooks.shake(0.5);
          }
        }
        if (this.t > 0.7) {
          this.enter('stalk');
          this.cooldown = 0.9;
        }
        break;
      }
      case 'roots': {
        tg.rear = 0.25 * smoothstep(0, 0.5, this.t);
        tg.lower = -0.3;
        if (this.t > 0.55 + this.rootsCast * 0.5 && this.rootsCast < 3) {
          this.rootsCast += 1;
          // The first strike leads a running target; later ones land where you stand.
          const lead = this.rootsCast === 1 ? 0.55 : 0.1;
          this.castRoots(player.x + this.playerVel.x * lead, player.z + this.playerVel.z * lead);
        }
        if (this.t > 2.2) {
          this.enter('stalk');
          this.cooldown = 1.4;
        }
        break;
      }
      case 'return': {
        this.hp = Math.min(MAX_HP, this.hp + dt * 120);
        const bx = this.bed.x - this.pos.x;
        const bz = this.bed.z - this.pos.z;
        const bd = Math.hypot(bx, bz);
        if (bd > 1.5) {
          this.turnToward(bx, bz, dt, 1.2);
          this.walk(dt, 2.6);
          tg.gait = 0.35;
        } else {
          this.yaw += angleDelta(this.yaw, this.bedYaw) * Math.min(1, dt * 1.5);
          tg.lie = smoothstep(0, 2, this.t);
          if (this.t > 2.5 && this.hp >= MAX_HP) this.reset();
        }
        break;
      }
      case 'calmed': {
        tg.kneel = 1 - smoothstep(1.5, 4, this.t);
        tg.lie = smoothstep(1.5, 4.5, this.t);
        tg.lower = 0.4;
        this.pose.bloom = Math.min(1, this.pose.bloom + dt * 0.18);
        break;
      }
    }
    if (dt > 0) this.playerVel.set((player.x - this.lastPlayer.x) / dt, 0, (player.z - this.lastPlayer.z) / dt).clampLength(0, 12);
    this.lastPlayer.set(player.x, player.y, player.z);
    this.cooldown -= dt;
    this.updateEffects(dt, player);
    this.place();
    this.applyPose(dt);
  }

  private readonly lastPlayer = new THREE.Vector3();
  private readonly playerVel = new THREE.Vector3();

  private updateStalk(dt: number, dx: number, dz: number, dist: number, player: { x: number; z: number; alive: boolean }): void {
    const tg = this.target;
    this.turnToward(dx, dz, dt, 1.1);
    const facing = this.facingDot(dx, dz, dist);
    if (dist > 8 && facing > 0.6) {
      this.walk(dt, this.phase2 ? 3.4 : 2.8);
      tg.gait = 0.45;
    } else this.speed = damp(this.speed, 0, 4, dt);
    if (this.cooldown > 0 || !player.alive) return;
    // Pick an attack that suits the range; vary so it can't be farmed.
    this.attackCount += 1;
    const roll = this.rng();
    if (dist < 7.5 && facing > 0.35) {
      if (roll < 0.6) {
        this.sweepSide = this.rng() < 0.5 ? -1 : 1;
        this.enter('sweepWindup');
        this.hooks.sound('roar', this.pos.x, this.pos.y + 4, this.pos.z, 0.5);
      } else this.beginStomp();
    } else if (dist < 11) {
      if (roll < 0.55) this.beginStomp();
      else if (this.phase2 && roll < 0.8) this.beginRoots();
      else this.beginCharge();
    } else if (dist < 42) {
      if (this.phase2 && roll < 0.35) this.beginRoots();
      else if (facing > 0.2 || roll < 0.5) this.beginCharge();
    }
  }

  private beginCharge(): void {
    this.enter('chargeWindup');
    this.hooks.sound('roar', this.pos.x, this.pos.y + 4, this.pos.z, 0.9);
  }

  private beginStomp(): void {
    this.stompCount = 0;
    this.enter('stompWindup');
  }

  private beginRoots(): void {
    this.rootsCast = 0;
    this.enter('roots');
    this.hooks.sound('roar', this.pos.x, this.pos.y + 4, this.pos.z, 0.7);
  }

  private updateCharge(dt: number, player: { x: number; y: number; z: number; alive: boolean }): void {
    const tg = this.target;
    tg.lower = 1;
    tg.gait = 1;
    const speed = this.phase2 ? 15.5 : 13.5;
    const step = speed * Math.min(1, this.t * 3) * dt;
    const nx = this.pos.x + this.chargeDir.x * step;
    const nz = this.pos.z + this.chargeDir.y * step;
    // Crash into big trees, the Bellstone, or a slope too steep to run.
    const headX = nx + this.chargeDir.x * 3.6;
    const headZ = nz + this.chargeDir.y * 3.6;
    let crashed = Math.hypot(headX - this.arena.x, headZ - this.arena.z) < 3.2;
    if (!crashed) {
      for (const o of this.hooks.obstacles(headX, headZ, 2.2)) {
        if (o.radius > 0.28 && Math.hypot(o.x - headX, o.z - headZ) < o.radius + 1.3) {
          crashed = true;
          break;
        }
      }
    }
    const rise = this.world.heightAt(headX, headZ) - this.world.heightAt(this.pos.x, this.pos.z);
    if (rise > 2.4) crashed = true;
    if (crashed) {
      this.hooks.sound('crash', headX, this.pos.y + 2, headZ, 1);
      this.hooks.shake(0.55);
      this.events.emit('notify', { text: 'Mossback crashes and reels!', icon: 'songstone', tone: 'good' });
      this.enter('stagger');
      return;
    }
    this.pos.x = nx;
    this.pos.z = nz;
    this.speed = speed;
    this.chargeDistance += step;
    // Trampling: anything along the front half of the body.
    if (!this.chargeHit && player.alive) {
      const px = player.x - this.pos.x;
      const pz = player.z - this.pos.z;
      const along = px * this.chargeDir.x + pz * this.chargeDir.y;
      const side = Math.abs(px * this.chargeDir.y - pz * this.chargeDir.x);
      if (along > -1 && along < 4.6 && side < 2.1 && player.y < this.pos.y + 3.5) {
        this.chargeHit = true;
        this.hooks.damagePlayer(32, 'Mossback', this.pos.x, this.pos.z);
        const s = Math.sign(px * this.chargeDir.y - pz * this.chargeDir.x) || 1;
        this.hooks.knockPlayer(this.chargeDir.x * 9 + this.chargeDir.y * s * 5, 6, this.chargeDir.y * 9 - this.chargeDir.x * s * 5);
        this.hooks.shake(0.8);
      }
    }
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.stepTimer = 0.28;
      this.hooks.sound('step', this.pos.x, this.pos.y, this.pos.z, 1);
      const pd = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
      this.hooks.shake(Math.max(0, 0.22 - pd * 0.008));
    }
    const maxRun = 36;
    if (this.chargeDistance > maxRun || Math.hypot(this.pos.x - this.arena.x, this.pos.z - this.arena.z) > LEASH_RADIUS - 20) {
      this.enter('winded');
      this.speed = 0;
    }
  }

  private stomp(): void {
    this.stompCount += 1;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const x = this.pos.x + fx * 2.4;
    const z = this.pos.z + fz * 2.4;
    const y = this.world.heightAt(x, z);
    this.hooks.sound('stomp', x, y, z, 1);
    const p = this.hooks.player();
    const d = Math.hypot(p.x - x, p.z - z);
    this.hooks.shake(Math.max(0.15, 0.7 - d * 0.03));
    this.spawnWave(x, y, z);
  }

  private walk(dt: number, speed: number): void {
    this.speed = damp(this.speed, speed, 3, dt);
    this.pos.x += -Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += -Math.cos(this.yaw) * this.speed * dt;
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.stepTimer = 0.62;
      this.hooks.sound('step', this.pos.x, this.pos.y, this.pos.z, 0.6);
    }
  }

  private turnToward(dx: number, dz: number, dt: number, rate: number): void {
    const want = Math.atan2(-dx, -dz);
    const delta = angleDelta(this.yaw, want);
    this.yaw += clamp(delta, -rate * dt, rate * dt);
  }

  private facingDot(dx: number, dz: number, dist: number): number {
    if (dist < 1e-3) return 1;
    return (-Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz) / dist;
  }

  private calm(): void {
    if (this.mode === 'calmed') return;
    this.hp = 0;
    this.enter('calmed');
    for (const w of this.waves) w.max = 0;
    for (const k of this.knots) {
      k.material.emissiveIntensity = 0.12;
    }
    this.eyeMaterial.emissive.setHex(0x9fe8b0);
    this.eyeMaterial.emissiveIntensity = 0.6;
    this.hooks.sound('calm', this.pos.x, this.pos.y + 2, this.pos.z, 1);
    this.hooks.shake(0.3);
    this.events.emit('notify', { text: 'Mossback kneels. The grove falls quiet.', icon: 'songstone', tone: 'good' });
    this.events.emit('wardenCalmed', { id: this.id, flag: this.flag, name: this.name });
  }

  /** Back to sleep at full strength (the player fled or fell). */
  private reset(): void {
    this.hp = MAX_HP;
    this.phase2 = false;
    for (const k of this.knots) {
      k.broken = false;
      k.hp = k.maxHp;
      k.material.emissiveIntensity = 2.4;
      k.material.color.setHex(0x1b6f64);
    }
    this.pose.bloom = 0;
    this.eyeMaterial.emissive.setHex(0xffa53a);
    this.eyeMaterial.emissiveIntensity = 3;
    this.attachMaterial.color.setRGB(1, 1, 1);
    this.pos.copy(this.bed);
    this.yaw = this.bedYaw;
    this.enter('dormant');
  }

  // ---------------------------------------------------------------------------
  // Effects

  private spawnWave(x: number, y: number, z: number): void {
    const material = additive(WAVE_FRAG, { uFade: { value: 1 }, uColor: { value: new THREE.Color(0.55, 0.5, 0.38) } });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 72, 1), material);
    ring.rotation.x = -Math.PI / 2;
    ring.layers.set(LAYER_TRANSPARENT);
    ring.frustumCulled = false;
    const dustMaterial = additive(DUST_FRAG, { uFade: { value: 1 }, uColor: { value: new THREE.Color(0.42, 0.38, 0.3) } });
    const dust = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.6, 72, 1, true), dustMaterial);
    dust.geometry.translate(0, 0.8, 0);
    dust.layers.set(LAYER_TRANSPARENT);
    dust.frustumCulled = false;
    this.group.add(ring, dust);
    this.waves.push({ x, y, z, r: 1, max: 17, hit: false, ring, dust, material, dustMaterial });
  }

  private castRoots(x: number, z: number): void {
    const y = this.world.heightAt(x, z);
    const decalMaterial = additive(DECAL_FRAG, { uProgress: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.35, 0.95, 0.55) } });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), decalMaterial);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, y + 0.12, z);
    decal.layers.set(LAYER_TRANSPARENT);
    decal.frustumCulled = false;
    const spikes = new THREE.Group();
    const barkColor = new THREE.Color(0.3, 0.23, 0.16);
    for (let i = 0; i < 7; i += 1) {
      const h = 1.8 + this.rng() * 1.2;
      const cone = new THREE.ConeGeometry(0.16 + this.rng() * 0.1, h, 6);
      cone.translate(0, h / 2, 0);
      const spike = new THREE.Mesh(paint(cone, () => barkColor), this.attachMaterial);
      const a = (i / 7) * Math.PI * 2 + this.rng();
      const r = i === 0 ? 0 : 0.7 + this.rng() * 0.9;
      spike.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      spike.rotation.set((this.rng() - 0.5) * 0.5, 0, (this.rng() - 0.5) * 0.5);
      spike.castShadow = true;
      spikes.add(spike);
    }
    spikes.position.set(x, y - 3.2, z);
    spikes.visible = false;
    this.group.add(decal, spikes);
    this.strikes.push({ x, y, z, t: 0, fuse: 1.15, hit: false, decal, decalMaterial, spikes });
    this.hooks.sound('rootsWarn', x, y, z, 1);
  }

  private updateEffects(dt: number, player: { x: number; y: number; z: number; grounded: boolean; alive: boolean }): void {
    for (let i = this.waves.length - 1; i >= 0; i -= 1) {
      const w = this.waves[i];
      w.r += dt * 13;
      const fade = 1 - smoothstep(w.max * 0.6, w.max, w.r);
      w.material.uniforms.uFade.value = fade;
      w.dustMaterial.uniforms.uFade.value = fade * 0.8;
      w.ring.position.set(w.x, w.y + 0.25, w.z);
      w.ring.scale.setScalar(w.r);
      w.dust.position.set(w.x, w.y - 0.2, w.z);
      w.dust.scale.set(w.r, 1 + fade * 0.4, w.r);
      if (!w.hit && player.alive) {
        const d = Math.hypot(player.x - w.x, player.z - w.z);
        const ground = this.world.heightAt(player.x, player.z);
        if (Math.abs(d - w.r) < 0.9 && player.y < ground + 0.45 && w.r < w.max * 0.92) {
          w.hit = true;
          this.hooks.damagePlayer(18, 'Mossback', w.x, w.z);
          const k = 6 / Math.max(1, d);
          this.hooks.knockPlayer((player.x - w.x) * k, 4, (player.z - w.z) * k);
        }
      }
      if (w.r >= w.max) {
        this.group.remove(w.ring, w.dust);
        w.ring.geometry.dispose();
        w.dust.geometry.dispose();
        w.material.dispose();
        w.dustMaterial.dispose();
        this.waves.splice(i, 1);
      }
    }
    for (let i = this.strikes.length - 1; i >= 0; i -= 1) {
      const s = this.strikes[i];
      s.t += dt;
      s.decalMaterial.uniforms.uProgress.value = Math.min(1, s.t / s.fuse);
      s.decalMaterial.uniforms.uTime.value = this.time;
      if (s.t >= s.fuse) {
        if (!s.spikes.visible) {
          s.spikes.visible = true;
          this.hooks.sound('roots', s.x, s.y, s.z, 1);
          const d = Math.hypot(player.x - s.x, player.z - s.z);
          this.hooks.shake(Math.max(0, 0.45 - d * 0.03));
        }
        const e = s.t - s.fuse;
        // Burst up fast, hold, sink slowly.
        const up = smoothstep(0, 0.12, e) * (1 - smoothstep(1.0, 1.6, e));
        s.spikes.position.y = s.y - 3.2 + up * 3.1;
        s.decal.visible = e < 0.3;
        if (!s.hit && e < 0.25 && player.alive && Math.hypot(player.x - s.x, player.z - s.z) < 2.15) {
          s.hit = true;
          this.hooks.damagePlayer(16, 'Mossback', s.x, s.z);
          this.hooks.knockPlayer(0, 6.5, 0);
        }
        if (e > 1.7) {
          this.group.remove(s.decal, s.spikes);
          s.decal.geometry.dispose();
          s.decalMaterial.dispose();
          s.spikes.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
          this.strikes.splice(i, 1);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pose

  private place(): void {
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    // Pitch the body to the slope under it.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const front = this.world.heightAt(this.pos.x + fx * 2.6, this.pos.z + fz * 2.6);
    const back = this.world.heightAt(this.pos.x - fx * 2.6, this.pos.z - fz * 2.6);
    const pitch = Math.atan2(front - back, 5.2);
    const mesh = this.rig.mesh;
    mesh.position.copy(this.pos);
    mesh.position.y = Math.min(front, back, this.pos.y) + 0.05;
    mesh.rotation.set(pitch * (1 - this.pose.lie), this.yaw, 0, 'YXZ');
  }

  private applyPose(dt: number): void {
    const p = this.pose;
    const tg = this.target;
    const k = dt > 0 ? 1 - Math.exp(-dt * 6) : 1;
    const slow = dt > 0 ? 1 - Math.exp(-dt * 2.2) : 1;
    p.gait += (tg.gait - p.gait) * k;
    p.rear += (tg.rear - p.rear) * (tg.rear < p.rear ? Math.min(1, k * 3.5) : k);
    p.lower += (tg.lower - p.lower) * k;
    p.sweep += (tg.sweep - p.sweep) * (this.mode === 'sweep' ? Math.min(1, k * 3) : k);
    p.kneel += (tg.kneel - p.kneel) * k;
    p.lie += (tg.lie - p.lie) * slow;
    p.paw += (tg.paw - p.paw) * k;
    p.flinch = Math.max(0, p.flinch - dt * 3);
    p.phase += dt * (1.5 + this.speed * 0.55);

    const b = this.rig.bones;
    const rig = this.rig;
    const H = rig.look.height;
    const breathe = Math.sin(this.time * (this.mode === 'dormant' ? 0.9 : 1.8)) * 0.012 * H;
    const bob = Math.abs(Math.sin(p.phase)) * 0.035 * H * p.gait;
    b[BONE.root].position.y = rig.rootHeight + breathe - bob - p.lie * rig.rootHeight * 0.6 - p.kneel * rig.rootHeight * 0.26;
    b[BONE.root].rotation.set(p.rear * 0.62 - p.kneel * 0.16 - p.lower * 0.05, 0, Math.sin(this.time * 31) * 0.02 * p.flinch);
    b[BONE.spine].rotation.x = Math.sin(p.phase * 2) * 0.03 * p.gait;
    b[BONE.chest].rotation.set(-Math.sin(p.phase * 2) * 0.04 * p.gait - p.rear * 0.12, 0, 0);
    // Neck and head: lowered for a charge, swung for a sweep, raised to roar.
    const look = this.mode === 'dormant' ? Math.sin(this.time * 0.2) * 0.1 : 0;
    b[BONE.neck].rotation.set(p.lower * 0.72 + p.lie * 0.45 - p.rear * 0.35 + Math.sin(this.time * 1.1) * 0.03, p.sweep * 0.95 + look, p.sweep * 0.2);
    b[BONE.head].rotation.set(-p.lower * 0.35 + p.lie * 0.25, 0, p.sweep * 0.25);
    b[BONE.tail].rotation.set(Math.sin(this.time * 2.1) * 0.1 + p.gait * 0.3, Math.sin(this.time * 1.7) * 0.15, 0);
    // Legs: gait, pawing, kneeling and lying folds.
    const gaitAmp = 0.3 + 0.35 * p.gait;
    const offsets = [0, Math.PI, Math.PI * (1 - 0.3 * p.gait), Math.PI * 0.3 * p.gait];
    for (let leg = 0; leg < 4; leg += 1) {
      const front = leg < 2;
      const ph = p.phase + offsets[leg];
      const swing = Math.sin(ph) * gaitAmp * Math.min(1, p.gait * 3);
      const lift = Math.max(0, Math.cos(ph)) * gaitAmp * 1.1 * Math.min(1, p.gait * 3);
      const upper = b[BONE.legs + leg * 2];
      const lower = b[BONE.legs + leg * 2 + 1];
      let u = swing;
      let l = (front ? -1 : 1) * lift * 0.9;
      if (front) {
        // Rearing: forelegs fold and paw the air.
        u += p.rear * (0.75 + 0.25 * Math.sin(this.time * 7 + leg)) - p.kneel * 0.55 - p.lie * 0.6;
        l += p.rear * -1.2 + p.kneel * 1.7 + p.lie * 1.9;
        if (leg === 1) u += p.paw * Math.max(0, Math.sin(this.time * 8)) * 0.55;
      } else {
        u += -p.rear * 0.45 + p.lie * 0.95 + p.kneel * 0.2;
        l += -p.lie * 1.9 - p.kneel * 0.3;
      }
      upper.rotation.set(u, 0, 0);
      lower.rotation.set(l, 0, 0);
    }
    this.rig.mesh.updateMatrixWorld(true);
    // Knot glow breathes; flowers open as the Warden calms.
    for (const kn of this.knots) {
      if (!kn.broken && this.mode !== 'calmed') {
        const open = kn.name === 'heart' ? (this.heartOpen ? 1 : 0.25) : 1;
        kn.material.emissiveIntensity = (1.6 + 0.9 * Math.sin(this.time * 3 + kn.bone)) * open;
      }
      kn.mesh.getWorldPosition(kn.world);
    }
    for (const f of this.flowers) f.visible = p.bloom > (f.userData.bloomAt as number);
    if (this.mode === 'calmed') {
      this.attachMaterial.color.setRGB(1 + p.bloom * 0.25, 1 + p.bloom * 0.35, 1 + p.bloom * 0.15);
    }
  }

  // ---------------------------------------------------------------------------
  // Save

  serialize(): { calmed: boolean } {
    return { calmed: this.mode === 'calmed' };
  }

  load(data: { calmed?: boolean } | null): void {
    this.reset();
    for (const w of this.waves) this.group.remove(w.ring, w.dust);
    this.waves.length = 0;
    for (const s of this.strikes) this.group.remove(s.decal, s.spikes);
    this.strikes.length = 0;
    if (data?.calmed) {
      this.calmSilently();
    }
  }

  /** Restore the calmed state without the fanfare (loading a save). */
  private calmSilently(): void {
    this.enter('calmed');
    this.t = 10;
    this.hp = 0;
    this.pose.bloom = 1;
    this.pose.lie = 1;
    this.pose.kneel = 0;
    for (const k of this.knots) k.material.emissiveIntensity = 0.12;
    this.eyeMaterial.emissive.setHex(0x9fe8b0);
    this.eyeMaterial.emissiveIntensity = 0.6;
    this.place();
    this.applyPose(0);
  }

  /** Debug/test: jump the fight to a state. */
  debug(action: 'wake' | 'calm' | 'reset' | 'stagger' | 'hurt' | 'hold' | 'release', amount = 0): string {
    if (action === 'hold') this.holdDormant = true;
    else if (action === 'release') this.holdDormant = false;
    else if (action === 'wake' && this.mode === 'dormant') {
      this.enter('stalk');
      this.pose.lie = 0;
      this.cooldown = 1;
    } else if (action === 'calm') this.calm();
    else if (action === 'reset') this.reset();
    else if (action === 'stagger') this.enter('stagger');
    else if (action === 'hurt') this.applyDamage(amount);
    return this.mode;
  }

  get arenaCenter(): THREE.Vector3 {
    return this.arena;
  }

  get debugState(): { mode: string; hp: number; phase2: boolean; knots: string[]; x: number; y: number; z: number; yaw: number } {
    return {
      mode: this.mode,
      hp: Math.round(this.hp),
      phase2: this.phase2,
      knots: this.knots.map((k) => `${k.name}:${k.broken ? 'broken' : Math.round(k.hp)}`),
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      yaw: this.yaw,
    };
  }

  /** World positions of the knots (for tests and aim assists). */
  knotPositions(): { name: string; x: number; y: number; z: number; open: boolean }[] {
    return this.knots.map((k) => ({ name: k.name, x: k.world.x, y: k.world.y, z: k.world.z, open: !k.broken && (k.name !== 'heart' || this.heartOpen) }));
  }
}

/** Ray/sphere: distance along the ray to the hit, or -1. */
function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const along = ox * dir.x + oy * dir.y + oz * dir.z;
  if (along < 0) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - along * along;
  if (d2 > radius * radius) return -1;
  return Math.max(0, along - Math.sqrt(radius * radius - d2));
}
