import * as THREE from 'three';
import type { EventBus } from '../core/Events';
import { createRng, hashString } from '../core/rng';
import { ORE } from '../render/props/propMaterials';
import type { PropHit, PropKindId, PropSystem } from '../world/props/PropSystem';
import type { TreeHit, VegetationSystem } from '../world/vegetation/VegetationSystem';
import type { WorldData } from '../world/WorldData';
import type { Inventory } from './Inventory';
import { itemDef, type ToolKind } from './items';
import type { Survival } from './Survival';

// What the survivor is looking at, and what pressing a button does to it:
// hand pickups (E), tool work with hit points (use/LMB), drinking from open
// water, eating and drinking from the hotbar. Yields are deterministic per
// node so reloading never rerolls loot.

export interface InteractionPrompt {
  key: string | null;
  text: string;
}

type Yield = [item: string, min: number, max: number, chance?: number];

interface PropRule {
  verb: string;
  name: string;
  tool?: ToolKind;
  tier?: number;
  hits?: number;
  regrowHours: number;
  yields: Yield[];
}

const HERB_ITEMS = ['herbs', 'moonmoss', 'frostmint'];
const HERB_NAMES = ['Yarrow', 'Moonmoss', 'Frostmint'];

const PROP_RULES: Record<Exclude<PropKindId, 'boulder' | 'rock_node'>, PropRule> = {
  stone: { verb: 'Pick up', name: 'Stone', regrowHours: 30, yields: [['stone', 1, 2]] },
  flint: { verb: 'Pick up', name: 'Flint', regrowHours: 36, yields: [['flint', 1, 1]] },
  stick: { verb: 'Pick up', name: 'Branch', regrowHours: 24, yields: [['stick', 1, 2]] },
  fiber_plant: { verb: 'Gather', name: 'Flax', regrowHours: 20, yields: [['fiber', 2, 3], ['seeds', 1, 1, 0.25]] },
  berry_bush: { verb: 'Pick', name: 'Lanternberries', regrowHours: 22, yields: [['berries', 3, 5]] },
  mushroom: { verb: 'Pick', name: 'Cap Mushrooms', regrowHours: 26, yields: [['mushroom', 1, 3]] },
  herb: { verb: 'Pick', name: 'Herbs', regrowHours: 24, yields: [['herbs', 1, 2]] },
  driftwood: { verb: 'Pick up', name: 'Driftwood', regrowHours: 48, yields: [['driftwood', 2, 2], ['stick', 1, 1]] },
  shell: { verb: 'Pick up', name: 'Shell', regrowHours: 40, yields: [['shell', 1, 2]] },
  clay: { verb: 'Dig', name: 'Clay Bank', regrowHours: 36, yields: [['clay', 2, 3]] },
};

const ORE_INFO: Record<number, { name: string; tier: number; yields: Yield[] }> = {
  [ORE.none]: { name: 'Rock', tier: 1, yields: [['stone', 3, 5], ['flint', 0, 2, 0.6]] },
  [ORE.iron]: { name: 'Iron Vein', tier: 1, yields: [['iron_ore', 2, 3], ['stone', 1, 3]] },
  [ORE.silver]: { name: 'Silver Vein', tier: 2, yields: [['silver_ore', 2, 3], ['stone', 1, 2]] },
  [ORE.coal]: { name: 'Coal Seam', tier: 1, yields: [['coal', 2, 4], ['stone', 1, 2]] },
  [ORE.sulfur]: { name: 'Sulfur Crust', tier: 1, yields: [['sulfur', 2, 3], ['stone', 1, 2]] },
  [ORE.obsidian]: { name: 'Obsidian Outcrop', tier: 2, yields: [['obsidian', 2, 3]] },
  [ORE.songstone]: { name: 'Songstone Cluster', tier: 1, yields: [['songstone', 1, 2], ['stone', 1, 2]] },
};

interface TreeRule {
  name: string;
  hits: number;
  yields: Yield[];
}

const TREE_RULES: Record<string, TreeRule> = {
  spruce: { name: 'Spruce', hits: 5, yields: [['wood', 4, 6], ['stick', 1, 3], ['resin', 1, 2, 0.6]] },
  pine: { name: 'Pine', hits: 5, yields: [['wood', 4, 6], ['stick', 1, 2], ['resin', 1, 2, 0.7]] },
  birch: { name: 'Birch', hits: 4, yields: [['wood', 3, 5], ['stick', 1, 3]] },
  oak: { name: 'Oak', hits: 7, yields: [['wood', 5, 7], ['hardwood', 1, 3], ['stick', 1, 2]] },
  willow: { name: 'Willow', hits: 5, yields: [['wood', 4, 5], ['fiber', 1, 3], ['stick', 1, 2]] },
  deadwood: { name: 'Dead Tree', hits: 3, yields: [['wood', 2, 4], ['stick', 2, 3]] },
  swampcypress: { name: 'Swamp Cypress', hits: 6, yields: [['wood', 4, 6], ['resin', 1, 2, 0.5], ['reeds', 1, 2, 0.4]] },
  glasstree: { name: 'Glass Tree', hits: 6, yields: [['wood', 3, 4], ['glass_petal', 1, 3], ['songstone', 1, 1, 0.3]] },
};

export interface GatherContext {
  camera: THREE.PerspectiveCamera;
  totalHours: number;
  /** Player feet position (for fall direction and reach). */
  playerX: number;
  playerZ: number;
  inWater: boolean;
}

export class Gathering {
  /** Current target (for the viewmodel and debug). */
  target: { kind: 'prop'; hit: PropHit } | { kind: 'tree'; hit: TreeHit } | { kind: 'water'; x: number; z: number } | null = null;
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly nodeHp = new Map<string, number>();
  private swingTimer = 0;
  private pendingHit: number = -1;
  private readonly reach = 2.9;

  constructor(
    private readonly events: EventBus,
    private readonly world: WorldData,
    private readonly props: PropSystem,
    private readonly vegetation: VegetationSystem,
    private readonly inventory: Inventory,
    private readonly survival: Survival,
  ) {}

  /** Is a swing in progress (0..1 progress) — for the viewmodel. */
  get swingProgress(): number {
    return this.swingTimer;
  }

  private heldTool(): { kind: ToolKind; tier: number; speed: number; damage: number } | null {
    const held = this.inventory.held;
    if (!held) return null;
    const def = itemDef(held.id);
    if (!def.tool) return null;
    return { kind: def.tool.kind, tier: def.tool.tier, speed: def.tool.speed, damage: def.tool.damage };
  }

  /** Aim ray from the camera; returns the prompt to show. */
  updateTarget(ctx: GatherContext): InteractionPrompt | null {
    ctx.camera.getWorldPosition(this.origin);
    ctx.camera.getWorldDirection(this.dir);
    const prop = this.props.pick(this.origin, this.dir, this.reach);
    const tree = this.vegetation.pickTree(this.origin, this.dir, this.reach + 0.3);
    this.target = null;
    if (prop && (!tree || prop.distance <= tree.distance + 0.3)) this.target = { kind: 'prop', hit: prop };
    else if (tree) this.target = { kind: 'tree', hit: tree };
    else {
      const water = this.waterAlongRay(2.6);
      if (water) this.target = { kind: 'water', x: water.x, z: water.z };
    }
    return this.promptFor();
  }

  private waterAlongRay(maxDistance: number): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    for (let t = 0.4; t <= maxDistance; t += 0.2) {
      p.copy(this.origin).addScaledVector(this.dir, t);
      const level = this.world.waterLevelAt(p.x, p.z);
      const ground = this.world.heightAt(p.x, p.z);
      if (ground > p.y) return null;
      if (level > ground + 0.08 && p.y <= level + 0.05) return p;
    }
    return null;
  }

  private promptFor(): InteractionPrompt | null {
    const t = this.target;
    const tool = this.heldTool();
    if (!t) {
      const held = this.inventory.held;
      if (held) {
        const def = itemDef(held.id);
        if (def.food) return { key: 'LMB', text: `${def.category === 'medicine' ? 'Use' : 'Eat'} ${def.name}` };
        if (def.tool?.kind === 'waterskin' && (held.durability ?? 0) > 0) return { key: 'LMB', text: `Drink (${held.durability} sips)` };
      }
      return null;
    }
    if (t.kind === 'water') {
      const held = this.inventory.held;
      if (held && itemDef(held.id).tool?.kind === 'waterskin') return { key: 'E', text: 'Fill Waterskin' };
      return { key: 'E', text: 'Drink' };
    }
    if (t.kind === 'tree') {
      const rule = TREE_RULES[t.hit.species];
      if (t.hit.bush) return { key: 'E', text: 'Break Branches' };
      if (!rule) return null;
      if (tool?.kind === 'axe') return { key: 'LMB', text: `Chop ${rule.name}` };
      return { key: null, text: `${rule.name} · needs an axe` };
    }
    const hit = t.hit;
    if (hit.kind === 'rock_node') {
      const info = ORE_INFO[hit.ore] ?? ORE_INFO[ORE.none];
      if (tool?.kind === 'pickaxe') {
        if (tool.tier < info.tier) return { key: null, text: `${info.name} · needs an iron pickaxe` };
        return { key: 'LMB', text: `Mine ${info.name}` };
      }
      return { key: null, text: `${info.name} · needs a pickaxe` };
    }
    const rule = PROP_RULES[hit.kind as keyof typeof PROP_RULES];
    if (!rule) return null;
    const name = hit.kind === 'herb' ? HERB_NAMES[hit.variant] ?? rule.name : rule.name;
    return { key: 'E', text: `${rule.verb} ${name}` };
  }

  /** E pressed: hand pickups, drinking, bushes. Returns true if something happened. */
  interact(ctx: GatherContext): boolean {
    const t = this.target;
    if (!t) return false;
    if (t.kind === 'water') {
      const held = this.inventory.held;
      if (held && itemDef(held.id).tool?.kind === 'waterskin') {
        held.durability = 5;
        this.events.emit('notify', { text: 'Waterskin filled', icon: 'waterskin', tone: 'good' });
        this.events.emit('inventoryChanged', {});
      } else {
        this.survival.drink(14);
        this.events.emit('consumed', { kind: 'drink' });
        this.events.emit('notify', { text: 'You drink the cold water', icon: 'water', tone: 'info' });
      }
      this.events.emit('splash', { strength: 0.25, x: t.x, y: this.world.waterLevelAt(t.x, t.z), z: t.z });
      return true;
    }
    if (t.kind === 'tree') {
      if (!t.hit.bush) return false;
      this.give(t.hit.id, [
        ['stick', 1, 2],
        ['fiber', 0, 1, 0.6],
      ]);
      this.vegetation.fell(t.hit, ctx.totalHours + 24, ctx.playerX, ctx.playerZ);
      this.events.emit('gathered', { resource: 'bush', x: t.hit.x, y: t.hit.y, z: t.hit.z });
      return true;
    }
    const hit = t.hit;
    if (hit.kind === 'rock_node' || hit.kind === 'boulder') return false;
    const rule = PROP_RULES[hit.kind];
    let yields = rule.yields;
    if (hit.kind === 'herb') yields = [[HERB_ITEMS[hit.variant] ?? 'herbs', 1, 2]];
    if (hit.kind === 'fiber_plant' && this.heldTool()?.kind === 'sickle') yields = [['fiber', 4, 6], ['seeds', 1, 2, 0.4]];
    if (!this.give(hit.id, yields)) return false;
    this.props.harvest(hit, ctx.totalHours + rule.regrowHours);
    this.events.emit('gathered', { resource: hit.kind, x: hit.x, y: hit.y, z: hit.z });
    return true;
  }

  /** Use/LMB pressed: swing a tool, eat, drink. */
  use(ctx: GatherContext): boolean {
    const held = this.inventory.held;
    if (!held) return false;
    const def = itemDef(held.id);
    if (def.food) {
      const f = def.food;
      this.survival.eat(f.food, f.water);
      if (f.health) this.survival.heal(f.health);
      if (f.stamina) this.survival.stamina = Math.min(this.survival.maxStamina, this.survival.stamina + f.stamina);
      if (f.warmth) this.survival.bodyTemp += Math.sign(f.warmth) * Math.min(1.2, Math.abs(f.warmth) / 150);
      if (f.risk && hashString(`${held.id}:${ctx.totalHours.toFixed(2)}`) % 1000 < f.risk * 1000) {
        this.survival.damage(4, 'food poisoning');
        this.survival.water = Math.max(0, this.survival.water - 8);
        this.events.emit('notify', { text: 'Your stomach turns. Cook it next time.', icon: 'meat', tone: 'bad' });
      }
      this.inventory.consumeSlot(this.inventory.selected, 1);
      this.events.emit('consumed', { kind: f.food > 0 ? 'eat' : 'drink' });
      this.events.emit('notify', { text: `${def.category === 'medicine' ? 'Used' : 'Ate'} ${def.name}`, icon: def.icon, tone: 'good' });
      return true;
    }
    if (def.tool?.kind === 'waterskin') {
      if ((held.durability ?? 0) <= 0) {
        this.events.emit('notify', { text: 'The waterskin is empty', icon: 'waterskin', tone: 'warn' });
        return false;
      }
      held.durability = (held.durability ?? 1) - 1;
      this.survival.drink(20);
      this.events.emit('consumed', { kind: 'drink' });
      this.events.emit('inventoryChanged', {});
      return true;
    }
    const tool = this.heldTool();
    if (!tool || this.swingTimer > 0) return false;
    // Start a swing; the hit lands partway through.
    this.swingTimer = 1;
    this.pendingHit = 0.55;
    this.swingDuration = 1 / Math.max(0.5, tool.speed);
    this.events.emit('swing', { tool: tool.kind });
    this.survival.spend(4);
    return true;
  }

  private swingDuration = 0.7;
  /** Hook: try to hit a creature first (returns true if something was hit). */
  creatureHit: ((origin: THREE.Vector3, dir: THREE.Vector3, reach: number, damage: number) => boolean) | null = null;

  /** Advance swings; resolves hits at impact time. */
  update(dt: number, ctx: GatherContext): void {
    if (this.swingTimer <= 0) return;
    this.swingTimer = Math.max(0, this.swingTimer - dt / this.swingDuration);
    if (this.pendingHit >= 0 && 1 - this.swingTimer >= this.pendingHit) {
      this.pendingHit = -1;
      this.resolveHit(ctx);
    }
  }

  private resolveHit(ctx: GatherContext): void {
    const tool = this.heldTool();
    if (tool && this.creatureHit) {
      ctx.camera.getWorldPosition(this.origin);
      ctx.camera.getWorldDirection(this.dir);
      const reach = tool.kind === 'spear' ? 3.4 : tool.kind === 'bow' ? 3 : 2.8;
      if (this.creatureHit(this.origin, this.dir, reach, tool.damage)) {
        this.inventory.wearHeld(1);
        return;
      }
    }
    const t = this.target;
    if (!tool || !t || t.kind === 'water') return;
    if (t.kind === 'tree') {
      const rule = TREE_RULES[t.hit.species];
      if (!rule || t.hit.bush || tool.kind !== 'axe') {
        this.events.emit('hit', { target: 'tree', material: 'wood-glance', x: t.hit.x, y: t.hit.y + 1, z: t.hit.z });
        return;
      }
      const hits = Math.max(1, Math.round(rule.hits / (tool.tier >= 2 ? 1.8 : 1)));
      const left = (this.nodeHp.get(t.hit.id) ?? hits) - 1;
      this.inventory.wearHeld(1);
      this.events.emit('hit', { target: 'tree', material: 'wood', x: t.hit.x, y: t.hit.y + 1.1, z: t.hit.z });
      if (left > 0) {
        this.nodeHp.set(t.hit.id, left);
        return;
      }
      this.nodeHp.delete(t.hit.id);
      this.give(t.hit.id, rule.yields);
      const hit = t.hit;
      this.vegetation.fell(hit, ctx.totalHours + 72, ctx.playerX, ctx.playerZ, () => {
        this.events.emit('hit', { target: 'treefall', material: 'timber', x: hit.x, y: hit.y, z: hit.z });
      });
      this.events.emit('gathered', { resource: `tree:${hit.species}`, x: hit.x, y: hit.y, z: hit.z });
      return;
    }
    const hit = t.hit;
    if (hit.kind !== 'rock_node') {
      this.events.emit('hit', { target: hit.kind, material: 'soft', x: hit.x, y: hit.y, z: hit.z });
      return;
    }
    const info = ORE_INFO[hit.ore] ?? ORE_INFO[ORE.none];
    if (tool.kind !== 'pickaxe' || tool.tier < info.tier) {
      this.events.emit('hit', { target: 'rock', material: 'stone-glance', x: hit.x, y: hit.y + 0.5, z: hit.z });
      return;
    }
    const hits = tool.tier >= 2 ? 3 : 5;
    const left = (this.nodeHp.get(hit.id) ?? hits) - 1;
    this.inventory.wearHeld(1);
    this.events.emit('hit', { target: 'rock', material: 'stone', x: hit.x, y: hit.y + 0.5, z: hit.z });
    if (left > 0) {
      this.nodeHp.set(hit.id, left);
      return;
    }
    this.nodeHp.delete(hit.id);
    this.give(hit.id, info.yields);
    this.props.harvest(hit, ctx.totalHours + 60);
    this.events.emit('gathered', { resource: `ore:${hit.ore}`, x: hit.x, y: hit.y, z: hit.z });
  }

  /** Grant deterministic yields for a node; false if the pack is full. */
  private give(nodeId: string, yields: Yield[]): boolean {
    const rng = createRng(hashString(nodeId) ^ 0x9e3779b9);
    const grants: [string, number][] = [];
    for (const [item, min, max, chance] of yields) {
      if (chance !== undefined && rng() > chance) continue;
      const n = min + Math.floor(rng() * (max - min + 1));
      if (n > 0) grants.push([item, n]);
    }
    if (grants.length > 0 && !this.inventory.canFit(grants[0][0], grants[0][1])) {
      this.events.emit('notify', { text: 'Your pack is full', icon: 'bag', tone: 'warn' });
      return false;
    }
    for (const [item, n] of grants) this.inventory.add(item, n);
    return true;
  }

  serialize(): [string, number][] {
    return [...this.nodeHp.entries()];
  }
}
