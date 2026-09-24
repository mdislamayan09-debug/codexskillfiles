# STILLWILD — Production Roadmap

This roadmap is ordered so the game is **playable and polished at the end of every milestone**. Nothing ships as a placeholder that a later milestone is expected to replace wholesale; each milestone deepens systems that already work.

Status legend: ✅ done · 🟡 in progress · ⬜ not started. The live state of each item is tracked in `docs/PROGRESS.md`.

---

## M0 — Pre-production

| Deliverable | Acceptance |
| --- | --- |
| Game design document (`docs/GAME_DESIGN.md`) | Covers premise, world, biomes, loops, story, progression, creatures, bosses, crafting, survival, combat, building, quests, UI, audio, art, tech, endgame |
| Technical architecture (§14 of the GDD, `CLAUDE.md`) | Renderer, physics, streaming, save, test hooks decided and justified |
| Project scaffold | `npm run dev`, `npm run build`, `npm test` all work; Playwright launches the pre-installed Chromium |

## M1 — Playable core (vertical slice of exploration)

The world exists, looks authored, and feels good to move through.

| Deliverable | Acceptance |
| --- | --- |
| Deterministic world generation in a worker | 2048² heightfield with seven biomes, rivers, lakes, coast, crater; < 4 s on desktop; cached |
| CDLOD terrain | One instanced draw, morphing without cracks, biome-aware triplanar shading |
| Water | Sea, lakes, rivers with depth color, shore foam, waves, refraction-lite |
| Sky & time | Day/night cycle with sun, moon, stars, clouds, colored fog per biome |
| Player | Authored character, procedural animation, third-person camera with collision |
| Traversal | Walk, sprint, jump, climb any steep surface, mantle, swim; stamina coupling |
| Vegetation & props | Per-biome kits, instanced, streamed, LOD, wind, collision proxies |
| Audio foundation | Ambience per biome/time, footsteps per surface, music bed |
| HUD foundation | Compass with landmarks, vitals, prompts, notifications |
| Diagnostics & tests | Test hooks, diagnostics, Playwright smoke + screenshots |

## M2 — Survival, gathering, crafting, building

| Deliverable | Acceptance |
| --- | --- |
| Survival stats | Food, water, temperature, wetness, shelter with buffs and soft penalties |
| Gathering | Harvestable trees, rocks, plants, ore; respawn timers; persistence |
| Items & inventory | Item database, stacking, backpack grid, hotbar, equipment |
| Crafting | Recipes by station, crafting UI, station tiers |
| Tools & weapons | Axe/pick/knife/torch tiers; weapons ladder |
| Building | Snap pieces in tiers, preview with reasons, storage, beds, stations |
| Farming | Seeds, plots, growth over days, watering |
| Save/load | Versioned saves, autosave, backup, death & respawn |

## M3 — Creatures, combat, ecosystems

| Deliverable | Acceptance |
| --- | --- |
| Combat | Light/heavy combos, bow, dodge i-frames, block/parry, lock-on, weak points, hit feel |
| Creature kit | Procedural models + locomotion for every creature in GDD §9 |
| AI | Perception (sight/hearing), herds, packs, predator/prey, day/night routines, territory |
| Ecosystem | Habitats, population caps, off-screen replenishment, no spawns in view |

## M4 — World content

| Deliverable | Acceptance |
| --- | --- |
| Landmarks | Every landmark in GDD §3.5 built from the Veyr/expedition kits |
| Caves | Seamless caves with lighting, reverb, loot |
| Puzzles | Tuning stones, prisms, echo bridges, wisp chases, sealed doors |
| Discovery system | Stingers, map reveal, compass sighting, journal entries |
| Curiosities | ~200 minor discoveries: lore, echoes, caches, shrines, rare nodes |
| Map & journal | Parchment map from heightmap with fog of war and pins; full journal |

## M5 — Story and survivors

| Deliverable | Acceptance |
| --- | --- |
| Dialogue system | Branching dialogue with conditions, affinity, subtitles |
| Survivors | Seven characters with personalities, quests, relationships, routines, services |
| Main quest | Acts I–III with non-linear Act II and ordered memories |
| Side stories | Personal quests + listed side stories |

## M6 — Wardens and endgame

| Deliverable | Acceptance |
| --- | --- |
| Five Wardens | Phases, telegraphs, weak points, arenas, world consequences |
| The Stillheart | Descent level, Seren Vey fight, three endings, post-game state |

## M7 — Weather and world events

| Deliverable | Acceptance |
| --- | --- |
| Regional weather | Clear, cloudy, fog, rain, storm/lightning, snow, blizzard, ashfall, resonance storm |
| Hazards | Cold, heat, toxic vents, miasma, lightning, drowning, falls |
| Rare events | Meteor shower, Wanderer, time-slip, aurora, eclipse, bottles |

## M8 — Polish and release

| Deliverable | Acceptance |
| --- | --- |
| Accessibility & settings | Full settings, rebinding, controller prompts, reduced motion, colorblind, subtitles |
| Performance | Budgets in GDD §14 met on the High preset; Low preset for weak GPUs |
| QA | Bot playtests across biomes, visual baselines, production build verified |
| Release | Static build deployable to any host; documented |

---

## Post-launch roadmap (future iterations)

1. **Content depth:** more side stories per biome, second cave per biome, more echo stories, Expedition Board job variety.
2. **Seasons:** once the note is released, the world gains seasons (post-game).
3. **Hand-authored hero assets:** replace the most-seen procedural models (player, survivors, Wardens) with sculpted/rigged models when an asset pipeline exists — the factory interfaces already return the shape an imported GLB loader would.
4. **WebGPU renderer** with TSL materials and GPU-driven vegetation.
5. **Touch/mobile controls** and a mobile quality tier.
6. **Co-op** (2–4 players) — the deterministic world and delta-only saves were chosen with this in mind.
7. **Photo mode** and a cartography mini-game (ink your own map annotations).
8. **Localization** — all player-facing strings already live in data modules.

## Realistic team framing

For a human indie team the milestones above map to roughly: M0–M1 three months, M2–M3 four months, M4–M5 six months, M6–M7 three months, M8 two months — ~18 months for a team of 5–7 (2 engineers, 1 technical artist, 1 environment artist, 1 designer/writer, 1 audio, part-time QA). The procedural-first pipeline chosen here is what makes that scope realistic for a small team.
