// Rivers, lake and bayou share one water plane at y=0 with planar reflections,
// depth-based colour/transparency from the heightfield, shoreline foam and sun glints.
import * as THREE from 'three';
import { U, GLSL_COMMON, GLSL_FOG_PARS } from './shared.js';
import { WATER_LEVEL } from './world.js';

export class Water {
  constructor(scene, renderer, { reflections = true, resScale = 0.5, normals = null } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.reflections = reflections;
    this.resScale = resScale;
    this.rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
    this.rt.texture.generateMipmaps = false;
    this.mirrorCam = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_LEVEL + 0.05);

    const geo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...U, uRefl: { value: this.rt.texture }, uTexMat: { value: this.textureMatrix }, uHasRefl: { value: reflections ? 1 : 0 }, tWaterN: { value: normals }, uRipples: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) } },
      vertexShader: /* glsl */ `
        uniform mat4 uTexMat;
        varying vec3 vW; varying vec4 vProj;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vProj = uTexMat * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        ${GLSL_FOG_PARS}
        uniform sampler2D uRefl; uniform sampler2D tWaterN; uniform float uHasRefl; uniform vec4 uRipples[6];
        varying vec3 vW; varying vec4 vProj;
        float waves(vec2 p){
          float t = uTime;
          return fbm2(p*0.35 + vec2(t*0.05, t*0.03)) * 0.6 + fbm2(p*1.3 - vec2(t*0.09, -t*0.06)) * 0.3 + vnoise(p*4.0 + t*0.4) * 0.1;
        }
        void main(){
          vec2 p = vW.xz;
          float ground = heightAt(p);
          float depth = max(-ground, 0.0);
          if (depth < 0.02) discard;
          vec4 sp = splatAt(p);
          float swampy = smoothstep(0.5, 1.0, sp.g) * step(600.0, p.x);
          float camD = length(vW - cameraPosition);
          float e = 0.08;
          float w0 = waves(p), wx = waves(p+vec2(e,0.0)), wz = waves(p+vec2(0.0,e));
          float amp = mix(0.55, 0.18, swampy) * smoothstep(400.0, 30.0, camD) + 0.05;
          vec3 N = normalize(vec3((w0-wx)/e*amp, 1.0, (w0-wz)/e*amp));
          {
            // two scrolling layers of scanned ripple normals for close-up detail
            vec3 a1 = texture(tWaterN, p / 7.0 + vec2(uTime * 0.021, uTime * 0.013)).xzy * 2.0 - 1.0;
            vec3 a2 = texture(tWaterN, p / 17.0 - vec2(uTime * 0.012, -uTime * 0.017)).xzy * 2.0 - 1.0;
            float k = mix(0.55, 0.2, swampy) * smoothstep(250.0, 10.0, camD);
            N = normalize(N + vec3(a1.x + a2.x, 0.0, a1.z + a2.z) * k);
          }
          // ripple rings where legs and bodies break the surface
          float ripFoam = 0.0;
          for (int i = 0; i < 6; i++) {
            vec4 rp = uRipples[i];
            if (rp.z <= 0.0) continue;
            vec2 dv = p - rp.xy; float d = length(dv);
            float ring = sin(d * 15.0 - uTime * 6.5) * exp(-d * 1.4) * rp.z;
            N.xz += dv / max(d, 1e-3) * ring * 0.35;
            ripFoam += smoothstep(1.1, 0.25, d) * rp.z * (0.6 + 0.4 * vnoise(p * 9.0 + uTime));
          }
          N = normalize(N);
          vec3 V = normalize(cameraPosition - vW);
          // open ocean: a wind-roughened surface averages a much weaker grazing mirror than calm water, so the sea
          // keeps its deep blue body colour out to the horizon instead of turning into a sheet of white sky
          float ocean = smoothstep(4.0, 20.0, depth) * (1.0 - swampy);
          float fres = (0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0)) * mix(1.0, 0.5, ocean * smoothstep(60.0, 500.0, camD));
          vec3 sun = normalize(uSunDir);
          // reflection
          vec2 ruv = vProj.xy / vProj.w + N.xz * 0.035;
          vec3 refl = texture(uRefl, ruv).rgb;
          vec3 skyFallback = mix(uFogColor * 0.9, uFogSunColor, pow(max(dot(reflect(-V,N), sun),0.0), 4.0));
          refl = mix(skyFallback, refl, uHasRefl);
          // body colour
          vec3 deep = mix(mix(vec3(0.016, 0.03, 0.024), vec3(0.03, 0.022, 0.01), swampy), vec3(0.006, 0.03, 0.062), ocean);
          vec3 shallow = mix(vec3(0.09, 0.095, 0.06), vec3(0.085, 0.065, 0.035), swampy);
          float dk = 1.0 - exp(-depth * 1.1);
          vec3 body = mix(shallow, deep, dk) * (0.3 + 0.7 * dot(uSunColor, vec3(0.3)));
          vec3 col = mix(body, refl * mix(1.0, 0.8, swampy), clamp(fres * mix(1.0, 0.8, swampy) + 0.03, 0.0, 1.0));
          // sun glint
          float spec = pow(max(dot(reflect(-sun, N), V), 0.0), 600.0);
          col += uSunColor * spec * 3.0;
          // shoreline foam / scum
          float foam = smoothstep(0.35, 0.0, depth) * (0.5 + 0.5 * vnoise(p * 3.0 + uTime*0.3)) + min(ripFoam, 1.0) * 0.7;
          col = mix(col, vec3(0.5, 0.47, 0.4) * (0.2 + 0.4*dot(uSunColor, vec3(0.3))), foam * 0.5);
          // algae patches in the bayou
          float algae = swampy * smoothstep(0.55, 0.75, fbm2(p*0.12)) * 0.75;
          col = mix(col, vec3(0.06, 0.08, 0.02) * (0.4 + dot(uSunColor, vec3(0.3))), algae);
          float alpha = clamp(smoothstep(0.0, 0.9, depth) * 0.95 + fres * 0.35 + algae, 0.0, 1.0);
          col = applyAtmosphere(col, vW);
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.set(7000, 1, 7000);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  setRipples(list) {
    const arr = this.material.uniforms.uRipples.value;
    for (let i = 0; i < arr.length; i++) { const r = list[i]; if (r) arr[i].set(r[0], r[1], r[2], 0); else arr[i].set(0, 0, 0, 0); }
  }

  update(camera, skipLayers = []) {
    this.mesh.position.x = Math.round(camera.position.x / 50) * 50;
    this.mesh.position.z = Math.round(camera.position.z / 50) * 50;
    if (!this.reflections) return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(64, Math.floor(size.x * this.resScale)), h = Math.max(64, Math.floor(size.y * this.resScale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    if (camera.position.y < WATER_LEVEL) return;
    // mirror camera
    const mc = this.mirrorCam;
    mc.copy(camera);
    const p = camera.position.clone(); p.y = 2 * WATER_LEVEL - p.y;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = -dir.y;
    const up = camera.up.clone(); up.y = -up.y;
    mc.position.copy(p);
    mc.up.copy(up);
    mc.lookAt(p.clone().add(dir));
    mc.updateMatrixWorld();
    mc.projectionMatrix.copy(camera.projectionMatrix);
    // texture matrix (world -> reflection uv)
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
    mc.layers.set(0);
    this.mesh.visible = false;
    const prevT = r.getRenderTarget();
    const prevClip = r.clippingPlanes;
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.clippingPlanes = [this.clipPlane];
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, mc);
    r.setRenderTarget(prevT);
    r.clippingPlanes = prevClip;
    r.shadowMap.autoUpdate = prevShadow;
    this.mesh.visible = true;
  }
}
