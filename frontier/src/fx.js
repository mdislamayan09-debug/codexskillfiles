// Pooled GPU particles (dust, gun smoke, blood, embers, chimney smoke), campfires, muzzle flashes, tracers.
import * as THREE from 'three';
import { U, GLSL_FOG_PARS, patchMaterial } from './shared.js';


export class Particles {
  constructor(scene, max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); // rgb + alpha
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.add_ = new Float32Array(max); // additive flag (1 = emissive)
    this.head = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAdd', new THREE.BufferAttribute(this.add_, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 aCol; attribute float aSize; attribute float aAdd;
        uniform float uScale;
        varying vec4 vCol; varying float vAdd; varying vec3 vW;
        void main(){
          vCol = aCol; vAdd = aAdd; vW = position;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          // fade anything drifting right up against the lens (it would fill the frame as a blurry blob)
          vCol.a *= smoothstep(0.5, 1.8, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          if (aCol.a <= 0.001) gl_Position = vec4(2.0,2.0,2.0,1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_FOG_PARS}
        varying vec4 vCol; varying float vAdd; varying vec3 vW;
        float ph(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(ph(i), ph(i+vec2(1,0)), f.x), mix(ph(i+vec2(0,1)), ph(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          vec3 col = vCol.rgb;
          if (vAdd < 0.5) {
            // billowed, ragged puffs instead of clean discs (seed drifts slowly with the particle)
            vec2 sd = vW.xz * 0.37 + vW.y * 0.53;
            float n = pn(c * 4.5 + sd) * 0.62 + pn(c * 10.0 - sd * 1.7) * 0.38;
            a *= smoothstep(0.2, 0.8, n + 0.42 - d * 1.1);
            // lit smoke/dust: sun + sky
            col *= (uSunColor * 0.22 + uFogColor * 0.6);
            col = applyAtmosphere(col, vW);
          }
          gl_FragColor = vec4(col, vCol.a * a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  setScale(h) { this.points.material.uniforms.uScale.value = h * 0.9; }

  emit(p, v, { color = [0.7, 0.6, 0.5], alpha = 0.6, size = 0.5, life = 2, grow = 1, drag = 1, grav = 0, add = 0 } = {}) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color[0], color[1], color[2], alpha], i * 4);
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav; this.add_[i] = add;
    this.col[i * 4 + 3] = alpha;
    this._alpha0 = this._alpha0 || new Float32Array(this.max);
    this._alpha0[i] = alpha;
  }

  burst(p, n, opts, spread = 1, up = 1) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread);
      this.emit(p, v, { ...opts, size: opts.size * (0.7 + Math.random() * 0.6), life: opts.life * (0.7 + Math.random() * 0.6) });
    }
  }

  update(dt) {
    const a0 = this._alpha0;
    if (!a0) return;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt + U.uWind.value.x * dt * 0.3 * (1 - this.add_[i]);
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt + U.uWind.value.y * dt * 0.3 * (1 - this.add_[i]);
      this.size[i] *= 1 + this.grow[i] * dt;
      this.col[i * 4 + 3] = a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAdd.needsUpdate = true;
  }
}

export class Campfire {
  constructor(scene, pos, particles) {
    this.pos = pos.clone();
    this.particles = particles;
    this.light = new THREE.PointLight(0xff7a2c, 900, 28, 2);
    this.light.position.copy(pos).add(new THREE.Vector3(0, 0.7, 0));
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.bias = -0.002;
    this.light.shadow.radius = 4;
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.camera.far = 24;
    scene.add(this.light);
    this.t = 0;
    // flame: crossed billboards with a procedural fire shader
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 uv = vUv;
          float t = uTime * 2.4;
          float turb = n(vec2(uv.x*5.0, uv.y*4.0 - t*2.0)) * 0.6 + n(vec2(uv.x*11.0, uv.y*9.0 - t*3.5)) * 0.4;
          float w = (1.0 - uv.y) * 0.42 + 0.04;
          float body = smoothstep(w, w * 0.25, abs(uv.x - 0.5 + (turb - 0.5) * 0.25 * uv.y));
          body *= smoothstep(1.0, 0.25, uv.y + turb * 0.35) * smoothstep(0.0, 0.08, uv.y);
          // orange-yellow, kept below the bloom/clip point so the core never burns out to white
          vec3 col = mix(vec3(1.8, 0.45, 0.08), vec3(2.6, 1.4, 0.38), smoothstep(0.3, 0.9, body) * (1.0 - uv.y));
          gl_FragColor = vec4(col * body, body);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const fg = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25).translate(0, 0.62, 0), this.flameMat);
      m.rotation.y = (i / 3) * Math.PI;
      fg.add(m);
    }
    fg.position.copy(pos).add(new THREE.Vector3(0, -0.15, 0));
    scene.add(fg);
    this.flame = fg;
  }
  update(dt, near) {
    this.t += dt;
    this.light.castShadow = near && this.light.position.distanceTo(this.lastCam || this.light.position) < 70;
    this.light.intensity = 820 + Math.sin(this.t * 13) * 90 + Math.sin(this.t * 31) * 60 + Math.random() * 60;
    this.flame.scale.y = 0.9 + Math.sin(this.t * 9) * 0.08 + Math.random() * 0.05;
    if (!near) return;
    if (Math.random() < dt * 40) this.particles.emit(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5)),
      new THREE.Vector3((Math.random() - 0.5) * 0.2, 1.0 + Math.random(), (Math.random() - 0.5) * 0.2),
      { color: [2.4, 0.85, 0.18], alpha: 0.6, size: 0.45, life: 0.55, grow: -1.2, drag: 1, add: 1 });
    if (Math.random() < dt * 6) this.particles.emit(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3((Math.random() - 0.5) * 0.4, 2.2 + Math.random(), (Math.random() - 0.5) * 0.4),
      { color: [8, 3, 0.6], alpha: 1, size: 0.05, life: 1.8, grow: 0, drag: 0.3, add: 1 });
    if (Math.random() < dt * 14) this.particles.emit(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.0, (Math.random() - 0.5) * 0.3)), new THREE.Vector3((Math.random() - 0.5) * 0.2, 1.0 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2),
      { color: [0.75, 0.62, 0.52], alpha: 0.4, size: 0.9, life: 6, grow: 0.55, drag: 0.35 });
  }
}

export class Tracers {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.flash = new THREE.PointLight(0xffb060, 0, 14, 2);
    scene.add(this.flash);
    this.mat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8 });
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,170,60,0.8)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(4, 3, 2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flashSprite.scale.setScalar(0.6);
    this.flashSprite.visible = false;
    scene.add(this.flashSprite);
    this.flashT = 0;
  }
  shot(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const l = new THREE.Line(g, this.mat.clone());
    this.scene.add(l);
    this.items.push({ l, t: 0.06 });
    this.flash.position.copy(from);
    this.flash.intensity = 40;
    this.flashSprite.position.copy(from);
    this.flashSprite.visible = true;
    this.flashSprite.material.rotation = Math.random() * 6;
    this.flashT = 0.05;
  }
  update(dt) {
    this.flashT -= dt;
    if (this.flashT <= 0) { this.flash.intensity = 0; this.flashSprite.visible = false; }
    this.items = this.items.filter((it) => {
      it.t -= dt;
      it.l.material.opacity = Math.max(0, it.t / 0.06) * 0.8;
      if (it.t <= 0) { this.scene.remove(it.l); it.l.geometry.dispose(); return false; }
      return true;
    });
  }
}

// Falling snow: a box of flakes that wraps around the camera, animated entirely on the GPU.
export class Snowfall {
  constructor(scene, count = 9000) {
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uIntensity: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uIntensity; uniform vec3 uCam; uniform float uScale; uniform float uTime; uniform vec2 uWind;
        varying float vA;
        void main(){
          const vec3 BOX = vec3(84.0, 38.0, 84.0);   // deep enough that the fall thins into the distance
          float fall = 0.9 + aSeed.w * 0.9;
          vec3 p = aSeed.xyz * BOX;
          p.y -= uTime * fall;
          p.xz += uWind * uTime * (1.6 + aSeed.w) + vec2(sin(uTime * 0.9 + aSeed.w * 40.0), cos(uTime * 0.7 + aSeed.x * 30.0)) * 0.5;
          p = mod(p - uCam + BOX * 0.5, BOX) + uCam - BOX * 0.5;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          // a few big wet flakes among many fine ones; those passing close to the lens are soft, out-of-focus discs
          float sz = 0.016 + 0.03 * aSeed.x * aSeed.x + 0.05 * step(0.93, aSeed.z) * aSeed.x;
          gl_PointSize = max(sz * uScale / max(d, 0.3) * (1.0 + 1.5 * smoothstep(3.0, 0.8, d)), 1.4);
          vA = uIntensity * step(aSeed.y, uIntensity * 1.2) * smoothstep(0.5, 1.4, d) * smoothstep(40.0, 16.0, d) * (0.55 + 0.45 * aSeed.z) * mix(0.35, 1.0, smoothstep(0.8, 3.0, d));
          if (vA <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor;
        varying float vA;
        void main(){
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, r) * vA;
          gl_FragColor = vec4(mix(vec3(0.9, 0.93, 0.97), uFogColor * 1.6, 0.25), a * 0.85);
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }
  setScale(h) { this.mat.uniforms.uScale.value = h * 0.9; }
  update(camPos, intensity) {
    this.mat.uniforms.uCam.value.copy(camPos);
    this.mat.uniforms.uIntensity.value = intensity;
    this.points.visible = intensity > 0.01;
  }
}

// The trench a horse ploughs through deep snow: a ribbon following the ride, churned with hoof pits and
// raised rims, laid just above the terrain.
export class SnowTrail {
  constructor(scene, world, max = 360) {
    this.world = world; this.max = max; this.pts = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(max * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    patchMaterial(m, {
      fragColor: /* glsl */ `
        #include <color_fragment>
        {
          float across = vUv.x;                       // 0..1 across the trench
          float along = vUv.y;
          float lane = min(abs(across - 0.32), abs(across - 0.68));
          float pit = smoothstep(0.62, 0.8, vnoise(vec2(across * 6.0, along * 2.2))) * smoothstep(0.2, 0.05, lane);
          vec3 trough = vec3(0.6, 0.66, 0.76);       // shadowed, compacted snow
          vec3 rim = vec3(0.94, 0.95, 0.97);         // thrown-up snow on the lips
          float edge = smoothstep(0.32, 0.5, abs(across - 0.5));
          vec3 col = mix(trough * (0.9 + 0.2 * vnoise(vWPos.xz * 4.0)), rim, edge);
          col = mix(col, vec3(0.45, 0.5, 0.6), pit * 0.7);
          diffuseColor.rgb = col;
          diffuseColor.a = smoothstep(0.5, 0.36, abs(across - 0.5)) * 0.92 * smoothstep(0.0, 0.04, along);
        }`,
    });
    m.defines = { USE_UV: '' }; // three declares and fills vUv for us
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    // the trough is carved into the terrain's own snow shading now (uTrail); the strip mesh read as a grey board
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  add(x, z) {
    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot(x - last[0], z - last[1]) < 0.7) return;
    this.pts.push([x, z]);
    if (this.pts.length > this.max) this.pts.shift();
    this.rebuild();
  }
  clear() { this.pts = []; this.rebuild(); }
  // a trench already ploughed behind a rider (for shots that start mid-ride)
  prefill(x, z, yaw, len = 45) {
    this.pts = [];
    const bx = -Math.sin(yaw), bz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (let d = len; d >= 0; d -= 0.8) {
      const w = Math.sin(d * 0.11) * 1.2 + Math.sin(d * 0.37) * 0.25;
      this.pts.push([x + bx * (d + 1.4) + rx * w, z + bz * (d + 1.4) + rz * w]);
    }
    this.rebuild();
  }
  rebuild() {
    const g = this.mesh.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, UV = g.attributes.uv.array;
    const n = this.pts.length, W = 0.75;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const [x, z] = this.pts[i];
      const [px, pz] = this.pts[Math.max(0, i - 1)], [nx, nz] = this.pts[Math.min(n - 1, i + 1)];
      let tx = nx - px, tz = nz - pz; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i > 0) along += Math.hypot(x - px, z - pz);
      for (let s = 0; s < 2; s++) {
        const sx = x + (s ? -tz : tz) * W, sz = z + (s ? tx : -tx) * W;
        const k = (i * 2 + s);
        P[k * 3] = sx; P[k * 3 + 1] = this.world.heightAt(sx, sz) + 0.14; P[k * 3 + 2] = sz;
        N[k * 3] = 0; N[k * 3 + 1] = 1; N[k * 3 + 2] = 0;
        UV[k * 2] = s; UV[k * 2 + 1] = along * 0.5;
      }
    }
    g.setDrawRange(0, Math.max(0, n - 1) * 6);
    // the last 48 points, resampled about a metre apart, feed the terrain shader
    {
      const T = U.uTrail.value, out = [];
      for (let i = n - 1; i >= 0 && out.length < 48; i--) {
        const p = this.pts[i], last = out[out.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.95 || i === 0) out.push(p);
      }
      out.reverse();
      for (let i = 0; i < 48; i++) { const p = out[Math.min(i, out.length - 1)] || [0, 0]; T[i].set(p[0], p[1]); }
      U.uTrailN.value = out.length;
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.uv.needsUpdate = true;
  }
}
