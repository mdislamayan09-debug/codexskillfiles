# World v2 — one map, every climate

The goal is one continuous open world in the style of Red Dead Redemption 2 that holds every climate. The user's
three reference frames set the bar:

1. A rider on a forest trail under tall pines, with god rays, fallen logs, ferns and pine litter.
2. A rider crossing a snowy alpine valley in a snowstorm, with dark cliffs, frozen falls and snow-loaded firs.
3. A view from a frosty rock outcrop down a long valley, with a cabin, a braided river and storm clouds.

## Map (8 km × 8 km, north is −z)

```
                         N  (z = −4096)
   +------------------------------------------------------------+
   |  GRIZZLY PEAKS — snowy range, peaks to ~1,250 m             |
   |     Frostwater Valley (glacial U-valley, frozen creek)      |
   |     Cabin bench overlooking the valley (reference 3)        |
   |  - - - - - - - - - snowline / treeline - - - - - - - - - -  |
   |  BIG PINES — tall conifer forest on rising foothills        |
   |     (reference 1), river gorge, outlaw hideout              |
   |----------------+-------------------------+-----------------|
   |  EMBER HILLS   |  HEARTLANDS             |  EAST PRAIRIE   |
   |  autumn        |  Copper Hollow, ranch,  |  open grassland |
   |  woodland      |  church, lake, river    |  and buttes     |
   |----------------+---------------+---------+-----------------|
   |  SUNDOWN MESA  |               |  BAYOU (swamp)            |
   |  desert,       |  JUNGLE COAST — palms, broadleaf canopy,  |
   |  red mesas     |  karst hills, beaches                     |
   |  ~~~~~~~~~~~~~~~~~~~~~~~~~ OCEAN ~~~~~~~~~~~~~~~~~~~~~~~~~ |
   +------------------------------------------------------------+
                         S  (z = +4096)
```

Climate is a set of smooth, noise-warped region weights that the generator writes into a second splat texture:
snow cover, jungle, autumn and desert. Terrain, vegetation, grass, weather and fog all read the same weights,
so every border blends instead of switching hard.

| Region | Climate / season | Terrain | Vegetation | Weather |
| --- | --- | --- | --- | --- |
| Grizzly Peaks | winter | eroded ridges, cliffs, U-valley, frozen creek | snow-loaded firs, dead snags, frosted shrubs | snowfall, low storm cloud, blue haze |
| Big Pines | late summer | foothills to ~350 m, boulders, river gorge | 30–40 m pines, ferns, fallen logs, pine litter | forest haze, light shafts |
| Heartlands | summer | rolling grass, lake, river | oaks, pasture grass | fair cumulus |
| Ember Hills | autumn | big rolling hills | maples/oaks in orange, red and yellow, golden grass, leaf litter | soft haze |
| East Prairie | summer | gentle swells, buttes | sparse oaks, tall grass | fair cumulus |
| Bayou | humid summer | wetlands at sea level | cypress, moss, lilies | humid haze |
| Jungle Coast | tropical | karst hills, beaches, ocean | palms, broadleaf canopy, big-leaf understory, vines | humid haze, towering cloud |
| Sundown Mesa | dry | terraced mesas, red strata, sand | cacti, dry scrub | clear, dusty |

## Roadmap and estimate

Effort is in agent working hours. One gauntlet round costs about 30–45 minutes on its own: capturing frames in
software GL (about 2 minutes per 720p frame, about 12 minutes per 4K frame), a blind critic, and fixes.

| Phase | Scope | Estimate |
| --- | --- | --- |
| **1. World v2 (now)** | 8 km map with every region above; fast parallel generation; biome terrain materials; biome trees, grass and ground clutter; snowfall and regional skies; a cabin for the snowy vista; new shots matching the three references; gauntlet rounds against them | 6–8 h |
| 2. Landforms | eroded mountain silhouettes (no cones), cliffs and frozen falls, sloped mountain rivers and waterfalls, ocean shoreline waves, desert canyons | 5–7 h |
| 3. Life | wildlife per biome (elk, wolves, bears, birds, gators), settlements per region (mining camp, coastal village, desert outpost), road network, points of interest | 6–9 h |
| 4. People | authored-quality characters and horses. This needs real assets (generator API keys, or a reachable model host); procedural sculpting has plateaued | 4–8 h with assets |
| 5. Polish and performance | LOD and streaming tuned for 8 km on real GPUs, seasonal time-of-year option, audio per biome | 3–5 h |

**Total: about 24–37 agent hours over several sessions.** Phases 1–2 decide whether the world reads as one
believable continent; phases 3–4 decide whether it reads as a game.

## Gauntlet bar for world v2

- **Reference 1** (forest trail ride) → shot `pines`
- **Reference 2** (snowy valley ride) → shot `snowride`
- **Reference 3** (snowy valley vista with cabin) → shot `snowvista`
- The existing RDR2 bar frames still judge `ranch`, `town`, `swamp` and `camp`.
- `jungle`, `autumn` and `desert` have no reference frame yet, so they are judged on their own against the
  same brief.
