import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The survivor's own right hand in first person: a gloved fist closed
// round a grip on the local Y axis. The back of the hand faces +X and the
// wrist runs back toward the camera (+Z) into a glove cuff and the coat
// sleeve. Fingers are jointed tubes wrapped round the grip with the
// knuckles standing proud; the thumb crosses over the index finger.

/** Radius of the grip the fist closes round. */
export const GRIP_R = 0.018;

/** Where the wrist is and which way the forearm runs from it. */
export const WRIST = new THREE.Vector3(0.032, -0.004, 0.084);
export const FOREARM = new THREE.Vector3(0.1, -0.42, 0.9).normalize();

/**
 * A tube along `path`: `radius(t, a)` at arc fraction t and angle a round
 * it, the cross-section squashed by `flat` along the reference direction
 * `ref(p)` (the back of a finger, the top of a wrist). A rounded cap closes
 * the far end when `cap` is set. UVs run in metres / `tile`.
 */
export function tube(
  path: THREE.Vector3[],
  radius: (t: number, a: number) => number,
  ref: (p: THREE.Vector3) => THREE.Vector3,
  opts: { sides?: number; steps?: number; flat?: number; cap?: boolean; tile?: number } = {},
): THREE.BufferGeometry {
  const sides = opts.sides ?? 10;
  const steps = opts.steps ?? 20;
  const flat = opts.flat ?? 1;
  const tile = opts.tile ?? 0.2;
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
  const length = curve.getLength();
  const rings: { p: THREE.Vector3; t: THREE.Vector3; r: number; along: number; u: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    rings.push({ p: curve.getPointAt(u), t: curve.getTangentAt(u), r: 1, along: u * length, u });
  }
  if (opts.cap) {
    const end = rings[rings.length - 1];
    const r0 = radius(1, 0);
    for (let k = 1; k <= 4; k += 1) {
      const s = k / 4;
      rings.push({ p: end.p.clone().addScaledVector(end.t, r0 * 0.85 * s), t: end.t, r: Math.sqrt(Math.max(0, 1 - s * s)), along: end.along + r0 * s, u: 1 });
    }
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const ring of rings) {
    n.copy(ref(ring.p));
    n.addScaledVector(ring.t, -n.dot(ring.t)).normalize();
    b.crossVectors(ring.t, n);
    for (let k = 0; k <= sides; k += 1) {
      const a = (k / sides) * Math.PI * 2;
      const r = radius(ring.u, a) * ring.r;
      pos.push(
        ring.p.x + (b.x * Math.cos(a) + n.x * Math.sin(a) * flat) * r,
        ring.p.y + (b.y * Math.cos(a) + n.y * Math.sin(a) * flat) * r,
        ring.p.z + (b.z * Math.cos(a) + n.z * Math.sin(a) * flat) * r,
      );
      uv.push(((k / sides) * Math.PI * 2 * radius(ring.u, 0)) / tile, ring.along / tile);
    }
  }
  for (let j = 0; j < rings.length - 1; j += 1) {
    for (let k = 0; k < sides; k += 1) {
      const a = j * (sides + 1) + k;
      const c = a + sides + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A rounded box (superellipsoid) with half extents `e`, blunter as `power` rises. */
function blob(e: THREE.Vector3, power: number, shape?: (v: THREE.Vector3) => void): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 24, 16);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  const f = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), 2 / power);
  for (let i = 0; i < pos.count; i += 1) {
    v.set(f(pos.getX(i)), f(pos.getY(i)), f(pos.getZ(i)));
    shape?.(v);
    pos.setXYZ(i, v.x * e.x, v.y * e.y, v.z * e.z);
  }
  g.computeVertexNormals();
  return g;
}

const polar = (r: number, phi: number, y: number) => new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
const outward = (p: THREE.Vector3) => new THREE.Vector3(p.x, 0, p.z);

/** One finger closed round the grip: joints on the wrap, straight bones between them. */
function finger(y: number, bones: [number, number, number], r: number): THREE.BufferGeometry {
  // Knuckle, middle joint, last joint, tip: each a little closer in.
  const radii = [0.034, 0.033, 0.0305, 0.0285];
  let phi = -0.28;
  const joints = [polar(radii[0], phi, y)];
  for (let i = 0; i < 3; i += 1) {
    const rp = radii[i];
    const rq = radii[i + 1];
    phi -= Math.acos(Math.min(1, (rp * rp + rq * rq - bones[i] * bones[i]) / (2 * rp * rq)));
    // The smaller fingers droop toward the wrist a touch as they close.
    joints.push(polar(rq, phi, y - (i + 1) * 0.0012));
  }
  const back = joints[0].clone().sub(joints[1]).normalize();
  const path = [joints[0].clone().addScaledVector(back, 0.014)];
  for (let i = 0; i < 3; i += 1) {
    // Keep the bones straight so the joints read as bends, not a curl.
    path.push(joints[i].clone());
    path.push(joints[i].clone().lerp(joints[i + 1], 0.2));
    path.push(joints[i].clone().lerp(joints[i + 1], 0.8));
  }
  path.push(joints[3]);
  // Arc fractions of the knuckles, for their bulge.
  const total = 0.014 + bones[0] + bones[1] + bones[2];
  const at = [0.014 / total, (0.014 + bones[0]) / total, (0.014 + bones[0] + bones[1]) / total];
  return tube(
    path,
    (t, a) => {
      let k = 1 - 0.2 * t;
      for (const j of at) k += 0.09 * Math.exp(-(((t - j) / 0.05) ** 2)) * Math.max(0, Math.sin(a));
      return r * k;
    },
    outward,
    { sides: 10, steps: 26, flat: 0.86, cap: true },
  );
}

export interface HandGeometry {
  /** The glove: palm, fingers, thumb and cuff. */
  glove: THREE.BufferGeometry;
  /** The coat sleeve with a knitted cuff at the wrist. */
  sleeve: THREE.BufferGeometry;
}

export function buildHand(): HandGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Index to little finger, top to bottom along the grip: bone lengths
  // (gloved) and thickness.
  const fingers: [number, [number, number, number], number][] = [
    [0.03, [0.045, 0.027, 0.021], 0.0112],
    [0.0085, [0.049, 0.03, 0.023], 0.0116],
    [-0.0125, [0.046, 0.028, 0.022], 0.011],
    [-0.0315, [0.037, 0.022, 0.019], 0.0098],
  ];
  for (const [y, bones, r] of fingers) parts.push(finger(y, bones, r));

  // Back of the hand: a slab from the knuckles back to the wrist, domed on
  // top and narrowing to the wrist.
  const palm = blob(new THREE.Vector3(0.017, 0.045, 0.052), 3, (v) => {
    const toWrist = Math.max(0, v.z);
    v.y *= 1 - 0.28 * toWrist;
    v.x *= 1 - 0.15 * toWrist;
    // The knuckle end bows round the grip.
    v.x += 0.12 * Math.max(0, -v.z) * (1 - v.y * v.y);
  });
  palm.translate(0.035, -0.001, 0.03);
  parts.push(palm);

  // The ball of the thumb, then the thumb itself over the index finger.
  const thenar = blob(new THREE.Vector3(0.016, 0.018, 0.027), 2.2);
  thenar.rotateY(-0.5);
  thenar.translate(0.014, 0.028, 0.045);
  parts.push(thenar);
  const thumbPath = [
    new THREE.Vector3(0.022, 0.028, 0.05),
    new THREE.Vector3(0.004, 0.038, 0.04),
    new THREE.Vector3(-0.015, 0.043, 0.03),
    new THREE.Vector3(-0.03, 0.044, 0.012),
    new THREE.Vector3(-0.037, 0.042, -0.004),
    new THREE.Vector3(-0.034, 0.039, -0.017),
  ];
  parts.push(
    tube(thumbPath, (t, a) => 0.0118 * (1 - 0.2 * t) * (1 + 0.07 * Math.exp(-(((t - 0.45) / 0.07) ** 2)) * Math.max(0, Math.sin(a))), (p) => new THREE.Vector3(p.x * 0.5, 1, p.z * 0.5), {
      sides: 10,
      steps: 24,
      flat: 0.85,
      cap: true,
    }),
  );

  // Glove cuff, flaring a little past the wrist.
  const side = () => new THREE.Vector3(1, 0, 0);
  const cuffPath = [WRIST.clone().addScaledVector(FOREARM, -0.012), WRIST.clone(), WRIST.clone().addScaledVector(FOREARM, 0.05)];
  parts.push(tube(cuffPath, (t) => 0.029 + 0.008 * t * t, side, { sides: 16, steps: 8, flat: 0.72 }));
  const glove = mergeGeometries(parts, false)!;

  // Sleeve: a knitted cuff round the glove's, then the coat, looser and
  // creased as it runs off screen.
  const sleeveParts: THREE.BufferGeometry[] = [];
  const knit = [WRIST.clone().addScaledVector(FOREARM, 0.036), WRIST.clone().addScaledVector(FOREARM, 0.075)];
  sleeveParts.push(tube(knit, (_t, a) => 0.039 * (1 + 0.025 * Math.cos(a * 22)), side, { sides: 44, steps: 3, flat: 0.8, tile: 0.6 }));
  const coatPath = [0.06, 0.2, 0.34, 0.5].map((s, i) => WRIST.clone().addScaledVector(FOREARM, s).add(new THREE.Vector3(0.006 * i, 0, 0)));
  sleeveParts.push(
    tube(coatPath, (t, a) => (0.046 + 0.022 * t) * (1 + 0.05 * Math.sin(a * 3 + t * 11) * Math.sin(t * 19 + a) + 0.03 * Math.sin(a * 5 - t * 7)), side, {
      sides: 20,
      steps: 16,
      flat: 0.84,
      tile: 0.6,
    }),
  );
  const sleeve = mergeGeometries(sleeveParts, false)!;
  return { glove, sleeve };
}
