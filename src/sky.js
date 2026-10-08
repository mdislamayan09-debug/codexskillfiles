// Sky dome (analytic scattering + painted cumulus), sun/moon, time of day and image-based light.
import * as THREE from 'three';
import { U } from './shared.js';
import { makeCloudNoise } from './cloudnoise.js';

const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform float uNight;
uniform float uCloudCover;
uniform float uStorm;
uniform float uBlizzard;
uniform vec3 uHaze;
uniform vec2 uCloudOffset;
uniform highp sampler3D tCloud;
varying vec3 vDir;

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
vec2 hash2(vec2 p){ return vec2(h12(p+1.3), h12(p+7.1)) * 0.6 + 0.2; }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<6;i++){ s+=a*vn(p); p=p*2.02+vec2(3.1,1.7); a*=0.5;} return s; }

vec3 skyColor(vec3 d, vec3 s){
  float sunH = s.y;
  float day = smoothstep(-0.12, 0.25, sunH);
  float dusk = smoothstep(0.45, 0.02, abs(sunH - 0.02)) * smoothstep(-0.2, 0.0, sunH);
  vec3 zenith = mix(vec3(0.004, 0.006, 0.016), vec3(0.11, 0.24, 0.55), day);
  vec3 horizon = mix(vec3(0.012, 0.016, 0.03), vec3(0.55, 0.64, 0.74), day);
  float sd = max(dot(normalize(vec3(d.x,0.0,d.z)), normalize(vec3(s.x,0.0,s.z)+1e-5)), 0.0);
  vec3 duskCol = mix(vec3(0.95, 0.42, 0.16), vec3(1.0, 0.68, 0.38), sd);
  horizon = mix(horizon, duskCol * (0.4 + 0.9*sd), dusk);
  zenith = mix(zenith, vec3(0.16, 0.20, 0.38), dusk*0.6);
  float y = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(y, 0.42));
  // ground-side haze below horizon
  col = mix(col, horizon*0.85, smoothstep(0.0, -0.15, d.y));
  float mu = dot(d, s);
  // Mie forward glow
  float mie = pow(max(mu, 0.0), 12.0) * 0.35 + pow(max(mu, 0.0), 220.0) * 2.0;
  col += mie * mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.92, 0.8), day) * smoothstep(-0.15, 0.05, sunH);
  return col;
}

// ---- raymarched cumulus slab (Perlin-Worley shape eroded by Worley detail)
const float CB = 1500.0, CT = 2900.0;
float remap(float v, float a, float b, float c, float d){ return c + (clamp(v, a, b) - a) / (b - a) * (d - c); }
float cloudDen(vec3 p, float cov){
  float h = (p.y - CB) / (CT - CB);
  if (h < 0.0 || h > 1.0) return 0.0;
  float weather = texture(tCloud, vec3(p.xz / 26000.0, 0.37)).b;
  vec4 lo = texture(tCloud, p / 6200.0 + vec3(weather * 0.35, 0.0, weather * 0.2));
  // a storm closes the gaps into a continuous, lumpy deck
  // a storm deck: heavy, but torn with breaks of brighter sky between the cells
  // (a storm is a layered overcast with a few lit breaks, not fair-weather cumulus on a blue sky)
  // (in clear air the deck is broken into great masses with breaks between them, a third of the sky open; in falling
  // snow it closes right over)
  float c = clamp(cov * (0.3 + 0.9 * weather) + uStorm * mix(0.02, 0.26 + 0.2 * smoothstep(0.2, 0.6, weather), uBlizzard), 0.0, 1.0);
  // flat dark bases, towering rounded tops
  // (in a storm the slab flattens into a low deck, a thin lumpy layer seen from beneath, not towering cumulus)
  // (a deck with body: a thin sheet let the sun straight through and its underside came out pale and even)
  float prof = smoothstep(0.0, 0.08, h) * smoothstep(mix(1.0, 0.9, uStorm), mix(0.45 + 0.4 * weather, 0.3 + 0.25 * weather, uStorm), h);
  // (a tighter edge band and finer, stronger erosion: defined cauliflower cells rather than soft blobs)
  // (the 8-bit shape noise is dithered by the detail noise and taken through a wider edge band: a narrow band
  // stretched a few grey levels into contour lines across the thin parts of the deck)
  float d = remap(lo.r * prof + (texture(tCloud, p / 1900.0).g - 0.5) * 0.06, 1.0 - c, 1.0 - c + 0.22, 0.0, 1.0);
  if (d <= 0.0) return 0.0;
  float det = texture(tCloud, p / 760.0 + vec3(0.0, uTime * 0.0004, 0.0)).g;
  d = remap(d, mix(det, 1.0 - det, smoothstep(0.0, 0.3, h)) * 0.68, 1.0, 0.0, 1.0);
  // a finer erosion pass where the cloud is thin: crisp wisps and torn edges instead of a soft, magnified blur
  if (d > 0.0 && d < 0.6) d = remap(d, texture(tCloud, p / 260.0 + vec3(uTime * 0.0006, 0.0, 0.0)).g * 0.32, 1.0, 0.0, 1.0);
  return d * c;
}
float hgPhase(float g, float mu){ float g2 = g*g; return (1.0 - g2) / pow(1.0 + g2 - 2.0*g*mu, 1.5); }
// returns in-scattered light (rgb) and transmittance (a)
vec4 marchClouds(vec3 d, vec3 s, vec3 sunC, vec3 ambTop, vec3 ambBot, float cov){
  float t0 = CB / d.y, t1 = min(CT / d.y, t0 + 11000.0);
  if (t0 > 60000.0) return vec4(0.0, 0.0, 0.0, 1.0);
  const int N = CLOUD_STEPS;
  float dt = (t1 - t0) / float(N);
  float t = t0 + dt * h12(gl_FragCoord.xy + fract(uTime * 7.31) * 61.0);
  vec3 off = vec3(uCloudOffset.x, 0.0, uCloudOffset.y) * 4000.0;
  float mu = dot(d, s);
  float ph = mix(hgPhase(0.55, mu), hgPhase(-0.25, mu), 0.35);
  vec3 L = vec3(0.0); float T = 1.0;
  for (int i = 0; i < N; i++) {
    vec3 p = d * t + off;
    float den = cloudDen(p, cov);
    if (den > 0.003) {
      float ld = 0.0;
      for (int j = 1; j <= 4; j++) { float o = 70.0 * float(j*j); ld += cloudDen(p + s * o, cov) * 70.0 * float(2*j - 1); }
      float sig = 0.0045 * (1.0 + 6.0 * uStorm);   // storm decks are thick and opaque: dark bellies, light only at their torn edges
      // two-lobe transmittance fakes multiple scattering in thick cloud
      float Tl = max(exp(-ld * sig), 0.14 * exp(-ld * sig * 0.3));
      float powder = 1.0 - exp(-den * 1800.0 * sig);
      float h = (p.y - CB) / (CT - CB);
      // (the sky's own light inside the cloud falls off toward its dense cores, so a storm deck's underside is
      // modelled in lumps and hollows of grey rather than one flat dark tone)
      vec3 S = sunC * Tl * ph * mix(0.6, 1.0, powder) + mix(ambBot, ambTop, smoothstep(0.0, 0.9, h)) * mix(1.0, mix(1.35, 0.5, smoothstep(0.08, 0.6, den)), uStorm);
      float a = exp(-den * sig * dt);
      L += T * S * (1.0 - a);
      T *= a;
      if (T < 0.03) break;
    }
    t += dt;
  }
  return vec4(L, T);
}
`;

export class Sky {
  constructor(scene, renderer, quality = 1) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 17.6; // hours — golden hour
    // regional weather, eased toward the climate under the camera: storm (snowy north), humid (jungle, bayou),
    // dry (desert)
    // storm = dark low cloud; blizzard = fog and snowfall (usually equal, but a storm can clear)
    this.weather = { storm: 0, humid: 0, dry: 0, blizzard: 0 };
    this.lastEnvStorm = -1;
    this.timeScale = 1 / 60; // hours per real second (1 day = 24 min)
    this.uniforms = {
      uSunDir: U.uSunDir, uTime: U.uTime, uNight: U.uNight,
      uCloudCover: { value: 0.5 }, uCloudOffset: { value: new THREE.Vector2() }, uStorm: { value: 0 }, uBlizzard: { value: 0 }, uHaze: { value: new THREE.Color() },
      tCloud: { value: Sky.cloudTexture() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { CLOUD_STEPS: quality >= 2 ? 80 : quality > 1 ? 48 : quality >= 1 ? 32 : 18 },   // (dithered: past ~80 steps the gain is not visible)
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: SKY_GLSL + /* glsl */ `
        // storm: a low, flat, blue-grey overcast (also what far clouds fade into)
        // (the breaks between the storm cells are pale, washed sky, not a saturated blue)
        vec3 stormSky(vec3 c){ return mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(0.76, 0.89, 1.06) * (0.95 + 0.2 * uBlizzard) + vec3(0.15, 0.185, 0.24), min(uStorm * 1.05, 1.0)); }
        void main(){
          vec3 d = normalize(vDir);
          vec3 s = normalize(uSunDir);
          vec3 col = skyColor(d, s);
          // storm: a low, flat, blue-grey overcast
          col = stormSky(col);
          float day = smoothstep(-0.12, 0.25, s.y);
          // above the broken storm deck lies a high, sunlit overcast: seen through the breaks it is the brightest thing in
          // the sky, and the deck's dark masses stand against it with lit edges
          {
            vec2 huv = d.xz / (max(d.y, 0.0) + 0.2);
            float hc = fbm(huv * 0.9 + 11.0);
            vec3 hi = vec3(0.66, 0.72, 0.82) * (0.5 + 0.65 * hc) * (0.3 + 0.7 * day);
            col = mix(col, hi, uStorm * (1.0 - uBlizzard) * smoothstep(-0.02, 0.1, d.y) * 0.9);
          }
          // sun disc
          float mu = dot(d, s);
          col += smoothstep(0.99965, 0.9999, mu) * vec3(30.0, 24.0, 16.0) * smoothstep(-0.05, 0.02, s.y);
          // stars + moon
          vec3 m = -s;
          float night = 1.0 - smoothstep(-0.18, 0.02, s.y);
          if (night > 0.0) {
            vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y,-1.0,1.0))) * 420.0;
            vec2 cell = floor(sp);
            float st = h12(cell);
            vec2 off = hash2(cell) ;
            float dd = length(fract(sp) - off);
            float star = step(0.993, st) * smoothstep(0.35, 0.0, dd) * smoothstep(0.0, 0.15, d.y) * (0.6 + 0.4*sin(uTime*3.0 + st*90.0)) * (0.5 + 2.0*fract(st*977.0));
            col += star * vec3(1.6, 1.6, 1.9) * night;
            // milky band
            col += vec3(0.02,0.022,0.03) * fbm(sp/60.0) * smoothstep(0.4, 0.0, abs(dot(d, normalize(vec3(0.3,0.8,0.5))))) * night;
            float md = dot(d, normalize(m + vec3(0.0, 0.25, 0.0)));
            col += smoothstep(0.9993, 0.9996, md) * vec3(2.2, 2.3, 2.5) * night;
            col += pow(max(md,0.0), 300.0) * vec3(0.08, 0.1, 0.14) * night;
          }
          // clouds: raymarched cumulus slab
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.08) * 1.4 + uCloudOffset;
            vec3 sunC = mix(vec3(1.0, 0.5, 0.25), vec3(1.0, 0.95, 0.88), smoothstep(0.0, 0.35, s.y));
            vec3 zen = skyColor(vec3(0.0, 1.0, 0.0), s);
            vec3 hor = skyColor(normalize(vec3(d.x, 0.05, d.z)), s);
            vec3 ambTop = zen * 0.62 + hor * 0.14 + vec3(0.006, 0.008, 0.014);
            vec3 ambBot = mix(hor, vec3(0.30, 0.27, 0.2) * day, 0.5) * 0.16 + vec3(0.003, 0.004, 0.008);
            ambTop = mix(ambTop, vec3(dot(ambTop, vec3(0.3, 0.59, 0.11))) * vec3(0.85, 0.9, 1.0) * 0.8, uStorm);
            ambBot *= 1.0 - 0.3 * uStorm;
            ambTop *= 1.0 - 0.2 * uStorm;
            // (a storm's cloud is lit as hard as any other: its body is dark because it is thick, and its thin torn edges
            // and the walls of its breaks blaze: the silver linings a dimmed, even grey deck never had)
            vec4 cl = marchClouds(d, s, sunC * (2.0 * smoothstep(-0.06, 0.1, s.y) + 0.02) * (1.0 - 0.25 * uStorm), ambTop, ambBot, uCloudCover);
            // aerial perspective: far clouds melt into the horizon haze
            float far = 1.0 - exp(-(CB / max(d.y, 0.02)) / 17000.0);
            vec3 hz = stormSky(skyColor(d, s));
            cl.rgb = mix(cl.rgb, hz * (1.0 - cl.a), far * 0.85);
            // storm decks: heavy slate undersides, with the far horizon left brighter where the light breaks through
            // (a blizzard instead scatters light everywhere: a bright, even grey with no dark undersides)
            cl.rgb *= mix(1.0, mix(0.62, 0.9, far), uStorm * (1.0 - 0.45 * uBlizzard));
            // (and its underside modelled in cells: heavier, darker bellies and paler thin places between them)
            {
              vec2 cuv2 = d.xz / (d.y + 0.14) * 0.9 + uCloudOffset * 2.0;
              float cell = fbm(cuv2 * 1.3) * 0.6 + fbm(cuv2 * 3.1 + 5.2) * 0.4;
              cl.rgb *= mix(1.0, mix(0.45, 1.05, smoothstep(0.3, 0.7, cell)), uStorm * (1.0 - uBlizzard) * smoothstep(0.03, 0.2, d.y));
            }
            float fade = smoothstep(0.0, 0.05, d.y);
            float dens = (1.0 - cl.a) * fade;
            col = col * mix(1.0, cl.a, fade) + cl.rgb * fade;
            // high cirrus
            float ci = fbm(vec2(uv.x*0.45, uv.y*1.1) + 20.0 + uTime*0.002);
            col = mix(col, sunC*(0.9*day+0.03) + vec3(0.1), smoothstep(0.66, 0.92, ci) * 0.16 * fade * (1.0 - dens));
          }
          // in a blizzard the sky is the inside of the snow cloud: a bright, even grey
          // (right up to the zenith: seen from inside falling snow the deck is a pale, softly mottled ceiling, not the
          // dark slate underside of a dry storm; its cells still show through)
          // seen from inside falling snow the deck is a pale ceiling, mottled lighter and darker where the cloud is
          // thinner and thicker, brightening to an even glow at the horizon (a clear dark gradient read as open sky)
          {
            vec2 cuv = d.xz / (max(d.y, 0.0) + 0.16) + uCloudOffset * 3.0;
            float lump = smoothstep(0.28, 0.72, fbm(cuv * 1.15) * 0.65 + fbm(cuv * 3.4 + 7.3) * 0.35);
            // (heavy and dark overhead, as the reference's ceiling presses down on the peaks, with paler rifts)
            vec3 ceilC = uHaze * mix(0.46 + 0.55 * lump * lump, 1.15, 1.0 - smoothstep(0.0, 0.2, d.y));
            col = mix(col, ceilC, uBlizzard * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.setScalar(9000);
    this.mesh.frustumCulled = false;
    // drawn after the opaque world so the cloud march only runs where sky is actually visible
    this.mesh.renderOrder = 1000;
    scene.add(this.mesh);

    // sky-only scene used to generate the environment map
    this.envScene = new THREE.Scene();
    const envMesh = new THREE.Mesh(geo, mat);
    envMesh.scale.setScalar(100);
    this.envScene.add(envMesh);
    // fake ground in the env so reflections and ambient bounce see earth tones
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4a4430 }));
    ground.position.y = -6;
    this.envGround = ground;
    this.envScene.add(ground);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvTime = -100;

    // Lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(4096, 4096);
    const S = 150;
    Object.assign(sh.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 1200 });
    sh.bias = -0.0004;
    sh.normalBias = 0.6;
    sh.radius = 2;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x4a4028, 0.4);
    scene.add(this.hemi);
  }

  static cloudTexture() {
    const N = 64;
    const t = new THREE.Data3DTexture(makeCloudNoise(N), N, N, N);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  sunDirection(t, out = new THREE.Vector3()) {
    // sunrise 6h east (+x), sunset 18h west (-x), arc tilted south (+z)
    const a = ((t - 6) / 12) * Math.PI;
    const elev = Math.sin(a);
    return out.set(Math.cos(a), elev * 0.92, 0.38).normalize();
  }

  setWeather(target, k) {
    for (const key of ['storm', 'humid', 'dry', 'blizzard']) this.weather[key] += ((target[key] ?? target.storm) - this.weather[key]) * Math.min(1, k);
  }

  update(dt, focus) {
    this.time = (this.time + dt * this.timeScale) % 24;
    const s = this.sunDirection(this.time, U.uSunDir.value);
    const sunH = s.y;
    const day = THREE.MathUtils.smoothstep(sunH, -0.1, 0.25);
    const night = 1 - THREE.MathUtils.smoothstep(sunH, -0.16, 0.02);
    U.uNight.value = night;
    this.uniforms.uCloudOffset.value.x += dt * 0.004;

    // sun colour: deep orange near horizon, white at noon
    const warm = THREE.MathUtils.smoothstep(sunH, 0.0, 0.45);
    const sunCol = new THREE.Color().setRGB(1.0, 0.52 + 0.42 * warm, 0.26 + 0.62 * warm);
    const above = THREE.MathUtils.smoothstep(sunH, -0.04, 0.06);
    // moon takes over at night
    // The shadow map is the costliest pass of the frame (every tree, rock and building near the lens drawn again).
    // In play it is redrawn on alternate frames; the light then stays where that map was drawn from, so map and
    // matrix always agree.
    this.tick = (this.tick || 0) + 1;
    const every = this.shadowEvery || 1;
    this.sun.shadow.autoUpdate = every < 2;
    const redraw = every < 2 || this.tick % every === 0 || !this.sun.shadow.map;
    if (above > 0.01) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.8 * above;
      if (redraw) this.sun.position.copy(focus).addScaledVector(s, 600);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 0.95);
      this.sun.intensity = 0.65 * night;
      const m = s.clone().negate(); m.y = Math.max(m.y, 0.25);
      if (redraw) this.sun.position.copy(focus).addScaledVector(m.normalize(), 600);
    }
    if (redraw) {
      // snap shadow camera to texels to avoid shimmering
      const texel = (2 * 150) / this.sun.shadow.mapSize.x;
      const f = focus.clone();
      f.x = Math.round(f.x / texel) * texel; f.z = Math.round(f.z / texel) * texel;
      this.sun.target.position.copy(f);
      this.sun.position.sub(focus).add(f);
      if (every > 1) this.sun.shadow.needsUpdate = true;
    }
    const W = this.weather;
    this.sun.intensity *= 1 - (0.62 + 0.16 * W.blizzard) * W.storm;   // a blizzard is lit mostly by the sky: soft, faint shadows
    // a storm deck in clear air is broken: cloud shadows cover most of the land, and the sun in the breaks is strong
    U.uCloudShadow.value = 0.9 * W.storm * (1 - W.blizzard);
    this.sun.intensity *= 1 + 0.55 * U.uCloudShadow.value;
    this.uniforms.uStorm.value = W.storm;
    this.uniforms.uBlizzard.value = W.blizzard;
    U.uSnowfall.value = W.blizzard;
    // (a storm in clear air is a broken deck, a third of the sky open; in falling snow it closes over)
    this.uniforms.uCloudCover.value = THREE.MathUtils.clamp(0.5 + 0.48 * W.storm * (0.62 + 0.38 * W.blizzard) + 0.12 * W.humid - 0.3 * W.dry, 0.05, 1);
    U.uSunColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);

    this.hemi.intensity = 0.16 + 0.1 * day;
    this.hemi.color.setRGB(0.32 + 0.43 * day, 0.4 + 0.4 * day, 0.62 + 0.23 * day);
    this.hemi.groundColor.setRGB(0.3 * day + 0.03, 0.26 * day + 0.03, 0.17 * day + 0.04);

    // fog / atmosphere
    const dusk = 1 - Math.min(1, Math.abs(sunH - 0.05) / 0.35);
    U.uFogColor.value.setRGB(0.5 * day + 0.02, 0.6 * day + 0.03, 0.72 * day + 0.06).lerp(new THREE.Color(0.75, 0.55, 0.42), dusk * 0.45 * day);
    U.uFogSunColor.value.setRGB(1.0, 0.62 + 0.3 * warm, 0.36 + 0.5 * warm).multiplyScalar(day * 0.75 + 0.02);
    U.uFogDensity.value = 0.0009 + 0.0006 * dusk + 0.0004 * night;
    // weather: blue-grey snow haze, warm green humidity, crisp dry desert air
    U.uFogColor.value.lerp(new THREE.Color(0.38, 0.5, 0.7).lerp(new THREE.Color(0.5, 0.55, 0.63), W.blizzard).multiplyScalar(0.35 + 0.65 * day), Math.max(W.storm * 0.8, W.blizzard * 0.85));   // (falling snow is grey-blue, not cobalt)
    U.uFogColor.value.lerp(new THREE.Color(0.58, 0.64, 0.55).multiplyScalar(0.3 + 0.7 * day), W.humid * 0.4);
    U.uFogSunColor.value.multiplyScalar(1 - 0.75 * W.storm);
    // (falling snow greys out the far side of a valley within a kilometre or two: the reference's ridges fade layer
    // by layer, ours stood crisp and bright at 1.5 km)
    U.uFogDensity.value *= (1 - 0.12 * W.blizzard + 0.45 * W.humid - 0.4 * W.dry) * (1 - 0.2 * W.storm * (1 - W.blizzard));   // humid air hazes, but the sea still reads blue to the horizon
    // storm fog fills the valleys to the ridgelines; fair weather keeps it low
    U.uFogFalloff.value = 0.022 * (1 - 0.8 * W.blizzard) * (1 - 0.3 * W.humid);
    this.uniforms.uHaze.value.copy(U.uFogColor.value);

    // environment map refresh
    // the lower hemisphere of the ambient light is the ground around the camera: snow throws a bright, cool bounce
    // up under hat brims and bellies, a forest floor almost none
    const ga = this.groundAlbedo || (this.groundAlbedo = new THREE.Color(0.22, 0.2, 0.13));
    const gKey = ga.r + ga.g * 3.1 + ga.b * 7.3;
    if (Math.abs(this.time - this.lastEnvTime) > 0.08 || Math.abs(W.storm - this.lastEnvStorm) > 0.04 || Math.abs(gKey - (this.lastGroundKey ?? -1)) > 0.05) {
      this.lastEnvTime = this.time; this.lastEnvStorm = W.storm; this.lastGroundKey = gKey;
      this.envGround.material.color.setRGB(ga.r * day + 0.01, ga.g * day + 0.01, ga.b * day + 0.012);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 400);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.5 + 0.3 * day * Math.min(1, Math.max(0, sunH * 3));
    }
    this.mesh.position.copy(focus);
  }
}
