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

`latest_frames/w104_<shot>.jpg` is our frame and `w104_<shot>_sbs.jpg` the same frame beside its reference.

## 3. Scores so far (blind critic, 10 = indistinguishable from the reference)

Order is pines / snowride / snowvista. Every verdict in every round was "clearly" (the critic always tells which
frame is ours).

| Rounds | Scores | Notes |
|---|---|---|
| 28–49 | 3–5 / 2–5 / 2–4 | the earlier account's work (see PROGRESS.md) |
| 50–62 | 4 / 3–5 / 3–4.5 | GPU captures, volumetric shafts from the shadow map, performance work |
| 64–77 | 3–4 / 3–5 / 3–5 | best total 14 at round 72 (4/5/5) |
| 78–87 | 4 / 3 (4 once) / 5 (6 at round 80) | heaped storm cumulus, grown timber, rebuilt horse legs/tail, coats with thickness |
| 88 | 4 / 4 / 6 | total 14 again |
| 89–94 | 4 / 3.5–4 / 5 (6 at round 92) | "at thumbnail size this nearly passes" (vista, round 92) |
| 95–103 | 3.5–4 / 3–4.5 / 5–5.5 | 96: 3.5/4.5/5.5 · 97–102: 4/4/5 · 103: 4/3/5 |
| 104 | not scored | far spurs reshaped; captured (`latest_frames/w104_*`), critic not run |

**The plain reading:** totals have stayed between 12 and 14 for twenty-seven rounds (77–103) while the frames
changed a great deal. The vista is the strongest shot (5–6). Both riding shots sit at 3–4, and the critic's first
item on them is almost always the horse and rider as assets ("clay mannequin", "toy", "plastic"). On single items
the critic now reverses itself from round to round (rim light "a toon outline" at one setting and "no rim light"
at the next; foreground rock "steel-blue monochrome" when cool and "a hue that does not belong" when warm):
that is the noise floor of the method. Never reversed: the horse and rider, bare ground in the pines, the sky and
far-distance layering in the vista.

**An open question for the owner (asked several times, not yet answered):** whether to download free CC0 scanned
assets (Poly Haven textures, about 100 MB, and/or a scanned or modelled horse and rider). Nothing has been
downloaded; all work so far is code-only. Do not download without the owner's yes.

## 4. The working method: the gauntlet loop

Everything runs from `frontier/`. Set-up once on a new machine:
```bash
cd frontier && npm install && npx playwright install chromium
python3 -m venv ../.venv && ../.venv/bin/pip install pillow numpy
```

1. **Build, capture and compare in one step** (about 3 s a frame on the M4's GPU through ANGLE/Metal):
   ```bash
   sh scripts/snap.sh ../work/w105 pines,snowride,snowvista 8 | tail -9
   ../.venv/bin/python scripts/stack.py ../work/w105 ../work/w105/all.jpg pines,snowride,snowvista 1700
   ```
   - `snap.sh <out> [shots] [frames] [WxH] [query]` runs `npx vite build`, then `capture.sh` (serves `dist/` on
     port 4180, `scripts/shoot.mjs`), then `sbs.py`, which writes `<shot>_sbs.jpg` (ours left, reference right)
     and prints tone numbers for both: mean luminance per vertical third, 5th/95th percentiles, saturation, mean
     colour. **Read the numbers every time**: a shader compile error shows up as a near-black frame with wild
     numbers, not as an error message.
   - Each shot gets a fresh page (`FRESH=1`, the default), so one shot's raised ground and planted timber never
     leak into another's frame. The default query is `capture&ss=1.5` (supersampled; headless Chromium has
     devicePixelRatio 1 where the owner's Mac has 2).
   - `scripts/launch.mjs` is the shared browser launcher: `GL=metal` by default on macOS, `GL=swiftshader` as the
     software fallback (minutes per frame).
   - Other shots for regression checks: `gallop,ranch,town,forest,swamp,autumn,desert,jungle,vista`.
2. **Probe** one shot with a JS expression, without the full capture:
   ```bash
   pgrep -f "http.server 4181" >/dev/null || (nohup python3 -m http.server 4181 --directory dist --bind 127.0.0.1 >/dev/null 2>&1 &)
   sh scripts/p.sh snowvista ../work/w105/p.png '(()=>{ const U = G.dbg.U; return U.uMist.value; })()'
   ```
   `p.sh` rebuilds `dist/` first, so **never run it (or any build) while a capture is running**. To probe without
   rebuilding: `node scripts/probe.mjs "http://127.0.0.1:4181/?capture&ss=1.5" <shot> "<expr>" out.png 1280x720`.
   `window.__game` is `G`; `G.dbg = {world, veg, sky, backdrop, scene, camera, U, THREE, CABIN, renderer, post,
   town}`. Also: `scripts/turntable.mjs <url> studio <prefix>` (six views of horse and rider) with
   `scripts/sheet.py`, `scripts/perf.mjs <url> [WxH] [dpr] [secs]` (play-mode frame rate), `probe_multi.mjs`,
   `mapdump.mjs`, `errlog.mjs`.
3. **Pairs:** `../.venv/bin/python scripts/make_pairs.py ../work/w105 references ../work/critic/round105`
   (random A/B order; the key is written one level up as `round105_key.json`; never show it to the critic).
4. **Blind critic:** a background `general-purpose` sub-agent (model `opus`) with exactly this prompt, path
   adjusted. If it dies on a usage limit, launch it again.
   > You are a harsh, blind art critic for real-time game graphics. Do not flatter. In the directory "<DIR>" there are three pairs of images: pines_A.jpg / pines_B.jpg, snowride_A.jpg / snowride_B.jpg, snowvista_A.jpg / snowvista_B.jpg. In each pair, one image is a frame from a shipped AAA open-world western game, and the other is a frame from a browser (WebGL) game that is trying to reproduce the same scene. You are NOT told which is which. Read ONLY those six image files with the Read tool (the path contains spaces; pass it exactly). Do not read any other file, do not look for key files, do not run any commands. For each pair, report: 1. Which image (A or B) is the AAA frame, and how sure you are: "clearly", "probably", or "cannot tell". 2. A score from 1 to 10 for the OTHER image: how close it comes to the AAA frame in realism and finish (10 = indistinguishable, 5 = a decent mid-budget game, 1 = programmer art). Be strict and use the same scale for all three. 3. The five most damaging visible gaps in the weaker image, most damaging first. Be concrete and specific about WHERE in the frame and WHAT is wrong (shape, material, lighting, density, colour, scale), so an engineer can act on each one. No generic advice. 4. One thing the weaker image does well, if anything. Finish with a three-line summary: the three scores, and the single change that would raise each score most.
5. **Measure as well as look.** Crop the same region from our frame and the reference with PIL and compare
   luminance percentiles and mean colour. Check the crop first: one measurement this run sampled forest floor
   where the rider's back was meant to be, and drove a wrong fix. The references are 1920x1280 with letterbox
   bars; `sbs.py` crops them to rows 0.078–0.922.
6. **Fix the top gaps, capture, look at the sheet, commit, log the round in `PROGRESS.md`**, refresh
   `latest_frames/` and, before handing over, regenerate this file: `python3 scripts/build_handoff.py` (it packs
   every git-tracked file under `frontier/` behind this brief, which lives in `scripts/handoff_header.md`).
7. **Push** when the machine is signed in to GitHub (section 8). The owner wants the loop kept running: do not
   stop it on a plateau; report the plateau honestly and pick the next lever.

## 5. Architecture (frontier/)

- `index.html`, `src/main.js`: boot, quality presets (`?q=low|med|high|ultra|cinematic`, cinematic is the
  default), the game loop, the HUD, the frame governor (`?nogov`, `?ss=`), and **the cinematic shots
  (`G.shots`) with their per-shot set-building in `G.setShot`**: `trailDress` (pines), `snowDress` (snowride),
  `foreground` (vista). A shot can set: `time`, `fov`, `player`, `camRel`/`lookRel`/`turn` or `cam`/`look`,
  `weather {storm, blizzard}`, `coat` (horse), `stride` (holds the horse mid-walk), `expK`, `volDensity`,
  `volFalloff`, `keyShaft`, `sunGap [from, to, halfWidth]` (fells a lane toward the sun), `deck [base, top,
  lensY]` (cloud slab), `coverAdd`. `veg.refreshImpostors()` runs after dressing.
  - Comparison switches kept in the URL: `?pinesold`, `?nogap`, `?rideold`, `?canyonride`, `?nocliff`,
    `?lowbrow`, `?spursold`, `?vistaridge`, `?vistalow`, `?vistasearch`, `?hightimber`, `?nomeadows`, `?wedge`,
    `?highdeck`, `?deck=a,b,c`, `?st=`, `?cv=`, `?leveldip`, `?nospurs`, `?pano`.
- `src/world.js`: the 8192 m world, a 4096² heightmap at cinematic, real DEM patches in `public/terrain/`.
  Set-building helpers used by the shots: `raiseSpur`, `stampPad`, `sculptDrifts`, `paintCreek`, `paintTrack`,
  `paintForest`, `setForest`, `eraseWet`, `ledgeBox`, `touchSplat`. `terraceCliffs()` cuts bedded strata into
  true cliffs at build time and `terraceCliffs(true)` re-cuts them tilted **after** planting (see pitfalls).
- `src/terrain.js`: the terrain shader (`terrainAlbedo`): grass, forest floor, pine duff with drawn needle
  litter, dirt and tread, rock, snow. In snow country: the snow/rock split (read over the whole face beyond
  250 m: `farSnowK`), the "Snow-country cliffs" block (beds, joints, snow ledges near; ribs and buttresses far),
  frozen river ice (dark from afar), the horse's trough, drift shading under overcast, the far-forest canopy.
- `src/vegetation.js`: trees (`buildPine`: pine, tall, fir; flared butts; bark shader with grounding, per-tree
  tone and lichen, darkened inside a stand by `uCanopy`), instanced `ScatterLayer`s (`trees` with billboard
  impostors to 4.2 km; `bushes` 0-2 leafy, 3-4 fern, 5-6 big-leaf, 7-8 twig brush, 9 bunchgrass, 10 stalks;
  `rocks` 0-3 boulders, 4-5 bare ledge slabs, **6-8 big jointed outcrops** drawn to 1.5 km when scale ≥ 6;
  `crags`; `logs`), `rockGeometry` (joint lattice, spike relax, broken top), the rock shader (triplanar noise
  `tnz`/`tfb`, crack networks `crackNet`, world-space strata with ledge snow, snow banked at the foot, warm tan
  in clear air and wet slate under snowfall), grass, forest clutter, climate tinting (`CLIMATE_FRAG`: snow load,
  frost `FROST_K`, russet `RUSSET_K`).
- `src/sky.js`: sky, ray-marched clouds (`uDeck` = slab base, top and lens height; 176 steps in capture, 80 in
  play), the storm cloud body modelled in panorama near the horizon, the blizzard ceiling, sun, fog colour,
  weather. `src/shared.js`: uniforms `U` (`uSnowfall`, `uMist`, `uBankBase`, `uCanopy`, `uCanopySpot`,
  `uCharFill`, `uSnowPad`, `uNoise`, ...), `patchMaterial()`, `canopyGaps`, `applyAtmosphere` (height fog,
  valley bank and rag layers integrated along the ray, snowfall haze by distance).
- `src/post.js`: GTAO, **volumetric sunlight ray-marched through the sun shadow map**, bloom, the grade (forest
  and storm branches). `src/backdrop.js`: the 70 km ring beyond the map; in the north the valley continues with
  interlocking spurs (`SPURS`).
- `src/creatures.js`: the rider is a scanned CC0 human body (MakeHuman) with clothes pushed off the skin
  (`mhTemplate`, `tailorCoat`), outfits `arthur` and `winter`; hat, satchel and strap, holster on the thigh,
  boots with soles, stirrups that ride on the feet. The horse is sculpted from primitives (`quadPrims`,
  `quadBones`): angled hind legs, a tail of a solid core with hair locks, a mane fitted to the neck's measured
  width, tack in `addTack` (saddle, blanket, bedroll, bags, lariat, rifle). `src/player.js`: riding (rider scale
  1.15), snow sink. Others as before: `town.js`, `fx.js`, `water.js`, `audio.js`, `hud.js`, `input.js`,
  `assets.js`, `textures.js`.
- `scripts/`: `snap.sh`, `capture.sh`, `shoot.mjs`, `launch.mjs`, `p.sh`, `probe.mjs`, `probe_multi.mjs`,
  `sbs.py`, `stack.py`, `sheet.py`, `make_pairs.py`, `turntable.mjs`, `perf.mjs`, `proftoggle.mjs`,
  `mapdump.mjs`, `errlog.mjs`, `build_handoff.py` + `handoff_header.md`, DEM baking, `build_human.py`,
  `make_artifact.py`.
- `PROGRESS.md` is the round-by-round log with the critic's own words: **read rounds 78–104 before changing
  anything**, most ideas have been tried once.

Play-mode performance on the M4 (measured at round 102 with `scripts/perf.mjs`): 13 fps at 1512x982 with the
governor off, about 24 fps where the governor settles (render scale 0.56), 5 fps at native retina.

## 6. Where it stands (round 104) and what to do next

**Pines (4).** Framing, tone numbers and light direction match the reference (thirds 100/74/46 against
107/72/50). What the critic names every round: (1) the rider and horse as assets; (2) the ground: a blurred
tread with too little on it (the reference has cones, stones, grass blades and twigs on every square metre, lit
and casting shadows); (3) trunks read as straight cylinders, the canopy as blobby cards with no needle sprays
against the sky; (4) the shafts are broad even bands, not broken by branches; no fine dapple on the floor.

**Snow ride (3–4).** (1) horse and rider; (2) the far walls and the valley's depth: pale masses, few planes;
(3) the snowfield: one ripple texture, no trench behind the horse; (4) trees one model in a row; (5) flakes are
uniform round dots. The left cliff (six tiers of big outcrops with strata and banked snow) is the part that has
come furthest.

**Snow vista (5–6).** (1) the far distance: the reference stacks six or more ridges with mist between them; ours
now has spurs beyond the map but their surfaces are pale and unshaded under the haze (round 104, unscored);
(2) the sky: heavy cloud with lit breaks in the reference; ours is a dark mass with paler billows; (3) forest
distribution still reads as scatter; (4) the foreground outcrop's rock is soft beside the reference's fractured
granite and frosted grass; (5) the river and homestead are small and plain.

**Levers not yet tried, in my order:**
1. Shade the backdrop's far ranges: rock on steep faces and snowfields that survive the haze (`backdrop.js`
   vertex colours and its shader), and mist banks lying between the spurs.
2. A hoof trench behind the horse in the snow ride that is actually visible (`uTrail` trough is too subtle
   under overcast), and wind-drawn streaks in the falling snow (`fx.js`).
3. Needle sprays for the pine canopy cards against the sky (`textures.js` `pineTuftTexture`) and branch-broken
   shafts (the canopy gap pattern in `shared.js` `canopyGaps` is a noise; real trunks and boughs should cut it).
4. Real geometry on the pine tread: more cones, stones and grass blades close to the lens (`makeClutter`).
5. With the owner's yes: scanned ground/rock textures and a real horse-and-rider model. I believe this is what
   moves the riding shots past 4.

**Four small edits that exist only on the GitHub branch and are not in this code** (commits 3dbb47e, 7cd17bc
and 7c41534 were made after the file this run started from): a `ledgeSnow` strata block in `terrain.js`, a trampled
yard in `world.stampPad`, lighter snow on the horse, and crags switched to the bare-ledge material
(`rMat` → `rMatBare` on the `cragBuilds` line of `vegetation.js`). The first three were reworked independently
here in rounds 79–102. The crag material change is the one worth trying; it is untested with this rock shader.

## 7. Pitfalls and lessons (do not relearn these)

- **A trailing `// comment` swallows code.** It bit three more times this run: after `.map(`, after an object
  literal, and on a line holding several statements. Put comments on their own line.
- **Batch edits with `assert`:** when one match string fails, earlier files in the same script are already
  written and the failing file is not. Grep for what applied before going on.
- **In zsh, `$c:frontier` applies the `:f` modifier.** Write `"$c":frontier`.
- **Planting follows the ground.** Any change to heights *before* vegetation is planted moves every tree, rock
  and bush in the world (a cactus appeared beside the desert rider). Cut new relief after planting and re-seat
  what stands on it (`terraceCliffs(true)` in `main.js`). Likewise, changing `r()` call counts in `scatter()`
  reshuffles the world: use `rc()`.
- **Shot dressing runs before the camera is moved.** Work out the lens position from the shot's `camRel`.
- **Ground-based planting under outcrops is buried.** Set plants where a ray from the lens strikes the rock
  meshes themselves (`rc.intersectObjects` on `veg.rocks.meshes[v]`, after `veg.rocks.update`).
- **Two materials, one fix.** There are two bark materials (`pineBark`, `ponderosaBark`) and the pine shot uses
  the second; a fix applied to one of a pair of look-alike lines does nothing in the frame you are judging.
- **GLSL scope:** a variable declared inside an `if` block is not visible after it; the capture comes back
  nearly black with no error in the image. Check the tone numbers and the capture log.
- **Identify the object before fixing it.** The vista's "wedge" was named for twenty rounds and was the corner
  of a different rock from the one a quick raycast picked. List candidates with their projected positions.
- **Over-correction.** Most single-item complaints have a history in `PROGRESS.md` of being fixed too far and
  then reversed (rock warm/cool, rim light, trunk brightness, snow on the horse, storm blue). Move half way.
- **Do not run two captures at once**, and never rebuild `dist/` during one.
- **Probes default to cinematic quality only when no `q=` is given.**
- **Shader compile errors are silent in the image.** The "GL_INVALID_OPERATION mismatch between texture format
  and sampler type" warnings at start-up are old and harmless.
- **Billboards are built once at load:** call `veg.refreshImpostors()` after adding or clearing trees.
- **Critic scores vary by ±1 between runs**, and a critic sub-agent can die on a usage limit: relaunch it.
- **The built-in browser pane cannot measure performance** (hidden tab, 0x0 canvas): use `scripts/perf.mjs`.

## 8. Repository and history

- **GitHub:** `mdislamayan09-debug/codexskillfiles`, branch `claude/aaa-open-world-game-c2ao5o`. The project is
  `frontier/`; this file sits beside it at the top level.
- Rounds 50–104 were made in a separate local repository rebuilt from the round-49 handoff file, on a machine
  that was **not signed in to GitHub**. They were prepared as one merge commit on top of the branch's commit
  `37e68cf`. **Check `git log` on the branch: if it shows "Merge rounds 50-104", the repository is current. If
  its last commit is still "Rebuild the all-in-one handoff with round 49", the push never happened and this
  file is ahead of the repository: extract it (section 0), commit `frontier/` and this file on the branch, and
  push.**
- **Artifact:** a playable single-page build was once published as a claude.ai artifact from
  `scripts/make_artifact.py` on the first account. It is long out of date.

## 9. Embedded file index

The archive is below, `frontier/...` paths with sizes. It includes:
- all source, scripts and docs
- `public/` assets (DEM patches, CC0 textures, the human template)
- `references/`: the three target images and five older RDR2 bar frames
- `latest_frames/`: the latest captures, as JPEG
