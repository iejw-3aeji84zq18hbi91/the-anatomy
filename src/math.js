// b-lumen math: vectors, matrices, quaternions, splines, hashing. No dependencies.

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => clamp(x, 0, 1);
export const smoothstep = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ------------------------------------------------------------------ vec3 (plain arrays)
export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  addS: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  // any unit vector perpendicular to a (a must be unit)
  perp: (a) => V3.norm(Math.abs(a[1]) < 0.9 ? V3.cross(a, [0, 1, 0]) : V3.cross(a, [1, 0, 0])),
  // remove the component of a along unit n
  reject: (a, n) => V3.addS(a, n, -V3.dot(a, n)),
};

// ------------------------------------------------------------------ mat4 (column-major Float32Array)
export const M4 = {
  identity: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
    return m;
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  // view matrix for a camera at pos with orientation quaternion q (camera looks down its local -Z)
  view(pos, q) {
    const r = Q.basis(q); // columns: right, up, back
    const m = new Float32Array(16);
    m[0] = r[0][0]; m[4] = r[0][1]; m[8] = r[0][2]; m[12] = -V3.dot(r[0], pos);
    m[1] = r[1][0]; m[5] = r[1][1]; m[9] = r[1][2]; m[13] = -V3.dot(r[1], pos);
    m[2] = r[2][0]; m[6] = r[2][1]; m[10] = r[2][2]; m[14] = -V3.dot(r[2], pos);
    m[15] = 1;
    return m;
  },
  point(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
  },
  dir(m, d) {
    return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
  },
};

// ------------------------------------------------------------------ quaternions [x, y, z, w]
export const Q = {
  identity: () => [0, 0, 0, 1],
  norm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
  mul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  },
  axisAngle(axis, ang) { const s = Math.sin(ang / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)]; },
  rotate(q, v) {
    const u = [q[0], q[1], q[2]], s = q[3];
    const t = V3.scale(V3.cross(u, v), 2);
    return V3.add(V3.addS(v, t, s), V3.cross(u, t));
  },
  // basis vectors [right, up, back] of the rotation
  basis(q) { return [Q.rotate(q, [1, 0, 0]), Q.rotate(q, [0, 1, 0]), Q.rotate(q, [0, 0, 1])]; },
  // from an orthonormal basis (right, up, back)
  fromBasis(r, u, b) {
    const m00 = r[0], m01 = u[0], m02 = b[0], m10 = r[1], m11 = u[1], m12 = b[1], m20 = r[2], m21 = u[2], m22 = b[2];
    const tr = m00 + m11 + m22; let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
    return Q.norm(q);
  },
  // camera orientation looking from eye to target, world up hint, roll in radians
  look(eye, target, up = [0, 1, 0], roll = 0) {
    const back = V3.norm(V3.sub(eye, target));
    let right = V3.cross(up, back);
    if (V3.len(right) < 1e-4) right = V3.cross([0, 0, 1], back);
    right = V3.norm(right);
    const u = V3.cross(back, right);
    let q = Q.fromBasis(right, u, back);
    if (roll) q = Q.mul(q, Q.axisAngle([0, 0, 1], roll));
    return q;
  },
  slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (d > 0.9995) return Q.norm([mix(a[0], bb[0], t), mix(a[1], bb[1], t), mix(a[2], bb[2], t), mix(a[3], bb[3], t)]);
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
  },
};

// ------------------------------------------------------------------ hashing and random
export function hash32(str) { // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ------------------------------------------------------------------ splines
function cr(p0, p1, p2, p3, t) { // uniform Catmull-Rom, one component set
  const t2 = t * t, t3 = t2 * t, o = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    o[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
  return o;
}

// A smooth path through waypoints, resampled by arc length, carrying a rotation-minimising frame.
// at(u) is valid a little outside [0,1] (open paths extrapolate along the end tangent; closed wrap).
export class Path {
  constructor(pts, { closed = false, samples = 160, up = [0, 1, 0] } = {}) {
    this.closed = closed;
    const n = pts.length, dense = [], D = Math.max(240, samples * 2);
    const get = (i) => (closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i <= D; i++) {
      const f = (i / D) * segs, s = Math.min(Math.floor(f), segs - 1);
      dense.push(cr(get(s - 1), get(s), get(s + 1), get(s + 2), f - s));
    }
    const cum = [0];
    for (let i = 1; i <= D; i++) cum.push(cum[i - 1] + V3.dist(dense[i], dense[i - 1]));
    this.length = cum[D];
    const S = (this.S = samples); this.P = []; this.T = []; this.N = []; this.B = [];
    let j = 0;
    for (let i = 0; i <= S; i++) {
      const d = (i / S) * this.length;
      while (j < D - 1 && cum[j + 1] < d) j++;
      const f = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      this.P.push(V3.lerp(dense[j], dense[j + 1], saturate(f)));
    }
    for (let i = 0; i <= S; i++) {
      const a = closed ? this.P[(i - 1 + S) % S] : this.P[Math.max(0, i - 1)];
      const b = closed ? this.P[(i + 1) % S] : this.P[Math.min(S, i + 1)];
      this.T.push(V3.norm(V3.sub(b, a)));
    }
    let nrm = V3.norm(V3.reject(up, this.T[0]));
    if (!isFinite(nrm[0]) || V3.len(V3.reject(up, this.T[0])) < 1e-3) nrm = V3.perp(this.T[0]);
    for (let i = 0; i <= S; i++) {
      nrm = V3.norm(V3.reject(nrm, this.T[i]));
      this.N.push(nrm); this.B.push(V3.cross(this.T[i], nrm));
    }
  }
  at(u) {
    const S = this.S;
    if (this.closed) u = u - Math.floor(u);
    const uc = clamp(u, 0, 1), f = uc * S, i = Math.min(Math.floor(f), S - 1), t = f - i;
    let p = V3.lerp(this.P[i], this.P[i + 1], t);
    const tan = V3.norm(V3.lerp(this.T[i], this.T[i + 1], t));
    if (!this.closed && u !== uc) p = V3.addS(p, tan, (u - uc) * this.length);
    return { p, t: tan, n: V3.norm(V3.lerp(this.N[i], this.N[i + 1], t)), b: V3.norm(V3.lerp(this.B[i], this.B[i + 1], t)) };
  }
}

// Uniform cubic B-spline over n control points stored flat as [x,y,z,w,...]; u in [0,1].
// Mirrors the vertex shader exactly so CPU picks, anchors and camera targets match the picture.
export function bspline(cp, off, n, u) {
  const tt = clamp(u, 0, 1) * (n - 3), s = Math.min(Math.floor(tt), n - 4), f = tt - s;
  const f2 = f * f, f3 = f2 * f, g = 1 - f;
  const b0 = (g * g * g) / 6, b1 = (3 * f3 - 6 * f2 + 4) / 6, b2 = (-3 * f3 + 3 * f2 + 3 * f + 1) / 6, b3 = f3 / 6;
  const d0 = (-g * g) / 2, d1 = (3 * f2 - 4 * f) / 2, d2 = (-3 * f2 + 2 * f + 1) / 2, d3 = f2 / 2;
  const o = off + s * 4, p = [0, 0, 0], t = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    p[k] = cp[o + k] * b0 + cp[o + 4 + k] * b1 + cp[o + 8 + k] * b2 + cp[o + 12 + k] * b3;
    t[k] = cp[o + k] * d0 + cp[o + 4 + k] * d1 + cp[o + 8 + k] * d2 + cp[o + 12 + k] * d3;
  }
  return { p, t: V3.norm(t) };
}

// Weighted sunflower packing followed by a few relaxation passes so discs never overlap.
// radii: per-item disc radius (already including clearance). Returns [{x,y}], and the bounding radius.
export function packDiscs(radii, { relax = 10 } = {}) {
  const n = radii.length, pts = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const a = radii[i] * radii[i] * 1.21; // disc area share, hex packing efficiency folded in
    const r = Math.sqrt(cum + a * 0.5), ang = i * 2.399963229728653;
    pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
    cum += a;
  }
  for (let it = 0; it < relax; it++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, d = Math.hypot(dx, dy) || 1e-4, need = radii[i] + radii[j];
      if (d < need) {
        const push = (need - d) * 0.5, ux = dx / d, uy = dy / d;
        const wi = radii[j] / need, wj = radii[i] / need; // thin ones move more
        pts[i].x -= ux * push * 2 * wi; pts[i].y -= uy * push * 2 * wi;
        pts[j].x += ux * push * 2 * wj; pts[j].y += uy * push * 2 * wj;
      }
    }
  }
  let R = 0, cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n || 1; cy /= n || 1;
  for (let i = 0; i < n; i++) { pts[i].x -= cx; pts[i].y -= cy; R = Math.max(R, Math.hypot(pts[i].x, pts[i].y) + radii[i]); }
  return { pts, R };
}
