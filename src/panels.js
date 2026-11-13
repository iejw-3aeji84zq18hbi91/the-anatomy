// The panels that are not fed by the skill map: the key caps, the legend, the burst counters, quiet notices.
// Markup lives in index.html and styles in viewer.css; this file only fills text and toggles `hidden`
// (CSSOM custom properties only, so it passes the app's security policy).

const $ = (id) => document.getElementById(id);
const NOT = 'Not recorded';
const int = (v) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US') : NOT);

// "Ran in": the run's own duration, as recorded.
function ranIn(s) {
  if (typeof s !== 'number' || !isFinite(s)) return NOT;
  if (s < 60) return `${s.toLocaleString('en-US', { maximumFractionDigits: 2 })} s`;
  return s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}
// How the replay's pace compares with the run's: the replay length over the recorded wall time.
function pace(k) {
  if (!(k > 0)) return 'Slowed down to watch; how long the run took was not recorded.';
  if (k >= 1.5) return `Replayed about ${Math.round(k).toLocaleString('en-US')} times slower than it ran.`;
  if (k > 1 / 1.5) return 'Replayed at about the speed it ran.';
  return `Replayed about ${Math.round(1 / k).toLocaleString('en-US')} times faster than it ran.`;
}
const put = (el, text) => { if (el.textContent !== text) el.textContent = text; };
// The specimen plate belongs to the light and material work.
const specimenFn = () => { const M = window.__MM || {}; return typeof M.specimen === 'function' ? M.specimen : null; };
const value = (el, v, fmt = int) => { const t = fmt(v); put(el, t); el.classList.toggle('nr', t === NOT); };

export class Panels {
  // h: { autopilot(), burst(), stopBurst(), leave(), layout() }
  // leave() ends whatever this build has open before another view takes the camera; layout() is called whenever a panel opens or closes
  constructor(h) {
    this.h = h;
    const press = (id, fn) => $(id).addEventListener('click', (e) => { if (e.detail) e.currentTarget.blur(); if (fn) fn(); });
    press('btn-auto', () => h.autopilot());
    press('btn-burst', () => h.burst());
    press('btn-legend', () => this.legend());
    press('legend-close', () => this.legend(false));
    press('burst-close', () => h.stopBurst());
    press('btn-specimen', () => { const f = specimenFn(); if (f) { h.leave(); f.call(window.__MM); } });
    // a pointer click leaves the button, so Space and the letter keys go back to the anatomy
    for (const id of ['btn-overview', 'btn-replay', 'g-play']) press(id);
  }

  // ---------------------------------------------------------------- key caps
  // FIX V41: with reduced motion the camera does not travel, and the button says why instead of saying "on"
  autopilot(on, reduced = false) { put($('btn-auto-t'), reduced ? 'Autopilot off: reduced motion' : on ? 'Autopilot on' : 'Autopilot off'); $('btn-auto').setAttribute('aria-pressed', String(!!on && !reduced)); }
  overview(plate) { put($('btn-overview-t'), plate ? 'Fly inside' : 'Overview'); }

  // ---------------------------------------------------------------- legend
  get legendOpen() { return !$('legend').hidden; }
  legend(open) {
    const el = $('legend'), on = open === undefined ? el.hidden : !!open;
    el.hidden = !on; $('btn-legend').setAttribute('aria-expanded', String(on));
    $('btn-specimen').hidden = !specimenFn();              // the button shows only when that hook exists
    this.h.layout();
    return on;
  }

  // Rows of the legend that are true only when the layout draws them: versions twisted together (same_shape links)
  // and the thin tendon from one skill to the next (chains_to links). Hidden unless the model carries such links.
  features({ strands = false, chains = false } = {}) {
    for (const row of document.querySelectorAll('#legend [data-if]')) row.hidden = !(row.dataset.if === 'strands' ? strands : row.dataset.if === 'chains' ? chains : false);
  }

  // ---------------------------------------------------------------- burst counters
  // info: the fixed facts of this replay, from burst.js. numeral: the plate numeral of its family, if it has one.
  burstOpen(info, numeral = '') {
    const el = $('burst');
    el.hidden = false; el.classList.remove('is-quiet');
    if (info.color) el.style.setProperty('--c', info.color); else el.style.removeProperty('--c');
    const where = $('burst-where'), num = document.createElement('i');
    num.className = 'l-num'; num.textContent = numeral;
    where.replaceChildren(`${int(info.skills)} ${info.skills === 1 ? 'skill' : 'skills'} in `, ...(numeral ? [num, ' '] : []), info.where);
    this._chip(info.family ? info.family.id : null);
    value($('b-wrong'), info.wrong); value($('b-calls'), info.modelCalls); value($('b-ran'), info.wallSeconds, ranIn);
    const cap = $('burst-caption'), line = (t) => { const s = document.createElement('span'); s.textContent = t; return s; };
    // FIX V21: amber means a hand-back to the MODEL on the map and a hand-back to a PERSON in this run. The panel says so.
    cap.replaceChildren(line(info.day ? `Sandbox run, ${info.day}.` : 'Sandbox run.'), line(pace(info.slower)), line('Not counted in jobs done.'), line('In this sandbox run a hand-back goes to a person, not to the model.'));
    const notes = [];
    if (info.missing) notes.push(`${int(info.missing)} of the ${int(info.runs)} skills in this run ${info.missing === 1 ? 'is' : 'are'} not in this library. ${info.missing === 1 ? 'Its' : 'Their'} jobs are not shown.`);
    if (info.unread) notes.push(`${int(info.unread)} ${info.unread === 1 ? 'job has' : 'jobs have'} no readable outcome and ${info.unread === 1 ? 'is' : 'are'} not shown.`);
    if (info.mismatch) notes.push('The totals written in the file do not match its list of jobs. The list is what is shown.');
    const note = $('burst-note'); note.hidden = !notes.length; put(note, notes.join(' '));
    $('btn-burst').setAttribute('aria-pressed', 'true');
    this.burstTick({ phase: 'flying', t: 0, jobs: 0, done: 0, handedBack: 0 });
    this.h.layout();
  }
  // the chip of the family a burst is running in is marked while it runs
  _chip(id) { for (const c of document.querySelectorAll('#chips .chip')) c.classList.toggle('is-current', id != null && c.dataset.family === id); }
  // s: the rolling state, once a frame
  burstTick(s) {
    put($('btn-burst-t'), s.phase === 'done' ? 'Replay burst' : 'Stop burst');      // B stops a running replay, and plays a finished one again
    put($('b-jobs'), int(s.jobs)); put($('b-done'), int(s.done)); put($('b-handed'), int(s.handedBack));
    const p = Math.round(s.t * 1000) / 1000;
    if (p !== this.barP) { this.barP = p; $('burst-bar').style.setProperty('--p', String(p)); }
  }
  // the panel with one quiet line and nothing else (a document that could not be read, or has no fibers here)
  burstQuiet(text) {
    const el = $('burst');
    el.hidden = false; el.classList.add('is-quiet'); el.style.removeProperty('--c');
    put($('burst-where'), text); $('burst-note').hidden = true; this._chip(null);
    put($('btn-burst-t'), 'Burst'); $('btn-burst').setAttribute('aria-pressed', 'false');
    this.h.layout();
  }
  burstClose() {
    if ($('burst').hidden) return;
    $('burst').hidden = true; this._chip(null);
    put($('btn-burst-t'), 'Burst'); $('btn-burst').setAttribute('aria-pressed', 'false');
    this.h.layout();
  }

  // ---------------------------------------------------------------- one quiet line (for a deep link that finds nothing)
  get noticeOpen() { return !$('notice').hidden; }
  notice(text) { const n = $('notice'); if (n.hidden === !text && n.textContent === (text || '')) return; n.hidden = !text; n.textContent = text || ''; this.h.layout(); }
}
