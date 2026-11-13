// Feed -> model. Everything the picture shows is derived here from the document and nothing else.
// Schema: autogenic.skill-map/1. null means "not recorded" and is carried through as null.

import { hash32 } from './math.js?v=mweb9mux';

// The ten first-class muscles, in a fixed order. Colours are the brief's, lightly tuned for harmony.
export const FAMILIES = [
  { id: 'research', color: '#FFC56A', arch: 'the river' },
  { id: 'back_office', color: '#38DCCB', arch: 'the veil' },
  { id: 'making', color: '#A68BFF', arch: 'the rope' },
  { id: 'conversation', color: '#FF7BA6', arch: 'the loop' },
  { id: 'browser', color: '#5AA2FF', arch: 'the fan' },
  { id: 'tools', color: '#74E6FF', arch: 'the plume' },
  { id: 'computer', color: '#E4ECFF', arch: 'the delta' },
  { id: 'shell', color: '#FF9C58', arch: 'the harp' },
  { id: 'files', color: '#C4EE66', arch: 'the strata' },
  { id: 'mail', color: '#EE6CDD', arch: 'the quill' },
];
export const NEUTRAL = '#AEB6C6';
export const FASCICLE_MAX = 48;

export const ORIGIN = { learned: 0, taught: 1, library: 2, foundry: 3 };   // anything else -> 4 (neutral)
export const STATE = { active: 0, staged: 1, off: 2, observed: 3 };        // anything else -> 4 (neutral)

const count = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0);
const time = (v) => { if (!v) return null; const t = Date.parse(v); return isFinite(t) ? t : null; };

// A small union-find over objects. root() is undefined for anything never joined.
function unionFind() {
  const parent = new Map();
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  return {
    union(a, b) { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra.order < rb.order ? rb : ra, ra.order < rb.order ? ra : rb); },
    root: (x) => (parent.has(x) ? find(x) : undefined),
    groups() { const g = new Map(); for (const x of parent.keys()) { const r = find(x); if (!g.has(r)) g.set(r, []); g.get(r).push(x); } return [...g.values()]; },
  };
}

export function buildModel(doc) {
  doc = doc && typeof doc === 'object' ? doc : {};
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const links = Array.isArray(doc.links) ? doc.links : [];
  const events = Array.isArray(doc.events) ? doc.events : [];
  const totals = doc.totals && typeof doc.totals === 'object' ? doc.totals : {};

  const tools = nodes.filter((n) => n && n.type === 'tool').map((n) => ({ id: n.id, label: n.label || n.id }));
  const toolById = new Map(tools.map((t) => [t.id, t]));
  const famLabel = new Map();
  for (const n of nodes) if (n && n.type === 'family') famLabel.set(String(n.id).replace(/^family:/, ''), n.label || n.id);

  const byId = new Map();

  // Links. Five kinds are understood; any other kind is skipped without complaint.
  const usesTool = new Map(), builtFrom = [], sameShape = [], chainsTo = [];
  for (const l of links) {
    if (!l || l.source == null || l.target == null) continue;
    if (l.kind === 'uses_tool') {
      if (!usesTool.has(l.source)) usesTool.set(l.source, []);
      usesTool.get(l.source).push(l.target);
    } else if (l.kind === 'built_from') builtFrom.push(l);
    else if (l.kind === 'same_shape') sameShape.push(l);
    else if (l.kind === 'chains_to') chainsTo.push(l);
  }

  const families = FAMILIES.map((f, i) => ({ ...f, index: i, known: true, label: famLabel.get(f.id) || f.id, skills: [], fascicles: [] }));
  const famById = new Map(families.map((f) => [f.id, f]));

  const skills = [];
  nodes.forEach((n) => {
    if (!n || n.type !== 'skill') return;
    const famId = n.family == null ? 'unsorted' : String(n.family);
    let fam = famById.get(famId);
    if (!fam) { // unknown family: still drawn, neutral finish, its own plain bundle
      fam = { id: famId, color: NEUTRAL, arch: 'loose strands', index: families.length, known: false, label: famLabel.get(famId) || famId, skills: [], fascicles: [] };
      families.push(fam); famById.set(famId, fam);
    }
    const toolIds = (usesTool.get(n.id) || []).slice().sort();
    const jobs = count(n.jobs_done), handed = count(n.handed_back), clean = count(n.clean_runs);
    const s = {
      id: String(n.id), order: skills.length, raw: n, label: n.label == null ? '' : String(n.label),
      family: fam, origin: n.origin, state: n.state,
      originCode: n.origin in ORIGIN ? ORIGIN[n.origin] : 4, stateCode: n.state in STATE ? STATE[n.state] : 4,
      learnedMs: time(n.learned_at), toolIds, toolKey: toolIds.join('+'),
      jobs, handed, clean,
      // brightness tier, from the record only: 2 proven, 1 practised, 0 formed
      tier: jobs > 0 ? 2 : clean > 0 ? 1 : 0,
      seed: hash32(String(n.id)), fiber: -1, strand: null, strandIndex: 0, chains: [],
    };
    fam.skills.push(s); skills.push(s); byId.set(s.id, s);
  });

  // ---- built_from: a swarm and its lanes. In the feed the link runs from the swarm (source) to each
  // lane (target); one swarm today has 206 lanes. Grouping is by connected component, so it holds
  // whichever way a later feed writes the link. Ends that are not skills (lessons, recordings) are skipped.
  const swarmUF = unionFind(), degree = new Map();
  for (const l of builtFrom) {
    const a = byId.get(String(l.source)), b = byId.get(String(l.target));
    if (!a || !b || a === b) continue;
    swarmUF.union(a, b);
    degree.set(a, (degree.get(a) || 0) + 1); degree.set(b, (degree.get(b) || 0) + 1);
  }
  // ---- same_shape: versions of one learned request. A strand is drawn twisted together and never split.
  const shapeUF = unionFind();
  for (const l of sameShape) {
    const a = byId.get(String(l.source)), b = byId.get(String(l.target));
    if (a && b && a !== b && a.family === b.family) shapeUF.union(a, b);
  }
  const byLearned = (a, b) => (a.learnedMs ?? Infinity) - (b.learnedMs ?? Infinity) || a.order - b.order;
  const strands = [];
  for (const members of shapeUF.groups()) {
    if (members.length < 2) continue;
    members.sort(byLearned);
    const strand = { id: 'strand:' + members[0].id, members };
    members.forEach((s, i) => { s.strand = strand; s.strandIndex = i; });
    strands.push(strand);
  }
  // ---- chains_to: one skill feeds the next. Drawn as a thin tendon while either end is in focus.
  const chains = [], seenChain = new Set();
  for (const l of chainsTo) {
    const a = byId.get(String(l.source)), b = byId.get(String(l.target)), key = l.source + '>' + l.target;
    if (!a || !b || a === b || seenChain.has(key)) continue;
    seenChain.add(key); chains.push({ from: a, to: b });
    a.chains.push({ other: b, dir: 1 }); b.chains.push({ other: a, dir: -1 });
  }

  // ---- fascicles. Lanes that share a swarm run together; where there is no swarm the tool set is the
  // group. Inside a group: learned order (undated last), a strand kept whole at its oldest member, and
  // anything over about 48 fibers split into equal parts that stay neighbours.
  for (const fam of families) {
    const swarmSize = new Map();
    for (const s of fam.skills) { const r = swarmUF.root(s); if (r) swarmSize.set(r, (swarmSize.get(r) || 0) + 1); }
    const keyOf = (s) => { const r = swarmUF.root(s); return r && swarmSize.get(r) > 1 ? 'swarm:' + r.id : 'tools:' + s.toolKey; };
    const groups = new Map();
    for (const s of fam.skills) {
      const key = keyOf(s.strand ? s.strand.members[0] : s);
      if (!groups.has(key)) groups.set(key, { key, swarm: key.startsWith('swarm:'), skills: [] });
      groups.get(key).skills.push(s);
    }
    const order = [...groups.values()].sort((a, b) => (b.swarm - a.swarm) || b.skills.length - a.skills.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    order.forEach((g, gi) => {
      // the swarm itself (the hub of its links) leads its lanes
      const hub = g.swarm ? g.skills.reduce((a, s) => ((degree.get(s) || 0) > (degree.get(a) || 0) ? s : a), g.skills[0]) : null;
      g.skills.sort((a, b) => ((b === hub) - (a === hub)) || byLearned(a, b));
      const units = [], done = new Set();
      for (const s of g.skills) {
        if (done.has(s)) continue;
        const unit = s.strand ? s.strand.members.filter((x) => x.family === fam) : [s];
        unit.forEach((x) => done.add(x)); units.push(unit);
      }
      const n = g.skills.length, parts = Math.max(1, Math.ceil(n / FASCICLE_MAX)), per = Math.ceil(n / parts);
      let cur = null, made = 0;
      for (const unit of units) {
        if (!cur || (cur.skills.length >= per && made < parts)) {
          cur = { group: g.key, groupIndex: gi, swarm: g.swarm, toolKey: g.swarm ? null : g.skills[0].toolKey, part: made++, parts, units: [], skills: [] };
          fam.fascicles.push(cur);
        }
        cur.units.push(unit); cur.skills.push(...unit);
      }
      for (const f of fam.fascicles) if (f.group === g.key) f.parts = made;
    });
    fam.groups = order.length;
    fam.jobs = fam.skills.reduce((a, s) => a + s.jobs, 0);
    fam.proven = fam.skills.filter((s) => s.jobs > 0).length;
    // FIX V02/V03/V23: how many of its skills carry a recorded jobs_done at all. null is "not recorded", never zero:
    // a family whose skills hold no number says "no jobs recorded" on its label, not "0 jobs done".
    fam.recorded = fam.skills.filter((s) => typeof s.raw.jobs_done === 'number' && isFinite(s.raw.jobs_done)).length;
  }

  // Growth order: dated skills by learned_at; undated ones are present throughout (birth = -1).
  const dated = skills.filter((s) => s.learnedMs != null).sort((a, b) => a.learnedMs - b.learnedMs || a.order - b.order);
  dated.forEach((s, i) => { s.birth = dated.length > 1 ? i / (dated.length - 1) : 0; });
  for (const s of skills) if (s.learnedMs == null) s.birth = -1;

  // The single most proven skill: highest jobs_done, then clean_runs, then feed order.
  let mostProven = null;
  for (const s of skills) {
    if (s.jobs <= 0) continue;
    if (!mostProven || s.jobs > mostProven.jobs || (s.jobs === mostProven.jobs && s.clean > mostProven.clean)) mostProven = s;
  }
  // The region with the most proven fibers (falls back to the largest family).
  let provenFamily = null;
  for (const f of families) if (f.skills.length && (!provenFamily || f.proven > provenFamily.proven || (f.proven === provenFamily.proven && f.skills.length > provenFamily.skills.length))) provenFamily = f;

  return {
    doc, totals, partial: doc.partial === true, mock: doc.mock === true, generatedAt: doc.generated_at || null,
    skills, families, tools, toolById, events, dated,
    undated: skills.length - dated.length,
    byId, strands, chains,
    linkCount: links.length,
    sumJobs: skills.reduce((a, s) => a + s.jobs, 0),
    sumHanded: skills.reduce((a, s) => a + s.handed, 0),
    mostProven, provenFamily,
  };
}

export async function loadFeed(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('feed ' + res.status);
  return res.json();
}
