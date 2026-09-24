import type { IconName } from '../ui/icons';

// Every item in STILLWILD. Items are data: behaviour lives in the systems
// that read these fields (tools in Gathering/Combat, food in Survival,
// placeables in Building).

export type ItemCategory = 'resource' | 'tool' | 'weapon' | 'ammo' | 'food' | 'medicine' | 'placeable' | 'armor' | 'relic';

export type ToolKind = 'axe' | 'pickaxe' | 'knife' | 'torch' | 'lantern' | 'spear' | 'bow' | 'club' | 'sword' | 'hammer' | 'waterskin' | 'sickle';

export interface ToolStats {
  kind: ToolKind;
  /** Gathering tier: 0 hands, 1 stone, 2 iron, 3 songsteel. */
  tier: number;
  damage: number;
  /** Swings per second. */
  speed: number;
  durability: number;
  /** Reach in meters. */
  reach: number;
}

export interface FoodStats {
  food: number;
  water: number;
  health?: number;
  warmth?: number;
  stamina?: number;
  /** Chance (0..1) of a stomach ache when eaten raw. */
  risk?: number;
}

export interface ArmorStats {
  slot: 'head' | 'body' | 'cloak';
  protection: number;
  warmth: number;
  heat: number;
}

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  category: ItemCategory;
  stack: number;
  tool?: ToolStats;
  food?: FoodStats;
  armor?: ArmorStats;
  /** Structure or station placed by this item (Building system id). */
  places?: string;
  /** Liters for water containers. */
  capacity?: number;
}

const r = (id: string, name: string, icon: IconName, description: string, stack = 50): ItemDef => ({
  id,
  name,
  icon,
  description,
  category: 'resource',
  stack,
});

const food = (id: string, name: string, icon: IconName, description: string, stats: FoodStats, stack = 20): ItemDef => ({
  id,
  name,
  icon,
  description,
  category: 'food',
  stack,
  food: stats,
});

const tool = (id: string, name: string, icon: IconName, description: string, stats: ToolStats, category: ItemCategory = 'tool'): ItemDef => ({
  id,
  name,
  icon,
  description,
  category,
  stack: 1,
  tool: stats,
});

const place = (id: string, name: string, icon: IconName, description: string, places: string, stack = 5): ItemDef => ({
  id,
  name,
  icon,
  description,
  category: 'placeable',
  stack,
  places,
});

export const ITEMS: readonly ItemDef[] = [
  // Common resources
  r('wood', 'Wood', 'wood', 'Split logs. Burns, builds, and becomes almost anything.', 60),
  r('stick', 'Stick', 'stick', 'A straight branch. Handles, kindling, torches.', 60),
  r('stone', 'Stone', 'stone', 'Fist-sized stones from rocks and riverbeds.', 60),
  r('flint', 'Flint', 'flint', 'Knaps to a razor edge. Sparks against iron.', 40),
  r('fiber', 'Plant Fiber', 'fiber', 'Stripped grass and nettle stems. Twist it into rope.', 60),
  r('resin', 'Resin', 'resin', 'Sticky pine sap. Glue, torches and waterproofing.', 40),
  r('clay', 'Clay', 'clay', 'Riverbank clay. Fires into pots and bricks.', 40),
  r('herbs', 'Wild Herbs', 'herb', 'Yarrow and sorrel. Medicine and tea.', 30),
  r('hide', 'Raw Hide', 'hide', 'Needs a tanning rack before it is useful.', 20),
  r('feather', 'Feather', 'feather', 'Fletching for arrows.', 50),
  r('bone', 'Bone', 'bone', 'Tools, glue and grim decorations.', 30),
  r('rope', 'Rope', 'rope', 'Twisted fiber. Holds most things together.', 30),
  r('leather', 'Leather', 'hide', 'Tanned hide. Supple, tough, warm.', 30),
  r('cloth', 'Cloth', 'cloth', 'Woven fiber. Bandages, sails, bedding.', 30),
  // Regional
  r('hardwood', 'Hardwood', 'wood', 'Dense Hollowpine heartwood. Slow to burn, hard to break.', 40),
  r('moonmoss', 'Moonmoss', 'herb', 'Glows faintly after dark. Hollowpine remedies use it.', 30),
  r('driftwood', 'Driftwood', 'wood', 'Sea-bleached timber. Light and salt-cured.', 40),
  r('salt', 'Salt', 'stone', 'Scraped from tide pools. Preserves meat.', 40),
  r('shell', 'Shell', 'shell', 'Iridescent shell fragments.', 40),
  r('kelp', 'Kelp', 'herb', 'Rubbery sea weed. Surprisingly edible.', 30),
  r('chitin', 'Chitin', 'shell', 'Plates from a Shellback or Cinder beetle.', 30),
  r('iron_ore', 'Iron Ore', 'ore', 'Rust-veined rock. Smelt it.', 40),
  r('coal', 'Coal', 'stone', 'Burns hot enough for a forge.', 40),
  r('obsidian', 'Obsidian', 'flint', 'Volcanic glass. Sharper than any steel.', 30),
  r('sulfur', 'Sulfur', 'ore', 'Yellow crust from the vents. Smells like trouble.', 30),
  r('silver_ore', 'Silver Ore', 'ore', 'Bright veins from the frozen peaks.', 30),
  r('pelt', 'Thick Pelt', 'hide', 'Winter fur. The warmest thing on the island.', 20),
  r('warden_antler', 'Mossback’s Shed Antler', 'bone', 'Shed where the Warden knelt. Hard as iron and faintly humming.', 5),
  r('frostmint', 'Frostmint', 'herb', 'Cold to the touch. Tea of it cools the blood.', 30),
  r('ice_crystal', 'Ice Crystal', 'songstone', 'Never melts. Hums when the wind is right.', 20),
  r('reeds', 'Reeds', 'fiber', 'Hollow marsh reeds. Mats, roofs, pipes.', 50),
  r('bog_iron', 'Bog Iron', 'ore', 'Iron nodules grown in the mire.', 30),
  r('songstone', 'Songstone Shard', 'songstone', 'Crystallized Veyr. Rings softly when held.', 30),
  r('glass_petal', 'Glass Petal', 'songstone', 'A flower that forgot to wilt.', 30),
  // Rare
  r('veyr_alloy', 'Veyr Alloy', 'ingot', 'Blue-grey metal from the ruins. Warm, like it is alive.', 20),
  r('airship_canvas', 'Airship Canvas', 'cloth', 'Waxed sailcloth from the Meridian.', 20),
  r('gears', 'Brass Gears', 'gear', 'Clockwork from the Meridian. Tock wants these.', 20),
  r('star_metal', 'Star Metal', 'ingot', 'Fell from the sky. Colder than the night it came from.', 10),
  r('heartsong', 'Heartsong Fragment', 'heart', 'A shard of a living song. Four make you stronger.', 4),
  r('iron_ingot', 'Iron Ingot', 'ingot', 'Smelted iron. The start of real tools.', 30),
  r('silver_ingot', 'Silver Ingot', 'ingot', 'Smelted silver. Veyr devices love it.', 30),
  r('seeds', 'Wild Seeds', 'seed', 'Plant them in a farm plot.', 40),

  // Food & drink
  food('berries', 'Lanternberries', 'berries', 'Sweet and a little tart. Safe raw.', { food: 6, water: 3 }),
  food('mushroom', 'Cap Mushroom', 'mushroom', 'Earthy. Better roasted.', { food: 5, water: 1, risk: 0.1 }),
  food('raw_meat', 'Raw Meat', 'meat', 'Cook it first unless you enjoy stomach aches.', { food: 8, water: 0, risk: 0.5 }),
  food('cooked_meat', 'Seared Meat', 'meat', 'Smoky and filling.', { food: 28, water: 0, health: 6 }),
  food('raw_fish', 'Raw Fish', 'fish', 'Slippery. Cook it.', { food: 6, water: 2, risk: 0.35 }),
  food('grilled_fish', 'Grilled Fish', 'fish', 'Flaky, salty, perfect.', { food: 22, water: 3, health: 5 }),
  food('roast_mushroom', 'Mushroom Skewer', 'mushroom', 'Roasted caps on a stick.', { food: 16, water: 2, stamina: 10 }),
  food('berry_mash', 'Berry Mash', 'berries', 'Mashed berries and honeyed herbs.', { food: 14, water: 10 }),
  food('hearty_stew', 'Hearty Stew', 'meat', 'Meat, roots, herbs. Warms you to the bone.', { food: 45, water: 15, health: 20, warmth: 120 }, 10),
  food('herbal_tea', 'Herbal Tea', 'water', 'Hot yarrow tea. Chases away the cold.', { food: 0, water: 25, warmth: 180 }, 10),
  food('frostmint_tea', 'Frostmint Tea', 'water', 'Cool mint tea for the burning south.', { food: 0, water: 30, warmth: -180 }, 10),
  food('clean_water', 'Boiled Water', 'water', 'Safe to drink.', { food: 0, water: 35 }, 10),
  {
    id: 'salve',
    name: 'Herbal Salve',
    icon: 'herb',
    description: 'Herbs and resin. Closes wounds.',
    category: 'medicine',
    stack: 10,
    food: { food: 0, water: 0, health: 35 },
  },
  {
    id: 'stamina_tonic',
    name: 'Stamina Tonic',
    icon: 'stamina',
    description: 'Bitter. Makes your legs forget they are tired.',
    category: 'medicine',
    stack: 10,
    food: { food: 0, water: 8, stamina: 100 },
  },

  // Tools
  tool('stone_axe', 'Stone Axe', 'axe', 'Flint lashed to a handle. Fells trees.', { kind: 'axe', tier: 1, damage: 12, speed: 1.4, durability: 140, reach: 2.4 }),
  tool('stone_pickaxe', 'Stone Pickaxe', 'pickaxe', 'Cracks rock, flint and ore.', { kind: 'pickaxe', tier: 1, damage: 10, speed: 1.2, durability: 140, reach: 2.4 }),
  tool('flint_knife', 'Flint Knife', 'knife', 'Skins game and cuts fiber cleanly.', { kind: 'knife', tier: 1, damage: 9, speed: 2.4, durability: 120, reach: 1.8 }),
  tool('torch', 'Torch', 'torch', 'Light, warmth and courage. Burns down.', { kind: 'torch', tier: 0, damage: 6, speed: 1.6, durability: 240, reach: 2 }),
  tool('waterskin', 'Waterskin', 'waterskin', 'Fill at any river or lake. Drink when thirsty.', { kind: 'waterskin', tier: 0, damage: 0, speed: 1, durability: 0, reach: 2 }),
  tool('echo_lantern', 'Echo Lantern', 'lantern', 'Captain Varga’s gift. It hums near things that remember.', { kind: 'lantern', tier: 0, damage: 0, speed: 1, durability: 0, reach: 2 }),
  tool('iron_axe', 'Iron Axe', 'axe', 'A proper axe. Hardwood is no longer a problem.', { kind: 'axe', tier: 2, damage: 20, speed: 1.6, durability: 400, reach: 2.5 }),
  tool('iron_pickaxe', 'Iron Pickaxe', 'pickaxe', 'Bites into iron, silver and obsidian.', { kind: 'pickaxe', tier: 2, damage: 17, speed: 1.4, durability: 400, reach: 2.5 }),
  tool('bone_sickle', 'Bone Sickle', 'knife', 'Harvests fiber, herbs and crops by the armful.', { kind: 'sickle', tier: 1, damage: 7, speed: 2.2, durability: 160, reach: 2 }),

  // Weapons
  tool('club', 'Knotted Club', 'stick', 'Heavy wood. Honest violence.', { kind: 'club', tier: 0, damage: 14, speed: 1.3, durability: 120, reach: 2.2 }, 'weapon'),
  tool('flint_spear', 'Flint Spear', 'spear', 'Long reach. Can be thrown.', { kind: 'spear', tier: 1, damage: 18, speed: 1.2, durability: 150, reach: 3 }, 'weapon'),
  tool('shortbow', 'Shortbow', 'bow', 'Hold to draw. Arrows can be recovered.', { kind: 'bow', tier: 1, damage: 22, speed: 1, durability: 200, reach: 60 }, 'weapon'),
  tool('iron_sword', 'Iron Sword', 'knife', 'Balanced, quick, reliable.', { kind: 'sword', tier: 2, damage: 26, speed: 1.7, durability: 450, reach: 2.4 }, 'weapon'),
  tool('iron_spear', 'Iron Spear', 'spear', 'Reach and weight.', { kind: 'spear', tier: 2, damage: 30, speed: 1.2, durability: 420, reach: 3.1 }, 'weapon'),
  tool('antler_pike', 'Antler Warpike', 'spear', 'Mossback’s antler on an iron-shod haft. It sings when it strikes songstone.', { kind: 'spear', tier: 2, damage: 36, speed: 1.25, durability: 520, reach: 3.3 }, 'weapon'),
  tool('longbow', 'Longbow', 'bow', 'Slow to draw, devastating to receive.', { kind: 'bow', tier: 2, damage: 38, speed: 0.8, durability: 380, reach: 90 }, 'weapon'),
  tool('obsidian_hammer', 'Obsidian Warhammer', 'axe', 'Shatters shells and stone hides.', { kind: 'hammer', tier: 2, damage: 42, speed: 0.8, durability: 380, reach: 2.6 }, 'weapon'),
  { id: 'flint_arrow', name: 'Flint Arrow', icon: 'spear', description: 'Feather, shaft and a sharp stone.', category: 'ammo', stack: 40 },
  { id: 'iron_arrow', name: 'Iron Arrow', icon: 'spear', description: 'Punches through hide and chitin.', category: 'ammo', stack: 40 },
  { id: 'songstone_arrow', name: 'Songstone Arrow', icon: 'songstone', description: 'Rings on impact. Staggers constructs.', category: 'ammo', stack: 30 },

  // Armor
  { id: 'hide_hood', name: 'Hide Hood', icon: 'hide', description: 'Keeps rain off your neck.', category: 'armor', stack: 1, armor: { slot: 'head', protection: 3, warmth: 3, heat: 0 } },
  { id: 'hide_coat', name: 'Hide Coat', icon: 'hide', description: 'Stiff, warm, smells of smoke.', category: 'armor', stack: 1, armor: { slot: 'body', protection: 8, warmth: 6, heat: 0 } },
  { id: 'fur_cloak', name: 'Fur Cloak', icon: 'hide', description: 'For the Frostveil. Nothing else will do.', category: 'armor', stack: 1, armor: { slot: 'cloak', protection: 4, warmth: 14, heat: -4 } },
  { id: 'ashweave_cloak', name: 'Ashweave Cloak', icon: 'cloth', description: 'Woven ash lichen. The heat slides off it.', category: 'armor', stack: 1, armor: { slot: 'cloak', protection: 4, warmth: 0, heat: 14 } },
  { id: 'iron_helm', name: 'Iron Helm', icon: 'ingot', description: 'Heavy, cold, dependable.', category: 'armor', stack: 1, armor: { slot: 'head', protection: 10, warmth: 0, heat: 0 } },
  { id: 'iron_mail', name: 'Iron Mail', icon: 'ingot', description: 'Rings of iron over leather.', category: 'armor', stack: 1, armor: { slot: 'body', protection: 22, warmth: 2, heat: -2 } },

  // Placeables
  place('campfire', 'Campfire', 'campfire', 'Warmth, light, cooking. Creatures keep their distance.', 'campfire'),
  place('bedroll', 'Bedroll', 'bedroll', 'Sleep through the night. You will wake here.', 'bedroll', 1),
  place('workbench', 'Workbench', 'build', 'Wooden tools, weapons, building pieces.', 'workbench', 1),
  place('storage_chest', 'Storage Chest', 'chest', 'Twenty-four slots of peace of mind.', 'chest', 5),
  place('tanning_rack', 'Tanning Rack', 'hide', 'Turns hide into leather.', 'tanning_rack', 1),
  place('cooking_pot', 'Cooking Pot', 'campfire', 'Stews, teas and remedies. Place over a fire.', 'cooking_pot', 1),
  place('smelter', 'Smelter', 'ingot', 'Clay and stone furnace for ore.', 'smelter', 1),
  place('farm_plot', 'Farm Plot', 'seed', 'Tilled soil for seeds.', 'farm_plot', 10),
  place('rain_collector', 'Rain Collector', 'water', 'Fills with rain. Drink or fill a waterskin.', 'rain_collector', 3),
  place('wood_foundation', 'Wood Foundation', 'build', 'Level ground to build on.', 'wood_foundation', 30),
  place('wood_wall', 'Wood Wall', 'build', 'Keeps wind and wolves out.', 'wood_wall', 30),
  place('wood_doorway', 'Wood Doorway', 'build', 'A wall with a way through.', 'wood_doorway', 10),
  place('wood_roof', 'Wood Roof', 'build', 'Shelter from rain and sky.', 'wood_roof', 30),
  place('wood_floor', 'Wood Floor', 'build', 'A floor for a second storey.', 'wood_floor', 30),
  place('wood_stairs', 'Wood Stairs', 'build', 'Up.', 'wood_stairs', 10),
  place('lantern_post', 'Lantern Post', 'lantern', 'Light that keeps night creatures away.', 'lantern_post', 10),
];

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

export function itemDef(id: string): ItemDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown item "${id}"`);
  return def;
}

export function hasItemDef(id: string): boolean {
  return BY_ID.has(id);
}
