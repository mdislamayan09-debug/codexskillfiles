# Dust & Redemption

An open-world western for the browser, built with Three.js and aimed at the look of Red Dead Redemption 2.
Models, animation and most materials are procedural. Ground, rock, timber and water surfaces use scanned CC0
photographic textures from ambientCG (see `public/textures/CREDITS.md`). Fonts are three web fonts.

Ride a horse across 67 km² of frontier that holds every climate (see `WORLD_PLAN.md`). The map takes in:
- the snowy Grizzly Peaks and the glacial Frostwater Valley with a trapper's cabin;
- a belt of giant pines on the foothills;
- the Heartlands around the town of Copper Hollow, with a ranch, a lake, a river and the Cutter Gang's
  hideout;
- the autumn-coloured Ember Hills;
- Sundown Mesa's red desert;
- the bayou;
- a palm-and-karst jungle coast on the ocean.

Weather follows the region: snowstorms in the north, humid haze in the south and clear desert air. A full
day/night cycle runs throughout.

## Run

```bash
cd frontier
npm install
npm run dev            # http://localhost:5173
# or
npm run build && npm run preview
```

Quality presets: `?q=low`, `?q=med`, `?q=high` (default), `?q=ultra`. Ultra renders at up to 2× pixel ratio
(native 4K on a 4K display), with an 8192² sun shadow map, terrain detail pushed 45% farther, 1.5× grass density, a wider
full-detail radius for trees and bushes, and higher-resolution water reflections.
`?ss=2` forces a 2× render scale on any display, so a 1920×1080 window renders a 3840×2160 frame. Combine
it with `?q=ultra` and press P for 4K stills, for example `?q=ultra&ss=2`.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move / steer horse (camera-relative) |
| Shift (hold) | Sprint / gallop |
| Ctrl | Walk |
| Mouse | Look (click the canvas to capture the mouse) |
| Right mouse / Left mouse | Aim / fire |
| Q | Dead Eye (slow time, aim assist) |
| R | Reload |
| E | Mount / dismount |
| H | Whistle for your horse |
| F | Loot body, skin deer, open strongbox |
| V | Cinematic travel camera (while riding) |
| M | Map |
| T | Wait one hour |
| P | Photo: saves the current frame as a PNG at full render resolution (no HUD) |
| F1 | Controls |

## What's in it

- **Terrain**: an 8 km float heightfield generated on load in Web Workers. It is 2048² to 3072² depending
  on quality, which is 4 to 2.7 m per sample.
  - Landforms: ridged mountains, a carved glacial valley, mesas, karst hills, coast, river gorge, lake, town
    plateaus and road beds.
  - Climate texture: a second texture carries the climate weights (snow, jungle, autumn, desert).
  - Rendering: GPU-displaced, instanced chunk LOD with skirts. A per-pixel splat shader samples texture arrays
    of scanned ground (grass, dirt, gravel, sand, pebble riverbed, triplanar rock, snow, forest litter) and
    blends them by climate. That covers snow on gentle ground with bare cliffs, frozen falls and a braided ice
    creek; red banded mesas; beaches; leaf litter; roads, wheel ruts, puddles and wet mud.
- **Sky and light**: analytic scattering sky with raymarched cumulus (a 3D Perlin-Worley noise volume, sun
  self-shadowing, silver lining and aerial perspective), cirrus, sun disc, stars and moon. Sun and moon lights follow the time of day, with a PMREM environment re-baked as it changes.
  Height fog with sun in-scattering and aerial perspective is patched into every material.
- **Vegetation**: everything is procedural.
  - Grass: wind-animated instanced blades in two rings, trampled by the player. They turn gold, straw or jungle
    green by climate and disappear under snow.
  - Trees: oaks, pines, forest-giant pines, snow firs, moss-hung cypress, palms, buttressed jungle trees with
    lianas, and saguaro.
  - Ground cover: ferns, big-leaf plants, dry scrub, fallen logs and rocks.
  - Climate on foliage: snow settles on boughs, rocks and roofs, and broadleaf crowns turn autumn colours.
  - Distance: real-time baked billboard impostors carry every tree out to the horizon.
- **Water**: one plane with planar reflections, heightfield-driven depth colour and transparency, shoreline
  foam, sun glints and bayou algae.
- **Town and props**: false-front buildings with porches, balconies, hand-painted signage, glowing night
  windows, a church with a steeple and graveyard, barns, corrals, a windmill, wagons, a water tower and
  telegraph lines.
- **Characters**: sweep-built humans (rider, townsfolk, outlaws) and quadrupeds (horse with tack, deer, sheep).
  Animation is procedural: walk, trot, canter and gallop gaits, riding pose, aiming, grazing and death.
- **Gameplay**: horse riding with stamina, on-foot movement, revolver combat with reload, Dead Eye, outlaw AI
  (alert, flank, shoot), wildlife that flees, hunting and looting, bounty money, a crime/wanted state, death
  and respawn, and a mission objective.
- **Post and HUD**: screen-space sun shafts, GTAO, bloom, ACES tone mapping and a film grade (split tone,
  grain, vignette, Dead Eye sepia). The period HUD has cores, a parchment minimap and map, prompts, a feed and
  region banners. Audio is procedural (wind, birds, crickets, hooves, gunshots, plucked-guitar score).

## 4K stills

`shots/4k/` holds native 3840×2160 frames rendered on the ultra preset. They are in-engine captures in headless
Chromium with software GL, with no upscaling and no paint-over. To make your own, run with `?q=ultra&ss=2` and
press P, or use `CANVAS=1 node scripts/shoot.mjs "http://localhost:4173/?capture&q=ultra" town,vista 2 3840x2160`.

## Gauntlet loop

This was built with a gauntlet loop: a builder, plus a separate blind critic comparing in-game captures against
real RDR2 frames. See `GAUNTLET_PROMPT.md` and `PROGRESS.md`. The capture tools are `scripts/shoot.mjs`
(headless Chromium screenshots of named shots via `window.__game.setShot`) and `scripts/make_pairs.py`
(blind A/B pairs).
