// The burst replay: one recorded sandbox run played back as sparks. Schema autogenic.skill-burst/1.
//
// A burst document lists, for each skill, one character per job in the order the jobs ran:
// 1 = finished by Auto, 0 = handed to a person. Here every job becomes exactly one spark on its skill's fiber:
//   1   a bright spark in the family colour that runs the length of the fiber
//   0   an amber spark that runs a short way, stops, and drops away
// The jobs of each skill keep their recorded order and the skills are interleaved, eased in and out over
// REPLAY_SECONDS. All sparks are ONE instanced additive draw: the instance data is (launch second, fiber, outcome)
// and the vertex shader works out where a spark is from the replay clock and the fiber's centre-line, so 25,007
// jobs cost one draw call and nothing is uploaded per frame. Nothing here writes to a fiber: a staged fiber stays
// dark glass, shows light only where a spark is passing, and is dark again when the stream ends.
//
// The counters are counted, never animated: at any replay time they are the number of sparks that have landed
// (or stopped) by then, read from the same schedule the GPU draws.

import { Program } from './glx.js';
import { V3, Q, clamp, hash32 } from './math.js';

export const BURST_SCHEMA = 'autogenic.skill-burst/1';
export const REPLAY_SECONDS = 14;          // the whole replay: first launch to last landing

const RUN = 0.36;                          // seconds a bright spark takes to run its fiber
const HOLD = 0.1;                          // an amber spark rests this long where it stopped
const FALL = 0.60;                         // then drops away over this long (FIX V14: was 0.95. The embers, 15 percent of the run, were most of what the eye saw)
const STREAK = 0.075;                      // the tail behind a spark, in seconds of its own travel (was 0.05: a finished job is a longer dash)
const AFTER = 2.5;                         // FIX V14: seconds of afterglow when the replay ends
const LAUNCH = REPLAY_SECONDS - RUN - 0.06; // sparks launch over this long, so the last one has landed when the replay ends
const stopU = (seed) => 0.08 + 0.28 * seed;       // how far along its fiber an amber spark gets (mirrored in the shader)
const stopT = (seed) => stopU(seed) * RUN * 1.6;  // and how long it takes to get there
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// replay progress -> share of the run launched. Eased in and out, so a replay opens and closes with single sparks.
const ease = (x) => x * x * x * (x * (6 * x - 15) + 10);
function easeInv(p) { let lo = 0, hi = 1; for (let i = 0; i < 36; i++) { const m = (lo + hi) / 2; if (ease(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
function hash01(a, b) {
  let x = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}
const upto = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; } return lo; };
const srgb = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linear = (hex) => { const n = parseInt(String(hex).slice(1), 16) || 0xaeb6c6; return [srgb(((n >> 16) & 255) / 255), srgb(((n >> 8) & 255) / 255), srgb((n & 255) / 255)]; };
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

// The day of the run, from the document. No field, no date: nothing is guessed.
function runDay(doc) {
  for (const k of ['ran_at', 'started_at', 'at', 'generated_at', 'date', 'about']) {
    const m = typeof doc[k] === 'string' && doc[k].match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
  }
  return null;
}

// Schema check. Returns the parts this viewer uses, or null when the document is not a burst it can read.
export function readBurst(doc) {
  if (!doc || typeof doc !== 'object' || doc.schema !== BURST_SCHEMA || !Array.isArray(doc.bursts)) return null;
  const runs = [];
  for (const b of doc.bursts) if (b && b.node != null && typeof b.outcomes === 'string') runs.push({ node: String(b.node), outcomes: b.outcomes });
  return {
    runs, jobs: num(doc.jobs), done: num(doc.done), handedBack: num(doc.handed_back), wrong: num(doc.wrong),
    modelCalls: num(doc.model_calls), wallSeconds: num(doc.wall_seconds), day: runDay(doc),
  };
}

// ---------------------------------------------------------------- the one draw
const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(location=0) in vec2 aQ;    // corner of the streak: x 0 tail end, 1 head end; y -1 / +1
layout(location=1) in vec4 iA;    // launch second, fiber, outcome (1 finished by Auto, 0 handed to a person), seed
layout(location=2) in vec4 iB;    // fiber colour (linear rgb), fiber radius
layout(location=3) in vec4 iC;    // fiber length, closed-loop flag, unused, unused
uniform sampler2D uCP;            // fiber control points (see lines.js)
uniform ivec2 uCPDim;             // control points per fiber, rows per column
uniform mat4 uView, uProj;
uniform vec2 uViewport;
uniform vec3 uCam;
uniform float uClock;             // replay clock, seconds
uniform float uTime, uSway;       // scene clock and sway, so a spark stays on its swaying fiber
uniform vec4 uDur;                // run, hold, fall, streak (seconds)
uniform float uPxMin, uFog;
out vec2 vP;                      // place in the streak, in fiber radii: x along (0 at the tip, negative behind), y across
flat out vec4 vA;                 // tail length in fiber radii, strength, outcome, how far into its fall
flat out vec3 vTint;

// The fiber's centre-line at u: the same uniform cubic B-spline and the same sway as the fiber's own vertex stage.
vec3 centre(float u) {
  int idx = int(iA.y + 0.5);
  int col = idx / uCPDim.y, row = idx - col * uCPDim.y;
  float n3 = float(uCPDim.x - 3);
  float t = clamp(u, 0., 1.) * n3, sf = min(floor(t), n3 - 1.), f = t - sf;
  int s = int(sf) + col * uCPDim.x;
  vec3 c0 = texelFetch(uCP, ivec2(s, row), 0).xyz, c1 = texelFetch(uCP, ivec2(s + 1, row), 0).xyz;
  vec3 c2 = texelFetch(uCP, ivec2(s + 2, row), 0).xyz, c3 = texelFetch(uCP, ivec2(s + 3, row), 0).xyz;
  float f2 = f * f, f3 = f2 * f, g = 1. - f;
  vec3 P = (c0 * (g * g * g) + c1 * (3. * f3 - 6. * f2 + 4.) + c2 * (-3. * f3 + 3. * f2 + 3. * f + 1.) + c3 * f3) / 6.;
  float env = iC.y > 0.5 ? 1. : sin(3.14159265 * u);
  P += uSway * env * vec3(sin(uTime * 0.31 + P.y * 0.045 + P.z * 0.03), 0.6 * sin(uTime * 0.23 + P.x * 0.04), cos(uTime * 0.27 + P.x * 0.035 + P.y * 0.03));
  return P;
}
// Where a spark is, age seconds after its launch.
vec3 sparkAt(float age, out float fade, out float fall) {
  fall = 0.;
  if (iA.z > 0.5) {                               // finished by Auto: runs the length of the fiber
    float u = clamp(age / uDur.x, 0., 1.);
    fade = smoothstep(0., 0.03, u) * (1. - smoothstep(0.965, 1., u)) * (1. + 0.9 * smoothstep(0.90, 0.965, u));   // it brightens as it lands
    return centre(u);
  }
  float us = 0.08 + 0.28 * iA.w, ts = us * uDur.x * 1.6;    // handed to a person: runs a short way and slows to a stop
  float a = clamp(age / ts, 0., 1.), u = us * (1. - (1. - a) * (1. - a));
  vec3 P = centre(u);
  fade = smoothstep(0., 0.03, u) * (1. + 0.6 * smoothstep(0.8, 1., a));     // it flares where it stops
  float tf = age - ts - uDur.y;
  if (tf > 0.) {                                  // then lets go of the fiber and drops away
    float k = clamp(tf / uDur.z, 0., 1.), L = iC.x;
    vec3 kick = vec3(fract(iA.w * 37.71) - 0.5, 0.2, fract(iA.w * 91.17) - 0.5) * (0.04 * L);
    P += kick * tf - vec3(0., 0.5 * 0.42 * L * tf * tf, 0.);
    fall = k;
    fade *= pow(1. - k, 1.5);
  }
  return P;
}
void main() {
  float age = uClock - iA.x;
  float life = iA.z > 0.5 ? uDur.x : (0.08 + 0.28 * iA.w) * uDur.x * 1.6 + uDur.y + uDur.z;
  gl_Position = vec4(2., 2., 2., 1.);
  vP = vec2(0.); vA = vec4(0.); vTint = vec3(0.);
  if (age <= 0. || age >= life) return;
  float fadeH, fallH, fadeT, fallT;
  vec3 Ph = sparkAt(age, fadeH, fallH), Pt = sparkAt(max(age - uDur.w, 0.), fadeT, fallT);
  vec4 vh = uView * vec4(Ph, 1.), vt = uView * vec4(Pt, 1.);
  if (vh.z > -0.6 || vt.z > -0.6) return;
  float lift = iB.w * 2.6;                                  // in front of its own glass, behind anything nearer
  vh.z += lift; vt.z += lift;
  vec4 ch = uProj * vh, ct = uProj * vt;
  vec2 hv = uViewport * 0.5;
  vec2 ph = ch.xy / ch.w * hv, pt = ct.xy / ct.w * hv;       // pixels from the centre of the frame
  float ppu = uProj[1][1] * hv.y / -vh.z;
  float rpx = iB.w * ppu * mix(1., 0.62, fallH);            // sized by the glass it runs in
  float rc = max(rpx, uPxMin);
  vec2 ax = ph - pt;
  float len = length(ax);
  ax = len > 1e-3 ? ax / len : vec2(1., 0.);
  const float HALO = 3.0;                                   // reach of the glow round the tip, in fiber radii
  float back = max(len + rc, HALO * rc);
  float wT = mix(HALO, 1.0, smoothstep(HALO, 2.6 * HALO, len / rc));
  float along = aQ.x > 0.5 ? HALO * rc : -back;
  float across = aQ.y * (aQ.x > 0.5 ? HALO : wT) * rc;
  vec2 p = ph + ax * along + vec2(-ax.y, ax.x) * across;
  gl_Position = vec4(p / hv, aQ.x > 0.5 ? ch.z / ch.w : ct.z / ct.w, 1.);
  vP = vec2(along, across) / rc;
  vA = vec4(len / rc, fadeH * exp(-length(Ph - uCam) * uFog) * clamp(rpx / rc, 0.3, 1.), iA.z, fallH);
  vTint = iB.rgb;
}
`;
const FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vA;
flat in vec3 vTint;
out vec4 o;
void main() {
  float a = vP.x, c = vP.y, len = vA.x;
  float t = clamp(-a / max(len, 0.5), 0., 1.);              // 0 at the point, 1 at the end of the tail
  // the point of the spark: sharp ahead, a short hot streak behind it that stretches with its speed (at rest it is round)
  float along = a > 0. ? exp(-a * a / 0.5) : exp(a / mix(0.7, 2.6, smoothstep(0., 4., len)));
  float wc = mix(0.30, 0.19, clamp(-a / 6., 0., 1.));
  float tip = along * exp(-c * c / (2. * wc * wc));         // white hot, a filament inside the glass
  float tail = smoothstep(0., -2., a) * exp(-2.4 * t) * (1. - t) * exp(-c * c / 0.07);   // the light it leaves in the fiber
  float glow = exp(-(a + 0.8) * (a + 0.8) / 7.0 - c * c / 2.6);                         // the sheath round the point catching the light
  vec3 col;
  if (vA.z > 0.5) {
    col = mix(vTint, vec3(1.0, 0.98, 0.94), 0.55) * tip * 9.0 + vTint * (tail * 1.1 + glow * 0.7);     // FIX V14: the family hue with a white head
  } else {
    float f = 1. - 0.5 * vA.w;
    col = vec3(1.0, 0.56, 0.17) * tip * 4.2 * f + vec3(1.0, 0.40, 0.05) * (tail * 0.8 + glow * 0.42);
  }
  o = vec4(col * vA.y, 0.);
}
`;

// eigenvectors of a symmetric 3 x 3 (Jacobi), widest spread first
function axes3(xx, xy, xz, yy, yz, zz) {
  const a = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 20; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-12) continue;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
  }
  return [0, 1, 2].map((i) => ({ w: a[i][i], v: V3.norm([v[0][i], v[1][i], v[2][i]]) })).sort((m, n) => n.w - m.w);
}

export class Burst {
  // src: { lines(): the accessor in lines.js, model(): the current model from feed.js }
  constructor(canvas, src) {
    this.canvas = canvas; this.src = src;
    this.phase = 'idle';                    // idle | flying (camera on its way) | playing | done | error
    this.doc = null; this.n = 0; this.clock = 0; this.t0 = 0;
    this.count = { jobs: 0, done: 0, handedBack: 0, sparksDrawn: 0 };
    this.total = { jobs: 0, done: 0, handedBack: 0 };
    this.info = null;
    this.drawCalls = 0; this.triangles = 0;
  }
  get active() { return this.phase === 'flying' || this.phase === 'playing' || this.phase === 'done'; }
  get stats() { return { ...this.count }; }
  get state() {
    const i = this.info || {};
    return {
      phase: this.phase, t: this.active ? clamp(this.clock / REPLAY_SECONDS, 0, 1) : 0, seconds: REPLAY_SECONDS, ...this.count,
      wrong: i.wrong ?? null, modelCalls: i.modelCalls ?? null, wallSeconds: i.wallSeconds ?? null, slower: i.slower ?? null,
      skills: i.skills ?? 0, missing: i.missing ?? 0, total: { ...this.total },
    };
  }

  // Take a document. False when it is not a burst this viewer can read.
  read(doc) { const d = readBurst(doc); if (!d) return false; this.doc = d; return true; }
  fail() { this.phase = 'error'; this.n = 0; }
  // FIX V05: the GPU context was lost and has come back: the program and the buffers are made again, the schedule re-uploaded
  lost() { this.prog = null; this.vao = null; this.buf = null; if (this.active && this.doc) this._schedule(); }
  // FIX V14: the afterglow. As the replay ends, each fiber of the run holds a light in proportion to its share of the jobs
  // (the fiber with the most jobs is 1), for AFTER seconds, then it is back in its true state. It rises over the last
  // second of the replay, so the last frame is the fullest and not the emptiest. Null when there is nothing to hold.
  afterglow() {
    if (!this.active || !this.shares || this.clock < REPLAY_SECONDS - 1.2 || this.clock > REPLAY_SECONDS + AFTER) return null;
    const up = clamp((this.clock - (REPLAY_SECONDS - 1.2)) / 1.2, 0, 1), down = clamp((this.clock - REPLAY_SECONDS - 0.7) / (AFTER - 0.7), 0, 1);
    return { k: up * up * (3 - 2 * up) * (1 - down * down * (3 - 2 * down)), shares: this.shares };
  }
  stop() { this.phase = 'idle'; this.clock = 0; this.count = { jobs: 0, done: 0, handedBack: 0, sparksDrawn: 0 }; this.drawCalls = this.triangles = 0; this.drawn = false; }

  // Map the document onto today's fibers and start the clock. `at` is where in the replay to start (0..1),
  // `delay` holds the first spark back while the camera flies in. False when none of its skills has a fiber here.
  arm({ now, at = 0, delay = 0 }) {
    if (!this.doc || !this._schedule()) { this.n = 0; return false; }
    this.t0 = now + delay - clamp(at, 0, 1) * REPLAY_SECONDS;
    this.phase = 'flying'; this.ticks = 0; this.drawn = false;
    this.update(now);
    return true;
  }
  // The anatomy was rebuilt under a running replay: map again and keep the clock.
  remap() { return !!this.doc && this._schedule(); }

  _schedule() {
    const model = this.src.model(), L = this.src.lines(), R = this.doc.runs, K = R.length;
    const items = [], mapped = [], missing = [];
    let unread = 0;
    R.forEach((r, k) => {
      const s = model && model.byId.get(r.node);
      if (!s || s.fiber < 0 || !L.fiber(s.fiber)) { missing.push(r.node); return; }
      mapped.push(s);
      const o = r.outcomes, n = o.length, base = hash32(r.node);
      for (let i = 0; i < n; i++) {
        const ch = o.charCodeAt(i);
        if (ch !== 48 && ch !== 49) { unread++; continue; }                 // not a 1 or a 0: no spark is drawn for it
        // recorded order within the skill; the skills interleave; a little jitter so the stream is not a dotted line
        const p = (i + clamp((k + 0.5) / K + 0.9 * (hash01(base, i) - 0.5), 0.02, 0.98)) / n;
        items.push([LAUNCH * easeInv(p), s.fiber, ch === 49 ? 1 : 0, hash01(base ^ 0x5bd1e995, i)]);
      }
    });
    if (!items.length) return false;
    items.sort((a, b) => a[0] - b[0]);
    const N = items.length, inst = new Float32Array(N * 12), launchAt = new Float32Array(N), doneAt = [], handAt = [], per = new Map();
    for (let j = 0; j < N; j++) {
      const it = items[j];
      let f = per.get(it[1]);
      if (!f) { const fb = L.fiber(it[1]), c = linear(fb.skill.family.color); f = [c[0], c[1], c[2], fb.radius, fb.len, fb.closed ? 1 : 0, 0, 0]; per.set(it[1], f); }
      inst.set(it, j * 12); inst.set(f, j * 12 + 4);
      launchAt[j] = it[0];
      if (it[2]) doneAt.push(it[0] + RUN); else handAt.push(it[0] + stopT(it[3]));
    }
    // each fiber's share of the jobs, against the fiber with the most (for the afterglow)
    const cnt = new Map(); let most = 1;
    for (const it of items) { const c = (cnt.get(it[1]) || 0) + 1; cnt.set(it[1], c); if (c > most) most = c; }
    this.shares = new Map([...cnt].map(([f, c]) => [f, Math.sqrt(c / most)]));
    this.n = N; this.launchAt = launchAt;
    this.doneAt = Float32Array.from(doneAt).sort(); this.handAt = Float32Array.from(handAt).sort();
    this.total = { jobs: N, done: doneAt.length, handedBack: handAt.length };
    this._upload(inst);

    // what the framing needs: the fibers the sparks run on, and everything else that could stand in the way
    const fibers = [...per.keys()], pts = [];
    for (const i of fibers) for (let k = 0; k < 16; k++) pts.push(...L.point(i, (k + 0.5) / 16));
    this.pts = pts; this.fibers = new Set(fibers); this.others = null;
    const fams = new Map();
    for (const s of mapped) fams.set(s.family.id, s.family);
    const fam = fams.size === 1 ? [...fams.values()][0] : null, d = this.doc;
    const same = (a, b) => a == null || a === b;
    this.info = {
      skills: mapped.length, runs: K, missing: missing.length, unread,
      where: fam ? fam.label : `${fams.size} families`, color: fam ? fam.color : null, family: fam,
      wrong: d.wrong, modelCalls: d.modelCalls, wallSeconds: d.wallSeconds, day: d.day,
      slower: d.wallSeconds > 0 ? REPLAY_SECONDS / d.wallSeconds : null,
      // the file's own totals, when every job could be drawn: they must equal what was counted from the outcomes
      mismatch: !missing.length && !unread && !(same(d.jobs, N) && same(d.done, doneAt.length) && same(d.handedBack, handAt.length)),
    };
    return true;
  }

  _upload(inst) {
    const gl = (this.gl = this.gl || this.canvas.getContext('webgl2'));
    if (!this.prog) {
      this.prog = new Program(gl, { vs: VS, fs: FS }, 'burst');
      this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
      const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      for (let k = 0; k < 3; k++) { gl.enableVertexAttribArray(1 + k); gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 48, k * 16); gl.vertexAttribDivisor(1 + k, 1); }
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
  }

  // Once a frame, before drawing: advance the clock and count what has landed.
  update(now) {
    this.drawCalls = this.triangles = 0;
    if (!this.active) return;
    const t = (this.clock = now - this.t0);
    this.phase = t < 0 ? 'flying' : t < REPLAY_SECONDS - 1e-6 ? 'playing' : 'done';
    const done = upto(this.doneAt, t), handed = upto(this.handAt, t);
    this.count = { jobs: done + handed, done, handedBack: handed, sparksDrawn: upto(this.launchAt, t) };
    // A merge that loses the renderer hook or the accessor would leave counters rolling over an empty picture: say so once.
    if (t > 0.5 && t < REPLAY_SECONDS && ++this.ticks > 4 && !this.drawn && !this.warned) {
      this.warned = true;
      console.warn('burst: no sparks are being drawn. Check renderer.extraPass (FEATURE-MERGE in renderer.js) and src/lines.js.');
    }
  }

  // The one instanced additive draw, called by the renderer between its last scene pass and post.
  // F: { view, proj }, S: { time, sway, pos, fog } as the renderer has them for this frame.
  draw(F, S) {
    if (!this.active || !this.n || this.clock <= 0 || this.clock > REPLAY_SECONDS + HOLD + FALL + 0.5) return;
    const L = this.src.lines();
    if (!L.tex) return;
    const gl = this.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    this.prog.use().tex('uCP', 0, L.tex).i('uCPDim', L.cpn, L.rows).m4('uView', F.view).m4('uProj', F.proj).f('uViewport', w, h)
      .v3('uCam', S.pos).f('uClock', this.clock).f('uTime', S.time).f('uSway', S.sway || 0).f('uDur', RUN, HOLD, FALL, STREAK)
      .f('uPxMin', 0.9 * (h / 900)).f('uFog', S.fog || 0);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    gl.bindVertexArray(null);
    this.drawCalls = 1; this.triangles = this.n * 2; this.drawn = true;
  }

  // A camera framing that holds the fibers of this burst inside `safe` (a rectangle of the frame in NDC, x and y
  // from -1 to 1, y up) and looks at them from the clearest side: the broad face of the set, as few other fibers
  // in front as possible, a level horizon. Returns { pos, q, fov, focus, aperture } for camera.framing().
  pose(aspect, safe, fov = 0.72, force = null) {
    const P = this.pts, n = P.length / 3, L = this.src.lines();
    if (!this.others) {                        // sample every other fiber once, and measure the whole cloud of fibers
      const o = [], per = L.count > 6000 ? 3 : 7;
      for (let i = 0; i < L.count; i++) if (!this.fibers.has(i)) for (let k = 0; k < per; k++) o.push(...L.point(i, (k + 0.5) / per));
      this.others = o;
      const all = [o, P], m = [0, 0, 0];
      let cnt = 0, R = 0;
      for (const a of all) for (let i = 0; i < a.length; i += 3) { m[0] += a[i]; m[1] += a[i + 1]; m[2] += a[i + 2]; cnt++; }
      m[0] /= cnt; m[1] /= cnt; m[2] /= cnt;
      for (const a of all) for (let i = 0; i < a.length; i += 3) R = Math.max(R, Math.hypot(a[i] - m[0], a[i + 1] - m[1], a[i + 2] - m[2]));
      this.cloud = { c: m, R };
    }
    const O = this.others, cloud = this.cloud;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < P.length; i += 3) { cx += P[i]; cy += P[i + 1]; cz += P[i + 2]; }
    cx /= n; cy /= n; cz /= n;
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (let i = 0; i < P.length; i += 3) { const x = P[i] - cx, y = P[i + 1] - cy, z = P[i + 2] - cz; xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z; }
    const ax = axes3(xx, xy, xz, yy, yz, zz);
    const T = Math.tan(fov / 2), scx = (safe.x0 + safe.x1) / 2, scy = (safe.y0 + safe.y1) / 2, shx = (safe.x1 - safe.x0) / 2, shy = (safe.y1 - safe.y0) / 2;

    const tryDir = (dir) => {
      const back = V3.norm(dir);
      let right = V3.cross([0, 1, 0], back);
      if (V3.len(right) < 1e-3) right = V3.cross([0, 0, 1], back);
      right = V3.norm(right);
      const up = V3.cross(back, right);
      // the box of the set as this lens sees it; its centre is what the lens holds
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i] * right[0] + P[i + 1] * right[1] + P[i + 2] * right[2], y = P[i] * up[0] + P[i + 1] * up[1] + P[i + 2] * up[2], z = P[i] * back[0] + P[i + 1] * back[1] + P[i + 2] * back[2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const c = V3.add(V3.add(V3.scale(right, (x0 + x1) / 2), V3.scale(up, (y0 + y1) / 2)), V3.scale(back, (z0 + z1) / 2));
      // slide the camera sideways (rather than turn it) so the centre of the set sits at the centre of the safe area
      const eye = (d) => V3.sub(V3.addS(c, back, d), V3.add(V3.scale(right, scx * T * aspect * d), V3.scale(up, scy * T * d)));
      const ndc = (pos, x, y, z) => {
        const vx = x - pos[0], vy = y - pos[1], vz = z - pos[2], dz = -(vx * back[0] + vy * back[1] + vz * back[2]);
        return [(vx * right[0] + vy * right[1] + vz * right[2]) / (dz * T * aspect), (vx * up[0] + vy * up[1] + vz * up[2]) / (dz * T), dz];
      };
      const fill = (d) => {
        const pos = eye(d); let m = 0;
        for (let i = 0; i < P.length; i += 3) { const q = ndc(pos, P[i], P[i + 1], P[i + 2]); if (q[2] < 1) return 1e9; m = Math.max(m, Math.abs(q[0] - scx) / shx, Math.abs(q[1] - scy) / shy); }
        return m;
      };
      let lo = 1, hi = 4000;
      for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (fill(m) > 0.94) lo = m; else hi = m; }
      const d = hi, pos = eye(d);
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, near = 1e9;
      for (let i = 0; i < P.length; i += 3) {
        const q = ndc(pos, P[i], P[i + 1], P[i + 2]);
        bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); near = Math.min(near, q[2]);
      }
      // Other fibers in front of the set hide it (the nearer, the larger they loom), fibers right round the lens smear
      // over the frame, and fibers behind the set clutter it.
      let front = 0, behind = 0;
      const mx = (bx1 - bx0) * 0.04, my = (by1 - by0) * 0.04, clear = Math.max(2.5, (z1 - z0) * 0.08), reach = 0.3 * d;
      for (let i = 0; i < O.length; i += 3) {
        const q = ndc(pos, O[i], O[i + 1], O[i + 2]), z = q[2];
        if (Math.hypot(O[i] - pos[0], O[i + 1] - pos[1], O[i + 2] - pos[2]) < reach) front += 2;
        if (z < 0.5) continue;
        const inBox = q[0] > bx0 - mx && q[0] < bx1 + mx && q[1] > by0 - my && q[1] < by1 + my;
        if (z < near - clear) { if (inBox) front += Math.min(6, d / z); else if (Math.abs(q[0]) < 1.25 && Math.abs(q[1]) < 1.25) front += 0.35 * Math.min(6, d / z); }
        else if (inBox) behind++;
      }
      const area = ((bx1 - bx0) * (by1 - by0)) / (4 * shx * shy);          // how much of the safe area the set takes: edge-on views take little
      // a lens outside the cloud of fibers is out among the scaffolding, which may stand in the way
      const out = Math.max(0, V3.dist(pos, cloud.c) - cloud.R);
      return { pos, back, d, front, behind, area, out };
    };

    const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
    const bases = [ax[2].v, V3.scale(ax[2].v, -1)];
    if (ax[2].w > 0.3 * ax[1].w) bases.push(ax[1].v, V3.scale(ax[1].v, -1));     // not a flat set: its second axis is as good a side
    let best = null;
    const yaws = force ? [force[1]] : [0, 0.3, -0.3, 0.6, -0.6], pitches = force ? [force[2]] : [0.1, 0.3, -0.12, 0.52];
    for (const b of force ? [bases[force[0]] || bases[0]] : bases) for (const yaw of yaws) for (const pitch of pitches) {
      const f = rotY(b, yaw), dir = V3.norm([f[0], f[1] * 0.6 + Math.tan(pitch) * Math.max(0.5, Math.hypot(f[0], f[2])), f[2]]);
      const r = tryDir(dir);
      r.score = r.front * 1.0 + r.behind * 0.05 + r.out * 2 + (1 - Math.min(1, r.area)) * 60 + Math.abs(yaw) * 16 + Math.abs(pitch - 0.1) * 14 + (dir[2] < 0 ? 5 : 0);
      if (!best || r.score < best.score) best = r;
    }
    const pos = best.pos;
    // the whole set stays sharp (its nearest and farthest fibers blur by about a pixel at most); what is behind goes soft
    // A small aperture: sparks are drawn without depth of their own, so an ember that has let go of its fiber would
    // otherwise be blurred with whatever lies far behind it.
    // (air and fogK are read by the layout build's camera: inside air, the fog of the place)
    return { pos, q: Q.look(pos, V3.sub(pos, best.back)), fov, focus: best.d, aperture: 0.0011, air: 0, fogK: 1 };
  }
}
