# STILLWILD: where things stand

This file tracks the live state of the roadmap (`docs/ROADMAP.md`). Each
item says what exists in the build and how it is checked. Legend:
✅ done and covered by a playtest · 🟡 playable, with more planned ·
⬜ not started.

## How it is checked

Browser playtests drive the real game in headless Chromium through
`window.__THREE_GAME_TEST_HOOKS__`. Each one prints PASS/FAIL per check and
saves screenshots under `artifacts/playtest/`. Start the dev server
(`npm run dev`) before running them.

| Script | What it covers |
| --- | --- |
| `scripts/playtest.mjs` | Movement: walk, sprint, jump, climb, mantle, swim, fall damage, stamina |
| `scripts/playtest-survival.mjs` | Gathering, crafting, felling, mining, placing a camp |
| `scripts/playtest-story.mjs` | Act I from the crash through the Singing Stones to the Rim |
| `scripts/playtest-building.mjs` | Snapping, walls, floors, stairs, roofs as shelter, dismantling, saves |
| `scripts/playtest-warden.mjs` | Mossback end to end: wake, charge, stomp, knots, calm, bell |
| `scripts/playtest-wardens.mjs` | All five Wardens: arena, attacks, weak points, calming, trophies |
| `scripts/capture-stillheart.mjs` | The Hush barrier, entering Hallowmere, the ending, resuming after it |
| `scripts/capture-title.mjs` | Title screen, new game, intro, wake-up, continue, quit to title |
| `scripts/capture-landmarks.mjs` | A picture of every landmark, a cache payout, a trap |
| `scripts/playtest-archery.mjs` | Drawing and loosing, arrows sticking and recovered, rooks shot for feathers, gulls in flight, a sprigbuck hunted, farm plots planted, watered, grown and harvested |
| `scripts/playtest-caves.mjs` | Walking into all four caves, the walls holding, chamber floors, darkness and a torch, the deep caches |
| `scripts/playtest-combat.mjs` | Dodging with invulnerability, blocking, parrying (the attacker reels), no guard from behind, lock-on |
| `scripts/playtest-sidestories.mjs` | Wren's field notes, Ilyr's four caves (in any order) and Tock's workshop, played through and paid out |
| `scripts/playtest-sky.mjs` | A meteor shower, a fallen star found and gathered, a Starglass Lantern made from it, an eclipse |
| `scripts/playtest-curiosities.mjs` | Curiosities spread over the island, one of each kind found once and rewarded |
| `scripts/playtest-sunwells.mjs` | The three Sunwells solved, doors sunk, sealed caches opened, each court walked, Tock's Burning Glass, the spyglass |
| `scripts/playtest-landmarks.mjs` | Solid set pieces: walls stop you, doors and arches let you through, the ziggurat stair, the stilt village steps and boardwalk, every cache reachable |
| `scripts/playtest-all.mjs` | Runs every script above, two at a time (`--gpu`, `--only`) |
| `scripts/capture.mjs` | Scenic views for visual review (`--views`, `--quality`) |

`npm test` runs the unit tests (`tests/unit/`). They check story data,
quest logic, the inventory, save round trips, the seeded RNG, noise,
landmark caches, farming growth, the combat rules, the Sunwell beams and
the solid-geometry columns (walls, stairs, doorways, plank walls, slopes)
(every well solvable, each harder than the last, one true path each).

## Milestones

### M0 Pre-production: ✅

- The design (`docs/GAME_DESIGN.md`) and this roadmap.
- Vite + TypeScript + Three.js scaffold. `npm run dev`, `build`,
  `typecheck` and `test` all work.

### M1 Playable core: ✅

- **World:** a deterministic 2048² island built in a worker and cached in
  IndexedDB. It has seven biomes, a crater, rivers, lakes, coast and cliffs,
  with hydraulic erosion. `GEN_VERSION` invalidates old caches.
- **Terrain:** CDLOD in one instanced draw, with 14 baked PBR rock and soil
  layers. Shading is height-blended, anti-tiled and biplanar on steep faces.
- **Water:** three tileable, spectrum-sampled wave cascades on the sea,
  and lakes and rivers with depth colour, foam and refraction. Frostglass Lake freezes over and can
  be walked on.
- **Sky:** physically based atmosphere, volumetric clouds, sun, moon phases
  and stars, and aerial perspective.
- **Lighting:** cascaded shadow maps, SSAO, bloom, god rays, eye
  adaptation, filmic tone mapping, colour grading and five quality presets
  (Low → Max).
- **Player:** a first-person controller that walks, sprints, crouches,
  jumps, climbs any steep face, mantles and swims. A viewmodel shows the
  held item.
- **Vegetation:** procedural trees per biome, impostors in the distance,
  instanced grass with wind, rocks and props with colliders.
- **Audio:** synthesized ambience per biome and time of day, footsteps per
  surface and adaptive music.
- **HUD:** compass with learned landmarks, vitals, prompts, notifications
  and discovery banners.

### M2 Survival, gathering, crafting, building: ✅

- Hunger, thirst, body temperature, wetness and stamina, each with soft
  penalties. A roof keeps off rain and wind, and a fire warms.
- Trees, rocks, ore, plants and fibre can be gathered and respawn.
- An item database, stacking inventory, hotbar and equipment slots.
- Crafting by hand and at stations: campfire, workbench, tanning rack,
  cooking pot and smelter.
- Tools, weapons and armour tiers.
- Structures: campfires, bedrolls (you wake there), chests, stations,
  lantern posts and rain collectors (which fill in the rain).
- Farming: six crops (flax, lanternberries, cap mushrooms, yarrow, moonmoss,
  frostmint) grow over in-game hours. They grow at full rate on wet soil and
  a fifth of it dry. Rain waters them unless a roof is over the plot, and so
  does a waterskin. Climate matters: frostmint thrives in the cold, mushrooms
  in the fen. Berries and herbs fruit again after picking.
- Timber building: foundations, walls, doorways, floors, roofs and stairs
  on a 3 m grid. Walls snap to edges, storeys are walkable, and pieces can
  be dismantled for a refund.
- Saves: versioned, autosaved every few minutes, when sleeping and when
  quitting, and resumed with Continue. Death follows the difficulty: Explorer keeps the pack, Survivor drops it where you fell,
  Harsh loses it.

### M3 Creatures and combat: ✅

- ✅ Wildlife: grazing herds, hares, boars, crabs and duskhounds that hunt at
  night. Each has perception, flee and attack behaviour, weak points and
  drops.
- ✅ Birds: rooks, gulls, herons and snowfinches flock by habitat. They
  wheel and glide, land to forage, flush when approached and call. A downed
  bird gives feathers (for fletching) and meat.
- ✅ Melee with stamina, reach and weak points.
- ✅ Archery: hold to draw (a longer draw hits harder and flies straighter;
  holding full draw costs stamina), release to loose. Arrows fly under
  gravity and stick in soil, bark, timber and hide, quivering. They can be
  pulled out again, and come back when a kill is butchered. Songstone arrows
  bite deeper into Warden knots.
- ✅ Defence: a dodge with a moment of invulnerability; a raised guard
  blocks blows from the front for stamina and breaks when stamina runs
  out; a guard raised just in time parries and staggers the attacker;
  lock-on keeps a target under the crosshair.

### M4 World content: ✅

- ✅ Parchment map drawn from the heightmap, with fog of war and pins.
- ✅ Journal of quests, places and lore.
- ✅ Discovery: named places are learned when seen and stamped on the
  compass and map.
- ✅ Landmarks: 25 set pieces, each with a cache that holds items and a
  journal page. Among them are the galleon, the lighthouse, the floating
  isle, the frozen titan, the monastery, the stilt village and the ziggurat.
  Built in `src/story/Landmarks.ts` from an architecture kit
  (`landmarkKit.ts`): voussoir arches, walls with real window openings,
  shingled roofs, a lofted ship hull and a sculpted colossal face. Stone
  and timber are textured in world space.
- ✅ Solid set pieces: every landmark and the story's set pieces (the
  wreck, the stones, the vault arch, the Bellstones) are built into
  columns of solid (`src/world/SolidField.ts`) from their own triangles.
  Walls, hulls and statues stop you; doorways and arches let you through;
  stairs, decks, terraces and boulder tops can be walked. The ziggurat has
  a grand stair to its shrine, the stilt village steps up out of the fen,
  arrows stop at walls and animals turn from them.
- ✅ Caves: the Whispering Cave, Crystal Grotto, Lava Tubes and Ice Caves
  open on their mounds' flanks, slope down under the rock and end in a
  chamber with the cache. It is dark underground: sun and sky light are cut
  off in every material, so a torch matters. Crystals and lava glow, ice
  hangs from the roof, water drips and echoes.
- ✅ Puzzles: the Singing Stones (strike in order) and the three
  **Sunwells**: the Dawnwell, Noonwell and Duskwell. In each, a lens
  throws sunlight across a paved court; turning crystal prisms carries the
  beam to the sun disc on a vault door, which sinks, and the light runs on
  into the vault. They need 4, 9 and 12 turns, and the beam only runs by
  day. (Planned next: echo bridges, wisp chases and glyph doors.)
- ✅ Curiosities: about seventy small finds between the named places, laid
  out from the world seed. Veyr cairns have a line carved into the
  capstone, lost expedition packs hold supplies, songstone shrines give a
  Heartsong fragment, and echo stones still hold a voice. Each is found
  once, and the journal keeps count.

### M5 Story and survivors: ✅

- ✅ Dialogue with subtitles, and survivors who move to the camp once
  found: Captain Varga, Tock, Dr. Okafor and Ilyr.
- ✅ Main quest: the crash, the stones, the Rim, the five bells and the
  Held Note.
- ✅ Side stories: Tock's workshop (a smelter and iron; he reforges a pick),
  Wren's field notes (a rook brought down with a bow, the Crystal Grotto's
  glow), Ilyr's *What the Rock Remembers* (listen in all four cave chambers,
  in any order; each chamber still says something), Varga's log, and
  Tock's *Burning Glass* (light the three Sunwells; he makes a spyglass
  that marks far places on the compass and map).

### M6 Wardens and endgame: ✅

- Five Wardens, each with its own body, voice, element and arena:
  - Mossback in Hollowpine
  - Tidemother on the coast
  - Emberjaw in the caldera
  - Rimebrow on Frostglass Lake
  - Old Croak in the Choir Mire
- Each fight has telegraphed charges, stomps and sweeps, a second phase
  with elemental strikes, and knots to break. The heart knot opens only
  while the Warden is winded.
- Wardens are calmed, never killed. A calmed Warden rests by its bell and
  leaves a trophy.
- The Stillheart: the Veil, the Hush barrier that thins with each bell, the
  city of Hallowmere with its towers, bridges and Crown rings, and an
  ending when the note is released. The game carries on afterwards.

### M7 Weather and world events: ✅

- ✅ Regional weather: clear, cloud, fog, rain, storms with lightning, snow
  and ashfall.
- ✅ Hazards: cold, heat, drowning and falls.
- ✅ Northern lights over the Frostveil.
- ✅ Meteor showers on about one night in five: streaks fan out from one
  radiant, busiest in the small hours. Each shower drops a star a few
  hundred metres away, marked by a pillar of light until dawn; its
  starmetal makes a Starglass Lantern.
- ✅ Eclipses: some afternoons the moon covers the sun for an hour. Light
  fails, stars come out and the corona shows round the dark disc.

### M8 Polish and release: 🟡

- ✅ Title screen with a camera tour, a difficulty choice and an intro.
- ✅ Settings: graphics presets, field of view, sensitivity, invert look,
  toggle sprint and crouch, reduced motion, colour-blind filters,
  interface scale, HUD opacity and subtitles.
- ✅ Full controller support, menus included.
- ✅ Survivors rebuilt as proper people (`src/story/figures/`): sculpted
  heads, baked skin, eyes that blink and look, clothes that hang, hands
  with fingers. First-person hands rebuilt as a gloved fist.
- ✅ Realism pass on the land: soil and gravel rebaked, litter and moss
  under forest canopy (and thinner grass), real-size leaves on branching
  twigs, mip-aware leaf coverage (distant spruces no longer go bare),
  finer folded grass blades, plated pine bark.
- 🟡 Performance: presets are tuned by eye and by budget. Frame times
  still need measuring on real Apple silicon.
- ⬜ Key rebinding.

## Next up

The full, ordered list is in `README.md` ("What we do next") and in
detail in `HANDOFF.md`. The first few:

1. Frame-time measurements on Apple silicon, presets tuned to them, and
   GPU timing in the diagnostics.
2. Visual polish: bark and forest edges, denser grass near the camera on
   High and above, and creature detail.
3. Key rebinding in Settings → Controls.
4. More puzzle types: echo bridges, wisp chases, sealed glyph doors.
