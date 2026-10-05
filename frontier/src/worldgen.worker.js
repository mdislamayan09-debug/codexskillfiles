// Generates one band of heightmap rows off the main thread.
import { World, setWorldResolution } from './world.js';

let world = null, worldRes = 0;
self.onmessage = (e) => {
  const { seed, res, j0, j1 } = e.data;
  if (!world || worldRes !== res) { setWorldResolution(res); world = new World(seed); worldRes = res; }
  const out = world.generateRows(j0, j1);
  self.postMessage(out, [out.heights.buffer, out.splat.buffer, out.climate.buffer]);
};
