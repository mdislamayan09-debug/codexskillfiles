# Gauntlet loop prompt used for this build

Generated with the `gauntlet-loop` skill (technique by Matt Shumer, skill by RoboNuggets).

```
Build the best-looking open-world western you can in the browser: a playable Three.js game in the spirit of Red Dead Redemption 2. Ride a horse across a huge procedural frontier with rolling grassland, forests, a river, snow-capped mountains, a living frontier town, wildlife, outlaws, a day/night cycle and a period-correct HUD.

The bar is Red Dead Redemption 2's own screenshots: the "Valentine, The Heartlands" ranch postcard, the swamp horseback shot, the train-robbery ride, the forest hunt and the Strawberry establishing shot, pulled from the public rdr2-site-clone repo on GitHub (d4v1-sudo/rdr2-site-clone, assets/img). Get those real images first and compare against them directly, not against a description of them.

Break this into the smallest pieces that can be improved and judged on their own: terrain, sky and light, vegetation, water, town, rider and horse, wildlife and outlaws, HUD, motion. For each piece, fan out a builder and a separate critic with fresh context. The critic captures our real in-game screenshot, puts it next to the RDR2 frame blind with the labels stripped, says which one is better, and names the single biggest remaining gap. Then it goes back to the builder.

The critic should be a harsh critic. Praise is not useful. If ours does not win, it keeps going.

/loop on each piece until the critic picks ours blind. Do not stop before that.

Keep a live progress page updating as the work evolves so I can watch it.

Fan out subagents and ultracode.
```
