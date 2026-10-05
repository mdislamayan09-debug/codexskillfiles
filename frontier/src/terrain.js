// GPU-displaced, instanced chunk-LOD terrain with a procedural splat shader.
import * as THREE from 'three';
import { U, GLSL_COMMON, patchMaterial } from './shared.js';
import { WORLD_SIZE, HALF } from './world.js';

const CHUNK = 128;
const N_CHUNKS = WORLD_SIZE / CHUNK;
const LODS = [64, 32, 16, 8, 4];
const LOD_DIST = [200, 480, 1100, 2400, 1e9];

function makeLodGeometry(seg, skirtDepth) {
  // positions: x,z in [0,1] grid; y = skirt flag
  const verts = [];
  const idx = [];
  const row = seg + 1;
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) verts.push(i / seg, 0, j / seg);
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // skirts
  const edge = (list) => {
    const base = verts.length / 3;
    for (const [i, j] of list) verts.push(i / seg, skirtDepth, j / seg);
    for (let k = 0; k < list.length - 1; k++) {
      const a0 = list[k][1] * row + list[k][0], a1 = list[k + 1][1] * row + list[k + 1][0];
      const s0 = base + k, s1 = base + k + 1;
      idx.push(a0, a1, s0, a1, s1, s0, a0, s0, a1, a1, s0, s1); // double sided
    }
  };
  const top = [], bot = [], lef = [], rig = [];
  for (let i = 0; i <= seg; i++) { top.push([i, 0]); bot.push([i, seg]); lef.push([0, i]); rig.push([seg, i]); }
  edge(top); edge(bot); edge(lef); edge(rig);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  const maxInst = N_CHUNKS * N_CHUNKS;
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(maxInst * 2), 2);
  inst.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aChunk', inst);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

const VERT_HEAD = /* glsl */ `
attribute vec2 aChunk;
uniform float uChunk;
`;
const VERT_BODY = /* glsl */ `
  vec2 wxz = aChunk + position.xz * uChunk;
  float hgt = heightAt(wxz) - position.y;
  vec3 transformed = vec3(wxz.x, hgt, wxz.y);
`;
const BEGIN_NORMAL = /* glsl */ `
  vec3 objectNormal = normalAt(aChunk + position.xz * uChunk);
`;

export const TERRAIN_FRAG_HEAD = /* glsl */ `
vec3 srgb(vec3 c){ return pow(c/255.0, vec3(2.2)); }
float gTRough = 0.9;
vec3 gTNormal = vec3(0.0,1.0,0.0);
vec3 terrainAlbedo(vec3 wp, vec3 n, out float rough){
  vec2 xz = wp.xz;
  vec4 sp = splatAt(xz);
  float road = sp.r, wet = sp.g, forest = sp.b, town = sp.a;
  float slope = 1.0 - n.y;
  float macro = fbm2(xz/380.0);
  float mid = fbm2(xz/45.0 + 7.0);
  float micro = vnoise(xz*1.7) * 0.5 + vnoise(xz*6.3)*0.5;
  float patchy = fbm2(xz/11.0 + 3.0);

  vec3 lush = mix(srgb(vec3(70,92,38)), srgb(vec3(96,112,44)), mid);
  vec3 dry = mix(srgb(vec3(146,128,72)), srgb(vec3(122,116,64)), mid);
  vec3 grass = mix(lush, dry, smoothstep(0.42, 0.68, macro + 0.15*patchy));
  grass *= 0.82 + 0.3*micro;
  // clover/flower specks
  grass = mix(grass, srgb(vec3(150,140,90)), smoothstep(0.78,0.9, vnoise(xz*0.9+11.0))*0.35);
  vec3 forestFloor = mix(srgb(vec3(66,56,38)), srgb(vec3(58,66,34)), patchy) * (0.8+0.3*micro);
  vec3 dirt = mix(srgb(vec3(116,92,66)), srgb(vec3(138,112,82)), micro);
  vec3 roadC = mix(srgb(vec3(128,104,78)), srgb(vec3(104,84,64)), vnoise(xz*0.6)) * (0.88+0.2*micro);
  vec3 mud = srgb(vec3(62,52,40)) * (0.85+0.25*micro);
  vec3 rock = mix(srgb(vec3(96,92,86)), srgb(vec3(70,68,66)), fbm2(xz/7.0)) * (0.75+0.4*micro);
  rock *= 0.8 + 0.4 * smoothstep(0.3, 0.7, fbm2(vec2(xz.x+xz.y, wp.y*3.0)/9.0)); // strata
  rock = mix(rock, srgb(vec3(124,104,84)), smoothstep(0.55,0.75,fbm2(vec2(xz.x/30.0, wp.y/6.0))));
  vec3 snow = srgb(vec3(232,236,242));

  vec3 c = grass; rough = 0.92;
  c = mix(c, forestFloor, smoothstep(0.25, 0.75, forest));
  float dirtAmt = smoothstep(0.55, 0.95, patchy + 0.25*town) * (0.35 + 0.65*town);
  c = mix(c, dirt, dirtAmt);
  float rr = smoothstep(0.35, 0.75, road + (micro-0.5)*0.25);
  c = mix(c, roadC, rr);
  // wheel ruts
  c *= 1.0 - rr*0.12*smoothstep(0.6,1.0,sin(xz.x*1.4+xz.y*0.4)*0.5+0.5);
  // town street: twin wheel ruts per lane, hoof-churned mud and puddles
  float street = smoothstep(0.5, 0.9, town) * smoothstep(11.0, 8.0, abs(xz.y)) * step(abs(xz.x), 150.0);
  float lanes = 0.0;
  for (int k = 0; k < 4; k++) {
    float zc = (float(k) - 1.5) * 2.6 + (vnoise(vec2(xz.x*0.05, float(k)*7.0)) - 0.5) * 0.8;
    lanes = max(lanes, smoothstep(0.32, 0.08, abs(xz.y - zc)));
  }
  float hoof = smoothstep(0.62, 0.8, vnoise(xz * 3.3)) * 0.5;
  c = mix(c, roadC * 0.62, street * max(lanes * 0.8, hoof));
  float puddle = street * smoothstep(0.66, 0.74, fbm2(xz * 0.22 + 4.0)) ;
  c = mix(c, mud * 0.55, puddle);
  rough = mix(rough, 0.08, puddle);
  float shore = smoothstep(2.4, 0.4, wp.y);
  c = mix(c, mud, max(wet*0.55, shore)*(1.0-rr));
  rough = mix(rough, 0.45, shore);
  float rockAmt = smoothstep(0.28, 0.45, slope + (mid-0.5)*0.25) ;
  rockAmt = max(rockAmt, smoothstep(200.0, 280.0, wp.y + mid*60.0) * smoothstep(0.1, 0.22, slope));
  // alpine meadow / conifer floor tint on high slopes
  c = mix(c, srgb(vec3(58,66,40)) * (0.8+0.3*micro), smoothstep(60.0, 140.0, wp.y) * (1.0 - rockAmt) * 0.6);
  c = mix(c, rock, rockAmt);
  float snowAmt = smoothstep(300.0, 360.0, wp.y + (mid-0.5)*120.0) * smoothstep(0.8, 0.5, slope);
  c = mix(c, snow, snowAmt);
  rough = mix(rough, 0.55, snowAmt);
  return c;
}
`;

export class Terrain {
  constructor(world, scene) {
    this.world = world;
    this.meshes = [];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    patchMaterial(mat, {
      vertexHead: VERT_HEAD,
      vertexBody: VERT_BODY,
      beginNormal: BEGIN_NORMAL,
      fragHead: TERRAIN_FRAG_HEAD,
      fragColor: /* glsl */ `
        #include <color_fragment>
        vec3 nW = normalAt(vWPos.xz);
        // detail bump
        float e = 0.15;
        vec2 bx = vWPos.xz;
        float b0 = fbm2(bx*1.3), b1 = fbm2((bx+vec2(e,0.0))*1.3), b2 = fbm2((bx+vec2(0.0,e))*1.3);
        float camD = length(vWPos - cameraPosition);
        float bumpS = 0.9 * smoothstep(120.0, 10.0, camD);
        nW = normalize(nW + vec3(b0-b1, 0.0, b0-b2) * bumpS * 4.0);
        float tr;
        diffuseColor.rgb = terrainAlbedo(vWPos, nW, tr);
        // distant forests read as a canopy mass (impostors thin out with distance)
        {
          float fo = splatAt(vWPos.xz).b;
          float canopyK = smoothstep(0.3, 0.65, fo) * smoothstep(180.0, 420.0, camD);
          vec3 canopy = mix(srgb(vec3(34,46,26)), srgb(vec3(52,62,32)), fbm2(vWPos.xz/18.0)) * (0.7 + 0.5*vnoise(vWPos.xz/4.0));
          canopy = mix(canopy, srgb(vec3(30,40,30)), smoothstep(80.0, 200.0, vWPos.y) * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, canopy, canopyK);
          tr = mix(tr, 1.0, canopyK);
        }
        gTRough = tr;
        gTNormal = nW;
      `,
      onShader: (shader) => {
        shader.uniforms.uChunk = { value: CHUNK };
        this.shaders.push(shader);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gTRough;')
          .replace('#include <normal_fragment_begin>', `
            #include <normal_fragment_begin>
            normal = normalize((viewMatrix * vec4(gTNormal, 0.0)).xyz);
            nonPerturbedNormal = normal;
          `);
      },
    });
    this.shaders = [];
    this.material = mat;
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.uniforms.uChunk = { value: CHUNK };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>', VERT_BODY);
    };
    LODS.forEach((seg, li) => {
      const g = makeLodGeometry(seg, 2 * Math.pow(2, li));
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = li <= 1;
      m.customDepthMaterial = depthMat;
      scene.add(m);
      this.meshes.push(m);
    });
    // chunk bounds for culling
    this.bounds = [];
    for (let cz = 0; cz < N_CHUNKS; cz++) for (let cx = 0; cx < N_CHUNKS; cx++) {
      const x0 = -HALF + cx * CHUNK, z0 = -HALF + cz * CHUNK;
      let mn = 1e9, mx = -1e9;
      for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
        const h = world.heightAt(x0 + (i / 8) * CHUNK, z0 + (j / 8) * CHUNK);
        mn = Math.min(mn, h); mx = Math.max(mx, h);
      }
      this.bounds.push(new THREE.Box3(new THREE.Vector3(x0, mn - 12, z0), new THREE.Vector3(x0 + CHUNK, mx + 4, z0 + CHUNK)));
    }
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
  }

  update(camera) {
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const counts = LODS.map(() => 0);
    const arrays = this.meshes.map((m) => m.geometry.attributes.aChunk.array);
    const cx = camera.position.x, cz = camera.position.z;
    for (let k = 0; k < this.bounds.length; k++) {
      const b = this.bounds[k];
      if (!this._frustum.intersectsBox(b)) continue;
      const mx = Math.max(b.min.x - cx, 0, cx - b.max.x), mz = Math.max(b.min.z - cz, 0, cz - b.max.z);
      const d = Math.hypot(mx, mz, Math.max(0, camera.position.y - b.max.y) * 0.5);
      let l = 0;
      while (d > LOD_DIST[l]) l++;
      const a = arrays[l];
      a[counts[l] * 2] = b.min.x; a[counts[l] * 2 + 1] = b.min.z;
      counts[l]++;
    }
    this.meshes.forEach((m, l) => {
      m.geometry.instanceCount = counts[l];
      const at = m.geometry.attributes.aChunk;
      at.clearUpdateRanges();
      at.addUpdateRange(0, counts[l] * 2);
      at.needsUpdate = true;
    });
  }
}
