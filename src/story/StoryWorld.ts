import * as THREE from 'three';
import type { EventBus } from '../core/Events';
import type { WorldData } from '../world/WorldData';
import { LANDMARKS } from '../world/WorldLayout';
import { generateRock } from '../world/props/RockGenerator';
import type { QuestTracker } from './Quests';
import { BELL_WARDENS, GLYPHS, NPCS, TUNING_ORDER, type NpcDef } from './StoryData';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { buildHumanFigure, type HumanFigure } from './figures/HumanFigure';
import { buildCrate, buildFireRing, buildTent, createCampMaterials } from './campProps';

// The physical side of the story: the survivors standing in the world,
// the set pieces that make landmarks recognisable, and the interactables
// the quests hinge on (mural, tuning stones, lantern pedestal, vault door,
// the flight log, the lookout). Everything is procedural geometry.

export interface Interactable {
  id: string;
  position: THREE.Vector3;
  radius: number;
  prompt(): { key: string | null; text: string } | null;
  use(): void;
}

interface NpcFigure {
  def: NpcDef;
  group: THREE.Group;
  head: THREE.Object3D;
  body: THREE.Object3D;
  present: boolean;
  materials: THREE.MeshStandardMaterial[];
  figure: HumanFigure;
}

function mat(color: number, roughness = 0.85, metalness = 0, emissive = 0, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
}

function glyphTexture(glyph: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.font = '92px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface StoryHooks {
  heldItem(): string | null;
  give(item: string, count: number): void;
  playTone(index: number, correct: boolean): void;
  say(speaker: string, text: string, seconds?: number): void;
  talk(npc: string): void;
  playerPosition(): THREE.Vector3;
  /** A freed Bellstone is struck: toll, memory, reward. */
  ringBell(id: string): void;
}

export class StoryWorld {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly npcs: NpcFigure[] = [];
  private tuneProgress = 0;
  private readonly stoneGlows: THREE.MeshStandardMaterial[] = [];
  private lanternOnPedestal: THREE.Object3D | null = null;
  private vaultDoor: THREE.Object3D | null = null;
  private readonly doorColliders: { x: number; z: number; radius: number; height: number; baseY: number }[] = [];
  private ilyrMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly bellGlows = new Map<string, THREE.MeshStandardMaterial>();
  private bellPulse = 0;
  private time = 0;
  private readonly lookTarget = new THREE.Vector3();
  private readonly m = {
    stone: mat(0x7c786f, 0.92),
    darkStone: mat(0x55524c, 0.9),
    wood: mat(0x6b4a2c, 0.85),
    plank: mat(0x8a6a44, 0.82),
    canvas: mat(0xcfc3a4, 0.9),
    canvasDark: mat(0x8f846b, 0.95),
    brass: mat(0xb08d4a, 0.35, 1),
    iron: mat(0x55575c, 0.5, 0.8),
    rope: mat(0xa8946a, 0.95),
    songstone: mat(0x2bd6c0, 0.2, 0, 0x1fb8a4, 2.2),
    glass: mat(0xbfe9ff, 0.1, 0, 0x2a8a80, 0.6),
  };

  constructor(
    private readonly world: WorldData,
    private readonly events: EventBus,
    private readonly quests: QuestTracker,
    private readonly hooks: StoryHooks,
  ) {
    for (const m of Object.values(this.m)) this.materials.push(m);
    this.buildCamp();
    this.buildWreck();
    this.buildSingingStones();
    this.buildVault();
    this.buildTail();
    this.buildLookout();
    this.buildBellstones();
    for (const def of NPCS) this.buildNpc(def);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.noShadow) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  private lm(id: string): { x: number; y: number; z: number } {
    const l = LANDMARKS.find((d) => d.id === id);
    if (!l) throw new Error(`Unknown landmark ${id}`);
    return { x: l.x, y: this.world.groundAt(l.x, l.z), z: l.z };
  }

  private ground(x: number, z: number): number {
    return this.world.groundAt(x, z);
  }

  private add(mesh: THREE.Object3D, x: number, z: number, yOffset = 0): THREE.Object3D {
    mesh.position.set(x, this.ground(x, z) + yOffset, z);
    this.group.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // Set pieces

  private buildCamp(): void {
    const c = this.lm('crash_camp');
    const kit = createCampMaterials();
    this.materials.push(...Object.values(kit));
    // Two ridge tents from salvaged envelope canvas, guyed out.
    for (const [dx, dz, yaw, seed] of [
      [-6, 4, 0.4, 11],
      [7, 5, -0.6, 12],
    ]) {
      const tent = buildTent(kit, seed);
      tent.rotation.y = yaw;
      this.add(tent, c.x + dx, c.z + dz);
    }
    // Crates and a salvaged propeller blade.
    for (const [dx, dz, s] of [
      [-3, -5, 0.7],
      [-2.2, -5.4, 0.5],
      [5, -4, 0.6],
    ]) {
      const crate = buildCrate(kit, s);
      crate.rotation.y = dx;
      this.add(crate, c.x + dx, c.z + dz);
    }
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 2.6), this.m.brass);
    blade.rotation.set(0.3, 0.8, 0.15);
    this.add(blade, c.x - 8, c.z - 2, 0.3);
    // Last night's fire, burnt down to embers.
    this.add(buildFireRing(kit, 4400), c.x, c.z + 1.5);
  }

  private buildWreck(): void {
    const w = this.lm('meridian_wreck');
    const hull = new THREE.Group();
    // Gondola: a long planked boat hull lying on its side.
    const shape = new THREE.Shape();
    shape.moveTo(-1.6, 0);
    shape.quadraticCurveTo(-1.8, -1.6, 0, -1.9);
    shape.quadraticCurveTo(1.8, -1.6, 1.6, 0);
    shape.lineTo(-1.6, 0);
    const gondola = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 14, bevelEnabled: false, curveSegments: 10 }), this.m.plank);
    gondola.rotation.set(0, 0.35, 0.55);
    gondola.position.set(0, 1.4, -7);
    hull.add(gondola);
    // Envelope ribs arching over the grove and torn canvas draped between them.
    for (let i = 0; i < 7; i += 1) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(5.5 - Math.abs(i - 3) * 0.6, 0.08, 6, 20, Math.PI * (0.7 + (i % 3) * 0.08)), this.m.iron);
      rib.position.set(-6 + i * 3.2, 0, 3);
      rib.rotation.set(0, Math.PI / 2 + 0.1 * (i - 3), 0.1 * (i % 2 ? 1 : -1));
      hull.add(rib);
    }
    const envelope = new THREE.Mesh(new THREE.PlaneGeometry(22, 9, 22, 8), this.m.canvasDark);
    const pos = envelope.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.45) * 0.8 + Math.cos(y * 0.9 + x * 0.2) * 0.5 + (y + 4.5) * 0.4);
    }
    envelope.geometry.computeVertexNormals();
    (envelope.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    envelope.rotation.set(-Math.PI / 2 + 0.35, 0, 0.1);
    envelope.position.set(3, 2.6, 4);
    hull.add(envelope);
    // Brass engine nacelle with a bent propeller.
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 3, 12), this.m.brass);
    nacelle.rotation.set(Math.PI / 2, 0, 0.4);
    nacelle.position.set(6, 0.8, -3);
    hull.add(nacelle);
    hull.rotation.y = 0.6;
    this.add(hull, w.x, w.z);
  }

  private buildSingingStones(): void {
    const c = this.lm('singing_stones');
    const R = 7;
    const standing = generateRock({ seed: 4500, kind: 'crag', detail: 3 }).geometry;
    // Ring of five tuning stones, each with a glowing glyph.
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const x = c.x + Math.cos(a) * R;
      const z = c.z + Math.sin(a) * R;
      const stone = new THREE.Mesh(standing, this.m.stone);
      stone.scale.set(0.8, 1.9, 0.7);
      stone.rotation.y = -a;
      this.add(stone, x, z, -0.2);
      const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2bd6c0, emissiveIntensity: 0.25, emissiveMap: glyphTexture(GLYPHS[i]), transparent: true, opacity: 0.95, alphaMap: glyphTexture(GLYPHS[i]) });
      this.stoneGlows.push(glow);
      this.materials.push(glow);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), glow);
      plate.userData.noShadow = true;
      // Face the ring centre.
      const inward = new THREE.Vector3(c.x - x, 0, c.z - z).normalize();
      plate.position.set(x + inward.x * 0.75, this.ground(x, z) + 1.5, z + inward.z * 0.75);
      plate.lookAt(c.x, this.ground(x, z) + 1.5, c.z);
      this.group.add(plate);
      const index = i;
      this.interactables.push({
        id: `tuning_${i}`,
        position: new THREE.Vector3(x, this.ground(x, z) + 1.2, z),
        radius: 1.3,
        prompt: () => (this.quests.flags.has('stones_tuned') ? null : { key: 'E', text: 'Strike the stone' }),
        use: () => this.strike(index),
      });
    }
    // Mural slab.
    const mx = c.x + R + 3;
    const mz = c.z - 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.35), this.m.darkStone);
    slab.rotation.set(-0.25, Math.PI / 2, 0);
    this.add(slab, mx, mz, 0.7);
    this.interactables.push({
      id: 'mural',
      position: new THREE.Vector3(mx, this.ground(mx, mz) + 0.9, mz),
      radius: 1.6,
      prompt: () => ({ key: 'E', text: 'Read the mural' }),
      use: () => {
        const order = TUNING_ORDER.map((i) => GLYPHS[i]).join('   ');
        this.hooks.say('Mural', `Five glyphs are carved in a line, worn but clear:   ${order}`, 9);
        this.quests.setFlag('read_mural');
      },
    });
    // Pedestal with the Echo Lantern.
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.1, 8), this.m.stone);
    this.add(pedestal, c.x, c.z, 0.5);
    const lantern = new THREE.Group();
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.3, 8, 1, true), this.m.brass);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), this.m.songstone);
    lantern.add(cage, core);
    this.add(lantern, c.x, c.z, 1.25);
    // Taken away later, so never solid.
    lantern.userData.moving = true;
    this.lanternOnPedestal = lantern;
    this.interactables.push({
      id: 'lantern_pedestal',
      position: new THREE.Vector3(c.x, this.ground(c.x, c.z) + 1.2, c.z),
      radius: 1,
      prompt: () => {
        if (!this.lanternOnPedestal?.visible) return null;
        return this.quests.flags.has('stones_tuned') ? { key: 'E', text: 'Take the Echo Lantern' } : { key: null, text: 'The lantern is sealed in light' };
      },
      use: () => {
        if (!this.quests.flags.has('stones_tuned') || !this.lanternOnPedestal) return;
        this.lanternOnPedestal.visible = false;
        this.hooks.give('echo_lantern', 1);
        this.quests.setFlag('has_lantern');
      },
    });
  }

  private strike(index: number): void {
    if (this.quests.flags.has('stones_tuned')) return;
    const expected = TUNING_ORDER[this.tuneProgress];
    const correct = index === expected;
    this.hooks.playTone(index, correct);
    const glow = this.stoneGlows[index];
    glow.emissiveIntensity = correct ? 3.5 : 0.1;
    if (!correct) {
      this.tuneProgress = 0;
      for (const g of this.stoneGlows) g.emissiveIntensity = 0.25;
      this.events.emit('notify', { text: 'The stones fall silent', icon: 'songstone', tone: 'warn' });
      return;
    }
    this.tuneProgress += 1;
    if (this.tuneProgress >= TUNING_ORDER.length) {
      this.quests.setFlag('stones_tuned');
      for (const g of this.stoneGlows) g.emissiveIntensity = 2.5;
      this.events.emit('discovered', { id: 'lore:undersong', name: 'The Undersong', kind: 'lore' });
      this.hooks.say('', 'The ring hums in one long chord. Light gathers above the pedestal.', 6);
    }
  }

  private buildVault(): void {
    const v = this.lm('tocks_vault');
    const arch = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1.2), this.m.darkStone);
    left.position.set(-2, 2, 0);
    const right = left.clone();
    right.position.x = 2;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1, 1.4), this.m.darkStone);
    lintel.position.y = 4.3;
    const door = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.4), this.m.stone);
    door.position.set(0, 1.9, 0);
    const seal = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 20), this.m.songstone);
    seal.position.set(0, 2.2, 0.22);
    door.add(seal);
    arch.add(left, right, lintel, door);
    arch.rotation.y = 0.9;
    this.add(arch, v.x, v.z);
    // The door sinks when the vault opens; the arch round it stays solid.
    // Until then the door is a wall of its own (see collidersNear).
    door.userData.moving = true;
    this.vaultDoor = door;
    for (const k of [-1, 0, 1]) this.doorColliders.push({ x: v.x + Math.cos(0.9) * k, z: v.z - Math.sin(0.9) * k, radius: 0.6, height: 3.8, baseY: v.y - 0.3 });
    this.interactables.push({
      id: 'vault_door',
      position: new THREE.Vector3(v.x, v.y + 1.8, v.z),
      radius: 2.2,
      prompt: () => {
        if (this.quests.flags.has('vault_open')) return null;
        if (!this.quests.isActive('rescue_tock')) return { key: null, text: 'Something knocks behind the door' };
        return this.hooks.heldItem() === 'echo_lantern' ? { key: 'E', text: 'Raise the Echo Lantern to the seal' } : { key: null, text: 'Sealed · the ring answers to the Echo Lantern' };
      },
      use: () => {
        if (!this.quests.isActive('rescue_tock') || this.hooks.heldItem() !== 'echo_lantern') return;
        this.quests.setFlag('vault_open');
        this.events.emit('hit', { target: 'vault', material: 'timber', x: v.x, y: v.y, z: v.z });
      },
    });
  }

  private buildTail(): void {
    const t = this.lm('meridian_tail');
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, 3.5), this.m.canvasDark);
    fin.rotation.set(0.3, 0.4, 0.4);
    this.add(fin, t.x, t.z, 1.6);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 7, 10), this.m.brass);
    boom.rotation.set(Math.PI / 2, 0.4, 0.2);
    this.add(boom, t.x + 1.5, t.z - 2, 0.6);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.55), this.m.plank);
    this.add(chest, t.x - 3, t.z + 1, 0.25);
    this.interactables.push({
      id: 'flight_log',
      position: new THREE.Vector3(t.x - 3, this.ground(t.x - 3, t.z + 1) + 0.4, t.z + 1),
      radius: 1.2,
      prompt: () => (this.quests.flags.has('found_log') ? null : { key: 'E', text: 'Search the navigator’s chest' }),
      use: () => {
        this.quests.setFlag('found_log');
        this.hooks.give('airship_canvas', 1);
        this.hooks.say('Flight log', '“Day 14. Instruments show land inside the shimmer. Crew uneasy. Holding course. — I.V.”', 8);
      },
    });
  }

  private buildLookout(): void {
    const l = this.lm('rim_lookout');
    const cairn = new THREE.Group();
    const rock = generateRock({ seed: 4700, kind: 'pebble', detail: 2 }).geometry;
    for (let i = 0; i < 6; i += 1) {
      const s = new THREE.Mesh(rock, this.m.stone);
      s.scale.setScalar(0.5 - i * 0.06);
      s.position.set(0, 0.2 + i * 0.3, 0);
      s.rotation.y = i * 1.3;
      cairn.add(s);
    }
    this.add(cairn, l.x, l.z);
    this.interactables.push({
      id: 'lookout',
      position: new THREE.Vector3(l.x, l.y + 1, l.z),
      radius: 2.2,
      prompt: () => {
        if (this.quests.flags.has('saw_stillheart') || !this.quests.isActive('needle')) return null;
        return this.hooks.heldItem() === 'echo_lantern' ? { key: 'E', text: 'Listen with the Echo Lantern' } : { key: null, text: 'Hold the Echo Lantern to listen' };
      },
      use: () => {
        if (this.hooks.heldItem() !== 'echo_lantern') return;
        this.quests.setFlag('saw_stillheart');
        this.events.emit('discovered', { id: 'lore:stillheart', name: 'The Held Note', kind: 'lore' });
        this.hooks.say('Ilyr', 'There. Beneath the light in the crater: Hallowmere, still singing its last note. Five bells hold it. Five bells can let it go.', 10);
      },
    });
  }

  private buildBellstones(): void {
    for (const id of ['bell_hollowpine', 'bell_coast', 'bell_cinder', 'bell_frost', 'bell_fen']) {
      const b = this.lm(id);
      const spire = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 1.2, 10), this.m.darkStone);
      base.position.y = 0.6;
      spire.add(base);
      // A tuning fork of stone, ringed with songstone.
      for (const side of [-1, 1]) {
        const tine = new THREE.Mesh(new THREE.BoxGeometry(0.9, 11, 1.1), this.m.stone);
        tine.position.set(side * 1.1, 6.6, 0);
        tine.rotation.z = side * -0.04;
        spire.add(tine);
      }
      const yoke = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.45, 8, 16, Math.PI), this.m.stone);
      yoke.rotation.z = Math.PI;
      yoke.position.y = 1.6;
      spire.add(yoke);
      // Each bell's bands glow on their own: dim while bound, bright once rung.
      const glow = this.m.songstone.clone();
      glow.emissiveIntensity = 0.9;
      this.materials.push(glow);
      this.bellGlows.set(id, glow);
      for (let k = 0; k < 3; k += 1) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.08, 6, 24), glow);
        band.rotation.x = Math.PI / 2;
        band.position.y = 3 + k * 3;
        band.userData.noShadow = true;
        spire.add(band);
      }
      spire.rotation.y = b.x * 0.01;
      this.add(spire, b.x, b.z, -0.3);
      const flag = `rung_${id}`;
      this.interactables.push({
        id: `bell:${id}`,
        position: new THREE.Vector3(b.x, b.y + 1.6, b.z),
        radius: 2.8,
        prompt: () => {
          if (this.quests.flags.has(flag)) return null;
          if (this.quests.flags.has(BELL_WARDENS[id])) return { key: 'E', text: 'Ring the Bellstone' };
          return { key: null, text: 'The Bellstone is silent. Something here will not let it ring.' };
        },
        use: () => {
          if (this.quests.flags.has(flag) || !this.quests.flags.has(BELL_WARDENS[id])) return;
          this.quests.setFlag(flag);
          this.bellPulse = 1;
          this.hooks.ringBell(id);
        },
      });
    }
  }

  /** The vault door, while it is still shut. */
  collidersNear(x: number, z: number, r: number, out: { x: number; z: number; radius: number; height: number; baseY?: number }[]): void {
    if (this.quests.flags.has('vault_open')) return;
    for (const c of this.doorColliders) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (r + c.radius) ** 2) out.push(c);
  }

  // ---------------------------------------------------------------------------
  // Survivors

  private buildNpc(def: NpcDef): void {
    const look = def.look;
    const echo = Boolean(look.echo);
    // Ilyr is an echo: one glowing, see-through material over a real form.
    const echoMat = echo ? new THREE.MeshStandardMaterial({ color: look.coat, emissive: look.coat, emissiveIntensity: 1.6, transparent: true, opacity: 0.55, roughness: 0.4, depthWrite: false }) : null;
    if (echoMat) this.ilyrMaterial = echoMat;
    const figure = buildHumanFigure(look, echoMat);
    const g = figure.group;
    const head = figure.head;
    const body = figure.body;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && echo) {
        o.layers.set(LAYER_TRANSPARENT);
        o.userData.noShadow = true;
      }
    });
    g.visible = false;
    // Survivors walk about: not part of the solid ground.
    g.userData.moving = true;
    this.group.add(g);
    const materials = echoMat ? [echoMat] : figure.materials;
    for (const m of materials) if (!this.materials.includes(m)) this.materials.push(m);
    this.npcs.push({ def, group: g, head, body, present: false, materials, figure });
    this.interactables.push({
      id: `npc:${def.id}`,
      position: new THREE.Vector3(),
      radius: 0.7,
      prompt: () => (this.npcFigure(def.id)?.present ? { key: 'E', text: `Talk to ${def.name.split(' ')[0] === 'Captain' ? 'Captain Varga' : def.name.replace(/ ".*"/, '')}` } : null),
      use: () => this.hooks.talk(def.id),
    });
  }

  private npcFigure(id: string): NpcFigure | undefined {
    return this.npcs.find((n) => n.def.id === id);
  }

  /** Where an NPC stands right now (null when absent). */
  npcPosition(id: string): THREE.Vector3 | null {
    const f = this.npcFigure(id);
    if (!f) return null;
    this.placeNpc(f);
    return f.present ? f.group.position : null;
  }

  private placeNpc(f: NpcFigure): void {
    const joined = f.def.startsAtCamp || (f.def.id === 'tock' && this.quests.isDone('rescue_tock')) || (f.def.id === 'wren' && this.quests.isDone('rescue_wren'));
    let present = true;
    let anchor = f.def.home;
    let offset = { dx: f.def.home.dx, dz: f.def.home.dz };
    if (joined) {
      anchor = { landmark: 'crash_camp', dx: 0, dz: 0 };
      offset = f.def.camp;
    } else if (f.def.id === 'tock') present = this.quests.flags.has('vault_open');
    else if (f.def.id === 'wren') present = this.quests.isActive('rescue_wren');
    else if (f.def.id === 'ilyr') present = this.quests.flags.has('stones_tuned');
    const l = this.lm(anchor.landmark);
    const x = l.x + offset.dx;
    const z = l.z + offset.dz;
    f.present = present;
    f.group.visible = present;
    f.group.position.set(x, this.ground(x, z), z);
    const ia = this.interactables.find((i) => i.id === `npc:${f.def.id}`);
    if (ia) ia.position.set(x, f.group.position.y + 1.2, z);
  }

  update(dt: number): void {
    this.time += dt;
    const player = this.hooks.playerPosition();
    for (const f of this.npcs) {
      this.placeNpc(f);
      if (!f.present) continue;
      // Idle: breathe, sway, and turn to face the survivor when near.
      const dx = player.x - f.group.position.x;
      const dz = player.z - f.group.position.z;
      const d = Math.hypot(dx, dz);
      const face = Math.atan2(-dx, -dz);
      if (d < 10) {
        let delta = face - f.group.rotation.y;
        delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        f.group.rotation.y += delta * Math.min(1, dt * 2.5);
      }
      // Breathing, blinking, and eyes on whoever comes to talk.
      this.lookTarget.set(player.x, player.y + 1.6, player.z);
      f.figure.update(dt, this.time, d < 7 ? this.lookTarget : null);
    }
    this.bellPulse = Math.max(0, this.bellPulse - dt * 0.12);
    for (const [id, glow] of this.bellGlows) {
      const rung = this.quests.flags.has(`rung_${id}`);
      glow.emissiveIntensity = rung ? 2.4 + Math.sin(this.time * 1.4) * 0.4 + this.bellPulse * 6 : 0.7 + Math.sin(this.time * 0.6) * 0.15;
    }
    if (this.ilyrMaterial) this.ilyrMaterial.opacity = 0.4 + 0.18 * Math.sin(this.time * 3.1) * Math.sin(this.time * 1.7);
    if (this.lanternOnPedestal?.visible) {
      this.lanternOnPedestal.rotation.y += dt * 0.8;
      this.lanternOnPedestal.position.y += Math.sin(this.time * 2) * 0.0015;
    }
    if (this.vaultDoor && this.quests.flags.has('vault_open') && this.vaultDoor.position.y > -2) this.vaultDoor.position.y -= dt * 1.2;
    if (this.quests.flags.has('has_lantern') && this.lanternOnPedestal) this.lanternOnPedestal.visible = false;
    for (let i = 0; i < this.stoneGlows.length; i += 1) {
      const g = this.stoneGlows[i];
      if (!this.quests.flags.has('stones_tuned') && g.emissiveIntensity > 0.25) g.emissiveIntensity = Math.max(0.25, g.emissiveIntensity - dt * 0.6);
      if (this.quests.flags.has('stones_tuned')) g.emissiveIntensity = 2 + Math.sin(this.time * 2 + i) * 0.5;
    }
  }

  /** Nearest interactable along the view ray. */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): Interactable | null {
    let best: Interactable | null = null;
    let bestT = reach + 2;
    const to = new THREE.Vector3();
    for (const ia of this.interactables) {
      to.copy(ia.position).sub(origin);
      const along = to.dot(dir);
      if (along < 0 || along > reach + ia.radius) continue;
      const miss = to.addScaledVector(dir, -along).length();
      if (miss > ia.radius) continue;
      if (along < bestT && ia.prompt()) {
        bestT = along;
        best = ia;
      }
    }
    return best;
  }
}
