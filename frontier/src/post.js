// Post stack: scene -> (GTAO) -> sun shafts -> bloom -> tone map -> film grade (+ Dead Eye).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { U } from './shared.js';

const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uSunUV: { value: new THREE.Vector2() }, uSunVis: { value: 0 },
    uSunColor: { value: new THREE.Color() }, uStrength: { value: 0.35 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uSunUV; uniform float uSunVis; uniform vec3 uSunColor; uniform float uStrength;
    varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uSunVis <= 0.001) { gl_FragColor = base; return; }
      vec2 d = (uSunUV - vUv);
      float dist = length(d);
      const int N = 40;
      vec2 stepv = d / float(N) * 0.95;
      vec2 p = vUv;
      float acc = 0.0, w = 1.0;
      float jitter = fract(sin(dot(vUv, vec2(12.9898,78.233))) * 43758.5453);
      p += stepv * jitter;
      // the sky mask is taken over a small footprint across the ray (not one texel), so needle-thin gaps in the
      // boughs give broad, soft beams rather than a starburst of hairline streaks
      vec2 side = normalize(vec2(-d.y, d.x) + 1e-5) * 0.006;
      for (int i = 0; i < N; i++) {
        p += stepv;
        float sky = step(0.99999, texture2D(tDepth, p).r) * 0.4
                  + step(0.99999, texture2D(tDepth, p + side).r) * 0.3
                  + step(0.99999, texture2D(tDepth, p - side).r) * 0.3;
        acc += sky * w;
        w *= 0.965;
      }
      acc /= float(N) * 0.5;
      float fall = exp(-dist * 2.2);
      // capped, so the sun's own gap does not swell into a white blob
      vec3 shafts = min(uSunColor * acc * fall * uStrength * uSunVis, uSunColor * 0.7);
      gl_FragColor = vec4(base.rgb + shafts, base.a);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uDeadEye: { value: 0 }, uDamage: { value: 0 }, uNight: { value: 0 }, uStorm: { value: 0 }, uForest: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) }, uVignette: { value: 1 }, uLetterbox: { value: 0 }, uFade: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uDeadEye; uniform float uDamage; uniform float uNight; uniform float uStorm; uniform float uForest;
    uniform vec2 uRes; uniform float uVignette; uniform float uLetterbox; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    vec3 sat(vec3 c, float s){ float l = dot(c, vec3(0.2126,0.7152,0.0722)); return mix(vec3(l), c, s); }
    void main(){
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;
      // subtle lens chromatic aberration at edges
      float ca = dot(cc, cc) * 0.006 * (1.0 + uDeadEye*2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - cc * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + cc * ca).b;
      // film grade: warm highlights, teal-olive shadows, gentle S-curve, slightly desaturated greens
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      vec3 shadowTint = vec3(0.92, 0.98, 1.02);
      // warm film highlights, cooled toward steel blue in a snow storm
      vec3 highTint = mix(vec3(1.05, 1.0, 0.9), vec3(0.96, 1.0, 1.07), uStorm);
      col *= mix(shadowTint, highTint, smoothstep(0.1, 0.8, l));
      col = sat(col, 0.92 - uNight*0.3);
      col = mix(col, col*col*(3.0-2.0*col), 0.28);
      col = pow(max(col, 0.0), vec3(1.0)) * 1.02 + vec3(0.012, 0.01, 0.006);
      // under the canopy: deeper shadows and richer greens, sun-warmed highlights (no milky lift)
      {
        vec3 c2 = col * col * (3.0 - 2.0 * col);
        c2 = sat(c2, 1.15) * mix(vec3(0.94, 0.98, 0.94), vec3(1.06, 1.0, 0.88), smoothstep(0.2, 0.8, l));
        col = mix(col, c2, uForest * 0.3);
      }
      // storm: cold, blue-grey and low-saturation
      // storm: cool blue-grey shadows, but warm wood and rock keep some colour
      col = mix(col, sat(col, 0.82) * mix(vec3(0.86, 0.95, 1.12), vec3(1.0), smoothstep(0.15, 0.6, l)), uStorm * 0.7);
      // and the whole frame steps down into steel blue, as in the references (their snow sits near 0.6/0.75/0.9
      // R/G/B of ours): red and green pulled down hardest in the shadows, the whites keep a little more
      col *= mix(vec3(1.0), mix(vec3(0.6, 0.8, 1.02), vec3(0.8, 0.9, 1.02), smoothstep(0.2, 0.85, l)), uStorm);
      // and a firmer S-curve, so the storm frame has true darks in rock and timber and bright snow, not one mid band
      col = mix(col, col * col * (3.0 - 2.0 * col) * 1.08, uStorm * 0.25);
      // night: blue shift
      col = mix(col, col * vec3(0.8, 0.92, 1.25) * 1.15, uNight * 0.6);
      // Dead Eye: sepia, high contrast, vignette pulse
      if (uDeadEye > 0.0) {
        float g = dot(col, vec3(0.3,0.59,0.11));
        vec3 sep = vec3(g*1.25, g*0.95, g*0.62);
        sep = smoothstep(0.02, 0.95, sep);
        col = mix(col, sep, uDeadEye * 0.85);
      }
      // vignette
      float vig = smoothstep(0.85, 0.25, length(cc * vec2(1.0, 0.85)));
      col *= mix(1.0, vig, 0.5 * uVignette + uDeadEye * 0.4);
      // damage
      col = mix(col, vec3(0.45, 0.02, 0.0), uDamage * smoothstep(0.25, 0.75, length(cc)) * 0.8);
      // film grain
      float gr = hash(uv * uRes + fract(uTime) * 100.0) - 0.5;
      col += gr * (0.035 + uDeadEye*0.04) * (1.0 - l*0.5);
      // letterbox
      if (abs(cc.y) > 0.5 - uLetterbox) col = vec3(0.0);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, { ao = true, bloom = true, smaa = false, samples = 4 } = {}) {
    this.renderer = renderer;
    this.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples });
    rt.depthTexture = new THREE.DepthTexture(size.x * pr, size.y * pr);
    rt.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.shafts = new ShaderPass(ShaftShader);
    this.shafts.material.depthTest = false;
    this.shafts.material.depthWrite = false;
    this.composer.addPass(this.shafts);
    if (ao) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      // reuse the main pass depth (terrain/grass are displaced on the GPU, so an override-material
      // normal pass would see flat geometry); normals are reconstructed from depth.
      this.gtao.setGBuffer(rt.depthTexture);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 1.0;
      this.gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.6, thickness: 2.0, scale: 1.1, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    if (bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.13, 0.5, 2.4);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    if (smaa) this.composer.addPass(new SMAAPass(size.x * pr, size.y * pr));
    this._v = new THREE.Vector3();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
  }

  render(dt, state) {
    const g = this.grade.uniforms;
    g.uTime.value += dt;
    g.uDeadEye.value = state.deadEye || 0;
    g.uDamage.value = state.damage || 0;
    g.uNight.value = U.uNight.value;
    g.uStorm.value = state.storm || 0;
    g.uForest.value = state.forest || 0;
    g.uLetterbox.value = state.letterbox || 0;
    g.uFade.value = state.fade || 0;
    // sun shafts from projected sun position
    const s = this._v.copy(U.uSunDir.value).multiplyScalar(5000).add(this.camera.position).project(this.camera);
    const sh = this.shafts.uniforms;
    const facing = this._v.z < 1 ? 1 : 0;
    const onScreen = THREE.MathUtils.smoothstep(1.6 - Math.max(Math.abs(s.x), Math.abs(s.y)), 0, 0.6);
    const sunUp = THREE.MathUtils.smoothstep(U.uSunDir.value.y, -0.02, 0.08);
    sh.uSunUV.value.set(s.x * 0.5 + 0.5, s.y * 0.5 + 0.5);
    sh.uSunVis.value = facing * onScreen * sunUp;
    sh.uSunColor.value.copy(U.uSunColor.value).multiplyScalar(0.25);
    sh.uStrength.value = 0.55 * Math.max(0, state.shaftK ?? 1);
    // the RenderPass draws into whatever readBuffer is at frame start
    const depth = this.composer.readBuffer.depthTexture;
    sh.tDepth.value = depth;
    if (this.gtao) {
      this.gtao.gtaoMaterial.uniforms.tDepth.value = depth;
      this.gtao.pdMaterial.uniforms.tDepth.value = depth;
    }
    this.composer.render(dt);
  }
}
