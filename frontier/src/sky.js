// Sky dome (analytic scattering + painted cumulus), sun/moon, time of day and image-based light.
import * as THREE from 'three';
import { U } from './shared.js';

const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform float uNight;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
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
`;

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 17.6; // hours — golden hour
    this.timeScale = 1 / 60; // hours per real second (1 day = 24 min)
    this.uniforms = {
      uSunDir: U.uSunDir, uTime: U.uTime, uNight: U.uNight,
      uCloudCover: { value: 0.5 }, uCloudOffset: { value: new THREE.Vector2() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: SKY_GLSL + /* glsl */ `
        void main(){
          vec3 d = normalize(vDir);
          vec3 s = normalize(uSunDir);
          vec3 col = skyColor(d, s);
          float day = smoothstep(-0.12, 0.25, s.y);
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
          // clouds on a curved plane
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.08) * 1.4 + uCloudOffset;
            vec2 w = vec2(fbm(uv*0.6 + uTime*0.003), fbm(uv*0.6 + 5.2));
            float base = fbm(uv*0.9 + w*1.4);
            float cov = uCloudCover;
            float dens = smoothstep(1.0 - cov, 1.0 - cov + 0.32, base);
            // light march toward sun
            vec2 toSun = normalize(s.xz + 1e-4) * 0.06;
            float dl = smoothstep(1.0 - cov, 1.0 - cov + 0.32, fbm((uv + toSun)*0.9 + w*1.4));
            float shade = clamp(1.0 - (dl - dens*0.55)*1.6, 0.0, 1.0);
            vec3 sunC = mix(vec3(1.0, 0.5, 0.25), vec3(1.0, 0.95, 0.88), smoothstep(0.0, 0.35, s.y));
            vec3 lit = mix(vec3(0.42, 0.45, 0.52)*day + vec3(0.02,0.025,0.04), sunC * (1.25*day + 0.04), shade);
            // silver lining near sun
            lit += pow(max(mu,0.0), 6.0) * sunC * (1.0 - dens) * 2.2 * day;
            lit = mix(lit, skyColor(d, s)*1.05, 0.25);
            float fade = smoothstep(0.0, 0.18, d.y);
            col = mix(col, lit, dens * fade * 0.96);
            // high cirrus
            float ci = fbm(vec2(uv.x*0.25, uv.y*1.6) + 20.0 + uTime*0.002);
            col = mix(col, sunC*(0.9*day+0.03) + vec3(0.1), smoothstep(0.62, 0.9, ci) * 0.3 * fade * (1.0 - dens));
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
    this.mesh.renderOrder = -1;
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

  sunDirection(t, out = new THREE.Vector3()) {
    // sunrise 6h east (+x), sunset 18h west (-x), arc tilted south (+z)
    const a = ((t - 6) / 12) * Math.PI;
    const elev = Math.sin(a);
    return out.set(Math.cos(a), elev * 0.92, 0.38).normalize();
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
    if (above > 0.01) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.8 * above;
      this.sun.position.copy(focus).addScaledVector(s, 600);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 0.95);
      this.sun.intensity = 0.65 * night;
      const m = s.clone().negate(); m.y = Math.max(m.y, 0.25);
      this.sun.position.copy(focus).addScaledVector(m.normalize(), 600);
    }
    // snap shadow camera to texels to avoid shimmering
    const texel = (2 * 150) / 4096;
    const f = focus.clone();
    f.x = Math.round(f.x / texel) * texel; f.z = Math.round(f.z / texel) * texel;
    this.sun.target.position.copy(f);
    this.sun.position.sub(focus).add(f);
    U.uSunColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);

    this.hemi.intensity = 0.16 + 0.1 * day;
    this.hemi.color.setRGB(0.32 + 0.43 * day, 0.4 + 0.4 * day, 0.62 + 0.23 * day);
    this.hemi.groundColor.setRGB(0.3 * day + 0.03, 0.26 * day + 0.03, 0.17 * day + 0.04);

    // fog / atmosphere
    const dusk = 1 - Math.min(1, Math.abs(sunH - 0.05) / 0.35);
    U.uFogColor.value.setRGB(0.5 * day + 0.02, 0.6 * day + 0.03, 0.72 * day + 0.06).lerp(new THREE.Color(0.75, 0.55, 0.42), dusk * 0.45 * day);
    U.uFogSunColor.value.setRGB(1.0, 0.62 + 0.3 * warm, 0.36 + 0.5 * warm).multiplyScalar(day * 0.75 + 0.02);
    U.uFogDensity.value = 0.0009 + 0.0006 * dusk + 0.0004 * night;

    // environment map refresh
    if (Math.abs(this.time - this.lastEnvTime) > 0.08) {
      this.lastEnvTime = this.time;
      this.envGround.material.color.setRGB(0.22 * day + 0.01, 0.2 * day + 0.01, 0.13 * day + 0.012);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 400);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.5 + 0.3 * day * Math.min(1, Math.max(0, sunH * 3));
    }
    this.mesh.position.copy(focus);
  }
}
