import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from '../core/math';
import { createRng, hashString } from '../core/rng';
import { addPatch, replaceOnce } from '../render/materials/MaterialPatches';
import { BIOME, BIOME_COUNT } from '../world/WorldConfig';
import type { WorldData } from '../world/WorldData';

// Birds: rooks over the meadows and pines, gulls along the coast, herons
// wading in the fen, snowfinches in the high cold. Flocks wheel and glide,
// come down to forage and flush when something comes too close. A bird
// brought down by an arrow gives feathers (the island's steady supply of
// fletching) and a little meat. Every species is one instanced draw; the
// wings beat in the vertex shader from a per-bird flap attribute.

export interface BirdSpecies {
  id: string;
  name: string;
  biomes: Partial<Record<number, number>>;
  flock: [number, number];
  /** Wingspan and body length (m). */
  span: number;
  body: number;
  /** Cruise speed (m/s) and wingbeats per second. */
  speed: number;
  flapRate: number;
  /** 0..1: how much of the time it glides rather than flaps. */
  glide: number;
  /** Cruise height above the ground (m). */
  altitude: [number, number];
  /** Flush distance when walking (m). */
  startle: number;
  colors: { body: number; belly: number; wing: number; tip: number; beak: number };
  loot: [item: string, min: number, max: number][];
  /** Stands in shallow water. */
  wade?: boolean;
  /** Long neck and trailing legs (herons). */
  heron?: boolean;
  call: 'caw' | 'cry' | 'croak' | 'chirp';
}

export const BIRD_SPECIES: readonly BirdSpecies[] = [
  {
    id: 'rook',
    name: 'Rook',
    biomes: { [BIOME.Greensward]: 1, [BIOME.Hollowpine]: 0.7, [BIOME.Rim]: 0.6, [BIOME.Glasswood]: 0.3 },
    flock: [4, 8],
    span: 0.9,
    body: 0.44,
    speed: 9,
    flapRate: 3.6,
    glide: 0.3,
    altitude: [16, 42],
    startle: 14,
    colors: { body: 0x16161c, belly: 0x1d1d25, wing: 0x14141b, tip: 0x0d0d12, beak: 0x6a6660 },
    loot: [
      ['feather', 2, 4],
      ['raw_meat', 0, 1],
    ],
    call: 'caw',
  },
  {
    id: 'gull',
    name: 'Gull',
    biomes: { [BIOME.Coast]: 1, [BIOME.Drownfen]: 0.15 },
    flock: [3, 7],
    span: 1.3,
    body: 0.56,
    speed: 10,
    flapRate: 2.4,
    glide: 0.75,
    altitude: [10, 34],
    startle: 16,
    colors: { body: 0xf2f2ee, belly: 0xffffff, wing: 0xaab2ba, tip: 0x1c1c20, beak: 0xe0b33a },
    loot: [
      ['feather', 3, 5],
      ['raw_meat', 1, 1],
    ],
    call: 'cry',
  },
  {
    id: 'heron',
    name: 'Grey Heron',
    biomes: { [BIOME.Drownfen]: 1, [BIOME.Greensward]: 0.08 },
    flock: [1, 3],
    span: 1.75,
    body: 0.9,
    speed: 7,
    flapRate: 1.6,
    glide: 0.35,
    altitude: [9, 24],
    startle: 22,
    colors: { body: 0x9aa3ad, belly: 0xdfe3e6, wing: 0x7c8894, tip: 0x2b2f36, beak: 0xd8a640 },
    loot: [
      ['feather', 4, 6],
      ['raw_meat', 1, 2],
    ],
    wade: true,
    heron: true,
    call: 'croak',
  },
  {
    id: 'snowfinch',
    name: 'Snowfinch',
    biomes: { [BIOME.Frostveil]: 1, [BIOME.Rim]: 0.25 },
    flock: [6, 11],
    span: 0.36,
    body: 0.18,
    speed: 8,
    flapRate: 9,
    glide: 0.15,
    altitude: [6, 20],
    startle: 9,
    colors: { body: 0xe6e2da, belly: 0xffffff, wing: 0xf4f4f4, tip: 0x202024, beak: 0x2c2a28 },
    loot: [['feather', 1, 2]],
    call: 'chirp',
  },
];

const GRAVITY = 9.8;

type BirdState = 'fly' | 'ground' | 'fall' | 'dead';

interface Bird {
  id: number;
  species: BirdSpecies;
  flock: Flock | null;
  state: BirdState;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  bank: number;
  /** Size variation. */
  size: number;
  phase: number;
  rate: number;
  /** Current wing pose (inner, outer, fold) eased toward targets. */
  inner: number;
  outer: number;
  fold: number;
  /** Seconds left of hard flapping (take-off). */
  burst: number;
  glideTimer: number;
  gliding: boolean;
  /** Formation offset from the flock's target. */
  slot: THREE.Vector3;
  /** Ground spot while landing, hop target while on the ground. */
  spot: THREE.Vector3;
  hop: number;
  hopFrom: THREE.Vector3;
  peck: number;
  timer: number;
  spin: THREE.Vector3;
  arrows: string[];
  deadTime: number;
}

type FlockMode = 'cruise' | 'land' | 'ground';

interface Flock {
  id: number;
  species: BirdSpecies;
  members: Bird[];
  mode: FlockMode;
  home: THREE.Vector3;
  center: THREE.Vector3;
  target: THREE.Vector3;
  angle: number;
  radius: number;
  altitude: number;
  timer: number;
  callTimer: number;
  /** Spin direction of the circling. */
  turn: number;
}

export interface BirdHooks {
  player(): { x: number; y: number; z: number; crouching: boolean; sprinting: boolean };
  isNight(): boolean;
  sound(kind: 'call' | 'flush', call: BirdSpecies['call'], x: number, y: number, z: number): void;
}

const FLAP_PARS = /* glsl */ `
attribute vec3 aFlap;
attribute float aWing;
uniform float uShoulder;
uniform float uElbow;
uniform float uWingY;
vec2 birdRot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
`;

// Normals turn with the wing: the whole wing about the shoulder, the outer
// part further about the elbow.
const FLAP_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
if (aWing > 0.5) {
  float bSideN = position.x >= 0.0 ? 1.0 : -1.0;
  float bAngleN = aFlap.x + (abs(position.x) > uElbow ? aFlap.y : 0.0);
  vec3 nA = vec3(objectNormal.x * bSideN, objectNormal.y, objectNormal.z);
  nA.xy = birdRot(nA.xy, bAngleN * (1.0 - aFlap.z));
  objectNormal = vec3(nA.x * bSideN, nA.y, nA.z);
}
`;

const FLAP_VERTEX = /* glsl */ `
#include <begin_vertex>
if (aWing > 0.5) {
  float bSide = position.x >= 0.0 ? 1.0 : -1.0;
  vec3 p = vec3(abs(position.x), position.y - uWingY, position.z);
  // Folded wings lie back along the body.
  float f = aFlap.z;
  float d = max(0.0, p.x - uShoulder);
  p.x = uShoulder + d * (1.0 - 0.84 * f);
  p.z -= d * 0.78 * f;
  p.y += d * 0.1 * f;
  float elbow = uShoulder + (uElbow - uShoulder) * (1.0 - 0.84 * f);
  if (p.x > elbow) p.xy = birdRot(p.xy - vec2(elbow, 0.0), aFlap.y * (1.0 - f)) + vec2(elbow, 0.0);
  p.xy = birdRot(p.xy - vec2(uShoulder, 0.0), aFlap.x * (1.0 - f)) + vec2(uShoulder, 0.0);
  transformed = vec3(p.x * bSide, p.y + uWingY, p.z);
}
`;

interface BirdShape {
  geometry: THREE.BufferGeometry;
  shoulder: number;
  elbow: number;
  wingY: number;
}

/** A bird facing +Z, wings along ±X, `aWing` marking the wing vertices. */
function buildBird(s: BirdSpecies): BirdShape {
  const L = s.body;
  const half = s.span / 2;
  const bw = L * (s.heron ? 0.16 : 0.2);
  const bh = L * (s.heron ? 0.2 : 0.24);
  const col = (hex: number) => new THREE.Color(hex);
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, color: THREE.Color | ((y: number, x: number) => THREE.Color), wing = 0): void => {
    const geo = g.index ? g.toNonIndexed() : g;
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const wingAttr = new Float32Array(pos.count).fill(wing);
    for (let i = 0; i < pos.count; i += 1) {
      const c = typeof color === 'function' ? color(pos.getY(i), pos.getX(i)) : color;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aWing', new THREE.BufferAttribute(wingAttr, 1));
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'aWing'].includes(name)) geo.deleteAttribute(name);
    parts.push(geo);
  };
  const body = col(s.colors.body);
  const belly = col(s.colors.belly);
  // Body: a teardrop, fuller at the chest.
  const torso = new THREE.SphereGeometry(1, 12, 9);
  const tp = torso.getAttribute('position');
  for (let i = 0; i < tp.count; i += 1) {
    const z = tp.getZ(i);
    const taper = z < 0 ? 1 + z * 0.35 : 1;
    tp.setXYZ(i, tp.getX(i) * bw * taper, tp.getY(i) * bh * taper, z * L * 0.5);
  }
  torso.computeVertexNormals();
  paint(torso, (y) => (y < -bh * 0.2 ? belly : body));
  // Head and beak.
  const headR = L * (s.heron ? 0.1 : 0.17);
  const neckLift = s.heron ? bh * 1.1 : bh * 0.35;
  const headZ = L * (s.heron ? 0.42 : 0.52);
  const head = new THREE.SphereGeometry(headR, 10, 8);
  head.translate(0, neckLift, headZ);
  paint(head, s.id === 'gull' || s.id === 'snowfinch' ? belly : body);
  if (s.heron) {
    // The neck drawn back into an S in flight.
    const neck = new THREE.CylinderGeometry(L * 0.05, L * 0.07, neckLift * 1.1, 7);
    neck.rotateX(-0.5);
    neck.translate(0, neckLift * 0.45, headZ - L * 0.1);
    paint(neck, belly);
    // Legs trailing behind.
    for (const side of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.008, 0.01, L * 0.75, 5);
      leg.rotateX(Math.PI / 2);
      leg.translate(side * bw * 0.35, -bh * 0.4, -L * 0.75);
      paint(leg, col(0x4a4038));
    }
  }
  const beakLen = L * (s.heron ? 0.36 : s.id === 'snowfinch' ? 0.12 : 0.2);
  const beak = new THREE.ConeGeometry(headR * 0.42, beakLen, 6);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, neckLift - headR * 0.1, headZ + headR * 0.8 + beakLen / 2);
  paint(beak, col(s.colors.beak));
  // Tail fan.
  const tail = new THREE.BufferGeometry();
  const tl = L * (s.heron ? 0.22 : 0.36);
  const tw = L * (s.id === 'rook' ? 0.2 : 0.16);
  tail.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, -L * 0.36, -tw, 0, -L * 0.36 - tl, tw, 0, -L * 0.36 - tl, 0, 0, -L * 0.36, tw, 0, -L * 0.36 - tl, -tw, 0, -L * 0.36 - tl], 3),
  );
  tail.computeVertexNormals();
  tail.translate(0, bh * 0.15, 0);
  paint(tail, col(s.id === 'gull' ? s.colors.belly : s.colors.wing));
  // Wings: a tapered, swept surface in two segments.
  const wingY = bh * 0.45;
  const shoulder = bw * 0.7;
  const elbow = shoulder + (half - shoulder) * 0.45;
  const nx = 8;
  const nz = 2;
  const chord0 = L * (s.heron ? 0.52 : 0.5);
  const verts: number[] = [];
  const wingCols: THREE.Color[] = [];
  const wing = col(s.colors.wing);
  const tip = col(s.colors.tip);
  for (const side of [1, -1]) {
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < nz; j += 1) {
        const quad = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        for (const [a, b] of side > 0 ? quad : [0, 2, 1, 3, 5, 4].map((k) => quad[k])) {
          const u = a / nx;
          const v = b / nz;
          const x = shoulder + (half - shoulder) * u;
          // Chord narrows toward the tip, the leading edge sweeps back.
          const chord = chord0 * (1 - 0.62 * u * u) * (s.id === 'gull' ? 0.85 : 1);
          const lead = L * 0.14 - u * u * L * 0.2;
          const z = lead - chord * v;
          verts.push(x * side, (u * u - u) * 0.02, z);
          wingCols.push(u > 0.72 ? tip.clone().lerp(wing, clamp((0.86 - u) / 0.14, 0, 1)) : wing.clone().multiplyScalar(1 - v * 0.18));
        }
      }
    }
  }
  const wings = new THREE.BufferGeometry();
  wings.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  wings.translate(0, wingY, 0);
  wings.computeVertexNormals();
  paint(wings, (_y, _x) => new THREE.Color(1, 1, 1), 1);
  // Replace the placeholder colours with the per-vertex wing colours.
  const wc = parts[parts.length - 1].getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < wingCols.length; i += 1) wc.setXYZ(i, wingCols[i].r, wingCols[i].g, wingCols[i].b);
  const geometry = mergeGeometries(parts);
  geometry.computeBoundingSphere();
  return { geometry, shoulder, elbow, wingY };
}

const CAPACITY = 48;

export class Birds {
  readonly group = new THREE.Group();
  readonly materials: THREE.Material[] = [];
  readonly flocks: Flock[] = [];
  readonly carcasses: Bird[] = [];
  /** Birds alive at once (set from the quality preset). */
  cap = 40;
  private readonly meshes = new Map<string, { mesh: THREE.InstancedMesh; flap: THREE.InstancedBufferAttribute }>();
  private readonly rng = createRng(0xb1d5);
  private nextId = 1;
  private spawnTimer = 0.5;
  private readonly weights = new Float32Array(BIOME_COUNT);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  constructor(
    private readonly world: WorldData,
    private readonly hooks: BirdHooks,
  ) {
    this.group.name = 'birds';
    for (const sp of BIRD_SPECIES) {
      const shape = buildBird(sp);
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
      const uniforms = { uShoulder: { value: shape.shoulder }, uElbow: { value: shape.elbow }, uWingY: { value: shape.wingY } };
      addPatch(material, {
        key: 'bird-flap',
        apply(shader) {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = replaceOnce(shader.vertexShader, '#include <common>', `#include <common>\n${FLAP_PARS}`, 'bird-flap-pars');
          shader.vertexShader = replaceOnce(shader.vertexShader, '#include <beginnormal_vertex>', FLAP_NORMAL, 'bird-flap-normal');
          shader.vertexShader = replaceOnce(shader.vertexShader, '#include <begin_vertex>', FLAP_VERTEX, 'bird-flap-vertex');
        },
      });
      this.materials.push(material);
      const flap = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
      flap.setUsage(THREE.DynamicDrawUsage);
      shape.geometry.setAttribute('aFlap', flap);
      const mesh = new THREE.InstancedMesh(shape.geometry, material, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `birds:${sp.id}`;
      this.meshes.set(sp.id, { mesh, flap });
      this.group.add(mesh);
    }
  }

  get alive(): number {
    let n = 0;
    for (const f of this.flocks) n += f.members.length;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Spawning

  private suitable(sp: BirdSpecies, x: number, z: number): number {
    this.world.biomeWeights(x, z, this.weights);
    let w = 0;
    for (const [b, k] of Object.entries(sp.biomes)) w += this.weights[Number(b)] * (k ?? 0);
    return w;
  }

  private trySpawn(px: number, pz: number): void {
    if (this.alive >= this.cap) return;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const a = this.rng() * Math.PI * 2;
      const d = 170 + this.rng() * 140;
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (Math.hypot(x, z) > 1400) continue;
      // Pick a species by habitat.
      let total = 0;
      const scores = BIRD_SPECIES.map((sp) => {
        const w = this.suitable(sp, x, z);
        total += w;
        return w;
      });
      if (total < 0.35) continue;
      let r = this.rng() * total;
      let sp = BIRD_SPECIES[0];
      for (let i = 0; i < scores.length; i += 1) {
        r -= scores[i];
        if (r <= 0) {
          sp = BIRD_SPECIES[i];
          break;
        }
      }
      if (this.flocks.filter((f) => f.species === sp).length >= 2) continue;
      const count = Math.min(this.cap - this.alive, sp.flock[0] + Math.floor(this.rng() * (sp.flock[1] - sp.flock[0] + 1)));
      if (count <= 0) return;
      this.spawnFlock(sp, x, z, count, true);
      return;
    }
  }

  /** A flock around (x, z): in the air, or already down on the ground. */
  spawnFlock(sp: BirdSpecies, x: number, z: number, count: number, airborne: boolean): Flock {
    const ground = Math.max(this.world.groundAt(x, z), this.world.waterLevelAt(x, z));
    const altitude = sp.altitude[0] + this.rng() * (sp.altitude[1] - sp.altitude[0]);
    const flock: Flock = {
      id: this.nextId++,
      species: sp,
      members: [],
      mode: airborne ? 'cruise' : 'ground',
      home: new THREE.Vector3(x, ground, z),
      center: new THREE.Vector3(x, ground, z),
      target: new THREE.Vector3(x, ground + altitude, z),
      angle: this.rng() * Math.PI * 2,
      radius: 18 + this.rng() * 30,
      altitude,
      timer: 25 + this.rng() * 50,
      callTimer: 3 + this.rng() * 8,
      turn: this.rng() < 0.5 ? -1 : 1,
    };
    for (let i = 0; i < count; i += 1) {
      const slot = new THREE.Vector3((this.rng() - 0.5) * 9, (this.rng() - 0.5) * 3, (this.rng() - 0.5) * 9);
      const bx = x + slot.x;
      const bz = z + slot.z;
      const by = airborne ? ground + altitude + slot.y : this.world.groundAt(bx, bz);
      const bird: Bird = {
        id: this.nextId++,
        species: sp,
        flock,
        state: airborne ? 'fly' : 'ground',
        pos: new THREE.Vector3(bx, by, bz),
        vel: airborne ? new THREE.Vector3(Math.cos(flock.angle) * sp.speed, 0, Math.sin(flock.angle) * sp.speed) : new THREE.Vector3(),
        yaw: this.rng() * Math.PI * 2,
        pitch: 0,
        bank: 0,
        size: 0.88 + this.rng() * 0.24,
        phase: this.rng() * Math.PI * 2,
        rate: sp.flapRate * (0.9 + this.rng() * 0.2),
        inner: 0,
        outer: 0,
        fold: airborne ? 0 : 1,
        burst: 0,
        glideTimer: this.rng() * 3,
        gliding: false,
        slot,
        spot: new THREE.Vector3(bx, by, bz),
        hop: 0,
        hopFrom: new THREE.Vector3(bx, by, bz),
        peck: 0,
        timer: this.rng() * 3,
        spin: new THREE.Vector3(),
        arrows: [],
        deadTime: 0,
      };
      flock.members.push(bird);
    }
    this.flocks.push(flock);
    return flock;
  }

  // ---------------------------------------------------------------------------
  // Behaviour

  /** Scare every flock within `radius` of a point (a shot, a roar, a fall). */
  startle(x: number, z: number, radius: number): void {
    for (const f of this.flocks) {
      if (f.mode === 'cruise') continue;
      for (const b of f.members) {
        if (Math.hypot(b.pos.x - x, b.pos.z - z) < radius) {
          this.flush(f, x, z);
          break;
        }
      }
    }
  }

  private flush(f: Flock, fromX: number, fromZ: number): void {
    const sp = f.species;
    let dx = f.center.x - fromX;
    let dz = f.center.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    // Settle somewhere well away.
    const hop = 90 + this.rng() * 90;
    f.home.set(f.center.x + dx * hop, 0, f.center.z + dz * hop);
    f.home.y = this.world.groundAt(f.home.x, f.home.z);
    f.center.copy(f.home);
    f.mode = 'cruise';
    f.timer = 30 + this.rng() * 40;
    f.angle = Math.atan2(-dz, -dx);
    for (const b of f.members) {
      if (b.state !== 'ground' && b.state !== 'fly') continue;
      const wasGround = b.state === 'ground';
      b.state = 'fly';
      b.burst = 1.6 + this.rng() * 0.8;
      if (wasGround) b.vel.set(dx * sp.speed * 0.5 + (this.rng() - 0.5) * 2, sp.speed * 0.45, dz * sp.speed * 0.5 + (this.rng() - 0.5) * 2);
    }
    const lead = f.members[0];
    if (lead) this.hooks.sound('flush', sp.call, lead.pos.x, lead.pos.y, lead.pos.z);
  }

  private findGround(f: Flock): THREE.Vector3 | null {
    const sp = f.species;
    const p = this.hooks.player();
    for (let k = 0; k < 14; k += 1) {
      const a = this.rng() * Math.PI * 2;
      const r = this.rng() * 45;
      const x = f.center.x + Math.cos(a) * r;
      const z = f.center.z + Math.sin(a) * r;
      if (Math.hypot(x - p.x, z - p.z) < sp.startle * 2.2) continue;
      const depth = this.world.waterDepthAt(x, z);
      if (depth > (sp.wade ? 0.35 : 0.02)) continue;
      if (this.world.slopeAt(x, z) > 0.45) continue;
      if (this.suitable(sp, x, z) < 0.3) continue;
      return new THREE.Vector3(x, this.world.groundAt(x, z), z);
    }
    return null;
  }

  update(dt: number, now: number): void {
    const p = this.hooks.player();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.trySpawn(p.x, p.z);
    }
    const night = this.hooks.isNight();
    for (let i = this.flocks.length - 1; i >= 0; i -= 1) {
      const f = this.flocks[i];
      if (f.members.length === 0 || Math.hypot(f.center.x - p.x, f.center.z - p.z) > 520) {
        this.flocks.splice(i, 1);
        continue;
      }
      this.updateFlock(f, dt, p, night);
      for (const b of f.members) this.updateBird(b, f, dt);
    }
    for (let i = this.carcasses.length - 1; i >= 0; i -= 1) {
      const b = this.carcasses[i];
      if (b.state === 'fall') this.updateFall(b, dt);
      if (b.state === 'dead' && (now - b.deadTime > 600 || Math.hypot(b.pos.x - p.x, b.pos.z - p.z) > 400)) this.carcasses.splice(i, 1);
    }
    this.sync();
  }

  private updateFlock(f: Flock, dt: number, p: { x: number; y: number; z: number; crouching: boolean; sprinting: boolean }, night: boolean): void {
    const sp = f.species;
    f.timer -= dt;
    // Calls now and then, when someone might hear.
    f.callTimer -= dt;
    if (f.callTimer <= 0) {
      f.callTimer = (f.mode === 'ground' ? 6 : 4) + this.rng() * 10;
      const b = f.members[Math.floor(this.rng() * f.members.length)];
      if (b && !night && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < 140) this.hooks.sound('call', sp.call, b.pos.x, b.pos.y, b.pos.z);
    }
    if (f.mode === 'cruise') {
      // Wheel about a centre that drifts around home.
      f.angle += (f.turn * (sp.speed / f.radius)) * dt;
      const ground = this.world.groundAt(f.center.x + Math.cos(f.angle) * f.radius, f.center.z + Math.sin(f.angle) * f.radius);
      const water = this.world.waterLevelAt(f.center.x, f.center.z);
      f.target.set(f.center.x + Math.cos(f.angle) * f.radius, Math.max(ground, water) + f.altitude, f.center.z + Math.sin(f.angle) * f.radius);
      if (f.timer <= 0) {
        f.timer = 30 + this.rng() * 50;
        const land = night || this.rng() < 0.55;
        const spot = land ? this.findGround(f) : null;
        if (spot) {
          f.mode = 'land';
          f.center.copy(spot);
          for (const b of f.members) {
            const a = this.rng() * Math.PI * 2;
            const r = 0.6 + this.rng() * (sp.heron ? 9 : 4);
            const bx = spot.x + Math.cos(a) * r;
            const bz = spot.z + Math.sin(a) * r;
            b.spot.set(bx, this.world.groundAt(bx, bz), bz);
          }
        } else {
          // Drift to a new centre near home.
          const a = this.rng() * Math.PI * 2;
          const r = this.rng() * 60;
          f.center.set(f.home.x + Math.cos(a) * r, 0, f.home.z + Math.sin(a) * r);
          f.radius = 16 + this.rng() * 34;
          f.altitude = sp.altitude[0] + this.rng() * (sp.altitude[1] - sp.altitude[0]);
          f.turn = this.rng() < 0.5 ? -1 : 1;
        }
      }
      return;
    }
    // Landing or foraging: too close, and up they go.
    const reach = sp.startle * (p.crouching ? 0.45 : p.sprinting ? 1.5 : 1);
    for (const b of f.members) {
      if (Math.hypot(b.pos.x - p.x, b.pos.z - p.z, (b.pos.y - p.y) * 0.5) < reach) {
        this.flush(f, p.x, p.z);
        return;
      }
    }
    if (f.mode === 'land' && f.members.every((b) => b.state === 'ground')) {
      f.mode = 'ground';
      f.timer = night ? 1e9 : 25 + this.rng() * 50;
    }
    if (f.mode === 'ground' && f.timer <= 0 && !night) {
      f.mode = 'cruise';
      f.timer = 30 + this.rng() * 40;
      for (const b of f.members) {
        b.state = 'fly';
        b.burst = 1.2 + this.rng();
        b.vel.set((this.rng() - 0.5) * 3, sp.speed * 0.4, (this.rng() - 0.5) * 3);
      }
    }
    if (f.mode === 'ground' && !night && f.timer > 1e8) f.timer = 5 + this.rng() * 20;
  }

  private updateBird(b: Bird, f: Flock, dt: number): void {
    const sp = b.species;
    if (b.state === 'ground') {
      this.updateGround(b, f, dt);
      this.pose(b, dt, 0, 0, 1);
      return;
    }
    // Flying: steer to the flock's target (or this bird's landing spot).
    const landing = f.mode === 'land' || f.mode === 'ground';
    const goal = landing ? this.v.copy(b.spot) : this.v.copy(f.target).add(b.slot);
    if (landing) {
      // Come in from above, then drop onto the spot.
      const flat = Math.hypot(goal.x - b.pos.x, goal.z - b.pos.z);
      goal.y += Math.min(12, flat * 0.35);
      if (flat < 1.2 && b.pos.y - b.spot.y < 1.5) {
        b.state = 'ground';
        b.pos.copy(b.spot);
        b.vel.set(0, 0, 0);
        b.hopFrom.copy(b.pos);
        b.timer = 1 + this.rng() * 3;
        return;
      }
    }
    const desired = this.v2.copy(goal).sub(b.pos);
    const dist = desired.length();
    const cruise = landing ? Math.max(2.2, Math.min(sp.speed, dist * 0.8)) : sp.speed;
    desired.multiplyScalar(cruise / Math.max(0.001, dist));
    // Keep apart from flock mates.
    for (const o of f.members) {
      if (o === b || o.state !== 'fly') continue;
      const dx = b.pos.x - o.pos.x;
      const dy = b.pos.y - o.pos.y;
      const dz = b.pos.z - o.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const min = sp.span * 2.2;
      if (d2 < min * min && d2 > 1e-6) {
        const push = (min - Math.sqrt(d2)) * 2.5;
        desired.x += dx * push;
        desired.y += dy * push;
        desired.z += dz * push;
      }
    }
    // Never fly into the hillside.
    const ground = this.world.groundAt(b.pos.x + b.vel.x * 1.5, b.pos.z + b.vel.z * 1.5);
    const clearance = b.pos.y - ground;
    if (!landing && clearance < 6) desired.y += (6 - clearance) * 1.5;
    const accel = b.burst > 0 ? 9 : 5;
    const steer = desired.sub(b.vel);
    const sl = steer.length();
    if (sl > accel * dt) steer.multiplyScalar((accel * dt) / sl);
    const oldYaw = Math.atan2(b.vel.x, b.vel.z);
    b.vel.add(steer);
    if (b.burst > 0) b.vel.y = Math.max(b.vel.y, 2.5);
    const speed = b.vel.length();
    const maxSpeed = sp.speed * (b.burst > 0 ? 1.5 : 1.25);
    if (speed > maxSpeed) b.vel.multiplyScalar(maxSpeed / speed);
    b.pos.addScaledVector(b.vel, dt);
    const floor = this.world.groundAt(b.pos.x, b.pos.z) + 0.3;
    if (b.pos.y < floor) {
      b.pos.y = floor;
      b.vel.y = Math.max(0, b.vel.y);
    }
    b.burst = Math.max(0, b.burst - dt);
    // Attitude: face the flight, bank into turns.
    const yaw = Math.atan2(b.vel.x, b.vel.z);
    let dYaw = yaw - oldYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    b.yaw = yaw;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    b.pitch = clamp(-Math.atan2(b.vel.y, Math.max(0.5, hs)), -0.7, 0.7);
    b.bank += (clamp((-dYaw / Math.max(dt, 1e-3)) * 0.35, -0.8, 0.8) - b.bank) * Math.min(1, dt * 3);
    // Flap or glide.
    b.glideTimer -= dt;
    if (b.glideTimer <= 0) {
      b.gliding = !b.gliding && this.rng() < sp.glide;
      b.glideTimer = b.gliding ? 1.5 + this.rng() * 3 * sp.glide : 0.8 + this.rng() * 2;
    }
    const mustFlap = b.burst > 0 || b.vel.y > 0.8 || landing;
    if (b.gliding && !mustFlap) {
      // Gulls hold a crooked "M"; others a shallow V.
      const m = sp.id === 'gull';
      this.pose(b, dt, m ? 0.22 : 0.1, m ? -0.34 : 0.04, 0);
    } else {
      const rate = b.rate * (b.burst > 0 ? 1.45 : 1);
      b.phase += dt * rate * Math.PI * 2;
      const beat = Math.sin(b.phase);
      const amp = landing ? 0.75 : 0.62;
      this.pose(b, dt, 0.08 + beat * amp, Math.sin(b.phase - 0.9) * 0.5, 0, true);
    }
  }

  private updateGround(b: Bird, f: Flock, dt: number): void {
    b.timer -= dt;
    b.peck = Math.max(0, b.peck - dt * 2.5);
    if (b.hop > 0) {
      b.hop = Math.max(0, b.hop - dt / 0.28);
      const t = 1 - b.hop;
      b.pos.lerpVectors(b.hopFrom, b.spot, t);
      b.pos.y += Math.sin(t * Math.PI) * 0.12 * b.species.body;
      if (b.hop === 0) b.pos.copy(b.spot);
    } else if (b.timer <= 0) {
      b.timer = 0.6 + this.rng() * 2.4;
      if (this.rng() < 0.45) b.peck = 1;
      else {
        // A short hop (herons stalk slowly).
        const a = b.yaw + (this.rng() - 0.5) * 2.2;
        const r = (b.species.heron ? 0.5 : 0.25) + this.rng() * 0.5;
        const x = b.pos.x + Math.sin(a) * r;
        const z = b.pos.z + Math.cos(a) * r;
        if (Math.hypot(x - f.center.x, z - f.center.z) < 12 && this.world.waterDepthAt(x, z) <= (b.species.wade ? 0.35 : 0.02)) {
          b.hopFrom.copy(b.pos);
          b.spot.set(x, this.world.groundAt(x, z), z);
          b.hop = 1;
          b.yaw = a;
        } else b.yaw += (this.rng() - 0.5) * 1.5;
      }
    }
    b.pitch = b.peck > 0 ? Math.sin(b.peck * Math.PI) * 0.7 : -0.12;
    b.bank *= 0.9;
  }

  private updateFall(b: Bird, dt: number): void {
    b.vel.y -= GRAVITY * dt;
    b.vel.multiplyScalar(1 - 0.4 * dt);
    b.pos.addScaledVector(b.vel, dt);
    b.yaw += b.spin.x * dt;
    b.pitch += b.spin.y * dt;
    b.bank += b.spin.z * dt;
    b.phase += dt * 14;
    this.pose(b, dt, Math.sin(b.phase) * 0.7, Math.sin(b.phase * 1.3) * 0.5, 0.2);
    const ground = Math.max(this.world.groundAt(b.pos.x, b.pos.z), this.world.waterLevelAt(b.pos.x, b.pos.z));
    if (b.pos.y <= ground + 0.05) {
      b.pos.y = ground + 0.04 * b.species.body;
      b.state = 'dead';
      b.vel.set(0, 0, 0);
      b.pitch = 0.1;
      b.bank = Math.PI / 2 - 0.25;
      this.pose(b, 1, -0.3, 0.2, 0.45);
    }
  }

  private pose(b: Bird, dt: number, inner: number, outer: number, fold: number, snap = false): void {
    const k = snap ? 1 : Math.min(1, dt * 8);
    b.inner += (inner - b.inner) * k;
    b.outer += (outer - b.outer) * k;
    b.fold += (fold - b.fold) * Math.min(1, dt * 6);
  }

  // ---------------------------------------------------------------------------
  // Hunting

  /** The first bird along a flight segment (nothing happens to it yet). */
  pick(from: THREE.Vector3, dir: THREE.Vector3, length: number): { t: number; id: number; species: string } | null {
    let best: Bird | null = null;
    let bestT = length;
    for (const f of this.flocks) {
      for (const b of f.members) {
        const r = b.species.body * 0.55 * b.size + 0.06;
        const tx = b.pos.x - from.x;
        const ty = b.pos.y + b.species.body * 0.1 - from.y;
        const tz = b.pos.z - from.z;
        const along = tx * dir.x + ty * dir.y + tz * dir.z;
        if (along < -r || along > bestT + r) continue;
        const miss = Math.hypot(tx - dir.x * along, ty - dir.y * along, tz - dir.z * along);
        if (miss > r) continue;
        const t = Math.max(0, along - Math.sqrt(Math.max(0, r * r - miss * miss)));
        if (t <= bestT) {
          bestT = t;
          best = b;
        }
      }
    }
    return best ? { t: bestT, id: best.id, species: best.species.id } : null;
  }

  /** Bring down a bird: it falls with the arrow in it; the flock scatters. */
  shoot(id: number, dir: THREE.Vector3, arrow: string | null): boolean {
    for (const f of this.flocks) {
      const b = f.members.find((m) => m.id === id);
      if (b) {
        this.kill(b, dir, arrow);
        return true;
      }
    }
    return false;
  }

  private kill(b: Bird, dir: THREE.Vector3, arrow: string | null): void {
    const f = b.flock;
    if (f) {
      f.members.splice(f.members.indexOf(b), 1);
      if (f.members.length > 0) this.flush(f, b.pos.x - dir.x * 10, b.pos.z - dir.z * 10);
    }
    b.flock = null;
    b.state = b.state === 'ground' ? 'dead' : 'fall';
    b.vel.multiplyScalar(0.3).addScaledVector(dir, 3);
    b.spin.set((this.rng() - 0.5) * 8, (this.rng() - 0.5) * 6, (this.rng() - 0.5) * 10);
    if (arrow) b.arrows.push(arrow);
    b.deadTime = performance.now() / 1000;
    if (b.state === 'dead') {
      b.bank = Math.PI / 2 - 0.25;
      b.fold = 0.45;
      b.pos.y = this.world.groundAt(b.pos.x, b.pos.z) + 0.04 * b.species.body;
    }
    this.carcasses.push(b);
  }

  /** A downed bird within reach. */
  pickCarcass(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): { id: number; name: string } | null {
    let best: Bird | null = null;
    let bestAlong = reach + 1;
    for (const b of this.carcasses) {
      if (b.state !== 'dead') continue;
      const tx = b.pos.x - origin.x;
      const ty = b.pos.y - origin.y;
      const tz = b.pos.z - origin.z;
      const along = tx * dir.x + ty * dir.y + tz * dir.z;
      if (along < 0 || along > reach + 0.6) continue;
      const miss = Math.hypot(tx - dir.x * along, ty - dir.y * along, tz - dir.z * along);
      if (miss > 0.45 + b.species.body * 0.3) continue;
      if (along < bestAlong) {
        bestAlong = along;
        best = b;
      }
    }
    return best ? { id: best.id, name: best.species.name } : null;
  }

  /** Take a downed bird: its loot, and any arrows in it. */
  collect(id: number): { loot: [string, number][]; arrows: string[] } | null {
    const i = this.carcasses.findIndex((b) => b.id === id && b.state === 'dead');
    if (i < 0) return null;
    const b = this.carcasses[i];
    this.carcasses.splice(i, 1);
    const rng = createRng(hashString(`bird:${b.species.id}:${b.id}`));
    const loot: [string, number][] = [];
    for (const [item, min, max] of b.species.loot) {
      const n = min + Math.floor(rng() * (max - min + 1));
      if (n > 0) loot.push([item, n]);
    }
    return { loot, arrows: b.arrows };
  }

  // ---------------------------------------------------------------------------
  // Drawing

  private sync(): void {
    const counts = new Map<string, number>();
    const put = (b: Bird): void => {
      const entry = this.meshes.get(b.species.id);
      if (!entry) return;
      const n = counts.get(b.species.id) ?? 0;
      if (n >= CAPACITY) return;
      this.e.set(b.pitch, b.yaw, b.bank, 'YXZ');
      this.q.setFromEuler(this.e);
      this.s.setScalar(b.size);
      this.m.compose(b.pos, this.q, this.s);
      entry.mesh.setMatrixAt(n, this.m);
      entry.flap.setXYZ(n, b.inner, b.outer, b.fold);
      counts.set(b.species.id, n + 1);
    };
    for (const f of this.flocks) for (const b of f.members) put(b);
    for (const b of this.carcasses) put(b);
    for (const [id, entry] of this.meshes) {
      entry.mesh.count = counts.get(id) ?? 0;
      entry.mesh.instanceMatrix.needsUpdate = true;
      entry.flap.needsUpdate = true;
    }
  }

  /** Test hook: every bird with its state. */
  debugBirds(): { id: number; species: string; state: string; x: number; y: number; z: number; flock: number }[] {
    const out: { id: number; species: string; state: string; x: number; y: number; z: number; flock: number }[] = [];
    for (const f of this.flocks) for (const b of f.members) out.push({ id: b.id, species: b.species.id, state: b.state, x: b.pos.x, y: b.pos.y, z: b.pos.z, flock: f.id });
    for (const b of this.carcasses) out.push({ id: b.id, species: b.species.id, state: b.state, x: b.pos.x, y: b.pos.y, z: b.pos.z, flock: 0 });
    return out;
  }

  /** Test hook: a flock of `species` at (x, z), airborne or foraging. */
  debugSpawn(species: string, x: number, z: number, count: number, airborne: boolean): number {
    const sp = BIRD_SPECIES.find((s) => s.id === species);
    if (!sp) return 0;
    return this.spawnFlock(sp, x, z, count, airborne).id;
  }

  clear(): void {
    this.flocks.length = 0;
    this.carcasses.length = 0;
    this.sync();
  }
}
