import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Input } from '../core/Input';
import type { WorldData } from '../world/WorldData';

/** Free camera for debugging, photo mode and automated vista captures. */
export class FlyCamera {
  yaw = 0;
  pitch = -0.1;
  speed = 18;
  private readonly move = { x: 0, y: 0 };
  private readonly look = { x: 0, y: 0 };
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly world: WorldData,
  ) {}

  setPose(position: THREE.Vector3, yaw: number, pitch: number): void {
    this.camera.position.copy(position);
    this.yaw = yaw;
    this.pitch = pitch;
    this.apply();
  }

  lookAt(target: THREE.Vector3): void {
    const d = target.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.apply();
  }

  update(dt: number): void {
    this.input.look(dt, this.look);
    this.yaw -= this.look.x;
    this.pitch = clamp(this.pitch - this.look.y, -1.5, 1.5);
    this.input.movement(this.move);
    const fast = this.input.isDown('sprint') ? 6 : 1;
    const v = this.speed * fast * dt;
    this.forward.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.addScaledVector(this.forward, this.move.y * v).addScaledVector(this.right, this.move.x * v);
    if (this.input.isDown('jump')) this.camera.position.y += v;
    if (this.input.isDown('crouch')) this.camera.position.y -= v;
    const ground = this.world.heightAt(this.camera.position.x, this.camera.position.z) + 0.6;
    if (this.camera.position.y < ground) this.camera.position.y = ground;
    this.apply();
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }
}
