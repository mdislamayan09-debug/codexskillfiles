import * as THREE from 'three';
import { createRng, hashString } from '../core/rng';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import type { WorldData } from './WorldData';

// Rare things in the sky. Some nights bring a meteor shower: streaks fan
// out from one point among the stars for a few hours. Once in a shower a
// star comes all the way down; it lands glowing somewhere nearby, a pillar
// of pale light marks it until dawn, and its metal can be gathered.

const STREAKS = 28;
const SKY_RADIUS = 1800;

const STREAK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A bright head fading into a long tail, soft across its width.
const STREAK_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float along = pow(1.0 - vUv.x, 2.2);
  float across = exp(-pow((vUv.y - 0.5) * 5.0, 2.0));
  float head = smoothstep(0.93, 1.0, 1.0 - vUv.x) * 2.5;
  gl_FragColor = vec4(uColor * (along + head) * across * uAlpha, 1.0);
}
`;

const PILLAR_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
void main() {
  float up = pow(1.0 - vUv.y, 1.6);
  float flicker = 0.85 + 0.15 * sin(uTime * 1.7 + vUv.y * 9.0);
  float edge = sin(vUv.x * 3.14159);
  gl_FragColor = vec4(vec3(0.62, 0.78, 1.0) * up * edge * flicker * uAlpha, 1.0);
}
`;

interface Streak {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  active: boolean;
  /** Unit direction of the head from the camera, and its tangent motion. */
  head: THREE.Vector3;
  motion: THREE.Vector3;
  speed: number;
  age: number;
  life: number;
  length: number;
}

export interface FallenStar {
  x: number;
  y: number;
  z: number;
  day: number;
  collected: boolean;
}

export interface SkyEventHooks {
  /** A star came down at (x, y, z): flash, rumble, a word to the player. */
  starfall(x: number, y: number, z: number): void;
}

/** Days with an eclipse: rare, never in the first few. */
export function eclipseOnDay(day: number): boolean {
  return day >= 3 && hashString(`eclipse:${day}`) % 100 < 7;
}

/** How much of the sun is covered (0..0.95) at `hours` on `day`. */
export function eclipseAt(day: number, hours: number, forced = false): number {
  if (!forced && !eclipseOnDay(day)) return 0;
  const s = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return 0.95 * s(13, 13.6, hours) * (1 - s(14.1, 14.7, hours));
}

/** Nights with a shower: about one in five, never the first. */
export function showerOnNight(day: number): boolean {
  return day >= 2 && hashString(`shower:${day}`) % 100 < 20;
}

export class SkyEvents {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  fallen: FallenStar | null = null;
  /** Forced by tests or story. */
  forceShower = false;
  forceEclipse = false;
  private readonly streaks: Streak[] = [];
  private spawnTimer = 0;
  private fallTimer = -1;
  private readonly rng = createRng(0x5ee7);
  private readonly star: THREE.Group;
  private readonly pillar: THREE.Mesh;
  private readonly pillarMaterial: THREE.ShaderMaterial;
  private readonly glow: THREE.MeshStandardMaterial;
  private time = 0;
  private lastNight = -1;
  private readonly tmp = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(
    private readonly world: WorldData,
    private readonly hooks: SkyEventHooks,
  ) {
    this.group.name = 'sky-events';
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0);
    for (let i = 0; i < STREAKS; i += 1) {
      const material = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0.85, 0.9, 1) } },
        vertexShader: STREAK_VERT,
        fragmentShader: STREAK_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.layers.set(LAYER_TRANSPARENT);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -5;
      this.group.add(mesh);
      this.streaks.push({ mesh, material, active: false, head: new THREE.Vector3(), motion: new THREE.Vector3(), speed: 0, age: 0, life: 1, length: 0 });
    }
    // The fallen star: a cluster of pale crystal in a scorched ring, and a
    // pillar of light over it that can be seen from far off.
    this.star = new THREE.Group();
    this.glow = new THREE.MeshStandardMaterial({ color: 0xcfe0ff, emissive: 0x9fc4ff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.3 });
    const scorch = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 });
    this.materials.push(this.glow, scorch);
    const rng = createRng(0x57a2);
    for (let i = 0; i < 9; i += 1) {
      const h = 0.4 + rng() * 1.3;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.25 + rng() * 0.25, 0), this.glow);
      shard.scale.set(1, h * 2.2, 1);
      shard.position.set((rng() - 0.5) * 1.4, h * 0.4, (rng() - 0.5) * 1.4);
      shard.rotation.set((rng() - 0.5) * 0.8, rng() * 3, (rng() - 0.5) * 0.8);
      this.star.add(shard);
    }
    const ring = new THREE.Mesh(new THREE.CircleGeometry(3.4, 24), scorch);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.receiveShadow = true;
    this.star.add(ring);
    this.pillarMaterial = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: STREAK_VERT,
      fragmentShader: PILLAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 140, 16, 1, true).translate(0, 70, 0), this.pillarMaterial);
    this.pillar.layers.set(LAYER_TRANSPARENT);
    this.pillar.frustumCulled = false;
    this.star.add(this.pillar);
    this.star.visible = false;
    this.group.add(this.star);
  }

  /** True while a shower is falling (night, and a shower night or forced). */
  showering(day: number, hours: number): boolean {
    const night = hours > 21 || hours < 4.2;
    // The shower belongs to the evening it started on.
    const eve = hours < 12 ? day - 1 : day;
    return night && (this.forceShower || showerOnNight(eve));
  }

  update(dt: number, day: number, hours: number, camera: THREE.Vector3, playerX: number, playerZ: number): void {
    this.time += dt;
    const shower = this.showering(day, hours);
    if (shower) {
      // Busiest in the small hours (around one o'clock).
      const sinceDusk = (hours - 21 + 24) % 24;
      const peak = Math.max(0, 1 - Math.abs(sinceDusk - 4) / 4);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = (0.35 + this.rng() * 2.2) / (0.5 + peak);
        this.spawn(day);
      }
      // One star comes down each shower night, around midnight.
      const eve = hours < 12 ? day - 1 : day;
      if (this.lastNight !== eve) {
        this.lastNight = eve;
        this.fallTimer = 30 + this.rng() * 90;
      }
      if (this.fallTimer > 0) {
        this.fallTimer -= dt;
        if (this.fallTimer <= 0 && (!this.fallen || this.fallen.collected)) this.dropStar(day, playerX, playerZ);
      }
    }
    for (const s of this.streaks) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.head.addScaledVector(s.motion, s.speed * dt).normalize();
      const t = s.age / s.life;
      s.material.uniforms.uAlpha.value = Math.sin(t * Math.PI) * 0.9;
      this.place(s, camera, s.length * (0.4 + 0.6 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5)));
    }
    // The pillar over the fallen star fades with daylight and once gathered.
    if (this.fallen) {
      const daylight = hours > 6 && hours < 19 ? 0.15 : 1;
      this.star.visible = !this.fallen.collected;
      this.pillarMaterial.uniforms.uAlpha.value = this.fallen.collected ? 0 : 0.5 * daylight;
      this.pillarMaterial.uniforms.uTime.value = this.time;
      this.glow.emissiveIntensity = 1.6 + 0.6 * Math.sin(this.time * 2.1);
    }
  }

  private spawn(day: number): void {
    const s = this.streaks.find((x) => !x.active);
    if (!s) return;
    // All streaks fan out from one radiant, fixed per night.
    const r = createRng(hashString(`radiant:${day}`));
    const ra = r() * Math.PI * 2;
    const radiant = new THREE.Vector3(Math.cos(ra) * 0.55, 0.8, Math.sin(ra) * 0.55).normalize();
    // Start a little away from the radiant, moving away from it.
    const off = new THREE.Vector3(this.rng() - 0.5, this.rng() * 0.4 - 0.2, this.rng() - 0.5).normalize();
    s.head.copy(radiant).addScaledVector(off, 0.2 + this.rng() * 0.6).normalize();
    if (s.head.y < 0.12) s.head.y = 0.12 + this.rng() * 0.3;
    s.head.normalize();
    s.motion.copy(s.head).sub(radiant);
    s.motion.addScaledVector(s.head, -s.motion.dot(s.head)).normalize();
    s.speed = 0.25 + this.rng() * 0.35;
    s.age = 0;
    s.life = 0.5 + this.rng() * 0.9;
    s.length = 40 + this.rng() * 90;
    s.active = true;
    s.mesh.visible = true;
    const warm = this.rng() < 0.2;
    s.material.uniforms.uColor.value.setRGB(warm ? 1 : 0.8, warm ? 0.82 : 0.9, warm ? 0.6 : 1);
  }

  /** Orient a streak: along its motion on the sky sphere, facing the camera. */
  private place(s: Streak, camera: THREE.Vector3, length: number): void {
    const pos = this.tmp.copy(s.head).multiplyScalar(SKY_RADIUS).add(camera);
    // The tail trails behind the head.
    const x = s.motion.clone().negate();
    const z = s.head.clone().negate();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    x.crossVectors(y, z).normalize();
    this.basis.makeBasis(x.multiplyScalar(length), y.multiplyScalar(2.2), z);
    this.basis.setPosition(pos);
    s.mesh.matrix.copy(this.basis);
    s.mesh.matrixWorldNeedsUpdate = true;
  }

  /** A star comes down on dry land a few hundred metres from the player. */
  dropStar(day: number, px: number, pz: number): FallenStar | null {
    const rng = createRng(hashString(`fall:${day}`));
    for (let k = 0; k < 24; k += 1) {
      const a = rng() * Math.PI * 2;
      const d = 140 + rng() * 220;
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (Math.hypot(x, z) > 1250) continue;
      if (this.world.waterDepthAt(x, z) > -0.3 || this.world.slopeAt(x, z) > 0.5) continue;
      const y = this.world.groundAt(x, z);
      this.fallen = { x, y, z, day, collected: false };
      this.star.position.set(x, y, z);
      this.star.visible = true;
      // One last, long streak down to the horizon.
      const s = this.streaks.find((q) => !q.active);
      if (s) {
        s.head.set(x - px, 260, z - pz).normalize();
        // Straight down the sky toward the horizon.
        s.motion.set(0, -1, 0).addScaledVector(s.head, s.head.y).normalize();
        s.speed = 0.5;
        s.age = 0;
        s.life = 1.8;
        s.length = 220;
        s.active = true;
        s.mesh.visible = true;
        s.material.uniforms.uColor.value.setRGB(1, 0.95, 0.85);
      }
      this.hooks.starfall(x, y, z);
      return this.fallen;
    }
    return null;
  }

  /** The fallen star is within reach of (x, z). */
  near(x: number, z: number, reach = 3.2): boolean {
    return this.fallen !== null && !this.fallen.collected && Math.hypot(this.fallen.x - x, this.fallen.z - z) < reach;
  }

  collect(): boolean {
    if (!this.fallen || this.fallen.collected) return false;
    this.fallen.collected = true;
    this.star.visible = false;
    return true;
  }

  serialize(): { fallen: FallenStar | null } {
    return { fallen: this.fallen };
  }

  load(data: unknown): void {
    const d = data as { fallen?: FallenStar | null } | null;
    this.fallen = d?.fallen ?? null;
    if (this.fallen) {
      this.star.position.set(this.fallen.x, this.fallen.y, this.fallen.z);
      this.star.visible = !this.fallen.collected;
    } else this.star.visible = false;
  }

  /** Test hook: streaks currently in the sky. */
  get activeStreaks(): number {
    return this.streaks.filter((s) => s.active).length;
  }
}
