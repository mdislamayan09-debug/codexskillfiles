import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import type { ToolStats } from './items';

// Bows and arrows. Holding the attack button draws the bow (a full draw
// takes under a second; holding it costs stamina and the aim starts to
// shake), letting go looses an arrow that flies under gravity. Arrows stick
// where they land: in soil, bark, timber and hide, quivering for a moment.
// A stuck arrow can be pulled out and used again, unless it broke; arrows in
// an animal come back when it is butchered.

export const ARROW_TYPES = ['flint_arrow', 'iron_arrow', 'songstone_arrow'] as const;
export type ArrowId = (typeof ARROW_TYPES)[number];

export function isArrow(id: string): id is ArrowId {
  return (ARROW_TYPES as readonly string[]).includes(id);
}

interface ArrowStats {
  /** Damage multiplier over the bow's. */
  damage: number;
  /** Launch speed multiplier. */
  speed: number;
  /** Chance to break on stone, or on striking anything very hard. */
  breakChance: number;
  head: number;
  fletch: number;
  glow: number;
}

export const ARROW_STATS: Record<ArrowId, ArrowStats> = {
  flint_arrow: { damage: 1, speed: 1, breakChance: 0.35, head: 0x24252a, fletch: 0xd9d2c4, glow: 0 },
  iron_arrow: { damage: 1.45, speed: 1.04, breakChance: 0.15, head: 0x8d9197, fletch: 0x6b5338, glow: 0 },
  songstone_arrow: { damage: 1.3, speed: 1.1, breakChance: 0.08, head: 0x49d8c6, fletch: 0xeef1f4, glow: 0x1f9e8e },
};

/** How much of the pull the gravity of this world keeps (arrows fly flatter than in life). */
const GRAVITY = 7.2;
const ARROW_LENGTH = 0.74;
const CAPACITY = 64;
const MAX_RESTING = 48;

export type ArrowSurface = 'flesh' | 'wood' | 'stone' | 'soil' | 'sand' | 'snow' | 'ice' | 'water' | 'warden';

export interface ArrowHit {
  /** Distance along the tested segment. */
  t: number;
  surface: ArrowSurface;
  /** Something that moves (a creature's bone): the arrow rides along with it. */
  attach?: THREE.Object3D | null;
  /** The surface normal, for arrows that glance off. */
  normal?: THREE.Vector3;
  /** The arrow is carried off by what it struck (a bird) and comes back with it. */
  absorb?: boolean;
}

export interface ArcheryHooks {
  /** Living things along a flight segment. Apply the damage here and say what was struck. */
  strike(from: THREE.Vector3, dir: THREE.Vector3, length: number, damage: number, arrow: ArrowId): ArrowHit | null;
  /** The static world along a segment: ground, water, trunks, rocks, built pieces. */
  world(from: THREE.Vector3, dir: THREE.Vector3, length: number): ArrowHit | null;
  /** Ground height, for arrows that fall out of something. */
  groundAt(x: number, z: number): number;
  sound(kind: 'draw' | 'release' | 'impact', x: number, y: number, z: number, detail: string, strength: number): void;
  splash(x: number, y: number, z: number): void;
}

interface Arrow {
  type: ArrowId;
  state: 'flying' | 'stuck' | 'resting';
  /** Tip position. */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Pointing direction (unit). */
  dir: THREE.Vector3;
  damage: number;
  age: number;
  travelled: number;
  attach: THREE.Object3D | null;
  /** Arrow matrix in the attached object's space. */
  local: THREE.Matrix4 | null;
  /** Seconds of quiver left after striking. */
  quiver: number;
  quiverAxis: THREE.Vector3;
  recoverable: boolean;
}

export interface LooseResult {
  type: ArrowId;
  draw: number;
}

export interface RestingArrow {
  type: ArrowId;
  x: number;
  y: number;
  z: number;
  distance: number;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** One arrow pointing down +Z with its tip at the origin: group 0 shaft and fletching, group 1 head. */
function arrowGeometry(fletch: THREE.Color): THREE.BufferGeometry {
  const shaftColor = new THREE.Color(0x8a6a44);
  const nockColor = new THREE.Color(0x2e241a);
  const paint = (g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry => {
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const out = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') out.deleteAttribute(name);
    return out;
  };
  const shaft = new THREE.CylinderGeometry(0.0042, 0.0046, ARROW_LENGTH - 0.05, 6, 1, true);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, -0.05 - (ARROW_LENGTH - 0.05) / 2);
  const nock = new THREE.CylinderGeometry(0.0055, 0.005, 0.02, 6);
  nock.rotateX(Math.PI / 2);
  nock.translate(0, 0, -ARROW_LENGTH + 0.005);
  const vanes: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k += 1) {
    // A swept vane: a thin quad from the shaft outwards, longer at the base.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.13, 0);
    shape.lineTo(0.1, 0.017);
    shape.quadraticCurveTo(0.03, 0.02, 0, 0.004);
    const vane = new THREE.ShapeGeometry(shape, 3);
    vane.rotateY(-Math.PI / 2);
    vane.translate(0, 0.003, -ARROW_LENGTH + 0.03);
    vane.rotateZ((k / 3) * Math.PI * 2 + 0.3);
    vanes.push(paint(vane, fletch.clone().multiplyScalar(k === 0 ? 0.62 : 1)));
  }
  const body = mergeGeometries([paint(shaft, shaftColor), paint(nock, nockColor), ...vanes]);
  const headShape = new THREE.ConeGeometry(0.011, 0.055, 4);
  headShape.rotateX(Math.PI / 2);
  headShape.scale(1, 0.35, 1);
  headShape.translate(0, 0, -0.0275);
  const head = paint(headShape, new THREE.Color(1, 1, 1));
  const merged = mergeGeometries([body, head], true);
  merged.computeBoundingSphere();
  return merged;
}

export class Archery {
  readonly group = new THREE.Group();
  readonly materials: THREE.Material[] = [];
  /** Current pull, 0..1. */
  draw = 0;
  drawing = false;
  /** Seconds held at (near) full draw. */
  private held = 0;
  private readonly arrows: Arrow[] = [];
  private readonly meshes = new Map<ArrowId, THREE.InstancedMesh>();
  private readonly rng = createRng(0xa770);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpM2 = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private readonly hooks: ArcheryHooks) {
    this.group.name = 'arrows';
    const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    this.materials.push(body);
    for (const type of ARROW_TYPES) {
      const s = ARROW_STATS[type];
      const head = new THREE.MeshStandardMaterial({
        color: s.head,
        roughness: type === 'flint_arrow' ? 0.3 : 0.35,
        metalness: type === 'iron_arrow' ? 0.9 : 0,
        emissive: s.glow,
        emissiveIntensity: s.glow ? 1.6 : 0,
      });
      this.materials.push(head);
      const mesh = new THREE.InstancedMesh(arrowGeometry(new THREE.Color(s.fletch)), [body, head], CAPACITY);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(type, mesh);
      this.group.add(mesh);
    }
  }

  get flying(): number {
    let n = 0;
    for (const a of this.arrows) if (a.state === 'flying') n += 1;
    return n;
  }

  /** Cancel a draw (weapon changed, menu opened, climbing). */
  cancel(): void {
    this.drawing = false;
    this.held = 0;
  }

  /**
   * Bow handling for one frame. `down` is the attack button; `pressed` its
   * edge. Returns what was loosed, if anything; the caller spends the arrow.
   */
  handle(
    dt: number,
    bow: ToolStats | null,
    ammo: ArrowId | null,
    down: boolean,
    pressed: boolean,
    camera: THREE.Camera,
    steadiness: number,
    stamina: { spend(n: number): boolean },
  ): LooseResult | null {
    if (!bow) {
      this.cancel();
      this.draw = Math.max(0, this.draw - dt * 6);
      return null;
    }
    if (!this.drawing) {
      this.draw = Math.max(0, this.draw - dt * 5);
      if (pressed && ammo) {
        this.drawing = true;
        this.held = 0;
        camera.getWorldPosition(this.tmpV);
        this.hooks.sound('draw', this.tmpV.x, this.tmpV.y, this.tmpV.z, bow.tier >= 2 ? 'longbow' : 'shortbow', 1);
      }
      return null;
    }
    const drawTime = 0.8 / Math.max(0.4, bow.speed);
    if (down) {
      this.draw = Math.min(1, this.draw + dt / drawTime);
      if (this.draw > 0.95) {
        this.held += dt;
        // Holding a full draw is work.
        if (this.held > 1.2 && !stamina.spend(dt * 5)) {
          this.drawing = false;
          this.held = 0;
        }
      }
      return null;
    }
    // Let go.
    this.drawing = false;
    const draw = this.draw;
    const held = this.held;
    this.held = 0;
    if (draw < 0.22 || !ammo) {
      this.draw = 0;
      return null;
    }
    this.loose(ammo, bow, draw, held, camera, steadiness);
    this.draw = 0;
    return { type: ammo, draw };
  }

  /** Spread (radians) for the current draw: tight at full pull, loose early or when shaking. */
  spread(draw: number, held: number, steadiness: number): number {
    const shake = held > 2.5 ? Math.min(1, (held - 2.5) / 3) : 0;
    return 0.0035 + (1 - draw) * 0.03 + (1 - steadiness) * 0.025 + shake * 0.02;
  }

  private loose(type: ArrowId, bow: ToolStats, draw: number, held: number, camera: THREE.Camera, steadiness: number): void {
    const s = ARROW_STATS[type];
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const up = this.tmpV2.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(this.tmpQ));
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const spread = this.spread(draw, held, steadiness);
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * spread;
    const dir = forward.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    // Longbows (tier 2) cast further than shortbows.
    const launch = (22 + bow.reach * 0.42) * s.speed * (0.32 + 0.68 * draw);
    const origin = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(up, -0.05).addScaledVector(dir, ARROW_LENGTH * 0.6);
    this.add({
      type,
      state: 'flying',
      pos: origin,
      vel: dir.clone().multiplyScalar(launch),
      dir: dir.clone(),
      damage: bow.damage * s.damage * (0.3 + 0.7 * draw * draw),
      age: 0,
      travelled: 0,
      attach: null,
      local: null,
      quiver: 0,
      quiverAxis: new THREE.Vector3(1, 0, 0),
      recoverable: true,
    });
    this.hooks.sound('release', origin.x, origin.y, origin.z, type, draw);
  }

  private add(a: Arrow): void {
    this.arrows.push(a);
    // Keep a bounded number of arrows lying about: the oldest go first.
    let resting = 0;
    for (const o of this.arrows) if (o.state !== 'flying') resting += 1;
    for (let i = 0; resting > MAX_RESTING && i < this.arrows.length; ) {
      if (this.arrows[i].state !== 'flying') {
        this.arrows.splice(i, 1);
        resting -= 1;
      } else i += 1;
    }
    while (this.arrows.length > CAPACITY * 2) this.arrows.shift();
  }

  /** Test-only: fire from an arbitrary point. */
  debugLoose(type: ArrowId, from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number): void {
    this.add({
      type,
      state: 'flying',
      pos: from.clone(),
      vel: dir.clone().normalize().multiplyScalar(speed),
      dir: dir.clone().normalize(),
      damage,
      age: 0,
      travelled: 0,
      attach: null,
      local: null,
      quiver: 0,
      quiverAxis: new THREE.Vector3(1, 0, 0),
      recoverable: true,
    });
  }

  update(dt: number): void {
    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      const a = this.arrows[i];
      a.age += dt;
      if (a.state === 'flying') {
        this.fly(a, dt);
        if (a.state === 'flying' && (a.age > 12 || a.pos.y < -60)) this.arrows.splice(i, 1);
        continue;
      }
      if (a.quiver > 0) a.quiver = Math.max(0, a.quiver - dt);
      if (a.attach && !this.inScene(a.attach)) {
        // Whatever it was in is gone: the arrow drops where it was.
        a.attach = null;
        a.local = null;
        this.fallToGround(a);
      }
    }
    this.syncInstances();
  }

  private inScene(o: THREE.Object3D): boolean {
    let p: THREE.Object3D | null = o;
    while (p.parent) p = p.parent;
    return (p as THREE.Scene).isScene === true;
  }

  private fly(a: Arrow, dt: number): void {
    // Sub-step so fast arrows never skip through a thin trunk.
    const speed = a.vel.length();
    const steps = Math.max(1, Math.ceil((speed * dt) / 2.5));
    const h = dt / steps;
    for (let k = 0; k < steps; k += 1) {
      a.vel.y -= GRAVITY * h;
      a.vel.multiplyScalar(1 - 0.012 * h);
      const len = a.vel.length() * h;
      const dir = this.tmpV.copy(a.vel).normalize();
      a.dir.copy(dir);
      const hitC = this.hooks.strike(a.pos, dir, len, a.damage, a.type);
      const hitW = this.hooks.world(a.pos, dir, len);
      const hit = hitC && (!hitW || hitC.t <= hitW.t) ? hitC : hitW;
      if (hit) {
        this.impact(a, dir, hit);
        return;
      }
      a.pos.addScaledVector(dir, len);
      a.travelled += len;
    }
  }

  private impact(a: Arrow, dir: THREE.Vector3, hit: ArrowHit): void {
    const s = ARROW_STATS[a.type];
    const speed = a.vel.length();
    a.pos.addScaledVector(dir, hit.t);
    const x = a.pos.x;
    const y = a.pos.y;
    const z = a.pos.z;
    this.hooks.sound('impact', x, y, z, hit.surface, Math.min(1, speed / 50));
    if (hit.absorb) {
      this.remove(a);
      return;
    }
    if (hit.surface === 'water') {
      this.hooks.splash(x, y, z);
      a.state = 'resting';
      a.recoverable = false;
      a.age = 0;
      // Sinks out of sight.
      this.remove(a);
      return;
    }
    const hard = hit.surface === 'stone' || hit.surface === 'ice';
    if (hard) {
      if (this.rng() < s.breakChance + 0.25) {
        this.remove(a);
        return;
      }
      // Glances off and clatters down nearby.
      a.pos.addScaledVector(dir, -0.2);
      this.fallToGround(a);
      return;
    }
    const bite = hit.surface === 'flesh' || hit.surface === 'warden' ? 0.16 : hit.surface === 'wood' ? 0.07 : hit.surface === 'snow' || hit.surface === 'sand' ? 0.3 : 0.2;
    a.pos.addScaledVector(dir, bite * Math.min(1, speed / 35));
    a.state = 'stuck';
    a.vel.set(0, 0, 0);
    a.quiver = 0.55;
    a.quiverAxis.set(-dir.z, 0, dir.x).normalize();
    if (a.quiverAxis.lengthSq() < 0.5) a.quiverAxis.set(1, 0, 0);
    // Arrows in flesh can snap when the animal falls on them.
    if ((hit.surface === 'flesh' || hit.surface === 'warden') && this.rng() < s.breakChance * 0.5) a.recoverable = false;
    if (hit.attach) {
      hit.attach.updateWorldMatrix(true, false);
      a.attach = hit.attach;
      a.local = this.arrowMatrix(a, new THREE.Matrix4()).premultiply(this.tmpM.copy(hit.attach.matrixWorld).invert());
    }
  }

  private fallToGround(a: Arrow): void {
    const g = this.hooks.groundAt(a.pos.x, a.pos.z);
    const yaw = this.rng() * Math.PI * 2;
    a.dir.set(Math.cos(yaw), -0.04, Math.sin(yaw)).normalize();
    a.pos.set(a.pos.x, g + 0.012, a.pos.z);
    a.state = 'resting';
    a.vel.set(0, 0, 0);
    a.quiver = 0;
  }

  private remove(a: Arrow): void {
    const i = this.arrows.indexOf(a);
    if (i >= 0) this.arrows.splice(i, 1);
  }

  private arrowMatrix(a: Arrow, out: THREE.Matrix4): THREE.Matrix4 {
    this.tmpQ.setFromUnitVectors(Z_AXIS, this.tmpV2.copy(a.dir).normalize());
    if (a.quiver > 0) {
      const t = 0.55 - a.quiver;
      const angle = Math.sin(t * 60) * 0.06 * (a.quiver / 0.55);
      this.tmpQ2.setFromAxisAngle(a.quiverAxis, angle);
      this.tmpQ.premultiply(this.tmpQ2);
    }
    return out.compose(a.pos, this.tmpQ, this.one);
  }

  private syncInstances(): void {
    const counts = new Map<ArrowId, number>();
    for (const type of ARROW_TYPES) counts.set(type, 0);
    for (const a of this.arrows) {
      const mesh = this.meshes.get(a.type);
      if (!mesh) continue;
      const n = counts.get(a.type) ?? 0;
      if (n >= CAPACITY) continue;
      if (a.attach && a.local) {
        this.tmpM.multiplyMatrices(a.attach.matrixWorld, a.local);
        if (a.quiver > 0) {
          // Quiver about the arrow's own tip.
          const t = 0.55 - a.quiver;
          const angle = Math.sin(t * 60) * 0.06 * (a.quiver / 0.55);
          this.tmpM.multiply(this.tmpM2.makeRotationX(angle));
        }
        // Keep the tip position readable for pickup tests.
        a.pos.setFromMatrixPosition(this.tmpM);
        a.dir.copy(Z_AXIS).transformDirection(this.tmpM);
      } else this.arrowMatrix(a, this.tmpM);
      mesh.setMatrixAt(n, this.tmpM);
      counts.set(a.type, n + 1);
    }
    for (const [type, mesh] of this.meshes) {
      mesh.count = counts.get(type) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** The recoverable arrow the player is looking at, if any (anywhere along its shaft). */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): RestingArrow | null {
    let best: RestingArrow | null = null;
    for (const a of this.arrows) {
      if (a.state === 'flying' || a.attach || !a.recoverable) continue;
      for (let k = 0; k <= 4; k += 1) {
        const back = ARROW_LENGTH * (0.1 + k * 0.2);
        const mx = a.pos.x - a.dir.x * back;
        const my = a.pos.y - a.dir.y * back;
        const mz = a.pos.z - a.dir.z * back;
        const tx = mx - origin.x;
        const ty = my - origin.y;
        const tz = mz - origin.z;
        const along = tx * dir.x + ty * dir.y + tz * dir.z;
        if (along < 0 || along > reach + 0.4) continue;
        const miss = Math.hypot(tx - dir.x * along, ty - dir.y * along, tz - dir.z * along);
        if (miss > 0.22 + along * 0.02) continue;
        if (best && along >= best.distance) continue;
        best = { type: a.type, x: a.pos.x, y: a.pos.y, z: a.pos.z, distance: along };
      }
    }
    return best;
  }

  /** Pull out every recoverable arrow within `radius` of a point. */
  recoverNear(x: number, y: number, z: number, radius: number): ArrowId[] {
    const out: ArrowId[] = [];
    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      const a = this.arrows[i];
      if (a.state === 'flying' || a.attach || !a.recoverable) continue;
      if (Math.hypot(a.pos.x - x, a.pos.y - y, a.pos.z - z) > radius) continue;
      out.push(a.type);
      this.arrows.splice(i, 1);
    }
    return out;
  }

  /** Arrows riding in `obj` or its children (a butchered animal): the whole ones come back. */
  recoverFrom(obj: THREE.Object3D): ArrowId[] {
    const inside = new Set<THREE.Object3D>();
    obj.traverse((o) => inside.add(o));
    const out: ArrowId[] = [];
    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      const a = this.arrows[i];
      if (!a.attach || !inside.has(a.attach)) continue;
      if (a.recoverable) out.push(a.type);
      this.arrows.splice(i, 1);
    }
    return out;
  }

  /** Arrows in `obj` fall out onto the ground (a calmed Warden shakes them off). */
  shakeOff(obj: THREE.Object3D): void {
    const inside = new Set<THREE.Object3D>();
    obj.traverse((o) => inside.add(o));
    for (const a of this.arrows) {
      if (!a.attach || !inside.has(a.attach)) continue;
      a.attach = null;
      a.local = null;
      this.fallToGround(a);
    }
  }

  debugArrows(): { type: ArrowId; state: string; x: number; y: number; z: number; attached: boolean; recoverable: boolean }[] {
    return this.arrows.map((a) => ({ type: a.type, state: a.state, x: a.pos.x, y: a.pos.y, z: a.pos.z, attached: Boolean(a.attach), recoverable: a.recoverable }));
  }

  clear(): void {
    this.arrows.length = 0;
    this.cancel();
    this.draw = 0;
    this.syncInstances();
  }
}
