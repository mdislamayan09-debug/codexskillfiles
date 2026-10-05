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
