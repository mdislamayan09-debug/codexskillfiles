# STILLWILD

*A land that forgot how to end.*

An open-world survival adventure that runs in the browser. Your airship, the
Meridian, came down inside a wall of light on the sea. The island within has
been holding one note for a thousand years: nothing ages, nothing ends, and
five vast Wardens guard the bells that keep it that way.

Everything is made at runtime: terrain, forests, water, creatures, textures,
music and sound. There are no downloaded assets.

## Running it

Requirements: Node 20+ and a WebGL2 browser (Chrome, Edge, Safari 17+ or
Firefox).

```sh
npm install
npm run dev        # http://127.0.0.1:5188
```

For the best experience build once and serve the production bundle:

```sh
npm run build
npm run preview    # http://127.0.0.1:4188
```

The first launch generates the island (a few seconds) and caches it; later
launches start faster.

### Graphics on a Mac

Quality is chosen automatically from your GPU and can be changed any time in
**Settings → Graphics**: Low, Medium, High, Extra High and Max. On Apple
silicon, **High** is the default. An M4 Pro or Max handles **Extra High**
comfortably, and **Max** turns everything up: full-resolution volumetric
clouds, the longest view distance and the densest forests. Use Safari or
Chrome in full screen for the steadiest frame rate. Turn on
**Show frame rate** in the same tab to compare presets.

## Controls

| Action | Keyboard & mouse | Controller |
| --- | --- | --- |
| Move / look | W A S D / mouse | Left / right stick |
| Jump, climb hop | Space | A |
| Sprint | Shift | Left stick press |
| Crouch, let go of a wall | C | Right stick press |
| Interact, gather, talk | E (hold E to dismantle a built piece) | X |
| Use, attack, place | Left mouse | Right trigger |
| Draw a bow, loose | Hold left mouse, release (right mouse to take aim) | Hold right trigger, release (left trigger to aim) |
| Guard (raise it just in time to parry) | Hold right mouse with a weapon or tool | Hold left trigger |
| Dodge | Q or Left Alt | B |
| Lock on to a target | T or middle mouse | D-pad right |
| Hotbar | 1–8, mouse wheel | Bumpers |
| Inventory & crafting | Tab or I | Y |
| Map | M | Back / View |
| Journal | J | D-pad down |
| Rotate a piece being placed | R | |
| Pause & settings | Esc | Start / Menu |

Menus, the title screen and the inventory can be driven entirely with a
controller: the d-pad or left stick moves between buttons, A selects, B goes
back, and left/right adjusts sliders.

## What's in the island

- **Seven biomes and a crater** on a 2 km island: meadows, pine forest, glass
  forest, coast, volcanic ash, frozen peaks and marsh, around the Stillheart.
  Day and night, moon phases, volumetric clouds, regional weather (rain,
  storms, fog, snow, ashfall) and northern lights over the Frostveil.
- **Survival**: hunger, thirst, body temperature, wetness and stamina.
  Gather, hunt, cook, craft tools and weapons, and build.
- **Building**: campfires, beds, chests, stations, rain collectors, and timber
  foundations, walls, doorways, floors, roofs and stairs that snap to a grid.
  Floors and stairs are walkable; a roof keeps the rain off.
- **Farming**: plant flax seeds, lanternberries, mushrooms, yarrow, moonmoss
  or frostmint in a farm plot. Rain or a waterskin keeps them growing, and
  berries and herbs fruit again after picking.
- **Wildlife**: grazing herds, skittish hares, territorial boars, crabs on the
  beaches and duskhounds that hunt at night. Aim for weak points. Rooks,
  gulls, herons and snowfinches flock overhead and flush when you come near.
- **Combat**: swing tools and weapons, dodge through blows, block with a
  raised guard or parry with a well-timed one, and lock on to a target.
- **Archery**: draw a bow and let fly. Arrows drop with distance, stick where
  they land and can be pulled out again. Birds give the feathers to fletch
  more.
- **Caves**: walk into the Whispering Cave, the Crystal Grotto, the Lava Tubes
  and the Ice Caves. It is dark underground, so bring a torch, and something
  waits in each deep chamber.
- **The story**: find the crew, tune the Singing Stones, climb to the Rim, then
  seek the five Bellstones. Each is guarded by a Warden: Mossback in
  Hollowpine, Tidemother on the coast, Emberjaw in the caldera forge,
  Rimebrow on the frozen lake and Old Croak in the Choir Mire. Calm them,
  ring the bells, and walk down into Hallowmere.
- **Side stories**: help Tock set up a workshop, fill Wren's field notes and
  listen in the caves for Ilyr.
- **Sky events**: some nights bring meteor showers, and a fallen star to
  find before dawn. Some afternoons, an eclipse.
- **Discovery**: a parchment map with fog of war, a compass that learns
  landmarks as you see them, a journal of quests, places and lore, and
  caches to search at the island's named places. Between them, about
  seventy curiosities: carved cairns, lost packs, shrines and echo stones.
- **Difficulty**: Explorer keeps your pack when you fall, Survivor drops it
  where you fell, Harsh loses it.
- **Accessibility**: remappable sensitivity, invert look, toggle sprint and
  crouch, reduced motion, colour-blind filters, interface scale, HUD opacity,
  subtitles and full controller support.

## For developers

```sh
npm run typecheck           # TypeScript
npm test                    # unit tests (vitest)
node scripts/playtest.mjs   # browser playtests (see scripts/), dev server running
```

The browser playtests drive the real game through
`window.__THREE_GAME_TEST_HOOKS__` in a headless Chromium and write
screenshots to `artifacts/`. `docs/GAME_DESIGN.md` is the design,
`docs/ROADMAP.md` the plan, and `docs/PROGRESS.md` where things stand.
