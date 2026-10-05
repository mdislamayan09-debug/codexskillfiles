// Living world: townsfolk, ranch hands and livestock, deer herds, and the outlaw gang at the hideout.
import * as THREE from 'three';
import { Human, Quadruped } from './creatures.js';
import { TOWN, RANCH, CAMP } from './world.js';
import { mulberry32 } from './noise.js';

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const _v = new THREE.Vector3();

// ray vs capsule (segment a-b, radius r): returns distance or -1
function rayCapsule(ray, a, b, r) {
  // sample closest approach of two lines
  const u = ray.direction, v = _v.subVectors(b, a);
  const w0 = new THREE.Vector3().subVectors(ray.origin, a);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w0), ee = v.dot(w0);
  const den = aa * cc - bb * bb;
  let sc = den > 1e-8 ? (bb * ee - cc * dd) / den : 0;
  let tc = den > 1e-8 ? (aa * ee - bb * dd) / den : ee / cc;
  tc = THREE.MathUtils.clamp(tc, 0, 1);
  sc = Math.max(0, (bb * tc - dd) / aa);
  const p = ray.origin.clone().addScaledVector(u, sc);
  const q = a.clone().addScaledVector(v, tc);
  return p.distanceTo(q) < r ? sc : -1;
}

class Actor {
  constructor(model, kind, pos, yaw) {
    this.model = model; this.kind = kind;
    this.pos = pos.clone(); this.yaw = yaw; this.speed = 0;
    this.health = 100; this.dead = false; this.deadT = 0;
    this.state = 'idle'; this.timer = Math.random() * 4; this.target = null;
    this.looted = false;
  }
  get root() { return this.model.root; }
}

export class NPCs {
  constructor({ world, town, veg, scene, fx, tracers, audio }) {
    Object.assign(this, { world, town, veg, scene, fx, tracers, audio });
    this.actors = [];
    const r = (this.rnd = mulberry32(4242));
    // townsfolk walking the boardwalks
    const outfits = ['rancher', 'gent', 'lady', 'worker', 'gent', 'lady', 'rancher'];
    for (let i = 0; i < 30; i++) {
      const h = new Human(outfits[i % outfits.length], 50 + i);
      const side = r() < 0.5 ? -1 : 1;
      const x = -110 + r() * 220, z = side * (r() < 0.6 ? 9.6 + r() * 1.2 : 3 + r() * 2.5);
      const a = this.add(h, 'towns', x, z, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      a.lane = z; a.home = new THREE.Vector3(x, 0, z);
    }
    // saddled horses tied at the hitching rails
    const hcoats = ['bay', 'chestnut', 'grey', 'black', 'bay', 'pinto'];
    town.hitches.forEach((h, i) => {
      if (r() < 0.45) return;
      const a = this.add(new Quadruped('horse', 700 + i, hcoats[i % hcoats.length]), 'tied', h.pos.x + (r() - 0.5) * 1.5, h.pos.z, h.yaw + (r() - 0.5) * 0.3);
      a.timer = r() * 10;
    });
    // the gang's horses picketed at the hideout
    for (let i = 0; i < 3; i++) {
      const x = CAMP.x + 13 + i * 0.6, z = CAMP.z - 9 + i * 2.2;
      const a = this.add(new Quadruped('horse', 760 + i, ['black', 'chestnut', 'grey'][i]), 'tied', x, z, 0.3 + i * 0.2);
      a.timer = r() * 10;
    }
    // ranch hands
    for (let i = 0; i < 3; i++) {
      const a = this.add(new Human('worker', 80 + i), 'towns', RANCH.x - 15 + i * 9, RANCH.z + 30, r() * 6);
      a.home = a.pos.clone(); a.roam = 14;
    }
    // sheep in the corral
    for (let i = 0; i < 12; i++) {
      const a = this.add(new Quadruped('sheep', 300 + i), 'sheep', RANCH.x - 30 + r() * 30, RANCH.z - 6 + r() * 24, r() * 6);
      a.pen = { minx: RANCH.x - 32, maxx: RANCH.x + 4, minz: RANCH.z - 8, maxz: RANCH.z + 20 };
    }
    // horses in the second corral
    const coats = ['bay', 'grey', 'chestnut', 'black'];
    for (let i = 0; i < 4; i++) {
      const a = this.add(new Quadruped('horse', 400 + i, coats[i]), 'horse', RANCH.x + 16 + r() * 22, RANCH.z + r() * 20, r() * 6);
      a.pen = { minx: RANCH.x + 12, maxx: RANCH.x + 42, minz: RANCH.z - 2, maxz: RANCH.z + 24 };
      // hide saddle bits on wild/ranch horses? keep tack: they are ranch stock
    }
    // deer herds
    const herds = [[-420, -260], [380, 260], [-700, 300], [260, -620], [-160, -900]];
    herds.forEach(([hx, hz], k) => {
      for (let i = 0; i < 5; i++) {
        const x = hx + (r() - 0.5) * 30, z = hz + (r() - 0.5) * 30;
        if (this.world.heightAt(x, z) < 0.5) continue;
        const a = this.add(new Quadruped('deer', 500 + k * 10 + i), 'deer', x, z, r() * 6);
        a.home = new THREE.Vector3(hx, 0, hz); a.herd = k;
        a.health = 40;
      }
    });
    // outlaws
    this.outlaws = [];
    for (let i = 0; i < 7; i++) {
      // three sit on the logs round the fire (logs lie at angles k*2.1, radius 3), the rest stand watch
      const sit = i < 3;
      const ang = sit ? i * 2.1 : (i / 7) * Math.PI * 2 + 0.9;
      const rad = sit ? 3.0 : 5.5 + r() * 2.5;
      const x = CAMP.x + Math.cos(ang) * rad, z = CAMP.z + Math.sin(ang) * rad;
      const a = this.add(new Human('outlaw', 600 + i), 'outlaw', x, z, Math.atan2(CAMP.x - x, CAMP.z - z));
      a.sitting = sit;
      a.fireT = 1 + r() * 2;
      a.cover = null;
      this.outlaws.push(a);
    }
    this.alerted = false;
  }

  add(model, kind, x, z, yaw) {
    const a = new Actor(model, kind, new THREE.Vector3(x, this.world.heightAt(x, z), z), yaw);
    this.scene.add(model.root);
    this.actors.push(a);
    return a;
  }

  // find first actor hit by ray within maxDist; returns {actor, dist, head}
  raycast(ray, maxDist) {
    let best = null;
    for (const a of this.actors) {
      if (a.dead || !a.root.visible) continue;
      const d0 = a.pos.distanceTo(ray.origin);
      if (d0 > maxDist + 3) continue;
      if (a.model instanceof Human) {
        const base = a.pos;
        const head = new THREE.Vector3(base.x, base.y + 1.66, base.z);
        let dh = rayCapsule(ray, head, head.clone().add(new THREE.Vector3(0, 0.12, 0)), 0.14);
        if (dh > 0 && (!best || dh < best.dist)) { best = { actor: a, dist: dh, head: true }; continue; }
        const d = rayCapsule(ray, base.clone().add(new THREE.Vector3(0, 0.15, 0)), base.clone().add(new THREE.Vector3(0, 1.5, 0)), 0.3);
        if (d > 0 && (!best || d < best.dist)) best = { actor: a, dist: d, head: false };
      } else {
        const s = a.model.spec.scale;
        const fwd = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
        const c = a.pos.clone().add(new THREE.Vector3(0, 1.3 * s, 0));
        const d = rayCapsule(ray, c.clone().addScaledVector(fwd, -0.8 * s), c.clone().addScaledVector(fwd, 1.1 * s).add(new THREE.Vector3(0, 0.5 * s, 0)), 0.48 * s);
        if (d > 0 && (!best || d < best.dist)) best = { actor: a, dist: d, head: false };
      }
    }
    return best && best.dist < maxDist ? best : null;
  }

  damage(a, amount, from) {
    if (a.dead) return false;
    a.health -= amount;
    this.fx.burst(a.pos.clone().add(new THREE.Vector3(0, a.kind === 'outlaw' || a.kind === 'towns' ? 1.3 : 1.0, 0)), 8, { color: [0.35, 0.02, 0.01], alpha: 0.9, size: 0.12, life: 0.6, grow: 1.5, drag: 3, grav: 6 }, 2, 1.5);
    if (a.kind === 'deer' || a.kind === 'sheep' || a.kind === 'horse') { a.state = 'flee'; a.fleeFrom = from.clone(); a.timer = 8; }
    if (a.kind === 'outlaw') this.alert(from);
    if (a.health <= 0) {
      a.dead = true; a.deadT = 0.001;
      if (a.kind === 'towns') this.onCrime && this.onCrime(a);
      return true;
    }
    return false;
  }

  alert(pos) {
    if (!this.alerted) { this.alerted = true; this.onAlert && this.onAlert(); }
    for (const o of this.outlaws) if (!o.dead) o.state = 'combat';
  }

  // gunshot noise scares wildlife & alerts nearby outlaws
  noise(pos, radius) {
    for (const a of this.actors) {
      if (a.dead) continue;
      const d = a.pos.distanceTo(pos);
      if (d > radius) continue;
      if (a.kind === 'deer' || a.kind === 'sheep' || a.kind === 'horse') { a.state = 'flee'; a.fleeFrom = pos.clone(); a.timer = 6 + Math.random() * 4; }
      if (a.kind === 'outlaw') this.alert(pos);
      if (a.kind === 'towns') { a.state = 'cower'; a.timer = 6; }
    }
  }

  update(dt, player) {
    const ppos = player.mounted ? player.hpos : player.pos;
    for (const a of this.actors) {
      const dist = a.pos.distanceTo(ppos);
      const active = dist < 420;
      a.root.visible = dist < 600;
      if (!active) continue;
      if (a.dead) {
        a.deadT += dt;
        a.speed = 0;
        if (a.model instanceof Human) a.model.animate(dt, { deadT: a.deadT });
        else { a.model.deadT = a.deadT; a.model.animate(dt, 0); }
        this.place(a);
        continue;
      }
      switch (a.kind) {
        case 'towns': this.updateTownsfolk(a, dt, ppos); break;
        case 'sheep': case 'horse': this.updateLivestock(a, dt, ppos); break;
        case 'deer': this.updateDeer(a, dt, ppos); break;
        case 'outlaw': this.updateOutlaw(a, dt, ppos, player); break;
        case 'tied': a.speed = 0; a.timer -= dt; a.model.grazing = a.timer % 14 < 5 ? 1 : 0; break;
      }
      // integrate
      if (a.speed > 0.01) {
        a.pos.x += Math.sin(a.yaw) * a.speed * dt;
        a.pos.z += Math.cos(a.yaw) * a.speed * dt;
        if (a.kind !== 'deer') this.town.collide(a.pos, 0.4);
      }
      const h = this.world.heightAt(a.pos.x, a.pos.z);
      if (h < -0.8) { a.yaw += Math.PI * 0.8; }
      this.place(a);
      if (a.model instanceof Human) a.model.animate(dt, { speed: a.speed, aim: a.aiming ? 1 : 0, aimPitch: 0, mode: a.sitting && a.state !== 'combat' ? 'sit' : 'ground' });
      else a.model.animate(dt, a.speed, a.turn || 0);
    }
  }

  place(a) {
    a.pos.y = this.world.heightAt(a.pos.x, a.pos.z);
    // stand on boardwalks
    if (a.kind === 'towns' && Math.abs(a.pos.x) < 132 && Math.abs(a.pos.z) > 8.0 && Math.abs(a.pos.z) < 11.6) a.pos.y += 0.42;
    a.root.position.copy(a.pos);
    a.root.rotation.y = a.yaw;
  }

  steer(a, want, rate, dt) {
    const d = angDiff(a.yaw, want);
    const s = THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
    a.yaw += s; a.turn = s / Math.max(dt, 1e-3) / rate;
  }

  updateTownsfolk(a, dt, ppos) {
    a.timer -= dt;
    if (a.state === 'cower') { a.speed = 0; if (a.timer < 0) a.state = 'idle'; return; }
    if (a.state === 'idle') {
      a.speed = THREE.MathUtils.lerp(a.speed, 0, dt * 4);
      // turn to look at a nearby player
      if (a.pos.distanceTo(ppos) < 6) this.steer(a, Math.atan2(ppos.x - a.pos.x, ppos.z - a.pos.z), 2, dt);
      if (a.timer < 0) {
        a.state = 'walk'; a.timer = 6 + this.rnd() * 10;
        if (a.roam) a.goal = a.home.clone().add(new THREE.Vector3((this.rnd() - 0.5) * a.roam * 2, 0, (this.rnd() - 0.5) * a.roam * 2));
        else a.goal = new THREE.Vector3(THREE.MathUtils.clamp(a.pos.x + (this.rnd() - 0.5) * 80, -125, 125), 0, a.lane);
      }
    } else {
      const want = Math.atan2(a.goal.x - a.pos.x, a.goal.z - a.pos.z);
      this.steer(a, want, 3, dt);
      a.speed = THREE.MathUtils.lerp(a.speed, 1.35, dt * 3);
      if (Math.hypot(a.goal.x - a.pos.x, a.goal.z - a.pos.z) < 1 || a.timer < 0) { a.state = 'idle'; a.timer = 3 + this.rnd() * 8; }
    }
  }

  updateLivestock(a, dt, ppos) {
    a.timer -= dt;
    const p = a.pen;
    if (a.state === 'flee') {
      const away = Math.atan2(a.pos.x - a.fleeFrom.x, a.pos.z - a.fleeFrom.z);
      this.steer(a, away, 3, dt);
      a.speed = THREE.MathUtils.lerp(a.speed, a.kind === 'horse' ? 9 : 4, dt * 2);
      if (a.timer < 0) { a.state = 'idle'; a.timer = 2; }
    } else if (a.state === 'idle') {
      a.speed = THREE.MathUtils.lerp(a.speed, 0, dt * 3);
      a.model.grazing = 1;
      if (a.timer < 0) {
        a.state = 'walk'; a.timer = 3 + this.rnd() * 5;
        a.goal = new THREE.Vector3(p.minx + this.rnd() * (p.maxx - p.minx), 0, p.minz + this.rnd() * (p.maxz - p.minz));
      }
    } else {
      a.model.grazing = 0;
      this.steer(a, Math.atan2(a.goal.x - a.pos.x, a.goal.z - a.pos.z), 1.5, dt);
      a.speed = THREE.MathUtils.lerp(a.speed, a.kind === 'horse' ? 1.5 : 0.7, dt * 2);
      if (a.timer < 0 || Math.hypot(a.goal.x - a.pos.x, a.goal.z - a.pos.z) < 1) { a.state = 'idle'; a.timer = 4 + this.rnd() * 10; }
    }
    // stay in pen
    if (p) {
      if (a.pos.x < p.minx || a.pos.x > p.maxx || a.pos.z < p.minz || a.pos.z > p.maxz) {
        a.pos.x = THREE.MathUtils.clamp(a.pos.x, p.minx, p.maxx);
        a.pos.z = THREE.MathUtils.clamp(a.pos.z, p.minz, p.maxz);
        a.yaw += Math.PI * 0.6;
      }
    }
  }

  updateDeer(a, dt, ppos) {
    a.timer -= dt;
    const pd = a.pos.distanceTo(ppos);
    if (a.state !== 'flee' && pd < 28) { a.state = 'flee'; a.fleeFrom = ppos.clone(); a.timer = 6 + this.rnd() * 3; }
    if (a.state === 'flee') {
      a.model.grazing = 0;
      const away = Math.atan2(a.pos.x - a.fleeFrom.x, a.pos.z - a.fleeFrom.z) + Math.sin(a.timer * 2 + a.herd) * 0.4;
      this.steer(a, away, 3.5, dt);
      a.speed = THREE.MathUtils.lerp(a.speed, 10, dt * 3);
      if (a.timer < 0) { a.state = 'idle'; a.timer = 3; a.home.set(a.pos.x, 0, a.pos.z); }
    } else if (a.state === 'idle') {
      a.speed = THREE.MathUtils.lerp(a.speed, 0, dt * 3);
      a.model.grazing = 1;
      if (pd < 50) a.model.grazing = 0; // alert, head up
      if (a.timer < 0) { a.state = 'walk'; a.timer = 2 + this.rnd() * 4; a.goal = a.home.clone().add(new THREE.Vector3((this.rnd() - 0.5) * 40, 0, (this.rnd() - 0.5) * 40)); }
    } else {
      a.model.grazing = 0;
      this.steer(a, Math.atan2(a.goal.x - a.pos.x, a.goal.z - a.pos.z), 1.5, dt);
      a.speed = THREE.MathUtils.lerp(a.speed, 1.1, dt * 2);
      if (a.timer < 0) { a.state = 'idle'; a.timer = 4 + this.rnd() * 8; }
    }
  }

  updateOutlaw(a, dt, ppos, player) {
    const pd = a.pos.distanceTo(ppos);
    if (a.state !== 'combat' && pd < 48) this.alert(ppos);
    if (a.state !== 'combat') {
      a.speed = 0;
      a.aiming = false;
      // face the fire
      this.steer(a, Math.atan2(CAMP.x - a.pos.x, CAMP.z - a.pos.z), 2, dt);
      return;
    }
    // combat: strafe between cover points, face & shoot the player
    if (!a.cover || a.pos.distanceTo(a.cover) < 1 || Math.random() < dt * 0.08) {
      const ang = Math.atan2(a.pos.x - ppos.x, a.pos.z - ppos.z) + (Math.random() - 0.5) * 1.2;
      const r = THREE.MathUtils.clamp(pd * 0.85, 10, 40);
      a.cover = new THREE.Vector3(ppos.x + Math.sin(ang) * r, 0, ppos.z + Math.cos(ang) * r);
      a.coverT = 2 + Math.random() * 3;
    }
    a.coverT -= dt;
    const moving = a.coverT > 0 && a.pos.distanceTo(a.cover) > 1;
    const want = moving ? Math.atan2(a.cover.x - a.pos.x, a.cover.z - a.pos.z) : Math.atan2(ppos.x - a.pos.x, ppos.z - a.pos.z);
    this.steer(a, want, 5, dt);
    a.speed = THREE.MathUtils.lerp(a.speed, moving ? 4.2 : 0, dt * 4);
    a.aiming = !moving;
    a.fireT -= dt;
    if (!moving && a.fireT < 0 && pd < 90 && !player.dead) {
      a.fireT = 1.1 + Math.random() * 1.8;
      const muzzle = a.pos.clone().add(new THREE.Vector3(Math.sin(a.yaw) * 0.6, 1.5, Math.cos(a.yaw) * 0.6));
      const moveK = player.mounted ? player.hspeed / 14 : player.speed / 7;
      const hitChance = THREE.MathUtils.clamp(0.55 - pd / 140 - moveK * 0.3, 0.06, 0.5);
      const hit = Math.random() < hitChance;
      const target = ppos.clone().add(new THREE.Vector3(0, 1.4, 0));
      if (!hit) target.add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 3));
      this.tracers.shot(muzzle, target);
      this.fx.burst(muzzle, 4, { color: [0.75, 0.72, 0.68], alpha: 0.45, size: 0.35, life: 1.5, grow: 1.2, drag: 2 }, 0.6, 0.4);
      this.audio && this.audio.gunshot(muzzle, 0.8);
      if (hit) this.onPlayerHit && this.onPlayerHit(8 + Math.random() * 8, muzzle);
    }
  }

  nearestLootable(pos) {
    let best = null, bd = 2.6;
    for (const a of this.actors) {
      if (!a.dead || a.looted) continue;
      const d = a.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
}
