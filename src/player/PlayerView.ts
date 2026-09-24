import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { PlayerController } from './PlayerController';

// First-person camera: eye height, head bob tied to footfalls, a sprung dip
// on landing, sprint FOV, subtle strafe roll and trauma shake — every motion
// effect honours the head-bob, camera-shake and reduced-motion settings.

export interface ViewOptions {
  fov: number;
  headBob: boolean;
  shake: boolean;
  reducedMotion: boolean;
}

export class PlayerView {
  private bobPhase = 0;
  private bobAmount = 0;
  private land = 0;
  private landVel = 0;
  private trauma = 0;
  private roll = 0;
  private fovCurrent = 74;
  private shakeTime = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  /** Kick the landing spring (m/s of impact). */
  impact(speed: number): void {
    this.landVel -= Math.min(speed, 16) * 0.055;
  }

  /** Camera shake from 0 (none) to 1 (violent). */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, player: PlayerController, camera: THREE.PerspectiveCamera, options: ViewOptions): void {
    const motion = !options.reducedMotion;
    const speed = player.speed;
    const grounded = player.state === 'ground';

    // Head bob follows stride frequency.
    const bobTarget = motion && options.headBob && grounded ? clamp(speed / 7.6, 0, 1) : 0;
    this.bobAmount = damp(this.bobAmount, bobTarget, 8, dt);
    const stepRate = player.sprinting ? 1.25 : player.crouching ? 0.6 : 0.85;
    this.bobPhase += (speed / stepRate) * Math.PI * dt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.055 * this.bobAmount - 0.03 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.03 * this.bobAmount;

    // Landing spring.
    const k = 90;
    const c = 14;
    this.landVel += (-k * this.land - c * this.landVel) * dt;
    this.land += this.landVel * dt;
    const landOffset = motion ? clamp(this.land, -0.35, 0.1) : 0;

    // Swimming: gentle roll with the swell.
    const swimSway = player.state === 'swim' && motion ? Math.sin(performance.now() * 0.0011) * 0.02 : 0;

    const eye = player.eyeHeight;
    const p = player.position;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    camera.position.set(p.x + cos * bobX, p.y + eye + bobY + landOffset, p.z - sin * bobX);

    // Strafe roll & trauma shake.
    const lateral = player.velocity.x * cos - player.velocity.z * sin;
    this.roll = damp(this.roll, motion ? clamp(-lateral * 0.0045, -0.02, 0.02) : 0, 6, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.shakeTime += dt;
    const shake = motion && options.shake ? this.trauma * this.trauma : 0;
    const t = this.shakeTime * 23;
    const shakeYaw = shake * 0.03 * Math.sin(t * 1.3 + 1.7);
    const shakePitch = shake * 0.03 * Math.sin(t * 1.7 + 0.3);
    const shakeRoll = shake * 0.04 * Math.sin(t * 1.1 + 2.1);

    this.euler.set(player.pitch + shakePitch, player.yaw + shakeYaw, this.roll + shakeRoll + swimSway);
    camera.quaternion.setFromEuler(this.euler);

    // Sprint widens the view a touch.
    const fovTarget = options.fov + (player.sprinting && motion ? 6 : 0) + (player.state === 'swim' ? -2 : 0);
    this.fovCurrent = damp(this.fovCurrent, fovTarget, 6, dt);
    if (Math.abs(camera.fov - this.fovCurrent) > 0.01) {
      camera.fov = this.fovCurrent;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }
}
