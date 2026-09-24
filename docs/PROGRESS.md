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
| `scripts/capture.mjs` | Scenic views for visual review (`--views`, `--quality`) |

`npm test` runs the unit tests (`tests/unit/`). They check story data,
quest logic, the inventory, save round trips, the seeded RNG, noise and
landmark caches.

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

### M2 Survival, gathering, crafting, building: 🟡

- Hunger, thirst, body temperature, wetness and stamina, each with soft
  penalties. A roof keeps off rain and wind, and a fire warms.
- Trees, rocks, ore, plants and fibre can be gathered and respawn.
- An item database, stacking inventory, hotbar and equipment slots.
- Crafting by hand and at stations: campfire, workbench, tanning rack,
  cooking pot and smelter.
- Tools, weapons and armour tiers.
- Structures: campfires, bedrolls (you wake there), chests, stations,
  lantern posts and rain collectors.
- ⬜ Farming: plots can be built, but seeds, growth and harvest are next.
- Timber building: foundations, walls, doorways, floors, roofs and stairs
  on a 3 m grid. Walls snap to edges, storeys are walkable, and pieces can
  be dismantled for a refund.
- Saves: versioned, autosaved every few minutes, when sleeping and when
  quitting, and resumed with Continue. Death follows the difficulty: Explorer keeps the pack, Survivor drops it where you fell,
  Harsh loses it.

### M3 Creatures and combat: 🟡

- ✅ Wildlife: grazing herds, hares, boars, crabs and duskhounds that hunt at
  night. Each has perception, flee and attack behaviour, weak points and
  drops.
- ✅ Melee with stamina, reach and weak points.
- 🟡 Bows can be crafted and arrows exist as items, but bows still strike
  at close range. Arrows in flight are next.
- ⬜ Dodge, block and parry, and lock-on. The inputs are reserved.

### M4 World content: 🟡

- ✅ Parchment map drawn from the heightmap, with fog of war and pins.
- ✅ Journal of quests, places and lore.
- ✅ Discovery: named places are learned when seen and stamped on the
  compass and map.
- 🟡 Landmarks: 25 set pieces, each with a cache that holds items and a
  journal page. Among them are the galleon, the lighthouse, the floating
  isle, the frozen titan, the monastery, the stilt village and the ziggurat.
  Built in `src/story/Landmarks.ts`.
- ⬜ Walkable cave interiors. Cave landmarks are entrances for now.
- 🟡 Puzzles: the Singing Stones (strike in order). Prisms and echo bridges
  are not built yet.

### M5 Story and survivors: 🟡

- ✅ Dialogue with subtitles, and survivors who move to the camp once
  found: Captain Varga, Tock, Dr. Okafor and Ilyr.
- ✅ Main quest: the crash, the stones, the Rim, the five bells and the
  Held Note.
- ⬜ Personal side stories for each survivor.

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

### M7 Weather and world events: 🟡

- ✅ Regional weather: clear, cloud, fog, rain, storms with lightning, snow
  and ashfall.
- ✅ Hazards: cold, heat, drowning and falls.
- ✅ Northern lights over the Frostveil.
- ⬜ Rare events: meteor showers, eclipses and time-slips.

### M8 Polish and release: 🟡

- ✅ Title screen with a camera tour, a difficulty choice and an intro.
- ✅ Settings: graphics presets, field of view, sensitivity, invert look,
  toggle sprint and crouch, reduced motion, colour-blind filters,
  interface scale, HUD opacity and subtitles.
- ✅ Full controller support, menus included.
- 🟡 Performance: presets are tuned by eye on SwiftShader and by budget.
  Frame times still need measuring on real Apple silicon.
- ⬜ Key rebinding.

## Next up

1. Farming: seeds, growth over days, watering and harvest.
2. Archery: drawing, arrows in flight, recovering arrows.
3. Caves you can walk into (Whispering Cave, Crystal Grotto, Ice Caves,
   Lava Tubes).
4. Dodge and block, lock-on for Warden fights.
5. Survivor side stories and a second puzzle type (prisms).
6. Visual polish: bark and forest edges, and denser grass near the camera
   on High and above.
7. Rare events and more curiosities between the landmarks.
