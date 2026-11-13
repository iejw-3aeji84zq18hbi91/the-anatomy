// The interior. Ten forms, one fiber arrangement and one fixed place per family id, strung along the
// course of the river. Input: the model from feed.js. Output: one spline per skill (exactly one),
// plus scaffolding (sheaths, tendons, the far architecture) that is flagged as not-data and never counted.
//
// World: X right, Y up, Z toward the plate camera. There is no spine and no centre. The principal
// shaft of light is the world Y axis; the river passes in front of it and everything else stands
// off to one side or the other.

import { V3, Path, TAU, clamp, mix, smoothstep, packDiscs, bspline, rng } from './math.js';

export const CPN = 32;            // control points per fiber (uniform cubic B-spline)
export const R0 = 0.19;           // radius of a fiber with no measured work
const GAP = 0.30;                 // clearance between neighbouring fibers
const FGAP = 0.40;                // clearance between fascicles
export const SPARE_ROWS = 12;     // spline rows kept free for nerve lines and chain tendons
const DEG = Math.PI / 180;
const SPARSE = 24;                // below this many fibers a form also shows the dark lanes still waiting to fill

// Jobs done thicken the fiber: radius grows with log2(1 + jobs_done).
// FIX V19: clean_runs no longer counts here. It is the counter of the trust ladder, not a job count: it sets the practised
// tier of resting light and nothing else, so a skill with 172 clean runs and no recorded job is not drawn as heavily used.
export const fiberRadius = (s) => R0 * (1 + 0.36 * Math.log2(1 + s.jobs));
// PASS3 (T4): the spacing of the marks of a record (the CPU mirror of RECORD in shaders.js; keep the two the same). Up to
// thirty marks it is what it always was. A longer record is drawn as a counted scale: still one band per job, set closer
// (the whole record is 90 radii long up to 214 marks, then 0.42 radii a mark), so it fits one close-up.
export const recordPitch = (rad, len, nb, nn) => { const n = Math.max(nb + 0.72 * nn, 1); return Math.min(3.0 * rad, 0.5 * len / n, rad * Math.max(0.42, 90 / n)); };

// ---------------------------------------------------------------- the plan: every fixed place in one table
// Nothing in here depends on the feed. Sizes are for the reference count `ref`; a form grows with
// sqrt(count / ref) between `lo` and `hi`, and past its ceiling the fibers pack tighter instead.
export const PLAN = {
  // three shafts of light at three depths: x, z, radius scale, strength of the lit air, strength of its light on the glass.
  // FIX V08: the air in a shaft is far dimmer than it was (0.5, 0.5, 0.42) so no shaft is brighter than a resting core, and
  // the principal shaft stands behind and to the left of the river's crossing (was the world Y axis, where it cut the
  // hero frame in two and stood against the fan on the plate). The light it lays on the glass is what it was.
  // ART: the forms were re-set into one space (below), so the shafts moved with them: the principal one behind the veil,
  // one far back behind the harp, one behind the fan.
  shafts: [[-44, -96, 1.3, 0.13, 0.5], [-228, -190, 2.0, 0.17, 0.5], [-108, -142, 1.5, 0.065, 0.42]],      // CABLES: the air of the shaft behind the fan is half what it was: it filled the gaps between the fan's strands (darkest tenth 13 to 16 at 117 s)   //      // REPAIR (R1): moved with the forms again
  plate: { t: [8, 2, 5], dist: 300, elev: 19 * DEG, fov: 0.80 },      // CABLES: the plate was a long lens from high up (640 away, 0.40): every form the same size, a catalogue. It is now a wide lens from half as far and lower, so the near bank looms, the far bank recedes, forms stand before and behind each other and run off the frame
  //      // ART: the target is 6 higher, so the rope and the delta clear the totals strip
  research: {
    knots: [[-265, -60, 168], [-200, -52, 122], [-148, -46, 84], [-100, -42, 54], [-56, -36, 38], [-12, -27, 29], [32, -14, 18],
      [76, 4, 4], [118, 26, -6], [160, 50, -8], [205, 74, 0], [255, 94, 16], [310, 108, 40]],
    up: [0, 0.62, 0.78], maxR: 38, emptyR: 6, wide: 22, loose: 1.9,      // ART (A3): the giant. A full river may be 26 across its half (was 17.5) and its lay opens to 22 (was 13.5, never more than `loose` times), with dark water between the channels
  },
  // ART (A4): one space. The forms stood apart on black, each a specimen. They now stand round the river in three depths
  // and pass in front of and behind each other and the river: far (harp, fan, delta), behind the river (veil, rope), in
  // front of it (loop, strata, plume, quill). A form with many fibers also grows much further than it did (`hi`), so a
  // full body fills the frame; with few fibers every form keeps the size it had (`lo`, `ref` unchanged).
  // REPAIR (R1): one woven space. On a full body every form grows to two or three times what it was (`hi`), and the forms
  // were set again so that they pass over, under and behind the river and each other: the veil hangs behind the river and
  // the delta comes down behind the veil; the fan and the harp stand behind the loop; the strata lie under the river and
  // across it; the rope hangs in a great swag that passes under the river's far reach; the plume and the quill stand on
  // the near bank. `lo` and `ref` are what they were, so a sparse body keeps its sizes.
  back_office: { top: [-26, 96, -56], e1: V3.norm([0.95, 0, 0.3]), W: 64, H: 70, ref: 21, lo: 0.9, hi: 2.5 },
  // the rope: the knots are written for a full body; with fewer fibers the swag is smaller, about its lowest point (`low`)
  making: { knots: [[72, 150, -46], [92, 90, -40], [112, 26, -52], [124, -27, 0], [110, 6, 50], [104, 64, 80], [98, 132, 106]], low: [124, -27, 0], full: 260, lo: 0.62, maxR: 14 },
  conversation: { c: [-150, 0, 18], axis: V3.norm([-23, 8, -155]), R: 22, tube: 11, ref: 41, lo: 0.85, hi: 2.2 },   // the axis points at the harp
  browser: { apex: [-140, -66, -108], d: V3.norm([-0.10, 0.99, 0.03]), pn: V3.norm([-0.20, 0.10, 0.97]), L: 44, spread: 0.84, ref: 19, lo: 0.85, hi: 2.5 },
  tools: { base: [60, -120, 96], up: V3.norm([0.04, 1, -0.06]), pn: V3.norm([0.10, 0.30, 0.95]), stem: 28, L: 38, ref: 32, lo: 0.85, hi: 2.4 },
  computer: { o: [197, 125, -38], flow: V3.norm([-0.33, -0.79, -0.375]), pn: V3.norm([0.25, 0.55, 0.80]), L: 60, ref: 20, lo: 0.9, hi: 2.7 },
  shell: { base: [-165, -62, -150], s: V3.norm([-0.06, 1, -0.04]), e: V3.norm([0.93, 0, 0.36]), Lmax: 76, Lmin: 26, ref: 30, lo: 0.9, hi: 1.6 },
  files: { c: [-30, -112, 40], e: V3.norm([0.485, 0.04, 0.875]), up: V3.norm([-0.20, 0.86, 0.46]), L: 50, depth: 12, pitch: 3.7, ref: 34, lo: 0.9, hi: 2.2 },
  mail: { base: [124, -100, 124], tip: [142, -53, 111], pn: V3.norm([0.20, 0.42, 0.88]), ref: 34, lo: 0.9, hi: 2.6 },
};

// ---------------------------------------------------------------- small helpers shared by the forms
const pol = (o) => [Math.hypot(o.x, o.y), Math.atan2(o.y, o.x)];
const off2 = (fr, x, y) => V3.addS(V3.addS(fr.p, fr.n, x), fr.b, y);
const at3 = (o, a, x, b, y, c, z) => {
  const p = [o[0] + a[0] * x, o[1] + a[1] * x, o[2] + a[2] * x];
  if (b) { p[0] += b[0] * y; p[1] += b[1] * y; p[2] += b[2] * y; }
  if (c) { p[0] += c[0] * z; p[1] += c[1] * z; p[2] += c[2] * z; }
  return p;
};
// CABLES: in a cable laid glass to glass the inner strands are hidden and the baked shadow already darkens its heart: the lay does not dim them a second time
const cableShade = (r, R) => mix(0.72, 1.18, Math.pow(clamp(R > 0 ? r / R : 1, 0, 1), 1.5));
const shadeOf = (r, R, rho, RM) => mix(0.34, 1, Math.pow(clamp(R > 0 ? r / R : 1, 0, 1), 1.5)) * mix(0.66, 1, clamp(RM > 0 ? rho / RM : 1, 0, 1));
const grow = (n, A) => clamp(Math.sqrt(Math.max(n, 1) / A.ref), A.lo, A.hi);
const leaf = (v, p = 0.7) => Math.pow(Math.max(0, Math.sin(Math.PI * clamp(v, 0, 1))), p);
// A unit is one skill, or the versions of one learned request (same_shape) that are drawn twisted together.
const ringOf = (k, r) => (k < 2 ? 0 : k === 2 ? r + 0.03 : (r + 0.03) / Math.sin(Math.PI / k));
const unitR = (unit) => { let r = 0; for (const s of unit) r = Math.max(r, fiberRadius(s)); return ringOf(unit.length, r) + r + GAP / 2; };
const packUnits = (units, k = 1) => packDiscs(units.map((u) => unitR(u) * k));
// CABLES: a fascicle is drawn as one cable: its strands lie glass to glass (a hair of air between them, no lane), so twenty
// to sixty strands read as one thick bundle with dark water between it and the next. The drawn radius is what counts
// (renderer.js caps it at 2.2 base radii), so a much-used fiber does not hold its neighbours off.
const RIVER_BODY = 1.35;
const CAB_AIR = 0.05, drawnR = (s) => Math.min(fiberRadius(s), 2.2 * R0);
const tightR = (unit) => { let r = 0; for (const s of unit) r = Math.max(r, drawnR(s)); return ringOf(unit.length, r) + r * 1.06 + CAB_AIR; };
const packTight = (units) => packDiscs(units.map(tightR), { relax: 14 });
// FOUNDER NOTE 1: a fascicle of fibers that are not active (staged, retired: dark glass with no light in it) is not laid
// glass to glass: packed tight, twenty dark strands read from the plate as one smooth dark rod. They keep the open lay.
const packCable = (units) => { let n = 0, a = 0; for (const u of units) for (const s of u) { n++; if (s.stateCode === 0) a++; } return a * 3 >= n ? packTight(units) : packUnits(units); };
const unitsOf = (fam) => fam.fascicles.flatMap((f) => f.units);
const fibersIn = (units) => units.reduce((a, u) => a + u.length, 0);
// spread an ordered list over bins, contiguous, so fascicles stay together
function chunk(list, bins) {
  const out = Array.from({ length: bins }, () => []), n = list.length;
  list.forEach((s, i) => out[n < bins ? i : Math.min(bins - 1, Math.floor((i * bins) / n))].push(s));
  return out;
}
// periodic Catmull-Rom over an array of numbers sampled at j = 0..n-1 (clamped at the ends)
function sampleCR(arr, x) {
  const n = arr.length, xc = clamp(x, 0, n - 1), i = Math.min(Math.floor(xc), n - 2), f = xc - i;
  const a = arr[Math.max(i - 1, 0)], b = arr[i], c = arr[i + 1], d = arr[Math.min(i + 2, n - 1)], f2 = f * f, f3 = f2 * f;
  return 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
}

// ---------------------------------------------------------------- the ten forms
const ARCH = {
  // The river (web search and research). A long course through the whole space. Fascicles take a
  // reach of it each and taper to pointed slips, so it swells where reaches overlap. Lanes of one
  // swarm share a channel and twist round each other; channels lie side by side in a flattened
  // cross-section that turns slowly, so the river broadens and narrows as it goes.
  research(m, ctx) {
    const A = PLAN.research, path = new Path(A.knots, { up: A.up, samples: 360 });
    const fasc = m.fam.fascicles, F = fasc.length;
    const FLAT_N = 0.9, FLAT_B = 1.14, CAB_GAP = 1.1;                     // thin toward the plate, broad across it
    const swell = (u) => 1 + 0.16 * Math.sin(TAU * 2.2 * u + 0.9) + 0.10 * Math.sin(TAU * 5.1 * u + 2.0);
    const mouth = (u) => 1 + 0.38 * Math.pow(1 - smoothstep(0, 0.30, u), 1.5);      // channels part toward the near end
    let R = A.emptyR, Rj = null, NS = 0, scR = 1;
    if (F) {
      // Reaches. Every fascicle rises near the head of the river, a little after the one before it,
      // so the near end is a spray of pointed slips. They leave it in turn: the small groups first,
      // then the second largest, and the largest runs on to the far end. The river is at its fullest
      // through the confluence in the light of the principal shaft and tapers into the distance.
      const gids = [...new Set(fasc.map((f) => f.group))];
      const gsize = new Map(gids.map((g) => [g, fasc.filter((f) => f.group === g).reduce((a, f) => a + f.skills.length, 0)]));
      const bySize = gids.slice().sort((a, b) => gsize.get(b) - gsize.get(a));
      const few = F <= 3;
      const groups = bySize.map((g, gi) => {
        const list = fasc.filter((f) => f.group === g);
        const band = few ? [0.955, 0.97] : gi === 0 ? [0.90, 0.97] : gi === 1 ? [0.76, 0.86] : [mix(0.56, 0.70, (gi - 2) / Math.max(bySize.length - 3, 1)), mix(0.60, 0.74, (gi - 2) / Math.max(bySize.length - 3, 1))];
        const fs = list.map((f, j) => ({ f, pk: packCable(f.units), a: 0, b: mix(band[0], band[1], list.length > 1 ? j / (list.length - 1) : 0.5), k: 0 }));
        return { g, gi, fs };
      });
      // heads, staggered in feed order (the swarm first)
      fasc.forEach((f, i) => { const x = groups.flatMap((G) => G.fs).find((y) => y.f === f); x.a = few ? 0.03 : mix(0.02, 0.10, F > 1 ? i / (F - 1) : 0); });
      const all = groups.flatMap((G) => G.fs); all.forEach((x, k) => { x.k = k; });
      const TAP = 0.065;
      const w = (x, u) => smoothstep(x.a, x.a + TAP, u) * smoothstep(x.b, x.b - TAP, u);
      // cross-sections at stations along the course: fascicles packed inside their group, groups packed in the river
      NS = 49;
      const GX = groups.map(() => new Float32Array(NS)), GY = groups.map(() => new Float32Array(NS));
      const FX = all.map(() => new Float32Array(NS)), FY = all.map(() => new Float32Array(NS));
      Rj = new Float32Array(NS);
      for (let j = 0; j < NS; j++) {
        const u = j / (NS - 1), gr = [];
        groups.forEach((G) => {
          const pk = packDiscs(G.fs.map((x) => (x.pk.R + CAB_GAP) * w(x, u)), { relax: 16 });      // CABLES: dark water between cables
          G.fs.forEach((x, i) => { FX[x.k][j] = pk.pts[i].x; FY[x.k][j] = pk.pts[i].y; });
          gr.push(G.fs.some((x) => w(x, u) > 0) ? pk.R + CAB_GAP * 0.6 : 0);
        });
        const pg = packDiscs(gr, { relax: 24 });
        groups.forEach((G, i) => { GX[i][j] = pg.pts[i].x; GY[i][j] = pg.pts[i].y; });
        Rj[j] = pg.R;
      }
      const RM = Rj.reduce((a, b) => Math.max(a, b), 0);
      const sc = Math.min(1, A.maxR / Math.max(RM * 1.15, 1e-3));
      // FIX V09 (and the known problem: the river reads thin): the river is the giant of the space. When its fibers pack into
      // less than A.wide, the lay is opened up (never more than A.loose times): the same fibers at the same thickness, with
      // dark water between the channels, so it stands as a massive braided body. A full river (the mock, the stress feed)
      // is at its ceiling already and is unchanged.
      const ps = sc * clamp(A.wide / Math.max(RM * sc, 1e-3), 1, A.loose); scR = ps;
      const turnsG = path.length / 520, turnsF = path.length / 150, hrnd = rng(211);
      groups.forEach((G) => G.fs.forEach((x) => {
        const hand = x.k % 2 ? 1 : -1, len = x.b - x.a, ph = (x.k * 2.399) % TAU;
        // CABLES: the ties of this cable (its centre line is the strands' own, with no strand offset)
        const cen = (ul) => {
          const u = x.a + len * ul, uc = clamp(u, 0, 1), fr = path.at(u), sj = uc * (NS - 1), e = swell(uc);
          const gx = sampleCR(GX[G.gi], sj), gy = sampleCR(GY[G.gi], sj), tg = TAU * turnsG * uc + 0.6, cg = Math.cos(tg), sg = Math.sin(tg);
          const fx = sampleCR(FX[x.k], sj), fy = sampleCR(FY[x.k], sj), tf = TAU * turnsF * uc * (G.gi % 2 ? -1 : 1) + G.gi, cf = Math.cos(tf), sf = Math.sin(tf), mo = mouth(uc);
          return off2(fr, ((gx * cg - gy * sg) * FLAT_N * e + (fx * cf - fy * sf) * mo) * ps, ((gx * sg + gy * cg) * FLAT_B * e + (fx * sf + fy * cf) * mo) * ps);
        };
        const tie0 = m.fibers.length;
        x.f.units.forEach((unit, i) => {
          const [r2, a2] = pol(x.pk.pts[i]);
          ctx.unit(unit, m, (ul) => {
            const u = x.a + len * ul, uc = clamp(u, 0, 1), fr = path.at(u), sj = uc * (NS - 1), ww = w(x, uc);
            // the group in the river: slow turn of the whole lay, then flattened
            const gx = sampleCR(GX[G.gi], sj), gy = sampleCR(GY[G.gi], sj), tg = TAU * turnsG * uc + 0.6, cg = Math.cos(tg), sg = Math.sin(tg), e = swell(uc);
            let X = (gx * cg - gy * sg) * FLAT_N * e, Y = (gx * sg + gy * cg) * FLAT_B * e;
            // the fascicle in its group: lanes of one swarm twist round each other
            const fx = sampleCR(FX[x.k], sj), fy = sampleCR(FY[x.k], sj), tf = TAU * turnsF * uc * (G.gi % 2 ? -1 : 1) + G.gi, cf = Math.cos(tf), sf = Math.sin(tf), mo = mouth(uc);
            X += (fx * cf - fy * sf) * mo; Y += (fx * sf + fy * cf) * mo;
            // the fiber in its fascicle: closes to a point at both ends of the reach
            const B = a2 + hand * TAU * 2.2 * ul + ph, k = mix(0.55, 1, Math.pow(ww, 0.8));
            // CABLES: the lay of the cables opens (ps); the strands of one cable stay glass to glass (sc)
            // P3R (scale): the cables of the river are RIVER_BODY times as thick (strands and lay alike, so each is still packed
            // glass to glass) on the same centre lines: 1.8 times the section, and the dark water between them is a third of
            // what it was. Within the river a fiber's thickness still says what it said (log of its jobs, one scale for all).
            return off2(fr, X * ps + Math.cos(B) * r2 * k * sc * RIVER_BODY, Y * ps + Math.sin(B) * r2 * k * sc * RIVER_BODY);
          }, { shade: mix(shadeOf(r2, x.pk.R, 1, 1), cableShade(r2, x.pk.R), 0.5), scale: sc * RIVER_BODY, taper: (ul) => mix(0.5, 1, smoothstep(0, 0.14, ul)) * mix(1, 0.5, smoothstep(0.86, 1, ul)) });
        });
        if (x.f.units.length >= 5) ctx.ties(m.fibers.slice(tie0), hrnd, { every: 30, u0: 0.16, u1: 0.84 });      // PASS3 (T1)
      }));
      R = Math.max(RM * ps, A.emptyR * 0.8);
      const rs = (u) => Math.max(sampleCR(Rj, clamp(u, 0, 1) * (NS - 1)) * ps * swell(clamp(u, 0, 1)) * 1.12 + 1.2, A.emptyR * 0.55);
      // FOUNDER NOTE 1: a river with its fibers in it has no envelope round it: at this size the envelope was a great smooth
      // rounded body behind the braid. A sparse river (the tiny feed) keeps it, with its dashed lanes.
      if (m.fam.skills.length < SPARSE) ctx.tube(m, path, { ra: (u) => rs(u) * FLAT_N, rb: (u) => rs(u) * FLAT_B, kind: 'sheath', rings: 150 });
    } else {
      const rs = (u) => A.emptyR * swell(u) * (0.7 + 0.3 * leaf(u, 0.5));
      ctx.tube(m, path, { ra: (u) => rs(u) * FLAT_N, rb: (u) => rs(u) * FLAT_B, kind: 'sheath', rings: 150 });
    }
    if (m.fam.skills.length < SPARSE) {                     // the braid still to come: five dark channels
      for (let k = 0; k < 5; k++) ctx.ghost(m, (v) => { const u = 0.03 + 0.94 * v, fr = path.at(u), a = TAU * (k / 5 + 3.2 * u), rr = A.emptyR * 0.52 * swell(u) * (0.6 + 0.4 * leaf(u, 0.5)); return off2(fr, Math.cos(a) * rr * FLAT_N, Math.sin(a) * rr * FLAT_B); }, 1.25, 90);
    }
    // both ends run on into the mist
    for (const s of [-1, 1]) {
      const e = path.at(s < 0 ? 0 : 1), d = V3.scale(e.t, s), rise = s < 0 ? [0, -8, 30] : [0, 26, 20];
      const tendon = new Path([path.at(s < 0 ? 0.03 : 0.97).p, e.p, V3.addS(e.p, d, 70), V3.add(V3.addS(e.p, d, 190), rise)], { up: A.up });
      ctx.tube(m, tendon, { ra: () => 0.34, rb: () => 0.34, kind: 'tendon', cap: true });      // FOUNDER NOTE 1: a cord, not a tapered rod
    }
    // half the thickness of the river at u, measured toward its broad face
    const half = (u) => Math.max((F ? sampleCR(Rj, clamp(u, 0, 1) * (NS - 1)) * scR : A.emptyR) * swell(clamp(u, 0, 1)), A.emptyR * 0.5) * FLAT_N;
    const top = (u, k = 0.55) => { const fr = path.at(u); return V3.addS(fr.p, fr.n, half(u) * k); };
    // for the rail: a point h above the broad face of the river at u, moved `side` across it
    m.skim = (u, h, side = 0) => { const fr = path.at(u); return V3.addS(V3.addS(fr.p, fr.n, half(u) + h), fr.b, side); };
    Object.assign(m, { path, anchors: [0.10, 0.19, 0.28, 0.37, 0.46, 0.55, 0.64, 0.74, 0.84].map((u) => top(u)), plateAnchor: top(0.34), center: path.at(0.4).p, view: V3.norm([0.1, 0.62, 0.78]), dist: 44, R });
  },

  // The veil (back-office work). A curtain hanging from a dark rail: three plies whose fibers lean
  // one way, the other way, and straight down, cut to the outline, with folds that deepen to the hem.
  back_office(m, ctx) {
    const A = PLAN.back_office, g = grow(m.fam.skills.length, A), W = A.W * g, H = A.H * g;
    const e1 = A.e1, dn = [0, -1, 0], pn = V3.cross(dn, e1);
    // REPAIR (R5): a veil that has grown is no flat wall of rods. Its pleats deepen with it and its three plies hang further
    // apart, so the baked shadow falls between the plies and into the folds; every strand has a brightness of its own, and
    // the sheet falls off from its lit edge (toward the principal shaft) to its far side. None of it reads the record.
    const gf = 0.5 + 0.5 * g, vr = rng(57);
    const fold = (a, h) => gf * (0.2 + 0.8 * h) * (Math.sin(TAU * 2.5 * a + 0.6) * 2.4 + Math.sin(TAU * 0.9 * a - 1.1) * 1.6 + (g > 1.2 ? Math.sin(TAU * 5.3 * a + 2.0 + 3.0 * h) * 0.7 : 0));
    const hem = (a) => 1 - 0.05 * (1 - Math.cos(TAU * 2.5 * a + 0.6));
    const surf = (a, h, lift = 0) => at3(A.top, e1, a * W * (1 + 0.07 * h), dn, h * H, pn, fold(a, h) + lift);
    const units = unitsOf(m.fam), fas = m.fam.fascicles, layers = [[], [], []];
    if (fas.length >= 3) fas.forEach((f, k) => layers[k % 3].push(...f.units)); else units.forEach((u, i) => layers[i % 3].push(u));
    const kLean = [Math.tan(24 * DEG) * H / W, -Math.tan(24 * DEG) * H / W, 0];
    const cap = Math.max(8, Math.floor(W / 0.5));
    // CABLES: a veil that has grown hangs from its rail as cables, one to a fascicle, and each cable opens on its way down
    // into the sheet: three leaning plies of loose tresses that fold and fray at the hem. (It was three flat plies of evenly
    // spaced rods: a lattice wall.) The strands are the same fibers, one to a skill; a sparse veil keeps the old lay.
    const cable = g > 1.2 && fas.length >= 3;
    if (cable) {
      const hrnd = rng(241), tot = units.length; let acc = 0;
      fas.forEach((f, k) => {
        const pk = packCable(f.units), n = f.units.length, c0 = acc / tot - 0.5, c1 = (acc + n) / tot - 0.5; acc += n;
        const ck = (c0 + c1) * 0.5 * 0.96, sway = (k % 2 ? 1 : -1) * 0.03, open0 = 0.20 + 0.18 * vr(), tw = (k % 2 ? 1 : -1) * (1.2 + 0.8 * vr());
        const gat = (h) => 1 - smoothstep(open0, open0 + 0.42, h), cx = (h) => ck + sway * Math.sin(Math.PI * 1.1 * h + k);
        const tie0 = m.fibers.length;
        f.units.forEach((unit, i) => {
          const [r2, a2] = pol(pk.pts[i]), ply = i % 3, kl = [0.15, -0.15, 0][ply];
          const cs = clamp(mix(c0, c1, (i + 0.5) / n) * 0.96 + (c1 - c0) * 0.3 * (vr() - 0.5), -0.5, 0.5);
          const lift = (ply - 1) * 1.15 * (1 + 0.7 * (gf - 1)), own = (0.62 + 0.55 * vr()) * mix(1.12, 0.66, clamp(cs + 0.5, 0, 1)), h1 = hem(cs) * (0.93 + 0.07 * vr());
          ctx.unit(unit, m, (u) => {
            const h = u * h1, gg = 0.22 + 0.78 * gat(h), B = a2 + TAU * tw * h;
            const q = surf(clamp(mix(cs + kl * (h - 0.6), cx(h), gg), -0.56, 0.56), h, lift * (1 - gg));
            return at3(q, e1, Math.cos(B) * r2 * gg, pn, Math.sin(B) * r2 * gg);
          }, { shade: mix(own, cableShade(r2, pk.R), 0.5) * 1.1, scale: 1, nrm: pn });
        });
        if (n >= 5) ctx.ties(m.fibers.slice(tie0), hrnd, { every: 15, u0: 0.04, u1: 0.27 });      // PASS3 (T1): on the gathered head of each cable, above where it opens
      });
    }
    else layers.forEach((list, li) => {
      const n = list.length, plies = Math.max(1, Math.ceil(n / cap)), per = Math.ceil(n / plies) || 1, k = kLean[li], ak = Math.abs(k);
      list.forEach((unit, i) => {
        const ply = i % plies, r = Math.floor(i / plies);
        const c = mix(-0.5 - 0.1 * ak, 0.5 + 0.1 * ak, (r + 0.5) / per) * 0.96;
        // the line a = c + k (h - 0.5), kept inside the outline
        let h0 = 0, h1 = 1;
        if (k > 0) { h0 = Math.max(0, 0.5 + (-0.5 - c) / k); h1 = Math.min(1, 0.5 + (0.5 - c) / k); } else if (k < 0) { h0 = Math.max(0, 0.5 + (0.5 - c) / k); h1 = Math.min(1, 0.5 + (-0.5 - c) / k); }
        h1 = Math.min(h1, hem(c + k * (h1 - 0.5)));
        const lift = ((li - 1) * 1.15 + ply * 0.5) * (1 + 0.7 * (gf - 1));
        const own = g > 1.2 ? (0.62 + 0.55 * vr()) * mix(1.12, 0.66, clamp(c + 0.5, 0, 1)) : 1;
        ctx.unit(unit, m, (u) => { const h = mix(h0, h1, u); return surf(c + k * (h - 0.5), h, lift); }, { shade: (li === 1 ? 0.8 : 1) * (ply ? 0.7 : 1) * own, scale: 1, nrm: pn });
      });
    });
    if (m.fam.skills.length < SPARSE) {
      kLean.forEach((k, li) => { const ak = Math.abs(k); for (let r = 0; r < 7; r++) {
        const c = mix(-0.5 - 0.1 * ak, 0.5 + 0.1 * ak, (r + 0.5) / 7) * 0.96; let h0 = 0, h1 = 1;
        if (k > 0) { h0 = Math.max(0, 0.5 + (-0.5 - c) / k); h1 = Math.min(1, 0.5 + (0.5 - c) / k); } else if (k < 0) { h0 = Math.max(0, 0.5 + (0.5 - c) / k); h1 = Math.min(1, 0.5 + (-0.5 - c) / k); }
        h1 = Math.min(h1, hem(c + k * (h1 - 0.5)));
        ctx.ghost(m, (u) => { const h = mix(h0, h1, u); return surf(c + k * (h - 0.5), h, (li - 1) * 1.15 - 0.4); }, 0.5, 12);
      } });
    }
    // the sheath: hanging pleats, and the rail they hang from with its two cords
    const P = cable ? 0 : 7;      // FOUNDER NOTE 1: no smooth pleat slabs round a veil that has its fibers
    for (let p = 0; p < P; p++) {
      const a = (p + 0.5) / P - 0.5, pts = [];
      for (let i = 0; i <= 6; i++) pts.push(surf(a, (i / 6) * hem(a)));
      ctx.tube(m, new Path(pts, { up: pn }), { ra: () => 1.5, rb: () => (W / P) * 0.53, kind: 'sheath', rings: 28 });
    }
    const rail = new Path([surf(-0.56, 0), surf(0, -0.004), surf(0.56, 0)], { up: [0, 1, 0] });
    ctx.tube(m, rail, { ra: () => 0.5, rb: () => 0.5, kind: 'tendon', rings: 20, cap: true });
    for (const s of [-1, 1]) {
      const a = surf(s * 0.5, 0), cord = new Path([a, at3(a, e1, s * 6, [0, 1, 0], 60), at3(a, e1, s * 22, [0, 1, 0], 190, pn, -30)], { up: pn });
      ctx.tube(m, cord, { ra: () => 0.3, rb: () => 0.3, kind: 'tendon', rings: 24, cap: true });
    }
    const path = new Path([surf(-0.5, 0.5), surf(-0.2, 0.5), surf(0.2, 0.5), surf(0.5, 0.5)], { up: [0, 1, 0] });
    Object.assign(m, { path, anchors: [surf(0.18, 0.3, 1.5), surf(-0.22, 0.45, 1.5), surf(0.05, 0.7, 1.5), surf(-0.35, 0.2, 1.5), surf(0.36, 0.55, 1.5)], plateAnchor: surf(-0.30, 0.16, 1.5), center: surf(0, 0.5), view: pn, dist: 62, R: W * 0.5 });
  },

  // The rope (making things). Strands laid round each other, the fibers of each strand counter-laid,
  // hung as a swag between two points that run on up into the mist.
  making(m, ctx) {
    const A = PLAN.making, gk = clamp(Math.sqrt(Math.max(m.fam.skills.length, 1) / A.full), A.lo, 1);      // REPAIR (R1)
    const path = new Path(A.knots.map((k) => V3.add(A.low, V3.scale(V3.sub(k, A.low), gk))), { up: [0, 0, 1] });
    const fas = m.fam.fascicles.map((f) => ({ f, pk: packCable(f.units) }));      // CABLES
    const K = fas.length, lay = packDiscs(fas.map((x) => x.pk.R + 0.5), { relax: 24 });
    const Rrope = K ? lay.R : 0, sc = Math.min(1, A.maxR / Math.max(Rrope, 1e-3));
    const turns = clamp(path.length / Math.max(26, Rrope * sc * 10), 2.5, 5);
    const hrnd = rng(223);
    fas.forEach((x, k) => {
      const [rho, phi] = pol(lay.pts[k]);
      const tie0 = m.fibers.length;
      x.f.units.forEach((unit, i) => {
        const [r2, a2] = pol(x.pk.pts[i]);
        ctx.unit(unit, m, (u) => {
          const fr = path.at(u), a = phi + TAU * turns * u, b = a2 - TAU * turns * 0.55 * u;
          return off2(fr, (Math.cos(a) * rho + Math.cos(b) * r2) * sc, (Math.sin(a) * rho + Math.sin(b) * r2) * sc);
        }, { shade: cableShade(r2, x.pk.R), scale: sc });
      });
      if (x.f.units.length >= 5) ctx.ties(m.fibers.slice(tie0), hrnd, { every: 26 });      // PASS3 (T1)
    });
    const R = Math.max(Rrope * sc + 0.7, 2.6);
    // FOUNDER NOTE 1: a rope with its fibers in it has no envelope (it was a smooth translucent capsule with a rounded end
    // round the strands on the real feed). Only a rope still waiting to fill keeps one, open at both ends, with its lanes.
    if (m.fam.skills.length < SPARSE) ctx.tube(m, path, { ra: () => R, rb: () => R, kind: 'sheath', rings: 90, cap: true });
    if (m.fam.skills.length < SPARSE) for (let k = 0; k < 3; k++) ctx.ghost(m, (u) => { const fr = path.at(u), a = TAU * (k / 3 + 3.5 * u); return off2(fr, Math.cos(a) * 1.5, Math.sin(a) * 1.5); }, 0.95, 70);
    for (const s of [0, 1]) {
      const e = path.at(s), d = V3.scale(e.t, s ? 1 : -1);
      const cord = new Path([path.at(s ? 0.97 : 0.03).p, e.p, V3.add(V3.addS(e.p, d, 60), [0, 22, 0]), V3.add(V3.addS(e.p, d, 150), [0, 120, -20])], { up: [0, 0, 1] });
      ctx.tube(m, cord, { ra: () => 0.32, rb: () => 0.32, kind: 'tendon', cap: true });      // FOUNDER NOTE 1: a thin cord (it was a smooth dark tapered rod in front of the river)
    }
    Object.assign(m, { path, anchors: [0.5, 0.3, 0.7, 0.16, 0.84].map((u) => path.at(u).p), plateAnchor: path.at(0.56).p, center: path.at(0.5).p, view: V3.norm([-0.3, 0.1, 0.95]), dist: 30, R });
  },

  // The loop (conversation). A free ring, tilted. Every fiber is a closed loop; nothing passes through it.
  conversation(m, ctx) {
    const A = PLAN.conversation, g = grow(m.fam.skills.length, A), RR = A.R * g, C = A.c, e3 = A.axis;
    const e1 = V3.norm(V3.cross([0, 1, 0], e3)), e2 = V3.cross(e3, e1);
    const fas = m.fam.fascicles.map((f) => ({ f, pk: packCable(f.units) }));      // CABLES
    const lay = packDiscs(fas.map((x) => x.pk.R + FGAP + 0.4), { relax: 24 }), RM = fas.length ? lay.R : 0;
    const sc = Math.min(1, A.tube / Math.max(RM, 1e-3));
    const pt = (th, x, y) => at3(C, e1, Math.cos(th) * (RR + x), e2, Math.sin(th) * (RR + x), e3, y);
    fas.forEach((x, k) => {
      const [rho, phi] = pol(lay.pts[k]);
      x.f.units.forEach((unit, i) => {
        const [r2, a2] = pol(x.pk.pts[i]), th0 = ((unit[0].seed % 1000) / 1000) * TAU, j0 = m.fibers.length;
        ctx.unit(unit, m, (u) => {
          const th = th0 + TAU * u, a = phi + th, b = a2 - 2 * th;      // CABLES: the lay is fixed to the ring, not to each fiber's own start, so a fascicle is one cable all the way round
          return pt(th, (Math.cos(a) * rho + Math.cos(b) * r2) * sc, (Math.sin(a) * rho + Math.sin(b) * r2) * sc);
        }, { shade: cableShade(r2, x.pk.R), scale: sc, closed: true, nrm: e3 });
        for (let j = j0; j < m.fibers.length; j++) (x.tie ||= []).push([m.fibers[j], th0 / TAU]);
      });
    });
    const R = Math.max(RM * sc + 0.7, 2.4);
    const loop = []; for (let i = 0; i < 28; i++) loop.push(pt((i / 28) * TAU, 0, 0));
    const path = new Path(loop, { closed: true, up: e3 });
    if (m.fam.skills.length < SPARSE) ctx.tube(m, path, { ra: () => R, rb: () => R, kind: 'sheath', closed: true, rings: 96 });      // FOUNDER NOTE 1: no smooth torus round a ring that has its fibers
    { const hrnd = rng(229); fas.forEach((x) => { if (x.f.units.length >= 5 && x.tie) ctx.ties(x.tie.map((q) => q[0]), hrnd, { every: 24, u0: 0, u1: 1, offs: x.tie.map((q) => q[1]), closed: true }); }); }      // PASS3 (T1)
    if (m.fam.skills.length < SPARSE) for (let k = 0; k < 3; k++) ctx.ghost(m, (u) => { const th = TAU * u, a = TAU * (k / 3 + u); return pt(th, Math.cos(a) * 1.3, Math.sin(a) * 1.3); }, 0.8, 72, true);
    const rim = (th) => pt(th, 0, 0);
    Object.assign(m, { path, anchors: [0.25, 0.75, 0.5, 0, 0.12, 0.62, 0.38, 0.88].map((t) => rim(t * TAU)), plateAnchor: rim(0.22 * TAU), center: C, view: V3.norm([-0.35, 0.3, 0.9]), dist: 62, R: RR, axis: e3 });
  },

  // The fan (in-app browser). A wide flat arc of fibers that all converge on one point.
  browser(m, ctx) {
    const A = PLAN.browser, g = grow(m.fam.skills.length, A), L = A.L * g, spread = A.spread, apex = A.apex, d = A.d;
    const pn = V3.norm(V3.reject(A.pn, d)), w = V3.cross(pn, d);
    const units = unitsOf(m.fam), N = units.length;
    const perMax = Math.round(42 * g), layers = Math.max(1, Math.ceil(N / perMax)), per = Math.ceil(N / layers) || 1;
    const sc = clamp(perMax / Math.max(per, 1), 0.6, 1);
    const tend = packUnits(units, 0.62);
    const ray = (al) => V3.addS(V3.scale(d, Math.cos(al)), w, Math.sin(al));
    // PASS3 (T3): the fan was a flat fan of single strands. On a body with enough of them the strands leave the stem as
    // cables (a dozen or so strands each, laid glass to glass, with ties), run out along the fan and splay over the outer
    // half into their own places on the rim. The rim, the point and the place are what they were.
    const cabN = N >= 40 ? clamp(Math.round(N / 14), 3, 16) : 0, frnd = rng(251), alOf = (i) => mix(-spread, spread, (Math.floor(i / layers) + 0.5) / per);
    const cabs = cabN ? chunk(units.map((_, i) => i), cabN).filter((l) => l.length).map((l, ci) => { const pk = packCable(l.map((i) => units[i]));
      return { l, ci, pk, al: l.reduce((a, i) => a + alOf(i), 0) / l.length, k: Math.min(1, 0.33 * L * (2 * spread / cabN) / Math.max(pk.R, 1e-3)), F: [] }; }) : [];
    const cabOf = new Map(); cabs.forEach((c) => c.l.forEach((i, q) => cabOf.set(i, [c, q])));
    units.forEach((unit, i) => {
      const lay = i % layers, j = Math.floor(i / layers);
      const al = mix(-spread, spread, (j + 0.5) / per), r = ray(al), lo = (lay - (layers - 1) / 2) * 0.85;
      if (cabOf.has(i)) {
        const [c, q] = cabOf.get(i), [r2, a2] = pol(c.pk.pts[q]), Lr = L * (0.955 + 0.045 * Math.cos(al * 2.2)), hand = c.ci % 2 ? 1 : -1;
        const to = V3.addS(V3.scale(w, tend.pts[i].x * sc), pn, tend.pts[i].y * sc), S0 = V3.add(V3.addS(apex, d, 3.2), to), S1 = V3.add(V3.addS(apex, d, -7), to), j0 = m.fibers.length;
        ctx.unit(unit, m, (u) => {
          const tau = Math.min(u / 0.80, 1), rho = Lr * (1 - tau), sp = 1 - smoothstep(0.03, 0.52, tau);      // sp: 1 on the rim (splayed), 0 once gathered
          const rr = ray(mix(c.al, al, sp)), wk = V3.cross(pn, rr), tw = a2 + hand * 2.4 * Math.PI * tau, g = r2 * c.k * (1 - sp);
          const A = at3(apex, rr, rho, wk, Math.cos(tw) * g, pn, lo * sp + Math.sin(tw) * g + 1.4 * Math.sin(Math.PI * Math.min(tau, 1)) * sp);
          const sg = smoothstep(0.58, 1.0, u), B = V3.lerp(S0, S1, clamp((u - 0.80) / 0.20, 0, 1));
          return V3.lerp(A, B, sg);
        }, { shade: mix(0.72 + 0.28 * (lay === layers - 1 ? 1 : 0.5), cableShade(r2, c.pk.R), 0.5), scale: Math.min(sc, c.k), nrm: pn, taper: (u) => mix(1, 0.62, smoothstep(0.45, 0.95, u)) });
        for (let q2 = j0; q2 < m.fibers.length; q2++) c.F.push(m.fibers[q2]);
        return;
      }
      const P0 = V3.addS(V3.addS(apex, r, L * (0.955 + 0.045 * Math.cos(al * 2.2))), pn, lo);
      const P1 = V3.addS(V3.addS(apex, r, L * 0.5), pn, lo + 1.4);
      const to = V3.addS(V3.scale(w, tend.pts[i].x * sc), pn, tend.pts[i].y * sc);
      const P2 = V3.add(V3.addS(apex, d, 3.2), to), P3 = V3.add(V3.addS(apex, d, -7), to);
      ctx.unit(unit, m, (u) => {
        const t = u, q = 1 - t, a = q * q * q, b = 3 * q * q * t, c = 3 * q * t * t, e = t * t * t;   // cubic Bezier, smooth just outside [0,1]
        return [P0[0] * a + P1[0] * b + P2[0] * c + P3[0] * e, P0[1] * a + P1[1] * b + P2[1] * c + P3[1] * e, P0[2] * a + P1[2] * b + P2[2] * c + P3[2] * e];
      }, { shade: 0.72 + 0.28 * (lay === layers - 1 ? 1 : 0.5), scale: sc, nrm: pn, taper: (u) => mix(1, 0.62, smoothstep(0.45, 0.95, u)) });
    });
    for (const c of cabs) ctx.ties(c.F, frnd, { every: 12, u0: 0.44, u1: 0.70 });      // PASS3 (T3): on the gathered run of each cable
    const axis = new Path([V3.addS(apex, d, L * 1.0), V3.addS(apex, d, L * 0.6), V3.addS(apex, d, L * 0.2), V3.addS(apex, d, -7.5)], { up: pn });
    ctx.tube(m, axis, { ra: (u) => mix(L * Math.sin(spread) * 1.02, 1.3, smoothstep(0, 0.86, u)), rb: (u) => mix(1.5 + layers * 0.45, 1.2, u), kind: 'sheath', swap: true });
    if (N < SPARSE) for (let j = 0; j < 13; j++) {
      const al = mix(-spread, spread, (j + 0.5) / 13), r = ray(al);
      const P0 = V3.addS(apex, r, L * (0.955 + 0.045 * Math.cos(al * 2.2))), P1 = V3.addS(V3.addS(apex, r, L * 0.5), pn, 1.4), P2 = V3.addS(apex, d, 3.2), P3 = V3.addS(apex, d, -5);
      ctx.ghost(m, (t) => { const q = 1 - t, a = q * q * q, b = 3 * q * q * t, c = 3 * q * t * t, e = t * t * t; return [P0[0] * a + P1[0] * b + P2[0] * c + P3[0] * e, P0[1] * a + P1[1] * b + P2[1] * c + P3[1] * e, P0[2] * a + P1[2] * b + P2[2] * c + P3[2] * e]; }, 0.5, 14);
    }
    // the point they converge on runs out as one pale cord
    const cord = new Path([V3.addS(apex, d, 1), V3.addS(apex, d, -8), V3.add(V3.addS(apex, d, -22), [2, -4, -3]), V3.add(V3.addS(apex, d, -46), [8, -16, -12])], { up: pn });
    ctx.tube(m, cord, { ra: (u) => mix(0.9, 0.3, smoothstep(0, 0.4, u)), rb: (u) => mix(0.9, 0.3, smoothstep(0, 0.4, u)), kind: 'tendon', cap: true });
    const on = (al, r) => V3.addS(V3.addS(apex, ray(al), L * r), pn, 1);
    Object.assign(m, { path: axis, anchors: [on(0.3, 0.66), on(-0.4, 0.6), on(0, 0.8), on(0.6, 0.85), on(-0.65, 0.85)], plateAnchor: on(-0.55, 0.8), center: V3.addS(apex, d, L * 0.5), view: pn, dist: 52, R: L * 0.5 });
  },

  // The plume (tool use). One stem; from its top several feathered heads spray out and droop.
  tools(m, ctx) {
    const A = PLAN.tools, n = m.fam.skills.length, g = grow(n, A), up = A.up;
    const pn = V3.norm(V3.reject(A.pn, up)), w = V3.cross(pn, up), L = A.L * g;
    const J = V3.addS(A.base, up, A.stem * g);
    const units = unitsOf(m.fam), H = clamp(Math.round(Math.sqrt(Math.max(n, 1)) / 1.4), 3, 7);
    const lists = chunk(units, H), heads = [];
    for (let h = 0; h < H; h++) {
      const be = mix(-1.12, 1.12, h / (H - 1)), lean = (h % 2 ? 1 : -1) * 0.2 * (1 - Math.abs(be) / 1.4);
      const dir = V3.norm(at3([0, 0, 0], up, Math.cos(be), w, Math.sin(be), pn, lean));
      const droop = 0.16 + 0.34 * Math.abs(Math.sin(be)), Lh = L * (1 - 0.14 * Math.abs(be));
      const path = new Path([J, at3(J, dir, Lh * 0.34, up, Lh * 0.05), at3(J, dir, Lh * 0.72, up, -Lh * droop * 0.25), at3(J, dir, Lh * 0.98, up, -Lh * droop)], { up: pn });
      heads.push({ path, units: lists[h], Lh });
    }
    const Wd = (v) => 7.6 * g * Math.pow(Math.sin(Math.PI * clamp(0.1 + 0.82 * v, 0, 1)), 0.75);
    heads.forEach((hd) => {
      const k = hd.units.length, rowMax = Math.round(44 * g), rows = Math.max(1, Math.ceil(k / rowMax)), nq = Math.ceil(k / rows) || 1;
      const sc = clamp(rowMax / Math.max(nq, 1) * 1.6, 0.55, 1);
      hd.units.forEach((unit, j) => {
        const row = j % rows, q = Math.floor(j / rows);
        const v = mix(0.16, 0.8, (q + 0.5) / nq), side = q % 2 ? 1 : -1, lo = (row - (rows - 1) / 2) * 0.8 * sc + side * 0.12;
        ctx.unit(unit, m, (u) => {
          const e = smoothstep(-0.05, 1.05, u), kk = 1 - e, fr = hd.path.at(v + 0.2 * kk);     // the free end leads toward the tip
          return off2(fr, lo + 0.32, side * (0.32 + Wd(v) * Math.pow(kk, 1.15)));
        }, { shade: 0.8 + 0.2 * (row === rows - 1 ? 1 : 0.4), scale: sc, nrm: pn, taper: (u) => mix(0.7, 1, smoothstep(0, 0.4, u)) });
      });
      ctx.tube(m, hd.path, { ra: (u) => 0.5 + Wd(u) * 1.02, rb: () => 1.5, kind: 'sheath', swap: true, rings: 40 });
      if (n < SPARSE) for (let q = 0; q < 8; q++) {
        const v = mix(0.16, 0.8, (q + 0.5) / 8), side = q % 2 ? 1 : -1;
        ctx.ghost(m, (u) => { const kk = 1 - smoothstep(-0.05, 1.05, u), fr = hd.path.at(v + 0.2 * kk); return off2(fr, 0.3, side * (0.32 + Wd(v) * Math.pow(kk, 1.15))); }, 0.42, 10);
      }
      ctx.tube(m, hd.path, { ra: (u) => mix(0.5, 0.2, u), rb: (u) => mix(0.5, 0.2, u), kind: 'tendon', rings: 30 });
    });
    const stem = new Path([V3.add(V3.addS(A.base, up, -24), [3, 0, 5]), V3.addS(A.base, up, -10), A.base, V3.addS(A.base, up, A.stem * g * 0.5), J], { up: pn });
    ctx.tube(m, stem, { ra: (u) => mix(0.3, 0.72, smoothstep(0, 0.6, u)), rb: (u) => mix(0.3, 0.72, smoothstep(0, 0.6, u)), kind: 'tendon', cap: true });
    const mid = heads[H >> 1];
    Object.assign(m, { path: mid.path, anchors: [heads[H - 1].path.at(0.5).p, heads[0].path.at(0.5).p, mid.path.at(0.6).p, heads[Math.max(0, H - 2)].path.at(0.6).p, J], plateAnchor: heads[0].path.at(0.62).p, center: V3.addS(J, up, L * 0.3), view: pn, dist: 56, R: L * 0.8 });
  },

  // The delta (computer use). One stem that divides in two and then into five slips, flat, like a river delta.
  computer(m, ctx) {
    const A = PLAN.computer, g = grow(m.fam.skills.length, A), L = A.L * g, f = A.flow;
    const pn = V3.norm(V3.reject(A.pn, f)), lat = V3.cross(pn, f);
    const P = (along, across, lift = 0) => at3(A.o, f, along * L, lat, across * L, pn, lift);
    // five slips. Slips 0 and 1 share the left arm, 2, 3 and 4 the right arm; all share the stem.
    const arm = [-0.10, -0.10, 0.09, 0.09, 0.09], fork = [-0.21, -0.11, 0.05, 0.16, 0.26], tip = [-0.44, -0.20, 0.03, 0.27, 0.47], reach = [0.90, 1.0, 1.02, 0.97, 0.86];
    const wig = [0.03, -0.025, 0.02, -0.03, 0.025];
    const slips = [0, 1, 2, 3, 4].map((j) => ({
      j, units: [],
      path: new Path([P(0, 0), P(0.18, 0.004), P(0.36, arm[j] * 0.35), P(0.52, arm[j]), P(0.68, fork[j] + wig[j]), P(0.84, mix(fork[j], tip[j], 0.55) - wig[j]), P(reach[j], tip[j])], { up: pn, samples: 120 }),
    }));
    const units = unitsOf(m.fam), order = units.length < 5 ? [2, 1, 3, 0, 4] : [0, 1, 2, 3, 4];
    chunk(units, 5).forEach((list, i) => { slips[order[i]].units = list; });
    const stemAll = packUnits(units), armOf = (j) => (j < 2 ? 0 : 1);
    const armUnits = [slips.filter((s) => s.j < 2).flatMap((s) => s.units), slips.filter((s) => s.j >= 2).flatMap((s) => s.units)];
    const armPk = armUnits.map((l) => packUnits(l));
    const scS = Math.min(1, 3.6 * g / Math.max(stemAll.R, 1e-3)), scA = armPk.map((p) => Math.min(1, 2.7 * g / Math.max(p.R, 1e-3)));
    const idxAll = new Map(units.map((u, i) => [u, i]));
    slips.forEach((sl) => {
      const pk = packUnits(sl.units), s2 = Math.min(1, 1.45 * g / Math.max(pk.R, 1e-3)), a = armOf(sl.j);
      sl.units.forEach((unit, q) => {
        const pa = stemAll.pts[idxAll.get(unit)], pb = armPk[a].pts[armUnits[a].indexOf(unit)], pc = pk.pts[q];
        ctx.unit(unit, m, (u) => {
          const fr = sl.path.at(u), e1 = smoothstep(0.22, 0.44, u), e2 = smoothstep(0.50, 0.72, u);
          const x = mix(mix(pa.x * scS, pb.x * scA[a], e1), pc.x * s2, e2), y = mix(mix(pa.y * scS, pb.y * scA[a], e1), pc.y * s2, e2);
          return off2(fr, x, y);
        }, { shade: 0.9, scale: Math.min(scS, scA[a], s2), nrm: pn });
      });
      sl.R = Math.max(pk.R * s2 + 0.5, 1.15 * g);
    });
    const Rs = Math.max(stemAll.R * scS + 0.6, 2.4 * g);
    slips.forEach((sl) => ctx.tube(m, sl.path, { ra: (u) => mix(Rs * 0.72, sl.R, smoothstep(0.2, 0.7, u)), rb: (u) => mix(Rs * 0.72, sl.R, smoothstep(0.2, 0.7, u)), kind: 'sheath', rings: 60, open: 1 }));
    const head = new Path([P(-1.6, 0.25, 30), P(-0.5, 0.05, 6), P(-0.08, 0), P(0.03, 0)], { up: pn });
    ctx.tube(m, head, { ra: () => 0.36, rb: () => 0.36, kind: 'tendon', cap: true });      // FOUNDER NOTE 1: a cord (it swelled to half the stem's radius: a smooth dark tapered rod across the rope on the plate)
    Object.assign(m, { path: slips[2].path, anchors: [P(0.5, 0, 1), slips[3].path.at(0.8).p, slips[1].path.at(0.8).p, P(0.2, 0, 1), slips[4].path.at(0.9).p], plateAnchor: P(0.42, 0.06, 1), center: P(0.55, 0), view: pn, dist: 56, R: L * 0.45 });
  },

  // The harp (shell commands). Straight parallel strings, taut, evenly spaced, their lengths graded
  // inside a dark three-sided frame. It stands at the edge of the space, never in the middle.
  shell(m, ctx) {
    const A = PLAN.shell, n = m.fam.skills.length, g = grow(n, A), s = A.s;
    const e = V3.norm(V3.reject(A.e, s)), pn = V3.cross(e, s);
    const units = unitsOf(m.fam);
    // PASS3 (T3): the harp was a row of strings. With enough strands every string is a taut cable: its strands laid glass
    // to glass with a slow twist, collars along it. Fewer and heavier strings at a wider pitch, so the row is as broad as
    // it was; straight, parallel, evenly spaced, in the same place. A sparse harp is strung as before.
    const cab = n >= 90, trnd = rng(241);
    const NS = cab ? clamp(Math.round(Math.sqrt(n) * 1.25), 12, 18) : clamp(Math.round(Math.sqrt(Math.max(n, 1)) * 2.2), 9, 26), courses = n > 900 ? 3 : n > 260 ? 2 : 1;
    const pitch = clamp(56 * g / NS, 2.0, cab ? 5.8 : 3.6), Wd = pitch * (NS - 1), Lmax = A.Lmax * g, Lmin = A.Lmin * g;
    const lists = chunk(units, NS * courses);
    // string k: foot on the soundboard (rising a little), head on the neck (falling steeply)
    const foot = (t) => at3(A.base, e, (t - 0.5) * Wd, s, 5 * t * g);
    const len = (t) => mix(Lmax, Lmin, Math.pow(t, 0.85));
    const fills = units.length < NS ? (() => { const o = []; for (let i = 0; i < NS; i++) o.push(i); const mid = (NS - 1) / 2; return o.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)); })() : null;
    for (let c = 0; c < courses; c++) for (let k = 0; k < NS; k++) {
      const slot = fills ? fills.indexOf(k) : k, list = fills ? (slot < units.length ? [units[slot]] : []) : lists[c * NS + k];
      const t = NS > 1 ? k / (NS - 1) : 0.5, a = V3.addS(foot(t), pn, (c - (courses - 1) / 2) * 2.6), Ls = len(t);
      const tight = cab && list.length >= 5, pk = tight ? packCable(list) : packUnits(list), sc = Math.min(1, (tight ? 1.5 : 0.92) / Math.max(pk.R, 1e-3));
      const turns = tight ? clamp(Ls / 30, 1.5, 3.5) * (k % 2 ? 1 : -1) : 0, comp = tight ? 3 / (2 + Math.cos(TAU * Math.abs(turns) / (CPN - 3))) : 1, tie0 = m.fibers.length;
      list.forEach((unit, i) => {
        const o = pk.pts[i], [r2, a2] = pol(o);
        ctx.unit(unit, m, (u) => { const b = a2 + TAU * turns * u; return at3(a, s, Ls * u, e, Math.cos(b) * r2 * sc * comp, pn, Math.sin(b) * r2 * sc * comp); }, { shade: tight ? cableShade(r2, pk.R) : shadeOf(r2, pk.R, 1, 1), scale: sc, nrm: pn });
      });
      if (tight) ctx.ties(m.fibers.slice(tie0), trnd, { every: 15, u0: 0.03, u1: 0.97 });
      const p = new Path([V3.addS(a, s, -0.5), V3.addS(a, s, Ls * 0.5), V3.addS(a, s, Ls + 0.5)], { up: pn });
      if (!tight) ctx.tube(m, p, { ra: () => 0.8, rb: () => 0.8, kind: 'sheath', rings: 12, lane: !list.length });   // a string not strung yet is a dashed lane
    }
    // the frame: soundboard, neck, and the pillar on the long side
    const f0 = V3.addS(foot(0), s, -1.2), f1 = V3.addS(foot(1), s, -1.2), h0 = V3.addS(foot(0), s, Lmax + 1.2), h1 = V3.addS(foot(1), s, Lmin + 1.2);
    const bar = (a, b, r0, r1, bow) => { const mid = V3.addS(V3.lerp(a, b, 0.5), bow[0], bow[1]); const p = new Path([V3.lerp(a, b, -0.12), a, mid, b, V3.lerp(a, b, 1.12)], { up: pn }); ctx.tube(m, p, { ra: (u) => mix(r0, r1, u), rb: (u) => mix(r0, r1, u), kind: 'tendon', rings: 30, cap: true }); };
    bar(f0, f1, 1.0, 0.7, [s, -1.5]); bar(h0, h1, 0.8, 0.6, [s, 3.5 * g]); bar(V3.addS(f0, e, -2.6), V3.addS(h0, e, -2.6), 0.9, 0.7, [e, -2.2 * g]);
    const axis = new Path([foot(0.4), V3.addS(foot(0.4), s, len(0.4) * 0.5), V3.addS(foot(0.4), s, len(0.4))], { up: pn });
    const on = (t, v) => at3(foot(t), s, len(t) * v, pn, 0.8);
    Object.assign(m, { path: axis, anchors: [on(0.3, 0.55), on(0.6, 0.5), on(0.1, 0.7), on(0.8, 0.5), on(0.45, 0.25)], plateAnchor: on(0.25, 0.72), center: at3(A.base, s, Lmax * 0.45), view: pn, dist: 70, R: Lmax * 0.5 });
  },

  // The strata (files). Flat straight layers, stacked like pages or sediment, with ragged ends.
  files(m, ctx) {
    const A = PLAN.files, n = m.fam.skills.length, g = grow(n, A), e = A.e;
    const up = V3.norm(V3.reject(A.up, e)), wv = V3.cross(e, up);        // wv: across each layer, toward the back
    const units = unitsOf(m.fam), S = clamp(Math.round(Math.sqrt(Math.max(n, 1)) * 1.1), 6, 10);
    const pitch = A.pitch * g, depth = A.depth * g, lists = chunk(units, S), rnd = rng(31);
    for (let j = 0; j < S; j++) {
      const Lj = A.L * g * (0.80 + 0.2 * rnd()), sx = (rnd() - 0.5) * 7 * g, sz = (rnd() - 0.5) * 2.4;
      const c = at3(A.c, up, (j - (S - 1) / 2) * pitch, e, sx, wv, sz), list = units.length < S ? (units[j] ? [units[j]] : []) : lists[j];
      const k = list.length, perRow = Math.max(6, Math.floor(depth / 0.6)), rows = Math.max(1, Math.ceil(k / perRow)), per = Math.ceil(k / rows) || 1, live = g > 1.25, ph = rnd() * 1.2;
      const sc = clamp((pitch * 0.72) / (rows * 0.6), 0.45, 1), sp = Math.min(0.66, depth / per);
      // PASS3 (T3): on a full body a stratum was thin straw: single strands 0.66 apart that wandered each its own way. It is
      // now two to four flat ribbon cables side by side: in each, the strands lie glass to glass in one or two rows, ride one
      // wave and one slow twist together (so the ribbon has a body and catches the light as one), carry flat clamps, and
      // fray open only toward the ragged ends. The layers, their pitch, their lengths and their place are what they were.
      if (live && k >= 5) {
        const rr2 = rng(37 + j), nR = clamp(Math.round(k / 9), 1, 4), parts = chunk(list, nR).filter((l) => l.length), gapR = 1.25;
        const rib = parts.map((l) => { const two = l.length > 11, wd = l.map((un) => 2 * tightR(un) * sc), per2 = two ? Math.ceil(l.length / 2) : l.length; let W = 0; for (let q = 0; q < per2; q++) W += wd[q]; return { l, two, wd, per2, W, f1: rr2() * TAU, f2: rr2() * TAU, own: 0.95 + 0.5 * rr2() }; });
        const Wt = rib.reduce((a, r) => a + r.W, 0) + gapR * (rib.length - 1); let x0 = -Wt / 2;
        for (const r of rib) {
          const tie0 = m.fibers.length, Xr = x0 + r.W / 2; x0 += r.W + gapR; let cx = -r.W / 2;
          r.l.forEach((unit, i) => {
            const row = r.two && i >= r.per2 ? 1 : 0, q = row ? i - r.per2 : i; if (q === 0) cx = -r.W / 2 + (row ? r.wd[0] * 0.5 : 0);
            const xl0 = cx + r.wd[i] / 2, yl0 = r.two ? (row - 0.5) * r.wd[i] * 0.9 : 0, fi = rr2() * TAU; cx += r.wd[i];
            ctx.unit(unit, m, (u) => {
              const s = u - 0.5, fr = Math.pow(Math.abs(2 * s), 3), tw = 0.2 * Math.sin(Math.PI * 1.3 * s + ph) + 0.32 * Math.sin(Math.PI * 0.9 * s + r.f2);
              const xl = xl0 * (1 + 0.55 * fr) + 0.7 * fr * Math.sin(fi), yl = yl0 * (1 + 2.2 * fr) + 0.6 * fr * Math.cos(fi * 1.7);
              const lift = 0.22 * pitch * Math.cos(TAU * 0.85 * s + 0.5 + 0.25 * j) + 0.15 * pitch * Math.sin(TAU * 0.6 * s + r.f1);
              return at3(c, e, s * Lj, wv, Xr + xl * Math.cos(tw) - yl * Math.sin(tw), up, lift + xl * Math.sin(tw) + yl * Math.cos(tw));
            }, { shade: r.own * (0.9 + 0.2 * rr2()), scale: sc, nrm: up });
          });
          // P3R: the ribbons carry no clamps. A ribbon is broad toward the back of its layer, so from where the rail looks at the
          // strata (93 s, 100 s) any band round it, oval or squared, sleeve or strap, is an arc standing in the gap between two
          // layers: it reads as a loose piece, never as a part of the cable (tried: squared bands 1.1 x the ribbon, straps only).
          // (ctx.ties keeps its `flat` option and the renderer its squared section, t.sq; nothing calls them now.)
        }
      } else
      list.forEach((unit, i) => {
        const row = i % rows, q = Math.floor(i / rows), x = (q - (per - 1) / 2) * sp, y = (row - (rows - 1) / 2) * 0.6 * sc;
        if (!live) { ctx.unit(unit, m, (u) => at3(c, e, (u - 0.5) * Lj, wv, x, up, y), { shade: row === rows - 1 ? 1 : 0.62, scale: sc, nrm: up }); return; }
        // REPAIR (R5): on a full body a stratum is a ribbon of glass fiber, not a plate: it sags and lifts along its length,
        // turns a little about its own axis, its strands wander and part, and it frays open toward both ends. The flat
        // glass slab that sheathed each one is not drawn. Layers keep clear of each other (the wave is under a quarter of
        // the pitch and neighbours ride nearly the same wave).
        const f1 = rnd() * TAU, f2 = rnd() * TAU, own = 0.95 + 0.5 * rnd();      // CABLES: the strata were dark straw; their strands carry the light the other forms do
        ctx.unit(unit, m, (u) => {
          const s = u - 0.5, fr = Math.pow(Math.abs(2 * s), 3), tw = 0.2 * Math.sin(Math.PI * 1.3 * s + ph);
          const xx = x * (1 + 0.4 * fr) + 0.4 * Math.sin(u * 7.3 + f1), yy = y * (1 + 2.2 * fr) + 0.22 * pitch * Math.cos(TAU * 0.85 * s + 0.5 + 0.25 * j) + 0.3 * Math.sin(u * 9.1 + f2) + pitch * 0.28 * fr * Math.sin(f1 + 2 * f2);
          return at3(c, e, s * Lj, wv, xx * Math.cos(tw) - yy * Math.sin(tw), up, xx * Math.sin(tw) + yy * Math.cos(tw));
        }, { shade: (row === rows - 1 ? 1 : 0.8) * own, scale: sc, nrm: up });
      });
      const p = new Path([V3.addS(c, e, -Lj * 0.5 - 0.6), c, V3.addS(c, e, Lj * 0.5 + 0.6)], { up });
      if (live) { /* no slab */ }
      else if (n >= SPARSE) ctx.tube(m, p, { ra: () => 1.15, rb: () => depth * 0.5 + 0.6, kind: 'sheath', rings: 14 });
      else for (let q = 0; q < 4; q++) { const x = (q - 1.5) * depth * 0.27; ctx.ghost(m, (u) => at3(c, e, (u - 0.5) * Lj, wv, x), 0.46, 6); }
    }
    const axis = new Path([V3.addS(A.c, e, -A.L * g * 0.5), A.c, V3.addS(A.c, e, A.L * g * 0.5)], { up });
    const on = (x, j) => at3(A.c, e, x * A.L * g, up, j * pitch, wv, -depth * 0.5);
    Object.assign(m, { path: axis, anchors: [on(0.2, 1), on(-0.25, -1), on(0, (S - 1) / 2), on(0.36, 0), on(-0.38, 2)], plateAnchor: on(-0.3, (S - 1) / 2), center: A.c, view: V3.norm(V3.add(V3.scale(wv, -1), V3.scale(up, 0.45))), dist: 56, R: A.L * g * 0.5 });
  },

  // The quill (mail). One curved stem with a bare base; fibers angle off both sides, a feather.
  mail(m, ctx) {
    const A = PLAN.mail, n = m.fam.skills.length, g = grow(n, A);
    const ax = V3.norm(V3.sub(A.tip, A.base)), pn = V3.norm(V3.reject(A.pn, ax)), sd = V3.cross(pn, ax), D = V3.dist(A.base, A.tip) * g;
    const B = (t, bow = 0) => at3(A.base, ax, t * D, sd, bow * D, pn, 0);
    const path = new Path([B(0.16, 0), B(0.38, 0.045), B(0.62, 0.06), B(0.84, 0.035), B(1.0, -0.02)], { up: pn });
    const units = unitsOf(m.fam), k = units.length, rowMax = Math.round(64 * g), rows = Math.max(1, Math.ceil(k / rowMax)), nq = Math.ceil(k / rows) || 1;
    const sc = clamp(rowMax / Math.max(nq, 1) * 1.5, 0.55, 1);
    const Wd = (v, side) => (side > 0 ? 9.6 : 6.6) * g * Math.pow(Math.sin(Math.PI * clamp(0.06 + 0.88 * v, 0, 1)), 0.62);
    const barb = (u, v, side, lift) => {
      const kk = 1 - smoothstep(-0.05, 1.05, u), fr = path.at(clamp(v - 0.10 + 0.30 * kk, 0, 1));
      return off2(fr, lift, side * (0.22 + Wd(v, side) * Math.pow(kk, 2.0)));
    };
    units.forEach((unit, j) => {
      const row = j % rows, q = Math.floor(j / rows), v = mix(0.06, 0.9, (q + 0.5) / nq), side = q % 2 ? 1 : -1, lo = (row - (rows - 1) / 2) * 0.8 * sc + side * 0.1;
      // FIX V10: the barbs had no shared spine: each met the stem at an angle and stopped, so the form read as loose curls.
      // Now every barb sweeps into the stem and runs along it for its last third (BARB), so the roots of all of them
      // lie together and draw the spine themselves; the dark stem under them is a little stouter.
      ctx.unit(unit, m, (u) => barb(u, v, side, lo + 0.3), { shade: row === rows - 1 ? 1 : 0.6, scale: sc, nrm: pn, taper: (u) => mix(0.7, 1, smoothstep(0, 0.4, u)) });
    });
    if (n < SPARSE) for (let q = 0; q < 22; q++) {
      const v = mix(0.06, 0.9, (q + 0.5) / 22), side = q % 2 ? 1 : -1;
      ctx.ghost(m, (u) => barb(u, v, side, 0.3), 0.42, 10);
    }
    for (const side of [-1, 1]) ctx.tube(m, path, { ra: (u) => 0.45 + Wd(u * 0.92 + 0.04, side) * 0.52, rb: () => 1.5, kind: 'sheath', swap: true, rings: 50, shift: (u) => side * (0.2 + Wd(u * 0.92 + 0.04, side) * 0.5) });
    const quill = new Path([B(-0.16, -0.03), B(0, -0.012), B(0.16, 0), B(0.5, 0.055), B(0.84, 0.035), B(1.03, -0.03)], { up: pn });
    ctx.tube(m, quill, { ra: (u) => mix(0.80, 0.22, u), rb: (u) => mix(0.80, 0.22, u), kind: 'tendon', cap: true, rings: 50 });
    Object.assign(m, { path, anchors: [path.at(0.45).p, path.at(0.7).p, path.at(0.2).p, B(0.02, -0.012), path.at(0.9).p], plateAnchor: path.at(0.3).p, center: path.at(0.5).p, view: pn, dist: 54, R: D * 0.45 });
  },
};

// Any family id the viewer has never heard of still gets a plain, neutral bundle of its own.
function archUnknown(m, ctx, slot) {
  const x = -150 + slot * 16;
  const path = new Path([[x, -74, 150], [x + 5, -60, 142], [x + 14, -50, 128]], { up: [0, 0, 1] });
  const fas = m.fam.fascicles.map((f) => ({ f, pk: packUnits(f.units) }));
  const lay = packDiscs(fas.map((x2) => x2.pk.R + FGAP), { relax: 24 }), RM = fas.length ? lay.R : 0;
  const sc = Math.min(1, 5 / Math.max(RM, 1e-3));
  fas.forEach((f, k) => f.f.units.forEach((unit, i) => {
    const x2 = (lay.pts[k].x + f.pk.pts[i].x) * sc, y2 = (lay.pts[k].y + f.pk.pts[i].y) * sc;
    ctx.unit(unit, m, (u) => off2(path.at(u), x2, y2), { shade: 0.9, scale: sc });
  }));
  const R = Math.max(RM * sc + 0.6, 1.6);
  ctx.tube(m, path, { ra: () => R, rb: () => R, kind: 'sheath' });
  Object.assign(m, { path, anchors: [path.at(0.5).p], plateAnchor: path.at(0.5).p, center: path.at(0.5).p, view: V3.norm([0, 0.2, 1]), dist: 30, R });
}

// ---------------------------------------------------------------- scaffolding: architecture, far away
// FOUNDER NOTE 1 (10 Nov, "can still see some rounded 3d blobs in the back"). The far architecture was fourteen fat smooth
// tubes with a soft rim. It is now machined structure, thinner and farther:
//   conduits  half the radius they had, and the two that stood nearest pushed back. Jointed every 2.6 radii with a
//             flange or a collar that breaks the round outline (real geometry), and between the joints a ribbed, fluted
//             or plated length with seams and panel lines (the scaffolding shader, fixed to the conduit).
//   pipes     two thin pipes strapped along most conduits, standing off the surface.
//   cables    thin spans hung between far points, high over the forms and low under them.
// Every conduit runs on in a straight line well past both of its ends, so no end is ever in view: it leaves the frame or
// dissolves in the air. Still architecture, never data: no light of its own, no family colour, darker than any fiber.
export const ARCHITECTURE = [
  // conduits: long sweeping lines
  { r: 13, k: [[-620, 60, -330], [-330, 20, -300], [-40, 50, -330], [260, 130, -300], [600, 200, -360]] },      // the great main behind everything
  { r: 7.5, k: [[-520, 260, -120], [-260, 190, -210], [10, 215, -250], [270, 300, -190], [520, 420, -60]] },   // high over the far bank
  { r: 6, k: [[-460, -170, -40], [-300, -120, -150], [-120, -128, -230], [90, -160, -260], [330, -230, -200]] },  // low, under the far bank
  { r: 6, k: [[-320, 190, -220], [-160, 96, -250], [10, 40, -270], [180, 0, -250], [350, -60, -190]] },         // falling left to right behind the far bank (was nearer)
  { r: 4.5, k: [[100, -250, -200], [140, -80, -214], [176, 62, -232], [200, 240, -256]] },                     // a leaning riser well behind the fan and the rope (was nearer)
  { r: 9, k: [[330, -260, -330], [318, -60, -290], [336, 150, -300], [300, 420, -350]] },                     // a trunk far right, leaning
  { r: 5.5, k: [[-360, -260, -250], [-338, -40, -272], [-372, 200, -246], [-330, 460, -300]] },               // a slimmer one far left
  { r: 6.5, k: [[-240, -250, 330], [-40, -150, 290], [150, -128, 250], [330, -160, 270], [540, -100, 350]] },  // low in front, under the near bank
  { r: 4.5, k: [[450, 20, 280], [370, 150, 170], [330, 290, 40], [350, 470, -90]] },                          // rising at the far right
  { r: 5, k: [[-480, 150, 250], [-410, 60, 120], [-400, -60, 10], [-440, -220, -90]] },                       // falling at the far left
  // arches: each one stands alone, a different size, a different way round
  { r: 6.5, k: [[-470, -300, -150], [-380, 40, -190], [-210, 250, -215], [10, 300, -225], [200, 200, -205], [310, -40, -170], [350, -300, -140]] },
  { r: 4.5, k: [[230, -300, -80], [262, -40, -84], [330, 150, -70], [420, 200, -30], [510, 110, 20], [560, -110, 40], [585, -300, 50]] },   // the river leaves under this one
  { r: 5, k: [[-570, -300, 120], [-520, -30, 150], [-430, 150, 170], [-320, 200, 185], [-250, 110, 200], [-225, -80, 205], [-215, -300, 210]] },
  { r: 6, k: [[-360, -320, 350], [-270, -70, 362], [-130, 52, 372], [40, 84, 376], [200, 44, 368], [300, -80, 352], [350, -320, 340]] },   // a low arch across the front, under the plate's line of sight
];
// ART (A5, founder note 1, second look): thinner and farther again. Every conduit is 0.55 of the radius it had, and
// everything behind the forms stands a third farther back and 40 more (the harp, the fan and the delta moved back in this
// pass; the pipes that crossed close behind the harp are now more than 150 behind it). Nothing here is near the rail.
const ARCH_R = 0.55, archZ = (z) => (z < 0 ? z * 1.3 - 40 : z);
function architecture(ctx) {
  const rnd = rng(417);
  ARCHITECTURE.forEach((a, ai) => {
    const path = new Path(a.k.map((q) => [q[0], q[1], archZ(q[2])]), { up: [0, 0, 1], samples: 220 }), L = path.length, R = a.r * ARCH_R, SEG = 2.6 * R, seed = (ai * 0.6180339 + 0.137) % 1;
    const EXT = 420;                                                            // how far it runs on, straight, past each end
    const ring = (sd, rad) => { const fr = path.at(sd / L); return { p: fr.p, n: fr.n, b: fr.b, t: fr.t, ra: rad, rb: rad, s: sd }; };
    const rings = [];
    for (let k = Math.ceil(-EXT / SEG); k * SEG <= L + EXT; k++) {
      // the joint at k * SEG (the shader draws its seam at the same place): now and then a broad flange, otherwise a slim collar
      const sd = k * SEG, big = rnd() < 0.34, rise = big ? 0.20 * R : 0.06 * R, hw = big ? 0.10 * R : 0.07 * R, e = 0.015 * R;
      rings.push(ring(sd - hw - e, R), ring(sd - hw, R + rise), ring(sd + hw, R + rise), ring(sd + hw + e, R));
      // the bolt ring of a flange stands a little proud again on one side
      if (big) rings.push(ring(sd + hw + 0.30 * R, R), ring(sd + hw + 0.31 * R, R * 1.07), ring(sd + hw + 0.40 * R, R * 1.07), ring(sd + hw + 0.41 * R, R));
      rings.push(ring(sd + SEG * 0.5, R));
    }
    ctx.raw({ muscle: null, kind: 'pillar', rings, closed: false, arch: { r: R, seed } });
    // thin pipes strapped along it, standing a little off the surface
    const pipes = ai % 4 === 3 ? 0 : 2;
    for (let c = 0; c < pipes; c++) {
      const ang = TAU * (seed * 3.1 + c * 0.37 + 0.11), pr = Math.max(0.045 * R, 0.28), off = R * 1.20 + pr, pr2 = [];
      for (let sd = -EXT; sd <= L + EXT; sd += SEG * 0.5) {
        const fr = path.at(sd / L), q = V3.addS(V3.addS(fr.p, fr.n, Math.cos(ang) * off), fr.b, Math.sin(ang) * off);
        pr2.push({ p: q, n: fr.n, b: fr.b, t: fr.t, ra: pr, rb: pr, s: sd });
      }
      ctx.raw({ muscle: null, kind: 'pillar', rings: pr2, closed: false, radial: 6, arch: { r: pr, seed: (seed + 0.31 * (c + 1)) % 1 } });
    }
  });
  // cables: thin spans hung between far points, sagging. High over the forms and low under them, never through them.
  for (let c = 0; c < 14; c++) {
    const high = c % 3 !== 2, y0 = high ? 150 + rnd() * 260 : -140 - rnd() * 160, y1 = high ? 150 + rnd() * 260 : -140 - rnd() * 160;
    const z0 = -270 - rnd() * 260, z1 = -270 - rnd() * 260, x0 = -760 - rnd() * 160, x1 = 760 + rnd() * 160, sag = 40 + rnd() * 90;
    const a = [x0, y0, z0], b = [x1, y1, z1], q = (f) => { const m = V3.lerp(a, b, f); return [m[0], m[1] - sag * 4 * f * (1 - f), m[2]]; };
    const path = new Path([q(0), q(0.2), q(0.4), q(0.6), q(0.8), q(1)], { up: [0, 0, 1], samples: 120 }), r = 0.4 + rnd() * 0.5, rings = [];
    for (let i = 0; i <= 90; i++) { const fr = path.at(i / 90); rings.push({ p: fr.p, n: fr.n, b: fr.b, t: fr.t, ra: r, rb: r, s: (i / 90) * path.length }); }
    ctx.raw({ muscle: null, kind: 'pillar', rings, closed: false, radial: 6, arch: { r, seed: rnd() } });
  }
}

// REPAIR (R1/R2): the far trunks. The space behind, under and beside the forms was empty black, so the forms stood apart
// as specimens. Great trunks of thin dark cable now sweep through it at far depth and cross each other: each one a
// bundle of a few dozen cables laid round each other, bound with a machined collar every so often, running out of frame
// or into the haze at both ends. They are scaffolding like the conduits (kind `pillar`: dark cool metal, no light of its
// own, no family colour, no band, never counted, never picked) and they keep well clear of every form and of the rail:
// behind z = -180, under y = -170, or far out to the sides.
export const TRUNKS = [
  { n: 26, R: 12, k: [[-700, -200, -260], [-380, -60, -300], [-60, 40, -270], [240, 150, -300], [620, 330, -380]] },      // behind, rising left to right
  { n: 22, R: 10, k: [[-650, 330, -330], [-300, 200, -380], [40, 60, -360], [330, -80, -320], [700, -240, -300]] },      // behind, falling left to right: the two cross
  { n: 24, R: 11, k: [[-520, -230, 300], [-260, -200, 120], [-20, -190, -40], [220, -210, -180], [520, -260, -330]] },   // low, under the forms, front left to back right
  { n: 20, R: 9, k: [[560, -200, 260], [300, -180, 90], [60, -215, -70], [-220, -235, -200], [-560, -300, -300]] },      // low, the other way: they cross under the river
  { n: 22, R: 10, k: [[260, -300, -240], [330, -60, -200], [420, 170, -230], [470, 420, -300]] },                        // rising behind the far end of the river
  { n: 20, R: 9, k: [[-420, -40, -200], [-300, 210, -260], [-80, 330, -300], [160, 300, -280], [330, 120, -250], [400, -120, -210]] },   // a high arc over the far bank
  { n: 18, R: 9, k: [[-480, -320, -140], [-430, -60, -180], [-460, 200, -150], [-400, 460, -220]] },                     // far left, leaning
  { n: 18, R: 8, k: [[640, -60, 120], [480, 40, -60], [380, 200, -190], [200, 380, -330]] },                             // far right, climbing away
];
function trunks(ctx) {
  const rnd = rng(733);
  TRUNKS.forEach((tr, ti) => {
    // FOUNDER NOTE 1 (second check: "large and conspicuous"): half as thick, each cable thinner, and farther off: the ones
    // behind stand 90 farther back, the low ones 70 lower, so they are lines in the haze, not bodies.
    const far = (q) => [q[0] * 1.08, q[1] < -150 ? q[1] - 70 : q[1], q[2] < -100 ? q[2] - 90 : q[2]];
    tr = { n: tr.n, R: tr.R * 0.5, k: tr.k.map(far) };
    const path = new Path(tr.k, { up: [0, 0, 1], samples: 200 }), L = path.length, EXT = 320, STEP = 15, turns = L / 620, hand = ti % 2 ? 1 : -1;
    const swell = (sd) => 1 + 0.22 * Math.sin(sd * 0.011 + ti * 1.7) + 0.10 * Math.sin(sd * 0.031 + ti);
    for (let c = 0; c < tr.n; c++) {
      const rho0 = tr.R * Math.sqrt((c + 0.5) / tr.n), phi0 = c * 2.39996 + ti, r = 0.32 + rnd() * 0.4, wob = 0.5 + rnd(), ph = rnd() * TAU, rings = [];
      for (let sd = -EXT; sd <= L + EXT; sd += STEP) {
        const fr = path.at(sd / L), a = phi0 + hand * TAU * turns * (sd / L) * (0.7 + 0.6 * rho0 / tr.R), rho = rho0 * swell(sd) * (1 + 0.16 * Math.sin(sd * 0.02 * wob + ph));
        rings.push({ p: V3.addS(V3.addS(fr.p, fr.n, Math.cos(a) * rho), fr.b, Math.sin(a) * rho), n: fr.n, b: fr.b, t: fr.t, ra: r, rb: r, s: sd });
      }
      ctx.raw({ muscle: null, kind: 'pillar', rings, closed: false, radial: 5, arch: { r, seed: rnd() } });
    }
    // the collars that bind it: short machined bands, never long enough to read as a body
    for (let sd = -EXT + 60 + rnd() * 80; sd < L + EXT; sd += 130 + rnd() * 150) {
      const Rc = tr.R * swell(sd) * 1.12 + 0.8, hw = 0.7 + rnd() * 0.8, rings = [];      // (thin hoops: a broad collar on a trunk read as a smooth drum from the plate)
      for (const [o, k] of [[-hw - 0.4, 0.94], [-hw, 1], [-hw * 0.34, 1], [-hw * 0.3, 1.05], [hw * 0.3, 1.05], [hw * 0.34, 1], [hw, 1], [hw + 0.4, 0.94]]) { const fr = path.at((sd + o) / L); rings.push({ p: fr.p, n: fr.n, b: fr.b, t: fr.t, ra: Rc * k, rb: Rc * k, s: sd + o }); }
      ctx.raw({ muscle: null, kind: 'pillar', rings, closed: false, radial: 18, arch: { r: Rc, seed: rnd() } });
    }
  });
}

// Dust: xyz and a seed for each mote. In the shafts, along the river, and thin everywhere else.
function dust() {
  const N = 2600, r = rng(99), d = new Float32Array(N * 4), S = PLAN.shafts, K = PLAN.research.knots;
  for (let i = 0; i < N; i++) {
    const t = r(); let x, y, z;
    if (t < 0.42) { const s = S[i % S.length], rad = 2 + Math.pow(r(), 0.7) * 26 * s[2] * 0.5, a = r() * TAU; x = s[0] + Math.cos(a) * rad; z = s[1] + Math.sin(a) * rad; y = -120 + r() * 300; }
    else if (t < 0.80) { const k = r() * (K.length - 1), i0 = Math.min(Math.floor(k), K.length - 2), p = V3.lerp(K[i0], K[i0 + 1], k - i0), rad = 6 + r() * 50, a = r() * TAU; x = p[0] + Math.cos(a) * rad; z = p[2] + Math.sin(a) * rad * 1.3; y = p[1] - 25 + r() * 70; }
    else { x = -330 + r() * 660; y = -110 + r() * 260; z = -260 + r() * 500; }
    d.set([x, y, z, r()], i * 4);
  }
  return d;
}

// ---------------------------------------------------------------- ART: the shadow inside a bundle
// A bundle of glass fiber is not a sheet of light: the strands on the side the light comes from are lit, the ones behind
// them stand in their shadow, and the heart of the bundle is dark. That is baked here once per anatomy: every fiber is
// dropped into a coarse grid (how much glass stands in each cell), and from each control point of each fiber a short
// line is walked toward the key light, across the fiber (never along it, so a fiber does not shadow itself). What comes
// back is 0 on the lit skin and near 1 deep inside or behind. The shaders dim the glass and the resting light by it,
// every tier alike, so formed < practised < proven still holds at any one place in a bundle. It is light, not data.
const KEY_LIGHT = V3.norm([0.16, 0.84, 0.52]);
function bakeShadow(cp, fibers) {
  const n = fibers.length, occ = new Float32Array((n + SPARE_ROWS) * CPN);
  if (!n) return occ;
  let total = 0; for (const f of fibers) total += f.len;
  const C = 1.5, step = Math.max(1.1, total / 260000), grid = new Map();
  const key = (x, y, z) => (Math.floor(x / C) + 512) + (Math.floor(y / C) + 512) * 1024 + (Math.floor(z / C) + 512) * 1048576;
  for (const f of fibers) {
    const off = f.index * CPN * 4, m = Math.max(6, Math.ceil(f.len / step)), w = (2 * f.radius * (f.len / m)) / (C * C);
    for (let k = 0; k < m; k++) { const p = bspline(cp, off, CPN, (k + 0.5) / m).p, q = key(p[0], p[1], p[2]); grid.set(q, (grid.get(q) || 0) + w); }
  }
  for (const f of fibers) {
    const off = f.index * CPN * 4, self = (2 * f.radius / C) * 1.5;
    for (let i = 0; i < CPN; i++) {
      const fr = bspline(cp, off, CPN, clamp((i - 1) / (CPN - 3), 0, 1)), p = fr.p;
      let d = V3.reject(KEY_LIGHT, fr.t); const dl = V3.len(d);
      if (dl < 0.25) { occ[f.index * CPN + i] = 0.35; continue; }
      d = V3.scale(d, C / dl);
      let tau = 0;
      for (let k = 1; k <= 9 && tau < 4; k++) tau += Math.max(0, (grid.get(key(p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k)) || 0) - (k === 1 ? self : 0));
      occ[f.index * CPN + i] = 1 - Math.exp(-0.85 * tau);
    }
  }
  return occ;
}

// ---------------------------------------------------------------- build
export function buildAnatomy(model) {
  const n = model.skills.length;
  const cp = new Float32Array((n + SPARE_ROWS) * CPN * 4);
  const fibers = [], tubes = [], muscles = [];
  const ctx = {
    fiber(skill, muscle, fn, { shade = 1, scale = 1, closed = false, taper = null } = {}) {
      const index = fibers.length, off = index * CPN * 4;
      for (let i = 0; i < CPN; i++) {
        const u = (i - 1) / (CPN - 3), p = fn(u);
        cp[off + i * 4] = p[0]; cp[off + i * 4 + 1] = p[1]; cp[off + i * 4 + 2] = p[2];
        cp[off + i * 4 + 3] = taper ? taper(clamp(u, 0, 1)) : 1;
      }
      let len = 0, prev = bspline(cp, off, CPN, 0).p;
      for (let k = 1; k <= 48; k++) { const q = bspline(cp, off, CPN, k / 48).p; len += V3.dist(q, prev); prev = q; }
      const f = { index, skill, muscle, len, radius: fiberRadius(skill) * scale, shade, closed };
      skill.fiber = index; fibers.push(f); muscle.fibers.push(f);
      return f;
    },
    // One skill is one fiber. The versions of one learned request (same_shape) share a centre line
    // and wind round it together: a pair, or a small strand.
    unit(unit, muscle, fn, opts = {}) {
      if (unit.length === 1) { ctx.fiber(unit[0], muscle, fn, opts); return; }
      const k = unit.length, sc = opts.scale || 1;
      let r = 0; for (const s of unit) r = Math.max(r, fiberRadius(s) * sc);
      let len = 0, prev = fn(0);
      for (let i = 1; i <= 16; i++) { const q = fn(i / 16); len += V3.dist(q, prev); prev = q; }
      const turns = clamp(Math.round(len / 8), 2, Math.floor((CPN - 3) / 5));       // at least five control points a turn
      const comp = 3 / (2 + Math.cos(TAU / ((CPN - 3) / turns)));                   // a B-spline rounds a sampled helix: give the radius back
      const rr = ringOf(k, r) * comp, e = 2e-3;
      const t0 = V3.norm(V3.sub(fn(0.5 + e), fn(0.5 - e))), ref = opts.nrm || V3.perp(t0);
      // FIX V12: the frame the strand winds in is kept with each of its fibers (f.ply), so the close-up of one of them can
      // comb the strand straight over its record (combRows below). Nothing else reads it.
      const frame = (u) => {
        const p = fn(u), t = V3.norm(V3.sub(fn(u + e), fn(u - e)));
        let n1 = V3.reject(ref, t); n1 = V3.len(n1) > 1e-4 ? V3.norm(n1) : V3.perp(t);
        return { p, t, n1, n2: V3.cross(t, n1) };
      };
      const group = [];
      unit.forEach((s, i) => {
        const f = ctx.fiber(s, muscle, (u) => {
          const fr = frame(u), a = TAU * (turns * u + i / k);
          return at3(fr.p, fr.n1, Math.cos(a) * rr, fr.n2, Math.sin(a) * rr);
        }, opts);
        f.ply = { frame, rr, turns, i, k, group }; group.push(f.index);
      });
    },
    // A thin dark sheath along one lane of an empty or nearly empty form: where a fiber will lie.
    // Scaffolding like any sheath (smooth, unlit, no core, never counted); it fades as the form fills.
    ghost(muscle, fn, r = 0.5, rings = 14, closed = false) {
      const R = []; let nrm = null;
      for (let i = 0; i <= rings; i++) {
        const u = i / rings, p = fn(u), e = 2e-3, t = V3.norm(V3.sub(fn(u + e), fn(u - e)));
        nrm = nrm ? V3.reject(nrm, t) : V3.perp(t); nrm = V3.len(nrm) > 1e-5 ? V3.norm(nrm) : V3.perp(t);
        const end = closed ? 1 : Math.sqrt(smoothstep(0, 0.12, u) * smoothstep(1, 0.88, u));
        R.push({ p, n: nrm, b: V3.cross(t, nrm), ra: r * end, rb: r * end });
      }
      tubes.push({ muscle, kind: 'sheath', rings: R, closed, lane: true });
    },
    // A swept elliptical tube: sheaths (the envelope of a form), tendons, the far architecture.
    tube(muscle, path, { ra, rb, kind, rings = 72, u0 = 0, u1 = 1, closed = false, swap = false, cap = false, open = 0, shift = null, lane = false }) {
      const R = [];
      for (let i = 0; i <= rings; i++) {
        const v = i / rings, u = mix(u0, u1, v), fr = path.at(u);
        const end = closed || cap ? 1 : Math.sqrt(smoothstep(0, 0.07, open < 0 ? Math.max(v, 0.1) : v) * smoothstep(1, 0.93, open > 0 ? Math.min(v, 0.9) : v));
        const n = swap ? fr.b : fr.n, b = swap ? fr.n : fr.b;
        R.push({ p: shift ? V3.addS(fr.p, n, shift(u)) : fr.p, n, b, ra: ra(u) * end, rb: rb(u) * end });
      }
      tubes.push({ muscle, kind, rings: R, closed, lane });
    },
    raw: (t) => tubes.push(t),
    // CABLES: the ties of a cable. Thin dark machined hoops clamped round one cable, two or three together, every so often
    // along it: the segment marks of the concept's bundles. Scaffolding like the far architecture (kind `pillar`: dark cool
    // metal, no light of its own, no family colour, never counted, never picked); a hoop is a hair wide, so it hides no record.
    // PASS3 (T1): the ties are sleeves and collars, fitted to the cable. They are laid from the strands as they are really
    // drawn (the centre and the cross-section of the cable are measured on its own splines; the old hoops were laid on the
    // cable's nominal centre line, which the splines cut inside of on every turn, so a hoop hung off its cable like a staple).
    // Two kinds, irregularly spaced: fine rings (one to three, a hair wide: they hide no record) and short machined sleeves
    // with a raised lip at each end (panel lines and seams are drawn in the shader). A sleeve is opaque, so it is never laid
    // over a record: only on a stretch where no strand of the cable carries a band, a notch or a collar.
    // F: the fibers of one cable. offs: for a closed cable whose strands start at different places, each one's start (in turns).
    ties(F, rnd, { every = 34, u0 = 0.05, u1 = 0.95, offs = null, closed = false, flat = false } = {}) {
      const nF = F.length; if (nF < 5) return;
      let len = 0; for (const f of F) len += f.len; len /= nF;
      // where the records lie (the same rule as RECORD in shaders.js: centred on the middle of each fiber)
      let rec = 0;
      for (const f of F) {
        const s = f.skill, nb = s.jobs || 0, nn = s.handed || 0; if (!(nb > 0 || nn > 0)) continue;
        const rad = Math.min(f.radius, 2.2 * R0), pitch = recordPitch(rad, f.len, nb, nn), pn = 0.72 * pitch;
        const span = Math.max(nb - 1, 0) * pitch + (nb > 0 && nn > 0 ? 0.5 * pitch + 0.62 * pn : 0) + Math.max(nn - 1, 0) * pn;
        rec = Math.max(rec, (0.5 * span + 2 * pitch + 2.4 * rad + 0.6) / f.len);
      }
      const at = (u, lim = nF) => {
        const c = [0, 0, 0], P = [], st = Math.max(1, Math.floor(nF / lim)); let nq = 0;
        for (let i = 0; i < nF; i += st) { nq++; let uf = offs ? u - offs[i] : u; if (closed) uf -= Math.floor(uf); const p = bspline(cp, F[i].index * CPN * 4, CPN, uf).p; P.push(p); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
        c[0] /= nq; c[1] /= nq; c[2] /= nq; return { c, P };
      };
      for (let sd = every * (0.15 + 0.8 * rnd()); sd < len; sd += every * (0.42 + 1.25 * rnd() * rnd() + 0.35 * rnd())) {
        const u = sd / len; if (u < u0 || u > u1) continue;
        const e = 2.5e-3, A0 = at(u), t = V3.norm(V3.sub(at(u + e, 6).c, at(u - e, 6).c)), n0 = V3.perp(t), b0 = V3.cross(t, n0);
        // the cross-section: principal axes of the strands about the centre, and how far they reach along each
        let sxx = 0, sxy = 0, syy = 0; const Q = [];
        for (const p of A0.P) { const d = V3.sub(p, A0.c), x = V3.dot(d, n0), y = V3.dot(d, b0); Q.push([x, y]); sxx += x * x; sxy += x * y; syy += y * y; }
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ca = Math.cos(ang), sa = Math.sin(ang);
        let ea = 0, eb = 0, rmax = 0; const qa = [], qb = [];
        Q.forEach(([x, y], i) => { const r = Math.min(F[i].radius, 2.2 * R0); rmax = Math.max(rmax, r); const va = Math.abs(x * ca + y * sa) + r, vb = Math.abs(-x * sa + y * ca) + r; qa.push(va); qb.push(vb); ea = Math.max(ea, va); eb = Math.max(eb, vb); });
        // PASS3 (T1, second sitting): the part was sized on the one strand that stood farthest out and then opened a third
        // of the way to a circle, so on a cable with a loose strand or a flat cross-section it stood off like a hoop and the
        // eye looked through it at its dark inner wall (the bracket). It is now sized on the body of the cable (the reach
        // that nine strands in ten stay inside), opened an eighth toward a circle: it sits in the outer strands, and a
        // strand that wanders runs over it.
        const bigM = Math.max(ea, eb), eaF = mix(ea, bigM, 0.2) + 0.03, ebF = mix(eb, bigM, 0.2) + 0.03;      // (a sleeve is a closed part: it clears every strand)
        if (!flat) { qa.sort((p, q) => p - q); qb.sort((p, q) => p - q); const k9 = Math.min(qa.length - 1, Math.floor(0.9 * qa.length)); ea = Math.min(ea, qa[k9] * 1.04); eb = Math.min(eb, qb[k9] * 1.04); }
        const big = Math.max(ea, eb);
        if (flat) { ea = ea * 1.10 + 0.05; eb = eb * 1.16 + 0.06; }                // a ribbon: a band with a squared section (sq below), so it clears the strands at its corners without standing off its edges (P3R: was an oval 1.3 x 1.45 the ribbon)
        else { ea = mix(ea, big, 0.12) + 0.02; eb = mix(eb, big, 0.12) + 0.02; }
        if (!(Math.min(ea, eb) > (flat ? 0.2 : 0.45)) || big > 9) continue;                       // not a cable here (a tip, or the strands have parted)
        // (second sitting) and a part is clamped only where the strands really lie together: where they fill less than
        // four tenths of the section (a cable about to branch, a loose run) a part would float round them like a hoop
        let fillF = 1; if (!flat) { let ar = 0; Q.forEach((_, i) => { const r = Math.min(F[i].radius, 2.2 * R0); ar += r * r; }); if (ar / (ea * eb) < 0.40) continue; fillF = ar / (eaF * ebF); }
        const n = V3.addS(V3.scale(n0, ca), b0, sa), b = V3.cross(t, n), R = Math.min(ea, eb);
        const env = 4 * Math.round(100 * (closed ? 1 : Math.sin(Math.PI * u)));      // the cable sways (FIBER_VS); its ties go with it
        const piece = (o, hl, prof, seed, radial, add = 0, full = false) => {
          const rings = [], pc = V3.addS(A0.c, t, o), tt = V3.scale(t, hl), A = full && !flat ? eaF : ea, B = full && !flat ? ebF : eb;
          for (const [a, f] of prof) rings.push({ p: V3.addS(pc, t, a * hl), n, b, t: tt, ra: A * f + add, rb: B * f + add, s: a + env });
          tubes.push({ muscle: null, kind: 'pillar', rings, closed: false, radial, sq: flat ? 0.42 : 0, arch: { r: R, seed } });      // seed 2..3: a ring, 3..4: a sleeve (TUBE in shaders.js)
        };
        const hlS = clamp((flat ? 0.3 * Math.max(ea, eb) : R) * (0.30 + 0.34 * rnd()), 0.34, 1.4), pick = rnd(), du = (hlS + 0.3) / len;
        const free = Math.abs(u - 0.5) - du > rec;
        // P3R: a ribbon carries straps only. A sleeve round a ribbon is a wide flat plate; seen from above the layer (the rail
        // at 93 s) it was a pale slat lying across the strata, larger than anything it held.
        if (pick < 0.22 && free && fillF >= 0.45 && !flat) {      // (a sleeve only on a cable that fills it)
          piece(0, hlS, [[-1, 0.965], [-0.985, 1.062], [-0.80, 1.062], [-0.765, 1.012], [0.765, 1.012], [0.80, 1.062], [0.985, 1.062], [1, 0.965]], 3 + rnd() * 0.999, 24, 0.25 * rmax + 0.02, true);      // (a sleeve has a wall: it stands clear of the halo of the strands it holds, so it is dark metal and not a grey film)
          if (rnd() < 0.45) { const hw = 0.035 + 0.03 * rnd(), s = rnd() < 0.5 ? -1 : 1; piece(s * (hlS + 0.16 + 0.2 * rnd() + hw), hw, [[-1, 0.985], [-0.5, 1.026], [0.5, 1.026], [1, 0.985]], 2 + rnd() * 0.999, 20); }
        } else {
          const k = pick > 0.86 ? 1 : rnd() < 0.42 ? 3 : 2, hw = 0.032 + 0.036 * rnd(), gap = 0.20 + 0.34 * rnd();
          for (let q = 0; q < k; q++) piece((q - (k - 1) / 2) * gap, hw * (q === 1 && k === 3 ? 1.5 : 1), [[-1, 0.985], [-0.5, 1.026], [0.5, 1.026], [1, 0.985]], 2 + rnd() * 0.999, 20);
        }
      }
    },
  };

  let unknownSlot = 0;
  for (const fam of model.families) {
    const m = { fam, id: fam.id, fibers: [], empty: fam.skills.length === 0 };
    muscles.push(m);
    if (ARCH[fam.id] && fam.known) ARCH[fam.id](m, ctx); else archUnknown(m, ctx, unknownSlot++);
    // where the proven work is, for the "bundle" framing
    const pr = m.fibers.filter((f) => f.skill.jobs > 0);
    // ART (A2): a cloud of points on the form, for the label layout: where its fibers are (overlay.js keeps labels off them)
    { const cl = [], F = m.fibers, river = m.id === 'research', stepF = Math.max(1, Math.floor(F.length / (river ? 90 : 60))), NU = river ? 26 : 11;      // REPAIR (R5): denser (the forms are larger on screen, and the river crosses the whole plate)
      for (let i = 0; i < F.length; i += stepF) for (let k = 0; k < NU; k++) cl.push(...bspline(cp, F[i].index * CPN * 4, CPN, 0.03 + 0.94 * k / (NU - 1)).p);
      if (!F.length && m.anchors) for (const a of m.anchors) cl.push(...a);
      m.cloud = new Float32Array(cl); m.cloudN = F.length ? NU : 0; }      // cloudN: points to a fiber, in order along it (0: loose points)
    m.provenCenter = pr.length ? V3.scale(pr.reduce((a, f) => V3.add(a, bspline(cp, f.index * CPN * 4, CPN, 0.5).p), [0, 0, 0]), 1 / pr.length) : m.center;
  }
  architecture(ctx);
  trunks(ctx);                                               // REPAIR (R1/R2)

  // Tool nodes: a fixed place per tool (by feed order), strung low along the near side of the river.
  const river = muscles.find((m) => m.id === 'research');
  const toolNodes = model.tools.map((t, i) => {
    const u = 0.30 + 0.36 * (model.tools.length > 1 ? i / (model.tools.length - 1) : 0.5), fr = river ? river.path.at(u) : { p: [i * 10, -40, 60], n: [0, 1, 0], b: [0, 0, 1] };
    return { tool: t, pos: V3.add(V3.addS(V3.addS(fr.p, fr.b, -30 - (i % 2) * 9), fr.n, -6), [0, -14 - (i % 3) * 5, 0]) };
  });

  const muscleById = new Map(muscles.map((m) => [m.id, m]));
  return {
    CPN, cp, fibers, tubes, muscles, toolNodes, count: fibers.length, occ: bakeShadow(cp, fibers),   // ART: occ, the shadow inside a bundle
    shafts: PLAN.shafts, dust: dust(), rail: buildRail(muscleById),
    muscleById,
    point: (index, u) => bspline(cp, index * CPN * 4, CPN, u),
  };
}

// ---------------------------------------------------------------- FIX V12: a strand combed straight for a close-up
// The versions of one request are drawn twisted together, so in the close-up of one of them half of every turn of its
// record passed behind a sibling and its bands could not all be counted. While such a fiber is in focus the strand is
// combed over the stretch that carries the record (first band to last notch, and a little more): the fiber in focus
// runs straight, its siblings lie beside it (above and below as the lens sees it, 3 radii apart) and all of them wind
// back into the strand at both ends. Returns the control points to draw meanwhile, [{ index, cp }], or null when the
// fiber is not part of a strand or carries no record. The anatomy itself is not changed: positions on the fiber at
// u = 0.5 are the same, the record is the same count in the same order, and leaving the close-up puts the rows back.
export function combRows(anat, index, eye, rad) {
  const f = anat.fibers[index], ply = f && f.ply, sk = f && f.skill;
  if (!ply || !sk || sk.jobs + sk.handed <= 0) return null;
  const nb = sk.jobs, nn = sk.handed;                                                                    // rad: the radius the fiber is drawn with
  const pitch = recordPitch(rad, f.len, nb, nn), pn = 0.72 * pitch;      // as in the shader (RECORD)
  const span = Math.max(nb - 1, 0) * pitch + (nb && nn ? 0.5 * pitch + 0.62 * pn : 0) + Math.max(nn - 1, 0) * pn;
  const half = Math.min((0.5 * span + 2.5 * pitch) / f.len, 0.40), blend = Math.min(0.10, 0.47 - half);
  const win = (u) => 1 - smoothstep(half, half + blend, Math.abs(u - 0.5));
  const mid = ply.frame(0.5), a0 = TAU * (ply.turns * 0.5 + ply.i / ply.k);
  // the side the siblings go to: across the fiber as the lens sees it, written in the strand's own frame so it is carried along the curve
  let side = V3.cross(mid.t, V3.sub(eye, mid.p)); side = V3.len(side) > 1e-5 ? V3.norm(side) : mid.n1;
  const sx = V3.dot(side, mid.n1), sy = V3.dot(side, mid.n2);
  const ox = Math.cos(a0) * ply.rr, oy = Math.sin(a0) * ply.rr;                                           // where the fiber in focus stays: its own place at u = 0.5
  const out = []; let slot = 0;
  for (const j of ply.group) {
    const g = anat.fibers[j], gp = g.ply, cp = new Float32Array(CPN * 4), off = j * CPN * 4;
    let tx = ox, ty = oy;
    if (j !== index) { const n = Math.floor(slot / 2) + 1, d = (slot % 2 ? -1 : 1) * n * 3.0 * rad; slot++; tx += sx * d; ty += sy * d; }
    for (let i = 0; i < CPN; i++) {
      const u = (i - 1) / (CPN - 3), fr = ply.frame(u), w = win(u), a = TAU * (gp.turns * u + gp.i / gp.k);
      const q = at3(fr.p, fr.n1, mix(Math.cos(a) * gp.rr, tx, w), fr.n2, mix(Math.sin(a) * gp.rr, ty, w));
      cp[i * 4] = q[0]; cp[i * 4 + 1] = q[1]; cp[i * 4 + 2] = q[2]; cp[i * 4 + 3] = anat.cp[off + i * 4 + 3];
    }
    out.push({ index: j, cp });
  }
  return out;
}

// ---------------------------------------------------------------- REPAIR (R5): neighbours stand back from a close-up
// In a dense form (a rope of 260 fibers) the fiber in focus was one strand among many: neighbours passed before it and
// lay close behind it, and there was no subject. While a fiber is in focus the fibers round the stretch the lens looks at
// are parted like a curtain: those between the lens and the fiber go to the sides (above and below it in the frame),
// those just behind it step back, and all of them run back into their own places beyond the stretch. Returns the control
// points to draw meanwhile, [{ index, cp }] (main.js eases them in and out with the combed rows). The anatomy itself is
// not changed, no record is touched, and leaving the close-up puts every row back. `skip`: rows already combed.
export function partRows(anat, index, eye, skip) {
  const f = anat.fibers[index]; if (!f) return [];
  const mid = anat.point(index, 0.5), dd = V3.dist(eye, mid.p), Ls = clamp(0.8 * dd, 6, 0.42 * f.len), Rs = 0.16 * dd, Rb = 0.15 * dd, reach = Rs + Rb;      // PASS3 (T4): 0.16 / 0.15 (were 0.13 / 0.12): the neighbours crowded the fiber in focus
  const M = 25, ax = []; for (let k = 0; k < M; k++) { const u = clamp(0.5 + ((k / (M - 1)) * 2 - 1) * 1.3 * Ls / f.len, 0, 1), q = anat.point(index, u); ax.push({ p: q.p, t: q.t, s: (u - 0.5) * f.len }); }
  const out = [], cpA = anat.cp;
  for (let j = 0; j < anat.count; j++) {
    if (j === index || (skip && skip.has(j))) continue;
    const off = j * CPN * 4; let hit = false, sum = 0; const mv = new Array(CPN).fill(null);
    for (let i = 0; i < CPN; i++) {
      const x = cpA[off + i * 4], y = cpA[off + i * 4 + 1], z = cpA[off + i * 4 + 2];
      let b = -1, bd = reach * reach * 4; for (let k = 0; k < M; k++) { const a = ax[k].p, d2 = (x - a[0]) * (x - a[0]) + (y - a[1]) * (y - a[1]) + (z - a[2]) * (z - a[2]); if (d2 < bd) { bd = d2; b = k; } }
      if (b < 0) continue;
      const a = ax[b], d = V3.reject([x - a.p[0], y - a.p[1], z - a.p[2]], a.t);
      let e = V3.reject(V3.sub(eye, a.p), a.t); if (V3.len(e) < 1e-4) continue; e = V3.norm(e);
      const l = V3.cross(a.t, e), de = V3.dot(d, e), dl = V3.dot(d, l), w = 1 - smoothstep(0.8 * Ls, 1.25 * Ls, Math.abs(a.s));
      if (w <= 0 || Math.abs(dl) >= Rs * 1.5 || de <= -Rb * 1.4) continue;
      mv[i] = { e, l, de, dl, w }; sum += dl; hit = true;
    }
    if (!hit) continue;
    const sg = Math.abs(sum) > 1e-3 ? Math.sign(sum) : j % 2 ? 1 : -1, cp = Float32Array.from(cpA.subarray(off, off + CPN * 4));
    for (let i = 0; i < CPN; i++) {
      const m = mv[i]; if (!m) continue;
      let nl = m.dl, ne = m.de;
      if (m.de > -0.3 * Rb) nl = sg * Math.max(Math.abs(m.dl), Rs * (1 + 0.5 * Math.min(Math.abs(m.dl) / Rs, 1)));      // before or beside the fiber: out to the side
      else ne = Math.min(m.de, -Rb * (1.4 - 0.4 * Math.min(-m.de / Rb, 1)));                                              // just behind it: back
      cp[i * 4] += m.w * ((nl - m.dl) * m.l[0] + (ne - m.de) * m.e[0]); cp[i * 4 + 1] += m.w * ((nl - m.dl) * m.l[1] + (ne - m.de) * m.e[1]); cp[i * 4 + 2] += m.w * ((nl - m.dl) * m.l[2] + (ne - m.de) * m.e[2]);
    }
    out.push({ index: j, cp });
  }
  return out;
}

// ---------------------------------------------------------------- the plate
const PL = PLAN.plate;
// the light rig and the banks of mist were placed for the old plate (640 away from [0, 0, 12], 33 degrees up); they stay where they were
export const PLATE_RIG = { t: [0, 0, 12], p: [0, 12 * 0 + Math.sin(33 * DEG) * 640, 12 + Math.cos(33 * DEG) * 640] };
export const PLATE = { t: PL.t, p: [PL.t[0], PL.t[1] + Math.sin(PL.elev) * PL.dist, PL.t[2] + Math.cos(PL.elev) * PL.dist], fov: PL.fov };

// ---------------------------------------------------------------- the rail
// One closed loop. Every key is a composed frame: p the lens, t what it looks at, f what is in focus
// (defaults to t), fov, ap the aperture, v the speed in units a second as the lens passes, fog a
// factor on the air, m the form this stretch is about, and st marks a station: a calm place where
// that form's label can be read. The skim keys ride the river's surface, so the rail is built from
// the anatomy and follows the river as it thickens.
function buildRail(byId) {
  const river = byId.get('research'), S = (u, h, side) => river.skim(u, h, side);
  const look = (p, yaw, pitch, d = 100) => [p[0] + Math.cos(pitch * DEG) * Math.cos(yaw * DEG) * d, p[1] + Math.sin(pitch * DEG) * d, p[2] + Math.cos(pitch * DEG) * Math.sin(yaw * DEG) * d];
  const C = (id) => byId.get(id).center;
  const loop = byId.get('conversation'), ax = loop.axis, Lp = (d, up = 0) => V3.add(V3.addS(loop.center, ax, d), [0, up, 0]);
  // ART (A4): the rail was re-cut for the forms where they stand now. Every key is written from the forms themselves (the
  // river's surface, a form's centre, the loop's axis), so it follows them when they grow.
  const hero = S(0.16, 4, -10);      // CABLES: beside the river, not over it: the cables sweep from the lower left corner under the lens up and away to the right
  const veil = C('back_office'), fan = C('browser'), rope = C('making'), delta = C('computer'), harp = C('shell');
  const quill = C('mail'), plume = C('tools'), strata = C('files');
  const back = V3.add(Lp(46), [-70, -2, 0]), left = V3.add(loop.center, [-82, -11, 30]), home = S(0.10, 12, -14);
  const sz = (id, r0) => Math.pow(Math.max(byId.get(id).R || r0, r0) / r0, 0.45);      // REPAIR (R1): a form that has grown is looked at from farther off
  const none = (id) => !!byId.get(id).empty;                   // a form with no skills yet: the lens does not linger on it
  const keys = [
    // 1. the concept frame: the river rushing past from the lower left and bending away to the upper right; the veil, the
    //    rope and the delta behind it on the left, the strata, the plume and the quill in front of it on the right
    { p: hero, t: V3.add(S(0.50, 10, -70), [0, -60, 0]), f: S(0.27, 0, 0), m: 'research', st: 1, v: 7, fov: 0.90, ap: 0.0013 },      // CABLES: the river from the lower left corner up and away to the right, the loop near on the left, the veil's cables and the rope crossing behind, the delta far      // REPAIR (R1): turned a little to the far bank and up, so the veil, the rope and the delta close the frame behind the river
    // 2. the skim: low over the broad face of the river. The fan stands on the far bank, then the veil hangs over it
    { p: S(0.195, 5.5, 3), t: S(0.31, 3, 0), m: 'research', v: 13, fov: 0.88, ap: 0.0010 },
    { p: S(0.25, 14, 5), t: V3.lerp(S(0.37, 3, 0), fan, 0.75), m: 'browser', st: 1, v: 10, fov: 0.86, ap: 0.0006 },      // CABLES: higher over the river (8 was so near that the cables under the lens filled the frame out of focus: darkest tenth 14 on the real feed)
    { p: S(0.32, 5, 0), t: S(0.44, 4, 0), m: 'research', v: 22, fov: 0.92, ap: 0.0014 },
    { p: S(0.40, 12, 6), t: V3.lerp(S(0.52, 6, 0), veil, byId.get('back_office').fibers.length < 40 ? 0.3 : 0.8), m: 'back_office', st: 1, v: 10, fov: 0.86, ap: 0.0018 },      // CABLES: a veil of a few fibers is not a frame by itself (14 percent lit on the real feed): the river stays in the lower half of it
    { p: S(0.47, 7, 0), t: S(0.59, 5, 0), m: 'research', v: 20, fov: 0.92, ap: 0.0014 },
    // 3. easing off under the rope, with the delta coming down behind it
    // REPAIR (R1): the rope now hangs across the river and passes under it: its station is on the river just before the
    // crossing, the far leg coming down on the left, the near leg rising on the right, the delta beyond
    // CABLES (second check: 33 to 37 percent lit at 19 to 23 s): this stretch rode the river's far reach, where only its last
    // cables run and the frame was a tip of gold on black. The lens now leaves the river for the near side: the rope's
    // station looks across the river at the crossing, both legs of the rope in frame and the delta beyond; then it climbs
    // past the far reach and the delta's station looks back from up-river, the delta near, the rope, the river and the veil behind.
    { p: V3.add(rope, [-84, 58, 80]), t: V3.add(rope, [-9, 45, -27]), f: rope, m: 'making', st: 1, v: 10, fov: 0.90, ap: 0.0016 },
    { p: V3.add(rope, [6, 84, 125]), t: V3.add(rope, [-62, 26, -19]), m: null, v: 16, fov: 1.0, ap: 0.0018 },      // round the outside of the rope's near leg
    { p: V3.add(delta, [80, 60, 99]), t: V3.add(delta, [-40, -30, 29]), f: delta, m: 'computer', st: 1, v: 12, fov: 0.90, ap: 0.002 },
    // 4. up over the high reach of the river, turning to look back down the whole of it
    { p: [150, 90, 200], t: [-30, -15, -30], m: null, st: 1, v: 12, fov: 0.96, ap: 0.0008, fog: 0.8 },      // the wide establishing moment: from high on the near side, so the veil and the fan show their faces and the river runs away under them
    // 5. the near bank: a steady oblique track past the quill, the plume and the strata, the river behind each of them
    // REPAIR (R1): each near-bank station now has the river and the far bank behind its form (a form alone on black was a
    // specimen again): the quill from downstream with the plume behind it, the plume across the river, the strata from
    // upstream and below, looking back under the river
    { p: V3.addS(quill, [46, 28, 48], sz('mail', 21)), t: V3.lerp(quill, plume, 0.4), m: 'mail', st: 1, v: 11.5, fov: 0.85, ap: 0.0022 },
    { p: V3.addS(plume, [34, 12, 72], sz('tools', 27)), t: plume, m: 'tools', st: 1, v: 12, fov: 0.80, ap: 0.0026 },
    { p: V3.addS(strata, [-60, 4, 60], sz('files', 22.5)), t: V3.addS(strata, [20, 24, -7], sz('files', 22.5)), m: 'files', st: 1, v: 12, fov: 0.95, ap: 0.0020 },
    // 6. the second fast pass: up from under the river, in over it and straight through the loop
    //    on its axis. The axis points at the harp, so the two stand in line all the way in.
    { p: V3.add(Lp(-128), [10, 8, 0]), t: V3.add(Lp(0), [8, 0, 0]), m: 'conversation', v: 20, fov: 0.90, ap: 0.0014 },
    { p: Lp(-80), t: Lp(0, -1.5), m: 'conversation', st: 1, along: 1, v: 16, fov: 0.84, ap: 0.0018 },
    { p: Lp(0), t: Lp(60), f: harp, m: 'conversation', along: 1, v: 15, fov: 0.86, ap: 0.0018, turn: 1 },      // the centre of the loop
    // 7. a wide turn behind the loop: along the face of the fan, then the three-shot from the far left: the harp far,
    //    the fan in the middle, the loop near. Then back across the river's entry to the first frame.
    { p: back, t: look(back, -26, 3), f: fan, m: 'shell', v: 14, fov: 0.88, ap: 0.0016, turn: 1 },
    { p: left, t: V3.lerp(harp, fan, 0.3), m: 'shell', st: 1, v: 12, fov: 0.85, ap: 0.0018 },
    { p: home, t: look(home, -40, 5), f: S(0.2, 0, 0), m: 'research', v: 9.5, fov: 0.86, ap: 0.0018 },
  ];
  // FIX V11: the time at a station follows what is there. Where a form has no skills yet the lens passes its station at
  // well over the pace it keeps for a form with fibers (the two-shot of the harp and the loop is a full picture either way
  // and keeps its pace).
  for (const k of keys) if (k.st && k.m && k.p !== left && none(k.m)) k.v *= 1.7;
  // REPAIR (R3): a near-bank form with only a few fibers (or none) is a few lines in a dark frame from its own station: on a
  // sparse body the lens does not go out to it. It keeps to the river, and the form is named from there and on the plate.
  const thin = new Set(['mail', 'tools', 'files'].filter((id) => byId.get(id).fibers.length < 40));
  const kept = keys.filter((k) => !(k.st && thin.has(k.m)));
  return none('shell') ? kept.filter((k) => !k.turn) : kept;
}
// Label seats on the plate, one per form: [side, vertical, run, rise] in CSS pixels at 1440 x 900
// (they scale with the window). Side +1 sets the label right of its dot, vertical -1 above it.
export const PLATE_SEATS = {
  research: [1, -1, 56, 38], back_office: [1, -1, 56, 38], making: [-1, -1, 56, 38], conversation: [1, -1, 56, 38], browser: [1, -1, 56, 38],
  tools: [1, -1, 56, 38], computer: [-1, -1, 56, 38], shell: [1, -1, 56, 38], files: [1, 1, 56, 40], mail: [1, -1, 56, 38],
};
