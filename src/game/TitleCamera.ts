import * as THREE from 'three';
import { smoothstep } from '../core/math';
import type { WeatherKind } from '../world/Weather';
import type { WorldData } from '../world/WorldData';
import { viewpointByName, type Viewpoint } from './Viewpoints';

// Slow cinematic drift behind the title: a loop of long, gentle camera moves
// through the island's best views, each faded in and out through black.

interface Shot {
  view: string;
  seconds: number;
  /** Meters moved over the shot: along the view, sideways, and up. */
  dolly: number;
  truck: number;
  rise: number;
  hour: number;
  /** In-game hours the light advances over the shot. */
  drift: number;
  weather: WeatherKind;
  fov: number;
}

const SHOTS: Shot[] = [
  { view: 'meadow-golden', seconds: 19, dolly: 16, truck: -7, rise: 1.2, hour: 18.55, drift: 0.2, weather: 'clear', fov: 48 },
  { view: 'mirror-lake', seconds: 18, dolly: 5, truck: 16, rise: 0.6, hour: 16.9, drift: 0.2, weather: 'clear', fov: 50 },
  { view: 'hollowpine', seconds: 18, dolly: 11, truck: 3, rise: 1.6, hour: 9.6, drift: 0.15, weather: 'cloudy', fov: 52 },
  { view: 'coast-cliffs', seconds: 18, dolly: 7, truck: -15, rise: 2.5, hour: 17.4, drift: 0.2, weather: 'clear', fov: 48 },
  { view: 'beach', seconds: 17, dolly: 9, truck: 6, rise: 0.8, hour: 15.6, drift: 0.15, weather: 'clear', fov: 50 },
  { view: 'marsh', seconds: 17, dolly: 8, truck: -5, rise: 0.8, hour: 6.8, drift: 0.25, weather: 'fog', fov: 50 },
];

const FADE = 1.6;

export interface ShotStart {
  x: number;
  z: number;
  hour: number;
  weather: WeatherKind;
}

export class TitleCamera {
  private index = -1;
  private t = 0;
  private shot: Shot = SHOTS[0];
  private readonly start = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private smoothY = 0;
  /** 1 = black. */
  fade = 1;
  hour = 12;

  constructor(private readonly world: WorldData) {}

  /** Start over from the first shot; returns where it begins. */
  reset(): ShotStart {
    this.index = -1;
    return this.next();
  }

  private next(): ShotStart {
    this.index = (this.index + 1) % SHOTS.length;
    this.shot = SHOTS[this.index];
    this.t = 0;
    const vp = viewpointByName(this.shot.view) as Viewpoint;
    const ground = Math.max(this.world.heightAt(vp.x, vp.z), this.world.waterLevelAt(vp.x, vp.z));
    this.start.set(vp.x, ground + vp.height, vp.z);
    const [tx, tz, th] = vp.target;
    this.look.set(tx, this.world.heightAt(tx, tz) + th, tz);
    this.forward.copy(this.look).sub(this.start).setY(0).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.smoothY = this.start.y;
    this.hour = this.shot.hour;
    return { x: vp.x, z: vp.z, hour: this.shot.hour, weather: this.shot.weather };
  }

  /** Advance; returns the next shot's start when a cut happens. */
  update(dt: number, camera: THREE.PerspectiveCamera): ShotStart | null {
    let cut: ShotStart | null = null;
    this.t += dt;
    if (this.index < 0 || this.t >= this.shot.seconds) cut = this.next();
    const s = this.shot;
    const u = this.t / s.seconds;
    // Constant speed reads as a camera on a dolly; fades hide the stops.
    this.pos
      .copy(this.start)
      .addScaledVector(this.forward, s.dolly * u)
      .addScaledVector(this.right, s.truck * u);
    this.pos.y += s.rise * u;
    const floor = Math.max(this.world.heightAt(this.pos.x, this.pos.z), this.world.waterLevelAt(this.pos.x, this.pos.z)) + 1.2;
    const wanted = Math.max(this.pos.y, floor);
    this.smoothY += (wanted - this.smoothY) * Math.min(1, dt * 1.5);
    if (cut) this.smoothY = wanted;
    this.pos.y = Math.max(this.smoothY, floor - 0.4);
    // The look point slides a little less than the camera: gentle parallax.
    this.aim.copy(this.look).addScaledVector(this.right, s.truck * u * 0.55).addScaledVector(this.forward, s.dolly * u * 0.3);
    camera.position.copy(this.pos);
    camera.lookAt(this.aim);
    if (camera.fov !== s.fov) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    this.hour = s.hour + s.drift * u;
    this.fade = Math.max(1 - smoothstep(0.2, FADE, this.t), smoothstep(s.seconds - FADE, s.seconds - 0.1, this.t));
    return cut;
  }
}
