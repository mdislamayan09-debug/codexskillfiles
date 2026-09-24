// Crafting recipes. Stations gate recipes by proximity (placed structures);
// "hands" recipes work anywhere. Categories drive the crafting screen tabs.

export type Station = 'hands' | 'campfire' | 'workbench' | 'tanning_rack' | 'cooking_pot' | 'smelter';

export type RecipeCategory = 'tools' | 'survival' | 'food' | 'building' | 'gear' | 'materials';

export interface Recipe {
  id: string;
  output: string;
  count: number;
  station: Station;
  category: RecipeCategory;
  inputs: [item: string, count: number][];
  /** Seconds to craft (a short hold, not a timer to babysit). */
  time: number;
}

const R = (id: string, output: string, count: number, station: Station, category: RecipeCategory, inputs: [string, number][], time = 0.8): Recipe => ({
  id,
  output,
  count,
  station,
  category,
  inputs,
  time,
});

export const RECIPES: readonly Recipe[] = [
  // Hands — the first hour.
  R('rope', 'rope', 1, 'hands', 'materials', [['fiber', 3]], 0.6),
  R('stone_axe', 'stone_axe', 1, 'hands', 'tools', [['stick', 2], ['flint', 2], ['rope', 1]]),
  R('stone_pickaxe', 'stone_pickaxe', 1, 'hands', 'tools', [['stick', 2], ['stone', 3], ['rope', 1]]),
  R('flint_knife', 'flint_knife', 1, 'hands', 'tools', [['stick', 1], ['flint', 2]]),
  R('torch', 'torch', 1, 'hands', 'tools', [['stick', 1], ['resin', 1], ['fiber', 1]], 0.6),
  R('torch_moss', 'torch', 1, 'hands', 'tools', [['stick', 1], ['fiber', 3]], 0.6),
  R('club', 'club', 1, 'hands', 'gear', [['wood', 2], ['stick', 1]]),
  R('flint_spear', 'flint_spear', 1, 'hands', 'gear', [['stick', 3], ['flint', 1], ['rope', 1]]),
  R('campfire', 'campfire', 1, 'hands', 'survival', [['stone', 6], ['wood', 3], ['stick', 2]], 1.2),
  R('bedroll', 'bedroll', 1, 'hands', 'survival', [['fiber', 12], ['stick', 2]], 1.2),
  R('workbench', 'workbench', 1, 'hands', 'survival', [['wood', 10], ['stick', 4], ['rope', 2], ['stone', 4]], 1.6),
  R('waterskin_hide', 'waterskin', 1, 'hands', 'survival', [['hide', 2], ['rope', 1]]),
  R('salve', 'salve', 1, 'hands', 'survival', [['herbs', 3], ['resin', 1]]),
  R('berry_mash', 'berry_mash', 1, 'hands', 'food', [['berries', 5], ['herbs', 1]], 0.6),
  R('bone_sickle', 'bone_sickle', 1, 'hands', 'tools', [['bone', 2], ['rope', 1]]),

  // Campfire.
  R('cooked_meat', 'cooked_meat', 1, 'campfire', 'food', [['raw_meat', 1]], 1.5),
  R('grilled_fish', 'grilled_fish', 1, 'campfire', 'food', [['raw_fish', 1]], 1.5),
  R('roast_mushroom', 'roast_mushroom', 1, 'campfire', 'food', [['mushroom', 3], ['stick', 1]], 1.2),

  // Workbench.
  R('storage_chest', 'storage_chest', 1, 'workbench', 'building', [['wood', 12], ['rope', 1]], 1.4),
  R('wood_foundation', 'wood_foundation', 1, 'workbench', 'building', [['wood', 8]]),
  R('wood_floor', 'wood_floor', 1, 'workbench', 'building', [['wood', 5]]),
  R('wood_wall', 'wood_wall', 1, 'workbench', 'building', [['wood', 6]]),
  R('wood_doorway', 'wood_doorway', 1, 'workbench', 'building', [['wood', 6]]),
  R('wood_roof', 'wood_roof', 1, 'workbench', 'building', [['wood', 6]]),
  R('wood_stairs', 'wood_stairs', 1, 'workbench', 'building', [['wood', 8]]),
  R('tanning_rack', 'tanning_rack', 1, 'workbench', 'building', [['wood', 6], ['rope', 3], ['bone', 2]], 1.4),
  R('cooking_pot', 'cooking_pot', 1, 'workbench', 'building', [['clay', 6], ['stone', 4]], 1.4),
  R('smelter', 'smelter', 1, 'workbench', 'building', [['stone', 14], ['clay', 8]], 2),
  R('farm_plot', 'farm_plot', 1, 'workbench', 'building', [['wood', 4], ['stick', 6], ['fiber', 4]]),
  R('rain_collector', 'rain_collector', 1, 'workbench', 'building', [['wood', 6], ['cloth', 2]]),
  R('lantern_post', 'lantern_post', 1, 'workbench', 'building', [['wood', 4], ['resin', 2]]),
  R('star_lantern', 'star_lantern', 1, 'workbench', 'tools', [['star_shard', 2], ['glass_petal', 2], ['iron_ingot', 1]], 2),
  R('cloth', 'cloth', 1, 'workbench', 'materials', [['fiber', 6]], 1),
  R('shortbow', 'shortbow', 1, 'workbench', 'gear', [['wood', 3], ['rope', 2], ['fiber', 4]], 1.4),
  R('flint_arrow', 'flint_arrow', 5, 'workbench', 'gear', [['stick', 3], ['flint', 2], ['feather', 2]]),
  R('iron_axe', 'iron_axe', 1, 'workbench', 'tools', [['iron_ingot', 3], ['wood', 2], ['leather', 1]], 1.6),
  R('iron_pickaxe', 'iron_pickaxe', 1, 'workbench', 'tools', [['iron_ingot', 3], ['wood', 2], ['leather', 1]], 1.6),
  R('iron_sword', 'iron_sword', 1, 'workbench', 'gear', [['iron_ingot', 4], ['leather', 1]], 1.8),
  R('iron_spear', 'iron_spear', 1, 'workbench', 'gear', [['iron_ingot', 2], ['wood', 3], ['rope', 1]], 1.6),
  R('antler_pike', 'antler_pike', 1, 'workbench', 'gear', [['warden_antler', 1], ['iron_ingot', 2], ['rope', 2]], 2),
  R('iron_arrow', 'iron_arrow', 5, 'workbench', 'gear', [['iron_ingot', 1], ['stick', 5], ['feather', 5]]),
  R('longbow', 'longbow', 1, 'workbench', 'gear', [['hardwood', 3], ['rope', 3], ['leather', 1]], 1.8),
  R('obsidian_hammer', 'obsidian_hammer', 1, 'workbench', 'gear', [['obsidian', 4], ['hardwood', 2], ['leather', 2]], 2),
  R('iron_helm', 'iron_helm', 1, 'workbench', 'gear', [['iron_ingot', 3], ['leather', 1]], 1.8),
  R('iron_mail', 'iron_mail', 1, 'workbench', 'gear', [['iron_ingot', 6], ['leather', 3]], 2.2),
  R('songstone_arrow', 'songstone_arrow', 5, 'workbench', 'gear', [['songstone', 1], ['stick', 5], ['feather', 5]]),

  // Tanning rack.
  R('leather', 'leather', 1, 'tanning_rack', 'materials', [['hide', 2]], 1.6),
  R('waterskin', 'waterskin', 1, 'tanning_rack', 'survival', [['leather', 2], ['rope', 1]]),
  R('hide_hood', 'hide_hood', 1, 'tanning_rack', 'gear', [['leather', 2], ['rope', 1]]),
  R('hide_coat', 'hide_coat', 1, 'tanning_rack', 'gear', [['leather', 5], ['rope', 2]], 1.6),
  R('fur_cloak', 'fur_cloak', 1, 'tanning_rack', 'gear', [['pelt', 3], ['leather', 2]], 1.6),
  R('ashweave_cloak', 'ashweave_cloak', 1, 'tanning_rack', 'gear', [['cloth', 4], ['sulfur', 2], ['leather', 1]], 1.6),

  // Cooking pot (next to a campfire).
  R('hearty_stew', 'hearty_stew', 1, 'cooking_pot', 'food', [['raw_meat', 2], ['mushroom', 2], ['herbs', 2]], 2.4),
  R('herbal_tea', 'herbal_tea', 1, 'cooking_pot', 'food', [['herbs', 2]], 1.6),
  R('frostmint_tea', 'frostmint_tea', 1, 'cooking_pot', 'food', [['frostmint', 2]], 1.6),
  R('clean_water', 'clean_water', 2, 'cooking_pot', 'food', [], 1.2),
  R('stamina_tonic', 'stamina_tonic', 1, 'cooking_pot', 'food', [['moonmoss', 2], ['berries', 3]], 2),

  // Smelter.
  R('iron_ingot', 'iron_ingot', 1, 'smelter', 'materials', [['iron_ore', 2], ['coal', 1]], 2.4),
  R('iron_ingot_wood', 'iron_ingot', 1, 'smelter', 'materials', [['iron_ore', 2], ['wood', 4]], 3),
  R('bog_ingot', 'iron_ingot', 1, 'smelter', 'materials', [['bog_iron', 3], ['wood', 3]], 3),
  R('silver_ingot', 'silver_ingot', 1, 'smelter', 'materials', [['silver_ore', 2], ['coal', 1]], 2.6),
];

export const STATION_NAMES: Record<Station, string> = {
  hands: 'By hand',
  campfire: 'Campfire',
  workbench: 'Workbench',
  tanning_rack: 'Tanning rack',
  cooking_pot: 'Cooking pot',
  smelter: 'Smelter',
};

export const CATEGORY_NAMES: Record<RecipeCategory, string> = {
  tools: 'Tools',
  survival: 'Survival',
  food: 'Food & drink',
  building: 'Building',
  gear: 'Weapons & gear',
  materials: 'Materials',
};
