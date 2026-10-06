# Texture credits

- `dirt`, `rock`, `grass`, `planks`, `snow`, `sand`, `riverbed`, `gravel`, `wood`, `stone` (albedo + normal):
  ambientCG (https://ambientcg.com), CC0-1.0, via the KTX2 surface library in
  https://github.com/tougenrip/thirdfold (`assets/textures/surface-*.ktx2`, provenance in `art/surfaces/*/meta.json`),
  transcoded to JPEG at 512 px.
- `waternormals.jpg`: three.js examples (https://github.com/mrdoob/three.js, `examples/textures/waternormals.jpg`), MIT.

# Terrain data credits

- `terrain/kawuneeche.png` (+ `.json`): elevation of Kawuneeche Valley, Rocky Mountain National Park, Colorado.
  Source: USGS 3D Elevation Program (public domain) via Mapzen/Tilezen Terrain Tiles on AWS Open Data
  (https://registry.opendata.aws/terrain-tiles/), z14 Terrarium tiles. Baked by `scripts/bake_dem.py`
  (0.55x horizontal, 0.95x vertical, light smoothing) into game space.
- `terrain/desert.png` (+ `.json`): Monument Valley (Utah/Arizona), same source, z13, 0.42x horizontal, 0.6x vertical,
  baked by `scripts/bake_patch.py`.
- `terrain/jungle.png` (+ `.json`): the Na Pali Coast of Kauai, Hawaii (USGS 3DEP; offshore from the tiles' bathymetry
  sources), z13, turned 225 degrees so the sea lies to the south of the map, 0.5x horizontal, 0.55x vertical.
