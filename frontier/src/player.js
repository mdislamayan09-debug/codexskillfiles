// Player: on-foot and horseback locomotion, third-person / aim / cinematic cameras.
import * as THREE from 'three';
import { Human, Quadruped } from './creatures.js';
import { HALF } from './world.js';

const tmp = new THREE.Vector3();
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Player {
  constructor({ world, town, veg, scene, camera, input }) {
    Object.assign(this, { world, town, veg, scene, camera, input });
    this.rider = new Human('arthur', 7);
    this.horse = new Quadruped('horse', 11, 'pinto');
    scene.add(this.horse.root);
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.speed = 0; this.vy = 0; this.grounded = true;
    this.hpos = new THREE.Vector3(); this.hyaw = 0; this.hspeed = 0; this.hturn = 0;
    this.mounted = true;
    this.camYaw = 0; this.camPitch = 0.12; this.camDist = 6.5; this.camZoom = 1;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.aim = 0; this.aiming = false;
    this.health = 100; this.stamina = 100; this.deadEye = 100;
    this.horseStamina = 100; this.horseHealth = 100;
    this.cinematic = 0; this.cinematicOn = false; this.cineT = 0;
    this.whistled = false;
    this.footstepT = 0;
    this.onStep = null;
    this.attachRider();
  }

  attachRider() {
    if (this.mounted) {
      this.horse.body.add(this.rider.root);
      this.rider.root.position.set(0, 0.9, -0.1);
      this.rider.root.rotation.set(0, 0, 0);
    } else {
      this.scene.add(this.rider.root);
    }
  }

  spawn(x, z, yaw) {
    this.hpos.set(x, this.world.heightAt(x, z), z);
    this.pos.copy(this.hpos);
    this.hyaw = this.yaw = this.camYaw = yaw;
    this.camPos.set(x - Math.sin(yaw) * 7, this.hpos.y + 3, z - Math.cos(yaw) * 7);
  }

  toggleMount() {
    if (this.mounted) {
      this.mounted = false;
      this.hspeed = 0;
      const side = new THREE.Vector3(Math.cos(this.hyaw), 0, -Math.sin(this.hyaw));
      this.pos.copy(this.hpos).addScaledVector(side, -1.1);
      this.yaw = this.hyaw;
      this.attachRider();
      return 'Dismounted';
    }
    if (this.pos.distanceTo(this.hpos) < 3.5) {
      this.mounted = true;
      this.attachRider();
      return 'Mounted';
    }
    return null;
  }

  update(dt, timeScale = 1) {
    const inp = this.input, W = this.world;
    // camera look
    const sens = this.aiming ? 0.0012 : 0.0022;
    this.camYaw -= inp.mouse.dx * sens;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.mouse.dy * sens, -0.5, 1.1);
    if (inp.down('ArrowLeft')) this.camYaw += dt * 2;
    if (inp.down('ArrowRight')) this.camYaw -= dt * 2;
    this.camZoom = THREE.MathUtils.clamp(this.camZoom + inp.mouse.wheel * 0.12, 0.55, 1.8);

    // movement intent (camera relative)
    let ix = 0, iz = 0;
    if (inp.down('KeyW')) iz += 1;
    if (inp.down('KeyS')) iz -= 1;
    if (inp.down('KeyA')) ix -= 1;
    if (inp.down('KeyD')) ix += 1;
    const has = ix !== 0 || iz !== 0;
    const inputYaw = this.camYaw + Math.atan2(-ix, iz);
    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    this.aiming = inp.mouse.right;

    if (this.mounted) this.updateHorseRidden(dt, has, inputYaw, iz, sprint);
    else {
      this.updateOnFoot(dt, has, inputYaw, sprint);
      this.updateHorseFree(dt);
    }
    // stats regen
    this.stamina = Math.min(100, this.stamina + dt * (sprint && has ? -6 : 9));
    this.health = Math.min(100, this.health + dt * 0.8);

    // horse pose
    this.horse.root.position.copy(this.hpos);
    // hooves sink into deep snow up to the fetlocks
    this.snowDepth = THREE.MathUtils.smoothstep(W.climateAt(this.hpos.x, this.hpos.z).snow, 0.45, 0.8);
    this.horse.root.position.y -= 0.24 * this.snowDepth;
    this.horse.root.rotation.y = this.hyaw;
    // pitch horse to terrain slope
    const fwd = tmp.set(Math.sin(this.hyaw), 0, Math.cos(this.hyaw));
    const hf = W.heightAt(this.hpos.x + fwd.x * 1.1, this.hpos.z + fwd.z * 1.1);
    const hb = W.heightAt(this.hpos.x - fwd.x * 1.1, this.hpos.z - fwd.z * 1.1);
    this.horse.root.rotation.x = 0;
    this.horse.body.rotation.x += 0; // gait handles bob
    this.horse.root.rotation.order = 'YXZ';
    this.horse.root.rotation.x = -Math.atan2(hf - hb, 2.2) * 0.8;
    const hphase = this.horse.animate(dt, this.hspeed, this.hturn);

    // rider pose
    if (this.mounted) {
      this.rider.animate(dt, { mode: 'ride', horsePhase: hphase, gait: this.horse.gait, aim: this.aiming ? 1 : 0, aimPitch: -this.camPitch });
      // twist rider toward aim
      const twist = this.aiming ? THREE.MathUtils.clamp(angDiff(this.hyaw, this.camYaw), -1.6, 1.6) : 0;
      this.rider.root.rotation.y = THREE.MathUtils.lerp(this.rider.root.rotation.y, twist, Math.min(1, dt * 8));
      this.pos.copy(this.hpos);
    } else {
      this.rider.root.position.copy(this.pos);
      this.rider.root.rotation.y = this.yaw;
      this.rider.animate(dt, { mode: 'ground', speed: this.speed, aim: this.aiming ? 1 : 0, aimPitch: -this.camPitch });
    }
    this.rider.lookYaw = THREE.MathUtils.clamp(angDiff(this.mounted ? this.hyaw : this.yaw, this.camYaw) * 0.5, -0.8, 0.8);
    this.updateCamera(dt);
  }

  groundSpeedFactor(p, yaw, speed) {
    const W = this.world;
    const ahead = W.heightAt(p.x + Math.sin(yaw) * 1.5, p.z + Math.cos(yaw) * 1.5);
    const here = W.heightAt(p.x, p.z);
    const grade = (ahead - here) / 1.5;
    let f = 1;
    if (grade > 0.45) f = Math.max(0, 1 - (grade - 0.45) * 4);
    const depth = -here;
    if (depth > 0) f *= Math.max(0.25, 1 - depth * 0.45);
    return f;
  }

  updateHorseRidden(dt, has, inputYaw, iz, sprint) {
    let target = 0;
    if (has) target = sprint && this.horseStamina > 5 ? 13.5 : 7.2;
    if (this.input.down('AltLeft') || this.input.down('KeyC') && false) target = Math.min(target, 1.8);
    if (iz < 0 && Math.abs(angDiff(this.hyaw, inputYaw)) > 2.4 && this.hspeed > 1) target = 0;
    if (this.input.down('ControlLeft')) target = Math.min(target, 1.8); // walk
    const accel = target > this.hspeed ? 3.2 : 6.5;
    this.hspeed += THREE.MathUtils.clamp(target - this.hspeed, -accel * dt, accel * dt);
    this.horseStamina = THREE.MathUtils.clamp(this.horseStamina + dt * (this.hspeed > 10 ? -7 : 5), 0, 100);
    if (has) {
      const turnRate = 2.6 - Math.min(this.hspeed, 13) * 0.11;
      const d = angDiff(this.hyaw, inputYaw);
      const step = THREE.MathUtils.clamp(d, -turnRate * dt, turnRate * dt);
      this.hyaw += step;
      this.hturn = THREE.MathUtils.lerp(this.hturn, step / Math.max(dt, 1e-3) / turnRate, Math.min(1, dt * 5));
    } else this.hturn = THREE.MathUtils.lerp(this.hturn, 0, Math.min(1, dt * 5));
    this.moveBody(this.hpos, this.hyaw, this.hspeed * this.groundSpeedFactor(this.hpos, this.hyaw, this.hspeed), dt, 1.0);
    if (this.hspeed > 0.5) {
      this.footstepT += dt * [0, 1.8, 2.7, 3.4, 4.3][this.horse.gait];
      if (this.footstepT > 1) { this.footstepT = 0; this.onStep && this.onStep('hoof', this.horse.gait); }
    }
  }

  updateHorseFree(dt) {
    // whistled horse trots to the player, otherwise grazes
    const d = this.pos.distanceTo(this.hpos);
    let target = 0;
    if (this.whistled && d > 3) {
      const want = Math.atan2(this.pos.x - this.hpos.x, this.pos.z - this.hpos.z);
      this.hyaw += THREE.MathUtils.clamp(angDiff(this.hyaw, want), -2 * dt, 2 * dt);
      target = d > 30 ? 12 : d > 10 ? 6 : 2;
    } else this.whistled = false;
    this.hspeed += THREE.MathUtils.clamp(target - this.hspeed, -6 * dt, 3 * dt);
    this.horse.grazing = target === 0 ? 1 : 0;
    this.moveBody(this.hpos, this.hyaw, this.hspeed, dt, 1.0);
  }

  updateOnFoot(dt, has, inputYaw, sprint) {
    let target = 0;
    if (has) target = sprint && this.stamina > 3 ? 6.4 : this.input.down('ControlLeft') ? 1.5 : 3.6;
    if (this.aiming) target = Math.min(target, 2.2);
    this.speed += THREE.MathUtils.clamp(target - this.speed, -14 * dt, 9 * dt);
    if (this.aiming) this.yaw += angDiff(this.yaw, this.camYaw) * Math.min(1, dt * 12);
    else if (has) this.yaw += angDiff(this.yaw, inputYaw) * Math.min(1, dt * 10);
    const moveYaw = this.aiming && has ? inputYaw : this.yaw;
    const W = this.world;
    // jump & gravity
    if (this.input.hit('Space') && this.grounded) { this.vy = 4.6; this.grounded = false; }
    this.vy -= 13 * dt;
    this.moveBody(this.pos, moveYaw, this.speed * this.groundSpeedFactor(this.pos, moveYaw, this.speed), dt, 0.35, true);
    this.pos.y += this.vy * dt;
    const gh = Math.max(W.heightAt(this.pos.x, this.pos.z), this.floorAt(this.pos));
    if (this.pos.y <= gh) { this.pos.y = gh; this.vy = 0; this.grounded = true; }
    if (this.speed > 0.5 && this.grounded) {
      this.footstepT += dt * (1.2 + this.speed * 0.35);
      if (this.footstepT > 1) { this.footstepT = 0; this.onStep && this.onStep('foot', this.speed); }
    }
  }

  // boardwalk floors in town
  floorAt(p) {
    const az = Math.abs(p.z);
    if (Math.abs(p.x) < 132 && az > 8.0 && az < 11.6) return this.world.heightAt(p.x, p.z) + 0.42;
    return -1e9;
  }

  moveBody(p, yaw, speed, dt, radius, keepY = false) {
    p.x += Math.sin(yaw) * speed * dt;
    p.z += Math.cos(yaw) * speed * dt;
    this.town.collide(p, radius);
    this.veg.collide(p, radius);
    const lim = HALF - 60;
    p.x = THREE.MathUtils.clamp(p.x, -lim, lim);
    p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
    // keep out of deep water
    const h = this.world.heightAt(p.x, p.z);
    if (h < -1.6) { p.x -= Math.sin(yaw) * speed * dt * 1.05; p.z -= Math.cos(yaw) * speed * dt * 1.05; }
    if (!keepY) p.y = THREE.MathUtils.lerp(p.y, Math.max(this.world.heightAt(p.x, p.z), -1.2), Math.min(1, dt * 12));
  }

  updateCamera(dt) {
    const cam = this.camera;
    this.aim = THREE.MathUtils.lerp(this.aim, this.aiming ? 1 : 0, Math.min(1, dt * 9));
    const base = this.mounted ? this.hpos : this.pos;
    const h = this.mounted ? 2.45 : 1.62;
    const look = new THREE.Vector3(base.x, base.y + h, base.z);
    const dist = THREE.MathUtils.lerp(this.mounted ? 6.2 + this.hspeed * 0.12 : 4.0, this.mounted ? 2.6 : 1.9, this.aim) * this.camZoom;
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    look.addScaledVector(right, -0.62 * this.aim - 0.25);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), -Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const want = look.clone().addScaledVector(dir, -dist);
    // terrain collision for camera
    const th = this.world.heightAt(want.x, want.z) + 0.6;
    if (want.y < th) want.y = th;
    if (this.cinematicOn && this.mounted) {
      // slow sweeping side-on shot with letterbox, like the cinematic travel camera
      this.cineT += dt * 0.08;
      const side = Math.sin(this.cineT) > 0 ? 1 : -1;
      const hy = this.hyaw;
      const off = new THREE.Vector3(Math.cos(hy) * 7 * side, 1.6, -Math.sin(hy) * 7 * side).addScaledVector(new THREE.Vector3(Math.sin(hy), 0, Math.cos(hy)), 5 + Math.cos(this.cineT * 3) * 3);
      want.copy(this.hpos).add(off);
      want.y = Math.max(want.y, this.world.heightAt(want.x, want.z) + 0.8);
      look.copy(this.hpos).add(new THREE.Vector3(0, 1.8, 0));
      this.cinematic = Math.min(1, this.cinematic + dt);
    } else this.cinematic = Math.max(0, this.cinematic - dt * 2);
    const k = 1 - Math.exp(-dt * (this.aiming ? 22 : 9));
    this.camPos.lerp(want, this.cinematicOn ? 1 - Math.exp(-dt * 1.5) : k);
    this.camLook.lerp(look, this.cinematicOn ? 1 - Math.exp(-dt * 2) : 1);
    cam.position.copy(this.camPos);
    cam.lookAt(this.cinematicOn ? this.camLook : look);
    const fov = THREE.MathUtils.lerp(this.mounted ? 55 + Math.min(this.hspeed, 14) * 0.6 : 52, 38, this.aim);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = THREE.MathUtils.lerp(cam.fov, fov, Math.min(1, dt * 6)); cam.updateProjectionMatrix(); }
  }

  // world-space aim ray from camera centre
  aimRay(out = new THREE.Ray()) {
    this.camera.getWorldPosition(out.origin);
    this.camera.getWorldDirection(out.direction);
    return out;
  }
}
