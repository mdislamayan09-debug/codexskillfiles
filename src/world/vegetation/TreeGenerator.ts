import * as THREE from 'three';
import { createRng, type Rng } from '../../core/rng';
import { BARK, FOLIAGE } from '../../render/vegetation/foliageTextures';

export type TreeShape = 'conical' | 'round' | 'columnar' | 'weeping' | 'bush' | 'dead' | 'spire' | 'swamp';

export interface SpeciesConfig {
  id: string;
  shape: TreeShape;
  bark: number;
  foliage: number;
  height: [number, number];
  /** Trunk base radius as a fraction of height. */
  trunkRadius: number;
  lean: number;
  crownStart: number;
  /** Number of main limbs (broadleaf) or branches per whorl (conifer). */
  limbs: number;
  limbAngle: number;
  limbLength: number;
  gravity: number;
  leafCard: number;
  leafDensity: number;
  twigs: boolean;
  /** Extra hanging moss cards (swamp). */
  moss?: boolean;
}

export const SPECIES: Record<string, SpeciesConfig> = {
  spruce: {
    id: 'spruce', shape: 'conical', bark: BARK.pine, foliage: FOLIAGE.spruce, height: [15, 26], trunkRadius: 0.016, lean: 0.02,
    crownStart: 0.1, limbs: 5, limbAngle: 1.45, limbLength: 0.28, gravity: 0.35, leafCard: 1.35, leafDensity: 1, twigs: false,
  },
  pine: {
    id: 'pine', shape: 'spire', bark: BARK.pine, foliage: FOLIAGE.pine, height: [14, 22], trunkRadius: 0.018, lean: 0.06,
    crownStart: 0.55, limbs: 4, limbAngle: 1.2, limbLength: 0.26, gravity: 0.1, leafCard: 1.55, leafDensity: 0.9, twigs: true,
  },
  birch: {
    id: 'birch', shape: 'columnar', bark: BARK.birch, foliage: FOLIAGE.birch, height: [10, 17], trunkRadius: 0.012, lean: 0.05,
    crownStart: 0.38, limbs: 7, limbAngle: 0.62, limbLength: 0.34, gravity: -0.1, leafCard: 1.35, leafDensity: 1.9, twigs: true,
  },
  oak: {
    id: 'oak', shape: 'round', bark: BARK.oak, foliage: FOLIAGE.oak, height: [11, 17], trunkRadius: 0.04, lean: 0.03,
    crownStart: 0.28, limbs: 5, limbAngle: 0.95, limbLength: 0.55, gravity: 0.08, leafCard: 1.75, leafDensity: 1.9, twigs: true,
  },
  willow: {
    id: 'willow', shape: 'weeping', bark: BARK.oak, foliage: FOLIAGE.bush, height: [9, 13], trunkRadius: 0.045, lean: 0.08,
    crownStart: 0.35, limbs: 6, limbAngle: 0.8, limbLength: 0.5, gravity: 0.7, leafCard: 1.45, leafDensity: 1.7, twigs: true,
  },
  deadwood: {
    id: 'deadwood', shape: 'dead', bark: BARK.dead, foliage: FOLIAGE.dry, height: [7, 13], trunkRadius: 0.032, lean: 0.12,
    crownStart: 0.35, limbs: 4, limbAngle: 0.8, limbLength: 0.42, gravity: -0.05, leafCard: 0, leafDensity: 0, twigs: true,
  },
  swampcypress: {
    id: 'swampcypress', shape: 'swamp', bark: BARK.swamp, foliage: FOLIAGE.bush, height: [10, 16], trunkRadius: 0.05, lean: 0.07,
    crownStart: 0.45, limbs: 6, limbAngle: 1.05, limbLength: 0.4, gravity: 0.25, leafCard: 1.35, leafDensity: 1.2, twigs: true, moss: true,
  },
  glasstree: {
    id: 'glasstree', shape: 'round', bark: BARK.glass, foliage: FOLIAGE.glass, height: [7, 12], trunkRadius: 0.03, lean: 0.04,
    crownStart: 0.4, limbs: 5, limbAngle: 0.85, limbLength: 0.45, gravity: 0.0, leafCard: 1.25, leafDensity: 1.2, twigs: true,
  },
  shrub: {
    id: 'shrub', shape: 'bush', bark: BARK.oak, foliage: FOLIAGE.bush, height: [1.2, 2.2], trunkRadius: 0.03, lean: 0,
    crownStart: 0, limbs: 7, limbAngle: 0.7, limbLength: 0.6, gravity: 0.05, leafCard: 0.95, leafDensity: 2.0, twigs: false,
  },
  heath: {
    id: 'heath', shape: 'bush', bark: BARK.dead, foliage: FOLIAGE.spruce, height: [0.7, 1.2], trunkRadius: 0.03, lean: 0,
    crownStart: 0, limbs: 6, limbAngle: 0.8, limbLength: 0.7, gravity: 0.1, leafCard: 0.55, leafDensity: 1.2, twigs: false,
  },
};

export interface TreeMeshes {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry | null;
  height: number;
  canopyRadius: number;
  trunkRadius: number;
}

interface Builder {
  pos: number[];
  nrm: number[];
  uv: number[];
  wind: number[];
  layer: number[];
  /** Leaves: how open to the sky each vertex is (0 deep in the crown, 1 outside). */
  shade: number[];
  idx: number[];
}

function newBuilder(): Builder {
  return { pos: [], nrm: [], uv: [], wind: [], layer: [], shade: [], idx: [] };
}

function toGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(b.wind, 4));
  if (b.layer.length) g.setAttribute('aLayer', new THREE.Float32BufferAttribute(b.layer, 1));
  if (b.shade.length) g.setAttribute('aShade', new THREE.Float32BufferAttribute(b.shade, 1));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

interface BranchPoint {
  p: THREE.Vector3;
  r: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** Tube along a polyline with parallel-transport frames. */
function addTube(b: Builder, points: BranchPoint[], radial: number, height: number, weight: number, phase: number, uScale: number): void {
  if (points.length < 2) return;
  const base = b.pos.length / 3;
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  // Initial frame.
  tangent.subVectors(points[1].p, points[0].p).normalize();
  normal.set(0, 1, 0);
  if (Math.abs(tangent.dot(normal)) > 0.9) normal.set(1, 0, 0);
  binormal.crossVectors(tangent, normal).normalize();
  normal.crossVectors(binormal, tangent).normalize();
  let length = 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += points[i].p.distanceTo(points[i - 1].p);
  // Square bark texels: one tile spans (circumference / uScale) along the tube.
  const tileLen = Math.max(0.12, (2 * Math.PI * points[0].r) / uScale);
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) {
      length += points[i].p.distanceTo(points[i - 1].p);
      const next = i < points.length - 1 ? points[i + 1].p : points[i].p;
      const prev = points[i - 1].p;
      const newTangent = tmpA.subVectors(next, prev).normalize();
      if (newTangent.lengthSq() < 1e-8) newTangent.copy(tangent);
      // Parallel transport: rotate the frame by the tangent change.
      const axis = tmpB.crossVectors(tangent, newTangent);
      const sin = axis.length();
      if (sin > 1e-6) {
        axis.divideScalar(sin);
        const angle = Math.asin(Math.min(1, sin));
        normal.applyAxisAngle(axis, angle);
        binormal.applyAxisAngle(axis, angle);
      }
      tangent.copy(newTangent);
    }
    const { p, r } = points[i];
    const t = total > 0 ? length / total : 0;
    for (let s = 0; s <= radial; s += 1) {
      const a = (s / radial) * Math.PI * 2;
      const cx = Math.cos(a);
      const sx = Math.sin(a);
      tmpC.copy(normal).multiplyScalar(cx).addScaledVector(binormal, sx);
      b.pos.push(p.x + tmpC.x * r, p.y + tmpC.y * r, p.z + tmpC.z * r);
      b.nrm.push(tmpC.x, tmpC.y, tmpC.z);
      b.uv.push((s / radial) * uScale, length / tileLen);
      b.wind.push(Math.max(0, p.y) / height, weight, phase, t);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let s = 0; s < radial; s += 1) {
      const a = base + i * ring + s;
      const c = a + ring;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
}

/** A foliage card: quad centered on `origin`, extending along `up` from its base. */
function addCard(
  b: Builder,
  origin: THREE.Vector3,
  up: THREE.Vector3,
  side: THREE.Vector3,
  size: number,
  height: number,
  weight: number,
  phase: number,
  canopyCenter: THREE.Vector3,
  layer: number,
): void {
  const base = b.pos.length / 3;
  const half = size * 0.5;
  const cardNormal = tmpA.crossVectors(side, up).normalize();
  const corners: [number, number][] = [
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ];
  for (const [sx, sy] of corners) {
    const x = origin.x + side.x * sx * half + up.x * sy * size;
    const y = origin.y + side.y * sx * half + up.y * sy * size;
    const z = origin.z + side.z * sx * half + up.z * sy * size;
    b.pos.push(x, y, z);
    // Blend the card normal with the canopy's outward normal (volumetric look).
    const ox = x - canopyCenter.x;
    const oy = (y - canopyCenter.y) * 0.8;
    const oz = z - canopyCenter.z;
    const ol = Math.hypot(ox, oy, oz) || 1;
    const nx = cardNormal.x * 0.35 + (ox / ol) * 0.65;
    const ny = cardNormal.y * 0.35 + (oy / ol) * 0.65 + 0.15;
    const nz = cardNormal.z * 0.35 + (oz / ol) * 0.65;
    const nl = Math.hypot(nx, ny, nz) || 1;
    b.nrm.push(nx / nl, ny / nl, nz / nl);
    b.uv.push((sx + 1) * 0.5, sy);
    b.wind.push(Math.max(0, y) / height, weight, phase, sy);
    b.layer.push(layer);
  }
  b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}

function perpendicular(dir: THREE.Vector3, azimuth: number, out: THREE.Vector3): THREE.Vector3 {
  const ref = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  return out.copy(u).multiplyScalar(Math.cos(azimuth)).addScaledVector(v, Math.sin(azimuth)).normalize();
}

/** Builds a curved limb from `start` along `dir`. */
function limbPoints(rng: Rng, start: THREE.Vector3, dir: THREE.Vector3, length: number, r0: number, r1: number, gravity: number, segments: number): BranchPoint[] {
  const pts: BranchPoint[] = [];
  const p = start.clone();
  const d = dir.clone().normalize();
  const step = length / segments;
  pts.push({ p: p.clone(), r: r0 });
  for (let i = 1; i <= segments; i += 1) {
    d.y -= gravity * (0.5 + 0.5 * (i / segments)) / segments;
    d.x += (rng() - 0.5) * 0.25;
    d.z += (rng() - 0.5) * 0.25;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push({ p: p.clone(), r: r0 + (r1 - r0) * (i / segments) });
  }
  return pts;
}

export interface GenerateOptions {
  seed: number;
  /** 0 full, 1 mid-distance, 2 shadow proxy (fewest cards, bigger). */
  lod: 0 | 1 | 2;
}

/** Generates a tree (or bush) of a species. Units: meters, origin at the root. */
export function generateTree(species: SpeciesConfig, options: GenerateOptions): TreeMeshes {
  const rng = createRng(options.seed);
  const lod = options.lod;
  const bark = newBuilder();
  const leaves = newBuilder();
  const H = species.height[0] + (species.height[1] - species.height[0]) * rng();
  const trunkR = Math.max(0.05, species.trunkRadius * H);
  const bushy = species.shape === 'bush';
  const radialTrunk = bushy ? 3 : lod === 0 ? 8 : 5;
  const radialLimb = bushy ? 3 : lod === 0 ? 4 : 3;
  const canopyCenter = new THREE.Vector3(0, H * (species.crownStart + (1 - species.crownStart) * 0.55), 0);
  let canopyRadius = 0;
  const leafScale = lod === 0 ? 1 : lod === 1 ? 1.45 : 1.9;
  const leafSkip = lod === 0 ? 1 : lod === 1 ? 2 : 4;
  let leafCounter = 0;
  const wantLeaf = () => {
    leafCounter += 1;
    return leafCounter % leafSkip === 0;
  };
  const cardUp = new THREE.Vector3();
  const cardSide = new THREE.Vector3();

  const addLeafCluster = (at: THREE.Vector3, dir: THREE.Vector3, size: number, weight: number, phase: number) => {
    if (species.leafCard <= 0 || !wantLeaf()) return;
    const s = size * leafScale * (0.8 + 0.4 * rng());
    // Two crossed cards pointing outward along the twig direction.
    cardUp.copy(dir).normalize();
    cardUp.y = Math.max(cardUp.y, -0.35);
    cardUp.normalize();
    perpendicular(cardUp, rng() * Math.PI * 2, cardSide);
    addCard(leaves, at, cardUp, cardSide, s, H, weight, phase, canopyCenter, species.foliage);
    if (lod === 0) {
      const side2 = cardSide.clone().applyAxisAngle(cardUp, Math.PI * 0.5);
      addCard(leaves, at, cardUp, side2, s * 0.9, H, weight, phase + 0.3, canopyCenter, species.foliage);
    }
    canopyRadius = Math.max(canopyRadius, Math.hypot(at.x, at.z) + s * 0.5);
  };

  // --- Trunk ---------------------------------------------------------------
  const trunk: BranchPoint[] = [];
  const trunkSegs = lod === 0 ? 10 : lod === 1 ? 5 : 3;
  const leanDir = new THREE.Vector2(rng() - 0.5, rng() - 0.5).normalize();
  const bush = species.shape === 'bush';
  if (!bush) {
    for (let i = 0; i <= trunkSegs; i += 1) {
      const t = i / trunkSegs;
      const y = t * H * (species.shape === 'dead' ? 0.85 : 1);
      const lean = species.lean * H * t * t;
      const wobble = 0.04 * H * Math.sin(t * 5 + rng() * 0.3) * t;
      const flare = i === 0 ? 1.45 : i === 1 ? 1.12 : 1;
      const taper = species.shape === 'conical' || species.shape === 'spire' ? 1 - t * 0.92 : 1 - t * 0.78;
      trunk.push({
        p: new THREE.Vector3(leanDir.x * lean + wobble * 0.3, y, leanDir.y * lean + wobble * 0.2),
        r: trunkR * taper * flare,
      });
    }
    addTube(bark, trunk, radialTrunk, H, 0, rng() * 6.28, 2);
  }

  const trunkAt = (t: number): THREE.Vector3 => {
    const f = t * (trunk.length - 1);
    const i = Math.min(trunk.length - 2, Math.floor(f));
    return trunk[i].p.clone().lerp(trunk[i + 1].p, f - i);
  };
  const trunkRadiusAt = (t: number): number => {
    const f = t * (trunk.length - 1);
    const i = Math.min(trunk.length - 2, Math.floor(f));
    return trunk[i].r + (trunk[i + 1].r - trunk[i].r) * (f - i);
  };

  const golden = 2.39996;

  if (species.shape === 'conical' || species.shape === 'spire') {
    // Conifer: whorls of near-horizontal branches carrying needle sprays.
    const spacing = species.shape === 'conical' ? 0.55 : 0.85;
    const startY = H * species.crownStart;
    let whorl = 0;
    for (let y = startY; y < H * 0.97; y += spacing * (0.85 + 0.3 * rng())) {
      whorl += 1;
      const t = y / H;
      const coneFrac = species.shape === 'conical' ? 1 - (y - startY) / (H - startY) : Math.sin(Math.PI * Math.min(1, (y - startY) / (H - startY)) * 0.9 + 0.2);
      const len = species.limbLength * H * (0.12 + 0.88 * coneFrac) * (0.8 + 0.4 * rng());
      const count = species.limbs + (rng() < 0.5 ? 0 : 1);
      for (let k = 0; k < count; k += 1) {
        const az = whorl * golden + (k / count) * Math.PI * 2 + rng() * 0.4;
        const dir = new THREE.Vector3(Math.cos(az), -0.1 - species.gravity * 0.3 + (species.shape === 'spire' ? 0.25 : 0), Math.sin(az)).normalize();
        const start = trunkAt(t).add(dir.clone().multiplyScalar(trunkRadiusAt(t) * 0.8));
        const pts = limbPoints(rng, start, dir, len, Math.max(0.025, trunkRadiusAt(t) * 0.35), 0.012, species.gravity, 2);
        const phase = rng() * 6.28;
        // Branch wood is mostly hidden by needles: cheap tubes, none at LOD 1.
        if (lod === 0 && len > 0.6) addTube(bark, pts, 3, H, 0.45, phase, 1);
        // Sprays along the branch, bigger toward the tip.
        const sprays = Math.max(1, Math.round(len / 0.65));
        for (let s = 0; s < sprays; s += 1) {
          const f = (s + 0.6) / sprays;
          const idx = Math.min(pts.length - 1, Math.floor(f * (pts.length - 1)));
          const at = pts[idx].p.clone().lerp(pts[Math.min(pts.length - 1, idx + 1)].p, (f * (pts.length - 1)) % 1);
          const sdir = dir.clone();
          sdir.y = -0.15 - 0.2 * rng();
          sdir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (rng() - 0.5) * 1.1).normalize();
          addLeafCluster(at, sdir, species.leafCard * (0.7 + 0.5 * f), 0.8 + 0.2 * f, phase);
        }
      }
    }
    // Leader top.
    addLeafCluster(trunkAt(0.96), new THREE.Vector3(0, 1, 0), species.leafCard * 0.9, 0.7, 0);
  } else {
    // Broadleaf / bush / dead / weeping: recursive limbs.
    const limbCount = species.limbs;
    for (let k = 0; k < limbCount; k += 1) {
      const t = bush ? 0 : species.crownStart + (1 - species.crownStart) * (0.1 + 0.8 * (k / limbCount)) * (0.85 + 0.3 * rng());
      const az = k * golden + rng() * 0.6;
      const tilt = species.limbAngle * (0.75 + 0.5 * rng()) * (bush ? 0.9 : 1);
      const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)).normalize();
      const start = bush ? new THREE.Vector3((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2) : trunkAt(t);
      const baseR = bush ? Math.max(0.02, trunkR * 0.5) : trunkRadiusAt(t) * 0.62;
      const len = species.limbLength * H * (0.7 + 0.5 * rng()) * (bush ? 1 : 1 - t * 0.35);
      const phase = rng() * 6.28;
      const limb = limbPoints(rng, start, dir, len, baseR, baseR * 0.3, species.gravity, bushy ? 2 : lod === 0 ? 4 : 2);
      addTube(bark, limb, radialLimb, H, 0.3, phase, 1);
      // Secondary branches.
      const subCount = bushy ? 2 : lod === 0 ? 4 + Math.floor(rng() * 3) : 3;
      for (let s = 0; s < subCount; s += 1) {
        const f = 0.3 + 0.65 * (s / subCount) + rng() * 0.05;
        const idx = Math.min(limb.length - 2, Math.floor(f * (limb.length - 1)));
        const at = limb[idx].p.clone().lerp(limb[idx + 1].p, (f * (limb.length - 1)) % 1);
        const parentDir = tmpB.subVectors(limb[idx + 1].p, limb[idx].p).normalize().clone();
        const sdir = parentDir.clone().applyAxisAngle(perpendicular(parentDir, rng() * 6.28, new THREE.Vector3()), 0.6 + rng() * 0.5).normalize();
        if (species.shape === 'weeping') sdir.y -= 0.6;
        const slen = len * (0.35 + 0.3 * rng()) * (1 - f * 0.4);
        const sub = limbPoints(rng, at, sdir, slen, Math.max(0.012, limb[idx].r * 0.5), 0.008, species.gravity * (species.shape === 'weeping' ? 3 : 1.2), 2);
        const sphase = phase + rng();
        if (!bushy && (lod === 0 || species.shape === 'dead')) addTube(bark, sub, 3, H, 0.6, sphase, 1);
        if (species.shape !== 'dead') {
          const clusters = Math.max(2, Math.round(slen * species.leafDensity * 3.6));
          for (let c = 0; c < clusters; c += 1) {
            const cf = 0.35 + 0.65 * ((c + 1) / clusters);
            const ci = Math.min(sub.length - 1, Math.round(cf * (sub.length - 1)));
            const cdir = sdir.clone();
            if (species.shape === 'weeping') cdir.set(cdir.x * 0.3, -1, cdir.z * 0.3).normalize();
            else cdir.y += 0.3;
            addLeafCluster(sub[ci].p, cdir, species.leafCard, 0.85, sphase);
          }
        }
        if (species.moss && lod === 0 && rng() < 0.5) {
          // Hanging moss drapes: a card hanging down from the branch.
          const down = new THREE.Vector3(0, -1, 0);
          const side = perpendicular(down, rng() * 6.28, new THREE.Vector3());
          const mossStart = sub[Math.floor(sub.length / 2)].p;
          addCard(leaves, mossStart.clone(), down, side, 1.2 + rng(), H, 0.9, sphase, canopyCenter, FOLIAGE.moss);
        }
      }
      if (species.shape !== 'dead') {
        // Foliage along the outer half of the limb itself.
        const along = Math.max(2, Math.round(len * species.leafDensity * 1.2));
        for (let c = 0; c < along; c += 1) {
          const f = 0.45 + 0.55 * ((c + 1) / along);
          const li = Math.min(limb.length - 1, Math.round(f * (limb.length - 1)));
          const ldir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rng() - 0.5) * 2.4);
          ldir.y += species.shape === 'weeping' ? -0.8 : 0.35;
          addLeafCluster(limb[li].p, ldir.normalize(), species.leafCard * 1.05, 0.82, phase);
        }
        addLeafCluster(limb[limb.length - 1].p, dir, species.leafCard * 1.1, 0.8, phase);
      }
    }
  }

  // Crown depth: leaves deep inside a crown, and low in it, see little of the
  // sky and are shaded by the leaves around them. Without it every card is
  // lit like the outermost one and a tree reads as flat cut-outs.
  const leafCount = leaves.pos.length / 3;
  if (leafCount > 0) {
    const dist = new Float32Array(leafCount);
    let maxD = 1e-3;
    for (let i = 0; i < leafCount; i += 1) {
      const dx = leaves.pos[i * 3] - canopyCenter.x;
      const dy = (leaves.pos[i * 3 + 1] - canopyCenter.y) * 0.8;
      const dz = leaves.pos[i * 3 + 2] - canopyCenter.z;
      dist[i] = Math.hypot(dx, dy, dz);
      maxD = Math.max(maxD, dist[i]);
    }
    const bottom = H * species.crownStart;
    for (let i = 0; i < leafCount; i += 1) {
      const t = Math.min(1, Math.max(0, (dist[i] / maxD - 0.2) / 0.75));
      const outer = t * t * (3 - 2 * t);
      const rel = Math.min(1, Math.max(0, (leaves.pos[i * 3 + 1] - bottom) / Math.max(H - bottom, 0.5)));
      leaves.shade.push((0.3 + 0.7 * outer) * (0.72 + 0.28 * rel));
    }
  }

  // The leaf cards of the moss (and foliage) share one geometry per species.
  return {
    bark: toGeometry(bark),
    leaves: leaves.pos.length ? toGeometry(leaves) : null,
    height: H,
    canopyRadius: Math.max(canopyRadius, H * 0.2),
    trunkRadius: bush ? 0 : trunkR,
  };
}
