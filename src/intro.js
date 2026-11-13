// INTRO: the opening sequence. About 55 seconds cut to the founder's track, then the controls are handed over with the
// page in exactly the state it reaches when it opens without an intro. See INTRO.md.
//
// THE ONE RULE OF THIS FILE: everything the sequence shows is a pure function of one number, its position t in seconds.
// While the track sounds (first pass), t IS the music's position (window.__MM_SOUND.clock().pos). Camera, growth, light,
// title and panels are computed from t every frame; nothing is accumulated, so the picture cannot drift from the music,
// a dropped frame costs nothing, and any moment can be shown frozen (lab=1&intro=1&introt=<seconds>).
// Only when the sound is off, or there is no track, does t advance by itself, by frame time.
//
// What is true is not changed here. Growth is the page's own Growth slider (dated skills in the order they were learned;
// only the pace of the whole is direction). Undated skills are never shown forming: they are present throughout and take
// the light with the rest of the body. Light is direction: in the dark of the opening only the first fiber has light.
// No number, date or caption is shown inside the sequence; no spark, burst or replay of events.

import { V3, Q, clamp, mix, smoothstep } from './math.js?v=mweb9mux';

// ---------------------------------------------------------------- THE WORDS (the founder's; change a word or a time here, nothing else)
// INTRO WORDS. Times are music positions in seconds. Each line arrives on its time (drawing itself in, left to right) and
// has gone by its end. A time within 0.03 s of a bar line, or of a phrase moment of the cue sheet, is that moment exactly.
// The credits play only in the full cut (meta anatomy-intro "on", or intro=1); the short cut ("short") ends at 54.863 as
// it always did. Each card is gone half a second before the next arrives; the last is gone by cardsEnd.
export const WORDS = {
  lines: [
    { at: 6.385, end: 9.6, text: 'This is the first thing Auto learned.' },
    { at: 12.363, end: 19.0, text: 'Every fiber is one skill.' },
    { at: 19.863, end: 24.4, text: 'Most AI starts from nothing every time.' },
    { at: 24.863, end: 29.4, text: 'Auto keeps what he learns.' },
    { at: 29.863, end: 37.4, text: 'What he has learned, he does himself.' },
  ],
  cards: [
    { at: 44.863, head: 'Auto', text: 'A new kind of AI system.' },
    { at: 49.863, head: 'He learns', text: 'The first time he meets a job, a model works it out. Auto keeps what worked.' },
    { at: 54.863, head: 'He remembers', text: 'The next time, he does the job himself. From memory.' },
    { at: 59.863, head: 'He builds on it', text: 'From what he has learned, he does brand-new things no one has shown him.' },   // FOUNDER, 12 Nov 3:31 PM: "your down playing it he can also do brand new stuff from what hes learned" (note 8). Never undersell this.
    { at: 64.863, head: 'He knows his limits', text: 'When he is not sure, he hands the job back to the model.' },
    { at: 69.863, head: 'Autogenic', text: 'This is everything Auto has learned so far.' },
  ],
  cardsEnd: 74.363,
  skip: 'Skip',                       // the quiet control at the lower right (its key cap says Esc)
};

// ---------------------------------------------------------------- THE TWO STRENGTHS (the founder may ask for more or less)
export const BASS_LIGHT = 0.04;      // the light of the whole room rises with the bass of the track: 0.04 is 4 percent of pixel level at the loudest bass (applied after the display curve, so about 9 percent of linear light; the bass of the track swings between about 0.35 and 1, so the felt swing is some 6 percent of light)   // INTRO REPAIR: was 0.07 (the checker measured it breathing visibly)
export const HIT_LIGHT = 0.07;       // INTRO R2: the answer to a strong hit of the track: the highlights of the whole frame flare by 7 percent at a full-strength hit, and the glints of the glass by ten times that (x1.7), gone within a quarter second. (Was HIT_GLINT = 0.5 on the glints alone: too small a part of the light to be seen, measured +0.4 percent)

// Used only when the cue sheet cannot be read: the same measured tempo (96 a minute, bar lines at -0.137 + 2.5 n).
const FALLBACK = { tempo: { downbeat: -0.137, bar: 2.5 }, moments: [{ t: 3.437, kind: 'fall' }, { t: 6.385, kind: 'enter' }], hits: [], envelope: null };
const CUES_URL = new URL('../audio/ambient.cues.json?v=mweb9mux', import.meta.url).href;

// The dark of the opening is air: how far the lens can see. At house light 0 the air is black some 22 units out (the
// first fiber and its nearest neighbours only); at 1 it is the page's own air (FOG_IN in main.js, about 700 units).
const SEE_DARK = 22, SEE_FULL = 700;
const U0 = 0.385;
const OPEN = 2.4;                    // how far the lens opens on the lone first fiber (exposure times this, back to 1 by the breath before the bass)                    // where along the first fiber the lens first looks (its record is centred on 0.5)
const TRACK = [0.04, 0.62];           // INTRO REPAIR: where along the river the weave's tracking shot starts and ends (0..1 of its middle line)
const TIP = 0;                      // INTRO R2: how lit the forming tip is while the lens is close (1 is the slider's own): unlit to the bass (at 0.2 a near forming tip still stood as a flat pink bar, mock 12 s; the fibers still visibly grow by their length), then back to full over the first bar of the bass, so the weave is seen drawing itself   // INTRO REPAIR: was 0.2 throughout
const CRANE_J = 26.0;               // INTRO R2: where the crane that starts on the bass joins the weave's own move (from here on the weave is exactly as it was: the gold tracking shot)
const PAGE = 'intro';               // body classes: intro (the sequence owns the page), intro-play (pointer hidden), intro-wait (Click to begin)

// ---------------------------------------------------------------- small pure helpers
const ss = (a, b, x) => smoothstep(a, b, x);
const sCurve = (u) => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };     // smoother step: no jolt at either end
// Monotone cubic through knots (Fritsch-Carlson): a curve that never runs backwards (growth must not shrink).
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}
const logMix = (a, b, e) => Math.exp(mix(Math.log(Math.max(a, 1e-3)), Math.log(Math.max(b, 1e-3)), e));
function mixPose(a, b, e) {
  return {
    pos: V3.lerp(a.pos, b.pos, e), q: Q.slerp(a.q, b.q, e), fov: mix(a.fov, b.fov, e), focus: logMix(a.focus, b.focus, e),
    aperture: mix(a.aperture, b.aperture, e), air: mix(a.air || 0, b.air || 0, e), fogK: mix(a.fogK == null ? 1 : a.fogK, b.fogK == null ? 1 : b.fogK, e),
    clear: mix(a.clear || 0, b.clear || 0, e), near: mixNear(a, b, e),
  };
}
// INTRO REPAIR: the clearing round the lens, as [gone, whole] in units from the lens (FIBER_VS uNearEase; renderer.js takes
// S.near when it is given, else 7 and 22 x clear as in the page's flights). In the close-up a neighbour that passes
// between the lens and the first fiber is gone before 0.55 of the focus distance and whole only beyond 0.8 of it, so it never
// crosses the lens as a flat hot slab (a rod pointing at the lens is drawn as a flat wedge: its ribbon turns edge-on).
const nearOf = (p) => p.near || [7 * (p.clear || 0), 22 * (p.clear || 0)];
function mixNear(a, b, e) { const x = nearOf(a), y = nearOf(b); return [mix(x[0], y[0], e), mix(x[1], y[1], e)]; }
const bez = (a, c, b, e) => { const g = 1 - e; return [a[0] * g * g + c[0] * 2 * g * e + b[0] * e * e, a[1] * g * g + c[1] * 2 * g * e + b[1] * e * e, a[2] * g * g + c[2] * 2 * g * e + b[2] * e * e]; };

// ---------------------------------------------------------------- the music, read from the cue sheet (a description of the track only)
// The envelope of the bass at a music position, eased over the last 0.15 s so the room breathes rather than flickers.
function bassAt(cues, pos) {
  const E = cues && cues.envelope; if (!E || !E.bass) return 0;
  const at = (p) => { const x = p / E.step, i = Math.floor(x), f = x - i, a = E.bass[clamp(i, 0, E.bass.length - 1)], b = E.bass[clamp(i + 1, 0, E.bass.length - 1)]; return a + (b - a) * f; };
  return (at(pos) + at(pos - 0.05) + at(pos - 0.10) + at(pos - 0.15)) / 4;
}
// How far the glints stand up on a strong hit: the strongest hit of the last quarter second, falling back to nothing.
function hitAt(cues, pos) {
  const H = cues && cues.hits; if (!H || !H.length) return 0;
  let lo = 0, hi = H.length;                                     // the first hit after pos
  while (lo < hi) { const m = (lo + hi) >> 1; if (H[m][0] <= pos) lo = m + 1; else hi = m; }
  let k = 0;
  for (let i = lo - 1; i >= 0 && pos - H[i][0] < 0.25; i--) {
    const a = clamp((H[i][1] - 0.3) / 0.25, 0, 1), age = (pos - H[i][0]) / 0.25;   // INTRO REPAIR: full at strength 0.55 (was 0.7: of the 45 hits over 0.3 only a handful came near half; measured flat)
    k = Math.max(k, a * (1 - age) * (1 - age));
  }
  return k;
}

// ---------------------------------------------------------------- the sequence
export class Intro {
  // h: { app, camera, overlay, reset(), still, reduced, shot, lab, qs }
  constructor(h) {
    this.h = h; this.cues = FALLBACK;
    this.state = 'off'; this.t = 0; this.log = {};
    this.phase = '';                   // inside 'waiting': 'armed' (Click to begin), 'starting' (the track is on its way), 'restart'
    this.clock = 'silent';             // 'music' (t is the track's position) or 'silent' (t runs on frame time)
    this.since = 0; this.hold = -1;
    this.frozen = null;                // the frozen position of a lab still (introt), or null
    this.vars = {};
    const qs = h.qs, m = document.querySelector('meta[name="anatomy-intro"]');
    const ask = qs.get('intro'), mc = m ? m.content : '';
    this.wanted = ask === '1' || ask === 'short' ? true : ask === '0' ? false : mc === 'on' || mc === 'short';
    // INTRO WORDS: the full cut (the credits, hand-over at 79.863) or the short cut the founder approved (hand-over at 54.863)
    this.long = ask === '1' ? true : ask === 'short' ? false : mc !== 'short';
    const ok1 = ask === '1' || ask === 'short';
    // It never plays: with a deep link, any shot, a still, an autopilot setting in the address, the lab (unless intro=1 is
    // given too), or reduced motion. (The feed rules are checked against each feed, in ok().)
    this.barred = !!(qs.get('focus') || h.shot || h.still || qs.get('autopilot') != null || (h.lab && !ok1) || h.reduced);
    if (h.lab && ok1 && qs.get('introt') != null && isFinite(parseFloat(qs.get('introt')))) this.frozen = Math.max(0, parseFloat(qs.get('introt')));
    // INTRO REPAIR: the cue sheet is read only where it can be used: for the sequence, or for the light that follows the music
    // (never in a still, a shot, the lab without the intro, or with reduced motion). Elsewhere the measured tempo stands in.
    this.wordsOn = !(h.lab && ok1 && qs.get('words') === '0');   // INTRO WORDS: lab only, words=0 plays the sequence without its words
    this.words = new Words(this); LAST = this;
    this.moved = 1e9;                                            // INTRO WORDS: seconds of frame time since the pointer last moved (the Skip key shows for three)
    this.skipBtn = document.getElementById('intro-skip');
    if (this.skipBtn) { const sp = this.skipBtn.querySelector('span'); if (sp) sp.textContent = WORDS.skip; this.skipBtn.addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); this.skip(); }); }
    addEventListener('pointermove', () => { this.moved = 0; }, { passive: true });
    const useful = (this.wanted && !this.barred) || !(h.still || h.shot || h.lab || h.reduced);
    this.cuesReady = !useful ? Promise.resolve() : fetch(CUES_URL, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && c.tempo && c.tempo.bar > 0) this.cues = c; }).catch(() => {}).then(() => this._anchors());
    this._anchors();
    this.btn = document.getElementById('btn-intro');
    this.line = document.getElementById('intro-begin');
    if (this.btn) this.btn.addEventListener('click', (e) => { if (e.detail) e.currentTarget.blur(); this.play(); });
    // The person's first click or key press, while the black frame waits for it. sound.js starts the track on the same gesture.
    const wake = (e) => {
      if (this.state !== 'waiting' || this.phase !== 'armed') return;
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey || /^[mMvV]$/.test(e.key))) return;     // M and V do their own job (sound.js wakes the track on V anyway, and the sequence follows the track)
      this._starting();
    };
    addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
  }

  // The anchors, all on bar lines of the cue sheet. Nothing here is rounded: bar n is downbeat + bar * n.
  _anchors() {
    const T = this.cues.tempo, bar = (n) => T.downbeat + T.bar * n;
    const mo = this.cues.moments || [], at = (kind, near, d) => { const x = mo.find((k) => k.kind === kind && Math.abs(k.t - near) < 0.6); return x ? x.t : d; };
    this.A = {
      light: bar(1),                 // 2.363: the first fiber is up out of black on the first bar line
      full: at('fall', 3.44, 3.437), // the first fiber is whole by the first fall of the phrase
      rise: at('enter', 6.39, 6.385),// the next fibers of the record take the light on the rise
      strands: bar(4), weave: bar(8), reveal: bar(16), dive: bar(18), arrive: bar(22),
      // INTRO WORDS: the full cut rides the rail on from stop 0 (arrive) through the credits and hands over where the music
      // falls back (79.863), the panels coming in over its last two bars; the short cut is exactly as it was
      totals: this.long ? bar(30) : bar(19), labels: this.long ? bar(31) : bar(20), dock: this.long ? bar(32) : bar(21), hand: this.long ? bar(32) : bar(22),
      breath: bar(8) - 0.86,         // 19.0: the breath before the bass
    };
    const A = this.A;
    // GROWTH (the Growth slider, 0..1). A dated fiber of rank b forms between b * 0.94 and b * 0.94 + 0.06 (FIBER_VS), so the
    // first fiber is whole at 0.06. The tip of the first fiber slows as it passes the lens and races round the rest.
    // The tip passes the lens (u = U0) as the picture rises, draws away along the loop into the dark, then runs round the rest.
    // INTRO REPAIR (third sitting): the weave's move, 0..1 over 19.86 to 39.36: its speed rises as u^1.3 and falls to rest
    // over the last 14 percent (about 2.7 s), so most of the travel is late and it lands just before the held half second
    // INTRO R2: the move no longer comes to rest before the hold: it keeps gathering pace to about 39.2 s and brakes over the
    // last 0.3 s into the held half second (N3). Up to 36.6 s it is exactly the old move (same speeds, same scale: the
    // old total), so the gold tracking shot is as it was; past that it simply goes on, further down the river (e > 1).
    { const xs = [0], ys = [0], N = 40; let acc = 0;
      for (let k = 1; k <= N; k++) { const um = (k - 0.5) / N; acc += Math.pow(um, 1.3) * (1 - smoothstep(0.86, 1, um)); xs.push(k / N); ys.push(acc); }
      const old = monotone(xs, ys.map((y) => y / acc)), U1 = 0.85, e1 = old(U1);
      // past U1: the same speed, u^1.3 (the old curve's slope is speed x N / acc), braking only over the last 0.7 percent (0.14 s)
      const fx = [U1], fy = [e1], M = 60; let f = e1;
      for (let k = 1; k <= M; k++) { const a = U1 + (1 - U1) * (k - 1) / M, b = U1 + (1 - U1) * k / M, um = (a + b) / 2; f += Math.pow(um, 1.3) * (1 - smoothstep(0.993, 1, um)) * (b - a) * N / acc; fx.push(b); fy.push(f); }
      const ext = monotone(fx, fy);
      this.craneO = old; this.craneE = (u) => (u <= U1 ? old(u) : ext(u)); this.craneX = ext(1) - old(1); }
    this.trav = monotone([A.strands, 12.6, 18.4, A.breath, A.weave], [0, 0.1, 0.86, 0.97, 1]);   // INTRO R2: the track along the coil, 0..1: eased in, even, almost still in the breath
    if (this.words) this.words.build();                          // INTRO WORDS: the lines and cards, on the sheet's bar lines
    this.g1 = monotone([0, 0.5, A.light, A.full, A.rise, A.strands, 15.0, A.breath, A.weave], [0, U0 * 0.06, (U0 + 0.13) * 0.06, 0.06, 0.066, 0.074, 0.088, 0.0985, 0.10]);
  }

  // May this feed carry the sequence? It needs skills, and at least two dated ones: a record to grow along.
  ok() { const m = this.h.app.model; return !!(m && !m.error && m.skills.length && m.dated && m.dated.length >= 2 && m.dated[0].fiber >= 0); }
  get allowed() { return this.wanted && !this.barred && this.ok(); }
  get active() { return this.state === 'waiting' || this.state === 'playing'; }

  // ------------------------------------------------------------ boot: decide, and begin
  boot() {
    this.rig();
    if (this.btn) this.btn.hidden = !this.allowed;
    if (!this.allowed) return;
    if (this.frozen != null) { this._enter(); this.state = 'playing'; this.clock = 'frozen'; this.t = this.frozen; document.body.classList.add('still'); return; }
    const S = window.__MM_SOUND;
    this._enter();
    if (S && S.arm && !S.armed && !S.on) S.arm();   // FOUNDER, 12 Nov 6:39 PM: the film always opens on Click to begin and starts the sound, even if the sound was switched off on an earlier visit (sound.js arm(); only the embedding page's meta keeps it silent)
    if (S && S.armed) { this.state = 'waiting'; this.phase = 'armed'; document.body.classList.add('intro-wait'); if (this.line) this.line.hidden = false; }
    else if (S && S.on) { this.state = 'waiting'; this._starting(); }          // an embedding page started the sound itself: the sequence starts with it
    else { this.state = 'playing'; this.clock = 'silent'; this.t = 0; this.wasOff = true; document.body.classList.add('intro-play'); }
  }
  // the gesture has come (or the sound started by other means): hold black until the track sounds
  _starting() {
    this.phase = 'starting'; this.since = 0;
    document.body.classList.remove('intro-wait'); if (this.line) this.line.hidden = true;
    document.body.classList.add('intro-play');
  }
  _enter() {
    this.log = {}; this.t = 0; this.hold = -1;
    document.body.classList.add(PAGE);
    this._vars(0, 0, 0, 0);
  }

  // ------------------------------------------------------------ geometry for this anatomy (once per anatomy, never per frame)
  rig() {
    const app = this.h.app, m = app.model, a = app.anat;
    this.R = null;
    if (!this.ok() || !a) return;
    const s = m.dated[0], fi = s.fiber, f = a.fibers[fi];
    // the middle of the first fiber's loop (or of its arc): the side the strands of its bundle gather on
    let c = [0, 0, 0]; const K = 48; for (let k = 0; k < K; k++) c = V3.add(c, a.point(fi, (k + 0.5) / K).p); c = V3.scale(c, 1 / K);
    const mus = f.muscle;
    let rho = 0; for (let k = 0; k < K; k++) rho += V3.dist(c, a.point(fi, (k + 0.5) / K).p) / K;    // INTRO REPAIR: how wide its loop is (mock 48, real 22): the bundle shot is framed by it
    this.R = { fi, len: f.len, closed: !!f.closed, radius: f.radius, center: c, rho, muscle: mus, mCenter: mus.center || c, coilD: 0.2 * rho + 3, ring: rho < 32 };   // INTRO R2: ring: a loop small enough to show whole from the bundle view (real 22: its clean ring); a larger one (mock 48: a thin dim arc from there) is travelled instead   // INTRO R2: coilD, how far the lens travels from the first fiber in the first strands (mock 12.6 units, real 7.4)
    // INTRO REPAIR (third sitting): the middle line of the river (the research muscle), for the weave's tracking shot: the
    // mean of up to 40 of its fibers at 25 places along them (each turned to run the same way as the first). A camera path
    // only; it marks nothing. No river (another feed's anatomy): the weave ends on the high view as before.
    const rm = a.muscleById.get('research'), rf = [];
    if (rm) a.fibers.forEach((x, i) => { if (x.muscle === rm && !x.closed) rf.push(i); });
    if (rf.length >= 3) {
      const step = Math.max(1, Math.floor(rf.length / 40)), pick = rf.filter((_, k) => k % step === 0), N = 24, pts = [];
      const ref = V3.sub(a.point(pick[0], 1).p, a.point(pick[0], 0).p), flip = pick.map((i) => V3.dot(V3.sub(a.point(i, 1).p, a.point(i, 0).p), ref) < 0);
      for (let k = 0; k <= N; k++) { let q = [0, 0, 0]; pick.forEach((i, j) => { q = V3.add(q, a.point(i, flip[j] ? 1 - k / N : k / N).p); }); pts.push(V3.scale(q, 1 / pick.length)); }
      let w = 0; pick.forEach((i, j) => { w += V3.dist(a.point(i, 0.5).p, pts[N / 2]) / pick.length; });
      this.R.river = pts; this.R.riverW = w;
      // the growth by which a third of the river has formed (undated fibers are there from the start): the lens turns to
      // the river no sooner than that, so it never looks down an empty river bed (the real feed learned its river late)
      const at = rf.map((i) => { const b = a.fibers[i].skill.birth; return b >= 0 ? 0.94 * b + 0.06 : 0; }).sort((x, y) => x - y);
      this.R.riverG = at[Math.floor(0.35 * (at.length - 1))];
      // the move's two parts measured once (the crane from the bundle, the track along the river), so its speed is even
      // across the join
      const E0 = this._track(TRACK[0]).pos, B = this._bundle();
      let lt = 0; for (let k = 0; k < 16; k++) lt += V3.dist(this._river(mix(TRACK[0], TRACK[1], k / 16)), this._river(mix(TRACK[0], TRACK[1], (k + 1) / 16)));
      const lc = 1.3 * V3.dist(B.pos, E0);
      this.R.join = lc / (lc + lt);
    }
  }
  // GROWTH at t (the Growth slider, 0..1): the first strands creep (g1), then on the bass it gathers pace: most of the body
  // arrives in the second half, the last fibers land just before the hit
  _g(t) {
    const A = this.A;
    if (t < A.weave) return this.g1(t);
    // INTRO R2: on the bass the growth takes off at once (0.03 of the record a second: every forming fiber draws half its
    // length a second), glides, and from CRANE_J + 1 runs exactly its old course (so the river and the gold tracking shot are
    // as they were). A cubic in time between the two, its end value and pace the old curve's; it never runs backwards.
    const T1 = CRANE_J + 1;
    if (t >= T1) return this._gOld(t);
    const h = T1 - A.weave, x = (t - A.weave) / h, y0 = 0.10, y1 = this._gOld(T1), m0 = 0.03 * h, m1 = (this._gOld(T1) - this._gOld(T1 - 0.01)) / 0.01 * h;
    const x2 = x * x, x3 = x2 * x;
    return (2 * x3 - 3 * x2 + 1) * y0 + (x3 - 2 * x2 + x) * m0 + (-2 * x3 + 3 * x2) * y1 + (x3 - x2) * m1;
  }
  _gOld(t) { const A = this.A, u = clamp((t - A.weave) / (A.reveal - 0.62 - A.weave), 0, 1); return 0.10 + 0.90 * (1 - Math.cos(Math.PI * Math.pow(u, 1.5))) / 2; }
  // INTRO REPAIR (third sitting): a point on the river's middle line (Catmull-Rom through the 25 means)
  _river(s) {
    const P = this.R.river, n = P.length - 1, x = clamp(s, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)], f2 = f * f, f3 = f2 * f;
    return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * f3));
  }
  // INTRO REPAIR (third sitting): the lens travelling down the river at s: above it and a little to one side, looking
  // ahead along it, so the strands stream toward the lens and under it
  _track(s) {
    const R = this.R, c = this._river(s), tan = V3.norm(V3.sub(this._river(s + 0.05), this._river(s - 0.05)));
    let side = V3.cross(tan, [0, 1, 0]); side = V3.len(side) > 1e-3 ? V3.norm(side) : [1, 0, 0];
    const W = R.riverW, eye = V3.add(V3.addS(c, side, 0.55 * W), [0, 0.9 * W + 8, 0]), tgt = V3.addS(this._river(s + 0.2), side, 0.1 * W);
    return { pos: eye, q: Q.look(eye, tgt), tgt, fov: 0.7, focus: V3.dist(eye, tgt), aperture: 0.006, air: 0.2, fogK: 0.8, clear: 0 };
  }
  // A point on the first fiber and its frame: tangent, toward the middle of its loop, and the loop's axis.
  _frame(u) {
    const R = this.R, a = this.h.app.anat;
    u = R.closed ? ((u % 1) + 1) % 1 : clamp(u, 0, 1);
    const { p, t } = a.point(R.fi, u);
    let n = V3.reject(V3.sub(R.center, p), t); n = V3.len(n) > 1e-3 ? V3.norm(n) : V3.perp(t);
    return { p, t, n, b: V3.cross(t, n) };
  }

  // ------------------------------------------------------------ the shot at position t: pure, nothing kept from the last frame
  // Returns { pose, growth, railT, look: { solo, soloK, house, room, fade }, panels: [title, totals, labels, dock] }
  shot(t) {
    const A = this.A, R = this.R, cam = this.h.camera;
    // GROWTH
    const g = this._g(t);   // INTRO REPAIR: the growth curve moved to _g(t) (the weave's camera reads it too)
    // LIGHT. soloK: every fiber but the first, dark until the rise, up over one bar. house: the air, the shafts and the far
    // structure come up as the body weaves itself; the cut to the plate is at full light.
    const soloK = ss(A.rise, A.rise + 2.5, t);
    const house = t >= A.reveal ? 1 : t < A.strands ? 0.12 * ss(A.rise, A.strands, t) : t < A.weave ? mix(0.12, 0.86, 1 - Math.pow(1 - clamp((t - A.strands) / (A.breath - A.strands), 0, 1), 3)) : mix(0.86, 0.95, sCurve((t - A.weave) / (A.reveal - 0.5 - A.weave)));
    const fade = ss(0, A.light, t) * (0.35 + 0.65 * ss(0, A.light, t));          // up out of the page's black, ending on the first bar line
    let room = 1;
    if (t < A.reveal) room = 1 - 0.25 * ss(A.reveal - 0.5, A.reveal - 0.06, t);  // the intake of breath before the hit
    else if (t < A.reveal + 0.6) { const k = 1 - (t - A.reveal) / 0.6; room = 1 + 0.33 * k * k; }   // one flash of exposure on the hit
    // CAMERA
    let pose;
    if (t < A.reveal) pose = this._inside(t);
    else if (t < A.dive) pose = this._plate(t);
    else if (t < A.arrive || !this.long) pose = this._dive(t);
    else pose = { ...cam.railPose(t - A.arrive), clear: 0 };      // INTRO WORDS: the full cut: on the rail exactly as the autopilot rides it from stop 0
    // PANELS: the lockup lands on the hit, fast; the rest on bar lines, each with a short fade
    const fadeIn = (at, d) => clamp((t - at) / d, 0, 1);
    const panels = [fadeIn(A.reveal, 0.16), fadeIn(A.totals, 0.45), fadeIn(A.labels, 0.45), fadeIn(A.dock, 0.45)];
    // the lens opens on the lone fiber in the dark (as the page opens it for a dim library, main.js app.expo) and closes
    // again as the body comes up round it
    // INTRO REPAIR: closes over the whole weave (was by 22.4), so the first half of the weave is not dark on a resting library.
    // INTRO REPAIR (third sitting): on a dim library (the page's own app.expo, above 1 when most skills rest: the real feed)
    // it closes only part of the way during the weave, so the weave is not a dark frame; the cut to the plate is at the
    // page's own exposure (1 here: the plate is drawn exactly as on a normal open).
    const lib = Math.max(1, this.h.app.expo || 1), expo1 = mix(OPEN, mix(1, lib, 0.75), ss(A.strands, A.reveal - 3, t));
    // INTRO R2: the lens stays open on the first strands until the breath before the bass, then closes onto its old course by CRANE_J
    const open = OPEN * (1 + 0.35 * ss(A.strands, A.strands + 2.7, t) * (1 - ss(A.breath - 1.5, A.breath, t)));   // and opens further while it travels the dim coil (the strands are hairs at this range)
    const expo = t >= A.reveal ? 1 : t < A.breath ? open : t < A.weave + 2.5 ? OPEN : mix(OPEN, expo1, ss(A.weave + 2.5, CRANE_J, t));   // (held open through the first bar of the bass, while the lens leaves the coil)
    // INTRO REPAIR (third sitting): in the opening no fiber but the first may stand wide in the frame (FIBER_VS uNearR: whole
    // while its radius is under 1.2 percent of the frame's height, gone at 3 percent). A thick rod beside the first fiber stood
    // as a flat hot slab at 7.5 s (real feed) and 12 s (mock); no clearing by distance removed it without taking the first
    // fiber too. Released over the first bar and a bit of the weave; from there the flight's clearing by distance takes over.
    // INTRO R2: and whatever comes nearer the lens than the subject fades out by distance (pose.nearF, FIBER_VS uNearF).
    const tip = t < A.rise ? 0.2 : t < A.weave ? TIP : mix(TIP, 1, ss(A.weave, A.weave + 2.5, t));   // (0.2 as before on the lone first fiber, so the first six seconds are as they were; nothing else is lit before the rise)   // INTRO R2: the forming tip back to full over the first bar of the bass
    // INTRO R2: the width cap is back, but it now FADES a neighbour that would stand too wide in the frame (a thick rod at
    // the first fiber's own distance, which no clearing by distance can take without the first fiber), instead of thinning
    // it into a fleck. Released by widening over the first bar and a bit of the weave, as before.
    const nk = 1 - ss(A.weave, A.weave + 3, t), nearR = nk > 1e-3 ? [0.02 / nk, 0.036 / nk] : null;
    return { pose, growth: clamp(g, 0, 1), railT: t - A.arrive, look: { solo: R.fi, soloK, nearR, tip, house, room, fade, expo, bare: t < A.weave + 2.5, glint: mix(1.5, 1, ss(A.rise, A.strands, t)) }, panels };
  }

  // 1: the lens on the first fiber.
  _closeUp(t) {
    const R = this.R, A = this.A, L = R.len;
    const s = 7.5 * ss(0.3, A.strands + 4, t);                    // a slow drift along the fiber, in units
    const u = U0 + s / L;
    const F = this._frame(u), ph = 0.55 + 0.30 * (t / A.strands);  // the lens turns a little round the glass, so its glints travel
    const side = V3.add(V3.scale(F.n, -Math.cos(ph)), V3.scale(F.b, Math.sin(ph)));
    // a three-quarter view from beside and a little behind, as the page's own close-up of a fiber (camera.js focusPose)
    const d = clamp(R.radius * 24, 4.5, 7.5);
    const eye = V3.addS(V3.addS(F.p, side, d), F.t, -d * 0.42);
    const ahead = this._frame(u + (d * 0.35) / L).p;
    const focus = V3.dist(eye, ahead);
    return { pos: eye, q: Q.look(eye, ahead), fov: 0.58, focus, aperture: 0.026, air: 0, fogK: 1, clear: 0, near: [0.55 * focus, 0.8 * focus], nearF: [0.6 * focus, 1.05 * focus], side };   // INTRO R2: + nearF: a neighbour nearer than the first fiber fades out by distance (only the others: the first fiber is untouched, so the first six seconds are as they were)   // INTRO REPAIR: nothing nearer than about half the way to what is in focus (the first fiber itself is at least 0.8 of it from the lens where it is in frame)
  }
  // 2: the first bundle, seen whole. The lens backs away the way it was looking from, and keeps the place on the first
  // fiber in the frame, so the strands gathering round it are the subject all the way out.
  // INTRO REPAIR (third sitting): one framing for every loop, sized by its width (mock 48 units, real 22): an oblique
  // view from above the loop on the first fiber's side and a little behind its place, looking at a point between that
  // place and the loop's middle, from about two loop-widths away. The whole coil sits in the frame with its near arc large
  // (was: on the mock the lens stood inside the coil, among blurred near strands, looking at empty air).
  _bundle() {
    const R = this.R, u = U0 + 7.5 / R.len, F = this._frame(u);
    const up = F.b[1] < 0 ? V3.scale(F.b, -1) : F.b;              // the loop's axis, turned to the upper side
    const tgt = V3.lerp(F.p, R.center, 0.45);
    const dir = V3.norm(V3.add(V3.add(V3.scale(up, 0.62), V3.scale(F.n, -0.62)), V3.scale(F.t, -0.48)));
    const eye = V3.addS(tgt, dir, 2.0 * R.rho + 24);
    const focus = V3.dist(eye, tgt);
    return { pos: eye, q: Q.look(eye, tgt), fov: 0.66, focus, aperture: 0.008, air: 0, fogK: 1, clear: 0, near: [0.12 * focus, 0.35 * focus] };
  }
  // the end of the weave: high inside the body, looking down across the river, much tighter than the plate it cuts to
  _high() {
    const P = this.h.camera.platePose(), C = V3.addS(P.pos, Q.basis(P.q)[2], -P.focus);   // the plate's own target: the middle of the body
    const river = this.h.app.anat.muscleById.get('research'), rc = river && river.center ? river.center : C;
    // INTRO REPAIR: tighter and on the gold alone (was a wider view half way to the middle of the body, which already showed
    // the teal tufts and the coil the plate reveals): the cut at 39.86 now changes scale and colour, not only angle.
    const tgt = V3.lerp(rc, C, 0.12), eye = V3.add(tgt, [-46, 112, 40]);
    return { pos: eye, q: Q.look(eye, tgt), fov: 0.62, focus: V3.dist(eye, tgt), aperture: 0.006, air: 0.2, fogK: 0.8, clear: 0 };
  }
  _inside(t) {
    const A = this.A;
    if (t < A.strands) return this._closeUp(t);
    if (t < A.weave) return this.R.ring ? this._ringBack(t) : this._coil(t);   // INTRO R2: the first strands: a small loop is shown whole (the real feed's ring), a large one is travelled close (the mock's coil)
    if (t < CRANE_J) return this._crane(t);                        // INTRO R2: the crane, starting on the bass
    return this._weave(t);
  }
  // INTRO R2: 2, the first strands. The lens rises off the first fiber sideways (along the side it was already looking
  // from: away from the fiber and out of its loop, so the fiber never passes the lens), to a close range where the
  // first fiber's bundle is about a third of the frame, and travels slowly along the curve of the coil, looking ahead
  // along it; shallow focus, the strands forming round it passing as soft lights. Almost still in the breath before
  // the bass. Whatever comes nearer than about half the way to the subject fades out by distance (nearF).
  _coil(t) {
    const R = this.R, A = this.A, L = R.len;
    const r = sCurve((t - A.strands) / 2.7);                       // the rise off the fiber, done by 12.56
    const s = 7.5 * ss(0.3, A.strands + 4, t) + this.trav(t) * 3 * R.coilD;   // the close-up's drift, then the track
    const u = U0 + s / L, F = this._frame(u);
    const ph = mix(0.55 + 0.30 * Math.min(t, A.strands) / A.strands, 0.25, r);   // the lens comes round to the outside of the loop as it rises (the bundle lies inward and along the axis: from there the first fiber is in front of its strands, not behind them)
    const side = V3.add(V3.scale(F.n, -Math.cos(ph)), V3.scale(F.b, Math.sin(ph)));
    const d0 = clamp(R.radius * 24, 4.5, 7.5), D = mix(d0, R.coilD, r);
    const inb = (q) => V3.add(V3.scale(q.n, 0.05 * R.rho * r), V3.scale(q.b, 0.03 * R.rho * r));   // toward the middle of the bundle (inward, along the axis) as the lens backs off
    const eye = V3.addS(V3.addS(V3.add(F.p, inb(F)), side, D), F.t, -D * mix(0.42, 0.06, r));   // from three-quarters behind (the close-up) round to the side: a lateral track, the strands crossing the frame
    const Fa = this._frame(u + (D * mix(0.35, 0.3, r)) / L), ahead = V3.add(Fa.p, inb(Fa));
    const focus = V3.dist(eye, ahead);
    return { pos: eye, q: Q.look(eye, ahead), fov: mix(0.58, 0.62, r), focus, aperture: mix(0.026, 0.018, r), air: 0, fogK: 1, clear: 0,
      near: [0.55 * focus * (1 - r), 0.8 * focus * (1 - r)], nearF: [mix(0.6, 0.32, r) * focus, mix(1.05, 0.62, r) * focus] };
  }
  // INTRO R2: 2 for a small loop: the lens backs away to the whole ring as before (same timing, same end frame), but on a
  // path that leaves the first fiber sideways first (along the side it was looking from: away from the fiber and out of
  // its loop) and swings round to the bundle view, so the fiber never passes the lens (it crossed it as a soft smear at 12 s)
  _ringBack(t) {
    const A = this.A, C = this._closeUp(t), B = this._bundle();
    const e = sCurve((t - A.strands) / (A.breath - A.strands)) * 0.985 + 0.015 * ss(A.breath, A.weave, t);
    const L = V3.dist(C.pos, B.pos), P1 = V3.addS(C.pos, C.side, 0.45 * L), P2 = V3.addS(B.pos, C.side, 0.15 * L), g = 1 - e;
    const P = mixPose(C, B, e);
    P.pos = [0, 1, 2].map((k) => C.pos[k] * g * g * g + P1[k] * 3 * g * g * e + P2[k] * 3 * g * e * e + B.pos[k] * e * e * e);
    const ct = V3.addS(C.pos, Q.basis(C.q)[2], -C.focus), bt = V3.addS(B.pos, Q.basis(B.q)[2], -B.focus), tgt = V3.lerp(ct, bt, e);
    P.q = Q.look(P.pos, tgt); P.focus = V3.dist(P.pos, tgt);
    P.near = [mix(0.55, 0.12, e) * P.focus, mix(0.8, 0.35, e) * P.focus]; P.nearF = [mix(0.6, 0.12, e) * P.focus, mix(1.05, 0.35, e) * P.focus];
    return P;
  }
  // INTRO R2: 3a, the crane, ON 19.86: from the coil the lens lifts away at once (full speed within a quarter beat),
  // gliding out until it lands on the weave's own move at CRANE_J with the same position, look and speed (a cubic in
  // time, its end velocity the weave's), so the join cannot be seen and the weave from there is exactly what it was.
  _crane(t) {
    const A = this.A, span = CRANE_J - A.weave, tau = t - A.weave, k = 0.15;
    const w = clamp((tau + k * (Math.exp(-tau / k) - 1)) / (span - k), 0, 1), e = sCurve(w);
    const E = this.R.ring ? this._ringBack(A.weave) : this._coil(A.weave), O = this._weave(t), J = this._weave(CRANE_J), J0 = this._weave(CRANE_J - 0.02);
    const D = V3.sub(J.pos, E.pos), m0 = V3.addS(V3.scale(D, 2.4), [0, 1, 0], 0.5 * V3.len(D)), m1 = V3.scale(V3.sub(J.pos, J0.pos), (span - k) / 0.02);
    const w2 = w * w, w3 = w2 * w, h00 = 2 * w3 - 3 * w2 + 1, h10 = w3 - 2 * w2 + w, h01 = -2 * w3 + 3 * w2, h11 = w3 - w2;
    const pos = [0, 1, 2].map((i) => h00 * E.pos[i] + h10 * m0[i] + h01 * J.pos[i] + h11 * m1[i]);
    const tg = (P) => V3.addS(P.pos, Q.basis(P.q)[2], -P.focus), tgt = V3.lerp(tg(E), tg(O), e);
    const P = mixPose(E, O, e);
    P.pos = pos; P.q = Q.look(pos, tgt); P.focus = V3.dist(pos, tgt);
    const nf = 1 - ss(A.weave, A.weave + 3, t);
    P.nearF = nf > 1e-3 ? [E.nearF[0] * nf, E.nearF[1] * nf] : null;   // the fade by distance hands over to the weave's own clearing
    return P;
  }
  // 3: the weave (exactly as it was from CRANE_J on).
  _weave(t) {
    const A = this.A, R = this.R, B = this._bundle();
    const u = clamp((t - A.weave) / (A.reveal - 0.5 - A.weave), 0, 1);
    if (R.river) return this._weaveTrack(t, u, B);                 // INTRO REPAIR (third sitting): the tracking shot down the river
    const H = this._high(), e = (0.14 * sCurve(u / 0.4) + 0.86 * (1 - Math.cos(Math.PI * Math.pow(u, 2.4))) / 2) * 0.995 + 0.005 * ss(A.reveal - 0.5, A.reveal, t);
    const bt = V3.addS(B.pos, Q.basis(B.q)[2], -B.focus), ht = V3.addS(H.pos, Q.basis(H.q)[2], -H.focus);
    // the lens rises up and over the first bundle and turns down toward the river, the body weaving itself below it
    // INTRO REPAIR (third sitting): the second handle stands well to the side of the end frame, so the last, fastest stretch
    // is a sweep across the river (parallax: the strands slide past each other) rather than a dolly in on one view.
    const back = V3.norm(V3.sub(B.pos, bt)), c1 = V3.add(V3.addS(B.pos, back, 30), [0, 110, 0]), c2 = V3.add(V3.addS(H.pos, Q.basis(H.q)[0], 130), [0, 50, 0]);   // a crane: up and over the coil, never through it
    const g = 1 - e, pos = [0, 1, 2].map((k) => B.pos[k] * g * g * g + c1[k] * 3 * g * g * e + c2[k] * 3 * g * e * e + H.pos[k] * e * e * e);
    const tgt = V3.lerp(bt, ht, sCurve(e / 0.34));                 // on the bass the lens turns from the first bundle to the river, the hero of the body
    const P = mixPose(B, H, e);
    P.pos = pos; P.q = Q.look(pos, tgt); P.focus = V3.dist(pos, tgt);
    // whatever comes too near the lens thins away (FIBER_VS uNearEase), as in a flight   // INTRO REPAIR: handed on from the bundle's own clearing over the first part of the move
    const cf = Math.min(1, 4 * e * (1 - e) * 1.5), kb = ss(0, 0.3, e);
    P.clear = cf; P.near = [mix(B.near[0], 7 * cf, kb), mix(B.near[1], 22 * cf, kb)];
    return P;
  }
  // INTRO REPAIR (third sitting): the weave as one move in two parts, at one even speed across the join: a crane up off the
  // first bundle and over to the head of the river, then a tracking shot down the river, the lens above it and looking
  // ahead along it while it weaves itself. The move gathers pace with the growth (its speed rises as u^1.3) and lands in
  // the last two seconds at 39.36, then holds for the half second before the hit. (Was: one crane to a high view of the
  // river, parked there from 34.9 s; and in the second sitting a sweep that still read as one view.)
  _weaveTrack(t, u, B) {
    const A = this.A, R = this.R, e = this.craneO(u), J = R.join;   // INTRO R2: the river is travelled on the old move exactly (craneO) ...
    const ex = this.craneE(u) - e;                                 // ... and what the new move has beyond it (0 to 36.6 s, then growing ever faster) pushes the lens forward
    const bt = V3.addS(B.pos, Q.basis(B.q)[2], -B.focus), T0 = this._track(TRACK[0]);
    let P, tgt;
    if (e < J) {
      const w = e / J, tan0 = V3.norm(V3.sub(this._river(TRACK[0] + 0.05), this._river(TRACK[0])));
      const back = V3.norm(V3.sub(B.pos, bt)), c1 = V3.add(V3.addS(B.pos, back, 20), [0, 70, 0]), c2 = V3.add(V3.addS(T0.pos, tan0, -0.9 * V3.dist(B.pos, T0.pos) / 3), [0, 25, 0]);
      const g = 1 - w; P = mixPose(B, T0, sCurve(w));
      P.pos = [0, 1, 2].map((k) => B.pos[k] * g * g * g + c1[k] * 3 * g * g * w + c2[k] * 3 * g * w * w + T0.pos[k] * w * w * w);
      tgt = V3.lerp(bt, T0.tgt, Math.min(sCurve(w / 0.7), ss(R.riverG - 0.06, R.riverG + 0.06, this._g(t))));   // the lens turns from the first bundle to the river on the bass, but not before a third of the river has formed (turned to early on the real feed, whose river was learned late, it looked at empty air at 27 s)
    } else {
      const s = mix(TRACK[0], TRACK[1], (e - J) / (1 - J)), T = this._track(s);
      P = { ...T }; tgt = T.tgt;
      // INTRO R2 (N3): to the hold the lens keeps gathering pace: as the track along the river slows to its old landing, a
      // push in toward the strands ahead takes over and outruns it, half the way to them by 39.36, braking only in the last
      // 0.3 s; then the held half second, and the hard cut to the whole body from outside
      if (ex > 0) P.pos = V3.addS(P.pos, V3.norm(V3.sub(tgt, P.pos)), 0.5 * V3.dist(P.pos, tgt) * ex / this.craneX);
    }
    P.q = Q.look(P.pos, tgt); P.focus = V3.dist(P.pos, tgt);
    // whatever comes too near the lens thins away (FIBER_VS uNearEase), as in the page's flights; handed on from the
    // bundle's own clearing over the first part of the move, and still a little open at the end (the lens is above strands)
    const cf = Math.min(1, 0.35 + 3 * e), kb = ss(0, 0.15, e);
    P.clear = cf; P.near = [mix(B.near[0], 7 * cf, kb), mix(B.near[1], 22 * cf, kb)];
    return P;
  }
  // 4: the reveal. The plate, pushing in slowly for two bars.
  _plate(t) {
    const A = this.A, P = this.h.camera.platePose(), k = 0.11 * sCurve(      // INTRO REPAIR: twice the push-in (0.055 could not be seen)
(t - A.reveal) / (A.dive - A.reveal + 4));
    const tgt = V3.addS(P.pos, Q.basis(P.q)[2], -P.focus);
    const pos = V3.lerp(P.pos, tgt, k);
    return { ...P, pos, focus: P.focus * (1 - k), clear: 0 };
  }
  // 5: the dive. From the plate into the body, arriving on the rail at stop 0 at the hand-over. In its last stretch the lens
  // rides the rail itself at the autopilot's own speed (railPose of t - hand), so the hand-over cannot be seen.
  _dive(t) {
    const A = this.A, cam = this.h.camera;
    const plate = this._plate(Math.min(t, A.dive));
    const rail = { ...cam.railPose(t - A.arrive), clear: 0 };   // INTRO WORDS: arrive (the hand-over of the short cut)
    // INTRO REPAIR: a flight, not a zoom (was a straight lerp and a slerp between two frames that look the same way).
    // A cubic path: it leaves the plate travelling the way the plate looks (down into the body), swings round, and comes
    // in to the rail's start travelling the way the rail runs (the second handle stands back along the rail's own
    // direction), so the last stretch is the rail itself. The lens looks where it is going: down the path's tangent,
    // handing over to the rail's own look (and its bank) in the last part. The ease is zero at both ends: it leaves the
    // held plate without a jolt and, since its rate is zero at the end, the speed at the hand-over is the autopilot's.
    // INTRO REPAIR (third sitting): looking down the tangent pointed the lens at empty air for three seconds (46 to 49 s).
    // Now the path's first handle lies three quarters of the way to the middle of the body (where the plate looks), so
    // the lens plunges into the body; it keeps looking at that middle as it closes on it, and from there its gaze swings to
    // where the rail looks, while the path bends round to come in along the rail. Passing the middle, the strands slide
    // past on every side (the clearing round the lens thins whatever comes within reach).
    const u = clamp((t - A.dive) / (A.arrive - A.dive), 0, 1), e = sCurve(1 - Math.pow(1 - u, 1.6));
    const C = V3.addS(plate.pos, Q.basis(plate.q)[2], -plate.focus), fwdR = V3.scale(Q.basis(rail.q)[2], -1);
    const RT = V3.addS(rail.pos, fwdR, rail.focus);
    // (third sitting) the first handle also stands well to the plate's right: the lens swings round the middle while it
    // closes on it, so the body turns in the frame as it is entered (straight in, it read as a zoom)
    const P0 = plate.pos, P1 = V3.addS(V3.lerp(P0, C, 0.6), Q.basis(plate.q)[0], 0.45 * V3.dist(P0, C)), P3 = rail.pos, P2 = V3.addS(P3, fwdR, -90);
    const g = 1 - e, pos = [0, 1, 2].map((k) => P0[k] * g * g * g + P1[k] * 3 * g * g * e + P2[k] * 3 * g * e * e + P3[k] * e * e * e);
    const P = mixPose(plate, rail, e);
    P.pos = pos;
    const tgt = V3.lerp(C, RT, ss(0.3, 0.8, e));
    P.q = Q.slerp(Q.slerp(plate.q, Q.look(pos, tgt), ss(0, 0.1, u)), rail.q, ss(0.72, 1, e));
    P.focus = mix(Math.max(V3.dist(pos, tgt), 1), rail.focus, ss(0.72, 1, e));
    const cf = Math.min(1, 4 * e * (1 - e) * 1.4);
    P.clear = cf; P.near = [7 * cf, 22 * cf];
    return P;
  }

  // ------------------------------------------------------------ the frame
  // real: seconds since the last frame, by the clock. Returns the shot to draw, or null when the sequence is not running.
  frame(real) {
    if (!this.active || !this.R) return null;
    const dt = Math.min(Math.max(real, 0), 0.1), S = window.__MM_SOUND, c = S && S.clock ? S.clock() : null;
    this.moved += dt; this._skipUI();
    if (this.state === 'waiting') {
      if (this.phase === 'armed' && S && !S.armed) this._starting();          // the sound was started by some other means (M, V, or the app itself)
      if (this.phase === 'starting' || this.phase === 'restart') {
        this.since += dt;
        if (c && c.run && c.mode === 'track' && c.pass === 0 && (this.phase !== 'restart' || this.restarted)) { this.state = 'playing'; this.clock = 'music'; }
        else if (this.phase === 'starting' && (this.since > 3 || (c && (c.mode === 'synth' || (!c.on && this.since > 0.25))))) { this.state = 'playing'; this.clock = 'silent'; this.lateSync = this.since > 3; this.wasOff = !!(c && !c.on); }
        else if (this.phase === 'restart' && this.restartFailed) { this.state = 'playing'; this.clock = 'silent'; }
      }
      if (this.state === 'waiting') return this._out(0);
    }
    // playing
    if (this.clock === 'music') {
      if (!c || !c.on || c.mode !== 'track') this.clock = 'silent';           // switched off mid-sequence: carry on silently from here
      else if (c.run && c.pass === 0) {
        const pos = Math.max(0, c.pos);
        if (this.hold >= 0) { if (pos >= this.hold) { this.hold = -1; this.t = pos; } }   // the picture waits for the music, never jumps back
        else this.t = pos;
      } else if (c.run && c.pass > 0) this.t = this.A.hand;                   // the track has gone round: the first pass is over
      // else: the sound is on but not sounding (decoding, hidden tab, suspended): hold
    } else if (this.clock === 'silent') {
      if (c && c.on && c.mode === 'track' && c.run && this.wasOff) { this.finish(); return null; }   // switched back on mid-sequence: hand over rather than jump
      this.wasOff = this.wasOff || !(c && c.on);
      if (c && c.on && c.mode === 'track' && c.run && c.pass === 0 && this.lateSync) { this.clock = 'music'; this.hold = this.t; }   // the track arrived late: follow it once it catches up
      else this.t += dt;
    }
    if (this.frozen != null) this.t = this.frozen;
    if (this.t >= this.A.hand && this.frozen == null) { this._mark(this.t); this.finish(this.t - this.A.hand, true); return null; }
    return this._out(this.t);
  }
  _out(t) {
    const s = this.shot(t);
    // INTRO WORDS: what of the story shows at t (nothing while the black frame waits), and the same line for a screen reader
    const W = this.words; W.cur = this.state === 'playing' && this.wordsOn ? W.at(t) : NONE; W.t = t; W.say();
    if (this.wordsOn && this.state === 'playing' && this.frozen == null) W.prefetch(t);
    if (this.state === 'playing') this._mark(t);
    this._vars(...s.panels);
    if (this.state === 'waiting') { s.look.fade = 0; s.look.soloK = 0; }
    return s;
  }
  // the first frame that showed each anchor: the music position it was drawn at
  _mark(t) {
    for (const k of ['strands', 'weave', 'reveal', 'dive', 'arrive', 'totals', 'labels', 'dock', 'hand']) if (this.log[k] == null && t >= this.A[k]) this.log[k] = +t.toFixed(4);
    if (this.wordsOn) for (const it of this.words.items) if (this.log[it.key] == null && t >= it.at && t < it.end) this.log[it.key] = +t.toFixed(4);   // INTRO WORDS: w0..w4, the lines; c0..c5, the cards
    if (this.log.start == null) this.log.start = +t.toFixed(4);
  }
  // INTRO WORDS: the Skip key (lower right): there for the whole of the credits; before them only while the pointer has
  // moved in the last three seconds (the pointer comes back for those seconds too), so the dark opening stays clean
  _skipUI() {
    const play = this.state === 'playing', moved = play && this.moved < 3, show = play && (moved || (this.long && this.t >= this.A.dive && this.t < this.A.hand));
    if (this.skipBtn && this.skipBtn.hidden === show) this.skipBtn.hidden = !show;
    if (this.uiMoved !== moved) { this.uiMoved = moved; document.body.classList.toggle('intro-moved', moved); }
  }
  // INTRO WORDS: drawn by the renderer's extra pass (main.js), into the scene before depth of field and bloom
  draw(F, S) { if (this.active && this.wordsOn && this.h.renderer) this.words.draw(F, S, this.h.renderer().gl); }
  lost() { this.words.lost(); }
  // the panels' opacities, written only when they change (custom properties on the root: CSSOM, as the page already does)
  _vars(title, totals, labels, dock) {
    const st = document.documentElement.style, set = (k, v) => { v = Math.round(v * 100) / 100; if (this.vars[k] !== v) { this.vars[k] = v; st.setProperty(k, String(v)); } };
    set('--i-title', title); set('--i-totals', totals); set('--i-labels', labels); set('--i-dock', dock);
  }

  // The look of the frame: the sequence's light (while it runs) and the light that follows the music (whenever the track
  // sounds, during the sequence and after it). S: the parameters of renderer.render, changed in place.
  look(S, shot) {
    if (shot) {
      const L = shot.look, h = L.house, see = Math.exp(mix(Math.log(SEE_DARK), Math.log(SEE_FULL), h));
      S.solo = L.solo; S.soloK = L.soloK; S.room = L.room; S.fade = L.fade;
      if (h < 1) S.fog = Math.max(S.fog || 0, 1.9 / (see - 10));    // (misted() in shaders.js: the air is 85 percent black at that distance)
      S.exposure *= L.expo; S.glint = L.glint;                     // (the glints of the lone fiber stand up a little more in the dark)
      if (L.bare) S.skip = 'pstn';   // INTRO R2: to the first bar line of the bass (22.36): the lens leaves the coil on the bass, and its ties (big blurred rings at the lens) arrive once it is out   // INTRO REPAIR: + t and n, the tendons and the spare lines (scaffolding: at the lens a spare line stood as a flat pink wedge, 6 to 12 s)                                   // until the bass enters, only fibers: no architecture, no sheath (renderer.js skip letters); the structure arrives with the bass
      if (h < 1) { const air = h * h * h; S.airBeam = air; S.shafts *= air; S.haze = air; S.mist = h; }   // CLARITY: from the reveal on (h is 1) the air is the viewer's own (main.js CLEAR), not forced back to full       // the light in the air comes last: the glass keeps its own light throughout
      S.growth = shot.growth;
      // INTRO REPAIR: the forming tip (the last 4 percent of a forming fiber, lit flat in its hue by the Growth slider) is
      // lowered to a fifth while the sequence plays: close to the lens it stood as a flat hot slab (6 to 12 s) and in the
      // weave the tips were the loose gold fragments. The fibers still visibly grow; only the marker of the front is quieter.
      S.tip = L.tip; S.nearR = L.nearR;   // INTRO R2: tip from the shot (TIP while close, then 1)
    }
    // THE ROOM ANSWERS THE MUSIC, NEVER A FIBER: one factor for the whole frame (uRoom) and one for the glints of every fiber.
    // Off in every still, every lab shot, with reduced motion, and whenever the track is not sounding.
    const H = this.h, M = window.__MM_SOUND;
    if (H.still || H.lab || H.shot || H.reduced || !M || !M.clock) return;
    const c = M.clock();
    if (!c.run || !c.on || c.mode !== 'track') return;
    S.room = (S.room == null ? 1 : S.room) * (1 + BASS_LIGHT * bassAt(this.cues, c.pos));
    const hk = hitAt(this.cues, c.pos);
    S.glint = (S.glint == null ? 1 : S.glint) * (1 + 10 * HIT_LIGHT * hk);
    S.hit = HIT_LIGHT * hk;                                        // INTRO R2: the highlights of the whole frame (uRoom.z, FINAL): one curve for every pixel, never a fiber's
  }

  // ------------------------------------------------------------ hand-over, skip, replay
  // The page is left in exactly the state it reaches when it opens without an intro: on the rail at stop 0 with the
  // autopilot running, growth at 1, every panel and key live.
  finish(over = 0, natural = false) {
    if (!this.active) return;
    const H = this.h, cam = H.camera, app = H.app;
    // INTRO WORDS: the rail where the autopilot has brought it since stop 0: at the hand-over itself, or, on a skip or a
    // replay, wherever the lens is on it now (0 before it arrives: the short cut's own rule)
    const railNow = natural ? this.A.hand - this.A.arrive + over : this.t - this.A.arrive;
    this.state = 'done'; this.phase = ''; this.t = Math.max(this.t, this.A.hand);
    cam.mode = 'tour'; cam.back = 'tour'; cam.flight = null; cam.custom = null; cam.focusIndex = -1;
    cam.railT = Math.max(0, railNow); cam.vel = 0;   // INTRO WORDS: (was max(0, over), the same in the short cut) cam.yaw = cam.pitch = 0; cam.dragging = false;
    cam.auto = !H.reduced; cam.autoK = cam.auto ? 1 : 0; cam.hold = 1e9;
    cam.pose = cam.railPose(cam.railT);
    app.growth = 1; app.playing = false; H.overlay.playing(false); H.overlay.growthUI(1);
    H.overlay.dirty = true;
    document.body.classList.remove(PAGE, 'intro-play', 'intro-wait');
    if (this.frozen == null) document.body.classList.remove('still');
    if (this.line) this.line.hidden = true;
    const st = document.documentElement.style; for (const k of ['--i-title', '--i-totals', '--i-labels', '--i-dock']) st.removeProperty(k);
    this.vars = {};
    // INTRO WORDS: the words go at once; the Skip key and the pointer come back; in the full cut the dock comes in on the
    // hand-over itself (its bar line), with the same short fade as the other panels
    this.words.cur = NONE; this.words.say(); this.moved = 1e9; this._skipUI();
    if (natural && this.long) { document.body.classList.add('intro-tail'); setTimeout(() => document.body.classList.remove('intro-tail'), 700); }
  }
  skip() { if (this.active) { this._mark(this.t); this.finish(0); } }
  play() {
    if (!this.allowed || !this.R) return false;
    this.h.reset();                                              // a close-up, a burst, the specimen plate, the legend: all closed first
    this._enter();
    this.state = 'waiting'; this.clock = 'silent'; this.wasOff = false; this.lateSync = false; this.restarted = false; this.restartFailed = false;
    document.body.classList.add('intro-play');
    const S = window.__MM_SOUND;
    if (S && S.on && S.restart) {                                // through black: hold the first frame until the track begins again
      this.phase = 'restart'; this.since = 0;
      S.restart().then((ok) => { if (ok) this.restarted = true; else this.restartFailed = true; }, () => { this.restartFailed = true; });
    } else { this.state = 'playing'; this.phase = ''; this.t = 0; this.wasOff = true; }
    return true;
  }

  // ------------------------------------------------------------ input (main.js asks first)
  // A key: true when the sequence took it. While it plays, Escape, Enter, Space and every key the viewer acts on end it;
  // M and V do their own job. While the black frame waits, every key is the gesture that starts it, never a skip.
  key(e) {
    const k = e.key;
    if (this.active) {
      if (this.state === 'waiting') return true;
      if (k === 'i' || k === 'I') { this.play(); return true; }
      if (k === 'Escape' || k === 'Enter' || k === ' ' || k === 'Spacebar' || /^[oObBlLrR]$/.test(k) || k.startsWith('Arrow')) { e.preventDefault(); this.skip(); return true; }
      return true;
    }
    if ((k === 'i' || k === 'I') && !e.repeat && this.allowed) { this.play(); return true; }
    return false;
  }
  // The picture: a click (a press and a release in place) ends the sequence while it plays; a drag does nothing. While the
  // black frame waits the press is the gesture that starts it (the window listener above), never a skip.
  pointer(e) {
    if (!this.active) return false;
    this.down = this.state === 'playing' && this.frozen == null ? { x: e.clientX, y: e.clientY } : null;
    return true;
  }
  pointerUp(e) {
    const d = this.down; this.down = null;
    if (!this.active) return false;
    if (d && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) <= 5) this.skip();
    return true;
  }
  // A new feed arrived (the app calls setFeed every second or two). The sequence carries on from where it is; only a
  // feed that can no longer carry it (no skills, fewer than two dated) ends it.
  anatomy() {
    this.rig();
    if (this.btn) this.btn.hidden = !this.allowed;
    if (this.active && !this.R) this.finish(0);
  }
}

// ================================================================ INTRO WORDS: the story, hung in the strands
// The lines of the story (WORDS.lines) and the credits (WORDS.cards). Each has a place: a quad in the world (or steady in
// the frame at the depth of focus), found once per anatomy and window shape. INTRO LEGIBLE (the art director, R1 to R4:
// readable first, woven second): the quad is no longer drawn into the scene. In the renderer's extra pass its projection
// is handed to FINAL (S.words), which lays the letters over the finished picture after the grade, so no strand and no
// scaffolding can hide a letter and no bloom or depth of field softens one, and darkens the picture under the block with
// a wide feathered shade only as strong as the light behind requires (none over black, at most SHADE_MAX). No item is
// depth tested any more (R1 allowed lines 1 and 2 at most, and only where proven clean everywhere; none is needed).
// No strand is drawn for the words. Each one is placed where the lens will be at the middle of its hold:
// facing the lens and level there, at about the depth of the subject, big enough to read, in the frame for the whole
// hold, sharp, over the dark, off the gold, with few strands in front. Its texture is drawn once in a 2D canvas.
// INTRO WORDS throughout.
const W_IN = 0.35, W_OUT = 0.5;      // a line draws itself in 0.35 s (left to right, a small bright tip leading, as a fiber forms) and dissolves in 0.5 s
const WORD_LIGHT = 0.90;             // INTRO LEGIBLE: the words' level on the screen, after the grade (was 0.72 of light before the exposure, which the bloom then haloed: the same near white, 0.90 of full)
const SHADE_MAX = 0.62;              // INTRO LEGIBLE (R2): the most the shade may take from the picture behind a block (over the gold); none over black
const SHADE_TO = 0.10;               // the relative luminance on the screen the shade brings the light behind down to (letters at 0.90 stand at about 0.78: 6.3 to 1)
const SHADE_FEATHER = 1.6;           // how far the shade reaches beyond the ink, in the font's size (a gaussian: no edge an eye can find)
const WORD_TINT = 0.16;              // a breath of the hue of the muscle beside the words
const PANE_H = 934;                  // the founder's pane: the sizes below are CSS pixels there (fractions of the frame height, so they grow with the frame)
const FIT = {
  line: { cap: 24.2 / PANE_H, max: 0.062, wrap: 12.5, ks: [0.97, 1, 1.04, 1.1, 1.2, 1.35, 1.6], xs: [-0.42, -0.22, 0, 0.22, 0.42], ys: [-0.5, -0.32, -0.14, 0.14, 0.32, 0.5] },
  card: { cap: 25.8 / PANE_H, max: 0.05, wrap: 12.5, ks: [0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.25], xs: [-0.45, -0.22, 0, 0.22, 0.45], ys: [-0.5, -0.3, -0.1, 0.12, 0.32] },
};
const HEAD = 0.6;                    // the heading's capitals against the sentence's (13 and 24 px at the pane, at least)
const SEE = (h) => Math.exp(mix(Math.log(SEE_DARK), Math.log(SEE_FULL), h)) + 10;
const NONE = [];
let LAST = null;                     // the page's one sequence, for the lab probe below

function cssVar(n, d) { try { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || d; } catch { return d; } }
function rgbOf(c) { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return [1, 1, 1]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2)); }

class Words {
  constructor(I) {
    this.I = I; this.items = []; this.fit = null; this.fitKey = ''; this.rast = null; this.rastPx = 0;
    this.gl = null; this.tex = [];
    this.cur = NONE; this.buf = []; this.t = 0; this.said = ''; this.noDepth = false;
    // INTRO LEGIBLE: what FINAL is handed each frame (made once, filled in place: nothing is allocated per frame for it)
    this.mode = 0; this.rect = null; this.mvp = new Float64Array(16); this.cl = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
    this.fin = { tex: null, H: new Float32Array(9), A: [0, 0, 0, 0], C: [0, 0, 0, 0], S: [0, 0, 0, SHADE_MAX], B: [0, 0, 0, 0], K: [0, 0, 0, 0], L: [0, SHADE_TO] };
    this.live = document.getElementById('intro-words');
  }
  // the items of this cut, on the cue sheet: a time within 0.03 s of a bar line or of a phrase moment is exactly that
  build() {
    const I = this.I, T = I.cues.tempo, mo = I.cues.moments || [];
    const snap = (x) => { const n = Math.round((x - T.downbeat) / T.bar), b = T.downbeat + T.bar * n; if (Math.abs(b - x) < 0.03) return b; const k = mo.find((q) => Math.abs(q.t - x) < 0.03); return k ? k.t : x; };
    const L = WORDS.lines.map((w) => ({ kind: 'line', at: snap(w.at), end: w.end, text: w.text }));
    const C = I.long ? WORDS.cards.map((w, i, all) => ({ kind: 'card', at: snap(w.at), end: (i + 1 < all.length ? snap(all[i + 1].at) : snap(WORDS.cardsEnd + 0.5)) - 0.5, head: w.head, text: w.text })) : [];
    this.items = [...L, ...C];
    this.items.forEach((it, i) => (it.key = it.kind === 'line' ? 'w' + i : 'c' + (i - L.length)));
    this.fit = null; this.fitKey = '';
  }
  // what shows at t: [{ i, p, a }] (p: drawn 0..1, a: light 0..1). Pure in t.
  at(t) {
    const out = this.buf; out.length = 0;
    for (let i = 0; i < this.items.length; i++) { const it = this.items[i]; if (t < it.at || t >= it.end) continue; out.push({ i, p: clamp((t - it.at) / W_IN, 0, 1), a: 1 - ss(it.end - W_OUT, it.end, t) }); }
    return out;
  }
  // W7: the line now showing, for people who cannot see the picture (one visually hidden element, aria-live polite)
  say() {
    let s = ''; const w = this.cur.find((x) => x.a > 0.5);
    if (w) { const it = this.items[w.i]; s = it.kind === 'card' ? it.head + '. ' + it.text : it.text; }
    if (s !== this.said) { this.said = s; if (this.live) this.live.textContent = s; }
  }

  // ------------------------------------------------------------ the textures' pictures (2D canvas, the page's own fonts, measured in this browser)
  _raster(fontPx) {
    const serif = cssVar('--serif', 'Georgia, serif'), sans = cssVar('--sans', 'sans-serif');
    const mk = () => document.createElement('canvas').getContext('2d');
    const m = mk(), F = `400 ${fontPx}px ${serif}`; m.font = F;
    const cap = m.measureText('H').actualBoundingBoxAscent || fontPx * 0.68;
    return this.items.map((it) => {
      const P = FIT[it.kind], maxW = P.wrap * fontPx, words = it.text.split(/\s+/), rows = [];
      m.font = F;
      for (const w of words) { const r = rows.length ? rows[rows.length - 1] + ' ' + w : w; if (rows.length && m.measureText(r).width <= maxW) rows[rows.length - 1] = r; else rows.push(w); }
      // a line is set in two rows only where one is too long (it then breaks after the comma or near the middle)
      if (it.kind === 'line') { rows.length = 0; const one = it.text; if (m.measureText(one).width <= maxW) rows.push(one); else { const c = one.indexOf(', '); let k = c > 0 ? c + 1 : -1; if (k < 0) { let best = 1e9; for (let j = 0; j < one.length; j++) if (one[j] === ' ') { const d = Math.abs(m.measureText(one.slice(0, j)).width - m.measureText(one.slice(j + 1)).width); if (d < best) { best = d; k = j; } } } rows.push(one.slice(0, k).trim(), one.slice(k + 1).trim()); } }
      const rw = rows.map((r) => m.measureText(r).width), lineH = 1.24 * fontPx, pad = Math.ceil(0.45 * fontPx);
      let head = null, headH = 0;
      if (it.head) {
        m.font = `600 ${fontPx}px ${sans}`; const sc = m.measureText('H').actualBoundingBoxAscent || fontPx * 0.72;
        const hp = Math.round(fontPx * HEAD * cap / sc), track = 0.14 * hp, txt = it.head.toUpperCase();
        m.font = `600 ${hp}px ${sans}`; let w = 0; const cw = [...txt].map((ch) => m.measureText(ch).width); cw.forEach((x) => (w += x)); w += track * (cw.length - 1);
        head = { hp, txt, cw, track, w, cap: HEAD * cap }; headH = HEAD * cap + 0.95 * cap;
      }
      const inkW = Math.max(...rw, head ? head.w : 0);
      const W = Math.ceil(inkW + 2 * pad), H = Math.ceil(2 * pad + headH + cap + (rows.length - 1) * lineH + 0.3 * fontPx);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d'); x.textBaseline = 'alphabetic';
      if (head) { x.font = `600 ${head.hp}px ${sans}`; x.fillStyle = 'rgba(255,255,255,0.74)'; let cx = pad; [...head.txt].forEach((ch, j) => { x.fillText(ch, cx, pad + head.cap); cx += head.cw[j] + head.track; }); }
      x.font = F; x.fillStyle = '#fff';
      rows.forEach((r, j) => x.fillText(r, pad, pad + headH + cap + j * lineH));
      return { cv, W, H, cap, capV: cap / H, headV: head ? head.cap / H : 0, span: [pad / W, (pad + inkW) / W], ink: [pad / W, pad / H, (pad + inkW) / W, (H - pad) / H], px: fontPx, rows: rows.length, letters: it.text.replace(/\s/g, '').length + (head ? head.txt.replace(/\s/g, '').length : 0) };   // INTRO LEGIBLE: + ink (the block inside the texture), px (the font's size there)
    });
  }

  // ------------------------------------------------------------ where each one hangs (once per anatomy and window shape)
  _ensure() {
    const I = this.I, app = I.h.app, cam = I.h.camera, el = document.getElementById('gl');
    const hCss = (el && el.clientHeight) || innerHeight, dpr = devicePixelRatio || 1;
    const px = clamp(Math.round((hCss * dpr * 0.052) / 8) * 8, 40, 160);
    if (!this.rast || this.rastPx !== px) { this.rast = this._raster(px); this.rastPx = px; this._drop(); }
    const key = [app.anat && app.anat.count, I.R && I.R.fi, I.R && I.R.center.map((v) => v.toFixed(1)).join(','), (cam.aspect || 1).toFixed(3), Math.round(hCss), this.items.length].join('|');
    if (this.fit && this.fitKey === key) return;
    // placed lazily, one item at a time (each costs some tens of milliseconds): the sequence asks for the next one a few
    // seconds before it is due (prefetch, from _out), a frozen frame for the one it shows
    this.fitKey = key; this.S = null; this.fit = this.items.map(() => null); this.asp = cam.aspect || 1; this.hCss = hCss;
  }
  fitOf(i) {
    this._ensure();
    if (!this.fit[i]) { if (!this.S) this._samples(); this.fit[i] = this._place(this.items[i], this.rast[i], this.asp, this.hCss); }
    return this.fit[i];
  }
  // the next item due within three seconds and not yet placed: placed now (one a frame at most)
  prefetch(t) { if (!this.items.length) return; this._ensure(); for (let i = 0; i < this.items.length; i++) if (!this.fit[i] && this.items[i].at - 3 < t && t < this.items[i].end) { this.fitOf(i); return; } }
  // the fibers, sampled (24 places each): where strands would cross or light up a placement
  _samples() {
    const I = this.I, a = I.h.app.anat, n = a.fibers.length, step = Math.max(1, Math.ceil(n / 4000)), K = 24, list = [];   // every fiber (up to 4000): a dim strand missed here stood in front of a line
    for (let i = 0; i < n; i += step) list.push(i);
    if (I.R && !list.includes(I.R.fi)) list.push(I.R.fi);
    const N = list.length * K, p = new Float32Array(N * 3), gate = new Float32Array(list.length), flag = new Uint8Array(list.length), rad = new Float32Array(list.length), hue = [];
    list.forEach((fi, j) => {
      const f = a.fibers[fi], b = f.skill.birth;
      gate[j] = b >= 0 ? 0.94 * b + 0.03 : -1; rad[j] = f.radius || 0.2; flag[j] = (f.muscle.id === 'research' ? 1 : 0) | (I.R && fi === I.R.fi ? 2 : 0); hue[j] = f.muscle;
      for (let k = 0; k < K; k++) { const q = a.point(fi, k / (K - 1)).p, o = j * K + k; p[o * 3] = q[0]; p[o * 3 + 1] = q[1]; p[o * 3 + 2] = q[2]; }
    });
    this.S = { p, gate, flag, rad, hue, nf: list.length, K, w: step };
  }
  // one view of the lens at t: every sampled strand drawn into a coarse grid of the frame (GRID x GRID cells), as how much
  // strand lies in each cell at each depth (DB bins, log-spaced), how much of it is lit and near enough to be seen, and how
  // much of that is gold. A placement then costs a sum over the cells it covers.
  _view(t, asp) {
    const I = this.I, s = I.shot(t), P = s.pose, b = Q.basis(P.q), ty = Math.tan(P.fov / 2), S = this.S, G = 40, DB = 32;
    const see = SEE(s.look.house), drawn = t >= I.A.rise, lit = t >= I.A.rise + 1.2, nf = P.nearF, ne = P.near || [7 * (P.clear || 0), 22 * (P.clear || 0)];
    const occ = new Float32Array(G * G * DB), all = new Float32Array(G * G), gold = new Float32Array(G * G), hueC = new Array(G * G);
    const bin = (z) => clamp(Math.floor((Math.log(Math.max(z, 2) / 2) / Math.log(400)) * DB), 0, DB - 1);
    const pr = (o) => { const dx = S.p[o * 3] - P.pos[0], dy = S.p[o * 3 + 1] - P.pos[1], dz = S.p[o * 3 + 2] - P.pos[2], z = -(dx * b[2][0] + dy * b[2][1] + dz * b[2][2]);
      return [(dx * b[0][0] + dy * b[0][1] + dz * b[0][2]) / (Math.max(z, 0.3) * ty * asp), (dx * b[1][0] + dy * b[1][1] + dz * b[1][2]) / (Math.max(z, 0.3) * ty), z]; };
    for (let j = 0; j < S.nf; j++) {
      const first = S.flag[j] & 2; if (!(S.gate[j] < s.growth) || !(drawn || first)) continue;   // formed, and drawn (dark or lit: a dark strand in front still hides letters)
      const isGold = S.flag[j] & 1, isLit = lit || first;
      let A = pr(j * S.K);
      for (let k = 1; k < S.K; k++) {
        const B = pr(j * S.K + k), a0 = A; A = B;
        if (a0[2] < 0.3 || B[2] < 0.3) continue;
        if ((a0[0] < -1.2 && B[0] < -1.2) || (a0[0] > 1.2 && B[0] > 1.2) || (a0[1] < -1.2 && B[1] < -1.2) || (a0[1] > 1.2 && B[1] > 1.2)) continue;
        const steps = Math.min(120, Math.ceil(Math.max(Math.abs(B[0] - a0[0]), Math.abs(B[1] - a0[1])) * G) + 1);
        for (let q = 0; q <= steps; q++) {
          const u = q / steps, x = a0[0] + (B[0] - a0[0]) * u, y = a0[1] + (B[1] - a0[1]) * u; if (x < -1 || x >= 1 || y < -1 || y >= 1) continue;
          const z = a0[2] + (B[2] - a0[2]) * u, gx = Math.floor(((x + 1) / 2) * G), gy = Math.floor(((y + 1) / 2) * G), c = gy * G + gx, wgt = 1 / (steps + 1);
          // a strand hides what is behind it over its whole width (it writes depth where it is at least 0.3 covered, FIBER_FS
          // id pass), and near the lens it is wide: spread over the cells its width covers. Faded by distance (nearF) or thinned
          // by the clearing round the lens (near), it writes no depth.
          const fd = nf && !first ? ss(nf[0], nf[1], z) : 1, nk = ne[1] > 0 ? ss(ne[0], ne[1], z) : 1;
          const rc = Math.min(4, Math.floor((S.rad[j] * nk / (z * ty)) * G * 0.5));
          if (fd >= 0.3) {
            const bz = bin(z);
            for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) { const xx = gx + dx, yy = gy + dy; if (xx >= 0 && xx < G && yy >= 0 && yy < G) occ[(yy * G + xx) * DB + bz] += wgt * 8; }
          }
          // INTRO LEGIBLE: its light over its whole width too (a lit strand near the lens is a wide bright band behind a line;
          // counted in one cell, the first fiber ran through the second row of line 1)
          if (isLit && z < see) { for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) { const xx = gx + dx, yy = gy + dy; if (xx >= 0 && xx < G && yy >= 0 && yy < G) { const cc = yy * G + xx; all[cc] += wgt * 8; if (isGold) gold[cc] += wgt * 8; } } hueC[c] = S.hue[j]; }
        }
      }
    }
    for (let c = 0; c < G * G; c++) for (let k = 1; k < DB; k++) occ[c * DB + k] += occ[c * DB + k - 1];   // prefix over depth: strand nearer than a bin
    return { t, pos: P.pos, b, ty, tx: ty * asp, f: P.focus, ap: P.aperture || 0, see, occ, all, gold, hueC, G, DB, bin };
  }
  // the strand over a rectangle of the frame in view v: in front of depth zt (occ), all lit (all), gold (gold)
  _cost(v, x0, x1, y0, y1, zt) {
    const G = v.G, DB = v.DB, i0 = clamp(Math.floor(((x0 + 1) / 2) * G), 0, G - 1), i1 = clamp(Math.floor(((x1 + 1) / 2) * G), 0, G - 1), j0 = clamp(Math.floor(((y0 + 1) / 2) * G), 0, G - 1), j1 = clamp(Math.floor(((y1 + 1) / 2) * G), 0, G - 1);
    const zb = v.bin(zt * 0.92); let occ = 0, all = 0, gold = 0;   // (bins 1.2 apart: strands nearer than about 0.92 to 1.1 of its depth)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = j * G + i; if (zb >= 0) occ += v.occ[c * DB + zb]; all += v.all[c]; gold += v.gold[c]; }
    return [occ, Math.max(0, all - occ), gold];
  }
  // where the panels are while the credits run (the lockup, the Skip key, the app's corner), in the frame's terms
  _keepOut() {
    const out = [], W = innerWidth, H = innerHeight, ndc = (r) => ({ x0: (r.left / W) * 2 - 1, x1: (r.right / W) * 2 - 1, y0: 1 - (r.bottom / H) * 2, y1: 1 - (r.top / H) * 2 });
    const lk = document.getElementById('lockup'); if (lk) { const r = lk.getBoundingClientRect(); if (r.width) out.push(ndc({ left: r.left - 16, right: r.right + 16, top: r.top - 16, bottom: r.bottom + 16 })); }
    out.push(ndc({ left: W - 420, right: W, top: H - 210, bottom: H }));   // the Skip key and the app's corner (WIRING.md section 6)
    return out;
  }
  _place(it, r, asp, hCss) {
    const I = this.I, P = FIT[it.kind], t0 = it.at + W_IN, t1 = it.end - W_OUT, N = 7, tm = (t0 + t1) / 2;
    const views = []; for (let j = 0; j < N; j++) views.push(this._view(mix(t0, t1, j / (N - 1)), asp));
    const M = I.shot(tm).pose, mb = Q.basis(M.q), mty = Math.tan(M.fov / 2), mtx = mty * asp, fwd = V3.scale(mb[2], -1), R = mb[0], U = mb[1], Nn = mb[2];
    const keep = this._keepOut(), S = this.S, aspQ = r.W / r.H;   // INTRO LEGIBLE (R3): lines too keep clear of the Skip key and the app's corner (was cards only)
    let best = null; const why = { near: 0, size: 0, face: 0, soft: 0, frame: 0, panel: 0 };
    // carry: how much of the lens's travel the place shares (0: fixed in the world). Where the lens travels far in a hold
    // (the crane, the dive) a place fixed beside the subject is passed in a second; one that drifts with part of the travel
    // stays readable, and still hangs at its real depth among the real strands (they pass in front of it, the depth of
    // field and the air treat it as what it is), only further off in its parallax. The least carry that works is taken.
    for (const cy of [0, 0.5, 0.75, 0.88, 0.95, 0.98, 1]) for (const k of P.ks) for (const x of P.xs) for (const y of P.ys) {
      const D = k * M.focus; if (D < 2.5) continue;
      const O0 = V3.add(V3.add(V3.addS(M.pos, fwd, D), V3.scale(R, x * D * mtx)), V3.scale(U, y * D * mty));
      const Os = views.map((v) => V3.addS(O0, V3.sub(v.pos, M.pos), cy));
      // its size: the smallest its capitals get over the hold is the size asked for
      let rmin = 1e9, rmax = 0, ok = true;
      const zs = views.map((v, j) => { const d = V3.sub(Os[j], v.pos), z = -V3.dot(d, v.b[2]); return z; });
      for (let j = 0; j < N; j++) { if (zs[j] < 1) { ok = false; break; } const c = (D * mty) / (zs[j] * views[j].ty); rmin = Math.min(rmin, c); rmax = Math.max(rmax, c); }
      if (!ok) { why.near++; continue; }
      const capF = P.cap / rmin; if (capF * rmax > P.max) { why.size++; continue; }
      const capW = capF * 2 * D * mty, hh = capW / r.capV / 2, hw = hh * aspQ;
      let travel = 0, last = null, occ = 0, gold = 0, behind = 0, softS = 0;
      for (let j = 0; j < N && ok; j++) {
        const v = views[j], O = Os[j];
        // facing: no more than about 35 degrees off the lens; sharp: within the depth of field
        const toE = V3.norm(V3.sub(v.pos, O)); if (V3.dot(Nn, toE) < 0.82) { ok = false; why.face++; break; }
        const soft = v.ap * hCss * Math.abs(zs[j] - v.f) / zs[j]; if (soft > (j >= 2 && j <= N - 3 ? 2.2 : 4.5)) { ok = false; why.soft++; break; }   // sharp through the middle of the hold; a little soft at its ends is allowed where the focus racks (the crane) softS += soft;
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const c = V3.add(V3.add(O, V3.scale(R, sx * hw)), V3.scale(U, sy * hh)), d = V3.sub(c, v.pos), z = -V3.dot(d, v.b[2]);
          if (z < 0.5) { ok = false; break; }
          const px = V3.dot(d, v.b[0]) / (z * v.tx), py = V3.dot(d, v.b[1]) / (z * v.ty);
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        if (!ok || x0 < -0.92 || x1 > 0.92 || y0 < -0.86 || y1 > 0.86) { ok = false; why.frame++; break; }
        for (const q of keep) if (x1 > q.x0 && x0 < q.x1 && y1 > q.y0 && y0 < q.y1) { ok = false; why.panel++; break; }
        if (!ok) break;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; if (last) travel += Math.hypot(cx - last[0], cy - last[1]); last = [cx, cy];
        const cc = this._cost(v, x0, x1, y0, y1, zs[j]); occ += cc[0]; behind += cc[1]; gold += cc[2];
      }
      if (!ok) continue;
      const w = S.w / N, dc = Math.hypot(x, y);   // (counts in strand-cells: a strand crossing one cell is 8)
      // INTRO LEGIBLE: strands in front no longer hide letters (occ 1 -> 0.6); what is lit behind the block costs (0.12 -> 1)
      const score = w * (occ * 0.6 + gold * 2.5 + behind * 1.0) + 18 * Math.max(0, travel - 0.7) + 12 * cy + 4 * softS / N + (it.kind === 'line' ? 14 * Math.abs(Math.log(k)) + 8 * Math.max(0, dc - 0.55) : 4 * Math.abs(Math.log(k)));
      if (!best || score < best.score) best = { mode: 'world', O: O0, M: M.pos, carry: cy, R: V3.scale(R, hw), U: V3.scale(U, hh), score, info: { carry: cy, x, y, k: +k.toFixed(2), D: +D.toFixed(1), occ: +(w * occ).toFixed(1), gold: +(w * gold).toFixed(1), behind: +(w * behind).toFixed(1), travel: +travel.toFixed(2), capMin: +(capF * hCss).toFixed(1), capMax: +(capF * rmax * hCss).toFixed(1), score: +score.toFixed(1) } };
    }
    // a card may also take the steady place in the frame when that is clearly better (over dark, off the gold): readability rules
    const world = best; if (it.kind === 'card') best = null;
    if (!best) {
      // no place in the world meets the rules for the whole hold (the lens racks its focus or travels too far for it): it
      // is set steady in the frame, at the depth of what is in focus (so it stays sharp and the strands nearer than the
      // subject pass in front of it), drifting a little with the camera: the brief's fallback for a card. The place in
      // the frame is the one over the most dark, off the gold, with the fewest strands in front, for the whole hold.
      const capF = P.cap * 1.04, hy = capF / r.capV, hx = hy * aspQ / asp;
      for (const k of it.kind === 'card' ? [0.25, 0.35, 0.5, 0.7, 1] : [0.7, 0.85, 1]) for (const x of [-0.55, -0.35, -0.15, 0.05, 0.25, 0.45]) for (const y of [-0.66, -0.5, -0.3, 0.3, 0.5, 0.66]) {
        let ok = true, occ = 0, gold = 0, behind = 0;
        for (let j = 0; j < N && ok; j++) {
          const v = views[j], u = j / (N - 1), cx = x + 0.035 * u, x0 = cx - hx, x1 = cx + hx, y0 = y - hy, y1 = y + hy, zt = clamp(k * v.f, 3, 400);
          if (x0 < -0.92 || x1 > 0.92 || y0 < -0.86 || y1 > 0.86) { ok = false; break; }
          if (v.ap * hCss * Math.abs(zt - v.f) / zt > 2.2) { ok = false; break; }   // sharp enough to read
          for (const q of keep) if (x1 > q.x0 && x0 < q.x1 && y1 > q.y0 && y0 < q.y1) { ok = false; break; }
          if (!ok) break;
          const cc = this._cost(v, x0, x1, y0, y1, zt); occ += cc[0]; behind += cc[1]; gold += cc[2];
        }
        if (!ok) continue;
        const w = S.w / N, score = w * (occ * 0.6 + gold * 2.5 + behind * 1.0) + 3 * Math.hypot(x, y);   // INTRO LEGIBLE: nothing hides a letter now (occ was 1); what is lit behind a block is what costs (was 0.12)
        if (!best || score < best.score) best = { mode: 'follow', x, y, k, capF, score, info: { follow: true, x, y, k, occ: +(w * occ).toFixed(1), gold: +(w * gold).toFixed(1), behind: +(w * behind).toFixed(1), score: +score.toFixed(1), why } };
      }
      if (!best) best = { mode: 'follow', x: -0.45, y: -0.5, k: 1, capF, score: 1e9, info: { follow: true, x: -0.45, y: -0.5, k: 1, why } };
      if (world && world.score <= best.score + 40) best = world;
    }
    best.t0 = t0; best.t1 = t1;
    // the hue of the muscle beside it: the lit strand nearest its place at the middle of the hold
    const v = views[N >> 1], G = v.G, gx = Math.floor(((clamp(best.info.x, -0.99, 0.99) + 1) / 2) * G), gy = Math.floor(((clamp(best.info.y, -0.99, 0.99) + 1) / 2) * G);
    let c = [1, 1, 1], top = null, bd = 1e9;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const m = v.hueC[j * G + i]; if (!m) continue; const d = Math.hypot(i - gx, j - gy); if (d < bd) { bd = d; top = m; } }
    if (top && top.fam) c = rgbOf(top.fam.color);
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] || 1;
    best.col = c.map((x) => mix(1, x / lum, WORD_TINT)); best.info.hue = top ? top.id : null;
    return best;
  }
  // the quad of item i at t (world: fixed; follow: steady in the frame of the pose at t)
  _quad(i, t, pose, asp) {
    const f = this.fitOf(i), r = this.rast[i];
    if (f.mode === 'world') { if (!f.carry) return f; f.Ot = V3.addS(f.O, V3.sub(pose.pos, f.M), f.carry); return { O: f.Ot, R: f.R, U: f.U }; }
    const b = Q.basis(pose.q), ty = Math.tan(pose.fov / 2), tx = ty * asp, D = clamp(f.k * pose.focus, 3, 400);
    const capW = f.capF * 2 * D * ty, hh = capW / r.capV / 2, hw = hh * (r.W / r.H);
    const u = clamp((t - f.t0) / Math.max(0.1, f.t1 - f.t0), -0.2, 1.2), cx = f.x + 0.035 * u, cy = f.y;
    const O = V3.add(V3.add(V3.addS(pose.pos, b[2], -D), V3.scale(b[0], cx * D * tx)), V3.scale(b[1], cy * D * ty));
    return { O, R: V3.scale(b[0], hw), U: V3.scale(b[1], hh) };
  }

  // ------------------------------------------------------------ INTRO LEGIBLE: handed to FINAL (renderer.extraPass, the same frame)
  _gl(gl) { if (this.gl !== gl) { this.gl = gl; this.tex = []; } }
  _drop() { const gl = this.gl; if (gl) for (const t of this.tex) if (t) gl.deleteTexture(t); this.tex = []; }
  _texture(i) {
    if (this.tex[i]) return this.tex[i];
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.rast[i].cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex[i] = t; return t;
  }
  lost() { this.gl = null; this.tex = []; }
  // The item now showing (one at a time: each is gone before the next arrives): its quad at t, projected by this frame's own
  // view and projection, as the map from the frame to its texture (a 3 x 3 homography, inverted here), the block of its ink
  // in the frame (where FINAL reads the light behind it), and its light, drawing and colour. Written into S.words.
  draw(F, S, gl) {
    if (!this.cur.length || !gl) return;
    this._gl(gl); this._ensure();
    let w = this.cur[0]; for (const x of this.cur) if (x.a > w.a) w = x;
    const asp = this.I.h.camera.aspect || 1, r = this.rast[w.i], f = this.fitOf(w.i), q = this._quad(w.i, this.t, S, asp);
    const M = this.mvp, Vw = F.view, Pj = F.proj;
    for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) M[c * 4 + k] = Pj[k] * Vw[c * 4] + Pj[4 + k] * Vw[c * 4 + 1] + Pj[8 + k] * Vw[c * 4 + 2] + Pj[12 + k] * Vw[c * 4 + 3];
    const clip = (o, x, y, z, h) => { for (let k = 0; k < 4; k++) o[k] = M[k] * x + M[4 + k] * y + M[8 + k] * z + M[12 + k] * h; return o; };
    // texture (u, v down) -> world: O - R + U + u 2R - v 2U
    const [a, b, c] = this.cl, O = q.O, R = q.R, U = q.U;
    clip(a, 2 * R[0], 2 * R[1], 2 * R[2], 0); clip(b, -2 * U[0], -2 * U[1], -2 * U[2], 0); clip(c, O[0] - R[0] + U[0], O[1] - R[1] + U[1], O[2] - R[2] + U[2], 1);
    // rows x, y, w of (u, v, 1) -> clip; its inverse goes to FINAL (column major)
    const m00 = a[0], m01 = b[0], m02 = c[0], m10 = a[1], m11 = b[1], m12 = c[1], m20 = a[3], m21 = b[3], m22 = c[3];
    const A00 = m11 * m22 - m12 * m21, A01 = m02 * m21 - m01 * m22, A02 = m01 * m12 - m02 * m11;
    const A10 = m12 * m20 - m10 * m22, A11 = m00 * m22 - m02 * m20, A12 = m02 * m10 - m00 * m12;
    const A20 = m10 * m21 - m11 * m20, A21 = m01 * m20 - m00 * m21, A22 = m00 * m11 - m01 * m10;
    const det = m00 * A00 + m01 * A10 + m02 * A20; if (!(Math.abs(det) > 1e-12)) return;
    const Hm = this.fin.H, id = 1 / det;
    Hm[0] = A00 * id; Hm[1] = A10 * id; Hm[2] = A20 * id; Hm[3] = A01 * id; Hm[4] = A11 * id; Hm[5] = A21 * id; Hm[6] = A02 * id; Hm[7] = A12 * id; Hm[8] = A22 * id;
    // the block of its ink in the frame (vUV, y up), from its four corners
    const ink = r.ink; let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (let k = 0; k < 4; k++) {
      const u = k & 1 ? ink[2] : ink[0], v = k & 2 ? ink[3] : ink[1], hw = a[3] * u + b[3] * v + c[3];
      if (!(hw > 1e-6)) return;                                    // behind the lens: nothing this frame
      const px = ((a[0] * u + b[0] * v + c[0]) / hw + 1) / 2, py = ((a[1] * u + b[1] * v + c[1]) / hw + 1) / 2;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const el = this.I.h.renderer && this.I.h.renderer().canvas, cw = (el && el.clientWidth) || innerWidth, ch = (el && el.clientHeight) || innerHeight;
    const Fn = this.fin;
    Fn.tex = this._texture(w.i);
    Fn.A[0] = w.a; Fn.A[1] = w.p; Fn.A[2] = r.span[0]; Fn.A[3] = r.span[1];
    Fn.C[0] = Math.min(1, f.col[0] * WORD_LIGHT); Fn.C[1] = Math.min(1, f.col[1] * WORD_LIGHT); Fn.C[2] = Math.min(1, f.col[2] * WORD_LIGHT); Fn.C[3] = this.mode;
    Fn.S[0] = r.W; Fn.S[1] = r.H; Fn.S[2] = SHADE_FEATHER * r.px;
    Fn.B[0] = ink[0]; Fn.B[1] = ink[1]; Fn.B[2] = ink[2]; Fn.B[3] = ink[3];
    Fn.K[0] = (x0 + x1) / 2; Fn.K[1] = (y0 + y1) / 2; Fn.K[2] = (x1 - x0) / 2; Fn.K[3] = (y1 - y0) / 2;
    Fn.L[0] = Math.log2(Math.max(2, (y1 - y0) * ch * 0.5));      // a mip whose texel is about half the block's height (the chain is one texel per CSS pixel)
    S.words = Fn;
    this.rect = [x0 * cw, (1 - y1) * ch, x1 * cw, (1 - y0) * ch, this.items[w.i].key];   // the ink block in CSS pixels (lab measure)
  }
  // lab: for each item, over its hold, how big its capitals stand (CSS px), where it lies in the frame, how square to the lens
  metrics() {
    this._ensure();
    const I = this.I, asp = I.h.camera.aspect || 1, hCss = (document.getElementById('gl') || {}).clientHeight || innerHeight, W = innerWidth;
    return this.items.map((it, i) => {
      const f = this.fitOf(i), r = this.rast[i], rows = [];
      for (let t = f.t0; t <= f.t1 + 1e-6; t += (f.t1 - f.t0) / 12) {
        const pose = I.shot(t).pose, b = Q.basis(pose.q), ty = Math.tan(pose.fov / 2), q = this._quad(i, t, pose, asp);
        const pr = (c) => { const d = V3.sub(c, pose.pos), z = -V3.dot(d, b[2]); return [(V3.dot(d, b[0]) / (z * ty * asp) + 1) * W / 2, (1 - V3.dot(d, b[1]) / (z * ty)) * hCss / 2, z]; };
        const cs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => pr(V3.add(V3.add(q.O, V3.scale(q.R, sx)), V3.scale(q.U, sy))));
        const top = cs[2][1], bot = cs[0][1], hpx = Math.abs(bot - top);
        rows.push({ t: +t.toFixed(2), cap: +(hpx * r.capV).toFixed(1), head: +(hpx * r.headV).toFixed(1), x0: Math.round(Math.min(...cs.map((c) => c[0]))), x1: Math.round(Math.max(...cs.map((c) => c[0]))), y0: Math.round(Math.min(...cs.map((c) => c[1]))), y1: Math.round(Math.max(...cs.map((c) => c[1]))), face: +V3.dot(V3.norm(V3.cross(q.R, q.U)), V3.norm(V3.sub(pose.pos, q.O))).toFixed(2) });
      }
      return { key: it.key, at: +it.at.toFixed(3), end: it.end, mode: f.mode, info: f.info, rows: r.rows, letters: r.letters, min: Math.min(...rows.map((x) => x.cap)), max: Math.max(...rows.map((x) => x.cap)), headMin: it.head ? Math.min(...rows.map((x) => x.head)) : null, frames: rows };
    });
  }
}

// lab only (tests import this module and call it; it is not part of the page's contract): the words' placements, their
// sizes over each hold, and a switch that draws them without the depth test (to measure how many letters strands cross)
export function wordsProbe(o = {}) {
  const I = LAST; if (!I || !I.words) return null;
  const W = I.words; if ('noDepth' in o) W.noDepth = !!o.noDepth;
  if ('mode' in o) W.mode = +o.mode || 0;                          // INTRO LEGIBLE: 0 as seen, 1 the letters alone (white on black), 2 without the shade
  if (o.rect) return { rect: W.rect, cur: W.cur.map((x) => ({ key: W.items[x.i].key, a: x.a, p: x.p })), fit: W.cur.length ? W.fitOf(W.cur[0].i).info : null, mode: W.fitOf && W.cur.length ? W.fitOf(W.cur[0].i).mode : null };
  if (o.refit) { W.fit = null; W.fitKey = ''; const t0 = performance.now(); W._ensure(); const t1 = performance.now(); W.items.forEach((_, i) => W.fitOf(i)); o.ms = [+(t1 - t0).toFixed(1), +(performance.now() - t1).toFixed(1)]; }
  if (o.poses) return o.poses.map((t) => { const p = I.shot(t).pose; return [t, +p.focus.toFixed(1), +(p.aperture || 0).toFixed(4), +p.fov.toFixed(3), p.pos.map((v) => +v.toFixed(1))]; });
  return { ms: o.ms, long: I.long, on: I.wordsOn, rastPx: W.rastPx, items: o.metrics ? W.metrics() : W.items.map((it, i) => ({ key: it.key, at: it.at, end: it.end, mode: W.fitOf(i).mode, info: W.fitOf(i).info })) };
}
