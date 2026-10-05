# Dust & Redemption — gauntlet progress

Live log of the gauntlet loop (see `GAUNTLET_PROMPT.md`). Each round: the builder captures real in-game
frames with `npm run shoot`, `scripts/make_pairs.py` pairs each with the matching Red Dead Redemption 2 bar
frame under random A/B labels, and a separate critic agent with fresh context picks the better image blind and
names the single biggest gap. The builder fixes that gap and the piece goes round again.

**Bar frames** (from `d4v1-sudo/rdr2-site-clone/assets/img`): Valentine/Heartlands ranch postcard, swamp
horseback shot, train-robbery ride, forest hunt, Strawberry establishing shot.

## Pieces

| Piece | Our shot | Bar frame | Status |
| --- | --- | --- | --- |
| Terrain + mountains | `vista`, `ranch` | Valentine postcard | in progress |
| Sky + light | all | all | in progress |
| Vegetation | `forest`, `ride` | forest hunt | in progress |
| Water | `swamp` | swamp ride | in progress |
| Town | `town`, `night` | Strawberry | in progress |
| Rider + horse | `ride`, `gallop` | swamp ride, train ride | in progress |
| Wildlife + outlaws | `camp`, `ranch` | forest hunt | in progress |
| HUD | `hud` | RDR2 HUD frames | in progress |

## Rounds

### Round 0 — first light
- Engine up: GPU heightfield terrain (4 km², chunk LOD), analytic sky with painted clouds, height fog with sun
  scattering, instanced grass, oak/pine/cypress trees with impostors, procedural town, rider/horse/deer/sheep,
  outlaw AI, HUD, procedural audio, post stack (god rays, GTAO, bloom, film grade).
- Bugs fixed before any critique: tree-impostor bake leaked the canvas viewport (black screen); pine cards were
  edge-on from the side (floating specks); shadow frustum did not reach the mid-ground.

### Round 1 — blind critic: 0 / 8
| piece | winner | biggest gap named by the critic | builder response |
| --- | --- | --- | --- |
| ranch | RDR2 | buildings are boxes dropped on an even grass field | dirt yards, hand-placed shade trees, tighter framing |
| vista | RDR2 | ground and trees ignore the pink dusk sky | env-map driven ambient (PMREM ×0.75–0.95), hemi light cut, impostors relit in-shader |
| ride | RDR2 | rider and horse are rough mannequins | **new SDF-sculpted, skinned horse + rider** (surface nets, bone weights), hair-card tail, rim light |
| swamp | RDR2 | water is a clean mirror lake, not murk | depth absorption ×2.4, weaker near-field Fresnel, 2.6k lily pads |
| gallop | RDR2 | no depth: every distance equally sharp | height fog density ×2 with steeper falloff, light motes |
| forest | RDR2 | it isn't a forest; bloom blows out the sky | shot now searches for dense forest; bloom threshold 0.95 → 2.2, shafts −35% |
| town | RDR2 | empty street, no people, props or wear | 22 townsfolk, saddled horses at hitching rails, troughs/hay/barrels, wheel ruts and puddles, clapboard siding |
| camp | RDR2 | campfire lights nothing | 160 cd shadow-casting fire light with flicker, procedural flame billboards, brighter moonlight, round stars |

Cross-cutting fixes: grass rebuilt as alpha clump cards (~30 painted blades + seed heads per card),
foliage self-occlusion via vertex AO, distant forest canopy tint on terrain, impostor fade beyond 1.5 km.

### Round 2 — blind critic: 0 / 8 (town no longer a landslide)
| piece | winner | margin | biggest gap named by the critic | builder response (round 3) |
| --- | --- | --- | --- | --- |
| ranch | RDR2 | landslide | barns are plain one-colour boxes | clapboard siding rewrite, inverted roofs fixed, pasture grass restored |
| vista | RDR2 | landslide | land lit flat-grey under a pink sky, no long shadows | **heightfield sun shadows** (22-step march toward the sun) on terrain/grass/trees/impostors, ambient tied to sun height |
| ride | RDR2 | landslide | faceless rider, shiny horse, slab tack | brows/beard/sideburns, matte coat (roughness 0.7), woven blanket texture, bedroll straps |
| swamp | RDR2 | landslide | camera buried in giant reeds | water shots frame from the open-water side |
| gallop | RDR2 | landslide | featureless brown road, horse not moving | narrower roads with grassy crown, side-on gallop with pre-warmed dust trail |
| forest | RDR2 | landslide | pines read as flat palm fronds | 2× denser, smaller branch cards with stronger core occlusion, warmer needles |
| town | RDR2 | clearly | boxes in one brick texture | weathered clapboard, glowing street lanterns, street clutter |
| camp | RDR2 | landslide | fire doesn't light the scene, tents glow white | outlaws sit at the fire, picket line, bedrolls/crates, canvas tents |

### Round 3 — blind critic: 0 / 8 (town "clearly", the rest landslides)
Fixed between rounds 2 and 3: the impostor shader had silently failed to compile since round 2 (undeclared `uCols`),
so no distant trees drew; impostors also brightened non-premultiplied texels to white. Both are fixed.

| piece | biggest gap named by the critic | builder response (round 4) |
| --- | --- | --- |
| ranch | dark tiled grass field, plain barn boxes | brighter matte grass; board-and-batten barns with corner boards and thicker roofs |
| vista | distant trees alias into speckle | impostors fade 850–1250 m and hand off to the terrain canopy tint; no more white impostors |
| ride | mannequin rider, plastic horse, no mane | sky fill (envMapIntensity 1.5) on characters, sheen coat (MeshPhysicalMaterial), larger hair-card mane |
| swamp | horse legs cut the water with a hard edge | coats and clothes darken below the waterline |
| gallop | crushed to black, no key light | front-lit open-road framing, exposure 0.95 → 1.12 |
| forest | no atmospheric depth | fog thickens among trees (×3.2) and in early morning (×2.8) |
| town | empty, green street | packed-dirt plateau; grime gradient and contact darkening at the base of every town surface |
| camp | fire lights nothing | fire light 160 → 380 cd, 38 m reach; picket line moved out of frame |

### Round 4 — blind critic: 0 / 8 (town "clearly", the rest landslides)
The critic still picks the RDR2 frame every time. Its round-4 gaps, and what has already landed since that capture:

| piece | biggest gap named by the critic | status |
| --- | --- | --- |
| ranch | uniform grass carpet, no worn paths or foundation skirts | field-scale grass colour/dryness variation landed; worn paths not yet |
| vista | far forest reads as white speckle | fixed after capture: far impostors now shrink into the canopy tint instead of dithering |
| ride | mannequin-grade rider and horse | open: needs hand-authored character art beyond SDF sculpting |
| swamp | opaque pea-green water, hard bank line | open |
| gallop | stair-stepped grass edge, blurry road | fixed after capture: soft ragged grass edges; road detail still open |
| forest | cotton-ball canopies blowing out to white | leaf albedo/env toned down; canopy shading still open |
| town | street too empty and clean | open (more clutter and NPC density) |
| camp | fire floods the whole clearing | open (tighter falloff, soft shadows) |

### Round 7 — blind critic: 0 / 8 (town "clearly", the rest landslides)
Mountains now show eroded rock relief and the camp shot is the most dramatic frame yet, but the verdicts have
plateaued: since round 3 the critic names the same three gaps every round — mannequin-grade people and horses,
flat material response (no texture-level wear or breakup), and thin ground/vegetation detail. A seating bug the
camp close-up exposed (outlaws hovering beside the logs) is fixed after capture.

### Round 8: blind critic 0 / 8 (vista "clearly", the rest landslides)
The "ultra realistic 4K" pass:
- **Photographic CC0 surfaces.** Terrain, boulders, town timber, foundations and water now sample ambientCG
  scans (albedo plus normal maps) with two scales mixed by noise to hide tiling. The scans are grass, dirt,
  gravel, pebble riverbed, triplanar rock (including a cliff-scale sample for distant faces), snow, planks,
  weathered wood and stone, plus scanned water normals.
- **Raymarched cumulus sky.** A 3D Perlin-Worley noise volume drives a cloud slab with sun self-shadowing,
  a two-lobe phase function and aerial perspective. This replaces the painted 2D clouds.
- **Grass.** Distant clumps settle to their mean colour, so the "dark lettuce" mottling is gone. The ranch
  pasture is grazed short, and the clumps are brightened to sit on the ground instead of reading as a dark mat.
- **`?q=ultra` preset.** Up to 2x pixel ratio, an 8192 shadow map, farther terrain detail, denser grass and
  sharper reflections.

| piece | margin | biggest gap named by the critic | builder response (after capture) |
| --- | --- | --- | --- |
| ranch | landslide | flat tiled lawn, props on a blockout grid | open: terrain undulation, clutter, wear at post bases |
| vista | clearly | mid-distance forest renders as grey-white speckle | fixed: terrain noise finer than a pixel fades to its mean, and far impostors take the canopy terrain's shading |
| ride | landslide | mannequin rider: one material, no face, no seat contact | open: needs authored character art |
| swamp | landslide | flat shadowless light, no humidity | open |
| gallop | landslide | rocking-horse pose, white blotches on the ground | dust puffs broken up with noise; gait still open |
| forest | landslide | "broccoli" card canopies, no sky holes | leaf translucency toned to yellow-green; canopy rebuild still open |
| town | landslide | flat tiling close-up surfaces, grey window quads, polka-dot rust | open (scanned boardwalk landed this round) |
| camp | landslide | fire is a white blown-out light; outlaw in mid-air | flames kept orange below the clip point; camp shot no longer alerts the gang, so outlaws stay on the logs |

The critic also flagged the test set. The repo only has five RDR2 bar frames, so three bar frames serve two
pieces each, and three pairs (vista, gallop, camp) don't compare like with like. Better-matched reference
frames would make future verdicts sharper.

## Where it stands (historical note from round 4 below; still accurate after round 8)
After four rounds the build has not beaten the bar. Every round closed visible gaps: the critic's notes moved from
"black screen / floating specks / mannequins in an empty field" to fine-grained material, foliage and character
detail. Town has stopped being a landslide since round 2. The remaining distance is mostly hand-authored art
(textured characters with cloth and hair, photographed material sets, sculpted cliffs) that a procedural,
code-only browser build can approach but not match.

Next pieces to loop on, in the critic's order: characters, sun-tinted fog and shafts, terrain wear and paths,
set-dressing density, foliage shading.

### Round 5 — blind critic: 0 / 8 (all landslides)
Gaps: near-black rider clothing, no visible mane, tiny fire pool, white canopy tops, stair-stepped grass edges,
no ripples. Builder response: lifted clothing albedo, sculpted mane ridge plus 22 hair cards, 900 cd fire,
toned foliage, noise-broken grass density, water ripple rings and foam around legs, porch-framed town shot,
wider worn paths.

### Round 6 — blind critic: 0 / 8 (town "clearly", the rest landslides)
The porch-framed town shot is the closest yet. Remaining gaps the critic repeats every round: mannequin
characters, flat atmosphere, no material breakdown, cone mountains, empty foregrounds. Builder response (round 7):
far-field rock relief on steep high ground (gullies and strata in the shader), stronger pasture hue/height
variation with muddier paths, camera pushed into the outlaw camp, denser lit smoke.

## World v2: the user's three reference frames

From round 9 the bar is the three frames the user supplied: a ride along a pine-forest trail, a ride up a
snowy valley in a blizzard, and a lookout over a snowy valley with a cabin. Each pair is judged blind.

### Round 9: blind critic 0 / 3 (all landslides)
- **pines:** flat, empty floor; a trail 6–8 m wide; flat light with no haze; a mannequin rider.
- **snowride:** a white sheet that doesn't react to the horse; heightmap-looking mountains; sparse scatter.
- **snowvista:** a stretched heightmap wall; blotchy snow; poor composition with no horizon.

### Rounds 10–11: blind critic 0 / 3 (all landslides; scores 3, 3, 2 out of 10)
Builder work between them:
- **Crags.** Range faces step into cliff bands with snow ledges. A noise-modulated terrace keeps risers
  steep and benches flat, so the snow-by-slope shader exposes dark granite.
- **Valley.** Frostwater Valley was rebuilt from a narrow slot into a broad glacial trough that flattens
  and widens toward its mouth. Spruce stands with meadows between them.
- **Winter rider.** The rider changes into a shearling coat with fur trim, a trapper hat and a scarf in
  the cold. Snow dusts the shoulders and the horse's back.
- **Snow-country scatter.**
  - Firs climb steeper slopes.
  - Snow-capped boulders gather in fields and are sunk into the slope.
  - Frosted dry brush grows in clumps. It used to render black because its vertex colours were missing.
- **Atmosphere.**
  - Fog no longer fills valleys below the layer base with an opaque white bowl.
  - Aerial perspective is stronger.
  - Mist banks lie along cold valley floors in storms.
  - The storm sky had been fading its clouds into clear-sky blue; it now uses the storm grade.
- **Forest.**
  - The camera is deep in the trees on level ground.
  - Forest giants have ragged columnar crowns.
  - Backlit boughs darken instead of glowing pale.
  - Green grass, fern beds and fallen logs fill the floor.
- **Tooling.**
  - `scripts/probe.mjs`: set a shot, evaluate JS against the game, save the frame.
  - `scripts/glcheck.mjs`: name the programs behind rejected GL draws. It showed the long-standing sampler
    warning is harmless: it is a frame-0 warm-up pass only.

What the round-11 critic still names, in order:
1. Too little aerial perspective and valley fog.
2. Spiky, faceted peaks, plus blade-like fins on the valley walls.
3. The rider and horse: the tail reads as a black slab.
4. Sparse ground dressing.
5. A blown-out sun bloom.
6. Evenly spaced identical trees.
