#!/usr/bin/env node
// Prints the WebGL2 capabilities of the Chromium that Playwright will use.
// STILLWILD's terrain needs vertex texture fetch and float textures; run this
// first when a new machine renders a blank or broken world. Takes the same
// --gpu / --swiftshader flags as the playtests.
import { launchChromium } from './lib/browser.mjs';

const browser = await launchChromium();
const page = await browser.newPage();
const info = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl2: true,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxVertexTextureUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    floatLinear: Boolean(gl.getExtension('OES_texture_float_linear')),
    colorBufferFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    anisotropic: Boolean(gl.getExtension('EXT_texture_filter_anisotropic')),
    gpuTimer: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
    webgpu: 'gpu' in navigator,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
