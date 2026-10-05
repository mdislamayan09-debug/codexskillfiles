// Signed-distance sculpting: smooth-union primitives -> surface nets mesh -> skin weights per bone.
// Used to build organic, seamless horses and people that deform on a skeleton.
import * as THREE from 'three';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Round cone between a and b with radii ra, rb (iq). Points are plain [x,y,z].
function sdRoundCone(px, py, pz, P) {
  const { ax, ay, az, bax, bay, baz, l2, rr, a2, il2, ra, rb } = P;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
}

export function roundCone(a, b, ra, rb, opts = {}) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  return {
    type: 'cone', P: { ax: a[0], ay: a[1], az: a[2], bax, bay, baz, l2, rr, a2, il2: 1 / l2, ra, rb },
    min: [Math.min(a[0] - ra, b[0] - rb), Math.min(a[1] - ra, b[1] - rb), Math.min(a[2] - ra, b[2] - rb)],
    max: [Math.max(a[0] + ra, b[0] + rb), Math.max(a[1] + ra, b[1] + rb), Math.max(a[2] + ra, b[2] + rb)],
    ...opts,
  };
}
// Ellipsoid centred at c with radii r=[rx,ry,rz] (approximate distance).
export function ellipsoid(c, r, opts = {}) {
  return { type: 'ell', c, r, min: [c[0] - r[0], c[1] - r[1], c[2] - r[2]], max: [c[0] + r[0], c[1] + r[1], c[2] + r[2]], ...opts };
}
// Rounded box (axis aligned) centre c half-size h, rounding rad.
export function rbox(c, h, rad, opts = {}) {
  return { type: 'box', c, h, rad, min: [c[0] - h[0] - rad, c[1] - h[1] - rad, c[2] - h[2] - rad], max: [c[0] + h[0] + rad, c[1] + h[1] + rad, c[2] + h[2] + rad], ...opts };
}
// Flat disc (hat brims) centre c, radius r, half thickness t, with curl function
export function disc(c, r, t, opts = {}) {
  return { type: 'disc', c, r, t, min: [c[0] - r - t, c[1] - 0.06, c[2] - r - t], max: [c[0] + r + t, c[1] + 0.06, c[2] + r + t], ...opts };
}

function evalPrim(p, x, y, z) {
  switch (p.type) {
    case 'cone': return sdRoundCone(x, y, z, p.P);
    case 'ell': {
      const qx = (x - p.c[0]) / p.r[0], qy = (y - p.c[1]) / p.r[1], qz = (z - p.c[2]) / p.r[2];
      const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
      const k1 = Math.sqrt((qx / p.r[0]) ** 2 + (qy / p.r[1]) ** 2 + (qz / p.r[2]) ** 2);
      return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...p.r);
    }
    case 'box': {
      const qx = Math.abs(x - p.c[0]) - p.h[0], qy = Math.abs(y - p.c[1]) - p.h[1], qz = Math.abs(z - p.c[2]) - p.h[2];
      const o = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return o + Math.min(Math.max(qx, qy, qz), 0) - p.rad;
    }
    case 'disc': {
      const dx = x - p.c[0], dz = z - p.c[2];
      const rad = Math.hypot(dx, dz);
      const yy = y - p.c[1] - (p.curl ? p.curl(dx, dz, rad) : 0);
      const qx = rad - p.r, qy = Math.abs(yy) - p.t;
      return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    }
  }
  return 1e9;
}

const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
};

// Field: primitives each carry {blend (k), sub (subtract), label, bone}
export function fieldAt(prims, x, y, z, margin) {
  let d = 1e9;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    if (x < p.min[0] - margin || y < p.min[1] - margin || z < p.min[2] - margin || x > p.max[0] + margin || y > p.max[1] + margin || z > p.max[2] + margin) {
      if (!p.sub) continue;
      continue;
    }
    const v = evalPrim(p, x, y, z) + (p.bump ? p.bump(x, y, z) : 0);
    if (p.sub) d = Math.max(d, -v);
    else d = smin(d, v, p.blend ?? 0.03);
  }
  return d;
}

// Surface nets polygonisation of the field within [min,max] at cell size h.
export function sculpt(prims, { cell = 0.02, pad = 0.04 } = {}) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of prims) if (!p.sub) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.min[k]); mx[k] = Math.max(mx[k], p.max[k]); }
  for (let k = 0; k < 3; k++) { mn[k] -= pad; mx[k] += pad; }
  const nx = Math.ceil((mx[0] - mn[0]) / cell) + 1, ny = Math.ceil((mx[1] - mn[1]) / cell) + 1, nz = Math.ceil((mx[2] - mn[2]) / cell) + 1;
  const F = new Float32Array(nx * ny * nz);
  const margin = 0.08;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    F[(k * ny + j) * nx + i] = fieldAt(prims, mn[0] + i * cell, mn[1] + j * cell, mn[2] + k * cell, margin);
  }
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  const vIndex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[idx(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; if (v[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
      n++;
    }
    vIndex[cidx(i, j, k)] = pos.length / 3;
    pos.push(mn[0] + (i + sx / n) * cell, mn[1] + (j + sy / n) * cell, mn[2] + (k + sz / n) * cell);
  }
  const index = [];
  // quads for each sign-changing grid edge
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[idx(i, j, k)] < 0;
    // x edge
    if (i < nx - 1 && a !== (F[idx(i + 1, j, k)] < 0)) {
      const q = [cidx(i, j - 1, k - 1), cidx(i, j, k - 1), cidx(i, j, k), cidx(i, j - 1, k)].map((c) => vIndex[c]);
      if (q.every((x) => x >= 0)) a ? index.push(q[0], q[1], q[2], q[0], q[2], q[3]) : index.push(q[0], q[2], q[1], q[0], q[3], q[2]);
    }
    if (j < ny - 1 && a !== (F[idx(i, j + 1, k)] < 0)) {
      const q = [cidx(i - 1, j, k - 1), cidx(i, j, k - 1), cidx(i, j, k), cidx(i - 1, j, k)].map((c) => vIndex[c]);
      if (q.every((x) => x >= 0)) a ? index.push(q[0], q[2], q[1], q[0], q[3], q[2]) : index.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
    if (k < nz - 1 && a !== (F[idx(i, j, k + 1)] < 0)) {
      const q = [cidx(i - 1, j - 1, k), cidx(i, j - 1, k), cidx(i, j, k), cidx(i - 1, j, k)].map((c) => vIndex[c]);
      if (q.every((x) => x >= 0)) a ? index.push(q[0], q[1], q[2], q[0], q[2], q[3]) : index.push(q[0], q[2], q[1], q[0], q[3], q[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  // normals from the field gradient (smooth, independent of mesh topology)
  const nrm = new Float32Array(pos.length);
  const e = cell * 0.5;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    let gx = fieldAt(prims, x + e, y, z, margin) - fieldAt(prims, x - e, y, z, margin);
    let gy = fieldAt(prims, x, y + e, z, margin) - fieldAt(prims, x, y - e, z, margin);
    let gz = fieldAt(prims, x, y, z + e, margin) - fieldAt(prims, x, y, z - e, margin);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[i] = gx / l; nrm[i + 1] = gy / l; nrm[i + 2] = gz / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// Label each vertex with the nearest primitive's label (material slot) and compute skin weights from
// distances to primitives grouped by bone.
export function labelAndSkin(geo, prims, { boneCount = 0, sharpness = 0.025, palette = null } = {}) {
  const p = geo.attributes.position;
  const n = p.count;
  const color = new Float32Array(n * 3);
  const label = new Float32Array(n);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const solid = prims.filter((q) => !q.sub);
  const boneD = new Float32Array(Math.max(1, boneCount));
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let best = 1e9, bl = 0, bp = null;
    boneD.fill(1e9);
    for (const q of solid) {
      const d = evalPrim(q, x, y, z) - (q.labelBias || 0);
      if (d < best) { best = d; bl = q.label || 0; bp = q; }
      if (boneCount && q.bone !== undefined && d < boneD[q.bone]) boneD[q.bone] = d;
    }
    label[i] = bl;
    if (palette) {
      const c = palette[bl] || [1, 0, 1];
      color[i * 3] = c[0]; color[i * 3 + 1] = c[1]; color[i * 3 + 2] = c[2];
    }
    if (boneCount) {
      // top 2 bones by distance, softmax weights
      let b0 = 0, b1 = 0, d0 = 1e9, d1 = 1e9;
      for (let b = 0; b < boneCount; b++) {
        const d = boneD[b];
        if (d < d0) { d1 = d0; b1 = b0; d0 = d; b0 = b; } else if (d < d1) { d1 = d; b1 = b; }
      }
      // rigid override (e.g. hooves/hat) keeps a single bone
      let w0 = 1, w1 = 0;
      if (bp && !bp.rigid && d1 < 1e8) {
        const e0 = Math.exp(-(d0 - d0) / sharpness), e1 = Math.exp(-(d1 - d0) / sharpness);
        w0 = e0 / (e0 + e1); w1 = e1 / (e0 + e1);
      } else if (bp && bp.rigid) { b0 = bp.bone; }
      skinIndex[i * 4] = b0; skinIndex[i * 4 + 1] = b1;
      skinWeight[i * 4] = w0; skinWeight[i * 4 + 1] = w1;
    }
  }
  if (palette) geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('aLabel', new THREE.BufferAttribute(label, 1));
  if (boneCount) {
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  }
  // rest position for procedural patterns
  geo.setAttribute('aRest', new THREE.BufferAttribute(new Float32Array(p.array), 3));
  return geo;
}
