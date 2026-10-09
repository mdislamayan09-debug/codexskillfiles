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

### Rounds 15–19: scores 3–4 out of 10, best "clearly" (snowride in round 17; vista in round 15)
- Foliage was the hidden culprit behind "frosted" pines. Card foliage has one normal on both faces, so seen from
  below it took full sky light, and at grazing angles Fresnel mirrored the bright sky. Fixed with matte leaves,
  shaded undersides and darkening for backlit boughs.
- Pines now has a forest grade, sunbeams between the trunks, fern-lined verges, and a set-dressed mossy log and
  boulder.
- The storm sky had faded its far clouds into clear-sky blue; it now uses the storm grade.
- Mist banks and distance haze in cold storms.
- Clustered spruce stands instead of an even pepper of trees.
- Animal tracks in the snow.
- The rider has a readable hat brim, coat wear and folds, and an elbows-out riding pose; the horse's tail is
  made of locks.

### Round 20+: real ground (scores 3, 3, 4 in round 21)
The user said, rightly, that the frames were nowhere near the references. The biggest structural gap was
procedural mountains: noise ranges read as cones, fins and stretched heightmaps. The snowy north is now real ground:
- **Source.** A window of Kawuneeche Valley, Rocky Mountain National Park: USGS 3DEP via AWS Terrain Tiles, z14.
- **Scale.** Baked by `scripts/bake_dem.py` at 0.55x horizontal and 0.95x vertical.
- **Wiring.** The valley floor, creek, cabin bench, road and river head are traced from the real ground.
- **Blending.** It blends into the generated pine belt to the south and climbs into a closing ridge at the north edge.
- **Terrain shader.** Curvature strips wind-scoured ribs to rock, and snow sheds from slopes steeper than about 33°.

The vista went from stylised spikes to recognisable alpine terrain. In round 21 the critic still names, in order:
1. The rider and horse read as placeholders.
2. Cliff bands and sharp ridgelines are missing. The real valley walls at the ride spot are gentle and forested.
3. Trees need clustering and density.
4. Storm-cloud skies.
5. The grade.
6. Foreground framing.

What's limiting the remaining distance:
- **Characters and vegetation need real art.** RDR2's look comes from scanned and hand-authored assets. The CC0
  scan libraries (Poly Haven, ambientCG) are blocked by this environment's network policy, so characters and
  foliage are still procedural.

### Rounds 22–27: more real ground, a real human body (scores 2–5 ours vs reference, worst "clearly")
- **Every climate on real ground.** Real DEM patches now cover:
  - Monument Valley (desert)
  - Na Pali (jungle coast)
  - Cades Cove (autumn hills)
  - Yosemite Valley (the snowy canyon ride)

  Each patch is baked with `scripts/bake_patch.py`. The generated world fills the gaps and the boundary ranges.
- **The rider is a MakeHuman (CC0) body.** It is reposed and folded onto the game skeleton by `scripts/build_human.py`.
  Clothing is cut from body regions and pushed out along the normals:
  - open coat with a V-front over the vest
  - creased felt hat
  - trapper hat with ear flaps for the cold
- **Cinematic preset by default.** 4096² heightmap, finer creature sculpts, denser stands and understorey.
- **Recurring critic notes:**
  - forest lighting crushed to black, with no shafts
  - distant forest reads as stipple
  - mountains streaked rather than rock with snow on the ledges
  - the snow grade goes sepia instead of steel-blue
  - not enough foreground anchors
  - a bare snow floor

  All of these got targeted fixes: forest grade and shafts that fire on trails, clean stand edges, rock joints and
  lichen, cool storm highlights, set-dressed foreground rocks and brush, and dry tufts.
- **Bug found in round 27.** Grass had silently failed to compile since the snow-tuft change: a variable was
  used before it was declared. Every frame from rounds 25–27 was missing its grass. The probe script now prints
  console shader errors, and every probe is checked for them.

### Round 28: the horizon, the horse, the kit
- **Distant country beyond the map edge** (`src/backdrop.js`).
  - **What it is.** A square ring of terrain out to about 70 km that carries on whatever lies at each edge:
    - snowy ranges to the north
    - mesas and sierras to the south-west
    - forested ridges elsewhere
    - sea off the coast
  - **The valley carries on.** Kawuneeche runs on north between the ranges, so the up-valley vista recedes into
    the haze like the reference, instead of ending at a wall.
  - **Depth.** Every patched material squeezes depth beyond 6.5 km into the 6.5–8 km band (`GLSL_FAR_DEPTH`), so
    the ranges sort correctly and are never clipped by the far plane.
- **Horse framing.** Shots can turn the horse against the lens (`turn`), so its neck and ears show past the rider,
  as in both ride references.
- **Horse anatomy.** A deeper barrel and chest and thicker forearms and quarters: the legs no longer read as stilts.
- **Tack and kit.**
  - warm saddle-brown leather instead of near-black
  - a canvas bedroll
  - a solid cantle instead of a hoop that read as a handlebar
  - a satchel strap across the back with the satchel on the left hip, and the holster on the right
- **Winter rider.** A rolled sheepskin collar standing up round the neck replaces the flat patch the critic called
  a "gold placeholder". The trapper hat is tufted rather than a smooth dome.
- **Forest.** Slimmer, greyer lodgepole and ponderosa trunks instead of redwood columns.

**Round 28 critic** (ours vs reference, 10 = indistinguishable): pines 3, snowride 2, snowvista 2, all "clearly".
The critic asked for:
- **Pines:** a horse and rider that don't read as placeholders; translucent, open canopy instead of a black wall;
  broad volumetric shafts instead of a radial starburst; clustered ground scatter; tapered trunks with root flare;
  a decayed log.
- **Snow ride:** drifts and a hoof trail in the snow; no clipping slab; dark rock structure on the far walls.
- **Snow vista:** forest in draws and stands rather than pepper; erosion-shaped rock instead of streaks; valley fog;
  a foreground ledge; a readable cabin and river.

### Round 29: canopy, drifts, river, kit (scores 3, 2, 4; the vista is up two)
- **Light and canopy.** Shafts sample a footprint across the ray, so beams are broad and soft. Needles transmit
  backlight, tall crowns are open, trunks have root flares, and the bark is plated and irregular, built from
  tileable noise.
- **Snow ride.** Metre-high wind drifts in the real heightmap of the snowfields, and crystal glints near the lens.
- **Snow vista.**
  - A wide braided river on the valley floor.
  - Timber follows the draws.
  - Low cloud rags cling to the mountainsides.
  - The lookout is closer to the homestead, which gains a smokehouse, a tack shed and a fence.
  - Split-granite outcrops anchor the foreground.
- **Horse.** A volumetric tail, muscle lobes, and snow on its back. The pre-filled trench (the "clipping slab") is
  gone from chase shots.
- **Other biomes.** Mottled shrub cover on the jungle slopes, a blue open ocean, and finer broadleaf sprays (the
  autumn trees no longer read as pom-poms).
- **Remaining asks:**
  - fur and hair shading on the horse, real tack detail, cloth folds on the rider
  - a deformable snow trail
  - fir boughs that read as sprays, not sheets
  - true darks in the storm frame
  - forest by gully and treeline across the whole valley
  - a bigger, warmer cabin focal point

### Round 30: open pine forest (scores 3, 2, 3)
The pines frame changed character:
- tall clear-boled lodgepole and ponderosa stands with high open crowns
- shafts through bright haze, root flares and the fallen log
- the horse's head and neck clear of the rider

The critic now asks for:
- **Pines:** canopy shade on the floor (the frame was overexposed: its mean was 1.7x the reference's).
- **Snow ride:** riders that take bounce light from the snow instead of reading as black cut-outs.
- **Snow vista:**
  - eroded ridgelines instead of noise lumps (the drifts had spilled onto the mountainsides)
  - light breaking through the storm deck
  - more snow on the boughs, and tree wells

### Round 31: light
- **Exposure.** Recalibrated against the references' measured means: no exposure lift in the forest; clear-air
  storms stop down. The snow ride already matched the reference's highlight, midtone and shadow colours to within
  about 10%.
- **Ambient bounce.** It now comes from the ground under the camera: snow throws a bright cool fill up under
  brims and bellies, while forest floor gives almost none.
- **Cloud shadows.** A broken storm deck casts drifting cloud shadows over everything lit, and the breaks drop
  strong pools of sun on slopes and peaks.
- **Trees and ground.** Tree wells under the snow-country spruce. Wind drifts only on flat snow.
- **Rider and horse.**
  - real geometric folds in the rider's coat
  - a girth strap and rings on the horse
  - breath smoking from the horse's nostrils in the cold
- **Grade.** Muted ferns; slightly warmer storm highlights.

**Round 31 critic:** pines 4 (up one), snowride 3 (up one), snowvista 3.

### Rounds 32–33
- **The north wall is gone.** A smooth artificial rise at the north edge had been closing the valley. Its striped
  slopes were the "comb" peaks the critic kept naming. The backdrop now carries the real ground on past the map,
  and the vista's background is real ranges with natural snow.
- **Light.**
  - ambient bounce follows the ground under the camera, so riders in the snow are lit from below
  - cloud shadows with sunlit breaks under a broken storm deck
- **Snow scenes.**
  - tree wells under the spruces
  - dead snags among the pines and spruces
  - a deeper snowfall volume with size variety and soft flakes near the lens
- **Characters.**
  - real geometric folds in the coat
  - a girth strap, breath vapour, and faded wool saddle blankets
  - hat brims with thickness
- **Mistake caught.** Alpha-to-coverage on the foliage (to soften card edges) thinned every distant crown into a
  see-through snag. Round 32 is discarded, and it is reverted.
- **Round 33 critic:** pines 3, snowride 2, snowvista 3. Its notes:
  - milky forest haze and clipped highlights (p95 218 against the reference's 184)
  - camouflage-like soft forest and snow blotches on the far slopes
  - soft clouds
  - the horse floating on the snow
- **Round 34 fixes.**
  - less forest exposure and haze
  - crisp, crown-ragged stand edges and snow-to-rock edges
  - finer cloud erosion
  - the snow ride framed off-centre toward the valley
  - snow-capped, half-buried rocks
  - broken-crust rings where the horse's legs enter deep snow

**Rounds 34–36 critic:** pines 3, 3, 4; snowride 3, 3, 3; snowvista 2, 3, 3.

### Rounds 35–37
- **The snow-forest look turned around.** The distant snow canopy had been painting the mountainsides dark with
  white glades, which the critic read as "camouflage" and "snow puddles on rock". It is now mostly white, flecked
  dark, and darkens the ground far less, as the reference's slopes are. Stand edges are ragged at crown scale and
  crisp. Distant snowy spruce impostors keep dark crowns; they had thinned to "pins".
- **Crags.** Split granite blocks 4–16 m across break out of steep snowy faces and are drawn out to 2.6 km.
- **Grade.** Smaller black lift, more contrast under the canopy, less forest haze and exposure.
- **Pine forest.**
  - fuller crowns (they had read as telephone poles)
  - rounder root buttresses
  - mossy boulders through the woods
  - shrub and fern drifts over the whole floor, now also in tree cells (dense stands had left bare duff)
  - fewer fallen sticks (they had carpeted the floor)
  - dead snags with drooping dead limbs
- **Horse.** Sturdier legs with defined knees, hocks and fetlocks. Snow rings at the hooves were tried and dropped:
  they read as white saucers.
- **Snow ride.**
  - framed with the rider off-centre toward the valley
  - snow-capped, half-buried rocks
  - a wider frozen creek
  - an old half-buried drift fence across the snowfield, as a made thing to ride toward
- **Snow vista.** The lens is turned partway up the valley so the homestead sits on a third, and a trampled road
  leads to it through the snow.

**Rounds 37–39 critic:** pines 4, 4, 3; snowride 3, 3, 2; snowvista 3, 3, 3.

### Round 40: the reference's vantage
- **Vista lookout.** The snow vista is now shot from a summit lookout 170–520 m above the homestead, looking up the
  length of the valley over it, past the map edge into the backdrop's ranges, under the storm deck. This is the
  first frame that is composed like the reference (`G.findVista(true)`). The old lookout sat just above the cabin
  and looked across at the nearby walls.
- **Backdrop.** The ranges get finer ridged spurs and gullies, on a ring mesh dense enough near the map to carry
  them.
- **Pine floor.** It finally has an understorey. A probe found 88 small bushes within 40 m of the rider, and tree
  cells skipped their undergrowth. Now tree cells grow 2–5 larger shrubs and ferns, and the grass under the
  canopy is back.
- **Snow ride.** A weathered, half-buried drift fence crosses the snowfield.

**Round 40 critic:** pines 4, snowride 3, snowvista 2. Snowvista notes:
- no foreground anchor
- a smooth central dome
- depth reads in reverse (the distant peak is the brightest thing)
- an empty valley floor

### Round 41–42: composing the vista by ray-marching the frame
- **Diagnosis.** The round 40/41 lookout turned out to be:
  - on a summit whose ground falls away so steeply that no ledge rock entered the frame
  - aimed across the valley, not along it
  - centred on a 1.5 km backdrop dome only 1.8 km past the map edge

  A probe marching rays from the camera found the centre ray ending on that dome.
- **`G.findVista`.**
  - Now searches every ledge in the snowy north. Each candidate is a ledge where the ground 16 m ahead dips only 0–9 m.
  - For each one it marches rays through a trial 46° frame and scores:
    - an open vanishing region (centre rays travelling 3.5 km or more)
    - a valley floor laid out below the horizon
  - It then looks for a flat snow bench 170–450 m out in the lower-middle of that frame. A second homestead (a line
    shack, built by the cabin builder) is set down on that bench and turned three-quarters to the lens.
- **Ledge.** The ledge rocks are placed in frame space: each rock's crown is put at a chosen point of the frame a few
  metres out. Where the slope drops away beneath that point, the rock grows down to meet the ground rather than
  float. This gives the reference's split granite shoulder in the lower left, slabs across the bottom and a boulder
  lower right, with frosted brush only where there is ground to root in.
- **Backdrop.**
  - The big massifs stay modest within the first ~9 km past the edge and step up range behind range.
  - The valley's continuation is wider.
  - A per-pixel erosion pass cuts fall-line gullies and ribs into the faces and bares dark rock on their steep parts,
    so distant faces read as couloirs between rock ribs rather than smooth shaded domes.
- **Snow ride.** The drift fence is gone (the reference has none). In its place are dark boulders half-buried in
  drift, in loose groups with frosted sage, either side of the open snowfield.
- **Pines.**
  - The floor and trail measured 0.6× the reference's brightness in the lower third. They are now a paler, tan duff
    and a dusty tread.
  - Young, full-skirted firs make up a middle storey, and mature pines vary in size, so the stand no longer reads
    as a planted grid of poles.

**Round 42 critic:** pines 5, snowride 4, snowvista 4. These are the best scores so far. The vista finally reads
as a lookout over a valley.

### Rounds 43–44: forests that read from afar, conifers with real boughs
- **Far forest.** Tree billboards used to sink away by 1.25 km, leaving the far forest as a grey tint on the
  ground. With no trees on it, that tint read as camouflage blotches across every mountainside. At cinematic
  quality the billboards now carry on to ~4 km, and snow-country stands grow close inside crisp edges.
- **Conifer cards.**
  - Redrawn as dense, layered sprays: dark interior needles, lighter tips, a ragged tapering silhouette. The old
    card was a few fronds on an empty card, so crowns read as see-through grey sheets.
  - Ponderosa and lodgepole have their own bottlebrush-tuft card, cinnamon plated bark, and a separate
    needle-duff ground layer.
  - Fir crowns are fuller, and their standing cards carry snow along the upper half.
- **Snow vista.**
  - The ledge uses bare granite variants, with wind-scoured crests on the summit.
  - Ochre bunchgrass tufts grow in the ledge's cracks.
  - The frozen creek has a willow-and-gravel corridor so it reads from the lookout.
  - The backdrop valley bears north-west along the lookout's line of sight.
  - The exposure is lifted for clear-air storms. The vista had measured about 25% darker than the reference.
  - The lens is narrowed to 40°.
- **Snow ride.**
  - Crag outcrops and spruce clusters fill the empty midground.
  - The weather is now a falling-snow storm with bigger flakes rather than a total white-out.
- **Grading.** The forest grade's S-curve became a highlight shoulder. The S-curve had blown the canopy gaps out
  while crushing the floor.

**Round 43 critic:** pines 4, snowride 3, snowvista 4.
- The dense young firs crowded the pine trail into Christmas-tree walls, so there are now fewer of them.
- The snow ride's air read as too clear.
- The vista's mountains still lack rock faces.

**Round 45 critic:** pines 4, snowride 5, snowvista 4.
**Round 46 critic:** pines 4, snowride 4, snowvista 3.5.

### Rounds 46–48: air in the forest, a storm deck, closer riders
- **Pines.**
  - The floor went back to a darker, layered brown needle duff and the trail to a brown dirt tread; the pale
    version had read as beige sand.
  - Forest effects (warm backlit haze, stronger shafts, a little exposure lift, the forest grade) now apply only
    below the snow line. On the snowy lookout they had milked out the vista.
- **Snow vista and snow ride.**
  - Erosion ribs and runnels run down the fall line of the snow-country slopes, so steep faces read as couloirs
    and rock bands.
  - Exposed rock keeps its warm grey-brown.
  - Clear-air storms keep more colour.
  - In storm the cloud slab flattens into a low deck with dark undersides.
  - Mist rags are torn apart with clear air between them.
- **Rides.** Both are framed closer, with the rider filling the lower centre as in the references.
- **Snow ride.**
  - The horse wades deeper, and its trench is stronger.
  - Sage, rocks and dead snags cover the near snowfield.
  - The crags now sit inside the frame.
  - Lone dead stalks are gone; they read as black stakes.
- **Billboards.** They are re-packed after a shot's dressing, so cleared sightlines clear at every distance. The
  vista's homestead now shows, with chimney smoke.
- **Ledge granite.** Cut by twice the joint planes, near-matte.
- **Tack and horse.**
  - Darker, rougher leather.
  - A dark walnut stock instead of a pale lit block.
  - The coat collar closes the gap that showed a black triangle at the nape.
  - A fuller tail.
  - A satin rather than glossy horse coat.
- **Captures.** They now render at 1.5× supersampling. Headless Chromium has a device pixel ratio of 1, while the
  target Mac renders at 2×, so the critic had been judging aliased foliage that a player never sees.

**Round 47 critic:** pines 4, snowride 5, snowvista 3. The vista was milky from haze, fixed in the round 48–49
commits.

### Round 49: first supersampled capture
- **Frames.** Rendered at `ss=1.5` and saved in `latest_frames/w49_*.jpg`. They have not been critiqued yet.
- **Vista.** A dark, flat storm deck with breaks of light, crisper mountains, textured forests, and the homestead
  with smoke in the lower centre.
- **Pines.** Lusher, with ferns and drifts of shrub along the trail, but darker.
- **Committed after the capture started:**
  - cliff strata with snow on the ledges
  - a trampled yard round the homestead
- **Handoff.** `scripts/build_handoff.py` packs the project and this log into `../DUST_AND_REDEMPTION_HANDOFF.md`
  for a fresh session.

*(The round-49 notes above are the first account's, from the GitHub branch; what follows was written in a separate repository rebuilt from the handoff file.)*

## New machine: the owner's MacBook (rounds 50 on)

The project was carried over in a single handoff file and rebuilt on the target machine itself, an Apple M4.

- **Captures now run on the real GPU.** `scripts/launch.mjs` starts Chromium in new-headless mode on ANGLE/Metal
  (`GL=swiftshader` brings back the old software path). The world is ready in about 15 s and a frame takes 2-3 s,
  against 5-15 minutes a frame before, so a change can be judged within a minute of making it.
- **New tools.** `scripts/snap.sh` builds, captures and lays each shot beside its reference with the tone numbers
  (`scripts/sbs.py`); `scripts/p.sh` is a one-shot probe; `scripts/mapdump.mjs` draws a shaded-relief map of any
  window of the world (cliffs, creeks, roads, timber) for scouting; `scripts/sheet.py` makes contact sheets of
  probe views.

### Round 50: light you can see in the air, mountains with geology, a built vista
The round 48-49 work was captured first (it had never been scored): pines dark and green with the sun out of
frame, the snow ride facing a smooth slab with a creek line scribbled up it, the vista a grey shelf with the
homestead hidden under its lip.

- **Volumetric sunlight** (`post.js`, `VolumetricShader`). The view ray is marched through the air and the sun's
  own shadow map is tested at every step, so haze glows only where the sun reaches it. Beams stand between the
  trunks, follow the real canopy gaps and leave shaded air dark. The old screen-space pass (which could only smear
  the sky's silhouette away from the sun) is nearly off under trees. The even forest haze was cut back to match.
- **Pines.** The shot looks down the trail into the sun (16.15 h, the sun just above the frame) with a lane open
  towards it, so the low sun reaches the floor in hard warm patches. A sixth of the trees within eighty metres are
  gone (an old, open stand). Two old pines stand close by the lens with their boughs in the top of the frame.
  The fern rosettes near the trail give way to low scrub and bunchgrass. The grade keeps true blacks, a cool
  shade and a warm light. Bark is darker; the largest pines are slimmer.
- **Mountain geology** (`world.js`, `terraceCliffs`). Every face steeper than about 35 degrees in the snow country
  is re-cut along its bedding: beds of uneven thickness, hard ones standing as cliff bands above benches, soft
  ones lying back, the whole dipping and wandering across the range, with gullies of scree left between
  buttresses. The slope rule in the terrain shader then lays snow on the benches and bares the risers. The
  canyon walls went from one airbrushed slab to banded cliffs.
- **Snow ride.** A scouted location: the canyon floor below the north-west massif, looking north-east up the
  valley with banded cliffs on the left and a spire in the gap. The blizzard sky is a pale mottled ceiling. Fog
  is thinner so near cliffs stay dark; exposure is a third of a stop lower. Creek lines no longer run up cliffs;
  seep lines hang with frozen falls instead. Boulders are bigger and capped, brush sits in clumps, the bare snags
  are gone.
- **Snow vista, built as a set.** A spur is raised from under the lookout to a knoll about 200 m off and 60 m
  below the lens (`world.raiseSpur`, ground only ever raised, everything growing there lifted with it). The
  homestead (a low log-brown barn, the cabin, sheds, corral) stands on its levelled crown among tall spruce.
  The lookout's own rock is placed against the frame: jointed granite blocks up the left side, slabs along the
  bottom, a boulder at the right. The shot waits for a break in the cloud deck to lie on the yard
  (`cloudLight`, the cloud-shadow field on the CPU). Lower knolls keep their snow.
- **Storm sky.** Clouds are lit as hard as fair-weather ones but are far thicker, so bodies are dark and torn
  edges bright. The deck is dithered (no more contour lines). Cloud shade lets 40 % of the sun through, which
  ended the grey camouflage blotches on snow slopes. Storm air and sky are bluer. Fog banks lie in separate
  patches with clear air between.
- **Rider and horse.** A smaller, dark bedroll; fine snow flecks instead of pinto blotches; a darker bay coat with
  less sheen; the coat collar no longer stands out as a plate; a darker satchel strap.

**Round 50 critic** (captured before the pines floor, sky and homestead-in-the-pines work above): pines 4,
snowride 4, snowvista 3, all "clearly". Its notes drove that later work: no sun dapple or debris on the pine
floor, striped rays over a yellow wash, squiggle ledges and a clear-blue sky in the snow ride, "forest painted
on as stains", a grey barn on a bald knoll and blob clouds in the vista.

### Rounds 51-53: sun on the pine floor, snowfall in the air, timber drawn tree by tree
- **Pines.** A longer lens from further back (35 degrees), so the horse no longer swells to twice the rider's width.
  The sky seen up through the trees is bright haze, not a hard-edged cumulus. Fallen cones are ovoids, fewer and
  smaller (the cone primitive read as triangular chips). The tread is a narrow hoof-worn line with needle litter
  drifted over it. The framing pines hard by the lens were taken out again: at a few metres the needle sprays are
  plainly cards.
- **Snow ride.** Falling snow now dissolves everything beyond a few kilometres into the tone of the sky
  (`uSnowfall`), which also removed a dark outline that hung above the left ridge: it was the crest of a far
  backdrop range showing through. Snow-country rock is near black. A 42 degree lens from further back.
- **Snow vista.** Distant spruce stands are drawn crown by crown in the ground shader (a dark cone lit on the sun's
  side, shaded snow between), fading to their mean tone with distance. The storm deck is a layered overcast with
  breaks. The barn is dark weathered timber.
- **Rider.** A smaller, curled hat brim; a tail of thinner hair cards; less snow speckle on the coat.

**Critic scores.** Round 51: pines 4, snowride 4, snowvista 3. Round 52: pines 4, snowride 3.5, snowvista 4.5.
Round 53: pines 4, snowride 3, snowvista 4. All "clearly". The scores have not moved from the handoff's (4, 5, 3):
within the critic's run-to-run spread of one point, the pines are level, the vista is up one and the snow ride
is down.

**What the critic keeps naming, in order of how often** (these are the next levers):
1. **Horse and rider** (every pair, every round): a smooth rump with no musculature, a strip tail, boxy bags, an
   untextured coat, legs lost in a dark mass. This is an asset problem, not a shader one. It needs a sculpted horse
   mesh with real anatomy and hair cards, and a clothed rider with folds; the procedural body has gone as far as it
   will go.
2. **Pines lighting**: still read as one sepia wash. The volumetric pass is physically right but the stand lets
   too little direct sun through; it wants higher contrast (denser canopy overhead, harder gaps) and a neutral,
   not gold, highlight.
3. **Snow-country terrain**: terraced contour banding (the strata pass over-reads from far away), blotchy snow
   masks, no sharp ridgelines. The heightmap is 2 m a cell; sharp arêtes need either displacement detail in the
   vertex stage or real mesh cliffs.
4. **Sky**: the storm deck is still flat wisps on blue from the lookout. It needs a second, higher-resolution
   cloud layer with self-shadowed bellies.
5. **Valley floor**: no river, tracks or clearings reading from the lookout.
6. **Ground dressing**: tiling snow normal, cloned shrubs, polka-dot scatter.

### Performance on the target machine (first measured this session)
The playable game had never been run on the GPU it was built for. On the M4 at the laptop's native 3024x1964 it
drew **4 frames a second**; at half that resolution, 8. Found and fixed:
- Each character was 20-40 separate meshes because every strap and buckle made its own material (2,500 draw calls
  a frame in town). Materials and textures are now shared and the parts merge: 900 calls.
- The ground's shader ran several times over for every pixel; a depth pre-pass now lets it run once.
- Three grass clumps in four were behind the camera yet ran the whole grass vertex shader; they are culled first.
- The shadow map and the water's mirror pass are redrawn every third and every second frame in play (stills take
  both every frame), and the mirror pass is skipped when no water is in reach.
- A frame governor lowers the render scale when the frame takes longer than 40 ms and raises it when there is
  headroom (`?nogov` turns it off, `?ss=` pins the scale).

Now: **about 15 fps at 1512x982, 28 fps at half scale; the governor settles at about 25 fps at a render scale of
0.56** on this machine. Native retina is still about 6 fps. The game is playable but soft; it is not yet the
"4K" the brief asks for at a playable rate. The remaining cost is shadows, terrain and grass in about equal parts.
Stills (`?capture`) are unaffected and keep every setting at its highest.

### Rounds 54-55: the horse, a real pine stand, the snow ride built as a set
- **Horse.** Hindquarters resculpted: a rump no taller than the back, two buttocks with a cleft under the tail,
  soft hip points, thighs that stand apart with daylight between them. The tail is a switch (narrow at the dock,
  fullest a third down, loose ends), not a fan. Coats: a dark bay for the forest, a blood bay for the snow ride
  (`setCoat`, a shot option), with the regular hair-stripe pattern replaced by noise. In snow the horse sinks to
  the cannons, not the hocks.
- **Rider and tack.** The stray ring strap and box satchel left over from the old sculpted body are gone from the
  real body (they stood out of the neck as a hook). A plain dark strap. The fur cap is turned down over the nape.
  Dark saddle leather. The bedroll is a rolled patterned blanket.
- **Pines.** Twenty-two big old pines placed by hand close along both sides of the trail (bare boles for ten
  metres and more), so trunks run out of the top of the frame, the sun comes through in separate beams and shadows
  lie in bars across the floor. The haze is a warm white, the eye opens up under the canopy. Tone numbers are now
  within a few points of the reference in every band.
- **Snow ride, built as a set** (`world.sculptDrifts`, `world.paintCreek`, `raiseSpur` with `flat0`): wind drifts
  with sharp backs over the open floor; the rider on the brow of a low rise so the floor falls away ahead; a
  rock-walled bench on the left with broken rock along its face and spruce on its rim; a frozen creek winding up
  the valley right of the rider, its banks lined with willow brush and stones; a heavy dark storm ceiling.
- **Tools.** Captures and probes now stop at once with the game's own error message when it fails to start
  (a start-up error used to hang a capture for ten minutes). `scripts/errlog.mjs` prints runtime errors for a shot.

**Round 54 critic** (before the snow ride set): pines 4, snowride 4, snowvista 3. Still "clearly" in all three.
What it names now: pines floor litter (cones, twigs, branches, stones in a continuous layer), uniform trunk bark
and flared bases, one symmetric young fir, hard radial rays; snow ride cliffs as slabs, a single mid-blue value
band; vista terracing bands, thresholded-looking cloud, no aerial layering.

### Rounds 56-57: timber in the valley, litter on the pine floor
- **Snow vista.** Closed spruce stands planted over the whole view below a treeline (about 19,000 trees, as
  billboards beyond 270 m), in broad masses with meadows between, with the ground under them shaded as forest
  floor: the mountainsides now carry dark timber up to a line, as the reference's do. The valley's creek is
  widened to a frozen river. The strata pass cuts true cliffs only (steeper than about 40 degrees); on ordinary
  valley sides it had drawn contour lines. The storm cloud's underside is modelled by its own density. The
  lookout's granite blocks have hard creased edges where joint planes meet. The yard is trodden and a sled track
  leaves it. River ice is matte (as a mirror it came out paler than the snow from above).
- **Pines.** Open ground in the pine belt is needle duff, not lawn. Forked twigs and fallen boughs lie in drifts,
  and close to the lens the ground shader draws a litter of sticks and needle clusters. The log is weathered and
  mossy along its top. Shrubs each take their own shade and glow a little against the sun. The light shafts have
  feathered edges and uneven dust; the haze reaches up into the crowns. A rim light draws rider and horse against
  the sun. A lighter, weathered hat.
- **Round 56 critic** (before the pines floor work): pines 4, snowride 4, snowvista 3, all "clearly".

Scores have stayed in the 3-4.5 band for seven rounds while the frames have changed a great deal; the critic's
notes have moved from composition and lighting to asset fidelity (bark, needles, rock, cloth, coat, cloud
volume). That is where the remaining distance is.

### Rounds 58-61: rock that is jointed, sun on the pine floor, snow under the spruce
- **Rock.** Outcrops and crags are built from bedding planes and two sets of upright joints (stacked blocks and
  stepped ledges, snow lying in patches on the flat tops) instead of an icosphere cut by planes at random angles,
  which made crystal shards. The scan is laid wider, in two unturned lays mixed by patches, with a narrow
  triplanar blend (two projections of its grain had crossed into a weave on oblique faces) and a fine grain close
  up. The lookout's rock takes the whole sky's light. A "snow packed in the joints" experiment drew white
  scribbles over the rock and was removed.
- **Snow ride.** The left wall is three tiers of jointed blocks standing proud of the slope from foot to rim.
  The storm grade leaves the darks near neutral and puts the blue in the snow; falling snow is grey-blue. Tall
  ragged pines stand among the spruce. Smoother snow. A dark fur cap; a muted bay and blanket.
- **Pines.** The stand of tall pines had closed the lane opened toward the sun; re-opened, the foreground floor
  lies in warm sun with the trunks' shadows across it. A few full-crowned pines hang boughs across the top of the
  frame. Twig, cone and stone litter is twice as dense and the drawn litter reaches the middle distance and runs
  over the tread. The fallen log is a knotted, out-of-round trunk.
- **Snow vista.** The ground inside a spruce stand is shaded snow, not a grey tint (tinted, a forested
  mountainside read as grey rock with white patches); the trees are what is dark. Stands are close-grown on the
  valley floor and thin with height to the treeline. Timber round the homestead. The sun is back to the side
  (behind the lens it lit the foreground but flattened every slope).
- **Horse and rider.** Light from above models every body (backs and rumps lit, bellies and inner legs in their own
  shade). Grooves between the buttock muscles and at the flank. Worn leather with rubbed and dry patches. A
  lighter, thinner tail.

**Critic scores.** Round 57: 4 / 5 / 4. Round 58: 4 / 4 / 3. Round 59: 4 / 4 / 3. Round 60: 4 / 5 / 4.
(pines / snowride / snowvista; all "clearly".) The best total is 13 against 12 at the handoff.

### Rounds 62-63: canopy-gap light, and two swallowed lines
- **Canopy-gap light** (`canopyGaps` in `shared.js`, shared with the volumetric pass). A forest roof lets the sun
  through in openings far smaller than a shadow map of the whole stand can hold. One noise pattern laid across the
  sun's own direction now gates both the lit haze and the direct light on every surface under trees, so the air
  breaks into separate shafts and each ends in its own pool of sun on the floor. `U.uCanopy` follows the forest
  cover round the camera. The oak-wood `forest` shot gains rays and dapples from it too.
- **Pines.** A high afternoon sun (15:00) and no lane cut toward it: the crowns over the trail dapple the floor.
  Thick lit dust and a wide exposure are now asked for by the shot (`volDensity`, `volFalloff`, `expK` on a shot),
  not global defaults: as defaults they washed out the ranch, the autumn road, the oak wood and the bayou.
- **A pitfall, relearned.** Section 7 of the handoff warns that a comment on the same line can swallow code. It
  did, twice: a trailing comment in `post.js` had cut off `v.uBase.value = ...` since round 57 (the haze layer
  was measured from sea level, not from the ground under the camera) and then `v.uFalloff.value = ...`; another in
  `terrain.js` had cut off the creek ice's normal. Both restored. An audit script for the pattern found no others.
  Never append a comment to a line that holds more than one statement.
- **Play performance re-measured.** The visual work of rounds 54-62 had slowed play from 15 to 10.5 fps at
  1512x982: the volumetric pass had grown to 19 ms a frame (64 steps, a 3-D dust noise and the gap pattern at
  every step). In play it now takes 22 steps without the dust noise (2 ms); stills are unchanged. Back to
  13.5 fps at 1512x982, 22-25 fps where the frame governor settles (render scale about 0.5).
  `scripts/proftoggle.mjs` measures what each part of the frame costs.
- **Other biomes checked** (autumn, desert, jungle, town, ranch, oak forest, heartland vista, bayou, gallop): no
  regressions after the fixes above.

**Critic scores.** Round 61: 4 / 4 / 3. Round 62: 4 / 5 / 3. Fourteen scored rounds this session; every one
between 3 and 5 on every shot, every one "clearly". The critic's notes are about asset fidelity now: bark,
needle cards, rock surface, cloth, the horse's coat and anatomy, cloud volume. The frames have changed a great
deal and the score has not, which says the remaining distance is in the assets, not the staging.

### Rounds 64-65, and where the loop stands
- **Round 64 made the pines worse (3).** A new plated bark read as "cracked mud at the wrong scale", denser cones
  as "identical dark dots stamped on an orange sheet", and the corrected haze base as a fog wall. Withdrawn in
  round 65: the furrowed bark is back, cones are fewer and closer to the duff's tone, the duff is a darker
  grey-brown, the dust thinner, the sun pools a metre or two across. Kept from round 64: boles that wander and
  taper in five sections, a few thick dead limbs, needle fringes that glow against the sun.
- **Play performance.** Value noise comes from a 256 x 256 half-float lattice texture (one fetch for four hashes),
  play shadows are 2048, the ground mesh in play is the standard LOD. 14.5 fps at 1512x982, 28 fps at half scale,
  about 25 fps where the governor settles (0.56). Native retina is about 5 fps.

**Critic scores.** Round 64: 3 / 4 / 3. Round 65: 4 / 5 / 3.

**All sixteen scored rounds of this session** (pines / snowride / snowvista):
50: 4/4/3 · 51: 4/4/3 · 52: 4/3.5/4.5 · 53: 4/3/4 · 54: 4/4/3 · 56: 4/4/3 · 57: 4/5/4 · 58: 4/4/3 · 59: 4/4/3 ·
60: 4/5/4 · 61: 4/4/3 · 62: 4/5/3 · 64: 3/4/3 · 65: 4/5/3. The handoff's last score was 4/5/3. Every verdict was
"clearly".

**Conclusion.** Staging, light, terrain, sets and dressing all changed a great deal and the blind score did not
move outside the critic's own run-to-run spread. What the critic names now is asset fidelity, the same items
every round: the horse and rider (anatomy, coat, cloth, tack), bark and needle foliage, rock surface, the snow
surface, cloud volume, and a valley floor with a river and forest in it. Procedural stand-ins for those have
reached their ceiling at about 4 out of 10 against RDR2. The next step that can move the score is real assets:
scanned PBR materials (bark, forest floor, granite, snow) and a sculpted, textured horse and rider. That needs
the owner's go-ahead to download them.

## Loop restarted (2026-10-08): the owner asked for it to run on for days

### Rounds 66-69
- **Tools.** `scripts/turntable.mjs` takes six chase views of the rider and horse in one page load; the `studio`
  shot stands them on open prairie under an early-afternoon sun.
- **The rider's coat is a garment** (`tailorCoat` in `creatures.js`). Pushed out along the skin's normals it was a
  second skin (shoulder blades, spine and buttocks showed through; with a glossy leather it read as a bare back).
  The cloth is relaxed, then draped: working down from the shoulders, at every bearing round the body it falls
  from whatever stood furthest out above it. It hangs over the belt, with long folds, and is matte with a fine
  grain. The strap is fitted to the tailored coat.
- **Horse.** The mane is one continuous fall of hair in layers down the off side of the neck (separate cards had
  stood along the crest as a row of teeth). Dark saddle leather, rounder bags, dull buckles.
- **Vista: a scouted lookout.** The search-found summit looked into a side notch. The shot now stands on a rock
  knob built up from the west shoulder above the mouth of the main valley (`?vistasearch` brings the old search
  back), looking north-east up its length: the floor with its frozen river on the right, timbered slopes either
  side. Low morning side light.
- **Lookout rock.** A 44-subdivision mesh; each joint face a plateau and each edge a short rounded riser
  (`soft()`), so blocks have weathered arrises; spalled faces; speckled granite with rain streaks; crisp-edged
  crust lichens; thin ragged snow on the flats; frosted grass and brush rooted on the blocks. Cool grey.
- **Homestead.** A broad, level crown with gentle flanks; a broken ring of spruce close round the buildings.
- **Valley fog is a layer of air** (`applyAtmosphere`): a bank between the valley floor ahead of the lens
  (`U.uBankBase`) and a ceiling 78 m up, integrated along the sight line, in banks. Painted onto surfaces by
  their height it had never read as fog in four attempts.
- **Storm sky.** The deck is broken into great masses over a bright high overcast seen through the breaks.
- **Erosion** (`world.erodeSlopes`): gullies cut down the fall line of snow-country slopes in two sizes, in
  swarms; their walls bare to rock.
- **Pines: god rays.** Inside a stand the conifer crowns no longer write to the shadow map (`windDepthMaterial`
  with `porous`, gated by `U.uCanopy`); the canopy-gap pattern carries the roof's shade instead, so about a fifth
  of the floor is in sun and the air is cut into narrow shafts, on a 150-step march for stills. Trunks keep real
  shadows, which fall as bars across the sun streaks. A low sun ahead again (16.35 h). The floor is grown over
  with olive grass off the tread; shrubs are olive, not card green; no full crowns hang near the lens (their
  needle cards read as broadleaf blobs).

**Critic scores.** Round 66: 4 / 5 / 3. Round 67: 3 / 4 / 5. Round 68: 4 / 4 / 4. The vista reached 5 for the
first time (round 67, the new lookout).

### Round 70
- **Crags** (`world.cragSlopes`): a ridged relief, buttresses about 190 m apart with smaller ones on their
  flanks and tens of metres high, on every snow-country face steeper than about 25 degrees and on the high tops.
  Faces now have steps too steep for snow (dark rock) beside ledges that hold it. The map's own mountains in the
  vista read as rock and timber for the first time.
- **Snow ride.** Three spurs raised in the middle distance, left at 330 m, right at 560 m, left at 830 m, with
  steep rocky flanks and timber on their crests: the valley closes in plane behind plane instead of running
  empty to walls a kilometre off. The whole horse is in frame (legs in the snow, tail). Conifers carry more snow
  while it falls. Snow on coats is a soft veil, not speckle. A drab canvas bedroll; rounder bags.
- **Vista.** The backdrop north of the map: its valley has walls within a kilometre of the floor, crags on the
  ground between, timber on the floor and lower slopes with crown speckle, and the region's relief takes over
  within a kilometre of the edge (it had lain beyond the map as smooth extruded dunes). Past three kilometres
  ranges flatten toward pale blue-grey. The storm deck is two-thirds closed.
- **Pines.** A key shaft (`U.uCanopySpot`, a shot's `keyShaft`): one gap in the roof whose light falls on the
  rider. Fallen needles drawn in two fine layers close to the lens.
- Still open in the vista: a smooth snow massif six kilometres off (backdrop, too coarse a mesh for crags).

**Round 69 critic:** 4 / 3 / 4.

### Rounds 71-73
- Rider and tack reworked against a zoomed crop of the reference: collar up, leather patina, fitted coat with
  readable folds, thin tan strap, small grey roll, flat bags, dark bay with a coat sheen, rim light on hat and
  tack, three-quarter camera. Snow ride framed as the reference (whole horse, hat four-tenths down).
- Pines: deep shade under the roof (ambient cut by forest cover) with brighter sun pools; dark sticks, spiky
  cones, flat grey stones, seedlings, a weathered log.
- Vista (round 73, captured, not yet scored): the base scatter's lone trees removed and the timber replanted in
  masses following the drainages, on ground up to about 50 degrees, sizes from saplings to giants; dark ground
  deep inside stands; frosted blue-grey far trees.

**Critic scores.** Round 70: 4 / 4 / 5. Round 71: 4 / 4 / 5. Round 72: 4 / 5 / 5 (total 14, the best yet;
12 at the handoff). All "clearly".

**Next (planned, not started):** pines track made visible again (lighter dirt, less litter over it, no grass
crown), larger stones and fallen branches along the verges, curved dead limbs, clustered softer shafts, more
colour separation in the forest grade; darker, less orange tack; a less saturated red bay with less sheen in
snow; re-check the nine other shots (not re-run since round 68).

### Rounds 74-76
- **Pines.** A canopy: full-crowned pines and spruce standing back from the lane (the stand of old boles alone had
  no boughs in frame); five small sprays to a bough instead of three big ones; a rutted track with grass at its
  edges; stones and fallen branches on the verges; dead limbs that sag and bend; shafts in clusters with soft
  edges; less haze, more ambient light under the roof.
- **Vista: a higher lookout** (`?vistalow` brings back the shoulder): the west ridge five hundred metres above
  the floor, looking north-north-east over ridge after ridge to the horizon. The height fog now rests on the
  valley floor ahead (`uBankBase`), not at the ridge's foot (which filled everything below to a white bowl).
  The mid-height mist is a layer the sight line crosses, like the valley bank. `uSnowPad` keeps a built knoll
  under snow whatever its height (above the crest line its convex top was stripped to dark rock). The outcrop's
  joints are closer and its blocks rounded: a weathered mass split by cracks, not three boxes.
- **Storm sky, painted** (`stormDeck` in `sky.js`): two layers on the planes they hang at, density from smooth
  warped noise stretched so there are true thick masses and true breaks, shaded by which way the surface faces
  the sun, dark where thick, pale at torn edges, over a bright overcast. Used when a storm stands in clear air
  (the ray-marched slab at a low angle kept coming out as streaks on a flat ground).
- **Snow ride.** The left bench is a thirty-metre face cut into rock risers and snow ledges (`world.ledgeBox`);
  the jointed blocks stood about the snowfield are gone. Spruce are ragged (uneven boughs, lopsided crowns,
  missing tiers). Drifts are shaped by a directional skylight while it snows. The horse is larger in frame.

**Critic scores.** Round 74: 4 / 4 / 4. Round 75: 4 / 4 / 5.

### Round 77
**Round 76 critic:** 4 / 4 / 3. The ridge lookout had depth but "no valley: a fog void and a wall", marbled
backdrop shading, lenticular smudges for a sky. So:
- **Vista: over the valley's mouth, looking straight up its axis** (`?vistaridge` and `?vistalow` bring back the
  earlier two). The lens stands on a 150 m knob built in the mouth; the homestead's knoll is 200 m ahead and 60 m
  below it; the floor runs away between two rocky, timbered flanks to a notch in the ranges, with a fog bank lying
  across it. The river meanders over the flat floor (the survey's own creek line erased first). The forest
  channel is *set* in the planting wedge, so no tint is left where no stand is planted. Cloud shade is deeper and
  the sun in the breaks stronger: pools of light on the flanks. The outcrop is warm ochre granite with thin
  feathered snow; brush is partly russet; bunchgrass keeps its straw; no stalks; nothing within arm's reach of
  the lens. Spruce of every height round the yard, a few old pines over them.
- **Storm sky.** The painted deck's layers are heaped cloud (`billow`: rounded lumps with creases, in octaves) on
  great masses with breaks, slate rather than navy.
- **Snow ride: the main valley** (`?canyonride` brings the canyon back): its floor, looking north, timbered
  flanks with rock on them either side and a notch at its head. Frozen braids are grey-blue ice half drifted
  over (dark, each was a black pond). The cliff band's rock is slate blue under falling snow. A darker bay with
  almost no sheen in snowfall; a paler trench under the horse.
- **Captures use a fresh page per shot** (`FRESH=1`, the default in `snap.sh`): each shot dresses a pristine
  world, so one shot's raised ground and planted timber never show in another's frame.

**Critic scores.** Round 77: 4 / 4 / 4.

### Round 78
- **Storm sky is the ray-marched cumulus.** The cloud slab now flattens only inside snowfall; the painted deck is
  down to a wash. The vista's sky is heaped grey cloud with dark bellies.
- **Vista: grown timber.** The valley's spruce were ten-metre saplings on a 4.6 m grid: a sprinkle of black
  spikes under which the homestead's buildings stood like warehouses. Replanted at 15-35 m in broader stands;
  the homestead is 300 m off with tall spruce round it; the knoll's flanks keep their snow (snow pad to a
  half slope); the stand's floor tint is taken off the knoll and the sightline; roof snow lies in drifts;
  the fog bank is a veil (cap 0.42). Ledge granite measured against the reference and cooled/darkened.
- **Snow trough** is churned and only a little darker under snowfall; no sun glints in a blizzard.

**Critic scores.** Round 78: 4 / 3 / 5 (vista back to its best; both riding shots: "mannequin rider, balloon
horse, flat ribbon tail, boxes for tack").

### Round 79: horse, rider, tack, framing, rock
The riding shots' weakest thing has been the same for thirty rounds, so this round went at it directly.
- **Framing measured off the references.** Pines: lens above the rider's shoulder looking down the trail,
  rider left of centre, hat a third down, frame cutting the horse at the croup (`?pinesold` = rounds 50-78).
  Snow ride: lens six metres back and near three up, whole horse in frame, hat just under half way down
  (`?rideold`).
- **Figures are lit.** `uCharFill`: light bounced from the ground and lit air onto figures (0.05 in the open,
  0.27 under canopy); measured against the reference the rider's back was a third as bright as it should be.
  Rim light cut to a third (rider and tack wore a glowing outline).
- **Rider.** Leather coat a mid brown with quieter patina; square shoulders, straight sides; folds shallower.
  The flat coat-tail panels are gone (two black slabs on the horse's back from above).
- **Tack.** Blanket drab wool (was red with a cream zigzag); satchel worn brown (was orange); bedroll a lumpy,
  sagging hide roll tucked in at the ends (was a drum with a painted spiral lid); cantle a rounded roll (was a
  half-drum showing its cut faces); fender a leaf of leather on the horse's side; rifle butt and holster shaped.
- **Horse.** Hind legs built on real angles: stifle forward, gaskin sloping back to a hock that is deep fore
  and aft and narrow from behind, hamstring from buttock to point of hock (bones moved to match; standing
  offsets removed from the walk). Knees and fetlocks flat, cannons slimmer. Tail is a solid core with 72 locks
  lying on it, to the hocks, hanging against the quarters. Hair-lie relief and sheen streaks fade out before
  they beat against the pixel grid (the rump was twill).
- **Rock.** Crack networks (cell borders on three planes: a close one a pace across and a coarse one for cliffs)
  drawn dark and cut into the normal. Big outcrop variants are only half snapped to their joint lattice: a
  weathered mass, not a pile of boxes. On ledge rock the lichen is hand-sized and faint (it was camouflage), the
  stretched scan is nearly out, snow edges break into grains.
- **Pine-belt grass** greyer and darker (a strip of lime down the trail in the sun).

**Critic scores.** Round 79: 4 / 3 / 5. No movement in the totals. What it saw: the coat's tan patina "reads as
bare skin", hat brim cartoonishly curled, horse legs now *too* thin ("stick legs"), pair too small in the snow
frame; the vista outcrop went from boxes to "melted wax with a spiky silhouette" (the half-snapped lattice
overshot) with snow "smeared into creases instead of sitting on up-facing surfaces"; snow ride's valley walls
are still a smooth dark mass and a washed pale sheet. Next: outcrop back toward planes and joints with snow on
its tops; snow-ride walls; horse legs' girth; coat darker and less mottled.

### Round 80
- **Coats have thickness.** The hero is the scanned human body with clothes pushed off the skin; the coat stood
  an inch off it all round, which is why it "read as bare skin". The leather jacket now stands 4 cm off the trunk
  and the shearling 8 cm, sleeves are tubes round the arm, the shoulder line is padded and squared.
  Patina fainter, leather darker; hat is worn hide with a nearly flat, slightly wavy brim.
- **Horse legs** got their girth back (cannons with tendons, fuller gaskin).
- **Snow-country cliffs are bedded rock** (terrain shader): beds of uneven thickness dipping along the valley,
  each its own shade, upright joints that do not line up from bed to bed, snow on the beds' tops in broken
  ledges with shade beneath, rime plastered on by a storm; rock under snowfall is 1.75x lighter (measured
  against the reference's storm cliffs); no green turf shows under the snow line.
- **Snow ride framing** re-measured: lens 6.4 m back at hat height, nearly level, horse three-quarters on.
- **Outcrop**: 62% snapped to its joints with a level top (snow lies on what faces up, in patches), then fins
  and spikes worn off by a relax that acts hardest on what stands proud.

**Critic scores.** Round 80: 4 / 3 / **6** (the vista's best: "composition and aerial perspective convincing",
"cliff banding plausible"). Riding shots unchanged: rider "bare clay", horse "toy", the pair does not sink into
or disturb the snow; left cliff's stuck-on slabs are "floating bricks"; snow frame has no deep darks.
(Found while comparing crops: my round-79 measurement of the reference rider's back had sampled forest floor.
The reference coat is dark leather, median luminance 35 with highlights to 105: contrast, not brightness, was
what ours lacked.)

### Round 81
- **Key light on the rider** (`uCanopySpot` doubles as a kicker for figures): inside the pine shot's shaft the
  hat, shoulders and tack take the sun on whatever faces it. Leather jacket is dark (0x3c2c20) with finger-wide
  crinkles in its relief; hat is worn hide with a narrower brim and a plaited cord; satchel flat and dark;
  bedroll dark hide; blanket darker.
- **Winter rider**: a roll of paler fur turned up round the cap and a broad shearling collar on the shoulders
  (lumpy tori of fur); snow lies on shoulders, hat and roll (looser up-facing test, 0.7).
- **Horse in snow**: legs caked white to the knees and hocks, thinning upward; a low haze of kicked powder at
  each leg and behind.
- **Snow ride cliff**: the boulder groups that landed on the bench's face are removed (the "floating bricks");
  ledges are short broken runs; joints darker and visible further; rock back down to 1.2x under snowfall with
  less rime (the frame had lost its darks).
- **Outcrop**: cooler stone, fainter rain stains, snow only on what is near level.

**Critic scores.** Round 81: 4 / 3 / 5 (the vista swings a point between runs on near-identical frames).
Still: horse "balloon"/"toy", rider "matte blob"/"orange mannequin", cliff "flat slab with painted dashes".

### Round 82
- **The snow ride's cliff is built of rock.** Four tiers of the big outcrop meshes stood up the bench's face from
  foot to rim, shoulder to shoulder (`?nocliff` leaves the bare slope). Under falling snow rock is wet slate
  blue with rime blown onto its faces. Loose boulders and brush are cleared off the face after all dressing.
- **The horse walks.** A shot can hold the horse mid-stride (`stride: 0.16`); both riding shots do.
- **Winter coat** a duller brown (it read as orange).
- **Pine-belt grass** darker again, straw no longer bleaches in a sun shaft; the fallen log's moss is in
  patches with grey bark between.

**Critic scores.** Round 82: 4 / 3 / 5. Flat. Snow ride's first complaint is now depth ("valley empty, no
layering; right wall white-on-white; left cliff a mid-grey monolith with no dark anchor"), then the figures
("rider 25% too small for the horse"). Vista: the strata banding on the right massif "reads as real geology,
the best single element"; the outcrop is still "melted", cracks "stretched".

### Round 83
- **Snow ride depth.** Timber scattered up both valley walls from 120 m to a kilometre, in stands and singles of
  every height with old pines among the spruce (5200 tries, thick where a noise field says so). Cliff bands on
  moderate snow slopes: in zones a few hundred metres across, the beds' risers stand clear of the snow as dark
  rock. Storm rock is near black (the frame's dark anchor). Blizzard eased to 0.62 so the cloud deck has
  structure and the far walls are seen.
- **The mounted rider is 1.1x**: a big man on his horse.
- **Outcrop tops** are broken and tilted (a dead-level cut made stumps iced with snow); cracks are hairline and
  of varied weight; brush and frosted tufts stand on the blocks' tops.

**Critic scores.** Round 83: 4 / 3 / 5. Three rounds flat (81-83) while the frames changed a good deal: the
critic's first item on both riding shots is still the horse and rider as assets, then ground detail (pines)
and mountain depth (snow ride).

### Round 84
- **Pines: a break in the timber toward the sun** (`sunGap: [62, 170, 4.5]`, `?nogap` to compare): a lane a few
  trees wide felled along the sun's bearing from 62 m to 170 m ahead of the lens. The bright sky now stands
  between the trunks where the light comes from, the shafts have a source, and the frame's tone figures sit on
  the reference's (thirds 103/75/53 against 107/72/50, p95 181 against 179). Haze thinner (0.0026).
  (Two bugs on the way: measured from the horse the lane missed the lens's line of sight, and the camera has
  not been moved to the shot yet when the dressing runs, so the lens position is worked out from the shot.)
- **Pine-belt grass** is let further in under the trees and broken into clumps a few paces across: no ruled
  green stripe beside the trail.

**Critic scores.** Round 84: 4 / **4** / 5. Snow ride back to 4 ("cold blue-grey grade and exposure sit close to
the reference"). Its first item is now the backdrop: "right wall a pale near-white mass with stair-step banding,
no exposed dark rock; the valley ends in one blank wedge where the reference stacks five ridgelines". Pines:
rider/horse first, then ground ("blurred smear, flecks that read as decals"), trunks, no dapple.

### Round 85
- **Rock patterns are triplanar** (`tnz`, `tfb` in the rock shader). Every pattern on a rock (mottle, lichen,
  speckle, snow flecks, drift, crack weight) was a 2-D noise of a slanted projection of the position, which
  runs out into streaks on any face lying along the projection: the "stretched, smeared texture" the critic
  has named for ten rounds. Now each is laid on the three planes and blended by the surface's facing.
- **Ledge snow has one crisp ragged edge**: it lies on what faces up, in patches, and stops at a line broken
  at every scale from a pace to a finger (faded over a range of slope it was soft white blobs). Tufts on the
  blocks are brighter and more frosted; the twig brush is off the block tops.
- **Storm sky and far air measured against the reference**: ours was a fifth too light and greyer, the sky
  flat (p5 153 against 91). Ceiling darker and bluer with deep masses and pale rifts; far air under snowfall
  darker, bluer and thinner (rock a kilometre off still shows dark).
- **Conifers stay dark under falling snow** (snow load 0.68, was 0.85: every tree was a white cone); single
  old pines stand out on the valley floor at every distance.
- **Horse in the storm**: flakes caught all over the coat's upper side, sheen off, the trough under it barely
  darker than the field (an overcast casts no shadow pool). Collar fur greyer.

**Critic scores.** Round 85: 4 / 3 / 5. The riding shots stay inside 3-4 and the vista inside 5-6 whatever
changes: nine rounds (77-85) with totals of 12-13. The critic's lead item moves round to round (rider, floor,
backdrop, rock) because each frame has several things at the same distance from the reference. Noted from this
report: ledge snow went from "soft blobs" to "hard-edged decals" (the reference's is a thin granular dusting,
not patches at all); the rider still reads "child-sized"; my snow flecks on the horse are "salt-and-pepper
noise"; the lone pine on the floor is "a lollipop bare trunk"; the far wall's terraces are heightmap stair-steps.

### Round 86
- **Pines framing**: the horse turned further from the lens (turn -0.62) and the lens lower and level
  (camRel [-0.35, 2.3, -4.95]), so the horse's neck, head and ears stand clear to the right of the rider as in
  the reference (square behind, "the animal looks truncated"). Sun gap widened for the new line of sight
  ([48, 190, 7.5]); tone figures 106/80/55, p95 172 (reference 107/72/50, 179).
- **Pine floor dressed across the lens's field** out to thirty metres, off the tread: 26 clumps of leafy scrub
  knee to waist high, 20 pieces of deadfall (limbs and poles), 30 half-sunk stones, all real meshes that cast
  shadows. Satchel strap dark.

**Critic scores.** Round 86: 4 / 3 / 4.5. Showing the horse's head in the pine shot traded "truncated" for
"undersized head, blue blocky bridle, vinyl toy". Found while chasing the snow ride's pale far wall: its faces
are steep (slope 0.4-0.85 sampled) and are rock, but the lens stands inside the valley's fog bank, whose colour
is near white whatever the weather, so every far face is veiled pale. Fixed in round 87.

### Round 87
- **The fog bank takes the storm air's tone under falling snow** (it was near white whatever the weather, and
  the snow ride's lens stands inside it): the far faces are no longer veiled pale. Rock under snowfall is dark
  wet slate (0.9x, was lifted 1.2x), less rime.
- **Nothing on a figure shines in a snowstorm**: roughness to 0.97 under snowfall for coat, hide and leather;
  horse coat rougher everywhere (0.84) with a weaker sheen; snow lies as a soft dusting along the horse's top
  line with a few flakes below (sprinkled evenly it was salt-and-pepper).
- **Snowfield**: drifts twice as deep and shaded harder under overcast; dark-sided boulders standing out of the
  snow in the near field; ledge cuts removed from the cliff's foot (a flat pale strip); snow settles on every
  ledge of the outcrops in a storm.
- **Snow ride lens** closer (5.4 m), exposure +7%. **Storm grade** bluer by (0.95, 1.01, 1.07): both storm
  references measured bluer than ours; snow ride now 113/136/169 against 109/141/177.

**Critic scores.** Round 87: 4 / 3 / 5. Snow ride: "whole frame tinted cobalt" (my uniform blue multiply: the
reference measures bluer on average, but its highlights are neutral white and its blue is in the shade and the
air), "snow surface one uniform crinkle, like crumpled foil" (the drift shading I strengthened also amplified
the fine ripple).

### Round 88
- **The horse's neck and head are a horse's length.** Measured, the neck was 0.6 m and the head 0.5 m: a pony's
  on a draught horse's body ("short stub, undersized head"). Neck a hand longer, head a fifth longer (0.6 m),
  bridle and reins refitted; the mane falls on the near side too.
- **The rider sits a long western leg** (thigh sloping down, shin a little behind the knee; he sat like a man
  on a kitchen chair) and is 1.15x. Leather relief is a grain, not lumps; seams drawn stronger.
- **Storm grade tints mid tones and shade only**; highlights stay neutral white (uniform, the frame was cobalt).
- **Snow under overcast is shaded by its broad forms only** (with the fine relief it was crumpled foil); ripple
  and fine relief eased under snowfall.

**Critic scores.** Round 88: 4 / **4** / **6**: total 14, level with the best (round 72). The vista's margin is
"the narrowest of the three"; the snow ride's left cliff "is the only surface that holds up". Noted: the soft
snow dusting on rider and horse is being read as gloss ("plastic highlights", "wet sheen") while the critic
also says there is no snow on them; the mane shows as "a blue strip"; trunks still "perfect cylinders".

### Round 89
- **Snow ride: ridges stand one behind another in the gap.** The three spurs' toes are carried in to the valley's
  axis (ending a hundred metres aside, the first was hidden behind the cliff and the others behind the timber),
  with bands of outcrop on their flanks and three times the timber on their crests (`?spursold` to compare).
- **Snow on rider and horse lies in clumps with an edge**, on what faces the sky only (shoulders, hat, bedroll,
  croup). As a soft veil it was read as "plastic highlights" and "wet sheen". Hat trim is the cap's own dark fur.
- **Mane is matte** (it mirrored the sky as a blue strip along the neck).
- **Trunks stand in the ground**: the butt swells into the floor in a curve with longer buttress roots; the
  bark is dark with shade and banked duff at its foot; each tree has its own tone and warmth, weathering in
  broad patches round and up the bole, grey-green lichen low on it.

**Critic scores.** Round 89: 4 / 4 / 5. The snow ride has held 4 for two rounds (it sat at 3 for most of 79-87).
Both riding shots: the horse and rider are the first item again ("the same rebuild lifts both").

### Round 90
- **Plants grow on the rock itself.** The ledge's planting was done on the ground, which under the outcrop is
  buried inside the blocks, so almost none of it showed (ten rounds of "no vegetation on the foreground rock").
  Now each plant is set where a ray from the lens strikes the blocks' own surface (`InstancedMesh` raycast)
  wherever it faces up enough to hold soil: ~200 clumps of frosted grass and russet brush along every shelf.
  Two brush plants in three are russet whatever the frost; tufts are ochre under a light frost. The vista's
  bottom third now measures 85 against the reference's 87 (it was 100).
- **Dry storm sky**: cells run together into great masses where the weather map is thick, with a high pale
  overcast showing bright through the breaks (dark slate there made white puffs on navy); bellies darker,
  tint nearly neutral.
- **Rock close to**: fine bedding lines and grain at two scales, the fine normal lay at 0.85; hair-thin snow in
  the fine up-facing joints (a hand wide along the big joints it was white lightning: withdrawn).

**Critic scores.** Round 90: 4 / 4 / 5. The vista's foreground rock dropped from first complaint to third, but
the new plants are "fans of crossed quads in one saturated orange-tan" (over-warmed) and the reworked sky is
"a flat dark-navy gradient with thin unlit wisps, darker than the sunlit snow" (worse than before). Snow ride:
"the world ends at one hedge-like band of conifers in front of a pale wall" (the spurs behind it are hidden).

### Round 91
- **Snow ride: the valley floor opened up.** Five trees in six are taken off the floor between the lens and the
  spurs, so single trees and small groups stand at every distance with the ground and ridges seen between them;
  the spurs are nearer (toes at 255, 430 and 660 m) where the snowfall has not yet taken their darks.
- **Pine tread and duff measured against the reference's floor** (ours was half again as light, and tan): the
  tread is dark red-brown soil, mottled; duff darker and redder; fallen needles are pale straw on it, twice as
  many; cones and twigs lie on the tread too (the clutter layers kept off it).
- **Ledge tufts** are frosted grey-straw, each its own tone (russet is per material now: brush 0.7, tufts 0.22).
- **Storm sky**: the breaks are bright (the lightest thing in the sky), cloud bellies lighter, masses less merged.
- (Pitfall again: a comment appended after `.map(` swallowed the arrow function. Never comment a line that
  continues.)

**Critic scores.** Round 91: 4 / 3.5 / 5. Snow ride's first item: the right mountainside "visibly terraced like
a quantised heightmap" (the level strata; tilted in round 92). Pines: the figure, then trunks "striped
cylinders, evenly saturated orange-red", canopy "painterly leaf cards". Vista: forest "black-and-white speckle
with no distance filtering".

### Round 92
- **Cliff strata dip ten degrees and bend** instead of lying level ("visibly terraced like a quantised
  heightmap"). Done in two steps, `World.terraceCliffs()` then `terraceCliffs(true)` after planting, because a
  first attempt that changed the heights before planting reshuffled every tree, rock and bush in the world
  (planting draws its random numbers according to the ground it finds): the pine shot moved and a cactus stood
  beside the desert rider. `?leveldip` keeps the level beds. The shader's beds and cliff bands dip with them.
- **Winter rider as the reference's**: tan shearling coat, a close fur collar (the wide lumpy one stood out like
  a rock on his shoulder), tan fur hat; a brighter blood bay with flakes on it and no snow patches; figures
  take 0.2 more sky fill under a storm's overcast (they were black cut-outs); a coiled lariat on the near side.
- **Bark**: furrows wander three times as far, plates are short, furrow contrast lower, tone grey-brown and
  darker (the saturated cinnamon lit up orange-red in the low sun). Pine exposure 1.23.

**Critic scores.** Round 92: 4 / 3.5 / **6** (vista: "at thumbnail size this nearly passes"; "the right-hand
mountain mass has believable snow and rock breakup"). Snow ride's first item is still "horizontal contour-line
steps" on the right wall: at that distance it is the shader's snow-ledge dashes on every 4 m bed, not the cut
terraces. Pines: "the forest alone would be about 5.5; the horse and rider are about 2.5 and drag it down".

### Round 93
- **Vista: a treeline.** Timbered to 440 m and more, both flanks were one even carpet of trees from floor to
  skyline. Now the forest fills the floor and lower slopes and gives out in a ragged line at 300-400 m, with
  open snow and rock above it, tongues of timber climbing the gullies, and trees stunted toward the line
  (`?hightimber` to compare).
- **Snow ride: the snowfield falls away from the horse's feet** as one long ramp down to the creek (15 m over
  200 m), so the whole middle ground faces the lens (`?lowbrow` = the old flat-topped rise, whose lip hid the
  floor however high it was). On it: 46 boulders under snow caps and 60 clumps of dead brush out to 300 m.
- **Far rock.** Big outcrops are drawn out to 1.5 km (the rock layer stopped at 420 m: the spurs' rock bands
  and the far end of the cliff were simply not drawn). Snow ledges are drawn bed by bed only within a
  quarter-mile (further off they were white dashes ruled across the wall: the "contour steps"); from afar the
  cliff bands are whole ribs and buttresses of dark rock a hundred metres across.

**Critic scores.** Round 93: 4 / 4 / 5. Both riding shots: the hero asset first again ("rebuild the horse and
rider: proportions, coat and leather materials, rim light, contact shadow"). A close crop of our pine rider
shows why: a charcoal sack of a coat lit flat by the uniform fill, a boot like a bare foot with the stirrup
hanging a foot away from it, a blanket striped like planks, the rifle butt standing up beside his thigh, the
mane a blue-black block.

### Round 94: the rig, from a close crop
- **Stirrups ride on the rider's feet** (a wooden hoop and tread round the ball of each boot, shown only in the
  saddle); the horse's own rings, which dangled a foot from the boot, are gone. Boots have a sole and a stacked
  heel and a looser shaft (the scanned foot in a skin of leather was a bare foot).
- **No loose slats.** The two that stood beside the rider's thigh and on the blanket were the holster (fixed to
  the hips, so upright behind a seated thigh: now hung on the thigh bone) and the rifle butt (now on the +x
  side; the shots' lenses stand on -x). The fender is a plain leaf laid to the barrel's curve.
- **Lariat** coiled over the near-side bag, as the reference's. **Blanket** plain dark felted wool (the striped
  weave lay under the saddle like planks). **Mane** hangs clear of the neck (its locks lay inside it and showed
  as stray ticks), warm dark, low alpha cut-off.
- **Light on figures**: the fill comes from above (0.3 underneath to 1.2 on top: laid on evenly it flattened every
  form into one tone); rim light back up to a third of the old glow (0.34 rider, 0.2 horse); the ground under
  the rider's horse lies in its shade. Leather jacket 0x4c3524. Rider sits 2.5 cm lower and 5 cm forward.

**Critic scores.** Round 94: 4 / 4 / 5. Rider and horse first on both riding shots again ("uniform brown fuzz
with no folds", "the head under the hat is a featureless dark blob", "a black blotch for a mane", "lasso a
perfect torus", horse "picking up none of the blue ambient light").

### Round 95
- **The mane is fitted to the neck by measurement**: the neck's half-width under every point of every lock is read
  off the sculpted mesh (a table of the furthest vertex in each 2 cm cell of the side view), and the lock laid a
  finger clear of it, five rows deep. Two estimates from the sculpt's primitives both left the cards cutting in
  and out of the neck ("a black blotch for a mane", "stray ticks").
- **The rider's arms hang by his ribs with his hands a hand's breadth over the horn** (he rode as if holding a
  steering wheel at chest height).
- **Under a snowstorm's overcast**: the sun is fainter still (0.62 + 0.3 x blizzard: the horse's hard blue shadow
  implied sun) with 45% more sky light; figures, tack and coat lose a third of their saturation and take the
  light's grey-blue (the bay stood in the storm orange-red, "picking up none of the blue ambient").
- Coat stains fainter.

**Critic scores.** Round 95: 3.5 / 4 / 5. Pines down half a point (the rider "a clay mannequin", horse ears
"cat-like spikes", "lasso a perfect torus", in the snow the coil over the dark bag "reads as a tyre"). Vista's
first item is now the sky: "flat white streaks on saturated navy" (my round 90-91 rework made it worse than
the heaped cumulus of round 78).

### Round 96: the storm sky, seen from the side
A lookout sees only the lowest dozen degrees of sky. Our cloud slab stood at 1500-2900 m over a lens taken to be at
sea level, so down there it was seventeen kilometres off, marched in coarse steps and two-thirds haze: streaks.
- **The slab's base, top and the lens's height are settable per shot** (`deck: [base, top, lensY]`, uniform
  `uDeck`; default 1500/2900/0 as before). The vista sets 950/2700/330: the storm stands three to ten
  kilometres off at eye level and is seen from the side, as heaped towers with lit heads and a dark body
  (`?highdeck` to compare, `?deck=a,b,c`, `?st=`, `?cv=` to tune). Cover eased by 0.1 so breaks open.
- **The cloud's body is modelled in panorama** (bearing and elevation, two cross-faded copies so there is no
  seam): great billows of paler grey in the dark mass, crisper lumps within them, darkest overhead, lit from
  below by the snow country. The plane-projected cells that did this job higher in the sky are faded out
  below twenty degrees, where they are drawn out into streaks. Sky tones now p5/50/75/95 = 87/122/136/183
  before the last contrast pass against the reference's 67/106/134/183 (it was 89/109/128/180 and flat).
- A painted panorama of cloud ranks (`stormPano`, `?pano`) was tried first and is kept switched off: smooth
  noise profiles, however thresholded, read as smears of paint beside the marched cloud's real shading.

**Critic scores.** Round 96: 3.5 / **4.5** / **5.5** (total 13.5). The storm sky dropped from the vista's first
complaint to its fourth; first is now colour: "steel-blue monochrome; B has warm tan rock with lichen, rust-brown
brush, green-black conifers against cool blue distance" (I cooled the rock in round 79 after a critic called it
sandstone: over-corrected). Snow ride: "no atmospheric depth", and the rider I desaturated last round is now
"dark grey on blue with no colour accent" where the reference's warm brown rider "pops": reverted in 97.

### Round 97: colour
- **Vista: warm against cool.** The foreground rock is a tan-grey granite again and a third lighter (in clear air
  only: under falling snow the same stone stays wet slate, the storm frame's dark anchor); brush is russet under
  a light frost (0.9), tufts ochre-straw. The frame's bottom third measures 91 (reference 87).
- **Snow ride.** Falling snow takes the valley by degrees (a quarter gone at a kilometre, two-thirds at two);
  the rider is a warm tan again and the horse keeps its red (greyed last round they were "a dark grey shape on
  blue"); lens a metre closer. River ice is dark from a distance, and the vista's river wider.
- **Horse**: ears short leaves (they were "cat-like spikes"), coat rougher (0.92) with half the sheen.
  **Lariat** a thin rope in a long hanging loop ("a perfect torus", "a tyre").

**Critic scores.** Round 97: 4 / 4 / 5. Found from its "trunks evenly lit red-orange" (after I had greyed the bark
in round 92): that edit reached only the first of the two bark materials, and the pine shot's ponderosas use the
second. Vista sky: "dark noisy smear with stamped white puffs, horizontal banding" (the march's dither grain and
step bands on the now-close deck). Snow ride: far walls "washed-out pale-blue blobs" (the haze I added), trees
"all tinted the same pale blue-white, no dark needle mass under the snow".

### Round 98
- **Pine trunks are dark shapes against the lit air.** Both bark materials are grey-brown now (the round-92 edit
  had reached only the spruce bark; the ponderosas in the pine shot stayed cinnamon), and inside a stand bark
  is halved and needles take 0.62 (`uCanopy`): lit by the forest's raised exposure, boles stood orange-brown in
  their own shade and the canopy was one mid green. Bark keeps the shared climate shading again (my override
  had dropped it).
- **Stills march the cloud at 176 steps** (80 in play): on the close deck the dither showed as grain and the
  steps as bands. A storm's lit heads are pale grey (sun x0.45), not white.
- **Conifers in a snowstorm are dark under their snow** (near trees' load 0.5, far billboards lose the frosted
  tint and a third of their albedo). Snowfall haze eased (300 m start, 2600 m scale).

**Critic scores.** Round 98: 4 / 4 / 5. Trunks went from "evenly lit red-orange" to "near-black across the whole
frame, no bark relief, no warm bounce" (overshot), the rim light I restored is "a toon outline" on hat and arm;
vista's first item is the forest again ("pepper noise: no clumping, no clearings, no size variation"); snow
ride's is the left cliff ("lumpy blob", with "a white smear and a dark band" at the frame's left edge).

### Round 99
- **Vista: meadows and age classes.** Crisp-edged openings a hundred to three hundred metres across are cut into
  the timber (a quarter of the ground; drainages keep their trees), and whole stands are old timber or young
  (size x0.62 to x1.32 by a 200 m noise): the forest stands in masses with white between them (`?nomeadows`).
- **Snow ride cliff**: six tiers of outcrop, a little bigger and less shrunk toward the lens: through the holes
  between four the bench's own slope showed as flat dark panels with a white stripe across them.
- **Light**: the rim on cloth is broad and soft at 0.2 (narrow at 0.34 it was "a toon outline"); trunks inside a
  stand at 0.72 (0.5 took them to black); broadleaf scrub under the canopy lifted x1.5 (black cut-outs).

**Critic scores.** Round 99: 4 / 4 / 5. Nine other scenes re-checked after this session's changes (gallop, ranch,
town, forest, swamp, autumn, desert, jungle, vista): no regressions. The critic now reverses itself between
rounds on single items (the rim light is "a toon outline" at 0.34 and "no rim light" at 0.2; the outcrop is
"steel-blue monochrome" when cool and "a yellow-green hue that does not belong" when warm), which marks the
noise floor of this method: totals have stayed 12-14 for twenty-two rounds (77-99) while the frames changed a
great deal. What it never reverses on: the horse and rider as assets, bare ground in the pines, the vista's
wedge-shaped block.

### Round 100
- **The vista's wedge is gone.** Named by the critic in every round since 79 ("smooth triangular prism",
  "knife-straight edge"), it was the corner of the big left block where round 83's tilted cut met its side:
  the cut was a plane, so every big outcrop had one flat sloping face. Found by listing every near rock with
  where its crown falls in frame (a raycast had picked a smaller block standing in front of it, and replacing
  that changed nothing). The cut is now a broken surface (two scales of noise, a slight lean), on all big
  outcrops, so the snow ride's cliff has broken tops too.
- Rim light on cloth between the two settings the critic rejected (2.7 at 0.27).

**Critic scores.** Round 100: 4 / 4 / 5. The wedge is no longer named. Vista's first item: mountain surfaces
"salt-and-pepper noise at one scale everywhere, not following slope; silhouettes soft" (named in nearly every
round); snow ride's: the cliff "a scaled-up boulder: crack texture whose feature size says 2 m rock, not 60 m
cliff, no horizontal strata, no snow on ledges"; pines: the rider and horse.

### Round 101
- **Far snow and rock sort themselves by the lie of the whole face** (terrain shader, snow country, beyond 250 m):
  the slope is read over forty metres, not cell by cell. Every crinkle of a mountainside used to shed its snow on
  its steep side and keep it on its flat: "salt and pepper at one scale". Now gentle faces are clean snowfields
  and steep faces dark rock; the small wind-scours fade out with distance. The lighting normal is unchanged.
- **Outcrop rock is bedded** (rock shader, big blocks): three metres or so to a bed in world space, each bed its
  own shade on upright faces, shade under the lip of the bed above, and snow lying on the ledge at its foot in
  short runs of varied thickness. The snow ride's cliff reads as stratified rock with snow on its ledges
  instead of "a scaled-up boulder".

**Critic scores.** Round 101: 4 / 4 / 5. The right massif, "where rock breaks through snow according to slope, is
convincing" (it had been "salt-and-pepper" for twenty rounds). The cliff's ledge snow "looks painted on: thin
dashes that do not sit on ledges; the base meets the ground in a hard line with no drift". Vista: trees
"near-black specks with no snow on their crowns" against "large white firs round the cabin that do not match".

### Round 102
- **Snow is banked against the foot of every rock in snow country**: a ragged apron climbing it a pace or so
  (cliffs and boulders met the snowfield on a ruled line; the slabs in the snow ride's field are half buried now).
- **Strata are stepped in the light**: each bed stands out a hand at its foot in the bump, so the ledge snow lies
  on steps instead of being ruled on a smooth face.
- **Trees match near and far**: near conifers carry less of a white coat in clear weather (0.42), far billboards
  keep their snow flecks out to 1.6 km: dark trees with snow on their boughs at every distance.
- **A ridden horse carries its head** (neck raised 0.2 rad on the rein when a shot poses it): the head hung
  small and low ahead of the saddle. Ears shorter and blunter.

**Critic scores.** Round 102: 4 / 4 / 5. Play-mode frame rate re-measured after this session's shader work:
13.2 fps at 1512x982 ungoverned (it was 14.5), and the governor settles at about 24 fps at scale 0.56 (25):
roughly a tenth slower. Vista's first item this time: "no atmospheric layering: the valley ends in a flat,
detail-free pale-blue wedge; B stacks six or more receding ridgelines with fog pooled between".

### Round 103
- **Interlocking spurs beyond the map** (`backdrop.js`, `?nospurs`): the valley's sides send spurs down across
  its floor from left and right in turn at 1.8, 3.2, 5, 7.4, 10.5 and 15 km, each higher than the last with a
  jagged crest, so looking up the valley the eye meets ridgeline behind ridgeline, paler and paler, to a jagged
  skyline. Before, the open floor ran twenty kilometres to one pale wedge. Both snow shots look up this valley.

**Critic scores.** Round 103: 4 / 3 / 5. The new spurs read badly as built: "a pale-blue sawtooth cutout with no
interior shading" over "a flat grey slab with hard horizontal lines, which reads as a far plane or a clipped
terrain edge" (each spur spanned the valley at full height, a dam, with evenly toothed crests); in the snow
ride "a bright white band against darker cloud, like cut paper". Reshaped in round 104.

### Round 104 (built and captured, not yet scored by the critic)
- **Far spurs reshaped**: each runs down from its own wall and dies out past the valley's axis, so its crest is a
  long slant across the view with a few broad summits (spanning the valley at full height each was a dam with a
  level top, and with a tooth every four hundred metres the far ones were a saw blade).
- Still open on the far distance: the backdrop's ranges are pale, with little interior shading under the haze;
  in the snow ride the far ridge stands as a bright band against darker cloud.

### Handing over (2026-10-09)
The owner asked for the work to be pushed so another Claude account can carry on. This machine is not signed in
to GitHub, so nothing could be pushed from it. Prepared instead: `scripts/handoff_header.md` rewritten for round
104, `latest_frames/w104_*`, the all-in-one handoff file regenerated with `scripts/build_handoff.py`, and a
merge commit on top of the GitHub branch's `37e68cf` ready to push as a fast-forward.
