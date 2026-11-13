// The camera rides a rail: one closed loop through the interior that visits all ten forms.
// Modes: 'tour' (on the rail), 'plate' (the whole interior), 'focus' (beside one fiber),
// 'custom' (a fixed framing). Every change of mode is one eased flight; nobody can get lost.
//
// The rail is a list of composed frames (anatomy.js RAIL). Position and look direction are splined
// through the keys; a time table turns seconds into distance so the glide eases down at every
// station and runs fast on the skims, whatever the spacing of the keys. A key flagged `along` is
// passed travelling exactly the way it looks (that is how the lens threads the loop on its axis).

import { V3, Q, clamp, mix, easeInOut, TAU } from './math.js?v=mwebkyjr';
import { PLATE, recordPitch } from './anatomy.js?v=mwebkyjr';

const K_SAMPLES = 9, STEPS = 3200;
const LOOP_MIN = 100, LOOP_MAX = 140;

function cr1(a, b, c, d, t) { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); }

export class Camera {
  constructor({ reduced = false } = {}) {
    this.reduced = reduced;
    this.rail = null;                    // the keys come with the anatomy: the rail rides the river's surface
    this.railT = 0; this.vel = 0; this.auto = true; this.autoK = 0; this.hold = 1e9; this.frozen = false;
    this.mode = 'tour'; this.back = 'tour';
    this.yaw = 0; this.pitch = 0; this.dragging = false;
    this.flight = null; this.custom = null; this.focusIndex = -1;
    this.pose = null;
  }
  setAnatomy(anat) {
    this.anat = anat; this.samples = null;
    this.rail = anat.rail; this.n = this.rail.length; this._build();
    if (!this.pose) this.pose = this.railPose(this.railT);
  }

  // ---- the rail
  _build() {
    const n = this.n, RAIL = this.rail;
    this._dir = RAIL.map((w) => V3.norm(V3.sub(w.t, w.p)));
    this._foc = RAIL.map((w) => Math.log(Math.max(V3.dist(w.p, w.f || w.t), 1)));
    this._fov = RAIL.map((w) => w.fov || 0.84);
    this._ap = RAIL.map((w) => (w.ap == null ? 0.0062 : w.ap));
    this._lv = RAIL.map((w) => Math.log(w.v || 9));
    this._fog = RAIL.map((w) => (w.fog == null ? 1 : w.fog));
    this._st = RAIL.map((w, i) => (w.st ? i : -1)).filter((i) => i >= 0);
    // the path's tangent at each key: Catmull-Rom, or along the view where the key says so
    this._tan = RAIL.map((w, i) => {
      const a = RAIL[(i - 1 + n) % n].p, c = RAIL[(i + 1) % n].p;
      return w.along ? V3.scale(this._dir[i], 0.5 * (V3.dist(a, w.p) + V3.dist(w.p, c))) : V3.scale(V3.sub(c, a), 0.5);
    });
    // seconds as a function of the key parameter: dt = distance / speed
    const tt = new Float64Array(STEPS + 1);
    let acc = 0, prev = this._vec('p', 0);
    for (let i = 0; i < STEPS; i++) {
      tt[i] = acc;
      const p = this._vec('p', ((i + 1) / STEPS) * n);
      acc += V3.dist(p, prev) / this._speed(((i + 0.5) / STEPS) * n);
      prev = p;
    }
    acc = Math.max(acc, 1e-6); tt[STEPS] = acc; this._tt = tt;
    this.loop = clamp(acc, LOOP_MIN, LOOP_MAX);        // the designed speeds give the loop its length; it is held between 100 and 140 s
    this._ts = this.loop / acc;
  }
  // speed along the rail: the cruise speed splined between the keys, easing right down at every station
  _speed(s) {
    let k = 1; const n = this.n;
    for (const i of this._st) { let d = Math.abs(s - i); d = Math.min(d, n - d); k -= 0.62 * Math.exp(-(d * d) / (2 * 0.17 * 0.17)); }
    return Math.exp(this._num(this._lv, s)) * Math.max(k, 0.3);
  }
  // position on the rail: a cubic Hermite through the keys with the tangents above
  _vec(key, s) {
    const n = this.n, i0 = ((Math.floor(s) % n) + n) % n, i1 = (i0 + 1) % n, f = s - Math.floor(s), f2 = f * f, f3 = f2 * f;
    const b = this.rail[i0][key], c = this.rail[i1][key], mb = this._tan[i0], mc = this._tan[i1];
    const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
    return [h00 * b[0] + h10 * mb[0] + h01 * c[0] + h11 * mc[0], h00 * b[1] + h10 * mb[1] + h01 * c[1] + h11 * mc[1], h00 * b[2] + h10 * mb[2] + h01 * c[2] + h11 * mc[2]];
  }
  _num(arr, s) {
    const n = this.n, i = Math.floor(s), f = s - i, g = (k) => arr[(((i + k) % n) + n) % n];
    return cr1(g(-1), g(0), g(1), g(2), f);
  }
  // rail time (seconds) -> key parameter
  _param(T) {
    const total = this._tt[STEPS] * this._ts, x = ((((T % total) + total) % total)) / this._ts;
    let lo = 0, hi = STEPS;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this._tt[m] <= x) lo = m; else hi = m; }
    const a = this._tt[lo], b = this._tt[hi];
    return ((lo + (x - a) / Math.max(1e-9, b - a)) / STEPS) * this.n;
  }
  keyTime(i) { return this._tt[Math.round((i / this.n) * STEPS)] * this._ts; }
  // The look direction is splined between the keys' own directions (not re-aimed at a moving target
  // every frame), so the head never whips round when the lens passes close to what it looks at.
  _fwd(s) {
    const n = this.n, i = Math.floor(s), f = s - i, g = (k) => this._dir[(((i + k) % n) + n) % n], a = g(-1), b = g(0), c = g(1), d = g(2);
    return V3.norm([cr1(a[0], b[0], c[0], d[0], f), cr1(a[1], b[1], c[1], d[1], f), cr1(a[2], b[2], c[2], d[2], f)]);
  }
  railPose(T) {
    const s = this._param(T), pos = this._vec('p', s), fwd = this._fwd(s);
    // the horizon stays level; the only roll is a gentle bank into the turn of the view (under 7 degrees)
    let roll = 0;
    if (!this.reduced) {
      const h = 0.25, a = this._fwd(this._param(T - h)), b = this._fwd(this._param(T + h));
      let dy = Math.atan2(b[2], b[0]) - Math.atan2(a[2], a[0]);
      dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI;
      roll = clamp((-dy / (2 * h)) * 0.5, -0.115, 0.115);
    }
    return {
      pos, q: Q.look(pos, V3.add(pos, fwd), [0, 1, 0], roll), fov: this._num(this._fov, s), focus: Math.exp(this._num(this._foc, s)),
      aperture: Math.max(0, this._num(this._ap, s)), air: 0, fogK: clamp(this._num(this._fog, s), 0.3, 1.5),
    };
  }
  // which form this stretch of the rail is about (for label priority)
  railMuscle() {
    const s = this._param(this.railT), i = Math.round(s) % this.n;
    return this.rail[i].m || null;
  }
  stopTime(id) { let i = this.rail.findIndex((w) => w.m === id && w.st); if (i < 0) i = this.rail.findIndex((w) => w.m === id); return i < 0 ? null : this.keyTime(i); }

  platePose() {
    // FIX V15: the plate was composed for a window 1.6 times as wide as it is tall. In a narrower one the lens pulls back
    // so the ten forms keep their place inside the panels (a little more in a small pane, where the panels take more room).
    // ART (A4): the forms now stand in a box about 1.45 times as wide as it is tall, so a squarer window needs far less
    // pull-back than it did (the pane, 975 x 934: 1.39, was 1.64) and the forms fill it.
    const k = Math.max(this.narrow ? 1.15 : 1.12, 1.41 / (this.aspect || 1.6), this.short ? 1.42 : 0);      // (a short window, under 780 high: the panels take a third of it, so the lens stands back and leaves dark room for the ten labels)      // CABLES: with the wide lens the forms run off the frame at the sides; less pull-back      // REPAIR (R1): the woven body is a little wider than it was
    const off = V3.scale(V3.sub(PLATE.p, PLATE.t), k);
    const q1 = Q.mul(Q.axisAngle([0, 1, 0], -this.yaw * 0.9), Q.axisAngle([1, 0, 0], this.pitch * 0.5));
    const tgt = this.short ? V3.add(PLATE.t, [0, -26, 0]) : PLATE.t;      // (and looks a little lower, so the near bank stands clear of the dock)
    const pos = V3.add(tgt, Q.rotate(q1, off));
    return { pos, q: Q.look(pos, tgt), fov: PLATE.fov, focus: V3.dist(pos, tgt), aperture: 0.0010, air: 1, fogK: 1 };
  }

  // ---- close-up beside one fiber: pick the side from which the fewest neighbours are in the way
  _samples() {
    if (this.samples) return this.samples;
    const a = this.anat, s = new Float32Array(a.count * K_SAMPLES * 3);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < K_SAMPLES; k++) s.set(a.point(i, (k + 0.5) / K_SAMPLES).p, (i * K_SAMPLES + k) * 3);
    return (this.samples = s);
  }
  // Points on other fibers that pass near p: found coarsely from the cached samples, then resampled
  // every couple of units, because a strand wound round this one crosses the line of sight between
  // two coarse samples.
  _near(index, p, reach) {
    const a = this.anat, S = this._samples(), out = [];
    for (let i = 0; i < a.count; i++) {
      if (i === index) continue;
      const len = a.fibers[i].len, slack = reach + len / (2 * K_SAMPLES) + 1;
      let hit = false;
      for (let k = 0, o = i * K_SAMPLES * 3; k < K_SAMPLES; k++, o += 3) if (Math.hypot(S[o] - p[0], S[o + 1] - p[1], S[o + 2] - p[2]) < slack) { hit = true; break; }
      if (!hit) continue;
      const n = Math.min(260, Math.max(K_SAMPLES, Math.ceil(len / 1.6)));
      for (let k = 0; k <= n; k++) { const q = a.point(i, k / n).p; if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < reach) out.push(q[0] - p[0], q[1] - p[1], q[2] - p[2], a.fibers[i].radius); }
    }
    return out;
  }
  focusPose(index) {
    const a = this.anat, f = a.fibers[index], { p, t } = a.point(index, 0.5);
    const d = clamp(f.radius * 30, 6.5, 13), ref = f.muscle.view, N = this._near(index, p, d + 2);
    let n0 = V3.reject(ref, t); n0 = V3.len(n0) > 1e-3 ? V3.norm(n0) : V3.perp(t);
    const b0 = V3.cross(t, n0);
    const tt = V3.dot(t, [1, 0.3, 0]) < 0 ? V3.scale(t, -1) : t;       // a three-quarter view along the fiber
    let best = n0, bs = 1e9;
    for (let k = 0; k < 36; k++) {
      const ang = (k / 36) * TAU, dir = V3.add(V3.scale(n0, Math.cos(ang)), V3.scale(b0, Math.sin(ang)));
      let sc = (1 - V3.dot(dir, ref)) * 1.4 + Math.max(0, -dir[1] - 0.2) * 2;
      // the line of sight the lens will really have: from beside and a little behind, onto the middle of the fiber
      const eye = V3.add(V3.scale(dir, d), V3.scale(tt, -d * 0.36)), el = V3.len(eye), ex = V3.scale(eye, 1 / el);
      for (let j = 0; j < N.length; j += 4) {           // neighbours standing between eye and fiber
        const al = N[j] * ex[0] + N[j + 1] * ex[1] + N[j + 2] * ex[2];
        if (al < 0.15 || al > el) continue;
        const lat = Math.hypot(N[j] - ex[0] * al, N[j + 1] - ex[1] * al, N[j + 2] - ex[2] * al) - N[j + 3], clear = 0.9 + 0.12 * al;      // the cone widens toward the lens
        if (lat < clear) sc += (clear - lat) * 0.5;
      }
      if (sc < bs) { bs = sc; best = dir; }
    }
    // FIX V12: a fiber with a record is shown so the record can be counted: square on, from far enough back that the
    // whole of it (first band to last notch) crosses about two thirds of the open part of the frame, and with a small
    // aperture so every band is sharp. A fiber with no record keeps the three-quarter close-up.
    const sk = f.skill, nb = sk.jobs, nn = sk.handed;
    if (nb + nn > 0) {
      const rad = Math.min(f.radius, 2.2 * 0.19), pitch = recordPitch(rad, f.len, nb, nn), pn = 0.72 * pitch;
      const span = Math.max(nb - 1, 0) * pitch + (nb && nn ? 0.5 * pitch + 0.62 * pn : 0) + Math.max(nn - 1, 0) * pn + 6 * rad;
      const fov = 0.62, asp = this.aspect || 1.6, open = this.narrow ? 0.50 : 0.62;                   // the share of the frame's width left of the card
      // ART (A7): never farther back than 30 (was 70). A record of a hundred bands and more does not fit a frame at any size
      // at which a band can be counted; the close-up stays a macro photograph and shows the middle of it, every band in
      // view countable (the card gives the total).
      // PASS3 (T4): a long record is a counted scale (recordPitch) and is shown whole: the lens may stand back as far as it takes (76)
      const dd = clamp(span / ((nb + 0.72 * nn > 30 ? 0.70 : 0.66) * open * 2 * Math.tan(fov / 2) * asp), 5.5, nb + 0.72 * nn > 30 ? 96 : 40);      // REPAIR (R5): 40 (was 30): the neighbours now stand back (anatomy.js partRows), so more of a long record can be shown
      // The lens is turned about its own axis until the fiber lies level across the frame (most fibers of the fan stand
      // nearly upright, and an upright record ran off the top and the foot of the frame): the record reads left to right.
      const pos2 = V3.addS(p, best, dd), fwd = V3.norm(V3.sub(p, pos2));
      let along = V3.reject(t, fwd); along = V3.len(along) > 1e-3 ? V3.norm(along) : V3.norm(V3.cross(fwd, [0, 1, 0]));
      let up2 = V3.cross(along, fwd);
      if (up2[1] < 0) { up2 = V3.scale(up2, -1); along = V3.scale(along, -1); }
      const tgt2 = V3.addS(p, along, dd * Math.tan(fov / 2) * asp * (1 - open) * 0.9);             // the record sits in the middle of the open part
      return { pos: pos2, q: Q.look(pos2, tgt2, up2), fov, focus: V3.dist(pos2, p), aperture: 0.0035, air: 0, fogK: 1 };
    }
    const pos = V3.add(V3.addS(p, best, d), V3.scale(tt, -d * 0.36));
    const right = V3.norm(V3.cross(V3.sub(p, pos), [0, 1, 0]));
    const tgt = V3.addS(p, right, d * 0.2);                             // leave room for the proof card
    return { pos, q: Q.look(pos, tgt), fov: 0.62, focus: V3.dist(pos, p), aperture: 0.024, air: 0, fogK: 1 };
  }
  // mid-distance, side-on to the form where its proven work is, so the fibers cross the frame at one depth
  bundlePose(m) {
    const c = m.provenCenter;
    let t = [1, 0, 0], best = 1e9;
    for (let i = 0; i <= 40; i++) { const fr = m.path.at(i / 40), d = V3.dist(fr.p, c); if (d < best) { best = d; t = fr.t; } }
    let v = V3.reject(m.view, t); v = V3.len(v) > 0.2 ? V3.norm(v) : m.view;
    const pos = V3.addS(V3.addS(c, v, m.dist * 0.7), t, -m.dist * 0.12);
    return { pos, q: Q.look(pos, c), fov: 0.62, focus: V3.dist(pos, c), aperture: 0.012, air: 0, fogK: 1 };
  }

  // PASS3 (T5): where the fibers are, for choosing a route: the cells (five units) any fiber passes through. Built once
  // per anatomy from the cached samples (a fiber is walked as the polyline through them), on the first flight.
  _grid() {
    if (this.grid && this.grid.of === this.anat) return this.grid;
    const S = this._samples(), n = this.anat.count, C = 5, set = new Set();
    for (let i = 0; i < n; i++) for (let k = 0; k < K_SAMPLES - 1; k++) {
      const o = (i * K_SAMPLES + k) * 3, ax = S[o], ay = S[o + 1], az = S[o + 2], bx = S[o + 3], by = S[o + 4], bz = S[o + 5];
      const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 4));
      for (let j = 0; j <= m; j++) { const f = j / m; set.add((Math.floor((ax + (bx - ax) * f) / C) + 512) * 1048576 + (Math.floor((ay + (by - ay) * f) / C) + 512) * 1024 + (Math.floor((az + (bz - az) * f) / C) + 512)); }
    }
    return (this.grid = { of: this.anat, cell: C, set });
  }

  // ---- mode changes
  _fly(dur) { this.flight = this.reduced || dur <= 0 ? null : { from: this.pose, t: 0, dur, bow: null }; }
  // ENG (E2): a flight went in a straight line from where the lens was to where it was going, and a straight line often
  // runs through a bundle: for two or three frames the picture was nothing but lit rods, a flash. Now every flight
  // may bow. The straight line and a ring of bowed ones (three sizes, eight directions across the line) are walked
  // against points on the fibers; each is charged for every stretch it spends nearer than CLEAR to a fiber (the two
  // ends are left out: a close-up ends beside its fiber by design) and a little for its own size, and the cheapest is
  // flown. Worked out once, on the first frame of the flight; the bow is zero at both ends, so nothing else changes.
  _bow(from, to) {
    const a = this.anat, S = a && a.count ? this._samples() : null, span = V3.sub(to, from), D = V3.len(span);
    if (!S || D < 12) return [0, 0, 0];
    // PASS3 (T5): the route was walked against nine points a fiber, thirty units apart on a long one, so a cable could lie
    // across it unseen; and only the middle three quarters of it were walked. It is now walked against a map of every
    // fiber (cells of five units, filled along the fibers every four), nearly end to end (the ends weigh less: a close-up
    // ends beside its fiber by design, and the clearing round the lens covers them), with a wider comfortable distance
    // (12, was 9) and more routes to choose from (four sizes, twelve directions).
    const CLEAR = 12, G = this._grid(), C = G.cell, R = Math.ceil(CLEAR / C);
    const t = V3.scale(span, 1 / D), u0 = V3.perp(t), v0 = V3.cross(t, u0), M = 30;
    const cost = (bow) => {
      let c = 0;
      for (let k = 0; k <= M; k++) {
        const e = 0.05 + 0.90 * (k / M), w = 4 * e * (1 - e), x = from[0] + span[0] * e + bow[0] * w, y = from[1] + span[1] * e + bow[1] * w, z = from[2] + span[2] * e + bow[2] * w;
        const ix = Math.floor(x / C), iy = Math.floor(y / C), iz = Math.floor(z / C); let d2 = CLEAR * CLEAR;
        for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (let c2 = -R; c2 <= R; c2++) {
          if (!G.set.has((ix + a + 512) * 1048576 + (iy + b + 512) * 1024 + (iz + c2 + 512))) continue;
          const dx = (ix + a + 0.5) * C - x, dy = (iy + b + 0.5) * C - y, dz = (iz + c2 + 0.5) * C - z, q = dx * dx + dy * dy + dz * dz; if (q < d2) d2 = q;
        }
        const d = Math.sqrt(d2); if (d < CLEAR) c += (CLEAR - d) * (CLEAR - d) * (0.35 + 0.65 * Math.min(1, Math.min(e, 1 - e) / 0.22));
      }
      return c;
    };
    let best = [0, 0, 0], bc = cost(best);
    if (bc < 1) return best;                                   // the straight line is clear
    for (const m of [0.12, 0.24, 0.40, 0.60]) for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * TAU, r = Math.min(m * D, 150), bow = V3.add(V3.scale(u0, Math.cos(ang) * r), V3.scale(v0, Math.sin(ang) * r));
      const c = cost(bow) + m * 6;
      if (c < bc) { bc = c; best = bow; }
    }
    return best;
  }
  setMode(mode, { instant = false } = {}) {
    if (mode === this.mode) return;
    this._fly(instant ? 0 : mode === 'plate' || this.mode === 'plate' ? 3.0 : 1.8);
    this.mode = mode; if (mode === 'tour' || mode === 'plate') this.back = mode;
    this.focusIndex = mode === 'focus' ? this.focusIndex : -1; this.yaw = this.pitch = 0;
  }
  focus(index, { instant = false } = {}) {
    this.custom = this.focusPose(index); this.focusIndex = index;
    this._fly(instant ? 0 : this.mode === 'plate' ? 2.6 : 1.9); this.mode = 'focus'; this.yaw = this.pitch = 0; this.hold = 0;
  }
  clearFocus({ instant = false } = {}) { if (this.mode === 'focus' || this.mode === 'custom') this.setMode(this.back, { instant }); }
  framing(pose, { instant = true } = {}) { this.custom = pose; this._fly(instant ? 0 : 1.8); this.mode = 'custom'; }
  toMuscle(id) {
    const T = this.stopTime(id); if (T == null) return false;
    this._fly(2.4); this.mode = 'tour'; this.back = 'tour'; this.focusIndex = -1;
    this.railT = T; this.vel = 0; this.hold = 0; this.yaw = this.pitch = 0;
    return true;
  }

  // ---- input
  touch() { this.hold = 0; }
  scroll(dy) { this.touch(); if (this.mode === 'tour') this.vel += clamp(-dy, -400, 400) * 0.012; }
  drag(dx, dy) { this.touch(); this.dragging = true; this.yaw = clamp(this.yaw + dx * 0.0032, -0.7, 0.7); this.pitch = clamp(this.pitch + dy * 0.0026, -0.4, 0.4); }
  endDrag() { this.dragging = false; }
  toggleAuto() { this.auto = this.reduced ? false : !this.auto; this.hold = this.auto ? 1e9 : 0; return this.auto; }   // FIX V41: with reduced motion it stays off

  target() {
    if (this.mode === 'plate') return this.platePose();
    const base = this.mode === 'tour' ? this.railPose(this.railT) : this.custom;
    if (!this.yaw && !this.pitch) return base;
    const q = Q.mul(Q.mul(Q.axisAngle([0, 1, 0], -this.yaw), base.q), Q.axisAngle([1, 0, 0], -this.pitch));
    return { ...base, q };
  }

  update(dt) {
    if (!this.frozen && dt > 0) {
      this.hold += dt;
      const run = this.mode === 'tour' && this.auto && !this.reduced && this.hold > 8;
      this.autoK += clamp((run ? 1 : 0) - this.autoK, -dt * 1.2, dt * 0.5);
      this.vel = clamp(this.vel, -9, 9);
      this.railT += dt * (this.autoK + this.vel);
      this.vel *= Math.exp(-dt * 2.4);
      if (!this.dragging) { const k = Math.exp(-dt * 2.6); this.yaw *= k; this.pitch *= k; if (Math.abs(this.yaw) + Math.abs(this.pitch) < 1e-4) this.yaw = this.pitch = 0; }
    }
    const tg = this.target();
    if (this.flight) {
      this.flight.t += dt / this.flight.dur;
      const e = easeInOut(clamp(this.flight.t, 0, 1)), a = this.flight.from;
      if (!this.flight.bow) this.flight.bow = this._bow(a.pos, tg.pos);        // ENG (E2)
      // P3R (flights): turning from one framing to the other at an even rate, the lens spent the middle of a flight looking at
      // nothing (Escape on the real feed: 0.4 s of dark frames with bars of the architecture across them). In the middle of a
      // flight it now looks at a point between what it looked at and what it will look at, drawn most of the way toward
      // the middle of the river, the body's largest form. Both ends are exactly the framings they were (the weight is 0 there).
      const posF = V3.addS(V3.lerp(a.pos, tg.pos, e), this.flight.bow, 4 * e * (1 - e));
      let qF = Q.slerp(a.q, tg.q, e);
      { const ba = Q.basis(a.q)[2], bt = Q.basis(tg.q)[2], Ca = V3.addS(a.pos, ba, -a.focus), Ct = V3.addS(tg.pos, bt, -tg.focus);
        const hero = this.anat && this.anat.muscleById && this.anat.muscleById.get('research'), w = 4 * e * (1 - e);
        let C = V3.lerp(Ca, Ct, e); if (hero && hero.fibers.length && hero.center) C = V3.lerp(C, hero.center, 0.72 * w);
        if (V3.dist(C, posF) > 4) qF = Q.slerp(qF, Q.look(posF, C), 0.95 * w * (2 - w)); }
      this.pose = {
        pos: posF, q: qF, fov: mix(a.fov, tg.fov, e), focus: Math.exp(mix(Math.log(a.focus), Math.log(tg.focus), e)),
        aperture: mix(a.aperture, tg.aperture, e) * (1 - 0.85 * 4 * e * (1 - e)), air:      /* P3R: stopped down in the middle of a flight: with the focus still near and the lens already far, the whole frame was soft */ mix(a.air || 0, tg.air || 0, e), fogK: mix(a.fogK == null ? 1 : a.fogK, tg.fogK == null ? 1 : tg.fogK, e),
        // PASS3 (T5): how far the clearing round the lens is open (renderer.js uNearEase): it opens over the first quarter of
        // a flight and closes over the last, so both ends are exactly the pictures they were
        clear: (() => { const x = clamp(this.flight.t, 0, 1), s = (v) => v * v * (3 - 2 * v); return s(clamp(x / 0.26, 0, 1)) * s(clamp((1 - x) / 0.26, 0, 1)); })(),
      };
      if (this.flight.t >= 1) this.flight = null;
    } else this.pose = tg;
    return this.pose;
  }
}
