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
