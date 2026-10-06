# DUST & REDEMPTION: complete project handoff (one file)

This single file contains the whole project:
- the goal, in the owner's own words
- the plan and the current state
- the full progress history and critic scores
- the working method (the "gauntlet loop") and every command it uses
- known pitfalls
- every source file and asset
- the three reference images the game must match
- our latest rendered frames

It is written for a Claude Code session that has never seen this project. Read sections 1 to 9 first (about 15
minutes), then extract the files (section 0) and continue the work.

---

## 0. Extract the project (do this first)

Everything after the line `==== EMBEDDED FILES ====` is a file archive. Each file sits between a
`<<<FILE ...>>>` line and a `<<<END FILE>>>` line. Text is stored as UTF-8, binaries as base64, and every file
carries a sha256. The extractor is embedded right below. Run from the directory holding this file:

```bash
sed -n '/^#==EXTRACTOR-BEGIN==/,/^#==EXTRACTOR-END==/p' DUST_AND_REDEMPTION_HANDOFF.md > extract_handoff.py
python3 extract_handoff.py DUST_AND_REDEMPTION_HANDOFF.md .      # recreates ./frontier/... and verifies every sha256
cd frontier && npm install && npx vite build                     # needs Node 20+; three@0.186, vite 8, playwright
npm run dev                                                      # http://localhost:5173  (?q=cinematic is the default)
```

```python
#==EXTRACTOR-BEGIN==
import base64, hashlib, os, re, sys
src, out = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '.')
data = open(src, 'r', encoding='utf-8').read()
body = data.split('\n==== EMBEDDED FILES ====\n', 1)[1]
pat = re.compile(r'^<<<FILE path="([^"]+)" encoding="(utf8|base64)" sha256="([0-9a-f]{64})" bytes="(\d+)">>>\n(.*?)\n<<<END FILE>>>$', re.S | re.M)
n = bad = 0
for m in pat.finditer(body):
    path, enc, sha, size, payload = m.group(1), m.group(2), m.group(3), int(m.group(4)), m.group(5)
    raw = base64.b64decode(payload.replace('\n', '')) if enc == 'base64' else payload.encode('utf-8')
    ok = hashlib.sha256(raw).hexdigest() == sha and len(raw) == size
    bad += (not ok)
    dst = os.path.join(out, path)
    os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
    open(dst, 'wb').write(raw)
    n += 1
    if not ok: print('CHECKSUM MISMATCH', path)
print(f'extracted {n} files, {bad} checksum mismatches')
#==EXTRACTOR-END==
```

After extraction:
- `frontier/` is the project.
- `frontier/references/` holds the three target images (`bar_ref_*.jpg`) and the older RDR2 bar frames.
- `frontier/latest_frames/` holds our most recent captures (the round is named in the file names).

**View the references and our frames with the Read tool before you do anything else.**

---

## 1. The goal (owner's words, condensed)

Build **the best AAA open-world game**: a Red Dead Redemption 2-style western in the browser (Three.js). The
owner's requirements:
- **"Ultra realistic 4K."** Quality and full production take priority over performance. The target machine is
  the owner's **MacBook M4**, so heavy settings are fine.
- **A full open world with every climate:** snowy mountains, pine forest, plains and town, autumn hills,
  desert mesas, bayou, and a jungle coast on an ocean. The focus is on visuals.
- **"Continuously work on this world until it looks exactly like the pictures I showed you."** The three
  reference frames (section 2) are the bar. The owner compared our output unfavourably with another AI's and
  asked us to "go all in".
- **Work autonomously.** "Don't ask me any permission or question, do everything by yourself, I give you full
  access." Keep looping (capture → blind critic → fix → commit) until the frames pass.
- **Work solo.** The owner tried a multi-agent "ultracode" workflow and asked to stop it. Background critic
  sub-agents are fine.

## 2. The three reference images (the bar)

The images live in `frontier/references/`. The critic compares each against our matching cinematic shot.

| Shot name (`?capture` → `G.setShot(name)`) | Reference | What it shows |
|---|---|---|
| `pines` | `bar_ref_forest.jpg` | Rider from behind on a sunlit dirt trail through an old pine forest, with strong backlit volumetric shafts and a layered floor (shrubs, cones, twigs, a mossy boulder, a fallen log). Tones: thirds mean luminance top 109, mid 68, bottom 44 (0-255); 5th percentile 13, 95th percentile 191. |
| `snowride` | `bar_ref_snowride.jpg` | Rider in a fur hat on a chestnut horse wading through deep powder in a snowy valley during falling snow. Dark granite cliffs with frozen waterfalls on the left, a frozen creek leading to a hazy vanishing point, snow-capped boulders, frosted brush, varied spruce, a heavy cloud deck and layered fog. |
| `snowvista` | `bar_ref_snowvista.jpg` | From a rocky summit ledge (lichen granite and frosted grass in the lower left and right foreground), looking down over a homestead (cabin, sheds, smoke) on a knoll into a long valley. A winding river and dense dark forest on the floor; 5+ ridge layers fading into blue; low fog banks; a dark storm deck with breaks of light. Tones: top 117, mid 117, bottom 84; saturation about 70 (warm rock and grass against cool snow). |

`latest_frames/*.jpg` are our latest frames, for comparison. `references/bar_*.jpg` (the other five)
are older RDR2 frames from the earlier world v1.

## 3. Scores so far (blind critic, 10 = indistinguishable from the reference)

| Round | pines | snowride | snowvista | Notes |
|---|---|---|---|---|
| 28–40 | 3–4 | 2–3 | 2–4 | the slow climb (see PROGRESS.md) |
| 42 | 5 | 4 | 4 | first real lookout composition |
| 43 | 4 | 3 | 4 | dense young firs walled in the pine trail |
| 45 | 4 | 5 | 4 | |
| 46 | 4 | 4 | 3.5 | |
| 47 | 4 | 5 | 3 | vista went milky (haze); fixes are in later commits |

**Round 49** (the latest frames in `latest_frames/w49_*.jpg`, rendered supersampled at `ss=1.5`) has been
captured but **not yet critiqued**; run the blind critic on it first. By eye:
- The vista made a clear step forward: a dark flat storm deck with breaks of light, crisper mountains, textured
  forests, and the homestead with chimney smoke in the lower centre.
- The pines frame is lusher (ferns and shrub drifts along a softer trail) but darker, with the sun hidden.
- The rider still shows a dark triangle on the coat's upper back, and a pale bar beside the saddle (the rifle
  scabbard or stock area in `addTack`). Investigate both.
- The snow ride moved to a new canyon spot (the creek-seeking search). It shows:
  - a big pale cliff wall on the left, and a thin white line running across it. Find out what draws that line;
    suspects are a road splat, a frozen-fall streak or a rib.
  - white "pill" crags on the cliff face. Fixed afterwards: crags now use the bare-granite material.
  - pinto-like snow speckles on the horse's rump. Fixed afterwards: lighter snow on animals.

  The valley, firs and snowfield read well.

The commits captured in round 49 (rounds 48 and 49) add:
- a low storm deck
- warm forest haze and longer shafts
- matte split granite
- patchier mist
- a dressed pine floor
- snow on brush and riders
- timber that thins upslope
- a forest-free homestead yard
- fixes to the tail, coat and tack
- a creek-seeking snow ride location
- 2× snowfall

Committed after the round 49 capture started, so not yet rendered:
- bedded strata and snow lying on the ledges of snow-country cliffs (`terrain.js`)
- a trampled, dirty-snow yard round the vista homestead (`world.stampPad`)
- crags in bare granite, and lighter snow on the horse

## 4. The working method: the gauntlet loop

1. **Build:** `cd frontier && npx vite build` (into `dist/`). **Never rebuild `dist/` while a capture is running
   from it.** For probes, build elsewhere: `npx vite build --outDir /tmp/distB --emptyOutDir`.
2. **Capture** (headless Chromium with SwiftShader software WebGL; one frame takes 5–15 min at 1280x720, longer
   when supersampled):
   ```bash
   cd frontier && mkdir -p ../work/w50
   CANVAS=1 OUT=../work/w50 nohup sh scripts/capture.sh "capture&ss=1.5" snowvista,pines,snowride 4 1280x720 > ../work/w50.log 2>&1 &
   ```
   - `capture.sh` serves `dist/` on port 4180 and runs `scripts/shoot.mjs`. It writes `<shot>.png`.
   - `ss=1.5` supersamples. Headless Chromium has devicePixelRatio 1, while the owner's Mac renders at 2×, so
     unsupersampled frames show alpha-test aliasing a player never sees.
   - The other biome shots are `autumn`, `desert`, `jungle` (and the older `vista`, `forest`, `ranch`, ...).
3. **Pairs:** `python3 scripts/make_pairs.py ../work/w50 references ../work/critic/round50`. This makes
   `<shot>_A.jpg`/`_B.jpg`, randomly ordered, plus a key json one level up. Never show the key to the critic.
4. **Blind critic:** a background general-purpose sub-agent with exactly this prompt (paths adjusted):
   > You are a harsh, experienced AAA art director doing a blind comparison. In the folder <DIR> there are three pairs of images: pines_A.jpg / pines_B.jpg, snowride_A.jpg / snowride_B.jpg, snowvista_A.jpg / snowvista_B.jpg. In each pair, one image is a frame from Red Dead Redemption 2 (the quality bar) and the other is from a real-time WebGL game trying to match it. You do not know which is which. Do NOT read any key/json file anywhere; judge only from the pixels. Use the Read tool to view each image. For each pair: 1. Say which image (A or B) you believe is the RDR2 bar and how confident you are ("clearly" or "narrowly"). 2. Score the OTHER image (the challenger) 1–10 against the bar, where 10 = indistinguishable from the bar in quality and realism, 5 = clearly a competent game but obviously behind, 1 = crude. 3. Name the single biggest gap that gives the challenger away, then the next five gaps in order of impact. Be concrete and visual: say where in the frame (left third, foreground, sky, etc.), what is wrong (shape, scale, material, lighting, colour, density, composition, depth), and what it should look like instead, as the bar shows it. Avoid generic advice. Be honest and specific; do not be polite. Keep the whole answer under 700 words, in this format per pair: PAIR <name>: bar = <A|B> (<clearly|narrowly>); challenger score <n>/10 / Biggest gap: ... / Next: 1) ... 2) ... 3) ... 4) ... 5) ...
5. **Measure as well as look.** Compare region luminance and saturation against the reference with PIL and
   numpy: mean luminance per vertical third, 5th and 95th percentiles, HSV saturation. Several of the big wins
   came from numbers (for example, the vista measured 25% too dark; the pine floor 0.6× too dark, then too pale).
6. **Fix the top gaps, build, and probe if needed.** `node scripts/probe.mjs 'http://127.0.0.1:4181/?capture'
   <shot> '<js expr using G>' out.png 960x540` against a second server on 4181 serving `/tmp/distB`. It prints
   shader compile errors. `window.__game` (G) exposes `G.dbg = {world, veg, sky, backdrop, scene, camera, U,
   THREE, CABIN, renderer, post, town}`. `scripts/probe_multi.mjs` renders several camera views in one page
   load. Probes default to cinematic quality only when no `q=` is given; `q=high` is a lower preset.
7. **Commit and push** after a verified build. End messages with any attribution the environment asks for.
   Refresh `latest_frames/` with the new round's frames (as JPEG) and regenerate this all-in-one file with
   `python3 scripts/build_handoff.py`. It packs every tracked file under `frontier/` behind this brief, which
   lives in `scripts/handoff_header.md`.
8. **Repeat.** Log each round in `frontier/PROGRESS.md`.

## 5. Architecture (frontier/)

- `index.html`, `src/main.js`: boot, the quality presets (`?q=low|med|high|ultra|cinematic`, cinematic is the
  default), the game loop, the HUD, and **the cinematic shots (`G.shots`) with their per-shot scene dressing in
  `G.setShot`**. The dressing blocks are `trailDress` (pines), `snowDress` (snowride) and `foreground` (vista),
  together with `G.findVista` (the ray-marched lookout search), `G.findCanyonRide` and the eye adaptation. Also
  `veg.refreshImpostors()` after dressing.
- `src/world.js`: the 8192 m world, a 4096² heightmap at cinematic quality, generated in worker threads.
  - Climates: snow north (z < -1300), the pine belt (z -700..-1300), heartlands and town at the centre,
    autumn west, desert south-west, bayou, a jungle coast and ocean south-east.
  - **Real DEM patches** (`public/terrain/*.png/json`): the Kawuneeche valley strip in the north, a Yosemite
    canyon (the snowride location), Monument Valley desert, Na Pali jungle, Cades Cove autumn.
  - The forest splat (it now has groves on flat valley floors and timber thinning upslope), roads and rivers.
  - `stampPad()` levels a yard and clears its forest tint at runtime.
- `src/terrain.js`: the terrain shader (`terrainAlbedo`). It layers grass, the forest floor (with a pine needle
  duff layer), dirt and road, rock, and snow:
  - the snow/rock split by slope
  - curvature ribs, wind-scoured crests and erosion runnels down the fall line
  - frozen falls and the frozen creek with its willow corridor
  - snow drifts and the horse-trail trench (`uTrail`)
  - the far-forest canopy tint
- `src/vegetation.js`: the trees and the scatter.
  - Trees: `buildPine` makes the kinds pine, tall and fir; the conifer cards come from `textures.js`, a dense
    spray for firs and a bottlebrush tuft for pines; ponderosa bark is cinnamon, spruce bark grey.
  - Other trees: oak, palm, jungle, cypress, cactus, snags.
  - Instanced ScatterLayers: `trees` (near radius 190·sqrt(q) m, then **billboard impostors out to 4.2 km at
    cinematic**), `bushes` (variants 0-2 leafy, 3-4 fern, 5-6 big-leaf, 7-8 frosted twig brush, 9 bunchgrass,
    10 dead stalks), `rocks` (0-3; 4-5 are bare split ledge granite), `crags`, `logs`.
  - The rock material: triplanar scanned relief, lichen, snow patches, BARE_LEDGE.
  - The grass shader, the forest clutter (cones, twigs, stones), and the climate tinting of foliage (snow load
    on boughs, autumn).
- `src/sky.js`: the sky, ray-marched clouds (112 steps at cinematic; storm flattens them into a low deck), the
  sun and fog colour, and weather (storm, blizzard, humid, dry) from the climate under the camera or a shot's
  `weather` override.
- `src/shared.js`: the shared uniforms `U`, `patchMaterial()` (injects the fog/atmosphere, cloud shadows and the
  far-depth squeeze into every material), and `applyAtmosphere` (height fog, sun scattering, mist banks and
  rags).
- `src/post.js`: GTAO, screen-space sun shafts, bloom, and the film grade. The grade has a forest branch (teal
  shade, gold light, a highlight shoulder) and a storm branch (steel blue).
- `src/backdrop.js`: the 70 km ring of distant ranges beyond the map edge. The north valley continues north-west.
  It has per-pixel erosion relief.
- `src/creatures.js`: humans (built from a MakeHuman-style template with clothing pushed out from the skin,
  outfits `arthur`/`winter`, and others), horses (procedural body, mane and tail cards, tack: saddle, bedroll,
  bags, rifle), and deer and sheep.
- `src/player.js`: riding and walking; the horse sinks into deep snow.
- Others: `src/town.js` (Copper Hollow, the ranch, the camp, the trapper's cabin, `addHomestead()`), `src/fx.js`
  (particles, snowfall, snow trail), `src/water.js`, `src/audio.js`, `src/hud.js`, `src/input.js`,
  `src/assets.js` (scanned CC0 textures and the procedural litter and needle layers), `src/textures.js`
  (procedural textures).
- `scripts/`:
  - capture and probe tooling: `shoot.mjs`, `capture.sh`, `probe.mjs`, `probe_multi.mjs`, `make_pairs.py`
  - DEM baking (`bake_dem.py`, `bake_patch.py`) and `build_human.py`
  - `make_artifact.py`, which packs `dist/` into a single shareable HTML page
- `WORLD_PLAN.md` is the world design. `PROGRESS.md` is the round-by-round log (read it). `GAUNTLET_PROMPT.md`
  is the original loop brief.

Key coordinates: CABIN ≈ (-460, -2496) (moved by DEM meta); the pine trail runs in the pine belt; the north
valley axis runs at x ≈ -750 from z -4096 to -1950 (floor about 200 m, flanks 500–1000 m).

## 6. Latest critic notes (round 47) and the to-do list

**Pines (4):**
- The floor is a bare plane with stamped grass tufts. A dressed floor was added after round 47; verify it.
- The light shafts read as a bloom halo and starburst, and the trunk under the sun glows. The shafts were
  softened and lengthened; the next step is **true volumetric shafts that ray-march the sun shadow map**.
- Trees look cloned and evenly spaced; trunks look smooth.
- The grade reads as olive-grey; a teal and gold grade was added.
- The path has a hard edge and evenly scattered chips.
- The rider and horse look like a clay mannequin with a plank tail; the tail, coat and tack were improved.

**Snow ride (5):**
- The rider has no snow on him (snow clumps were added), and the hat and scarf are smooth.
- The cliff is a smooth slab with no ledges, strata or icefalls. Next: snow ledges and strata on steep rock.
- The snow surface is a flat tiling normal; the legs stood on top of it (the horse now sinks 0.55 m).
- Shrubs read as snowless pom-poms (they now carry snow and the pale bud dots are gone).
- Snowfall is sparse with no fog banks (2× flakes added, mist kept in blizzard).
- A clump of cloned firs blocked the valley (clusters now pushed to the sides).

**Snow vista (3):**
- The terrain reads as smooth heightfield lumps with a blotchy camouflage snow mask and pepper-dot forest
  everywhere. Thinning timber and erosion runnels were added; more is needed.
- There is no focal point: the homestead (`G.findVista` → `town.addHomestead` on a stamped yard) is a tiny box
  about 550 m away. It needs to be nearer and larger, on a knoll.
- The haze is milky and even (patchier mist was added); the reference has stacked ridges and low fog banks.
- The clouds were cotton balls (now a storm deck).
- The rocks were blobby wet marble (now split matte granite).
- Brush was salted with white dots (fixed).

**Biggest remaining levers:**
1. Real volumetric light from the shadow map, in the forest and through storm breaks.
2. Mountain geology: strata and ledges, sharper ridges, rock on steep faces.
3. Character and horse asset quality: fur hat, coat detail, a horse with real hair and muscle.
4. A homestead focal point at about 150–250 m.
5. Snow surface micro-detail: wind ripples and sastrugi, without tiling.
6. A frozen river reading in both snow shots.
7. Check the other biome shots (autumn, desert, jungle) for regressions from global changes, then improve them.

## 7. Pitfalls and lessons (do not relearn these)

- **Probes default to cinematic quality only when no `q=` is given.** `q=high` is a much lower preset (2560
  heightmap, 1.25 km billboards), so probe at cinematic to judge the far forest.
- **Don't run two captures at once.** Both bind port 4180 and race on the same output files. If a command is
  interrupted, check `pgrep -af shoot` before starting another.
- **A comment on the same line can swallow code.** A `// comment` placed on the same line as an object literal
  once commented out a shader argument. Always build before committing.
- **Shader compile errors are silent in the image.** Read the probe or capture log for `THREE.WebGLProgram` and
  `ERROR`. The "GL_INVALID_OPERATION mismatch between texture format and sampler type" warnings are
  pre-existing, happen at init, and are harmless.
- **The forest effects are confined below the snow line.** Forest haze, shafts, exposure lift and the forest
  grade made the snowy vista milky until restricted.
- **Billboards are built once at load.** Call `veg.refreshImpostors()` after clearing or adding trees at runtime,
  otherwise distant cleared trees remain.
- **Frame-space placement grows rocks.** A rock grown down to far-fallen ground also grows sideways across the
  frame, so it is capped. Ground-bedded slabs sized by distance work better.
- **Changing `r()` call counts in `scatter()` reshuffles the whole world.** Use the separate stream `rc()` for
  new randomness.
- **Critic scores vary by ±1 between runs.** Trust repeated, consistent complaints over a single score.
- **The owner rejects tool calls sometimes.** If a command is interrupted, check what actually ran (a rejected
  chain had partly executed once).

## 8. Repository and history

- **GitHub:** `mdislamayan09-debug/codexskillfiles`, branch `claude/aaa-open-world-game-c2ao5o` (the latest
  commit at handoff is `79f93d6`, "Round 49 fixes ..."). The project lives in `frontier/`. If you can reach
  the repo, `git log` there has the full history. If not, this file is self-contained.
- **Artifact:** a playable single-page build was published as a claude.ai artifact (v12) from
  `scripts/make_artifact.py`. It is tied to the old account, so publish a new one if needed.

## 9. Embedded file index

The archive is below, `frontier/...` paths with sizes. It includes:
- all source, scripts and docs
- `public/` assets (DEM patches, CC0 textures, the human template)
- `references/`: the three target images and five older RDR2 bar frames
- `latest_frames/`: the latest captures, as JPEG
