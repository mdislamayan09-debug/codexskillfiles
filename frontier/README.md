# Dust & Redemption

An open-world western for the browser, built with Three.js and aimed at the look of Red Dead Redemption 2.
Models, animation and most materials are procedural. Ground, rock, timber and water surfaces use scanned CC0
photographic textures from ambientCG (see `public/textures/CREDITS.md`). Fonts are three web fonts.

Ride a horse across 16 km² of frontier: rolling Heartlands grass, oak meadows, pine ridges, a river valley,
a lake, a cypress bayou and a snow-capped range. The world includes the frontier town of Copper Hollow, a
ranch with livestock, deer herds, and the Cutter Gang's hideout. A full day/night cycle runs throughout.

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

- **Terrain**: a 1536² float heightfield generated on load (domain-warped ridged mountains, river and lake
  carving, town plateaus, road beds). It is rendered as GPU-displaced, instanced chunk LOD with skirts, and a
  per-pixel splat shader blends scanned grass, dirt, gravel, pebble riverbed, triplanar rock and snow (albedo
  plus normal maps, two scales mixed by noise to hide tiling) with roads, wheel ruts, puddles and wet mud.
- **Sky and light**: analytic scattering sky with raymarched cumulus (a 3D Perlin-Worley noise volume, sun
  self-shadowing, silver lining and aerial perspective), cirrus, sun disc, stars and moon. Sun and moon lights follow the time of day, with a PMREM environment re-baked as it changes.
  Height fog with sun in-scattering and aerial perspective is patched into every material.
- **Vegetation**: wind-animated instanced grass blades (two rings, trampled by the player), procedural oaks,
  pines and moss-hung cypress with spherical foliage normals and leaf translucency, real-time baked billboard
  impostors for every tree out to the horizon, bushes, and moss-capped rocks.
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
