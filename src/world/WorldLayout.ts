// The authored skeleton of the Stillwild. Noise and erosion decorate this
// layout; they never decide where important things are. Coordinates are world
// meters: +X east, +Z south, origin at the Stillheart.
// Dependency-free so the generator worker can import it.

import { BIOME, type BiomeId } from './WorldConfig';

export interface BiomeSeed {
  biome: BiomeId;
  x: number;
  z: number;
  /** Positive bias grows the region. */
  bias: number;
}

export const BIOME_SEEDS: readonly BiomeSeed[] = [
  // Greensward — south center, the starting meadows.
  { biome: BIOME.Greensward, x: 0, z: 560, bias: 40 },
  { biome: BIOME.Greensward, x: -150, z: 430, bias: 10 },
  { biome: BIOME.Greensward, x: 210, z: 690, bias: 20 },
  { biome: BIOME.Greensward, x: 50, z: 830, bias: 20 },
  // Drownfen — south-west marsh.
  { biome: BIOME.Drownfen, x: -560, z: 650, bias: 20 },
  { biome: BIOME.Drownfen, x: -410, z: 810, bias: 10 },
  { biome: BIOME.Drownfen, x: -720, z: 500, bias: 0 },
  // Hollowpine — the western forest.
  { biome: BIOME.Hollowpine, x: -650, z: -40, bias: 30 },
  { biome: BIOME.Hollowpine, x: -540, z: 270, bias: 20 },
  { biome: BIOME.Hollowpine, x: -830, z: 170, bias: 10 },
  { biome: BIOME.Hollowpine, x: -470, z: -200, bias: 0 },
  // Frostveil — northern peaks.
  { biome: BIOME.Frostveil, x: -420, z: -660, bias: 30 },
  { biome: BIOME.Frostveil, x: -130, z: -780, bias: 20 },
  { biome: BIOME.Frostveil, x: -770, z: -560, bias: 10 },
  { biome: BIOME.Frostveil, x: 140, z: -900, bias: 0 },
  // Cinderreach — the volcanic north-east.
  { biome: BIOME.Cinderreach, x: 540, z: -600, bias: 30 },
  { biome: BIOME.Cinderreach, x: 330, z: -430, bias: 5 },
  { biome: BIOME.Cinderreach, x: 780, z: -420, bias: 10 },
  { biome: BIOME.Cinderreach, x: 620, z: -840, bias: 10 },
  // Saltglass Coast — the eastern shore.
  { biome: BIOME.Coast, x: 830, z: 380, bias: 10 },
  { biome: BIOME.Coast, x: 840, z: 60, bias: 10 },
  { biome: BIOME.Coast, x: 700, z: 700, bias: 0 },
  { biome: BIOME.Coast, x: 880, z: -200, bias: 0 },
  // Glasswood — the crystalline grove east of center.
  { biome: BIOME.Glasswood, x: 430, z: 220, bias: 25 },
  { biome: BIOME.Glasswood, x: 540, z: 30, bias: 10 },
  { biome: BIOME.Glasswood, x: 330, z: 430, bias: 0 },
];

/** Radius of the Rim region around the Stillheart crater. */
export const RIM_RADIUS = 360;
export const CRATER_FLOOR_RADIUS = 160;
export const CRATER_CREST_RADIUS = 250;
/** Compass bearing (degrees) of the ramp that descends into the crater. */
export const CRATER_DESCENT_BEARING = 200;

/** The Cinderreach volcano (the Caldera Forge sits in its crater). */
export const VOLCANO = { x: 560, z: -640, radius: 400, height: 172, calderaRadius: 88, calderaDepth: 46 } as const;

/** The Crown: the floating ring above the Stillheart. */
export const CROWN = { x: 0, z: 0, altitude: 238, radius: 64 } as const;

/**
 * Coastline radius (meters from center) keyed by compass bearing in degrees
 * (0 = north, 90 = east). Values beyond ~1100 mean "land runs past the Veil".
 */
export const COAST_PROFILE: readonly [number, number][] = [
  [0, 1180],
  [30, 1160],
  [52, 1010],
  [70, 830],
  [80, 800],
  [92, 770],
  [110, 745],
  [130, 790],
  [152, 850],
  [180, 880],
  [205, 905],
  [225, 915],
  [245, 960],
  [262, 1150],
  [300, 1180],
  [330, 1180],
  [360, 1180],
];

/** Bearing ranges (degrees) where the shore is a beach rather than a cliff. */
export const BEACH_BEARINGS: readonly [number, number][] = [
  [96, 107], // Galleon Cove
  [128, 140], // Tidepool Strand
  [150, 250], // Southern strands and the marsh shallows
];

/** Localized coastline bulges (headlands) in bearing degrees. */
export const HEADLANDS: readonly { bearing: number; width: number; extend: number }[] = [
  { bearing: 82, width: 3.2, extend: 95 }, // Lamplight headland
  { bearing: 118, width: 5, extend: 40 },
  { bearing: 60, width: 4, extend: 60 },
];

export interface SeaStack {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export const SEA_STACKS: readonly SeaStack[] = [
  { x: 910, z: -193, radius: 13, height: 34 },
  { x: 923, z: -65, radius: 9, height: 26 },
  { x: 850, z: 0, radius: 11, height: 30 },
  { x: 742, z: 300, radius: 12, height: 28 },
  { x: 704, z: 440, radius: 10, height: 24 },
  { x: 546, z: 651, radius: 14, height: 31 },
];

export type LandmarkKind =
  | 'wreck'
  | 'camp'
  | 'ruin'
  | 'cave'
  | 'bellstone'
  | 'natural'
  | 'structure'
  | 'lookout'
  | 'lake'
  | 'crater';

export interface LandmarkDef {
  id: string;
  name: string;
  biome: BiomeId;
  kind: LandmarkKind;
  x: number;
  z: number;
  /** Flatten a pad for structures: radius of the flat area and blend distance. */
  pad?: { radius: number; falloff: number; height?: number; offset?: number };
  /** Raise terrain into a hill/mound: peak height added at the center. */
  mound?: { height: number; radius: number };
  /** Short description for the journal. */
  blurb: string;
  /** Discover radius in meters (defaults by kind). */
  discoverRadius?: number;
}

export const LANDMARKS: readonly LandmarkDef[] = [
  // --- Greensward -----------------------------------------------------------
  {
    id: 'meridian_wreck',
    name: 'Wreck of the Meridian',
    biome: BIOME.Greensward,
    kind: 'wreck',
    x: 70,
    z: 640,
    pad: { radius: 26, falloff: 24 },
    blurb: 'Your airship, torn open across a birch grove. The envelope still breathes in the wind.',
  },
  {
    id: 'crash_camp',
    name: 'Crash Camp',
    biome: BIOME.Greensward,
    kind: 'camp',
    x: 28,
    z: 604,
    pad: { radius: 14, falloff: 14 },
    blurb: 'Where Captain Varga dragged what could be saved.',
  },
  {
    id: 'singing_stones',
    name: 'The Singing Stones',
    biome: BIOME.Greensward,
    kind: 'ruin',
    x: -190,
    z: 520,
    pad: { radius: 22, falloff: 20 },
    blurb: 'A ring of pale stones that hum when the wind turns.',
  },
  {
    id: 'whispering_cave',
    name: 'Whispering Cave',
    biome: BIOME.Greensward,
    kind: 'cave',
    x: -70,
    z: 405,
    mound: { height: 26, radius: 70 },
    blurb: 'Air sighs out of this hillside like breath.',
  },
  {
    id: 'old_aqueduct',
    name: 'The Old Aqueduct',
    biome: BIOME.Greensward,
    kind: 'ruin',
    x: 170,
    z: 470,
    pad: { radius: 12, falloff: 16 },
    blurb: 'Veyr arches that once carried water from the Rim.',
  },
  {
    id: 'poppy_hill',
    name: 'Poppy Hill',
    biome: BIOME.Greensward,
    kind: 'lookout',
    x: -40,
    z: 745,
    mound: { height: 22, radius: 95 },
    blurb: 'A red hill with a view of half the world.',
  },
  {
    id: 'tocks_vault',
    name: 'The Sealed Vault',
    biome: BIOME.Greensward,
    kind: 'ruin',
    x: 290,
    z: 540,
    mound: { height: 24, radius: 60 },
    blurb: 'A Veyr door set into the hill. Someone has been hammering on it — from the inside.',
  },
  {
    id: 'rim_lookout',
    name: 'Rim Lookout',
    biome: BIOME.Rim,
    kind: 'lookout',
    x: -30,
    z: 262,
    pad: { radius: 9, falloff: 12 },
    blurb: 'From here you can see the Crown turning over the Stillheart.',
  },
  // --- Hollowpine -----------------------------------------------------------
  {
    id: 'hollow_elder',
    name: 'The Hollow Elder',
    biome: BIOME.Hollowpine,
    kind: 'natural',
    x: -610,
    z: 110,
    pad: { radius: 28, falloff: 26 },
    blurb: 'A tree older than the Veil. Something hangs in its crown.',
  },
  {
    id: 'trapper_cabin',
    name: "Jonah Reed's Cabin",
    biome: BIOME.Hollowpine,
    kind: 'camp',
    // On the dry bank above the pond, not in it.
    x: -491,
    z: -113,
    pad: { radius: 11, falloff: 12 },
    blurb: 'A trapper lived here once. His traps are still set.',
  },
  {
    id: 'duskhound_den',
    name: 'Duskhound Den',
    biome: BIOME.Hollowpine,
    kind: 'natural',
    x: -760,
    z: -170,
    mound: { height: 14, radius: 45 },
    blurb: 'Bones, and the smell of wet fur.',
  },
  {
    id: 'fungus_ring',
    name: 'The Lantern Ring',
    biome: BIOME.Hollowpine,
    kind: 'natural',
    x: -700,
    z: 340,
    pad: { radius: 14, falloff: 14 },
    blurb: 'A perfect circle of glowing caps. Nothing grows inside it.',
  },
  {
    id: 'bell_hollowpine',
    name: "Mossback's Grove",
    biome: BIOME.Hollowpine,
    kind: 'bellstone',
    x: -830,
    z: 20,
    pad: { radius: 42, falloff: 30 },
    blurb: 'The first Bellstone, grown over by a forest that will not die.',
    discoverRadius: 120,
  },
  // --- Glasswood ------------------------------------------------------------
  {
    id: 'floating_isle',
    name: 'The Floating Isle',
    biome: BIOME.Glasswood,
    kind: 'ruin',
    x: 470,
    z: 180,
    pad: { radius: 30, falloff: 24 },
    blurb: 'A hill of stone that forgot to stay on the ground.',
    discoverRadius: 140,
  },
  {
    id: 'echo_garden',
    name: 'The Echo Garden',
    biome: BIOME.Glasswood,
    kind: 'ruin',
    x: 360,
    z: 335,
    pad: { radius: 26, falloff: 22 },
    blurb: 'Crystal flowers repeat whatever was last said near them.',
  },
  {
    id: 'meridian_tail',
    name: "The Meridian's Tail",
    biome: BIOME.Glasswood,
    kind: 'wreck',
    x: 565,
    z: 300,
    pad: { radius: 16, falloff: 16 },
    blurb: 'The tail section came down miles from the rest.',
  },
  {
    id: 'crystal_grotto',
    name: 'Crystal Grotto',
    biome: BIOME.Glasswood,
    kind: 'cave',
    x: 520,
    z: -40,
    mound: { height: 20, radius: 60 },
    blurb: 'Light goes in. It does not always come out.',
  },
  // --- Saltglass Coast --------------------------------------------------------
  {
    id: 'galleon',
    name: 'The Saint Aldric',
    biome: BIOME.Coast,
    kind: 'wreck',
    x: 721,
    z: 144,
    blurb: 'A sailing ship of a century nobody alive remembers — with a lamp lit in its stern.',
    discoverRadius: 110,
  },
  {
    id: 'lighthouse',
    name: 'The Lamplight',
    biome: BIOME.Coast,
    kind: 'structure',
    x: 850,
    z: -125,
    pad: { radius: 9, falloff: 10 },
    blurb: 'A lighthouse built by no one who ever sailed here.',
    discoverRadius: 120,
  },
  {
    id: 'bell_coast',
    name: 'The Drowned Bell',
    biome: BIOME.Coast,
    kind: 'bellstone',
    x: 667,
    z: 385,
    mound: { height: 30, radius: 70 },
    // A rock shelf under the headland: room for Tidemother to fight.
    pad: { radius: 34, falloff: 22, height: 6 },
    blurb: 'At low tide you can hear it ringing under the cliffs.',
    discoverRadius: 110,
  },
  {
    id: 'tide_pools',
    name: 'Tidepool Strand',
    biome: BIOME.Coast,
    kind: 'natural',
    x: 565,
    z: 545,
    blurb: 'Shallow pools full of patient, armored things.',
  },
  // --- Cinderreach ------------------------------------------------------------
  {
    id: 'sunken_face',
    name: 'The Sunken Face',
    biome: BIOME.Cinderreach,
    kind: 'ruin',
    x: 360,
    z: -560,
    pad: { radius: 30, falloff: 24 },
    blurb: 'A Veyr face as large as a hill, looking up from the ash.',
    discoverRadius: 130,
  },
  {
    id: 'old_persistence',
    name: 'Old Persistence',
    biome: BIOME.Cinderreach,
    kind: 'wreck',
    x: 560,
    z: -380,
    pad: { radius: 18, falloff: 16 },
    blurb: 'A mining crawler with its boiler still warm.',
  },
  {
    id: 'hot_springs',
    name: 'Emberwell Springs',
    biome: BIOME.Cinderreach,
    kind: 'natural',
    x: 425,
    z: -300,
    pad: { radius: 30, falloff: 20 },
    blurb: 'Steaming pools that never freeze and never cool.',
  },
  {
    id: 'lava_tubes',
    name: 'The Lava Tubes',
    biome: BIOME.Cinderreach,
    kind: 'cave',
    x: 700,
    z: -470,
    mound: { height: 18, radius: 55 },
    blurb: 'Tunnels melted through the mountain’s root.',
  },
  {
    id: 'bell_cinder',
    name: 'The Caldera Forge',
    biome: BIOME.Cinderreach,
    kind: 'bellstone',
    x: 560,
    z: -640,
    blurb: 'A forge built inside a volcano, still tended.',
    discoverRadius: 140,
  },
  // --- Frostveil --------------------------------------------------------------
  {
    id: 'monastery',
    name: 'Monastery of Hush',
    biome: BIOME.Frostveil,
    kind: 'structure',
    x: -560,
    z: -760,
    pad: { radius: 26, falloff: 30 },
    mound: { height: 40, radius: 120 },
    blurb: 'Bells without clappers, and one lit window.',
    discoverRadius: 150,
  },
  {
    id: 'bell_frost',
    name: 'Frostglass Lake',
    biome: BIOME.Frostveil,
    kind: 'bellstone',
    x: -260,
    z: -560,
    blurb: 'A lake frozen so clear you can see what sleeps under it.',
    discoverRadius: 150,
  },
  {
    id: 'sled_camp',
    name: 'Brightwater Sled Camp',
    biome: BIOME.Frostveil,
    kind: 'camp',
    x: -300,
    z: -390,
    pad: { radius: 12, falloff: 14 },
    blurb: 'Tents of a survey sixty years gone, frozen mid-meal.',
  },
  {
    id: 'ice_caves',
    name: 'The Ice Caves',
    biome: BIOME.Frostveil,
    kind: 'cave',
    x: -730,
    z: -450,
    blurb: 'Blue light and the groan of moving ice.',
  },
  {
    id: 'frozen_titan',
    name: 'The Frozen Titan',
    biome: BIOME.Frostveil,
    kind: 'natural',
    x: -60,
    z: -640,
    pad: { radius: 24, falloff: 24 },
    blurb: 'Something enormous, standing in the glacier, one hand raised.',
    discoverRadius: 120,
  },
  {
    id: 'aurora_overlook',
    name: 'Aurora Overlook',
    biome: BIOME.Frostveil,
    kind: 'lookout',
    x: -150,
    z: -890,
    pad: { radius: 8, falloff: 12 },
    blurb: 'The highest place you can stand. The sky does strange things up here.',
  },
  // --- Drownfen ---------------------------------------------------------------
  {
    id: 'stilt_village',
    name: 'The Stilt Village',
    biome: BIOME.Drownfen,
    kind: 'camp',
    x: -520,
    z: 700,
    pad: { radius: 40, falloff: 24, height: -0.7 },
    blurb: 'Houses on legs above the water, built by people who meant to stay.',
    discoverRadius: 110,
  },
  {
    id: 'ziggurat',
    name: 'The Sunken Ziggurat',
    biome: BIOME.Drownfen,
    kind: 'ruin',
    x: -690,
    z: 560,
    pad: { radius: 26, falloff: 20, height: 0.4 },
    blurb: 'A stepped temple, half swallowed, still singing under the mud.',
    discoverRadius: 120,
  },
  {
    id: 'bell_fen',
    name: 'The Choir Mire',
    biome: BIOME.Drownfen,
    kind: 'bellstone',
    x: -365,
    z: 780,
    pad: { radius: 40, falloff: 26, height: 0.3 },
    blurb: 'Bells stand in the water like reeds. They sing when no one is there.',
    discoverRadius: 130,
  },
  {
    id: 'lanternfly_hollow',
    name: 'Lanternfly Hollow',
    biome: BIOME.Drownfen,
    kind: 'natural',
    x: -300,
    z: 630,
    blurb: 'At dusk the air here fills with slow gold lights.',
  },
  // --- The Rim / Stillheart -------------------------------------------------
  {
    id: 'stillheart',
    name: 'The Stillheart',
    biome: BIOME.Rim,
    kind: 'crater',
    x: 0,
    z: 0,
    blurb: 'The crater where Hallowmere fell. Above it, the Crown.',
    discoverRadius: 240,
  },
];

export function landmarkById(id: string): LandmarkDef {
  const found = LANDMARKS.find((landmark) => landmark.id === id);
  if (!found) throw new Error(`Unknown landmark: ${id}`);
  return found;
}

export interface RiverDef {
  id: string;
  name: string;
  /** Control points from source to mouth. */
  points: readonly [number, number][];
  width: number;
  depth: number;
  /** Lake id the river starts from / ends in, if any. */
  fromLake?: string;
  toLake?: string;
  warm?: boolean;
}

export const RIVERS: readonly RiverDef[] = [
  {
    id: 'lanternrun_upper',
    name: 'The Lanternrun',
    fromLake: 'frostglass',
    toLake: 'mirror',
    width: 13,
    depth: 2.2,
    points: [
      [-318, -468],
      [-352, -412],
      [-396, -352],
      [-424, -300],
      [-446, -226],
      [-470, -150],
      [-455, -60],
      [-438, 20],
      [-452, 100],
      [-466, 168],
    ],
  },
  {
    id: 'lanternrun_lower',
    name: 'The Lanternrun',
    fromLake: 'mirror',
    width: 15,
    depth: 2.4,
    points: [
      [-450, 392],
      [-432, 470],
      [-452, 552],
      [-490, 630],
      [-548, 706],
      [-610, 790],
      [-672, 872],
      [-730, 950],
      [-790, 1010],
    ],
  },
  {
    id: 'emberbrook',
    name: 'Emberbrook',
    warm: true,
    width: 9,
    depth: 1.6,
    points: [
      [440, -318],
      [500, -270],
      [575, -240],
      [646, -262],
      [712, -296],
      [782, -318],
      [850, -330],
      [920, -335],
    ],
  },
  {
    id: 'wreckers_stream',
    name: "Wrecker's Stream",
    width: 7,
    depth: 1.3,
    points: [
      [60, 330],
      [84, 402],
      [92, 470],
      [80, 540],
      [104, 610],
      [112, 660],
      [86, 730],
      [60, 800],
      [44, 880],
      [34, 960],
    ],
  },
];

export interface LakeDef {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  depth: number;
  frozen?: boolean;
  hot?: boolean;
}

export const LAKES: readonly LakeDef[] = [
  { id: 'mirror', name: 'Mirror Lake', x: -462, z: 282, radius: 108, depth: 9 },
  { id: 'frostglass', name: 'Frostglass Lake', x: -262, z: -560, radius: 112, depth: 7, frozen: true },
  { id: 'emberwell_a', name: 'Emberwell', x: 418, z: -296, radius: 15, depth: 2.2, hot: true },
  { id: 'emberwell_b', name: 'Emberwell', x: 462, z: -330, radius: 10, depth: 1.8, hot: true },
  { id: 'emberwell_c', name: 'Emberwell', x: 398, z: -344, radius: 8, depth: 1.5, hot: true },
  { id: 'poppy_pond', name: 'Heron Pond', x: 140, z: 760, radius: 26, depth: 2.5 },
];

/** Worn trails that connect landmarks; players follow them without being told. */
export const TRAILS: readonly [string, string][] = [
  ['crash_camp', 'meridian_wreck'],
  ['crash_camp', 'singing_stones'],
  ['singing_stones', 'whispering_cave'],
  ['crash_camp', 'poppy_hill'],
  ['crash_camp', 'old_aqueduct'],
  ['old_aqueduct', 'rim_lookout'],
  ['old_aqueduct', 'tocks_vault'],
  ['tocks_vault', 'echo_garden'],
  ['echo_garden', 'floating_isle'],
  ['floating_isle', 'meridian_tail'],
  ['singing_stones', 'lanternfly_hollow'],
  ['lanternfly_hollow', 'stilt_village'],
  ['stilt_village', 'ziggurat'],
  ['whispering_cave', 'hollow_elder'],
  ['hollow_elder', 'trapper_cabin'],
  ['trapper_cabin', 'sled_camp'],
  ['sled_camp', 'bell_frost'],
  ['echo_garden', 'hot_springs'],
  ['hot_springs', 'old_persistence'],
  ['old_persistence', 'sunken_face'],
  ['meridian_tail', 'galleon'],
  ['galleon', 'lighthouse'],
];
