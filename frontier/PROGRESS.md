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
