# STILLWILD: everything in one file

*A land that forgot how to end.*

This document is the whole project in one place: the idea, what has been
built, how it fits together, how it is tested, the rules we work by, what is
unfinished, and what comes next. If you are picking the project up (a person,
or Claude Code in a terminal), read this first. `README.md` is the short
version: the game plan, where we are and what is next.

Last updated September 2026, after the terminal session that finished the
Sunwells and made the set pieces solid. Branch:
`claude/clever-hawking-4d1prc`.

---

## Contents

1. [Picking it up](#1-picking-it-up)
2. [The game](#2-the-game)
3. [What is built](#3-what-is-built)
4. [How it fits together](#4-how-it-fits-together)
5. [Every file](#5-every-file)
6. [Content catalogue](#6-content-catalogue)
7. [Testing](#7-testing)
8. [Rules we work by](#8-rules-we-work-by)
9. [History](#9-history)
10. [Unfinished work and known issues](#10-unfinished-work-and-known-issues)
11. [What comes next](#11-what-comes-next)
12. [Lessons learned](#12-lessons-learned)

---

## 1. Picking it up

### Get the code

```sh
git clone https://github.com/mdislamayan09-debug/codexskillfiles.git
cd codexskillfiles
git checkout claude/clever-hawking-4d1prc
npm install
npm run dev            # http://127.0.0.1:5188
```

Node 20 or newer (developed on Node 22). Any WebGL2 browser: Chrome, Edge,
Safari 17+ or Firefox. On a Mac, Chrome or Safari in full screen.

Production build, the fastest way to play:

```sh
npm run build          # typecheck + vite build into dist/
npm run preview        # http://127.0.0.1:4188
```

The first launch generates the island in a Web Worker (seconds on a fast
machine) and caches it in IndexedDB. Later launches are quicker.

### Check that everything works

```sh
npm run typecheck      # tsc, must be clean
npm test               # vitest unit tests (tests/unit), 73
node scripts/playtest.mjs            # a browser playtest; needs npm run dev running
node scripts/playtest-all.mjs        # every playtest, two at a time
```

Browser playtests drive the real game in headless Chromium (see
[Testing](#7-testing)). On a machine with a graphics card they render on
it; run `npx playwright install chromium` once if Playwright asks for its
browser. The cloud session used a pre-installed Chromium at
`/opt/pw-browsers/chromium` with software rendering (SwiftShader).

### The repository

- The game lives at the repository root: `src/`, `scripts/`, `tests/`,
  `docs/`, `index.html`, `package.json`.
- `client-finder-run/` is an unrelated research workspace from before the
  game. Never touch it.
- `.claude/skills/` holds Three.js game-development skills (graphics,
  gameplay systems, UI, audio, debugging, direction) that Claude Code can
  load. They were installed at the start and shaped much of the approach.
- `artifacts/` (ignored by git) is where playtests write screenshots and logs.
- `dist/` (ignored) is the production build.

---

## 2. The game

### Pitch

STILLWILD is a single-player, open-world survival adventure that runs in the
browser. You are the Surveyor, cartographer of the airship *Meridian*, which
came down inside a wall of light on the sea. The island within, the
Stillwild, has been holding one note for nine hundred years. Nothing ages,
nothing ends, and every expedition that ever blundered in is still here.
Five vast Wardens guard the five Bellstones that keep the note held. At the
centre, above a crater, floats the Crown.

Survive, map the land, find the crew, calm the Wardens, ring the bells, and
walk down into Hallowmere to let the note go.

### Design pillars (from `docs/GAME_DESIGN.md`)

1. **Curiosity is the engine.** Every minute or two of movement shows,
   sounds or turns up something that asks a question.
2. **A wilderness with memory.** Every place tells a story: the Veyr, an
   earlier expedition, or an ecosystem doing its thing.
3. **Survival is texture, not tax.** Needs create preparation and choices.
   They never interrupt play constantly or kill an attentive player.
4. **Earned mobility.** Progression is mostly new ways to move and places
   you can survive, not +3% damage.
5. **Small, dense, deliberate.** 2 × 2 km where nearly every hill hides
   something.

### Visual bar

"Luminous Realism": the natural world is photographic and physically lit;
the only unnatural thing is the teal light of the Veyr (songstone,
`#5FF2D6`). Ember orange means danger, warm amber means people and safety.
Everything is generated at runtime: terrain, forests, water, sky, creatures,
textures, music and sound. There are no downloaded assets and no API keys.

The owner plays on an **M4 MacBook** and asked for the highest visual
quality possible, with presets **Low, Medium, High, Extra High and Max**.

### Where the build differs from the design document

`docs/GAME_DESIGN.md` is the original, fuller vision. The build diverged in
a few deliberate ways:

- **First person, not third person.** The player is a first-person body with
  hands and held items (`src/player/Viewmodel.ts`).
- **Four survivors, not seven.** Varga, Tock, Wren (Dr. Wren Okafor) and
  Ilyr exist. Pell, Sister Maudra and Corwin are designed but not built.
- **The Wardens** were recast during building: Mossback, Tidemother,
  Emberjaw, Rimebrow and Old Croak, rather than the design's list. They are
  calmed, never killed.
- **One ending.** The note is released. The Sustain and Retune endings,
  Seren Vey's fight and affinity are not built.
- **Not yet built from the design:** the Wingsail glider, climbing picks and
  Resonance Hook; clothing and armour tiers beyond the basics; the loom and
  resonance altar; echo bridges, wisp chases and sealed glyph doors; the
  Wanderer, time-slips, resonance storms and bottles; the Expedition Board;
  stone and iron building tiers; key rebinding.

---

## 3. What is built

Status by milestone (the live list is `docs/PROGRESS.md`):

| Milestone | Status |
| --- | --- |
| M0 Pre-production: design, roadmap, scaffold | ✅ |
| M1 Playable core: world, rendering, movement, audio, HUD | ✅ |
| M2 Survival, gathering, crafting, building, farming, saves | ✅ |
| M3 Creatures and combat, archery, birds, defence | ✅ |
| M4 World content: landmarks, caves, curiosities, puzzles | ✅ (solid set pieces, three Sunwells; more puzzle types planned) |
| M5 Story and survivors | ✅ (four survivors, the main quest, seven side quests) |
| M6 Wardens and the Stillheart ending | ✅ |
| M7 Weather and sky events | ✅ |
| M8 Polish and release | 🟡 key rebinding and Apple-silicon frame timing left |

### The world

- A deterministic **2048 × 2048 m island** (1 m height samples) generated
  from `WORLD_SEED` in a Web Worker: an authored layout
  (`src/world/WorldLayout.ts`) decorated by noise, hydraulic erosion,
  terraces, rivers, lakes, coast, cliffs and sea stacks, a volcano with a
  caldera, and the central crater. Cached in IndexedDB by `GEN_VERSION`
  (currently **10**, since the Sunwell pads were added). Bump it whenever
  generation output changes.
- **Seven biomes and the Rim:** the Greensward (meadows, the crash),
  Hollowpine (dark pines, Mirror Lake), the Glasswood (crystal trees), the
  Saltglass Coast, the Cinderreach (volcanic ash), the Frostveil (snow
  peaks, frozen Frostglass Lake you can walk on) and the Drownfen (marsh),
  around the Rim and the Stillheart crater.
- **Water:** a spectrum-sampled ocean in three tileable wave cascades;
  lakes and rivers with depth colour, foam, refraction and flow; hot
  springs; a frozen lake with its own ice shader.
- **Trails** worn between landmarks, which players follow without being told.
- **The Veil,** a wall of light about 980 m out, bounds the island.

### Rendering

- A custom **HDR pipeline** on Three.js r186 (`WebGLRenderer`, WebGL2):
  MSAA scene pass, a second pass for water and transparents, SSAO, god
  rays, physically based bloom, eye adaptation, AgX tone mapping (ACES
  optional), colour grading and colour-blind filters.
- **Sky:** a physically based atmosphere after Hillaire 2020 (transmittance,
  multi-scattering, sky-view and aerial-perspective LUTs), sun and moon
  with phases, stars, northern lights, meteor streaks, an eclipse corona.
- **Volumetric clouds,** raymarched at reduced resolution with temporal
  reprojection and cloud shadows.
- **Lighting:** sun or moon with cascaded shadow maps, sky IBL. Every lit
  material is patched (`src/render/materials/MaterialPatches.ts`) so it
  shares the atmosphere, fog, cave darkness and shadowing.
- **Terrain:** CDLOD in one instanced draw with geomorphing; 14 GPU-baked
  PBR ground layers; height blending, anti-tiling, biplanar shading on
  steep faces; far-field shading; holes cut for caves. Bare soil is
  crumbly earth with a few half-buried stones and twigs, not a pavement
  of pebbles. A **canopy mask** (`VegetationSystem.paintCanopy`, the
  forest channel of mask B) is painted at boot from the same stand
  density that places the trees: the ground under a closed canopy turns
  to needle and leaf litter and moss, and the grass thins there.
- **Vegetation:** procedurally grown trees per biome (bark and leaf
  textures baked on the GPU), hierarchical wind, baked multi-view
  impostors for distant trees, dense instanced grass with translucency.
  Leaf cards carry leaves at their real size on branching twigs (about
  140 per card). Leaf alpha is boosted with the mip level so thin needle
  cards keep their coverage at a distance (without it, spruces beyond
  ~20 m went bare). Grass blades are narrow and folded along the midrib,
  so each half takes the light differently. Pine and spruce bark is
  irregular plates split by furrows that wander, pinch shut and flake.
- **Props:** procedural rocks and gatherables, streamed in cells.
- **Stonework:** dressed masonry and natural rock generated as canvas
  textures and applied in world space (triplanar), so long lintels and
  tall piers never stretch.
- **Five quality presets:** Low, Medium, High, Extra High and Max, picked
  from the GPU name (Apple M-series Max or Ultra → Max, Pro → Extra High,
  other M chips → High) and changeable in Settings → Graphics.

| Preset | Render scale, max DPR | MSAA | Shadow map, cascades, reach | SSAO, god rays | Cloud steps (buffer) | Grass density, radius | Trees to | Far plane |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 0.7, 1 | off | 1024, 2, 140 m | off, off | off | 0.35, 26 m | 420 m | 4.2 km |
| Medium | 0.85, 1.25 | off | 2048, 3, 220 m | on, off | 36 (1/16) | 0.65, 38 m | 650 m | 5.5 km |
| High | 1.0, 1.5 | 4× | 2048, 3, 320 m | on, on | 56 (1/16) | 1.0, 56 m | 900 m | 7 km |
| Extra High | 1.0, 2 | 4× | 4096, 4, 480 m | on, on | 72 (1/9) | 1.35, 70 m | 1200 m | 9 km |
| Max | 1.0, 3 | 4× | 4096, 4, 650 m | on, on | 96 (1/4) | 1.8, 85 m | 1600 m | 11 km |

(All values: `src/render/Quality.ts`.)

### The player

- First-person body over the heightfield (`src/player/PlayerController.ts`):
  walk, sprint, crouch, jump with coyote time, **climb any steep face**,
  mantle, swim, fall damage, stamina coupling, a dodge dash.
- Camera with head bob, landing dip, sprint FOV and reduced-motion support
  (`PlayerView.ts`). Hands and held items, torches that light the way,
  a bow rig and a guard pose (`Viewmodel.ts`). The hand is a gloved fist
  built in `hand.ts`: jointed fingers wrapped round the grip with the
  knuckles standing proud, the thumb over the index finger, baked leather
  and a wool sleeve with a knitted cuff.

### Survival, gathering, crafting, building, farming

- **Needs:** health, stamina, food, water, body temperature and wetness,
  each with soft penalties. A roof keeps off rain and wind, a fire warms.
- **Gathering:** fell trees, mine rock and ore, pick plants and fibre; all
  respawn on in-game timers and persist in saves.
- **Items:** 94 items (47 resources, 19 tools and weapons, 16 placeables,
  12 foods); **61 recipes** across hands, campfire, workbench, tanning
  rack, cooking pot and smelter.
- **Structures:** campfires, bedrolls (you wake there), chests, stations,
  lantern posts, rain collectors (fill in the rain), farm plots.
- **Timber building** on a 3 m snapping grid: foundations, walls,
  doorways, floors, roofs and stairs. Storeys are walkable, a roof counts
  as shelter, pieces can be dismantled for a refund.
- **Farming:** six crops (flax, lanternberries, cap mushrooms, yarrow,
  moonmoss, frostmint) grow over in-game hours. Full rate when wet, a fifth
  dry; rain waters them unless roofed, a waterskin works too. Climate
  matters. Berries and herbs fruit again after picking.
- **Saves:** versioned, autosaved every few minutes, on sleeping and on
  quitting; Continue on the title screen. **Difficulty:** Explorer keeps
  the pack on death, Survivor drops it where you fell, Harsh loses it.

### Creatures and combat

- **Wildlife** (`Wildlife.ts`, `CreatureModel.ts`): grazing sprigbuck
  herds, hares, boars, crabs and duskhounds that hunt at night; perception,
  flee and attack behaviour, weak points and drops; procedural bodies and
  locomotion.
- **Birds** (`Birds.ts`): rooks, gulls, herons and snowfinches flock by
  habitat, wheel, glide, land to forage, flush and call. Downed birds give
  feathers and meat.
- **Melee** with stamina, reach and weak points.
- **Archery** (`Archery.ts`): hold to draw, release to loose; arrows fly
  under gravity, stick in soil, bark, timber and hide, quiver, can be pulled
  out and come back from butchered kills. Songstone arrows bite deeper into
  Warden knots.
- **Defence** (`Combat.ts`): a dodge with invulnerability frames; a guard
  that blocks from the front for stamina; a parry window that staggers the
  attacker; lock-on.

### Story

- **Survivors** with dialogue and subtitles: Captain Ilse Varga, Tomas
  "Tock" Brennet (engineer), Dr. Wren Okafor (naturalist) and Ilyr (the
  Listener, an echo of the Veyr). They move to camp once found.
- **Survivors' bodies** (`src/story/figures/`, see `docs/CHARACTERS.md`):
  each is built from a written description (`Person` in `StoryData.ts`:
  sex, age, build, face, eyes, hair, beard, weather, coat). A sculpted
  head (nose, sockets, cheekbones, lips, ears), eyes with baked irises and
  blinking lids, skin painted on the face's own anatomy with a wrap-light
  scatter, hair and beards, and clothes lofted and hung like cloth over
  a body in proportion: coats with collars, pockets, buttons and belts,
  hands with jointed fingers, boots. They breathe, shift their weight,
  blink and turn to look at the player.
- **Main quest:** Waking → Shelter Before Dark → The Singing Stones (a
  tuning puzzle; the Echo Lantern) → What the Needle Knows (the Rim) → The
  Five Bells (one quest per Warden) → The Held Note (the Stillheart).
- **The Wardens** (`Warden.ts`, `WardenDefs.ts`): Mossback in Hollowpine,
  Tidemother on the coast, Emberjaw in the caldera forge, Rimebrow on
  Frostglass Lake and Old Croak in the Choir Mire. Each has its own body,
  voice, element and arena, telegraphed charges, stomps and sweeps, a
  second phase, and knots to break; the heart knot opens only while the
  Warden is winded. Calmed Wardens rest by their bell and leave a trophy.
- **The Stillheart** (`Stillheart.ts`): the Hush barrier thins with each
  bell; Hallowmere's towers, bridges and the Crown's rings; an ending when
  the note is released. The game carries on afterwards.
- **Side stories:** Rescue Tock (Knocking from Below), Rescue Wren (Up a
  Tree), The Captain's Log, A Proper Workshop (Tock: a smelter and iron),
  Field Notes (Wren: a rook shot with a bow, the Crystal Grotto),
  What the Rock Remembers (Ilyr: listen in all four caves, any order), and
  **Burning Glass** (Tock: light the three Sunwells; in progress, see §10).

### Places

- **Landmarks:** 25 set pieces (28 with the Sunwells), each with a cache and
  a journal page, all solid: walls stop you, stairs, decks and terraces
  can be walked (climb the ziggurat's grand stair to its shrine, or the
  stilt village's steps out of the fen) (`Landmarks.ts`, `LandmarkData.ts`, built from the
  architecture kit in `landmarkKit.ts`: voussoir arches, walls with window
  openings, gable roofs, stairs, a lofted ship hull, a sculpted colossal
  face). Among them: the Meridian wreck, the Singing Stones, the Old
  Aqueduct, Tock's vault, the galleon, the lighthouse (its beam sweeps the
  sea at night), the Sunken Face, the Old Persistence crawler, the
  monastery, the frozen titan, the floating isle, the stilt village, the
  ziggurat and the Hollow Elder (a giant oak grown by the vegetation
  system).
- **Caves** (`Caves.ts`): the Whispering Cave, Crystal Grotto, Lava Tubes
  and Ice Caves open in their hillsides and slope down to a chamber with
  the cache. Underground, sun, sky light and haze are cut off in every
  material, so it is dark until a torch comes out. Crystals and lava glow,
  ice hangs from the roof, water drips with reverb. Each chamber has a line
  for Ilyr's story.
- **Curiosities** (`Curiosities.ts`): 72 small finds laid out from the seed
  between landmarks: Veyr cairns with carved lines, lost expedition packs,
  songstone shrines that give a Heartsong fragment, echo stones that still
  hold a voice. Each is found once; the journal counts them.
- **Discovery:** landmarks seen from afar appear on the compass; walking up
  discovers them (banner, stinger, journal). A parchment map painted from
  the heightmap with fog of war and pins.

### Weather and sky

- Regional weather fronts: clear, cloud, fog, rain, storms with lightning,
  snow and ashfall, weighted per biome. Hazards: cold, heat, drowning, falls.
- Northern lights over the Frostveil.
- **Meteor showers** on about one night in five (from day 2): streaks fan
  out from a radiant, and a star falls a few hundred metres away, marked by
  a pillar of light until dawn. Its starmetal makes a **Starglass Lantern**.
- **Eclipses** (from day 3, rare): the moon covers the sun for about an
  hour; light fails, stars come out, the corona shows.

### Audio

Everything synthesized with the Web Audio API (`AudioEngine.ts`): ambience
per biome and time of day, weather, footsteps per surface, adaptive modal
music, discovery stingers, creature and Warden voices, bird calls, bow and
arrow sounds, cave drips and reverb, bells, and (with the Sunwells) prism
chimes and a door chord.

### Interface and settings

- HUD that fades unless it matters: compass with markers and distances,
  vitals, hotbar, prompts, notifications, discovery banners, quest tracker,
  lock-on marker, subtitles.
- Inventory and crafting on one screen; journal (quests, places, lore,
  curiosity count); map; title screen with a camera tour, difficulty
  choice and intro; pause menu with tabbed settings.
- **Settings:** graphics preset, field of view, sensitivity, invert look,
  toggle sprint and crouch, reduced motion, colour-blind filters, interface
  scale, HUD opacity, subtitles, volumes, show frame rate.
- **Full controller support,** menus included (`PadNavigator.ts`).

### Controls

| Action | Keyboard and mouse | Controller |
| --- | --- | --- |
| Move / look | W A S D / mouse | Left / right stick |
| Jump, climb hop | Space | A |
| Sprint | Shift | Left stick press |
| Crouch, let go of a wall | C | Right stick press |
| Interact, gather, talk | E (hold E to dismantle a built piece) | X |
| Use, attack, place | Left mouse | Right trigger |
| Draw a bow, loose | Hold left mouse, release (right mouse to take aim) | Hold right trigger, release |
| Guard (raise it just in time to parry) | Hold right mouse | Hold left trigger |
| Look through the spyglass | Hold right mouse | Hold left trigger |
| Dodge | Q or Left Alt | B |
| Lock on | T or middle mouse | D-pad right |
| Hotbar | 1–8, mouse wheel | Bumpers |
| Inventory and crafting | Tab or I | Y |
| Map | M | Back / View |
| Journal | J | D-pad down |
| Rotate a piece being placed | R | |
| Pause and settings | Esc | Start / Menu |

---

## 4. How it fits together

### Boot

`index.html` → `src/main.ts` shows a loading bar, creates `Game`
(`src/game/Game.ts`) and walks the boot stages: settings and quality,
renderer and pipeline, world generation (worker + IndexedDB cache via
`WorldLoader.ts`), then terrain, water, sky, vegetation, props, creatures,
story, landmarks, caves, curiosities, sky events and the Sunwells. Then the
title screen.

### `Game.ts`, the conductor

`Game.ts` (about 2,850 lines) owns every system and wires them with small
hook objects: each system takes an interface of callbacks
(`LandmarkHooks`, `SunwellHooks`, `ArcheryHooks` and so on) instead of
reaching into the game. Game also:

- runs each frame's update, roughly in this order: input → dialogue →
  defence and spyglass → player → caves → survival → gathering and the
  other systems → environment (sun, moon, weather, lighting) → story and
  places → render;
- owns discovery (`seen` and `discovered` sets), the compass markers, the
  death and respawn flow, sleeping, the save participants;
- exposes `window.game` and `window.__THREE_GAME_TEST_HOOKS__` for tests.

### Events

`src/core/Events.ts` is a typed publish/subscribe bus. Systems announce
facts (`itemAdded`, `crafted`, `discovered`, `notify`, `subtitle`,
`biomeChanged` and more); the quest tracker, HUD, audio and journal listen.

### Quests

`src/story/Quests.ts` is a state machine over `QUESTS` in `StoryData.ts`.
Steps are of kinds `discover`, `craft`, `place`, `collect`, `kill`, `flag`
and `talk`. Story flags (`quests.setFlag`) are the glue for everything
stateful in the world: `looted:<landmark>`, `heard:<cave>`,
`found:<curiosity>`, `lit:<sunwell>`, `spotted:<landmark>` and so on. They
save with the quests. Dialogue is keyed `npc:quest:step` or `npc:idle`.

### Rendering pipeline

`src/render/RenderPipeline.ts`: layer 0 is opaque and alpha-tested world
(MSAA), layer 1 (`LAYER_TRANSPARENT`) is water and transparents in a second
pass that can sample the resolved colour and depth. Then post passes
(`src/render/post/`). `MaterialPatches.ts` injects shared uniforms and GLSL
into every standard material: atmosphere and aerial perspective, height fog,
cloud shadows, cave darkness (`uCaveSpheres`, `atmoCaveDark`,
`atmoCaveInside`), and the eclipse. New materials must go through
`lighting.setupMaterial(material)` to join in.

### World data and physics

`WorldData.ts` answers exact queries: `heightAt`, `groundAt` (with ice),
`normalAt`, `slopeAt`, `waterLevelAt`, `waterDepthAt`, `dominantBiome`,
`isPath`, `raycast`. The player collides with the heightfield plus **circle
colliders** (vertical cylinders with base and height) gathered each frame
from vegetation, props, Wardens, building pieces, the Stillheart and the
Sunwells, and a `confine` hook for caves and for the **solid set pieces**
(`SolidField`: columns of solid spans built from the landmarks' and story
set pieces' own triangles; see §10). Built floors and set pieces' steps
and decks come in through `groundHeight` when the feet's height is given.

### Streaming and instancing

Vegetation and props stream in cells around the camera with per-cell
deterministic seeds; only harvested state persists. Trees are instanced
with impostors beyond a distance; grass is a GPU patch system.

### Saves

`src/game/SaveSystem.ts` composes saves from participants: each system
registers a key with `save()` and `load()`. The keys are `player`,
`clock`, `survival`, `inventory`, `discoveries`, `structures` (farm plots
included), `quests` (story flags included), `map`, `weather`, `harvest`,
`building`, `wardens`, `sky` and `meta`. Saves are versioned JSON in
localStorage.

### Randomness

All gameplay and world randomness goes through `src/core/rng.ts` (seeded
generators and hashes). `Math.random` is not used for gameplay.

---

## 5. Every file

Line counts at hand-off. 97 TypeScript files, about 37,000 lines in `src`.

### `src/core`

| File | Lines | What it does |
| --- | --- | --- |
| `Events.ts` | 68 | Typed publish/subscribe bus |
| `GameClock.ts` | 45 | In-game time; a day lasts a set number of real minutes |
| `Input.ts` | 373 | Device-agnostic actions over keyboard, mouse and gamepad bindings |
| `Settings.ts` | 122 | Player options, persisted per browser |
| `math.ts` | 113 | Allocation-free helpers: clamp, damp, smoothstep, angles |
| `noise.ts` | 131 | Seeded 2D simplex noise and fractal helpers |
| `rng.ts` | 80 | Seeded random generators and hashes: all randomness goes here |

### `src/world`

| File | Lines | What it does |
| --- | --- | --- |
| `WorldConfig.ts` | 133 | World constants, biomes, `GEN_VERSION`, `WORLD_SEED` |
| `WorldLayout.ts` | 719 | The authored skeleton: biome seeds, landmarks, rivers, lakes, trails, coast |
| `WorldData.ts` | 284 | Main-thread world queries and GPU textures |
| `WorldLoader.ts` | 87 | Worker generation and the IndexedDB cache |
| `gen/generateWorld.ts` | 1,095 | Deterministic generation: noise, erosion, pads, trails, masks, water |
| `gen/erosion.ts` | 180 | Particle hydraulic erosion |
| `gen/worldGen.worker.ts` | 44 | Worker entry |
| `terrain/TerrainRenderer.ts` | 244 | CDLOD terrain |
| `terrain/terrainShader.ts` | 424 | Terrain vertex morphing and layered shading |
| `vegetation/VegetationSystem.ts` | 794 | Tree streaming, colliders, clearings, the hero oak |
| `vegetation/TreeGenerator.ts` | 425 | Procedural tree species |
| `vegetation/GrassSystem.ts` | 379 | Instanced grass by biome and masks |
| `vegetation/ecology.ts` | 136 | Plant ecology shared with the generator |
| `props/PropSystem.ts` | 813 | Streams rocks and gatherables, harvest and regrowth |
| `props/PropGeometry.ts` | 347 | Small procedural props |
| `props/RockGenerator.ts` | 179 | Procedural rocks |
| `Caves.ts` | 677 | Walk-in caves: planning, tunnels, chambers, floors, confinement |
| `SkyEvents.ts` | 336 | Meteor showers, fallen stars, eclipses |
| `Weather.ts` | 296 | Regional weather fronts |
| `Celestial.ts` | 58 | Sun, moon and star positions and phases |
| `SolidField.ts` | ~420 | Solid set pieces: triangles laid into columns of spans; walls, floors, arrows |

### `src/render`

| File | Lines | What it does |
| --- | --- | --- |
| `RenderPipeline.ts` | 423 | HDR passes, layers, targets |
| `Quality.ts` | 198 | The five presets and GPU-based suggestion |
| `Lighting.ts` | 93 | Sun/moon light, cascaded shadows, material setup |
| `FullscreenPass.ts` | 75 | Full-screen triangle helper |
| `atmosphere/Atmosphere.ts`, `atmosphereGlsl.ts` | 214, 319 | Physically based sky LUTs |
| `clouds/VolumetricClouds.ts`, `cloudGlsl.ts` | 224, 291 | Raymarched clouds |
| `materials/MaterialPatches.ts` | 287 | Shared shader chunks injected into every material |
| `post/PostPasses.ts`, `compositeGlsl.ts` | 490, 182 | Bloom, SSAO, god rays, exposure, tone map, grade |
| `sky/SkyRenderer.ts`, `skyGlsl.ts` | 142, 239 | Sky, stars, aurora, corona |
| `terrain/TerrainMaterialBaker.ts`, `terrainLayers.ts` | 66, 465 | GPU-baked ground layers |
| `vegetation/Impostors.ts`, `foliageTextures.ts`, `treeMaterials.ts` | 294, 374, 234 | Tree impostors, bark and leaves, wind |
| `water/WaterSystem.ts`, `WaveCascades.ts`, `waterGlsl.ts`, `iceGlsl.ts` | 601, 253, 382, 65 | Ocean, lakes, rivers, ice |
| `props/propMaterials.ts`, `rockTexture.ts`, `stoneTextures.ts`, `woodTextures.ts` | 244, 120, 270, 186 | Rock, masonry and timber textures, triplanar helper |

### `src/player`

| File | Lines | What it does |
| --- | --- | --- |
| `PlayerController.ts` | 629 | Movement, climbing, swimming, colliders, the dodge dash |
| `PlayerView.ts` | 89 | The first-person camera |
| `Viewmodel.ts` | 495 | Hands, held items, bow rig, guard pose, torch light |
| `hand.ts` | 213 | The gloved fist and sleeve: jointed finger tubes round the grip |

### `src/game`

| File | Lines | What it does |
| --- | --- | --- |
| `Game.ts` | ~2,850 | Owns and wires every system; the update loop; test hooks |
| `items.ts` | 242 | Every item (data) |
| `recipes.ts` | 120 | Every recipe and station |
| `Inventory.ts` | 169 | Slots, hotbar, stacking |
| `Survival.ts` | 213 | Needs, temperature, wetness, damage |
| `Gathering.ts` | 371 | Aiming at things and using tools on them |
| `Structures.ts` | 598 | Placed structures, stations, farm plots |
| `Building.ts` | 950 | Timber building on a snapping grid |
| `Farming.ts` | 520 | Crops, growth, watering, harvest |
| `Archery.ts` | 554 | Bows, arrows in flight, sticking, recovery |
| `Combat.ts` | 122 | Dodge, guard, parry, lock-on rules |
| `SaveSystem.ts` | 116 | Save participants, versioning |
| `TitleCamera.ts` | 112 | Title-screen camera tour |
| `Viewpoints.ts` | 31 | Named viewpoints for captures |

### `src/creatures`

| File | Lines | What it does |
| --- | --- | --- |
| `Wildlife.ts` | 707 | Herds, hares, boars, crabs, duskhounds |
| `CreatureModel.ts` | 428 | Procedural creature bodies |
| `Birds.ts` | 960 | Flocks, flight, landing, flushing, shooting |
| `Warden.ts` | 1,257 | Warden bodies, fight logic, knots |
| `WardenDefs.ts` | 491 | The five Wardens' definitions |

### `src/story`

| File | Lines | What it does |
| --- | --- | --- |
| `StoryData.ts` | ~550 | Survivors, quests, dialogue, cave echoes |
| `Quests.ts` | 181 | Quest state machine and flags |
| `StoryWorld.ts` | 593 | Survivors in the world, the Singing Stones, Tock's vault, bells |
| `figures/HumanFigure.ts` | 1,011 | A survivor's body, clothes, kit and idle rig from their `Person` |
| `figures/head.ts` | 582 | The sculpted head: face depth, masks, eyes, lids, hair, beard |
| `figures/textures.ts` | 352 | Baked skin, iris, cloth, leather and hair textures |
| `figures/skinShading.ts` | 31 | Wrap-light scatter for skin |
| `Stillheart.ts` | 319 | The Veil, the Hush, Hallowmere and the Crown |
| `Landmarks.ts` | 951 | The set pieces, caches, lighthouse beam, lanternflies, traps |
| `LandmarkData.ts` | 199 | Cache contents, journal pages, cache spots |
| `landmarkKit.ts` | 274 | Architecture kit shapes |
| `Curiosities.ts` | 240 | The seventy-odd small finds |
| `sunwellLogic.ts` | 208 | Sunwell rules: beam tracing, solver, the three layouts |
| `Sunwells.ts` | ~680 | Sunwell courts: stonework, prisms, beam, door, colliders |

### `src/ui` and `src/styles`

| File | Lines | What it does |
| --- | --- | --- |
| `Hud.ts` | ~400 | Compass, vitals, hotbar, prompts, lock-on, spyglass scope |
| `InventoryScreen.ts` | 340 | Pack and crafting |
| `MapScreen.ts` | ~425 | The parchment map |
| `Menu.ts` | 330 | Pause menu and settings |
| `StoryUi.ts` | 264 | Dialogue box, journal, quest tracker |
| `TitleScreen.ts` | 206 | Title, new game, continue |
| `PadNavigator.ts` | 151 | Controller navigation for DOM screens |
| `icons.ts` | ~70 | Line icons as inline SVG |
| `styles/*.css` | ~2,450 | Base, HUD, inventory and menu styles |

### Other

`src/main.ts` (boot), `src/debug/FlyCamera.ts` (free camera for captures),
`src/audio/AudioEngine.ts` (all sound). In `scripts/`: `lib/browser.mjs`
(how every test starts Chromium: GPU, SwiftShader, profiles) and
`playtest-all.mjs` (the whole suite).

---

## 6. Content catalogue

### Landmarks

| Biome | Places |
| --- | --- |
| Greensward | Wreck of the Meridian, crash camp, Singing Stones, Whispering Cave, Old Aqueduct, Poppy Hill, Tock's vault, the Dawnwell |
| Hollowpine | Hollow Elder, Duskhound Den, Fungus Ring, Jonah Reed's cabin (trapper cabin), the Duskwell |
| Glasswood | Floating Isle, Echo Garden, Crystal Grotto, the Noonwell |
| Saltglass Coast | Galleon, Lighthouse, the Drowned Bell (Tidemother), Tide Pools |
| Cinderreach | Sunken Face, Old Persistence, Hot Springs, Lava Tubes, the Caldera Forge (Emberjaw) |
| Frostveil | Monastery, Frostglass (Rimebrow), Sled Camp, Ice Caves, Frozen Titan, Aurora Overlook |
| Drownfen | Stilt Village, Ziggurat, the Choir Mire (Old Croak), Lanternfly Hollow |
| Rim | Rim Lookout, the Stillheart |

Coordinates are in `WorldLayout.ts` (x east, z south, metres from the
crater). The crash camp is at (28, 604).

### Quests

Main: `waking`, `shelter`, `stones`, `needle`, `bells`, `grove_warden`,
`coast_warden`, `cinder_warden`, `frost_warden`, `fen_warden`, `held_note`.
Side: `rescue_tock`, `rescue_wren`, `captains_log`, `tocks_workshop`,
`burning_glass`, `field_notes`, `rock_remembers`.

### Survivors

| Id | Name | Role |
| --- | --- | --- |
| `varga` | Captain Ilse Varga | Captain of the Meridian; the main-quest voice at camp |
| `tock` | Tomas "Tock" Brennet | Chief engineer; workshop, reforged pick, spyglass |
| `wren` | Dr. Wren Okafor | Naturalist; field notes, iron arrows |
| `ilyr` | Ilyr | The Listener, an echo of the Veyr; the guide |

### Wardens

Mossback (Hollowpine, roots), Tidemother (coast, water), Emberjaw (caldera,
fire), Rimebrow (Frostglass Lake, ice), Old Croak (Choir Mire, mud).

### Crops

Flax (from seeds), lanternberries (berries), cap mushrooms, yarrow (herbs),
moonmoss, frostmint.

---

## 7. Testing

### Unit tests (`npm test`)

`tests/unit/`: `core` (math), `inventory`, `quests`, `saves`, `storyData`
(every quest, item, dialogue key, kill target and cave echo is real),
`landmarks` (caches and lore), `farming`, `combat`, `birds`, `sky`,
`curiosities`, `sunwells` (beam rules; every well unsolved at start,
solvable, harder than the last, with exactly one true path) and `solids`
(blocks, stairs, doorways, thin plank walls, slopes, pushing a body out of
a wall, arrows). 73 tests.

### Browser playtests (`scripts/`)

Start `npm run dev` first (or see "Testing while editing" below). Each
script prints PASS/FAIL per check and saves screenshots under
`artifacts/playtest/<name>/`. `--quality low` is the default.

**GPU or software.** The scripts start Chromium through
`scripts/lib/browser.mjs`: on a machine with a graphics card the game
renders on it (a full Sunwells run: 80–100 s); in the cloud, where
`/opt/pw-browsers/chromium` exists and there is no GPU, SwiftShader is
used (the same run: about 7 minutes). `--gpu` or `--swiftshader` forces
either. `--profile <dir>` keeps a browser profile, so the island stays
cached between runs (handy for captures).

**The whole suite:** `node scripts/playtest-all.mjs [--gpu]` runs every
script two at a time and prints one line each; logs go to
`artifacts/playtest/logs/`. `--only caves,sky` picks some.

**Testing while editing.** Vite reloads the page when a source file is
saved, which breaks a running test. To keep working, build once and point
the suite at the build: `npm run build`, `npm run preview`, then
`--url http://127.0.0.1:4188`.

| Script | Covers | Last result (GPU, September 2026) |
| --- | --- | --- |
| `playtest.mjs` | Walk, sprint, jump, climb, mantle, swim, fall damage, stamina | 9/9 |
| `playtest-survival.mjs` | Gathering, crafting, felling, mining, a camp | 13/13 |
| `playtest-creatures.mjs` | Wildlife, hunting, weak points | 4/4 |
| `playtest-story.mjs` | Act I end to end | 14/14 |
| `playtest-building.mjs` | A two-room cabin, roofs as shelter, dismantling, saves | 12/12 |
| `playtest-warden.mjs` | Mossback end to end | 14/14 |
| `playtest-wardens.mjs` | All five Wardens | 32/32 |
| `playtest-archery.mjs` | Bow, arrows, rooks, gulls, a hunt, farm plots | 18/18 |
| `playtest-caves.mjs` | All four caves, walls, floors, darkness and a torch | 18/18 |
| `playtest-combat.mjs` | Dodge, block, parry, lock-on | 8/8 |
| `playtest-sidestories.mjs` | Wren, Ilyr and Tock's workshop | 12/12 |
| `playtest-sky.mjs` | Meteor shower, fallen star, Starglass Lantern, eclipse | 8/8 |
| `playtest-curiosities.mjs` | Curiosities spread and rewarded | 6/6 |
| `playtest-sunwells.mjs` | Sunwells solved, vaults opened, the courts walked, Burning Glass, spyglass | 15/15 |
| `playtest-landmarks.mjs` | Solid set pieces: walls, doors, arches, the ziggurat stair, the stilt village, every cache reachable | 13/13 |
| `capture-landmarks.mjs` | A picture of every landmark, a cache, a trap | 4/4 |
| `capture-stillheart.mjs` | The Hush, Hallowmere, the ending | 6/6 |
| `capture-title.mjs` | Title flow, new game, continue | 9/9 |
| `capture-sunwells.mjs` | Each Sunwell found, lit, close up and open (`--quality high`) | pictures |
| `capture.mjs` | Scenic views (`--views`, `--quality`) | pictures |

Capture mode (`?capture=1`) turns CSS transitions off: time is stepped
frame by frame, and a fade would still be half-way when the screenshot is
taken.

### Test hooks

`window.__THREE_GAME_TEST_HOOKS__` (see the end of `Game.ts`) includes:
`setState`, `freeze`, `renderFrames(n, dt)`, `teleport(x, z, yaw)`,
`give`, `selectItem`, `aim(x, y, z)`, `act('interact'|'use'|'place')`,
`craft`, `quest`, `talk`, `useStory(id)`, `setTime`, `setWeather`,
`passHours`, `spawnCreature`, `creatures`, `warden(s)`, `shootBow`,
`arrows`, `birds`, `spawnBirds`, `defend`, `combat`, `strikePlayer`,
`caves`, `inCave`, `curiosities`, `sunwells`, `turnPrism`,
`raiseSpyglass`, `spyglass`, `skyEvent`, `sky`, `gatherStar`, `plots`,
`lookFrom`, `landmarks`, `probe`, `hideDebugUi` and more. `window.game` is
the live `Game` for anything else.

### How to write a playtest

Copy a short one (`playtest-curiosities.mjs`). The pattern: launch Chromium,
open `/?quality=low&capture=1`, wait for the hooks, `freeze(true)`, drive
with hooks, advance time with `renderFrames`, check state, screenshot with
`hideDebugUi` first. Filter "Failed to load resource" console noise.

---

## 8. Rules we work by

- **Everything procedural.** No downloaded models, textures or sounds; no
  API keys. Generate geometry, bake textures on the GPU or a canvas,
  synthesize sound.
- **Seeded randomness only.** Use `createRng`/`hash*` from
  `src/core/rng.ts`; never `Math.random` in gameplay or generation.
- **Bump `GEN_VERSION`** in `WorldConfig.ts` whenever world generation
  output changes (layout, pads, trails, noise), or players keep a stale
  cached island.
- **New materials** go through `lighting.setupMaterial()` so atmosphere,
  shadows and cave darkness apply. Transparent additive effects go on
  `LAYER_TRANSPARENT`.
- **State that must persist** goes in a save participant or a quest flag.
- **Match the surrounding code:** comment density, naming, idiom. Comments
  explain why and what the player sees, in plain words.
- **Keep docs in step:** `README.md`, `docs/PROGRESS.md` and this file when
  features land; `docs/GAME_DESIGN.md` when the design changes.
- **Verify before committing:** `npm run typecheck`, `npm test`, and the
  playtest that covers what you touched.
- **Git:** work on `claude/clever-hawking-4d1prc` (or a branch from it),
  commit with clear messages, push when done. Do not open pull requests
  unless the owner asks.
- **Leave `client-finder-run/` alone.**

---

## 9. History

| Commit | Date | What landed |
| --- | --- | --- |
| `119679d` | 2026-09-23 | Design docs, world generator, physically based renderer foundation |
| `5303a57` | 2026-09-24 | Volumetric clouds, five quality presets, procedural forests |
| `04c3078` | 2026-09-24 | Ocean cascades, lakes, rivers, ice; shadow and fog fixes |
| `c4336b2` | 2026-09-24 | First-person movement, survival stats, HUD, pause menu |
| `a8aeb63` | 2026-09-24 | Rocks and gatherable props groundwork |
| `4ed1b0f` | 2026-09-24 | Gathering, crafting and camps: the survival loop |
| `d3e4ad2` | 2026-09-24 | Wildlife, hunting and the synthesized soundscape |
| `931ec5c` | 2026-09-24 | Story Act I, survivors, weather, map and journal |
| `2d03123` | 2026-09-24 | Title screen, the first Warden, timber building |
| `e1b83b7` | 2026-09-24 | Five Wardens, the Stillheart ending, controller menus, unit tests |
| `f4365c0` | 2026-09-24 | Caves, archery, birds, farming, defence, sky events, side stories, landmark rebuild, curiosities |
| `cb58682` | 2026-09-24 | Steadier side-story and sky playtests |
| `88dc627` | 2026-09-24 | Sunwells, Burning Glass, spyglass; this file, README plan, CLAUDE.md |
| `b365e77` | 2026-09-24 | Sunwells finished (the beam, flagstones), GPU playtests, the suite runner |
| (this session) | 2026-09-24 | Solid set pieces: `SolidField`, the ziggurat stair, the stilt village steps, every cache reachable |

Earlier commits in the repository (`3a0df7e`, `5ec6464`, `8fd3fed`) belong to
`client-finder-run/` and have nothing to do with the game.

---

## 10. Unfinished work and known issues

### The Sunwells (finished)

Three Veyr sun-courts: **the Dawnwell** (Greensward, 338, 728), **the
Noonwell** (Glasswood, 394, 14) and **the Duskwell** (Hollowpine edge,
−338, 186). In each, a lens throws a beam of sunlight across a 5 × 5 grid
of flagstones; crystal prisms on bronze turntables send the beam out of
the side they face (turn one a quarter with E); pillars stop it. When the
beam reaches the bronze sun on the vault door, the door sinks, the light
runs on into the vault and rests on its back wall, and the sealed cache
(a Heartsong and more) can be searched. The beam only runs while the sun
is up. The wells need 4, 9 and 12 turns and each has a single true path
(`tests/unit/sunwells.test.ts`). Lighting all three completes Tock's
**Burning Glass**, which pays out the **Veyr Spyglass** (about 4× zoom, a
steadier hand; a named place held in its sights is marked on the compass
and map with flag `spotted:<id>`).

The look: the beam is a hot core inside a sheath of lit air (one shader
on a wide cylinder; brightness comes from how far across the beam a pixel
looks, measured square to the beam's axis so it holds up seen at a slant),
flares at the lens, each lit prism and where the light lands, and dust
drifting in the light. The paving uses a jointless flagstone texture
(`stoneTextures.ts`, `slab`) tiled at 4.3 m so no two slabs match; moss
grows in low cushions against the walls and pillars.

`scripts/playtest-sunwells.mjs` (15 checks) solves all three, opens the
vaults, pays out the spyglass, and walks each court: in through both open
sides and from in front of each door into its vault.
`scripts/capture-sunwells.mjs` pictures each court found, lit, close up
and open.

### Solid set pieces (finished)

Landmarks and the story's set pieces (the Meridian wreck and camp, the
Singing Stones, Tock's vault arch, the tail, the lookout, the Bellstones)
are solid. `src/world/SolidField.ts` lays the same triangles the scene
draws into 10 cm columns; each column keeps the heights where solid
begins and ends and which way each top faces. A span rising more than a
step above the feet is a wall (the player is pushed back along it);
a top within a step is floor. So walls, hulls and statues stop you,
doorways and arches let you through, stairs, decks and terraces can be
walked, boulders stood on, and steep faces slide you off as terrain does.
Arrows stop at walls, and animals turn away from them.

- `Landmarks` feeds each part to the field before merging (flowers, lamps
  and anything smaller than 30 cm are left out, and so is the floating
  isle, which drifts). `Game` then adds the story's set pieces
  (`SolidField.addObject`, which skips subtrees marked
  `userData.moving`: the survivors, the Echo Lantern, Tock's vault door)
  and packs the field. Tock's door is a wall of its own until the vault
  opens (`StoryWorld.collidersNear`), like the Sunwell doors.
- Built at boot in about 1.5 s on this machine (`timings.landmarksMs`
  in the diagnostics), ~510,000 spans.
- Changes made so every place stays reachable: the ziggurat has one grand
  stair from the fen to the shrine (the old per-terrace stairs overlapped
  into 1.5 m walls) and its cache now waits in the shrine; the stilt
  village's huts have a metre of deck outside their walls and steep plank
  steps from the fen floor to the first hut (the old ladder could not be
  climbed), and its cache sits on that hut's floor instead of the fen bed;
  Jonah Reed's doorway is tall enough to walk through; the Aurora
  Overlook's platform is one step high with its cache on top; the Frozen
  Titan's cache is outside the glacier; the Floating Isle's fallen rubble
  no longer drifts with the isle.
- `scripts/playtest-landmarks.mjs` (13 checks) walks into walls, through
  the cabin door and the aqueduct, up the ziggurat and the stilt village,
  along a boardwalk, and up to every landmark cache.

### Known issues and gaps

- **Frame times on Apple silicon are unmeasured.** Presets were tuned by
  eye and budget. Measure on the M4 (Settings → Show frame rate) and
  adjust `Quality.ts`.
- **Key rebinding** is not built (bindings are data in `Input.ts`).
- The player cannot climb landmark walls (climbing reads the terrain
  only), and wildlife only turns away from walls rather than steering
  round them.
- `docs/GAME_DESIGN.md` still describes a third-person game and seven
  survivors; see §2 for how the build differs.

---

## 11. What comes next

In priority order. Each item should end playable, tested and documented.
(The Sunwells and solid set pieces, items 1 and 2 at the last hand-off,
are done; see §10.)

1. **Performance on the M4:** measure each preset, set Max and Extra High
   to hold 60 fps where possible, and add GPU timing to the diagnostics
   (`EXT_disjoint_timer_query_webgl2` is available in Chrome).
2. **Visual polish for "AAA":** bark and forest edges, denser grass near
   the camera on High and above, creature detail (fur shells, better
   silhouettes), wet surfaces in rain, better cave light.
3. **Key rebinding** in Settings → Controls, with controller prompts.
4. **More puzzle types:** echo bridges (visible only through the Echo
   Lantern), wisp chases, sealed glyph doors.
5. **The remaining survivors** from the design: Pell (stilt village),
   Sister Maudra (monastery), Corwin (galleon), with quests and camp
   services; affinity. The stilt village and ziggurat can now be walked,
   so Pell's home is ready for him.
6. **Traversal gear:** the Wingsail glider (updrafts from vents and cliffs),
   climbing picks (and climbing set-piece walls, which today only reads
   the terrain), the Resonance Hook.
7. **Endings:** Seren Vey at the Crown, and the Sustain and Retune endings.
8. **More world events:** the Wanderer colossus, time-slips, resonance
   storms, messages in bottles.
9. **Building tiers** (stone, reinforced) and clothing and armour tiers
   (fur for cold, ashweave for heat).
10. **Release:** a production build hosted as a static site.

---

## 12. Lessons learned

- **Vite reloads the page when an imported source file changes.** Editing
  `src/` while a playtest runs breaks the test. Edit scripts, docs and
  tests freely; wait for playtests before touching game code.
- **Each Playwright launch is a fresh browser profile,** so the world
  regenerates (no IndexedDB cache). Budget a couple of minutes per test on
  software rendering.
- **Run at most two playtests at once** on a four-core machine.
- **Shoot and place on level ground in tests:** find a flat, open spot
  (low `slopeAt`, few colliders) before aiming, and confirm the result
  (bird down, bench placed) before checking the quest.
- **Arrows drop:** full-draw shortbow arrows leave at about 47 m/s under
  7.2 m/s² gravity; hold over by `0.5 * 7.2 * (range / 47.2)²`.
- **Caves:** probe the floor at the player's height, not the terrain;
  darkness must reach well past the cave radius or sunlight leaks onto
  walls.
- **Never `pkill -f` a pattern that matches your own shell command.**
- **Keep browser profiles and other test output under `artifacts/`.** The
  dev server's file watcher ignores that folder; a Chromium profile
  anywhere else in the project crashes the watcher on Windows (`EBUSY`).
- **A waypoint walker must brake.** The player keeps about 0.4 m of
  momentum at walking speed, so a test that runs up to a mark and turns
  goes over ledges a careful player would not. Step in short moves near
  the mark and stop before turning (see `follow` in
  `playtest-landmarks.mjs`).
- **Solid geometry changes what is reachable.** When a set piece becomes
  solid, walk to its cache (the landmarks playtest does, for all of
  them): several caches were inside walls, stairs or ice and nobody had
  noticed while everything was walk-through.
- The pale lattice seen on the north-west skyline from the Dawnwell is the
  Crown over the Stillheart, not a stray impostor.
- **The ocean and sky are the most expensive passes;** Max doubles cloud
  resolution and view distance, which is where an M4 base model may need
  Extra High instead.
