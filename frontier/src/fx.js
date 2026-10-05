// Pooled GPU particles (dust, gun smoke, blood, embers, chimney smoke), campfires, muzzle flashes, tracers.
import * as THREE from 'three';
import { U, GLSL_FOG_PARS } from './shared.js';


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
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          if (aCol.a <= 0.001) gl_Position = vec4(2.0,2.0,2.0,1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_FOG_PARS}
        varying vec4 vCol; varying float vAdd; varying vec3 vW;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          vec3 col = vCol.rgb;
          if (vAdd < 0.5) {
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
    this.light = new THREE.PointLight(0xff8030, 380, 38, 1.55);
    this.light.position.copy(pos).add(new THREE.Vector3(0, 0.7, 0));
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.bias = -0.002;
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
          vec3 col = mix(vec3(6.0, 1.4, 0.25), vec3(9.0, 6.5, 2.4), smoothstep(0.3, 0.9, body) * (1.0 - uv.y));
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
    this.light.intensity = 340 + Math.sin(this.t * 13) * 40 + Math.sin(this.t * 31) * 25 + Math.random() * 25;
    this.flame.scale.y = 0.9 + Math.sin(this.t * 9) * 0.08 + Math.random() * 0.05;
    if (!near) return;
    if (Math.random() < dt * 40) this.particles.emit(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5)),
      new THREE.Vector3((Math.random() - 0.5) * 0.2, 1.0 + Math.random(), (Math.random() - 0.5) * 0.2),
      { color: [6, 2.2, 0.5], alpha: 0.9, size: 0.45, life: 0.55, grow: -1.2, drag: 1, add: 1 });
    if (Math.random() < dt * 6) this.particles.emit(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3((Math.random() - 0.5) * 0.4, 2.2 + Math.random(), (Math.random() - 0.5) * 0.4),
      { color: [8, 3, 0.6], alpha: 1, size: 0.05, life: 1.8, grow: 0, drag: 0.3, add: 1 });
    if (Math.random() < dt * 8) this.particles.emit(this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), new THREE.Vector3(0, 1.1, 0),
      { color: [0.55, 0.52, 0.5], alpha: 0.35, size: 0.8, life: 5, grow: 0.5, drag: 0.4 });
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
