import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { getRockTexture } from '../render/props/rockTexture';
import { applyTriplanar, getStoneTextures } from '../render/props/stoneTextures';
import { generateRock } from '../world/props/RockGenerator';
import type { WorldData } from '../world/WorldData';
import { LANDMARKS } from '../world/WorldLayout';
import { merge, voussoirArch } from './landmarkKit';
import type { Interactable } from './StoryWorld';
import { doorSpot, DX, DZ, isSolved, solveSunwell, SUNWELL_CELL, SUNWELL_LAYOUTS, SUNWELL_PARAPET as PARAPET, traceBeam, turn, type Dir, type SunwellLayout } from './sunwellLogic';

// The Veyr Sunwells: paved courts where a lens gathers the sun and throws
// it across the flagstones as a beam. Crystal prisms on bronze turntables
// send the beam out of whichever side they face; turn them until the light
// reaches the sun disc on the vault door, and the door sinks into the
// ground. The rules live in `sunwellLogic.ts`; this is the stonework, the
// light and the turning.

/** Height of the beam above the flagstones. */
const BEAM_Y = 1.35;
const TURN_TIME = 0.32;
const DOOR_TIME = 3.2;
/** Specks of dust drifting through each court's light. */
const MOTES = 48;

/** A soft round glow, white at the middle, for flares and dust. */
function glowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export interface SunwellHooks {
  hasFlag(flag: string): boolean;
  setFlag(flag: string): void;
  say(speaker: string, text: string, seconds?: number): void;
  /** A crystal turning on its bronze bearing, at (x, y, z). */
  turned(index: number, x: number, y: number, z: number): void;
  /** Light reached the disc: the door is opening. */
  opened(id: string, name: string): void;
  /** 0 at night .. 1 in full sun. */
  sunlight(): number;
}

interface Prism {
  cell: [number, number];
  facing: Dir;
  head: THREE.Group;
  crystal: THREE.Mesh;
  angle: number;
  /** Seconds left in a turn. */
  turning: number;
  x: number;
  z: number;
}

interface Site {
  layout: SunwellLayout;
  name: string;
  cx: number;
  cz: number;
  y: number;
  prisms: Prism[];
  beams: THREE.Mesh[];
  lens: THREE.Mesh;
  disc: THREE.Mesh;
  /** This court's own bronze sun, so it glows only when its light arrives. */
  discMat: THREE.MeshStandardMaterial;
  door: THREE.Group;
  /** 0 shut .. 1 sunk. */
  open: number;
  solved: boolean;
  /** Seconds since the light first reached the disc. */
  since: number;
  colliders: { x: number; z: number; radius: number; height: number; baseY?: number; door?: boolean }[];
  /** Beam path in world space, for tests and the HUD. */
  path: THREE.Vector3[];
  end: string;
  /** Prisms the light reaches, in order. */
  lit: number[];
  /** Dust in the light: along the beam (0..1), angle and distance off its axis, twinkle phase. */
  motes: THREE.Points;
  moteSeeds: Float32Array;
  /** Glows where the light gathers: the lens, each lit prism, the sun on the door. */
  flares: THREE.Sprite[];
}

function mat(color: number, roughness = 0.85, metalness = 0, emissive = 0, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
}

const NAMES: Record<string, string> = { dawnwell: 'the Dawnwell', noonwell: 'the Noonwell', duskwell: 'the Duskwell' };

export class Sunwells {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly sites: Site[] = [];
  private readonly m: {
    stone: THREE.MeshStandardMaterial;
    dark: THREE.MeshStandardMaterial;
    paving: THREE.MeshStandardMaterial;
    rock: THREE.MeshStandardMaterial;
    brass: THREE.MeshStandardMaterial;
    crystal: THREE.MeshStandardMaterial;
    lit: THREE.MeshStandardMaterial;
    lens: THREE.MeshStandardMaterial;
    disc: THREE.MeshStandardMaterial;
    moss: THREE.MeshStandardMaterial;
  };
  private readonly beamMaterial: THREE.ShaderMaterial;
  private readonly beamGeometry: THREE.CylinderGeometry;
  private readonly glow = glowTexture();
  private readonly flareMaterial: THREE.SpriteMaterial;
  private readonly moteMaterial: THREE.PointsMaterial;
  private time = 0;

  constructor(
    private readonly world: WorldData,
    interactables: Interactable[],
    private readonly hooks: SunwellHooks,
  ) {
    this.m = {
      stone: mat(0xe6dcc6, 0.88),
      dark: mat(0x9a9284, 0.9),
      paving: mat(0xcfc4ae, 0.93),
      rock: mat(0xc8bea8, 0.92),
      brass: mat(0xb08a48, 0.32, 1),
      crystal: mat(0xd8e4ff, 0.06, 0, 0x6a7cff, 0.25),
      lit: mat(0xfff0c8, 0.05, 0, 0xffc860, 3.2),
      lens: mat(0x2a2010, 0.08, 0.2, 0xffd890, 0.2),
      disc: mat(0xa8844a, 0.3, 1, 0xffb040, 0),
      moss: mat(0x6b7a3e, 0.97),
    };
    for (const m of Object.values(this.m)) this.materials.push(m);
    const stone = getStoneTextures();
    applyTriplanar(this.m.stone, stone.masonry, 2.4, 1);
    applyTriplanar(this.m.dark, stone.masonry, 1.8, 1.2);
    // Each flagstone is one great slab: a jointless worn face, tiled at a
    // size that is not the cell's, so no two slabs look alike.
    applyTriplanar(this.m.paving, stone.slab, 4.3, 0.9);
    applyTriplanar(this.m.rock, getRockTexture(), 2.6, 1.2);

    // The beam: a hot, narrow core inside a soft sheath of lit air, with a
    // slow shimmer running along it like heat. The cylinder is wide; how far
    // across it a pixel looks decides how bright it is.
    this.beamMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vAxis;
        varying float vAlong;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vec3 axis = normalize(modelMatrix[2].xyz);
          vAlong = dot(world.xyz, axis);
          vec4 mv = viewMatrix * world;
          vN = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          vAxis = normalize(mat3(viewMatrix) * axis);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vAxis;
        varying float vAlong;
        void main() {
          // Seen at a slant, the eye's line runs partly along the beam; only
          // the part across it says how near this pixel is to the axis.
          vec3 axis = normalize(vAxis);
          vec3 view = normalize(vView);
          vec3 perp = view - axis * dot(view, axis);
          float slant = length(perp);
          float facing = abs(dot(normalize(vN), perp / max(slant, 1e-4)));
          // 0 looking through the axis, 1 at the rim.
          float across = sqrt(max(0.0, 1.0 - facing * facing));
          float core = exp(-across * across / 0.016);
          float sheath = exp(-across * across / 0.2);
          float shimmer = 0.8 + 0.2 * sin(vAlong * 2.3 - uTime * 3.1) * sin(vAlong * 0.7 + uTime * 1.3);
          // Straight down the axis there is no across; the flares at the
          // ends carry the light there.
          float endOn = smoothstep(0.03, 0.2, slant);
          vec3 col = vec3(1.0, 0.83, 0.55) * (core * 16.0 + sheath * 0.9) * shimmer * endOn * uIntensity;
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.beamGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, true);
    this.beamGeometry.translate(0, 0.5, 0);
    this.beamGeometry.rotateX(Math.PI / 2);
    this.flareMaterial = new THREE.SpriteMaterial({ map: this.glow, color: 0xffd79a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false });
    this.moteMaterial = new THREE.PointsMaterial({ map: this.glow, size: 0.06, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false });

    for (const layout of SUNWELL_LAYOUTS) {
      const lm = LANDMARKS.find((l) => l.id === layout.id);
      if (!lm) continue;
      const site = this.build(layout, lm.x, lm.z, lm.name);
      this.sites.push(site);
      const s = this.sites.length - 1;
      site.prisms.forEach((p, i) => {
        interactables.push({
          id: `sunwell:${layout.id}:${i}`,
          position: new THREE.Vector3(p.x, site.y + BEAM_Y, p.z),
          radius: 0.95,
          prompt: () => (site.solved ? null : { key: 'E', text: 'Turn the prism' }),
          use: () => this.turnPrism(s, i),
        });
      });
      const [lc, lr] = [layout.emitter.cell[0] - DX[layout.emitter.dir], layout.emitter.cell[1] - DZ[layout.emitter.dir]];
      const lensAt = this.cellWorld(site, lc, lr);
      interactables.push({
        id: `sunwell:${layout.id}:lens`,
        position: new THREE.Vector3(lensAt.x, site.y + BEAM_Y, lensAt.z),
        radius: 1.1,
        prompt: () => (this.hooks.sunlight() < 0.05 ? { key: null, text: 'The lens is dark. It waits for the sun.' } : null),
        use: () => {},
      });
      const door = this.doorWorld(site);
      interactables.push({
        id: `sunwell:${layout.id}:door`,
        position: new THREE.Vector3(door.x, site.y + BEAM_Y, door.z),
        radius: 1.4,
        prompt: () => (site.solved ? null : { key: null, text: 'A bronze sun is set in the door. It is cold.' }),
        use: () => {},
      });
      if (this.hooks.hasFlag(`lit:${layout.id}`)) this.restoreSolved(site);
      this.retrace(site);
    }
  }

  // ---------------------------------------------------------------------------
  // Placement

  private cellWorld(site: { cx: number; cz: number; layout: SunwellLayout }, c: number, r: number): { x: number; z: number } {
    const half = (site.layout.size - 1) / 2;
    return { x: site.cx + (c - half) * SUNWELL_CELL, z: site.cz + (r - half) * SUNWELL_CELL };
  }

  /** The vault door sits in the parapet where the beam must leave. */
  private doorWorld(site: { cx: number; cz: number; layout: SunwellLayout }): { x: number; z: number } {
    const [x, z] = doorSpot(site.layout);
    return { x: site.cx + x, z: site.cz + z };
  }

  // ---------------------------------------------------------------------------
  // Building

  private build(layout: SunwellLayout, cx: number, cz: number, name: string): Site {
    const rng = createRng(0x5e11 + layout.id.length * 131 + Math.round(cx));
    const y = this.world.groundAt(cx, cz);
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (m: THREE.Material, g: THREE.BufferGeometry) => {
      const list = parts.get(m) ?? [];
      list.push(g);
      parts.set(m, list);
    };
    const colliders: Site['colliders'] = [];
    const site: Site = {
      layout,
      name: NAMES[layout.id] ?? name,
      cx,
      cz,
      y,
      prisms: [],
      beams: [],
      lens: null as unknown as THREE.Mesh,
      disc: null as unknown as THREE.Mesh,
      discMat: this.m.disc.clone(),
      door: new THREE.Group(),
      open: 0,
      solved: false,
      since: 0,
      colliders,
      path: [],
      end: 'held',
      lit: [],
      motes: new THREE.Points(new THREE.BufferGeometry(), this.moteMaterial),
      moteSeeds: new Float32Array(MOTES * 4),
      flares: [],
    };
    const L = SUNWELL_CELL;
    const extent = PARAPET * L;
    const box = (m: THREE.Material, w: number, h: number, d: number, x: number, yy: number, z: number, ry = 0, rx = 0, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.rotateX(rx);
      g.rotateZ(rz);
      g.rotateY(ry);
      g.translate(x, yy, z);
      add(m, g);
    };
    // Moss grows in low cushions where feet never go: against the foot of
    // the walls and round the pillars.
    const cushion = (x: number, z: number, s: number) => {
      const g = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const a = rng() * 10;
      for (let i = 0; i < pos.count; i += 1) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const lump = 0.8 + 0.2 * Math.sin(vx * 3.1 + a) * Math.cos(vz * 2.7 + a * 1.3);
        pos.setXYZ(i, vx * s * lump, Math.max(-0.2, vy) * s * 0.2 * lump, vz * s * 0.8 * lump);
      }
      g.computeVertexNormals();
      g.rotateY(rng() * Math.PI);
      g.translate(x, y + 0.02, z);
      add(this.m.moss, g);
    };

    // Flagstones: one great slab per cell, a border of smaller ones, each
    // settled a little differently.
    for (let r = -1; r <= layout.size; r += 1) {
      for (let c = -1; c <= layout.size; c += 1) {
        const border = r < 0 || c < 0 || r >= layout.size || c >= layout.size;
        const w = this.cellWorld(site, c, r);
        const tilt = border ? 0.02 : 0.01;
        const sink = border ? rng() * 0.08 : rng() * 0.03;
        if (border) {
          for (let k = 0; k < 4; k += 1) {
            const ox = (k % 2 === 0 ? -0.5 : 0.5) * L * 0.5;
            const oz = (k < 2 ? -0.5 : 0.5) * L * 0.5;
            if (rng() < 0.12) continue;
            box(this.m.paving, L * 0.48, 0.3, L * 0.48, w.x + ox, y - 0.12 - sink, w.z + oz, rng() * 0.06 - 0.03, (rng() - 0.5) * tilt, (rng() - 0.5) * tilt);
          }
        } else {
          box(this.m.paving, L * 0.96, 0.32, L * 0.96, w.x, y - 0.1 - sink, w.z, 0, (rng() - 0.5) * tilt, (rng() - 0.5) * tilt);
          // A bronze inlay line under the beam's possible paths.
          box(this.m.brass, L * 0.96, 0.02, 0.05, w.x, y + 0.065 - sink, w.z);
          box(this.m.brass, 0.05, 0.02, L * 0.96, w.x, y + 0.065 - sink, w.z);
        }
      }
    }

    // The parapet: a low wall round the court with coping stones, broken in
    // places, pierced by two entrances. Corner piers stand taller.
    const lensSide = (layout.emitter.dir + 2) % 4;
    const doorSide = layout.receptor.dir;
    const gaps = [0, 1, 2, 3].filter((s) => s !== lensSide && s !== doorSide);
    for (let side = 0; side < 4; side += 1) {
      const nx = DX[side];
      const nz = DZ[side];
      const tx = -nz;
      const tz = nx;
      const door = this.doorWorld(site);
      for (let k = -3; k <= 3; k += 1) {
        const along = k * L;
        const x = cx + nx * extent + tx * along;
        const z = cz + nz * extent + tz * along;
        // Entrances: the middle of each side that holds neither lens nor door.
        if (gaps.includes(side) && k === 0) continue;
        if (side === doorSide && Math.hypot(x - door.x, z - door.z) < L * 0.6) continue;
        const broken = rng() < 0.18;
        const h = broken ? 0.45 + rng() * 0.3 : 1.05;
        const g = this.world.groundAt(x, z);
        const base = Math.min(g, y) - 0.4;
        box(this.m.stone, side % 2 === 0 ? L : 0.7, h + (y - base), side % 2 === 0 ? 0.7 : L, x, base + (h + (y - base)) / 2, z);
        if (!broken) box(this.m.dark, side % 2 === 0 ? L + 0.04 : 0.86, 0.14, side % 2 === 0 ? 0.86 : L + 0.04, x, y + h + 0.07, z);
        else box(this.m.stone, 0.5 + rng() * 0.4, 0.35, 0.4 + rng() * 0.3, x + tx * (rng() - 0.5) * 2 + nx * 1.1, y + 0.1, z + tz * (rng() - 0.5) * 2 + nz * 1.1, rng() * 3, rng() * 0.4);
        if (!broken && rng() < 0.3) cushion(x - nx * 0.45 + tx * (rng() - 0.5) * 2.4, z - nz * 0.45 + tz * (rng() - 0.5) * 2.4, 0.35 + rng() * 0.3);
        for (let s = -1; s <= 1; s += 1) colliders.push({ x: x + tx * s * L * 0.34, z: z + tz * s * L * 0.34, radius: 0.55, height: h + 0.3, baseY: y - 0.5 });
      }
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = cx + sx * extent;
      const z = cz + sz * extent;
      const h = 3.2 + rng() * 1.2;
      box(this.m.stone, 1.2, h + 0.4, 1.2, x, y - 0.4 + (h + 0.4) / 2, z);
      box(this.m.dark, 1.5, 0.3, 1.5, x, y + h + 0.15, z);
      box(this.m.dark, 1.5, 0.35, 1.5, x, y + 0.1, z);
      colliders.push({ x, z, radius: 0.85, height: h + 0.5, baseY: y - 0.5 });
    }
    // Rubble and a few boulders outside the walls, so the court sits in its
    // ground instead of on it.
    for (let k = 0; k < 10; k += 1) {
      const a = rng() * Math.PI * 2;
      const d = extent + 2 + rng() * 6;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const geo = generateRock({ seed: 900 + k + layout.id.length * 17, kind: rng() < 0.5 ? 'boulder' : 'crag', detail: 2 }).geometry.clone();
      const s = 0.5 + rng() * 0.9;
      geo.scale(s, s * 0.7, s);
      geo.rotateY(rng() * 6);
      geo.translate(x, this.world.groundAt(x, z) - 0.1, z);
      add(this.m.rock, geo);
    }

    // Standing pillars that stop the beam: square Veyr columns, broken off
    // at different heights.
    for (const [c, r] of layout.pillars) {
      const w = this.cellWorld(site, c, r);
      const h = 2.3 + rng() * 1.3;
      box(this.m.dark, 1.1, 0.3, 1.1, w.x, y + 0.15, w.z);
      box(this.m.stone, 0.8, h, 0.8, w.x, y + 0.3 + h / 2, w.z, rng() * 0.08);
      box(this.m.stone, 0.95, 0.18, 0.95, w.x, y + 0.3 + h * 0.62, w.z);
      colliders.push({ x: w.x, z: w.z, radius: 0.62, height: h + 0.3, baseY: y - 0.3 });
      if (rng() < 0.5) cushion(w.x + (rng() - 0.5) * 0.9, w.z + (rng() < 0.5 ? -0.6 : 0.6), 0.28 + rng() * 0.2);
    }

    // The lens: a stone plinth one cell back from where the beam enters,
    // a thick glass disc in a bronze ring, and a sun-catcher dish on a mast
    // above that turns the sky's light down into it.
    {
      const d = layout.emitter.dir;
      const w = this.cellWorld(site, layout.emitter.cell[0] - DX[d], layout.emitter.cell[1] - DZ[d]);
      const yaw = Math.atan2(DX[d], DZ[d]);
      box(this.m.dark, 1.5, 0.9, 1.5, w.x, y + 0.45, w.z);
      box(this.m.stone, 1.0, 0.35, 1.0, w.x, y + 1.0, w.z);
      const mast = new THREE.CylinderGeometry(0.12, 0.16, 4.8, 8);
      mast.translate(w.x - DX[d] * 0.55, y + 2.4 + 0.9, w.z - DZ[d] * 0.55);
      add(this.m.brass, mast);
      const ring = new THREE.TorusGeometry(0.62, 0.07, 8, 32);
      ring.rotateY(yaw);
      ring.translate(w.x, y + BEAM_Y, w.z);
      add(this.m.brass, ring);
      const lensGeo = new THREE.SphereGeometry(0.6, 32, 12);
      lensGeo.scale(1, 1, 0.24);
      lensGeo.rotateY(yaw);
      const lens = new THREE.Mesh(lensGeo, this.m.lens);
      lens.position.set(w.x, y + BEAM_Y, w.z);
      lens.userData.noShadow = true;
      this.group.add(lens);
      site.lens = lens;
      // The dish, tipped to the southern sky.
      const dish = new THREE.SphereGeometry(1.1, 24, 8, 0, Math.PI * 2, 0, 0.55);
      dish.rotateX(Math.PI + 0.75);
      dish.translate(w.x - DX[d] * 0.55, y + 5.8, w.z - DZ[d] * 0.55);
      add(this.m.brass, dish);
      const arm = new THREE.BoxGeometry(0.08, 0.08, 1.4);
      arm.rotateX(-0.9);
      arm.translate(w.x - DX[d] * 0.3, y + 5.0, w.z - DZ[d] * 0.3 + 0.2);
      add(this.m.brass, arm);
      colliders.push({ x: w.x, z: w.z, radius: 0.95, height: 6.4, baseY: y - 0.3 });
    }

    // The vault: a gatehouse in the parapet with an arch, a stone door with a
    // bronze sun on its face, and a little vaulted room behind it.
    {
      const d = layout.receptor.dir;
      const door = this.doorWorld(site);
      const yaw = Math.atan2(DX[d], DZ[d]);
      const out = (k: number) => ({ x: door.x + DX[d] * k, z: door.z + DZ[d] * k });
      const tx = -DZ[d];
      const tz = DX[d];
      const place = (m: THREE.Material, g: THREE.BufferGeometry, x: number, yy: number, z: number) => {
        g.rotateY(yaw);
        g.translate(x, yy, z);
        add(m, g);
      };
      // Jambs and arch.
      for (const s of [-1, 1]) {
        place(this.m.stone, new THREE.BoxGeometry(0.9, 3.6, 1.2), door.x + tx * s * 1.75, y + 1.8 - 0.2, door.z + tz * s * 1.75);
        colliders.push({ x: door.x + tx * s * 1.75, z: door.z + tz * s * 1.75, radius: 0.6, height: 4.6, baseY: y - 0.3 });
      }
      const arch = voussoirArch(2.6, 0.7, 1.2, 11);
      place(this.m.stone, arch, door.x, y + 3.2, door.z);
      place(this.m.dark, new THREE.BoxGeometry(4.6, 0.5, 1.4), door.x, y + 4.75, door.z);
      // The room behind: three walls and a slab roof.
      const room = out(2.2);
      for (const s of [-1, 1]) {
        const wx = room.x + tx * s * 1.8;
        const wz = room.z + tz * s * 1.8;
        place(this.m.stone, new THREE.BoxGeometry(0.6, 4.2, 3.8), wx, y + 1.8, wz);
        for (const k of [-1, 0, 1]) colliders.push({ x: wx + DX[d] * k * 1.2, z: wz + DZ[d] * k * 1.2, radius: 0.5, height: 4.4, baseY: y - 0.4 });
      }
      const back = out(4.1);
      place(this.m.stone, new THREE.BoxGeometry(4.2, 4.2, 0.6), back.x, y + 1.8, back.z);
      for (const k of [-1, 0, 1]) colliders.push({ x: back.x + tx * k * 1.2, z: back.z + tz * k * 1.2, radius: 0.5, height: 4.4, baseY: y - 0.4 });
      place(this.m.dark, new THREE.BoxGeometry(4.8, 0.5, 4.8), room.x, y + 4.15, room.z);
      place(this.m.paving, new THREE.BoxGeometry(3.2, 0.3, 3.4), room.x, y - 0.08, room.z);
      // The door itself, and the sun it wears.
      const slab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 0.5), this.m.dark);
      slab.position.y = 1.6;
      this.materials.push(site.discMat);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 36), site.discMat);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0, BEAM_Y, -0.3);
      const rays = new THREE.Mesh(
        merge(
          Array.from({ length: 12 }, (_, i) => {
            const g = new THREE.BoxGeometry(0.08, 0.34, 0.05);
            g.translate(0, 0.84, 0);
            g.rotateZ((i / 12) * Math.PI * 2);
            return g;
          }),
        ),
        site.discMat,
      );
      rays.position.set(0, BEAM_Y, -0.29);
      site.door.add(slab, disc, rays);
      site.door.position.set(door.x, y, door.z);
      site.door.rotation.y = yaw;
      site.door.traverse((o) => {
        (o as THREE.Mesh).castShadow = true;
        (o as THREE.Mesh).receiveShadow = true;
      });
      this.group.add(site.door);
      site.disc = disc;
      for (const s of [-0.8, 0, 0.8]) colliders.push({ x: door.x + tx * s, z: door.z + tz * s, radius: 0.5, height: 3.2, baseY: y - 0.2, door: true });
    }

    // Prisms: a stone pedestal, a bronze turntable, and a crystal that sends
    // the light out through the brass aperture on the side it faces.
    const pedestal = merge([
      new THREE.CylinderGeometry(0.34, 0.46, 0.95, 10).translate(0, 0.475, 0),
      new THREE.CylinderGeometry(0.5, 0.52, 0.14, 10).translate(0, 0.07, 0),
    ]);
    const table = new THREE.CylinderGeometry(0.44, 0.44, 0.06, 24);
    const crystalGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.62, 6);
    crystalGeo.rotateY(Math.PI / 6);
    for (const [i, p] of layout.prisms.entries()) {
      const w = this.cellWorld(site, p.cell[0], p.cell[1]);
      const ped = pedestal.clone();
      ped.translate(w.x, y, w.z);
      add(this.m.stone, ped);
      colliders.push({ x: w.x, z: w.z, radius: 0.5, height: 1.8, baseY: y - 0.2 });
      const head = new THREE.Group();
      const t = new THREE.Mesh(table, this.m.brass);
      t.position.y = 0.98;
      const crystal = new THREE.Mesh(crystalGeo, this.m.crystal);
      crystal.position.y = BEAM_Y;
      crystal.userData.noShadow = true;
      // Two bronze cheeks hold the crystal; the aperture ring marks the
      // side the light leaves by, and a vane on the turntable points there.
      const cheek = new THREE.BoxGeometry(0.05, 0.62, 0.3);
      for (const s of [-1, 1]) {
        const ch = new THREE.Mesh(cheek, this.m.brass);
        ch.position.set(s * 0.24, BEAM_Y, 0);
        head.add(ch);
      }
      const aperture = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 6, 16), this.m.brass);
      aperture.position.set(0, BEAM_Y, -0.22);
      const vane = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 3), this.m.brass);
      vane.rotation.x = -Math.PI / 2;
      vane.position.set(0, 1.04, -0.36);
      head.add(t, crystal, aperture, vane);
      head.position.set(w.x, y, w.z);
      head.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.noShadow) (o as THREE.Mesh).castShadow = true;
      });
      this.group.add(head);
      const facing = p.start;
      const angle = -facing * (Math.PI / 2);
      head.rotation.y = angle;
      site.prisms.push({ cell: [p.cell[0], p.cell[1]], facing, head, crystal, angle, turning: 0, x: w.x, z: w.z });
      void i;
    }

    // Glows where the light gathers: the lens, every prism, the sun on the
    // door. Each is shown only while light reaches it.
    const flare = (x: number, z: number) => {
      const s = new THREE.Sprite(this.flareMaterial);
      s.position.set(x, y + BEAM_Y, z);
      s.layers.set(LAYER_TRANSPARENT);
      s.visible = false;
      this.group.add(s);
      site.flares.push(s);
    };
    const lensAt = this.cellWorld(site, layout.emitter.cell[0] - DX[layout.emitter.dir], layout.emitter.cell[1] - DZ[layout.emitter.dir]);
    flare(lensAt.x, lensAt.z);
    for (const p of site.prisms) flare(p.x, p.z);
    const doorAt = this.doorWorld(site);
    flare(doorAt.x - DX[layout.receptor.dir] * 0.45, doorAt.z - DZ[layout.receptor.dir] * 0.45);
    // Dust in the light: each speck keeps its place along the beam, its angle
    // and distance off the axis, and a phase for its twinkle.
    for (let k = 0; k < MOTES; k += 1) site.moteSeeds.set([rng(), rng() * Math.PI * 2, Math.sqrt(rng()) * 0.3, rng() * Math.PI * 2], k * 4);
    const moteGeo = site.motes.geometry;
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    moteGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    site.motes.layers.set(LAYER_TRANSPARENT);
    site.motes.frustumCulled = false;
    site.motes.visible = false;
    this.group.add(site.motes);

    // Merge the stonework: one mesh per material for the whole court.
    for (const [m, list] of parts) {
      const mesh = new THREE.Mesh(merge(list), m);
      mesh.name = `sunwell:${layout.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return site;
  }

  // ---------------------------------------------------------------------------
  // Play

  /** Turn one prism a quarter clockwise. */
  turnPrism(s: number, i: number): void {
    const site = this.sites[s];
    const prism = site?.prisms[i];
    if (!site || !prism || site.solved) return;
    prism.facing = turn(prism.facing);
    prism.turning = TURN_TIME;
    this.hooks.turned(i, prism.x, site.y + BEAM_Y, prism.z);
    this.retrace(site);
  }

  private facings(site: Site): Dir[] {
    return site.prisms.map((p) => p.facing);
  }

  /** Set a solved court's prisms to the answer and its door open. */
  private restoreSolved(site: Site): void {
    const answer = solveSunwell(site.layout)?.facings;
    if (answer) {
      site.prisms.forEach((p, i) => {
        p.facing = answer[i];
        p.angle = -p.facing * (Math.PI / 2);
        p.head.rotation.y = p.angle;
      });
    }
    site.solved = true;
    site.open = 1;
    site.since = DOOR_TIME + 2;
    site.door.position.y = site.y - 3.3;
    site.door.visible = false;
  }

  /** Follow the light across the court and lay the beam meshes along it. */
  private retrace(site: Site): void {
    const trace = traceBeam(site.layout, this.facings(site));
    site.end = trace.end;
    const size = site.layout.size;
    const half = (size - 1) / 2;
    const pts = trace.points.map(([c, r]) => new THREE.Vector3(site.cx + (c - half) * SUNWELL_CELL, site.y + BEAM_Y, site.cz + (r - half) * SUNWELL_CELL));
    // Light that leaves the court runs on to the parapet, or to the disc.
    if (trace.end === 'wall' || trace.end === 'receptor') {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const dir = b.clone().sub(a).normalize();
      const stop = trace.end === 'receptor' ? PARAPET * SUNWELL_CELL - 0.35 : PARAPET * SUNWELL_CELL - 0.36;
      const along = Math.abs(dir.x) > 0.5 ? (stop - Math.abs(a.x - site.cx)) : (stop - Math.abs(a.z - site.cz));
      b.copy(a).addScaledVector(dir, Math.max(0.2, along));
    }
    site.path = pts;
    site.lit = trace.lit;
    for (const p of site.prisms) p.crystal.material = this.m.crystal;
    for (const i of trace.lit) site.prisms[i].crystal.material = this.m.lit;
    if (trace.end === 'receptor' && !site.solved) {
      site.solved = true;
      site.since = 0;
      this.hooks.setFlag(`lit:${site.layout.id}`);
      this.hooks.opened(site.layout.id, site.name);
    }
  }

  /** Lay the beam meshes along the light as it is this frame; returns the points it passes. */
  private layBeams(site: Site, strength: number): THREE.Vector3[] {
    // Hide the beam past a prism that is still turning.
    let pts = site.path;
    const busy = site.prisms.findIndex((p) => p.turning > 0);
    if (busy >= 0) {
      const at = site.prisms[busy];
      const k = pts.findIndex((v) => Math.abs(v.x - at.x) < 0.01 && Math.abs(v.z - at.z) < 0.01);
      if (k >= 0) pts = pts.slice(0, k + 1);
      else {
        // A prism passing the beam straight on: cut the segment through it.
        for (let j = 1; j < pts.length; j += 1) {
          const a = pts[j - 1];
          const b = pts[j];
          const ab = b.clone().sub(a);
          const t = ab.lengthSq() > 0 ? new THREE.Vector3(at.x - a.x, 0, at.z - a.z).dot(ab) / ab.lengthSq() : -1;
          const q = a.clone().addScaledVector(ab, THREE.MathUtils.clamp(t, 0, 1));
          if (t > 0 && t < 1 && Math.hypot(q.x - at.x, q.z - at.z) < 0.05) {
            pts = [...pts.slice(0, j), new THREE.Vector3(at.x, a.y, at.z)];
            break;
          }
        }
      }
    }
    // Once the door sinks, the light runs on into the vault to its back wall.
    if (site.end === 'receptor' && busy < 0 && site.open > 0) {
      const e = site.open * site.open * (3 - 2 * site.open);
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      pts = [...pts.slice(0, -1), b.clone().addScaledVector(b.clone().sub(a).normalize(), e * 4.05)];
    }
    const segs = strength > 0.02 ? pts.length - 1 : 0;
    while (site.beams.length < segs) {
      const b = new THREE.Mesh(this.beamGeometry, this.beamMaterial);
      b.layers.set(LAYER_TRANSPARENT);
      b.frustumCulled = false;
      this.group.add(b);
      site.beams.push(b);
    }
    for (let j = 0; j < site.beams.length; j += 1) {
      const b = site.beams[j];
      b.visible = j < segs;
      if (!b.visible) continue;
      const a = pts[j];
      const c = pts[j + 1];
      const len = a.distanceTo(c);
      b.position.copy(a);
      b.lookAt(c);
      b.scale.set(1, 1, Math.max(0.01, len));
    }
    return pts;
  }

  /**
   * Flares where the light gathers and dust drifting in it. `pts` is the
   * beam as laid this frame; `close` is 1 beside the court, 0 far off.
   */
  private layGlows(site: Site, pts: THREE.Vector3[], strength: number, close: number): void {
    const on = strength > 0.02;
    const pulse = 0.94 + 0.06 * Math.sin(this.time * 2.1 + site.cx);
    const [lens, ...rest] = site.flares;
    const end = rest[rest.length - 1];
    lens.visible = on;
    lens.scale.setScalar(1.7 * pulse * (0.5 + 0.5 * strength));
    // Prisms glow while the light reaches them (up to one that is turning).
    const busy = site.prisms.findIndex((p) => p.turning > 0);
    const cut = busy >= 0 ? site.lit.indexOf(busy) : -1;
    const lit = cut >= 0 ? site.lit.slice(0, cut + 1) : site.lit;
    site.prisms.forEach((_, i) => {
      rest[i].visible = on && lit.includes(i);
      rest[i].scale.setScalar(1.05 * pulse);
    });
    // The sun on the door flares as the light arrives, then the light rests
    // on the vault's back wall.
    end.visible = on && site.solved;
    if (end.visible) {
      const last = pts[pts.length - 1];
      end.position.copy(last);
      const arriving = Math.min(1, site.since / 1.2);
      end.scale.setScalar((site.open > 0 ? 1.4 : 0.6 + 1.6 * arriving) * pulse);
    }
    // Dust: every speck drifts slowly along the light and turns about its
    // axis, twinkling as it crosses the brightest part.
    site.motes.visible = on && close > 0.01 && pts.length > 1;
    if (!site.motes.visible) return;
    const pos = site.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = site.motes.geometry.getAttribute('color') as THREE.BufferAttribute;
    let total = 0;
    for (let j = 1; j < pts.length; j += 1) total += pts[j - 1].distanceTo(pts[j]);
    const seeds = site.moteSeeds;
    for (let k = 0; k < MOTES; k += 1) {
      const u = seeds[k * 4];
      const angle = seeds[k * 4 + 1] + this.time * 0.15;
      const off = seeds[k * 4 + 2];
      const phase = seeds[k * 4 + 3];
      let s = ((u + this.time * 0.01 * (0.6 + 0.4 * Math.sin(phase))) % 1) * total;
      let j = 1;
      while (j < pts.length - 1 && s > pts[j - 1].distanceTo(pts[j])) {
        s -= pts[j - 1].distanceTo(pts[j]);
        j += 1;
      }
      const a = pts[j - 1];
      const b = pts[j];
      const len = Math.max(1e-4, a.distanceTo(b));
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      const across = Math.cos(angle) * off;
      pos.setXYZ(k, a.x + dx * s - dz * across, a.y + Math.sin(angle) * off + Math.sin(this.time * 0.4 + phase) * 0.04, a.z + dz * s + dx * across);
      const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(this.time * 1.7 + phase * 3)) ** 2;
      const bright = strength * close * twinkle * (1 - off / 0.34) * 2.4;
      col.setXYZ(k, bright, bright * 0.86, bright * 0.62);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const sun = THREE.MathUtils.clamp(this.hooks.sunlight(), 0, 1);
    this.beamMaterial.uniforms.uTime.value = this.time;
    this.beamMaterial.uniforms.uIntensity.value = 0.25 + 0.75 * sun;
    this.m.lens.emissiveIntensity = 0.15 + 2.6 * sun;
    this.m.lit.emissiveIntensity = 0.6 + 2.8 * sun;
    const pos = camera.position;
    this.flareMaterial.color.setRGB(1, 0.84, 0.6).multiplyScalar(0.8 + 7 * sun);
    for (const site of this.sites) {
      const d2 = (pos.x - site.cx) ** 2 + (pos.z - site.cz) ** 2;
      const near = d2 < 420 * 420;
      for (const p of site.prisms) {
        const target = -p.facing * (Math.PI / 2);
        if (p.turning > 0) {
          p.turning = Math.max(0, p.turning - dt);
          const k = 1 - p.turning / TURN_TIME;
          const ease = k * k * (3 - 2 * k);
          const from = target + Math.PI / 2;
          p.head.rotation.y = from + (target - from) * ease;
          if (p.turning === 0) p.angle = target;
        } else p.head.rotation.y = target;
      }
      // A beam only runs while the sun is up to feed the lens.
      const strength = near ? sun : 0;
      const pts = this.layBeams(site, strength);
      this.layGlows(site, pts, strength, 1 - THREE.MathUtils.smoothstep(Math.sqrt(d2), 45, 90));
      if (!site.solved) site.discMat.emissiveIntensity = 0;
      else if (site.open >= 1) site.discMat.emissiveIntensity = 1.2;
      if (site.solved && site.open < 1) {
        site.since += dt;
        site.discMat.emissiveIntensity = Math.min(1, site.since / 1.2) * 3;
        if (site.since > 1.2) {
          site.open = Math.min(1, (site.since - 1.2) / DOOR_TIME);
          const e = site.open * site.open * (3 - 2 * site.open);
          site.door.position.y = site.y - e * 3.3 + Math.sin(site.since * 40) * 0.01 * (1 - site.open);
          if (site.open >= 1) site.door.visible = false;
        }
      }
    }
  }

  /** Match the courts to the story flags after a new game or a load. */
  sync(): void {
    for (const site of this.sites) {
      if (this.hooks.hasFlag(`lit:${site.layout.id}`)) {
        if (!site.solved || site.open < 1) this.restoreSolved(site);
      } else {
        site.solved = false;
        site.open = 0;
        site.since = 0;
        site.door.visible = true;
        site.door.position.y = site.y;
        site.prisms.forEach((p, i) => {
          p.facing = site.layout.prisms[i].start;
          p.turning = 0;
          p.angle = -p.facing * (Math.PI / 2);
          p.head.rotation.y = p.angle;
        });
      }
      this.retrace(site);
    }
  }

  collidersNear(x: number, z: number, r: number, out: { x: number; z: number; radius: number; height: number; baseY?: number }[]): void {
    for (const site of this.sites) {
      if ((site.cx - x) ** 2 + (site.cz - z) ** 2 > (PARAPET * SUNWELL_CELL + 12 + r) ** 2) continue;
      for (const c of site.colliders) {
        if (c.door && site.open > 0.5) continue;
        if ((c.x - x) ** 2 + (c.z - z) ** 2 < (r + c.radius) ** 2) out.push(c);
      }
    }
  }

  /** For tests: each court's prisms, beam and door. */
  debug(): { id: string; x: number; z: number; y: number; prisms: { x: number; z: number; facing: Dir; start: Dir }[]; answer: Dir[]; end: string; solved: boolean; open: number; path: number[][]; door: { x: number; z: number } }[] {
    return this.sites.map((s) => ({
      id: s.layout.id,
      answer: solveSunwell(s.layout)?.facings ?? [],
      x: s.cx,
      z: s.cz,
      y: s.y,
      prisms: s.prisms.map((p, i) => ({ x: p.x, z: p.z, facing: p.facing, start: s.layout.prisms[i].start })),
      end: s.end,
      solved: s.solved,
      open: s.open,
      path: s.path.map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]),
      door: this.doorWorld(s),
    }));
  }

  isSolved(id: string): boolean {
    const site = this.sites.find((s) => s.layout.id === id);
    return site ? isSolved(site.layout, this.facings(site)) : false;
  }
}
