import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import { generateRock } from '../world/props/RockGenerator';
import { VEIL_RADIUS } from '../world/WorldConfig';
import type { WorldData } from '../world/WorldData';
import { LANDMARKS } from '../world/WorldLayout';
import type { Interactable } from './StoryWorld';

// The small finds between the named places, so a walk anywhere turns up
// something: Veyr cairns with a line carved into the capstone, packs left
// by the lost expedition, songstone shrines that give a Heartsong
// fragment, and echo stones that still hold a voice. About seventy, laid
// out once from the world seed; each is found once and remembered.

export type CuriosityKind = 'cairn' | 'pack' | 'shrine' | 'echo';

export interface Curiosity {
  id: string;
  kind: CuriosityKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Index into the kind's text or loot table. */
  pick: number;
}

/** Carved into Veyr cairns. */
export const CAIRN_LINES: readonly string[] = [
  'WE WALKED HERE WHEN THE HILL WAS YOUNG. THE HILL IS STILL YOUNG.',
  'SING LOW NEAR WATER. WATER REMEMBERS.',
  'THE CHOIRMASTER SAYS HOLD. WE HOLD.',
  'COUNT THE DAYS IN STONES. WE RAN OUT OF STONES.',
  'THIS WAY TO THE RIM. THE RIM IS ALWAYS THIS WAY.',
  'HERE LIES NO ONE. NO ONE HAS DIED IN A LONG TIME.',
  'THE BELLS KEEP THE NOTE. THE NOTE KEEPS US.',
  'IF YOU READ THIS, YOU ARE NEW. WELCOME. I AM SORRY.',
  'THE WARDENS ARE NOT ANGRY. THEY ARE TIRED.',
  'WE LEFT THE FIFTH VERSE UNSUNG. SOMEONE MUST.',
  'LISTEN TO THE STONES AT DUSK. THEY LISTEN BACK.',
  'THE GLASS TREES GREW FROM A SINGLE SUSTAINED CHORD.',
  'DO NOT SLEEP IN THE MIRE. THE MIRE DOES NOT SLEEP.',
  'THE FIRE MOUNTAIN HUMS A FIFTH BELOW THE REST.',
  'MY DAUGHTER CARVED THIS. SHE IS STILL SEVEN.',
  'THE SEA COMES IN. THE SEA DOES NOT GO OUT.',
];

/** What the lost expedition left behind. */
export const PACK_LOOT: readonly [string, number][][] = [
  [['rope', 2], ['cooked_meat', 1]],
  [['flint', 3], ['stick', 4]],
  [['salve', 1], ['herbs', 2]],
  [['iron_ore', 3], ['coal', 2]],
  [['flint_arrow', 6], ['feather', 3]],
  [['hide', 2], ['fiber', 5]],
  [['herbal_tea', 1], ['berries', 4]],
  [['gears', 1], ['airship_canvas', 1]],
];

/** What the echo stones still say. */
export const ECHO_LINES: readonly string[] = [
  '…one more time, from the top. Hold the last note. Hold it…',
  '…can you hear the sea? It has been breaking on that rock for a thousand years…',
  '…tell the Choirmaster we are ready. Tell him we are afraid…',
  '…I planted beans here. They are still beans. They are always beans…',
  '…whoever you are, the bells can be rung. They were made to be rung…',
  '…the light at the edge of the sea. Do not go through it. It goes through you…',
  '…the song is not a prison. It was a lullaby. We sang it too long…',
  '…count with me. One. One. One…',
];

const KINDS: [CuriosityKind, number][] = [
  ['cairn', 0.34],
  ['pack', 0.3],
  ['shrine', 0.14],
  ['echo', 0.22],
];

/** Lay out every curiosity from the world: dry, walkable ground away from named places. */
export function layoutCuriosities(world: WorldData, count = 72): Curiosity[] {
  const rng = createRng(0xc0e1105);
  const out: Curiosity[] = [];
  const kindCount: Record<CuriosityKind, number> = { cairn: 0, pack: 0, shrine: 0, echo: 0 };
  let tries = 0;
  while (out.length < count && tries < count * 60) {
    tries += 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (VEIL_RADIUS - 160);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Not in the crater city.
    if (Math.hypot(x, z) < 190) continue;
    if (world.waterDepthAt(x, z) > -0.2 || world.slopeAt(x, z) > 0.45) continue;
    if (LANDMARKS.some((l) => Math.hypot(l.x - x, l.z - z) < 45)) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 70)) continue;
    let roll = rng();
    let kind: CuriosityKind = 'cairn';
    for (const [k, w] of KINDS) {
      roll -= w;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    const pick = kindCount[kind];
    kindCount[kind] += 1;
    out.push({ id: `${kind}-${out.length}`, kind, x, y: world.groundAt(x, z), z, yaw: rng() * Math.PI * 2, pick });
  }
  return out;
}

export interface CuriosityHooks {
  isFound(id: string): boolean;
  found(c: Curiosity): void;
  give(item: string, count: number): void;
  say(speaker: string, text: string, seconds?: number): void;
}

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  return out;
}

export class Curiosities {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly list: Curiosity[];
  private readonly glow: THREE.MeshStandardMaterial;
  private time = 0;

  constructor(world: WorldData, interactables: Interactable[], private readonly hooks: CuriosityHooks) {
    this.group.name = 'curiosities';
    this.list = layoutCuriosities(world);
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.92 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.8 });
    const canvas = new THREE.MeshStandardMaterial({ color: 0xa89878, roughness: 0.95 });
    this.glow = new THREE.MeshStandardMaterial({ color: 0x1b6f64, emissive: 0x2bd6c0, emissiveIntensity: 1.4, roughness: 0.3 });
    this.materials.push(stone, leather, canvas, this.glow);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (m: THREE.Material, g: THREE.BufferGeometry, c: Curiosity, dx = 0, dy = 0, dz = 0) => {
      g.translate(dx, dy, dz);
      g.rotateY(c.yaw);
      g.translate(c.x, c.y, c.z);
      const list = byMat.get(m) ?? [];
      list.push(clean(g));
      byMat.set(m, list);
    };
    for (const c of this.list) {
      switch (c.kind) {
        case 'cairn': {
          // Stacked stones, largest at the bottom, a flat capstone.
          let y = 0;
          for (let k = 0; k < 5; k += 1) {
            const s = 0.55 - k * 0.08;
            const rock = generateRock({ seed: 400 + c.pick * 7 + k, kind: 'pebble', detail: 1 }).geometry.clone();
            rock.scale(s, s * 0.7, s);
            add(stone, rock, c, (k % 2 ? 0.05 : -0.04), y + s * 0.3, 0);
            y += s * 0.55;
          }
          add(stone, new THREE.BoxGeometry(0.5, 0.08, 0.36), c, 0, y + 0.1, 0);
          break;
        }
        case 'pack': {
          const bag = new THREE.SphereGeometry(0.3, 10, 8);
          bag.scale(1, 0.75, 0.7);
          add(leather, bag, c, 0, 0.22, 0);
          add(canvas, new THREE.BoxGeometry(0.4, 0.04, 0.5), c, 0.1, 0.02, 0.1);
          add(leather, new THREE.TorusGeometry(0.2, 0.025, 5, 12, Math.PI).rotateX(Math.PI / 2), c, 0, 0.42, 0);
          add(canvas, new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8).rotateZ(Math.PI / 2), c, 0, 0.1, -0.35);
          break;
        }
        case 'shrine': {
          // A songstone obelisk on a low plinth, with a glowing groove.
          add(stone, new THREE.CylinderGeometry(0.9, 1, 0.3, 8), c, 0, 0.15, 0);
          add(stone, new THREE.CylinderGeometry(0.18, 0.32, 2.2, 5), c, 0, 1.4, 0);
          add(this.glow, new THREE.BoxGeometry(0.06, 1.5, 0.36), c, 0, 1.35, 0);
          break;
        }
        case 'echo': {
          const s = generateRock({ seed: 900 + c.pick, kind: 'boulder', detail: 1 }).geometry.clone();
          s.scale(0.8, 1.2, 0.8);
          add(stone, s, c, 0, 0.3, 0);
          add(this.glow, new THREE.TorusGeometry(0.28, 0.03, 5, 16), c, 0, 1.1, 0.42);
          break;
        }
      }
      interactables.push({
        id: `curio:${c.id}`,
        position: new THREE.Vector3(c.x, c.y + (c.kind === 'shrine' ? 1.2 : 0.4), c.z),
        radius: c.kind === 'shrine' ? 1.1 : 0.8,
        prompt: () => (this.hooks.isFound(c.id) ? null : { key: 'E', text: PROMPTS[c.kind] }),
        use: () => this.use(c),
      });
    }
    for (const [m, list] of byMat) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = m !== this.glow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private use(c: Curiosity): void {
    if (this.hooks.isFound(c.id)) return;
    this.hooks.found(c);
    switch (c.kind) {
      case 'cairn':
        this.hooks.say('Carved into the capstone', CAIRN_LINES[c.pick % CAIRN_LINES.length], 6);
        break;
      case 'pack':
        for (const [item, n] of PACK_LOOT[c.pick % PACK_LOOT.length]) this.hooks.give(item, n);
        this.hooks.say('', 'A pack from the lost expedition, stiff with age.', 4);
        break;
      case 'shrine':
        this.hooks.give('heartsong', 1);
        this.hooks.say('', 'The song in the stone passes into you. It is warm.', 4);
        break;
      case 'echo':
        this.hooks.say('Echo', ECHO_LINES[c.pick % ECHO_LINES.length], 7);
        this.hooks.give('songstone', 1);
        break;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.glow.emissiveIntensity = 1.1 + 0.35 * Math.sin(this.time * 1.4);
  }
}

const PROMPTS: Record<CuriosityKind, string> = {
  cairn: 'Read the cairn',
  pack: 'Search the pack',
  shrine: 'Touch the shrine',
  echo: 'Listen to the stone',
};
