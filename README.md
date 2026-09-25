# STILLWILD

*A land that forgot how to end.*

An open-world survival adventure that runs in the browser. Your airship, the
Meridian, came down inside a wall of light on the sea. The island within has
been holding one note for nine hundred years: nothing ages, nothing ends, and
five vast Wardens guard the bells that keep it that way.

Everything is made at runtime: terrain, forests, water, sky, creatures,
textures, music and sound. There are no downloaded assets.

> **Picking the project up?** Read [`HANDOFF.md`](HANDOFF.md). It has
> everything in one file: what is built, how it fits together, every file,
> how it is tested, the rules, and the next steps in detail.

---

## The game plan

**The goal:** the most beautiful, most curious open world we can make in a
browser, at the highest realistic visual quality an M4 MacBook can run,
with graphics presets from Low to Max.

**The pillars** (from [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)):

1. **Curiosity is the engine.** Every minute or two of walking shows,
   sounds or turns up something that asks a question.
2. **A wilderness with memory.** Every place tells a story.
3. **Survival is texture, not tax.** Needs create choices, never chores.
4. **Earned mobility.** Progress means new ways to move and new places to
   survive.
5. **Small, dense, deliberate.** Two kilometres square, and nearly every
   hill hides something.

**How we build it:** milestone by milestone, so the game is playable and
polished at the end of each one (plan: [`docs/ROADMAP.md`](docs/ROADMAP.md)).
Every system is procedural, every random choice is seeded, and every feature
lands with a test that drives the real game in a browser.

| Milestone | What it means | Status |
| --- | --- | --- |
| M0 Pre-production | Design, roadmap, project scaffold | ✅ Done |
| M1 Playable core | The island, rendering, movement, sound, HUD | ✅ Done |
| M2 Survival and building | Needs, gathering, crafting, building, farming, saves | ✅ Done |
| M3 Creatures and combat | Wildlife, birds, melee, archery, dodge, guard, parry | ✅ Done |
| M4 World content | Landmarks, caves, curiosities, puzzles | ✅ Done (more puzzle types planned) |
| M5 Story and survivors | Survivors, main quest, side stories | ✅ Done (four of the seven survivors designed) |
| M6 Wardens and endgame | Five Wardens, the Stillheart, the ending | ✅ Done (one of three endings) |
| M7 Weather and world events | Weather, hazards, meteor showers, eclipses | ✅ Done |
| M8 Polish and release | Settings, accessibility, performance, release | 🟡 Key rebinding and M4 frame timing left |

---

## Where we are now

The whole game is playable from the crash to the ending, and the island is
full of things to find.

- **The island:** a 2 km island with seven biomes around a crater, built
  from a seed with erosion, rivers, lakes, coast and a volcano. Day and
  night, moon phases, volumetric clouds, regional weather (rain, storms,
  fog, snow, ash) and northern lights.
- **The look:** physically based sky and atmosphere, cascaded shadows,
  ambient occlusion, god rays, bloom, filmic tone mapping, a real ocean,
  procedural forests and dense grass. Five presets: **Low, Medium, High,
  Extra High and Max**.
- **Survival:** hunger, thirst, body temperature, wetness and stamina.
  Gather, hunt, cook, craft (94 items, 61 recipes) and build timber houses
  on a grid. Six crops to farm.
- **Creatures and combat:** herds, hares, boars, crabs and night-hunting
  duskhounds; flocks of birds. Melee with weak points, a bow whose arrows
  fly, stick and can be recovered, a dodge, a guard, a parry and lock-on.
- **The story:** find the crew (Captain Varga, Tock, Wren and Ilyr), tune
  the Singing Stones, climb to the Rim, calm the five Wardens (Mossback,
  Tidemother, Emberjaw, Rimebrow, Old Croak), ring the bells and walk down
  into Hallowmere to release the note. Seven side quests. The survivors
  are proper people built from a description: sculpted faces, eyes that
  blink and follow you, skin, hair and clothes that hang like cloth
  (`docs/CHARACTERS.md`).
- **Places:** 28 landmarks with caches and journal pages, four caves you
  walk into (dark without a torch), and about seventy curiosities between
  them: carved cairns, lost packs, shrines and echo stones. The set pieces
  are solid: walls stop you, and you can climb the ziggurat's grand stair
  to its shrine, walk the stilt village's boardwalks above the fen, step
  under the aqueduct's arches and into Jonah Reed's cabin.
- **Sky events:** meteor showers with a fallen star to find (its metal makes
  a Starglass Lantern), and eclipses.
- **Light puzzles:** the three **Sunwells**, where you turn crystal prisms
  to carry a beam of sunlight across a paved court to a vault door, and
  Tock's side story *Burning Glass*, which rewards a **spyglass** that
  marks far places on your map.
- **Interface:** compass, map with fog of war, journal, inventory and
  crafting, title screen, full settings, subtitles, colour-blind filters,
  reduced motion, and full controller support.

**Tests:** 79 unit tests and 18 browser playtests and captures, all passing on a real GPU (`node scripts/playtest-all.mjs --gpu`). Typecheck is clean.

**Known gaps:** frame rates have not been measured on a real M4, key
rebinding is missing, and some of the design (three more survivors, the
glider, two more endings) is not built yet.

---

## What we do next

In order:

1. **Performance on the M4.** Measure each preset, make Extra High and Max
   hold 60 fps where possible, add GPU timing to the diagnostics.
2. **Visual polish.** Bark and forest edges, denser grass close up on High
   and above, creature detail, wet surfaces in rain, better cave lighting.
3. **Key rebinding** in Settings → Controls.
4. **More puzzles:** echo bridges seen only through the Echo Lantern, wisp
   chases, sealed glyph doors.
5. **Three more survivors:** Pell, Sister Maudra and Corwin, with their
   quests and what they do at camp.
6. **Traversal gear:** the Wingsail glider, climbing picks, the Resonance
   Hook.
7. **The full ending:** Seren Vey at the Crown, and the Sustain and Retune
   endings.
8. **More world events:** the Wanderer colossus, time-slips, resonance
   storms.
9. **Tiers:** stone and reinforced building, fur and ashweave clothing.
10. **Release:** host the production build as a website.

---

## Running it

Requirements: Node 20+ and a WebGL2 browser (Chrome, Edge, Safari 17+ or
Firefox).

```sh
npm install
npm run dev        # http://127.0.0.1:5188
```

For the best experience, build once and serve the production bundle:

```sh
npm run build
npm run preview    # http://127.0.0.1:4188
```

The first launch generates the island and caches it; later launches start
faster.

### Graphics

Quality is chosen from your GPU and can be changed any time in
**Settings → Graphics**: Low, Medium, High, Extra High and Max. On Apple
silicon, **High** is the default; an M4 Pro gets **Extra High** and an M4
Max gets **Max**, which turns everything up: finer volumetric clouds, the
longest view distance and the densest forests. Use Chrome or Safari in full
screen, and turn on **Show frame rate** in the same tab to compare presets.

Every preset renders with temporal anti-aliasing that rebuilds the image
at your display's full resolution, and **dynamic resolution** (on by
default, target 60 fps; choose 30 on a laptop) lowers the scene's
resolution only when frames run long. On integrated graphics (Intel Iris
Xe and the like) the presets keep their effects but fit their geometry to
the chip: Max holds about 30 fps at 1080p on an Iris Xe laptop with the
target at 30. The production build (`npm run build`, then `npm run
preview`) is noticeably faster than the dev server.

## Controls

| Action | Keyboard & mouse | Controller |
| --- | --- | --- |
| Move / look | W A S D / mouse | Left / right stick |
| Jump, climb hop | Space | A |
| Sprint | Shift | Left stick press |
| Crouch, let go of a wall | C | Right stick press |
| Interact, gather, talk, turn a prism | E (hold E to dismantle a built piece) | X |
| Use, attack, place | Left mouse | Right trigger |
| Draw a bow, loose | Hold left mouse, release (right mouse to take aim) | Hold right trigger, release (left trigger to aim) |
| Guard (raise it just in time to parry) | Hold right mouse with a weapon or tool | Hold left trigger |
| Look through the spyglass | Hold right mouse | Hold left trigger |
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

## For developers

```sh
npm run typecheck                      # TypeScript
npm test                               # unit tests (vitest)
node scripts/playtest-sunwells.mjs     # a browser playtest; needs npm run dev
node scripts/playtest-all.mjs          # every playtest, two at a time
```

The browser playtests in `scripts/` drive the real game through
`window.__THREE_GAME_TEST_HOOKS__` in headless Chromium and write
screenshots to `artifacts/playtest/`. They render on your graphics card
when there is one (`--swiftshader` forces software rendering).

| Document | What it is |
| --- | --- |
| [`HANDOFF.md`](HANDOFF.md) | Everything about the project in one file |
| [`CLAUDE.md`](CLAUDE.md) | Working notes for Claude Code sessions |
| [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) | The full design |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | The milestone plan |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Status of every roadmap item and how it is tested |
