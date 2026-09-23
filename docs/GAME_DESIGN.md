# STILLWILD — Game Design Document

> *A land that forgot how to end.*

Version 1.0 · Living document. Every system in `src/` traces back to a section here. When design changes, update this file in the same commit.

---

## 1. One-page pitch

**Genre:** Open-world survival-adventure, third person, single player.
**Platform:** Desktop browser (WebGL2). Keyboard + mouse and gamepad. Touch/mobile is a later roadmap item.
**Session shape:** 20-minute sittings that always end with something new found, and a 25–40 hour full playthrough.

You are **the Surveyor**, the cartographer of the airship *Meridian*. A storm that sang like a choir tore the ship apart over an uncharted valley. You wake in the wreckage inside **the Stillwild**: a dense, beautiful wilderness ringed by a wall of mist that never lets anyone leave, scattered with the resonant ruins of a vanished people, the Veyr.

The Stillwild does not change. Nothing here truly dies, the seasons stall, echoes of the past replay on the wind, and every expedition that ever blundered in — a galleon crew 180 years ago, a balloon survey 63 years ago, a mining crawler 40 years ago — is still here, held. At the center of the land a colossal ring of stone, **the Crown**, floats above a crater, and your compass needle will not stop pointing at it.

Survive, map the land, find your scattered crew and the stranger survivors who came before, ring the five Bellstones, and decide what to do with the note that has held this world still for nine hundred years.

### Design pillars

1. **Curiosity is the engine.** Every 60–120 seconds of movement the player sees, hears or finds something that asks a question: a distant structure, a strange sound, a glint, an echo, a creature doing something unexpected. The world is built around sightlines and silhouettes, not map icons.
2. **A wilderness with memory.** Every place tells a story — of the Veyr, of an earlier expedition, or of an ecosystem doing its thing. Nothing is placed only to be filler.
3. **Survival is texture, not tax.** Needs create preparation and choices (pack warm clothes for the peaks, make camp before dark, cook before the long trek). They never interrupt play every 90 seconds, and they never kill a player who is paying reasonable attention.
4. **Earned mobility.** Progression is mostly new ways to move and new places you can survive: the Echo Lantern, fur and ash clothing, climbing picks, the Wingsail glider, the Resonance Hook. Not +3% damage.
5. **Small, dense, deliberate.** 2 × 2 km of land where nearly every hill hides purpose. We prefer a smaller map with constant discovery to a large empty one.

### Visual bar

Ultra-realistic, physically lit, AAA-grade presentation (see §13): a world that looks like a place, where the teal light of the Veyr is the only thing that shouldn't be there.

### Target feeling

Awe and wanderlust, laced with unease. Quiet mornings, a hush before storms, relief at a campfire, the thrill of cresting a ridge and seeing the Crown catch the sunrise. Danger is real but readable.

---

## 2. Core loops

### Core loop contract

> The player **explores and traverses** the Stillwild to **uncover landmarks, resources and lore** while **hunger, cold, night, weather and creatures** create risk; success gives **new gear, traversal abilities, survivors and story revelations** that open new regions; failure means **waking at the last bed or campfire, with the carried satchel left behind where you fell**.

| Time scale | What the player does | What changes |
| --- | --- | --- |
| 5–30 s | Move, look, spot, gather in passing, dodge, fight or avoid | Resources, stamina, position, curiosity targets |
| 1–5 min | Reach a point of interest, solve a small puzzle, loot, fight a guardian, cook, camp | New item, recipe, lore page, map reveal, echo |
| 15–60 min | Prepare and run an expedition into a new biome, rescue a survivor, build/upgrade base | New traversal/resistance, new station tier, new service |
| Hours | Ring the five Bellstones, uncover the Stilling, reach the Stillheart | World state shifts, Veil thins, story revelations, endgame |

### What a better player does differently

Reads weather and time of day and plans around them; uses terrain (high ground to scout, water to escape predators, cliffs to glide); targets weak points; brings the right clothing; builds a base in a good spot (near water, central to routes); follows sounds and sightlines instead of the compass.

### Fun-factor checks (must stay true)

- First 30 seconds contain a decision (loot the wreck vs. follow the smoke to the captain) and a view of the Crown.
- The main mechanic (exploration) cannot be ignored: resources, recipes and story are distributed so progress *requires* going somewhere new.
- Failure is always legible: the death screen names the cause (fell, froze, mauled by a Duskhound pack at night).

---

## 3. World

### 3.1 Scale and structure

- Playable land: **2048 m × 2048 m** heightfield (1 m resolution), origin at the center. North = −Z, East = +X.
- The Veil (a luminous mist wall) rings the land at ~980 m from center. Approaching it disorients the player and gently turns them around (no invisible walls — a diegetic boundary).
- Sea level `y = 0`. Highest peak ~320 m (Whitecrown Spire in the Frostveil).
- Walking 4.6 m/s, sprinting 7.6 m/s. A full crossing is ~4–5 minutes of sprinting — but nobody sprints in a straight line here.
- **Density target:** ~70 authored points of interest (one every ~250 m) plus ~200 minor curiosities (one every ~80–100 m), placed along sightlines.

### 3.2 Map sketch

```
                          N (−Z)
        ┌────────────────────────────────────────┐
        │   FROSTVEIL PEAKS        │  CINDERREACH │
        │  (snow, monastery,       │ (volcano,    │
        │   frozen lake, ice caves)│  vents, lava │
        │         ▲Bell            │  tubes) ▲Bell│
        │ HOLLOWPINE  ╲  THE RIM   ╱             │
  W     │ (dark pines, ╲ ┌──────┐ ╱   GLASSWOOD  │   E (+X)
 (−X)   │  Mirror Lake,  │CROWN │   (crystal     │  SALTGLASS
        │  Hollow Elder) │STILL-│    trees,      │  COAST
        │    ▲Bell       │HEART │    floating    │  (cliffs,
        │                └──────┘    isle)       │   galleon,
        │ DROWNFEN          GREENSWARD      ▲Bell│   lighthouse,
        │ (marsh, stilt    (meadows, the         │   sea cave)
        │  village) ▲Bell   Meridian crash)      │
        └────────────────────────────────────────┘
                          S (+Z) — sea
```

### 3.3 Biomes

Each biome has its own terrain shape, palette, vegetation kit, fauna, weather profile, ambient bed, music mode, hazard and signature landmark.

| Biome | Where | Terrain | Palette | Hazard | Signature landmark |
| --- | --- | --- | --- | --- | --- |
| **Greensward** | South center | Rolling hills 8–45 m, streams, meadows | Sun-bleached greens, gold grass, white birches, poppy reds | Gentle; night | **The Meridian wreck** (envelope draped over birches), **Singing Stones** circle |
| **Hollowpine** | West | Hills 20–90 m, valleys, Mirror Lake | Deep teal-greens, black trunks, bioluminescent fungus | Duskhound packs at night, low light | **The Hollow Elder** (colossal hollow tree, balloon gondola in its crown) |
| **Glasswood** | East of center | Undulating 15–55 m, crystal outcrops | Lavender, pale gold, teal crystal light | Resonance anomalies (hummers, time ripples) | **The Floating Isle** (tethered rock with a Veyr observatory) |
| **Saltglass Coast** | East edge | Cliffs, black-sand beaches, sea stacks | Slate blue, foam white, rust, kelp olive | Tides, Shellbacks, drowning | **The Saint Aldric galleon** and **the Lamplight** lighthouse |
| **Cinderreach** | North-east | Volcanic cone ~190 m, basalt terraces, caldera | Charcoal, ember orange, sulfur yellow | Heat, toxic vents, ashfall | **The Sunken Face** (colossal fallen Veyr statue), steam-crawler *Old Persistence* |
| **Frostveil Peaks** | North / north-west | Ridged mountains 80–320 m, high valley lake | Snow white, ice blue, dark spruce | Cold, blizzards, falls | **Monastery of Hush** on a peak, **Frostglass Lake** (walkable ice) |
| **Drownfen** | South-west | Flat 0–4 m, pools, channels | Olive, brown, sickly green, lantern-fly gold | Miasma, deep mud, Bog Lurkers | **The Stilt Village** (earlier expedition), half-sunken ziggurat |
| **The Rim & Stillheart** | Center | Ring ridge to 70 m around a 220 m crater | Pale stone, teal light, frozen motion | The barrier; endgame | **The Crown** — a floating ring of stone and light, visible from everywhere |

### 3.4 Water

- **Sea** everywhere below `y = 0` (east and south coasts, south-west shallows).
- **Rivers:** *Lanternrun* (Frostglass Lake → Veilfall waterfall → Mirror Lake → Drownfen → sea), *Emberbrook* (Cinderreach hot springs → Saltglass Coast, warm and steaming), *Wrecker's Stream* (Rim → past the Meridian → south beach; first drinking water).
- **Lakes:** Mirror Lake (Hollowpine), Frostglass Lake (frozen, walkable), hot pools (Cinderreach), marsh pools (Drownfen).

### 3.5 Points of interest (authored)

Landmarks are sited so that from each one you can see at least two others.

- **Greensward:** Meridian crash site (start), Wrecker's Stream ford, Singing Stones (tutorial ruin + Echo Lantern), Whispering Cave (tutorial cave), the Old Aqueduct, Poppy Hill lookout, a shepherd's cairn field, Tock's vault (Veyr vault door).
- **Hollowpine:** Hollow Elder, Jonah Reed's trapper cabin, Mirror Lake (+ submerged archive), Duskhound den, Fungus Ring, Mossback's Grove (Bellstone I), root caverns.
- **Glasswood:** Floating Isle observatory, Echo Garden (Listener's home), crystal grotto cave, Meridian tail section, Glass Stag meadow, Hummer pools.
- **Saltglass Coast:** Saint Aldric galleon (Corwin), Lamplight lighthouse, sea stacks, tide pools, Drowned Bell sea cave (Bellstone II), smugglers' steps.
- **Cinderreach:** Sunken Face, Old Persistence crawler, lava tubes, hot springs, obsidian field, the Caldera Forge (Bellstone III).
- **Frostveil:** Monastery of Hush (Maudra), Frostglass Lake arena (Bellstone IV), ice caves, sled camp (climbing picks), frozen titan in the ice, aurora overlook.
- **Drownfen:** Stilt Village (Pell), half-sunken ziggurat, Lantern-fly hollow, the Choir Mire (Bellstone V), drowned bells field.
- **Rim/Stillheart:** Five barrier pylons, the Rim lookout, the Descent, the Crown.

### 3.6 Minor curiosities (the connective tissue)

Placed procedurally along paths and sightlines with authored templates: lore pages, echoes (ghost replays with one line), Veyr tuning stones, cairns with a stash, skeletons with a clue, rare resource nodes (songstone clusters, silverleaf, star metal after meteor events), animal dens, bird nests, abandoned camps, shrines holding **Heartsong fragments** (4 fragments = +1 max stamina or health tier).

---

## 4. Story

### 4.1 Lore bible

- **The Veyr** lived in this valley — they called it *Aurelmark* — ~900 years ago. They believed the land sang: the **Undersong**, a resonance in stone that governs growth, weather and time. They built **Bellstones** (towering tuning-fork spires) to listen and to answer, coaxing rain, harvests and healing.
- Their city **Hallowmere** stood where the crater is now. Its heart was **the Crown**, a great resonant ring conducted by the **Choirmaster Seren Vey**.
- A wasting sickness, **the Greying**, took the Veyr's children first. Seren's daughter **Lio** was dying. Seren conceived **the Held Note**: sing the Undersong on one unending note so that nothing would ever change — nothing would ever end.
- Seren's apprentice **Ilyr** warned that a song without an ending is not a song. They were overruled.
- The whole city sang. The note held. The Greying stopped — and so did everything else. Hallowmere collapsed into the crater as the Crown rose. The singers crystallized: **songstone, the glowing teal crystal found across the land, is what the Veyr became.** (Mid-game revelation. Players have been crafting with it.)
- The note's reach formed **the Veil**. Inside it, time pools and loops. Nothing ages, nothing truly dies. Anything that wanders in is *held*.
- Earlier arrivals, all still here: the galleon **Saint Aldric** (~180 years ago), trapper **Jonah Reed** (~110 years ago, now an echo), the **Brightwater balloon survey** (63 years ago), the mining crawler **Old Persistence** (~40 years ago), and now the **Meridian**.
- The Bellstones are the note's anchors. Each is guarded by a **Warden**: a creature of the land the Held Note bound in place.

### 4.2 Cast

| Character | Who | Personality | Found | Role at base | Personal quest |
| --- | --- | --- | --- | --- | --- |
| **Captain Ilse Varga** | Captain of the *Meridian* | Stern, dry humor, protective, guilt over the crash | Crash camp (start) | **Expedition Board** (side jobs), rallies survivors | *The Captain's Log* — recover the flight log from the tail section in the Glasswood |
| **Tomas "Tock" Brennet** | Chief engineer | Gruff, funny, big-hearted, obsessed with Veyr machines | Trapped in a Veyr vault (Greensward edge) | **Tinker** — tool/weapon upgrades, builds the Wingsail | *Old Persistence* — restart the mining crawler in Cinderreach |
| **Dr. Wren Okafor** | Naturalist | Gentle, curious, wry | Up a tree in Hollowpine, surrounded by Duskhounds | **Botanist** — farm yields, remedies, bestiary | *Field Notes* — catalog 12 species; discovers nothing here ages |
| **Pell** | 12-year-old stowaway | Fearless, secretive, great climber | Drownfen stilt village | **Scout** — reveals rumored locations on the map | *Lights Under the Lake* — the submerged archive in Mirror Lake |
| **Sister Maudra** | Brightwater survey medic, arrived 63 years ago; looks 30 | Calm, wise, haunted | Monastery of Hush | **Glyph reader** — translates ruins, healer | *Letters Never Sent* — her letters in the balloon gondola |
| **Corwin Hale** | Marine of the *Saint Aldric*; believes it's been "near a season" | Wary, loyal, rigid honor, superb hunter | Guarding the galleon | **Quartermaster** — arrows, combat training, weak-point lore | *The Captain's Colors* — the galleon's flag, in the Drowned Bell's cave |
| **Ilyr, the Listener** | Echo of Seren's apprentice | Fragmented at first; clearer with every bell | Singing Stones, then Echo Garden | Main-quest guide | *(main quest)* |

Relationships: Varga ↔ Tock (old friends who bicker), Wren looks after Pell, Corwin distrusts Tock's "devilry", Maudra knows more than she says and becomes Varga's confidant, Maudra helps Corwin accept how long he's been here.

**Affinity** (0–100) grows through quests, gifts (each has liked/loved items) and conversations. Thresholds unlock deeper dialogue (25), their personal quest (40), better services (60) and their ending contribution (80).

### 4.3 Main quest

**Act I — Wreckage (Greensward).**
1. *Waking* — wake in the gondola wreck. Find Captain Varga at the crash camp. (Movement, camera, interact.)
2. *Shelter Before Dark* — gather, craft a stone axe, build a campfire and a bedroll before night. (Gathering, crafting, building, sleeping.)
3. *The Singing Stones* — the humming ruin to the west. Solve the tuning stones, take the **Echo Lantern**. Ilyr's first fragment. (Puzzle, lantern.)
4. *What the Needle Knows* — climb to the Rim lookout. See the Stillheart and the barrier. Ilyr explains the five Bellstones. (Climbing, map.)

**Act II — The Five Bells (any order).** For each Bellstone: reach it, clear its approach (mini-dungeon or puzzle), face its Warden, ring the bell. Each ringing thins the Veil, changes the world (new echoes, anomalies, weather), grants a **Heartsong** (max stamina/health) and plays a **memory**. Memories play in the order bells are rung, not by location, so the story is coherent in any route:
1. The Veyr at peace; the Undersong.
2. The Greying; Seren and Lio.
3. The plan of the Held Note; Ilyr's dissent.
4. The Stilling — the city falls, the singers crystallize (songstone reveal).
5. Seren alone in the Crown for nine centuries; the Veil forming.

Parallel thread: rescue Tock, Wren, Pell, Maudra and Corwin. After the third bell, Maudra reveals how long she's really been here; the survivors realize "home" may not be the home they left.

**Act III — The Stillheart.** With five bells rung the barrier falls. Descend into the crater: the moment of the Stilling held in place — crystal Veyr mid-song, a wave of rubble frozen mid-collapse, debris to climb. At the Crown: **Seren Vey, the Choirmaster**.

**Endings**
- **Release** — end the note. The Veil falls; time resumes. The Veyr finally rest (all songstone crumbles). The crew can go home. Maudra and Corwin age to their true years; Maudra chooses to walk out into the sunrise.
- **Sustain** — take Seren's place and hold a gentler note. The survivors stay in a world that will never end; you become its new Warden.
- **Retune** *(secret; requires all survivors at affinity ≥ 80 and all twelve of Ilyr's notes)* — teach the land a song with an ending in it. The Veil becomes a door, not a wall.

Post-game free roam continues in the chosen world state.

### 4.4 Side stories (examples)

*Jonah's Trapline* (Hollowpine) · *The Lantern Keeper* — relight the lighthouse (Coast) · *Echoes of Hallowmere* — seven echo scenes of two Veyr lovers across the land · *Fallen Star* (meteor event → star metal) · *The Wanderer* — climb the colossus and find the shrine on its back · the five personal quests above · Varga's Expedition Board jobs (repeatable, light).

---

## 5. Player

### 5.1 Movement (feel targets)

| Action | Tuning | Notes |
| --- | --- | --- |
| Walk / run | 4.6 m/s, accel 22 m/s², decel 26 m/s² | Snappy but weighted; turn-in-place blending |
| Sprint | 7.6 m/s, 12 stamina/s | FOV +6°, camera lowers slightly |
| Jump | 5.4 m/s up, coyote 0.12 s, buffer 0.12 s | Air control 35% |
| Climb | 1.9 m/s, 9 stamina/s; any surface steeper than 52° | Hop-up with jump (burst cost 18); mantle at ledges |
| Swim | 2.6 m/s, sprint-swim 4 m/s costs stamina | Out of stamina in deep water → drowning damage |
| Glide (Wingsail) | 9 m/s forward, −2.2 m/s sink, 4 stamina/s | Updrafts from hot vents and cliffs |
| Dodge roll | 0.45 s, i-frames 0.08–0.32 s, 20 stamina | Cancels attack recovery |
| Crouch | 2.2 m/s | Halves hearing radius for creatures |

Falls: safe under 9 m, damage scales to lethal at ~24 m. Landing in water ≥ 2 m deep negates fall damage.

### 5.2 Survival stats

| Stat | Behaviour | Penalty (never instantly lethal) | Buffs |
| --- | --- | --- | --- |
| **Health** | 100 base (+Heartsongs) | — | Regenerates when Fed and Hydrated; faster when Rested near fire/shelter |
| **Stamina** | 100 base | Max stamina shrinks when Hungry/Cold | Well Fed raises regen |
| **Food** | Full → empty in ~45 real minutes | Hungry: no health regen, −25 max stamina. Starving: slow damage | Cooked meals give timed buffs (warmth, regen, stamina) |
| **Water** | Full → empty in ~35 real minutes; faster in heat | Thirsty: stamina regen −50%. Parched: slow damage | Drink from rivers/lakes (raw water risk: small), flasks, rain collectors |
| **Temperature** | Body temp drifts toward felt temperature (biome, altitude, time, weather, wetness, clothing, fire, shelter) | Cold: stamina drain, then slow damage. Hot: water drains 2×, then slow damage | Warm clothing, teas, fires, shelter |
| **Wetness** | Rain/swimming | Feels 8–12 °C colder | Dries by fire/sun |

**Shelter** is detected (roof overhead + walls nearby or a campfire + roof). Sheltered = rain doesn't wet you, +warmth, can sleep, Rested buff.

### 5.3 Death and respawn

Wake at last bed/bedroll (or the crash camp). **Survivor** difficulty drops a satchel with carried non-equipped items at the death spot (marked on compass; one active satchel). **Explorer** keeps everything. **Harsh** drops everything but equipped gear.

---

## 6. Gathering, items and crafting

### 6.1 Resources

- **Common:** Wood, Fiber, Stone, Flint, Clay, Resin, Berries, Mushrooms, Herbs, Raw meat, Hide, Feathers, Bone.
- **Regional:** Hardwood & Moonmoss (Hollowpine), Driftwood, Salt, Kelp, Shells, Chitin (Coast), Iron ore, Coal, Obsidian, Sulfur, Ash lichen (Cinderreach), Silver ore, Pelts, Frostmint, Ice crystal (Frostveil), Reeds, Bog iron, Leeches (Drownfen), Songstone shard, Glass petals (Glasswood).
- **Rare:** Veyr alloy (ruins), Airship canvas and gears (Meridian), Star metal (meteor events), Heartsong fragments (shrines), Warden relics (bosses).

Resource nodes are placed deterministically per biome and respawn on in-game timers (trees 3 days, rock 2 days, plants 1 day, ore 4 days). Harvested state persists.

### 6.2 Crafting stations (tiers)

| Station | Unlocks | Built from |
| --- | --- | --- |
| Hands | Stone tools, torch, rope, bedroll, campfire | — |
| Campfire | Cooked meat/fish, roasted mushrooms, boiled water | Stone, wood |
| Workbench | Wood building pieces, bow, arrows, spear, chests, farm plot, tanning rack | Wood, rope, flint |
| Tanning rack | Leather, hide/fur armor, waterskin | Wood, rope, bone |
| Cooking pot | Stews, teas, remedies | Clay, stone, iron (upgrade) |
| Smelter / Forge | Iron & silver ingots, iron tools/weapons/armor, stone building tier | Stone, clay, iron ore |
| Loom | Cloth, Ashweave, Songweave | Wood, rope, iron |
| Resonance altar | Songsteel, songstone arrows, Veyr gear, Echo Lantern upgrades | Veyr alloy, songstone, silver |

Stations upgrade (e.g. Workbench II adds a vise: better tools); survivors at base unlock extra recipes.

### 6.3 Gear ladder (abridged)

- **Tools:** Stone axe/pick → Iron → Songsteel. Flint knife (skinning), torch, waterskin, **Echo Lantern** (unique, upgradable: reveal → attune → resonate), **climbing picks**, **Wingsail**, **Resonance Hook**, **rebreather**.
- **Weapons:** Club, flint spear (throwable), shortbow + flint arrows, iron sword, iron spear, longbow + iron arrows, obsidian warhammer, songsteel blade, songstone arrows (stagger), starforged blade.
- **Armor (head / body / cloak):** Hide → Fur (cold) / Ashweave (heat) → Iron → Songweave (all-weather, late). Veyr circlet (lantern range).
- **Consumables:** Cooked meat, grilled fish, berry mash, mushroom skewer, hearty stew, herbal tea (warm), frostmint tea (cool), salve (heal), antidote (miasma), stamina tonic.

---

## 7. Base building and farming

- **Snap-based pieces** on a 2 m grid with 45° rotation: foundation, floor, wall, doorway, window wall, door, roof (slope & flat), stairs, pillar, fence. **Tiers:** wood → stone → reinforced (iron-banded). Placement preview is green/red with the reason shown ("needs support", "blocked", "too steep").
- **Functional pieces:** storage chest (24 slots) / large chest (48), bed (respawn + sleep through night), campfire, all stations, **farm plot** (plant seeds; growth over in-game days; watered by rain or rain collector; Wren boosts yield), rain collector (fills flasks), lantern post (light; creatures avoid lit areas at night), drying rack (preserves meat), **camp beacon** (claims the base, lets survivors settle).
- **Survivors at base** need a bed; they follow daily routines (work at their station by day, sit by the fire at dusk, sleep at night) and provide services.

---

## 8. Combat

- **Melee:** light combo (3 hits), heavy (hold, charged), sprint attack, jump attack. Block with a shield or weapon (reduced damage, stamina cost). **Parry** window 0.18 s after raising the guard (unlocked via Corwin) staggers most creatures.
- **Ranged:** bow — hold to draw (0.8 s full draw), aim zooms the camera, arrows arc and can be recovered. Spears can be thrown.
- **Dodge roll** with i-frames. **Soft lock-on** (toggle) orbits the camera around the target.
- **Weak points:** every hostile has at least one — glowing songstone nodes, soft undersides, exposed joints, cracked shells. Weak-point hits deal ×2.5 and show a distinct spark + chime; some weak points break (permanent stagger/disarm).
- **Feel:** hitstop 40–90 ms on heavy hits, trauma-based camera shake, hit flash, knockback, pitch-varied impact audio, controller rumble. All of it respects Reduced Motion.

---

## 9. Creatures and ecosystems

Creatures live in **habitats** (herds graze meadows, wolves den in the forest, crabs patrol beaches), with population caps per region that slowly replenish. Nothing spawns in view of the player. Predators hunt prey — you will see Duskhounds chase a Sprigbuck.

| Creature | Biome | Temperament | AI notes | Weak point | Drops |
| --- | --- | --- | --- | --- | --- |
| Sprigbuck | Greensward, Hollowpine edge | Skittish, herds | Grazes, alarm call spreads to herd, flees | Neck | Meat, hide |
| Burrowhare | Greensward | Skittish | Zig-zag flee, dives into burrows | — | Meat, fur scrap |
| Thistleback boar | Greensward, Hollowpine | Neutral → aggressive | Charges with telegraph (scrape + snort) | Flank | Meat, hide, tusk |
| Duskhound | Hollowpine (snow variant in Frostveil) | Pack predator, nocturnal | Circles, flanks, alpha howl, retreats when alpha falls | Belly | Meat, pelt, fang |
| Glass stag | Glasswood | Rare, skittish | Blinks (short teleport) when threatened | Antler crystals | Songstone, glass petals |
| Hummer | Glasswood | Passive drifting | Floats; zaps when touched; drifts toward songstone | Core | Songstone dust |
| Shellback | Coast | Territorial | Sidesteps, claw guard, retreats into shell | Underside when flipped | Chitin, meat |
| Cinder beetle | Cinderreach | Aggressive | Spits embers (arc telegraph), armored | Back vent | Chitin, sulfur |
| Frost ram | Frostveil | Neutral | Headbutt charge on cliffs | Horns (break) | Meat, pelt, horn |
| Rime wraith | Frostveil (night/blizzard) | Hostile spirit | Phases in/out; lantern light makes it vulnerable | Heart shard | Ice crystal, echo dust |
| Bog lurker | Drownfen | Ambush predator | Hides submerged; bubbles telegraph | Eyes | Hide, bog iron |
| Veyr sentinel | Ruins everywhere | Guardian construct | Activates when ruins are disturbed; beam + slam | Core behind back plate | Veyr alloy, gears |
| Ambient life | Everywhere | — | Birds flock and scatter, butterflies, fireflies, fish, lantern-flies | — | Feathers, fish |
| **The Wanderer** | Roams a long loop | Peaceful colossus | Rare sighting; climbable; ruin shrine on its back | — | Heartsong, lore |

### Wardens (bosses)

Each Warden is a creature the Held Note bound to its Bellstone. Defeating one *frees* it rather than killing it.

1. **Mossback, the Antlered Mother** (Hollowpine) — colossal elk whose antlers grew into living trees. Antler sweeps, charge, stomp shockwaves, root spikes. Weak points: songstone nodes in the antlers (arrows stagger her). Freed, she lies down and becomes a flowering hill.
2. **Old Clapper, the Drowned Bell** (Coast sea cave) — a giant hermit crab wearing a sunken Veyr bell. Claw slams, bubble jets; retreats into the bell and rings a shockwave (jump it). Weak point: soft body when it emerges; heavy hits to the upturned bell stun it.
3. **The Forgewarden** (Cinderreach caldera) — a Veyr construct of stone and bronze with a molten core. Hammer slams, magma arcs, heat pulses (Ashweave needed). Weak points: vents that open after big attacks. Reward: **Resonance Hook**.
4. **Hoarfang, the Winter That Walks** (Frostglass Lake) — a huge ice wolf with a frost mane. Summons snow Duskhounds, blizzard phase, cracks the ice. Weak point: the songstone shard in its shoulder — pull it out when staggered.
5. **The Mire Choir** (Drownfen) — a mass of drowned bells and reeds that sings. Leech swarms, miasma clouds. Weak points: three singing "throats" around the arena to silence.
6. **Seren Vey, the Choirmaster** (the Crown) — three phases: harmonic projectiles among floating platforms; time-slow zones; the final "counter-song" where the player answers her notes with the Echo Lantern.

---

## 10. Exploration content

### 10.1 The Echo Lantern (signature tool)

- **Reveal** (start): lights the dark; reveals hidden glyphs, echo footprints and secret marks within its radius.
- **Attune** (after 2 bells): hold to see the past — echo bridges and doorways become solid while attuned (stamina drain).
- **Resonate** (after 4 bells): pulse that activates Veyr mechanisms at range and staggers Rime wraiths and sentinels.

### 10.2 Puzzle vocabulary

Each is taught, confirmed, then twisted across the world:
- **Tuning stones** — strike stones in the order shown by a nearby mural.
- **Prism beams** — rotate songstone prisms to carry a light beam to a receptor.
- **Echo bridges** — invisible paths that exist only while attuned.
- **Wisp chase** — follow an echo wisp through terrain to a hidden cache.
- **Sealed doors** — keyed to glyph words translated by Maudra.

### 10.3 Caves

Caves are **seamless**: the terrain has a hole at each authored cave mouth and the underground spaces are real geometry beneath the surface. Caves have their own lighting, reverb and loot; the deepest rooms hold Heartsong shrines or rare nodes.

### 10.4 Discovery system

Discovering a POI plays a short musical stinger, writes its name across the screen, reveals it on the map, logs it in the journal and grants a small XP-free reward (map reveal radius, recipe, lore). Undiscovered landmarks appear on the compass only once *seen* (line-of-sight check), which is how the world pulls you forward.

### 10.5 Rare world events

| Event | Trigger | What happens |
| --- | --- | --- |
| Resonance storm | Rare weather, more likely after each bell | Teal sky, singing wind, echoes everywhere, Chorus moths, songstone blooms |
| Meteor shower | Some clear nights | A fallen star lands visibly; star metal at the crater |
| The Wanderer | Periodic | The colossus crosses the plains; climbable |
| Time-slip | Near ruins, random | A patch of the world shows Hallowmere in its prime for ~20 s |
| Aurora | Clear nights, north | Green-violet curtains over the Frostveil |
| Eclipse | Very rare | Creatures agitated, echoes speak |
| Message in a bottle | Beach, random | A treasure map to a buried cache |

---

## 11. UI and UX

- **HUD** (fades when unneeded): vitals cluster bottom-left (health arc, stamina arc near the character when used, food/water/temperature icons that appear only when relevant), compass strip top-center with landmarks/quest/satchel markers, hotbar bottom-center, context prompt near center, notifications right, subtitles bottom.
- **Map:** hand-inked parchment generated from the real heightmap, fog of war revealed as you explore, discovered icons, custom pins, player arrow, biome names in calligraphy.
- **Journal:** Quests (main/side/tracked), Lore, Echoes, Bestiary, Survivors (affinity, likes), Discoveries.
- **Inventory/Crafting:** one screen with tabs — backpack grid, equipment, hotbar, crafting by category with station filter.
- **Build mode:** piece bar with tiers, material costs, placement feedback.
- **Menus:** Title (living world backdrop), pause, settings (graphics, audio, controls with rebinding, gamepad, accessibility, difficulty), save/load slots, death screen with cause.
- **Accessibility:** subtitles with speaker names and size options, UI scale, colorblind-safe palettes + filters, reduced motion (no shake/hitstop/head bob), hold/toggle options for sprint/crouch/aim, adjustable FOV and sensitivity, invert Y, high-contrast HUD, disable screen flashes.
- **Controller:** full gamepad support with button prompts that swap automatically.

Aesthetic: cartographer's brass and parchment meeting teal Veyr glyphs. Ink icons, fixed-width numerals, no generic stat cards.

---

## 12. Audio

All audio is **synthesized at runtime** with the Web Audio API (no audio files), which keeps the game small and gives each biome a tunable soundscape.

- **Ambience beds** per biome and time of day: wind layers, leaf rustle, birdsong (FM chirps), crickets and frogs at night, surf, river, lava hiss, cave drips with convolution reverb.
- **Weather:** rain (filtered noise + drop grains), thunder (layered noise with distance delay after the lightning flash), snow hush, blizzard howl, resonance-storm choir.
- **Music:** generative, modal and sparse — pads and bell/piano-like plucks in a biome mode (Greensward: Lydian, Hollowpine: Dorian, Cinderreach: Phrygian, Frostveil: Aeolian, Glasswood: whole-tone shimmer). Silence is part of the score. **Discovery stingers**, combat drums layer, Warden themes, a lullaby motif (Seren and Lio) that recurs.
- **SFX:** footsteps by surface (grass, stone, sand, snow, wood, water, mud), swings, impacts, bowstring, gathering (chop, mine, pick), crafting, UI.
- **Creatures:** synthesized calls per species (bleats, growls, howls, chitters, the Wardens' voices).
- 3D positional audio for world sources; buses: master, music, ambience, SFX, voice/UI.

---

## 13. Art direction — "Luminous Realism"

**Quality bar: the highest-fidelity realism a browser GPU can deliver.** The natural world is photographic and physically lit; the *only* unnatural element is the Veyr's teal songstone light. Realism comes from light and atmosphere first, then materials, then density — never from glow or fog standing in for missing detail.

- **Reference feelings (not copies):** Pacific-Northwest rainforest mist (Hollowpine), Scottish-highland meadows at golden hour (Greensward), Icelandic black beaches and basalt (Saltglass Coast, Cinderreach), Alpine ridgelines (Frostveil), bayou haze (Drownfen), megalithic temple ruins reclaimed by moss and roots (Veyr sites).
- **Signature color:** *songstone teal* (#5FF2D6) is reserved for the Veyr and the mystery — glyphs, anomalies, collectibles, Bellstones. Ember orange means danger. Warm amber means people and safety (lanterns, campfires, survivors).
- **Veyr architecture is acoustic:** spires shaped like tuning forks, halls like resonating chambers, arches like harp frames, bells everywhere. Weathered limestone with beveled, eroded edges, lichen and moss masks, root overgrowth and teal inlay channels.
- **Expedition relics** read as human and warm: canvas, brass, rope, riveted iron — contrast with the alien Veyr stone.
- **Characters** wear their world: the Surveyor's hood, goggles, scarf and simulated cloak make a readable silhouette from behind; survivors are defined by costume, hats and props at conversational distance.

### Rendering feature targets

| Area | Technique |
| --- | --- |
| Sky & atmosphere | Physically based Rayleigh/Mie/ozone scattering with transmittance, multi-scattering and sky-view LUTs (Hillaire 2020); matching aerial perspective on every surface; sun/moon discs, stars, aurora |
| Clouds | Raymarched volumetric clouds (Perlin-Worley 3D noise, weather map, dual-lobe phase, beer-powder) at reduced resolution with temporal accumulation; moving cloud shadows on the land |
| Light | Sun/moon with cascaded shadow maps, sky image-based lighting refreshed with time of day, screen-space ambient occlusion, god rays, eye adaptation, HDR bloom, AgX/ACES filmic tone mapping, per-biome grading |
| Terrain | 1 m heightfield shaped by hydraulic + thermal erosion; GPU-baked PBR layers (albedo/height/normal/roughness/AO) with height-based blending, triplanar cliffs, anti-tiling, macro variation, wetness/puddles/snow cover |
| Vegetation | Dense GPU grass with translucency and wind gusts, ground cover, procedurally grown trees with bark and translucent leaf cards, hierarchical wind, baked multi-view impostors for distance |
| Water | Gerstner-wave ocean, refraction and depth absorption from the scene buffers, Fresnel sky reflection, shoreline foam, caustics, flowing rivers and waterfalls with mist |
| Characters & creatures | Smooth SDF-modeled bodies meshed and auto-skinned to procedural skeletons, cloth-simulated cloaks, fur shells, chitin/crystal materials, procedural locomotion with foot placement |
| Anti-aliasing | MSAA on the HDR target with alpha-to-coverage for foliage; FXAA fallback on the Low preset |

- **Production reality:** everything is procedural or kit-based — geometry factories, GPU texture bakers, a shared material library — so a small team can extend it without an external asset pipeline, and swap hero assets for scanned/sculpted ones later through the same factory interfaces.

---

## 14. Technical design

- **Renderer:** Three.js `WebGLRenderer` (WebGL2) with a custom HDR pipeline: MSAA scene target with depth → resolved color/depth copies for water refraction → sky/cloud fill → transparent/water pass → SSAO, god rays, bloom, eye adaptation, grading, tone map. Custom GLSL for terrain, water, sky, clouds, grass and foliage; a shared atmosphere chunk is injected into every material. A `WebGPURenderer`/TSL port is a roadmap item once it can be verified headlessly with equal performance.
- **World generation:** deterministic from a fixed seed in a Web Worker: authored macro layout → noise → hydraulic and thermal erosion → rivers, lakes, pads, paths; outputs height, normal/AO, biome, mask and water-level fields as typed arrays; cached in IndexedDB by generator version.
- **Terrain:** CDLOD quadtree rendered as one instanced draw with per-vertex morphing (no cracks, no popping); per-pixel normals from a normal texture; cave-mouth holes via a mask.
- **Physics:** custom kinematic capsule controller against the exact heightfield plus primitive colliders (cylinders, spheres, Y-rotated boxes) in a spatial hash. Deterministic, cheap, feel-first.
- **Streaming:** 64 m cells populate vegetation, props, resource nodes and colliders within the view radius; instanced meshes per kit; LOD by distance; per-cell deterministic seeds so only deltas (harvested nodes, built pieces) persist.
- **Entities:** creatures and NPCs are pooled; AI runs at reduced rates beyond 60 m and freezes beyond 250 m (population simulated abstractly).
- **UI:** DOM overlay (crisp text, accessibility), canvas-rendered icons.
- **Save:** versioned JSON in localStorage with checksum, rolling backup slot and migrations; autosave on sleep, discovery, quest step, and every 5 minutes.
- **Test & debug:** `window.__THREE_GAME_DIAGNOSTICS__`, `window.__THREE_GAME_TEST_HOOKS__` (seed, setState, pause, reduced motion), `?debug` panel (teleport, time, weather, spawn, give item, god mode), Playwright smoke/visual/bot tests.

### Performance budget (desktop, worst active view)

Draw calls ≤ 300 · triangles ≤ 1.5M on Ultra / 750k on High · texture memory ≤ 256 MB · 3 shadow cascades at ≤ 2048 · DPR ≤ 2. The realism pipeline deliberately exceeds the generic "≤ 2 post passes" starting budget (documented trade-off): post passes are half/quarter resolution where possible and each is switchable per preset. Quality presets (Low/Medium/High/Ultra) scale render scale, MSAA, shadow cascades/resolution, cloud quality, SSAO, god rays, grass density, impostor distance and view distance; the game auto-selects a preset from a short startup benchmark.

---

## 15. Difficulty

| Setting | Needs decay | Enemy damage | Death penalty |
| --- | --- | --- | --- |
| **Explorer** | ×0.5, no starvation damage | ×0.5 | Keep everything |
| **Survivor** (default) | ×1 | ×1 | Satchel of carried items dropped |
| **Harsh** | ×1.5 | ×1.5 | Everything but equipped gear dropped |

---

## 16. Endgame and replay

Endings as in §4.3; post-game free roam in the resulting world. Completion tracking: map %, discoveries, bestiary, lore, echoes, Heartsongs. New Game+ (stretch): keep the map knowledge and cosmetic gear, harder Wardens.
