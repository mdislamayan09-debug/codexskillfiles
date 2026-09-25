# Characters

The four survivors and the player's own hands are built at boot from code,
like everything else. Nothing is downloaded. This note is for anyone
changing how they look.

## A survivor from a description

Every survivor in `src/story/StoryData.ts` carries a `look.person`:

| Field | Meaning |
| --- | --- |
| `seed` | Varies noise in skin, cloth and hair so no two match |
| `sex`, `age`, `build` | Proportions, age lines, shoulder and hip widths |
| `face` | `jaw`, `nose`, `brow`, `cheek`, `lips`, `width`, each 0..1 |
| `eyes` | Iris colour |
| `hair` | `style` (`bun`, `balding`, `coils`, `crop`), `color`, `grey` |
| `beard` | 0 clean shaven, 1 full |
| `weather` | Freckles, redness and fine lines from years outdoors |
| `coat` | `greatcoat`, `workcoat`, `fieldcoat` or `robe` |

`buildHumanFigure(look, echo)` in `figures/HumanFigure.ts` turns that into a
rigged group. Ilyr passes the echo material and is drawn as light.

## The head (`figures/head.ts`)

- A sphere displaced by `faceDepth(x, y, person)`: brow ridge, eye sockets,
  the nose from bridge to wings to nostrils, cheekbones and the hollow
  under them, the mouth mound and the lips, jaw and chin. Ears are added
  as shaped pillows at the sides.
- `faceMasks` gives the skin painter where lips, nostrils, brows, lids,
  folds, crow's feet, blush and beard are, in the same face coordinates,
  so paint always lands on the anatomy.
- Eyes are balls with a baked iris, set in the sockets. `buildEyelids`
  rebuilds the lids for a blink without changing the vertex count.

## Surfaces (`figures/textures.ts`, `figures/skinShading.ts`)

- Skin is baked per survivor on a canvas: mottling, lips tapering to the
  corners, brows as fine hairs, stubble, pores in the normal map. Deep
  skin tones warm rather than redden, so cheeks never go muddy.
- Cloth (wool, canvas, waxed, linen, serge), leather and hair are baked
  tiles with normal maps.
- `applySkinShading` lets light wrap past the terminator with a warm tint,
  standing in for light scattering under the skin.

## The body and clothes

- Garments are lofted superellipse rings (`Ring`, `ringAt`, `ringPoint`),
  so collars, pockets and straps can sit on the cloth by sampling the same
  rings. Pockets are laid over the coat's curve; the satchel strap is a
  smooth curve just above it.
- Arms, legs and fingers are tubes with parallel-transport frames; the
  hands hang relaxed with four jointed fingers and a thumb.
- The rig is a handful of pivots (waist, neck, head, eyes). `update`
  breathes, shifts weight, blinks and turns the head and eyes toward the
  look target (the player while talking).

## First-person hands (`src/player/hand.ts`)

A gloved right fist round a grip on the local Y axis: four jointed finger
tubes placed round the grip bone by bone, knuckles standing proud, the
thumb over the index finger, a domed back of the hand, and a glove cuff
running into a wool sleeve with a knitted cuff. `Viewmodel.ts` gives it
baked leather and wool.

## Checking changes

- `tests/unit/figures.test.ts` and `tests/unit/hand.test.ts` check the
  anatomy (nose forward, eyes in the sockets, lids that close, fingers all
  round the grip, normals outward).
- `node scripts/capture-characters.mjs --gpu [--only varga,hands]` renders
  each survivor's portrait, figure and profile, and the hands with an axe
  and a torch, to `artifacts/review/characters/`.
