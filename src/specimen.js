// The specimen plate: six real fibers lifted out of the anatomy and laid side by side, one of each kind
// (formed, practised, proven, taught, library, staged foundry), each with a small label. It will become the legend.
//
// Self-contained: nothing else knows how the plate is laid out, lit or labelled. The six fibers are not copies.
// Their own spline rows are rewritten in place, so there is still exactly one fiber per skill and every count
// stays true; closing the plate puts them back where the anatomy had them.
//
// LIGHT-MERGE: main.js carries five small hooks for this file, each marked LIGHT-MERGE there. Nothing else changes.
// Merged file (see MERGE.md): the light lane's, with one line added in pose() (LAYOUT-MERGE) and one number changed in _labels() (MERGE).

import { V3, Q, M4, bspline } from './math.js?v=mwebkyjr';
import * as ANAT from './anatomy.js?v=mwebkyjr';
import { RIG } from './renderer.js?v=mwebkyjr';

const CPN = ANAT.CPN;
const C = [0, -420, 0];          // where the plate stands: far below the anatomy, in clear air
const LEN = 15;                  // length of a specimen
const ROW = 1.95;                // distance between rows
const TURN = 0.16;               // the plate is turned a little about the vertical, so the rows run into depth
const FOV = 0.46;
const EX = [Math.cos(TURN), 0, Math.sin(TURN)], EY = [0, 1, 0], EZ = [-Math.sin(TURN), 0, Math.cos(TURN)];
const at = (x, y, z) => V3.addS(V3.addS(V3.addS(C, EX, x), EY, y), EZ, z);

// The plate has its own lights, in the same form as the main rig: a shaft of light standing behind the row, a warm
// lamp above the beads, a pale one low on the left. The strip that rides with the camera and the bounce are shared.
// FIX V13: a museum plate stands on black. The shaft behind the row is no longer seen in the air (gain 0): it only lays its
// cool light on the glass, as before (glass). The second shaft is gone, and there is no mist (mistK 0).
const PLATE_RIG = {
  near: 1, mistK: 0, bare: true,                                // bare: no far architecture is drawn behind the plate
  shafts: [
    { p: at(3.2, 0, -15), d: [0.03, 1, 0], r: 1.7, col: [0.56, 0.77, 1.0], gain: 0, glass: 0.22, halo: [5, 0.04], span: [-260, 300] },
  ],
  lamps: [
    { p: at(2.6, 15, 12), w: 1, col: [1.0, 0.80, 0.56], gain: 18 },
    { p: at(-6, -9, 16), w: 1, col: [1.0, 0.93, 0.88], gain: 6 },
  ],
  strip: { ...RIG.strip, gain: 1.6 }, fill: RIG.fill,      // on the plate the lamps do the talking: a long white hairline must not be taken for the taught thread
  air: { c: at(0, 0, -10), s: [90, 60, 76] },             // a wide box: a few motes drift past the row, it does not snow
};

// ---------------------------------------------------------------- which six
// The rule of the material studies, made to work on any feed. Ties go to feed order.
//   formed     the first active learned skill with no clean runs and no jobs, taken from the largest family
//   practised  the active learned skill with the most clean runs and no jobs
//   proven     the active learned skill with the most jobs done, then the most clean runs
//   taught     the taught skill with the most clean runs
//   library    the library skill with the most jobs done
//   foundry    the first Foundry skill that is staged
// A kind the feed does not hold is left out; nothing is invented to fill the row.
export function pickSpecimens(model) {
  const S = model.skills, order = (a, b) => a.order - b.order;
  const first = (f, cmp) => S.filter(f).sort(cmp)[0] || null;
  const big = [...model.families].sort((a, b) => b.skills.length - a.skills.length).map((f) => f.id);
  const rank = (s) => big.indexOf(s.family.id), active = (s) => s.stateCode === 0;
  return [
    { key: 'formed', name: 'Formed', skill: first((s) => active(s) && s.originCode === 0 && !s.jobs && !s.clean, (a, b) => rank(a) - rank(b) || order(a, b)) },
    { key: 'practised', name: 'Practised', skill: first((s) => active(s) && s.originCode === 0 && !s.jobs && s.clean > 0, (a, b) => b.clean - a.clean || order(a, b)) },
    { key: 'proven', name: 'Proven', skill: first((s) => active(s) && s.originCode === 0 && s.jobs > 0, (a, b) => b.jobs - a.jobs || b.clean - a.clean || order(a, b)) },
    { key: 'taught', name: 'Taught', skill: first((s) => s.originCode === 1, (a, b) => b.clean - a.clean || order(a, b)) },
    { key: 'library', name: 'Library', skill: first((s) => s.originCode === 2, (a, b) => b.jobs - a.jobs || order(a, b)) },
    { key: 'foundry', name: 'Foundry, staged', skill: first((s) => s.originCode === 3 && s.stateCode === 1, order) },
  ].filter((x) => x.skill && x.skill.fiber >= 0);
}

// What the label says: only what the record says.
// FIX V35: jobs_done null is "no jobs recorded" (proof runs are not jobs and are named only on the card); a recorded 0 is
// "0 jobs done". FIX V17: on an invented feed the line ends with the word invented.
function facts(sp, mock) {
  const s = sp.skill, out = [], num = (v) => v.toLocaleString('en-US'), j = s.raw.jobs_done;
  if (sp.key === 'taught') out.push('taught by demonstration');
  if (sp.key === 'library') out.push('admitted from the One Autogenics Library');
  if (s.jobs) out.push(`${num(s.jobs)} ${s.jobs === 1 ? 'job done' : 'jobs done'}`);
  else out.push(typeof j === 'number' && isFinite(j) ? '0 jobs done' : 'no jobs recorded');
  if (s.handed) out.push(`${num(s.handed)} handed back to the model`);
  if (s.clean) out.push(`${num(s.clean)} ${s.clean === 1 ? 'clean run' : 'clean runs'}`);
  if (sp.key === 'foundry') out.push('not switched on');
  // FOUNDER, 11 Nov 5:32 PM: the word invented is off the labels (the caption of the plate still says mock data).
  return out.join(' · ');
}

export class Specimen {
  // h: { renderer, camera, model(), anat(), focus(id), canvas }
  constructor(h) { this.h = h; this.isOpen = false; this.items = []; this.aspect = 0; }

  // Rewrite the six rows of an anatomy in place (no upload). Called again whenever the anatomy is rebuilt while the plate is open.
  lay(model, anat) {
    const picks = pickSpecimens(model), n = picks.length;
    anat.specimenBackup = [];
    picks.forEach((sp, i) => {
      const f = anat.fibers[sp.skill.fiber], off = f.index * CPN * 4, y0 = ((n - 1) / 2 - i) * ROW;
      anat.specimenBackup.push({ f, cp: anat.cp.slice(off, off + CPN * 4), len: f.len, radius: f.radius, shade: f.shade, closed: f.closed });
      for (let k = 0; k < CPN; k++) {
        const u = (k - 1) / (CPN - 3), q = 2 * u - 1;
        // a gentle arch, the ends a touch nearer the eye, and each row leaning its own way so no two catch the light alike
        const p = at(q * LEN * 0.5, y0 + 0.34 * (1 - q * q) + 0.05 * q * (i - 2.5), 0.30 * q * q + 0.10 * q * (2.5 - i));
        anat.cp.set([p[0], p[1], p[2], 1], off + k * 4);
      }
      let len = 0, prev = bspline(anat.cp, off, CPN, 0).p;
      for (let k = 1; k <= 48; k++) { const p = bspline(anat.cp, off, CPN, k / 48).p; len += V3.dist(p, prev); prev = p; }
      f.len = len; f.shade = 1; f.closed = false;
      if (typeof ANAT.fiberRadius === 'function') f.radius = ANAT.fiberRadius(sp.skill);   // true relative thickness, no muscle scale
      sp.fiber = f; sp.y0 = y0;
    });
    this.picks = picks;
    return picks;
  }
  _unlay(anat) {
    for (const b of anat.specimenBackup || []) { anat.cp.set(b.cp, b.f.index * CPN * 4); b.f.len = b.len; b.f.radius = b.radius; b.f.shade = b.shade; b.f.closed = b.closed; }
    anat.specimenBackup = null;
  }
  _upload() { const a = this.h.anat(); this.h.renderer.setAnatomy(a); this.h.camera.setAnatomy(a); }

  // the framing: the whole row, with room for the lockup above and the labels beside it
  // The fibers take the right two thirds of the frame, their labels a column on the left, and the row sits a little low so the
  // title lockup stays clear above it.
  pose(aspect) {
    const n = Math.max(this.picks ? this.picks.length : 6, 2), t = Math.tan(FOV / 2);
    const d = Math.max(((n - 1) * ROW) / 0.62 / (2 * t), LEN / 0.62 / (2 * t * aspect));
    const tgt = at(-0.115 * 2 * t * d * aspect, 0.085 * 2 * t * d, 0), pos = V3.addS(tgt, EZ, d);
    // LAYOUT-MERGE: air 1 and fogK 1 are read by the layout lane's camera and frame loop (air by pose): the plate stands
    // in the thin air it was designed in (in the light lane it got that from its distance from the old body).
    return { pos, q: Q.look(pos, tgt), fov: FOV, focus: d, aperture: 0.0045, air: 1, fogK: 1 };
  }

  open() {
    if (this.isOpen) return;
    const { renderer, camera, canvas } = this.h;
    this.isOpen = true;
    this.lay(this.h.model(), this.h.anat()); this._upload();
    this.rigBefore = renderer.rig; renderer.setRig(PLATE_RIG);
    this.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    camera.framing(this.pose(this.aspect));
    document.getElementById('dock').hidden = true;
    this._labels();
  }
  // FIX V05: after a lost GPU context the renderer is a new one: take its rig again
  rerig() { const r = this.h.renderer; this.rigBefore = r.home || r.rig; r.setRig(PLATE_RIG); }
  // FIX V39: called by the page after the overlay has rebuilt its own labels under an open plate
  relabel() { if (this.isOpen) this._labels(); }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._unlay(this.h.anat()); this._upload();
    this.h.renderer.setRig(this.rigBefore || RIG);
    document.getElementById('dock').hidden = false;
    for (const it of this.items) it.box.remove();
    if (this.caption) this.caption.remove();
    this.items = []; this.caption = null;
  }

  _labels() {
    const root = document.getElementById('labels'), ui = document.getElementById('ui'), mock = !!(this.h.mock && this.h.mock());
    for (const it of this.items) it.box.remove();
    if (this.caption) this.caption.remove();
    const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
    // TYPE (11 Nov, founder note 2): the line of facts is built as clauses, as on the muscle labels (overlay.js, setFact):
    // each clause (.l-cl) carries the dot that follows it (.l-sep), a plain space stands between clauses, so where the
    // line has to wrap it wraps between two facts and not inside one. The text of the line is unchanged.
    const clauses = (text) => { const e = el('span', 'l-fact'), parts = String(text).split(' · '); parts.forEach((part, k) => { const c = el('span', 'l-cl', part); e.append(c); if (k < parts.length - 1) { c.append(el('span', 'l-sep', ' ·')); e.append(' '); } }); return e; };
    this.items = this.picks.map((sp, i) => {
      const box = el('button', 'label on flip spec'); box.type = 'button';
      box.style.setProperty('--c', sp.skill.family.color);
      const title = sp.skill.label.length > 46 ? sp.skill.label.slice(0, 44).trimEnd() + '…' : sp.skill.label || 'Untitled skill';
      box.append(el('span', 'l-name', `${i + 1}  ${sp.name}`), clauses(facts(sp, mock)), el('span', 'l-fact l-title', title));
      box.addEventListener('click', () => this.h.focus(sp.skill.id));
      root.append(box);
      return { sp, box };
    });
    // FIX V13/V17: on an invented feed the caption does not say "real"
    const n = this.picks.length === 6 ? 'six' : String(this.picks.length);
    this.caption = el('p', 'caption', mock ? `Specimen plate · ${n} fibers with invented counts (mock data), one of each kind` : `Specimen plate · ${n} real fibers from the feed, one of each kind`);
    // MERGE: was 30px. The features lane's labels are solid plates, a few pixels larger all round than the light lane's
    // bare text, and the sixth one reached the caption; 14px clears it.
    this.caption.style.top = 'auto'; this.caption.style.bottom = '14px';       // the dock is hidden while the plate is open; the caption takes its place
    ui.append(this.caption);
  }

  // every frame: keep the framing right for the window, and the labels beside their fibers
  frame(vp, W, H, camMode) {
    if (!this.isOpen) return;
    const aspect = W / Math.max(H, 1);
    if (Math.abs(aspect - this.aspect) > 0.01 && camMode === 'custom') { this.aspect = aspect; this.h.camera.framing(this.pose(aspect)); }
    const a = this.h.anat(), on = camMode === 'custom';
    for (const it of this.items) {
      const f = it.sp.fiber, c = M4.point(vp, a.point(f.index, 0).p);            // the left end of the fiber
      const x = (c[0] * 0.5 + 0.5) * W, y = (0.5 - c[1] * 0.5) * H;
      it.box.classList.toggle('on', on && c[3] > 0);
      // FIX (last pass): in a narrow window a long label ran over the left end of its fiber. A label is never wider than the
      // room left of its fiber: its facts wrap onto a second line and its title is cut with an ellipsis (viewer.css .label.spec)
      const left = 32, room = Math.max(Math.round(x - 26 - left), 140);     // 32: its plate stays clear of the mock mark in the left margin
      if (it.room !== room) { it.room = room; it.box.style.maxWidth = `${room}px`; }
      it.box.style.transform = `translate(${Math.max(x - 26 - it.box.offsetWidth, left).toFixed(1)}px, ${(y - it.box.offsetHeight * 0.5).toFixed(1)}px)`;
    }
    if (this.caption) this.caption.hidden = !on;
  }
}
