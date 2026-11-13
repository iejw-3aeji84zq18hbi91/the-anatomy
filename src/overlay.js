// The overlay: plate labels in an anatomy atlas. HTML on top of the canvas, positioned from script
// (el.style.* only, so it passes the app's security policy). All numbers come straight from the feed.
//
// Merged file (see MERGE.md). The label layout (PLATE_SEATS, SEATS, rects, _measure, frame) is the layout lane's,
// untouched. The features lane's small edits are re-applied on top and marked FEATURES: the exported plate numeral,
// the short chip name, chip and label construction in build(), and two lines in showCard(). The newer panels
// (keys, legend, burst counters, notices) live in panels.js. Lines marked MERGE were written at the merge.

import { M4, clamp } from './math.js?v=mweb9mux';
import { PLATE_SEATS } from './anatomy.js?v=mweb9mux';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DASH = '–';
const num = (v) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US') : DASH);
const rec = (v) => (v == null ? 'Not recorded' : typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US') : String(v));
const two = (n) => String(n).padStart(2, '0');
export const fmtDay = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDate = (iso) => { const ms = iso ? Date.parse(iso) : NaN; if (!isFinite(ms)) return 'Not recorded'; const d = new Date(ms); return `${fmtDay(ms)}, ${two(d.getHours())}:${two(d.getMinutes())}`; };
const fmtSecs = (s) => {
  if (typeof s !== 'number' || !isFinite(s)) return 'Not recorded';
  if (s < 60) return `${s.toLocaleString('en-US', { maximumFractionDigits: 1 })} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const $ = (id) => document.getElementById(id);
const MAX_COVER = 0.15, KEEP_COVER = 0.22;      // CABLES: the hard limit is the checkers' 15 percent (was 0.20 / 0.28)   //      // REPAIR (R5): how much of a label's box may lie on fiber: to take a seat, and to keep the seat it has
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
// Seats a label may take round its dot: [side, vertical, run, rise] in CSS pixels. Side +1 sets the
// label to the right of the dot, vertical -1 above it. Tried in order; the first free one is taken.
const FAR_SEATS = [[1, -1, 210, 150], [-1, -1, 210, 150], [1, 1, 210, 150], [-1, 1, 210, 150], [1, -1, 230, 30], [-1, -1, 230, 30], [1, 1, 230, 34], [-1, 1, 230, 34], [1, -1, 40, 170], [-1, -1, 40, 170], [1, 1, 40, 170], [-1, 1, 40, 170], [1, -1, 300, 200], [-1, -1, 300, 200], [1, 1, 300, 200], [-1, 1, 300, 200]];   // ART (A2): farther seats, for a frame that is full of fiber
const SEATS = [[1, -1, 56, 38], [1, 1, 56, 40], [1, -1, 100, 78], [1, 1, 100, 80], [-1, -1, 56, 38], [-1, 1, 56, 40], [-1, -1, 100, 78], [-1, 1, 100, 80], [1, -1, 150, 112], [1, 1, 150, 112], [-1, -1, 150, 112], [-1, 1, 150, 112]];

const ORIGIN_WORDS = {
  learned: ['Learned', 'Learned from a real request'],
  taught: ['Taught', 'Taught by demonstration'],
  library: ['Library', 'Admitted from the One Auto Library'],
  foundry: ['Foundry', 'Certified by the Foundry.'],
};
const STATE_WORDS = { active: 'Active', staged: 'Staged: not switched on', off: 'Switched off', observed: 'Observed only' };
// FEATURES: plate numerals, fixed by family order (research I ... mail X). A family the viewer does not know has none.
// (The layout lane's own NUMERAL table held the same ten numerals under the same rule; this one export serves both.)
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const numeral = (fam) => (fam && fam.known && fam.index < ROMAN.length ? ROMAN[fam.index] : '');
// FEATURES: the short name on a chip in a narrow window: the family id from the feed, spaced and capitalised.
const shortName = (fam) => { const t = String(fam.id).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

// TYPE (11 Nov, founder note 2): the line of facts under a muscle's name is built as clauses, split at its middle dots, so
// the stylesheet can break the line between clauses where a label has to be narrow. Each clause (.l-cl) carries the dot
// that follows it (.l-sep); a plain space stands between clauses. The text of the line is unchanged, character for character.
const setFact = (e, text) => {
  const parts = String(text).split(' · ');
  e.replaceChildren();
  parts.forEach((part, i) => { const c = el('span', 'l-cl', part); e.append(c); if (i < parts.length - 1) { c.append(el('span', 'l-sep', ' ·')); e.append(' '); } });
};

export class Overlay {
  constructor(handlers) {
    this.h = handlers; this.items = []; this.toolItems = []; this.keep = []; this.size = [0, 0];
    this.ui = $('ui'); this.labels = $('labels'); this.leaders = $('leaders'); this.card = $('card'); this.tip = $('tip');
    this.range = $('g-range');
    this.range.addEventListener('input', () => handlers.growth(this.range.value / 1000, true));
    $('g-play').addEventListener('click', () => handlers.playGrowth());
    $('card-close').addEventListener('click', () => handlers.clearFocus());
    $('card-more').addEventListener('click', () => { const open = this.card.classList.toggle('expanded'); $('card-more').textContent = open ? 'Show less' : 'Show full title'; });
    $('btn-overview').addEventListener('click', () => handlers.overview());
    $('btn-replay').addEventListener('click', () => handlers.replay());
  }

  // ---------------------------------------------------------------- content from the feed
  build(model, anat) {
    this.model = model; this.anat = anat; this.dirty = true;
    const t = model.totals, tot = $('totals');
    tot.replaceChildren();
    // FIX V21: the amber on the map is a hand-back to the model (in the burst replay it is a hand-back to a person, and says so)
    for (const [v, label] of [[t.skills, t.skills === 1 ? 'skill' : 'skills'], [t.jobs_done, 'jobs done by Auto'], [t.handed_back, 'handed back to the model'], [t.model_calls_saved, 'model calls saved']]) {
      const d = el('div', 'tot'); d.append(el('dt', null, num(v)), el('dd', null, label)); tot.append(d);
    }
    // FIX V17: on an invented feed the strip itself says so, so no crop of it can pass for a record
    if (model.mock) { const d = el('div', 'tot tot-mock'); d.append(el('dt', null, 'Demo'), el('dd', null, 'invented numbers')); tot.append(d); }
    $('banner').hidden = !model.partial || !!model.error;
    $('empty').hidden = model.skills.length !== 0 || !!model.error;
    // FIX V22: a feed that could not be fetched or read is not an empty library. One quiet line says what happened.
    $('feed-error').hidden = !model.error;
    // FIX V20/V40: the strip shows the totals the feed states; the bands and notches follow the skills. When the two
    // disagree the screen says so, with the numbers the skills add up to. (Proof runs are in neither.)
    const offJobs = typeof t.jobs_done === 'number' && t.jobs_done !== model.sumJobs;
    const loose = typeof t.handed_back_not_tied_to_a_skill === 'number' ? t.handed_back_not_tied_to_a_skill : 0;
    const offHand = typeof t.handed_back === 'number' && t.handed_back - loose !== model.sumHanded;
    const mm = $('mismatch');
    mm.hidden = !(offJobs || offHand) || !!model.error;
    if (!mm.hidden) mm.textContent = `The totals in the feed do not match its skills. The skills show ${plural(model.sumJobs, 'job done', 'jobs done')} and ${num(model.sumHanded)} handed back; the bands follow the skills.`;

    // FEATURES: family chips, one row: plate numeral, name, count. Readable text on a dark well; colour is carried by a bar
    // and by the numeral. An empty family is an outlined chip showing 0.
    const chips = $('chips'); chips.replaceChildren();
    for (const m of anat.muscles) {
      const b = el('button', 'chip' + (m.empty ? ' is-empty' : '')); b.type = 'button';
      b.style.setProperty('--c', m.fam.color); b.dataset.family = m.id;
      const nm = numeral(m.fam);
      if (nm) b.append(el('span', 'chip-num', nm));
      b.append(el('span', 'chip-name', m.fam.label), el('span', 'chip-short', shortName(m.fam)), el('span', 'chip-n', num(m.fam.skills.length)));
      b.title = `${m.fam.label}: ${m.fam.arch}`;
      b.setAttribute('aria-label', `${nm ? nm + '. ' : ''}${m.fam.label}, ${plural(m.fam.skills.length, 'skill', 'skills')}`);
      b.addEventListener('click', () => this.h.muscle(m.id));
      chips.append(b);
    }

    // muscle labels with leader lines
    this.labels.replaceChildren(); this.leaders.replaceChildren(); this.items = [];
    for (const m of anat.muscles) {
      const box = el('button', 'label' + (m.empty ? ' is-empty' : '')); box.type = 'button';      // FEATURES: is-empty
      box.style.setProperty('--c', m.fam.color);
      const fact = this.fact(m);
      // FEATURES: the name line carries the plate numeral; it stays the first child, which the layout measures
      const name = el('span', 'l-name'), nm = numeral(m.fam);
      if (nm) name.append(el('i', 'l-num', nm));
      name.append(el('span', null, m.fam.label));
      const factEl = el('span', 'l-fact'); setFact(factEl, fact);      // TYPE: clauses (see setFact)
      box.append(name, factEl);
      box.addEventListener('click', () => this.h.muscle(m.id));
      // leader: two hairlines and a dot, moved with transforms only (no repaint while flying)
      const g = el('div', 'leader'), a = el('i', 'seg'), b = el('i', 'seg'), dot = el('i', 'dot');
      g.append(a, b, dot); g.style.setProperty('--c', m.fam.color);
      this.labels.append(box); this.leaders.append(g);
      this.items.push({ m, box, g, a, b, dot, factEl, fact, on: false, opt: -1, anchor: -1, lean: 0, w: 0, h: 0, key: '', rect: null });
    }
    this.chipItems = [...chips.children].map((b, i) => ({ m: anat.muscles[i], n: b.querySelector('.chip-n'), text: b.querySelector('.chip-n').textContent }));
    // tool labels, shown beside the nerve lines of a focused fiber
    this.toolItems = anat.toolNodes.map((tn) => { const b = el('span', 'tool-label', tn.tool.label); this.labels.append(b); return { tn, box: b }; });
    this.growthUI(1);
  }

  // The line of facts under a muscle's name. FIX V02/V03/V23: a number of jobs is shown only where jobs were recorded.
  //   no skills                          no skills yet
  //   jobs recorded and above zero       19 skills · 19 jobs done on 4 fibers   (the sum, and how many fibers carry it)
  //   every skill holds a recorded 0     3 skills · 0 jobs done
  //   otherwise (null on some or all)    336 skills · no jobs recorded
  // FIX V17: on an invented feed every such line ends with the word invented.
  // FIX V32: while the growth slider is back in time (formed is a number), only the fibers formed by then are counted,
  // and nothing is said about jobs, which carry no date.
  fact(m, formed = null) {
    const f = m.fam, n = f.skills.length;
    if (m.empty) return 'no skills yet';
    if (formed != null) return formed === 0 ? 'not yet formed' : `${num(formed)} of ${plural(n, 'skill', 'skills')} formed`;
    const skills = plural(n, 'skill', 'skills');
    // FOUNDER, 11 Nov 5:32 PM: "i know its mock data remove that its taking up the view". On a mock feed the labels no
    // longer end with the word invented. The one mark that stays is the Mock cell in the totals strip. Do not restore.
    if (this.model && this.model.mock) return `${skills} · ${f.jobs > 0 ? plural(f.jobs, 'job done', 'jobs done') : f.recorded === n ? '0 jobs done' : 'no jobs recorded'}`;
    if (f.jobs > 0) return `${skills} · ${plural(f.jobs, 'job done', 'jobs done')} on ${plural(f.proven, 'fiber', 'fibers')}`;
    return f.recorded === n ? `${skills} · 0 jobs done` : `${skills} · no jobs recorded`;
  }

  growthUI(g) {
    const m = this.model; if (!m) return;
    // FIX V32: labels and chips follow the slider. At the present day (g = 1) they say what the feed says.
    const back = g < 1, born = (s) => s.birth < 0 || s.birth * 0.94 < g;
    for (const it of this.items || []) {
      const formed = back && !it.m.empty ? it.m.fam.skills.filter(born).length : null, text = this.fact(it.m, formed);
      if (text !== it.fact) { it.fact = text; setFact(it.factEl, text); it.box.classList.toggle('is-unformed', formed === 0); this.dirty = true; }
    }
    for (const c of this.chipItems || []) {
      const text = back ? num(c.m.fam.skills.filter(born).length) : num(c.m.fam.skills.length);
      if (text !== c.text) { c.text = text; c.n.textContent = text; }
    }
    const n = m.dated.length, formed = m.undated + m.dated.filter((s) => s.birth * 0.94 < g).length;
    const shown = g >= 1 ? m.skills.length : formed;
    $('g-count').textContent = `${num(shown)} of ${num(m.skills.length)} fibers formed`;
    const date = $('g-date');
    if (n) {
      const idx = clamp(Math.round((g / 0.94) * (n - 1)), 0, n - 1);
      date.textContent = fmtDay(m.dated[g >= 1 ? n - 1 : idx].learnedMs);
    } else date.textContent = 'No dates recorded';
    date.style.left = `${g * 100}%`;
    if (Math.round(g * 1000) !== +this.range.value) this.range.value = String(Math.round(g * 1000));
    this.range.style.setProperty('--g', `${g * 100}%`);
    $('g-note').textContent = m.undated ? `${plural(m.undated, 'fiber has', 'fibers have')} no recorded date and ${m.undated === 1 ? 'is' : 'are'} shown throughout.` : '';
  }
  playing(on) { $('g-play').textContent = on ? 'Pause' : 'Play'; }
  // FIX V34: the replay caption says what is being replayed and what a spark is, from the events themselves.
  caption(on, text) {
    const c = $('caption');
    if (on && text) c.replaceChildren(el('span', 'cap-head', text[0]), el('span', 'cap-note', text[1]));
    if (c.hidden === !on) return;
    c.hidden = !on; this.dirty = true;
  }

  // ---------------------------------------------------------------- proof card
  showCard(skill, tools) {
    const r = skill.raw, c = this.card;
    c.style.setProperty('--c', skill.family.color);          // FEATURES: the rule along the top of the card and the band key
    const chips = $('card-chips'); chips.replaceChildren();
    const fam = el('span', 'cchip'); fam.style.setProperty('--c', skill.family.color); fam.append(el('span', 'chip-dot'), el('span', null, skill.family.label));
    const ow = ORIGIN_WORDS[r.origin];
    chips.append(fam, el('span', 'cchip cchip-origin', ow ? ow[0] : r.origin == null ? 'Origin not recorded' : String(r.origin)));
    if (this.model && this.model.mock) chips.prepend(el('span', 'cchip cchip-mock', 'Mock data'));     // FIX V17: an invented counter under a real title is marked on the card itself
    const title = $('card-title'); title.textContent = skill.label || 'Untitled skill';
    c.classList.remove('expanded'); $('card-more').textContent = 'Show full title';
    let origin = ow ? ow[1] : r.origin == null ? 'Origin not recorded.' : `Origin recorded as "${String(r.origin)}", a kind this viewer does not know yet.`;
    if (r.origin === 'foundry' && r.state === 'staged') origin += ' Staged: not switched on.';
    $('card-origin').textContent = origin;
    const rows = $('card-rows'); rows.replaceChildren();
    const add = (k, v, cls) => { const d = el('div', 'row' + (cls ? ' ' + cls : '')); d.append(el('dt', null, k), el('dd', v === 'Not recorded' ? 'nr' : null, v)); rows.append(d); };
    add('Jobs Auto finished', rec(r.jobs_done), 'row-jobs');
    add('Handed back', rec(r.handed_back), 'row-handed' + (r.handed_back > 0 ? ' has' : ''));   // FEATURES: amber only when above 0
    // MERGE (the one addition of the merge brief): a fiber that carries proof runs says so here, in words, and nowhere
    // else. They were build-day test tasks nobody asked for: never bands, never notches, never sparks, never part of a
    // jobs-done number. On such a card Jobs Auto finished still reads Not recorded.
    const proof = (k, v) => {
      if (typeof v !== 'number' || !isFinite(v)) return;
      const d = el('div', 'row row-proof'), dd = el('dd');
      dd.append(el('span', 'proof-n', num(v)), ' ', el('span', 'proof-note', 'build-day test tasks, not counted as jobs done'));   // (the space is for readers of the text; the two sit on two lines)
      d.append(el('dt', null, k), dd); rows.append(d);
    };
    proof('Proof runs', r.proof_runs);
    proof('Proof hand-backs', r.proof_hand_backs);
    add('Clean runs', rec(r.clean_runs));
    add('Model calls saved', rec(r.model_calls_saved));
    add('Time saved', fmtSecs(r.seconds_saved));
    add('Learned', fmtDate(r.learned_at));
    add('Last used', fmtDate(r.last_used_at));
    add('Uses', tools.length ? tools.map((t) => t.label).join(', ') : 'No tools recorded', 'row-wide');
    add('State', STATE_WORDS[r.state] || (r.state == null ? 'Not recorded' : String(r.state)));
    c.hidden = false; this.dirty = true;
    document.body.classList.add('has-card');                   // FIX V15/V29: in a narrow window the legend drawer keeps clear of an open card (viewer.css)
    $('card-more').hidden = !(title.scrollHeight > title.clientHeight + 2);
    this.fitCard();
  }
  // FIX V29: a card that would not fit in its column (a record with proof lines, a small window) is set tighter and gives
  // up its two key lines, which the legend repeats, before it ever scrolls.
  fitCard() {
    const c = this.card;
    if (c.hidden) return;
    c.classList.remove('tight', 'tighter');
    if (c.scrollHeight > c.clientHeight + 2) c.classList.add('tight');
    if (c.scrollHeight > c.clientHeight + 2) c.classList.add('tighter');   // FIX V29 (last pass): a card with both proof lines in a 700 px window still scrolled by 30 px
  }
  hideCard() { if (!this.card.hidden) { this.card.hidden = true; this.dirty = true; document.body.classList.remove('has-card'); } }

  tooltip(skill, x, y) {
    const t = this.tip;
    if (!skill) { t.hidden = true; return; }
    const label = skill.label.length > 84 ? skill.label.slice(0, 82).trimEnd() + '…' : skill.label || 'Untitled skill';
    if (t.dataset.id !== skill.id) { t.replaceChildren(el('span', 'tip-fam', skill.family.label), el('span', 'tip-name', label)); t.dataset.id = skill.id; t.style.setProperty('--c', skill.family.color); }
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = `${clamp(x + 16, 8, this.size[0] - w - 8)}px`; t.style.top = `${clamp(y - h - 14, 8, this.size[1] - h - 8)}px`;
  }

  // for the layout checks: the labels on screen now and everything they must keep clear of
  rects() {
    return { labels: this.items.filter((it) => it.on && it.rect).map((it) => ({ id: it.m.id, ...it.rect })), keep: this.keep.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) };
  }

  // ---------------------------------------------------------------- label layout, every frame
  _measure(W, H) {
    this.size = [W, H]; this.dirty = false;
    const r = (sel, pad = 10) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left - pad, y: b.top - pad, w: b.width + pad * 2, h: b.height + pad * 2 } : null; };
    const tr = r('.topright'); if (tr) tr.top = true;
    const dock = r('.dock', 14); if (dock) dock.dock = true;
    // TYPE (11 Nov, founder note 2): the legend drawer is kept clear of as its own box. It used to be part of the dock
    // wrapper's box, so with the legend open the labels kept off one rectangle as wide as the dock and as tall as dock
    // and legend together: nearly half the frame once the type grew, and the forms on the right lost their labels to the
    // far corners. (viewer.css takes the drawer out of the wrapper's flow; the corner stays the last entry.)
    this.keep = [r('.lockup'), tr, dock, r('.legend', 14), r('.card'), { x: W - 180, y: H - 200, w: 180, h: 200 }].filter(Boolean);
    // TYPE: when a panel opens, closes or changes size, the free places of the plate are looked for afresh (frame, below),
    // so a place taken while the legend was open is not kept once it has closed and there is room beside the form again
    const sig = this.keep.map((k) => `${Math.round(k.x)},${Math.round(k.y)},${Math.round(k.w)},${Math.round(k.h)}`).join(';');
    if (sig !== this.keepSig) { this.keepSig = sig; this.keepTick = (this.tick || 0) + 1; }
    for (const it of this.items) { it.w = it.box.offsetWidth; it.h = it.box.offsetHeight; it.nameH = it.box.firstChild.offsetHeight; }
  }

  // vp: view-projection matrix; mode: 'tour' | 'plate' | 'focus' | 'custom'; lead: the form this stretch of the rail is about; only: show just that one
  frame(vp, camPos, W, H, { mode, lead, only, at, focusSkill, clear, lit }) {
    if (this.dirty || W !== this.size[0] || H !== this.size[1]) this._measure(W, H);
    const project = (p) => { const c = M4.point(vp, p); return { x: (c[0] * 0.5 + 0.5) * W, y: (0.5 - c[1] * 0.5) * H, nx: c[0], ny: c[1], front: c[3] > 1, d: Math.hypot(p[0] - camPos[0], p[1] - camPos[1], p[2] - camPos[2]) }; };
    const inKeep = (x, y) => this.keep.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
    const placed = [], show = new Map(), leaders = []; this.tick = (this.tick || 0) + 1;
    // ART (A2): a label takes a seat that covers no form. Where the fibers are on screen is marked in a coarse grid, from a
    // cloud of points on every form (anatomy.js, m.cloud); a seat is scored by how much of its box lies on marked cells.
    const CELL = 18, gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
    if (!this.occ || this.occ.length !== gw * gh) this.occ = new Uint8Array(gw * gh); else this.occ.fill(0);
    const occ = this.occ;
    // REPAIR (R5): the renderer weighs every frame on a grid of its own for the hero order (renderer.js, _order): how much of
    // each cell every family's fibers cover, from points along every fiber. That is a far truer picture of where the
    // fibers are than the cloud, so it is used when it is there: a cell counts as fiber when a twenty-fifth of it is covered.
    const lg = mode !== 'focus' && lit && lit.tau && lit.gw ? lit : null;
    if (lg) {
      const GW = lg.gw, GH = lg.gh, NC = GW * GH, NF = lg.L.length, tau = lg.tau, sum = this.lsum && this.lsum.length === NC ? this.lsum : (this.lsum = new Float32Array(NC));
      for (let c = 0; c < NC; c++) { let t = 0; for (let f = 0; f < NF; f++) t += tau[f * NC + c]; sum[c] = t; }
      // a cell is fiber when a twenty-fifth of it is covered (thin threads at rest are bright lines); a dense bundle also lights the air beside it, so the cells that touch
      // a well covered cell count too. (Two cells out was tried: on a full body it left room for two labels on the plate.)
      const near = (cx, cy) => { if (sum[cy * GW + cx] > 0.012) return true;      // CABLES: was 0.04; thin bright barbs (the plume, the quill) cover little of a cell and light all of it
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= GW || Y >= GH || (dx && dy)) continue; if (sum[Y * GW + X] > 0.35) return true; }
        return false; };
      for (let b = 0; b < gh; b++) { const cy = Math.min(GH - 1, Math.floor((1 - (b + 0.5) * CELL / H) * GH)); if (cy < 0) continue;
        for (let a = 0; a < gw; a++) if (near(Math.min(GW - 1, Math.floor(((a + 0.5) * CELL / W) * GW)), cy)) occ[b * gw + a] = 1; }
    }
    // and the cloud as well, drawn as lines from point to point along each fiber: it also marks what the grid weighs lightly
    // (a rope in its sheath, a thin far form) and what it samples too coarsely (a fiber passing close to the lens)
    const mark = (gx, gy, r = 0) => { if (r > 0) { for (let b = Math.max(0, gy - r); b <= Math.min(gh - 1, gy + r); b++) for (let a = Math.max(0, gx - r); a <= Math.min(gw - 1, gx + r); a++) occ[b * gw + a] = 1; return; }
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return; occ[gy * gw + gx] = 1; if (lg) return; if (gx > 0) occ[gy * gw + gx - 1] = 1; if (gx < gw - 1) occ[gy * gw + gx + 1] = 1; if (gy > 0) occ[(gy - 1) * gw + gx] = 1; if (gy < gh - 1) occ[(gy + 1) * gw + gx] = 1; };
    if (mode !== 'focus') for (const it of this.items) {
      const c = it.m.cloud; if (!c) continue;
      const NU = it.m.cloudN || 0; let px = 0, py = 0, pf = false;
      for (let i = 0, k = 0; i < c.length; i += 3, k++) {
        const x = c[i], y = c[i + 1], z = c[i + 2], w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15], first = !NU || k % NU === 0;
        if (w <= 1) { pf = false; continue; }                                                              // (M4.point, written out: no array per point)
        const sx = (((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w) * 0.5 + 0.5) * W / CELL, sy = (0.5 - ((vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) * 0.5) * H / CELL;
        const nr = w < 30 ? 2 : w < 80 ? 1 : 0;      // a fiber close to the lens is wide and out of focus: it takes the cells round it too
        if (pf && !first) { const n = Math.min(160, Math.ceil(Math.max(Math.abs(sx - px), Math.abs(sy - py)) * (nr ? 0.7 : 1.5))); for (let q = 1; q < n; q++) mark(Math.floor(px + (sx - px) * q / n), Math.floor(py + (sy - py) * q / n), nr); }
        mark(Math.floor(sx), Math.floor(sy), nr); px = sx; py = sy; pf = true;
      }
    }
    // ART (A7): in the close-up the label keeps off the record of the fiber in focus (`clear`: points along it, from main.js)
    if (clear) for (const c of clear) {
      const q = M4.point(vp, c); if (q[3] <= 1) continue;
      const gx = Math.floor(((q[0] * 0.5 + 0.5) * W) / CELL), gy = Math.floor(((0.5 - q[1] * 0.5) * H) / CELL);
      for (let b = gy - 1; b <= gy + 1; b++) for (let a = gx - 1; a <= gx + 1; a++) if (a >= 0 && b >= 0 && a < gw && b < gh) occ[b * gw + a] = 1;
    }
    const cover = (r) => {
      let n = 0, t = 0;
      for (let b = Math.max(0, Math.floor(r.y / CELL)); b <= Math.min(gh - 1, Math.floor((r.y + r.h) / CELL)); b++) for (let a = Math.max(0, Math.floor(r.x / CELL)); a <= Math.min(gw - 1, Math.floor((r.x + r.w) / CELL)); a++) { t++; n += occ[b * gw + a]; }
      return t ? n / t : 0;
    };
    // two leader lines never cross, and no leader runs under another label
    const cross = (a, b) => { const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); const [p1, p2] = a, [p3, p4] = b; return d(p1, p2, p3) * d(p1, p2, p4) < 0 && d(p3, p4, p1) * d(p3, p4, p2) < 0; };
    const through = (l, r) => { for (let k = 1; k < 20; k++) { const x = l[0][0] + (l[1][0] - l[0][0]) * k / 20, y = l[0][1] + (l[1][1] - l[0][1]) * k / 20; if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true; } return false; };
    // seat one label: the first seat whose box is on screen and clear of the lockup, totals, card, dock, corner and every label already seated
    // FIX V31: `avoid` is a box the label must also keep off: the form it names, when that form carries proven work
    const seat = (it, p, seats, k = 1, keepOpt = false, avoid = null, relax = false) => {
      const order = keepOpt && it.opt >= 0 && it.opt < seats.length ? [it.opt, ...seats.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...seats.keys()];
      let best = null, bc = 1e9;
      for (const si of order) {
        const [sx, sy, run, rise] = seats[si];
        const x = sx > 0 ? p.x + run * k : sx < 0 ? p.x - run * k - it.w : p.x - it.w / 2, y = sy < 0 ? p.y - rise * k - it.nameH : p.y + rise * k - it.nameH;
        const box = { x: x - 8, y: y - 6, w: it.w + 16, h: it.h + 12 };
        if (x < 14 || y < 14 || x + it.w > W - 14 || y + it.h > H - 14) continue;
        if (this.keep.some((r) => hit(box, r)) || placed.some((r) => hit(box, r))) continue;
        const lead = [[p.x, p.y], [sx >= 0 ? x : x + it.w, y + it.nameH + 3]];
        if (!relax && (leaders.some((l) => cross(lead, l)) || placed.some((r) => through(lead, r)) || leaders.some((l) => through(l, box)))) continue;
        const cv = cover(box) + (avoid && hit(box, avoid) ? 0.3 : 0), len = Math.hypot(lead[1][0] - p.x, lead[1][1] - p.y);
        const take = { box, si, lead, s: { x, y, right: sx >= 0, p } };
        if (cv > (si === it.opt ? KEEP_COVER : MAX_COVER)) continue;    // REPAIR (R5): fiber under the label is a hard limit, before the length of the leader
        if (cv <= (si === it.opt ? KEEP_COVER : 0.04) && len < 130) { best = take; bc = -1; break; }   // near, and clear of every form (the seat it has may keep a little)
        const c = 2 * cv + 0.0007 * len - (si === it.opt ? 0.1 : 0);                                 // otherwise: as clear as can be had without a leader across the picture
        if (c < bc) { bc = c; best = take; }
      }
      if (!best) return false;                                          // no designed seat is clear: the caller looks for a free place (below), and failing that there is no label rather than a label on the form
      placed.push(best.box); leaders.push(best.lead); it.opt = best.si; it.rect = best.box; it.fs = null; show.set(it, best.s);
      return true;
    };
    // REPAIR (R5): a free place. When no designed seat round the dot is clear (a woven body fills the frame), the label may
    // sit anywhere in the frame that is clear of every form, panel, label and leader: the nearest such place to its dot.
    // The place is remembered as an offset from the dot and kept while it stays clear, and the search (a walk over the
    // frame in steps of 20 pixels) runs at most once in twelve frames for a label, so nothing jumps and nothing is slow.
    const tryAt = (it, p, x, y, limit, relax = false) => {
      if (x < 14 || y < 14 || x + it.w > W - 14 || y + it.h > H - 14) return null;
      const box = { x: x - 8, y: y - 6, w: it.w + 16, h: it.h + 12 };
      if (p.x > box.x - 6 && p.x < box.x + box.w + 6 && p.y > box.y - 6 && p.y < box.y + box.h + 6) return null;      // never on its own dot
      if (this.keep.some((r) => hit(box, r)) || placed.some((r) => hit(box, r)) || (limit < 1 && cover(box) > limit)) return null;      // TYPE: (a limit of 1 or more cannot fail: the cells are not counted for it)
      const right = Math.abs(x - p.x) <= Math.abs(x + it.w - p.x), lead = [[p.x, p.y], [right ? x : x + it.w, y + it.nameH + 3]];
      if (!relax && (leaders.some((l) => cross(lead, l)) || placed.some((r) => through(lead, r)) || leaders.some((l) => through(l, box)))) return null;
      return { box, lead, len: Math.hypot(lead[1][0] - p.x, lead[1][1] - p.y), s: { x, y, right, p } };
    };
    const free = (it, p, limits, maxLen) => {
      let best = it.fs && it.fs.mode === mode ? tryAt(it, p, p.x + it.fs.dx, p.y + it.fs.dy, Math.max(it.fs.limit, KEEP_COVER)) : null;
      if (best && best.len > maxLen * 1.15) best = null;
      if (!best) {
        if (this.tick - (it.ft == null ? -99 : it.ft) < 12) return false;
        it.ft = this.tick;
        for (const limit of limits) {
          let bl = maxLen;
          for (let y = 16; y + it.h <= H - 16; y += 20) for (let x = 16; x + it.w <= W - 16; x += 20) {
            const ex = Math.abs(x - p.x) <= Math.abs(x + it.w - p.x) ? x : x + it.w;
            if (Math.hypot(ex - p.x, y + it.nameH + 3 - p.y) >= bl) continue;                 // (cheapest test first: farther than the best so far)
            const t = tryAt(it, p, x, y, limit); if (t && t.len > 34) { best = t; bl = t.len; }
          }
          if (best) { it.fs = { mode, limit, dx: best.s.x - p.x, dy: best.s.y - p.y }; break; }
        }
        if (!best) return false;
      }
      placed.push(best.box); leaders.push(best.lead); it.opt = -1; it.rect = best.box; show.set(it, best.s);
      return true;
    };
    if (mode === 'plate') {
      // the plate: every form has a designed seat, tried first; the general seats are only a fallback
      const k = Math.min(W / 1440, H / 900);
      // (ART: a designed dot that falls under a panel in this window gives way to the first of the form's other anchors that does not)
      const corner = this.keep[this.keep.length - 1], onlyCorner = (q) => corner && q.x > corner.x && q.y > corner.y && !this.keep.slice(0, -1).some((r) => q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h);
      // (REPAIR R5: a small form that lies wholly in the corner the app keeps clear still gets its dot, and its label a free place outside the corner)
      const vis = this.items.map((it) => { const qs = [it.m.plateAnchor, ...(it.m.anchors || [])].map(project).filter((q) => q.front && q.x > 8 && q.y > 8 && q.x < W - 8 && q.y < H - 8); return { it, p: qs.find((q) => !inKeep(q.x, q.y)) || qs.find(onlyCorner) || qs[0] }; })      /* CABLES: a form that lies wholly behind a panel in this window is still named (its dot is behind the panel) */.filter((o) => o.p).sort((a, b) => a.p.x + a.p.y - b.p.x - b.p.y);   // ART (A2): from the top left corner outward (was top to bottom), so the crowded side is seated first
      const late = [];
      for (const o of vis) {
        const d = PLATE_SEATS[o.it.m.id], seats = d ? [d, ...SEATS, ...FAR_SEATS] : [...SEATS, ...FAR_SEATS], kk = Math.max(k, 0.8);
        if (seat(o.it, o.p, seats, kk, true)) continue;
        // ART (A2): no clear seat round the designed dot (a full body in a small pane): the dot may sit elsewhere on the form
        let ok = false;
        for (const a of o.it.m.anchors || []) { const q = project(a); if (q.front && !inKeep(q.x, q.y) && seat(o.it, q, seats, kk, false)) { ok = true; break; } }
        if (!ok) late.push(o);
      }
      // REPAIR (R5): then, for the forms still unnamed (after every label that has a clear seat beside its dot is seated, so
      // their short leaders are in place first), any free place in the frame, nearest first; its leader crosses no other
      // leader and runs under no label. Failing that it may take a place that touches a form (up to 0.42 of its box on
      // marked cells: the edge or a thin part of a form), and where a window is too small even for that the label is not
      // shown rather than laid on a form: the chips in the dock still name and count every family.
      // CABLES (second check: 8, 7 and 3 of 10 families named on the plate): the plate names every family, always. A form
      // still unnamed takes the place that costs least: the length of its leader plus a heavy charge for every part of
      // its box over a tenth that lies on a form (so a clear place a little farther off beats a near one on a bundle, but
      // no leader crosses the whole picture to save a few percent). Only if no place at all has a leader clear of the
      // others is that rule let go. The search runs once in twelve frames for a label and the place is remembered.
      // TYPE (11 Nov, founder note 2): a label belongs beside its own form. The type is larger now and so are the boxes, and
      // with the legend open the rule above sent labels across the whole picture to the nearest clear corner (a leader of
      // 1,130 px at 1440 x 900). So a free place is looked for within reach of the dot first: a fifth of the frame's
      // diagonal, which is as far as the farthest designed seat goes. Within reach the old charge still decides (the
      // clearest place, then the nearest), so the label sits beside its form and not on it wherever there is room. A place
      // is ranked: 0 in reach and clear of every other leader and label; 1 up to half as far again, still clear; 2 in
      // reach but across a leader; 3 and 4 are the old last resorts (anywhere, clear; anywhere). The best rank wins. A
      // place of rank 1 or worse is kept only until a better one turns up (looked for again once a second), and every
      // free place is looked for afresh after a panel has opened or closed (_measure, keepTick).
      const reach = 0.2 * Math.hypot(W, H);
      const crosses = (t) => leaders.some((l) => cross(t.lead, l)) || placed.some((r) => through(t.lead, r)) || leaders.some((l) => through(l, t.box));
      const far = (len) => (len <= reach ? 0 : len <= 1.5 * reach ? 1 : 3);
      const rank = (t) => { const f = far(t.len); return crosses(t) ? (f === 0 ? 2 : 4) : f; };
      for (const o of late) {
        const it = o.it, p = o.p;
        // (the dot may sit on any of the form's anchors that is in frame: more places to reach a clear seat from)
        const ok = (q) => q.front && q.x > 8 && q.y > 8 && q.x < W - 8 && q.y < H - 8 && !inKeep(q.x, q.y);
        const dots = [p, ...(it.m.anchors || []).map(project)];
        const rp = it.fs && it.fs.mode === 'plate*' ? dots[it.fs.di] : null;
        let best = rp && (it.fs.di === 0 || ok(rp)) ? tryAt(it, rp, rp.x + it.fs.dx, rp.y + it.fs.dy, 1.01, true) : null;
        let br = best ? rank(best) : 9;
        const old = !!best && !(it.fs.at >= (this.keepTick || 0));      // taken before the panels last changed: looked for again, from scratch
        if ((br > 0 || old) && this.tick - (it.ft == null ? -99 : it.ft) >= (best && !old ? 60 : 12)) {
          it.ft = this.tick;
          let found = null, fr = old ? 9 : br, fc = 1e9, fd = 0;
          for (let di = 0; di < dots.length; di++) { const dp = dots[di]; if (di && !ok(dp)) continue; for (let y = 16; y + it.h <= H - 16; y += 18) for (let x = 16; x + it.w <= W - 16; x += 18) {
            const ex = Math.abs(x - dp.x) <= Math.abs(x + it.w - dp.x) ? x : x + it.w;
            if (far(Math.hypot(ex - dp.x, y + it.nameH + 3 - dp.y)) > fr) continue;               // (cheapest test first: it could not rank better than the best so far)
            const t = tryAt(it, dp, x, y, 1.01, true); if (!t || t.len < 34) continue;
            const r = rank(t); if (r > fr) continue;
            const c = t.len + 2200 * Math.max(0, cover(t.box) - 0.08);
            if (r < fr || c < fc) { fr = r; fc = c; found = t; fd = di; }
          } }
          if (found && (old || fr < br)) { best = found; br = fr; it.fs = { mode: 'plate*', limit: 1.01, relax: true, di: fd, dx: found.s.x - found.s.p.x, dy: found.s.y - found.s.p.y, at: this.tick }; }
          else if (old) it.fs.at = this.tick;
        }
        if (best) { placed.push(best.box); leaders.push(best.lead); it.opt = -1; it.rect = best.box; show.set(it, best.s); }
      }
    } else {
      // on the rail: each form shows the dot that sits best in frame; the form this stretch is about comes first
      const cand = [];
      for (const it of this.items) {
        if (only && it.m.id !== only) continue;
        let best = null, bs = 0, bi = -1;
        const pts = only && at ? (Array.isArray(at[0]) ? at : [at]) : it.m.anchors;     // ART (A7): the close-up may offer more than one place for the dot
        pts.forEach((a, i) => {
          const q = project(a);
          if (!q.front || Math.abs(q.nx) > 0.9 || Math.abs(q.ny) > 0.82 || q.d < 9 || (!only && q.d > (it.m.empty ? 520 : 330)) || inKeep(q.x, q.y)) return;
          let sc = (1 - 0.7 * Math.abs(Math.hypot(q.nx, q.ny) - 0.45)) / (1 + q.d / 150);       // not dead centre, not at the edge, nearer is better
          if (i === it.anchor) sc *= 1.35;                                                      // stay on the dot you have
          if (sc > bs) { bs = sc; best = q; bi = i; }
        });
        it.anchor = bi;
        if (best) cand.push({ it, p: best, sc: bs * (it.m.id === lead ? 6 : 1) * (it.on ? 1.2 : 1) * (it.m.empty ? 40 : 1) });   // ART (A6): a form with no skills yet is a few dark lanes; wherever it is in frame it says so (was: last in line, so it stood unnamed)
      }
      cand.sort((a, b) => b.sc - a.sc);
      const max = only ? 1 : 4 + cand.filter((c) => c.it.m.empty).length;
      for (const c of cand) {
        if (show.size >= max) break;
        const it = c.it, p = c.p;
        let seats;
        if (only) seats = mode === 'focus' ? [[-1, 1, 150, 120], [1, 1, 150, 120], [-1, -1, 150, 120], [1, -1, 150, 120]] : [[1, -1, 170, 120], [1, 1, 170, 120], [-1, -1, 170, 120], [-1, 1, 170, 120]];
        else {
          // a label leans away from the middle of the frame, where the subject is
          const sx = p.x < W / 2 ? -1 : 1, sy = p.y < H * 0.46 ? -1 : 1, lean = sx * 2 + sy;
          if (it.lean !== lean) { it.lean = lean; it.opt = -1; }
          seats = [[sx, sy, 56, 38], [sx, -sy, 56, 40], [sx, sy, 100, 78], [sx, -sy, 100, 80], [-sx, sy, 56, 38], [-sx, -sy, 56, 40], [sx, sy, 150, 112], [-sx, sy, 100, 78], [-sx, -sy, 100, 80], [sx, sy, 200, 150], [-sx, sy, 200, 150], [sx, -sy, 200, 150], ...FAR_SEATS];
        }
        // FIX V31: a compact form that carries proven fibers is the thing to look at: its label takes a seat beside it,
        // never on it. The box is the form as the lens sees it (its centre and its radius). If no seat is free the
        // label falls back to the ordinary rule rather than going missing.
        let avoid = null;
        const m = it.m;
        if (!only && m.fam.proven > 0 && m.id !== 'research' && m.R > 0) {   // any compact form with proven work (on a well-used body, every one)
          const c = project(m.center), e = [project([m.center[0] + m.R, m.center[1], m.center[2]]), project([m.center[0], m.center[1] + m.R, m.center[2]]), project([m.center[0], m.center[1], m.center[2] + m.R])];
          const r = 0.8 * Math.max(...e.map((q) => Math.hypot(q.x - c.x, q.y - c.y)));
          if (c.front && r > 12 && r < 0.2 * W) avoid = { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r };
        }
        // The form with the most proven work may send its label well clear of it; any other form only to a seat close by
        // (a long leader across the picture points at the wrong thing), and failing that the label sits where it always did.
        // REPAIR (R5): and when no seat round the dot is clear, a free place within reach; failing that, no label
        if (!seat(it, p, seats, 1, true, avoid)) free(it, p, [MAX_COVER], only ? 1e4 : 0.42 * Math.min(W, H));   // ART (A2): one rule now: the nearest seat that is clear of every form, of every label and of every leader
      }
    }
    for (const it of this.items) {
      const s = show.get(it);
      if (!s) { it.rect = null; if (it.on) { it.on = false; it.box.classList.remove('on'); it.g.classList.remove('on'); } continue; }
      if (!it.on) { it.on = true; it.box.classList.add('on'); it.g.classList.add('on'); }
      const key = `${s.x.toFixed(1)},${s.y.toFixed(1)},${s.p.x.toFixed(1)},${s.p.y.toFixed(1)},${s.right}`;
      if (key === it.key) continue;                       // nothing moved: no DOM writes at all
      it.key = key;
      it.box.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      it.box.classList.toggle('flip', !s.right);
      const uy = s.y + it.nameH + 3, x0 = s.right ? s.x : s.x + it.w, x1 = s.right ? s.x + it.w : s.x;
      const dx = x0 - s.p.x, dy = uy - s.p.y;
      it.a.style.transform = `translate(${s.p.x.toFixed(1)}px, ${s.p.y.toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(4)}rad) scaleX(${Math.hypot(dx, dy).toFixed(1)})`;
      it.b.style.transform = `translate(${Math.min(x0, x1).toFixed(1)}px, ${uy.toFixed(1)}px) scaleX(${Math.abs(x1 - x0).toFixed(1)})`;
      it.dot.style.transform = `translate(${s.p.x.toFixed(1)}px, ${s.p.y.toFixed(1)}px)`;
    }
    // tool names at the ends of the nerve lines
    for (const t of this.toolItems) {
      const on = !!focusSkill && focusSkill.toolIds.includes(t.tn.tool.id), c = on ? M4.point(vp, t.tn.pos) : null;
      const vis = on && c[3] > 1 && Math.abs(c[0]) < 0.96 && Math.abs(c[1]) < 0.94;
      t.box.classList.toggle('on', !!vis);
      if (vis) t.box.style.transform = `translate(${((c[0] * 0.5 + 0.5) * W + 10).toFixed(1)}px, ${((0.5 - c[1] * 0.5) * H - 8).toFixed(1)}px)`;
    }
  }
}
