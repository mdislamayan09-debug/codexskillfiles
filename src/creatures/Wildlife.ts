import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/math';
import { createRng, hashString } from '../core/rng';
import type { EventBus } from '../core/Events';
import type { WorldData } from '../world/WorldData';
import { BIOME, BIOME_COUNT } from '../world/WorldConfig';
import { MASK } from '../world/gen/generateWorld';
import { CreatureBuilder, poseCreature, type CreatureLook, type CreatureRig, type PoseState } from './CreatureModel';

// Living creatures: herds graze, hares bolt, boars bluff-charge, duskhounds
// hunt at night, crabs guard the beaches. Each animal perceives the player
// (sight cone + hearing that cares about crouching and sprinting), keeps to
// its habitat, avoids water and cliffs, and has a weak point that rewards
// aim. Spawning happens out of view in rings around the player; nothing
// pops into existence in front of you.

type Temperament = 'skittish' | 'neutral' | 'aggressive' | 'territorial';
type State = 'graze' | 'wander' | 'alert' | 'flee' | 'chase' | 'windup' | 'recover' | 'dead';

export interface SpeciesDef {
  id: string;
  name: string;
  look: CreatureLook;
  biomes: Partial<Record<number, number>>;
  activity: 'day' | 'night' | 'any';
  herd: [number, number];
  temperament: Temperament;
  /** Aggressive at night only (duskhounds). */
  nightAggro?: boolean;
  hp: number;
  walk: number;
  run: number;
  sight: number;
  hearing: number;
  attack?: { damage: number; range: number; cooldown: number; windup: number };
  loot: [item: string, min: number, max: number][];
  /** Multiplier for hits on the weak point. */
  weakMultiplier: number;
  armor: number;
  scale: [number, number];
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export const SPECIES: readonly SpeciesDef[] = [
  {
    id: 'sprigbuck',
    name: 'Sprigbuck',
    look: { plan: 'quadruped', length: 1.35, height: 1.15, bulk: 0.85, neck: 1.25, headSize: 0.9, snout: 1.1, legThickness: 0.035, tail: 0.12, ears: 'pointed', horns: 'antlers', coat: C(0.42, 0.27, 0.15), belly: C(0.78, 0.68, 0.54), accent: C(0.55, 0.47, 0.36), roughness: 0.9 },
    biomes: { [BIOME.Greensward]: 1, [BIOME.Hollowpine]: 0.5, [BIOME.Rim]: 0.5, [BIOME.Glasswood]: 0.2 },
    activity: 'any',
    herd: [2, 5],
    temperament: 'skittish',
    hp: 40,
    walk: 1.5,
    run: 9,
    sight: 42,
    hearing: 22,
    loot: [
      ['raw_meat', 2, 3],
      ['hide', 1, 2],
      ['bone', 1, 1],
    ],
    weakMultiplier: 2.5,
    armor: 1,
    scale: [0.85, 1.1],
  },
  {
    id: 'burrowhare',
    name: 'Burrowhare',
    look: { plan: 'quadruped', length: 0.42, height: 0.3, bulk: 1.2, neck: 0.4, headSize: 1.3, snout: 0.5, legThickness: 0.018, tail: 0.1, ears: 'long', horns: 'none', coat: C(0.46, 0.38, 0.28), belly: C(0.82, 0.77, 0.68), accent: C(0.3, 0.24, 0.2), roughness: 0.95 },
    biomes: { [BIOME.Greensward]: 1, [BIOME.Rim]: 0.6, [BIOME.Coast]: 0.3, [BIOME.Frostveil]: 0.3 },
    activity: 'any',
    herd: [1, 2],
    temperament: 'skittish',
    hp: 10,
    walk: 1.2,
    run: 8,
    sight: 26,
    hearing: 16,
    loot: [
      ['raw_meat', 1, 1],
      ['hide', 0, 1],
    ],
    weakMultiplier: 2,
    armor: 1,
    scale: [0.9, 1.15],
  },
  {
    id: 'boar',
    name: 'Thistleback Boar',
    look: { plan: 'quadruped', length: 1.25, height: 0.85, bulk: 1.45, neck: 0.35, headSize: 1.25, snout: 1.3, legThickness: 0.05, tail: 0.1, ears: 'small', horns: 'tusks', coat: C(0.22, 0.17, 0.13), belly: C(0.35, 0.28, 0.22), accent: C(0.3, 0.22, 0.2), roughness: 0.95 },
    biomes: { [BIOME.Hollowpine]: 0.8, [BIOME.Greensward]: 0.35, [BIOME.Drownfen]: 0.4 },
    activity: 'any',
    herd: [1, 3],
    temperament: 'neutral',
    hp: 70,
    walk: 1.3,
    run: 7.2,
    sight: 20,
    hearing: 18,
    attack: { damage: 18, range: 1.9, cooldown: 2.2, windup: 0.55 },
    loot: [
      ['raw_meat', 3, 4],
      ['hide', 2, 2],
      ['bone', 1, 2],
    ],
    weakMultiplier: 2,
    armor: 0.9,
    scale: [0.9, 1.15],
  },
  {
    id: 'duskhound',
    name: 'Duskhound',
    look: { plan: 'quadruped', length: 1.15, height: 0.85, bulk: 0.9, neck: 0.65, headSize: 1.05, snout: 1.35, legThickness: 0.035, tail: 0.45, ears: 'pointed', horns: 'none', coat: C(0.2, 0.2, 0.22), belly: C(0.45, 0.43, 0.42), accent: C(0.12, 0.1, 0.1), roughness: 0.9 },
    biomes: { [BIOME.Hollowpine]: 1, [BIOME.Frostveil]: 0.6, [BIOME.Rim]: 0.3 },
    activity: 'night',
    herd: [2, 4],
    temperament: 'aggressive',
    nightAggro: true,
    hp: 50,
    walk: 1.8,
    run: 9.5,
    sight: 48,
    hearing: 32,
    attack: { damage: 11, range: 1.7, cooldown: 1.2, windup: 0.35 },
    loot: [
      ['raw_meat', 2, 2],
      ['pelt', 1, 1],
      ['bone', 1, 1],
    ],
    weakMultiplier: 2.5,
    armor: 1,
    scale: [0.9, 1.1],
  },
  {
    id: 'shellback',
    name: 'Shellback',
    look: { plan: 'crab', length: 0.9, height: 0.45, bulk: 1, neck: 0, headSize: 1, snout: 0, legThickness: 0.03, tail: 0, ears: 'none', horns: 'none', coat: C(0.5, 0.18, 0.1), belly: C(0.78, 0.62, 0.48), accent: C(0.62, 0.22, 0.12), roughness: 0.45 },
    biomes: { [BIOME.Coast]: 1 },
    activity: 'any',
    herd: [1, 3],
    temperament: 'territorial',
    hp: 45,
    walk: 1.1,
    run: 3.8,
    sight: 12,
    hearing: 9,
    attack: { damage: 10, range: 1.5, cooldown: 1.6, windup: 0.45 },
    loot: [
      ['chitin', 1, 2],
      ['raw_meat', 1, 1],
    ],
    weakMultiplier: 3,
    armor: 0.55,
    scale: [0.8, 1.3],
  },
  {
    id: 'frost_ram',
    name: 'Frost Ram',
    look: { plan: 'quadruped', length: 1.3, height: 1.05, bulk: 1.35, neck: 0.55, headSize: 1.1, snout: 0.8, legThickness: 0.04, tail: 0.08, ears: 'small', horns: 'curled', coat: C(0.78, 0.76, 0.72), belly: C(0.62, 0.6, 0.56), accent: C(0.45, 0.4, 0.34), roughness: 0.95 },
    biomes: { [BIOME.Frostveil]: 1, [BIOME.Rim]: 0.25 },
    activity: 'day',
    herd: [2, 4],
    temperament: 'neutral',
    hp: 80,
    walk: 1.3,
    run: 7.5,
    sight: 30,
    hearing: 20,
    attack: { damage: 20, range: 2, cooldown: 2.6, windup: 0.6 },
    loot: [
      ['raw_meat', 3, 3],
      ['pelt', 2, 2],
      ['bone', 1, 1],
    ],
    weakMultiplier: 2,
    armor: 0.85,
    scale: [0.9, 1.15],
  },
  {
    id: 'cinder_beetle',
    name: 'Cinder Beetle',
    look: { plan: 'beetle', length: 1.1, height: 0.55, bulk: 1, neck: 0, headSize: 1, snout: 0, legThickness: 0.03, tail: 0, ears: 'none', horns: 'none', coat: C(0.08, 0.07, 0.07), belly: C(0.2, 0.12, 0.08), accent: C(1.4, 0.45, 0.08), roughness: 0.35 },
    biomes: { [BIOME.Cinderreach]: 1 },
    activity: 'any',
    herd: [1, 2],
    temperament: 'aggressive',
    hp: 55,
    walk: 1.2,
    run: 5.5,
    sight: 18,
    hearing: 14,
    attack: { damage: 13, range: 1.7, cooldown: 1.8, windup: 0.5 },
    loot: [
      ['chitin', 2, 2],
      ['sulfur', 1, 2],
    ],
    weakMultiplier: 3,
    armor: 0.6,
    scale: [0.9, 1.2],
  },
];

export interface Creature {
  id: number;
  species: SpeciesDef;
  rig: CreatureRig;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  scale: number;
  hp: number;
  state: State;
  timer: number;
  target: THREE.Vector3;
  herd: number;
  angryUntil: number;
  attackReady: number;
  pose: PoseState;
  deadTime: number;
  looted: boolean;
  flinch: number;
}

export interface WildlifeHooks {
  player(): { x: number; y: number; z: number; crouching: boolean; sprinting: boolean; noise: number };
  damagePlayer(amount: number, source: string, fromX: number, fromZ: number): void;
  isNight(): boolean;
  cameraFacing(x: number, z: number): boolean;
}

export class Wildlife {
  readonly group = new THREE.Group();
  readonly creatures: Creature[] = [];
  private readonly builder = new CreatureBuilder();
  private nextId = 1;
  private herdCounter = 1;
  private spawnTimer = 2;
  private readonly rng = createRng(0x51de);
  private readonly biomeScratch = new Float32Array(BIOME_COUNT);
  private readonly tmp = new THREE.Vector3();
  cap = 16;

  constructor(
    private readonly world: WorldData,
    private readonly events: EventBus,
    private readonly hooks: WildlifeHooks,
    private readonly treeColliders: (x: number, z: number, r: number) => { x: number; z: number; radius: number }[],
  ) {}

  get materials(): THREE.Material[] {
    return this.builder.materials;
  }

  // ---------------------------------------------------------------------------
  // Spawning

  spawn(species: SpeciesDef, x: number, z: number, herd = 0): Creature {
    const rig = this.builder.build(species.look);
    const scale = species.scale[0] + this.rng() * (species.scale[1] - species.scale[0]);
    rig.mesh.scale.setScalar(scale);
    const c: Creature = {
      id: this.nextId++,
      species,
      rig,
      pos: new THREE.Vector3(x, this.world.groundAt(x, z), z),
      yaw: this.rng() * Math.PI * 2,
      speed: 0,
      scale,
      hp: species.hp * scale,
      state: 'graze',
      timer: 1 + this.rng() * 4,
      target: new THREE.Vector3(x, 0, z),
      herd,
      angryUntil: 0,
      attackReady: 0,
      pose: { phase: this.rng() * 6, gait: 0, graze: 0, lunge: 0, dead: 0, look: 0, time: 0 },
      deadTime: 0,
      looted: false,
      flinch: 0,
    };
    this.group.add(rig.mesh);
    this.creatures.push(c);
    return c;
  }

  private despawn(c: Creature): void {
    this.group.remove(c.rig.mesh);
    c.rig.mesh.geometry.dispose();
    c.rig.mesh.skeleton.dispose();
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
  }

  private trySpawn(px: number, pz: number, time: number): void {
    const alive = this.creatures.filter((c) => c.state !== 'dead').length;
    if (alive >= this.cap) return;
    const night = this.hooks.isNight();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const a = this.rng() * Math.PI * 2;
      const r = 75 + this.rng() * 70;
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      // Never spawn where the player is looking unless far enough away.
      if (this.hooks.cameraFacing(x, z) && r < 120) continue;
      const ground = this.world.heightAt(x, z);
      if (this.world.waterLevelAt(x, z) > ground - 0.2) continue;
      if (this.world.slopeAt(x, z) > 0.45) continue;
      const w = this.world.biomeWeights(x, z, this.biomeScratch);
      let total = 0;
      const options: [SpeciesDef, number][] = [];
      for (const s of SPECIES) {
        if (s.activity === 'night' && !night) continue;
        if (s.activity === 'day' && night) continue;
        let weight = 0;
        for (let b = 0; b < BIOME_COUNT; b += 1) weight += (s.biomes[b] ?? 0) * w[b];
        if (s.id === 'shellback') weight *= this.world.maskAt(x, z, MASK.sand) > 0.3 ? 1 : 0;
        if (s.id === 'duskhound' && night) weight *= 1.8;
        if (weight > 0.02) {
          options.push([s, weight]);
          total += weight;
        }
      }
      if (total <= 0) continue;
      let roll = this.rng() * total;
      let chosen = options[0][0];
      for (const [s, weight] of options) {
        roll -= weight;
        if (roll <= 0) {
          chosen = s;
          break;
        }
      }
      const n = chosen.herd[0] + Math.floor(this.rng() * (chosen.herd[1] - chosen.herd[0] + 1));
      const herd = this.herdCounter++;
      for (let k = 0; k < n && alive + k < this.cap; k += 1) {
        const hx = x + (this.rng() - 0.5) * 8;
        const hz = z + (this.rng() - 0.5) * 8;
        if (this.world.waterLevelAt(hx, hz) > this.world.heightAt(hx, hz) - 0.2) continue;
        this.spawn(chosen, hx, hz, herd);
      }
      void time;
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Queries & damage

  /** Creature under the aim ray (sphere test around the body). */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): { creature: Creature; weak: boolean; distance: number } | null {
    let best: { creature: Creature; weak: boolean; distance: number } | null = null;
    for (const c of this.creatures) {
      const s = c.scale;
      const L = c.species.look.length * s;
      const H = c.species.look.height * s;
      const center = this.tmp.set(c.pos.x, c.pos.y + H * 0.6, c.pos.z);
      const radius = Math.max(0.35, Math.max(L * 0.55, H * 0.5));
      const to = center.clone().sub(origin);
      const along = to.dot(dir);
      if (along < 0 || along > reach + radius) continue;
      const miss = to.clone().addScaledVector(dir, -along).length();
      if (miss > radius + 0.15) continue;
      if (best && along >= best.distance) continue;
      // Weak point: the head / neck end of the body.
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      const head = new THREE.Vector3(c.pos.x + fx * L * 0.55, c.pos.y + H * 0.95, c.pos.z + fz * L * 0.55);
      const hp = head.sub(origin);
      const hAlong = hp.dot(dir);
      const hMiss = hp.addScaledVector(dir, -hAlong).length();
      best = { creature: c, weak: hMiss < Math.max(0.28, H * 0.3), distance: along };
    }
    return best;
  }

  /** Apply a player hit; returns true if the creature died. */
  damage(c: Creature, amount: number, weak: boolean, fromX: number, fromZ: number, now: number): boolean {
    if (c.state === 'dead') return false;
    const dealt = amount * c.species.armor * (weak ? c.species.weakMultiplier : 1);
    c.hp -= dealt;
    c.flinch = 1;
    // Knockback.
    const dx = c.pos.x - fromX;
    const dz = c.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    c.pos.x += (dx / d) * 0.35;
    c.pos.z += (dz / d) * 0.35;
    this.events.emit('hit', { target: c.species.id, material: weak ? 'flesh-weak' : 'flesh', x: c.pos.x, y: c.pos.y + 0.6, z: c.pos.z });
    if (c.hp <= 0) {
      c.state = 'dead';
      c.deadTime = now;
      c.speed = 0;
      this.events.emit('notify', { text: `${c.species.name} down`, icon: 'meat', tone: 'info' });
      this.events.emit('killed', { species: c.species.id });
      this.alarmHerd(c, fromX, fromZ);
      return true;
    }
    const t = c.species.temperament;
    if (t === 'skittish' || (c.hp < c.species.hp * 0.25 && t !== 'territorial')) this.flee(c, fromX, fromZ);
    else {
      c.angryUntil = now + 25;
      c.state = 'chase';
    }
    this.alarmHerd(c, fromX, fromZ);
    return false;
  }

  private flee(c: Creature, fromX: number, fromZ: number): void {
    const dx = c.pos.x - fromX;
    const dz = c.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    c.target.set(c.pos.x + (dx / d) * 45 + (this.rng() - 0.5) * 15, 0, c.pos.z + (dz / d) * 45 + (this.rng() - 0.5) * 15);
    c.state = 'flee';
    c.timer = 5 + this.rng() * 3;
  }

  private alarmHerd(c: Creature, fromX: number, fromZ: number): void {
    for (const o of this.creatures) {
      if (o === c || o.herd !== c.herd || o.state === 'dead') continue;
      if (o.species.temperament === 'skittish') this.flee(o, fromX, fromZ);
      else if (o.species.temperament !== 'territorial') {
        o.angryUntil = Math.max(o.angryUntil, c.angryUntil);
        o.state = 'chase';
      }
    }
  }

  /** Corpse within reach for skinning. */
  corpseNear(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): Creature | null {
    for (const c of this.creatures) {
      if (c.state !== 'dead' || c.looted) continue;
      const to = new THREE.Vector3(c.pos.x, c.pos.y + 0.3, c.pos.z).sub(origin);
      const along = to.dot(dir);
      if (along < 0 || along > reach + 0.8) continue;
      if (to.addScaledVector(dir, -along).length() < 0.9 * c.scale + 0.2) return c;
    }
    return null;
  }

  /** Deterministic loot for a corpse; knives yield more. */
  loot(c: Creature, knife: boolean): [string, number][] {
    const rng = createRng(hashString(`${c.species.id}:${c.id}`));
    c.looted = true;
    const out: [string, number][] = [];
    for (const [item, min, max] of c.species.loot) {
      let n = min + Math.floor(rng() * (max - min + 1));
      if (knife) n += item === 'raw_meat' || item === 'hide' || item === 'pelt' ? 1 : 0;
      if (n > 0) out.push([item, n]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Simulation

  update(dt: number, now: number, camera: THREE.Camera): void {
    const p = this.hooks.player();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      this.trySpawn(p.x, p.z, now);
    }
    const night = this.hooks.isNight();
    for (let i = this.creatures.length - 1; i >= 0; i -= 1) {
      const c = this.creatures[i];
      const dx = p.x - c.pos.x;
      const dz = p.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 230 || (c.state === 'dead' && (c.looted ? now - c.deadTime > 2 : now - c.deadTime > 240))) {
        this.despawn(c);
        continue;
      }
      if (dist > 160 && c.state !== 'dead') {
        // Far away: freeze the simulation, keep the pose cheap.
        c.rig.mesh.visible = dist < 200;
        continue;
      }
      c.rig.mesh.visible = true;
      this.think(c, dt, now, p, dist, night);
      this.move(c, dt, p.x, p.z);
      this.animate(c, dt, now);
    }
    void camera;
  }

  private think(c: Creature, dt: number, now: number, p: ReturnType<WildlifeHooks['player']>, dist: number, night: boolean): void {
    const s = c.species;
    if (c.state === 'dead') return;
    c.timer -= dt;
    c.flinch = Math.max(0, c.flinch - dt * 3);
    // Perception: sight cone in front, hearing all round.
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    const facing = dist > 0 ? ((p.x - c.pos.x) * fx + (p.z - c.pos.z) * fz) / dist : 1;
    const stealth = p.crouching ? 0.5 : p.sprinting ? 1.45 : 1;
    const heard = dist < s.hearing * stealth * (0.6 + p.noise * 0.4);
    const seen = dist < s.sight * (p.crouching ? 0.7 : 1) && facing > -0.2;
    const noticed = heard || seen;
    const aggressive = s.temperament === 'aggressive' && (!s.nightAggro || night) || now < c.angryUntil;
    const territorial = s.temperament === 'territorial' && dist < 5.5;
    const crowded = s.temperament === 'neutral' && dist < 4 && !p.crouching;

    switch (c.state) {
      case 'graze':
      case 'wander': {
        if (noticed || crowded || territorial) {
          if (aggressive || territorial || crowded) {
            if (crowded || territorial) c.angryUntil = now + 15;
            c.state = 'alert';
            c.timer = s.temperament === 'aggressive' ? 0.3 : 0.9;
          } else if (s.temperament === 'skittish' || s.temperament === 'neutral') {
            c.state = 'alert';
            c.timer = s.temperament === 'skittish' ? 0.35 + this.rng() * 0.4 : 1.2;
          }
          break;
        }
        if (c.timer <= 0) {
          if (c.state === 'graze') {
            c.state = 'wander';
            const a = this.rng() * Math.PI * 2;
            const r = 6 + this.rng() * 18;
            c.target.set(c.pos.x + Math.cos(a) * r, 0, c.pos.z + Math.sin(a) * r);
            c.timer = 8 + this.rng() * 6;
          } else {
            c.state = 'graze';
            c.timer = 3 + this.rng() * 8;
          }
        }
        break;
      }
      case 'alert': {
        if (c.timer <= 0) {
          if (aggressive || now < c.angryUntil) c.state = 'chase';
          else if (noticed || dist < 12) {
            this.flee(c, p.x, p.z);
            this.alarmHerd(c, p.x, p.z);
          } else {
            c.state = 'graze';
            c.timer = 2 + this.rng() * 3;
          }
        }
        break;
      }
      case 'flee': {
        if (c.timer <= 0) {
          c.state = dist > 40 ? 'graze' : 'flee';
          if (c.state === 'flee') this.flee(c, p.x, p.z);
          else c.timer = 3;
        }
        break;
      }
      case 'chase': {
        if (!s.attack || (!aggressive && now >= c.angryUntil) || dist > 70) {
          c.state = 'wander';
          c.timer = 5;
          c.target.set(c.pos.x - (p.x - c.pos.x), 0, c.pos.z - (p.z - c.pos.z));
          break;
        }
        c.target.set(p.x, 0, p.z);
        if (dist < s.attack.range && now >= c.attackReady) {
          c.state = 'windup';
          c.timer = s.attack.windup;
          this.events.emit('hit', { target: s.id, material: 'growl', x: c.pos.x, y: c.pos.y, z: c.pos.z });
        }
        if (c.hp < s.hp * 0.2 && s.temperament !== 'territorial') this.flee(c, p.x, p.z);
        break;
      }
      case 'windup': {
        if (c.timer <= 0 && s.attack) {
          // Strike lands only if the player is still in reach and in front.
          if (dist < s.attack.range + 0.6 && (facing > 0.2 || dist < 1.2)) this.hooks.damagePlayer(s.attack.damage, s.name, c.pos.x, c.pos.z);
          c.attackReady = now + s.attack.cooldown;
          c.state = 'recover';
          c.timer = 0.5;
        }
        break;
      }
      case 'recover':
        if (c.timer <= 0) c.state = 'chase';
        break;
    }
  }

  private move(c: Creature, dt: number, px = 0, pz = 0): void {
    const s = c.species;
    let desired = 0;
    if (c.state === 'wander') desired = s.walk;
    else if (c.state === 'flee') desired = s.run;
    else if (c.state === 'chase') desired = s.run * 0.92;
    else if (c.state === 'windup') desired = 0.3;
    if (c.state === 'dead') desired = 0;
    const tx = c.target.x - c.pos.x;
    const tz = c.target.z - c.pos.z;
    const td = Math.hypot(tx, tz);
    if (td < 1.2 && c.state === 'wander') {
      c.state = 'graze';
      c.timer = 3 + this.rng() * 6;
      desired = 0;
    }
    // Predators close to striking distance, then hold and face their prey.
    const toPlayer = Math.hypot(px - c.pos.x, pz - c.pos.z);
    const engaged = (c.state === 'chase' || c.state === 'windup' || c.state === 'recover') && s.attack;
    if (engaged && s.attack && toPlayer < s.attack.range * 0.75) desired = 0;
    if ((desired > 0 || engaged) && td > 0.1) {
      const want = Math.atan2(-tx, -tz);
      let delta = want - c.yaw;
      delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const turnRate = c.state === 'flee' || c.state === 'chase' ? 4.5 : 2;
      c.yaw += clamp(delta, -turnRate * dt, turnRate * dt);
      // Slow down while turning hard.
      desired *= 1 - Math.min(0.7, Math.abs(delta) / Math.PI);
    }
    c.speed = damp(c.speed, desired * (1 - c.flinch * 0.6), c.state === 'flee' ? 5 : 3, dt);
    if (c.speed < 0.02) return;
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    let nx = c.pos.x + fx * c.speed * dt;
    let nz = c.pos.z + fz * c.speed * dt;
    // Keep out of deep water and off cliffs: turn away instead.
    const ground = this.world.groundAt(nx, nz);
    const water = this.world.waterLevelAt(nx, nz);
    if (water > ground + 0.35 || this.world.slopeAt(nx, nz) > 0.62) {
      c.yaw += Math.PI * (0.5 + this.rng() * 0.5);
      c.speed *= 0.3;
      return;
    }
    // Slip around tree trunks.
    for (const t of this.treeColliders(nx, nz, 1.5)) {
      const ox = nx - t.x;
      const oz = nz - t.z;
      const d = Math.hypot(ox, oz);
      const min = t.radius + 0.35 * c.scale;
      if (d < min && d > 1e-4) {
        nx = t.x + (ox / d) * min;
        nz = t.z + (oz / d) * min;
      }
    }
    // Bodies don't overlap the survivor.
    const ox = nx - px;
    const oz = nz - pz;
    const od = Math.hypot(ox, oz);
    const minD = 0.55 + s.look.length * c.scale * 0.35;
    if (od < minD && od > 1e-4) {
      nx = px + (ox / od) * minD;
      nz = pz + (oz / od) * minD;
    }
    c.pos.set(nx, this.world.groundAt(nx, nz), nz);
  }

  private animate(c: Creature, dt: number, now: number): void {
    const s = c.species;
    const pose = c.pose;
    pose.time = now;
    const gaitTarget = clamp(c.speed / s.run, 0, 1);
    pose.gait = damp(pose.gait, gaitTarget, 6, dt);
    const stride = (s.look.length * c.scale) * (0.9 + pose.gait * 1.4);
    pose.phase += (c.speed / Math.max(0.1, stride)) * Math.PI * dt;
    pose.graze = damp(pose.graze, c.state === 'graze' && s.look.plan === 'quadruped' && s.temperament !== 'aggressive' ? 1 : 0, 2.5, dt);
    pose.lunge = damp(pose.lunge, c.state === 'windup' ? 1 : c.state === 'recover' ? 0.3 : 0, 10, dt);
    pose.dead = c.state === 'dead' ? Math.min(1, pose.dead + dt * 1.6) : 0;
    pose.look = damp(pose.look, c.state === 'alert' ? 0.4 * Math.sin(now * 0.8) : 0, 3, dt);
    poseCreature(c.rig, pose);
    const mesh = c.rig.mesh;
    mesh.position.copy(c.pos);
    // Align to the slope a little.
    const e = 0.6 * c.scale;
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    const hf = this.world.groundAt(c.pos.x + fx * e, c.pos.z + fz * e);
    const hb = this.world.groundAt(c.pos.x - fx * e, c.pos.z - fz * e);
    const pitch = Math.atan2(hb - hf, e * 2);
    mesh.rotation.set(-pitch * 0.8, c.yaw, 0, 'YXZ');
    if (c.state === 'dead') mesh.position.y -= smoothstep(1, 3, (now - c.deadTime) * 0.02) * 0.1;
  }

  serialize(): unknown {
    return null;
  }
}
