import * as THREE from 'three';

// The survivor's defence: a quick dodge with a moment of invulnerability, a
// raised guard that turns aside blows from the front (at a cost in
// stamina), a parry for a guard raised just in time, and lock-on to keep a
// target under the crosshair. Pure state; the Game wires input, movement,
// damage and the HUD to it.

export type HitResult = 'hit' | 'dodged' | 'blocked' | 'parried' | 'guardBreak';

export interface LockCandidate {
  kind: 'creature' | 'warden';
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface StaminaSpend {
  spend(amount: number): boolean;
}

/** Seconds of the dash itself, and of invulnerability (a little longer). */
export const DODGE = { dash: 0.2, iframes: 0.3, cooldown: 0.6, speed: 10.5, stamina: 16 };
/** A guard raised this recently parries instead of blocking. */
export const PARRY_WINDOW = 0.2;

export class Combat {
  /** Invulnerability left (s). */
  iframes = 0;
  /** Dash left (s) and its direction (world xz, unit). */
  dash = 0;
  readonly dashDir = new THREE.Vector2();
  cooldown = 0;
  /** Guard raised, and for how long. */
  blocking = false;
  guardTime = 0;
  /** Guard knocked down (s): no blocking until it recovers. */
  guardBroken = 0;
  /** Seconds since the last parry (drives the flash and sound). */
  parried = 99;
  lock: LockCandidate | null = null;

  update(dt: number, wantBlock: boolean): void {
    this.iframes = Math.max(0, this.iframes - dt);
    this.dash = Math.max(0, this.dash - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.guardBroken = Math.max(0, this.guardBroken - dt);
    this.parried += dt;
    const block = wantBlock && this.guardBroken <= 0 && this.dash <= 0;
    this.guardTime = block ? (this.blocking ? this.guardTime + dt : 0) : 0;
    this.blocking = block;
  }

  /** Start a dodge toward (dx, dz); false if tired or too soon. */
  dodge(dx: number, dz: number, stamina: StaminaSpend): boolean {
    if (this.cooldown > 0 || this.dash > 0) return false;
    if (!stamina.spend(DODGE.stamina)) return false;
    const d = Math.hypot(dx, dz) || 1;
    this.dashDir.set(dx / d, dz / d);
    this.dash = DODGE.dash;
    this.iframes = DODGE.iframes;
    this.cooldown = DODGE.cooldown;
    this.blocking = false;
    return true;
  }

  /**
   * A blow of `amount` from (fromX, fromZ) against a survivor at (x, z)
   * facing `yaw`. Returns what lands and why.
   */
  incoming(amount: number, fromX: number, fromZ: number, x: number, z: number, yaw: number, stamina: StaminaSpend): { damage: number; result: HitResult } {
    if (this.iframes > 0) return { damage: 0, result: 'dodged' };
    if (this.blocking) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const dx = fromX - x;
      const dz = fromZ - z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / d > 0.2) {
        if (this.guardTime < PARRY_WINDOW) {
          this.parried = 0;
          return { damage: 0, result: 'parried' };
        }
        if (stamina.spend(amount * 1.1)) return { damage: amount * 0.25, result: 'blocked' };
        this.guardBroken = 1.4;
        this.blocking = false;
        return { damage: amount * 0.75, result: 'guardBreak' };
      }
    }
    return { damage: amount, result: 'hit' };
  }

  /** The candidate nearest the crosshair (within `maxAngle` of forward and `range`). */
  acquire(candidates: LockCandidate[], eye: THREE.Vector3, forward: THREE.Vector3, range = 32, maxAngle = 0.45): LockCandidate | null {
    let best: LockCandidate | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const dx = c.x - eye.x;
      const dy = c.y - eye.y;
      const dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range || d < 0.5) continue;
      const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
      const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
      if (angle > maxAngle) continue;
      const score = angle * 4 + d / range;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Yaw and pitch that look from `eye` at the locked target. */
  static aimAt(eye: THREE.Vector3, x: number, y: number, z: number): { yaw: number; pitch: number } {
    const dx = x - eye.x;
    const dz = z - eye.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(y - eye.y, Math.hypot(dx, dz)) };
  }
}
