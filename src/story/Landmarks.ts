import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { getRockTexture } from '../render/props/rockTexture';
import { applyTriplanar, getStoneTextures } from '../render/props/stoneTextures';
import { getWoodTextures } from '../render/props/woodTextures';
import { generateRock, type RockKind } from '../world/props/RockGenerator';
import type { Caves } from '../world/Caves';
import { SolidField } from '../world/SolidField';
import type { WorldData } from '../world/WorldData';
import { LANDMARKS, type LandmarkDef } from '../world/WorldLayout';
import type { Interactable } from './StoryWorld';
import { CACHE_SPOTS, CACHES, type LandmarkCache } from './LandmarkData';
import { colossalFace, gableEnds, gableRoof, hull, stairs, voussoirArch, wallWithOpenings } from './landmarkKit';

// Every named place on the island gets something to find: a set piece that
// makes it recognisable from a distance, a cache worth the walk, and a page
// for the journal. Set pieces are procedural and merged per material per
// place, so the whole island costs a few draws per landmark in view.

export interface LandmarkHooks {
  give(item: string, count: number): void;
  hasFlag(flag: string): boolean;
  setFlag(flag: string): void;
  lore(id: string, title: string): void;
  say(speaker: string, text: string, seconds?: number): void;
  damage(amount: number, source: string): void;
  playerPosition(): THREE.Vector3;
}

type Mat = 'stone' | 'dark' | 'rock' | 'rockDark' | 'wood' | 'plank' | 'slate' | 'thatch' | 'iron' | 'brass' | 'cloth' | 'ice' | 'glass' | 'lamp' | 'song' | 'lava' | 'fungus' | 'crystal' | 'moss' | 'red' | 'bone';

interface Piece {
  lm: LandmarkDef;
  parts: Map<Mat, THREE.BufferGeometry[]>;
  cx: number;
  cy: number;
  cz: number;
  /** Where the cache stands, when not on the ground (a floor, a terrace). */
  cacheY?: number;
}


function mat(color: number, roughness = 0.85, metalness = 0, emissive = 0, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
}

export class Landmarks {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  /** Walls to walk into and floors, steps and decks to walk on. */
  readonly solids = new SolidField();
  private readonly m: Record<Mat, THREE.MeshStandardMaterial>;
  private readonly rng = createRng(0x1a4d);
  private readonly beam: THREE.Mesh;
  private readonly beamMaterial: THREE.ShaderMaterial;
  private readonly isle = new THREE.Group();
  private readonly flies: THREE.Points;
  private readonly flyMaterial: THREE.PointsMaterial;
  private readonly flyBase: Float32Array;
  private readonly traps: { x: number; z: number; sprung: boolean }[] = [];
  private time = 0;

  constructor(
    private readonly world: WorldData,
    interactables: Interactable[],
    private readonly hooks: LandmarkHooks,
    private readonly caves: Caves | null = null,
  ) {
    const wood = getWoodTextures();
    const plank = new THREE.MeshStandardMaterial({ map: wood.planks.map, normalMap: wood.planks.normalMap, roughness: 0.86 });
    // Roofs: the shingle texture, weathered grey like old slate.
    const slate = new THREE.MeshStandardMaterial({ map: wood.shingles.map, normalMap: wood.shingles.normalMap, color: 0x8a9098, roughness: 0.78 });
    // Reed thatch: the shingle texture, straw-coloured and matte.
    const thatch = new THREE.MeshStandardMaterial({ map: wood.shingles.map, normalMap: wood.shingles.normalMap, color: 0xc8b078, roughness: 0.97 });
    this.m = {
      stone: mat(0xe0d8c8, 0.9),
      dark: mat(0x8e887e, 0.92),
      rock: mat(0xd2c8b8, 0.9),
      rockDark: mat(0x8a847a, 0.92),
      wood: mat(0xa88462, 0.86),
      plank,
      slate,
      thatch,
      iron: mat(0x4d4a47, 0.55, 0.75),
      brass: mat(0xa8894c, 0.35, 1),
      cloth: mat(0xb8ab8c, 0.95),
      ice: mat(0xbfe2f2, 0.08, 0, 0x2a5a6a, 0.35),
      glass: mat(0x1a1408, 0.3, 0, 0xffc46a, 2.2),
      lamp: mat(0x2a1a06, 0.4, 0, 0xffd28a, 4),
      song: mat(0x1b6f64, 0.25, 0, 0x2bd6c0, 1.8),
      lava: mat(0x2a0a02, 0.7, 0, 0xff5a10, 2.6),
      fungus: mat(0x0f3a34, 0.5, 0, 0x5ff2c8, 2.2),
      crystal: mat(0xcfd8ff, 0.1, 0, 0x8f9aff, 0.9),
      moss: mat(0x34462a, 0.95),
      red: mat(0x9a1c14, 0.8),
      bone: mat(0xd8d0bc, 0.7),
    };
    for (const m of Object.values(this.m)) this.materials.push(m);
    // Dressed stone and weathered timber in world space: no stretching on
    // long lintels or tall piers.
    const stone = getStoneTextures();
    applyTriplanar(this.m.stone, stone.masonry, 2.6, 1);
    applyTriplanar(this.m.dark, stone.masonry, 1.9, 1.2);
    applyTriplanar(this.m.wood, wood.planks, 1.4, 0.8);
    const rock = getRockTexture();
    applyTriplanar(this.m.rock, rock, 2.8, 1.2);
    applyTriplanar(this.m.rockDark, rock, 2.2, 1.3);

    // The lighthouse beam: a slow additive cone that sweeps the sea at night.
    this.beamMaterial = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          // uv.y runs from the open end (0) to the lamp (1).
          float along = pow(vUv.y, 2.2);
          // Seen side-on the cone is thin at its rim and full through its middle.
          float rim = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
          float a = along * rim * smoothstep(0.0, 0.25, vUv.y);
          gl_FragColor = vec4(vec3(1.0, 0.88, 0.64) * a * uIntensity, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const beamGeo = new THREE.ConeGeometry(9, 140, 24, 1, true);
    beamGeo.translate(0, -70, 0);
    beamGeo.rotateZ(Math.PI / 2);
    this.beam = new THREE.Mesh(beamGeo, this.beamMaterial);
    this.beam.layers.set(LAYER_TRANSPARENT);
    this.beam.frustumCulled = false;

    // Lanternflies: slow gold motes that drift at dusk.
    const count = 220;
    this.flyBase = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    const lf = LANDMARKS.find((l) => l.id === 'lanternfly_hollow') as LandmarkDef;
    for (let i = 0; i < count; i += 1) {
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * 38;
      const x = lf.x + Math.cos(a) * r;
      const z = lf.z + Math.sin(a) * r;
      this.flyBase[i * 3] = x;
      this.flyBase[i * 3 + 1] = world.groundAt(x, z) + 0.6 + this.rng() * 3.5;
      this.flyBase[i * 3 + 2] = z;
    }
    positions.set(this.flyBase);
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.flyMaterial = new THREE.PointsMaterial({ color: 0xffd66a, size: 0.22, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.flies = new THREE.Points(flyGeo, this.flyMaterial);
    this.flies.layers.set(LAYER_TRANSPARENT);
    this.flies.frustumCulled = false;
    this.group.add(this.flies);

    for (const lm of LANDMARKS) {
      const build = this.builders[lm.id];
      if (!build) continue;
      const piece: Piece = { lm, parts: new Map(), cx: lm.x, cy: world.groundAt(lm.x, lm.z), cz: lm.z };
      build.call(this, piece);
      this.flush(piece, lm.id === 'floating_isle' ? this.isle : this.group);
      const cache = CACHES[lm.id];
      if (cache) this.addCache(piece, cache, interactables);
    }
    this.group.add(this.isle);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.noShadow) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers (world coordinates relative to the place's centre)

  private g(x: number, z: number): number {
    return this.world.groundAt(x, z);
  }

  private put(p: Piece, m: Mat, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    geo.rotateX(rx);
    geo.rotateZ(rz);
    geo.rotateY(ry);
    geo.translate(p.cx + x, y, p.cz + z);
    const list = p.parts.get(m) ?? [];
    list.push(geo);
    p.parts.set(m, list);
  }

  /** Box resting on the ground at (dx, dz) (+lift). */
  private box(p: Piece, m: Mat, w: number, h: number, d: number, dx: number, dz: number, lift = 0, ry = 0, rx = 0, rz = 0): void {
    this.put(p, m, new THREE.BoxGeometry(w, h, d), dx, this.g(p.cx + dx, p.cz + dz) + lift + h / 2, dz, rx, ry, rz);
  }

  private cyl(p: Piece, m: Mat, rt: number, rb: number, h: number, dx: number, dz: number, lift = 0, seg = 12, rx = 0, rz = 0): void {
    this.put(p, m, new THREE.CylinderGeometry(rt, rb, h, seg), dx, this.g(p.cx + dx, p.cz + dz) + lift + h / 2, dz, rx, 0, rz);
  }

  private rock(p: Piece, m: Mat, seed: number, kind: RockKind, s: number, dx: number, dz: number, lift = 0, sy = 1): void {
    const geo = generateRock({ seed, kind, detail: 2 }).geometry.clone();
    geo.scale(s, s * sy, s);
    // Boulders are natural rock whatever the place is built of.
    const natural: Mat = m === 'stone' ? 'rock' : m === 'dark' ? 'rockDark' : m;
    this.put(p, natural, geo, dx, this.g(p.cx + dx, p.cz + dz) + lift, dz, 0, seed);
  }

  /**
   * Merge a place's parts, one mesh per material. Everything that stands on
   * the ground is solid too, except flowers, lamps and anything too small
   * to trip over (and the floating isle, which drifts out of reach).
   */
  private flush(p: Piece, parent: THREE.Object3D): void {
    if (parent !== this.isle) {
      for (const [m, list] of p.parts) {
        if (m === 'red' || m === 'lamp') continue;
        for (const g of list) {
          if (g.userData.ghost) continue;
          g.computeBoundingBox();
          const b = g.boundingBox as THREE.Box3;
          if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) < 0.3 && b.max.y - b.min.y < 0.6) continue;
          this.solids.add(g);
        }
      }
    }
    for (const [m, list] of p.parts) {
      const geo = mergeGeometries(
        list.map((g) => {
          const ng = g.index ? g.toNonIndexed() : g;
          for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') ng.deleteAttribute(name);
          if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
          return ng;
        }),
        false,
      );
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, this.m[m]);
      mesh.name = `landmark:${p.lm.id}:${m}`;
      if (m === 'glass' || m === 'lamp' || m === 'lava' || m === 'fungus') mesh.userData.noShadow = true;
      parent.add(mesh);
    }
  }

  private addCache(p: Piece, cache: LandmarkCache, interactables: Interactable[]): void {
    const flag = `looted:${p.lm.id}`;
    const at = CACHE_SPOTS[p.lm.id] ?? [4, 3];
    const deep = this.caves?.cacheSpots().find((c) => c.id === p.lm.id);
    const x = deep ? deep.x : p.cx + at[0];
    const z = deep ? deep.z : p.cz + at[1];
    const y = deep ? deep.y : (p.cacheY ?? this.g(x, z) + (at[2] ?? 0));
    // A small iron-banded crate (or urn) to search.
    const crate = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.55), this.m.plank);
    body.position.y = 0.25;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.06, 0.59), this.m.iron);
    band.position.y = 0.4;
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.04), this.m.brass);
    clasp.position.set(0, 0.36, 0.29);
    crate.add(body, band, clasp);
    crate.position.set(x, y, z);
    crate.rotation.y = this.rng() * 6;
    crate.traverse((o) => {
      (o as THREE.Mesh).castShadow = true;
      (o as THREE.Mesh).receiveShadow = true;
    });
    this.group.add(crate);
    interactables.push({
      id: `cache:${p.lm.id}`,
      position: new THREE.Vector3(x, y + 0.4, z),
      radius: 0.9,
      prompt: () => (this.hooks.hasFlag(flag) || (cache.sealedBy && !this.hooks.hasFlag(cache.sealedBy)) ? null : { key: 'E', text: `Search the ${cache.container}` }),
      use: () => {
        if (this.hooks.hasFlag(flag) || (cache.sealedBy && !this.hooks.hasFlag(cache.sealedBy))) return;
        this.hooks.setFlag(flag);
        for (const [item, n] of cache.items) this.hooks.give(item, n);
        this.hooks.lore(cache.lore.id, cache.lore.title);
        clasp.visible = false;
      },
    });
  }

  /**
   * Frame a cave's real mouth: great stones either side, a lintel slab over
   * the opening and a scatter of fallen rock, with the cave's own accents.
   */
  private caveMouth(p: Piece, accent: Mat, seed: number): void {
    const cave = this.caves?.byId(p.lm.id);
    if (!cave) return;
    const mx = cave.mouth.x - p.cx;
    const mz = cave.mouth.z - p.cz;
    const dx = cave.dir.x;
    const dz = cave.dir.y;
    const nx = -dz;
    const nz = dx;
    const r = cave.nodes[0].r;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k += 1) {
        const s = 2.4 - k * 0.5 + this.rng() * 0.6;
        const off = r + 1.2 + k * 1.6;
        this.rock(p, 'dark', seed + k * 2 + (side > 0 ? 1 : 0), k === 0 ? 'crag' : 'boulder', s, mx + nx * side * off - dx * (0.6 + k * 1.4), mz + nz * side * off - dz * (0.6 + k * 1.4), -0.6, 1.3 - k * 0.2);
      }
    }
    // The lintel: a long slab bridging the opening, resting on the hill.
    const top = cave.nodes[0].floor + r * 1.75 + 0.3;
    const lintel = new THREE.BoxGeometry(r * 2 + 3.4, 1.1, 2.2);
    lintel.rotateY(-Math.atan2(dz, dx) + Math.PI / 2);
    this.put(p, 'dark', lintel, mx + dx * 1.2, Math.max(top, this.g(cave.mouth.x + dx * 1.2, cave.mouth.z + dz * 1.2) - 0.2), mz + dz * 1.2);
    for (let i = 0; i < 6; i += 1) {
      const a = this.rng() * Math.PI - Math.PI / 2;
      const d = r + 2 + this.rng() * 5;
      const x = mx - dx * d * Math.cos(a) + nx * d * Math.sin(a);
      const z = mz - dz * d * Math.cos(a) + nz * d * Math.sin(a);
      this.rock(p, 'dark', seed + 20 + i, 'pebble', 0.6 + this.rng() * 0.8, x, z, -0.2);
    }
    // Accents at the threshold.
    for (let i = 0; i < 5; i += 1) {
      const side = i % 2 ? 1 : -1;
      const x = mx + nx * side * (r * 0.8 + this.rng()) + dx * (1 + this.rng() * 2);
      const z = mz + nz * side * (r * 0.8 + this.rng()) + dz * (1 + this.rng() * 2);
      const h = 0.6 + this.rng() * 1.4;
      if (accent === 'crystal' || accent === 'ice') {
        const g = new THREE.CylinderGeometry(0, 0.25, h, 6);
        g.rotateZ((this.rng() - 0.5) * 0.8);
        this.put(p, accent, g, x, this.g(p.cx + x, p.cz + z) + h / 2 - 0.1, z);
      } else if (accent === 'lava') {
        this.put(p, 'lava', new THREE.BoxGeometry(0.2, 0.05, 1.8), x, this.g(p.cx + x, p.cz + z) + 0.03, z, 0, this.rng() * 3, 0);
      } else {
        // Veyr listening-stones: carved pillars with a glowing groove.
        this.put(p, 'stone', new THREE.BoxGeometry(0.5, h + 0.8, 0.4), x, this.g(p.cx + x, p.cz + z) + (h + 0.8) / 2 - 0.2, z, 0, this.rng(), 0);
        this.put(p, 'song', new THREE.BoxGeometry(0.06, h * 0.6, 0.42), x, this.g(p.cx + x, p.cz + z) + h * 0.5, z, 0, 0, 0);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Set pieces

  private readonly builders: Record<string, (p: Piece) => void> = {
    whispering_cave(this: Landmarks, p) {
      this.caveMouth(p, 'song', 2400);
    },
    old_aqueduct(this: Landmarks, p) {
      // An arcade striding across the valley: round arches of dressed stone,
      // a channel on top, two bays fallen into rubble.
      const n = 9;
      const bay = 7;
      const deckTop = p.cy + 11.5;
      for (let i = 0; i < n; i += 1) {
        const dz = (i - (n - 1) / 2) * bay;
        const broken = i === 3 || i === 7;
        const ground = Math.min(this.g(p.cx - 1.2, p.cz + dz - bay / 2), this.g(p.cx - 1.2, p.cz + dz + bay / 2), this.g(p.cx + 1.2, p.cz + dz));
        const base = ground - 1;
        const height = deckTop - base;
        if (height < 3) continue;
        if (broken) {
          // Only the pier stumps stand; the rest lies in the grass.
          this.put(p, 'stone', new THREE.BoxGeometry(2.2, 3 + (i % 2) * 2, 1.6), 0, base + 1.5, dz - bay / 2 + 0.8);
          for (let k = 0; k < 5; k += 1) this.rock(p, 'stone', 2500 + i * 7 + k, k % 2 ? 'slab' : 'boulder', 0.8 + this.rng() * 0.9, (this.rng() - 0.5) * 7, dz + (this.rng() - 0.5) * 6, -0.2, 0.6);
          continue;
        }
        const spring = height - 3.4 - 2.3;
        // Where the valley floor rises close to the deck, a solid wall.
        const wall = spring > 1.5 ? wallWithOpenings(bay, height, 2.2, [{ x: 0, y: 0.3, w: 4.6, h: spring + 2.0, arched: true }]) : new THREE.BoxGeometry(bay, height, 2.2).translate(0, height / 2, 0);
        wall.rotateY(Math.PI / 2);
        this.put(p, 'stone', wall, 0, base, dz);
        // A proud ring of voussoirs on each face.
        for (const side of spring > 1.5 ? [-1, 1] : []) {
          const ring = voussoirArch(4.6, 0.7, 0.25, 13);
          ring.rotateY(Math.PI / 2);
          this.put(p, 'stone', ring, side * 1.2, base + spring, dz);
        }
        // Cornice and the water channel on top.
        this.put(p, 'dark', new THREE.BoxGeometry(2.8, 0.35, bay), 0, deckTop - 0.2, dz);
        for (const side of [-1, 1]) this.put(p, 'stone', new THREE.BoxGeometry(0.35, 0.8, bay - 0.04), side * 1.05, deckTop + 0.4, dz);
      }
    },
    poppy_hill(this: Landmarks, p) {
      // A cairn, a survey tripod and poppies.
      for (let i = 0; i < 6; i += 1) this.rock(p, 'stone', 2600 + i, 'pebble', 0.7 - i * 0.07, (this.rng() - 0.5) * 0.4, (this.rng() - 0.5) * 0.4, i * 0.45);
      for (let k = 0; k < 3; k += 1) {
        const a = (k / 3) * Math.PI * 2;
        this.put(p, 'wood', new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), 2 + Math.cos(a) * 0.35, p.cy + 0.75, 1 + Math.sin(a) * 0.35, Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25);
      }
      this.put(p, 'brass', new THREE.CylinderGeometry(0.06, 0.08, 0.5, 8), 2, p.cy + 1.62, 1, 0, 0, Math.PI / 2);
      for (let i = 0; i < 260; i += 1) {
        const a = this.rng() * Math.PI * 2;
        const r = 3 + Math.sqrt(this.rng()) * 22;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const s = 0.09 + this.rng() * 0.05;
        this.put(p, 'red', new THREE.IcosahedronGeometry(s, 0), x, this.g(p.cx + x, p.cz + z) + 0.42 + this.rng() * 0.15, z);
      }
    },
    hollow_elder(this: Landmarks, p) {
      // The tree itself is grown by the forest (see Game); here, the dark
      // hollow in its trunk and a lantern hung in the crown.
      const a = 0.2 + (2 / 8) * Math.PI * 2;
      const hollow = new THREE.SphereGeometry(1, 16, 12);
      hollow.scale(0.75, 1.3, 0.3);
      this.put(p, 'dark', hollow, Math.cos(a) * 1.55, p.cy + 0.9, Math.sin(a) * 1.55, 0, -a + Math.PI / 2, 0);
      this.put(p, 'lamp', new THREE.OctahedronGeometry(0.4, 0), 4, p.cy + 24, 1);
      this.put(p, 'iron', new THREE.CylinderGeometry(0.02, 0.02, 3, 4), 4, p.cy + 25.8, 1);
    },
    trapper_cabin(this: Landmarks, p) {
      // Log cabin, chimney, drying rack, and traps in the grass.
      for (let r = 0; r < 8; r += 1) {
        const y = p.cy + 0.2 + r * 0.32;
        this.put(p, 'wood', new THREE.CylinderGeometry(0.17, 0.17, 5.4, 8), 0, y, -2, 0, 0, Math.PI / 2);
        if (r < 6 || r === 7) this.put(p, 'wood', new THREE.CylinderGeometry(0.17, 0.17, 5.4, 8), 0, y, 2, 0, 0, Math.PI / 2);
        this.put(p, 'wood', new THREE.CylinderGeometry(0.17, 0.17, 4.4, 8), -2.6, y, 0, Math.PI / 2, 0, 0);
        // The east side is the doorway, tall enough to walk in upright.
        if (r > 5) this.put(p, 'wood', new THREE.CylinderGeometry(0.17, 0.17, 4.4, 8), 2.6, y, 0, Math.PI / 2, 0, 0);
      }
      for (const side of [-1, 1]) this.put(p, 'plank', new THREE.BoxGeometry(6, 0.12, 2.8), 0, p.cy + 3.2, side * 1.2, side * 0.55, 0, 0);
      this.put(p, 'stone', new THREE.BoxGeometry(0.8, 4.2, 0.8), -2.3, p.cy + 2.1, -1.3);
      for (let i = 0; i < 3; i += 1) this.put(p, 'wood', new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5), 5 + i * 0.9, p.cy + 1.1, 3);
      this.put(p, 'wood', new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5), 5.9, p.cy + 2, 3, 0, 0, Math.PI / 2);
      this.put(p, 'cloth', new THREE.BoxGeometry(0.9, 0.7, 0.03), 5.5, p.cy + 1.55, 3);
      for (const [x, z] of [
        [8, -4],
        [-7, 5],
        [3, 8],
      ]) {
        this.put(p, 'iron', new THREE.TorusGeometry(0.3, 0.03, 4, 12), x, this.g(p.cx + x, p.cz + z) + 0.04, z, Math.PI / 2, 0, 0);
        this.traps.push({ x: p.cx + x, z: p.cz + z, sprung: false });
      }
    },
    duskhound_den(this: Landmarks, p) {
      for (let i = 0; i < 6; i += 1) this.rock(p, 'dark', 2700 + i, 'crag', 3 + this.rng() * 2, Math.cos(i) * 7, Math.sin(i) * 7 - 4, -0.6);
      for (let i = 0; i < 26; i += 1) {
        const x = (this.rng() - 0.5) * 12;
        const z = (this.rng() - 0.5) * 12;
        this.put(p, 'bone', new THREE.CylinderGeometry(0.04, 0.05, 0.6 + this.rng() * 0.5, 5), x, this.g(p.cx + x, p.cz + z) + 0.05, z, Math.PI / 2, this.rng() * 6, 0);
      }
      this.put(p, 'bone', new THREE.SphereGeometry(0.22, 8, 6), 1.5, this.g(p.cx + 1.5, p.cz + 1) + 0.15, 1);
    },
    fungus_ring(this: Landmarks, p) {
      const n = 44;
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        const r = 11 + (this.rng() - 0.5) * 0.8;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const s = 0.25 + this.rng() * 0.3;
        const y = this.g(p.cx + x, p.cz + z);
        this.put(p, 'bone', new THREE.CylinderGeometry(s * 0.25, s * 0.3, s * 1.2, 6), x, y + s * 0.6, z);
        this.put(p, 'fungus', new THREE.SphereGeometry(s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, y + s * 1.15, z);
      }
    },
    floating_isle(this: Landmarks, p) {
      // A torn-up hill of rock hanging in the air: roots trailing from its
      // underside, a ring of standing stones and a shrine on top, and the
      // rubble of what fell.
      const lift = 24;
      const top = p.cy + lift;
      const mass = new THREE.IcosahedronGeometry(1, 4);
      const pos = mass.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const yy = pos.getY(i);
        const z = pos.getZ(i);
        const n = 0.82 + this.rng() * 0.1 + 0.12 * Math.sin(x * 5 + z * 3) * Math.cos(yy * 4);
        // Flat on top, a long ragged point underneath.
        const down = yy < 0 ? 1 + -yy * 1.5 : 0.2;
        pos.setXYZ(i, x * 16 * n, yy * (yy < 0 ? 22 * n : 2) * (yy < 0 ? 1 : down), z * 16 * n);
      }
      mass.computeVertexNormals();
      this.put(p, 'rockDark', mass, 0, top - 1.2, 0);
      this.put(p, 'moss', new THREE.CylinderGeometry(15.2, 15.8, 1.1, 20), 0, top + 0.1, 0);
      // Roots hanging from the underside.
      for (let i = 0; i < 18; i += 1) {
        const a = this.rng() * Math.PI * 2;
        const r = 4 + this.rng() * 9;
        const len = 3 + this.rng() * 8;
        const root = new THREE.CylinderGeometry(0.04, 0.16, len, 4);
        this.put(p, 'wood', root, Math.cos(a) * r, top - 6 - (13 - r) * 0.9 - len / 2, Math.sin(a) * r, (this.rng() - 0.5) * 0.3, 0, (this.rng() - 0.5) * 0.3);
      }
      // Standing stones and the reliquary.
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        const h = 3.5 + (i % 3) * 1.6;
        this.put(p, 'stone', new THREE.BoxGeometry(1.1, h, 0.8), Math.cos(a) * 7.5, top + 0.6 + h / 2, Math.sin(a) * 7.5, 0, -a, (i % 2 ? 0.05 : -0.04));
      }
      const arch = voussoirArch(3, 0.6, 0.9, 9);
      this.put(p, 'stone', arch, 0, top + 3.4, -3.6);
      for (const side of [-1, 1]) this.put(p, 'stone', new THREE.BoxGeometry(0.8, 2.8, 0.9), side * 1.8, top + 2, -3.6);
      this.put(p, 'stone', new THREE.CylinderGeometry(3.5, 3.5, 0.6, 20), 0, top + 0.9, 0);
      this.put(p, 'song', new THREE.OctahedronGeometry(1.1, 0), 0, top + 3.2, 0);
      // Fallen rubble below where the reliquary landed: on the ground, so it
      // stays put while the isle drifts overhead.
      const fallen: Piece = { lm: p.lm, parts: new Map(), cx: p.cx, cy: p.cy, cz: p.cz };
      for (let i = 0; i < 8; i += 1) this.rock(fallen, 'dark', 2800 + i, 'boulder', 1 + this.rng() * 1.4, (this.rng() - 0.5) * 18, (this.rng() - 0.5) * 18, -0.3);
      this.flush(fallen, this.group);
    },
    echo_garden(this: Landmarks, p) {
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const h = 2 + this.rng() * 4;
        this.cyl(p, 'stone', 0.45, 0.55, h, Math.cos(a) * 9, Math.sin(a) * 9, -0.2, 10);
      }
      for (let i = 0; i < 40; i += 1) {
        const x = (this.rng() - 0.5) * 16;
        const z = (this.rng() - 0.5) * 16;
        const y = this.g(p.cx + x, p.cz + z);
        const s = 0.15 + this.rng() * 0.25;
        this.put(p, 'crystal', new THREE.CylinderGeometry(0.02, 0.03, s * 4, 4), x, y + s * 2, z);
        this.put(p, 'crystal', new THREE.OctahedronGeometry(s, 0), x, y + s * 4.2, z, 0, this.rng() * 3, 0);
      }
    },
    crystal_grotto(this: Landmarks, p) {
      this.caveMouth(p, 'crystal', 2800);
    },
    galleon(this: Landmarks, p) {
      // A tall-sided ship aground and listing on the sand, planks sprung
      // from her ribs amidships, masts snapped, the stern lamp still lit.
      const yaw = 0.4;
      const roll = 0.3;
      const place = (m: Mat, g: THREE.BufferGeometry, lift = 0) => {
        g.rotateX(roll);
        g.rotateY(yaw);
        this.put(p, m, g, 0, p.cy - 1.4 + lift, 0);
      };
      const ship = hull(30, 8.4, 5.6, [0.38, 0.56]);
      place('plank', ship.shell);
      place('wood', ship.ribs);
      place('plank', ship.deck);
      // Sterncastle with its windows.
      const castle = new THREE.BoxGeometry(6, 3.4, 7);
      castle.translate(-12, 7.6, 0);
      place('plank', castle);
      for (let k = -1; k <= 1; k += 1) {
        const win = new THREE.BoxGeometry(0.1, 1, 1.1);
        win.translate(-15.05, 7.8, k * 1.8);
        place(k === 0 ? 'glass' : 'dark', win);
      }
      // Masts: a snapped mainmast, a stump, and a spar fallen on the sand.
      for (const [x, h] of [
        [-3, 17],
        [7, 7],
      ] as [number, number][]) {
        const mast = new THREE.CylinderGeometry(0.26, 0.34, h, 8);
        mast.translate(x, 5.4 + h / 2, 0);
        place('wood', mast);
      }
      const yard = new THREE.CylinderGeometry(0.16, 0.2, 11, 6);
      yard.rotateX(Math.PI / 2);
      yard.translate(-3, 18, 0);
      place('wood', yard);
      const sail = new THREE.PlaneGeometry(9, 6, 6, 4);
      const sp = sail.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < sp.count; i += 1) sp.setZ(i, Math.sin(sp.getX(i) * 0.5) * 0.5 + Math.cos(sp.getY(i) * 0.7) * 0.3);
      sail.computeVertexNormals();
      sail.rotateY(Math.PI / 2);
      sail.translate(-2.8, 14.5, 0);
      place('cloth', sail);
      const fallen = new THREE.CylinderGeometry(0.25, 0.32, 14, 8);
      fallen.rotateZ(Math.PI / 2 - 0.08);
      this.put(p, 'wood', fallen, 10, this.g(p.cx + 10, p.cz + 8) + 0.3, 8, 0, 1.1, 0);
      // Planks and barrels spilled from the breach.
      for (let i = 0; i < 10; i += 1) {
        const x = 3 + this.rng() * 8;
        const z = 5 + this.rng() * 6;
        this.put(p, 'plank', new THREE.BoxGeometry(2.2 + this.rng() * 1.5, 0.08, 0.28), x, this.g(p.cx + x, p.cz + z) + 0.08, z, 0, this.rng() * 3, 0);
      }
      for (let i = 0; i < 3; i += 1) this.cyl(p, 'wood', 0.38, 0.32, 0.9, 6 + i * 1.6, 8 + (i % 2), 0, 12, i === 1 ? Math.PI / 2 : 0, 0);
    },
    lighthouse(this: Landmarks, p) {
      // A stone tower banded in red, a gallery with a rail, the lantern room
      // and its dome; a keeper's cottage beside it.
      const base = p.cy - 0.5;
      this.cyl(p, 'stone', 2.6, 3.6, 24, 0, 0, -0.5, 24);
      // Painted bands follow the shaft's taper (3.6 m at its foot to 2.6 m at
      // 24 m), standing just proud of the stone.
      const shaftR = (y: number) => 3.6 - (y + 0.5) / 24 + 0.03;
      for (let i = 0; i < 3; i += 1) {
        const y0 = 4 + i * 6.5;
        this.cyl(p, 'red', shaftR(y0 + 1.6), shaftR(y0), 1.6, 0, 0, y0, 24);
      }
      // Gallery and rail.
      this.put(p, 'dark', new THREE.CylinderGeometry(3.5, 3.1, 0.4, 24), 0, base + 24.2, 0);
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        this.put(p, 'iron', new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5), Math.cos(a) * 3.35, base + 24.95, Math.sin(a) * 3.35);
      }
      const rail = new THREE.TorusGeometry(3.35, 0.05, 5, 36);
      rail.rotateX(Math.PI / 2);
      this.put(p, 'iron', rail, 0, base + 25.5, 0);
      // Lantern room: a low parapet, glazing you see through between iron
      // mullions to the lens at its heart, a copper dome and vane.
      this.put(p, 'dark', new THREE.CylinderGeometry(1.95, 1.95, 0.7, 16), 0, base + 24.75, 0);
      this.put(p, 'iron', new THREE.CylinderGeometry(1.96, 1.96, 0.1, 16), 0, base + 26.95, 0);
      this.put(p, 'dark', new THREE.CylinderGeometry(0.35, 0.5, 0.9, 10), 0, base + 25.5, 0);
      this.put(p, 'glass', new THREE.CylinderGeometry(0.62, 0.62, 1.1, 16), 0, base + 26.2, 0);
      this.put(p, 'lamp', new THREE.SphereGeometry(0.28, 12, 8), 0, base + 26.2, 0);
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        this.put(p, 'iron', new THREE.BoxGeometry(0.12, 2.7, 0.12), Math.cos(a) * 1.93, base + 25.75, Math.sin(a) * 1.93);
      }
      this.put(p, 'dark', new THREE.SphereGeometry(2.1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, base + 27, 0);
      this.put(p, 'iron', new THREE.ConeGeometry(0.12, 1.4, 6), 0, base + 29.6, 0);
      // The keeper's cottage.
      const cx = 7;
      const cz = 4;
      const cf = this.g(p.cx + cx, p.cz + cz);
      const cw = wallWithOpenings(5, 3.2, 0.5, [{ x: -1, y: 1.2, w: 0.9, h: 1.1 }, { x: 1.2, y: 0.3, w: 1, h: 2.1 }]);
      this.put(p, 'stone', cw.clone(), cx, cf - 0.3, cz + 1.75);
      this.put(p, 'stone', cw, cx, cf - 0.3, cz - 1.75);
      const cs = new THREE.BoxGeometry(0.5, 3.2, 3);
      this.put(p, 'stone', cs.clone(), cx - 2.25, cf + 1.3, cz);
      this.put(p, 'stone', cs, cx + 2.25, cf + 1.3, cz);
      this.put(p, 'stone', gableEnds(4.5, 4, 1.8, 0.5), cx, cf + 2.9, cz);
      const roof = gableRoof(5, 4, 1.8, 0.35, 0.14, 1);
      this.put(p, 'slate', roof, cx, cf + 2.9, cz);
      this.put(p, 'stone', new THREE.BoxGeometry(0.7, 2.2, 0.7), cx + 1.6, cf + 4.2, cz);
      this.put(p, 'glass', new THREE.BoxGeometry(0.9, 1.1, 0.06), cx - 1, cf + 1.25, cz + 2.02);
      this.beam.position.set(p.cx, base + 25.8, p.cz);
      this.group.add(this.beam);
    },
    tide_pools(this: Landmarks, p) {
      for (let i = 0; i < 16; i += 1) this.rock(p, 'dark', 3000 + i, i % 3 ? 'slab' : 'boulder', 1 + this.rng() * 2, (this.rng() - 0.5) * 30, (this.rng() - 0.5) * 30, -0.4, 0.5);
      for (let i = 0; i < 30; i += 1) {
        const x = (this.rng() - 0.5) * 24;
        const z = (this.rng() - 0.5) * 24;
        this.put(p, i % 2 ? 'red' : 'bone', new THREE.ConeGeometry(0.12, 0.1, 5), x, this.g(p.cx + x, p.cz + z) + 0.05, z, 0, this.rng() * 6, 0);
      }
    },
    sunken_face(this: Landmarks, p) {
      // A colossal stone face gazing up out of the ash, half swallowed.
      const S = 13;
      const face = colossalFace(S, 71);
      face.rotateX(-0.22);
      face.rotateY(0.6);
      this.put(p, 'stone', face, 0, p.cy - S * 0.32, 0);
      // Song still glows in the sockets.
      for (const u of [-0.28, 0.28]) {
        const v = -0.16;
        const lift = Math.sqrt(1 - u * u - v * v) * S * 0.62 * 0.86;
        const eye = new THREE.SphereGeometry(0.9, 12, 8);
        eye.translate(u * S * 0.82, lift, v * S);
        eye.rotateX(-0.22);
        eye.rotateY(0.6);
        this.put(p, 'song', eye, 0, p.cy - S * 0.32, 0);
      }
      // Fallen fragments of the crown around it.
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2 + 0.3;
        this.rock(p, 'stone', 2900 + i, i % 2 ? 'slab' : 'crag', 1.2 + this.rng() * 1.4, Math.cos(a) * (S + 3), Math.sin(a) * (S + 3), -0.6, 0.8);
      }
    },
    old_persistence(this: Landmarks, p) {
      // A steam crawler: a boiler on a chassis, treads and a stack.
      this.box(p, 'iron', 8, 1.2, 4.4, 0, 0, 0.9, 0.2);
      for (const side of [-1, 1]) this.box(p, 'dark', 9, 1.6, 1.1, side * 0 + 0, side * 2.6, 0, 0.2);
      this.put(p, 'iron', new THREE.CylinderGeometry(1.7, 1.7, 6, 16), 0, p.cy + 3.6, 0, 0, 0.2, Math.PI / 2);
      this.put(p, 'brass', new THREE.CylinderGeometry(1.75, 1.75, 0.3, 16), 2.3, p.cy + 3.6, 0.46, 0, 0.2, Math.PI / 2);
      this.put(p, 'iron', new THREE.CylinderGeometry(0.4, 0.5, 5, 10), -2.5, p.cy + 6.5, -0.5, 0, 0.2, 0);
      this.put(p, 'lava', new THREE.BoxGeometry(0.9, 0.6, 0.1), 3.1, p.cy + 2.9, 0.62, 0, 0.2, 0);
      this.put(p, 'plank', new THREE.BoxGeometry(2.4, 2.2, 2.6), -3.6, p.cy + 3.2, 0, 0, 0.2, 0);
    },
    hot_springs(this: Landmarks, p) {
      for (let i = 0; i < 14; i += 1) {
        const a = (i / 14) * Math.PI * 2;
        this.rock(p, 'stone', 3200 + i, 'boulder', 0.9 + this.rng() * 0.8, Math.cos(a) * 9, Math.sin(a) * 9, -0.3, 0.7);
      }
      this.box(p, 'plank', 3, 0.15, 3, 12, 2, 0.4);
      for (const [x, z] of [
        [10.8, 0.8],
        [13.2, 0.8],
        [10.8, 3.2],
        [13.2, 3.2],
      ]) this.cyl(p, 'wood', 0.08, 0.08, 2.4, x, z, 0, 6);
      this.put(p, 'cloth', new THREE.BoxGeometry(3.2, 0.1, 3.2), 12, this.g(p.cx + 12, p.cz + 2) + 2.5, 2, 0.1, 0, 0);
    },
    lava_tubes(this: Landmarks, p) {
      this.caveMouth(p, 'lava', 3300);
    },
    monastery(this: Landmarks, p) {
      // A hall of dressed stone with round-headed windows and a slate roof,
      // a belfry tower whose bells have no clappers, and a walled court.
      const floor = this.g(p.cx, p.cz);
      const W = 14;
      const D = 9;
      const H = 7;
      const t = 0.8;
      const side = (y0: number) => [
        { x: -4.2, y: y0, w: 1.3, h: 3.2, arched: true },
        { x: 0, y: y0, w: 1.3, h: 3.2, arched: true },
        { x: 4.2, y: y0, w: 1.3, h: 3.2, arched: true },
      ];
      const long = wallWithOpenings(W, H + 1, t, side(3));
      this.put(p, 'stone', long.clone(), 0, floor - 1, D / 2 - t / 2);
      this.put(p, 'stone', long, 0, floor - 1, -D / 2 + t / 2);
      const end = wallWithOpenings(D - t * 2, H + 1, t, [{ x: 0, y: 1, w: 2, h: 3.6, arched: true }]);
      end.rotateY(Math.PI / 2);
      this.put(p, 'stone', end.clone(), -W / 2 + t / 2, floor - 1, 0);
      const back = wallWithOpenings(D - t * 2, H + 1, t, [{ x: 0, y: 4.2, w: 1.1, h: 2.2, arched: true }]);
      back.rotateY(Math.PI / 2);
      this.put(p, 'stone', back, W / 2 - t / 2, floor - 1, 0);
      // Buttresses between the windows.
      for (const x of [-6.3, -2.1, 2.1, 6.3]) {
        for (const s of [-1, 1]) {
          const b = new THREE.BoxGeometry(0.7, 5.5, 1.1);
          this.put(p, 'stone', b, x, floor + 1.75, s * (D / 2 + 0.45));
          const cap = new THREE.BoxGeometry(0.72, 0.5, 1.3);
          this.put(p, 'dark', cap, x, floor + 4.6, s * (D / 2 + 0.35), s * 0.5, 0, 0);
        }
      }
      // Gable ends and the roof.
      const ends = gableEnds(W - t, D, 4, t);
      this.put(p, 'stone', ends, 0, floor + H, 0);
      this.put(p, 'slate', gableRoof(W, D, 4, 0.5, 0.18, 1.1), 0, floor + H, 0);
      this.put(p, 'dark', new THREE.BoxGeometry(W + 1, 0.25, 0.3), 0, floor + H + 4.05, 0);
      // One window still warm inside.
      this.put(p, 'glass', new THREE.BoxGeometry(1.2, 2.6, 0.08), 0, floor + 3.3, D / 2 - t / 2);
      for (const x of [-4.2, 4.2]) this.put(p, 'dark', new THREE.BoxGeometry(1.2, 2.6, 0.08), x, floor + 3.3, D / 2 - t / 2);
      // Door and steps.
      this.put(p, 'plank', new THREE.BoxGeometry(0.12, 2.8, 1.8), -W / 2 + 0.2, floor + 1.4, 0);
      const st = stairs(2.6, 4, 0.18, 0.4);
      st.rotateY(-Math.PI / 2);
      this.put(p, 'stone', st, -W / 2 - 0.1, floor - 0.72, 0);
      // The belfry tower.
      const tx = W / 2 + 2.2;
      const tz = -D / 2 + 2;
      const tf = this.g(p.cx + tx, p.cz + tz);
      const TH = 17;
      for (const [rx, rz, ry] of [
        [0, 2, 0],
        [0, -2, 0],
        [2, 0, Math.PI / 2],
        [-2, 0, Math.PI / 2],
      ] as [number, number, number][]) {
        const w = wallWithOpenings(ry ? 2.4 : 4, TH + 1, 0.8, [{ x: 0, y: TH - 5.2, w: ry ? 1.3 : 1.6, h: 3.6, arched: true }]);
        w.rotateY(ry);
        this.put(p, 'stone', w, tx + rx * 0.8, tf - 1, tz + rz * 0.8);
      }
      this.put(p, 'dark', new THREE.BoxGeometry(4.9, 0.4, 4.9), tx, tf + TH + 0.2, tz);
      const spire = new THREE.ConeGeometry(3.6, 6, 4);
      spire.rotateY(Math.PI / 4);
      this.put(p, 'slate', spire, tx, tf + TH + 3.4, tz);
      for (let i = 0; i < 2; i += 1) this.put(p, 'brass', new THREE.CylinderGeometry(0.4, 0.75, 1.1, 14, 1, true), tx - 0.6 + i * 1.2, tf + TH - 3.2, tz);
      // The court: a low wall with a gate.
      for (const [x, z, w, d] of [
        [-3, 11, 22, 0.8],
        [-14, 1, 0.8, 20],
      ] as [number, number, number, number][]) this.box(p, 'stone', w, 2.2, d, x, z, -0.3);
      const gate = wallWithOpenings(4, 3.6, 0.9, [{ x: 0, y: 0.3, w: 2, h: 3, arched: true }]);
      this.put(p, 'stone', gate, 9.5, this.g(p.cx + 9.5, p.cz + 11) - 0.3, 11);
    },
    sled_camp(this: Landmarks, p) {
      for (const [x, z, yaw] of [
        [-4, 0, 0.3],
        [4, 2, -0.5],
        [0, -5, 1.2],
      ]) {
        const tent = new THREE.CylinderGeometry(0.01, 2, 2.2, 4, 1, true);
        this.put(p, 'cloth', tent, x, this.g(p.cx + x, p.cz + z) + 1.1, z, 0, yaw + Math.PI / 4, 0);
      }
      this.box(p, 'plank', 2, 0.1, 1, 1, 6, 0.8);
      for (let i = 0; i < 3; i += 1) this.put(p, 'iron', new THREE.CylinderGeometry(0.12, 0.1, 0.1, 10), 0.4 + i * 0.6, this.g(p.cx + 1, p.cz + 6) + 0.9, 6);
      this.box(p, 'wood', 3.2, 0.2, 1.1, -6, 6, 0.3, 0.4);
      for (const side of [-1, 1]) this.put(p, 'wood', new THREE.BoxGeometry(3.6, 0.08, 0.08), -6 + side * 0.2, this.g(p.cx - 6, p.cz + 6) + 0.1, 6 + side * 0.5, 0, 0.4, 0);
      for (let i = 0; i < 4; i += 1) this.box(p, 'plank', 0.8, 0.6, 0.8, 5 + i * 0.3, -4 + i * 0.9, 0);
    },
    ice_caves(this: Landmarks, p) {
      this.caveMouth(p, 'ice', 3500);
    },
    frozen_titan(this: Landmarks, p) {
      // A stone colossus locked in the glacier to the waist, one hand raised
      // to the sky; its face is the island's old face, eyes still lit.
      const y = p.cy - 6;
      const torso = new THREE.CylinderGeometry(5.2, 4.2, 14, 10, 3);
      torso.scale(1, 1, 0.62);
      this.put(p, 'dark', torso, 0, y + 13, 0);
      // Shoulders and a heavy collar.
      for (const side of [-1, 1]) this.put(p, 'dark', new THREE.SphereGeometry(2.6, 14, 10), side * 5.4, y + 19.2, 0);
      this.put(p, 'stone', new THREE.TorusGeometry(3.2, 0.7, 8, 20), 0, y + 20.3, 0, Math.PI / 2, 0, 0);
      // The head: the old face, looking out over the ice.
      const face = colossalFace(3.3, 31);
      face.rotateX(Math.PI / 2 - 0.15);
      this.put(p, 'dark', face, 0, y + 24.2, -0.4);
      // Rotated upright, the face looks toward +z: the eyes sit there.
      for (const side of [-1, 1]) this.put(p, 'song', new THREE.SphereGeometry(0.34, 10, 8), side * 0.76, y + 24.95, -0.4 + 1.5);
      // The raised arm (upper arm, forearm, an open hand).
      const upper = new THREE.CapsuleGeometry(1.35, 7.5, 4, 10);
      this.put(p, 'dark', upper, -7.2, y + 23.5, 0, 0, 0, -0.5);
      const fore = new THREE.CapsuleGeometry(1.15, 6.5, 4, 10);
      this.put(p, 'dark', fore, -9.6, y + 31, -0.4, 0, 0, 0.12);
      this.put(p, 'dark', new THREE.BoxGeometry(2.4, 2.4, 1), -10.1, y + 35.4, -0.5, 0, 0, 0.12);
      for (let f = 0; f < 4; f += 1) this.put(p, 'dark', new THREE.CapsuleGeometry(0.28, 1.6, 3, 6), -11 + f * 0.6, y + 37.3, -0.5, 0, 0, 0.12 - 0.06 * (f - 1.5));
      this.put(p, 'dark', new THREE.CapsuleGeometry(0.3, 1.3, 3, 6), -8.6, y + 36, -0.4, 0, 0, -0.9);
      // The other arm, lowered into the ice.
      this.put(p, 'dark', new THREE.CapsuleGeometry(1.35, 9, 4, 10), 6.6, y + 13.5, 0.2, 0, 0, 0.18);
      // The glacier locking it in, and icicles hanging from the raised arm.
      const ice = new THREE.CylinderGeometry(10, 13, 15, 16, 3);
      const pos = ice.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 1) pos.setXYZ(i, pos.getX(i) * (0.82 + this.rng() * 0.36), pos.getY(i) + (this.rng() - 0.5) * 1.2, pos.getZ(i) * (0.82 + this.rng() * 0.36));
      ice.computeVertexNormals();
      this.put(p, 'ice', ice, 0, p.cy + 2, 0);
      for (let i = 0; i < 10; i += 1) {
        const icicle = new THREE.ConeGeometry(0.18 + this.rng() * 0.2, 1.2 + this.rng() * 2.2, 6);
        icicle.rotateX(Math.PI);
        this.put(p, 'ice', icicle, -7 - this.rng() * 3, y + 25 + this.rng() * 5, -0.4 + (this.rng() - 0.5) * 1.6);
      }
    },
    aurora_overlook(this: Landmarks, p) {
      // A round platform one step up, ringed with cairns.
      this.cyl(p, 'stone', 5, 5.4, 0.8, 0, 0, -0.4, 20);
      p.cacheY = p.cy + 0.4;
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        for (let k = 0; k < 4; k += 1) this.rock(p, 'stone', 3500 + i * 4 + k, 'pebble', 0.6 - k * 0.1, Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0.4 + k * 0.45);
      }
      this.put(p, 'brass', new THREE.TorusGeometry(1.2, 0.08, 6, 24), 0, p.cy + 1.8, 0, Math.PI / 2 - 0.5, 0, 0);
      this.cyl(p, 'dark', 0.12, 0.15, 1.3, 0, 0, 0.5, 8);
    },
    stilt_village(this: Landmarks, p) {
      // Plank huts on stilts over the fen, with doors, shuttered windows and
      // reed-thatched roofs; boardwalks between them and a ladder down.
      const houses: [number, number, number][] = [
        [0, 0, 0],
        [9, 4, 0.5],
        [-8, 6, -0.4],
        [4, -9, 1.2],
        [-6, -7, 2],
      ];
      const deck = this.world.waterLevelAt(p.cx, p.cz) + 1.6;
      const W = 3.6;
      // Tall enough that the eaves clear a head on the ledge below them.
      const Hh = 2.7;
      for (const [x, z, yaw] of houses) {
        const rot = (dx: number, dz: number): [number, number] => [x + dx * Math.cos(yaw) - dz * Math.sin(yaw), z + dx * Math.sin(yaw) + dz * Math.cos(yaw)];
        for (const [a, b] of [
          [-1.8, -1.8],
          [1.8, -1.8],
          [-1.8, 1.8],
          [1.8, 1.8],
        ]) {
          const [px, pz] = rot(a, b);
          const base = this.g(p.cx + px, p.cz + pz);
          const h = deck + 0.3 - base;
          if (h > 0) this.put(p, 'wood', new THREE.CylinderGeometry(0.14, 0.17, h + 0.6, 6), px, base - 0.3 + (h + 0.6) / 2, pz);
        }
        // The deck runs a metre out past the walls: a ledge to walk round
        // from the door to the boardwalks.
        this.put(p, 'plank', new THREE.BoxGeometry(5.6, 0.2, 5.6), x, deck + 0.3, z, 0, yaw, 0);
        // Walls: a door at the front, a window each side.
        const walls: [number, number, number, { x: number; y: number; w: number; h: number }[]][] = [
          [0, W / 2, 0, [{ x: 0.5, y: 0.15, w: 0.9, h: 1.8 }]],
          [0, -W / 2, 0, [{ x: -0.4, y: 1, w: 0.8, h: 0.7 }]],
          [W / 2, 0, Math.PI / 2, [{ x: 0, y: 1, w: 0.8, h: 0.7 }]],
          [-W / 2, 0, Math.PI / 2, []],
        ];
        for (const [dx, dz, ry, holes] of walls) {
          const g = wallWithOpenings(ry ? W - 0.2 : W + 0.2, Hh, 0.12, holes);
          g.rotateY(ry + yaw);
          const [wx, wz] = rot(dx, dz);
          this.put(p, 'plank', g, wx, deck + 0.4, wz);
        }
        const ends = gableEnds(W, W, 1.5, 0.12);
        ends.rotateY(yaw);
        this.put(p, 'plank', ends, x, deck + 0.4 + Hh, z);
        const roof = gableRoof(W, W, 1.5, 0.55, 0.22, 0.9);
        roof.rotateY(yaw);
        this.put(p, 'thatch', roof, x, deck + 0.4 + Hh, z);
        // A lamp by the door.
        const [lx, lz] = rot(1.4, W / 2 + 0.15);
        this.put(p, 'glass', new THREE.BoxGeometry(0.2, 0.28, 0.2), lx, deck + 2.2, lz);
      }
      for (let i = 0; i < houses.length - 1; i += 1) {
        const [ax, az] = houses[0];
        const [bx, bz] = houses[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        this.put(p, 'plank', new THREE.BoxGeometry(0.9, 0.12, len), (ax + bx) / 2, deck + 0.35, (az + bz) / 2, 0, Math.atan2(bx - ax, bz - az), 0);
        // Posts along the walk.
        for (let k = 1; k < 4; k += 1) {
          const t = k / 4;
          const px = ax + (bx - ax) * t;
          const pz = az + (bz - az) * t;
          const base = this.g(p.cx + px, p.cz + pz);
          const h = deck + 0.35 - base;
          if (h > 0) this.put(p, 'wood', new THREE.CylinderGeometry(0.1, 0.12, h + 0.5, 5), px, base - 0.5 + (h + 0.5) / 2, pz);
        }
      }
      // Steep plank steps from the fen floor up to the first hut, the way up
      // out of the water, with a punt moored alongside.
      const water = this.world.waterLevelAt(p.cx + 2, p.cz + 4);
      const foot = this.g(p.cx + 2, p.cz + 5);
      const flight = deck + 0.4 - foot;
      const treads = Math.ceil(flight / 0.3);
      const steps = stairs(0.8, treads, flight / treads, 0.3);
      steps.rotateY(Math.PI);
      this.put(p, 'plank', steps, 2, foot, 2.8 + treads * 0.3);
      this.put(p, 'plank', new THREE.BoxGeometry(1.2, 0.3, 3.6), 3, water + 0.1, 4.2);
      p.cacheY = deck + 0.4;
    },
    ziggurat(this: Landmarks, p) {
      // Five dressed terraces climbing to a shrine, one grand stair up the
      // front from the mud to the top, song-lines in the risers, and a
      // corner or two fallen away.
      const base = this.g(p.cx, p.cz) - 1.5;
      const H = 3;
      for (let k = 0; k < 5; k += 1) {
        const s = 22 - k * 4;
        const y = base + k * H;
        this.put(p, k % 2 ? 'stone' : 'dark', new THREE.BoxGeometry(s, H, s), 0, y + H / 2, 0);
        // A cornice lip round each terrace.
        this.put(p, 'dark', new THREE.BoxGeometry(s + 0.4, 0.3, s + 0.4), 0, y + H - 0.15, 0);
        // The glowing lines in the front riser, either side of the stair.
        for (const side of [-1, 1]) this.put(p, 'song', new THREE.BoxGeometry(s * 0.2, 0.16, 0.12), side * (2.2 + s * 0.12), y + H * 0.55, s / 2 + 0.05);
        // A fallen corner block on the lower terraces.
        if (k < 3) this.rock(p, 'stone', 3600 + k, 'slab', 1.1 + k * 0.2, (k % 2 ? 1 : -1) * (s / 2 + 1.5), (k % 2 ? -1 : 1) * (s / 2 - 1), -0.3, 0.7);
      }
      // The stair: 45 steps of a third of a metre, from well out in front up
      // to the top terrace's edge, with a low wall down each side.
      const treads = 45;
      const run = 0.4;
      const flight = stairs(3.2, treads, (5 * H) / treads, run);
      flight.rotateY(Math.PI);
      this.put(p, 'stone', flight, 0, base, 3 + treads * run);
      for (const side of [-1, 1]) {
        for (let k = 0; k < treads; k += 3) {
          const z = 3 + (treads - k) * run - run * 1.5;
          const top = base + ((k + 3) * 5 * H) / treads;
          this.put(p, 'dark', new THREE.BoxGeometry(0.5, 1.9, run * 3), side * 1.85, top - 0.25, z);
        }
      }
      // The shrine: four columns, a slab roof and the song within.
      const top = base + 5 * H;
      p.cacheY = top;
      for (const [x, z] of [
        [-1.6, -1.6],
        [1.6, -1.6],
        [-1.6, 1.6],
        [1.6, 1.6],
      ] as [number, number][]) this.put(p, 'stone', new THREE.CylinderGeometry(0.32, 0.38, 3.2, 12), x, top + 1.6, z);
      this.put(p, 'dark', new THREE.BoxGeometry(4.6, 0.5, 4.6), 0, top + 3.45, 0);
      const cap = new THREE.ConeGeometry(3.3, 1.6, 4);
      cap.rotateY(Math.PI / 4);
      this.put(p, 'stone', cap, 0, top + 4.5, 0);
      this.put(p, 'song', new THREE.OctahedronGeometry(0.7, 0), 0, top + 1.7, 0);
      this.put(p, 'moss', new THREE.CylinderGeometry(15, 17, 2.6, 16), 0, this.g(p.cx, p.cz) - 0.6, 0);
    },
    lanternfly_hollow(this: Landmarks, p) {
      for (let i = 0; i < 12; i += 1) this.rock(p, 'moss', 3600 + i, 'boulder', 0.8 + this.rng(), (this.rng() - 0.5) * 30, (this.rng() - 0.5) * 30, -0.3, 0.6);
    },
    // The Sunwells build their own courts (Sunwells.ts); only the cache is set here.
    dawnwell() {},
    noonwell() {},
    duskwell() {},
  };

  /** Night factor 0..1; `camera` for distance culling of the dynamic bits. */
  update(dt: number, night: number, camera: THREE.Vector3): void {
    this.time += dt;
    // The lighthouse turns its beam across the sea after dusk.
    this.beam.rotation.y = this.time * 0.35;
    this.beamMaterial.uniforms.uIntensity.value = 0.55 * night;
    this.beam.visible = night > 0.05;
    this.m.lamp.emissiveIntensity = 1 + 4 * night;
    this.m.glass.emissiveIntensity = 0.6 + 2.4 * night;
    this.m.fungus.emissiveIntensity = 0.6 + 2.4 * night + 0.3 * Math.sin(this.time * 1.3);
    // The floating isle breathes up and down.
    this.isle.position.y = Math.sin(this.time * 0.25) * 0.6;
    this.isle.rotation.y = Math.sin(this.time * 0.05) * 0.03;
    // Lanternflies drift at dusk and night.
    const lf = LANDMARKS.find((l) => l.id === 'lanternfly_hollow') as LandmarkDef;
    const near = Math.hypot(camera.x - lf.x, camera.z - lf.z) < 300;
    this.flies.visible = near && night > 0.15;
    if (this.flies.visible) {
      this.flyMaterial.opacity = Math.min(1, night * 1.4) * (0.7 + 0.3 * Math.sin(this.time * 2));
      const pos = this.flies.geometry.getAttribute('position') as THREE.BufferAttribute;
      const t = this.time;
      for (let i = 0; i < pos.count; i += 1) {
        const k = i * 3;
        pos.setXYZ(i, this.flyBase[k] + Math.sin(t * 0.3 + i) * 1.6, this.flyBase[k + 1] + Math.sin(t * 0.7 + i * 1.7) * 0.8, this.flyBase[k + 2] + Math.cos(t * 0.27 + i * 0.6) * 1.6);
      }
      pos.needsUpdate = true;
    }
    // Jonah Reed's traps are still set.
    const p = this.hooks.playerPosition();
    for (const trap of this.traps) {
      if (trap.sprung) continue;
      if (Math.hypot(p.x - trap.x, p.z - trap.z) < 0.45) {
        trap.sprung = true;
        this.hooks.damage(14, 'a trap');
        this.hooks.say('', 'Iron jaws snap shut on your boot. His traps are still set.', 4);
      }
    }
  }
}
