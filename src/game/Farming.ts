import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, hashString } from '../core/rng';
import { BIOME } from '../world/WorldConfig';
import type { StructureData } from './Structures';

// Farm plots grow what you plant in them: wild flax seeds, lanternberries,
// cap mushrooms, yarrow, moonmoss and frostmint. Crops grow over in-game
// hours, twice as fast while the soil is wet: rain waters them (unless a
// roof is in the way), and so does a waterskin. Berries and herbs come back
// after picking; flax and mushrooms are replanted. Each plot shows nine
// plants that grow up, flower and fruit, and dark wet soil after watering.

export interface CropDef {
  id: string;
  name: string;
  /** The item planted. */
  seed: string;
  /** In-game hours to ripen while watered. */
  hours: number;
  yields: [item: string, min: number, max: number][];
  /** Perennials drop back to this growth after a harvest instead of clearing. */
  regrow?: number;
  look: 'flax' | 'bush' | 'caps' | 'herb' | 'moss' | 'mint';
  /** Growth multipliers by biome (the default table covers the rest). */
  climate?: Partial<Record<number, number>>;
  /** Draws water from the damp air; never needs watering. */
  damp?: boolean;
}

export const CROPS: readonly CropDef[] = [
  {
    id: 'flax',
    name: 'Flax',
    seed: 'seeds',
    hours: 30,
    yields: [
      ['fiber', 6, 9],
      ['seeds', 1, 3],
    ],
    look: 'flax',
  },
  {
    id: 'lanternberry',
    name: 'Lanternberries',
    seed: 'berries',
    hours: 44,
    yields: [['berries', 5, 8]],
    regrow: 0.45,
    look: 'bush',
  },
  {
    id: 'capshroom',
    name: 'Cap Mushrooms',
    seed: 'mushroom',
    hours: 26,
    yields: [['mushroom', 3, 5]],
    look: 'caps',
    damp: true,
    climate: { [BIOME.Drownfen]: 1.4, [BIOME.Hollowpine]: 1.2, [BIOME.Cinderreach]: 0.3 },
  },
  {
    id: 'yarrow',
    name: 'Yarrow',
    seed: 'herbs',
    hours: 28,
    yields: [['herbs', 2, 4]],
    regrow: 0.4,
    look: 'herb',
  },
  {
    id: 'moonmoss',
    name: 'Moonmoss',
    seed: 'moonmoss',
    hours: 40,
    yields: [['moonmoss', 2, 3]],
    regrow: 0.5,
    look: 'moss',
    damp: true,
    climate: { [BIOME.Glasswood]: 1.4, [BIOME.Drownfen]: 1.3, [BIOME.Cinderreach]: 0.2 },
  },
  {
    id: 'frostmint',
    name: 'Frostmint',
    seed: 'frostmint',
    hours: 34,
    yields: [['frostmint', 2, 4]],
    regrow: 0.4,
    look: 'mint',
    climate: { [BIOME.Frostveil]: 1.5, [BIOME.Rim]: 1.2, [BIOME.Cinderreach]: 0.2 },
  },
];

/** How well things grow in each biome unless a crop says otherwise. */
const CLIMATE: Record<number, number> = {
  [BIOME.Greensward]: 1.15,
  [BIOME.Hollowpine]: 1,
  [BIOME.Glasswood]: 1,
  [BIOME.Coast]: 0.85,
  [BIOME.Cinderreach]: 0.45,
  [BIOME.Frostveil]: 0.4,
  [BIOME.Drownfen]: 1.05,
  [BIOME.Rim]: 0.8,
};

/** Hours a soaking lasts. */
const WET_HOURS = 30;
/** Growth rate on dry soil, relative to wet. */
const DRY_RATE = 0.2;

export interface CropState {
  id: string;
  /** 0..1; ripe at 1. */
  growth: number;
  /** Soil moisture 0..1. */
  water: number;
  /** Total hours at the last update. */
  last: number;
  harvests: number;
}

export function cropForSeed(item: string | null | undefined): CropDef | null {
  return item ? (CROPS.find((c) => c.seed === item) ?? null) : null;
}

export function cropDef(id: string): CropDef | null {
  return CROPS.find((c) => c.id === id) ?? null;
}

/** Bring older saves' crops ({planted, ready}) forward, and fill gaps. */
export function normalizeCrop(raw: unknown, now: number): CropState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<CropState> & { planted?: number; ready?: number };
  if (typeof r.id === 'string' && cropDef(r.id)) {
    return {
      id: r.id,
      growth: Math.min(1, Math.max(0, r.growth ?? 0)),
      water: Math.min(1, Math.max(0, r.water ?? 0)),
      last: Number.isFinite(r.last) ? (r.last as number) : now,
      harvests: r.harvests ?? 0,
    };
  }
  if (typeof r.planted === 'number' && typeof r.ready === 'number') {
    const span = Math.max(1, r.ready - r.planted);
    return { id: 'flax', growth: Math.min(1, Math.max(0, (now - r.planted) / span)), water: 0.5, last: now, harvests: 0 };
  }
  return null;
}

/**
 * Advance a crop to `now`. Wet hours grow at full rate, dry hours at a
 * fifth; the soil dries linearly over `WET_HOURS`.
 */
export function growCrop(crop: CropState, now: number, rain: number, biome: number): void {
  const def = cropDef(crop.id);
  if (!def) return;
  const dt = now - crop.last;
  crop.last = now;
  if (dt <= 0) return;
  if (rain > 0.15 || def.damp) crop.water = 1;
  const wet = def.damp ? dt : Math.min(dt, crop.water * WET_HOURS);
  crop.water = def.damp ? 1 : Math.max(0, crop.water - dt / WET_HOURS);
  const climate = def.climate?.[biome] ?? CLIMATE[biome] ?? 1;
  crop.growth = Math.min(1, crop.growth + ((wet + (dt - wet) * DRY_RATE) * climate) / def.hours);
}

/** Deterministic harvest for a plot's nth picking. */
export function harvestYield(plotId: string, crop: CropState): [string, number][] {
  const def = cropDef(crop.id);
  if (!def) return [];
  const rng = createRng(hashString(`${plotId}:${crop.id}:${crop.harvests}`));
  const out: [string, number][] = [];
  for (const [item, min, max] of def.yields) {
    const n = min + Math.floor(rng() * (max - min + 1));
    if (n > 0) out.push([item, n]);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Looks

interface PlantLook {
  body: THREE.BufferGeometry;
  fruit: THREE.BufferGeometry | null;
  fruitMaterial: THREE.MeshStandardMaterial | null;
}

function painted(g: THREE.BufferGeometry, color: THREE.Color | ((y: number) => THREE.Color)): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const c = typeof color === 'function' ? color(pos.getY(i)) : color;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') geo.deleteAttribute(name);
  return geo;
}

function leaf(length: number, width: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(width, length * 0.45, 0, length);
  s.quadraticCurveTo(-width, length * 0.45, 0, 0);
  return new THREE.ShapeGeometry(s, 4);
}

function buildLook(look: CropDef['look'], seed: number): PlantLook {
  const rng = createRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const fruits: THREE.BufferGeometry[] = [];
  const green = (h: number, s: number, l: number) => new THREE.Color().setHSL(h, s, l);
  let fruitMaterial: THREE.MeshStandardMaterial | null = null;
  const stalk = (x: number, z: number, h: number, r: number, lean: number, color: THREE.Color): THREE.Vector3 => {
    const g = new THREE.CylinderGeometry(r * 0.6, r, h, 5);
    g.translate(0, h / 2, 0);
    g.rotateZ(lean);
    g.rotateY(rng() * Math.PI * 2);
    g.translate(x, 0, z);
    parts.push(painted(g, color));
    const top = new THREE.Vector3(0, h, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), lean);
    return top.add(new THREE.Vector3(x, 0, z));
  };
  switch (look) {
    case 'flax': {
      for (let i = 0; i < 9; i += 1) {
        const x = (rng() - 0.5) * 0.22;
        const z = (rng() - 0.5) * 0.22;
        const top = stalk(x, z, 0.7 + rng() * 0.3, 0.006, (rng() - 0.5) * 0.25, green(0.24, 0.45, 0.32));
        for (let k = 0; k < 3; k += 1) {
          const l = leaf(0.12, 0.012);
          l.rotateZ((rng() - 0.5) * 1.6);
          l.rotateY(rng() * Math.PI * 2);
          l.translate(x, 0.15 + k * 0.18, z);
          parts.push(painted(l, green(0.26, 0.4, 0.3)));
        }
        const bloom = new THREE.IcosahedronGeometry(0.022, 0);
        bloom.scale(1, 0.5, 1);
        bloom.translate(top.x, top.y + 0.01, top.z);
        fruits.push(painted(bloom, new THREE.Color(0x5b7fd6)));
      }
      fruitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x0c1430 });
      break;
    }
    case 'bush': {
      for (let i = 0; i < 6; i += 1) {
        const r = 0.12 + rng() * 0.08;
        const g = new THREE.IcosahedronGeometry(r, 1);
        const p = g.getAttribute('position');
        for (let k = 0; k < p.count; k += 1) {
          const n = 1 + (rng() - 0.5) * 0.3;
          p.setXYZ(k, p.getX(k) * n, p.getY(k) * n * 0.8, p.getZ(k) * n);
        }
        g.computeVertexNormals();
        g.translate((rng() - 0.5) * 0.28, 0.14 + rng() * 0.26, (rng() - 0.5) * 0.28);
        parts.push(painted(g, green(0.3, 0.38, 0.17 + rng() * 0.05)));
      }
      stalk(0, 0, 0.18, 0.02, 0, new THREE.Color(0x4a3524));
      for (let i = 0; i < 14; i += 1) {
        const b = new THREE.SphereGeometry(0.022, 6, 5);
        const a = rng() * Math.PI * 2;
        const h = 0.12 + rng() * 0.36;
        const rr = 0.14 + rng() * 0.1;
        b.translate(Math.cos(a) * rr, h, Math.sin(a) * rr);
        fruits.push(painted(b, new THREE.Color(0xff8a2a)));
      }
      // Lanternberries glow faintly.
      fruitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, emissive: 0xff6a10, emissiveIntensity: 0.9 });
      break;
    }
    case 'caps': {
      for (let i = 0; i < 5; i += 1) {
        const x = (rng() - 0.5) * 0.3;
        const z = (rng() - 0.5) * 0.3;
        const h = 0.05 + rng() * 0.08;
        stalk(x, z, h, 0.012 + rng() * 0.008, (rng() - 0.5) * 0.3, new THREE.Color(0xd8ccb4));
        const r = 0.035 + rng() * 0.045;
        const cap = new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, 0.65, 1);
        cap.translate(x, h, z);
        parts.push(painted(cap, (y) => (y < h + 0.004 ? new THREE.Color(0xc8b494) : new THREE.Color(0x8a5a34))));
      }
      break;
    }
    case 'herb': {
      for (let i = 0; i < 6; i += 1) {
        const x = (rng() - 0.5) * 0.18;
        const z = (rng() - 0.5) * 0.18;
        const top = stalk(x, z, 0.32 + rng() * 0.18, 0.005, (rng() - 0.5) * 0.3, green(0.25, 0.3, 0.3));
        for (let k = 0; k < 4; k += 1) {
          const l = leaf(0.1, 0.02);
          l.rotateZ(0.9 + rng() * 0.6);
          l.rotateY(rng() * Math.PI * 2);
          l.translate(x, 0.04 + k * 0.06, z);
          parts.push(painted(l, green(0.27, 0.35, 0.28)));
        }
        const umbel = new THREE.SphereGeometry(0.04, 8, 4);
        umbel.scale(1, 0.3, 1);
        umbel.translate(top.x, top.y, top.z);
        fruits.push(painted(umbel, new THREE.Color(0xf2efe4)));
      }
      fruitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
      break;
    }
    case 'moss': {
      for (let i = 0; i < 4; i += 1) {
        const g = new THREE.SphereGeometry(0.12 + rng() * 0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        g.scale(1, 0.45, 1);
        g.translate((rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25);
        parts.push(painted(g, new THREE.Color(0x3a5a58)));
      }
      for (let i = 0; i < 18; i += 1) {
        const tip = new THREE.SphereGeometry(0.012, 5, 4);
        tip.translate((rng() - 0.5) * 0.4, 0.04 + rng() * 0.05, (rng() - 0.5) * 0.4);
        fruits.push(painted(tip, new THREE.Color(0x8ad8ff)));
      }
      fruitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0x3aa8e0, emissiveIntensity: 1.2 });
      break;
    }
    case 'mint': {
      for (let i = 0; i < 7; i += 1) {
        const x = (rng() - 0.5) * 0.22;
        const z = (rng() - 0.5) * 0.22;
        const h = 0.2 + rng() * 0.12;
        const top = stalk(x, z, h, 0.005, (rng() - 0.5) * 0.25, green(0.42, 0.3, 0.35));
        for (let k = 0; k < 3; k += 1) {
          for (const side of [-1, 1]) {
            const l = new THREE.SphereGeometry(0.03, 6, 4);
            l.scale(1, 0.25, 0.6);
            l.rotateY(side * 0.3 + k);
            l.translate(x + side * 0.03, 0.05 + k * 0.06, z);
            parts.push(painted(l, green(0.45, 0.35, 0.55)));
          }
        }
        const spike = new THREE.ConeGeometry(0.012, 0.05, 5);
        spike.translate(top.x, top.y + 0.02, top.z);
        fruits.push(painted(spike, new THREE.Color(0xb8a0e8)));
      }
      fruitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
      break;
    }
  }
  const body = mergeGeometries(parts);
  body.computeBoundingSphere();
  const fruit = fruits.length > 0 ? mergeGeometries(fruits) : null;
  return { body, fruit, fruitMaterial };
}

interface PlotVisual {
  crop: string | null;
  group: THREE.Group;
  plants: { body: THREE.Mesh; fruit: THREE.Mesh | null; lean: number; phase: number }[];
  wet: THREE.Mesh;
}

export interface FarmPrompt {
  key: string | null;
  text: string;
}

export interface FarmAction {
  /** Item to take from the pack (planting). */
  consume?: string;
  /** Items to give (harvest). */
  give?: [string, number][];
  /** A waterskin sip used. */
  watered?: boolean;
  message?: string;
}

export class Farming {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly looks = new Map<string, PlantLook>();
  private readonly visuals = new Map<string, PlotVisual>();
  private readonly plantMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  private readonly wetMaterial = new THREE.MeshStandardMaterial({ color: 0x1c140c, roughness: 0.35, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly wetGeometry = new THREE.PlaneGeometry(2.3, 2.3).rotateX(-Math.PI / 2);

  constructor() {
    this.group.name = 'farming';
    this.materials.push(this.plantMaterial, this.wetMaterial);
  }

  private look(id: string): PlantLook | null {
    const def = cropDef(id);
    if (!def) return null;
    let look = this.looks.get(id);
    if (!look) {
      look = buildLook(def.look, hashString(id));
      if (look.fruitMaterial) this.materials.push(look.fruitMaterial);
      this.looks.set(id, look);
    }
    return look;
  }

  /** Grow every planted plot to `now` and refresh the plants near the camera. */
  update(plots: StructureData[], now: number, rainAt: (d: StructureData) => number, biomeAt: (x: number, z: number) => number, camera: THREE.Vector3, time: number): void {
    const seen = new Set<string>();
    for (const d of plots) {
      if (d.type !== 'farm_plot') continue;
      const crop = normalizeCrop(d.crop, now);
      d.crop = crop;
      if (crop) growCrop(crop, now, rainAt(d), biomeAt(d.x, d.z));
      if (Math.hypot(d.x - camera.x, d.z - camera.z) > 180) continue;
      seen.add(d.id);
      this.syncPlot(d, crop, time);
    }
    for (const [id, v] of this.visuals) {
      if (seen.has(id)) continue;
      this.group.remove(v.group);
      this.visuals.delete(id);
    }
  }

  private syncPlot(d: StructureData, crop: CropState | null, time: number): void {
    let v = this.visuals.get(d.id);
    const cropId = crop?.id ?? null;
    if (!v || v.crop !== cropId) {
      if (v) this.group.remove(v.group);
      const group = new THREE.Group();
      group.position.set(d.x, d.y + 0.14, d.z);
      group.rotation.y = d.yaw;
      const wet = new THREE.Mesh(this.wetGeometry, this.wetMaterial);
      wet.position.y = 0.012;
      wet.receiveShadow = true;
      group.add(wet);
      const plants: PlotVisual['plants'] = [];
      const look = cropId ? this.look(cropId) : null;
      if (look) {
        const rng = createRng(hashString(d.id));
        for (let i = 0; i < 3; i += 1) {
          for (let j = 0; j < 3; j += 1) {
            const body = new THREE.Mesh(look.body, this.plantMaterial);
            body.position.set((i - 1) * 0.72 + (rng() - 0.5) * 0.12, 0, (j - 1) * 0.72 + (rng() - 0.5) * 0.12);
            body.rotation.y = rng() * Math.PI * 2;
            body.castShadow = true;
            body.receiveShadow = true;
            let fruit: THREE.Mesh | null = null;
            if (look.fruit && look.fruitMaterial) {
              fruit = new THREE.Mesh(look.fruit, look.fruitMaterial);
              body.add(fruit);
            }
            group.add(body);
            plants.push({ body, fruit, lean: 0.03 + rng() * 0.04, phase: rng() * Math.PI * 2 });
          }
        }
      }
      v = { crop: cropId, group, plants, wet };
      this.visuals.set(d.id, v);
      this.group.add(group);
    }
    v.group.position.set(d.x, d.y + 0.14, d.z);
    const growth = crop?.growth ?? 0;
    // Sprouts come up small and fill out; flowers and fruit show once ripe.
    const eased = growth * growth * (3 - 2 * growth);
    const scale = 0.1 + 0.9 * eased;
    for (const p of v.plants) {
      p.body.scale.set(scale, scale * (0.7 + 0.3 * eased), scale);
      p.body.rotation.z = Math.sin(time * 1.3 + p.phase) * p.lean * eased;
      if (p.fruit) p.fruit.visible = growth >= 1;
    }
    (v.wet.material as THREE.MeshStandardMaterial).opacity = 0.5;
    v.wet.visible = (crop?.water ?? 0) > 0.05;
    v.wet.scale.setScalar(0.85 + 0.15 * (crop?.water ?? 0));
  }

  /** What E does at this plot with `held` in hand. */
  prompt(d: StructureData, held: string | null, charges: number, has: (item: string) => boolean): FarmPrompt {
    const crop = normalizeCrop(d.crop, 0);
    if (!crop) {
      const planted = cropForSeed(held);
      if (planted) return { key: 'E', text: `Plant ${planted.name}` };
      if (has('seeds')) return { key: 'E', text: 'Plant Flax (wild seeds)' };
      return { key: null, text: 'Farm Plot · hold seeds, berries, herbs or mushrooms to plant' };
    }
    const def = cropDef(crop.id);
    const name = def?.name ?? 'Crop';
    if (crop.growth >= 1) return { key: 'E', text: `Harvest ${name}` };
    const pct = `${Math.floor(crop.growth * 100)}%`;
    if (!def?.damp && held === 'waterskin' && charges > 0 && crop.water < 0.7) return { key: 'E', text: `Water ${name} · ${pct}` };
    const soil = def?.damp ? 'damp' : crop.water > 0.05 ? 'watered' : 'dry soil, water it';
    return { key: null, text: `${name} · ${pct} grown · ${soil}` };
  }

  /** Plant, water or harvest. The caller applies inventory changes. */
  use(d: StructureData, held: string | null, charges: number, has: (item: string) => boolean, now: number): FarmAction | null {
    const crop = normalizeCrop(d.crop, now);
    if (!crop) {
      const def = cropForSeed(held) ?? (has('seeds') ? cropForSeed('seeds') : null);
      if (!def) return null;
      d.crop = { id: def.id, growth: 0, water: def.damp ? 1 : 0, last: now, harvests: 0 };
      return { consume: def.seed, message: `${def.name} planted${def.damp ? '' : ' · water it, or wait for rain'}` };
    }
    const def = cropDef(crop.id);
    if (!def) return null;
    if (crop.growth >= 1) {
      const give = harvestYield(d.id, crop);
      crop.harvests += 1;
      if (def.regrow !== undefined) {
        crop.growth = def.regrow;
        d.crop = crop;
      } else d.crop = null;
      return { give, message: def.regrow !== undefined ? `${def.name} picked · it will fruit again` : `${def.name} harvested` };
    }
    if (!def.damp && held === 'waterskin' && charges > 0 && crop.water < 0.7) {
      crop.water = 1;
      d.crop = crop;
      return { watered: true, message: `${def.name} watered` };
    }
    return null;
  }

  clear(): void {
    for (const v of this.visuals.values()) this.group.remove(v.group);
    this.visuals.clear();
  }
}
