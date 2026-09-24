import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addPatch, replaceOnce } from '../render/materials/MaterialPatches';

// Procedural creature bodies: parts (ellipsoids, tapered capsules, cones)
// rigidly skinned to a small bone rig and merged into ONE SkinnedMesh per
// species, so a herd costs one draw call per animal. Gaits, grazing,
// lunges and death falls are posed procedurally every frame.

export type BodyPlan = 'quadruped' | 'crab' | 'beetle';

export interface CreatureLook {
  plan: BodyPlan;
  /** Body length (m, nose excluded). */
  length: number;
  /** Shoulder height (m). */
  height: number;
  bulk: number;
  neck: number;
  headSize: number;
  snout: number;
  legThickness: number;
  tail: number;
  ears: 'long' | 'pointed' | 'small' | 'none';
  horns: 'antlers' | 'tusks' | 'curled' | 'none';
  coat: THREE.Color;
  belly: THREE.Color;
  accent: THREE.Color;
  /** Fur/grain pattern strength and gloss (chitin shells are glossy). */
  roughness: number;
}

export const BONE = {
  root: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  tail: 5,
  // Legs: FL, FR, BL, BR × (upper, lower).
  legs: 6,
} as const;

export interface CreatureRig {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  look: CreatureLook;
  /** Height of the root above the ground at rest. */
  rootHeight: number;
  legCount: number;
}

interface Part {
  geometry: THREE.BufferGeometry;
  bone: number;
  color: THREE.Color;
  colorTop?: THREE.Color;
}

function ellipsoid(rx: number, ry: number, rz: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.floor(seg * 0.7)));
  g.scale(rx, ry, rz);
  return g;
}

function limb(r0: number, r1: number, length: number, seg = 8): THREE.BufferGeometry {
  // Tapered capsule hanging down from the joint at y=0.
  const g = new THREE.CapsuleGeometry((r0 + r1) / 2, length, 3, seg);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + length / 2) / length, 0, 1);
    const r = THREE.MathUtils.lerp(r1, r0, t) / ((r0 + r1) / 2);
    pos.setX(i, pos.getX(i) * r);
    pos.setZ(i, pos.getZ(i) * r);
    pos.setY(i, y - length / 2);
  }
  g.computeVertexNormals();
  return g;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Tapered capsule from `from` (radius r0) to `to` (radius r1), in rest space. */
function segment(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, seg = 7): THREE.BufferGeometry {
  const dir = from.clone().sub(to);
  const len = Math.max(1e-3, dir.length());
  const g = limb(r0, r1, len, seg);
  g.translate(0, len, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()));
  g.translate(to.x, to.y, to.z);
  return g;
}

export class CreatureBuilder {
  private readonly material: THREE.MeshStandardMaterial;

  constructor() {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.material.name = 'creature';
    // Fur grain: fine directional noise breaks up the flat vertex colour.
    addPatch(this.material, {
      key: 'creature-fur',
      apply(shader) {
        shader.vertexShader = replaceOnce(
          shader.vertexShader,
          '#include <common>',
          '#include <common>\nvarying vec3 vFurPos;',
          'fur-vpars',
        );
        shader.vertexShader = replaceOnce(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\nvFurPos = position;', 'fur-pos');
        shader.fragmentShader = replaceOnce(
          shader.fragmentShader,
          '#include <common>',
          `#include <common>
varying vec3 vFurPos;
float furHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
          'fur-fpars',
        );
        shader.fragmentShader = replaceOnce(
          shader.fragmentShader,
          '#include <color_fragment>',
          `#include <color_fragment>
float furN = furHash(floor(vFurPos * vec3(160.0, 60.0, 160.0))) * 0.6 + furHash(floor(vFurPos * 40.0)) * 0.4;
diffuseColor.rgb *= 0.8 + 0.34 * furN;`,
          'fur-color',
        );
      },
    });
  }

  get materials(): THREE.Material[] {
    return [this.material];
  }

  build(look: CreatureLook): CreatureRig {
    if (look.plan === 'quadruped') return this.quadruped(look);
    return this.arthropod(look);
  }

  private finish(parts: Part[], bones: THREE.Bone[], look: CreatureLook, rootHeight: number, legCount: number): CreatureRig {
    const geometries: THREE.BufferGeometry[] = [];
    for (const part of parts) {
      const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
      g.deleteAttribute('uv');
      const count = g.getAttribute('position').count;
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      const colors = new Float32Array(count * 3);
      const pos = g.getAttribute('position');
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < count; i += 1) {
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
      }
      for (let i = 0; i < count; i += 1) {
        skinIndex[i * 4] = part.bone;
        skinWeight[i * 4] = 1;
        const t = part.colorTop ? (pos.getY(i) - minY) / Math.max(1e-4, maxY - minY) : 0;
        const c = part.colorTop ? part.color.clone().lerp(part.colorTop, THREE.MathUtils.smoothstep(t, 0.35, 0.8)) : part.color;
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometries.push(g);
    }
    const merged = mergeGeometries(geometries, false) as THREE.BufferGeometry;
    merged.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(merged, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.add(bones[0]);
    // Bone inverses must come from the rest pose in mesh space.
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    return { mesh, bones, look, rootHeight, legCount };
  }

  /**
   * Parts are authored in world-rest space and then transformed into their
   * bone's local frame (bones are pure translations at rest).
   */
  private place(geometry: THREE.BufferGeometry, restWorld: THREE.Vector3, rot?: THREE.Euler): THREE.BufferGeometry {
    if (rot) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
    geometry.translate(restWorld.x, restWorld.y, restWorld.z);
    return geometry;
  }

  private quadruped(look: CreatureLook): CreatureRig {
    const L = look.length;
    const H = look.height;
    const legLen = H * 0.62;
    const hipY = legLen + look.legThickness;
    const bodyR = (H - legLen) * 0.55 * look.bulk + 0.02;
    const bones: THREE.Bone[] = [];
    const world: THREE.Vector3[] = [];
    const bone = (parent: number, pos: THREE.Vector3) => {
      const b = new THREE.Bone();
      const idx = bones.length;
      if (parent >= 0) {
        b.position.copy(pos).sub(world[parent]);
        bones[parent].add(b);
      } else b.position.copy(pos);
      bones.push(b);
      world.push(pos.clone());
      return idx;
    };
    // Creature faces -Z (forward). Root at the hips.
    const root = bone(-1, new THREE.Vector3(0, hipY, L * 0.3));
    const spine = bone(root, new THREE.Vector3(0, hipY + bodyR * 0.15, 0));
    const chest = bone(spine, new THREE.Vector3(0, hipY + bodyR * 0.2, -L * 0.3));
    const neckBase = new THREE.Vector3(0, hipY + bodyR * 0.6, -L * 0.45);
    const neck = bone(chest, neckBase);
    const headPos = new THREE.Vector3(0, neckBase.y + L * 0.28 * look.neck, neckBase.z - L * 0.18 * look.neck);
    const head = bone(neck, headPos);
    const tail = bone(root, new THREE.Vector3(0, hipY + bodyR * 0.3, L * 0.48));
    const legBones: number[] = [];
    const legX = bodyR * 0.62;
    for (const [x, z, parent] of [
      [-legX, -L * 0.34, chest],
      [legX, -L * 0.34, chest],
      [-legX, L * 0.3, root],
      [legX, L * 0.3, root],
    ] as const) {
      const upper = bone(parent, new THREE.Vector3(x, hipY, z));
      const lower = bone(upper, new THREE.Vector3(x, hipY - legLen * 0.5, z));
      legBones.push(upper, lower);
    }
    void legBones;

    const coat = look.coat;
    const parts: Part[] = [];
    const add = (geometry: THREE.BufferGeometry, b: number, rest: THREE.Vector3, color: THREE.Color, rot?: THREE.Euler, top?: THREE.Color) => {
      parts.push({ geometry: this.place(geometry, rest, rot), bone: b, color, colorTop: top });
    };
    const addSeg = (b: number, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, color: THREE.Color, seg = 7) => {
      parts.push({ geometry: segment(from, to, r0, r1, seg), bone: b, color });
    };
    // Barrel: hindquarters + chest, darker along the back.
    add(ellipsoid(bodyR * 0.95, bodyR, L * 0.32), spine, new THREE.Vector3(0, hipY + bodyR * 0.12, L * 0.12), look.belly, undefined, coat);
    add(ellipsoid(bodyR * 1.02, bodyR * 1.08, L * 0.3), chest, new THREE.Vector3(0, hipY + bodyR * 0.22, -L * 0.22), look.belly, undefined, coat);
    // Neck and head.
    addSeg(neck, neckBase.clone().add(new THREE.Vector3(0, -bodyR * 0.3, 0.05 * L)), headPos, bodyR * 0.62, bodyR * 0.36 * look.headSize + 0.02, coat, 8);
    const hs = look.headSize;
    add(ellipsoid(0.11 * hs * L, 0.1 * hs * L, 0.14 * hs * L), head, headPos, coat);
    const snout = new THREE.ConeGeometry(0.075 * hs * L, 0.2 * look.snout * L, 8);
    add(snout, head, headPos.clone().add(new THREE.Vector3(0, -0.02 * L, -0.15 * hs * L - 0.08 * look.snout * L)), look.accent, new THREE.Euler(-Math.PI / 2 - 0.25, 0, 0));
    // Eyes (dark, glossy).
    for (const side of [-1, 1]) add(ellipsoid(0.018 * L * hs, 0.018 * L * hs, 0.012 * L * hs, 6), head, headPos.clone().add(new THREE.Vector3(side * 0.085 * hs * L, 0.03 * L, -0.08 * hs * L)), new THREE.Color(0.02, 0.02, 0.02));
    // Ears.
    if (look.ears !== 'none') {
      const earLen = look.ears === 'long' ? 0.22 * L : look.ears === 'pointed' ? 0.1 * L : 0.06 * L;
      for (const side of [-1, 1]) {
        const ear = new THREE.ConeGeometry(0.03 * L * (look.ears === 'long' ? 0.8 : 1), earLen, 5);
        add(ear, head, headPos.clone().add(new THREE.Vector3(side * 0.07 * hs * L, 0.08 * hs * L + earLen * 0.4, 0.02 * L)), coat, new THREE.Euler(0.2, 0, side * -0.45));
      }
    }
    // Horns.
    if (look.horns === 'antlers') {
      for (const side of [-1, 1]) {
        const base = headPos.clone().add(new THREE.Vector3(side * 0.05 * L, 0.1 * hs * L, 0.02 * L));
        const mid = base.clone().add(new THREE.Vector3(side * 0.12 * L, 0.2 * L, 0.06 * L));
        const top = mid.clone().add(new THREE.Vector3(side * 0.05 * L, 0.2 * L, 0.08 * L));
        addSeg(head, base, mid, 0.02 * L, 0.014 * L, look.accent, 5);
        addSeg(head, mid, top, 0.014 * L, 0.006 * L, look.accent, 5);
        addSeg(head, mid, mid.clone().add(new THREE.Vector3(side * 0.12 * L, 0.06 * L, -0.08 * L)), 0.012 * L, 0.005 * L, look.accent, 5);
        addSeg(head, base.clone().lerp(mid, 0.4), base.clone().add(new THREE.Vector3(side * 0.02 * L, 0.12 * L, -0.12 * L)), 0.011 * L, 0.005 * L, look.accent, 5);
      }
    } else if (look.horns === 'tusks') {
      for (const side of [-1, 1]) add(new THREE.ConeGeometry(0.012 * L, 0.09 * L, 5), head, headPos.clone().add(new THREE.Vector3(side * 0.05 * L, -0.03 * L, -0.2 * L)), new THREE.Color(0.9, 0.86, 0.75), new THREE.Euler(-2.6, 0, side * 0.3));
    } else if (look.horns === 'curled') {
      for (const side of [-1, 1]) {
        const horn = new THREE.TorusGeometry(0.075 * L, 0.03 * L, 6, 12, Math.PI * 1.5);
        add(horn, head, headPos.clone().add(new THREE.Vector3(side * 0.1 * L, 0.06 * L, 0.02 * L)), look.accent, new THREE.Euler(0, Math.PI / 2, side * 0.5));
      }
    }
    // Tail.
    if (look.tail > 0) {
      const tl = look.tail * L;
      addSeg(tail, world[tail], world[tail].clone().add(new THREE.Vector3(0, -0.45 * tl, 0.9 * tl)), 0.04 * L, 0.012 * L, coat, 6);
    }
    // Legs: upper and lower segments with hooves/paws.
    const lt = look.legThickness;
    for (let k = 0; k < 4; k += 1) {
      const upper = BONE.legs + k * 2;
      const lower = upper + 1;
      const front = k < 2;
      const hip = world[upper].clone().add(new THREE.Vector3(0, bodyR * 0.25, 0));
      const knee = world[lower];
      const foot = knee.clone().add(new THREE.Vector3(0, -legLen * 0.5, 0));
      addSeg(upper, hip, knee, lt * (front ? 1.45 : 1.75), lt * 0.95, front ? coat : look.belly.clone().lerp(coat, 0.6));
      addSeg(lower, knee, foot, lt * 0.85, lt * 0.62, coat.clone().multiplyScalar(0.85), 6);
      add(ellipsoid(lt * 0.8, lt * 0.55, lt * 1.1, 6), lower, foot.clone().add(new THREE.Vector3(0, 0, -lt * 0.2)), look.accent.clone().multiplyScalar(0.5));
    }
    return this.finish(parts, bones, look, hipY, 4);
  }

  /** Crabs and beetles: wide low body, six or eight splayed legs. */
  private arthropod(look: CreatureLook): CreatureRig {
    const L = look.length;
    const H = look.height;
    const bones: THREE.Bone[] = [];
    const world: THREE.Vector3[] = [];
    const bone = (parent: number, pos: THREE.Vector3) => {
      const b = new THREE.Bone();
      const idx = bones.length;
      if (parent >= 0) {
        b.position.copy(pos).sub(world[parent]);
        bones[parent].add(b);
      } else b.position.copy(pos);
      bones.push(b);
      world.push(pos.clone());
      return idx;
    };
    const crab = look.plan === 'crab';
    const bodyY = H * 0.6;
    const root = bone(-1, new THREE.Vector3(0, bodyY, 0));
    const spine = bone(root, new THREE.Vector3(0, bodyY, 0));
    const chest = bone(spine, new THREE.Vector3(0, bodyY, -L * 0.2));
    const neck = bone(chest, new THREE.Vector3(0, bodyY, -L * 0.35));
    const head = bone(neck, new THREE.Vector3(0, bodyY, -L * 0.45));
    const tail = bone(root, new THREE.Vector3(0, bodyY, L * 0.4));
    void spine;
    void tail;
    const legPairs = crab ? 4 : 3;
    const legCount = legPairs * 2;
    for (let i = 0; i < legCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const pair = Math.floor(i / 2);
      const z = (pair / Math.max(1, legPairs - 1) - 0.5) * L * 0.55;
      const upper = bone(root, new THREE.Vector3(side * L * (crab ? 0.32 : 0.22), bodyY, z));
      bone(upper, new THREE.Vector3(side * L * (crab ? 0.62 : 0.42), bodyY + H * 0.15, z));
    }
    const parts: Part[] = [];
    const add = (geometry: THREE.BufferGeometry, b: number, rest: THREE.Vector3, color: THREE.Color, rot?: THREE.Euler) => {
      parts.push({ geometry: this.place(geometry, rest, rot), bone: b, color });
    };
    // Shell.
    add(ellipsoid(L * (crab ? 0.42 : 0.26), H * 0.35, L * (crab ? 0.32 : 0.5), 14), root, new THREE.Vector3(0, bodyY + H * 0.08, 0), look.coat);
    add(ellipsoid(L * (crab ? 0.38 : 0.22), H * 0.18, L * (crab ? 0.28 : 0.45), 12), root, new THREE.Vector3(0, bodyY - H * 0.08, 0), look.belly);
    add(ellipsoid(L * 0.12, H * 0.2, L * 0.12, 8), head, world[head], look.accent);
    for (const side of [-1, 1]) add(ellipsoid(0.03 * L, 0.03 * L, 0.03 * L, 6), head, world[head].clone().add(new THREE.Vector3(side * 0.07 * L, H * 0.18, -0.02 * L)), new THREE.Color(0.02, 0.02, 0.02));
    if (crab) {
      // Claws on the chest bone.
      for (const side of [-1, 1]) add(ellipsoid(L * 0.12, H * 0.13, L * 0.18, 8), chest, world[chest].clone().add(new THREE.Vector3(side * L * 0.32, 0, -L * 0.22)), look.accent);
    } else {
      // Beetle vent glow on the back.
      add(ellipsoid(L * 0.08, H * 0.05, L * 0.12, 8), root, new THREE.Vector3(0, bodyY + H * 0.42, L * 0.1), look.accent);
    }
    for (let i = 0; i < legCount; i += 1) {
      const upper = BONE.legs + i * 2;
      const lower = upper + 1;
      const side = i % 2 === 0 ? -1 : 1;
      const a = world[upper];
      const b = world[lower];
      parts.push({ geometry: segment(a, b, L * 0.035, L * 0.028, 5), bone: upper, color: look.coat.clone().multiplyScalar(0.8) });
      const tip = b.clone().add(new THREE.Vector3(side * L * 0.12, -H * 0.72, 0));
      parts.push({ geometry: segment(b, tip, L * 0.028, L * 0.01, 5), bone: lower, color: look.coat.clone().multiplyScalar(0.7) });
    }
    return this.finish(parts, bones, look, bodyY, legCount);
  }
}

export interface PoseState {
  /** Gait phase (radians) advanced by the caller with speed. */
  phase: number;
  /** 0 idle .. 1 full gallop. */
  gait: number;
  /** Head lowered to graze (0..1). */
  graze: number;
  /** Lunge/attack pose (0..1). */
  lunge: number;
  /** Death fall (0..1). */
  dead: number;
  /** Head turn toward something (radians, yaw). */
  look: number;
  time: number;
}

const tmpEuler = new THREE.Euler();

/** Poses a rig procedurally. */
export function poseCreature(rig: CreatureRig, s: PoseState): void {
  const b = rig.bones;
  const quad = rig.look.plan === 'quadruped';
  const gaitAmp = 0.35 + 0.35 * s.gait;
  const bob = Math.abs(Math.sin(s.phase)) * 0.04 * rig.look.height * (0.3 + s.gait);
  const breathe = Math.sin(s.time * 2.1) * 0.01;
  b[BONE.root].position.y = rig.rootHeight - bob * (s.dead > 0 ? 0 : 1) + breathe * rig.look.height;
  // Death: roll onto the side and settle.
  const fall = THREE.MathUtils.smoothstep(s.dead, 0, 1);
  b[BONE.root].rotation.set(-s.lunge * 0.12, 0, fall * 1.45);
  b[BONE.root].position.y -= fall * rig.rootHeight * 0.45;
  if (quad) {
    // Spine flex, neck and head.
    b[BONE.spine].rotation.x = Math.sin(s.phase * 2) * 0.03 * s.gait;
    b[BONE.chest].rotation.x = -Math.sin(s.phase * 2) * 0.04 * s.gait;
    const graze = s.graze * (1 - s.gait);
    tmpEuler.set(graze * 1.05 + s.lunge * -0.3 + Math.sin(s.time * 1.3) * 0.03, s.look * (1 - graze), 0);
    b[BONE.neck].rotation.copy(tmpEuler);
    b[BONE.head].rotation.set(graze * 0.4 - s.gait * 0.15, 0, 0);
    b[BONE.tail].rotation.set(Math.sin(s.time * 3.1) * 0.15 + s.gait * 0.4, Math.sin(s.time * 2.3) * 0.2, 0);
    // Legs: diagonal pairs (trot) blend toward a bounding gallop.
    const offsets = [0, Math.PI, Math.PI * (1 - 0.3 * s.gait), Math.PI * 0.3 * s.gait];
    for (let k = 0; k < 4; k += 1) {
      const ph = s.phase + offsets[k];
      const swing = Math.sin(ph) * gaitAmp * Math.min(1, s.gait * 3 + 0.001) * (s.dead > 0 ? 0.1 : 1);
      const lift = Math.max(0, Math.cos(ph)) * gaitAmp * 1.2 * Math.min(1, s.gait * 3);
      const upper = b[BONE.legs + k * 2];
      const lower = b[BONE.legs + k * 2 + 1];
      upper.rotation.x = swing + (k < 2 ? -s.lunge * 0.5 : s.lunge * 0.2) + fall * (k % 2 ? 0.6 : -0.3);
      lower.rotation.x = (k < 2 ? -1 : 1) * lift * 0.9;
    }
  } else {
    for (let i = 0; i < rig.legCount; i += 1) {
      const upper = b[BONE.legs + i * 2];
      const side = i % 2 === 0 ? -1 : 1;
      const ph = s.phase * 1.5 + (i % 2) * Math.PI + Math.floor(i / 2) * 1.3;
      upper.rotation.set(0, Math.sin(ph) * 0.35 * Math.min(1, s.gait * 3 + 0.05), side * Math.max(0, Math.cos(ph)) * 0.25 * Math.min(1, s.gait * 3));
    }
    b[BONE.chest].rotation.set(-s.lunge * 0.4, 0, 0);
  }
}
