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
    id: 'grove_warden',
    title: 'The Warden of Hollowpine',
    main: true,
    giver: 'ilyr',
    summary: 'Each Bellstone is guarded by something the Held Note will not let die. The nearest lies west, where Hollowpine has grown over the first bell.',
    steps: [
      { id: 'reach', text: 'Find the Bellstone in Hollowpine', kind: 'discover', target: 'bell_hollowpine', hint: 'Far west, beyond the Hollow Elder.' },
      { id: 'calm', text: 'Calm Mossback, Warden of Hollowpine', kind: 'flag', target: 'warden_hollowpine', hint: 'Shatter the glowing knots on its forelegs. When it reels, strike the knot at its chest. Jump its shockwaves; let its charge find a tree.' },
      { id: 'ring', text: 'Ring the Bellstone', kind: 'flag', target: 'rung_bell_hollowpine' },
      { id: 'report', text: 'Tell Ilyr the first bell has rung', kind: 'talk', target: 'ilyr' },
    ],
    rewards: [['heartsong', 2]],
    after: ['needle'],
    auto: true,
  },
  {
    id: 'coast_warden',
    title: 'The Drowned Bell',
    main: true,
    giver: 'ilyr',
    summary: 'On the eastern coast a bell rings under the cliffs at low tide. Something vast sleeps in the shallows beside it.',
    steps: [
      { id: 'reach', text: 'Find the Drowned Bell on the eastern coast', kind: 'discover', target: 'bell_coast' },
      { id: 'calm', text: 'Calm Tidemother, Warden of the Drowned Bell', kind: 'flag', target: 'warden_coast', hint: 'Her knots glow on her forelegs. Jump the waves she stamps out; watch the sand for rising water.' },
      { id: 'ring', text: 'Ring the Drowned Bell', kind: 'flag', target: 'rung_bell_coast' },
    ],
    rewards: [['heartsong', 2]],
    after: ['grove_warden'],
    auto: true,
  },
  {
    id: 'cinder_warden',
    title: 'The Caldera Forge',
    main: true,
    giver: 'ilyr',
    summary: 'Inside the volcano the Veyr cast their bells, and the forge is still tended. Bring water, and something for the heat.',
    steps: [
      { id: 'reach', text: 'Find the forge inside the caldera', kind: 'discover', target: 'bell_cinder' },
      { id: 'calm', text: 'Calm Emberjaw, Warden of the Caldera Forge', kind: 'flag', target: 'warden_cinder', hint: 'It charges hard and fast. Put a pillar or a boulder between you, then strike its knots while it reels.' },
      { id: 'ring', text: 'Ring the Forge Bell', kind: 'flag', target: 'rung_bell_cinder' },
    ],
    rewards: [['heartsong', 2]],
    after: ['grove_warden'],
    auto: true,
  },
  {
    id: 'frost_warden',
    title: 'Frostglass',
    main: true,
    giver: 'ilyr',
    summary: 'A lake in the northern peaks is frozen so clear you can see what sleeps under it. The bell stands in the middle of the ice.',
    steps: [
      { id: 'reach', text: 'Cross the ice to the bell on Frostglass Lake', kind: 'discover', target: 'bell_frost', hint: 'Dress warm. The cold on the ice is worse than the cold on the peaks.' },
      { id: 'calm', text: 'Calm Rimebrow, Warden of Frostglass', kind: 'flag', target: 'warden_frost', hint: 'Ice erupts where it stares. Keep moving, and break the crystal knots on its legs.' },
      { id: 'ring', text: 'Ring the Frostglass Bell', kind: 'flag', target: 'rung_bell_frost' },
    ],
    rewards: [['heartsong', 2]],
    after: ['grove_warden'],
    auto: true,
  },
  {
    id: 'fen_warden',
    title: 'The Choir Mire',
    main: true,
    giver: 'ilyr',
    summary: 'In the southern marsh, bells stand in the water like reeds and sing when no one is there. Ilyr will not say why the Mire makes them sad.',
    steps: [
      { id: 'reach', text: 'Find the Choir Mire in the Drownfen', kind: 'discover', target: 'bell_fen' },
      { id: 'calm', text: 'Calm Old Croak, Warden of the Choir Mire', kind: 'flag', target: 'warden_fen', hint: 'Heavy and slow, but the mud answers it. Watch the ground.' },
      { id: 'ring', text: 'Ring the Mire Bell', kind: 'flag', target: 'rung_bell_fen' },
    ],
    rewards: [['heartsong', 2]],
    after: ['grove_warden'],
    auto: true,
  },
  {
    id: 'held_note',
    title: 'The Held Note',
    main: true,
    giver: 'ilyr',
    summary: 'Five bells ring free. The wall of light over the crater is thinner than it has been in an age. Ilyr is waiting.',
    steps: [
      { id: 'talk', text: 'Return to Ilyr at the Singing Stones', kind: 'talk', target: 'ilyr' },
      { id: 'heart', text: 'Walk down into Hallowmere, to the Heart', kind: 'flag', target: 'reached_heart', hint: 'The crater at the centre of the island. The wall of light will let you pass now.' },
    ],
    rewards: [['heartsong', 4]],
    after: ['grove_warden', 'coast_warden', 'cinder_warden', 'frost_warden', 'fen_warden'],
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
  {
    id: 'tocks_workshop',
    title: 'A Proper Workshop',
    main: false,
    giver: 'tock',
    summary: 'Tock can’t mend an airship with a rock and good intentions. He wants a smelter at camp, and iron to feed it.',
    steps: [
      { id: 'smelter', text: 'Build a smelter', kind: 'place', target: 'smelter', hint: 'Craft one at a workbench from stone and clay.' },
      { id: 'iron', text: 'Smelt four iron ingots', kind: 'collect', target: 'iron_ingot', count: 4, hint: 'Iron veins show rust-red in the rock. Smelt two ore with coal or wood.' },
      { id: 'talk', text: 'Bring the ingots to Tock', kind: 'talk', target: 'tock' },
    ],
    rewards: [
      ['iron_pickaxe', 1],
      ['gears', 2],
    ],
    after: ['rescue_tock'],
    auto: true,
  },
  {
    id: 'field_notes',
    title: 'Field Notes',
    main: false,
    giver: 'wren',
    summary: 'Wren is cataloguing everything that lives here. The birds fly the same circles every day; she wants a closer look at one, and at whatever makes the Crystal Grotto glow.',
    steps: [
      { id: 'rook', text: 'Bring down a rook with a bow', kind: 'kill', target: 'rook', count: 1, hint: 'Rooks flock over the Greensward. Hold the shot a little high at range.' },
      { id: 'grotto', text: 'Reach the chamber of the Crystal Grotto', kind: 'flag', target: 'heard:crystal_grotto', hint: 'East in the Glasswood. It is dark inside: take a torch.' },
      { id: 'talk', text: 'Tell Wren what you found', kind: 'talk', target: 'wren' },
    ],
    rewards: [
      ['iron_arrow', 12],
      ['salve', 2],
    ],
    after: ['rescue_wren'],
    auto: true,
  },
  {
    id: 'rock_remembers',
    title: 'What the Rock Remembers',
    main: false,
    giver: 'ilyr',
    summary: 'The Veyr listened to the island through its caves. Ilyr asks you to go down into each one and hear what the stone still holds.',
    steps: [
      { id: 'whisper', text: 'Listen in the Whispering Cave', kind: 'flag', target: 'heard:whispering_cave', hint: 'On a hill in the Greensward, west of camp.' },
      { id: 'crystal', text: 'Listen in the Crystal Grotto', kind: 'flag', target: 'heard:crystal_grotto', hint: 'In the Glasswood.' },
      { id: 'lava', text: 'Listen in the Lava Tubes', kind: 'flag', target: 'heard:lava_tubes', hint: 'In the Cinderreach, under the caldera.' },
      { id: 'ice', text: 'Listen in the Ice Caves', kind: 'flag', target: 'heard:ice_caves', hint: 'High in the Frostveil.' },
      { id: 'talk', text: 'Return to Ilyr', kind: 'talk', target: 'ilyr' },
    ],
    rewards: [
      ['heartsong', 1],
      ['songstone', 4],
    ],
    after: ['stones'],
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
  'ilyr:grove_warden:report': [
    { speaker: 'Ilyr', text: 'I heard it. The whole ring heard it. For a moment the stones remembered a second note.' },
    { speaker: 'Ilyr', text: 'Mossback was gentle once. It carried the Choirmaster’s daughter through the grove on its back.' },
    { speaker: 'Ilyr', text: 'Four bells remain, and four Wardens. The coast. The caldera. The ice. The fen. Each will be harder than the last.' },
  ],
  'ilyr:held_note:talk': [
    { speaker: 'Ilyr', text: 'Five bells. I heard every one of them. For the first time since the note began, it is not alone.' },
    { speaker: 'Ilyr', text: 'The Veil is thin enough to walk through now. Go to the crater. Stand at the heart of the island and listen.' },
    { speaker: 'Ilyr', text: 'Whatever happens there, you gave us back the end of our song. That is more than anyone ever gave the Veyr.' },
  ],
  'tock:tocks_workshop:talk': [
    { speaker: 'Tock', text: 'Four ingots! Clean pours, too. You’ve got hands for this, you know.' },
    { speaker: 'Tock', text: 'Here. I reforged the old ship’s pick while you were out. Iron bites where stone just bounces.' },
    { speaker: 'Tock', text: 'The Meridian’s frame is sound. It’s the rest of the island that’s broken. Clocks, compasses, time. I can fix brass. I can’t fix that.' },
  ],
  'wren:field_notes:talk': [
    { speaker: 'Wren', text: 'Look at this primary feather. Notched, here. Every rook in that flock has the same notch, in the same place.' },
    { speaker: 'Wren', text: 'It isn’t a flock. It’s one morning, repeating. And the grotto? The crystals are singing. Literally. The song goes solid when it has nowhere to go.' },
    { speaker: 'Wren', text: 'Take these. Iron heads. Whatever is holding this island still, I would like it to hold still less.' },
  ],
  'ilyr:rock_remembers:talk': [
    { speaker: 'Ilyr', text: 'You heard them. The breath in the hill, the glass voices, the fire that hums, the cold that listens.' },
    { speaker: 'Ilyr', text: 'Four caves, four parts of one chord. We sang it once, together, and the island answered. Then we stopped, and it kept holding the last note for us.' },
    { speaker: 'Ilyr', text: 'This is a Heartsong. It was mine. I have less need of a heartbeat than you.' },
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

/** Which flag frees each Bellstone (its Warden calmed). */
export const BELL_WARDENS: Record<string, string> = {
  bell_hollowpine: 'warden_hollowpine',
  bell_coast: 'warden_coast',
  bell_cinder: 'warden_cinder',
  bell_frost: 'warden_frost',
  bell_fen: 'warden_fen',
};

/** What the Bellstone shows you when it rings (Ilyr's voice through the stone). */
export const BELL_MEMORIES: Record<string, Line[]> = {
  bell_hollowpine: [
    { speaker: 'Memory', text: 'A girl in a grey choir-robe runs through young birches, laughing. A calf with velvet antlers follows her everywhere.' },
    { speaker: 'Memory', text: 'The note begins. The birds stop mid-song. The calf lies down beside the bell and will not leave it.' },
    { speaker: 'Memory', text: 'Years that are not years. It cannot die, so it grows. Moss. Ferns. Trees. A forest keeping watch over a bell.' },
    { speaker: 'Ilyr', text: 'One bell rings free. Can you feel the Veil loosen, just a little?' },
  ],
  bell_coast: [
    { speaker: 'Memory', text: 'A harbour full of ships with sails the colour of dawn. A great turtle carries the harbour-master’s children through the shallows.' },
    { speaker: 'Memory', text: 'The note begins. A wave rising over the breakwater stops, and hangs there, and never falls.' },
    { speaker: 'Memory', text: 'The turtle swims out to the Drowned Bell and curls around it, and the sea forgets how to move.' },
    { speaker: 'Ilyr', text: 'Two bells. The tide is breathing again.' },
  ],
  bell_cinder: [
    { speaker: 'Memory', text: 'The forge at the heart of the mountain, where the Veyr cast their bells. A great boar sleeps by the anvils, warming the smiths’ hands.' },
    { speaker: 'Memory', text: 'The Smith-Mother pours the last bell as the note begins. The metal never cools.' },
    { speaker: 'Memory', text: 'Her hound stands guard over a forge that can never finish its work.' },
    { speaker: 'Ilyr', text: 'The forge can rest now. So can we, soon.' },
  ],
  bell_frost: [
    { speaker: 'Memory', text: 'A frozen lake at midwinter, children skating in circles. A white ram watches from the shore.' },
    { speaker: 'Memory', text: 'The Choirmaster comes to sing the note into the ice, to keep it safe. It works too well.' },
    { speaker: 'Memory', text: 'The ram stands on the ice for a thousand winters, keeping the song from breaking through.' },
    { speaker: 'Ilyr', text: 'The Choirmaster was my teacher. She only meant to keep the song safe.' },
  ],
  bell_fen: [
    { speaker: 'Memory', text: 'The choir rehearses in the reeds at dusk, bells tied at their wrists. A huge old toad hums along, always half a note flat.' },
    { speaker: 'Memory', text: 'The water rises as the note begins. The choir keeps singing. They keep singing.' },
    { speaker: 'Memory', text: 'The toad gathers up their bells one by one and holds them above the water.' },
    { speaker: 'Ilyr', text: 'They were my friends. Thank you for letting them rest.' },
  ],
};

/** The last narration, when the heart of the island is reached with five bells rung. */
export const EPILOGUE = [
  'At the rim of the crater, the five bells answer each other across the island.',
  'The wall of light over Hallowmere shivers, and for the first time in an age, the note changes.',
  'It does not stop. It resolves: a second note beneath the first, then a third. A chord.',
  'Below, in the city, lamps come on in windows that have been dark for a thousand years.',
  'Ilyr, very close: “Thank you. Now it can end properly. Now something can begin.”',
  'Behind you, on the wind, an engine coughs and catches. Varga has the Meridian flying.',
];

/** Mural glyph order for the Singing Stones (indices into GLYPHS). */
export const TUNING_ORDER = [2, 0, 3, 1, 4];
export const GLYPHS = ['○', '△', '◇', '☽', '✶'];
export const GLYPH_NAMES = ['Circle', 'Rise', 'Diamond', 'Crescent', 'Star'];

/** What each cave's deep chamber still says, the first time you stand in it. */
export const CAVE_ECHOES: Record<string, Line[]> = {
  whispering_cave: [
    { speaker: '', text: 'The hill breathes in. Somewhere in the dark, many voices hum one low note.' },
    { speaker: 'Echo', text: '…hold it… hold it for us… we will come back for the end of it…' },
  ],
  crystal_grotto: [
    { speaker: '', text: 'The crystals ring faintly as you come near, as if something inside them is still singing.' },
    { speaker: 'Echo', text: 'Sing it into the glass. Glass forgets nothing.' },
  ],
  lava_tubes: [
    { speaker: '', text: 'The rock hums in the heat. It is the same note, lower, bent by the fire.' },
    { speaker: 'Echo', text: 'Keep the forges lit. If the song cools, the island cools with it.' },
  ],
  ice_caves: [
    { speaker: '', text: 'Frost creeps across the ice in slow rings, keeping time to something you cannot hear.' },
    { speaker: 'Echo', text: 'Listen. The cold is only waiting. The cold is very patient.' },
  ],
};
