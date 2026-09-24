// What each named place holds: the cache you can search there, what it
// gives, and the journal page it adds. Pure data (no rendering), so tests
// can check every item and landmark it names.

export interface LandmarkLore {
  id: string;
  title: string;
  text: string;
}

export interface LandmarkCache {
  items: [string, number][];
  container: string;
  lore: LandmarkLore;
}

/** Caches: what each place gives, and the journal page it holds. */
export const CACHES: Record<string, LandmarkCache> = {
  whispering_cave: {
    container: 'Veyr breath-urn',
    items: [['flint', 4], ['rope', 2], ['songstone', 1]],
    lore: { id: 'lore:whispering_cave', title: 'The Breathing Hill', text: 'The Veyr cut listening-shafts into the hills so the Undersong could breathe. Put your ear to the rock here and you can still hear the island inhale.' },
  },
  old_aqueduct: {
    container: 'mason’s strongbox',
    items: [['clay', 6], ['iron_ingot', 1], ['songstone', 1]],
    lore: { id: 'lore:old_aqueduct', title: 'Water from the Rim', text: 'The aqueduct carried snowmelt from the Rim to the Greensward farms. When the note held, the water stopped mid-channel. Some of it is still there, perfectly still, under the moss.' },
  },
  poppy_hill: {
    container: 'surveyor’s tin',
    items: [['berries', 6], ['seeds', 4], ['herbs', 3]],
    lore: { id: 'lore:poppy_hill', title: 'A Survey, Unfinished', text: '“Sixty-one years out of Port Aster. Every heading we take brings us back to this hill. The poppies never close. Harlan says it’s beautiful. Harlan says that about everything now.”' },
  },
  trapper_cabin: {
    container: 'trapper’s chest',
    items: [['flint_knife', 1], ['hide', 4], ['rope', 3], ['cooked_meat', 2]],
    lore: { id: 'lore:trapper_cabin', title: 'Jonah Reed’s Diary', text: '“Set the lines again. Same hare in the same snare, same notch in its ear. I let it go. Tomorrow I will let it go again. I have stopped counting the tomorrows.”' },
  },
  duskhound_den: {
    container: 'bone pile',
    items: [['bone', 6], ['pelt', 2], ['feather', 4]],
    lore: { id: 'lore:duskhound_den', title: 'The Hounds', text: 'Duskhounds were the Veyr’s night-watch, bred to guard the bell roads. They still patrol them after dark, for masters a thousand years gone.' },
  },
  fungus_ring: {
    container: 'ring of caps',
    items: [['mushroom', 6], ['herbs', 2]],
    lore: { id: 'lore:fungus_ring', title: 'The Lantern Ring', text: 'Where a note was struck too hard, nothing grows but light. The caps glow with the last sound this ground ever heard.' },
  },
  floating_isle: {
    container: 'fallen reliquary',
    items: [['songstone', 4], ['glass_petal', 3], ['heartsong', 1]],
    lore: { id: 'lore:floating_isle', title: 'The Isle That Forgot', text: 'A Veyr observatory stood here. When the note held, the hill it stood on forgot which way was down, and has been waiting ever since to be reminded.' },
  },
  echo_garden: {
    container: 'crystal planter',
    items: [['glass_petal', 5], ['songstone', 2]],
    lore: { id: 'lore:echo_garden', title: 'The Echo Garden', text: 'The Choir grew these flowers to learn new songs. Speak near them and they answer in your own voice, a heartbeat late.' },
  },
  crystal_grotto: {
    container: 'crystal-choked chest',
    items: [['songstone', 3], ['ice_crystal', 2], ['iron_ingot', 1]],
    lore: { id: 'lore:crystal_grotto', title: 'Where the Light Goes', text: 'Light that enters the grotto rings off the crystals until it forgets which way it came. Some of it has been bouncing since before the Veil.' },
  },
  galleon: {
    container: 'captain’s sea chest',
    items: [['iron_ingot', 3], ['rope', 4], ['cloth', 4], ['gears', 1]],
    lore: { id: 'lore:galleon', title: 'The Constant Lamp', text: '“Log of the Saint Anselm. Day unknown. We ran aground inside the shimmer. The stern lamp will not go out, though no one has filled it since. The men say it is waiting for someone.”' },
  },
  lighthouse: {
    container: 'keeper’s locker',
    items: [['torch', 2], ['resin', 4], ['iron_ingot', 2]],
    lore: { id: 'lore:lighthouse', title: 'The Keeper', text: 'No keeper, no oil, and still the lamp turns. The Veyr built it to guide ships home through the Veil. It has never guided anyone in. Perhaps it will guide someone out.' },
  },
  tide_pools: {
    container: 'shell cache',
    items: [['shell', 6], ['raw_fish', 2], ['salt', 3]],
    lore: { id: 'lore:tide_pools', title: 'Patient Things', text: 'The shellbacks here do not age. Wren counted the rings on one: the same number, every season, for as long as anyone has counted.' },
  },
  sunken_face: {
    container: 'offering bowl',
    items: [['obsidian', 3], ['songstone', 3], ['heartsong', 1]],
    lore: { id: 'lore:sunken_face', title: 'The Listening Face', text: 'A face carved to look up at the Crown and listen. When the note began, the ash rose to its chin. It has not stopped listening.' },
  },
  old_persistence: {
    container: 'crawler toolbox',
    items: [['gears', 3], ['iron_ingot', 3], ['coal', 6]],
    lore: { id: 'lore:old_persistence', title: 'The Old Persistence', text: '“Crawler No. 4, Aster Mining Co. Boiler holding pressure day 900. Fuel untouched. Crew requests relief. Crew requests anything at all.”' },
  },
  hot_springs: {
    container: 'bather’s basket',
    items: [['herbs', 4], ['salve', 2], ['cloth', 2]],
    lore: { id: 'lore:hot_springs', title: 'Warm Water', text: 'The Veyr came here to rest their voices. The springs are warm because the mountain is still humming, very low, under the water.' },
  },
  lava_tubes: {
    container: 'miner’s cache',
    items: [['obsidian', 4], ['iron_ore', 4], ['coal', 4]],
    lore: { id: 'lore:lava_tubes', title: 'The Mountain’s Root', text: 'The tubes were melted by a note the Smith-Mother sang to open the mountain. The rock remembers the shape of her voice.' },
  },
  monastery: {
    container: 'abbot’s coffer',
    items: [['cloth', 4], ['heartsong', 1], ['herbal_tea', 3]],
    lore: { id: 'lore:monastery', title: 'Bells Without Clappers', text: 'The brothers removed every clapper when the note began, so that nothing here would add to it. One window stays lit. Someone is still keeping silence.' },
  },
  sled_camp: {
    container: 'survey crate',
    items: [['cooked_meat', 3], ['cloth', 3], ['rope', 2], ['torch', 1]],
    lore: { id: 'lore:sled_camp', title: 'Frozen Mid-Meal', text: '“Second Aster Survey, north camp. Soup on the stove, three bowls poured. Harlan went to fetch snow for the kettle and the kettle never boiled. Neither did the soup. Neither did we.”' },
  },
  ice_caves: {
    container: 'ice-locked chest',
    items: [['ice_crystal', 4], ['pelt', 2], ['songstone', 2]],
    lore: { id: 'lore:ice_caves', title: 'The Groaning Ice', text: 'The glacier is moving, very slowly, against the Held Note. You can hear it straining. It wants to reach the sea.' },
  },
  frozen_titan: {
    container: 'shrine at its feet',
    items: [['frostmint', 3], ['heartsong', 1], ['songstone', 2]],
    lore: { id: 'lore:frozen_titan', title: 'The Titan', text: 'The Veyr say a giant raised its hand to stop the note from being struck, and was too late. Its hand is still raised. The ice is its patience.' },
  },
  aurora_overlook: {
    container: 'stargazer’s case',
    items: [['songstone', 3], ['ice_crystal', 3]],
    lore: { id: 'lore:aurora_overlook', title: 'Where the Sky Sings', text: 'On clear nights the Veil catches the northern light and bends it into curtains. From this height you can hear them: a thin, high chord, holding.' },
  },
  stilt_village: {
    container: 'fisher’s trunk',
    items: [['raw_fish', 4], ['reeds', 6], ['rope', 3]],
    lore: { id: 'lore:stilt_village', title: 'People Who Meant to Stay', text: 'The fen-folk built above the water because the water was rising. It rose for exactly one day, and has been that high ever since.' },
  },
  ziggurat: {
    container: 'temple offering',
    items: [['songstone', 4], ['clay', 4], ['heartsong', 1]],
    lore: { id: 'lore:ziggurat', title: 'The Singing Steps', text: 'Each step of the ziggurat is tuned to a note of the Choir’s scale. Walk them in order and the mud remembers the melody.' },
  },
  lanternfly_hollow: {
    container: 'lanternfly jar',
    items: [['resin', 3], ['herbs', 3], ['glass_petal', 1]],
    lore: { id: 'lore:lanternfly_hollow', title: 'Lanternflies', text: 'Wren has a theory: the lanternflies are not insects at all, but notes that got loose, looking for the song they came from.' },
  },
  hollow_elder: {
    container: 'hollow in the roots',
    items: [['resin', 4], ['wood', 6], ['seeds', 3]],
    lore: { id: 'lore:hollow_elder', title: 'The Hollow Elder', text: 'Older than the Veil. The Veyr hung their first bell in its crown to hear how far a note could carry. The bell is gone. The listening is not.' },
  },
};

export const LANDMARK_LORE: readonly LandmarkLore[] = Object.values(CACHES).map((c) => c.lore);

/** Where each cache sits relative to its landmark (dx, dz, lift). */
export const CACHE_SPOTS: Record<string, [number, number, number?]> = {
  whispering_cave: [1.2, -2.2],
  old_aqueduct: [2.5, 1.5],
  poppy_hill: [1.4, -0.8],
  hollow_elder: [0.5, 3.8],
  trapper_cabin: [-1, 0],
  duskhound_den: [0.5, -2.5],
  fungus_ring: [0, 0],
  floating_isle: [3, 5],
  echo_garden: [0, 0],
  crystal_grotto: [0.8, -1.5],
  galleon: [6, 7],
  lighthouse: [4.5, -2],
  tide_pools: [2, 1],
  sunken_face: [0.5, 12],
  old_persistence: [3, 4],
  hot_springs: [12, 2, 0.5],
  lava_tubes: [1, -1.8],
  monastery: [2, 7],
  sled_camp: [2, 6, 0.85],
  ice_caves: [0.6, -1.6],
  frozen_titan: [4, 11],
  aurora_overlook: [1.5, 1],
  stilt_village: [0, 0.2],
  ziggurat: [0, 12.5],
  lanternfly_hollow: [0, 0],
};
