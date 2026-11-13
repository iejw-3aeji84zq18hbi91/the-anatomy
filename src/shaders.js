// All GLSL for The Anatomy (light build, on the b-lumen renderer). WebGL2 / GLSL ES 3.00.
//
// The fiber is a GPU-evaluated ribbon: control points live in a float texture, the vertex shader
// evaluates a uniform cubic B-spline and expands a camera-facing strip in screen space with a
// minimum pixel width (alpha makes up the difference), and the fragment shader rebuilds the round
// wall, cuts the outline to the rod's own profile (beads, collars) and resolves the edge analytically.
//
// The material is LUMINOUS SILK with a TONUS core:
//   surface   drawn glass in a dark field. Bright rims, a dark middle, light living in lines: each light
//             mirrored as a crisp white strip (R), a second coloured line that went through the glass
//             (TRT), back light focused through the rod (TT), a slow ripple that breaks every long
//             highlight into dashes, micro facets that glint.
//   core      one thin luminous line inside the sheath, seen through the glass as through a lens.
//             Its brightness is the tier: formed 1x, practised 3x, proven 10x. Staged fibers have none.
//   record    one bead per finished job (the rod swells and a white-hot ring crosses it), one amber
//             diamond per job handed back, an engraved barcode plate for the id, gold knurled collars
//             for library skills, a white thread for taught skills, a pearl sheath for foundry skills.
// Every light the shaders know comes from one list (RIG in renderer.js): shafts of light, lamps, the strip
// that rides with the camera. Nothing in here is tied to a place in the scaffolding.
//
// Merged file (see MERGE.md): the light lane's shaders. The layout lane's shader hooks are carried onto this material
// by hand and marked LAYOUT-MERGE: the pool of light on the glass is one per shaft that stands among the fibers
// (blended in the vertex stage, as the layout lane's notes ask), and a sheath is lit by each of those shafts. The
// shells of mist behind everything take their place from the rig, and a sheath only a few pixels wide (the layout's
// dark lanes) takes the mean of its rim instead of a row of dots (both marked MERGE). With a rig of one near shaft
// and no mist entry (the light lane's own, and the specimen plate's) every other line computes what it did before.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

// ---------------------------------------------------------------- shared atmosphere
const AIR = `
uniform vec3 uCam;
uniform float uTime;
uniform float uFog;
#define NSH 4
uniform int uShN;            // shafts of light in use
uniform int uShNear;         // the first of them stand among the fibers: those also scatter light in front of fibers
uniform vec3 uShP[NSH];      // a point on the axis of each shaft (world)
uniform vec3 uShD[NSH];      // its unit axis, pointing at where the light comes from
uniform vec4 uShC[NSH];      // rgb: radiance seen looking straight across the core. a: core radius (gaussian sigma)
uniform vec4 uShH[NSH];      // x: halo radius, y: halo gain, z: the beam fades in above this height along its axis, w: and out by this one
float sq(float x) { return x * x; }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float erfA(float x) { float x2 = x * x; return sign(x) * sqrt(1. - exp(-x2 * (1.27324 + 0.147 * x2) / (1. + 0.147 * x2))); }
// The far mist by direction: indigo, lifting to violet above and to the right, teal low on the left. No data in it.
vec3 mistBase(vec3 rd) {
  // FIX V07/V26: the air is black unless a shaft lights it. These are the review's numbers: the violet end at well under
  // half of what it was, the haze at eye level at three tenths.
  vec3 c = mix(vec3(0.0010, 0.0018, 0.0052), vec3(0.0040, 0.0025, 0.0100), smoothstep(-0.55, 0.75, rd.y + rd.x * 0.3));
  c = mix(c, vec3(0.0006, 0.0050, 0.0070), 0.75 * smoothstep(0.25, -0.85, rd.y + rd.x * 0.55));
  c += vec3(0.0009, 0.0013, 0.0036) * exp(-sq(rd.y * 3.2));     // haze at eye level: far things stand against it
  return c;
}
// Light scattered toward the eye by the air inside one shaft, between the eye and tMax along the ray: the line integral of
// a gaussian beam, in closed form. It has compact support, so it lifts no blacks, and it stops at the surface, so whatever
// stands in or before the beam cuts a true silhouette into it.
float erfL(float x) { return clamp(x * 1.05, -1., 1.) * (1.5 - 0.5 * min(abs(x * 1.05), 1.)) / 1.0; }   // a cheap stand-in, for the wide soft halo only
// A shaft is never an even column: whatever it fell through on its way down left it in streaks. A pattern fixed in the
// world, across the beam (c: where the ray passes the axis, in the plane across it), turning slowly with height.
float streaks(vec3 c, vec3 D, float h, float sc) {
  vec3 e1 = normalize(cross(D, abs(D.y) < 0.9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.))), e2 = cross(D, e1);
  float u = dot(c, e1) / sc, v = dot(c, e2) / sc;
  return 1. + 0.30 * sin(u * 3.1 + 1.3 * sin(v * 2.3 + h * 0.011) + 0.7) * sin(v * 2.7 - 0.9 * sin(u * 1.9) + 2.1) + 0.16 * sin((u + v) * 6.3 + h * 0.02);
}
vec3 shaft(int i, vec3 ro, vec3 rd, float tMax) {
  vec3 D = uShD[i], w0 = ro - uShP[i];
  float wd = dot(w0, D), rdD = dot(rd, D);
  vec3 wp = w0 - D * wd, rp = rd - D * rdD;
  float a = max(dot(rp, rp), 0.14), b = dot(wp, rp), sa = sqrt(a), t0 = b / a;      // (floored: looking along a shaft must not flood the frame)
  float d2 = max(dot(wp, wp) - b * t0, 0.);
  float tc = clamp(-t0, 0., tMax);
  float h = wd + rdD * tc;                                   // how high up the beam the ray passes it
  float fall = smoothstep(uShH[i].z, uShH[i].z + 170., h) * (1. - smoothstep(uShH[i].w - 280., uShH[i].w, h));
  float sc = uShC[i].a, sh = uShH[i].x;
  if (d2 > 11. * sh * sh) return vec3(0.);                   // the ray never comes near the beam: nothing to integrate
  float kc = sa / (sc * 1.41421), kh = sa / (sh * 1.41421);
  float core = d2 < 11. * sc * sc ? exp(-d2 / (2. * sc * sc)) * (erfA((tMax + t0) * kc) - erfA(t0 * kc)) * mix(1., streaks(wp + rp * tc, D, h, sc), i == 0 ? 1. : 0.4) : 0.;   // FOUNDER NOTE 1 (last pass): the streaks of the far shafts are fainter: with three dark bands down it a dim shaft read as a turned column
  float halo = exp(-d2 / (2. * sh * sh)) * (erfL((tMax + t0) * kh) - erfL(t0 * kh));
  return uShC[i].rgb * ((core + halo * uShH[i].y) * (0.5 / sa) * fall * (0.55 + 0.45 * smoothstep(-60., 190., h)));
}
// the same for a ray that runs on into open air (the background): the far limit of both integrals is 1
vec3 shaftOpen(int i, vec3 ro, vec3 rd) {
  vec3 D = uShD[i], w0 = ro - uShP[i];
  float wd = dot(w0, D), rdD = dot(rd, D);
  vec3 wp = w0 - D * wd, rp = rd - D * rdD;
  float a = max(dot(rp, rp), 0.14), b = dot(wp, rp), sa = sqrt(a), t0 = b / a;
  float d2 = max(dot(wp, wp) - b * t0, 0.);
  float tc = max(-t0, 0.);
  float h = wd + rdD * tc;
  float fall = smoothstep(uShH[i].z, uShH[i].z + 170., h) * (1. - smoothstep(uShH[i].w - 280., uShH[i].w, h));
  float sc = uShC[i].a, sh = uShH[i].x;
  float core = d2 < 11. * sc * sc ? exp(-d2 / (2. * sc * sc)) * (1. - erfA(t0 * sa / (sc * 1.41421))) * mix(1., streaks(wp + rp * tc, D, h, sc), i == 0 ? 1. : 0.4) : 0.;
  float halo = exp(-d2 / (2. * sh * sh)) * (1. - erfL(t0 * sa / (sh * 1.41421)));
  return uShC[i].rgb * ((core + halo * uShH[i].y) * (0.5 / sa) * fall * (0.55 + 0.45 * smoothstep(-60., 190., h)));
}
// Depth mist with colour (warm near, blue-violet far), then the shaft light between eye and surface.
// The mist starts a little way out, so nothing near the lens is veiled and the blacks stay deep.
vec3 misted(vec3 col, vec3 wp, out vec3 rd, out float d) {
  vec3 rv = wp - uCam; d = length(rv); rd = rv / max(d, 1e-4);
  float f = 1. - exp(-max(d - 10., 0.) * uFog);
  return mix(col, mix(vec3(0.020, 0.010, 0.0045), mistBase(rd) * 0.85, smoothstep(24., 150., d)), f);     // (no brighter than the air behind: far things sink into it, they do not turn pale)
}
vec3 fogged(vec3 col, vec3 wp) {
  vec3 rd; float d;
  col = misted(col, wp, rd, d);
  for (int i = 0; i < NSH; i++) { if (i >= uShNear) break; col += shaft(i, uCam, rd, d); }
  return col;
}
`;

// ---------------------------------------------------------------- fiber vertex stage (shared)
const FIBER_VS = HEAD + AIR + `
layout(location=0) in vec2 aUV;   // u along the fiber, side -1 / +1
layout(location=1) in vec4 iA;    // spline row, radius, length, shade
layout(location=2) in vec4 iB;    // colour rgb, brightness tier
layout(location=3) in vec4 iC;    // bands, notches, finish, state
layout(location=4) in vec4 iD;    // seed a, seed b, birth, closed-loop flag
layout(location=5) in vec4 iE;    // spark start, born at, highlight, unused
uniform sampler2D uCP;            // spline control points: xyz, taper
uniform sampler2D uFR;            // a twist-free reference normal per control point: the frame the engraving and the core are fixed to
uniform ivec2 uCPDim;             // control points per fiber, rows per column
uniform mat4 uView, uProj;
uniform vec2 uViewport;
uniform float uSway, uGrowth, uPxMin, uPad, uWidthMul, uBias, uLitOnly;   // (uTime and the shafts are declared in AIR)
uniform vec2 uSolo;               // INTRO: x the one fiber the opening lights alone, y the light of every other fiber (1 outside the intro: nothing changes)
uniform vec2 uNearR;              // INTRO REPAIR: the widest a fiber other than the first may stand in the opening, as its radius over the frame's height: whole below x, gone at y (0, 0: off)
uniform vec2 uNearF;              // INTRO R2: in the intro's opening, the distances from the lens at which a fiber other than the first is gone and at which it is whole: it fades by distance (its light and its cover), it does not thin (0, 0: off)
uniform vec2 uNearEase;       // PASS3 (T5): during a flight, the distances from the lens at which a fiber is gone and at which it is whole (0, 0: no flight)
uniform float uInner;             // 1: only the part of the ribbon that is fully covered (drawn opaque, no discard, so hidden fragments cost nothing)
uniform float uSel;               // 0 all fibers, 1 plain ones only, 2 only those with a profile (beads, collars)
uniform float uShK[NSH];          // LAYOUT-MERGE: radius of the pool of light each of them lays on the glass round it
uniform vec3 uShG[NSH];           // FIX V08: the light each of them lays on the glass (apart from uShC, the brightness of its air)
out vec4 vAx;                     // LAYOUT-MERGE: world-space direction to those shafts, weighted by their pools (xyz), and the strength of the pools (w)
out vec3 vAxC;                    // LAYOUT-MERGE: their colour, weighted the same way
out float vU, vAcross, vRpx, vFade, vIn, vSh;
out vec3 vT, vWP, vRf;
flat out vec4 vCol, vK, vM, vL;
flat out float vId, vClosed;
flat out float vAG;               // FIX V14: afterglow of a burst replay on this fiber, 0..1 (set by the page for a few seconds, then 0)
// ENG (E3), large libraries only (renderer.js LOD_AT). uBk: sixteen over the number of fibers; the instances are drawn in
// sixteen lots and vBk says which lot this fiber is in. uLod 1: the light of the shafts in the air before a far strand is
// worked out here, once a vertex, instead of once a pixel (vFogS).
uniform float uBk, uLod;
flat out float vBk;
out vec3 vFogS;
void main() {
  int idx = int(iA.x + 0.5);
  int col = idx / uCPDim.y, row = idx - col * uCPDim.y;
  bool closed = iD.w > 0.5;
  // growth: a fiber forms along its length once the scrubber passes its learned_at rank
  float head = iD.z < 0. ? 1. : clamp((uGrowth - iD.z * 0.94) / 0.06, 0., 1.);
  head = min(head, clamp((uTime - iE.y) / 1.8, 0., 1.));
  float u = min(aUV.x, head), n3 = float(uCPDim.x - 3);
  float t = u * n3, sf = min(floor(t), n3 - 1.), f = t - sf;
  int s = int(sf) + col * uCPDim.x;
  vec4 c0 = texelFetch(uCP, ivec2(s, row), 0), c1 = texelFetch(uCP, ivec2(s + 1, row), 0);
  vec4 c2 = texelFetch(uCP, ivec2(s + 2, row), 0), c3 = texelFetch(uCP, ivec2(s + 3, row), 0);
  float f2 = f * f, f3 = f2 * f, g = 1. - f;
  vec4 w = vec4(g * g * g, 3. * f3 - 6. * f2 + 4., -3. * f3 + 3. * f2 + 3. * f + 1., f3) / 6.;
  vec4 P4 = c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;
  vec3 T = normalize(c0.xyz * (-g * g) + c1.xyz * (3. * f2 - 4. * f) + c2.xyz * (-3. * f2 + 2. * f + 1.) + c3.xyz * f2);
  vec4 Rf4 = texelFetch(uFR, ivec2(s, row), 0) * w.x + texelFetch(uFR, ivec2(s + 1, row), 0) * w.y
           + texelFetch(uFR, ivec2(s + 2, row), 0) * w.z + texelFetch(uFR, ivec2(s + 3, row), 0) * w.w;
  vec3 Rf = Rf4.xyz; vSh = Rf4.w;                           // ART: w is the shadow this point of the fiber stands in, inside its bundle (baked, anatomy.js)
  vec3 P = P4.xyz;
  float env = closed ? 1. : sin(3.14159265 * u);
  P += uSway * env * vec3(sin(uTime * 0.31 + P.y * 0.045 + P.z * 0.03), 0.6 * sin(uTime * 0.23 + P.x * 0.04), cos(uTime * 0.27 + P.x * 0.035 + P.y * 0.03));
  float lr = iA.z / max(iA.y, 1e-5);                        // length in radii
  // a long fiber thins and fades out at both ends; a short one (a specimen) keeps its width and ends in a rounded cap
  float ends = closed ? 1. : mix(1., smoothstep(0., 0.016, u) * smoothstep(1., 0.984, u), smoothstep(100., 220., lr));
  float tipR = closed ? 1e5 : min(aUV.x, 1. - aUV.x) * lr;  // radii from the nearer tip
  vec3 vp = (uView * vec4(P, 1.)).xyz;
  vec3 vt = mat3(uView) * T;
  vec3 side = cross(vt, -vp);
  float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(1., 0., 0.);
  float ppu = uProj[1][1] * uViewport.y * 0.5 / max(-vp.z, 0.02);
  // PASS3 (T5): a flight never drags a rod across the lens. While the lens is under way, whatever comes nearer than a
  // comfortable distance thins to a hair and is gone before it reaches the glass, and swells back as it falls behind:
  // eased by distance, never cut. At rest (on the rail, on the plate, in a close-up) the distances are zero.
  float nearK = uNearEase.y > 0. ? smoothstep(uNearEase.x, uNearEase.y, length(vp)) : 1.;
  // (INTRO R2: the width cap moved below, onto the fade)
  float radius = iA.y * P4.w * mix(0.35, 1., ends) * nearK;
  float rpx = radius * ppu * uWidthMul;
  float reff = max(rpx, uPxMin);
  float fade = clamp(rpx / reff, 0., 1.) * ends;
  if (uNearR.y > 0. && abs(iA.x - uSolo.x) > 0.5) fade *= 1. - smoothstep(uNearR.x, uNearR.y, iA.y * P4.w * ppu * uWidthMul / uViewport.y);   // INTRO R2: applied to the fade below, no longer to the radius (thinned, a thick neighbour tapered into a flat fleck; faded, it goes smoothly). INTRO REPAIR: and, in the intro's opening, every fiber but the first thins away when it would stand wider in the frame than uNearR (its radius as a share of the frame's height: whole below x, gone at y); (0, 0) outside it: nothing changes (a branch on a uniform, so with it off the code is the old code to the bit)
  if (uNearF.y > 0. && abs(iA.x - uSolo.x) > 0.5) fade *= smoothstep(uNearF.x, uNearF.y, length(vp));   // INTRO R2: too near the lens, a neighbour of the first fiber fades out smoothly by distance (thinned or capped it stood as a flat fleck); (0, 0) outside the intro: nothing changes
  bool wideF = iC.x > 0.5 || abs(iC.z - 2.) < 0.5;          // beads or collars: the ribbon leaves room for the profile
  bool ghost = abs(iC.w - 3.) < 0.5;
  float halfW = reff * (wideF ? 1.30 : 1.) + uPad;
  // the part the interior pass draws opaque: fully covered, a pixel inside the edge, clear of the rounded tips. The fringe
  // pass is told the same number per vertex, so the two meet exactly and neither leaves a hole.
  float inner = fade > 0.999 && !ghost && !wideF && tipR > 2.0 ? max(reff - 0.62, 0.) : 0.;
  if (uInner > 0.5) halfW = inner;
  vp += side * (aUV.y * halfW / ppu);
  vp.z += uBias * radius;
  float sparkT = (uTime - iE.x) / 1.5;
  bool lit = iC.w < 0.5 && (iB.w > 0.5 || iC.x > 0.5) || (sparkT > 0. && sparkT < 1.15) || iE.w > 0.002;
  bool sel = uSel < 0.5 || (uSel < 1.5 ? !wideF : wideF);
  // FIX V12: a nerve line to a tool (a spare line of neutral glass, thinner than any fiber) is two faint edges and no body
  if (uInner > 0.5 && abs(iC.w - 4.) < 0.5 && iA.y < 0.06) sel = false;
  bool dark = uSolo.y < 0.001 && abs(iA.x - uSolo.x) > 0.5;     // INTRO: in the dark of the opening every other fiber is not drawn at all (an unlit rod would stand as a black silhouette)
  gl_Position = head > 0. && sel && !dark && (uLitOnly < 0.5 || lit) ? uProj * vec4(vp, 1.) : vec4(2., 2., 2., 1.);
  vU = u; vAcross = aUV.y * halfW / reff; vRpx = reff; vFade = fade; vIn = inner;
  vT = T; vWP = P; vRf = Rf; vClosed = closed ? 1. : 0.;
  // LAYOUT-MERGE: was one pool of light round the first shaft, measured per fragment; now one pool per shaft that stands
  // among the fibers, blended here (the layout lane's hook, in world space because this material is shaded there).
  // With one near shaft this is the light lane's own 1 / (1 + (d / 26)^2), its own direction and its own colour.
  vec3 ax = vec3(0.), axc = vec3(0.); float pool = 0.;
  for (int k = 0; k < NSH; k++) {
    if (k >= max(uShNear, 1)) break;
    vec3 to = uShP[k] - P; to -= uShD[k] * dot(to, uShD[k]);
    float dl = length(to), q = dl / uShK[k], wt = 1. / (1. + q * q);
    ax += to * (wt / max(dl, 1e-3)); axc += uShG[k] * wt; pool += wt;
  }
  vAx = vec4(ax, pool); vAxC = axc;
  vCol = vec4(iB.rgb, iA.w); vK = vec4(iA.z, iA.y, iD.x, iD.y); vM = iC; vL = vec4(iB.w, head, iE.x, iE.z);
  vId = iA.x; vAG = iE.w;
  vBk = floor(float(gl_InstanceID) * uBk);
  vFogS = vec3(0.);
  if (uLod > 0.5) {
    vec3 rv = P - uCam; float dv = length(rv); rv /= max(dv, 1e-4);
    for (int k = 0; k < NSH; k++) { if (k >= uShNear) break; vFogS += shaft(k, uCam, rv, dv); }
  }
}
`;

const FIBER_IN = `
in float vU, vAcross, vRpx, vFade, vIn, vSh;
in vec3 vT, vWP, vRf;
flat in vec4 vCol, vK, vM, vL;
flat in float vId, vClosed;
uniform vec2 uSolo;               // INTRO: see FIBER_VS. The same light for every fiber but the one: light is direction, it marks nothing
float soloK() { return abs(vId - uSolo.x) < 0.5 ? 1. : uSolo.y; }
uniform float uTip;               // INTRO REPAIR: how strongly the forming tip is lit (1 outside the intro; the sequence lowers it: at the lens a lit tip stood as a flat hot slab)
flat in float vAG;
flat in float vBk;                // ENG (E3): the lot this fiber is drawn in (large libraries)
in vec3 vFogS;                    // ENG (E3): shaft light in the air before a far strand, from the vertex stage
`;

// Where the record sits on a fiber, and the shape it gives the rod. Shared by the body, the glow and the depth pass so
// they always agree. Bands (one per job done) and notches (one per job handed back) are centred together on the middle
// of the fiber, close enough to be counted in one close-up; their position along the fiber carries no meaning.
const RECORD = `
struct Rec { float dB; float dN; float pitch; float pn; float a; float b; float kb; };
Rec record(float s, float len, float rad, float nb, float nn) {
  Rec r;
  float nrec = max(nb + 0.72 * nn, 1.);
  float pitch = min(min(3.0 * rad, 0.5 * len / nrec), rad * max(0.42, 90. / nrec));      // PASS3 (T4): a long record is set closer (recordPitch in anatomy.js is the same rule)
  float pn = 0.72 * pitch;
  float gap = nb > 0.5 && nn > 0.5 ? 0.5 * pitch + 0.62 * pn : 0.;
  float span = max(nb - 1., 0.) * pitch + gap + max(nn - 1., 0.) * pn;
  float s0 = 0.5 * len - 0.5 * span;
  float kb = clamp(floor((s - s0) / pitch + 0.5), 0., max(nb - 1., 0.));
  r.dB = nb > 0.5 ? s - (s0 + kb * pitch) : 1e5;
  float n0 = s0 + max(nb - 1., 0.) * pitch + gap;
  float kn = clamp(floor((s - n0) / pn + 0.5), 0., max(nn - 1., 0.));
  r.dN = nn > 0.5 ? s - (n0 + kn * pn) : 1e5;
  r.pitch = pitch; r.pn = pn; r.a = s0; r.b = s0 + span; r.kb = kb;
  return r;
}
float gBeadK = 1.;               // PASS3 (T3): how much of the swell a fiber shows (1 on the fiber in focus and on a rod that fills the frame; set in GLASS)
const float BEAD = 0.16;          // how far the rod swells at a band, in radii (FIX V12: was 0.20 over 0.64 of the spacing, which read as bamboo)
const float COLLAR_HALF = 0.85;   // half length of a gold collar, in radii
const float COLLAR_RISE = 0.19;   // its thickness
const float LIP_RISE = 0.075;     // the raised lip at each end of it
// Relative radius of the rod at s. slope: d(radius)/d(arc). collar: 1 on the metal. cq: -1..1 along the collar.
float profile(Rec r, float s, float len, float rad, float nb, int finish, float aa, out float slope, out float collar, out float cq) {
  float p = 1.; slope = 0.; collar = 0.; cq = 0.;
  if (nb > 0.5) {
    float hw = 0.175 * r.pitch, t = r.dB / hw;                 // FIX V12: a bead is 0.35 of the spacing wide (was 0.64), so the glass between two bands is plain rod
    float bk = gBeadK * (nb > 30.5 ? (mod(r.kb + 1., 10.) < 0.5 ? 1.25 : 0.22) : 1.);      // PASS3 (T4): on a counted scale only every tenth mark is a full bead; the nine between barely swell, so the edge of the rod is not a saw
    if (abs(t) < 1.) { float w = 1. - t * t; p += BEAD * bk * w * w; slope += BEAD * bk * (-4. * t * w) * rad / hw; }
  }
  if (finish == 2) {              // library: collars bracket the record and sit near both ends
    float cw = COLLAR_HALF * rad;
    float d1 = s - (r.a - 0.75 * r.pitch - cw), d2 = s - (r.b + 0.75 * r.pitch + cw), d3 = s - 0.07 * len, d4 = s - 0.93 * len;
    float d = abs(d1) < abs(d2) ? d1 : d2, e = abs(d3) < abs(d4) ? d3 : d4;
    d = abs(d) < abs(e) ? d : e;
    cq = d / cw;
    float q = abs(cq), sg = sign(d) / cw;
    collar = clamp((1. - q) * cw / max(aa, 1e-5) + 0.5, 0., 1.);
    float tt = clamp((1. - q) / 0.14, 0., 1.), sh = tt * tt * (3. - 2. * tt);
    float lip = exp(-sq((q - 0.80) / 0.075));
    p += COLLAR_RISE * sh + LIP_RISE * lip * step(q, 1.);
    slope += rad * sg * (COLLAR_RISE * (-6. * tt * (1. - tt) / 0.14) * step(q, 1.) * step(0.86, q) + LIP_RISE * lip * (-2. * (q - 0.80) / 0.005625) * step(q, 1.));
  }
  return p;
}
`;

// ---------------------------------------------------------------- fiber body: luminous silk over a tonus core
// Three uses of one shader. OPAQUE: the fully covered interior of plain fibers, drawn with no discard at all, so the GPU's
// hidden surface removal shades each pixel once however deep the bundle is. uPass 0: the interiors of fibers that carry
// beads or collars, cut to their profile. uPass 1: the analytic fringe of every fiber, blended over what is behind.
const GLASS = `
in vec4 vAx;                  // LAYOUT-MERGE: toward the shafts that stand among the fibers, and the strength of their pools (vertex stage)
in vec3 vAxC;                 // LAYOUT-MERGE: their colour
uniform int uPass;
uniform float uDim;           // how far the other fibers step back while one is in focus
uniform float uFocusK;        // PASS3 (T4): 1 while a fiber is in focus (eased), 0 otherwise
uniform float uRest;          // radiance of the resting core of a formed fiber: the 1x
uniform vec4 uLook;           // x reflections, y glints, z engraving, w ripple
uniform vec4 uLook2;          // x rim (the fiber's own light in its edges), y core width, z halo, w bands
uniform vec4 uLook3;          // x smallest radius of a glint in pixels (1.5), y how much of its light the engraving leaks
uniform vec3 uStripDir, uStripAxis, uStripCol;   // a strip of light that rides with the camera: every strand keeps a sliding hairline
#define NLP 2
uniform vec4 uLampP[NLP];     // lamps at places in the world (w = 1) or far away in a direction (w = 0)
uniform vec3 uLampC[NLP];
uniform vec3 uFillDir, uFillCol;
uniform float uDbg;
uniform float uLod;           // ENG (E3): 1 in the fringe pass of a large library: far strands take the cheaper path (see main)
uniform float uCull;          // ENG (E3): 1 when the coverage of the lots drawn after this one is to be read
uniform sampler2D uOc0, uOc1, uOc2, uOc3;   // ENG (E3): that coverage, four lots a texture
uniform float uDpx;           // ENG (E1): device pixels of this screen per pixel of the reference screen (2x): 1 at 2x, 0.5 at 1x. Rules about what a fiber IS at a size read reference pixels; only antialiasing reads device pixels
out vec4 o;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 AMBER = vec3(1.0, 0.36, 0.04);
const vec3 GOLD = vec3(1.0, 0.72, 0.30);
const float HAIR_REST = 0.05;     // FIX V09: share of the mirrored hairlines a strand inside a bundle keeps (the lead strands keep all of it)

float gauss(float x, float b) { return exp(-x * x / (2. * b * b)); }
float plateau(float x, float w, float b) { float e = max(abs(x) - w, 0.); return exp(-e * e / (2. * b * b)); }
// a soft line across the rod at lateral position c, half-width w, whose mean over the width is 1
float lineN(float x, float c, float w) { float q = (x - c) / w; return exp(-q * q) / (0.886 * w); }
// ENG (E1): a soft line that had to be widened to the pixel grid of this screen (width squared w2) carries the light it carries
// on the reference screen (w2r), counting only what falls inside the rod (half-width b, same units). 1 when the two are equal.
float keep(float w2r, float w2, float b) { return sqrt(w2r * (1. - exp(-1.2732 * b * b / w2r)) / (w2 * (1. - exp(-1.2732 * b * b / w2)))); }

// A line of light (the arc K cos p + A sin p on the sphere of directions) mirrored in a rod shows at the one or two places
// where the arc crosses the cone of mirror directions. Both are returned, each with a weight that eases to nothing at the
// ends of the arc: a hairline never jumps, it slides, fades in and fades out. c = -dot(V, T).
void lineLight(vec3 T, float c, vec3 K, vec3 A, float cLo, float cHi, out vec3 La, out vec3 Lb, out vec2 w) {
  float kt = dot(K, T), at = dot(A, T), R2 = kt * kt + at * at + 1e-6;
  float q = sqrt(max(R2 - c * c, 0.));
  vec2 a = vec2(kt * c - at * q + 1e-6, at * c + kt * q), b = vec2(kt * c + at * q + 1e-6, at * c - kt * q);
  a *= inversesqrt(dot(a, a)); b *= inversesqrt(dot(b, b));
  w = vec2(smoothstep(0., 0.16, a.x - (a.y < 0. ? cLo : cHi)), smoothstep(0., 0.16, b.x - (b.y < 0. ? cLo : cHi)));
  La = K * a.x + A * a.y; Lb = K * b.x + A * b.y;
}

// what one fragment of the rod looks like to a light
struct Surf { vec3 T; vec3 V; vec3 Vp; vec3 S; vec3 N; vec3 Ng; float sinV; float nt; float rip; float x; float pxw; float tube;
              float F0; float lineW; float wR; float bR; float satin; float clearG; float metal; float bead; float gdot; float etch; float hw; };
vec3 aSpec, aThru, aFrost, aGlint, gHue2, gHueW;

// One light on the rod. kR: its mirror image in the sheath. kT: the light that went through the glass, the light the
// engraving scatters, and the glint of the micro facet. Every term is skipped where it cannot contribute.
void lightOn(Surf f, vec3 L, vec3 Lc, float kR, float kT, float kG) {
  float sinL = dot(L, f.T);
  vec3 Lp = L - f.T * sinL; Lp *= inversesqrt(max(dot(Lp, Lp), 1e-6));
  float xc = sinL + f.sinV - 2. * (f.nt + f.rip);            // 0 on the cone of mirror directions
  float cphi = dot(Lp, f.Vp);                                 // relative azimuth of light and eye
  float chalf = sqrt(max(0.5 + 0.5 * cphi, 0.)), shalf = sqrt(max(0.5 - 0.5 * cphi, 0.));
  float sd = clamp(dot(Lp, f.S) * 12., -1., 1.);              // which side the light is on, eased through the middle so nothing jumps
  float wa = 0.5 + 0.5 * sd, wb = 1. - wa;
  float ci = 1. - sqrt(max(0.5 + 0.5 * dot(L, f.V), 0.)), ci2 = ci * ci;
  float fr = f.F0 + (1. - f.F0) * ci2 * ci2 * ci;
  if (kR > 0.) {
    // R: the light mirrored in the sheath. On a strand, the lobe summed over its width. On a rod, a crisp-edged strip like a
    // softbox in glassware, never narrower than two pixels, with a thinner echo from the inner wall.
    float mR = plateau(xc, f.wR * 0.55, f.bR * 1.5);
    if (mR > 0.003) {
      float lobe = mR * 0.5 * chalf * 0.30;                    // a highlight that cannot be resolved fades: a far strand stays dark and clear, never satin
      if (f.tube > 0.) {
        float ch = max(chalf, 0.25);
        float wl = max(f.lineW * ch, f.pxw * f.hw), e = max(0.14 * wl, 0.5 * f.pxw);   // FIX V09: f.hw, see main()
        float da = abs(f.x - shalf), db = abs(f.x + shalf);
        float strip = 0.;
        if (f.satin > 0.) strip = wa * mix(1. - smoothstep(wl - e, wl + e, da), exp(-da * da * 1.6 / (wl * wl)), f.satin) + wb * mix(1. - smoothstep(wl - e, wl + e, db), exp(-db * db * 1.6 / (wl * wl)), f.satin);
        else strip = wa * (1. - smoothstep(wl - e, wl + e, da)) + wb * (1. - smoothstep(wl - e, wl + e, db));
        strip *= 0.5 * ch / (wl * mix(0.86, 0.70, f.satin));
        float eg = f.clearG * smoothstep(0.35, 1.0, wl * 0.28 / f.pxw);       // the echo: only once it can be told from the main strip
        if (eg > 0.) {
          float wg = max(wl * 0.28, f.pxw);
          float ga = (f.x - shalf * 0.58) / wg, gb = (f.x + shalf * 0.58) / wg;
          strip += eg * 0.32 * (wa * exp(-ga * ga) + wb * exp(-gb * gb)) * (0.5 * ch * wl * 0.28 / (wl * 0.86 * wg));
        }
        float lr = mR * strip;
        if (f.bead * f.clearG > 0.01) {                        // on a bead the wall is doubly curved, so the mirrored light gathers into one soft spot
          float spot = (wa * exp(-da * da * 0.5 / (wl * wl)) + wb * exp(-db * db * 0.5 / (wl * wl))) * (0.5 * ch / wl) * gauss(xc, 0.16) * 0.35;
          lr = mix(lr, spot, f.bead * f.clearG);
        }
        lobe = mix(lobe, lr, f.tube);
      }
      aSpec += Lc * mix(vec3(fr), GOLD * 0.32, f.metal) * (kR * lobe);
    }
  }
  if (kT > 0.) {
    // TRT: through the glass, off the back wall, out again. A second line in the family hue, shifted along the fiber, on the other side.
    float mT = gauss(xc - 0.20, 0.10);
    if (mT > 0.003) {
      float xt = mix(0.60, 0.80, shalf), lt = max(0.07, f.pxw);
      float aT = (0.22 + 0.5 * chalf * chalf) * (f.tube > 0. ? mix(0.35, (wa * lineN(f.x, -xt, lt) + wb * lineN(f.x, xt, lt)) * (0.07 / max(0.07, f.pxw * uDpx)), f.tube) : 0.35);
      aThru += Lc * (kT * (1. - fr) * mT * aT * 0.014) * gHue2;
    }
    // TT: back light focused through the rod. Only when the light is behind the fiber.
    if (cphi < -0.15) {
      float mF = gauss(xc, 0.13), wf = max(0.09, f.pxw);
      float aF = exp(-(1. + cphi) * 5.5) * (f.tube > 0. ? mix(0.5, 0.30 * lineN(f.x, -0.62 * dot(Lp, f.S), wf) * (0.09 / max(0.09, f.pxw * uDpx)), f.tube) : 0.5);
      aThru += Lc * (kT * (1. - fr) * mF * aF * 0.30) * gHueW;
    }
    if (f.etch > 0.002) {
      float wrap = 0.5 + 0.5 * dot(f.N, L);
      aFrost += Lc * (kT * (0.004 * wrap * wrap + 0.030 * gauss(xc, 0.20) * (0.35 + 0.65 * chalf)));
    }
  }
  if (kG > 0. && f.gdot > 0.002) {
    float g = max(dot(f.Ng, normalize(L + f.V)), 0.);
    g *= g; g *= g; g *= g; g *= g; g *= g; g *= g; g *= g;     // ^128: wide enough that a glint swells and fades over degrees, never pops
    aGlint += Lc * (kG * g * f.gdot);
  }
}

// The room a mirror-smooth sheath sees: deep indigo, the lit air of the nearest shaft, soft walls of light behind the lamps
// and the strip, a teal bounce from below. Analytic, no textures.
vec3 room(vec3 P, vec3 d, vec3 L0, vec3 L1) {
  vec3 c = mix(vec3(0.010, 0.009, 0.024), vec3(0.014, 0.022, 0.060), smoothstep(-0.6, 0.8, d.y));
  vec3 D = uShD[0], w0 = P - uShP[0];
  vec3 wp = w0 - D * dot(w0, D), rp = d - D * dot(d, D);
  float a = max(dot(rp, rp), 0.03), b = dot(wp, rp), d2 = max(dot(wp, wp) - b * b / a, 0.);
  float ahead = smoothstep(-3., 8., -b * inversesqrt(a));
  float sc = uShC[0].a * 1.6;                                  // a drawn rod is not a perfect mirror: the image of the shaft is a little soft
  c += uShC[0].rgb * (ahead * (exp(-d2 / (2. * sc * sc)) + 0.05 * exp(-d2 / (2. * sq(uShH[0].x)))) * inversesqrt(max(a, 0.3)));
  float l0 = max(dot(d, L0), 0.), l1 = max(dot(d, L1), 0.), st = max(dot(d, uStripDir), 0.), fl = max(dot(d, uFillDir), 0.);
  l0 *= l0; l1 *= l1; st *= st;
  float l04 = l0 * l0, l14 = l1 * l1;
  c += uLampC[0] * (0.002 * l0 + 0.03 * l04 * l04 * l04 * l04) + uLampC[1] * (0.002 * l1 + 0.03 * l14 * l14 * l14 * l14);
  c += uStripCol * (0.006 * st + 0.04 * st * st * st * st) + uFillCol * (0.012 * fl * fl);
  return c;
}

void main() {
  float len = vK.x, rad = vK.y, seed = vK.z, seed2 = vK.w;
  float nb = vM.x, nn = vM.y, tier = vL.x, hl = vL.w;
  int finish = int(vM.z + 0.5), state = int(vM.w + 0.5);
  float rpx = vRpx, pxw = 1. / rpx;                 // one pixel, in units of the drawn radius
  float rq = rpx / uDpx, pxwR = pxw * uDpx;         // ENG (E1): the same radius in reference pixels (half a CSS pixel), and one reference pixel in radii. The picture is the same on a 1x and a 2x screen
  float aa = max(fwidth(vU) * len, 1e-5);           // one pixel, in world units along the fiber
  float tube = smoothstep(2.0, 4.6, rq);            // 0: a strand up to four pixels wide. 1: a rod with a cross-section
  float near = smoothstep(7., 30., rq);             // close enough to show what is inside the glass
  bool wide = nb > 0.5 || finish == 2;

  vec3 T = normalize(vT), V = normalize(uCam - vWP);
  float vt = dot(V, T), vpl = sqrt(max(1. - vt * vt, 1e-4));
  vec3 Vp = (V - T * vt) / vpl, S = cross(T, Vp);

  // The ribbon is flat and the rod is round: slide along the fiber to the wall the eye really sees, so rings curve round it.
  float x0 = clamp(vAcross, -1., 1.);
  float s = vU * len + tube * clamp(rad * sqrt(1. - x0 * x0) * vt / max(vpl, 0.3), -2.5 * rad, 2.5 * rad);

  // ---- the record and the shape it gives the rod
  Rec r = record(s, len, rad, nb, nn);
  float prof = 1., slope = 0., collar = 0., cq = 0.;
  // PASS3 (T3): at middle distance a body of banded rods read as bamboo: every band a swollen joint with a flat lozenge of
  // light across it. The swell belongs to the close-up; on any other fiber it is a third of itself until the rod fills
  // much of the frame.
  gBeadK = hl > 1.5 ? 1. : mix(0.30, 1., smoothstep(30., 70., rq));
  if (wide) { prof = profile(r, s, len, rad, nb, finish, aa, slope, collar, cq); prof = mix(1., prof, tube); slope *= tube; }
  float tipE = vClosed > 0.5 ? 2. : min(vU, 1. - vU) * len / rad;            // radii from the nearer tip
  if (tipE < 1. && tube > 0.) {                                               // the rod ends in a rounded cap
    float c = sqrt(max(tipE * (2. - tipE), 1e-3));
    prof *= mix(1., c, tube); slope += tube * min((1. - tipE) / c, 4.) * (vU < 0.5 ? 1. : -1.);
  }
  float ax = abs(vAcross);
  float cov = clamp((prof - ax) * rpx + 0.5, 0., 1.) * vFade;
  float opac = state == 3 ? 0.04 + 0.7 * pow(min(ax, 1.), 3.) : 1.;      // observed: a ghost outline
  float alpha = cov * opac;
#ifndef OPAQUE
  // decide the pass before any shading
  if (uPass == 0) { if (alpha < 0.999) discard; }
  else { if (alpha < 0.003 || (wide ? alpha >= 0.999 : ax * rpx < vIn - 0.3)) discard; }
#endif

#ifndef OPAQUE
  // ENG (E3): a large library seen from afar is forty and more strands deep at every pixel, and all but the last few drawn
  // are painted over. The fibers are drawn in sixteen lots; a pass before this one summed, for every pixel, what each
  // lot covers (as -ln(1 - coverage), so the sum is the logarithm of what still shows through). A far strand that the lots
  // still to come will cover to 97 percent or more is not shaded: at most 3 percent of its light is lost, nothing else changes.
  if (uCull > 0.5 && tube <= 0.) {
    ivec2 pc = ivec2(gl_FragCoord.xy);
    vec4 ix = vec4(0.5, 1.5, 2.5, 3.5) - vBk;
    float after = dot(texelFetch(uOc0, pc, 0), step(1., ix)) + dot(texelFetch(uOc1, pc, 0), step(1., ix + 4.))
                + dot(texelFetch(uOc2, pc, 0), step(1., ix + 8.)) + dot(texelFetch(uOc3, pc, 0), step(1., ix + 12.));
    if (after * (255. / 64.) > 3.5) discard;
  }
#endif
  bool lodS = uLod > 0.5 && tube <= 0.;             // ENG (E3): a far strand of a large library
  float x = clamp(vAcross / prof, -1., 1.), nz = sqrt(max(1. - x * x, 0.));
  vec3 N0 = S * x + Vp * nz;                        // the round wall, rebuilt
  vec3 N = normalize(N0 - T * slope);               // tilted where the rod swells
  vec3 Bt = S * nz - Vp * x;                        // round the rod
  float nt = dot(N, T);
  // the same point in the fiber's own twist-free frame: (cos, sin) of its angle round the rod. Engraving, facets and the
  // core are placed in this frame, so they are fixed to the glass and never swim when the camera moves.
  vec3 e1 = vRf - T * dot(vRf, T); e1 *= inversesqrt(max(dot(e1, e1), 1e-8));
  vec3 e2 = cross(T, e1);
  float cF = dot(Vp, e1), sF = dot(Vp, e2);
  float cth = nz * cF - x * sF, sth = nz * sF + x * cF;

  // ---- what kind of fiber
  float lit = state == 0 ? 1. : 0.;
  float isPearl = finish == 3 ? 1. : 0.;
  float metal = collar, satin = max(isPearl, metal), clearG = (1. - isPearl) * (1. - metal);
  vec3 hue = vCol.rgb * mix(vec3(1.10, 0.985, 0.84), vec3(0.92, 1.0, 1.12), seed);    // small identity tint (ART: a little wider, so neighbours in a bundle differ in hue)
  float lit0 = hl > 1.5 ? 1. : 1. - clamp(vSh, 0., 1.);     // (the fiber in focus is combed out of its bundle and stands in no shadow)            // ART: 1 on the lit skin of a bundle, 0 in the shadow of the strands in front (baked, anatomy.js)
  float shG = mix(0.07, 1., lit0 * lit0);          // what the shadow leaves of the light that falls on the glass
  float shE = mix(0.20, 1., lit0);                 // and of the fiber's own resting light, seen through the strands in front. Every tier alike
  vec3 hueN = hue * pow(0.5 / max(dot(hue, LUMA), 0.05), 0.5);                         // a tier means the same on gold and on azure
  float shade = vCol.a;
  // ART (A3): a family that is drawn below the river's level keeps its own colour in everything that used to go to white
  // (a hot core, a band, the light on its glass). Mixed toward a fixed white, the quieter families washed out to pastel.
  vec3 hueC = hue / max(max(hue.r, hue.g), max(hue.b, 1e-3));          // the hue alone, at full strength
  float lvl = min(sqrt(dot(hue, LUMA) / 0.42), 1.25);                 // the level the family is drawn at: 1.25 the river, about 0.6 the others
  vec3 whiteN = mix(hueC, vec3(1.), 0.72) * lvl;                      // this family's "white hot"
  gHue2 = mix(hue, hue * hue, 0.3);                 // the colour after a round trip through the glass
  gHueW = mix(hue, vec3(1.), 0.15);
  float sR = s / rad;                               // arc position in radii
  float sid = floor(seed2 * 4093.);

  // ---- marks: one bead with a white-hot ring per job, one amber diamond per job handed back
  float bandRing = 0., bandGlow = 0., bead = 0., bandTen = 0., bandLong = 0.;
  if (nb > 0.5) {
    float hb = 0.14 * r.pitch, w0 = 0.070 * r.pitch, d = abs(r.dB);
    // PASS3 (T4): a record of more than thirty bands is a counted scale. Its marks may widen to a fifth of their spacing
    // before they dim, so every one stays a crisp tick, and every tenth (the 10th, 20th, ...) is the long bright mark.
    if (nb > 30.5) { w0 = max(w0, min(0.20 * r.pitch, 0.9 * aa)); bandTen = mod(r.kb + 1., 10.) < 0.5 ? 1. : 0.; bandLong = 1.; }
    float wr = max(w0, 0.8 * aa);
    bandRing = exp(-d * d / (wr * wr)) * (w0 / wr);            // filtered by its footprint: wider and dimmer, never aliased
    bandGlow = exp(-d * d / (hb * hb));
    bead = exp(-d * d / (hb * hb * 3.2)) * tube;
  }
  float notch = 0., notchIn = 0.;
  if (nn > 0.5) {
    float hn = max(0.40 * r.pn, 1.6 * aa), hx = max(0.60, 1.6 * pxw);    // never under three pixels across
    float dd = 1. - (abs(r.dN) / hn + abs(x) / hx);                      // > 0 inside the diamond
    float e = length(vec2(aa / hn, pxw / hx));                           // one pixel, in the same units
    notch = clamp(dd / e + 0.5, 0., 1.) * min(1., (0.40 * r.pn / hn) * (0.60 / hx) * 1.5);
    notchIn = clamp(dd, 0., 1.);
  }
  float clean = (1. - collar) * (1. - notch) * (1. - min(bandGlow * 1.2, 1.));

  // ---- the etched id signature (identity only, never a metric): a two-track barcode plate engraved on the sheath, repeated
  // along the fiber like cable print, every plate facing its own way.
  float etch = 0., etchTilt = 0.;
#ifdef OPAQUE
  const bool detail = true;
#else
  bool detail = uPass == 0 || vIn < 0.5 || ax * rpx < vIn + 0.3;      // the one-pixel fringe of a fiber that has an interior needs no engraving and no facets
#endif
  if (rq > 2.2 && isPearl < 0.5 && detail) {
    const float PER = 22., PLATE = 6.2, UNITS = 46., ARC = 0.62;
    float qq = sR + seed * 97., pi = floor(qq / PER), q = qq - pi * PER;
    if (q < PLATE) {
      float ap = 6.2831853 * hash21(vec2(pi, sid + 11.));
      float ca = cos(ap), sa = sin(ap);
      float cD = cth * ca + sth * sa, sD = sth * ca - cth * sa;         // cos and sin of the angle from the middle of the plate
      if (cD > 0.3) {
        float a = atan(sD, cD);
        float W = PLATE / UNITS, xq = q / W, slot = floor(xq), f = xq - slot;
        float hA = hash21(vec2(slot, sid)), hB = hash21(vec2(slot + 211., sid + 3.)), h2 = hash21(vec2(slot + 61., sid + 7.));
        float guard = min(step(slot, 1.5) * step(0.5, slot) + step(UNITS - 2.5, slot) * step(slot, UNITS - 1.5), 1.);
        float wbar = mix(mix(0.16, 0.60, h2 * h2), 0.34, guard);
        float aaS = clamp(aa / rad / W, 1e-3, 4.);
        float bar = clamp((0.5 * wbar - abs(f - 0.5)) / aaS + 0.5, 0., 1.);
        float fa = max(pxw / max(nz, 0.25), 1e-3);                      // one pixel, in radians round the rod
        float up = clamp((a - 0.07) / fa + 0.5, 0., 1.) * clamp((ARC - a) / fa + 0.5, 0., 1.);
        float lo = clamp((-0.07 - a) / fa + 0.5, 0., 1.) * clamp((a + ARC) / fa + 0.5, 0., 1.);
        float full = clamp((a + ARC + 0.12) / fa + 0.5, 0., 1.) * clamp((ARC + 0.12 - a) / fa + 0.5, 0., 1.);
        float m = bar * mix(step(0.50, hA) * up + step(0.42, hB) * lo, full, guard);
        float ql = q / PLATE;
        float soft = 0.30 * sq(sin(3.14159 * ql)) * (1. - smoothstep(0., ARC + 0.2, abs(a)));   // too fine to resolve: one soft frosted patch
        // FIX V16: the engraving is cut INTO the glass: it only ever darkens what is there (see the assembly below), it keeps a
        // full pitch clear of the record at both ends so it can never be counted with the bands, and it is left out
        // altogether on a fiber too small on screen to show it as fine lines.
        etch = mix(m, soft, smoothstep(0.45, 1.3, aaS)) * smoothstep(4.5, 7.0, rq) * clean * uLook.z;
        if (nb + nn > 0.5) etch *= 1. - smoothstep(r.a - 2.0 * r.pitch, r.a - r.pitch, s) * (1. - smoothstep(r.b + r.pitch, r.b + 2.0 * r.pitch, s));
        etchTilt = hash21(vec2(slot + 127., sid + 13.)) * 2. - 1.;
      }
    }
  }

  // ---- glints: one micro facet cut into the glass every few radii. A dot fixed to the fiber with its own tilted normal, so
  // it flashes only when a light, the facet and the eye line up. Never under three pixels across; it gives the energy back.
  float gdot = 0., gLeak = 0.; vec3 Ng = N;
  if (clearG > 0.5 && state < 2 && detail) {
    const float CELL = 2.1;
    float gc = sR / CELL + seed * 31., gi = floor(gc), gf = gc - gi;
    vec2 h1 = hash22(vec2(gi, sid + 5.));
    float rs = max(0.09, uLook3.x * aa / rad), ra = max(0.09, uLook3.x * pxw / max(nz, 0.35));
    float m = min(0.5, 2.3 * rs / CELL);
    float gs = (gf - mix(m, 1. - m, h1.x)) * CELL;
    float ag = 6.2831853 * h1.y;
    float cg = cos(ag), sg = sin(ag), cD = cth * cg + sth * sg;
    if (cD > 0.45 && abs(gs) < 3. * rs) {
      float ga = (sth * cg - cth * sg) / cD;
      vec2 h2 = hash22(vec2(gi + 17., sid + 3.));
      float rsR = max(0.09, uLook3.x * aa * uDpx / rad), raR = max(0.09, uLook3.x * pxwR / max(nz, 0.35));   // ENG (E1): its size on the reference screen: the dot is as large as this screen needs and carries the same light
      float gsh = exp(-(gs * gs / (rs * rs) + ga * ga / (ra * ra))) * pow(0.0081 / (rsR * raR), 0.75) * ((rsR * raR) / (rs * ra)) * clean * smoothstep(0.45, 0.7, cD);
      gdot = gsh * smoothstep(0.45, 1.2, rq);
      // PASS3 (T2): the glass sparkles. A facet is a cut in a wall that carries light, so a little of the fiber's own light
      // leaves through it: a pin point fixed in the glass, there from every side (a shimmer of five percent with the angle of
      // view, no more), never moving along the fiber. Most facets are faint, one in twenty is a star, and some strands carry
      // more than their neighbours. It is not a record: irregular, a fraction of the size of a band, on fibers with no job
      // as on those with many, and kept a full pitch clear of every record (as the engraving is).
      float gh = h2.x, gh2 = gh * gh, gh4 = gh2 * gh2;
      float gw = (0.10 + 2.0 * gh2 * gh + 5.0 * gh4 * gh4 * gh4) * pow(1. + 1.5 * gh4, 1.5);
      float spk = 0.35 + 1.5 * sq(fract(seed2 * 17.3 + seed * 9.1));
      float shim = 0.95 + 0.05 * sin(dot(V, e1 * cg + e2 * sg) * 23. + h2.y * 6.2831853);
      gLeak = gsh * smoothstep(0.22, 0.8, rq) * gw * spk * shim;
      if (nb + nn > 0.5) gLeak *= 1. - smoothstep(r.a - 2.0 * r.pitch, r.a - r.pitch, s) * (1. - smoothstep(r.b + r.pitch, r.b + 2.0 * r.pitch, s));
      vec3 Nc = e1 * cg + e2 * sg;                               // a facet is flat: one normal for the whole dot, fixed in the fiber's frame
      Ng = normalize(Nc + (T * (h2.x - 0.5) + (e2 * cg - e1 * sg) * (h2.y - 0.5)) * 0.9);
    }
  }

  // ---- drawn glass is never straight: a slow ripple in the wall, fixed to the fiber, breaks each long highlight into dashes
  float rip = 0.;
  if (rq > 2.0) {
    float ripF = 0.50 + 0.45 * fract(seed * 53.);
    rip = (0.55 * sin(sR * ripF + seed * 40.) + 0.30 * sin(sR * ripF * 0.37 + seed * 11.) + 0.15 * sin(sR * ripF * 2.7 + seed * 17.))
        * (0.026 * uLook.w * clearG * smoothstep(2.0, 4.4, rq));
  }

  // PASS3 (T2): drawn glass carries draw lines: fine flutes along the rod, fixed in the fiber's frame, each strand its own
  // count. They come in over the last third of an approach (when a flute is a few pixels wide) and split every highlight
  // into a sheaf of hairlines. A property of the glass: the same on every fiber, it marks nothing.
  // (second sitting: they were tied to near, which is still close to zero at the distance of a close-up of a short record,
  // so the rod in focus was plain. They now come in as soon as the rod is a dozen reference pixels thick.)
  float fluteK = max(near, smoothstep(5., 13., rq));
  if (fluteK > 0. && clearG > 0.5 && detail) {
    float ngr = 9. + floor(seed * 6.), kq = smoothstep(2.4, 5.5, (6.2831853 / ngr) * rpx * max(nz, 0.25));
    if (kq > 0.) { float gph = atan(sth, cth) * ngr + seed2 * 40. + 0.6 * sin(sR * 0.21 + seed * 9.); N = normalize(N + Bt * (0.24 * fluteK * kq * sin(gph))); }
  }

  // ---- the lights
  Surf f;
  f.T = T; f.V = V; f.Vp = Vp; f.S = S; f.N = N; f.Ng = Ng; f.sinV = vt; f.nt = nt; f.rip = rip; f.x = x; f.pxw = pxw; f.tube = tube;
  f.F0 = mix(0.09, 0.06, isPearl); f.lineW = mix(mix(0.055, 0.42, isPearl), 0.32, metal);
  f.wR = mix(mix(0.045, 0.42, isPearl), 0.50, metal); f.bR = mix(mix(0.025, 0.20, isPearl), 0.22, metal);
  f.satin = satin; f.clearG = clearG; f.metal = metal; f.bead = bead; f.gdot = gdot; f.etch = isPearl;
  aSpec = vec3(0.); aThru = vec3(0.); aFrost = vec3(0.); aGlint = vec3(0.);
  // the nearest shaft is a line of light: a pool of it round the axis, a cool hairline in every strand, back light through the glass
  // LAYOUT-MERGE: which way, how strong and what colour now arrive from the vertex stage, blended over every shaft that
  // stands among the fibers (was: measured here to the first shaft alone). The axis of the line stays the first shaft's.
  vec3 aDir = normalize(vAx.xyz + vec3(0., 0., 1e-5));
  vec3 shCol = vAxC / max(vAx.w, 1e-4);
  vec3 shC = mix(shCol, vec3(dot(shCol, vec3(0.3333))), 0.55) * (5.0 * (0.07 + 1.25 * min(vAx.w, 1.)));   // cool white: blue light on gold glass is khaki
  vec3 La, Lb; vec2 lw;
  float lineK = smoothstep(2.1, 3.3, rq);                    // far strands leave the hairlines out: their core is the line the eye follows
  // FIX V09 (last pass): in a bundle seen from a little way off every strand carried two to four mirrored hairlines, each at
  // least two pixels wide on a strand five to eight pixels wide. Summed over a packed bundle that is a satin sheet: the
  // resting river read as matte straw with no dark between its strands. Light on a bundle of glass lands on the strands
  // that face it: now only the lead strands (about one in six, on the skin of the bundle) carry the hairlines until a
  // rod is close enough to be seen one at a time (near), and the rest keep their dark glass and their core. A property of
  // the glass and the light: it marks nothing, and it is the same on every tier.
  float lead = step(0.60, fract(seed2 * 13.7 + seed * 5.1)) * smoothstep(0.66, 0.90, shade);
  float hair = mix(mix(HAIR_REST, 1., lead), 1., near);
  f.hw = mix(0.64, 1., near);                                 // and a hairline in a bundle is a hairline: 1.3 pixels at the least (was 2), 2 again close up
  lineK *= hair;
  if (lineK > 0.) {
    lineLight(T, -vt, aDir, uShD[0], 0.765, 0.219, La, Lb, lw); lw *= lineK;
    if (lw.x > 0.) lightOn(f, La, shC * lw.x, 1., 0., 0.);
    if (lw.y > 0.) lightOn(f, Lb, shC * lw.y, 1., 0., 0.);
    lineLight(T, -vt, uStripDir, uStripAxis, 0.408, 0.408, La, Lb, lw); lw *= lineK;
    if (lw.x > 0.) lightOn(f, La, uStripCol * lw.x, 1., 0., 0.);
    if (lw.y > 0.) lightOn(f, Lb, uStripCol * lw.y, 1., 0., 0.);
  }
  // Where the picture cannot show them, terms are left out: a strand a pixel wide has no lines of through-light to resolve
  // (the back light of the shaft is kept, it is what makes strands glow before it), and the outer edge of a wide rod holds
  // only its rim and whatever mirror strip sits there.
  float kT = detail || (rq < 5. && tube > 0.) ? smoothstep(0.0, 0.4, tube) : 0.;
  if (detail || (rq < 5. && tube > 0.)) lightOn(f, normalize(aDir + uShD[0] * 0.6), shC, 0., 1., 1.);
  vec3 L0 = normalize(uLampP[0].xyz - vWP * uLampP[0].w), L1 = normalize(uLampP[1].xyz - vWP * uLampP[1].w);
  // ENG (E3): in a large library a far strand that is not a lead strand keeps a twentieth of the lamps' mirror image (hair):
  // too little to see. It is left out there, unless a glint facet sits under this pixel.
  if (!(lodS && lead < 0.5 && gdot <= 0.002)) {
  lightOn(f, L0, uLampC[0], hair, kT, 1.);                     // FIX V09: the mirror images of the lamps follow the same rule as the hairlines
  lightOn(f, L1, uLampC[1], hair, kT, 1.);
  }
  if (gdot > 0.002) {           // the strip that rides with the camera also finds facets: wherever you look, a few of them answer
    float g = max(dot(Ng, normalize(uStripDir + V)), 0.);
    g *= g; g *= g; g *= g; g *= g; g *= g; g *= g; g *= g;
    aGlint += uStripCol * (2.5 * g * gdot);
  }

  // ---- the room in the sheath: glass in a dark field carries its light in its edges. Active fibers also bathe each other in
  // their resting light, so the rim of a lit fiber takes its family hue; a staged fiber only has the room.
  vec3 Nr = normalize(mix(Vp, N, tube));
  // The rim belongs to the silhouette of the cross-section. (Taken from the true grazing angle, a rod running away from the eye
  // mirrors the room over its whole width, and a bundle of them turns to satin.) It never goes sub-pixel.
  float nv = max(nz, 0.30 * pxw);
  float rimP = sq(sq(1. - nv));
  float frim = mix(0.040, rimP, tube);
  float frimS = mix(0.012, rimP * mix(0.12, 1., near), tube);   // far away a fiber is its thread of light: three gold lines a strand would average to brass
  vec3 sib = hue * (uRest * lit);
  vec3 roomR = vec3(0.012, 0.014, 0.034);                                                  // a strand only has the dim average of the room
  if (tube > 0. && frim + isPearl > 0.004) roomR = mix(roomR, room(vWP, reflect(-V, Nr), L0, L1), smoothstep(0.0, 0.3, tube));   // a rod mirrors it, where the rim can show it
  vec3 sheen = mix(vec3(1.), hueC, mix(0.78, 0.12, isPearl)) * min(lvl, 1.);    // ART: was 0.62. White light on the glass washed every family to pastel
  vec3 film = vec3(1.);
  if (isPearl > 0.5) {                                         // nacre: a thin film whose thickness drifts along the rod
    float nm = mix(290., 520., 0.5 + 0.5 * sin(sR * 0.11 + seed * 91.)) + 70.;
    float ct = sqrt(1. - (1. - nz * nz) / 1.9044);
    film = 0.5 - 0.5 * cos(6.2831853 * (2.76 * nm * ct) / vec3(650., 550., 450.));
    film = mix(vec3(dot(film, vec3(0.3333))), film, 0.34);      // a faint overtone, not a rainbow
    sheen = mix(vec3(1.), film * 1.7, 0.55) * mix(vec3(1.), hue, 0.12) * 0.8;
  }
  sheen = mix(sheen, GOLD, metal);
  vec3 rimC = roomR * 1.1 * mix(vec3(frim + 0.05 * isPearl), GOLD * 0.85, metal) + sib * (uLook2.x * frimS * (1. - metal));
  // the rod is a tube: its inner wall shows as a second, fainter pair of lines inside the rim, with a dark band between
  float wi = max(0.035, pxw);
  float inner = exp(-sq((abs(x) - 0.74) / wi)) * (0.035 / wi);
  vec3 lens = (vec3(0.012, 0.016, 0.040) * mix(vec3(1.), hue, 0.85) + sib * 0.5) * ((0.22 * mix(0.05, inner, tube) + 0.03 * mix(0.5, nz * nz * nz, tube)) * mix(0.2, 1., near));

  // ---- inner light: the resting tone. One thin core line inside the sheath, seen through the glass like a lens: the eye ray is
  // refracted into the rod and its chord is followed in closed form, so the core is magnified, sits off the axis, and slides
  // across the fiber as the fiber turns. 1x formed, 3x practised, 10x proven and white-hot. Staged: nothing.
  float tg = tier > 1.5 ? 10. : tier > 0.5 ? 3. : 1.;
  float breath = 1. + 0.045 * sin(uTime * 0.55 + seed * 6.2831853);
  float cool = mix(1., 0.6, near);                             // close up a core is many pixels wide and needs less radiance to read; all tiers alike, so 1 : 3 : 10 holds
  float E = uRest * tg * breath * lit * cool;
  // FIX V09: a resting bundle is not one flat tone. Each formed or practised fiber rests a little brighter or dimmer than its
  // neighbour (by its id, within 30 percent, so 1x : 3x still holds), and the fibers at the heart of a bundle are darker
  // than those on its skin, so the bundle has a lit surface and a dark interior. Proven fibers are left exactly as they were.
  // The ladder stays strict: a formed fiber rests between 0.35x and 1x, a practised one between 2.4x and 3x, a proven one at 10x.
  float vr = fract(seed2 * 7.31 + seed * 3.77);
  if (tier < 1.5) E *= (tier < 0.5 ? 0.35 + 0.65 * vr : 0.80 + 0.20 * vr) * mix(0.42, 1., smoothstep(0.30, 0.95, shade));
  else E *= 0.86 + 0.14 * vr;                                  // ART: a proven fiber is one of many too: 8.6x to 10x, by its id
  E *= shE;                                                    // ART: the shadow inside the bundle, the same factor on every tier
  // Light in drawn glass is never even along a strand: it gathers and thins with the slow ripple of the wall. Seen from
  // afar, where a strand is only its thread of light, that is what lets the eye follow one strand through a bundle
  // instead of seeing a sheet. Close up (a rod with a cross-section) the core is steady. A property of the glass: it
  // marks no event and is the same on every fiber of a tier.
  float thread = 1. - smoothstep(2.4, 6.0, rq);
  float wave = 0.5 + 0.5 * sin(sR * (0.017 + 0.012 * fract(seed * 91.3)) + seed2 * 40. + 1.7 * sin(sR * 0.0061 + seed * 23.));
  E *= mix(1., mix(0.30, 1.25, wave * wave), thread * (tier > 1.5 ? 0.45 : 1.));
  // Seen from afar a resting thread keeps its place in the picture (LOOK.farRest): without it the body at rest (the real feed)
  // sank to a dim bronze on the plate. Formed fibers take the whole lift, practised ones a third of it, proven none, so
  // from any distance formed < practised < proven still holds (at most 2.6 x 1.25, at least 2.4 x 1.5, and 10).
  if (tier < 1.5) E *= mix(1., tier < 0.5 ? uLook3.z : mix(1., uLook3.z, 0.3), thread);
  E *= mix(1., 1.4, thread) * mix(1., 1.65, 1. - smoothstep(0.6, 1.6, rq));   // (and a little more once a strand is under a pixel, as on the plate, where a body at rest must still read)                                   // ART: every tier alike: a thread seen from afar gets back part of what its widened core now gives away (see coreLine below)
  float nEff = min(sqrt(2.25 - vt * vt) / vpl, 1.7);           // a cylinder bends a skew ray more; capped, or the core would fill the rod end-on
  float st = clamp(-x / nEff, -0.999, 0.999);
  vec2 cd = vec2(-sqrt(1. - st * st), -st);                    // the chord inside the glass, in the (N, Bt) cross-section
  float ecc = 0.30 * tube;
  float ph = seed * 6.2831853 + sR * 0.022, cp = cos(ph), sp = sin(ph);
  vec2 cc = ecc * vec2(cp * cth + sp * sth, sp * cth - cp * sth) - vec2(1., 0.);
  float bs = cc.x * cd.y - cc.y * cd.x;                        // distance from the chord to the core, in radii
  float fwb = pxw / nEff;                                      // one pixel, in the same units
  float rc = (0.040 + 0.009 * tier) * uLook2.y;                // practice thickens the core
  float fwbR = fwb * uDpx, sc2R = rc * rc + 0.50 * fwbR * fwbR;   // ENG (E1): the same on the reference screen
  float sc2 = rc * rc + 0.50 * fwb * fwb;                      // never under about a pixel and a half wide: it widens instead, and barely dims (FIX V09: was two pixels, which turned a bundle of thin strands into one flat sheet)
  float coreLine = mix(exp(-bs * bs / sc2), sqrt(max(1. - bs * bs / (rc * rc * 1.2), 0.)), smoothstep(1.2, 3.0, rc / fwb)) * pow(rc * rc / (rc * rc + 0.50 * sq(min(fwbR, 0.42))), 0.36) * keep(sc2R, sc2, 1. / nEff);   // ART: was 0.07. A core too thin to resolve was widened to a pixel and a half at nearly its full radiance, so every strand of a bundle seen from a little way off was a pale ribbon of light as wide as itself, and the glass was never seen. Now a widened core gives most of the energy back: a thread of its own colour inside dark glass. (Only as far as the strand is wide: a strand under a pixel is all thread, and its coverage already carries the rest)
  float rh = 0.10 + 0.03 * tier;                               // the glass round the core carries a little of it
  float halo = near > 0. ? exp(-abs(bs) / rh) * (0.010 + 0.006 * tier) * uLook2.z * near * (hl > 1.5 ? 0.6 : 1.) : 0.;      // P3R: on the rod in focus the glow round the core is 0.6 of itself, so its draw lines and its engraving show
  vec3 coreCol = mix(hueN, whiteN, 0.05 + 0.16 * tier);      // 1x is pure hue, 10x is hot but still its own colour (FIX V01); the bands are the white
  vec3 emis = E * (coreCol * coreLine + hueN * halo);
  if (tier > 1.5) emis += hueN * (E * 0.006 * exp(-x * x / 0.42) * (1. - near));             // proven, seen from afar: its colour fills the strand. Close up the glass is clear (ART: half of it; with half of a body proven the fill hid the strands)
  // PASS3 (flat tone): a rod at middle distance was black glass with a bright wire in it. Glass that carries light is lit
  // through: once a fiber has a cross-section its body holds a little of its core's light, most on the axis, none at the
  // wall. It follows the tier like the core (so the three tiers keep their order) and stands in the bundle's shadow.
  // P3R: three times that (0.0042): at 93 s the strata, rods a dozen pixels thick, were dull dark stalks, and the near cables of
  // the river black glass round a wire. The body of a rod is lit glass; its flanks stay dark, so a cable keeps its relief.
  emis += hueN * (E * 0.0125 * shE * max(1. - 1.15 * x * x, 0.) * tube * (1. - 0.6 * near));
  if (finish == 1) {            // taught: a second, straight, white thread on the axis
    float wt2R = sq(0.052) + 0.81 * fwbR * fwbR;               // ENG (E1)
    float wt2 = sq(0.052) + 0.81 * fwb * fwb;                  // st is the distance from the chord to the axis: the thread, through the lens
    float thread = exp(-st * st / wt2) * pow(sq(0.052) / wt2R, 0.12) * keep(wt2R, wt2, 1. / nEff);
    emis += vec3(1.0, 0.985, 0.95) * (uRest * 4.0 * breath * lit * cool + 0.05 * (1. - lit)) * thread;
  }
  // bands: a white-hot ring of light across the rod, glowing into its bead
  float across = mix(0.80, 0.50 + 0.50 * nz, tube), glowK = 1.;
  // PASS3 (T3): on a strand that is not yet a rod in close-up a band is a point of light in the glass, not a rung across it:
  // its light is gathered on the middle of the strand and the glow of its bead is held back. On the fiber in focus the
  // ring and the bead are exactly what they were.
  // (the fiber in focus always shows its rings; another fiber only when it is a rod filling much of the frame)
  { float dotK = (hl > 1.5 ? 0. : 1. - smoothstep(30., 70., rq)) * (1. - bandLong); across *= mix(1., 2.3 * exp(-x * x / 0.16), dotK); glowK = mix(1., 0.55 * exp(-x * x / 0.22), dotK); }
  // PASS3 (T4): the counted scale. An ordinary mark is a short tick across the middle of the rod; every tenth runs the
  // whole way across and is brighter, like the marks on a ruler.
  // (on a fiber that is not the subject the tenth mark does not run across either: a long record seen in passing is a row of
  // points with a brighter one every tenth, never a ladder)
  if (bandLong > 0.5) { float sub = hl > 1.5 ? 1. : smoothstep(30., 70., rq); across *= mix(1.0 * exp(-x * x / 0.07), mix(1.7 * exp(-x * x / 0.10), 2.6, sub), bandTen); glowK = mix(0.12, mix(0.45 * exp(-x * x / 0.22), 1.8, sub), bandTen); }
  vec3 bandE = (mix(hueN, whiteN, 0.70) * (9. * bandRing * across) + mix(hueN, whiteN, 0.10) * (0.9 * glowK * bandGlow * mix(0.7, 0.25 + 0.75 * nz * nz, tube))) * (uRest * breath * lit * cool * uLook2.w);
  bandE += vec3(0.55) * (0.02 * bandRing * (1. - lit));         // unlit, a band stays as a matte score line
  // Seen from afar the bands of a fiber cannot be told apart, and spread over their footprint they sank to the level of a
  // resting core: a fiber with thirty jobs looked like one with none. From afar the stretch of the fiber that carries
  // its bands is one white-hot dash, as long as the bands are many (the record itself, unresolved). It hands over to the
  // separate rings as the fiber comes close enough to show them.
  if (nb > 0.5 && tube < 1.) {
    float e0 = r.a - 0.55 * r.pitch, e1 = r.a + (nb - 1.) * r.pitch + 0.55 * r.pitch;
    float dash = clamp((s - e0) / aa + 0.5, 0., 1.) * clamp((e1 - s) / aa + 0.5, 0., 1.);
    bandE += mix(hueN, whiteN, 0.45) * (uRest * 7.5 * breath * lit * uLook2.w * dash * coreLine * (1. - tube) * shE);   // ART: in its own colour, and in the bundle's shadow like the core it rides on
  }
  // PASS3 (T4): a close-up has one subject. While a fiber is in focus the records of the others are dimmed to a trace
  // (they are still there and still theirs; leaving the close-up brings them back).
  float away = hl > 1.5 ? 0. : uFocusK;
  emis += bandE * (1. - 0.70 * away);      // P3R: 30 percent (was 14: the close-up of the mock's busy fiber stood on near-black)
  // PASS3 (T2): the facets' leak (see the glints above). It follows the tier (1 : 1.7 : 3.2, so resting, practised and proven
  // stay in order), stands in the bundle's shadow like the core, and is capped.
  if (gLeak > 0.001) emis += mix(hueN, whiteN, 0.72) * min(uRest * uLook.y * 0.95 * sqrt(tg) * breath * lit * shE * gLeak, 22.);
  // notches: an amber diamond set into the glass. Its facets catch a little more light toward the middle.
  if (nn > 0.5) {
    vec3 nc = AMBER * ((uRest * cool * (2.2 + 7.0 * notchIn * notchIn) * lit + 0.03 * (1. - lit)) * mix(0.8, 0.55 + 0.45 * nz, tube));
    emis = mix(emis, nc * (1. - 0.70 * away), notch);
  }
  if (isPearl > 0.5) emis = hueN * (E * (0.16 + 0.10 * nz));   // a pearl fiber that is switched on glows as a milky rod; staged it has no light at all

  // ---- assemble. Surface reflections keep the colour of the light: white sparkle on a coloured body says glass.
  float dimK = hl > 1.5 ? 1. : uDim, dimE = mix(dimK * dimK, dimK, 0.66 * uFocusK), dimG = mix(1., dimK, 0.92);      // P3R: beside a fiber in focus the others keep more of their resting light (0.2 of it, was 0.09), so the subject has a body behind it; under a burst they step back as far as they did     // light steps back further than glass (CABLES: the glass steps back nearly as far, was 0.75: beside a fiber in focus the beads of its neighbours read as combs)
  vec3 ext = aSpec * uLook.x * sheen * (1. - 0.45 * etch) * (1. - 0.6 * min(bandRing, 1.) * clearG) * mix(1., 0.30, isPearl);
  ext += rimC * sheen;
  ext += (aThru * (1. - 0.5 * notch) + lens) * clearG;
  ext += min(aGlint * (5. * uLook.y), vec3(26.)) * clearG;
  ext += (vec3(0.010, 0.011, 0.014) + aFrost * 0.05) * mix(vec3(1.), film * 1.5, 0.5) * isPearl;      // dark nacre: it only answers the room
  // ART: the sweep. A bundle of glass under a lamp carries a band of glitter where its strands turn through the mirror
  // angle; every strand answers a little before or after its neighbour (its own lay in the bundle), so the band is
  // sparks, not a stripe. Strands only: a rod close up has its true mirror strip already. Light on glass: it marks nothing.
  if (tube < 1. && state < 2 && isPearl < 0.5) {
    float xs = dot(L0, T) + vt + (fract(seed * 71.3 + seed2 * 3.1) - 0.5) * 0.22 + 0.06 * sin(sR * 0.027 + seed * 50.);
    float sw = exp(-xs * xs / 0.0032) + 0.22 * exp(-xs * xs / 0.03);
    ext += mix(vec3(1.), hueN, 0.55) * uLampC[0] * (0.020 * sw * (1. - tube) * step(0.30, fract(seed2 * 29.7)));
  }
  vec3 col = ext * (shade * dimG * shG) + emis * dimE;
  col *= 1. - 0.35 * etch * clearG;                             // FIX V16: the engraved id is darker than the glass it is cut into. It never adds light
  // FIX V14: the afterglow of a burst replay: for a few seconds the fiber holds a light in proportion to its share of the jobs
  if (vAG > 0.002) col += mix(hueN, vec3(1.), 0.22) * (uRest * 7.0 * vAG * (coreLine + 0.10 * exp(-x * x / 0.42) * (1. - near)));
  if (uDbg > 0.5) {            // look-dev: one term at a time
    col = uDbg < 1.5 ? emis : uDbg < 2.5 ? rimC * sheen : uDbg < 3.5 ? aThru : uDbg < 4.5 ? lens : uDbg < 5.5 ? aSpec * uLook.x : uDbg < 6.5 ? vec3(etch) : min(aGlint * 5., vec3(16.));
  }

  // ---- library: gold knurled collars. Opaque metal clamped on the glass; they hide the light and mirror the room.
  if (collar > 0.) {
    float th = atan(sth, cth), sc = cq * COLLAR_HALF;
    float a1 = 30. * (th + sc), a2 = 30. * (th - sc);
    float kf = smoothstep(2.0, 5.5, 0.21 * rpx * nz) * (1. - smoothstep(0.62, 0.74, abs(cq)));   // cuts finer than a few pixels fade to satin; the lips are plain
    vec3 Nk = normalize(N + (Bt * (cos(a1) + cos(a2)) + T * (cos(a1) - cos(a2))) * (0.20 * kf));
    vec3 Rk = reflect(-V, Nk);
    float nvk = clamp(dot(Nk, V), 0., 1.);
    vec3 Fm = GOLD + (1. - GOLD) * pow(1. - nvk, 5.);
    vec3 env = room(vWP, Rk, L0, L1) * 3.0;
    float k0 = max(dot(Rk, L0), 0.), k1 = max(dot(Rk, L1), 0.), ks = max(dot(Rk, uStripDir), 0.);
    env += uLampC[0] * (0.30 * pow(k0, 90.) + 0.012 * pow(k0, 6.)) + uLampC[1] * (0.30 * pow(k1, 90.) + 0.012 * pow(k1, 6.));
    env += uStripCol * (0.10 * pow(ks, 12.) + 0.02 * ks) + shC * (0.02 + 0.10 * pow(max(dot(Rk, normalize(aDir + uShD[0] * 0.6)), 0.), 8.));
    float groove = 1. - 0.55 * exp(-sq((abs(cq) - 0.68) / 0.035));
    vec3 metalC = Fm * env * (shade * dimG * groove * (0.82 + 0.18 * kf * cos(a1) * cos(a2))) + GOLD * 0.010
                + GOLD * hueN * (E * dimE * (0.03 + 0.10 * smoothstep(0.80, 1.0, abs(cq))));     // the collar is lit by the fiber it clamps
    col = mix(col, metalC, collar);
  }

  // ---- state
  if (state == 1) {                                                                              // staged: dark glass
    if (isPearl < 0.5) col *= 0.62;
    // FIX V33: from afar a staged fiber is a dark line with one cool edge: half the sheen, and no warm tint in it
    float farK = 1. - smoothstep(3., 8., rq);
    col = mix(col, vec3(dot(col, LUMA)) * vec3(0.74, 0.88, 1.12), 0.85 * farK) * mix(1., 0.5, farK);
  }
  if (state == 2) col = vec3(dot(col, LUMA)) * vec3(0.30, 0.31, 0.34);                      // off: dark grey
  else if (state == 3) col = (rimC * sheen + aSpec * 0.25) * 0.8;                                // observed: only its outline
  else if (state == 4) col = mix(vec3(dot(col, LUMA)), col, 0.35);                               // a state this viewer does not know: neutral

  // REPAIR (R4): the bright end. Every family but the river has a ceiling (the river is drawn at lvl 1.25, the others well
  // under 1): its hottest core, band or glint rolls off under the river's, so the highest light in any frame is gold.
  if (lvl < 0.95 && vL.w < 1.5) { float mxc = max(col.r, max(col.g, col.b)) / 0.30; col /= sqrt(1. + mxc * mxc); }      // (not the fiber in focus: in its own close-up it is the subject)
  // ---- spark: only when a new event id arrives, or during a captioned replay
  float spk = (uTime - vL.z) / 1.5;
  if (spk > 0. && spk < 1.15) {
    float d = (vU - spk) * len / max(rad * 5., 0.4);
    col += mix(hue, vec3(1.), 0.65) * exp(-d * d) * 10. * (1. - spk / 1.15);
  }
  // ---- forming tip, only while the growth scrubber is passing this fiber
  if (vL.y < 0.999) col += hue * smoothstep(vL.y - 0.04, vL.y, vU) * 1.4 * uTip;   // INTRO REPAIR: uTip (1 outside the intro: nothing changes)
  // ---- pointer and focus
  if (hl > 0.5) col += vec3(0.75, 0.86, 1.0) * pow(min(ax / prof, 1.), 5.) * (hl > 1.5 ? 0.9 : 0.8);

  if (lodS) { vec3 rdq; float dq; col = misted(col, vWP, rdq, dq) + vFogS; }   // ENG (E3): the shafts' light before a far strand comes from the vertex stage
  else col = fogged(col, vWP);
  float sk = soloK();                                          // INTRO: 1 outside the intro
#ifdef OPAQUE
  o = vec4(col * sk, 1.);
#else
  o = uPass == 0 ? vec4(col * sk, 1.) : vec4(col * (alpha * sk), alpha * sk);
#endif
}
`;
export const FIBER_BODY = { vs: FIBER_VS, fs: HEAD + AIR + FIBER_IN + RECORD + GLASS };
export const FIBER_OPAQUE = { vs: FIBER_VS, fs: HEAD + '#define OPAQUE\n' + AIR + FIBER_IN + RECORD + GLASS };

// ---------------------------------------------------------------- additive HDR glow (cores the record lights, and bands)
export const FIBER_GLOW = {
  vs: FIBER_VS,
  fs: HEAD + AIR + FIBER_IN + RECORD + `
uniform float uDim, uWidthMul, uRest, uGlowMax, uFocusK;
uniform float uDpx;                 // ENG (E1): see GLASS
out vec4 o;
void main() {
  int state = int(vM.w + 0.5);
  float tier = vL.x, st = (uTime - vL.z) / 1.5;
  bool spark = st > 0. && st < 1.15;
  if ((state != 0 || (tier < 0.5 && vM.x < 0.5)) && !spark && vAG < 0.002) discard;
  float q = vAcross * uWidthMul;                    // across, in fiber radii
  float edge = 1. - smoothstep(0.6, 1., abs(vAcross));
  float g1 = exp(-q * q * 0.85), g2 = exp(-q * q * 0.10);
  vec3 base = vCol.rgb;
  float len = vK.x, rad = vK.y, s = vU * len;
  vec3 col = vec3(0.);
  if (state == 0) {
    // ART: the halo of a resting core is a third of what it was. With half of a full body proven, the halos (five radii wide)
    // met between the strands and every dense bundle was one flat fill of its colour. The bands keep their glow.
    col += base * (uRest * (tier > 1.5 ? g1 * 0.22 + g2 * 0.035 : tier > 0.5 ? g1 * 0.06 + g2 * 0.01 : 0.));
    if (vM.x > 0.5) {
      Rec r = record(s, len, rad, vM.x, vM.y);
      // PASS3 (T3): on a rod that is not the subject the glow of a band is a round point of light in the middle of the glass
      // (it was a lozenge as wide as the rod, and a row of them was a ladder). A strand seen from afar, and the fiber in focus, are what they were.
      float rqG = vRpx / (uWidthMul * uDpx), dotG = (vL.w > 1.5 ? 0. : 1. - smoothstep(30., 70., rqG)) * smoothstep(2.0, 4.6, rqG) * (vM.x > 30.5 ? 0. : 1.);
      float gb = exp(-sq(r.dB / (rad * mix(0.95, 0.64, dotG))));
      col += mix(base, vec3(dot(base, vec3(0.2126, 0.7152, 0.0722)) * 2.2), 0.4) * gb * (uRest * mix(g1 * 1.3 + g2 * 0.26, exp(-q * q * 2.6) * 2.4 + g2 * 0.14, dotG)) * (vL.w > 1.5 ? 1. : 1. - 0.70 * uFocusK);      // PASS3 (T4)   // ART: the glow of a band is no whiter than its family is bright
    }
  }
  if (spark) {
    float d = (vU - st) * len / max(rad * 6., 0.5);
    col += mix(base, vec3(1.), 0.5) * exp(-d * d) * (g1 * 6. + g2 * 1.6) * (1. - st / 1.15);
  }
  col *= (vL.w > 1.5 ? 1. : uDim);
  col += base * (uRest * (g1 * 1.1 + g2 * 0.22) * vAG);                         // FIX V14: the afterglow of a burst replay does not step back with the rest
  col *= edge * vFade * mix(1., 0.07, smoothstep(3., 22., vRpx / (uWidthMul * uDpx)));
  col *= sq(1. - clamp(vSh, 0., 1.)) * 0.9 + 0.1;                                 // ART: a halo is light in the air round a strand on the skin of a bundle; inside, the strands in front hide it
  if (vClosed < 0.5) col *= smoothstep(0., 4., min(vU, 1. - vU) * len / rad);      // the halo dies away toward a tip instead of ending in a square
  col *= exp(-length(vWP - uCam) * uFog) * soloK();               // INTRO: soloK is 1 outside the intro
  // FIX V01: halos do not pile up without limit. The alpha written here is how much of the room for glow this halo uses
  // (the blend adds each halo times what is left: see render() in renderer.js). One fiber alone is exactly what it was;
  // where a hundred proven fibers cross, the sum stops near uGlowMax and the dark between the strands survives.
  o = vec4(col, clamp(max(col.r, max(col.g, col.b)) / uGlowMax, 0., 1.));
}
`,
};

// ---------------------------------------------------------------- ENG (E3): what each lot of far strands covers (large libraries)
// Drawn before the fringe pass with the same vertices, the same depth test and the same rule for what the fringe pass
// draws. Only strands (the fringe pass culls only strands; a rod is never counted and never culled). A ghost hides nothing.
// Sixteen lots in four 8-bit textures, additive: -ln(1 - coverage) in units of 1/64, so a channel is full at about 4.
export const FIBER_OCC = {
  vs: FIBER_VS,
  fs: HEAD + FIBER_IN + `
uniform float uDpx;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
layout(location=3) out vec4 o3;
void main() {
  float ax = abs(vAcross);
  float cov = clamp((1. - ax) * vRpx + 0.5, 0., 1.) * vFade;
  bool wide = vM.x > 0.5 || abs(vM.z - 2.) < 0.5;
  if (vRpx > 2.0 * uDpx || abs(vM.w - 3.) < 0.5 || cov < 0.02 || (wide ? cov >= 0.999 : ax * vRpx < vIn - 0.3)) discard;
  float v = min(-log(1. - min(cov, 0.98)), 3.9) * (64. / 255.);
  int b = int(vBk + 0.5), c = b & 3, t = b >> 2;
  vec4 u = vec4(c == 0 ? v : 0., c == 1 ? v : 0., c == 2 ? v : 0., c == 3 ? v : 0.), z = vec4(0.);
  o0 = t == 0 ? u : z; o1 = t == 1 ? u : z; o2 = t == 2 ? u : z; o3 = t == 3 ? u : z;
}
`,
};

// ---------------------------------------------------------------- id buffer (picking) and depth for thin fibers
export const FIBER_ID = {
  vs: FIBER_VS,
  fs: HEAD + 'float sq(float x) { return x * x; }\n' + FIBER_IN + RECORD + `
uniform float uCut;
uniform float uDpx;                 // ENG (E1): see GLASS (1 while picking: the id buffer has its own scale)
out vec4 o;
void main() {
  float prof = 1.;
  if ((vM.x > 0.5 || abs(vM.z - 2.) < 0.5) && vRpx > 1.4 * uDpx) {      // beads and collars are part of the silhouette
    float sl, co, cq;
    Rec r = record(vU * vK.x, vK.x, vK.y, vM.x, vM.y);
    prof = mix(1., profile(r, vU * vK.x, vK.x, vK.y, vM.x, int(vM.z + 0.5), 1e-4, sl, co, cq), smoothstep(2.0, 4.6, vRpx / uDpx));
  }
  float cov = clamp((prof - abs(vAcross)) * vRpx + 0.5, 0., 1.) * mix(1., vFade, step(0.001, uCut));
  if (cov < uCut || abs(vAcross) > prof) discard;
  float id = vId + 1.;
  o = vec4(mod(id, 256.), mod(floor(id / 256.), 256.), floor(id / 65536.), 255.) / 255.;
}
`,
};

// ---------------------------------------------------------------- scaffolding meshes (not data)
export const TUBE = {
  vs: HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aTint;   // sheath, tendon: rgb tint, a = emptiness (+2 on a lane still waiting for its fiber). Architecture: the tangent of the conduit, a = a seed
layout(location=3) in float aRad;   // MERGE: the thinner radius of the tube at this ring (architecture: the nominal radius of the conduit)
layout(location=4) in float aAlong; // distance along the tube, in world units (dashes of a lane, the joints of the architecture)
uniform mat4 uView, uProj;
uniform vec2 uViewport;             // MERGE
uniform float uDpx, uSway, uTime;
uniform float uIsTie;               // P3R: 1 only while the ties are drawn. (A dashed lane of an empty form also carries aTint.a >= 2, and was taken for a tie here: it swayed, sank and lost its dashes.)
uniform vec2 uArchEase;             // P3R (flights): the distances from the lens at which the architecture and the tendons are drawn in to nothing and at which they are whole (0, 0: no flight)
out vec3 vN, vWP; out vec4 vTint;
out float vRpx;                     // MERGE: that radius on screen, in pixels
out float vRad, vAlong;
void main() {
  vN = aNrm; vTint = aTint; vRad = aRad; vAlong = aAlong;
  vec3 pos = aPos;
  bool tieV = uIsTie > 0.5 && aTint.a >= 2.;
  // P3R (flights): a flight never drags a bar of the far architecture across the lens either. No discard (the architecture is
  // nearly all hidden, and a shader that may discard is shaded before the GPU knows that): the bar is drawn in toward
  // its own axis as it comes near, to a hair and to nothing, and swells back as it falls behind.
  if (!tieV && uArchEase.y > 0.) pos -= aNrm * (aRad * 0.985 * (1. - smoothstep(uArchEase.x, uArchEase.y, length((uView * vec4(aPos, 1.)).xyz))));
  if (tieV) {       // PASS3 (T1): a tie sways with the cable it is clamped on (the same motion as FIBER_VS)
    float envI = floor((aAlong + 2.) / 4.);
    vAlong = aAlong - 4. * envI;
    pos += uSway * (envI / 100.) * vec3(sin(uTime * 0.31 + pos.y * 0.045 + pos.z * 0.03), 0.6 * sin(uTime * 0.23 + pos.x * 0.04), cos(uTime * 0.27 + pos.x * 0.035 + pos.y * 0.03));
  }
  vec4 vp = uView * vec4(pos, 1.);
  vRpx = aRad * uProj[1][1] * uViewport.y * 0.5 / max(-vp.z, 0.02);
  // PASS3 (T1): a tie on a cable (aTint.a >= 2: rgb is its axis times its half length) that would be finer than the picture
  // can draw sinks under the outer strands of its cable instead of breaking into dots: quiet at a distance, there up close.
  if (tieV) {
    float hl = length(aTint.rgb), rq = vRpx / uDpx, wpx = 2. * hl * rq / max(aRad, 1e-3);
    float up = aTint.a >= 3. ? smoothstep(4.5, 10., rq) * smoothstep(1.5, 4., wpx) : smoothstep(0.75, 1.9, wpx);
    // P3R (ties): a part seen nearly along its cable shows only a crescent of its wall and none of the cable it holds, so it
    // read as a loose piece floating in the air. As the line of sight comes within about 55 degrees of the axis the part
    // sinks under the outer strands like a part too fine to draw, and a part that has sunk all the way is not drawn at all
    // (it is put behind the far plane: it costs no pixel, and it was hidden already, so nothing pops).
    float eo = abs(dot(mat3(uView) * (aTint.rgb / max(hl, 1e-5)), normalize(vp.xyz)));
    up *= 1. - smoothstep(aTint.a >= 3. ? 0.55 : 0.70, aTint.a >= 3. ? 0.80 : 0.88, eo);      // (second look: a short band seen at 45 degrees is still a C with no legible cable in it; it is gone by about 37 degrees, a ring by 28)
    pos -= aNrm * (aRad * 0.34 * (1. - up));
    vp = uView * vec4(pos, 1.);
    vWP = pos;
    gl_Position = uProj * vp;
    if (up < 0.004) gl_Position.z = 2. * gl_Position.w;
    return;
  }
  vWP = pos;
  gl_Position = uProj * vp;
}
`,
  fs: HEAD + AIR + `
in vec3 vN, vWP; in vec4 vTint;
in float vRpx, vRad, vAlong;
uniform int uKind;          // 0 sheath (membrane), 1 tendon, 2 pillar
uniform vec3 uStripDir;
uniform float uLane;        // how strongly the dashed lanes of an empty form are drawn
uniform float uDpx;         // ENG (E1): device pixels per reference pixel (see GLASS)
uniform vec4 uPart;         // PASS3 (T4): the point a close-up looks at, and the reach round it within which the strands are parted (0: no close-up)
uniform float uFocusK;
uniform vec2 uNearEase;     // PASS3 (T5): see FIBER_VS
uniform float uDim;         // P3R: how far everything but the subject steps back (a close-up, a burst): the ties step back with their cables
out vec4 o;
void main() {
  vec3 V = normalize(uCam - vWP), N = normalize(vN);
  // PASS3 (T8): a shader that can discard is shaded before the GPU knows what will cover it. The far architecture stands
  // behind everything and is nearly all covered, so with the ties' discards in its shader the 5,000-skill plate paid
  // for every hidden pixel of it. The discards are compiled only into the variant the ties are drawn with (TUBE_TIE).
#ifdef TIE_CUT
  // PASS3 (T5): a tie near the lens during a flight dissolves with the fibers it holds
  if (uNearEase.y > 0. && smoothstep(uNearEase.x, uNearEase.y, distance(vWP, uCam)) < hash21(gl_FragCoord.xy + 0.11)) discard;
  // PASS3 (T4): while a fiber is in focus its neighbours are parted like a curtain (anatomy.js partRows). The ties of those
  // cables cannot hold strands that have stepped aside: within the parted reach they dissolve (and come back with the strands).
  if (uKind == 2 && vTint.a >= 2. && uPart.w > 0.) {
    float kq = uFocusK * (1. - smoothstep(0.70, 1.0, distance(vWP, uPart.xyz) / uPart.w));
    if (kq > hash21(gl_FragCoord.xy + 0.37)) discard;
  }
#endif
  // FOUNDER NOTE 1: the far architecture is machined, not smooth. Everything below is fixed to the conduit (its own
  // length and its own angle round), so it never swims: joints with a seam and a lip every few radii, and between them
  // a ribbed length, a fluted length or a plated one with panel lines; two hairline pipes run the whole way. No light of
  // its own, no colour of any family: dark cool metal that only answers the shafts and the lens. Each kind of detail
  // fades out before it is too fine for the picture, so far structure dissolves instead of sparkling.
  float alb = 1., groove = 0., ridge = 0., edge = 0.;
  bool tie = uKind == 2 && vTint.a >= 2.;
  if (tie) {
#ifdef TIE_CUT
    if (dot(N, V) < -0.04) discard;      // PASS3 (T1): only the outer skin of a part is drawn; its inner wall, seen through a gap, was the dark bracket
#endif
    // PASS3 (T1): a tie is a machined part clamped on a cable. A ring: a turned band with a knurled face. A sleeve: a raised
    // lip at each end, the body cut into two to four lengths by seams, each length into plates with a line between them,
    // and every third plate slotted. All of it is fixed to the part (its own length a = -1..1 and its own angle round),
    // and each kind of detail comes in only when the picture can draw it. Neutral dark metal: no family colour, no light
    // of its own, never gold.
    vec3 T = normalize(vTint.rgb); float hl = length(vTint.rgb);
    vec3 rf = cross(T, vec3(0.31, 0.22, 0.925)); rf = dot(rf, rf) > 1e-3 ? normalize(rf) : normalize(cross(T, vec3(1., 0., 0.)));
    vec3 bn = cross(T, rf);
    float cT = dot(N, rf), sT = dot(N, bn), th = atan(sT, cT), R = max(vRad, 1e-3), sv = fract(vTint.a);
    float a = vAlong, q = abs(a), aaA = max(fwidth(a), 1e-4), aaS = aaA * hl, aaT = max(fwidth(cT) + fwidth(sT), 1e-4);
    float nT = 0., nB = 0.;
    if (vTint.a >= 3.) {
      float lipIn = 0.78, body = lipIn * hl;                                   // half length of the body between the lips
      float lip = smoothstep(lipIn - aaA, lipIn + aaA, q);
      // the bright edge: the two corners of each lip
      float we = max(0.035, 0.75 * aaA);
      edge = (exp(-sq((q - 0.80) / we)) + exp(-sq((q - 0.975) / we))) * min(1., 0.035 / (0.75 * aaA) + 0.12);
      float ns = 2. + floor(sv * 2.999), sa = (a / lipIn * 0.5 + 0.5) * ns, si = floor(sa), sf = sa - si;
      float dj = min(sf, 1. - sf) * 2. * body / ns;                            // world distance to the nearest seam
      float kS = smoothstep(0.18, 0.7, 0.03 / aaS);      // (second sitting: the seams hold from farther off, so a sleeve reads as cut into lengths before its plates resolve)
      float seam = (1. - smoothstep(0.022, 0.022 + aaS, dj)) * min(1., 0.044 / max(aaS, 1e-4)) * (1. - lip) * kS;
      float hs = hash21(vec2(si + 3., sv * 71.3));
      float np = 6. + floor(hs * 5.), pa = (th / 6.2831853 + 0.5) * np + hs * 5., pi = floor(pa), pf = pa - pi;
      float dp = min(pf, 1. - pf) * 6.2831853 / np;                            // radians to the nearest plate line
      float kP = smoothstep(0.5, 1.5, 0.016 / aaT);
      float line = (1. - smoothstep(0.014, 0.014 + aaT, dp)) * (1. - lip) * kP;
      float hp = hash21(vec2(pi + si * 7., sv * 13.3));
      alb = mix(1., 0.66 + 0.62 * hp, (1. - lip) * kP) * mix(1., 0.72 + 0.56 * hs, (1. - lip) * kS);      // each length its own tone
      nB = (pf < 0.5 ? 1. : -1.) * 0.8 * exp(-sq(dp / max(0.035, 1.5 * aaT))) * kP * (1. - lip);   // the edge of each plate is turned
      // slots milled into some plates (the last third of an approach)
      float per = 0.085, kV = smoothstep(1.6, 3.4, per / aaS) * step(0.62, hp) * (1. - lip);
      float inP = smoothstep(0.10, 0.16, min(pf, 1. - pf)) * smoothstep(0.10, 0.2, min(sf, 1. - sf));
      float ph = 6.2831853 * (a * hl) / per, slot = (0.5 + 0.5 * sin(ph)) * kV * inP;
      nT += 0.7 * cos(ph) * kV * inP; alb *= 1. - 0.55 * slot;
      groove = max(seam, line);
      nT += -0.9 * sign(a) * (exp(-sq((q - 0.80) / we)) - exp(-sq((q - 0.975) / we))) * min(1., 0.035 / (0.75 * aaA));
      alb *= mix(1., 1.35, lip);
    } else {
      // a ring: its two shoulders catch the light; its face is knurled
      // P3R: up close the lit edge was as wide as the ring (a flat pale crescent). It is a hairline on each shoulder: a
      // couple of pixels, whatever the size of the ring on screen. From afar (a ring a few pixels wide) it is what it was.
      float we = max(clamp(2.0 * aaA, 0.045, 0.16), 0.8 * aaA);
      edge = exp(-sq((q - 0.5) / we)) * min(1., 0.16 / (0.8 * aaA) + 0.3) * 0.8;
      float nk = floor(R * 26.) + 12., kK = smoothstep(1.2, 3., (6.2831853 / nk) / aaT) * (1. - smoothstep(0.35, 0.5, q));
      nB = 0.6 * cos(th * nk) * kK; alb *= 1. - 0.3 * kK * (0.5 + 0.5 * sin(th * nk));
      nT = -0.7 * sign(a) * smoothstep(0.35, 0.6, q);
    }
    vec3 tb = bn * cT - rf * sT;
    N = normalize(N + T * nT + tb * nB);
  } else if (uKind == 2) {
    vec3 T = normalize(vTint.rgb);
    vec3 rf = cross(T, vec3(0.31, 0.22, 0.925)); rf = dot(rf, rf) > 1e-3 ? normalize(rf) : normalize(cross(T, vec3(1., 0., 0.)));
    vec3 bn = cross(T, rf);
    float cT = dot(N, rf), sT = dot(N, bn), th = atan(sT, cT), R = max(vRad, 1e-3), seed = fract(vTint.a);      // CABLES: a seed of 2 or more marks a tie on a cable
    float aaS = max(fwidth(vAlong), 1e-4), aaT = max(fwidth(cT) + fwidth(sT), 1e-4);
    float SEG = 2.6 * R, q = vAlong / SEG, si = floor(q), sf = q - si;
    float h = hash21(vec2(si, seed * 91.7)), h2 = hash21(vec2(si + 17., seed * 37.1));
    float dj = min(sf, 1. - sf) * SEG;                                          // distance to the nearest joint
    groove = 1. - smoothstep(0.035 * R, 0.035 * R + aaS, dj);                   // the seam itself
    ridge = exp(-sq((dj - 0.11 * R) / max(0.03 * R, 0.7 * aaS))) * min(1., 0.03 * R / (0.7 * aaS));   // the lip beside it
    float nT = 0., nB = 0.;                                                     // tilt of the surface along the conduit and round it
    if (h < 0.34) {                                                             // ribbed: fine rings
      float per = 0.26 * R, k = smoothstep(1.3, 3.2, per / aaS), ph = 6.2831853 * vAlong / per;
      nT = 0.55 * cos(ph) * k; alb *= 1. - 0.30 * k * (0.5 + 0.5 * sin(ph));
    } else if (h < 0.66) {                                                      // fluted: grooves along its length
      float nf = 14. + floor(h2 * 3.) * 4., k = smoothstep(1.3, 3.2, (6.2831853 / nf) / aaT);
      nB = 0.60 * cos(th * nf) * k; alb *= 1. - 0.28 * k * (0.5 + 0.5 * sin(th * nf));
    } else {                                                                    // plated: panels with a line between them
      float np = 5. + floor(h2 * 4.), a = (th / 6.2831853 + 0.5) * np + h * 3., pi = floor(a), pf = a - pi;
      float dp = min(pf, 1. - pf) * 6.2831853 / np;                            // radians to the nearest panel line
      float line = 1. - smoothstep(0.012, 0.012 + aaT, dp);
      float hp = hash21(vec2(pi + si * 7., seed * 13.3));
      float half2 = step(0.55, hp) * (1. - smoothstep(0.02 * R, 0.02 * R + aaS, abs(sf - 0.5) * SEG));   // some panels are cut across once more
      groove = max(groove, max(line, half2) * smoothstep(0.6, 1.6, 0.012 / aaT + 0.4));
      alb *= 0.62 + 0.62 * hp;
      nB = (pf < 0.5 ? 1. : -1.) * 0.9 * exp(-sq(dp / max(0.03, 1.5 * aaT))) * smoothstep(0.5, 1.5, 0.03 / aaT);   // the edge of each plate is turned
    }
    // two hairline pipes strapped along the whole conduit
    for (int k = 0; k < 2; k++) {
      float tc = 6.2831853 * fract(seed * (3.7 + float(k) * 2.9)) - 3.14159265;
      float d = atan(sin(th - tc), cos(th - tc)), w = max(0.035, 1.2 * aaT), g = exp(-d * d / (w * w)) * min(1., 0.035 / (1.2 * aaT) + 0.25);
      nB += -1.6 * (d / w) * g; alb = mix(alb, 1.25, g * 0.6);
    }
    // a thin pipe or a cable, and any conduit far enough away, is a plain dark line: no joints, no plates, nothing that could
    // be read as dashes. The detail comes in as the conduit grows past a few pixels across.
    float det = smoothstep(1.6, 4.5, vRpx / uDpx);
    alb = mix(1., alb, det); groove *= det; ridge *= det; nT *= det; nB *= det;
    nT += -0.8 * sign(sf - 0.5) * ridge;
    vec3 tb = bn * cT - rf * sT;                                                // round the conduit
    N = normalize(N + T * nT + tb * nB);
  }
  if (dot(N, V) < 0.) N = -N;
  float nv = max(dot(N, V), 0.), fres = pow(1. - nv, 3.);
  // every shaft of light lights the scaffolding near it; dark, smooth, no glow of its own
  vec3 lite = vec3(0.); float i0 = 0., d0 = 0.;
  for (int i = 0; i < NSH; i++) {
    if (i >= (uKind == 0 ? max(uShNear, 1) : uShN)) break;      // LAYOUT-MERGE: a sheath answers every shaft that stands among the fibers (was: the first alone)
    vec3 toAx = uShP[i] - vWP; toAx -= uShD[i] * dot(toAx, uShD[i]);
    float dAx = length(toAx), reach = 34. + 3. * uShC[i].a;
    float ii = reach / (reach + dAx), dd = max(dot(N, normalize(toAx / max(dAx, 1e-3) + uShD[i] * 0.6)), 0.);
    if (uKind == 2) dd *= dd;                                  // metal: the light falls off quickly round the conduit, most of it stays dark
    lite += uShC[i].rgb * (ii * dd);
    if (i == 0 || (uKind == 0 && ii * dd > i0 * d0)) { i0 = ii; d0 = dd; }   // LAYOUT-MERGE: for a sheath, the shaft that lights it most
  }
  float d1 = max(dot(N, uStripDir), 0.);
  vec3 col; float a = 1.;
  if (uKind == 0) {            // a smooth dark membrane: rim only, no glow, no bands
    bool lane = vTint.a > 1.5;
    float empty = lane ? vTint.a - 2. : vTint.a;
    vec3 tint = mix(vec3(0.30, 0.36, 0.48), vTint.rgb, mix(0.30, 0.60, empty));
    float lit = 0.02 + 0.30 * i0 * d0 + 0.10 * d1;            // an empty sheath is unlit by data but still stands in the hall's light
    // MERGE: the layout's dark lanes (where fibers will lie in an empty or sparse form) are sheaths a few pixels wide.
    // Their bright rim is thinner than a pixel, so sampled as it is it comes out as a row of dots that crawls when the
    // lens moves. A lane too thin to show its rim is given the mean of the rim over its width instead: one even line
    // that carries the same light. (Across a round tube the mean of (1 - cos)^3 is 0.055, which is the mean opacity;
    // the colour is weighted by that opacity, which puts its mean at 0.12.) A sheath wide enough to resolve is untouched.
    float thick = smoothstep(2.0, 6.0, vRpx), fresA = mix(0.055, fres, thick), fresC = mix(0.12, fres, thick);
    // an empty sheath is a vessel of thin dark glass: nearly clear face on, a soft edge where it turns away. Never a flat disc.
    col = tint * (fresC * mix(0.05 + 0.20 * i0 * d0, 0.34, empty) + lit * mix(0.08, 0.20, empty));
    a = mix(0.03, 0.13, empty) + fresA * mix(0.26, 0.62, empty);
    // FOUNDER NOTE 1: the envelope of a full form is a hint of glass round the fibers, never a shape of its own. The larger
    // it stands on screen the fainter it is, so no big smooth rounded body can show behind the forms.
    if (!lane) { float big = smoothstep(26., 150., vRpx / uDpx); col *= mix(1., 0.30, big * (1. - empty)); a *= mix(1., 0.22, big * (1. - empty)); }
    if (lane) {
      // FIX V11/V37: a lane where a fiber will lie is a DASHED dark line in a quarter of the family's colour: a form with
      // no skills yet can be found on the plate and its label has a subject, and a dashed line can never be taken for
      // a fiber (a fiber is one unbroken line with a lit core). No glow, no bloom: its light is far under a resting core.
      float aaS = max(fwidth(vAlong), 1e-4), per = 5.2, f = fract(vAlong / per) * per;
      float dash = clamp((0.64 * per - f) / aaS, 0., 1.) * clamp(f / aaS, 0., 1.);
      float k = uLane * mix(0.22, 1., empty * empty) * dash;
      // FIX (last pass): flown past up close, the lanes of an empty form (Files, on the real feed) stood in the middle of the
      // frame as a lit lime grid that could be read as data. A lane is as faint close up as it is on the plate: the wider
      // it stands on screen the less it gives, and a high-luminance hue (lime, cyan) is brought down to the level of the others.
      vec3 lt = vTint.rgb * min(1., 0.30 / max(dot(vTint.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3));
      k *= mix(1., 0.32, smoothstep(1.6, 7.0, vRpx / uDpx));
      col += lt * (0.11 * k); a = max(a, 0.50 * k);
    }
    vec3 rd; float dd;
    col = misted(col, vWP, rd, dd);              // a thin membrane: what is behind it already carries the light of the air
    a *= exp(-length(vWP - uCam) * uFog * 0.6);
    o = vec4(col * a, a);
    return;
  } else if (uKind == 1) {     // tendon: pale, matte, unlit by data
    float grain = 0.55 + 0.9 * vnoise(vWP * 0.9 + 7.7) * vnoise(vWP * vec3(0.21, 0.21, 0.21) + 1.3) * 2.;   // sinew, not plastic
    col = (vec3(0.10, 0.105, 0.125) * (0.04 + 0.26 * d1 * d1) + vec3(0.11, 0.12, 0.14) * lite * 1.2) * grain + vec3(0.16, 0.17, 0.21) * fres * fres * 0.30;
  } else {                     // far architecture: dark cool metal. It catches the shafts, and its edges and details catch the lens
    float wear = 0.55 + 0.9 * vnoise(vWP * vec3(0.060, 0.011, 0.060) + 3.1);       // never one flat tone from top to bottom
    vec3 Hh = normalize(uStripDir + V);
    float sp = pow(max(dot(N, Hh), 0.), 36.);                                      // a hairline of the lens's own light on every turned edge
    col = vec3(0.0100, 0.0125, 0.0215) * (0.20 + 0.80 * d1) * alb + vec3(0.050, 0.058, 0.085) * lite * (0.9 * wear * alb) + lite * (fres * fres * 0.24);
    col += vec3(0.040, 0.052, 0.090) * (sp * alb * 1.6) + vec3(0.030, 0.040, 0.076) * ridge * (0.35 + 0.65 * d1) * 2.2;      // P3R: the seams and turned edges of the far architecture catch more of the lens's light (1.6 and 2.2 times): the background is not empty. Still no light of its own
    col += vec3(0.0070, 0.0100, 0.0240) * fres * alb;
    col *= 1. - 0.85 * groove;
    // CABLES: a tie clamped on a cable is the same dark metal, turned and polished: its edge carries one hairline of the
    // lens's light and a thin cool rim, so a cable reads as bound and segmented. No family colour, no light of its own.
    if (tie) {
      // PASS3 (T1): turned and polished. One glint of the lens's light where the part faces it, a lit edge on every shoulder,
      // a thin cool rim. The face itself stays dark graphite, so the part is never brighter than the glass it holds.
      float d2 = max(dot(N, normalize(uStripDir + vec3(0., 0.6, 0.))), 0.);
      // (second sitting) On bright glass a black part is the loudest thing there is: a row of them read as staples. The face is
      // now satin steel: a broad soft sheen toward the lens, three times the level it had, still far under the glass
      // it holds, and the lips carry a clear bright edge. Neutral: grey with a breath of blue.
      float nv = max(dot(N, V), 0.);
      // (looked at in the final inside frame and the strata at 93 s: at that level the sleeves and the flat clamps were pale and
      // drew the eye. Two thirds of it: dark steel that still shows its form.)
      // P3R: the larger a part stands on screen the less sheen its face carries: a near sleeve was a flat pale-grey crescent,
      // the loudest thing on its cable. Near, the face is graphite and only the edges and the cut lines carry light.
      float bigT = smoothstep(4., 16., vRpx / uDpx), satT = mix(1., 0.16, bigT), frsT = mix(1., 0.22, bigT);
      col = vec3(0.019, 0.021, 0.027) * (0.55 + 0.45 * d1) * alb * mix(1., 0.55, bigT) + vec3(0.040, 0.046, 0.068) * lite * (0.6 * alb * satT) + vec3(0.030, 0.033, 0.042) * (nv * nv * alb * satT) + vec3(0.022, 0.024, 0.031) * (fres * alb * frsT);
      col += vec3(0.20, 0.22, 0.27) * pow(max(dot(N, Hh), 0.), 70.) * (0.4 + 0.6 * alb) * mix(1., 0.45, bigT);
      col += vec3(0.38, 0.41, 0.48) * edge * (0.22 + 0.78 * d2 * d2);
      col += (vec3(0.016, 0.019, 0.027) * fres + vec3(0.07, 0.08, 0.10) * lite * fres) * frsT;
      col *= 1. - 0.88 * groove;
      if (!gl_FrontFacing) col *= 0.12;                       // the inside of a sleeve is in the dark
      col *= mix(1., uDim, 0.92);                             // P3R: the same step back as the glass of the fibers it holds (GLASS, dimG)
    }
    o = vec4(fogged(col, vWP), 1.);              // and it dissolves into the air like everything else that is far
    return;
  }
  o = vec4(fogged(col, vWP), 1.);
}
`,
};

export const TUBE_TIE = { vs: TUBE.vs, fs: TUBE.fs.replace(HEAD, HEAD + '#define TIE_CUT\n') };      // PASS3 (T8): the ties' variant (see TUBE)

// ---------------------------------------------------------------- background and dust
const FS_TRI = HEAD + `
out vec2 vUV;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUV = p; gl_Position = vec4(p * 2. - 1., 1., 1.); }
`;

export const BACKGROUND = {
  vs: FS_TRI,
  fs: HEAD + AIR + `
in vec2 vUV;
uniform mat3 uCamRot;   // right, up, back
uniform vec2 uTan;      // tan(fov/2) * aspect, tan(fov/2)
uniform float uMist;
uniform float uBase;    // FIX V13: the far mist by direction, 1 in the interior, 0 on the specimen plate (a black ground)
uniform vec3 uMistC;    // MERGE: the middle the shells of mist stand round
uniform vec3 uMistS;    // MERGE: radius of the first shell, step out to the second, and the scale of the banks (1 at the light lane's own 320)
out vec4 o;
float fbm2(vec3 p) { return vnoise(p) * 0.62 + vnoise(p * 2.6 + 4.7) * 0.38; }
void main() {
  vec2 ndc = vUV * 2. - 1.;
  vec3 rd = normalize(uCamRot * vec3(ndc * uTan, -1.));
  // the far mist, by direction: slow banks of violet and hollows of teal
  vec3 q = rd * 1.7 + vec3(0., uTime * 0.003, 0.);
  float n = fbm2(q), m = vnoise(rd * 1.1 + 21.3);
  vec3 c = mistBase(rd);
  c = mix(c, vec3(0.016, 0.006, 0.028), smoothstep(0.52, 0.85, m) * 0.6);
  c = mix(c, vec3(0.002, 0.016, 0.020), smoothstep(0.48, 0.15, m) * 0.5);
  c *= (0.12 + 2.4 * n * n * n) * uBase;      // (PASS3, T7: uBase carries LOOK.airBase)
  // nearer banks with parallax: two shells of mist round the anatomy. Each is lit by the shafts that pass through it,
  // so the air has depth and the background is never one flat tone.
  // MERGE: the shells stand round uMistC at uMistS.x and uMistS.x + uMistS.y, and everything measured on them scales with
  // uMistS.z, so the banks keep their apparent size (the light lane's numbers: round the origin, 320 and 560, scale 1).
  vec3 oc = uCam - uMistC;
  float b0 = dot(oc, rd), c0 = dot(oc, oc), ms = max(uMistS.z, 1e-3);
  for (int k = 0; k < 2; k++) {
    float R = uMistS.x + uMistS.y * float(k);
    float t = -b0 + sqrt(max(b0 * b0 - c0 + R * R, 0.));
    vec3 p = (oc + rd * t) / ms;                               // on the shell, in the light lane's own units
    float dens = mix(vnoise(p * (0.011 - 0.003 * float(k)) + vec3(float(k) * 7.3, uTime * 0.004, 0.)), m, 0.25);
    dens = smoothstep(0.50, 0.86, dens);
    vec3 glow = vec3(0.); float by = 0.;
    for (int i = 0; i < NSH; i++) {
      if (i >= uShN) break;
      vec3 w = p - (uShP[i] - uMistC) / ms; w -= uShD[i] * dot(w, uShD[i]);
      float fall = 1. / (1. + dot(w, w) / (60. * 60.));
      glow += uShC[i].rgb * fall; by = max(by, fall * step(1e-4, dot(uShC[i].rgb, vec3(1.))));
    }
    vec3 tint = mix(vec3(0.004, 0.020, 0.026), vec3(0.018, 0.010, 0.040), smoothstep(-120., 160., p.y + p.x * 0.4));
    // FIX V07/V26: a bank of mist has a tone of its own only beside a shaft of light (by: 1 on a shaft, falling away from it).
    // Away from the shafts it is black air.
    c += (tint * (0.15 * by) + glow * 0.030) * (dens * uMist * (1. - 0.22 * float(k)));
  }
  for (int i = 0; i < NSH; i++) { if (i >= uShN) break; c += shaftOpen(i, uCam, rd); }
  o = vec4(c, 1.);
}
`,
};

// Dust motes: they catch the light of whatever shaft they drift through, and out of focus they open into soft discs.
export const DUST = {
  vs: HEAD + `
layout(location=0) in vec4 aP;   // xyz, seed
uniform mat4 uView, uProj;
uniform vec2 uViewport;
uniform vec3 uCam;
uniform float uTime, uFog;
uniform vec4 uDof;               // focus distance, aperture (half-res px), max near, max far
uniform float uPxScale;          // 2 when drawing into the full-resolution image, 1 into the half-resolution one
#define NSH 4
uniform int uShN;
uniform vec3 uShP[NSH];
uniform vec3 uShD[NSH];
uniform vec4 uShC[NSH];
uniform vec4 uShH[NSH];
out vec4 vC; out float vSoft;
void main() {
  vec3 p = aP.xyz;
  p += vec3(sin(uTime * 0.05 + aP.w * 40.), cos(uTime * 0.04 + aP.w * 31.), sin(uTime * 0.045 + aP.w * 17.)) * 2.5;
  vec4 vp = uView * vec4(p, 1.);
  float d = max(-vp.z, 0.05);
  float ppu = uProj[1][1] * uViewport.y * 0.5 / d;
  float coc = abs(clamp(uDof.y * (d - uDof.x) / d, -uDof.z, uDof.w)) * uPxScale;   // px of the target
  float core = max((0.030 + 0.030 * fract(aP.w * 13.7)) * ppu, 0.45 * uPxScale);
  float size = core + coc;
  vec3 lit = vec3(0.020, 0.024, 0.034);
  for (int i = 0; i < NSH; i++) {
    if (i >= uShN) break;
    vec3 w = p - uShP[i]; float h = dot(w, uShD[i]); w -= uShD[i] * h;
    float d2 = dot(w, w), sc = uShC[i].a, sh = uShH[i].x;
    float fall = smoothstep(uShH[i].z, uShH[i].z + 170., h) * (1. - smoothstep(uShH[i].w - 280., uShH[i].w, h));
    lit += uShC[i].rgb * ((3.0 * exp(-d2 / (2. * sc * sc * 2.2)) + 0.30 * exp(-d2 / (2. * sh * sh))) * fall);
  }
  float a = pow(core / size, 1.45) * exp(-d * uFog * 2.2) * smoothstep(1.5, 6., d);       // a wide soft disc keeps a little more than the inverse square would leave it
  vC = vec4(lit * mix(vec3(0.80, 0.90, 1.0), vec3(1.0, 0.86, 0.66), fract(aP.w * 7.3)) * a, 1.);
  vSoft = clamp(coc / size, 0., 1.);
  gl_Position = uProj * vp;
  gl_PointSize = min(size * 2. + 2., 60. * uPxScale);
}
`,
  fs: HEAD + `
in vec4 vC; in float vSoft; out vec4 o;
uniform sampler2D uDepth; uniform vec2 uInvRes; uniform float uTest;
void main() {
  if (uTest > 0.5 && gl_FragCoord.z > texture(uDepth, gl_FragCoord.xy * uInvRes).r) discard;      // hidden behind something solid
  float r = length(gl_PointCoord * 2. - 1.);
  // in focus: a small soft point. Out of focus: an even disc with a slightly brighter edge, the way a lens draws it.
  float a = mix(exp(-r * r * 3.2), (1. - smoothstep(0.86, 1., r)) * (0.82 + 0.30 * r * r), vSoft);
  o = vec4(vC.rgb * a, 0.);
}
`,
};

// ---------------------------------------------------------------- post chain
const DEPTH = `
uniform vec2 uNF;
uniform vec4 uDof;   // focus distance, aperture (half-res px), max near, max far
float viewZ(float d) { float z = d * 2. - 1.; return 2. * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
float cocOf(float d) { float z = viewZ(d); return clamp(uDof.y * (z - uDof.x) / z, -uDof.z, uDof.w); }
`;

// half resolution: colour + signed circle of confusion (negative = in front of focus)
export const PREFILTER = {
  vs: FS_TRI,
  fs: HEAD + DEPTH + `
in vec2 vUV; uniform sampler2D uScene, uDepth; uniform vec2 uTexel; out vec4 o;
void main() {
  vec4 d = vec4(texture(uDepth, vUV + uTexel * vec2(-0.5, -0.5)).r, texture(uDepth, vUV + uTexel * vec2(0.5, -0.5)).r,
                texture(uDepth, vUV + uTexel * vec2(-0.5, 0.5)).r, texture(uDepth, vUV + uTexel * vec2(0.5, 0.5)).r);
  vec3 c = texture(uScene, vUV).rgb;                 // bilinear at the 2x2 centre = box filter
  float cn = cocOf(min(min(d.x, d.y), min(d.z, d.w))), ca = (cocOf(d.x) + cocOf(d.y) + cocOf(d.z) + cocOf(d.w)) * 0.25;
  o = vec4(min(c, vec3(40.)), cn < 0. ? min(cn, ca) : ca);
}
`,
};

// Near field, step 1: the largest foreground blur radius inside each 4 x 4 tile of the half-resolution image.
export const NEAR_MAX = {
  vs: FS_TRI,
  fs: HEAD + `
in vec2 vUV; uniform sampler2D uPre; out vec4 o;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy) * 4, lim = textureSize(uPre, 0) - 1;
  float m = 0.;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) m = max(m, -texelFetch(uPre, min(b + ivec2(i, j), lim), 0).a);
  o = vec4(m, 0., 0., 1.);
}
`,
};
// Near field, step 2: spread each tile's radius over the tiles it can reach. The result says, smoothly and for every
// pixel, how far it must look to find something soft and close hanging over it. No blocks, no six-point probes.
export const NEAR_SPREAD = {
  vs: FS_TRI,
  fs: HEAD + `
in vec2 vUV; uniform sampler2D uTile; out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), lim = textureSize(uTile, 0) - 1;
  float m = 0.;
  for (int j = -5; j <= 5; j++) for (int i = -5; i <= 5; i++) {
    float r = texelFetch(uTile, clamp(c + ivec2(i, j), ivec2(0), lim), 0).r;      // half-res px
    float d = max(length(vec2(i, j)) - 1.0, 0.) * 4.;                             // nearest edge of that tile, half-res px
    m = max(m, r * smoothstep(r + 3., r - 1., d));
  }
  o = vec4(m, 0., 0., 1.);
}
`,
};

// half resolution: scatter-as-gather bokeh on a fixed golden spiral. Every tap reads a mip matched to the spacing between
// taps, so the disc is filled rather than dotted and needs no per-pixel jitter: nothing boils, nothing blotches.
// rgb = blurred, a = how much of it to use.
export const GATHER = {
  vs: FS_TRI,
  fs: HEAD + `
in vec2 vUV; uniform sampler2D uPre, uNear; uniform vec2 uTexel; uniform vec4 uDof; uniform int uTaps; out vec4 o;
void main() {
  vec4 c0 = texture(uPre, vUV);
  float coc0 = c0.a, nearR = texture(uNear, vUV).r;
  float R = max(abs(coc0), nearR * 0.96);
  if (R < 0.45) { o = vec4(c0.rgb, 0.); return; }
  // Behind the plane of focus the picture is soft already (mist, far structure), so it needs fewer taps from a coarser mip.
  // In front of it, thin bright fibers are being spread wide: those get every tap.
  int taps = nearR < 0.5 && coc0 > 0. ? (uTaps * 5) / 8 : uTaps;
  float n = float(taps);
  float lod = clamp(log2(R * 1.9 / sqrt(n)) + 0.35, 0., 3.2);
  vec3 acc = c0.rgb * 0.6; float ws = 0.6, wNear = 0.;
  vec2 dir = vec2(1., 0.);
  const mat2 rot = mat2(-0.7373688, 0.6754903, -0.6754903, -0.7373688);      // the golden angle
  for (int i = 0; i < 64; i++) {
    if (i >= taps) break;
    float rr = sqrt((float(i) + 0.5) / n), dist = rr * R;
    vec4 sm = textureLod(uPre, vUV + dir * (dist * uTexel), lod);
    float reach = sm.a < coc0 - 0.25 ? abs(sm.a) : min(abs(sm.a), abs(coc0));   // nearer samples spread freely; farther ones never onto a sharper centre
    float w = smoothstep(dist - 1.5, dist + 0.5, reach + 0.5);
    acc += sm.rgb * w; ws += w;
    wNear += sm.a < -0.6 ? w : 0.;
    dir = rot * dir;
  }
  o = vec4(acc / ws, clamp(max(smoothstep(0.45, 1.5, abs(coc0)), 2.0 * wNear / n), 0., 1.));
}
`,
};
// A 3 x 3 tent over the gather: what little pattern the spiral leaves is gone before anything reads it.
export const DOF_SOFT = {
  vs: FS_TRI,
  fs: HEAD + `
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 o;
void main() {
  vec2 t = uTexel;
  vec4 c = texture(uTex, vUV) * 4.;
  c += (texture(uTex, vUV + t * vec2(-1, 0)) + texture(uTex, vUV + t * vec2(1, 0)) + texture(uTex, vUV + t * vec2(0, -1)) + texture(uTex, vUV + t * vec2(0, 1))) * 2.;
  c += texture(uTex, vUV + t * vec2(-1, -1)) + texture(uTex, vUV + t * vec2(1, -1)) + texture(uTex, vUV + t * vec2(-1, 1)) + texture(uTex, vUV + t * vec2(1, 1));
  o = c / 16.;
}
`,
};

// bloom: soft-knee prefilter, 13-tap downsample, tent upsample
export const BLOOM_PRE = {
  vs: FS_TRI,
  fs: HEAD + `
in vec2 vUV; uniform sampler2D uPre, uDofTex; uniform float uKnee; out vec4 o;
void main() {
  vec4 p = texture(uPre, vUV), d = texture(uDofTex, vUV);
  vec3 c = mix(p.rgb, d.rgb, d.a);
  float l = max(c.r, max(c.g, c.b));
  float lc = l < 3. ? l : 3. + (l - 3.) * 0.45;      // white-hot cores and bands bloom more than the rest, but never so much that they drown their own glass
  float soft = clamp(lc - uKnee + 0.5, 0., 1.); soft = soft * soft * 0.5;
  o = vec4(c * max(soft, lc - uKnee) / max(l, 1e-4), 1.);
}
`,
};
export const BLOOM_DOWN = {
  vs: FS_TRI,
  fs: HEAD + `
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 o;
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uTex, vUV + t * vec2(-2, -2)).rgb, b = texture(uTex, vUV + t * vec2(0, -2)).rgb, c = texture(uTex, vUV + t * vec2(2, -2)).rgb;
  vec3 d = texture(uTex, vUV + t * vec2(-2, 0)).rgb, e = texture(uTex, vUV).rgb, f = texture(uTex, vUV + t * vec2(2, 0)).rgb;
  vec3 g = texture(uTex, vUV + t * vec2(-2, 2)).rgb, h = texture(uTex, vUV + t * vec2(0, 2)).rgb, i = texture(uTex, vUV + t * vec2(2, 2)).rgb;
  vec3 j = texture(uTex, vUV + t * vec2(-1, -1)).rgb, k = texture(uTex, vUV + t * vec2(1, -1)).rgb, l = texture(uTex, vUV + t * vec2(-1, 1)).rgb, m = texture(uTex, vUV + t * vec2(1, 1)).rgb;
  o = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.);
}
`,
};
export const BLOOM_UP = {
  vs: FS_TRI,
  fs: HEAD + `
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uGain; out vec4 o;
void main() {
  vec2 t = uTexel;
  vec3 c = texture(uTex, vUV).rgb * 4.;
  c += (texture(uTex, vUV + t * vec2(-1, 0)).rgb + texture(uTex, vUV + t * vec2(1, 0)).rgb + texture(uTex, vUV + t * vec2(0, -1)).rgb + texture(uTex, vUV + t * vec2(0, 1)).rgb) * 2.;
  c += texture(uTex, vUV + t * vec2(-1, -1)).rgb + texture(uTex, vUV + t * vec2(1, -1)).rgb + texture(uTex, vUV + t * vec2(-1, 1)).rgb + texture(uTex, vUV + t * vec2(1, 1)).rgb;
  o = vec4(c / 16. * uGain, 1.);
}
`,
};

// Streaming light. From every pixel, march across the screen toward the place the first shaft's light comes from, and at each
// step ask how much of the beam's lit air is in front of whatever is drawn there (the same closed-form integral, stopped at the
// depth buffer). Where fibers stand before the beam the answer is nothing, so they cut real streaks of shadow into the light.
// No colour is read, so nothing bright in the picture can leak into the rays.
export const SHAFTS = {
  vs: FS_TRI,
  fs: HEAD + AIR + `
in vec2 vUV; uniform sampler2D uDepth; uniform vec2 uLight, uNF, uTan; uniform mat3 uCamRot; uniform float uAspect, uStrength; out vec4 o;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float viewZ(float d) { float z = d * 2. - 1.; return 2. * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
void main() {
  const int N = 24;
  vec2 delta = (uLight - vUV) * (0.94 / float(N));
  vec2 uv = vUV + delta * ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.); float w = 1., ws = 0.;
  for (int i = 0; i < N; i++) {
    vec2 c = clamp(uv, vec2(0.002), vec2(0.998));
    vec3 rd = normalize(uCamRot * vec3((c * 2. - 1.) * uTan, -1.));
    float t = viewZ(texture(uDepth, c).r) / max(-dot(rd, uCamRot[2]), 0.05);
    acc += shaft(0, uCam, rd, t) * w; ws += w;
    w *= 0.95; uv += delta;
  }
  vec2 dl = (vUV - uLight) * vec2(uAspect, 1.);
  vec3 r = acc / ws * uStrength / (1. + dot(dl, dl) * 1.2);
  o = vec4(r / (1. + 1.6 * max(r.r, max(r.g, r.b))), 1.);      // a soft ceiling: streaming light is an accent, never a wash
}
`,
};

// full resolution: depth of field composite, bloom, shafts, filmic tonemap, vignette, grain
export const FINAL = {
  vs: FS_TRI,
  fs: HEAD + DEPTH + `
in vec2 vUV;
uniform sampler2D uScene, uDepth, uDofTex, uBloom, uShafts;
uniform sampler2D uWide;           // FIX V01/V27: the half-resolution picture with its mips: a wide average of the light round this pixel
uniform vec4 uComp;                // mip to read, the level above which the picture is locally stopped down, how hard, size of one texel of that mip
uniform float uExposure, uBloomK, uTime, uGrain, uVignette;
uniform vec2 uRes;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform vec3 uCam, uRayP, uRayD;   // the shaft whose light streams: a point on its axis and its direction
uniform vec3 uRoom;                // INTRO R2: z the lift of the frame's highlights on a hit of the track (0 outside it: nothing changes). INTRO: x the light of the whole room (the music's breath, the flash on the hit, the breath before it), y how far the frame is up from the page's black. (1, 1) outside the intro and in every still
uniform sampler2D uMark;           // FIX V17: the words MOCK DATA, drawn into the picture itself while an invented feed is loaded (r: letters, g: their dark ground)
uniform vec4 uMarkR;               // where: x, y, width, height in pixels of the frame (the line runs up the left edge); width 0 means no mark
// INTRO LEGIBLE: the words of the opening (one line or one card at a time, intro.js), laid in after the grade so that nothing
// in the scene can stand in front of a letter and no bloom or depth of field can soften one; under them a feathered shade.
uniform sampler2D uWord;           // its letters (alpha), drawn once in a 2D canvas
uniform mat3 uWordH;               // the frame (ndc x, y, 1) to its texture (u s, v s, s): the projection of its quad, inverted
uniform vec4 uWordA;               // x: how much of it shows (0: no words, nothing of this runs), y: how far it has drawn itself, zw: where the ink lies in u
uniform vec4 uWordC;               // rgb: its colour on the screen; w: 0 as seen, 1 the letters alone white on black (lab measure), 2 without the shade (lab)
uniform vec4 uWordS;               // xy: its texture in pixels, z: the feather of the shade in those pixels, w: the strongest the shade may be
uniform vec4 uWordB;               // the ink inside its texture (u0, v0, u1, v1)
uniform vec4 uWordK;               // the block in the frame (centre and half size, in vUV) over which the light behind it is read
uniform vec2 uWordL;               // x: the mip of the half-resolution picture read there, y: the luminance on the screen the shade brings the picture behind down to
out vec4 o;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 c) {   // Hill's ACES fit: bright colours roll off to white instead of clipping
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * c;
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
  c = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c;
  return clamp(c, 0., 1.);
}
// REPAIR (R2): the lit air. The air between the forms was black, so nothing stood behind anything and nothing read as
// far. Light now scatters in the air round whatever is bright: the picture itself, averaged over three widths (2.5, 8 and
// 23 percent of the frame height, from the mips of the half-resolution picture), is laid back over it. So the glow is in
// the colour of the bundle that makes it, the gold makes the most of it, it falls away with distance from the fiber, and
// where nothing is lit the air stays black: there is no level under it. How much of it a pixel takes depends on how much
// air lies before its first surface (uAir.y: the depth at which the air carries about two thirds of its light): a near
// bundle keeps the dark between its strands, a far form sinks into the tone of what stands round and behind it, and open
// air takes it whole. Banks and hollows fixed in the world, drifting very slowly, keep it from being even. It is light
// in the air, never a fiber: no strand, no band, nothing countable, and the specimen plate has none (black ground).
uniform float uAirMax, uAirSat, uAirPivot;
uniform vec4 uAir;                 // x: the mip whose texel is uAir.w of the frame height, y: depth of the air, z: gain (0: none), w: that texel
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 wideAt(float lod, float tex) {      // four taps half a texel out: a tent over the mip, so no texel of it shows
  vec2 d = tex * vec2(uRes.y / uRes.x, 1.) * 0.5;
  return 0.25 * (textureLod(uWide, vUV + d, lod).rgb + textureLod(uWide, vUV - d, lod).rgb + textureLod(uWide, vUV + vec2(d.x, -d.y), lod).rgb + textureLod(uWide, vUV + vec2(-d.x, d.y), lod).rgb);
}
vec3 litAir(vec3 rd, float ts) {
  vec3 a1 = wideAt(uAir.x, uAir.w), a2 = wideAt(uAir.x + 1.6, uAir.w * 3.03), a3 = wideAt(uAir.x + 3.2, uAir.w * 9.19);
  vec3 air = a1 * 0.44 + a2 * 0.46 + a3 * 0.10;      // CABLES: the widest of the three carried 0.22: a low even level over the whole frame wherever a bright form was in it (the darkest tenth at 13 to 16). Light near a bundle, black away from it
  // CABLES (second check: the glow read as violet-tinted air on the real feed, and the darkest tenth rose where one form
  // fills the frame). Two things. Where the picture round a pixel is already bright (a form filling the frame), the light
  // is on the glass and the gaps between the strands keep their dark: the air takes less of it. And scattered light pales:
  // the glow keeps three quarters of the colour of what makes it and leans to the warm key, so it is light near a
  // bundle and never the violet of the room laid over the frame.
  // P3R (the slab round a replayed bundle): the middle width limited itself (5.5 x its own level), so round one very bright
  // bundle in a dark frame the glow was the same everywhere inside the reach of that width and stopped where it stopped:
  // a block with an edge. The light of the middle width now counts against itself only as far as the widest one
  // carries it too (a form that fills the frame, as before). What it has over the widest is a source close by, and the
  // glow of a source falls away with distance from it: brightest on the bundle, gone at the end of its reach, no edge.
  { float l2 = dot(a2, vec3(0.2126, 0.7152, 0.0722)), l3 = dot(a3, vec3(0.2126, 0.7152, 0.0722)); air /= 1. + (5.5 * min(l2, l3) + 13. * l3) * uExposure; }      // (a2: the form itself; a3, a quarter of the frame wide: a form that fills the frame)
  // PASS3 (T6): scattered light is the colour of what it comes from. It was the wide average paled by a quarter and leaned
  // to the warm key, which beside the river came out as a brown-mauve patch (dim gold, greyed, over the violet of the room).
  // The air now carries the luminance of the wide light in the hue of the nearest source at full strength: amber beside
  // the river, cyan beside the veil, blue beside the fan. Nothing is added where there is no source.
  // P3R: between two sources (the river and the violet rope at 2000 x 1250) the hue was their plain mix, a mauve. Each of
  // the three widths now counts by its own brightness: beside a source the narrow one is far the brightest and the air is
  // that source's colour; in the open between two, the widest carries the most light and it is the colour of whatever
  // leads that part of the frame (the river, wherever it is near). The change from one to the other is as wide as the air.
  { const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    vec3 src = a1 * dot(a1, LW) + a2 * (1.5 * dot(a2, LW)) + a3 * (6. * dot(a3, LW));
    float m = max(src.r, max(src.g, src.b)), L = dot(air, LW);
    vec3 hue = m > 1e-6 ? src / m : vec3(1.);
    hue = max(mix(vec3(dot(hue, LW)), hue, uAirSat), 0.02);
    air = hue * (L / max(dot(hue, LW), 0.05)); }
  vec3 pw = uCam + rd * min(ts, 260.);
  float n = 0.62 * vn3(pw * 0.011 + vec3(0., uTime * 0.004, 3.1)) + 0.38 * vn3(pw * 0.031 + vec3(7.7, 0., uTime * 0.006));
  air *= uAir.z * mix(0.10, 1., 1. - exp(-ts / uAir.y)) * (ts < 2000. ? 0.6 : 1.) * (0.45 + 1.3 * n * n);      // (open air takes it whole; a surface, however far, a little less, so a form that fills the frame keeps its blacks)
  // a soft ceiling: scattered light is never a wash (uAirMax follows the exposure, so a dim body opened up by the lens
  // has the same air on the screen as a full one)
  // PASS3 (T6/T7): no uniform lift. The air is given contrast about a low pivot: light that is already there (near a
  // bundle) comes up to twice as strong, and the faint level far from any source goes down toward black with it.
  // P3R: the curve is steeper under the pivot (the square), and the lit air is no longer put through the cut of the dim
  // in main(): that cut ended the skirt of every glow at one level, and round a lone bright bundle (a burst replay) the
  // end was a hard edge in the shape of the wide average. The air now goes to black by itself, with no edge anywhere.
  { float L2 = dot(air, vec3(0.2126, 0.7152, 0.0722)), Lp = uAirMax * uAirPivot; air *= 2. * L2 * L2 / (L2 * L2 + Lp * Lp); }
  float v = max(air.r, max(air.g, air.b));
  return air / (1. + v / uAirMax);
}
void main() {
  vec3 sharp = texture(uScene, vUV).rgb;
  float dep = texture(uDepth, vUV).r, coc = cocOf(dep);
  vec4 dof = texture(uDofTex, vUV);
  vec3 col = mix(sharp, dof.rgb, max(smoothstep(0.5, 1.5, abs(coc)), dof.a));
  // FIX V01: bloom limits itself. A lone fiber's halo is faint and passes whole; where a dense bundle would stack halo on
  // halo the sum is rolled off, so it cannot wash the glass out.
  vec3 bl = texture(uBloom, vUV).rgb;
  col += bl * (uBloomK / (1.0 + 0.6 * dot(bl, vec3(0.2126, 0.7152, 0.0722))));
  // The streaming light is in the air round its shaft. A surface nearer than the shaft has none of that air in front of it,
  // so it receives none: fibers before the light stay as true dark silhouettes, and nothing veils the frame.
  vec2 ndc = vUV * 2. - 1.;
  vec3 rd = normalize(uCamRot * vec3(ndc * uTan, -1.));
  vec3 w0 = uCam - uRayP, wp = w0 - uRayD * dot(w0, uRayD), rp = rd - uRayD * dot(rd, uRayD);
  float tc = -dot(wp, rp) / max(dot(rp, rp), 0.02);
  float ts = viewZ(dep) / max(-dot(rd, uCamRot[2]), 0.05);
  vec2 qo = 2.2 / uRes;                                        // the march is jittered per pixel: four taps average that grain away
  vec3 rays = 0.25 * (texture(uShafts, vUV + qo).rgb + texture(uShafts, vUV - qo).rgb + texture(uShafts, vUV + vec2(qo.x, -qo.y)).rgb + texture(uShafts, vUV + vec2(-qo.x, qo.y)).rgb);
  // CABLES: the streaming light is dusty: streaks fixed in the world along the shaft, drifting slowly, so a shaft is a
  // beam in dust and never a pale smooth column
  vec3 ps = uCam + rd * clamp(tc, 0., 900.);
  rays *= 0.50 + 1.0 * vn3(vec3(ps.x * 0.085, ps.y * 0.011 - uTime * 0.01, ps.z * 0.085)) * (0.6 + 0.8 * vn3(ps * vec3(0.31, 0.02, 0.31) + 4.4));
  col += rays * smoothstep(tc - 26., tc + 6., ts);
  vec3 airC = uAir.z > 0. ? litAir(rd, ts) * uExposure : vec3(0.);      // REPAIR (R2)   // P3R: kept apart until after the cut of the dim
  col *= uExposure;
  // PASS3 (T7): the air falls away toward the corners of the frame. Only what is dim there (air, mist, far structure) is
  // taken down; a form in a corner keeps all of its light. The open corners are where the darkest tenth of a full frame
  // lies, and they are black.
  { float cv = smoothstep(0.56, 1.0, length((vUV - 0.5) * vec2(1.15, 1.35)) * 1.35), lc = dot(col + airC, vec3(0.2126, 0.7152, 0.0722));
    // (second sitting) and a little of the same everywhere: with the page's cards (luminance 11 to 12, a sixth of the pane)
    // in the frame, a full frame such as the rail at 8 s still had its darkest tenth at 11. What is dim (the mist between
    // far forms, under a display level of about 20) goes down by up to seven tenths over the whole frame; anything brighter,
    // the lit air beside a form included, is untouched, so the lit share of the frame is what it was.
    float cvK = 0.94 * cv * (1. - smoothstep(0.014, 0.085, lc));
    col = col * (1. - max(cvK, 0.70 * (1. - smoothstep(0.008, 0.016, lc)))) + airC * (1. - cvK); }
  // FIX V01/V27: a busy body holds its colour. Where the light averaged over a wide patch of the picture is far above what
  // any resting bundle gives (a dense braid of proven fibers), the picture is stopped down there, as a printer burns in a
  // hot corner of a negative: cores stay bright, the dark between the strands comes back, gold stays gold. The patch is
  // much wider than a fiber, so one proven fiber alone (the real feed today) is nowhere near the level and is untouched.
  vec2 wt = uComp.ww * vec2(uRes.y / uRes.x, 1.) * 0.5;
  vec3 wide = textureLod(uWide, vUV + wt, uComp.x).rgb + textureLod(uWide, vUV - wt, uComp.x).rgb
            + textureLod(uWide, vUV + vec2(wt.x, -wt.y), uComp.x).rgb + textureLod(uWide, vUV + vec2(-wt.x, wt.y), uComp.x).rgb;
  float wl = dot(wide, vec3(0.2126, 0.7152, 0.0722)) * 0.25;
  col /= 1. + uComp.z * max(wl - uComp.y, 0.);
  vec2 q = vUV - 0.5;
  col *= 1. - uVignette * smoothstep(0.25, 1.05, length(q * vec2(1.15, 1.35)) * 1.35);
  col *= 1.35;
  // Up to about the level of a resting core the filmic curve is applied to the brightest channel and the others follow, so a
  // gold thread stays gold instead of sliding to khaki. Above that it blends to the per-channel curve: bright light pales and
  // burns to white (practised and proven cores, bands, highlights, glints).
  // FIX V01/V27: the hue is held far longer than it was (the blend to the per-channel curve ran from 1.2 to 3.4 and went all
  // the way), and the pull to white is capped: a proven core lands on pale gold, only bands and glints reach white.
  float mx = max(col.r, max(col.g, col.b));
  float cm = (mx * (2.51 * mx + 0.03)) / (mx * (2.43 * mx + 0.59) + 0.14);
  col = mix(col * (cm / max(mx, 1e-5)), aces(col), 0.55 * smoothstep(4.0, 14.0, mx));
  col = max(col - 0.0035, 0.);                                 // FIX V07: a toe. The last trace of veil goes to black
  // FOUNDER NOTE 1 (last pass): the toe cut the skirt of every dim soft thing off at its steepest part, and the display curve
  // (a power of 0.45, vertical at zero) then drew that cut as a hard edge: a soft shaft of violet light stood behind the
  // lattice as a solid smooth column. The toe now leaves black with no slope, so a shaft feathers out over the outer part
  // of its width and far structure sinks into the air instead of ending. Nothing is lifted: black is black exactly where
  // it was, and everything above the toe is a touch darker (0.002 at most).
  col = col * col / (col + 0.002);
  col = pow(clamp(col, 0., 1.), vec3(1. / 2.2));
  col = mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 1.20);   // a little chroma back after the filmic roll-off
  float tq = floor(uTime * 24.);
  float g = h12(gl_FragCoord.xy + vec2(tq * 37.7, tq * 91.3)) + h12(gl_FragCoord.yx * 1.31 + vec2(tq * 13.1, 7.7)) - 1.;
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  col *= uRoom.x * (1. + uRoom.z * smoothstep(0.3, 0.8, lum));   // INTRO: one factor for every pixel of the frame: it is the room that answers, never a fiber.   INTRO R2: and on a hit of the track its highlights flare (uRoom.z), one curve for every pixel by its brightness, never by its fiber; z is 0 outside it, and the factor is then uRoom.x exactly (folded into the one multiply, so the code with it off rounds as before)
  col += g * uGrain * (0.35 + 0.65 * (1. - lum));
  col += (h12(gl_FragCoord.xy * 0.7 + 3.3) - 0.5) / 255.;
  // FIX V17: on an invented feed the canvas itself says so, after the grade, so a capture of the canvas alone (no page
  // round it) still carries the words. Faint, in the left margin, on a dark ground so it reads over a lit fiber too.
  if (uMarkR.z > 0.) {
    vec2 m = (gl_FragCoord.xy - uMarkR.xy) / uMarkR.zw;
    if (m.x > 0. && m.x < 1. && m.y > 0. && m.y < 1.) {
      vec2 mk = texture(uMark, vec2(m.y, m.x)).rg;
      float gnd = max(mk.g, 0.86 * smoothstep(0., 0.22, m.x) * smoothstep(1., 0.78, m.x) * smoothstep(0., 0.03, m.y) * smoothstep(1., 0.97, m.y));
      col = mix(col * (1. - 0.92 * gnd), vec3(0.96, 0.74, 0.40), 0.80 * mk.r);
    }
  }
  col = mix(vec3(3., 5., 10.) / 255., col, uRoom.y);           // INTRO: out of the page's own black (#03050a), not out of a darker one
  if (uWordA.x > 0.) {             // INTRO LEGIBLE (off in every still and every frame without a line or card: nothing below runs). Last of all, so the code of the frame before it is exactly what it was
    vec3 hq = uWordH * vec3(ndc, 1.);
    vec2 uv = hq.xy / max(hq.z, 1e-6), tp = uv * uWordS.xy;      // its texture (v down), and the same in its pixels
    // The shade: only as strong as the light behind requires. That light is read twice from the half-resolution picture
    // (before exposure; put through this pass's own curve on the luminance alone): its mean over the block (ten taps of a
    // mip about the block's height, the same for every pixel) and the light round this pixel. A mean is mostly the dark
    // between the strands, so it is taken three times: what the eye meets behind a letter is the strands themselves (and
    // the bloom and air this picture does not hold). The picture is darkened until that stands at uWordL.y on the screen,
    // never more than uWordS.w; the darkening falls away from the ink as a wide gaussian: no edge, nothing shaped like a box.
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    float lb = 0.;
    for (int i = 0; i < 5; i++) for (int j = 0; j < 2; j++) lb += dot(textureLod(uWide, uWordK.xy + uWordK.zw * vec2(float(i) * 0.4 - 0.8, float(j) - 0.5), uWordL.x).rgb, LW);
    float lw = max(lb * 0.1, 0.8 * dot(wideAt(uComp.x, uComp.w), LW)) * uExposure * 1.35 * 3.;
    float lr = lw * (2.51 * lw + 0.03) / (lw * (2.43 * lw + 0.59) + 0.14);     // relative luminance behind, on the screen
    float need = clamp(1. - pow(uWordL.y / max(lr, uWordL.y), 1. / 2.2), 0., uWordS.w);
    vec2 dd = max(max(uWordB.xy * uWordS.xy - tp, tp - uWordB.zw * uWordS.xy), 0.);
    float r2 = dot(dd, dd) / (uWordS.z * uWordS.z);
    float sh = need * exp(-2. * r2) * uWordA.x * min(1., uWordA.y * 2.5);
    // the letters: drawn in from left to right with a brighter front, as a fiber forms; a breath of light round them from
    // a softer mip of their own picture (about a stroke wide), never the bloom of the scene
    vec2 uc = clamp(uv, 0., 1.);
    float inq = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
    float x = (uv.x - uWordA.z) / max(uWordA.w - uWordA.z, 1e-3), f = uWordA.y * 1.12;
    float shown = (1. - smoothstep(f - 0.12, f, x)) * uWordA.x * inq;
    float tip = (1. - smoothstep(0.82, 1., uWordA.y)) * exp(-pow((x - f + 0.07) / 0.045, 2.));
    float a = texture(uWord, uc).a * shown, br = texture(uWord, uc, 1.8).a * shown;
    // and right under the letters a closer, softer darkening (their own picture, much blurred), so a bright strand that runs
    // through a word dims where it meets the letters: in proportion to the need, none over black
    float ul = min(1., 2.2 * texture(uWord, uc, 3.4).a * shown) * 0.5 * need / max(uWordS.w, 1e-3);
    if (uWordC.w > 0.5 && uWordC.w < 1.5) col = vec3(a);
    else {
      if (uWordC.w < 0.5) col *= (1. - sh) * (1. - ul);
      vec3 wc = mix(vec3(3., 5., 10.) / 255., min(uWordC.rgb * (1. + 0.5 * tip), vec3(1.)), uRoom.y);   // (with the frame, out of the page's black)
      col = mix(col, wc, a) + wc * (0.10 * br * (1. - a)) + g * uGrain * 0.35 * a;   // (and the film's grain, lightly, so they belong to the picture)
    }
  }
  o = vec4(col, 1.);
}
`,
};
