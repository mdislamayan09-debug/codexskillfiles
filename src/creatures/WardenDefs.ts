import * as THREE from 'three';
import { clamp } from '../core/math';
import { generateRock } from '../world/props/RockGenerator';
import { BONE, type CreatureLook } from './CreatureModel';

// The five Wardens, one per Bellstone. Each shares the same fight grammar
// (charge, stomp shockwave, close sweep, eruptions from the ground past half
// strength; knots on the forelegs and a knot at the heart) but has its own
// body, element, voice and story. Bodies come from the creature builder;
// everything that makes them unique is "dressing" built here.

export type StrikeKind = 'roots' | 'geyser' | 'ice' | 'lava' | 'mud';

export interface Dresser {
  L: number;
  H: number;
  hipY: number;
  bodyR: number;
  legLen: number;
  lt: number;
  rng: () => number;
  /** Rest-pose world position of each bone. */
  rest: THREE.Vector3[];
  /** Height of the top of the back at model-space z. */
  backY(z: number): number;
  /** Decorative part (vertex coloured), merged per bone. */
  put(bone: number, g: THREE.BufferGeometry, world: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3): void;
  /** Glowing part (the Warden's glow material), merged per bone. */
  glow(bone: number, g: THREE.BufferGeometry, world: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3): void;
  /** Revealed in three waves as the Warden calms (stage 0..2). */
  calm(bone: number, g: THREE.BufferGeometry, world: THREE.Vector3, stage: number): void;
}

export interface WardenDef {
  id: string;
  name: string;
  title: string;
  bell: string;
  flag: string;
  /** Where it sleeps relative to its Bellstone, and the heading it faces. */
  bed: [number, number];
  bedYaw: number;
  hp: number;
  look: CreatureLook;
  /** Roar pitch (1 = Mossback). */
  voice: number;
  walk: number;
  /** Charge speed in phase one and two. */
  charge: [number, number];
  damage: { charge: number; stomp: number; sweep: number; strike: number };
  element: { kind: StrikeKind; wave: number; dust: number; decal: number };
  glow: { color: number; emissive: number; intensity: number; calmIntensity: number };
  /** Glow of the decorations that appear as it calms (flowers, pearls, fireflies). */
  calmEmissive: number;
  eye: number;
  eyeCalm: number;
  lines: { wake: string; phase2: string; calm: string };
  /** What the grove gives when the Bellstone rings. */
  trophy: string;
  dress(d: Dresser): void;
}

// ---------------------------------------------------------------------------
// Geometry helpers

/** Vertex colours for merged decorative parts; strips every other attribute. */
export function paint(g: THREE.BufferGeometry, color: (i: number, x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
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

/** A flat colour with a little per-vertex variation. */
export function solid(color: THREE.Color, jitter = 0.08): (i: number) => THREE.Color {
  return (i: number) => {
    const n = Math.sin(i * 7.31) * 0.5 + 0.5;
    return color.clone().multiplyScalar(1 - jitter + n * jitter * 2);
  };
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** A lumpy cap (upper part of an ellipsoid): moss, fleece, shell or warty hide. */
export function mantle(rx: number, ry: number, rz: number, rng: () => number, dark: THREE.Color, light: THREE.Color, fleck: THREE.Color, opts: { lumps?: number; lumpHeight?: number; tufts?: number; cap?: number; fleckRate?: number } = {}): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 30, 16, 0, Math.PI * 2, 0, Math.PI * (opts.cap ?? 0.6));
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const blobs = Array.from({ length: opts.lumps ?? 26 }, () => {
    const a = rng() * Math.PI * 2;
    const b = rng() * 1.8;
    return { x: Math.sin(b) * Math.cos(a), y: Math.cos(b), z: Math.sin(b) * Math.sin(a), h: (0.06 + rng() * 0.16) * (opts.lumpHeight ?? 1), w: 0.04 + rng() * 0.1 };
  });
  const lump = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let h = 0;
    for (const b of blobs) h += b.h * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2 + (z - b.z) ** 2) / b.w);
    h += (opts.tufts ?? 0.025) * Math.sin(x * 23 + z * 17) * Math.sin(y * 19 - x * 11);
    lump[i] = h;
    const s = 1 + h;
    pos.setXYZ(i, x * s * rx, y * s * ry, z * s * rz);
  }
  g.computeVertexNormals();
  const c = new THREE.Color();
  const index = g.index as THREE.BufferAttribute;
  const rate = opts.fleckRate ?? 0.07;
  return paint(g, (i) => {
    const src = index.getX(i);
    c.copy(dark).lerp(light, clamp(lump[src] * 3.2 + 0.2, 0, 1));
    const speck = Math.sin(src * 12.9898) * 43758.5453;
    if (speck - Math.floor(speck) > 1 - rate) c.lerp(fleck, 0.7);
    return c;
  });
}

function cone(radius: number, length: number, sides = 5, down = false): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, length, sides);
  if (down) {
    g.rotateX(Math.PI);
    g.translate(0, -length / 2, 0);
  } else g.translate(0, length / 2, 0);
  return g;
}

/** Five knots of shards (crystals, plates): an octahedron cluster. */
function cluster(rng: () => number, size: number, count = 4, stretch = 1.9): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const g = new THREE.OctahedronGeometry(size * (0.6 + rng() * 0.5), 0);
    g.scale(0.8, stretch, 0.8);
    g.rotateX((rng() - 0.5) * 1.1);
    g.rotateZ((rng() - 0.5) * 1.1);
    g.translate((rng() - 0.5) * size, size * stretch * 0.4, (rng() - 0.5) * size);
    out.push(g);
  }
  return out;
}

/** Scatter points over the back between z0 and z1. */
function backPoint(d: Dresser, z0: number, z1: number, spread = 1.1): { bone: number; p: THREE.Vector3 } {
  const z = z0 + d.rng() * (z1 - z0);
  const x = (d.rng() - 0.5) * d.bodyR * spread;
  return { bone: z < -d.L * 0.05 ? BONE.chest : BONE.spine, p: new THREE.Vector3(x, d.backY(z) - 0.12, z) };
}

/** Standard bloom: small flowers in three waves across the back. */
function flowers(d: Dresser, palette: THREE.Color[], count = 60, size = 0.07): void {
  for (let i = 0; i < count; i += 1) {
    const { bone, p } = backPoint(d, -d.L * 0.42, d.L * 0.36, 1.7);
    const petal = new THREE.IcosahedronGeometry(size + d.rng() * size * 0.7, 0);
    petal.scale(1, 0.45, 1);
    d.calm(bone, paint(petal, solid(palette[i % palette.length], 0.05)), p.add(new THREE.Vector3(0, 0.17, 0)), i % 3);
  }
}

/** A beard of hanging strands under the neck and chest. */
function beard(d: Dresser, color: THREE.Color, count: number, thickness: number, length: number): void {
  const { L, bodyR, hipY, rng } = d;
  for (let i = 0; i < count; i += 1) {
    const len = length * (0.45 + rng() * 0.8);
    const strand = cone(thickness * (0.7 + rng() * 0.6), len, 4, true);
    const onNeck = i < count * 0.45;
    const world = onNeck
      ? new THREE.Vector3((rng() - 0.5) * bodyR * 0.8, hipY + bodyR * 0.25, -L * 0.48 - rng() * 0.5)
      : new THREE.Vector3((rng() - 0.5) * bodyR * 1.4, hipY - bodyR * 0.55, -L * 0.1 - rng() * L * 0.3);
    d.put(onNeck ? BONE.neck : BONE.chest, paint(strand, solid(color, 0.25)), world, new THREE.Euler((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3));
  }
}

// ---------------------------------------------------------------------------
// The five

const MOSSBACK: WardenDef = {
  id: 'mossback',
  name: 'Mossback',
  title: 'Warden of Hollowpine',
  bell: 'bell_hollowpine',
  flag: 'warden_hollowpine',
  bed: [15, 5],
  bedYaw: -Math.PI / 2,
  hp: 900,
  look: { plan: 'quadruped', length: 8.4, height: 6.0, bulk: 1.35, neck: 0.72, headSize: 1.08, snout: 1.0, legThickness: 0.36, tail: 0.1, ears: 'small', horns: 'antlers', coat: C(0.14, 0.2, 0.08), belly: C(0.2, 0.16, 0.12), accent: C(0.6, 0.56, 0.46), roughness: 0.95 },
  voice: 1,
  walk: 2.8,
  charge: [13.5, 15.5],
  damage: { charge: 32, stomp: 18, sweep: 24, strike: 16 },
  element: { kind: 'roots', wave: 0x8c805f, dust: 0x6b614c, decal: 0x59f28c },
  glow: { color: 0x1a1206, emissive: 0xffb45a, intensity: 0.8, calmIntensity: 0.3 },
  calmEmissive: 0xfff2d8,
  eye: 0xffa53a,
  eyeCalm: 0x9fe8b0,
  lines: {
    wake: 'The hillside breathes. Moss splits, and something vast rises out of the grove.',
    phase2: 'Roots stir under the grove. Mossback’s moss darkens and bristles.',
    calm: 'Mossback kneels. The grove falls quiet.',
  },
  trophy: 'warden_antler',
  dress(d) {
    const { L, bodyR, hipY, rng } = d;
    d.put(BONE.spine, mantle(bodyR * 1.1, bodyR * 0.78, L * 0.36, rng, C(0.13, 0.2, 0.07), C(0.38, 0.48, 0.15), C(0.55, 0.56, 0.42)), new THREE.Vector3(0, hipY + bodyR * 0.32, L * 0.1));
    d.put(BONE.chest, mantle(bodyR * 1.16, bodyR * 0.85, L * 0.3, rng, C(0.13, 0.2, 0.07), C(0.38, 0.48, 0.15), C(0.55, 0.56, 0.42)), new THREE.Vector3(0, hipY + bodyR * 0.42, -L * 0.22));
    d.put(BONE.neck, mantle(bodyR * 0.62, bodyR * 0.5, bodyR * 0.8, rng, C(0.13, 0.2, 0.07), C(0.38, 0.48, 0.15), C(0.55, 0.56, 0.42)), new THREE.Vector3(0, hipY + bodyR * 0.95, -L * 0.47), new THREE.Euler(-0.5, 0, 0));
    // Saplings and ferns rooted in the moss.
    const bark = C(0.27, 0.21, 0.15);
    const leaf = [C(0.2, 0.33, 0.1), C(0.28, 0.4, 0.12), C(0.35, 0.36, 0.1)];
    for (let i = 0; i < 5; i += 1) {
      const z = -L * 0.3 + i * L * 0.13 + (rng() - 0.5) * 0.4;
      const bone = z < -L * 0.05 ? BONE.chest : BONE.spine;
      const h = 1.5 + rng() * 1.7;
      const base = new THREE.Vector3((rng() - 0.5) * bodyR * 1.1, d.backY(z) - 0.15, z);
      const lean = new THREE.Euler((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.5);
      d.put(bone, paint(cone(0.07, h, 5), solid(bark)), base, lean, new THREE.Vector3(0.6, 1, 0.6));
      for (let k = 0; k < 3; k += 1) {
        const crown = new THREE.IcosahedronGeometry(0.45 + rng() * 0.32, 0);
        crown.translate((rng() - 0.5) * 0.4, h * (0.7 + k * 0.14), (rng() - 0.5) * 0.4);
        d.put(bone, paint(crown, solid(leaf[(i + k) % 3], 0.15)), base.clone(), lean, new THREE.Vector3(1, 0.8, 1));
      }
    }
    for (let i = 0; i < 9; i += 1) {
      const { bone, p } = backPoint(d, -L * 0.4, L * 0.32, 1.5);
      for (let f = 0; f < 5; f += 1) {
        const frond = new THREE.PlaneGeometry(0.22, 0.95, 1, 3);
        const fp = frond.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < fp.count; v += 1) {
          const y = fp.getY(v) + 0.475;
          fp.setY(v, y);
          fp.setZ(v, -y * y * 0.35);
          fp.setX(v, fp.getX(v) * (1 - y * 0.8));
        }
        d.put(bone, paint(frond, solid(leaf[f % 3], 0.2)), p.clone(), new THREE.Euler(-0.5, (f / 5) * Math.PI * 2 + rng(), 0, 'YXZ'));
      }
    }
    for (let i = 0; i < 3; i += 1) {
      const rock = generateRock({ seed: 9100 + i, kind: 'boulder', detail: 1 }).geometry.clone();
      const z = -L * 0.15 + i * L * 0.16;
      d.put(i === 0 ? BONE.chest : BONE.spine, paint(rock, solid(C(0.42, 0.41, 0.38), 0.12)), new THREE.Vector3((rng() - 0.5) * bodyR, d.backY(z) - 0.1, z), undefined, new THREE.Vector3(0.45, 0.35, 0.45));
    }
    // Bracket fungus glowing faintly at dusk.
    for (let i = 0; i < 6; i += 1) {
      const { bone, p } = backPoint(d, -L * 0.3, L * 0.3, 2.1);
      const shelf = new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      shelf.scale(1, 0.35, 1);
      d.glow(bone, shelf, p.add(new THREE.Vector3(0, -0.35, 0)));
    }
    beard(d, C(0.2, 0.26, 0.12), 34, 0.05, 0.8);
    flowers(d, [C(0.95, 0.93, 0.86), C(0.95, 0.7, 0.78), C(0.98, 0.86, 0.45)]);
  },
};

const TIDEMOTHER: WardenDef = {
  id: 'tidemother',
  name: 'Tidemother',
  title: 'Warden of the Drowned Bell',
  bell: 'bell_coast',
  flag: 'warden_coast',
  bed: [-15, 4],
  bedYaw: Math.PI / 2,
  hp: 1050,
  look: { plan: 'quadruped', length: 9, height: 4.2, bulk: 1.75, neck: 0.55, headSize: 1.3, snout: 0.5, legThickness: 0.48, tail: 0.18, ears: 'none', horns: 'none', coat: C(0.16, 0.23, 0.25), belly: C(0.55, 0.52, 0.42), accent: C(0.3, 0.3, 0.28), roughness: 0.7 },
  voice: 0.72,
  walk: 2.4,
  charge: [12, 14],
  damage: { charge: 34, stomp: 20, sweep: 26, strike: 18 },
  element: { kind: 'geyser', wave: 0x8fd8e6, dust: 0x5fa8bf, decal: 0x4fd6ff },
  glow: { color: 0x06201f, emissive: 0x3ff0d8, intensity: 1.2, calmIntensity: 2.2 },
  calmEmissive: 0xffd8e8,
  eye: 0x7ff6ff,
  eyeCalm: 0xfff0d0,
  lines: {
    wake: 'The tide pulls back all at once. The beach rises, and the rise has eyes.',
    phase2: 'The sea answers her. Water gathers under the sand.',
    calm: 'Tidemother settles into the shallows. The surf goes gentle.',
  },
  trophy: 'tide_pearl',
  dress(d) {
    const { L, bodyR, hipY, rng } = d;
    // A domed shell, much wider than the body, crusted with barnacles.
    const shell = mantle(bodyR * 2.1, bodyR * 1.05, L * 0.42, rng, C(0.1, 0.14, 0.15), C(0.3, 0.34, 0.31), C(0.78, 0.76, 0.68), { lumps: 40, lumpHeight: 0.6, fleckRate: 0.16, cap: 0.55 });
    d.put(BONE.spine, shell, new THREE.Vector3(0, hipY + bodyR * 0.1, -L * 0.04));
    // Scute ridges down the middle.
    for (let i = 0; i < 6; i += 1) {
      const z = -L * 0.3 + i * L * 0.11;
      const scute = new THREE.OctahedronGeometry(0.42, 0);
      scute.scale(1.2, 0.45, 1.4);
      d.put(z < -L * 0.05 ? BONE.chest : BONE.spine, paint(scute, solid(C(0.2, 0.25, 0.24), 0.1)), new THREE.Vector3(0, d.backY(z) + 0.18, z));
    }
    // Barnacle clusters.
    for (let i = 0; i < 34; i += 1) {
      const { bone, p } = backPoint(d, -L * 0.4, L * 0.36, 3.6);
      const b = new THREE.CylinderGeometry(0.05 + rng() * 0.05, 0.1 + rng() * 0.06, 0.12 + rng() * 0.1, 6);
      d.put(bone, paint(b, solid(C(0.82, 0.8, 0.72), 0.12)), p.add(new THREE.Vector3(0, 0.08, 0)), new THREE.Euler((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6));
    }
    // Kelp trailing from the shell rim.
    for (let i = 0; i < 26; i += 1) {
      const a = rng() * Math.PI * 2;
      const world = new THREE.Vector3(Math.cos(a) * bodyR * 1.9, hipY - bodyR * 0.2, -L * 0.04 + Math.sin(a) * L * 0.38);
      d.put(BONE.spine, paint(cone(0.05, 0.8 + rng() * 1.2, 4, true), solid(C(0.2, 0.22, 0.08), 0.25)), world, new THREE.Euler((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4));
    }
    // Bioluminescent spots along the shell's edge.
    for (let i = 0; i < 18; i += 1) {
      const a = (i / 18) * Math.PI * 2;
      const spot = new THREE.SphereGeometry(0.09, 6, 4);
      d.glow(BONE.spine, spot, new THREE.Vector3(Math.cos(a) * bodyR * 1.95, hipY + bodyR * 0.05, -L * 0.04 + Math.sin(a) * L * 0.39));
    }
    // Calm: anemones and pearls open across the shell.
    flowers(d, [C(0.98, 0.72, 0.8), C(0.95, 0.95, 0.9), C(0.6, 0.9, 0.85)], 50, 0.09);
  },
};

const EMBERJAW: WardenDef = {
  id: 'emberjaw',
  name: 'Emberjaw',
  title: 'Warden of the Caldera Forge',
  bell: 'bell_cinder',
  flag: 'warden_cinder',
  bed: [14, 10],
  bedYaw: Math.PI,
  hp: 1150,
  look: { plan: 'quadruped', length: 7.6, height: 5.2, bulk: 1.55, neck: 0.45, headSize: 1.3, snout: 1.2, legThickness: 0.38, tail: 0.15, ears: 'small', horns: 'tusks', coat: C(0.09, 0.08, 0.08), belly: C(0.22, 0.11, 0.07), accent: C(0.85, 0.8, 0.7), roughness: 0.6 },
  voice: 1.12,
  walk: 3.1,
  charge: [15, 17],
  damage: { charge: 36, stomp: 22, sweep: 26, strike: 20 },
  element: { kind: 'lava', wave: 0xff7a2a, dust: 0x3a2a24, decal: 0xff5a1a },
  glow: { color: 0x2a0800, emissive: 0xff5a10, intensity: 3.2, calmIntensity: 0.5 },
  calmEmissive: 0xffe8c8,
  eye: 0xffd24a,
  eyeCalm: 0xffb07a,
  lines: {
    wake: 'The forge floor splits and glows. A shape of black glass heaves itself up, dripping fire.',
    phase2: 'The caldera groans. Heat builds under your feet.',
    calm: 'Emberjaw lies down among the anvils. The fire in it banks to a warm glow.',
  },
  trophy: 'ember_core',
  dress(d) {
    const { L, bodyR, hipY, rng } = d;
    const basalt = C(0.1, 0.09, 0.09);
    d.put(BONE.spine, mantle(bodyR * 1.05, bodyR * 0.7, L * 0.34, rng, C(0.05, 0.045, 0.045), C(0.16, 0.13, 0.12), C(0.3, 0.14, 0.08), { tufts: 0.01, lumpHeight: 0.5 }), new THREE.Vector3(0, hipY + bodyR * 0.3, L * 0.1));
    d.put(BONE.chest, mantle(bodyR * 1.12, bodyR * 0.8, L * 0.3, rng, C(0.05, 0.045, 0.045), C(0.16, 0.13, 0.12), C(0.3, 0.14, 0.08), { tufts: 0.01, lumpHeight: 0.5 }), new THREE.Vector3(0, hipY + bodyR * 0.42, -L * 0.22));
    // Obsidian plates along the spine, lava glowing in the cracks between.
    for (let i = 0; i < 9; i += 1) {
      const z = -L * 0.42 + i * L * 0.095;
      const bone = z < -L * 0.05 ? BONE.chest : BONE.spine;
      for (const side of [-1, 1]) {
        const plate = new THREE.OctahedronGeometry(0.5 + rng() * 0.2, 0);
        plate.scale(0.5, 1.3, 1);
        d.put(bone, paint(plate, solid(basalt, 0.2)), new THREE.Vector3(side * bodyR * 0.35, d.backY(z) + 0.25, z), new THREE.Euler(0, 0, side * 0.5));
      }
      const crack = new THREE.BoxGeometry(bodyR * 0.3, 0.12, 0.1);
      d.glow(bone, crack, new THREE.Vector3(0, d.backY(z) + 0.02, z + L * 0.045));
    }
    // Smouldering vents on the shoulders and haunches.
    for (const [x, z] of [
      [-0.8, -0.28],
      [0.8, -0.28],
      [-0.75, 0.22],
      [0.75, 0.22],
    ]) {
      const vent = new THREE.SphereGeometry(0.2, 8, 6);
      d.glow(z < 0 ? BONE.chest : BONE.spine, vent, new THREE.Vector3(x * bodyR, d.backY(z * L) - 0.25, z * L));
    }
    // A bristling mane of black spines.
    for (let i = 0; i < 30; i += 1) {
      const z = -L * 0.5 + rng() * L * 0.35;
      d.put(z < -L * 0.4 ? BONE.neck : BONE.chest, paint(cone(0.05, 0.5 + rng() * 0.5, 4), solid(C(0.06, 0.05, 0.05), 0.2)), new THREE.Vector3((rng() - 0.5) * bodyR * 0.5, d.backY(z) + 0.1, z), new THREE.Euler(0.6 + rng() * 0.4, 0, (rng() - 0.5) * 0.6));
    }
    // Calm: ash lilies open in the cooled cracks.
    flowers(d, [C(0.95, 0.93, 0.9), C(0.9, 0.85, 0.8), C(1, 0.72, 0.5)], 44, 0.08);
  },
};

const RIMEBROW: WardenDef = {
  id: 'rimebrow',
  name: 'Rimebrow',
  title: 'Warden of Frostglass',
  bell: 'bell_frost',
  flag: 'warden_frost',
  bed: [12, 14],
  bedYaw: Math.PI,
  hp: 1100,
  look: { plan: 'quadruped', length: 7, height: 5.8, bulk: 1.28, neck: 0.66, headSize: 1.1, snout: 0.85, legThickness: 0.3, tail: 0.08, ears: 'pointed', horns: 'curled', coat: C(0.72, 0.74, 0.78), belly: C(0.6, 0.62, 0.68), accent: C(0.7, 0.84, 0.95), roughness: 0.9 },
  voice: 1.32,
  walk: 3.2,
  charge: [15.5, 17.5],
  damage: { charge: 34, stomp: 20, sweep: 28, strike: 18 },
  element: { kind: 'ice', wave: 0xbfe8ff, dust: 0xd8ecf5, decal: 0x8fdcff },
  glow: { color: 0x2a4a5a, emissive: 0x7fd8ff, intensity: 1.4, calmIntensity: 0.6 },
  calmEmissive: 0xfff6e0,
  eye: 0x9ff0ff,
  eyeCalm: 0xffe8b0,
  lines: {
    wake: 'The ice sings. A ram of frost and crystal climbs out of the lake, horns first.',
    phase2: 'Cold pours off it in waves. The ground cracks white.',
    calm: 'Rimebrow bows its great horns. The lake stops singing.',
  },
  trophy: 'rime_horn',
  dress(d) {
    const { L, bodyR, hipY, rng } = d;
    const fleece = [C(0.6, 0.63, 0.68), C(0.93, 0.95, 0.97), C(0.72, 0.86, 1.0)] as const;
    d.put(BONE.spine, mantle(bodyR * 1.18, bodyR * 0.9, L * 0.38, rng, fleece[0], fleece[1], fleece[2], { lumps: 60, lumpHeight: 0.8, tufts: 0.05 }), new THREE.Vector3(0, hipY + bodyR * 0.25, L * 0.1));
    d.put(BONE.chest, mantle(bodyR * 1.24, bodyR * 0.95, L * 0.32, rng, fleece[0], fleece[1], fleece[2], { lumps: 60, lumpHeight: 0.8, tufts: 0.05 }), new THREE.Vector3(0, hipY + bodyR * 0.35, -L * 0.22));
    d.put(BONE.neck, mantle(bodyR * 0.7, bodyR * 0.6, bodyR * 0.9, rng, fleece[0], fleece[1], fleece[2], { lumps: 30, tufts: 0.05 }), new THREE.Vector3(0, hipY + bodyR * 0.9, -L * 0.47), new THREE.Euler(-0.5, 0, 0));
    // Ice crystals growing out of the fleece.
    for (let i = 0; i < 9; i += 1) {
      const { bone, p } = backPoint(d, -L * 0.38, L * 0.32, 1.4);
      const lean = new THREE.Euler((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7);
      for (const shard of cluster(rng, 0.22 + rng() * 0.18, 3 + Math.floor(rng() * 3), 2.4)) d.glow(bone, shard, p.clone(), lean);
    }
    // Icicles hanging from the belly and throat.
    beard(d, C(0.78, 0.88, 0.96), 30, 0.05, 0.7);
    // Calm: snowdrops, and the crystals warm to gold.
    flowers(d, [C(0.98, 0.98, 0.95), C(0.85, 0.95, 0.8), C(1, 0.94, 0.7)], 50, 0.07);
  },
};

const OLD_CROAK: WardenDef = {
  id: 'oldcroak',
  name: 'Old Croak',
  title: 'Warden of the Choir Mire',
  bell: 'bell_fen',
  flag: 'warden_fen',
  bed: [-13, -10],
  bedYaw: -Math.PI / 2,
  hp: 1200,
  look: { plan: 'quadruped', length: 6.8, height: 4, bulk: 2.05, neck: 0.28, headSize: 1.7, snout: 0.42, legThickness: 0.44, tail: 0, ears: 'none', horns: 'none', coat: C(0.2, 0.25, 0.13), belly: C(0.62, 0.58, 0.4), accent: C(0.38, 0.33, 0.2), roughness: 0.55 },
  voice: 0.84,
  walk: 2.6,
  charge: [14, 16.5],
  damage: { charge: 32, stomp: 22, sweep: 26, strike: 20 },
  element: { kind: 'mud', wave: 0x9a9060, dust: 0x4a4230, decal: 0xc8e04a },
  glow: { color: 0x1a2004, emissive: 0xd8f04a, intensity: 1.6, calmIntensity: 1.0 },
  calmEmissive: 0xffe066,
  eye: 0xf0e04a,
  eyeCalm: 0xbff0a0,
  lines: {
    wake: 'Every little bell in the mire rings at once. The reeds stand up. They are growing out of something.',
    phase2: 'The mire bubbles and heaves. Mud rises in columns.',
    calm: 'Old Croak sinks into the reeds with a long, low hum. The little bells go quiet one by one.',
  },
  trophy: 'choir_bell',
  dress(d) {
    const { L, bodyR, hipY, H, rng } = d;
    const bog = [C(0.12, 0.16, 0.07), C(0.34, 0.38, 0.15), C(0.62, 0.55, 0.22)] as const;
    d.put(BONE.spine, mantle(bodyR * 1.1, bodyR * 0.72, L * 0.36, rng, bog[0], bog[1], bog[2], { lumps: 70, lumpHeight: 0.45, fleckRate: 0.12 }), new THREE.Vector3(0, hipY + bodyR * 0.28, L * 0.08));
    d.put(BONE.chest, mantle(bodyR * 1.15, bodyR * 0.8, L * 0.3, rng, bog[0], bog[1], bog[2], { lumps: 70, lumpHeight: 0.45, fleckRate: 0.12 }), new THREE.Vector3(0, hipY + bodyR * 0.38, -L * 0.22));
    // Reeds and bulrushes growing from its back.
    for (let i = 0; i < 40; i += 1) {
      const { bone, p } = backPoint(d, -L * 0.36, L * 0.34, 1.3);
      const h = 0.9 + rng() * 1.3;
      const lean = new THREE.Euler((rng() - 0.5) * 0.35, 0, (rng() - 0.5) * 0.35);
      d.put(bone, paint(cone(0.025, h, 4), solid(i % 3 ? C(0.42, 0.45, 0.2) : C(0.55, 0.5, 0.3), 0.15)), p.clone(), lean);
      if (i % 5 === 0) {
        const head = new THREE.CylinderGeometry(0.05, 0.05, 0.28, 6);
        head.translate(0, h - 0.1, 0);
        d.put(bone, paint(head, solid(C(0.3, 0.2, 0.12), 0.1)), p.clone(), lean);
      }
    }
    // Little brass bells hanging in the reeds.
    for (let i = 0; i < 12; i += 1) {
      const { bone, p } = backPoint(d, -L * 0.3, L * 0.3, 1.6);
      const bell = new THREE.ConeGeometry(0.1, 0.18, 8, 1, true);
      bell.translate(0, 0.45 + rng() * 0.5, 0);
      d.put(bone, paint(bell, solid(C(0.72, 0.56, 0.26), 0.1)), p.clone());
    }
    // Lily pads plastered on its flanks.
    for (let i = 0; i < 10; i += 1) {
      const side = i % 2 ? 1 : -1;
      const z = -L * 0.3 + rng() * L * 0.6;
      const pad = new THREE.CircleGeometry(0.28 + rng() * 0.15, 10, 0.3, Math.PI * 2 - 0.6);
      d.put(z < -L * 0.05 ? BONE.chest : BONE.spine, paint(pad, solid(C(0.22, 0.36, 0.14), 0.1)), new THREE.Vector3(side * bodyR * 1.02, hipY + bodyR * (0.2 + rng() * 0.4), z), new THREE.Euler(0, side * Math.PI / 2, 0));
    }
    // A glowing throat sac.
    const sac = new THREE.SphereGeometry(0.5, 12, 8);
    sac.scale(1, 0.7, 0.9);
    d.glow(BONE.head, sac, d.rest[BONE.head].clone().add(new THREE.Vector3(0, -0.12 * L * 0.25 - H * 0.08, -0.05 * L)));
    // Calm: fireflies drift up out of the reeds.
    flowers(d, [C(1, 0.95, 0.55), C(0.9, 1, 0.6), C(1, 0.85, 0.45)], 40, 0.05);
  },
};

export const WARDENS: readonly WardenDef[] = [MOSSBACK, TIDEMOTHER, EMBERJAW, RIMEBROW, OLD_CROAK];
