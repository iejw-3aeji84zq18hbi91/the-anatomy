// Deep links into the anatomy.
//   ?focus=<node id>           opens flown-in on that fiber with its record open (the chat's "See it in the Anatomy").
//                              An id that is not a skill in this library shows one quiet line instead.
//   ?burst=<same-origin url>   names the burst document the Burst control replays, and plays it on arrival.
//                              Without it the Burst control replays the document named by <meta name="anatomy-burst">
//                              in index.html (the app sets it), or the default below.
export const BURST_DEFAULT = '../kit/burst-25k.json';
export const NOT_HERE = 'That skill is not in this library.';

// A relative or same-origin URL, or the fallback. Nothing is ever fetched from another origin.
export function sameOrigin(q, fallback) {
  if (!q) return fallback;
  try { const u = new URL(q, location.href); return u.origin === location.origin ? u.href : fallback; } catch { return fallback; }
}

export function readLinks(qs = new URLSearchParams(location.search)) {
  const focus = qs.get('focus'), burst = qs.get('burst');
  // FIX V06: with no ?burst=, the address the app wrote into <meta name="anatomy-burst"> in index.html; then the default.
  const m = document.querySelector('meta[name="anatomy-burst"]'), fromApp = m && m.content ? m.content : null;
  return { focus: focus ? focus : null, burstUrl: sameOrigin(burst || fromApp, BURST_DEFAULT), burstAsked: !!burst };
}

// Open on one fiber, already flown in. `focus` is the viewer's own focus(id, opts). Returns null when no id was
// asked for, true when the fiber is open, false when the id is not a skill here (and says so, quietly).
export function openFocus(id, focus, say) {
  if (id == null) return null;
  if (focus(id, { instant: true })) return true;
  say(NOT_HERE);
  return false;
}
