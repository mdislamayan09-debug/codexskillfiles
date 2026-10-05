// Photographic CC0 surface library (see public/textures/CREDITS.md).
import * as THREE from 'three';

const NAMES = ['grass', 'dirt', 'rock', 'snow', 'gravel', 'planks', 'riverbed', 'wood', 'stone'];

export async function loadSurfaces(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const load = (url, srgb) => new Promise((res) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(16, aniso);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      res(t);
    }, undefined, () => res(null));
  });
  const out = {};
  await Promise.all(NAMES.flatMap((n) => [
    load(`./textures/${n}-albedo.jpg`, true).then((t) => (out[n] = t)),
    load(`./textures/${n}-normal.jpg`, false).then((t) => (out[n + 'N'] = t)),
  ]));
  out.water = await load('./textures/waternormals.jpg', false);
  // fall back to a flat 1×1 texture so shaders still compile if a file is missing
  const flat = (rgb) => { const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1); t.needsUpdate = true; return t; };
  for (const n of NAMES) { out[n] = out[n] || flat([128, 128, 128]); out[n + 'N'] = out[n + 'N'] || flat([128, 128, 255]); }
  out.water = out.water || flat([128, 128, 255]);
  return out;
}
