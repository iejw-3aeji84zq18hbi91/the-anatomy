// The Anatomy: boot, page contract, frame loop. The merged viewer (see MERGE.md).
// This file is the features lane's main.js with the other two lanes' edits carried in by hand:
//   FEATURES     wiring for the burst replay, deep links, the legend and the key caps (burst.js, lines.js, deeplink.js, panels.js)
//   LIGHT-MERGE  the hooks for the specimen plate (specimen.js)
//   LAYOUT       the layout lane's edits: air by pose, the chain tendon on focus, the labels / rail checks
//   MERGE        lines written at the merge, where two lanes meet

import { buildModel, loadFeed } from './feed.js?v=mweb9mux';
import { buildAnatomy, combRows, partRows, recordPitch, CPN } from './anatomy.js?v=mweb9mux';
import { Renderer, drawRadius } from './renderer.js?v=mweb9mux';
import { Camera } from './camera.js?v=mweb9mux';
import { Overlay, numeral } from './overlay.js?v=mweb9mux';
import { M4, V3, Q, clamp, mix, bspline } from './math.js?v=mweb9mux';
import { Burst } from './burst.js?v=mweb9mux';                           // FEATURES
import { fiberLines } from './lines.js?v=mweb9mux';                      // FEATURES
import { Panels } from './panels.js?v=mweb9mux';                         // FEATURES
import { readLinks, openFocus } from './deeplink.js?v=mweb9mux';         // FEATURES
import { Specimen } from './specimen.js?v=mweb9mux';                     // LIGHT-MERGE: the specimen plate (shot=specimen); everything about it lives in that one file
import { qs, LAB, labQ } from './lab.js?v=mweb9mux';                     // FIX V42: look-dev and measurement switches are read only with ?lab=1
import { Intro } from './intro.js?v=mweb9mux';                           // INTRO: the opening sequence, cut to the track (intro.js, INTRO.md)

const SHOT = qs.get('shot');
const STILL = qs.get('still') === '1';
const T0 = parseFloat(qs.get('t')) || 0;
const UI = qs.get('ui') !== '0';
const QUALITY = ['auto', 'high', 'low'].includes(qs.get('quality')) ? qs.get('quality') : 'auto';
const DBG = { dof: labQ('dof') !== '0', bloom: labQ('bloom') !== '0' };       // look-dev switches (lab only)
const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LINK = readLinks(qs);                                   // FEATURES: ?focus=<node id>, ?burst=<same-origin url>
const BURST_DIM = 0.20;                                       // FEATURES: how far the library's own light steps back under a burst (FIX V14: was 0.34; proven cores still shouted over the sparks)
const BURST_BLOOM = 0.11;                                     // FEATURES: and how much the sparks bloom
const NO_LABEL = ' ';                                         // FEATURES: an id no muscle has
// LAYOUT: the interior is about three times the size of the old body, so the air is thinner by about the same
// factor: the far bank is still a place and the architecture beyond it still dissolves.
const FOG_IN = +labQ('fog') || 0.0027, FOG_PLATE = 0.0011;      // CABLES: the plate lens stands half as far off as it did: the same air over the river, more between the near bank and the far
// CLARITY (founder, 12 Nov 2:45 PM, after watching the intro: "the intro looks amazing, can we get that type of clarity for
// anatomy? it seems brighter or something"). What the intro does before its reveal is open the lens and take most of the
// light out of the air, so the glass stands sharp against black. CLEAR brings that to the whole viewer:
// [exposure, light in the air (the haze and the glow of the beams), far mist, light shafts], each against the look of the
// third art pass ([1, 1, 1, 1] is exactly that look). Look-dev: lab=1&clear=1.3,0.45,0.5,0.5 tries other values.
const CLEAR_SET = [1.45, 0.35, 0.4, 0.45];   // chosen from stills on both feeds: the lens 1.45 times as open, about a third of the light left in the air
const CLEAR = labQ('clear') ? labQ('clear').split(',').map((v, i) => (Number.isFinite(+v) ? +v : CLEAR_SET[i])) : CLEAR_SET;

// Where the skill map comes from, in this order:
//   1. ?feed=<same-origin address>        (anything else is refused: the page says the map could not be read, FIX V22)
//   2. <meta name="anatomy-feed" content> in index.html, which the app sets to its own address (FIX V06)
//   3. the default below
const meta = (name) => { const m = document.querySelector(`meta[name="${name}"]`); return m && m.content ? m.content : null; };
function feedUrl() {
  const REAL = '../kit/feed.json';
  // MOCK FOR NOW (Dakota, 2026-11-10): the default is the mock feed so the look of a well-used Anatomy can be seen.
  // TO REMOVE THE MOCK: set def to REAL on the next line (and delete kit/feed-mock.json and kit/make-mock-feed.mjs).
  const def = '../kit/feed-mock.json';
  const q = qs.get('feed') || meta('anatomy-feed');
  if (q) { try { const u = new URL(q, location.href); return u.origin === location.origin ? u.href : null; } catch { return null; } }
  // FIX V18: a link to one real skill (the chat's "See it in the Anatomy") or to a recorded burst never opens on invented
  // numbers: it gets the real feed. Only the bare page, with nothing asked of it, opens on the mock.
  return LINK.focus || LINK.burstAsked ? REAL : def;
}

const canvas = document.getElementById('gl');
const app = {
  time: T0, growth: 1, playing: false, dim: 1, hover: -1, focus: -1,
  model: null, anat: null, seen: new Set(), queue: [], replaying: 0, scale: QUALITY === 'low' ? 0.5 : 1, frames: 0,
  combing: new Map(),                                        // ENG (E2): rows of a strand on their way to or from being combed
  beam: 1, glow: new Map(),                                   // FIX V14: the shafts step out under a burst; fibers holding an afterglow
};
let renderer, camera, overlay, specimen;                      // LIGHT-MERGE: + specimen
let burst, panels;                                            // FEATURES
let intro = null;                                             // INTRO

// ---------------------------------------------------------------- feed -> anatomy
function apply(doc, { first = false, error = null } = {}) {
  const prevIds = app.model ? new Set(app.model.skills.map((s) => s.id)) : null;
  const focusId = app.focus >= 0 && app.anat ? app.anat.fibers[app.focus].skill.id : null;
  // FIX V22: a feed that could not be fetched or read is not an empty library and not a partial one. It is shown as what it is.
  if (!error && (!doc || typeof doc !== 'object' || Array.isArray(doc))) error = 'the feed is not a skill map document';
  if (error) console.error('The Anatomy: the skill map could not be read. ' + error);
  app.model = buildModel(error ? null : doc);
  app.model.error = error || null;
  app.mock = !error && !!(doc && doc.mock === true);          // MOCK: a feed that says "mock": true is invented data
  document.body.classList.toggle('is-mock', app.mock);
  const mockBanner = document.getElementById('mock');
  if (mockBanner) mockBanner.hidden = !app.mock;              // and the screen says so, on every frame, until a real feed is loaded
  app.anat = buildAnatomy(app.model); recKey = -1;             // ART (A7): the cached record points belong to the old anatomy
  if (specimen && specimen.isOpen) specimen.lay(app.model, app.anat);   // LIGHT-MERGE: an open specimen plate survives a refreshed feed (the six rows are laid before the upload)
  renderer.setAnatomy(app.anat); camera.setAnatomy(app.anat); overlay.build(app.model, app.anat);
  // REPAIR (R3): a body at rest is dim by the tier rule (formed 1, practised 3, proven 10), and a sparse library is mostly at
  // rest: the real feed today drew darker than it did before the art pass. The lens opens for it, as a camera does for a
  // dim room: one exposure for the whole picture, from the mean tier of the library (a full body with half its fibers
  // proven: 1.0; the real feed today: about 2.0). The air is not opened with it (renderer.js, _air). In a close-up and under a burst
  // the lens closes again as the rest of the body steps back (app.dim): one fiber or the sparks are the subject there. Every ratio inside the picture is what it was.
  { let lv = 0; for (const f of app.anat.fibers) lv += f.skill.tier > 1.5 ? 10 : f.skill.tier > 0.5 ? 3 : 1; app.expo = Math.min(2.1, Math.max(1, Math.pow(5 / Math.max(lv / Math.max(app.anat.fibers.length, 1), 1), 0.5))); }
  app.comb = null; app.combing.clear();                       // FIX V12: a new anatomy is uploaded as it is; a fiber still in focus is combed again below (ENG E2: and no row is left on its way)
  if (specimen && specimen.isOpen) specimen.relabel();        // FIX V39: its labels are rebuilt after the overlay has rebuilt its own (the overlay empties the label layer)
  app.hover = -1; app.focus = -1; app.glow.clear();
  overlay.growthUI(app.growth);
  if (!first && prevIds) for (const f of app.anat.fibers) if (!prevIds.has(f.skill.id) && !(intro && intro.active && !(f.skill.birth >= 0))) renderer.born(f.index, app.time);   // new ids grow in   // INTRO REPAIR: not an undated one while the sequence plays (nothing undated is ever shown forming inside it; after it the page's own rule stands, the founder's call)
  // a spark runs down a fiber only when an event id arrives that has not been seen before
  for (const e of app.model.events) {
    if (!e || app.seen.has(e.id)) continue;
    app.seen.add(e.id);
    const s = !first && e.node ? app.model.byId.get(e.node) : null;
    if (s && s.fiber >= 0) app.queue.push({ at: app.time + 0.2 + Math.random() * 0.6, fiber: s.fiber });
  }
  if (focusId && app.model.byId.has(focusId)) focus(focusId, { instant: true }); else if (focusId) clearFocus();
  // FEATURES: the legend names twisted versions and feeding tendons only when the model carries such links
  panels.features({ strands: !!(app.model.strands && app.model.strands.length), chains: !!(app.model.chains && app.model.chains.length) });
  // FEATURES: a burst that is replaying keeps its clock and finds its fibers again in the new anatomy
  if (burst && burst.active) { if (burst.remap()) { panels.burstOpen(burst.info, numeral(burst.info.family)); camera.framing(burstPose(), { instant: true }); } else clearFocus(); }
  if (intro) intro.anatomy();                                 // INTRO: a feed that arrives during the sequence does not restart it
}

// ---------------------------------------------------------------- focus and its nerve lines
// LAYOUT: a quadratic curve from a through mid to b, as one spare spline row.
function line(from, mid, to, style) {
  const cp = new Float32Array(CPN * 4);
  for (let i = 0; i < CPN; i++) {
    const u = (i - 1) / (CPN - 3), g = 1 - u;
    cp.set([from[0] * g * g + mid[0] * 2 * g * u + to[0] * u * u, from[1] * g * g + mid[1] * 2 * g * u + to[1] * u * u, from[2] * g * g + mid[2] * 2 * g * u + to[2] * u * u, 1], i * 4);
  }
  let len = 0, prev = bspline(cp, 0, CPN, 0).p;
  for (let k = 1; k <= 24; k++) { const q = bspline(cp, 0, CPN, k / 24).p; len += V3.dist(q, prev); prev = q; }
  return { cp, len, ...style };
}
// LAYOUT: lines drawn only while a fiber is in focus: thin nerve lines to the tools it uses, and for every
// chains_to link a thin dark tendon to the fiber it feeds (or is fed by).
function nerves(skill) {
  if (!skill) { renderer.setNerves([]); return; }
  const a = app.anat, from = a.point(skill.fiber, 0.5).p, lines = [];
  const pt = (i, u) => (app.comb && app.comb.has(i) ? bspline(app.comb.get(i), 0, CPN, u) : a.point(i, u));   // FIX V12: a tendon lands on the fiber where it is drawn
  // The tendon leaves the feeding fiber just past its record and lands on the fed one just before its
  // record. It bows a little to one side as the lens sees it (never toward the lens, where it would
  // cover the bands), so it reads as a bridge between two strands and not as a third strand.
  const eye = camera.custom && camera.mode === 'focus' ? camera.custom.pos : null;
  for (const c of skill.chains || []) {
    if (c.other.fiber < 0) continue;
    const A = pt(skill.fiber, 0.5 + 0.045 * c.dir), B = pt(c.other.fiber, 0.5 - 0.045 * c.dir);
    const span = V3.sub(B.p, A.p), d = V3.len(span), half = V3.lerp(A.p, B.p, 0.5);
    let bow = V3.cross(eye ? V3.sub(half, eye) : A.t, span); bow = V3.len(bow) > 1e-4 ? V3.norm(bow) : V3.perp(A.t);
    if (V3.dot(bow, [0, 1, 0]) < 0) bow = V3.scale(bow, -1);
    lines.push(line(A.p, V3.addS(half, bow, 0.5 + d * 0.14), B.p, { radius: 0.095, color: [0.86, 0.84, 0.80], state: 2 }));
  }
  for (const tn of a.toolNodes) {
    if (!skill.toolIds.includes(tn.tool.id)) continue;
    const to = tn.pos;
    lines.push(line(from, V3.add(V3.lerp(from, to, 0.5), [0, V3.dist(from, to) * 0.12, 0]), to));
  }
  renderer.setNerves(lines);
}
// FIX V12: while a fiber that is twisted with other versions of the same request is in focus, the strand is combed straight
// over its record so every band and notch can be counted (anatomy.js combRows). Leaving the close-up puts it back.
// ENG (E2): the strand is not combed in one frame. Every row that is being moved eases from where it is drawn now to where
// it should lie (the combed row, or the anatomy's own again) over COMB_S seconds; the camera is flying in or out meanwhile,
// so the strand opens as the lens arrives and closes as it leaves, and nothing snaps. app.combing: row index -> { from,
// to, cur, t0 }. With reduced motion, in a still, and after a lost context the rows are put where they belong at once.
const COMB_S = 0.4;
const ownRow = (i) => app.anat.cp.subarray(i * CPN * 4, (i + 1) * CPN * 4);
function combTo(i, to, instant) {
  if (!(i >= 0 && i < app.anat.count)) return;
  if (instant || REDUCED || STILL) { app.combing.delete(i); renderer.setRows([{ index: i, cp: to }]); return; }
  const was = app.combing.get(i), cur = was ? was.cur : Float32Array.from(app.comb && app.comb.has(i) ? app.comb.get(i) : ownRow(i));
  app.combing.set(i, { from: Float32Array.from(cur), to, cur, t0: performance.now() });
}
function combStep(now) {
  if (!app.combing.size) return;
  const rows = [];
  for (const [i, c] of app.combing) {
    const u = clamp((now - c.t0) / (COMB_S * 1000), 0, 1), e = u * u * (3 - 2 * u);
    for (let k = 0; k < c.cur.length; k++) c.cur[k] = c.from[k] + (c.to[k] - c.from[k]) * e;
    rows.push({ index: i, cp: u >= 1 ? c.to : c.cur });
    if (u >= 1) app.combing.delete(i);
  }
  renderer.setRows(rows);
}
function uncomb({ instant = false } = {}) {
  if (!app.comb) return;
  const keys = [...app.comb.keys()];
  for (const i of keys) combTo(i, ownRow(i), instant);         // (combTo reads app.comb for where the row is drawn now)
  app.comb = null;
}
function comb(skill, { instant = false } = {}) {
  let rows = !skill || (specimen && specimen.isOpen) || !camera.custom ? null : combRows(app.anat, skill.fiber, camera.custom.pos, drawRadius(app.anat.fibers[skill.fiber]));
  // REPAIR (R5): and the neighbours of the fiber in focus stand back from it (anatomy.js partRows), eased like the combed rows
  if (skill && !(specimen && specimen.isOpen) && camera.custom) { const part = partRows(app.anat, skill.fiber, camera.custom.pos, rows ? new Set(rows.map((r) => r.index)) : null); if (part.length) rows = (rows || []).concat(part); }
  const next = rows && rows.length ? new Map(rows.map((r) => [r.index, r.cp])) : null;
  if (app.comb) for (const i of app.comb.keys()) if (!next || !next.has(i)) combTo(i, ownRow(i), instant);   // rows the new close-up leaves alone go home
  if (next) for (const [i, cp] of next) combTo(i, cp, instant);
  app.comb = next;
}
function focus(id, { instant = false } = {}) {
  const s = app.model && app.model.byId.get(String(id));
  if (!s || s.fiber < 0) return false;
  stopBurst();                                                // FEATURES
  if (app.focus >= 0) renderer.setHighlight(app.focus, 0);
  app.focus = s.fiber; renderer.setHighlight(s.fiber, 2);
  camera.focus(s.fiber, { instant: instant || STILL });
  comb(s, { instant });
  overlay.showCard(s, s.toolIds.map((t) => app.model.toolById.get(t)).filter(Boolean));
  overlay.tooltip(null);
  nerves(s);
  return true;
}
function clearFocus({ instant = false } = {}) {
  stopBurst();                                                // FEATURES: Escape ends a burst and flies back, like any close-up
  if (app.focus >= 0) renderer.setHighlight(app.focus, 0);
  const had = app.focus >= 0;
  app.focus = -1; overlay.hideCard(); renderer.setNerves([]); uncomb({ instant });
  // LIGHT-MERGE: Esc from a specimen returns to the plate; Esc on the plate closes it and flies back to the rail
  if (specimen && specimen.isOpen) { if (had) { camera.framing(specimen.pose(specimen.aspect), { instant: instant || STILL }); return; } specimen.close(); }
  camera.clearFocus({ instant: instant || STILL });
}
// MERGE: the specimen plate can now be opened from the legend, so every other way of taking the camera (overview, a chip,
// the burst) first puts its six fibers back where the anatomy had them. Esc is handled in clearFocus above.
function leaveSpecimen() { if (specimen && specimen.isOpen) specimen.close(); }
// MERGE: and the legend button leaves whatever was open (a running burst, a fiber in focus) before the plate takes the camera.
function leaveAll() {
  stopBurst();
  if (app.focus >= 0) { renderer.setHighlight(app.focus, 0); app.focus = -1; overlay.hideCard(); renderer.setNerves([]); uncomb(); }
}
function setMode(mode, opts = {}) {
  if (mode !== 'tour' && mode !== 'plate') return;
  stopBurst();                                                // FEATURES
  leaveSpecimen();                                            // MERGE
  if (app.focus >= 0) { renderer.setHighlight(app.focus, 0); app.focus = -1; overlay.hideCard(); renderer.setNerves([]); uncomb(); }
  if (camera.mode === 'custom' || camera.mode === 'focus') { camera.back = mode; camera.clearFocus({ instant: opts.instant || STILL }); }
  camera.setMode(mode, { instant: opts.instant || STILL });
  panels.overview(mode === 'plate');                          // FEATURES: the button keeps its key cap
}
function setGrowth(g, fromUser) {
  app.growth = clamp(+g || 0, 0, 1);
  if (fromUser) { app.playing = false; overlay.playing(false); }
  overlay.growthUI(app.growth);
}
function playGrowth() {
  app.playing = !app.playing;
  if (app.playing && app.growth >= 1) app.growth = 0;
  overlay.playing(app.playing);
}
function replay() {
  const ev = app.model ? app.model.events.filter((e) => e && e.node && app.model.byId.has(e.node)) : [];
  if (!ev.length) return 0;
  const dur = clamp(ev.length * 0.05, 3, 10);
  ev.forEach((e, i) => app.queue.push({ at: app.time + 0.3 + (i / ev.length) * dur, fiber: app.model.byId.get(e.node).fiber }));
  // FIX V34: the caption says what is replayed and what a spark is, counted from the events themselves. A spark here is
  // never a job (the burst replay, a few keys away, is where a spark is a job).
  const kinds = new Map(), n = ev.length;
  for (const e of ev) { const k = typeof e.kind === 'string' && e.kind ? e.kind : 'unnamed'; kinds.set(k, (kinds.get(k) || 0) + 1); }
  const lessons = kinds.size === 1 && kinds.has('learned'), N = n.toLocaleString('en-US');
  overlay.caption(true, lessons
    ? [`Replaying ${N} recorded ${n === 1 ? 'lesson' : 'lessons'}`, `Each spark is one skill being learned, not a job.${app.mock ? ' Mock data.' : ''}`]
    : [`Replaying ${N} recorded ${n === 1 ? 'event' : 'events'}`, `Each spark is one event on its skill (${[...kinds].map(([k, c]) => `${c.toLocaleString('en-US')} ${k}`).join(', ')}), not a job.${app.mock ? ' Mock data.' : ''}`]);
  app.replaying = app.time + dur + 2.2;
  return ev.length;
}
function toMuscle(id) {
  stopBurst();                                                // FEATURES
  leaveSpecimen();                                            // MERGE
  if (app.focus >= 0) { renderer.setHighlight(app.focus, 0); app.focus = -1; overlay.hideCard(); renderer.setNerves([]); uncomb(); }
  if (!camera.toMuscle(id)) { const m = app.anat.muscleById.get(id); if (m) camera.framing(camera.bundlePose(m), { instant: STILL }); }
  panels.overview(false);                                     // FEATURES
}

// ---------------------------------------------------------------- FEATURES: the burst replay
// One recorded sandbox run, played back as sparks on the fibers of its skills (burst.js). The camera flies to a
// framing that holds those fibers; the counters and the caption sit under the totals; Escape ends it.
const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
// the part of the frame the overlay leaves open while the counters are up, in NDC (y up)
function safeArea() {
  const W = Math.max(1, canvas.clientWidth), H = Math.max(1, canvas.clientHeight);
  const roomy = W - 392 - 44 > 260 && H - 146 - 188 > 200;     // in a very small window the whole frame is used instead
  const box = UI && roomy ? { l: 44, r: W - 392, t: 188, b: H - 146 } : { l: W * 0.06, r: W * 0.94, t: H * 0.08, b: H * 0.92 };
  return { x0: (box.l / W) * 2 - 1, x1: (box.r / W) * 2 - 1, y0: 1 - (box.b / H) * 2, y1: 1 - (box.t / H) * 2 };
}
const BVIEW = labQ('bview') ? labQ('bview').split(',').map(Number) : null;   // look-dev: bview=<side 0..3>,<yaw>,<pitch>
const burstPose = () => burst.pose(aspect(), safeArea(), +labQ('bfov') || undefined, BVIEW);
let burstAsk = 0, burstDoc = null;
async function loadBurst() {
  if (burstDoc) return burstDoc;
  const res = await fetch(LINK.burstUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error('burst ' + res.status);
  return (burstDoc = await res.json());
}
// doc: a burst document, or nothing to load the one named by ?burst= (default ../kit/burst-25k.json).
// at: where in the replay to start, 0..1. Resolves true when sparks are on their way.
async function playBurst(doc, { at = 0, instant = false } = {}) {
  const ask = ++burstAsk;
  if (!doc) {
    try { doc = await loadBurst(); } catch (e) { doc = null; }
    if (ask !== burstAsk) return false;                       // stopped, or asked again, while the file was on its way
  }
  if (app.focus >= 0) { renderer.setHighlight(app.focus, 0); app.focus = -1; overlay.hideCard(); renderer.setNerves([]); uncomb(); }
  leaveSpecimen();                                            // MERGE: the replay runs in the anatomy, not on the specimen plate
  if (app.growth < 1) setGrowth(1, true);                    // the replay runs on the library as it stands today
  if (!burst.read(doc)) { burst.fail(); panels.burstQuiet('That run could not be read.'); return false; }
  const here = burst.active && camera.mode === 'custom';      // replaying again from the same framing
  if (!burst.arm({ now: app.time, at, delay: instant || STILL ? 0 : here ? 0.5 : 1.5 })) {
    burst.fail(); panels.burstQuiet('None of the skills in this run are in this library.'); return false;
  }
  camera.framing(burstPose(), { instant: instant || STILL || here });
  panels.burstOpen(burst.info, numeral(burst.info.family));
  return true;
}
// Ends the replay and takes the counters down. The camera is left to whoever called (clearFocus flies it back).
function stopBurst() {
  burstAsk++;
  if (!burst || burst.phase === 'idle') return false;
  burst.stop(); panels.burstClose();
  return true;
}
// B: play, or stop a replay that is running. After a replay has finished, B plays it again.
function toggleBurst() {
  if (burst.phase === 'flying' || burst.phase === 'playing') clearFocus(); else playBurst();
}
function escape() {
  const closeUp = burst.phase !== 'idle' || app.focus >= 0 || camera.mode === 'custom' || camera.mode === 'focus';
  if (!closeUp && panels.legendOpen) panels.legend(false); else clearFocus();
}

// ---------------------------------------------------------------- input
function bindInput() {
  let down = null, moved = 0, pointer = null, wheelAcc = 0;
  canvas.addEventListener('pointerdown', (e) => { if (intro && intro.pointer(e)) return; down = { x: e.clientX, y: e.clientY }; moved = 0; canvas.setPointerCapture(e.pointerId); panels.notice(null); });   // INTRO: a click on the picture ends the sequence, and is nothing more
  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY, dirty: true };
    if (!down || (intro && intro.active)) return;                // INTRO: no drag until the hand-over
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 5) { camera.drag(dx, dy); canvas.classList.add('dragging'); overlay.tooltip(null); }
    down = { x: e.clientX, y: e.clientY };
  });
  const up = (e) => {
    if (intro && intro.pointerUp(e)) return;                  // INTRO: a click in place ends the sequence; a drag does nothing
    if (!down) return;
    canvas.classList.remove('dragging'); camera.endDrag();
    if (moved <= 5) {
      const r = canvas.getBoundingClientRect(), i = renderer.pick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      if (i >= 0) focus(app.anat.fibers[i].skill.id);
    }
    down = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { down = null; camera.endDrag(); canvas.classList.remove('dragging'); });
  canvas.addEventListener('pointerleave', () => { pointer = null; overlay.tooltip(null); if (app.hover >= 0 && app.hover !== app.focus) renderer.setHighlight(app.hover, 0); app.hover = -1; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (intro && intro.active) return;                        // INTRO: the wheel does nothing until the hand-over
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    if (camera.mode === 'plate') { wheelAcc += dy; if (wheelAcc < -160) { wheelAcc = 0; setMode('tour'); } return; }
    if (camera.mode === 'focus' || camera.mode === 'custom') { wheelAcc += dy; if (Math.abs(wheelAcc) > 220) { wheelAcc = 0; clearFocus(); } return; }
    camera.scroll(dy);
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (intro && intro.key(e)) return;                        // INTRO: the sequence asks first (it ends on Escape, Enter, Space and the viewer's keys; I plays it again)
    const k = e.key;
    panels.notice(null);                                      // FEATURES: a quiet notice leaves at the first key
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); camera.toggleAuto(); }
    else if (k === 'Escape') escape();                        // FEATURES: ends a burst, leaves a close-up, or closes the legend
    else if (k === 'o' || k === 'O') setMode(camera.mode === 'plate' ? 'tour' : 'plate');
    else if (k === 'r' || k === 'R') replay();
    else if (k === 'b' || k === 'B') toggleBurst();            // FEATURES
    else if (k === 'l' || k === 'L') panels.legend();          // FEATURES
    else if (k === 'ArrowRight' || k === 'ArrowUp') camera.scroll(-260);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') camera.scroll(260);
  });
  // FIX V38: hover asks at most ten times a second and never waits for the GPU: the answer is fetched a frame or two later
  let asked = 0;
  return () => {
    if (intro && intro.active) { pointer = null; return; }   // INTRO: no hover while the sequence plays, and none after it until the pointer moves again
    const i = renderer.pickPoll();
    if (i !== undefined && pointer && !down && !camera.flight) {
      if (i !== app.hover) {
        if (app.hover >= 0 && app.hover !== app.focus) renderer.setHighlight(app.hover, 0);
        if (i >= 0 && i !== app.focus) renderer.setHighlight(i, 1);
        app.hover = i;
      }
      canvas.classList.toggle('over', i >= 0);
      overlay.tooltip(i >= 0 ? app.anat.fibers[i].skill : null, pointer.x, pointer.y);
    }
    if (!pointer || !pointer.dirty || down || camera.flight) return;
    const now = performance.now();
    if (now - asked < 100) return;
    const r = canvas.getBoundingClientRect();
    if (renderer.pickAsync((pointer.x - r.left) / r.width, (pointer.y - r.top) / r.height)) { pointer.dirty = false; asked = now; }
  };
}

// ---------------------------------------------------------------- size and quality
function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * app.scale;
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  renderer.resize(w, h, w / Math.max(1, canvas.clientWidth), Math.min(window.devicePixelRatio || 1, 2));   // ENG (E1): the renderer is told the screen's ratio, so its rules are in CSS pixels
}
// FIX V24: the automatic quality works both ways and by the clock. It keeps a running average of the real time a frame
// takes. Above 22 ms for a second and a half it steps down: lower internal resolution, fewer taps in the depth of field,
// and fewer segments along every fiber (the heavy feeds are bound by vertices, not pixels). Holding the display's
// rate for a while it steps back up, restoring everything; if that step up fails at once, it waits twice as long
// before trying again, so it cannot hunt.
// ENG (E3): the profile says the heavy feeds are bound by the pixels of the fringe pass, not by vertices (dropping that pass
// takes a 10,000-skill plate from 54 ms to 8). So the first two steps no longer take segments away from the fibers (a
// fiber with fewer segments shows its corners): they lower the resolution, which is what pays. Was seg 1, 0.7, 0.5, 0.34.
const QLEVELS = [{ scale: 1, taps: 48, shafts: true, seg: 1 }, { scale: 0.75, taps: 32, shafts: true, seg: 1 }, { scale: 0.6, taps: 20, shafts: true, seg: 0.8 }, { scale: 0.5, taps: 20, shafts: false, seg: 0.5 }];
const aq = { level: 0, ema: 16.7, slow: 0, fast: 0, wait: 5, upAt: -1e9, t0: 0 };
function setQuality(level) {
  const L = QLEVELS[(aq.level = clamp(level, 0, QLEVELS.length - 1))];
  app.scale = QUALITY === 'low' ? 0.5 : L.scale; renderer.quality.taps = L.taps; renderer.quality.shafts = L.shafts; renderer.setSegments(L.seg);
}
function autoQuality(real) {                        // real: seconds since the last frame, by the clock
  if (QUALITY !== 'auto' || STILL) return;
  const now = performance.now();
  if (!aq.t0) aq.t0 = now;
  if (now - aq.t0 < 1500 || real > 1) return;       // a second and a half to settle, by the clock; a pause (a hidden tab) is not a slow frame
  // ENG (E2): one long frame is not a slow machine. A click on a fiber (the pick is read back, the close-up is chosen, the
  // flight is routed) or a busy moment elsewhere on the machine makes a single frame of 100 ms or more; weighted by its
  // own length it pushed the average over the line for more than a second and the quality stepped down in the middle of
  // an ordinary session (the art pass saw this and could not find the cause). A frame now counts for at most 50 ms, so a
  // lone hitch moves the average by a few milliseconds; a rate that stays low still takes it over the line within a second.
  const fr = Math.min(real, 0.05);
  aq.ema += (fr * 1000 - aq.ema) * Math.min(1, fr / 0.4);
  if (aq.ema > 22) { aq.slow += real; aq.fast = 0; } else if (aq.ema < 17.6) { aq.fast += real; aq.slow = Math.max(0, aq.slow - real); } else { aq.fast = 0; aq.slow = Math.max(0, aq.slow - real); }
  if (aq.slow > 1.5 && aq.level < QLEVELS.length - 1) {
    if (now - aq.upAt < 8000) aq.wait = Math.min(aq.wait * 2, 80);
    setQuality(aq.level + 1); aq.slow = 0; aq.fast = 0; aq.ema = 16.7;
  } else if (aq.fast > aq.wait && aq.level > 0) { setQuality(aq.level - 1); aq.upAt = now; aq.fast = 0; aq.slow = 0; }
}

// ---------------------------------------------------------------- shot presets
function preset() {
  const auto = qs.get('autopilot');
  camera.auto = auto === '1' ? true : auto === '0' ? false : !SHOT;
  if (REDUCED && auto !== '1') camera.auto = false;           // FIX V41: with reduced motion the autopilot is off, and its button says so
  camera.frozen = STILL;
  if (STILL || auto === '1') camera.railT = T0;
  camera.autoK = camera.auto && !REDUCED ? 1 : 0;
  if (!SHOT) return;
  camera.auto = auto === '1';
  if (SHOT === 'plate') setMode('plate', { instant: true });
  else if (SHOT === 'growth') { setMode('plate', { instant: true }); setGrowth(0.35); }
  else if (SHOT === 'bundle') { const f = app.model.provenFamily; if (f) camera.framing(camera.bundlePose(app.anat.muscleById.get(f.id))); }
  else if (SHOT === 'fiber') { if (app.model.mostProven) focus(app.model.mostProven.id, { instant: true }); }
  else if (SHOT === 'specimen') specimen.open();              // LIGHT-MERGE: six real fibers, one of each kind, side by side
  else camera.railT = auto === '1' ? T0 : 0;      // inside: the hero frame is rail stop 0
  if (labQ('cam')) {                              // look-dev only (lab=1): cam=x,y,z&tgt=x,y,z&foc=distance&fov=radians
    const v = (k, d) => (labQ(k) || d).split(',').map(Number), pos = v('cam', '0,0,100'), tgt = v('tgt', '0,0,0');
    camera.framing({ pos, q: Q.look(pos, tgt), fov: +labQ('fov') || 0.84, focus: +labQ('foc') || V3.dist(pos, tgt), aperture: labQ('ap') == null ? 0.0062 : +labQ('ap'), air: +labQ('air') || 0, fogK: 1 });   // LAYOUT: + ap, air
  }
  camera.flight = null;
}

// ART (A7): where the muscle label's dot may sit on a fiber in close-up: just past either end of its record, between the
// last band and the collar, never on a band or a notch. (It sat on the middle of the fiber, which is the middle of the record.)
function dotPlaces(i) {
  const f = app.anat.fibers[i], sk = f.skill, nb = sk.jobs, nn = sk.handed;
  if (nb + nn <= 0) return app.anat.point(i, 0.5).p;
  const rad = Math.min(f.radius, 2.2 * 0.19), pitch = recordPitch(rad, f.len, nb, nn), pn = 0.72 * pitch;
  const span = Math.max(nb - 1, 0) * pitch + (nb && nn ? 0.5 * pitch + 0.62 * pn : 0) + Math.max(nn - 1, 0) * pn;
  const d = (0.5 * span + (sk.originCode === 2 ? 0.46 : 0.9) * pitch) / f.len;
  // and, for a record too long for the frame (both ends out of view), the middle of a gap between two bands near the centre
  const k = Math.max(0, Math.floor(nb / 2) - 1), gap = nb > 1 ? (0.5 * f.len - 0.5 * span + (k + 0.5) * pitch) / f.len : 0.5 - d;
  return [app.anat.point(i, Math.max(0.03, 0.5 - d)).p, app.anat.point(i, Math.min(0.97, 0.5 + d)).p, app.anat.point(i, gap).p];
}

// ART (A7): points along the record of a fiber, so the overlay can keep the muscle label off its bands and notches
let recKey = -1, recPts = null;
function recordPoints(i) {
  if (recKey === i && recPts) return recPts;
  const ends = dotPlaces(i); recKey = i; recPts = [];
  if (!Array.isArray(ends[0])) return recPts;
  const f = app.anat.fibers[i], sk = f.skill, rad = Math.min(f.radius, 2.2 * 0.19), pitch = recordPitch(rad, f.len, sk.jobs, sk.handed);
  const span = Math.max(sk.jobs - 1, 0) * pitch + (sk.jobs && sk.handed ? 0.5 * pitch + 0.62 * 0.72 * pitch : 0) + Math.max(sk.handed - 1, 0) * 0.72 * pitch, d = (0.5 * span + 0.3 * pitch) / f.len;
  for (let k = 0; k <= 40; k++) recPts.push(app.anat.point(i, Math.min(0.99, Math.max(0.01, 0.5 - d + 2 * d * k / 40))).p);
  return recPts;
}

// ---------------------------------------------------------------- frame loop
let raf = 0, running = false, frameFn = null;
function start() {
  const hover = bindInput();
  let last = performance.now(), sized = [0, 0];
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const real = Math.max(0, (now - last) / 1000), dt = Math.min(0.05, real); last = now;
    const shot = intro ? intro.frame(real) : null;            // INTRO: the shot of the sequence at its position (null when it is not running)
    if (!STILL && !(intro && intro.frozen != null)) app.time += dt;
    if (shot) { app.growth = shot.growth; camera.railT = shot.railT; camera.mode = 'tour'; }
    fit();
    if (app.playing) { app.growth = Math.min(1, app.growth + dt / 16); overlay.growthUI(app.growth); if (app.growth >= 1) { app.playing = false; overlay.playing(false); } }
    if (shot) app.queue.length = 0;                            // INTRO: no spark inside the sequence (a spark is a recorded event; a live one that arrives now is still in the record, only not flashed)
    while (app.queue.length && app.queue[0].at <= app.time) renderer.spark(app.queue.shift().fiber, app.time);
    if (app.replaying && app.time > app.replaying) { app.replaying = 0; overlay.caption(false); }
    // FEATURES: the burst clock, its counters, and a reframe if the window changed shape under it
    burst.update(app.time);
    const bOn = burst.active, cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (bOn && (cw !== sized[0] || ch !== sized[1]) && sized[0]) camera.framing(burstPose(), { instant: true });
    if (cw !== sized[0] || ch !== sized[1]) overlay.fitCard();   // FIX V29: an open card is fitted again when the window changes
    sized = [cw, ch];
    camera.aspect = cw / Math.max(1, ch); camera.narrow = cw < 1100; camera.short = ch < 780;   // FIX V15: the plate pulls back in a narrow window
    // FIX V14: as a replay ends, each of its fibers holds a light in proportion to its share of the jobs, then eases back to
    // its true state. Nothing is written to the record; the level lives a few seconds in the fiber's dynamic slot.
    const ag = burst.afterglow();
    if (ag) for (const [i, share] of ag.shares) { const v = Math.round(share * ag.k * 200) / 200; if ((app.glow.get(i) || 0) !== v) { app.glow.set(i, v); renderer.setGlow(i, v); } }
    else if (app.glow.size) { for (const i of app.glow.keys()) renderer.setGlow(i, 0); app.glow.clear(); }
    const ease = Math.min(1, dt * 4 + (STILL ? 1 : 0));
    // CABLES (second check: the last frame of a replay was nearly black): over the last seventh of the replay the body
    // comes back up toward its resting light, so the replay ends on the body with its counts, not on a dark frame
    const bEnd = bOn ? Math.min(1, Math.max(0, ((+burst.state.t || 0) - 0.86) / 0.14)) : 0;
    app.dim += ((app.focus >= 0 ? 0.3 : bOn ? BURST_DIM + (0.66 - BURST_DIM) * bEnd * bEnd * (3 - 2 * bEnd) : 1) - app.dim) * ease;
    app.beam += ((bOn ? 0 : 1) - app.beam) * ease;             // FIX V14: no shaft of light stands behind a burst
    app.focusK = (app.focusK || 0) + ((app.focus >= 0 ? 1 : 0) - (app.focusK || 0)) * ease;      // PASS3 (T4): the records of the other fibers step back with them
    const pose = shot ? (camera.pose = shot.pose) : camera.update(STILL ? 0 : dt);   // INTRO: while it runs the sequence holds the lens
    combStep(now);                                             // ENG (E2)
    const far = pose.air || 0;                                 // LAYOUT: air by pose. The plate stands well back: thin the air so the whole interior reads
    const look = {
      ...pose, aperture: DBG.dof ? pose.aperture : 0, time: app.time, growth: app.growth, sway: REDUCED ? 0 : 0.22, dim: app.dim, focusK: app.focusK || 0, mark: false,   // FOUNDER, 11 Nov 5:32 PM: the strip of words inside the picture is off on purpose (it was app.mock). Do not restore.
      fog: mix(FOG_IN * (pose.fogK == null ? 1 : pose.fogK), FOG_PLATE, far), beam: mix(0.50, 0.38, far) * app.beam, exposure: specimen && specimen.isOpen ? 1 : mix(1, app.expo || 1, Math.min(1, Math.max(0, (app.dim - 0.3) / 0.7))), bloom: DBG.bloom ? (bOn ? BURST_BLOOM : mix(0.10, 0.06, 1 - app.dim)) : 0, grain: 0.022, shafts: mix(0.9, 0.30, far) * app.beam,   // LAYOUT: fog, beam and shafts; FEATURES: bloom under a burst
    };
    // CLARITY: the whole viewer in the intro's clear light. Not while the sequence is still in its own dark (before its reveal it
    // has its own, tuned light), and not on the specimen plate (a calibrated plate at exposure 1).
    if (!(shot && shot.look && shot.look.house < 1) && !(specimen && specimen.isOpen)) {
      look.exposure *= CLEAR[0]; look.airBeam = CLEAR[1]; look.haze = CLEAR[1]; look.mist = CLEAR[2]; look.shafts *= CLEAR[3];
    }
    if (intro) intro.look(look, shot);                        // INTRO: the sequence's light, and the light that follows the music (off in stills and lab shots)
    renderer.render(look);
    if (UI && renderer.last) {
      // FEATURES: under a burst no muscle label floats over the sparks (`only` names no muscle); the counters say where
      // LIGHT-MERGE: and no muscle label on the specimen plate. (The one line two lanes changed; merged as features NOTES section 3 item 10 gives it.)
      const L = renderer.last, only = camera.mode === 'focus' ? app.anat.fibers[camera.focusIndex].muscle.id : camera.mode === 'custom' ? (bOn ? NO_LABEL : specimen.isOpen ? null : (app.model.provenFamily || {}).id) : null;
      specimen.frame(M4.mul(L.proj, L.view), canvas.clientWidth, canvas.clientHeight, camera.mode);   // LIGHT-MERGE
      overlay.frame(M4.mul(L.proj, L.view), pose.pos, canvas.clientWidth, canvas.clientHeight, {
        lit: renderer.ord,                                       // REPAIR (R5): where the fibers lie in this frame, as the renderer weighed it (labels keep off it)
        mode: camera.flight && camera.mode === 'plate' ? 'tour' : camera.mode, lead: camera.railMuscle(), only,
        at: camera.mode === 'focus' ? dotPlaces(camera.focusIndex) : camera.mode === 'custom' && only && !bOn ? app.anat.muscleById.get(only).provenCenter : null,
        focusSkill: app.focus >= 0 ? app.anat.fibers[app.focus].skill : null,
        clear: camera.mode === 'focus' ? recordPoints(camera.focusIndex) : null,       // ART (A7)
      });
      hover();
      panels.autopilot(camera.auto, REDUCED);                  // FEATURES
      if (burst.phase !== 'idle' && burst.phase !== 'error') panels.burstTick(burst.state);
    }
    autoQuality(real);
    if (++app.frames === 3) {                                  // feed loaded, fibers built, post chain on, frame presented
      document.body.classList.add('live');                     // FIX V25/V30: the picture fades in from black (viewer.css), the panels a moment after
      window.__MM_READY = true;
    }
  };
  frameFn = frame;
  const go = () => { cancelAnimationFrame(raf); running = !document.hidden && !renderer.gl.isContextLost(); if (running) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', go);          // no rendering while the tab is hidden
  // FIX V05: a lost GPU context (sleep and wake, a GPU switch, a driver reset) is taken back. While it is gone one quiet line
  // says so; when the browser hands it back everything on the GPU is rebuilt from what the page still holds.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); running = false; document.getElementById('restoring').hidden = false; });
  canvas.addEventListener('webglcontextrestored', async () => {
    try { await restore(); document.getElementById('restoring').hidden = true; go(); }
    catch (err) { const f = document.getElementById('fatal'); f.hidden = false; f.textContent = 'The anatomy could not be drawn on this device. ' + (err && err.message ? err.message : ''); console.error(err); }
  });
  go();
}
// FIX V05: everything that lived on the GPU, made again.
async function restore() {
  renderer = new Renderer(canvas);
  await renderer.ready();
  renderer.extraPass = (F, S) => { burst.draw(F, S); if (intro) intro.draw(F, S); };   // INTRO WORDS: and the words of the sequence
  if (intro) intro.lost();                                    // INTRO WORDS: its textures and program are made again on the new context
  setQuality(aq.level);
  renderer.setAnatomy(app.anat);
  app.combing.clear();                                        // ENG (E2): after a lost context every row is put where it belongs at once
  if (app.comb) renderer.setRows([...app.comb].map(([index, cp]) => ({ index, cp })));   // FIX V12: a combed strand stays combed
  if (specimen.isOpen) specimen.rerig();
  burst.lost();
  for (const [i, v] of app.glow) renderer.setGlow(i, v);
  if (app.focus >= 0) { renderer.setHighlight(app.focus, 2); nerves(app.anat.fibers[app.focus].skill); }
}

async function boot() {
  document.body.classList.toggle('no-ui', !UI);
  document.body.classList.toggle('still', STILL);
  try {
    // FIX V06: the kit's GPU timer is a lab tool outside this folder. It is loaded only with ?lab=1, never by the page itself.
    if (LAB) await new Promise((res) => { const sc = document.createElement('script'); sc.src = '../kit/gpu-timer.js'; sc.onload = sc.onerror = () => res(); document.head.append(sc); });
    renderer = new Renderer(canvas);
    camera = new Camera({ reduced: REDUCED });
    camera.aspect = aspect(); camera.narrow = canvas.clientWidth < 1100; camera.short = canvas.clientHeight < 780;
    overlay = new Overlay({ growth: setGrowth, playGrowth, clearFocus: () => clearFocus(), overview: () => setMode(camera.mode === 'plate' ? 'tour' : 'plate'), replay, muscle: toMuscle });
    // FEATURES: the burst draws its sparks through the renderer's one optional pass, and reads fibers through lines.js
    burst = new Burst(canvas, { lines: () => fiberLines(renderer, app.anat), model: () => app.model });
    renderer.extraPass = (F, S) => { burst.draw(F, S); if (intro) intro.draw(F, S); };   // INTRO WORDS: and the words of the sequence (nothing is drawn unless a line or card shows)
    panels = new Panels({ autopilot: () => camera.toggleAuto(), burst: () => toggleBurst(), stopBurst: () => clearFocus(), leave: () => leaveAll(), layout: () => { overlay.dirty = true; } });   // MERGE: leave also drops a fiber in focus
    specimen = new Specimen({ get renderer() { return renderer; }, camera, canvas, model: () => app.model, anat: () => app.anat, focus: (id) => focus(id), mock: () => !!app.mock });   // LIGHT-MERGE (the renderer by a getter: after a lost context it is a new one)
    // FIX V22: a feed that cannot be fetched or read, or an address that is refused, is reported as that. Nothing is put in its place.
    let doc = null, error = null;
    const url = feedUrl(), programs = renderer.ready();       // FIX V25: the programs link on the driver's threads while the feed is on its way
    if (!url) error = 'the feed address is not on this origin';
    else try { doc = await loadFeed(url); } catch (e) { error = String((e && e.message) || e); }
    await programs;
    apply(doc, { first: true, error });
    preset();
    // FEATURES: shot=burst&t=0..1 is a reproducible still of the replay; ?focus= opens on one fiber; ?burst= arrives playing
    if (SHOT === 'burst') await playBurst(null, { at: clamp(T0, 0, 1), instant: true });
    else if (openFocus(LINK.focus, focus, (text) => panels.notice(text)) === null && LINK.burstAsked && !SHOT) playBurst();
    // INTRO: the opening sequence (it decides for itself whether it may play: meta anatomy-intro, intro=1/0, and the rules in intro.js)
    intro = new Intro({ app, camera, overlay, qs, renderer: () => renderer, still: STILL, reduced: REDUCED, shot: SHOT, lab: LAB, reset: () => {
      stopBurst(); leaveSpecimen(); if (panels.legendOpen) panels.legend(false); overlay.tooltip(null);
      if (app.focus >= 0) { renderer.setHighlight(app.focus, 0); app.focus = -1; overlay.hideCard(); renderer.setNerves([]); uncomb({ instant: true }); }
      panels.overview(false);
    } });
    intro.boot();
    if (intro.frozen != null) app.time = intro.frozen;          // INTRO: a lab still of the sequence is frozen in every way
    window.__MM = {
      get stats() {
        const m = app.model, r = renderer.stats;
        return {
          skills: m.skills.length, fibersDrawn: r.fibersDrawn, families: app.anat.muscles.length, emptyFamilies: app.anat.muscles.filter((x) => x.empty).length,
          tools: m.tools.length, links: m.linkCount, events: m.events.length, bandsDrawn: r.bandsDrawn, notchesDrawn: r.notchesDrawn,
          mock: !!app.mock,                                    // MOCK: true while the loaded feed is invented data
          full: renderer.ord && renderer.ord.full != null ? +renderer.ord.full.toFixed(2) : null,   // CABLES: how full the frame is (renderer.js, _stop)
          order: renderer.ord ? app.anat.muscles.map((x, i) => [x.id, +renderer.ord.k[i].toFixed(2), Math.round(renderer.ord.L[i] * 1000)]) : null,   // REPAIR (R4): how far each family is drawn down in this frame to keep the hero order, and the estimate of its light
          triangles: r.triangles + burst.triangles, drawCalls: r.drawCalls + burst.drawCalls,
          fibersFormed: m.undated + m.dated.filter((s) => s.birth * 0.94 < app.growth || app.growth >= 1).length, scale: app.scale,
          burst: burst.stats,                                  // FEATURES: { jobs, done, handedBack, sparksDrawn }, rolling with the replay
        };
      },
      get gpuMs() { return renderer.timer && typeof renderer.timer.ms === 'number' ? renderer.timer.ms : null; },
      focus: (id) => focus(id), clearFocus: () => clearFocus(), setMode: (m) => setMode(m), setGrowth: (g) => setGrowth(g),
      setFeed: (d) => apply(d), replay: () => replay(),
      // INTRO: the opening sequence. state: off | waiting | playing | done; t: its position in seconds; play() plays it again
      // (through black, from the top of the track when the sound is on); skip() ends it in the hand-over state; log: for each
      // anchor, the music position of the first frame that showed it.
      intro: { get state() { return intro.state; }, get t() { return +intro.t.toFixed(4); }, play: () => intro.play(), skip: () => intro.skip(), get log() { return { ...intro.log }; } },
      get quality() { return { level: aq.level, scale: app.scale, segments: renderer.seg, frameMs: +aq.ema.toFixed(1) }; },   // FIX V24: what the automatic quality is doing
      specimen: (on = true) => (on ? specimen.open() : clearFocus()),   // LIGHT-MERGE: open or close the specimen plate (the legend's button calls this)
      // LAYOUT: layout checks: label boxes and reserved areas now on screen; rail timing
      labels: () => overlay.rects(), rail: () => ({ loop: camera.loop, t: camera.railT, stations: camera.rail.map((k, i) => (k.st ? { m: k.m, t: camera.keyTime(i) } : null)).filter(Boolean) }),
      // FEATURES: play(doc) replays a burst document (or, with no argument, the one named by ?burst=); resolves true
      // when sparks are on their way. stop() ends it. state is { phase, t, jobs, done, handedBack, sparksDrawn, ... }.
      burst: { play: (d) => playBurst(d), stop: () => { if (burst.phase !== 'idle') clearFocus(); }, get state() { return burst.state; } },
      // look-dev, lab only (?lab=1): render n frames back to back, forcing each to complete with a one pixel read-back, and
      // return the mean milliseconds per frame. Unlike gpuMs this is not bent by vsync, by other work
      // on the GPU process, or by the GPU slowing its clock under a light load.
      ...(LAB ? { bench: (n = 60, skip = '') => {
        const gl = renderer.gl, S = { ...renderer.last.S, skip }, px = new Uint8Array(4);
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        renderer.render(S); sync();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { renderer.render(S); sync(); }
        return (performance.now() - t0) / n;
      } } : {}),
    };
    start();
  } catch (err) {
    const f = document.getElementById('fatal');
    f.hidden = false; f.textContent = 'The anatomy could not be drawn on this device. ' + (err && err.message ? err.message : '');
    throw err;
  }
}
boot();
