// The Anatomy renderer (light build, on b-lumen). Raw WebGL2, no dependencies.
//
// Merged file (see MERGE.md): the light lane's renderer, with the layout lane's renderer hooks carried in by hand
// (marked LAYOUT-MERGE: the shafts of light and the dust come from the anatomy, spare lines can be styled and have a
// body), the features lane's one hook (FEATURE-MERGE, in render()), the join of the two rigs (sceneRig, marked MERGE),
// and one more float per scaffolding vertex (MERGE: the tube's radius, so a lane too thin to resolve is not drawn as dots).
//
// Frame:  scaffolding  ->  fibers, opaque interiors (no discard: the GPU shades each pixel once)  ->  interiors of
// fibers with beads or collars (cut to their profile)  ->  background mist and shafts where nothing solid was drawn
// ->  fibers, analytic fringe (blended)  ->  additive HDR glow for cores the record lights  ->  depth for every
// fiber (so focus finds the thin ones)  ->  sheath membranes  ->  dust  ->  depth of field (near-field map, spiral
// gather, tent)  ->  bloom mip chain  ->  streaming light  ->  filmic tonemap, vignette, grain.
// Picking renders fiber ids into a small offscreen buffer.

import { Program, texture, target } from './glx.js';
import * as SH from './shaders.js';
import { M4, Q, V3, clamp, mix, rng } from './math.js';
import * as ANAT from './anatomy.js';
import { LAB, labQ } from './lab.js';

const { CPN, SPARE_ROWS } = ANAT;
const ROWS_MAX = 2048;
const RADIAL = 20;        // vertices round a scaffolding tube (a tube may ask for fewer: thin cables)
const TV = 12;            // floats a scaffolding vertex: position 3, normal 3, tint 4, radius 1, distance along 1
const BLOOM_LEVELS = 5;
const NSH = 4;            // shafts of light the shaders can hold
const FAM_LUM = 0.19;      // ART (A3): the luminance every family but the river is drawn at (see setAnatomy)
const LOD_AT = 3500;      // ENG (E3): libraries larger than this are drawn with the level of detail for far strands (see render)
const LOTS = 16;          // ENG (E3): and their fibers in this many lots
// REPAIR (R4): the hero order, held frame by frame (see _order). With the river in the frame no other family may carry
// more light than `share` of the gold's; a family that would is drawn down, never under `min` of its own light. `in` is
// the part of the frame's light the river must carry before the rule is in full force (so nothing pumps as it enters).
const ORDER = { share: 0.70, min: 0.5, in: 0.05, tau: 0.3, gw: 40, gh: 36 };
const RADIUS_CAP = 2.2;   // practice thickens a fiber, but never past this many base radii

const srgb = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const hexLinear = (hex) => { const n = parseInt(hex.slice(1), 16); return [srgb(((n >> 16) & 255) / 255), srgb(((n >> 8) & 255) / 255), srgb((n & 255) / 255)]; };

// ------------------------------------------------------------ THE LIGHT RIG
// One list. Everything that is lit, every shaft drawn in the air, the mist it lights, the dust that drifts through it and
// the light that streams between the fibers reads this and nothing else. World space unless it says otherwise.
// When the scaffolding moves, move the lights here.
export const RIG = {
  // Tall shafts of light. p: a point on the axis. d: the axis, pointing at where the light comes from. r: core radius.
  // col x gain: radiance seen looking straight across the core. halo: [radius, gain]. span: the beam fades in above
  // span[0] along its axis and is gone by span[1].
  // The first `near` shafts stand among the fibers: they are also line lights on the glass (a cool hairline in every
  // strand, a pool of light round the axis, back light through the rods) and they scatter in front of fibers.
  // shafts[0] is the one whose light streams between the fibers.
  near: 1,
  shafts: [
    // FIX V08: the core is narrower (was 3.4) and the beam is a pool round the forms, not a column from the top of the frame to the dock (span was [-170, 460])
    { p: [0, 0, 0], d: [0, 1, 0], r: 2.3, col: [0.46, 0.74, 1.0], gain: 0.78, halo: [15, 0.035], span: [-90, 300] },
    { p: [150, 0, -190], d: [-0.10, 1, 0.08], r: 5, col: [0.58, 0.42, 1.0], gain: 0.30, halo: [20, 0.06], span: [-300, 520] },
    { p: [-170, 0, -130], d: [0.12, 1, 0.04], r: 6, col: [0.16, 0.82, 0.88], gain: 0.24, halo: [22, 0.06], span: [-300, 520] },
    { p: [30, 0, -310], d: [0.02, 1, 0], r: 8, col: [0.45, 0.62, 1.0], gain: 0.20, halo: [30, 0.07], span: [-320, 560] },
  ],
  // Lamps: small and bright, at places in the world, no falloff. Each makes one zone where the glass glitters.
  // w: 1 a position, 0 a direction to a light far away.
  lamps: [
    { p: [78, 70, -22], w: 1, col: [1.0, 0.76, 0.44], gain: 30 },     // warm key, above and beyond the far end of the river
    { p: [112, 24, 84], w: 1, col: [1.0, 0.93, 0.88], gain: 7 },     // lilac kicker, front right, across the fibers
  ],
  // A strip of light that rides with the camera (view space: x right, y up, z toward the eye). Mirrored in a rod it is a
  // hairline along the whole strand, and it slides as you fly.
  strip: { dir: [-0.12, 0.55, 0.82], axis: [1, 0, 0], col: [1.0, 0.97, 0.92], gain: 5.0 },   // FIX V09: was 4.0. The hairline that slides along every strand is what says glass
  // A teal bounce from below and behind, the complement of the gold. Room reflections only.
  fill: { dir: [-0.52, -0.62, -0.58], col: [0.20, 0.85, 0.82], gain: 1.0 },
  // The air the dust drifts in: centre and size of the box (two motes in five ride inside the shafts instead).
  air: { c: [0, 10, 10], s: [300, 250, 300] },
};

// ------------------------------------------------------------ MERGE: the rig of the interior
// RIG above was placed for the old body: a shaft down a spine on the world Y axis, three more round it, a river a third
// the size. The layout lane gave the interior its own scaffolding and says where its light stands (anat.shafts: x, z,
// radius scale, strength, three of them, never in a row) and where its dust drifts (anat.dust). The light lane's notes
// say: when the scaffolding moves, move the lights here. This is that move, and nothing else about the light changes:
//   shafts   WHERE, HOW WIDE and HOW STRONG from the layout: one per entry of anat.shafts, upright (the layout's motes hang
//            in upright columns), none anywhere the layout did not put one. Each is the light lane's first shaft (the one
//            it built for the b-lumen shaft that the layout's table is measured against: core, halo, span), its core and
//            halo sized by the layout's radius scale relative to its principal shaft, its gain multiplied by the layout's
//            strength. The colour is RIG's: each shaft takes the colour of the RIG shaft that stood nearest to where it
//            stands now, each colour used once (the principal keeps the first; the one far back on the left is teal, as
//            the light lane's far left one was; the one behind the teal veil is violet). All of them stand among the
//            forms, so all are `near`: each has its pool of light on the glass (radius 26 x the layout's radius scale,
//            the layout's own rule), scatters in front of fibers, and is dimmed with the others when the frame asks (S.beam).
//   lamps    the same two lamps in the same roles. The warm key stood above and beyond the far end of the old river: it
//            stands above and beyond the far end of the new one. The kicker stood front right of the middle: it keeps that
//            bearing from the new plate target, at the new scale. Lamps have no falloff, so only their bearing matters.
//   mist     the two shells of mist stood round the middle of the old body at 320 and 560; they stand round the new plate
//            target at the new scale, and the banks keep their apparent size.
//   scale    one number for both: how far back the new plate stands over how far back the old one stood (640 / 246 = 2.6).
//   dust     the layout's own motes (in its shafts, along the river, thin everywhere else).
// The specimen plate swaps in its own rig (PLATE_RIG in specimen.js), which has none of the new fields and so draws
// exactly as it did in the light lane.
export function sceneRig(anat) {
  const table = ((anat && anat.shafts) || []).filter((s) => s && s[3] > 0).slice(0, NSH), base = RIG.shafts[0];
  const rest = RIG.shafts.slice(1);                              // colours still to hand out; the principal keeps the first shaft's
  const shafts = table.map((s, k) => {
    const w = (s[2] || 1) / (table[0][2] || 1), p = [s[0], 0, s[1]];
    let col = base.col;
    if (k > 0 && rest.length) { rest.sort((a, b) => V3.dist(a.p, p) - V3.dist(b.p, p)); col = rest.shift().col; }
    // FIX V08: s[3] is how bright the AIR in the shaft is; s[4] (when given) is how strongly the same shaft lights the glass
    // round it. They were one number, so a shaft bright enough to light the glass was brighter than the fibers themselves.
    return { p, d: [0, 1, 0], r: base.r * w, col, gain: base.gain * s[3], glass: base.gain * (s[4] == null ? s[3] : s[4]), halo: [base.halo[0] * w, base.halo[1]], span: base.span, pool: 26 * (s[2] || 1) };
  });
  if (!shafts.length) return { ...RIG };                         // an anatomy that brings no shafts keeps the light lane's rig as it is
  const river = anat.muscleById && anat.muscleById.get('research'), end = river && river.path ? river.path.at(1) : null;
  const OLD = { p: [0, -3, 246], t: [0, -3, 0] };                          // the plate of the body RIG was placed for (b-lumen's PLATE)
  const plate = ANAT.PLATE_RIG || ANAT.PLATE || OLD, k = V3.dist(plate.p, plate.t) / V3.dist(OLD.p, OLD.t);
  const lamps = RIG.lamps.map((l) => ({ ...l }));
  if (end) lamps[0].p = V3.add(V3.addS(end.p, end.t, 30), [0, 60, 0]);     // above and beyond the far end of the river
  lamps[1].p = V3.addS(plate.t, V3.sub(RIG.lamps[1].p, OLD.t), k);         // front right of the middle, across the fibers
  return {
    near: shafts.length, shafts, lamps, strip: RIG.strip, fill: RIG.fill, air: RIG.air, weigh: true,
    mist: { c: plate.t, r: [320 * k, 560 * k] }, dust: anat.dust || null,
  };
}

// ------------------------------------------------------------ THE LOOK (every tunable of the material and the grade)
export const LOOK = {
  // FIX V01/V09: was 1.25. At 1.25 a resting core already sat on the shoulder of the film curve, so formed, practised and
  // proven all came out at nearly the same brightness on screen and every lit thing glowed alike. At 0.36 the three tiers
  // are three clearly different lights: a formed fiber is a dim gold thread, a practised one bright, a proven one blazing.
  rest: 0.36,      // radiance of the resting core of a formed fiber, the 1x. Practised is 3x, proven 10x
  glass: 1.0,      // gain on mirror images of the lights in the sheath
  glint: 3.2,      // ART: was 2.0. The concept glitters      // gain on the micro facets
  gpx: 1.5,        // smallest radius of a glint, in pixels: nothing ever flashes in a single pixel
  leak: 0.0,       // FIX V16: the engraving leaks no light at all (was 0.8). It is cut into the glass and only darkens
  etch: 1.0,       // strength of the engraved id plates
  ripple: 1.8,     // how much the drawn glass ripples (breaks highlights into dashes)
  rim: 1.4,        // how much of its own resting light a lit fiber shows in its rim, in units of rest
  core: 1.0,       // core width
  halo: 1.0,       // glow of the glass round the core
  bands: 1.0,      // brightness of job bands
  mist: 0.4,       // the banks of mist behind everything (FIX V07: was 1.0)
  bloom: 1.3,      // bloom strength, on top of what the frame asks for
  rays: 0.35,      // light streaming from the first shaft, on top of what the frame asks for
  knee: 1.6,       // bloom threshold (FIX V08: was 1.05. Only proven cores, bands and glints bloom; a practised ring does not)
  vignette: 0.42,
  glowMax: 0.30,   // ART: was 0.55, which is brighter than a resting core: the sum of the halos was the fill between the strands   // FIX V01: where halos of many lit fibers cross, their sum stops near this radiance
  compAt: 0.50,    // FIX V01: the wide average of the picture above which it is locally stopped down (a resting bundle is far under it)
  comp: 1.2,       // and how hard
  lane: 1.0,       // FIX V11: the dashed lanes of a form with no skills yet
  airSat: 1.3,     // PASS3 (T6): how strongly the lit air holds the hue of its source (1: as the source; under 1 pales it)
  airPivot: 0.10,   /* P3R: was 0.06 with a gentler curve and a cut after it (litAir, FINAL) */  // PASS3 (T6/T7): the level (a share of airMax) about which the lit air is given contrast
  airBase: 0.66,   // PASS3 (T7): the far mist by direction, against what it was (the darkest tenth of an open frame is this mist)
  air: 3.0,       // CABLES: was 1.05; the air now takes less where a form fills the frame (litAir), so open air near a bundle may carry more   // REPAIR (R2): the lit air: how much of the light round a pixel scatters back over it (litAir in FINAL, shaders.js)
  airMax: 0.075,   // its soft ceiling, scene-linear at exposure 1 (lower ceilings were tried: at 0.022 with more gain the glow became an even plateau, a veil again; at 0.040 the plate and the real feed fell under their floors)
  airDepth: 240,   // and the depth of air (world units) that carries about two thirds of it: nearer surfaces keep their blacks
  farRest: 4.4,    // ART: was 2.6; the widened core of a far thread now gives energy back (shaders.js, coreLine), so the lift that keeps a body at rest readable on the plate is larger    // the resting core of a formed or practised fiber seen from afar (a thread under a few pixels), against the same core close up
};

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl; this.canvas = canvas;
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);   // FIX V25/V30: black before anything else is drawn
    if (!gl.getExtension('EXT_color_buffer_float')) gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.prog = {};
    for (const [k, src] of Object.entries({
      body: SH.FIBER_BODY, opq: SH.FIBER_OPAQUE, glow: SH.FIBER_GLOW, id: SH.FIBER_ID, occ: SH.FIBER_OCC, tube: SH.TUBE, tie: SH.TUBE_TIE, bg: SH.BACKGROUND, dust: SH.DUST,
      pre: SH.PREFILTER, nmax: SH.NEAR_MAX, nspr: SH.NEAR_SPREAD, gather: SH.GATHER, dsoft: SH.DOF_SOFT,
      bpre: SH.BLOOM_PRE, bdown: SH.BLOOM_DOWN, bup: SH.BLOOM_UP, shafts: SH.SHAFTS, final: SH.FINAL,
    })) {
      this.prog[k] = new Program(gl, src, k, { defer: true });   // FIX V25: nothing is asked of the driver until ready()
    }
    this.timer = LAB && window.MMGpuTimer ? window.MMGpuTimer.create(gl) : null;   // FIX V06: the kit's timer is a lab tool, loaded only with ?lab=1
    this.stats = { triangles: 0, drawCalls: 0, fibersDrawn: 0, bandsDrawn: 0, notchesDrawn: 0 };
    this.triVAO = gl.createVertexArray();
    this.count = 0; this.nerveCount = 0; this.W = 0; this.H = 0;
    this.quality = { taps: 48, shafts: true };
    this.look = { ...LOOK };
    this.jit = [0, 0]; this.skip = ''; this.dbg = 0; this.prepass = true; this.jitMode = 'orbit';
    this.lod = false; this.bk = 0; this.slot = null; this.oc = null;   // ENG (E3)
    this.dpx = 1; this.postK = 1;                             // ENG (E1): see resize()
    this.segK = 1;                                            // FIX V24: share of the strip's segments drawn (the automatic quality lowers it on a slow machine)
    if (LAB) this._lookDev();
    this.setRig(RIG);
  }
  // FIX V25: resolves when every program is compiled and linked. With KHR_parallel_shader_compile the driver works on its
  // own threads and this only polls, so the page stays live (and black) while it does; without it the checks block as before.
  async ready() {
    const gl = this.gl, ext = gl.getExtension('KHR_parallel_shader_compile'), list = Object.values(this.prog), t0 = performance.now();
    if (ext) while (!gl.isContextLost() && !list.every((p) => p.done(ext)) && performance.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 4));
    for (const p of list) p.check();
  }

  // look-dev switches, read only with ?lab=1 (FIX V42):  &look=rest:0.6,glint:1.4   &jit=<yaw degrees>[,<pitch degrees>]   &jitmode=pan
  // jit moves the camera a fraction of a degree (round its focus point, or on the spot with jitmode=pan): the test for shimmer.
  _lookDev() {
    for (const kv of (labQ('look') || '').split(',')) { const [k, v] = kv.split(':'); if (k in this.look && isFinite(+v)) this.look[k] = +v; }
    const j = (labQ('jit') || '').split(',').map(Number);
    if (isFinite(j[0])) this.jit = [j[0] || 0, isFinite(j[1]) ? j[1] : 0];
    this.skip = labQ('skip') || '';                           // letters drop a pass, as in __MM.bench
    this.dbg = +labQ('dbg') || 0;                             // show one term of the glass at a time (1..7)
    this.prepass = labQ('prepass') !== '0';                   // depth first for the opaque interiors (prepass=0 leaves it to the GPU's own hidden surface removal)
    this.jitMode = labQ('jitmode') === 'pan' ? 'pan' : 'orbit';
    window.__LIGHT = { renderer: this, RIG, LOOK, shimmer: (deg, radius, mode) => this.shimmer(deg, radius, mode) };
  }

  // ------------------------------------------------------------ the rig
  setRig(rig) {
    this.rig = rig;
    const n = Math.min(rig.shafts.length, NSH);
    this.sh = { n, near: Math.min(rig.near || 0, n), P: new Float32Array(NSH * 3), D: new Float32Array(NSH * 3), C: new Float32Array(NSH * 4), H: new Float32Array(NSH * 4), K: new Float32Array(NSH).fill(26), G: new Float32Array(NSH * 3) };
    // MERGE: where the shells of mist stand (centre, first radius, step to the second, scale of the banks). The light lane's own numbers unless the rig says otherwise.
    const mist = rig.mist || { c: [0, 0, 0], r: [320, 560] };
    this.mistK = rig.mistK == null ? 1 : rig.mistK;          // FIX V13: a rig can stand in black air (the specimen plate)
    this.mistC = mist.c; this.mistS = [mist.r[0], mist.r[1] - mist.r[0], mist.r[0] / 320];
    rig.shafts.slice(0, n).forEach((s, i) => {
      const d = V3.norm(s.d);
      if (s.pool > 0) this.sh.K[i] = s.pool;                   // LAYOUT-MERGE: radius of the pool of light this shaft lays on the glass round it (26 in the light lane)
      this.sh.P.set(s.p, i * 3); this.sh.D.set(d, i * 3);
      this.sh.C.set([s.col[0] * s.gain, s.col[1] * s.gain, s.col[2] * s.gain, s.r], i * 4);
      const gg = s.glass == null ? s.gain : s.glass;          // FIX V08: the light a shaft lays on the glass, apart from the brightness of its air
      this.sh.G.set([s.col[0] * gg, s.col[1] * gg, s.col[2] * gg], i * 3);
      this.sh.H.set([s.halo[0], s.halo[1], s.span[0], s.span[1]], i * 4);
    });
    for (let i = n; i < NSH; i++) { this.sh.D.set([0, 1, 0], i * 3); this.sh.C.set([0, 0, 0, 1], i * 4); this.sh.H.set([1, 0, -1e5, 1e5], i * 4); }
    this._dust();
  }
  // FIX V08: one strong shaft and one faint one in any frame, never three bars side by side. Inside, each shaft is weighed
  // by how far its axis stands from the lens against the nearest one (1 for the nearest, falling smoothly: nothing pops as
  // the lens travels). From the plate, which stands far from all of them, the principal keeps its light and the others
  // are faint. Computed once a frame (render calls it), used by every pass.
  _weigh(S) {
    const sh = this.sh, rig = this.rig, d = [], w = (this.shW = new Float32Array(NSH).fill(1));
    if (!rig.weigh) return;
    for (let i = 0; i < sh.n; i++) {
      const to = V3.sub(S.pos, [sh.P[i * 3], sh.P[i * 3 + 1], sh.P[i * 3 + 2]]), ax = [sh.D[i * 3], sh.D[i * 3 + 1], sh.D[i * 3 + 2]];
      d.push(V3.len(V3.reject(to, ax)));
    }
    const dm = Math.max(Math.min(...d), 20), far = clamp(S.air || 0, 0, 1);
    for (let i = 0; i < sh.n; i++) {
      const near = clamp(1 / (1 + 3.2 * (Math.max(d[i], 20) / dm - 1)), 0.10, 1);
      w[i] = near + ((i === 0 ? 1 : 0.30) - near) * far;
    }
  }
  _air(p, S) {
    const gl = this.gl, sh = this.sh, C = sh.C.slice(), G = sh.G.slice(), k = S.beam == null ? 1 : S.beam / 0.5, W = this.shW, ex = 1 / Math.max(S.exposure || 1, 0.2);
    // the frame can dim the first shaft (the plate stands far back). LAYOUT-MERGE: and with it every other shaft that stands
    // among the fibers, as the layout lane's uBeam did (with one near shaft this is the light lane's own line)
    for (let j = 0; j < Math.max(sh.near, 1); j++) for (let i = 0; i < 3; i++) { C[j * 4 + i] *= k; G[j * 3 + i] *= k; }
    if (S.airBeam != null) for (let j = 0; j < sh.n; j++) for (let i = 0; i < 3; i++) C[j * 4 + i] *= S.airBeam;   // INTRO: the light in the air of every shaft, without the light it lays on the glass (left out: no change)
    if (W) for (let j = 0; j < sh.n; j++) for (let i = 0; i < 3; i++) C[j * 4 + i] *= W[j];
    // REPAIR (R3): the lens opens for a body at rest (main.js, app.expo), but the air is not part of the body: the light in the
    // shafts and the mist is drawn down by as much, so on the screen the air is what it is on a full body and only the
    // fibers come up. (Opened with the rest, the mist was a violet veil over the whole frame.) The light the shafts lay on
    // the glass (G) belongs to the fibers and is left alone.
    if (ex !== 1) for (let j = 0; j < sh.n; j++) for (let i = 0; i < 3; i++) C[j * 4 + i] *= ex;
    p.v3('uCam', S.pos).f('uTime', S.time).f('uFog', S.fog).i('uShN', sh.n).i('uShNear', sh.near);
    gl.uniform3fv(p.u('uShP[0]'), sh.P); gl.uniform3fv(p.u('uShD[0]'), sh.D); gl.uniform4fv(p.u('uShC[0]'), C); gl.uniform4fv(p.u('uShH[0]'), sh.H);
    gl.uniform1fv(p.u('uShK[0]'), sh.K);                     // LAYOUT-MERGE (only the fiber programs have it; a null location is ignored)
    gl.uniform3fv(p.u('uShG[0]'), G);                        // FIX V08 (the fiber programs only)
    return p;
  }
  _glass(p, S, F) {
    const gl = this.gl, L = this.look, r = this.rig, lp = new Float32Array(8), lc = new Float32Array(6);
    for (let i = 0; i < 2; i++) {
      const l = r.lamps[i]; if (!l) continue;
      const q = l.w ? l.p : V3.norm(l.p);
      lp.set([q[0], q[1], q[2], l.w ? 1 : 0], i * 4); lc.set([l.col[0] * l.gain, l.col[1] * l.gain, l.col[2] * l.gain], i * 3);
    }
    gl.uniform4fv(p.u('uLampP[0]'), lp); gl.uniform3fv(p.u('uLampC[0]'), lc);
    return p.f('uFocusK', S.focusK || 0).f('uDbg', this.dbg).f('uRest', L.rest).f('uLook', L.glass, L.glint * (S.glint == null ? 1 : S.glint), L.etch, L.ripple).f('uLook2', L.rim, L.core, L.halo, L.bands).f('uLook3', L.gpx, L.leak, L.farRest, 0).f('uDim', S.dim)
      .v3('uStripDir', F.stripDir).v3('uStripAxis', F.stripAxis).v3('uStripCol', r.strip.col.map((v) => v * r.strip.gain))
      .v3('uFillDir', F.fillDir).v3('uFillCol', r.fill.col.map((v) => v * r.fill.gain));
  }

  // ------------------------------------------------------------ geometry upload
  setAnatomy(anat) {
    const gl = this.gl, n = anat.count, total = n + SPARE_ROWS;
    this.anat = anat; this.count = n;
    // LAYOUT-MERGE: the shafts of light and the dust come from the layout (anatomy.js), through the rig. The scene's rig is
    // one object for the life of the renderer (the specimen plate keeps a reference and hands it back on close), refreshed
    // from each anatomy. It is put in force unless another rig (the specimen plate's) is in force just now.
    const mine = this.rig === this.home || this.rig === RIG;
    if (!this.home) this.home = {};                           // (this.scene is the render target; the interior's rig is this.home)
    for (const k of Object.keys(this.home)) delete this.home[k];
    Object.assign(this.home, sceneRig(anat));
    if (mine) this.setRig(this.home);
    // spline control points -> float texture, CPN texels per fiber, wrapped into columns
    const rows = (this.rows = Math.min(Math.max(total, 1), ROWS_MAX)), cols = Math.ceil(total / rows);
    const tw = CPN * cols, data = new Float32Array(tw * rows * 4), frame = new Float32Array(tw * rows * 4), fr = new Float32Array(CPN * 4);
    for (let i = 0; i < total; i++) {
      const col = Math.floor(i / rows), row = i % rows, f = anat.fibers[i];
      data.set(anat.cp.subarray(i * CPN * 4, (i + 1) * CPN * 4), (row * tw + col * CPN) * 4);
      frameRow(anat.cp, i * CPN * 4, fr, !!(f && f.closed), f ? ((f.skill.seed >>> 8) & 0xffff) / 65535 : 0);
      if (anat.occ && f) for (let k = 0; k < CPN; k++) fr[k * 4 + 3] = anat.occ[i * CPN + k];      // ART: the shadow inside a bundle rides in the spare channel
      frame.set(fr, (row * tw + col * CPN) * 4);
    }
    if (this.cpTex) gl.deleteTexture(this.cpTex);
    if (this.frTex) gl.deleteTexture(this.frTex);
    this.cpTex = texture(gl, tw, rows, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST, data });
    // a twist-free reference normal per control point: the frame the engraving, the facets and the core are fixed to
    this.frTex = texture(gl, tw, rows, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST, data: frame });
    this.cpW = tw;

    // one shared strip, instanced once per fiber
    this.segFull = n > 9000 ? 32 : n > 3500 ? 48 : n > 1200 ? 72 : 104;
    this._strip();

    // ENG (E3): the order the fibers are drawn in. A small library: as they come (nothing changes). A large one: in LOTS
    // lots, every form spread evenly over all of them (by a hash of the index), so that at any pixel the lots drawn later
    // say how much of an earlier strand will be painted over. slot[i] is where fiber i stands in the instance buffers.
    const lod = (this.lod = n > LOD_AT), slot = (this.slot = new Int32Array(Math.max(n, 1)));
    this.bk = lod ? LOTS / n : 0;
    if (lod) {
      const lot = (i) => Math.imul(i + 1, 0x9e3779b1) >>> 28, ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => lot(a) - lot(b) || a - b);
      ord.forEach((i, k) => { slot[i] = k; });
    } else { for (let i = 0; i < n; i++) slot[i] = i; if (this.oc) this._occFree(); }
    const A = new Float32Array(Math.max(n, 1) * 16), E = (this.dyn = new Float32Array(Math.max(n, 1) * 4));
    let bands = 0, notches = 0;
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    anat.fibers.forEach((f, i) => {
      const s = f.skill, c = hexLinear(s.family.color), o = slot[i] * 16;
      let col = c;
      // FIX V10: families are matched by how bright they look, not by radiance. Lime, cyan and the pale delta are high
      // luminance hues: driven as hard as gold they out-shout it. Every hue brighter than 0.44 is brought down to it;
      // only the river keeps the full 1.0. (Blue, violet, pink and magenta are under it already and are untouched.)
      // ART (A3): the hero order. The gold river is the key of every picture; no other hue may be louder. The shaders drive a
      // fiber by the square root of the luminance of its colour, so the river is given 1.35 times its hue and every other
      // family is set to one luminance, 0.19: its light and the light on its glass come out at about half the
      // river's. Within a family nothing changes: formed, practised and proven are still 1 : 3 : 10 of that family's level.
      // P3R: one luminance for every family makes a yellow-green one (the files strata, #C4EE66) the darkest thing in the room:
      // lime at that level is olive, and the strata read as dull straw however much light their cores carry. A hue that is
      // yellow-green (green over red over blue) is drawn at up to 1.9 times that luminance (the files: 0.36, its brightest channel then level with violet, pink and blue); the river is at 0.85.
      if (s.family.id !== 'research') { const L = lum(c), mx = Math.max(c[0], c[1], c[2], 1e-6), yg = clamp((Math.min(c[0], c[1]) - c[2]) / mx, 0, 1) * clamp((c[1] - c[0]) / (0.2 * mx) + 0.5, 0, 1), T = FAM_LUM * (1 + 1.8 * yg); if (L > T) col = c.map((v) => (v * T) / L); }
      else col = c.map((v) => v * 1.35);
      if (s.originCode === 4 || s.stateCode === 4) { const l = col[0] * 0.3 + col[1] * 0.5 + col[2] * 0.2; col = col.map((v) => v * 0.3 + l * 0.7); }
      A.set([i, drawRadius(f), f.len, f.shade, col[0], col[1], col[2], s.tier, s.jobs, s.handed, s.originCode, s.stateCode,
        (s.seed & 0xffff) / 65535, (s.seed >>> 16) / 65535, s.birth, f.closed ? 1 : 0], o);
      E.set([-1e6, -1e6, 0, 0], i * 4);            // spark start, born at, highlight, afterglow of a burst replay
      bands += A[o + 8]; notches += A[o + 9];      // counted from what is actually uploaded
    });
    this.stats.fibersDrawn = n; this.stats.bandsDrawn = bands; this.stats.notchesDrawn = notches;
    {   // REPAIR (R4): what _order needs: points along every fiber, its family, its colour as uploaded, and about how much light it gives
      const NF = (anat.muscles || []).length, K = clamp(Math.round(36000 / Math.max(n, 1)), 3, 14), NC = ORDER.gw * ORDER.gh;
      const o = (this.ord = { A, slot, K, fam: new Int16Array(n), pts: new Float32Array(n * K * 3), w: new Float32Array(n), base: new Float32Array(n * 3), tau: new Float32Array((NF + 1) * NC), dz: new Float32Array((NF + 1) * NC),
        k: new Float32Array(NF + 1).fill(1), to: new Float32Array(NF + 1).fill(1), L: new Float32Array(NF + 1), hero: -1, tick: 0, t: 0, snap: true, gw: ORDER.gw, gh: ORDER.gh });
      anat.fibers.forEach((f, i) => {
        const mi = Math.max(0, (anat.muscles || []).indexOf(f.muscle)), s = f.skill, a = slot[i] * 16, r = drawRadius(f); o.fam[i] = mi;
        if (s.family.id === 'research') o.hero = mi;
        for (let k = 0; k < K; k++) o.pts.set(anat.point(f.index, (k + 0.5) / K).p, (i * K + k) * 3);
        o.w[i] = (2 * r * f.len * (s.tier > 1.5 ? 2.6 : s.tier > 0.5 ? 1.5 : 1) + 0.5 * s.jobs * 4 * r * r) / K;      // the glass and its core by tier, and the bands
        o.base.set([A[a + 4], A[a + 5], A[a + 6]], i * 3);
      });
    }

    // FIX V04: the vertex arrays and buffers are made once and live as long as the renderer. A refreshed feed (and the
    // specimen plate, which lays six fibers out and puts them back) refills them; nothing is created, so nothing leaks.
    const inst = () => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1);
      for (let k = 0; k < 4; k++) { gl.enableVertexAttribArray(1 + k); gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 64, k * 16); gl.vertexAttribDivisor(1 + k, 1); }
      const b2 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b2);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(5, 1);
      gl.bindVertexArray(null);
      return { vao, b1, b2 };
    };
    const fill = (o, a, e) => { gl.bindBuffer(gl.ARRAY_BUFFER, o.b1); gl.bufferData(gl.ARRAY_BUFFER, a, gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, o.b2); gl.bufferData(gl.ARRAY_BUFFER, e, gl.DYNAMIC_DRAW); };
    if (!this.fiber) { this.fiber = inst(); this.nerve = inst(); }
    fill(this.fiber, A, E);
    // nerve lines (drawn only while a fiber is in focus) live in the spare spline rows
    this.nerveA = new Float32Array(SPARE_ROWS * 16); this.nerveE = new Float32Array(SPARE_ROWS * 4);
    fill(this.nerve, this.nerveA, this.nerveE); this.nerveCount = 0;
    if (anat.tubes !== this._tubeSrc) { this._tubes(anat.tubes); this._tubeSrc = anat.tubes; }   // the scaffolding is uploaded once per anatomy, not once per call
  }
  // REPAIR (R4): the hero order, per frame. Every fourth frame the light each family lays on this frame is estimated on a
  // coarse grid of the frame: points along every fiber, weighed by its width, its length, its tier and its record, laid
  // into the cells they fall in, composed from the front (a family behind another is hidden by it) and dimmed by the
  // depth mist. (Checked against light measured per hue in pictures: shots/viewer-pass2-repair/cal.mjs.) A family that
  // would carry more than ORDER.share of the river's light is drawn down, the whole family alike: its colour as uploaded
  // is scaled, so formed, practised and proven keep 1 : 3 : 10 within it and nothing about a single skill changes. It
  // eases (ORDER.tau seconds), it never goes under ORDER.min of its light, and with no river in the frame every family is
  // drawn at its own level. The specimen plate (bare rig) is left alone.
  // CABLES: the stop-down for a frame one form fills edge to edge (see _order): down to 0.62 of the exposure when over 0.86 of the frame is covered
  _stop() { const o = this.ord; if (!o || o.full == null || this.rig.bare) return 1; const t = clamp((o.full - 0.56) / 0.30, 0, 1); return 1 - 0.38 * t * t * (3 - 2 * t) * (o.dimK == null ? 1 : o.dimK); }
  _order(view, proj, fog, dim) {
    const o = this.ord; if (!o || !o.fam.length) return;
    o.dimK = clamp((dim - 0.5) / 0.4, 0, 1);
    const now = performance.now(), dt = Math.min(0.1, (now - (o.t || now)) / 1000); o.t = now;
    if ((o.tick++ & 3) === 0) {
      const m = M4.mul(proj, view), GW = ORDER.gw, GH = ORDER.gh, NC = GW * GH, NF = o.L.length, L = o.L.fill(0), P = o.pts, n = o.fam.length, K = o.K, tau = o.tau.fill(0), dz = o.dz.fill(0);
      const ka = (proj[0] * proj[5]) / ((2 / GW) * (2 / GH));
      for (let i = 0, j = 0; i < n; i++) for (let k = 0; k < K; k++, j += 3) {
        const x = P[j], y = P[j + 1], z = P[j + 2], w = m[3] * x + m[7] * y + m[11] * z + m[15]; if (w < 2) continue;
        const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w; if (cx <= -1 || cx >= 1 || cy <= -1 || cy >= 1) continue;
        const c = o.fam[i] * NC + Math.floor((cy * 0.5 + 0.5) * GH) * GW + Math.floor((cx * 0.5 + 0.5) * GW), t = (o.w[i] * ka) / (w * w); tau[c] += t; dz[c] += t * w;
      }
      const ord = o.ordv || (o.ordv = new Int16Array(NF));
      for (let c = 0; c < NC; c++) {
        let nn = 0; for (let f = 0; f < NF; f++) if (tau[f * NC + c] > 0) ord[nn++] = f;
        for (let a = 1; a < nn; a++) { const v = ord[a], dv = dz[v * NC + c] / tau[v * NC + c]; let b = a - 1; while (b >= 0 && dz[ord[b] * NC + c] / tau[ord[b] * NC + c] > dv) { ord[b + 1] = ord[b]; b--; } ord[b + 1] = v; }
        let T = 1; for (let a = 0; a < nn; a++) { const f = ord[a], t = tau[f * NC + c], e = Math.exp(-t); L[f] += T * (1 - e) * Math.exp((-fog * dz[f * NC + c]) / t); T *= e; }
      }
      let sum = 0; for (let f = 0; f < NF; f++) sum += L[f];
      // CABLES (second check: the darkest tenth rose over 12 where one form fills the frame): how full the frame is, as the
      // share of cells that fibers cover well. A frame filled edge to edge by one form is stopped down a little (render()),
      // as a photographer would, so the gaps between its strands stay dark. Eased with the rest; a composed frame is untouched.
      { let nf = 0; for (let c = 0; c < NC; c++) { let t = 0; for (let f = 0; f < NF; f++) t += tau[f * NC + c]; if (t > 0.22) nf++; } o.fullTo = nf / NC; }
      const G = o.hero >= 0 ? L[o.hero] : 0, on = this.rig.bare || sum <= 0 ? 0 : clamp(G / sum / ORDER.in, 0, 1) * clamp((dim - 0.5) / 0.4, 0, 1);      // (in a close-up and under a burst the body has stepped back already, and the fiber in focus or the sparks are the subject: no family is drawn down)
      for (let f = 0; f < NF; f++) o.to[f] = f === o.hero || L[f] <= 0 ? 1 : mix(1, clamp((ORDER.share * G) / L[f], ORDER.min, 1), on);
      // CABLES (second check: the darkest tenth at 13 to 16 where one form fills the frame, the fan at 117 s): no form but the
      // river floods a frame. A family that would lay more than CAP of light on the frame is drawn down toward it (never
      // under the floor of the hero order), river in frame or not; the glow it throws into the corners goes down with it.
      { const CAP = 105, onC = this.rig.bare ? 0 : clamp((dim - 0.5) / 0.4, 0, 1); for (let f = 0; f < NF; f++) if (f !== o.hero && L[f] > CAP) o.to[f] = Math.min(o.to[f], mix(1, clamp(CAP / L[f], ORDER.min, 1), onC)); }
    }
    let dirty = false; const e = o.snap ? 1 : 1 - Math.exp(-dt / ORDER.tau); if (o.tick > 1) o.snap = false;
    o.full = (o.full == null ? o.fullTo || 0 : o.full) + ((o.fullTo || 0) - (o.full == null ? o.fullTo || 0 : o.full)) * e;
    for (let f = 0; f < o.k.length; f++) { const v = o.k[f] + (o.to[f] - o.k[f]) * e; if (Math.abs(v - o.k[f]) > 2e-3 || (v !== o.k[f] && Math.abs(o.to[f] - v) < 2e-3)) { o.k[f] = Math.abs(o.to[f] - v) < 2e-3 ? o.to[f] : v; dirty = true; } }
    if (!dirty) return;
    const A = o.A, B = o.base, gl = this.gl;
    for (let i = 0; i < o.fam.length; i++) { const q = o.k[o.fam[i]], g = q * q * q, a = o.slot[i] * 16; A[a + 4] = B[i * 3] * g; A[a + 5] = B[i * 3 + 1] * g; A[a + 6] = B[i * 3 + 2] * g; }   // (measured: the light of a family follows its colour's luminance to the power of about a third: the shaders draw at its square root, and bands and the film curve flatten it further)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fiber.b1); gl.bufferSubData(gl.ARRAY_BUFFER, 0, A);
  }
  _strip() {
    const gl = this.gl, seg = (this.seg = Math.max(12, Math.round(this.segFull * this.segK)));
    const uv = new Float32Array((seg + 1) * 4);
    for (let i = 0; i <= seg; i++) { uv[i * 4] = i / seg; uv[i * 4 + 1] = -1; uv[i * 4 + 2] = i / seg; uv[i * 4 + 3] = 1; }
    this.stripVerts = (seg + 1) * 2;
    if (!this.uvBuf) this.uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
  }
  setSegments(k) { k = clamp(k, 0.2, 1); if (k !== this.segK) { this.segK = k; if (this.segFull) this._strip(); } }

  _tubes(tubes) {
    const gl = this.gl; this.tubes = this.tubes || {};
    for (const kind of ['sheath', 'tendon', 'pillar']) {
      const isTie = (t) => (t.arch && t.arch.seed >= 2 ? 1 : 0);      // PASS3 (T8): the ties come last in the buffer, so they can be drawn apart (render)
      const list = tubes.filter((t) => t.kind === kind).sort((a, b) => isTie(a) - isTie(b));
      let nv = 0, ni = 0, split = 0;
      for (const t of list) { const rd = t.radial || RADIAL; nv += t.rings.length * rd; ni += (t.rings.length - 1) * rd * 6; if (!isTie(t)) split = ni; }
      const v = new Float32Array(nv * TV), idx = new Uint32Array(ni);
      let vo = 0, io = 0, base = 0;
      for (const t of list) {
        const R = t.rings, nr = R.length, rd = t.radial || RADIAL;
        // how much of the envelope is still waiting to fill: 1 for an empty muscle, 0 for a full one
        const tint = t.muscle ? hexLinear(t.muscle.fam.color) : [0.3, 0.35, 0.5], empty = t.muscle ? clamp(1 - t.muscle.fibers.length / 40, 0, 1) : 0;
        let along = 0;
        for (let i = 0; i < nr; i++) {
          const r = R[i];
          if (i) along += V3.dist(r.p, R[i - 1].p);
          // architecture carries its own numbers: the tangent of the conduit (in place of a tint), a seed, its nominal radius
          const a0 = t.arch ? r.t[0] : tint[0], a1 = t.arch ? r.t[1] : tint[1], a2 = t.arch ? r.t[2] : tint[2];
          const a3 = t.arch ? t.arch.seed : empty + (t.lane ? 2 : 0), rad = t.arch ? t.arch.r : Math.min(r.ra, r.rb), al = t.arch ? r.s : along;
          for (let j = 0; j < rd; j++) {
            const a = (j / rd) * Math.PI * 2, c0 = Math.cos(a), s0 = Math.sin(a), fl = t.arch && r.flute ? 1 + r.flute * (j % 2 ? 1 : -1) : 1;
            // P3R: a tube may have a squared section (t.sq under 1: a superellipse, 1 / none: an ellipse). The flat clamp of a ribbon
            // cable is a band that lies on the ribbon, not an oval hoop that stands off its edges.
            const e = t.sq || 1, c = e === 1 ? c0 : Math.sign(c0) * Math.pow(Math.abs(c0), e), s = e === 1 ? s0 : Math.sign(s0) * Math.pow(Math.abs(s0), e);
            const kc = e === 1 ? 1 : Math.pow(Math.max(Math.abs(c0), 0.08), e - 1), ks = e === 1 ? 1 : Math.pow(Math.max(Math.abs(s0), 0.08), e - 1);
            const nx = r.n[0] * c0 * ks * r.rb + r.b[0] * s0 * kc * r.ra, ny = r.n[1] * c0 * ks * r.rb + r.b[1] * s0 * kc * r.ra, nz = r.n[2] * c0 * ks * r.rb + r.b[2] * s0 * kc * r.ra;
            const nl = Math.hypot(nx, ny, nz) || 1;
            v[vo++] = r.p[0] + (r.n[0] * c * r.ra + r.b[0] * s * r.rb) * fl; v[vo++] = r.p[1] + (r.n[1] * c * r.ra + r.b[1] * s * r.rb) * fl; v[vo++] = r.p[2] + (r.n[2] * c * r.ra + r.b[2] * s * r.rb) * fl;
            v[vo++] = nx / nl; v[vo++] = ny / nl; v[vo++] = nz / nl; v[vo++] = a0; v[vo++] = a1; v[vo++] = a2; v[vo++] = a3; v[vo++] = rad; v[vo++] = al;
          }
        }
        for (let i = 0; i < nr - 1; i++) for (let j = 0; j < rd; j++) {
          const a = base + i * rd + j, b = base + i * rd + ((j + 1) % rd), c = a + rd, d = b + rd;
          idx[io++] = a; idx[io++] = b; idx[io++] = c; idx[io++] = b; idx[io++] = d; idx[io++] = c;
        }
        base += nr * rd;
      }
      // FIX V04: one vertex array and two buffers per kind for the life of the renderer, refilled
      let T = this.tubes[kind];
      if (!T) {
        T = this.tubes[kind] = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), n: 0 };
        gl.bindVertexArray(T.vao); gl.bindBuffer(gl.ARRAY_BUFFER, T.vb);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, TV * 4, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, TV * 4, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, TV * 4, 24);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, TV * 4, 40);   // MERGE: radius, for lanes too thin to resolve (TUBE in shaders.js)
        gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, TV * 4, 44);   // distance along the tube
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, T.ib);
        gl.bindVertexArray(null);
      }
      gl.bindVertexArray(T.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, T.vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, T.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      T.n = idx.length; T.split = split;
    }
  }

  // Dust is placed from the rig: two motes in five drift inside a shaft of light, the rest fill the air round the anatomy.
  // LAYOUT-MERGE: a rig that brings its own motes (the interior's, from anatomy.js: xyz and a seed each) has those drawn instead.
  _dust() {
    const gl = this.gl, own = this.rig.dust && this.rig.dust.length >= 4 ? this.rig.dust : null;
    const N = (this.dustN = own ? Math.floor(own.length / 4) : 2600), r = rng(99), d = own || new Float32Array(N * 4), sh = this.rig.shafts;
    const near = Math.max(1, Math.min(this.rig.near || 1, sh.length)), air = this.rig.air || { c: [0, 10, 10], s: [300, 250, 300] };
    for (let i = 0; i < N && !own; i++) {
      let p;
      if (sh.length && r() < 0.42) {
        const s = sh[r() < 0.7 ? Math.floor(r() * near) : Math.floor(r() * sh.length)], ax = V3.norm(s.d), n0 = V3.perp(ax), b0 = V3.cross(ax, n0);
        const a = r() * Math.PI * 2, rad = s.r * (0.2 + 2.6 * Math.sqrt(r())) + r() * r() * s.halo[0] * 0.8, h = -120 + r() * 290;
        p = V3.addS(V3.addS(V3.addS(s.p, ax, h), n0, Math.cos(a) * rad), b0, Math.sin(a) * rad);
      } else p = [air.c[0] + (r() - 0.5) * air.s[0], air.c[1] + (r() - 0.5) * air.s[1], air.c[2] + (r() - 0.5) * air.s[2]];
      d.set([p[0], p[1], p[2], r()], i * 4);
    }
    if (!this.dustVAO) {
      this.dustVAO = gl.createVertexArray(); gl.bindVertexArray(this.dustVAO);
      this.dustBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
  }

  // ------------------------------------------------------------ per-fiber dynamic state
  _dynWrite(i) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.fiber.b2); gl.bufferSubData(gl.ARRAY_BUFFER, this.slot[i] * 16, this.dyn.subarray(i * 4, i * 4 + 4)); }   // ENG (E3): at its slot
  setGlow(i, v) { if (i < 0 || i >= this.count || this.dyn[i * 4 + 3] === v) return; this.dyn[i * 4 + 3] = v; this._dynWrite(i); }   // FIX V14: the afterglow of a burst replay
  setHighlight(i, v) { if (i < 0 || i >= this.count || this.dyn[i * 4 + 2] === v) return; this.dyn[i * 4 + 2] = v; this._dynWrite(i); }
  spark(i, t0) { if (i < 0 || i >= this.count) return; this.dyn[i * 4] = t0; this._dynWrite(i); }
  born(i, t0) { if (i < 0 || i >= this.count) return; this.dyn[i * 4 + 1] = t0; this._dynWrite(i); }

  // FIX V12: draw some fibers along other control points for a while (a strand combed straight under a close-up), or put
  // the anatomy's own back. rows = [{ index, cp: Float32Array(CPN * 4) }]. Only the two spline textures are touched: the
  // record, the counts and everything else about the fiber stay as uploaded.
  setRows(rows) {
    const gl = this.gl, fr = new Float32Array(CPN * 4), A = this.anat;
    for (const r of rows) {
      const i = r.index; if (!(i >= 0 && i < this.count) || !this.cpTex) continue;
      const col = Math.floor(i / this.rows), row = i % this.rows, f = A && A.fibers[i];
      gl.bindTexture(gl.TEXTURE_2D, this.cpTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, col * CPN, row, CPN, 1, gl.RGBA, gl.FLOAT, r.cp);
      frameRow(r.cp, 0, fr, !!(f && f.closed), f ? ((f.skill.seed >>> 8) & 0xffff) / 65535 : 0);
      if (A && A.occ) for (let k = 0; k < CPN; k++) fr[k * 4 + 3] = A.occ[i * CPN + k];            // ART: the row keeps its shadow
      gl.bindTexture(gl.TEXTURE_2D, this.frTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, col * CPN, row, CPN, 1, gl.RGBA, gl.FLOAT, fr);
    }
  }

  // Spare lines drawn only while a fiber is in focus: nerve lines to its tools, and the tendon of a chains_to link.
  // lines = [{cp: Float32Array(CPN*4), len, radius?, color?, state?}]   (LAYOUT-MERGE: the three optional fields)
  setNerves(lines) {
    const gl = this.gl, k = Math.min(lines.length, SPARE_ROWS), fr = new Float32Array(CPN * 4);
    this.nerveCount = k;
    if (!k) return;
    for (let j = 0; j < k; j++) {
      const i = this.count + j, col = Math.floor(i / this.rows), row = i % this.rows;
      gl.bindTexture(gl.TEXTURE_2D, this.cpTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, col * CPN, row, CPN, 1, gl.RGBA, gl.FLOAT, lines[j].cp);
      frameRow(lines[j].cp, 0, fr, false, 0);
      gl.bindTexture(gl.TEXTURE_2D, this.frTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, col * CPN, row, CPN, 1, gl.RGBA, gl.FLOAT, fr);
      // state 4: neutral glass with no light of its own. A nerve line is not a fiber and must not look like one.
      // LAYOUT-MERGE: a line may bring its own radius, colour and state (the chain tendon: thicker, grey, state 2 "off").
      const L = lines[j], c = L.color || [0.55, 0.70, 0.95];
      this.nerveA.set([i, L.radius || 0.045, L.len, 1, c[0], c[1], c[2], 0, 0, 0, 0, L.state || 4, 0.5, 0.5, -1, 0], j * 16);
      this.nerveE.set([-1e6, -1e6, 2, 0], j * 4);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nerve.b1); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.nerveA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nerve.b2); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.nerveE);
  }

  // ------------------------------------------------------------ targets
  // ENG (E1): the same picture on a 1x and a 2x screen. per: device pixels of the canvas per CSS pixel (the screen's ratio times
  // the quality scale). screen: the screen's own ratio (capped at 2 by the page). Two things follow from them:
  //   dpx     device pixels per pixel of the reference screen (2x). The shaders divide by it wherever a rule says what a fiber
  //           is at a given size on screen (strand or rod, thread, hairlines, the far resting light, the halo), so those rules
  //           are in CSS pixels. Antialiasing stays in device pixels.
  //   postK   the "half resolution" chain (depth of field, bloom, wide average, near field) runs at one texel per CSS pixel
  //           on any screen: half the canvas at 2x, the whole canvas at 1x. Its thresholds and its bloom radii are in its own
  //           texels, so they are in CSS pixels too. (The quality scale still shrinks it with the canvas: that is its job.)
  // At 2x both are 1 and nothing is computed differently.
  resize(W, H, per = 2, screen = 2) {
    const dpx = clamp(per / 2, 0.05, 4), postK = clamp(2 / Math.max(screen, 0.5), 1, 2);
    this.dpx = dpx;
    if (W === this.W && H === this.H && postK === this.postK) return;
    const gl = this.gl; this.W = W; this.H = H; this.postK = postK;
    for (const t of this.targets || []) t.dispose();
    this._occFree();                                          // ENG (E3): it shares the depth of the scene
    const hw = Math.min(W, Math.ceil((W / 2) * postK)), hh = Math.min(H, Math.ceil((H / 2) * postK));
    this.scene = target(gl, W, H, { depth: true });
    this.pre = target(gl, hw, hh, { mips: true });
    this.nearA = target(gl, Math.ceil(hw / 4), Math.ceil(hh / 4));
    this.nearB = target(gl, Math.ceil(hw / 4), Math.ceil(hh / 4));
    this.dof = target(gl, hw, hh);
    this.dofB = target(gl, hw, hh);
    this.bpre = target(gl, hw, hh);
    this.bloom = [];
    for (let i = 0, w = hw, h = hh; i < BLOOM_LEVELS; i++) { w = Math.ceil(w / 2); h = Math.ceil(h / 2); this.bloom.push(target(gl, w, h)); }
    this.shaft = target(gl, Math.ceil(hw / 2), Math.ceil(hh / 2));
    this.idT = target(gl, Math.ceil(W / 2), Math.ceil(H / 2), { depth: true, rgba8: true });
    this.targets = [this.scene, this.pre, this.nearA, this.nearB, this.dof, this.dofB, this.bpre, ...this.bloom, this.shaft, this.idT];
  }

  // ENG (E3): the four textures the coverage of the lots is summed in (large libraries only). They share the scene's depth.
  _occ() {
    const gl = this.gl;
    if (this.oc) return this.oc;
    const fb = gl.createFramebuffer(), tex = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    for (let i = 0; i < 4; i++) { tex.push(texture(gl, this.W, this.H, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST })); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex[i], 0); }
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.scene.depth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.oc = { fb, tex, ok };
    return this.oc;
  }
  _occFree() { const gl = this.gl, o = this.oc; if (!o) return; gl.deleteFramebuffer(o.fb); for (const t of o.tex) gl.deleteTexture(t); this.oc = null; }

  // ------------------------------------------------------------ draw helpers
  _fibers(nerves) {
    const gl = this.gl;
    if (this.count) {
      gl.bindVertexArray(this.fiber.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.stripVerts, this.count);
      this.stats.drawCalls++; this.stats.triangles += this.count * this.seg * 2;
    }
    if (nerves) this._nerves();
  }
  _nerves() {
    const gl = this.gl;
    if (!this.nerveCount || this.noNerve) return;
    gl.bindVertexArray(this.nerve.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.stripVerts, this.nerveCount);
    this.stats.drawCalls++; this.stats.triangles += this.nerveCount * this.seg * 2;
  }
  _tri() { const gl = this.gl; gl.bindVertexArray(this.triVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); this.stats.drawCalls++; this.stats.triangles += 1; }
  _tube(kind, part = 0) {      // part 1: all but the ties, 2: the ties (PASS3)
    const gl = this.gl, t = this.tubes && this.tubes[kind];
    if (!t || !t.n) return;
    const from = part === 2 ? t.split || 0 : 0, n = part === 1 ? t.split || 0 : t.n - from;
    if (n <= 0) return;
    gl.bindVertexArray(t.vao); gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, from * 4);
    this.stats.drawCalls++; this.stats.triangles += n / 3;
  }
  _fiberU(p, S, F, { vw, vh, pxMin, pad, widthMul = 1, bias = 0, litOnly = 0, inner = 0, sel = 0 }) {
    p.f('uNearEase', S.near ? S.near[0] : 7 * (S.clear || 0), S.near ? S.near[1] : 22 * (S.clear || 0));   // INTRO REPAIR: S.near = [gone, whole] in units, when the intro gives it (its close-up keeps the lens clear of neighbours without touching the subject); left out, nothing changes      // PASS3 (T5)   // P3R: wider (were 5.5 and 15): leaving a close-up inside the mock's dense river, soft near strands still filled the lens for half a second
    return p.tex('uCP', 0, this.cpTex).tex('uFR', 1, this.frTex).i('uCPDim', CPN, this.rows).m4('uView', F.view).m4('uProj', F.proj).f('uViewport', vw, vh)
      .f('uTime', S.time).f('uSway', S.sway).f('uGrowth', S.growth).f('uPxMin', pxMin).f('uPad', pad).f('uWidthMul', widthMul).f('uBias', bias)
      .f('uLitOnly', litOnly).f('uInner', inner).f('uSel', sel).f('uDpx', this.dpx).f('uBk', this.bk).f('uLod', 0).f('uCull', 0)   // ENG (E1): + uDpx
      .f('uSolo', S.solo == null ? -1 : S.solo, S.soloK == null ? 1 : S.soloK).f('uTip', S.tip == null ? 1 : S.tip).f('uNearR', S.nearR ? S.nearR[0] : 0, S.nearR ? S.nearR[1] : 0).f('uNearF', S.nearF ? S.nearF[0] : 0, S.nearF ? S.nearF[1] : 0);   // INTRO R2: + nearF (fade by distance in the opening; left out, nothing changes)      // INTRO: one fiber lit alone in the opening; (-1, 1) otherwise, which changes nothing
  }
  // look-dev: orbit the camera about its focus point by a fraction of a degree
  _jitter(S) {
    const [jy, jp] = this.jit;
    if (!jy && !jp) return S;
    const b = Q.basis(S.q), C = V3.addS(S.pos, b[2], -S.focus);
    const r = Q.mul(Q.axisAngle([0, 1, 0], (jy * Math.PI) / 180), Q.axisAngle(b[0], (jp * Math.PI) / 180));
    if (this.jitMode === 'pan') return { ...S, q: Q.mul(r, S.q) };          // turn on the spot: the picture shifts by a fraction of a pixel
    return { ...S, pos: V3.add(C, Q.rotate(r, V3.sub(S.pos, C))), q: Q.mul(r, S.q) };
  }

  // ------------------------------------------------------------ the frame
  // S: { pos, q, fov, focus, aperture, time, growth, sway, dim, fog, beam, exposure, bloom, grain, shafts }
  // INTRO: and, all optional and changing nothing when left out: solo, soloK (one fiber lit alone), glint (the glints of
  // every fiber, for the music), mist (the far mist), airBeam (the light in the air of the shafts, not on the glass), room (the
  // light of the whole frame), fade (0 is the page's black)
  render(S0) {
    const gl = this.gl, P = this.prog, W = this.W, H = this.H;
    if (!W || !this.anat) return;
    if (this.timer) this.timer.begin();
    const S = this._jitter(S0);
    this.stats.drawCalls = 0; this.stats.triangles = 0;
    const near = 0.25, far = 2400, rig = this.rig;
    const view = M4.view(S.pos, S.q), proj = M4.perspective(S.fov, W / H, near, far), basis = Q.basis(S.q);
    const toWorld = (v) => V3.norm([basis[0][0] * v[0] + basis[1][0] * v[1] + basis[2][0] * v[2], basis[0][1] * v[0] + basis[1][1] * v[1] + basis[2][1] * v[2], basis[0][2] * v[0] + basis[1][2] * v[1] + basis[2][2] * v[2]]);
    const stripDir = toWorld(rig.strip.dir), stripAxis = V3.norm(V3.reject(toWorld(rig.strip.axis), stripDir));
    const F = (this.last = { view, proj, S: S0, stripDir, stripAxis, fillDir: V3.norm(rig.fill.dir) });
    this._weigh(S);
    this._order(view, proj, S.fog || 0, S.dim == null ? 1 : S.dim);   // REPAIR (R4)
    const hh = this.pre.h, px = H / 900;                  // px: device pixels per reference pixel (ENG E1: hh is the height of the post chain, which is one texel per CSS pixel)
    const dof = [S.focus, S.aperture * hh, 0.020 * hh, 0.012 * hh];
    const K = S.skip || this.skip;                        // look-dev: letters drop a pass (see __MM.bench)
    this.noNerve = K.includes('n');                        // INTRO REPAIR: skip letter n drops the spare lines (nerves to tools, chain tendons): the intro's bare opening

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb); gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);

    // opaque scaffolding: far structure, tendons
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this._air(P.tube.use(), S).v3('uStripDir', stripDir).m4('uView', view).m4('uProj', proj).f('uViewport', W, H).f('uDpx', this.dpx).f('uSway', S.sway || 0).f('uNearEase', S.near ? S.near[0] : 7 * (S.clear || 0), S.near ? S.near[1] : 22 * (S.clear || 0))
      .f('uPart', S.pos[0] - basis[2][0] * S.focus, S.pos[1] - basis[2][1] * S.focus, S.pos[2] - basis[2][2] * S.focus, (S.focusK || 0) > 0.001 ? 1.9 * S.focus : 0).f('uFocusK', S.focusK || 0).f('uDim', S.dim == null ? 1 : S.dim).f('uIsTie', 0).f('uArchEase', 12 * (S.clear || 0), 46 * (S.clear || 0));      // PASS3 (T4): where the strands are parted for a close-up, the ties let go   // MERGE: + uViewport   // PASS3: + uSway (ties)
    P.tube.i('uKind', 2); if (!K.includes('p') && !this.rig.bare) this._tube('pillar', 1);   // FIX V13: a rig may ask for no architecture (the specimen plate stands on black)
    P.tube.i('uKind', 1); if (!K.includes('t')) this._tube('tendon');   // INTRO REPAIR: skip letter t drops the tendons (the intro's bare opening: scaffolding is not drawn until the bass)
    if (!K.includes('p') && !this.rig.bare && this.tubes && this.tubes.pillar && this.tubes.pillar.n > (this.tubes.pillar.split || 0)) {      // PASS3 (T8): the ties, with the variant that may discard
      this._air(P.tie.use(), S).v3('uStripDir', stripDir).m4('uView', view).m4('uProj', proj).f('uViewport', W, H).f('uDpx', this.dpx).f('uSway', S.sway || 0).f('uNearEase', S.near ? S.near[0] : 7 * (S.clear || 0), S.near ? S.near[1] : 22 * (S.clear || 0))
        .f('uPart', S.pos[0] - basis[2][0] * S.focus, S.pos[1] - basis[2][1] * S.focus, S.pos[2] - basis[2][2] * S.focus, (S.focusK || 0) > 0.001 ? 1.9 * S.focus : 0).f('uFocusK', S.focusK || 0).f('uDim', S.dim == null ? 1 : S.dim).f('uIsTie', 1).f('uArchEase', 0, 0).f('uNearEase', 18 * (S.clear || 0), 48 * (S.clear || 0)).i('uKind', 2);      // P3R: in a flight the ties let go well before their strands thin (they stood in the lens as pale blurred crescents)
      this._tube('pillar', 2);
    }

    // fibers, pass 0: opaque interiors write depth. Plain fibers go through a shader with no discard in it, so the
    // GPU's hidden surface removal shades every pixel once, however deep the bundle. Fibers with beads or collars are
    // few; theirs are cut per pixel to the profile.
    const fu = { vw: W, vh: H, pxMin: 0.62 * px, pad: 0.75 };
    if (!K.includes('a')) {
      this._glass(this._air(this._fiberU(P.opq.use(), S, F, { ...fu, inner: 1, sel: 1 }), S), S, F);
      if (this.prepass) {
        // Lay their depth first, then shade only the fragment that matches it. Same program, same uniforms, same vertices:
        // the two depths are bit-identical. In a dense bundle seen from afar this is cheaper still than leaving it to the GPU.
        // LAYOUT-MERGE: the spare lines are drawn here too (they are plain rods), so a chain tendon, which is thicker than a
        // nerve, has a body and not only an edge. In the light lane's frame the fringe pass alone drew them.
        gl.colorMask(false, false, false, false); this._fibers(true); gl.colorMask(true, true, true, true);
        gl.depthFunc(gl.EQUAL); gl.depthMask(false); this._fibers(true); gl.depthFunc(gl.LESS); gl.depthMask(true);
      } else this._fibers(true);
      this._glass(this._air(this._fiberU(P.body.use(), S, F, { ...fu, sel: 2 }), S), S, F).i('uPass', 0);
      this._fibers(false);
    }

    // background: mist and the shafts of light, only where nothing solid was drawn
    gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    const tanY = Math.tan(S.fov / 2), camRot = new Float32Array([...basis[0], ...basis[1], ...basis[2]]);
    this._air(P.bg.use(), S).m3('uCamRot', camRot).f('uTan', tanY * (W / H), tanY).f('uMist', (this.look.mist * this.mistK * (S.mist == null ? 1 : S.mist)) / Math.max(S.exposure || 1, 0.2)).f('uBase', this.look.airBase * this.mistK * (S.mist == null ? 1 : S.mist) / Math.max(S.exposure || 1, 0.2)).v3('uMistC', this.mistC).v3('uMistS', this.mistS);   // MERGE: + where the shells stand
    if (!K.includes('k')) this._tri();

    // pass 1: the analytic fringe, blended over what is behind it
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
    // ENG (E3), large libraries: first what each lot of far strands covers, then the fringe pass reads it (GLASS in shaders.js)
    const oc = this.lod && !K.includes('z') ? this._occ() : null, cull = !!(oc && oc.ok);
    if (cull) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, oc.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._fiberU(P.occ.use(), S, F, fu); this._fibers(false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    this._glass(this._air(this._fiberU(P.body.use(), S, F, fu), S), S, F).i('uPass', 1).f('uLod', this.lod && !K.includes('l') ? 1 : 0).f('uCull', cull ? 1 : 0);
    for (let i = 0; i < 4; i++) P.body.tex('uOc' + i, 2 + i, cull ? oc.tex[i] : this.cpTex);
    if (!K.includes('b')) { this._fibers(false); if (this.nerveCount) { P.body.f('uCull', 0); this._nerves(); } }
    // additive HDR glow, only for cores the record lights (unlit fibers are culled in the vertex stage)
    // FIX V01: the halos are summed with a ceiling. The alpha of the scene is free at this point of the frame: it is cleared
    // and used to count how much of the room for glow is taken, and each halo is added times what is left. One fiber
    // alone is drawn exactly as before; a dense braid of proven fibers no longer stacks to a white slab.
    gl.colorMask(false, false, false, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 1);
    gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    this._air(this._fiberU(P.glow.use(), S, F, { vw: W, vh: H, pxMin: 2.2 * px, pad: 0, widthMul: 5, bias: 1.6, litOnly: 1 }), S).f('uFocusK', S.focusK || 0).f('uDim', S.dim).f('uRest', this.look.rest).f('uGlowMax', this.look.glowMax);
    if (!K.includes('g')) this._fibers(false);
    gl.blendFunc(gl.ONE, gl.ONE);

    // depth for every fiber, including those too thin to have an opaque interior, so focus finds them
    gl.disable(gl.BLEND); gl.colorMask(false, false, false, false); gl.depthMask(true); gl.depthFunc(gl.LESS);
    this._fiberU(P.id.use(), S, F, fu).f('uCut', 0.3);
    if (!K.includes('d')) this._fibers(false);
    gl.colorMask(true, true, true, true);

    // sheath membranes: back faces, then front faces
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
    this._air(P.tube.use(), S).v3('uStripDir', stripDir).m4('uView', view).m4('uProj', proj).f('uViewport', W, H).i('uKind', 0).f('uLane', this.look.lane).f('uDpx', this.dpx).f('uIsTie', 0).f('uArchEase', 0, 0);   // MERGE: + uViewport
    gl.enable(gl.CULL_FACE);
    if (!K.includes('s')) { gl.cullFace(gl.FRONT); this._tube('sheath'); gl.cullFace(gl.BACK); this._tube('sheath'); }
    gl.disable(gl.CULL_FACE);

    // FEATURE-MERGE begin (features lane, used by src/burst.js): one optional additive pass of the caller's own,
    // drawn into the HDR scene after the last scene pass and immediately before post, so it is depth-tested, bloomed
    // and tone-mapped with everything else. The scene target and its depth must still be bound; the callback sets
    // its own blend and depth state (additive, depth test LEQUAL, no depth writes).
    // (In this renderer the dust has moved into post, so the last scene pass is the sheath membranes: the place the
    // features lane's own dry run found, its NOTES section 2.)
    if (this.extraPass) this.extraPass(F, S);
    // FEATURE-MERGE end

    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    this._post(S, F, dof, near, far, camRot, tanY, K);
    if (this.timer) this.timer.end();
  }

  // Dust motes carry their own bokeh (a disc sized by their own depth), so they are drawn after the depth of field, never
  // through it: once into the sharp image and once into the blurred one. Gathered by the lens blur, a sharp bright mote
  // would come out as a dotted copy of the tap pattern.
  _dustPass(S, F, dof, t, half) {
    const gl = this.gl, P = this.prog;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (half) gl.disable(gl.DEPTH_TEST); else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); }
    this._air(P.dust.use(), S).m4('uView', F.view).m4('uProj', F.proj).f('uViewport', t.w, t.h).v4('uDof', dof).f('uPxScale', half ? 1 : this.pxScale())
      .tex('uDepth', 0, half ? this.scene.depth : this.pre.color).f('uInvRes', 1 / t.w, 1 / t.h).f('uTest', half ? 1 : 0);   // (the sharp pass tests against the real depth buffer; it must not also sample it)
    gl.bindVertexArray(this.dustVAO); gl.drawArrays(gl.POINTS, 0, this.dustN); this.stats.drawCalls++;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  }

  // ENG (E1): texels of the scene per texel of the post chain: 2 on a 2x screen (exactly, as it always was), 1 on a 1x screen
  pxScale() { const r = this.scene.h / this.pre.h; return Math.abs(r - 2) < 0.02 ? 2 : Math.abs(r - 1) < 0.02 ? 1 : r; }

  _post(S, F, dof, near, far, camRot, tanY, K) {
    const gl = this.gl, P = this.prog, W = this.W, H = this.H;
    const to = (t) => { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, t ? t.w : W, t ? t.h : H); };
    // half-res colour + circle of confusion
    to(this.pre);
    P.pre.use().tex('uScene', 0, this.scene.color).tex('uDepth', 1, this.scene.depth).f('uTexel', 1 / W, 1 / H).f('uNF', near, far).v4('uDof', dof);
    this._tri();
    gl.bindTexture(gl.TEXTURE_2D, this.pre.color); gl.generateMipmap(gl.TEXTURE_2D);
    // near field: how far each pixel must look to find something soft and close hanging over it
    to(this.nearA); P.nmax.use().tex('uPre', 0, this.pre.color); this._tri();
    to(this.nearB); P.nspr.use().tex('uTile', 0, this.nearA.color); this._tri();
    // bokeh gather, then a tent over it
    to(this.dof);
    P.gather.use().tex('uPre', 0, this.pre.color).tex('uNear', 1, this.nearB.color).f('uTexel', 1 / this.pre.w, 1 / this.pre.h).v4('uDof', dof).i('uTaps', this.quality.taps);
    this._tri();
    to(this.dofB);
    P.dsoft.use().tex('uTex', 0, this.dof.color).f('uTexel', 1 / this.dof.w, 1 / this.dof.h);
    this._tri();
    if (!K.includes('u')) { this._dustPass(S, F, dof, this.scene, false); this._dustPass(S, F, dof, this.dofB, true); }
    // bloom
    to(this.bpre);
    P.bpre.use().tex('uPre', 0, this.pre.color).tex('uDofTex', 1, this.dofB.color).f('uKnee', this.look.knee);
    this._tri();
    let src = this.bpre;
    P.bdown.use();
    for (const b of this.bloom) { to(b); P.bdown.tex('uTex', 0, src.color).f('uTexel', 1 / src.w, 1 / src.h); this._tri(); src = b; }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    P.bup.use();
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const s = this.bloom[i], d = this.bloom[i - 1];
      to(d); P.bup.tex('uTex', 0, s.color).f('uTexel', 1 / s.w, 1 / s.h).f('uGain', 0.9); this._tri();
    }
    gl.disable(gl.BLEND);
    // light streaming from the first shaft of the rig: its source is a point on the axis above the eye
    to(this.shaft);
    const s0 = this.rig.shafts[0], ax = s0 ? V3.norm(s0.d) : [0, 1, 0], sp = s0 ? s0.p : [0, 0, 0];
    const lw = V3.addS(sp, ax, clamp(V3.dot(V3.sub(S.pos, sp), ax) + 34, -10, 80)), lc = M4.point(M4.mul(F.proj, F.view), lw);
    const vis = s0 && lc[3] > 0 && this.quality.shafts ? 1 : 0;
    this._air(P.shafts.use(), S).tex('uDepth', 0, this.scene.depth).f('uLight', lc[0] * 0.5 + 0.5, lc[1] * 0.5 + 0.5).f('uAspect', W / H).f('uStrength', (vis * S.shafts * this.look.rays) / Math.max(S.exposure || 1, 0.2))
      .f('uNF', near, far).m3('uCamRot', camRot).f('uTan', tanY * (W / H), tanY);
    this._tri();
    // composite to the screen
    to(null);
    const mk = S.mark ? this._mark() : null;                   // FIX V17 (made before the textures of this pass are bound)
    if (!S.mark && this.markTex) { gl.deleteTexture(this.markTex.tex); this.markTex = undefined; }   // and given back when a real feed is loaded
    P.final.use().tex('uScene', 0, this.scene.color).tex('uDepth', 1, this.scene.depth).tex('uDofTex', 2, this.dofB.color).tex('uBloom', 3, this.bloom[0].color).tex('uShafts', 4, this.shaft.color)
      .f('uNF', near, far).v4('uDof', dof).f('uExposure', S.exposure * this._stop()).f('uBloomK', S.bloom * this.look.bloom).f('uTime', S.time).f('uGrain', S.grain).f('uVignette', this.look.vignette).f('uRes', W, H)
      .m3('uCamRot', camRot).f('uTan', tanY * (W / H), tanY).v3('uCam', S.pos).v3('uRayP', sp).v3('uRayD', ax)
      .tex('uWide', 5, this.pre.color).f('uComp', Math.max(0, Math.log2(0.045 * this.pre.h)), this.look.compAt, K.includes('c') ? 0 : this.look.comp, 0.045);   // FIX V01: the wide average, from the mips of the half-res picture
    // INTRO LEGIBLE: the words of the sequence (S.words, set by intro.js in the extra pass of this same frame), laid in by
    // FINAL over everything with their shade. Left out (every still, every frame without a line or card), uWordA.x is 0 and
    // FINAL does not touch the picture; the unit is then given a texture of the chain so nothing samples an empty one.
    const Wd = S.words;
    if (Wd) P.final.tex('uWord', 7, Wd.tex).m3('uWordH', Wd.H).v4('uWordA', Wd.A).v4('uWordC', Wd.C).v4('uWordS', Wd.S).v4('uWordB', Wd.B).v4('uWordK', Wd.K).f('uWordL', Wd.L[0], Wd.L[1]);
    else P.final.tex('uWord', 7, this.scene.color).f('uWordA', 0, 0, 0, 0);
    P.final.f('uRoom', S.room == null ? 1 : S.room, S.fade == null ? 1 : S.fade, S.hit || 0);   // INTRO R2: + S.hit, the highlights' lift on a hit (0: nothing changes). INTRO: the room's light and the rise out of black; (1, 1) changes nothing
    // FIX V17: the mark of an invented feed, in the picture itself. It stands in the left margin of the page (clear of every
    // panel at every window size), 15 CSS pixels wide, reading upward from the bottom left corner.
    // REPAIR (R2): the lit air (litAir in FINAL). The first of its three widths is 2.5 percent of the frame height.
    P.final.f('uAirMax', this.look.airMax / Math.max(S.exposure || 1, 0.2)).f('uAirSat', this.look.airSat).f('uAirPivot', this.look.airPivot);
    P.final.f('uAir', Math.max(0, Math.log2(0.025 * this.pre.h)), this.look.airDepth, K.includes('h') || this.rig.bare ? 0 : this.look.air * this.mistK * (S.haze == null ? 1 : S.haze) / Math.pow(Math.max(S.exposure || 1, 1), 0.8), 0.025);      // CABLES: a body opened up by the lens does not get that much more air with it
    const k = W / Math.max(this.canvas.clientWidth || W, 1);
    if (mk) P.final.tex('uMark', 6, mk.tex).f('uMarkR', 4 * k, 18 * k, 15 * k, Math.min(15 * k * (mk.w / mk.h), H - 36 * k));
    else P.final.tex('uMark', 6, this.scene.color).f('uMarkR', 0, 0, 0, 0);
    this._tri();
  }
  // FIX V17: the words, rasterised once with the system font into a small texture (red: the letters, green: a soft dark
  // ground under them). No file and no font is loaded. Where a 2D canvas cannot be had there is no mark in the picture;
  // the banner on the page (#mock) does not depend on this.
  _mark() {
    if (this.markTex !== undefined) return this.markTex;
    this.markTex = null;
    try {
      const gl = this.gl, c = document.createElement('canvas'), g = c.getContext('2d');
      if (!g) return null;
      const text = 'MOCK DATA  \u00b7  INVENTED NUMBERS  \u00b7  NOT A RECORD', F = 22, sp = 0.2 * F;
      const font = `600 ${F}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Arial, sans-serif`;
      g.font = font; let w = 0; for (const ch of text) w += g.measureText(ch).width + sp;
      c.width = Math.ceil(w + 28); c.height = 36;
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      const draw = () => { let x = 14; for (const ch of text) { g.fillText(ch, x, 19); x += g.measureText(ch).width + sp; } };
      g.font = font; g.textBaseline = 'middle';
      g.shadowColor = 'rgb(0,255,0)'; g.shadowBlur = 8; g.fillStyle = 'rgb(0,255,0)'; draw(); draw();
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgb(255,0,0)'; draw();
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.markTex = { tex, w: c.width, h: c.height };
    } catch (e) { this.markTex = null; }
    return this.markTex;
  }

  // ------------------------------------------------------------ shimmer test (look-dev)
  // Renders the current frame, then the same frame from a camera a fraction of a degree away, and looks for pops: places that
  // are bright in one frame with nothing nearly as bright within `radius` pixels in the other. A highlight or a glint that
  // slides keeps its brightness and is matched a few pixels along; a pop has no counterpart.
  //   mode 'orbit': the camera moves round its focus point, so every viewing direction changes (do glints and hairlines pop?)
  //   mode 'pan':   the camera turns where it stands, so the picture shifts by a fraction of a pixel (do thin lines crawl?)
  // Two measures. raw: on the pixels as they are. box: on a 3 x 3 sum, which does not care how an antialiased hairline
  // shares its light between two neighbouring pixels, only whether the light is there.
  shimmer(deg = 0.05, radius = 5, mode = 'orbit') {
    const gl = this.gl, W = this.W, H = this.H, S = this.last && this.last.S;
    if (!S) return null;
    const keep = this.jit, keepMode = this.jitMode, grab = (j) => {
      this.jit = j; this.jitMode = mode; this.render({ ...S, grain: 0 });
      const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = new Float32Array(W * H);
      for (let i = 0, o = 0; i < l.length; i++, o += 4) l[i] = (px[o] * 77 + px[o + 1] * 150 + px[o + 2] * 29) / 256;
      return l;
    };
    const a = grab([0, 0]), b = grab([deg, deg * 0.5]);
    this.jit = keep; this.jitMode = keepMode; this.render(S);
    const pass = (src, r, f) => {                            // separable window: max (dilate) or mean (box)
      const t = new Float32Array(W * H), o = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r); for (let k = x0; k <= x1; k++) { const v = src[y * W + k]; m = f ? Math.max(m, v) : m + v; } t[y * W + x] = f ? m : m / (x1 - x0 + 1); }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r); for (let k = y0; k <= y1; k++) { const v = t[k * W + x]; m = f ? Math.max(m, v) : m + v; } o[y * W + x] = f ? m : m / (y1 - y0 + 1); }
      return o;
    };
    const measure = (p, q, t1, t2) => {
      const dp = pass(p, radius, true), dq = pass(q, radius, true);
      let n1 = 0, n2 = 0, worst = 0;
      for (let i = 0; i < p.length; i++) {
        const e = Math.max(p[i] - dq[i], q[i] - dp[i]);       // how much brighter than anything near it in the other frame
        if (e > t1) n1++; if (e > t2) n2++; if (e > worst) worst = e;
      }
      return [n1, n2, +worst.toFixed(1)];
    };
    let bright = 0, sumAbs = 0;
    for (let i = 0; i < a.length; i++) { sumAbs += Math.abs(a[i] - b[i]); if (a[i] > 150 || b[i] > 150) bright++; }
    const raw = measure(a, b, 24, 48), box = measure(pass(a, 1, false), pass(b, 1, false), 8, 16);
    return { mode, deg, radius, pixels: a.length, brightPixels: bright, meanAbsDiff: +(sumAbs / a.length).toFixed(3),
      rawOver24: raw[0], rawOver48: raw[1], rawWorst: raw[2], boxOver8: box[0], boxOver16: box[1], boxWorst: box[2] };
  }

  // ------------------------------------------------------------ picking through the id buffer
  // x, y in 0..1 of the canvas (y down). Returns a fiber index or -1.
  // FIX V38: two stages in one go. The ids are drawn twice into two small boxes of the id buffer: at their true width
  // (never under one pixel) in the box round the pointer, and with the padded hit area in a second box beside it. The
  // answer is the fiber nearest the pointer at its true width, and only where there is none, the padded one. So in a
  // bundle the fiber under the pointer wins, and a lone thin fiber is still easy to hit.
  _pickDraw(x, y) {
    const gl = this.gl, F = this.last, t = this.idT;
    const R = 9, px = Math.round(x * t.w), py = Math.round((1 - y) * t.h);
    const x0 = clamp(px - R, 0, t.w - 1), y0 = clamp(py - R, 0, t.h - 1), w = Math.min(2 * R + 1, t.w - x0), h = Math.min(2 * R + 1, t.h - y0);
    const dx = x0 + 2 * w + 2 <= t.w ? w + 2 : -(w + 2);                       // where the second box stands
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.enable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.clearColor(0, 0, 0, 0);
    const dc = this.stats.drawCalls, tr = this.stats.triangles, S = this._jitter(F.S);
    for (const [off, pxMin] of [[0, 1.0], [dx, 3.2]]) {
      gl.viewport(off, 0, t.w, t.h); gl.scissor(x0 + off, y0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this._fiberU(this.prog.id.use(), S, F, { vw: t.w, vh: t.h, pxMin: pxMin * (t.h / 450), pad: 0 }).f('uCut', 0).f('uDpx', 1);
      this._fibers(false);
    }
    this.stats.drawCalls = dc; this.stats.triangles = tr; gl.clearColor(0, 0, 0, 1);
    return { t, px, py, x0, y0, w, h, dx };
  }
  _pickEnd() { const gl = this.gl; gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  _pickRead(buf, off, q) {
    let best = -1, bd = 1e9;
    for (let j = 0; j < q.h; j++) for (let i = 0; i < q.w; i++) {
      const o = off + (j * q.w + i) * 4;
      if (!buf[o + 3]) continue;
      const d = (q.x0 + i - q.px) ** 2 + (q.y0 + j - q.py) ** 2;
      if (d < bd) { bd = d; best = buf[o] + buf[o + 1] * 256 + buf[o + 2] * 65536 - 1; }
    }
    return best < this.count ? best : -1;
  }
  pick(x, y) {
    const gl = this.gl;
    if (!this.last || !this.count || gl.isContextLost()) return -1;
    const q = this._pickDraw(x, y), n = q.w * q.h * 4, buf = new Uint8Array(n * 2);
    gl.readPixels(q.x0, q.y0, q.w, q.h, gl.RGBA, gl.UNSIGNED_BYTE, buf, 0);
    gl.readPixels(q.x0 + q.dx, q.y0, q.w, q.h, gl.RGBA, gl.UNSIGNED_BYTE, buf, n);
    this._pickEnd();
    const a = this._pickRead(buf, 0, q);
    return a >= 0 ? a : this._pickRead(buf, n, q);
  }
  // The same, for the pointer hovering: the pixels are read into a buffer on the GPU and fetched a frame or two later, when
  // the GPU says they are there, so a hover never stalls the frame. pickAsync starts one (false while one is on its way);
  // pickPoll returns undefined until the answer is in, then the fiber index or -1, once.
  pickAsync(x, y) {
    const gl = this.gl;
    if (this._pk || !this.last || !this.count || gl.isContextLost()) return false;
    const q = this._pickDraw(x, y), n = q.w * q.h * 4;
    if (!this.pbo) { this.pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 19 * 19 * 4 * 2, gl.STREAM_READ); }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(q.x0, q.y0, q.w, q.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.readPixels(q.x0 + q.dx, q.y0, q.w, q.h, gl.RGBA, gl.UNSIGNED_BYTE, n);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this._pickEnd();
    this._pk = { q, n, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) };
    gl.flush();
    return true;
  }
  pickPoll() {
    const gl = this.gl, k = this._pk;
    if (!k) return undefined;
    if (gl.isContextLost()) { this._pk = null; return -1; }
    const st = gl.clientWaitSync(k.sync, 0, 0);
    if (st === gl.TIMEOUT_EXPIRED) return undefined;
    gl.deleteSync(k.sync); this._pk = null;
    if (st === gl.WAIT_FAILED) return -1;
    const buf = new Uint8Array(k.n * 2);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const a = this._pickRead(buf, 0, k.q);
    return a >= 0 ? a : this._pickRead(buf, k.n, k.q);
  }
}

// Jobs done thicken a fiber (log2 of the count; FIX V19: clean runs no longer do, they are the trust ladder's counter and
// only set the practised tier of light). The drawn radius is capped at RADIUS_CAP base radii so a fiber with hundreds of
// jobs does not become a monster. The layout's own scale for the muscle is kept.
export function drawRadius(f) {
  const nominal = typeof ANAT.fiberRadius === 'function' ? ANAT.fiberRadius(f.skill) : 0, R0 = ANAT.R0;
  return nominal > 0 && R0 > 0 ? Math.min(f.radius, RADIUS_CAP * R0 * (f.radius / nominal)) : f.radius;
}

// A reference normal for every control point of one fiber, carried along it without twist (parallel transport), written
// as xyz + 0 into out. A closed loop is given the small extra turn that makes its ends meet. The engraving, the glint
// facets and the off-axis core are placed against this frame, so they are fixed to the glass.
function frameRow(cp, off, out, closed, seed) {
  const P = (k) => [cp[off + k * 4], cp[off + k * 4 + 1], cp[off + k * 4 + 2]];
  const tan = (k) => { const d = V3.sub(P(Math.min(k + 1, CPN - 1)), P(Math.max(k - 1, 0))); return V3.len(d) > 1e-9 ? V3.norm(d) : [0, 1, 0]; };
  const T = []; for (let k = 0; k < CPN; k++) T.push(tan(k));
  const a0 = seed * Math.PI * 2, n0 = V3.perp(T[0]), b0 = V3.cross(T[0], n0);
  const N = [V3.add(V3.scale(n0, Math.cos(a0)), V3.scale(b0, Math.sin(a0)))];
  for (let k = 1; k < CPN; k++) {
    let n = V3.reject(N[k - 1], T[k]);
    N.push(V3.len(n) > 1e-6 ? V3.norm(n) : V3.perp(T[k]));
  }
  if (closed) {
    const i0 = 1, i1 = CPN - 2, t = T[i0], b = V3.cross(t, N[i0]);
    const al = Math.atan2(V3.dot(N[i1], b), V3.dot(N[i1], N[i0]));          // how far the frame has turned once round the loop
    for (let k = i0; k <= i1; k++) {
      const a = (-al * (k - i0)) / (i1 - i0), bk = V3.cross(T[k], N[k]);
      N[k] = V3.add(V3.scale(N[k], Math.cos(a)), V3.scale(bk, Math.sin(a)));
    }
    N[0] = N[CPN - 3]; N[CPN - 1] = N[2];
  }
  for (let k = 0; k < CPN; k++) { out[k * 4] = N[k][0]; out[k * 4 + 1] = N[k][1]; out[k * 4 + 2] = N[k][2]; out[k * 4 + 3] = 0; }
}
