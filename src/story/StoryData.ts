// Narrative content: the survivors, the quests of Act I and the rescues
// that bring the crew back together, and every line they speak. Systems in
// src/story read this data; nothing here knows about rendering.

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  /** Where they live before and after joining the camp. */
  home: { landmark: string; dx: number; dz: number };
  camp: { dx: number; dz: number };
  /** Starts at the crash camp (true) or must be found first. */
  startsAtCamp: boolean;
  look: { coat: number; trim: number; skin: number; hat: 'captain' | 'goggles' | 'hood' | 'none' | 'tricorn'; height: number; echo?: boolean };
}

export const NPCS: readonly NpcDef[] = [
  {
    id: 'varga',
    name: 'Captain Ilse Varga',
    title: 'Captain of the Meridian',
    home: { landmark: 'crash_camp', dx: 3, dz: -2 },
    camp: { dx: 3, dz: -2 },
    startsAtCamp: true,
    look: { coat: 0x1f2a3a, trim: 0xb08d4a, skin: 0xc79a7a, hat: 'captain', height: 1.74 },
  },
  {
    id: 'tock',
    name: 'Tomas "Tock" Brennet',
    title: 'Chief Engineer',
    home: { landmark: 'tocks_vault', dx: 4, dz: 3 },
    camp: { dx: -4, dz: 3 },
    startsAtCamp: false,
    look: { coat: 0x5a4632, trim: 0x8a8d92, skin: 0xa8765a, hat: 'goggles', height: 1.8 },
  },
  {
    id: 'wren',
    name: 'Dr. Wren Okafor',
    title: 'Naturalist',
    home: { landmark: 'hollow_elder', dx: 6, dz: 2 },
    camp: { dx: -2, dz: -5 },
    startsAtCamp: false,
    look: { coat: 0x3d5a3a, trim: 0xd9c9a0, skin: 0x5a3a28, hat: 'none', height: 1.68 },
  },
  {
    id: 'ilyr',
    name: 'Ilyr',
    title: 'The Listener',
    home: { landmark: 'singing_stones', dx: 0, dz: 0 },
    camp: { dx: 0, dz: 0 },
    startsAtCamp: false,
    look: { coat: 0x3fd9c4, trim: 0xbff5ea, skin: 0x9ff0e4, hat: 'hood', height: 1.9, echo: true },
  },
];

export type StepKind = 'talk' | 'goto' | 'craft' | 'place' | 'sleep' | 'collect' | 'flag' | 'discover' | 'kill';

export interface QuestStep {
  id: string;
  text: string;
  kind: StepKind;
  /** npc id, landmark id, item id, structure type, flag name or species. */
  target: string;
  count?: number;
  /** Optional hint text shown under the objective. */
  hint?: string;
}

export interface QuestDef {
  id: string;
  title: string;
  main: boolean;
  giver: string;
  summary: string;
  steps: QuestStep[];
  rewards: [string, number][];
  /** Quest ids that must be complete before this one starts. */
  after: string[];
  /** Starts automatically when prerequisites finish (else needs a flag). */
  auto: boolean;
  startFlag?: string;
}

export const QUESTS: readonly QuestDef[] = [
  {
    id: 'waking',
    title: 'Waking',
    main: true,
    giver: 'varga',
    summary: 'The Meridian is down. Someone is shouting your name from the smoke by the birches.',
    steps: [{ id: 'talk', text: 'Find Captain Varga at the crash camp', kind: 'talk', target: 'varga' }],
    rewards: [['berries', 4]],
    after: [],
    auto: true,
  },
  {
    id: 'shelter',
    title: 'Shelter Before Dark',
    main: true,
    giver: 'varga',
    summary: 'Varga wants tools, a fire and somewhere to sleep before the sun goes. Nights here are not kind.',
    steps: [
      { id: 'axe', text: 'Craft a stone axe', kind: 'craft', target: 'stone_axe', hint: 'Sticks, flint and rope (twist fibre from flax plants). Open your pack with Tab.' },
      { id: 'fire', text: 'Build a campfire', kind: 'place', target: 'campfire', hint: 'Stones, wood and sticks. Fell a tree with your axe for wood.' },
      { id: 'bed', text: 'Lay down a bedroll', kind: 'place', target: 'bedroll', hint: 'Twelve fibre and two sticks.' },
      { id: 'report', text: 'Tell Varga the camp is ready', kind: 'talk', target: 'varga' },
    ],
    rewards: [
      ['torch', 1],
      ['cooked_meat', 2],
    ],
    after: ['waking'],
    auto: true,
  },
  {
    id: 'stones',
    title: 'The Singing Stones',
    main: true,
    giver: 'varga',
    summary: 'West of camp, a ring of standing stones hums at dusk. Varga heard it all night. So did you.',
    steps: [
      { id: 'reach', text: 'Reach the Singing Stones', kind: 'discover', target: 'singing_stones' },
      { id: 'mural', text: 'Read the carved mural', kind: 'flag', target: 'read_mural', hint: 'A slab at the edge of the ring shows the order of the glyphs.' },
      { id: 'tune', text: 'Strike the stones in the mural’s order', kind: 'flag', target: 'stones_tuned', hint: 'Each stone bears one glyph. Strike them with E.' },
      { id: 'lantern', text: 'Take the Echo Lantern', kind: 'collect', target: 'echo_lantern' },
      { id: 'listen', text: 'Speak with the echo in the ring', kind: 'talk', target: 'ilyr' },
    ],
    rewards: [['songstone', 2]],
    after: ['shelter'],
    auto: true,
  },
  {
    id: 'needle',
    title: 'What the Needle Knows',
    main: true,
    giver: 'ilyr',
    summary: 'Ilyr says the land is holding a single note, and that you can hear it best from the high ground of the Rim.',
    steps: [
      { id: 'climb', text: 'Climb to the Rim Lookout', kind: 'discover', target: 'rim_lookout', hint: 'Steep faces can be climbed. Watch your stamina.' },
      { id: 'see', text: 'Listen at the lookout', kind: 'flag', target: 'saw_stillheart', hint: 'Look toward the crater with the Echo Lantern in hand.' },
      { id: 'report', text: 'Return to Varga with what you saw', kind: 'talk', target: 'varga' },
    ],
    rewards: [['heartsong', 1]],
    after: ['stones'],
    auto: true,
  },
  {
    id: 'bells',
    title: 'The Five Bells',
    main: true,
    giver: 'ilyr',
    summary: 'Five Bellstones anchor the Held Note. Each is guarded. Ring them, and the Veil may thin.',
    steps: [
      { id: 'hollowpine', text: 'Find the Bellstone of Hollowpine', kind: 'discover', target: 'bell_hollowpine' },
      { id: 'coast', text: 'Find the Drowned Bell on the coast', kind: 'discover', target: 'bell_coast' },
      { id: 'cinder', text: 'Find the Bellstone in the caldera', kind: 'discover', target: 'bell_cinder' },
      { id: 'frost', text: 'Find the Bellstone of Frostglass', kind: 'discover', target: 'bell_frost' },
      { id: 'fen', text: 'Find the Bellstone of the Drownfen', kind: 'discover', target: 'bell_fen' },
    ],
    rewards: [['heartsong', 1]],
    after: ['needle'],
    auto: true,
  },
  {
    id: 'rescue_tock',
    title: 'Knocking from Below',
    main: false,
    giver: 'varga',
    summary: 'Tock went looking for salvage and never came back. Varga thinks she heard hammering from the old vault at the Greensward edge.',
    steps: [
      { id: 'reach', text: 'Reach Tock’s Vault', kind: 'discover', target: 'tocks_vault' },
      { id: 'open', text: 'Open the sealed door with the Echo Lantern', kind: 'flag', target: 'vault_open', hint: 'Hold the lantern and use the door.' },
      { id: 'talk', text: 'Talk to Tock', kind: 'talk', target: 'tock' },
    ],
    rewards: [
      ['iron_ingot', 2],
      ['gears', 2],
    ],
    after: ['stones'],
    auto: true,
  },
  {
    id: 'rescue_wren',
    title: 'Up a Tree',
    main: false,
    giver: 'varga',
    summary: 'Dr. Okafor was last seen chasing a moth into Hollowpine. Duskhounds hunt there after dark.',
    steps: [
      { id: 'reach', text: 'Search the Hollow Elder in Hollowpine', kind: 'discover', target: 'hollow_elder' },
      { id: 'hounds', text: 'Drive off the duskhounds', kind: 'kill', target: 'duskhound', count: 2, hint: 'Hounds circle below the great tree. Weak point: the throat.' },
      { id: 'talk', text: 'Talk to Wren', kind: 'talk', target: 'wren' },
    ],
    rewards: [
      ['salve', 3],
      ['herbal_tea', 2],
    ],
    after: ['shelter'],
    auto: true,
  },
  {
    id: 'captains_log',
    title: 'The Captain’s Log',
    main: false,
    giver: 'varga',
    summary: 'The tail section fell somewhere in the Glasswood. Varga wants the flight log back. She won’t say why.',
    steps: [
      { id: 'reach', text: 'Find the Meridian’s tail section', kind: 'discover', target: 'meridian_tail' },
      { id: 'log', text: 'Recover the flight log', kind: 'flag', target: 'found_log' },
      { id: 'return', text: 'Bring the log to Varga', kind: 'talk', target: 'varga' },
    ],
    rewards: [['airship_canvas', 3]],
    after: ['needle'],
    auto: true,
  },
];

export interface Line {
  speaker: string;
  text: string;
}

/**
 * Dialogue keyed by `${npc}:${quest}:${step}` for the active step the NPC
 * advances, or `${npc}:idle` for small talk. Later lines win over earlier.
 */
export const DIALOGUE: Record<string, Line[]> = {
  'varga:waking:talk': [
    { speaker: 'Varga', text: 'There you are. I thought the envelope had taken you with it.' },
    { speaker: 'Varga', text: 'Half the crew is missing. Tock went after salvage, Okafor went after a moth. Of course she did.' },
    { speaker: 'Varga', text: 'We came down inside that shimmer we saw from the air. The compass spins. The radio sings. Sings.' },
    { speaker: 'Varga', text: 'First things first. We need a fire and somewhere to sleep before dark. I don’t like what I heard last night.' },
  ],
  'varga:shelter:report': [
    { speaker: 'Varga', text: 'A fire. A bed. You’d be surprised how much of command is exactly this.' },
    { speaker: 'Varga', text: 'Now. The humming. West of here, a ring of stones. It got louder at dusk, like it was listening back.' },
    { speaker: 'Varga', text: 'Take a torch. Go look. Don’t touch anything clever.' },
  ],
  'ilyr:stones:listen': [
    { speaker: 'Ilyr', text: '…you struck them in order. No one has struck them in order for… I cannot count it.' },
    { speaker: 'Ilyr', text: 'I am Ilyr. I was the Choirmaster’s apprentice. I am what is left of a warning no one heard.' },
    { speaker: 'Ilyr', text: 'The land is holding one note. It has held it so long it has forgotten how to let go.' },
    { speaker: 'Ilyr', text: 'Carry the lantern to the Rim. Listen from the high ground. You will see what the note is holding.' },
  ],
  'varga:needle:report': [
    { speaker: 'Varga', text: 'A city in the crater, under a wall of light. And a voice telling you to ring bells.' },
    { speaker: 'Varga', text: '…Fine. We can’t fly out through that shimmer. If ringing bells thins it, we ring bells.' },
    { speaker: 'Varga', text: 'But we do it together. Find my people. Then find your bells.' },
  ],
  'tock:rescue_tock:talk': [
    { speaker: 'Tock', text: 'Light! Blessed, beautiful light. Three days I’ve been hammering on that door. Or three hours. Clocks don’t work in there.' },
    { speaker: 'Tock', text: 'You opened it with a lamp? Show me that lamp. No — later. Food first. Then the lamp.' },
    { speaker: 'Tock', text: 'I’ll set up at camp. Bring me iron and I’ll make you tools that don’t shatter on the first stubborn rock.' },
  ],
  'wren:rescue_wren:talk': [
    { speaker: 'Wren', text: 'Oh thank goodness. They’ve been circling since yesterday. Very polite about it, actually. Very patient.' },
    { speaker: 'Wren', text: 'I found something odd. The moths here don’t age. The same scar on the same wing, every night.' },
    { speaker: 'Wren', text: 'I’ll come back to camp. I can grow things, and I can patch you up. Bring me anything strange.' },
  ],
  'varga:captains_log:return': [
    { speaker: 'Varga', text: 'You read it. Of course you did.' },
    { speaker: 'Varga', text: 'We didn’t drift into the shimmer. I steered us in. The instruments said there was an island inside. I wanted to see.' },
    { speaker: 'Varga', text: 'That makes this my fault. So I’ll be the one who gets everyone home.' },
  ],
  'varga:idle': [
    { speaker: 'Varga', text: 'Keep the fire fed. Eat when you can, drink when you can. And don’t sleep in the open.' },
  ],
  'tock:idle': [
    { speaker: 'Tock', text: 'Everything the Veyr built hums. Put your ear on a wall sometime. Go on.' },
  ],
  'wren:idle': [
    { speaker: 'Wren', text: 'If you see a deer with a notch in its left ear, write down the date. I want to know if it’s the same one.' },
  ],
  'ilyr:idle': [
    { speaker: 'Ilyr', text: 'Five bells. Five anchors. Each one guarded by something the note would not let go.' },
  ],
};

/** Mural glyph order for the Singing Stones (indices into GLYPHS). */
export const TUNING_ORDER = [2, 0, 3, 1, 4];
export const GLYPHS = ['○', '△', '◇', '☽', '✶'];
export const GLYPH_NAMES = ['Circle', 'Rise', 'Diamond', 'Crescent', 'Star'];
