import * as THREE from 'three';
import { createRng } from '../../core/rng';
import type { Person } from '../StoryData';

// A human head sculpted from a dense sphere. The base is an egg with a flat
// face, a jaw that narrows to the chin and a chin that comes forward; on it,
// anatomy is laid as smooth bumps and hollows measured in metres on the face
// plane (x across, y up, from the middle of the head): brow ridge, eye
// sockets, the nose from bridge to wings to nostrils, cheekbones, the mound
// of the mouth with its lips, philtrum and chin. The same functions paint
// the skin (see textures.ts), so colour always sits on the right anatomy.
//
// The head faces +z. The eyes are separate glossy balls in the sockets, with
// lid shells that close over them to blink; ears are shaped pillows at the
// sides; hair and beard are shells grown out of the same mesh.

/** Half width, half height (chin to crown ≈ 22.4 cm) and half depth of an adult head. */
export const HEAD_A = 0.074;
export const HEAD_B = 0.112;
export const HEAD_C = 0.1;
/** Eye centre on the face plane, and eyeball radius. */
export const EYE_X = 0.0312;
export const EYE_Y = 0.006;
export const EYE_R = 0.0121;
/** Where the mouth closes, and the nose tip, on the face plane. */
export const MOUTH_Y = -0.057;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const g = (v: number, s: number) => Math.exp(-(v * v) / (s * s));

type Face = Person['face'];

/** The head's base surface (before features) for a unit direction. */
export function headBase(dx: number, dy: number, dz: number, face: Face, out: THREE.Vector3): THREE.Vector3 {
  let x = dx * HEAD_A * face.width;
  let y = dy * HEAD_B;
  let z = dz * HEAD_C;
  // The back of the skull is fuller than the face.
  if (dz < 0) {
    z *= 1.04;
    x *= 1 + 0.06 * -dz * smooth(-0.4, 0.3, dy);
  } else {
    // A face is flatter across than an egg: square the front a little.
    const hr = Math.hypot(dx, dz);
    if (hr > 1e-5) {
      const c = Math.abs(dx / hr);
      const s = Math.abs(dz / hr);
      const n = 2.35;
      const k = 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n);
      x *= k;
      z *= k;
    }
  }
  // Below the cheekbones the face narrows to the jaw and the chin; the
  // back of the lower head tucks in toward the neck.
  const low = smooth(0.05, -0.9, dy);
  const front = smooth(-0.2, 0.6, dz);
  x *= 1 - low * (0.24 - 0.12 * face.jaw) * (0.55 + 0.45 * front);
  x *= 1 - smooth(-0.35, -0.95, dy) * smooth(0.25, -0.55, dz) * 0.3;
  // The jaw's corner stands out below the ear.
  x *= 1 + 0.08 * face.jaw * g(dy + 0.62, 0.18) * g(dz - 0.05, 0.35);
  // The chin comes forward, under the mouth.
  z += 0.03 * smooth(-0.25, -0.82, dy) * smooth(0.05, 0.55, dz);
  // The crown sits a little back and flatter.
  y *= 1 - 0.05 * smooth(0.55, 1, dy);
  z -= 0.008 * smooth(0.45, 1, dy);
  return out.set(x, y, z);
}

/** The nose, from the bridge between the eyes down to the nostrils. */
function noseDepth(fx: number, fy: number, k: number): number {
  const ax = Math.abs(fx);
  const top = 0.008;
  const tip = -0.029 * k;
  const base = -0.041 * k;
  let prof = 0;
  let width = 0.006;
  if (fy <= top && fy >= tip) {
    const t = (top - fy) / (top - tip);
    prof = 0.0015 + 0.0195 * k * Math.pow(t, 1.15);
    width = 0.0055 + 0.0045 * t;
  } else if (fy < tip) {
    const t = Math.min(1, (tip - fy) / (tip - base + 0.004));
    prof = 0.021 * k * Math.pow(1 - t, 1.6);
    width = 0.0098 - 0.002 * t;
  } else {
    prof = 0.0015 * g(fy - top, 0.006);
  }
  let d = prof * g(fx, width);
  // The rounded tip, the wings either side and the nostrils beneath.
  d += 0.0035 * k * g(fx, 0.0085) * g(fy - tip, 0.0065);
  d += 0.0065 * g(ax - 0.0128 * k, 0.0058) * g(fy - (tip - 0.0065), 0.0062);
  d -= 0.0045 * g(ax - 0.0062, 0.0028) * g(fy - (base + 0.0015), 0.0022);
  return d;
}

/** Lips on the mound of the mouth, with a cupid's bow, the philtrum and the line between. */
function lipsDepth(fx: number, fy: number, full: number): number {
  const ax = Math.abs(fx);
  const half = 0.0215 + 0.0025 * full;
  const across = 1 - smooth(half * 0.72, half, ax);
  const bow = 0.0011 * g(ax - 0.0055, 0.004) - 0.0007 * g(fx, 0.0028);
  let d = 0;
  d += (0.0017 + 0.0013 * full) * g(fy - (MOUTH_Y + 0.0042 + bow), 0.003 + 0.0006 * full) * across;
  d += (0.0022 + 0.0016 * full) * g(fy - (MOUTH_Y - 0.0052), 0.0038 + 0.0008 * full) * across;
  d -= 0.0038 * g(fy - MOUTH_Y, 0.0011) * (1 - smooth(half * 0.9, half * 1.05, ax));
  // The philtrum's groove, from the nose down to the bow.
  d -= 0.0011 * g(fx, 0.0034) * smooth(-0.046, -0.049, fy) * smooth(MOUTH_Y + 0.004, MOUTH_Y + 0.008, fy);
  return d;
}

/** Nasolabial fold: distance from the crease running nose-wing to mouth-corner. */
function foldDistance(fx: number, fy: number): number {
  const ax = Math.abs(fx);
  const ax0 = 0.0175;
  const ay0 = -0.036;
  const bx = 0.029;
  const by = -0.066;
  const vx = bx - ax0;
  const vy = by - ay0;
  const t = Math.min(1, Math.max(0, ((ax - ax0) * vx + (fy - ay0) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(ax - (ax0 + vx * t), fy - (ay0 + vy * t));
}

/** Almond of the open eye (1 inside), around the eye centre, grown by `grow` metres. */
export function eyeOpening(ex: number, ey: number, grow = 0): number {
  const halfW = 0.0142 + grow;
  const t = Math.min(1, Math.abs(ex) / halfW);
  // Upper lid arches higher toward the nose side; the lower lid is shallower.
  const upper = (0.0046 + grow) * Math.pow(Math.cos((t * Math.PI) / 2), 0.75) + 0.0006 * (ex < 0 ? 1 : 0);
  const lower = -(0.0045 + grow) * Math.pow(Math.cos((t * Math.PI) / 2), 0.9);
  if (t >= 1) return 0;
  return smooth(upper + 0.0008, upper - 0.0008, ey) * smooth(lower - 0.0008, lower + 0.0008, ey);
}

/**
 * Outward displacement of the face at (fx, fy) on the face plane. With
 * `sockets` false the hollows round the eyes are left out (the plane the
 * eyeballs are set against).
 */
export function faceDepth(fx: number, fy: number, p: Person, sockets = true): number {
  const face = p.face;
  const ax = Math.abs(fx);
  const male = p.sex === 'm' ? 1 : 0;
  const lean = 1 - p.build;
  let d = 0;
  // Brow ridge: a soft shelf over the eyes, heavier with age and in men.
  d += (0.0022 + 0.0035 * face.brow + 0.0012 * male) * g(fy - 0.023, 0.0085) * (1 - smooth(0.04, 0.062, ax));
  // Forehead dome and the glabella between the brows.
  d += 0.0022 * g(fx, 0.032) * g(fy - 0.052, 0.03);
  if (sockets) {
    // Eye sockets, and the eye's own almond pushed back to show the ball.
    d -= 0.0095 * g(ax - EYE_X, 0.0165) * g(fy - (EYE_Y - 0.0015), 0.0125);
    const ex = (fx < 0 ? -1 : 1) * (ax - EYE_X);
    d -= 0.014 * eyeOpening(ex, fy - EYE_Y, 0.0026);
  }
  d += noseDepth(fx, fy, face.nose);
  // Cheekbones, and the hollow beneath them in leaner, older faces.
  d += (0.0026 + 0.0038 * face.cheek) * g(ax - 0.046, 0.018) * g(fy + 0.013, 0.016);
  d -= (0.0012 + 0.0025 * lean + 0.00004 * p.age) * g(ax - 0.045, 0.012) * g(fy + 0.043, 0.013);
  // The mouth sits on a rounded mound; lips on it.
  d += 0.0065 * g(fx, 0.03) * g(fy - (MOUTH_Y - 0.002), 0.022);
  d += lipsDepth(fx, fy, face.lips);
  // Lines from the nose wings to the mouth corners, deeper with age.
  d -= (0.0005 + 0.00003 * p.age) * g(foldDistance(fx, fy), 0.0026) * (1 - smooth(0.018, 0.03, Math.abs(fy + 0.051)));
  // Chin, and the dip between it and the lower lip.
  d += (0.0035 + 0.0045 * face.jaw) * g(fx, 0.0165 + 0.004 * face.jaw) * g(fy + 0.094, 0.011);
  d -= 0.0024 * g(fx, 0.018) * g(fy + 0.076, 0.0042);
  // Temples.
  d -= 0.0038 * g(ax - 0.066, 0.012) * g(fy - 0.03, 0.02);
  return d;
}

/** Masks the skin painter uses, at a point on the face plane (front only). */
export function faceMasks(fx: number, fy: number, p: Person): { lips: number; lipLine: number; nostril: number; blush: number; brow: number; lid: number; fold: number; beard: number; crow: number } {
  const ax = Math.abs(fx);
  const face = p.face;
  const half = 0.0215 + 0.0025 * face.lips;
  const across = 1 - smooth(half * 0.8, half * 1.02, ax);
  const bow = 0.0011 * g(ax - 0.0055, 0.004) - 0.0007 * g(fx, 0.0028);
  // Lips are fullest in the middle and thin out to the corners.
  const taper = 0.2 + 0.8 * Math.sqrt(Math.max(0, 1 - (ax / half) ** 2));
  const lipTop = MOUTH_Y + (0.0068 + 0.0014 * face.lips) * taper + bow;
  const lipBot = MOUTH_Y - (0.0085 + 0.002 * face.lips) * taper;
  const lips = across * smooth(lipTop + 0.0008, lipTop - 0.0006, fy) * smooth(lipBot - 0.0008, lipBot + 0.0006, fy);
  const lipLine = g(fy - MOUTH_Y, 0.0009) * (1 - smooth(half * 0.85, half * 1.08, ax));
  const tip = -0.029 * face.nose;
  const base = -0.041 * face.nose;
  const nostril = g(ax - 0.0062, 0.0026) * g(fy - (base + 0.0012), 0.0019);
  const blush = g(ax - 0.042, 0.02) * g(fy + 0.02, 0.018) * 0.8 + g(fx, 0.009) * g(fy - tip, 0.008) * 0.6;
  // Eyebrows: an arch over each eye, thickest toward the nose.
  const bx = ax - EYE_X;
  const archY = 0.0205 + 0.004 * Math.cos(Math.min(1, Math.abs(bx + 0.002) / 0.021) * (Math.PI / 2)) - 0.0035 * smooth(0.004, 0.02, bx);
  const browW = 0.0032 * (1 - smooth(-0.006, 0.02, bx) * 0.55);
  const brow = smooth(-0.021, -0.016, bx) * (1 - smooth(0.016, 0.022, bx)) * g(fy - archY, browW);
  // Upper lid and the soft shadow round the eye.
  const lid = g(ax - EYE_X, 0.014) * g(fy - (EYE_Y + 0.005), 0.007);
  const fold = g(foldDistance(fx, fy), 0.0022) * (1 - smooth(0.018, 0.03, Math.abs(fy + 0.051)));
  // Crow's feet at the outer corners.
  const crow = g(ax - (EYE_X + 0.019), 0.005) * g(fy - EYE_Y, 0.009);
  // Where a beard grows: jaw, chin and upper lip, not the lips or cheeks.
  // Below the cheek line at the sides, below the nose in the middle; the
  // lips and the skin just under them stay bare.
  const cheekLine = -0.03 - 0.016 * g(fx, 0.022);
  const bare = g(fx, 0.012) * smooth(MOUTH_Y + 0.004, MOUTH_Y - 0.002, fy) * smooth(MOUTH_Y - 0.016, MOUTH_Y - 0.01, fy);
  const beard = smooth(cheekLine + 0.003, cheekLine - 0.005, fy) * (1 - Math.min(1, lips * 1.4)) * (1 - bare);
  return { lips, lipLine, nostril, blush, brow, lid, fold, beard, crow };
}

/**
 * Both eyes' lids and lashes as one mesh, `blink` 0 open .. 1 shut. The
 * topology never changes, so a blink only rewrites positions and normals.
 */
export function buildEyelids(eyes: THREE.Vector3[], blink: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const e of eyes) parts.push(buildLids(e, blink), buildLashes(e, blink));
  for (const part of parts) {
    whiten(part);
    mapToHeadUv(part);
  }
  return mergeParts(parts);
}

/** White vertex colour (the skin material multiplies by it), unless already set. */
function whiten(part: THREE.BufferGeometry): void {
  if (!part.getAttribute('color')) part.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(part.getAttribute('position').count * 3).fill(1), 3));
}

/** Head sphere resolution (around, top to bottom). */
const SEG_U = 160;
const SEG_V = 120;

export interface HeadParts {
  skin: THREE.BufferGeometry;
  /** Eyeball centres (head frame): [left, right] as seen by the person. */
  eyes: THREE.Vector3[];
  eyeball: THREE.BufferGeometry;
  hair: THREE.BufferGeometry | null;
  beard: THREE.BufferGeometry | null;
}

/** The direction on the unit sphere for a head-texture texel (u, v in 0..1). */
export function headTexelDirection(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  // Matches SphereGeometry with phiStart -π/2: the seam at the back, the face at u = 0.5.
  const phi = -Math.PI / 2 + u * Math.PI * 2;
  const theta = Math.PI * (1 - v);
  return out.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

/** Where the hair grows on the scalp (1 inside), for a unit direction. */
export function hairRegion(dx: number, dy: number, dz: number, style: Person['hair']['style']): number {
  // Front hairline over the forehead, dipping at the temples; round the
  // ears; down the nape at the back.
  const front = smooth(0.1, 0.5, dz);
  const side = 1 - Math.abs(dz);
  const hairline = 0.55 * front + (0.12 - 0.05 * side) * (1 - front) - 0.42 * smooth(0.1, -0.5, dz);
  let r = smooth(hairline - 0.05, hairline + 0.05, dy);
  // Keep the ears clear.
  r *= 1 - g(dy + 0.05, 0.16) * g(dz + 0.02, 0.2) * smooth(0.75, 0.95, Math.abs(dx));
  if (style === 'balding') {
    // A horseshoe round the sides and back; the crown is bare.
    r *= 1 - smooth(0.35, 0.6, dy) * smooth(-0.55, 0.1, dz);
    r *= 1 - smooth(0.55, 0.75, dy);
  }
  return r;
}

/**
 * Sculpt the head for `person`: the skin (head, lids, ears), the eyeballs
 * and, where they grow, hair and beard shells.
 */
export function buildHead(p: Person): HeadParts {
  const rng = createRng(p.seed * 7919 + 17);
  const geo = new THREE.SphereGeometry(1, SEG_U, SEG_V, -Math.PI / 2, Math.PI * 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const base = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const n = pos.count;
  const dirs = new Float32Array(n * 3);
  // A slight asymmetry, as no face is a mirror.
  const tilt = (rng() - 0.5) * 0.004;
  for (let i = 0; i < n; i += 1) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    dirs.set([dir.x, dir.y, dir.z], i * 3);
    headBase(dir.x, dir.y, dir.z, p.face, base);
    const front = smooth(0.12, 0.5, dir.z);
    if (front > 0) {
      const fx = base.x * (1 + tilt * Math.sign(base.x));
      base.addScaledVector(dir, faceDepth(fx, base.y, p) * front);
    }
    pos.setXYZ(i, base.x, base.y, base.z);
  }
  geo.computeVertexNormals();
  weldSeam(geo);

  // The eyeballs sit behind the natural face plane, their fronts 3.5 mm in.
  const eyes: THREE.Vector3[] = [];
  for (const side of [1, -1]) {
    const dx = (side * EYE_X) / HEAD_A;
    const dy = EYE_Y / HEAD_B;
    headBase(dx, dy, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)), p.face, base);
    const zFace = base.z + faceDepth(side * EYE_X, EYE_Y, p, false);
    eyes.push(new THREE.Vector3(side * EYE_X, EYE_Y, zFace - 0.0035 - EYE_R));
  }

  const parts: THREE.BufferGeometry[] = [geo];
  for (const side of [1, -1]) parts.push(buildEar(p, side));
  for (const part of parts) whiten(part);
  // Ears take the skin texture where they sit on the head.
  for (const part of parts.slice(1)) mapToHeadUv(part);
  const skin = mergeParts(parts);

  const hair = p.hair.style === 'crop' && p.face ? growShell(geo, dirs, (d) => hairRegion(d[0], d[1], d[2], p.hair.style), 0.004, 0) : growShell(geo, dirs, (d) => hairRegion(d[0], d[1], d[2], p.hair.style), hairThickness(p), p.hair.style === 'coils' ? 0.0025 : 0.0008);
  const beard = p.beard > 0.05 ? growShell(geo, dirs, (d) => beardRegion(d, p), 0.004 + 0.007 * p.beard, 0.0012) : null;

  const eyeball = new THREE.SphereGeometry(EYE_R, 40, 28);
  // Pole forward: the iris sits round the +z pole; the cornea bulges.
  eyeball.rotateX(Math.PI / 2);
  const ep = eyeball.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < ep.count; i += 1) {
    dir.set(ep.getX(i), ep.getY(i), ep.getZ(i)).normalize();
    const a = Math.acos(Math.min(1, dir.z));
    const bulge = 0.0009 * Math.pow(Math.max(0, Math.cos((a / 0.52) * (Math.PI / 2))), 1.5) * (a < 0.52 ? 1 : 0);
    ep.setXYZ(i, dir.x * (EYE_R + bulge), dir.y * (EYE_R + bulge), dir.z * (EYE_R + bulge));
  }
  eyeball.computeVertexNormals();
  return { skin, eyes, eyeball, hair, beard };
}

function hairThickness(p: Person): number {
  if (p.hair.style === 'coils') return 0.014;
  if (p.hair.style === 'bun') return 0.006;
  if (p.hair.style === 'balding') return 0.0035;
  return 0.005;
}

function beardRegion(d: ArrayLike<number>, p: Person): number {
  if (d[2] < -0.35) return 0;
  const base = headBase(d[0], d[1], d[2], p.face, new THREE.Vector3());
  const m = faceMasks(base.x, base.y, p);
  // Round the jaw toward the ears as well as over the chin.
  // (The front of the face is left to the mask above; this is the sides.)
  const jaw = smooth(-0.15, -0.5, d[1]) * smooth(-0.35, 0.05, d[2]) * smooth(0.72, 0.42, d[2]);
  return Math.max(m.beard * smooth(0.05, 0.35, d[2]), jaw) * p.beard;
}

/** Average the normals across the sphere's back seam so it does not show. */
function weldSeam(geo: THREE.BufferGeometry): void {
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let iy = 0; iy <= SEG_V; iy += 1) {
    const a = iy * (SEG_U + 1);
    const b = a + SEG_U;
    const x = nrm.getX(a) + nrm.getX(b);
    const y = nrm.getY(a) + nrm.getY(b);
    const z = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(a, x / l, y / l, z / l);
    nrm.setXYZ(b, x / l, y / l, z / l);
  }
}

/**
 * A shell grown out of the head where `region` says (hair, beard): each
 * vertex pushed out along its normal by up to `thickness`, tucked under the
 * skin elsewhere; triangles wholly outside are dropped. `noise` roughens it.
 */
function growShell(head: THREE.BufferGeometry, dirs: Float32Array, region: (d: ArrayLike<number>) => number, thickness: number, noise: number): THREE.BufferGeometry | null {
  const src = head.getAttribute('position') as THREE.BufferAttribute;
  const nrm = head.getAttribute('normal') as THREE.BufferAttribute;
  const uv = head.getAttribute('uv') as THREE.BufferAttribute;
  const count = src.count;
  const w = new Float32Array(count);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const d = dirs.subarray(i * 3, i * 3 + 3);
    w[i] = region(d);
    const bump = noise * (Math.sin(d[0] * 180 + d[1] * 97) * Math.sin(d[2] * 150 - d[1] * 60) * 0.5 + Math.sin(d[0] * 460 + d[2] * 380) * 0.5);
    const t = w[i] > 0.02 ? thickness * Math.pow(w[i], 0.6) + bump * w[i] : -0.002;
    out[i * 3] = src.getX(i) + nrm.getX(i) * t;
    out[i * 3 + 1] = src.getY(i) + nrm.getY(i) * t;
    out[i * 3 + 2] = src.getZ(i) + nrm.getZ(i) * t;
  }
  const index = head.getIndex() as THREE.BufferAttribute;
  const keep: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const a = index.getX(k);
    const b = index.getX(k + 1);
    const c = index.getX(k + 2);
    if (w[a] > 0.02 || w[b] > 0.02 || w[c] > 0.02) keep.push(a, b, c);
  }
  if (keep.length === 0) return null;
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g2.setAttribute('uv', uv.clone());
  g2.setIndex(keep);
  g2.computeVertexNormals();
  return g2;
}

/**
 * Upper and lower lids round an eyeball: shells just larger than the ball,
 * cut to the almond of the open eye, with a rounded margin that touches the
 * ball. `blink` (0 open .. 1 shut) brings the upper margin down.
 */
export function buildLids(eye: THREE.Vector3, blink: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = 28;
  const R = EYE_R + 0.0016;
  const inner = EYE_R + 0.0003;
  const addLid = (upper: boolean) => {
    const start = pos.length / 3;
    const rows = 7;
    for (let c = 0; c <= cols; c += 1) {
      const a = (-0.5 + c / cols) * 1.9 * (Math.PI / 2); // round the ball, corner to corner
      const ca = Math.pow(Math.cos(a / 1.05), 0.75);
      const open = upper ? 0.34 * ca : -0.3 * Math.pow(Math.cos(a / 1.05), 0.85);
      const shut = -0.05 * ca;
      const margin = upper ? open + (shut - open) * blink : open;
      const far = upper ? 1.3 : -1.15;
      for (let r = 0; r <= rows; r += 1) {
        // Row 0 is the inner lip against the ball; then out and over.
        const t = r / rows;
        const el = r === 0 ? margin : margin + (far - margin) * Math.pow((r - 0.6) / (rows - 0.6), 1.3);
        const rad = r === 0 ? inner : R + 0.0012 * Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.6;
        const cx = Math.sin(a) * Math.cos(el);
        const cy = Math.sin(el);
        const cz = Math.cos(a) * Math.cos(el);
        pos.push(eye.x + cx * rad * (eye.x < 0 ? -1 : 1), eye.y + cy * rad, eye.z + cz * rad);
      }
    }
    const ring = rows + 1;
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const a = start + c * ring + r;
        const b = a + ring;
        if (upper === (eye.x < 0)) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  };
  addLid(true);
  addLid(false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A dark lash line along the upper lid margin, sweeping out and up. */
export function buildLashes(eye: THREE.Vector3, blink: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = 20;
  const R = EYE_R + 0.0017;
  for (let c = 0; c <= cols; c += 1) {
    const a = (-0.5 + c / cols) * 1.75 * (Math.PI / 2);
    const ca = Math.pow(Math.cos(a / 1.05), 0.75);
    const open = 0.34 * ca;
    const el = open + (-0.05 * ca - open) * blink;
    const len = 0.0045 * (0.4 + 0.6 * Math.sin((c / cols) * Math.PI)) + 0.0015;
    const sx = eye.x < 0 ? -1 : 1;
    const bx = Math.sin(a) * Math.cos(el);
    const by = Math.sin(el);
    const bz = Math.cos(a) * Math.cos(el);
    pos.push(eye.x + bx * R * sx, eye.y + by * R, eye.z + bz * R);
    // Out along the surface normal, curling up.
    pos.push(eye.x + bx * (R + len * 0.8) * sx, eye.y + by * R + len * 0.75, eye.z + bz * (R + len * 0.8));
  }
  for (let c = 0; c < cols; c += 1) {
    const a = c * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Near-black: vertex colour multiplies the skin.
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0.05), 3));
  return geo;
}

/** An ear: a shaped pillow with a raised rim and a hollow bowl, set at the side of the head. */
function buildEar(p: Person, side: number): THREE.BufferGeometry {
  const ear = new THREE.SphereGeometry(1, 22, 18);
  const e = ear.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < e.count; i += 1) {
    const x = e.getX(i);
    const y = e.getY(i);
    const z = e.getZ(i);
    // Outline: taller than wide, the lobe narrower below.
    const width = 0.017 * (1 - 0.25 * smooth(0, -0.9, y));
    const outward = x > 0;
    const rr = Math.hypot(y, z);
    let t = outward ? 0.0045 : 0.002;
    if (outward) {
      // A raised rim (helix) round the edge and a hollow bowl (concha).
      t += 0.0035 * smooth(0.6, 0.85, rr) * (1 - smooth(0.92, 1, rr));
      t -= 0.004 * g(y + 0.05, 0.35) * g(z + 0.1, 0.3);
    }
    e.setXYZ(i, x * t, y * 0.031, z * width + 0.004 * y);
  }
  ear.computeVertexNormals();
  // Stand the ear out from the head, tilted back, at the side.
  ear.rotateZ(-0.12);
  ear.rotateY(side * 0.35);
  ear.rotateX(-0.2);
  if (side < 0) ear.scale(-1, 1, 1);
  const x = side * HEAD_A * p.face.width * 0.99;
  ear.translate(x, -0.012, -0.006);
  // Mirrored geometry flips its winding; flip it back.
  if (side < 0) flipWinding(ear);
  return ear;
}

function flipWinding(geo: THREE.BufferGeometry): void {
  const index = geo.getIndex();
  if (!index) return;
  for (let k = 0; k < index.count; k += 3) {
    const b = index.getX(k + 1);
    index.setX(k + 1, index.getX(k + 2));
    index.setX(k + 2, b);
  }
  geo.computeVertexNormals();
}

/** Give a part UVs into the head texture, from its direction off the head's centre. */
function mapToHeadUv(part: THREE.BufferGeometry): void {
  const pos = part.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) / HEAD_A;
    const y = pos.getY(i) / HEAD_B;
    const z = pos.getZ(i) / HEAD_C;
    const l = Math.hypot(x, y, z) || 1;
    const theta = Math.acos(Math.max(-1, Math.min(1, y / l)));
    let phi = Math.atan2(z / l, -x / l);
    // phi runs from -π/2 (back) round to 3π/2.
    if (phi < -Math.PI / 2) phi += Math.PI * 2;
    uv[i * 2] = (phi + Math.PI / 2) / (Math.PI * 2);
    uv[i * 2 + 1] = 1 - theta / Math.PI;
  }
  part.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

/** Merge indexed parts that share position, normal, uv and color. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color'];
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    vertices += p.getAttribute('position').count;
    indices += p.getIndex()?.count ?? 0;
  }
  const out = new THREE.BufferGeometry();
  const idx = new Uint32Array(indices);
  const data: Record<string, Float32Array> = {};
  const sizes: Record<string, number> = { position: 3, normal: 3, uv: 2, color: 3 };
  for (const n of names) data[n] = new Float32Array(vertices * sizes[n]);
  let v0 = 0;
  let i0 = 0;
  for (const p of parts) {
    const count = p.getAttribute('position').count;
    for (const n of names) {
      const attr = p.getAttribute(n) as THREE.BufferAttribute;
      const size = sizes[n];
      for (let i = 0; i < count; i += 1) for (let k = 0; k < size; k += 1) data[n][(v0 + i) * size + k] = attr.array[i * attr.itemSize + k] as number;
    }
    const index = p.getIndex() as THREE.BufferAttribute;
    for (let k = 0; k < index.count; k += 1) idx[i0 + k] = index.getX(k) + v0;
    v0 += count;
    i0 += index.count;
  }
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(data[n], sizes[n]));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
