import * as THREE from 'three';
import { damp } from '../core/math';
import { addPatch, replaceOnce } from '../render/materials/MaterialPatches';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { generateRock } from '../world/props/RockGenerator';
import { itemDef } from '../game/items';

// First-person hands and held items. Drawn in the second (transparent)
// pass with clip-space depth squeezed toward the near plane, so the tool
// never sinks into walls yet still self-occludes and receives sun, shadow
// and sky light like everything else.

const VIEWMODEL_DEPTH = /* glsl */ `
#include <project_vertex>
gl_Position.z = mix(-gl_Position.w, gl_Position.z, 0.035);
`;

function viewmodelMaterial(color: THREE.ColorRepresentation, roughness = 0.8, metalness = 0, emissive?: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: emissive ?? 0x000000 });
  addPatch(m, {
    key: 'viewmodel-depth',
    apply(shader) {
      shader.vertexShader = replaceOnce(shader.vertexShader, '#include <project_vertex>', VIEWMODEL_DEPTH, 'viewmodel-depth');
    },
  });
  return m;
}

const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Camera-facing quad (the viewmodel lives in camera space already).
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy;
  gl_Position = projectionMatrix * mv;
  gl_Position.z = mix(-gl_Position.w, gl_Position.z, 0.03);
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  float t = uTime * 3.2;
  float turb = n(vec2(uv.x * 3.0, uv.y * 2.0 - t)) * 0.5 + n(vec2(uv.x * 6.0, uv.y * 4.0 - t * 1.7)) * 0.25;
  uv.x += (turb - 0.35) * 0.35 * (uv.y + 1.0) * 0.5;
  float shape = 1.0 - smoothstep(0.0, 1.0, length(vec2(uv.x * 1.9 / max(0.25, 1.0 - (uv.y + 1.0) * 0.42), (uv.y + 0.35) * 0.95)));
  shape *= smoothstep(-1.0, -0.6, uv.y);
  float core = pow(max(shape, 0.0), 2.5);
  vec3 col = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.8, 0.45), core) * (shape * 4.5 + core * 10.0);
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

interface HeldVisual {
  group: THREE.Group;
  /** Grip offset (the hand wraps here). */
  light?: { color: THREE.Color; intensity: number; flicker: number };
  flame?: THREE.Mesh;
  twoHanded?: boolean;
}

export class Viewmodel {
  readonly root = new THREE.Group();
  readonly light: THREE.PointLight;
  private readonly arm = new THREE.Group();
  private readonly holder = new THREE.Group();
  private readonly cache = new Map<string, HeldVisual>();
  private current: HeldVisual | null = null;
  private currentId: string | null = null;
  private readonly flameUniforms = { uTime: { value: 0 }, uIntensity: { value: 1 } };
  private readonly materials = {
    glove: viewmodelMaterial(0x3a2a1c, 0.75),
    sleeve: viewmodelMaterial(0x2f3a2c, 0.95),
    wood: viewmodelMaterial(0x6a4a2c, 0.8),
    darkWood: viewmodelMaterial(0x3d2b1b, 0.85),
    lashing: viewmodelMaterial(0x9c8a5e, 0.95),
    stone: viewmodelMaterial(0x6d6a64, 0.7),
    flint: viewmodelMaterial(0x26262c, 0.25),
    iron: viewmodelMaterial(0x8a8d92, 0.35, 0.9),
    leather: viewmodelMaterial(0x5a3d24, 0.7),
    cloth: viewmodelMaterial(0x2a2118, 0.95),
    brass: viewmodelMaterial(0xb08d4a, 0.35, 1),
    glass: viewmodelMaterial(0x2ec9b4, 0.1, 0, 0x1a9c8c),
    berry: viewmodelMaterial(0x7a0c14, 0.35),
    mushroom: viewmodelMaterial(0x8a5a36, 0.7),
    meat: viewmodelMaterial(0x8a3024, 0.55),
    cooked: viewmodelMaterial(0x5a2e16, 0.6),
  };
  private swayX = 0;
  private swayY = 0;
  private bob = 0;
  private lower = 1;
  private equipTimer = 0;
  private time = 0;

  constructor() {
    this.root.name = 'viewmodel';
    this.light = new THREE.PointLight(0xffa35a, 0, 14, 2);
    this.light.castShadow = false;
    // Held lights sit ahead of the hand so the glove isn't blown out.
    this.light.position.set(0.05, 0.4, -1.1);
    this.root.add(this.light);
    this.root.add(this.arm);
    this.buildArm();
    this.arm.add(this.holder);
    this.holder.position.set(0, 0, 0);
    this.setLayer(this.root);
  }

  private setLayer(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      o.layers.set(LAYER_TRANSPARENT);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
      }
    });
  }

  private buildArm(): void {
    // Sleeve disappearing off the bottom-right of the screen.
    // The forearm runs down and back toward the camera from the wrist
    // (expressed in the arm's tilted local frame).
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.07, 0.45, 12, 1, true), this.materials.sleeve);
    sleeve.rotation.x = -0.49;
    sleeve.position.set(0.02, -0.25, 0.135);
    this.arm.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 6, 14), this.materials.leather);
    cuff.rotation.x = Math.PI / 2 - 0.49;
    cuff.position.set(0.02, -0.05, 0.03);
    this.arm.add(cuff);
    // Gloved fist around a vertical grip at the origin.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), this.materials.glove);
    palm.scale.set(0.9, 1.25, 1.05);
    palm.position.set(0.025, -0.01, 0.02);
    this.arm.add(palm);
    for (let f = 0; f < 4; f += 1) {
      const y = 0.035 - f * 0.024;
      const finger = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.012, 6, 10, Math.PI * 1.25), this.materials.glove);
      finger.position.set(-0.004, y, 0.002);
      finger.rotation.set(Math.PI / 2, 0, -0.9 + f * 0.05);
      this.arm.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.035, 4, 8), this.materials.glove);
    thumb.position.set(-0.02, 0.05, -0.015);
    thumb.rotation.set(0.5, 0, 0.9);
    this.arm.add(thumb);
  }

  // ---------------------------------------------------------------------------
  // Item visuals

  private handle(length: number, radius: number, material: THREE.Material, below = 0.12): THREE.Mesh {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius, length, 8), material);
    h.position.y = length / 2 - below;
    return h;
  }

  private lash(y: number, radius: number): THREE.Mesh {
    const l = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.25, radius * 0.45, 5, 10), this.materials.lashing);
    l.rotation.x = Math.PI / 2;
    l.position.y = y;
    return l;
  }

  private build(id: string): HeldVisual {
    const g = new THREE.Group();
    const m = this.materials;
    const visual: HeldVisual = { group: g };
    const def = itemDef(id);
    const kind = def.tool?.kind;
    if (kind === 'axe') {
      g.add(this.handle(0.62, 0.018, m.wood));
      const head = new THREE.Mesh(generateRock({ seed: 77, kind: 'shard', detail: 2 }).geometry, id.startsWith('iron') ? m.iron : m.flint);
      head.scale.set(0.09, 0.065, 0.028);
      head.rotation.z = Math.PI / 2;
      head.position.set(0.055, 0.42, 0);
      g.add(head, this.lash(0.4, 0.02), this.lash(0.45, 0.02));
    } else if (kind === 'pickaxe') {
      g.add(this.handle(0.62, 0.018, m.wood));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.36, 6), id.startsWith('iron') ? m.iron : m.stone);
      head.rotation.z = Math.PI / 2;
      head.position.set(0.03, 0.44, 0);
      const back = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 6), head.material);
      back.rotation.z = -Math.PI / 2;
      back.position.set(-0.08, 0.44, 0);
      g.add(head, back, this.lash(0.44, 0.02));
    } else if (kind === 'knife' || kind === 'sickle' || kind === 'sword') {
      const long = kind === 'sword' ? 0.55 : 0.16;
      g.add(this.handle(0.13, 0.016, m.leather, 0.06));
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, long, 0.03), kind === 'sword' ? m.iron : m.flint);
      blade.position.y = 0.07 + long / 2;
      if (kind === 'sickle') {
        blade.rotation.z = 0.7;
        blade.position.x = 0.05;
      }
      g.add(blade);
    } else if (kind === 'torch') {
      g.add(this.handle(0.5, 0.017, m.darkWood));
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.09, 8), m.cloth);
      wrap.position.y = 0.4;
      g.add(wrap);
      const flame = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.24),
        new THREE.ShaderMaterial({
          vertexShader: FLAME_VERT,
          fragmentShader: FLAME_FRAG,
          uniforms: this.flameUniforms,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      flame.position.y = 0.52;
      g.add(flame);
      visual.flame = flame;
      visual.light = { color: new THREE.Color(1, 0.62, 0.32), intensity: 16, flicker: 0.25 };
    } else if (kind === 'lantern') {
      g.add(this.handle(0.1, 0.008, m.brass, 0.02));
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8, 1, true), m.brass);
      cage.position.y = 0.16;
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), m.glass);
      core.position.y = 0.16;
      g.add(cage, core);
      visual.light = { color: new THREE.Color(0.4, 1, 0.9), intensity: 4.5, flicker: 0.05 };
    } else if (kind === 'spear') {
      const shaft = this.handle(1.5, 0.014, m.wood, 0.55);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.12, 5), id.startsWith('iron') ? m.iron : m.flint);
      tip.position.y = 1.01;
      g.add(shaft, tip, this.lash(0.94, 0.016));
      visual.twoHanded = true;
    } else if (kind === 'club' || kind === 'hammer') {
      const club = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.6, 7), kind === 'hammer' ? m.flint : m.darkWood);
      club.position.y = 0.2;
      g.add(club);
    } else if (kind === 'waterskin') {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), m.leather);
      bag.scale.set(1, 1.3, 0.7);
      bag.position.y = 0.06;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.05, 8), m.leather);
      neck.position.y = 0.16;
      g.add(bag, neck);
    } else if (kind === 'bow') {
      const limb = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 5, 24, Math.PI * 0.8), m.wood);
      limb.rotation.set(0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.1);
      limb.position.set(0, 0.0, 0.3);
      g.add(limb);
    } else if (def.category === 'food' || def.category === 'medicine') {
      let mesh: THREE.Mesh;
      if (id === 'berries' || id === 'berry_mash') mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 1), m.berry);
      else if (id.includes('mushroom')) mesh = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.mushroom);
      else if (id.includes('meat') || id.includes('fish')) mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), id.startsWith('raw') ? m.meat : m.cooked);
      else mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), m.leather);
      mesh.position.set(-0.01, 0.05, -0.01);
      mesh.scale.set(1, 0.8, 1.1);
      g.add(mesh);
    } else {
      // Raw materials: a small bundle in the palm.
      const bundle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), id.includes('wood') || id === 'stick' ? m.wood : m.stone);
      bundle.position.set(-0.01, 0.04, -0.01);
      g.add(bundle);
    }
    this.setLayer(g);
    return visual;
  }

  /** Show `id` in hand (null = empty hand, arm lowered). */
  private equip(id: string | null): void {
    if (id === this.currentId) return;
    if (this.current) this.holder.remove(this.current.group);
    this.currentId = id;
    this.current = null;
    if (id) {
      let visual = this.cache.get(id);
      if (!visual) {
        visual = this.build(id);
        this.cache.set(id, visual);
      }
      this.current = visual;
      this.holder.add(visual.group);
    }
    this.equipTimer = 1;
  }

  update(
    dt: number,
    state: { held: string | null; swing: number; speed: number; sprinting: boolean; lookX: number; lookY: number; grounded: boolean; reducedMotion: boolean; climbing: boolean; swimming: boolean },
  ): void {
    this.time += dt;
    this.flameUniforms.uTime.value = this.time;
    this.equip(state.climbing || state.swimming ? null : state.held);
    const motion = !state.reducedMotion;

    // Lag behind the look direction, bob with footfalls.
    this.swayX = damp(this.swayX + (motion ? -state.lookX * 0.6 : 0), 0, 9, dt);
    this.swayY = damp(this.swayY + (motion ? state.lookY * 0.6 : 0), 0, 9, dt);
    this.bob += dt * (state.sprinting ? 11 : 7.5) * Math.min(1, state.speed / 4);
    const bobAmt = motion && state.grounded ? Math.min(1, state.speed / 6) : 0;
    const hidden = !this.currentId;
    this.lower = damp(this.lower, hidden ? 1 : state.sprinting ? 0.35 : 0, 10, dt);
    this.equipTimer = Math.max(0, this.equipTimer - dt * 3.5);

    // Swing curve: wind-up, strike, recover.
    const p = state.swing > 0 ? 1 - state.swing : 0;
    let swingAngle = 0;
    let swingDrop = 0;
    if (p > 0) {
      if (p < 0.4) {
        const t = p / 0.4;
        swingAngle = -0.9 * t * t;
      } else if (p < 0.58) {
        const t = (p - 0.4) / 0.18;
        swingAngle = -0.9 + 2.3 * t;
        swingDrop = 0.08 * t;
      } else {
        const t = (p - 0.58) / 0.42;
        swingAngle = 1.4 * (1 - t) * (1 - t);
        swingDrop = 0.08 * (1 - t);
      }
    }
    const bobX = Math.cos(this.bob) * 0.012 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.016 * bobAmt;
    const breathe = motion ? Math.sin(this.time * 1.7) * 0.004 : 0;
    this.arm.position.set(
      0.23 + this.swayX * 0.05 + bobX,
      -0.19 - this.lower * 0.35 - this.equipTimer * 0.25 + this.swayY * 0.05 + bobY + breathe - swingDrop,
      -0.4,
    );
    // Tool held angled forward and inward, like a real grip at rest.
    this.arm.rotation.set(-0.55 + swingAngle, -0.28 + this.swayX * 0.2, 0.32 + (this.current?.twoHanded ? 0.35 : 0));

    // Carried light: torch flicker, lantern glow.
    const light = this.current?.light;
    if (light && !hidden) {
      const flick = 1 - light.flicker * (0.5 + 0.5 * Math.sin(this.time * 17.3) * Math.sin(this.time * 7.1 + 1.3));
      this.light.color.copy(light.color);
      this.light.intensity = light.intensity * flick * (1 - this.lower * 0.5);
      this.flameUniforms.uIntensity.value = flick;
    } else {
      this.light.intensity = 0;
    }
  }
}
