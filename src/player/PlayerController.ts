import * as THREE from 'three';
import { clamp, damp } from '../core/math';

// Kinematic first-person body over the heightfield: walk / sprint / crouch,
// buffered + coyote jumps, climbing any steep terrain, swimming with
// buoyancy and river drift, fall damage, and circle colliders (tree trunks,
// rocks, props). Tuning follows docs/GAME_DESIGN.md §5.1.

export type MoveState = 'ground' | 'air' | 'climb' | 'swim';

export const PLAYER_TUNING = {
  radius: 0.32,
  eyeStand: 1.64,
  eyeCrouch: 1.08,
  walkSpeed: 4.6,
  sprintSpeed: 7.6,
  crouchSpeed: 2.2,
  accel: 22,
  decel: 26,
  airControl: 0.35,
  jumpSpeed: 5.4,
  gravity: 17,
  terminalSpeed: 55,
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  /** Ground steeper than this (normal.y) is unwalkable: ~42°. */
  walkableNy: 0.74,
  /** Terrain steeper than this can be climbed: ~50°. */
  climbNy: 0.66,
  climbSpeed: 1.9,
  climbDrain: 9,
  climbHangDrain: 2.5,
  climbHopCost: 18,
  swimSpeed: 2.6,
  swimSprintSpeed: 4,
  swimSprintDrain: 11,
  /** Feet depth below the surface while floating. */
  swimFloat: 1.2,
  swimEnterDepth: 1.3,
  swimExitDepth: 1.05,
  sprintDrain: 12,
  jumpCost: 5,
  safeFall: 9,
  lethalFall: 24,
  stepHeight: 0.45,
  groundSnap: 0.55,
} as const;

export interface WaterAt {
  surface: number;
  depth: number;
  frozen: boolean;
  flowX: number;
  flowZ: number;
}

export interface CircleCollider {
  x: number;
  z: number;
  radius: number;
  height: number;
  /** Bottom of the collider; defaults to the ground under it. */
  baseY?: number;
}

export interface PlayerEnvironment {
  /**
   * Ground under (x, z). With `y` (the feet), built floors no higher than a
   * step above it count too, so storeys stack; without it, terrain only.
   */
  groundHeight(x: number, z: number, y?: number): number;
  groundNormal(x: number, z: number, out: THREE.Vector3, y?: number): THREE.Vector3;
  water(x: number, z: number): WaterAt;
  colliders(x: number, z: number, radius: number, out: CircleCollider[]): CircleCollider[];
  surface(x: number, z: number): string;
  /** Soft world boundary radius. */
  boundary: number;
}

export interface StaminaBudget {
  readonly stamina: number;
  /** True while exhausted (sprint locked until partly recovered). */
  readonly exhausted: boolean;
  /** Spend a lump sum; returns false if not enough. */
  spend(amount: number): boolean;
  /** Continuous drain (per second × dt); returns false once empty. */
  drain(amount: number): boolean;
  /** Mark activity so regeneration pauses briefly. */
  hold(): void;
}

export interface ControlIntent {
  moveX: number;
  moveY: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  sprint: boolean;
  crouch: boolean;
}

export interface PlayerCallbacks {
  onLand?(speed: number, height: number, damage: number, intoWater: boolean): void;
  onJump?(): void;
  onFootstep?(surface: string, speed: number, left: boolean): void;
  onEnterWater?(speed: number): void;
  onExitWater?(): void;
  onClimb?(climbing: boolean): void;
  onDrowning?(dt: number): void;
}

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  state: MoveState = 'ground';
  crouching = false;
  sprinting = false;
  /** 0 standing .. 1 crouched (smoothed for the camera). */
  crouchBlend = 0;
  /** Horizontal speed actually achieved this frame. */
  speed = 0;
  /** Seconds since the last state change (for camera effects). */
  stateTime = 0;
  noclip = false;
  readonly climbNormal = new THREE.Vector3();
  callbacks: PlayerCallbacks = {};

  private coyote = 0;
  private jumpBuffer = 0;
  private peakY = 0;
  private stride = 0;
  private leftFoot = false;
  private readonly normal = new THREE.Vector3();
  private readonly aheadNormal = new THREE.Vector3();
  private readonly colliderScratch: CircleCollider[] = [];

  constructor(
    private readonly env: PlayerEnvironment,
    private readonly stamina: StaminaBudget,
  ) {}

  /** Teleport, standing on the ground (or floating on water). */
  spawn(x: number, z: number, yaw = this.yaw, yHint?: number): void {
    const ground = this.env.groundHeight(x, z, yHint);
    this.position.set(x, ground, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.setState('ground');
    const w = this.env.water(x, z);
    if (Number.isFinite(w.surface) && !w.frozen && w.surface - ground > PLAYER_TUNING.swimEnterDepth) {
      this.position.y = w.surface - PLAYER_TUNING.swimFloat;
      this.setState('swim');
    }
    this.peakY = this.position.y;
  }

  /** External shove (a Warden's charge, a shockwave): adds velocity and lifts off. */
  knock(x: number, y: number, z: number): void {
    if (this.state === 'swim') {
      this.velocity.x += x * 0.4;
      this.velocity.z += z * 0.4;
      return;
    }
    this.velocity.x += x;
    this.velocity.z += z;
    if (y > 0) {
      this.velocity.y = Math.max(this.velocity.y, y);
      this.position.y += 0.05;
      this.setState('air');
    }
  }

  get eyeHeight(): number {
    if (this.state === 'swim') return PLAYER_TUNING.eyeStand;
    return THREE.MathUtils.lerp(PLAYER_TUNING.eyeStand, PLAYER_TUNING.eyeCrouch, this.crouchBlend);
  }

  get grounded(): boolean {
    return this.state === 'ground';
  }

  private setState(state: MoveState): void {
    if (state === this.state) return;
    const previous = this.state;
    this.state = state;
    this.stateTime = 0;
    if (previous === 'climb') this.callbacks.onClimb?.(false);
    if (state === 'climb') this.callbacks.onClimb?.(true);
    if (previous === 'swim') this.callbacks.onExitWater?.();
    if (state === 'air') this.peakY = this.position.y;
  }

  update(dt: number, intent: ControlIntent): void {
    dt = Math.min(dt, 1 / 20);
    this.stateTime += dt;
    const T = PLAYER_TUNING;
    const p = this.position;
    const v = this.velocity;

    if (this.noclip) {
      this.updateNoclip(dt, intent);
      return;
    }

    // Wish direction from the view yaw.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wishX = -sin * intent.moveY + cos * intent.moveX;
    let wishZ = -cos * intent.moveY - sin * intent.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    if (intent.jumpPressed) this.jumpBuffer = T.jumpBuffer;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    this.crouching = intent.crouch && this.state === 'ground';
    this.crouchBlend = damp(this.crouchBlend, this.crouching ? 1 : 0, 12, dt);

    // Water: enter swimming when deep enough at the feet.
    const water = this.env.water(p.x, p.z);
    const hasWater = Number.isFinite(water.surface) && !water.frozen;
    if (this.state !== 'swim' && hasWater && water.surface - p.y > T.swimEnterDepth) {
      const impact = -v.y;
      this.callbacks.onEnterWater?.(Math.max(0, impact));
      if (this.state === 'air') this.landing(true);
      this.setState('swim');
    }

    switch (this.state) {
      case 'ground':
        this.updateGround(dt, intent, wishX, wishZ);
        break;
      case 'air':
        this.updateAir(dt, wishX, wishZ);
        break;
      case 'climb':
        this.updateClimb(dt, intent);
        break;
      case 'swim':
        this.updateSwim(dt, intent, wishX, wishZ, water);
        break;
    }

    this.resolveColliders();
    this.applyBoundary();
    this.speed = Math.hypot(v.x, v.z);
  }

  private updateNoclip(dt: number, intent: ControlIntent): void {
    const speed = intent.sprint ? 40 : 12;
    const fx = -Math.sin(this.yaw) * Math.cos(this.pitch);
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.position.x += (fx * intent.moveY + rx * intent.moveX) * speed * dt;
    this.position.y += fy * intent.moveY * speed * dt + ((intent.jumpHeld ? 1 : 0) - (intent.crouch ? 1 : 0)) * speed * dt;
    this.position.z += (fz * intent.moveY + rz * intent.moveX) * speed * dt;
    this.velocity.set(0, 0, 0);
  }

  private updateGround(dt: number, intent: ControlIntent, wishX: number, wishZ: number): void {
    const T = PLAYER_TUNING;
    const p = this.position;
    const v = this.velocity;
    const n = this.env.groundNormal(p.x, p.z, this.normal, p.y);
    const moving = Math.hypot(wishX, wishZ) > 0.1;

    // Sprint needs forward intent and stamina.
    this.sprinting = intent.sprint && moving && intent.moveY > 0.3 && !this.crouching && !this.stamina.exhausted && this.stamina.stamina > 0;
    if (this.sprinting && !this.stamina.drain(T.sprintDrain * dt)) this.sprinting = false;
    let target: number = this.crouching ? T.crouchSpeed : this.sprinting ? T.sprintSpeed : T.walkSpeed;

    // Uphill is slower, gentle downhill slightly faster.
    const uphill = -(n.x * wishX + n.z * wishZ);
    target *= clamp(1 - uphill * 0.9, 0.55, 1.12);

    // Try to climb when walking into a wall of rock or a steep slope.
    if (moving && intent.moveY > 0.5 && this.tryStartClimb(wishX, wishZ)) return;

    // Accelerate toward the wish velocity.
    const tx = wishX * target;
    const tz = wishZ * target;
    const rate = moving ? T.accel : T.decel;
    const dvx = tx - v.x;
    const dvz = tz - v.z;
    const dl = Math.hypot(dvx, dvz);
    const step = Math.min(dl, rate * dt);
    if (dl > 1e-5) {
      v.x += (dvx / dl) * step;
      v.z += (dvz / dl) * step;
    }

    // Unwalkable slopes: slide downhill and refuse to climb them by walking.
    if (n.y < T.walkableNy) {
      const slide = (T.walkableNy - n.y) * 30;
      v.x += n.x * slide * dt;
      v.z += n.z * slide * dt;
      const into = -(v.x * n.x + v.z * n.z);
      if (into > 0) {
        const hl = Math.hypot(n.x, n.z) || 1;
        v.x += (n.x / hl) * into;
        v.z += (n.z / hl) * into;
      }
    }

    const nx = p.x + v.x * dt;
    const nz = p.z + v.z * dt;
    const nextGround = this.env.groundHeight(nx, nz, p.y);
    // A sudden wall higher than a step blocks horizontal motion.
    if (nextGround - p.y > T.stepHeight + Math.hypot(v.x, v.z) * dt * 1.2) {
      v.x *= 0.2;
      v.z *= 0.2;
    } else {
      p.x = nx;
      p.z = nz;
    }

    const ground = this.env.groundHeight(p.x, p.z, p.y);
    if (p.y - ground > T.groundSnap) {
      // Walked off a ledge.
      v.y = 0;
      this.coyote = T.coyoteTime;
      this.setState('air');
    } else {
      p.y = ground;
      v.y = 0;
      this.coyote = T.coyoteTime;
    }

    // Footsteps.
    const horizontal = Math.hypot(v.x, v.z);
    this.stride += horizontal * dt;
    const strideLength = this.sprinting ? 1.25 : this.crouching ? 0.6 : 0.85;
    if (this.stride > strideLength && horizontal > 0.4) {
      this.stride = 0;
      this.leftFoot = !this.leftFoot;
      this.callbacks.onFootstep?.(this.env.surface(p.x, p.z), horizontal, this.leftFoot);
    }

    if (this.jumpBuffer > 0 && this.state === 'ground') this.jump();
  }

  private jump(): void {
    const T = PLAYER_TUNING;
    this.stamina.spend(T.jumpCost);
    this.stamina.hold();
    this.velocity.y = T.jumpSpeed;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.setState('air');
    this.callbacks.onJump?.();
  }

  private updateAir(dt: number, wishX: number, wishZ: number): void {
    const T = PLAYER_TUNING;
    const p = this.position;
    const v = this.velocity;
    if (this.coyote > 0) {
      this.coyote -= dt;
      if (this.jumpBuffer > 0 && v.y <= 0.5) {
        this.jump();
        return;
      }
    }
    // Air control toward the wish direction (never faster than a sprint).
    const target = Math.max(T.walkSpeed, Math.hypot(v.x, v.z));
    const ax = wishX * target - v.x;
    const az = wishZ * target - v.z;
    const al = Math.hypot(ax, az);
    const step = Math.min(al, T.accel * T.airControl * dt);
    if (al > 1e-5 && Math.hypot(wishX, wishZ) > 0.1) {
      v.x += (ax / al) * step;
      v.z += (az / al) * step;
    }
    v.y = Math.max(v.y - T.gravity * dt, -T.terminalSpeed);
    // Floors are found from where the feet were, so a fast fall can't skip one.
    const fromY = p.y;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    this.peakY = Math.max(this.peakY, p.y);

    // Grab a wall mid-air when falling past it.
    if (v.y < 2 && Math.hypot(wishX, wishZ) > 0.3 && this.tryStartClimb(wishX, wishZ)) return;

    const ground = this.env.groundHeight(p.x, p.z, Math.max(fromY, p.y));
    if (p.y <= ground) {
      p.y = ground;
      this.landing(false);
      this.setState('ground');
      // Keep sliding momentum on slopes but kill the vertical part.
      v.y = 0;
    }
  }

  private landing(intoWater: boolean): void {
    const T = PLAYER_TUNING;
    const height = Math.max(0, this.peakY - this.position.y);
    const speed = Math.max(0, -this.velocity.y);
    let damage = 0;
    if (!intoWater && height > T.safeFall) {
      damage = 100 * Math.pow(clamp((height - T.safeFall) / (T.lethalFall - T.safeFall), 0, 1), 1.4);
    }
    if (intoWater) {
      const w = this.env.water(this.position.x, this.position.z);
      const deep = w.surface - this.env.groundHeight(this.position.x, this.position.z);
      if (deep < 2 && height > T.safeFall) damage = 60 * clamp((height - T.safeFall) / (T.lethalFall - T.safeFall), 0, 1);
    }
    this.callbacks.onLand?.(speed, height, damage, intoWater);
    this.peakY = this.position.y;
  }

  /** Starts climbing if a steep face rises right in front. */
  private tryStartClimb(wishX: number, wishZ: number): boolean {
    const T = PLAYER_TUNING;
    if (this.stamina.stamina < 4 || this.stamina.exhausted) return false;
    const p = this.position;
    const len = Math.hypot(wishX, wishZ) || 1;
    const ax = p.x + (wishX / len) * (T.radius + 0.35);
    const az = p.z + (wishZ / len) * (T.radius + 0.35);
    const ahead = this.env.groundHeight(ax, az);
    if (ahead - p.y < 0.8) return false;
    const n = this.env.groundNormal(ax, az, this.aheadNormal);
    if (n.y > T.climbNy) return false;
    // Only when facing the wall.
    const hl = Math.hypot(n.x, n.z) || 1;
    if ((n.x / hl) * (wishX / len) + (n.z / hl) * (wishZ / len) > -0.35) return false;
    this.climbNormal.copy(n);
    this.velocity.set(0, 0, 0);
    this.setState('climb');
    return true;
  }

  private updateClimb(dt: number, intent: ControlIntent): void {
    const T = PLAYER_TUNING;
    const p = this.position;
    const v = this.velocity;
    const n = this.climbNormal;
    const hl = Math.hypot(n.x, n.z);

    // Let go: crouch or run out of stamina.
    if (intent.crouch && this.stateTime > 0.2) {
      v.set(n.x * 1.5, 0, n.z * 1.5);
      this.setState('air');
      return;
    }
    const moving = Math.abs(intent.moveX) + Math.abs(intent.moveY) > 0.1;
    this.stamina.hold();
    if (!this.stamina.drain((moving ? T.climbDrain : T.climbHangDrain) * dt)) {
      v.set(n.x * 1.2, -1, n.z * 1.2);
      this.setState('air');
      return;
    }

    // Hop: a quick burst up the face.
    if (this.jumpBuffer > 0 && this.stamina.spend(T.climbHopCost)) {
      this.jumpBuffer = 0;
      v.y = 5.5;
    }
    v.y = damp(v.y, 0, 5, dt);
    const up = intent.moveY * T.climbSpeed + v.y;

    // Lateral motion along the contour line of the face.
    const tx = hl > 1e-4 ? -n.z / hl : 1;
    const tz = hl > 1e-4 ? n.x / hl : 0;
    const side = intent.moveX * T.climbSpeed * 0.85;
    p.x += tx * side * dt;
    p.z += tz * side * dt;
    p.y += up * dt;

    // Hands on the face: find where the terrain reaches eye level (Newton
    // steps along the slope), then hang a little way out from it.
    const eyeY = p.y + T.eyeStand;
    for (let i = 0; i < 5; i += 1) {
      const h = this.env.groundHeight(p.x, p.z);
      const gn = this.env.groundNormal(p.x, p.z, this.normal);
      const gl = Math.hypot(gn.x, gn.z);
      if (gl < 1e-3) break;
      const grad = gl / Math.max(0.05, gn.y);
      const stepLen = clamp((h - eyeY) / grad, -0.8, 0.8);
      p.x += (gn.x / gl) * stepLen;
      p.z += (gn.z / gl) * stepLen;
    }
    const contact = this.env.groundNormal(p.x, p.z, this.normal);
    const cl = Math.hypot(contact.x, contact.z);

    // Topped out: the face flattens at hand height → mantle onto it.
    if (contact.y > T.walkableNy && intent.moveY > 0) {
      const fx = hl > 1e-4 ? -n.x / hl : 0;
      const fz = hl > 1e-4 ? -n.z / hl : 0;
      p.x += fx * 0.45;
      p.z += fz * 0.45;
      p.y = this.env.groundHeight(p.x, p.z);
      v.set(0, 0, 0);
      this.setState('ground');
      return;
    }
    if (cl > 1e-3) {
      this.climbNormal.copy(contact);
      p.x += (contact.x / cl) * 0.38;
      p.z += (contact.z / cl) * 0.38;
    }
    // The feet hang into the slope (out of view); never snap them to it, or
    // every frame would lift the body a little further up the face.
    const ground = this.env.groundHeight(p.x, p.z);
    if (intent.moveY < 0 && ground >= p.y - 0.05 && this.env.groundNormal(p.x, p.z, this.normal).y > T.walkableNy) {
      p.y = ground;
      this.setState('ground');
    }
    this.peakY = p.y;
  }

  private updateSwim(dt: number, intent: ControlIntent, wishX: number, wishZ: number, water: WaterAt): void {
    const T = PLAYER_TUNING;
    const p = this.position;
    const v = this.velocity;
    const hasWater = Number.isFinite(water.surface) && !water.frozen;
    const ground = this.env.groundHeight(p.x, p.z);
    if (!hasWater || water.surface - ground < T.swimExitDepth) {
      p.y = Math.max(p.y, ground);
      this.setState('ground');
      return;
    }
    const moving = Math.hypot(wishX, wishZ) > 0.1;
    let target: number = T.swimSpeed;
    if (intent.sprint && moving && !this.stamina.exhausted && this.stamina.drain(T.swimSprintDrain * dt)) target = T.swimSprintSpeed;
    if (this.stamina.stamina <= 0) this.callbacks.onDrowning?.(dt);
    const accel = moving ? 7 : 3;
    const tx = wishX * target + water.flowX * 0.8;
    const tz = wishZ * target + water.flowZ * 0.8;
    v.x = damp(v.x, tx, accel * 0.5, dt);
    v.z = damp(v.z, tz, accel * 0.5, dt);
    // Buoyancy spring toward the floating depth; waves carry you.
    const floatY = water.surface - T.swimFloat;
    v.y = damp(v.y, (floatY - p.y) * 3, 4, dt);
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    p.y = Math.max(p.y, this.env.groundHeight(p.x, p.z));
    this.peakY = p.y;

    // Climb out onto a bank or rock with jump.
    if (this.jumpBuffer > 0 && water.surface - this.env.groundHeight(p.x + wishX, p.z + wishZ, p.y + 1.2) < 1.2) {
      this.jumpBuffer = 0;
      v.y = 4.2;
      this.setState('air');
      return;
    }
    this.stride += Math.hypot(v.x, v.z) * dt;
    if (this.stride > 1.6) {
      this.stride = 0;
      this.leftFoot = !this.leftFoot;
      this.callbacks.onFootstep?.('swim', Math.hypot(v.x, v.z), this.leftFoot);
    }
  }

  private resolveColliders(): void {
    const T = PLAYER_TUNING;
    const p = this.position;
    const v = this.velocity;
    const list = this.env.colliders(p.x, p.z, T.radius + 1.5, this.colliderScratch);
    for (const c of list) {
      const base = c.baseY ?? this.env.groundHeight(c.x, c.z);
      if (p.y > base + c.height || p.y + 1.7 < base) continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = T.radius + c.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const nx = dx / d;
      const nz = dz / d;
      const push = min - d;
      p.x += nx * push;
      p.z += nz * push;
      const into = v.x * nx + v.z * nz;
      if (into < 0) {
        v.x -= nx * into;
        v.z -= nz * into;
      }
    }
  }

  private applyBoundary(): void {
    const p = this.position;
    const r = Math.hypot(p.x, p.z);
    const limit = this.env.boundary;
    if (r > limit) {
      const k = limit / r;
      p.x *= k;
      p.z *= k;
      const out = (this.velocity.x * p.x + this.velocity.z * p.z) / limit;
      if (out > 0) {
        this.velocity.x -= (p.x / limit) * out;
        this.velocity.z -= (p.z / limit) * out;
      }
    }
  }
}
