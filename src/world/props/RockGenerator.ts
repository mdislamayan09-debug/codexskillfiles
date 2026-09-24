import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, hash3i } from '../../core/rng';

// Procedural rocks: a subdivided icosahedron roughened with 3D noise, then
// sliced by random fracture planes (vertices beyond a plane are pressed onto
// it). The slices give the flat faces and sharp arrises of broken stone;
// creased normals keep those edges crisp. Every LOD uses the same seed so
// shapes match across distances.

export type RockKind = 'boulder' | 'crag' | 'slab' | 'pebble' | 'shard' | 'river';

export interface RockOptions {
  seed: number;
  kind: RockKind;
  /** Icosahedron subdivision (7 ≈ 1280 tris, 3 ≈ 320, 1 ≈ 80). */
  detail: number;
}

export interface RockMesh {
  geometry: THREE.BufferGeometry;
  /** Axis-aligned half extents of the finished rock (unit scale). */
  extents: THREE.Vector3;
  /** Height of the top above the ground plane (unit scale, after burial). */
  top: number;
}

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number, c: number) => (hash3i(xi + a, yi + b, zi + c, seed) / 4294967295) * 2 - 1;
  const x00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * u;
  const x10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * u;
  const x01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * u;
  const x11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += valueNoise3(x * freq, y * freq, z * freq, seed + o * 131) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

interface ShapeParams {
  scale: THREE.Vector3;
  roughness: number;
  planes: number;
  planeDepth: [number, number];
  bury: number;
  creaseDeg: number;
}

function shapeFor(kind: RockKind, rng: () => number): ShapeParams {
  switch (kind) {
    case 'crag':
      return { scale: new THREE.Vector3(0.75 + rng() * 0.3, 1.25 + rng() * 0.6, 0.7 + rng() * 0.3), roughness: 0.2, planes: 9, planeDepth: [0.5, 0.85], bury: 0.22, creaseDeg: 32 };
    case 'slab':
      return { scale: new THREE.Vector3(1.2 + rng() * 0.4, 0.38 + rng() * 0.18, 0.95 + rng() * 0.35), roughness: 0.12, planes: 7, planeDepth: [0.55, 0.9], bury: 0.3, creaseDeg: 30 };
    case 'pebble':
      return { scale: new THREE.Vector3(1, 0.62 + rng() * 0.2, 0.8 + rng() * 0.2), roughness: 0.1, planes: 4, planeDepth: [0.72, 0.95], bury: 0.25, creaseDeg: 50 };
    case 'shard':
      return { scale: new THREE.Vector3(0.55 + rng() * 0.2, 1 + rng() * 0.3, 0.5 + rng() * 0.2), roughness: 0.08, planes: 8, planeDepth: [0.35, 0.7], bury: 0.15, creaseDeg: 25 };
    case 'river':
      return { scale: new THREE.Vector3(1, 0.55 + rng() * 0.15, 0.85 + rng() * 0.15), roughness: 0.05, planes: 2, planeDepth: [0.8, 0.95], bury: 0.3, creaseDeg: 70 };
    default:
      return { scale: new THREE.Vector3(1, 0.72 + rng() * 0.25, 0.85 + rng() * 0.25), roughness: 0.18, planes: 6, planeDepth: [0.6, 0.9], bury: 0.28, creaseDeg: 38 };
  }
}

export function generateRock(options: RockOptions): RockMesh {
  const rng = createRng(options.seed * 7919 + 17);
  const params = shapeFor(options.kind, rng);
  const noiseSeed = options.seed * 31 + 7;

  // Fracture planes (identical for every LOD).
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < params.planes; i += 1) {
    const theta = rng() * Math.PI * 2;
    const y = rng() * 1.6 - 0.6; // bias toward sides and top
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    planes.push({
      n: new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize(),
      d: params.planeDepth[0] + rng() * (params.planeDepth[1] - params.planeDepth[0]),
    });
  }

  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, options.detail);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).normalize();
    const n1 = fbm3(v.x * 1.4 + 3, v.y * 1.4, v.z * 1.4, noiseSeed, 3);
    const n2 = fbm3(v.x * 4.1, v.y * 4.1 + 7, v.z * 4.1, noiseSeed + 99, 3);
    const radius = 1 + params.roughness * n1 * 1.6 + params.roughness * 0.35 * n2;
    v.multiplyScalar(radius);
    for (const plane of planes) {
      const along = v.dot(plane.n);
      if (along > plane.d) v.addScaledVector(plane.n, -(along - plane.d) * 0.96);
    }
    v.multiply(params.scale);
    pos.setXYZ(i, v.x, v.y, v.z);
    box.expandByPoint(v);
  }
  // Sit on the ground: shift so the rock is partly buried.
  const height = box.max.y - box.min.y;
  const shift = -box.min.y - height * params.bury;
  for (let i = 0; i < pos.count; i += 1) pos.setY(i, pos.getY(i) + shift);
  box.min.y += shift;
  box.max.y += shift;

  // Cavity occlusion from local concavity (vertex vs. neighbour average).
  const index = geometry.getIndex() as THREE.BufferAttribute;
  const sums = new Float32Array(pos.count * 3);
  const counts = new Float32Array(pos.count);
  for (let f = 0; f < index.count; f += 3) {
    const a = index.getX(f);
    const b = index.getX(f + 1);
    const c = index.getX(f + 2);
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
      [b, a],
      [c, b],
      [a, c],
    ]) {
      sums[p * 3] += pos.getX(q);
      sums[p * 3 + 1] += pos.getY(q);
      sums[p * 3 + 2] += pos.getZ(q);
      counts[p] += 1;
    }
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) {
    const cx = sums[i * 3] / counts[i] - pos.getX(i);
    const cy = sums[i * 3 + 1] / counts[i] - pos.getY(i);
    const cz = sums[i * 3 + 2] / counts[i] - pos.getZ(i);
    const concave = cx * normals.getX(i) + cy * normals.getY(i) + cz * normals.getZ(i);
    const ground = THREE.MathUtils.smoothstep(pos.getY(i), -0.05, height * 0.35);
    ao[i] = THREE.MathUtils.clamp(1 - concave * 6, 0.35, 1) * (0.55 + 0.45 * ground);
  }
  geometry.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));

  // Crisp fracture edges.
  const creased = toCreasedNormals(geometry, THREE.MathUtils.degToRad(params.creaseDeg));
  geometry.dispose();
  creased.computeBoundingSphere();
  creased.computeBoundingBox();
  const extents = new THREE.Vector3(
    Math.max(-box.min.x, box.max.x),
    (box.max.y - box.min.y) / 2,
    Math.max(-box.min.z, box.max.z),
  );
  return { geometry: creased, extents, top: box.max.y };
}
