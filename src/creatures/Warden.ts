import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { angleDelta, clamp, damp, smoothstep } from '../core/math';
import { createRng, hashString } from '../core/rng';
import type { EventBus } from '../core/Events';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import type { WorldData } from '../world/WorldData';
import { LANDMARKS } from '../world/WorldLayout';
import { BONE, CreatureBuilder, type CreatureRig } from './CreatureModel';
import { paint, solid, WARDENS, type Dresser, type StrikeKind, type WardenDef } from './WardenDefs';

// The Wardens: vast guardians the Held Note will not let die, each bound to
// a Bellstone. They are not killed. Break the songstone knots grown into
// them, wear them down, and they kneel, the note loosens, and their land
// blooms. Every attack is telegraphed (a roar, a rear, a pawed hoof, a
// glowing ring on the ground): a fair fight you learn by watching.
//
// All five share one grammar (charge, stomp shockwave, close sweep, and
// eruptions from the ground past half strength) with their own bodies,
// elements and voices (see WardenDefs). Stand before a big tree and a
// charge crashes into it; jump the shockwaves.

export type WardenSound = 'roar' | 'stomp' | 'step' | 'charge' | 'crash' | 'roots' | 'rootsWarn' | 'crack' | 'calm';

export interface WardenHooks {
  player(): { x: number; y: number; z: number; grounded: boolean; alive: boolean };
  damagePlayer(amount: number, source: string, fromX: number, fromZ: number): void;
  knockPlayer(x: number, y: number, z: number): void;
  shake(amount: number): void;
  sound(kind: WardenSound, x: number, y: number, z: number, strength?: number, pitch?: number, element?: StrikeKind): void;
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

/** What a strike did: `t` is the distance along the ray, `attach` what was struck. */
export interface WardenHit {
  hit: boolean;
  weak: boolean;
  broke: boolean;
  t?: number;
  attach?: THREE.Object3D;
}

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

interface Strike {
  x: number;
  y: number;
  z: number;
  t: number;
  fuse: number;
  hit: boolean;
  decal: THREE.Mesh;
  decalMaterial: THREE.ShaderMaterial;
  spikes: THREE.Group;
  /** Rise height of the eruption. */
  rise: number;
}

export interface BossStatus {
  name: string;
  title: string;
  fraction: number;
  phaseAt: number;
}

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

/** Shockwave: a ring of force rolling outward. */
const WAVE_FRAG = /* glsl */ `
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float band = 1.0 - abs(vUv.y * 2.0 - 1.0);
  gl_FragColor = vec4(uColor * band * uFade * 1.6, 1.0);
}`;

/** The wall of dust (or spray, or embers) that follows it. */
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

/** A geyser column of water or mud: brighter at the core, torn at the top. */
const COLUMN_FRAG = /* glsl */ `
uniform float uFade;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float h = vUv.y;
  float streak = 0.6 + 0.4 * sin(vUv.x * 40.0 + uTime * 9.0 + h * 12.0);
  float a = (1.0 - smoothstep(0.55, 1.0, h)) * streak * uFade;
  gl_FragColor = vec4(uColor * a * 1.3, 1.0);
}`;

function additive(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DECAL_VERT,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
}

/** One Warden: body, dressing, knots and the fight. */
export class Warden {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly rig: CreatureRig;
  private readonly knots: Knot[] = [];
  private readonly attachMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshStandardMaterial;
  private readonly calmMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly strikeMaterial: THREE.MeshStandardMaterial;
  private readonly calmMeshes: THREE.Mesh[] = [];
  private readonly waves: Wave[] = [];
  private readonly strikes: Strike[] = [];
  private readonly rng: () => number;
  private readonly pose: Pose = { phase: 0, gait: 0, rear: 0, lower: 0, sweep: 0, kneel: 0, lie: 1, paw: 0, flinch: 0, bloom: 0 };
  private readonly target: Pose = { phase: 0, gait: 0, rear: 0, lower: 0, sweep: 0, kneel: 0, lie: 1, paw: 0, flinch: 0, bloom: 0 };
  mode: Mode = 'dormant';
  hp: number;
  /** Tests/photo mode: keep sleeping even with the player close. */
  holdDormant = false;
  private t = 0;
  private time = 0;
  private cooldown = 0;
  private phase2 = false;
  private readonly pos = new THREE.Vector3();
  private yaw: number;
  private speed = 0;
  private readonly bed = new THREE.Vector3();
  readonly arena = new THREE.Vector3();
  private readonly chargeDir = new THREE.Vector2();
  private chargeDistance = 0;
  private chargeHit = false;
  private sweepSide = 1;
  private sweepHit = false;
  private stompCount = 0;
  private rootsCast = 0;
  private stepTimer = 0;
  private readonly lastPlayer = new THREE.Vector3();
  private readonly playerVel = new THREE.Vector3();
  private readonly bodyColliders = [
    { x: 0, z: 0, radius: 1.5, height: 4.5 },
    { x: 0, z: 0, radius: 1.5, height: 4.5 },
    { x: 0, z: 0, radius: 1.1, height: 4 },
  ];
  private readonly tmp = new THREE.Vector3();
  /** Body half-width (from the creature builder's proportions). */
  private readonly bodyR: number;

  constructor(
    readonly def: WardenDef,
    builder: CreatureBuilder,
    private readonly world: WorldData,
    private readonly events: EventBus,
    private readonly hooks: WardenHooks,
  ) {
    const bell = LANDMARKS.find((l) => l.id === def.bell);
    if (!bell) throw new Error(`${def.name} needs its Bellstone (${def.bell})`);
    this.rng = createRng(hashString(def.id));
    this.hp = def.hp;
    this.bodyR = def.look.height * 0.38 * 0.55 * def.look.bulk + 0.02;
    this.arena.set(bell.x, world.groundAt(bell.x, bell.z), bell.z);
    this.bed.set(bell.x + def.bed[0], 0, bell.z + def.bed[1]);
    this.bed.y = world.groundAt(this.bed.x, this.bed.z);
    this.pos.copy(this.bed);
    this.yaw = def.bedYaw;
    this.attachMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    this.glowMaterial = new THREE.MeshStandardMaterial({ color: def.glow.color, emissive: def.glow.emissive, emissiveIntensity: def.glow.intensity, roughness: 0.35 });
    this.calmMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: def.calmEmissive, emissiveIntensity: 0.15 });
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x1a0c02, emissive: def.eye, emissiveIntensity: 3, roughness: 0.3 });
    const k = def.element.kind;
    this.strikeMaterial = new THREE.MeshStandardMaterial(
      k === 'ice'
        ? { color: 0xcfeeff, emissive: 0x5fb8e8, emissiveIntensity: 0.7, roughness: 0.08, metalness: 0 }
        : k === 'lava'
          ? { color: 0x1a1210, emissive: 0xff4a0a, emissiveIntensity: 1.6, roughness: 0.7, metalness: 0 }
          : { vertexColors: true, roughness: 0.9, metalness: 0 },
    );
    this.rig = this.build(builder);
    this.materials.push(this.attachMaterial, this.glowMaterial, this.calmMaterial, this.eyeMaterial, this.strikeMaterial);
    for (const kn of this.knots) this.materials.push(kn.material);
    this.group.add(this.rig.mesh);
    this.place();
    this.applyPose(0);
  }

  // ---------------------------------------------------------------------------
  // Model

  private build(builder: CreatureBuilder): CreatureRig {
    const look = this.def.look;
    const rig = builder.build(look);
    rig.mesh.updateMatrixWorld(true);
    const rest = rig.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    const L = look.length;
    const H = look.height;
    const legLen = H * 0.62;
    const hipY = legLen + look.legThickness;
    const bodyR = (H - legLen) * 0.55 * look.bulk + 0.02;
    const lists = { attach: new Map<number, THREE.BufferGeometry[]>(), glow: new Map<number, THREE.BufferGeometry[]>(), calm: new Map<string, THREE.BufferGeometry[]>() };
    const local = (g: THREE.BufferGeometry, bone: number, world: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3) => {
      if (scale) g.scale(scale.x, scale.y, scale.z);
      if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
      g.translate(world.x - rest[bone].x, world.y - rest[bone].y, world.z - rest[bone].z);
      return g;
    };
    const push = <K>(map: Map<K, THREE.BufferGeometry[]>, key: K, g: THREE.BufferGeometry) => {
      const list = map.get(key) ?? [];
      list.push(g);
      map.set(key, list);
    };
    const plain = (g: THREE.BufferGeometry) => {
      const geo = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      return geo;
    };
    const dresser: Dresser = {
      L,
      H,
      hipY,
      bodyR,
      legLen,
      lt: look.legThickness,
      rng: createRng(hashString(`${this.def.id}:dress`)),
      rest,
      backY: (z) => hipY + bodyR * (z > -L * 0.05 ? 1.02 : 1.2),
      put: (bone, g, world, rot, scale) => push(lists.attach, bone, local(g, bone, world, rot, scale)),
      glow: (bone, g, world, rot, scale) => push(lists.glow, bone, local(plain(g), bone, world, rot, scale)),
      calm: (bone, g, world, stage) => push(lists.calm, `${bone}:${stage}`, local(g, bone, world)),
    };
    this.def.dress(dresser);
    const add = (bone: number, list: THREE.BufferGeometry[], material: THREE.Material, shadow = true) => {
      const merged = mergeGeometries(list, false);
      if (!merged) return null;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      rig.bones[bone].add(mesh);
      return mesh;
    };
    for (const [bone, list] of lists.attach) add(bone, list, this.attachMaterial);
    for (const [bone, list] of lists.glow) add(bone, list, this.glowMaterial, false);
    for (const [key, list] of lists.calm) {
      const [bone, stage] = key.split(':').map(Number);
      const mesh = add(bone, list, this.calmMaterial, false);
      if (!mesh) continue;
      mesh.visible = false;
      mesh.userData.bloomAt = 0.12 + stage * 0.3;
      this.calmMeshes.push(mesh);
    }

    // Songstone knots, the same teal on every Warden: the weak points.
    const rng = createRng(hashString(`${this.def.id}:knots`));
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
    const knotHp = Math.round(this.def.hp * 0.13);
    const ks = H / 4.4;
    knot('left', BONE.legs + 1, new THREE.Vector3(-bodyX - lt * 0.9, hipY - legLen * 0.5 + 0.1, frontLegZ - lt * 0.4), 0.42 * ks, knotHp);
    knot('right', BONE.legs + 3, new THREE.Vector3(bodyX + lt * 0.9, hipY - legLen * 0.5 + 0.1, frontLegZ - lt * 0.4), 0.42 * ks, knotHp);
    knot('heart', BONE.chest, new THREE.Vector3(0, hipY - bodyR * 0.3, -L * 0.47), 0.62 * ks, Infinity);

    // Eyes that watch you.
    const hs = look.headSize;
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03 * L * hs, 8, 6), this.eyeMaterial);
      eye.position.set(side * 0.088 * hs * L, 0.03 * L, -0.085 * hs * L);
      rig.bones[BONE.head].add(eye);
    }
    return rig;
  }

  // ---------------------------------------------------------------------------
  // Queries

  get name(): string {
    return this.def.name;
  }

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
    return { name: this.def.name, title: this.def.title, fraction: Math.max(0, this.hp / this.def.hp), phaseAt: 0.5 };
  }

  colliders(): { x: number; z: number; radius: number; height: number }[] {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const L = this.def.look.length;
    const offsets = [L * 0.3, -L * 0.06, -L * 0.37];
    const r = this.bodyR * 1.05;
    this.bodyColliders.forEach((c, i) => {
      c.x = this.pos.x + fx * offsets[i];
      c.z = this.pos.z + fz * offsets[i];
      c.radius = i === 2 ? r * 0.9 : r;
      c.height = this.def.look.height * (1 - this.pose.lie * 0.55);
    });
    return this.bodyColliders;
  }

  /** The player's swing: knots first, then the body (thick hide and dressing). */
  hit(origin: THREE.Vector3, dir: THREE.Vector3, reach: number, damage: number): WardenHit {
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
    let bodyBone: number = BONE.chest;
    for (const s of this.bodySpheres()) {
      const t = raySphere(origin, dir, s.center, s.radius);
      if (t >= 0 && t < bodyT) {
        bodyT = t;
        bodyBone = s.bone;
      }
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
        this.hooks.sound('crack', best.world.x, best.world.y, best.world.z, 1, 1);
        this.hooks.shake(0.35);
        this.events.emit('notify', { text: `The knot shatters. ${this.def.name} stumbles!`, icon: 'songstone', tone: 'good' });
        this.enter('stagger');
      }
      this.applyDamage(dealt);
      this.pose.flinch = 1;
      this.events.emit('hit', { target: 'warden', material: 'songstone', x: best.world.x, y: best.world.y, z: best.world.z });
      return { hit: true, weak: true, broke, t: bestT, attach: best.mesh };
    }
    if (bodyT <= reach + 0.3) {
      const dealt = damage * 0.25;
      this.applyDamage(dealt);
      this.pose.flinch = Math.max(this.pose.flinch, 0.35);
      const p = this.tmp.copy(origin).addScaledVector(dir, bodyT);
      this.events.emit('hit', { target: 'warden', material: this.def.element.kind === 'ice' || this.def.element.kind === 'lava' ? 'stone' : 'wood', x: p.x, y: p.y, z: p.z });
      return { hit: true, weak: false, broke: false, t: bodyT, attach: this.rig.bones[bodyBone] };
    }
    return { hit: false, weak: false, broke: false };
  }

  private get heartOpen(): boolean {
    return this.mode === 'winded' || this.mode === 'stagger';
  }

  private bodySpheres(): { center: THREE.Vector3; radius: number; bone: number }[] {
    const b = this.rig.bones;
    const look = this.def.look;
    const out: { center: THREE.Vector3; radius: number; bone: number }[] = [];
    const add = (bone: number, radius: number) => out.push({ center: b[bone].getWorldPosition(new THREE.Vector3()), radius, bone });
    add(BONE.spine, this.bodyR * 1.05);
    add(BONE.chest, this.bodyR * 1.1);
    add(BONE.neck, this.bodyR * 0.65);
    add(BONE.head, 0.13 * look.length * look.headSize);
    for (let k = 0; k < 4; k += 1) add(BONE.legs + k * 2 + 1, look.legThickness * 1.9);
    return out;
  }

  private applyDamage(amount: number): void {
    if (!this.active) return;
    this.hp -= amount;
    if (!this.phase2 && this.hp < this.def.hp * 0.5) {
      this.phase2 = true;
      this.roar(1.2);
      this.hooks.shake(0.4);
      this.hooks.say('', this.def.lines.phase2, 5);
    }
    if (this.hp <= 0) this.calm();
  }

  private roar(strength: number): void {
    this.hooks.sound('roar', this.pos.x, this.pos.y + this.def.look.height, this.pos.z, strength, this.def.voice);
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
    const d = this.def;

    // Leave the arena or fall, and the Warden goes back to its bed.
    if (this.active && this.mode !== 'waking' && (!player.alive || toArena > LEASH_RADIUS)) this.enter('return');

    switch (this.mode) {
      case 'dormant': {
        tg.lie = 1;
        if (!this.holdDormant && player.alive && Math.hypot(player.x - this.bed.x, player.z - this.bed.z) < WAKE_RADIUS) {
          this.enter('waking');
          this.roar(1);
          this.hooks.shake(0.3);
          this.hooks.say('', d.lines.wake, 6);
          this.events.emit('notify', { text: `${d.name}, ${d.title}`, icon: 'songstone', tone: 'bad' });
          this.events.emit('wardenAwake', { id: d.id, name: d.name });
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
          this.roar(1);
        }
        break;
      }
      case 'stalk':
        this.updateStalk(dt, dx, dz, dist, player);
        break;
      case 'chargeWindup': {
        tg.lower = 0.85;
        tg.paw = 1;
        if (this.t < 1.0) this.turnToward(dx, dz, dt, 1.6);
        if (this.t > (this.phase2 ? 1.15 : 1.45)) {
          this.chargeDir.set(-Math.sin(this.yaw), -Math.cos(this.yaw));
          this.chargeDistance = 0;
          this.chargeHit = false;
          this.enter('charge');
          this.hooks.sound('charge', this.pos.x, this.pos.y + 2, this.pos.z, 1, d.voice);
        }
        break;
      }
      case 'charge':
        this.updateCharge(dt, player);
        break;
      case 'winded': {
        // Head thrown aside, blowing hard: the chest is open.
        tg.lower = 0.45;
        tg.kneel = 0.35;
        tg.sweep = 0.45 * this.sweepSide;
        if (this.t > 2.8) this.enter('stalk');
        break;
      }
      case 'stagger': {
        // Reeling on its knees, head flung to one side, heart knot bared.
        tg.kneel = 1;
        tg.lower = 0.2;
        tg.sweep = 0.6 * this.sweepSide;
        if (this.t > 3.8) {
          this.enter('stalk');
          this.cooldown = 0.6;
          this.roar(0.8);
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
          if (dist < d.look.length * 1.05 && facing > 0.25 && player.alive) {
            this.hooks.damagePlayer(d.damage.sweep, d.name, this.pos.x, this.pos.z);
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
          this.castStrike(player.x + this.playerVel.x * lead, player.z + this.playerVel.z * lead);
        }
        if (this.t > 2.2) {
          this.enter('stalk');
          this.cooldown = 1.4;
        }
        break;
      }
      case 'return': {
        this.hp = Math.min(d.hp, this.hp + dt * d.hp * 0.13);
        const bx = this.bed.x - this.pos.x;
        const bz = this.bed.z - this.pos.z;
        const bd = Math.hypot(bx, bz);
        if (bd > 1.5) {
          this.turnToward(bx, bz, dt, 1.2);
          this.walk(dt, d.walk * 0.9);
          tg.gait = 0.35;
        } else {
          this.yaw += angleDelta(this.yaw, d.bedYaw) * Math.min(1, dt * 1.5);
          tg.lie = smoothstep(0, 2, this.t);
          if (this.t > 2.5 && this.hp >= d.hp) this.reset();
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

  private updateStalk(dt: number, dx: number, dz: number, dist: number, player: { x: number; z: number; alive: boolean }): void {
    const tg = this.target;
    const L = this.def.look.length;
    this.turnToward(dx, dz, dt, 1.1);
    const facing = this.facingDot(dx, dz, dist);
    if (dist > L * 1.1 && facing > 0.6) {
      this.walk(dt, this.def.walk * (this.phase2 ? 1.2 : 1));
      tg.gait = 0.45;
    } else this.speed = damp(this.speed, 0, 4, dt);
    if (this.cooldown > 0 || !player.alive) return;
    // Pick an attack that suits the range; vary it so it can't be farmed.
    const roll = this.rng();
    if (dist < L * 1.0 && facing > 0.35) {
      if (roll < 0.6) {
        this.sweepSide = this.rng() < 0.5 ? -1 : 1;
        this.enter('sweepWindup');
        this.roar(0.5);
      } else this.beginStomp();
    } else if (dist < L * 1.6) {
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
    this.roar(0.9);
  }

  private beginStomp(): void {
    this.stompCount = 0;
    this.enter('stompWindup');
  }

  private beginRoots(): void {
    this.rootsCast = 0;
    this.enter('roots');
    this.roar(0.7);
  }

  private updateCharge(dt: number, player: { x: number; y: number; z: number; alive: boolean }): void {
    const tg = this.target;
    const d = this.def;
    tg.lower = 1;
    tg.gait = 1;
    const speed = this.phase2 ? d.charge[1] : d.charge[0];
    const step = speed * Math.min(1, this.t * 3) * dt;
    const nx = this.pos.x + this.chargeDir.x * step;
    const nz = this.pos.z + this.chargeDir.y * step;
    // Crash into big trees, the Bellstone, or a slope too steep to run.
    const reach = d.look.length * 0.56;
    const headX = nx + this.chargeDir.x * reach;
    const headZ = nz + this.chargeDir.y * reach;
    let crashed = Math.hypot(headX - this.arena.x, headZ - this.arena.z) < 3.2;
    if (!crashed) {
      for (const o of this.hooks.obstacles(headX, headZ, 2.2)) {
        if (o.radius > 0.28 && Math.hypot(o.x - headX, o.z - headZ) < o.radius + 1.3) {
          crashed = true;
          break;
        }
      }
    }
    const rise = this.world.groundAt(headX, headZ) - this.world.groundAt(this.pos.x, this.pos.z);
    if (rise > 2.4) crashed = true;
    if (crashed) {
      this.hooks.sound('crash', headX, this.pos.y + 2, headZ, 1, d.voice);
      this.hooks.shake(0.55);
      this.events.emit('notify', { text: `${d.name} crashes and reels!`, icon: 'songstone', tone: 'good' });
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
      if (along > -1 && along < reach + 1 && side < d.look.height * 0.48 && player.y < this.pos.y + d.look.height * 0.8) {
        this.chargeHit = true;
        this.hooks.damagePlayer(d.damage.charge, d.name, this.pos.x, this.pos.z);
        const s = Math.sign(px * this.chargeDir.y - pz * this.chargeDir.x) || 1;
        this.hooks.knockPlayer(this.chargeDir.x * 9 + this.chargeDir.y * s * 5, 6, this.chargeDir.y * 9 - this.chargeDir.x * s * 5);
        this.hooks.shake(0.8);
      }
    }
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.stepTimer = 0.28;
      this.hooks.sound('step', this.pos.x, this.pos.y, this.pos.z, 1, d.voice);
      const pd = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
      this.hooks.shake(Math.max(0, 0.22 - pd * 0.008));
    }
    if (this.chargeDistance > 36 || Math.hypot(this.pos.x - this.arena.x, this.pos.z - this.arena.z) > LEASH_RADIUS - 20) {
      this.enter('winded');
      this.speed = 0;
    }
  }

  private stomp(): void {
    this.stompCount += 1;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const reach = this.def.look.length * 0.37;
    const x = this.pos.x + fx * reach;
    const z = this.pos.z + fz * reach;
    const y = this.world.groundAt(x, z);
    this.hooks.sound('stomp', x, y, z, 1, this.def.voice, this.def.element.kind);
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
      this.hooks.sound('step', this.pos.x, this.pos.y, this.pos.z, 0.6, this.def.voice);
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
    this.setCalmLook();
    this.hooks.sound('calm', this.pos.x, this.pos.y + 2, this.pos.z, 1, 1);
    this.hooks.shake(0.3);
    this.events.emit('notify', { text: this.def.lines.calm, icon: 'songstone', tone: 'good' });
    this.events.emit('wardenCalmed', { id: this.def.id, flag: this.def.flag, name: this.def.name });
  }

  private setCalmLook(): void {
    for (const k of this.knots) k.material.emissiveIntensity = 0.12;
    this.eyeMaterial.emissive.setHex(this.def.eyeCalm);
    this.eyeMaterial.emissiveIntensity = 0.6;
    this.glowMaterial.emissiveIntensity = this.def.glow.calmIntensity;
  }

  /** Back to sleep at full strength (the player fled or fell). */
  private reset(): void {
    const d = this.def;
    this.hp = d.hp;
    this.phase2 = false;
    for (const k of this.knots) {
      k.broken = false;
      k.hp = k.maxHp;
      k.material.emissiveIntensity = 2.4;
      k.material.color.setHex(0x1b6f64);
    }
    this.pose.bloom = 0;
    this.eyeMaterial.emissive.setHex(d.eye);
    this.eyeMaterial.emissiveIntensity = 3;
    this.glowMaterial.emissiveIntensity = d.glow.intensity;
    this.attachMaterial.color.setRGB(1, 1, 1);
    this.pos.copy(this.bed);
    this.yaw = d.bedYaw;
    this.enter('dormant');
  }

  // ---------------------------------------------------------------------------
  // Effects

  private spawnWave(x: number, y: number, z: number): void {
    const el = this.def.element;
    const material = additive(WAVE_FRAG, { uFade: { value: 1 }, uColor: { value: new THREE.Color(el.wave).multiplyScalar(0.7) } });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 72, 1), material);
    ring.rotation.x = -Math.PI / 2;
    ring.layers.set(LAYER_TRANSPARENT);
    ring.frustumCulled = false;
    const dustMaterial = additive(DUST_FRAG, { uFade: { value: 1 }, uColor: { value: new THREE.Color(el.dust).multiplyScalar(0.8) } });
    const dust = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.6, 72, 1, true), dustMaterial);
    dust.geometry.translate(0, 0.8, 0);
    dust.layers.set(LAYER_TRANSPARENT);
    dust.frustumCulled = false;
    this.group.add(ring, dust);
    this.waves.push({ x, y, z, r: 1, max: 20, hit: false, ring, dust, material, dustMaterial });
  }

  /** The ground erupts under a glowing ring: roots, ice, lava, water or mud. */
  private castStrike(x: number, z: number): void {
    const el = this.def.element;
    const y = this.world.groundAt(x, z);
    const decalMaterial = additive(DECAL_FRAG, { uProgress: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(el.decal).multiplyScalar(0.6) } });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), decalMaterial);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, y + 0.12, z);
    decal.layers.set(LAYER_TRANSPARENT);
    decal.frustumCulled = false;
    const spikes = new THREE.Group();
    let rise = 3.1;
    if (el.kind === 'geyser' || el.kind === 'mud') {
      // A column of water or mud: soft, bright, and gone in a moment.
      const colMaterial = additive(COLUMN_FRAG, { uFade: { value: 1 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(el.kind === 'geyser' ? 0xbfefff : 0x8a7a50).multiplyScalar(el.kind === 'geyser' ? 0.8 : 0.55) } });
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 5.5, 20, 1, true), colMaterial);
      column.geometry.translate(0, 2.75, 0);
      column.layers.set(LAYER_TRANSPARENT);
      column.frustumCulled = false;
      spikes.add(column);
      spikes.userData.columnMaterial = colMaterial;
      if (el.kind === 'mud') {
        for (let i = 0; i < 6; i += 1) {
          const blob = new THREE.Mesh(paint(new THREE.IcosahedronGeometry(0.35 + this.rng() * 0.3, 0), solid(new THREE.Color(0.24, 0.2, 0.12), 0.2)), this.strikeMaterial);
          blob.position.set((this.rng() - 0.5) * 1.6, 0.5 + this.rng() * 3.5, (this.rng() - 0.5) * 1.6);
          spikes.add(blob);
        }
      }
      rise = 5.5;
    } else {
      const bark = new THREE.Color(0.3, 0.23, 0.16);
      for (let i = 0; i < 7; i += 1) {
        const h = 1.8 + this.rng() * 1.2;
        const cone = new THREE.ConeGeometry(0.16 + this.rng() * 0.1, h, el.kind === 'ice' ? 4 : 6);
        cone.translate(0, h / 2, 0);
        const spike = new THREE.Mesh(el.kind === 'roots' ? paint(cone, () => bark) : cone, el.kind === 'roots' ? this.attachMaterial : this.strikeMaterial);
        const a = (i / 7) * Math.PI * 2 + this.rng();
        const r = i === 0 ? 0 : 0.7 + this.rng() * 0.9;
        spike.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        spike.rotation.set((this.rng() - 0.5) * 0.5, this.rng() * 3, (this.rng() - 0.5) * 0.5);
        spike.castShadow = true;
        spikes.add(spike);
      }
    }
    spikes.position.set(x, y - rise - 0.1, z);
    spikes.visible = false;
    this.group.add(decal, spikes);
    this.strikes.push({ x, y, z, t: 0, fuse: 1.15, hit: false, decal, decalMaterial, spikes, rise });
    this.hooks.sound('rootsWarn', x, y, z, 1, this.def.voice, el.kind);
  }

  private updateEffects(dt: number, player: { x: number; y: number; z: number; grounded: boolean; alive: boolean }): void {
    const d = this.def;
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
        const dist = Math.hypot(player.x - w.x, player.z - w.z);
        const ground = this.world.groundAt(player.x, player.z);
        if (Math.abs(dist - w.r) < 0.9 && player.y < ground + 0.45 && w.r < w.max * 0.92) {
          w.hit = true;
          this.hooks.damagePlayer(d.damage.stomp, d.name, w.x, w.z);
          const k = 6 / Math.max(1, dist);
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
      const col = s.spikes.userData.columnMaterial as THREE.ShaderMaterial | undefined;
      if (col) col.uniforms.uTime.value = this.time;
      if (s.t >= s.fuse) {
        if (!s.spikes.visible) {
          s.spikes.visible = true;
          this.hooks.sound('roots', s.x, s.y, s.z, 1, d.voice, d.element.kind);
          const dist = Math.hypot(player.x - s.x, player.z - s.z);
          this.hooks.shake(Math.max(0, 0.45 - dist * 0.03));
        }
        const e = s.t - s.fuse;
        // Burst up fast, hold, sink (or collapse, for columns).
        const up = smoothstep(0, 0.12, e) * (1 - smoothstep(1.0, 1.6, e));
        s.spikes.position.y = s.y - s.rise - 0.1 + up * s.rise;
        if (col) col.uniforms.uFade.value = 1 - smoothstep(0.6, 1.5, e);
        s.decal.visible = e < 0.3;
        if (!s.hit && e < 0.25 && player.alive && Math.hypot(player.x - s.x, player.z - s.z) < 2.15) {
          s.hit = true;
          this.hooks.damagePlayer(d.damage.strike, d.name, s.x, s.z);
          this.hooks.knockPlayer(0, 6.5, 0);
        }
        if (e > 1.7) {
          this.group.remove(s.decal, s.spikes);
          s.decal.geometry.dispose();
          s.decalMaterial.dispose();
          s.spikes.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
          col?.dispose();
          this.strikes.splice(i, 1);
        }
      }
    }
  }

  private clearEffects(): void {
    for (const w of this.waves) this.group.remove(w.ring, w.dust);
    this.waves.length = 0;
    for (const s of this.strikes) this.group.remove(s.decal, s.spikes);
    this.strikes.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Pose

  private place(): void {
    this.pos.y = this.world.groundAt(this.pos.x, this.pos.z);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const half = this.def.look.length * 0.4;
    const front = this.world.groundAt(this.pos.x + fx * half, this.pos.z + fz * half);
    const back = this.world.groundAt(this.pos.x - fx * half, this.pos.z - fz * half);
    const pitch = Math.atan2(front - back, half * 2);
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
    const look = this.mode === 'dormant' ? Math.sin(this.time * 0.2) * 0.1 : 0;
    b[BONE.neck].rotation.set(p.lower * 0.72 + p.lie * 0.45 - p.rear * 0.35 + Math.sin(this.time * 1.1) * 0.03, p.sweep * 0.95 + look, p.sweep * 0.2);
    b[BONE.head].rotation.set(-p.lower * 0.35 + p.lie * 0.25, 0, p.sweep * 0.25);
    b[BONE.tail].rotation.set(Math.sin(this.time * 2.1) * 0.1 + p.gait * 0.3, Math.sin(this.time * 1.7) * 0.15, 0);
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
    for (const kn of this.knots) {
      if (!kn.broken && this.mode !== 'calmed') {
        const open = kn.name === 'heart' ? (this.heartOpen ? 1 : 0.25) : 1;
        kn.material.emissiveIntensity = (1.6 + 0.9 * Math.sin(this.time * 3 + kn.bone)) * open;
      }
      kn.mesh.getWorldPosition(kn.world);
    }
    for (const m of this.calmMeshes) m.visible = p.bloom > (m.userData.bloomAt as number);
    if (this.mode === 'calmed') {
      this.attachMaterial.color.setRGB(1 + p.bloom * 0.04, 1 + p.bloom * 0.1, 1 + p.bloom * 0.03);
      this.calmMaterial.emissiveIntensity = 0.15 + p.bloom * (this.def.element.kind === 'mud' ? 1.4 : 0.25);
    }
  }

  // ---------------------------------------------------------------------------
  // Save and debugging

  serialize(): boolean {
    return this.mode === 'calmed';
  }

  load(calmed: boolean): void {
    this.reset();
    this.clearEffects();
    if (calmed) {
      this.enter('calmed');
      this.t = 10;
      this.hp = 0;
      this.pose.bloom = 1;
      this.pose.lie = 1;
      this.pose.kneel = 0;
      this.setCalmLook();
      this.place();
      this.applyPose(0);
    }
  }

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

  get debugState(): { id: string; mode: string; hp: number; phase2: boolean; knots: string[]; x: number; y: number; z: number; yaw: number } {
    return {
      id: this.def.id,
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

  knotPositions(): { name: string; x: number; y: number; z: number; open: boolean }[] {
    return this.knots.map((k) => ({ name: k.name, x: k.world.x, y: k.world.y, z: k.world.z, open: !k.broken && (k.name !== 'heart' || this.heartOpen) }));
  }
}

/** All five Wardens: only the one near the player thinks and fights. */
export class WardenSystem {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly wardens: Warden[] = [];
  private readonly builder = new CreatureBuilder();
  private readonly empty: { x: number; z: number; radius: number; height: number }[] = [];

  constructor(
    world: WorldData,
    events: EventBus,
    private readonly hooks: WardenHooks,
  ) {
    this.materials.push(...(this.builder.materials as THREE.MeshStandardMaterial[]));
    for (const def of WARDENS) {
      const w = new Warden(def, this.builder, world, events, hooks);
      this.wardens.push(w);
      this.materials.push(...w.materials);
      this.group.add(w.group);
    }
  }

  get(id: string): Warden | undefined {
    return this.wardens.find((w) => w.def.id === id);
  }

  /** The Warden nearest the player (the only one that can matter). */
  private nearest(): { w: Warden; d: number } {
    const p = this.hooks.player();
    let best = this.wardens[0];
    let bestD = Infinity;
    for (const w of this.wardens) {
      const d = Math.hypot(w.position.x - p.x, w.position.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return { w: best, d: bestD };
  }

  get active(): boolean {
    return this.wardens.some((w) => w.active);
  }

  update(dt: number): void {
    const p = this.hooks.player();
    for (const w of this.wardens) {
      const d = Math.hypot(w.position.x - p.x, w.position.z - p.z);
      // Far Wardens sleep unseen; close ones breathe; the near one fights.
      w.group.visible = d < 520;
      if (d < 260 || w.active || w.mode === 'return') w.update(dt);
    }
  }

  hit(origin: THREE.Vector3, dir: THREE.Vector3, reach: number, damage: number): WardenHit {
    const { w, d } = this.nearest();
    if (d > 40) return { hit: false, weak: false, broke: false };
    return w.hit(origin, dir, reach, damage);
  }

  colliders(): { x: number; z: number; radius: number; height: number }[] {
    const { w, d } = this.nearest();
    return d < 40 ? w.colliders() : this.empty;
  }

  status(): BossStatus | null {
    for (const w of this.wardens) {
      const s = w.status();
      if (s) return s;
    }
    return null;
  }

  serialize(): { calmed: string[] } {
    return { calmed: this.wardens.filter((w) => w.serialize()).map((w) => w.def.id) };
  }

  load(data: unknown): void {
    const d = data as { calmed?: string[]; mossback?: { calmed?: boolean } } | null;
    const calmed = new Set(d?.calmed ?? []);
    if (d?.mossback?.calmed) calmed.add('mossback');
    for (const w of this.wardens) w.load(calmed.has(w.def.id));
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
