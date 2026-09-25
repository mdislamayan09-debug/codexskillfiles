import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import { applyTriplanar, getStoneTextures } from '../render/props/stoneTextures';
import { getWoodTextures } from '../render/props/woodTextures';
import { generateRock } from '../world/props/RockGenerator';
import { bakeCloth } from './figures/textures';

// The crash camp's kit, built like the real thing: ridge tents of salvaged
// envelope canvas pitched on poles and guyed out, plank crates with battens,
// and a fire ring of fieldstones round the charred ends of last night's
// logs. Each piece is merged per material so it costs a draw or two.

export interface CampMaterials {
  canvas: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
  rope: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  char: THREE.MeshStandardMaterial;
  ash: THREE.MeshStandardMaterial;
  ember: THREE.MeshStandardMaterial;
}

export function createCampMaterials(): CampMaterials {
  const cloth = bakeCloth('canvas', 0xc4b48e, 41);
  for (const t of [cloth.map, cloth.normalMap]) t.repeat.set(3, 3);
  const wood = getWoodTextures();
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 });
  applyTriplanar(stone, getStoneTextures().slab, 0.9, 1.2);
  return {
    canvas: new THREE.MeshStandardMaterial({ map: cloth.map, normalMap: cloth.normalMap, roughness: 0.93, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b513a, roughness: 0.85 }),
    crate: new THREE.MeshStandardMaterial({ map: wood.planks.map, normalMap: wood.planks.normalMap, roughness: 0.84 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x9c8a62, roughness: 0.95 }),
    stone,
    char: new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.95 }),
    ash: new THREE.MeshStandardMaterial({ color: 0x5d5954, roughness: 1 }),
    ember: new THREE.MeshStandardMaterial({ color: 0x2a0d05, emissive: 0xff5a1a, emissiveIntensity: 0.9, roughness: 0.8 }),
  };
}

/** A thin cylinder from a to b. */
function strut(a: THREE.Vector3, b: THREE.Vector3, radius: number, sides = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(radius, radius, len, sides, 1);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

function mergedMesh(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const geos = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of geos) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A ridge tent: two canvas slopes that sag between the poles and ripple a
 * little, a closed back, the front flaps tied open, a ridge pole on two
 * uprights, and guy ropes out to pegs.
 */
export function buildTent(m: CampMaterials, seed: number, length = 2.5, width = 2.1, height = 1.55): THREE.Group {
  const rng = createRng(seed);
  const group = new THREE.Group();
  const halfL = length / 2;
  const halfW = width / 2;
  // Slopes: a grid from ridge to eave, sagging between the poles.
  const slope = (side: number): THREE.BufferGeometry => {
    const nu = 8;
    const nv = 12;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= nv; j += 1) {
      const v = j / nv;
      for (let i = 0; i <= nu; i += 1) {
        const u = i / nu;
        // Sag: deepest mid-slope and mid-length, none at the ridge and poles.
        const sag = Math.sin(Math.PI * u) * (0.35 + 0.65 * Math.sin(Math.PI * v)) * 0.09;
        const ripple = Math.sin(v * 23 + u * 5 + seed) * 0.008 * u;
        const x = side * (halfW * u) - side * sag * 0.55;
        const y = height * (1 - u) - sag * 0.8 + ripple;
        const z = -halfL + length * v + (u > 0.95 ? (rng() - 0.5) * 0.03 : 0);
        pos.push(x, y + 0.04, z);
        uv.push(u * 0.9, v * 1.1);
      }
    }
    for (let j = 0; j < nv; j += 1) {
      for (let i = 0; i < nu; i += 1) {
        const a = j * (nu + 1) + i;
        idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const back = new THREE.BufferGeometry();
  back.setAttribute('position', new THREE.Float32BufferAttribute([0, height + 0.04, -halfL, -halfW, 0.04, -halfL, halfW, 0.04, -halfL], 3));
  back.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 1, 0, 0, 1, 0], 2));
  back.computeVertexNormals();
  // Front flaps rolled back and tied: narrow triangles folded against the slopes.
  const flap = (side: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, height, halfL + 0.02, side * halfW * 0.95, 0.06, halfL + 0.02, side * halfW * 0.55, 0.05, halfL + 0.28], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 1, 0, 0, 0.3, 0], 2));
    g.computeVertexNormals();
    return g;
  };
  group.add(mergedMesh([slope(-1), slope(1), back, flap(-1), flap(1)], m.canvas));
  // Poles and ridge.
  const poles = [
    strut(new THREE.Vector3(0, 0, halfL + 0.03), new THREE.Vector3(0, height + 0.12, halfL + 0.03), 0.022),
    strut(new THREE.Vector3(0, 0, -halfL - 0.03), new THREE.Vector3(0, height + 0.12, -halfL - 0.03), 0.022),
    strut(new THREE.Vector3(0, height + 0.06, -halfL - 0.03), new THREE.Vector3(0, height + 0.06, halfL + 0.03), 0.02),
  ];
  // Pegs along the eaves and at the guy ends.
  const pegs: THREE.BufferGeometry[] = [];
  const ropes: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k += 1) {
      const z = -halfL + (length * (k + 0.5)) / 3;
      const peg = new THREE.Vector3(side * (halfW + 0.12), 0, z);
      pegs.push(strut(peg.clone().setY(-0.05), peg.clone().setY(0.12), 0.012, 4));
      ropes.push(strut(new THREE.Vector3(side * halfW, 0.06, z), peg.clone().setY(0.1), 0.005, 3));
    }
  }
  for (const end of [-1, 1]) {
    const top = new THREE.Vector3(0, height + 0.1, end * (halfL + 0.03));
    for (const side of [-1, 1]) {
      const peg = new THREE.Vector3(side * 0.7, 0, end * (halfL + 1.3));
      pegs.push(strut(peg.clone().setY(-0.05), peg.clone().setY(0.14), 0.014, 4));
      ropes.push(strut(top, peg.clone().setY(0.12), 0.006, 3));
    }
  }
  group.add(mergedMesh([...poles, ...pegs], m.wood));
  const ropeMesh = mergedMesh(ropes, m.rope);
  ropeMesh.castShadow = false;
  ropeMesh.userData.noShadow = true;
  group.add(ropeMesh);
  return group;
}

/** A plank crate: boards on every face, battens round the edges, a diagonal brace. */
export function buildCrate(m: CampMaterials, size: number): THREE.Group {
  const s = size;
  const group = new THREE.Group();
  const body = new THREE.BoxGeometry(s * 0.96, s * 0.96, s * 0.96);
  // Planks run across each face: scale the uvs so boards are ~12 cm wide.
  const uv = body.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * s * 1.6, uv.getY(i) * s * 1.6);
  body.translate(0, s / 2, 0);
  const battens: THREE.BufferGeometry[] = [];
  const b = s * 0.07;
  const h = s / 2;
  for (const y of [b / 2, s - b / 2]) {
    for (const [x, z, w, d] of [
      [0, h - b / 2, s, b],
      [0, -h + b / 2, s, b],
      [h - b / 2, 0, b, s],
      [-h + b / 2, 0, b, s],
    ] as const) {
      const g = new THREE.BoxGeometry(w, b, d);
      g.translate(x, y, z);
      battens.push(g);
    }
  }
  for (const [x, z] of [
    [h - b / 2, h - b / 2],
    [-h + b / 2, h - b / 2],
    [h - b / 2, -h + b / 2],
    [-h + b / 2, -h + b / 2],
  ] as const) {
    const g = new THREE.BoxGeometry(b, s, b);
    g.translate(x, s / 2, z);
    battens.push(g);
  }
  const brace = new THREE.BoxGeometry(b * 0.8, s * 1.25, b * 0.5);
  brace.rotateZ(Math.PI / 4);
  brace.translate(0, s / 2, h + b * 0.15);
  battens.push(brace);
  group.add(mergedMesh([body], m.crate));
  group.add(mergedMesh(battens, m.wood));
  return group;
}

/**
 * Last night's fire: fieldstones of different sizes set in a ring, the
 * charred ends of logs pushed into the middle, a bed of ash with embers
 * still glowing under it.
 */
export function buildFireRing(m: CampMaterials, seed: number): THREE.Group {
  const rng = createRng(seed);
  const group = new THREE.Group();
  const stones: THREE.BufferGeometry[] = [];
  const count = 11;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.2;
    const r = 0.62 + (rng() - 0.5) * 0.08;
    const g = generateRock({ seed: seed * 13 + i, kind: 'boulder', detail: 2 }).geometry.clone();
    const size = 0.13 + rng() * 0.09;
    g.scale(size * (1 + rng() * 0.4), size * (0.7 + rng() * 0.3), size);
    g.rotateY(rng() * Math.PI * 2);
    g.translate(Math.cos(a) * r, size * 0.35, Math.sin(a) * r);
    stones.push(g);
  }
  group.add(mergedMesh(stones, m.stone));
  // Ash: a low mound, thicker in the middle.
  const ash = new THREE.CylinderGeometry(0.5, 0.56, 0.05, 20, 1);
  ash.translate(0, 0.02, 0);
  const ashMesh = mergedMesh([ash], m.ash);
  ashMesh.castShadow = false;
  ashMesh.userData.noShadow = true;
  group.add(ashMesh);
  // Logs burnt to stumps, their ends meeting in the middle.
  const logs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + rng() * 0.5;
    const outer = new THREE.Vector3(Math.cos(a) * 0.55, 0.07, Math.sin(a) * 0.55);
    const inner = new THREE.Vector3(Math.cos(a) * 0.08, 0.16, Math.sin(a) * 0.08);
    logs.push(strut(outer, inner, 0.045 + rng() * 0.02, 7));
  }
  group.add(mergedMesh(logs, m.char));
  // Embers where the logs meet.
  const embers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    const g = new THREE.IcosahedronGeometry(0.03 + rng() * 0.025, 0);
    g.translate((rng() - 0.5) * 0.3, 0.05, (rng() - 0.5) * 0.3);
    embers.push(g);
  }
  const emberMesh = mergedMesh(embers, m.ember);
  emberMesh.castShadow = false;
  emberMesh.userData.noShadow = true;
  group.add(emberMesh);
  return group;
}
