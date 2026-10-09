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
      // (a long reach at a lower strength: beams carried across the midground, not a halo round the sun)
      float fall = exp(-dist * 1.25);
      // capped, so the sun's own gap does not swell into a white blob
      vec3 shafts = min(uSunColor * acc * fall * uStrength * uSunVis * 0.8, uSunColor * 0.55);
      gl_FragColor = vec4(base.rgb + shafts, base.a);
    }`,
};

// True volumetric sunlight: the view ray is marched through the air and the sun's shadow map is tested at every
// step, so haze glows only where the sun actually reaches it. Beams stand between the trunks, their edges follow
// the real canopy gaps, and shaded air stays clear and dark (the screen-space pass below can only smear the sky's
// silhouette away from the sun's position on screen).
const VolumetricShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, tShadow: { value: null },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uShadowMatrix: { value: new THREE.Matrix4() },
    uSunDir: U.uSunDir, uSunColor: { value: new THREE.Color() }, uCamPos: { value: new THREE.Vector3() },
    uDensity: { value: 0.004 }, uFalloff: { value: 0.03 }, uBase: { value: 0 }, uMaxDist: { value: 260 }, uStrength: { value: 0 }, uTime: { value: 0 },
    uAmbient: { value: new THREE.Color() }, uCanopy: U.uCanopy, uCanopySpot: U.uCanopySpot,
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    precision highp sampler2DShadow;
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform sampler2DShadow tShadow;
    uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform mat4 uShadowMatrix;
    uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uCamPos; uniform vec3 uAmbient;
    uniform float uDensity; uniform float uFalloff; uniform float uBase; uniform float uMaxDist; uniform float uStrength; uniform float uTime;
    varying vec2 vUv;
    float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    float hg(float g, float mu){ float g2 = g*g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0*g*mu, 1.5)); }
    uniform float uCanopy;
uniform vec4 uCanopySpot;
    float mistH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float mistN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(mistH(i), mistH(i+vec2(1,0)), f.x), mix(mistH(i+vec2(0,1)), mistH(i+vec2(1,1)), f.x), f.y); }
    // The canopy's small gaps. A forest roof lets the sun through in thousands of openings far smaller than a shadow
    // map of the whole stand can hold; they are what break the light into separate shafts in the air and into pools on
    // the floor. The pattern is laid across the sun's own direction, so it is the same all the way down a ray: a beam
    // in the haze ends in its own patch of light on the ground.
    float canopyGaps(vec3 wp){
      if (uCanopy <= 0.001) return 1.0;
      vec3 L = normalize(uSunDir);
      vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), L)), Up = cross(L, R);
      vec2 q = vec2(dot(wp, R), dot(wp, Up));
      float n = mistN(q / 1.9) * 0.5 + mistN(q / 0.7 + 7.3) * 0.32 + mistN(q / 6.0 - 2.9) * 0.18 + (mistN(q / 19.0 + 4.4) - 0.5) * 0.2;   // (pools a metre or two across, gathered where the roof is thin)
      float gap = 0.02 + 0.98 * smoothstep(0.545, 0.655, n);   // (about a quarter of the floor in sun: soft-edged shafts, dark air between)
  // a shot's key light: one gap in the roof whose shaft falls on a chosen point (the rider), as a cinematographer
  // would wait for or cut
  if (uCanopySpot.w > 0.0) { vec2 q0 = vec2(dot(uCanopySpot.xyz, R), dot(uCanopySpot.xyz, Up)); gap = max(gap, smoothstep(uCanopySpot.w, uCanopySpot.w * 0.5, length(q - q0))); }
  return mix(1.0, gap, uCanopy);
    }
    
    float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
                 mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.001) { gl_FragColor = base; return; }
      float z = texture2D(tDepth, vUv).r;
      vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      v.xyz /= v.w;
      float dist = z >= 0.99999 ? uMaxDist : min(length(v.xyz), uMaxDist);
      vec3 rd0 = normalize((uCamWorld * vec4(normalize(v.xyz), 0.0)).xyz);
      // sky seen up through the trees is bright haze, as the reference's: the air between here and the clouds is
      // full of the same lit dust (a hard-edged cumulus showing through the canopy read as a glowing blob)
      if (z >= 0.99999) {
        vec3 hz = mix(uSunColor, vec3(dot(uSunColor, vec3(0.3, 0.59, 0.11))) * vec3(1.02, 1.0, 0.95), 0.85) * (0.1 + 0.2 * pow(max(dot(rd0, uSunDir), 0.0), 4.0));
        base.rgb = mix(base.rgb, hz * vec3(0.97, 1.0, 1.06), 0.6 * min(uStrength, 1.0));
      }
      vec3 rd = normalize((uCamWorld * vec4(normalize(v.xyz), 0.0)).xyz);
      const int N = VOL_STEPS;
      // steps bunch up near the lens (where a beam's edge is sharpest on screen) and stretch with distance
      float jit = ign(gl_FragCoord.xy + fract(uTime * 0.37) * 97.0);
      float mu = dot(rd, uSunDir);
      // dusty air: a strong forward lobe (the glare round the sun) on a broad one (beams seen from the side)
      float phase = mix(hg(0.7, mu), hg(0.1, mu), 0.55);   // (mostly a broad lobe: beams show from the side and from below, not only round the sun)
      float lit = 0.0, amb = 0.0, tPrev = 0.0, T = 1.0;
      for (int i = 0; i < N; i++) {
        float f = (float(i) + jit) / float(N);
        float t = dist * f * (0.35 + 0.65 * f);
        float dt = t - tPrev; tPrev = t;
        vec3 p = uCamPos + rd * t;
        vec4 sc = uShadowMatrix * vec4(p, 1.0);
        float s = 1.0;
        // (the sun is a disc and the canopy moves: each step looks up the shadow a little to one side, which feathers
        // the beams' edges; and the dust hangs unevenly, in drifts, so a beam is not one even streak)
        vec2 so = (vec2(ign(gl_FragCoord.xy + float(i) * 7.3), ign(gl_FragCoord.yx + float(i) * 3.1)) - 0.5) * 0.0022;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) s = texture(tShadow, vec3(sc.xy + so, sc.z - 0.0006));
        s *= canopyGaps(p);
        float den = uDensity * exp(-max(p.y - uBase, 0.0) * uFalloff);
        #ifdef VOL_DUST
        den *= 0.45 + 1.1 * n3(p * 0.11 + vec3(uTime * 0.02, 0.0, uTime * 0.013));
        #endif
        float a = den * dt;
        lit += T * s * a;
        amb += T * a;
        T *= exp(-a * 0.6);
      }
      // (dust scatters the sun paler than its disc: a pale gold, not the low sun's orange)
      vec3 sunC = mix(uSunColor, vec3(dot(uSunColor, vec3(0.3, 0.59, 0.11))) * vec3(1.04, 1.0, 0.92), 0.85);   // (a warm white: gold haze under a warm grade went sepia)
      vec3 L = sunC * phase * lit * 12.566 + uAmbient * amb;
      // the haze stands in front of what is behind it: a little of the scene is lost to it as well
      gl_FragColor = vec4(base.rgb * mix(1.0, T, 0.5) + L * uStrength, base.a);
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
      col = pow(max(col, 0.0), vec3(1.0)) * 1.02 + vec3(0.004, 0.0035, 0.002);   // (a bigger lift read as haze: keep true blacks)
      // under the canopy: richer greens and sun-warmed highlights, with a shoulder on the highlights. The
      // reference's woods keep true blacks but hold the hazy canopy gaps near 0.45 and their brightest 5% near
      // 0.75; an S-curve here had blown the gaps to 0.6 and the top 5% to 0.9 (and a lifted toe went milky)
      {
        // (cool teal-green in the shade against warm gold in the light: an even olive cast read as grey-green mud)
        // (true blacks under the boughs and a cool shade: an even yellow-green wash read as one flat tone)
        vec3 c2 = sat(col, 1.5) * mix(vec3(0.84, 0.95, 1.03), vec3(1.05, 0.99, 0.9), smoothstep(0.1, 0.65, l));
        c2 = max(c2 - 0.042, 0.0) * 1.045;
        c2 -= 0.34 * max(c2 - 0.33, 0.0);
        col = mix(col, c2, uForest);
      }
      // storm: cold, blue-grey and low-saturation
      // storm: cool blue-grey shadows, but warm wood and rock keep some colour
      col = mix(col, sat(col, 0.82) * mix(vec3(0.95, 0.98, 1.05), vec3(1.0), smoothstep(0.15, 0.6, l)), uStorm * 0.7);
      // and the whole frame steps down into steel blue, as in the references (their snow sits near 0.6/0.75/0.9
      // R/G/B of ours): red and green pulled down hardest in the shadows, the whites keep a little more
      // (the snow takes the blue, the darks stay near neutral: tinted hardest in the shadows the whole frame went
      // cobalt and rock, timber and coat all read as blue)
      col *= mix(vec3(1.0), mix(vec3(0.9, 0.93, 0.98), vec3(0.78, 0.89, 1.03), smoothstep(0.12, 0.7, l)), uStorm);   // (shadows less saturated: the pool under the horse read as dyed blue)
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
      col *= mix(1.0, vig, 0.32 * uVignette + uDeadEye * 0.4);
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
  constructor(renderer, scene, camera, { ao = true, bloom = true, smaa = false, samples = 4, volSteps = 48, volDust = true } = {}) {
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
    this.vol = new ShaderPass(new THREE.ShaderMaterial({ ...VolumetricShader, uniforms: VolumetricShader.uniforms, defines: { VOL_STEPS: volSteps, ...(volDust ? { VOL_DUST: 1 } : {}) } }));
    this.vol.material.depthTest = false;
    this.vol.material.depthWrite = false;
    this.composer.addPass(this.vol);
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
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
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
    // volumetric sunlight: the sun's own shadow map, marched along every view ray
    {
      const v = this.vol.uniforms, sun = state.sun, map = sun && sun.shadow.map && sun.shadow.map.depthTexture;
      const k = map ? (state.vol || 0) : 0;
      this.vol.enabled = k > 0.001;
      if (this.vol.enabled) {
        v.tDepth.value = depth; v.tShadow.value = map;
        v.uShadowMatrix.value.copy(sun.shadow.matrix);
        v.uInvProj.value.copy(this.camera.projectionMatrixInverse); v.uCamWorld.value.copy(this.camera.matrixWorld);
        v.uCamPos.value.copy(this.camera.position);
        v.uSunColor.value.copy(U.uSunColor.value);
        v.uAmbient.value.copy(U.uFogColor.value).multiplyScalar(state.volAmbient ?? 0.07);
        // (the everyday air; a shot can ask for thick dust standing up into the crowns)
        v.uDensity.value = state.volDensity ?? 0.003;
        v.uFalloff.value = state.volFalloff ?? 0.03;
        v.uBase.value = U.uFogBase.value;
        v.uMaxDist.value = state.volDist ?? 260; v.uStrength.value = k; v.uTime.value = g.uTime.value;
      }
    }
    if (this.gtao) {
      this.gtao.gtaoMaterial.uniforms.tDepth.value = depth;
      this.gtao.pdMaterial.uniforms.tDepth.value = depth;
    }
    this.composer.render(dt);
  }
}
