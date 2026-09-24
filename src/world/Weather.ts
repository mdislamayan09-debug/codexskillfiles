import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import { createRng } from '../core/rng';
import { LAYER_TRANSPARENT } from '../render/RenderPipeline';
import { BIOME, BIOME_COUNT, BIOMES } from './WorldConfig';

// Weather fronts roll through on in-game timers, chosen by the weights of
// the biome you are in (fog in the Drownfen, snow on the peaks, ash near the
// caldera). Everything that weather touches reads the same blended state:
// clouds, fog, haze, wind, wet ground, rain/snow/ash particles, lightning,
// sound, body temperature and wetness.

export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'snow' | 'ash';

export interface WeatherState {
  coverage: number;
  cloudType: number;
  fog: number;
  haze: number;
  wind: number;
  rain: number;
  snow: number;
  ash: number;
  lightning: number;
  /** Air temperature offset (°C). */
  chill: number;
}

const PRESETS: Record<WeatherKind, WeatherState> = {
  clear: { coverage: 0.32, cloudType: 0.35, fog: 0, haze: 1.8, wind: 0.3, rain: 0, snow: 0, ash: 0, lightning: 0, chill: 0 },
  cloudy: { coverage: 0.66, cloudType: 0.55, fog: 0.0006, haze: 2.4, wind: 0.5, rain: 0, snow: 0, ash: 0, lightning: 0, chill: -1.5 },
  fog: { coverage: 0.58, cloudType: 0.3, fog: 0.014, haze: 4.5, wind: 0.12, rain: 0, snow: 0, ash: 0, lightning: 0, chill: -2 },
  rain: { coverage: 0.86, cloudType: 0.75, fog: 0.0025, haze: 3, wind: 0.6, rain: 0.75, snow: 0, ash: 0, lightning: 0, chill: -3.5 },
  storm: { coverage: 0.97, cloudType: 0.95, fog: 0.003, haze: 3.4, wind: 1, rain: 1, snow: 0, ash: 0, lightning: 1, chill: -5 },
  snow: { coverage: 0.84, cloudType: 0.6, fog: 0.004, haze: 3.2, wind: 0.5, rain: 0, snow: 0.9, ash: 0, lightning: 0, chill: -6 },
  ash: { coverage: 0.62, cloudType: 0.5, fog: 0.007, haze: 3.8, wind: 0.4, rain: 0, snow: 0, ash: 0.85, lightning: 0, chill: 2 },
};

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Overcast',
  fog: 'Fog',
  rain: 'Rain',
  storm: 'Storm',
  snow: 'Snow',
  ash: 'Ashfall',
};

function blend(a: WeatherState, b: WeatherState, t: number, out: WeatherState): WeatherState {
  for (const key of Object.keys(out) as (keyof WeatherState)[]) out[key] = lerp(a[key], b[key], t);
  return out;
}

export class WeatherSystem {
  current: WeatherKind = 'clear';
  next: WeatherKind = 'clear';
  /** In-game hours left in the current front. */
  remaining = 5;
  /** 0..1 progress of the transition toward `next`. */
  transition = 1;
  readonly state: WeatherState = { ...PRESETS.clear };
  /** Wetness of the ground (0 dry .. 1 soaked); lags the rain. */
  groundWetness = 0;
  readonly windDir = new THREE.Vector2(0.86, 0.5);
  private readonly local: WeatherState = { ...PRESETS.clear };
  private rng = createRng(0xa11e7);
  private lightningTimer = 8;
  /** Set when lightning strikes this frame: seconds until thunder arrives. */
  thunderIn = -1;
  flash = 0;
  forced: WeatherKind | null = null;

  /** Advance the weather clock. `weights` = biome weights at the player. */
  update(dt: number, hoursElapsed: number, weights: Float32Array): WeatherState {
    this.remaining -= hoursElapsed;
    if (this.transition < 1) this.transition = Math.min(1, this.transition + hoursElapsed / 0.6);
    if (this.remaining <= 0 && this.transition >= 1) {
      this.current = this.next;
      this.next = this.forced ?? this.pick(weights);
      this.transition = 0;
      this.remaining = 1.5 + this.rng() * 4;
    }
    const from = PRESETS[this.current];
    const to = PRESETS[this.next];
    blend(from, to, smoothstep(0, 1, this.transition), this.local);

    // Regional character: rain turns to snow on the peaks, ash only near the caldera.
    const frost = weights[BIOME.Frostveil];
    const cinder = weights[BIOME.Cinderreach];
    const s = this.state;
    Object.assign(s, this.local);
    const precip = s.rain;
    s.snow = Math.max(s.snow, precip * smoothstep(0.35, 0.7, frost));
    s.rain = precip * (1 - smoothstep(0.35, 0.7, frost));
    s.ash = s.ash * smoothstep(0.2, 0.5, cinder);
    if (s.snow > 0 && frost < 0.2) {
      // Snow fronts become cold rain in the lowlands.
      s.rain = Math.max(s.rain, s.snow * 0.8);
      s.snow *= smoothstep(0.05, 0.2, frost);
    }
    s.chill += -4 * frost * (s.snow > 0 ? 1 : 0);

    // Ground wetness follows rain slowly and dries slower still.
    const target = s.rain > 0.05 ? 1 : 0;
    const rate = target > this.groundWetness ? 0.5 + s.rain : 0.35;
    this.groundWetness = clamp(this.groundWetness + (target - this.groundWetness) * Math.min(1, hoursElapsed * rate * 2), 0, 1);

    // Lightning.
    this.flash = Math.max(0, this.flash - dt * 4);
    this.thunderIn = -1;
    if (s.lightning > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 6 + this.rng() * 16;
        this.flash = 0.6 + this.rng() * 0.6;
        this.thunderIn = 0.8 + this.rng() * 7;
      }
    }
    // Wind veers slowly.
    const a = Math.atan2(this.windDir.y, this.windDir.x) + (this.rng() - 0.5) * dt * 0.02;
    this.windDir.set(Math.cos(a), Math.sin(a));
    return s;
  }

  private pick(weights: Float32Array): WeatherKind {
    const totals: Record<string, number> = { clear: 0, cloudy: 0, fog: 0, rain: 0, storm: 0, snow: 0, ash: 0 };
    for (let b = 0; b < BIOME_COUNT; b += 1) {
      const w = weights[b];
      if (w < 0.01) continue;
      for (const [k, v] of Object.entries(BIOMES[b].weather)) totals[k] += v * w;
    }
    // Fronts tend to persist a little.
    totals[this.current] = (totals[this.current] ?? 0) * 1.3;
    let sum = 0;
    for (const v of Object.values(totals)) sum += v;
    let roll = this.rng() * sum;
    for (const [k, v] of Object.entries(totals)) {
      roll -= v;
      if (roll <= 0) return k as WeatherKind;
    }
    return 'clear';
  }

  /** Force a weather front (debug / story beats). */
  set(kind: WeatherKind, instant = false): void {
    this.next = kind;
    this.transition = instant ? 1 : 0;
    if (instant) this.current = kind;
    this.remaining = 3;
  }

  serialize(): unknown {
    return { current: this.current, next: this.next, remaining: this.remaining, transition: this.transition, wet: this.groundWetness };
  }

  load(data: unknown): void {
    const d = data as { current: WeatherKind; next: WeatherKind; remaining: number; transition: number; wet: number };
    if (!d || !(d.current in PRESETS)) return;
    this.current = d.current;
    this.next = d.next in PRESETS ? d.next : d.current;
    this.remaining = d.remaining ?? 3;
    this.transition = d.transition ?? 1;
    this.groundWetness = d.wet ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Precipitation: one instanced draw of streaks/flakes wrapped in a box that
// follows the camera; positions are computed entirely on the GPU.

const PRECIP_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCamera;
uniform float uTime;
uniform float uBox;
uniform vec3 uVelocity;
uniform float uLength;
uniform float uWidth;
uniform float uDensity;
uniform float uFlutter;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vec3 start = aSeed.xyz * uBox;
  vec3 p = start + uVelocity * (uTime * (0.8 + 0.4 * aSeed.w));
  // Flakes flutter; rain does not.
  p.x += sin(uTime * (1.0 + aSeed.w * 2.0) + aSeed.y * 40.0) * uFlutter;
  p.z += cos(uTime * (0.8 + aSeed.x * 2.0) + aSeed.z * 40.0) * uFlutter;
  vec3 local = mod(p - uCamera + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCamera + local;
  vec3 dir = normalize(uVelocity);
  vec3 toCam = normalize(cameraPosition - world);
  vec3 side = normalize(cross(dir, toCam)) * uWidth;
  vec3 along = -dir * uLength;
  world += side * position.x + along * position.y;
  vAlpha = step(aSeed.w, uDensity) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(local)));
  vUv = position.xy + vec2(0.5, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const PRECIP_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSoft;
varying float vAlpha;
varying vec2 vUv;
void main() {
  if (vAlpha <= 0.0) discard;
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float tip = uSoft > 0.5 ? (1.0 - length(vUv * 2.0 - 1.0)) : smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  float a = clamp(edge * tip, 0.0, 1.0) * vAlpha * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

export class Precipitation {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uCamera: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uBox: { value: 28 },
    uVelocity: { value: new THREE.Vector3(0, -9, 0) },
    uLength: { value: 0.5 },
    uWidth: { value: 0.012 },
    uDensity: { value: 0 },
    uFlutter: { value: 0 },
    uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uOpacity: { value: 0.3 },
    uSoft: { value: 0 },
  };

  constructor(count: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const seeds = new Float32Array(count * 4);
    const rng = createRng(0x5a1);
    for (let i = 0; i < count * 4; i += 1) seeds[i] = rng();
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    const material = new THREE.ShaderMaterial({
      vertexShader: PRECIP_VERT,
      fragmentShader: PRECIP_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_TRANSPARENT);
    this.mesh.renderOrder = 20;
  }

  update(time: number, camera: THREE.Vector3, w: WeatherState, windX: number, windZ: number, ambient: THREE.Color): void {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCamera.value.copy(camera);
    const rain = w.rain;
    const snow = w.snow;
    const ash = w.ash;
    const amount = Math.max(rain, snow, ash);
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    const wind = 2 + w.wind * 6;
    if (rain >= snow && rain >= ash) {
      u.uVelocity.value.set(windX * wind, -11, windZ * wind);
      u.uLength.value = 0.55;
      u.uWidth.value = 0.012;
      u.uFlutter.value = 0;
      u.uBox.value = 26;
      u.uSoft.value = 0;
      u.uColor.value.copy(ambient).multiplyScalar(1.6).addScalar(0.04);
      u.uOpacity.value = 0.22;
      u.uDensity.value = rain;
    } else {
      const isAsh = ash > snow;
      u.uVelocity.value.set(windX * wind * 0.5, isAsh ? -0.7 : -1.3, windZ * wind * 0.5);
      u.uLength.value = isAsh ? 0.05 : 0.045;
      u.uWidth.value = isAsh ? 0.05 : 0.045;
      u.uFlutter.value = isAsh ? 0.6 : 0.35;
      u.uBox.value = 22;
      u.uSoft.value = 1;
      u.uColor.value.copy(ambient).multiplyScalar(isAsh ? 0.6 : 2.2).addScalar(isAsh ? 0.01 : 0.05);
      u.uOpacity.value = isAsh ? 0.7 : 0.85;
      u.uDensity.value = isAsh ? ash : snow;
    }
  }
}
