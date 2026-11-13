// The Anatomy: sound. One self-contained module; nothing else imports it and it imports nothing.
//
// THE BED IS A TRACK: viewer/audio/ambient.mp3, the piece the founder chose on 11 Nov. It plays
// from the person's first click or key press for as long as they are in the Anatomy, and when it
// reaches its end it loops: the track fades into its own beginning over a few seconds, so there
// is no gap and no click where it meets itself.
//
// FOUNDER, 11 Nov 6:45 PM: "just put sound to normal". THE TRACK PLAYS AS IT IS: at its own level,
// exactly as the file sounds in any player, and with nothing laid over it. Before this the page
// brought it down to about half (a "bed", 0.14 average) and added a rush of air when the wheel
// turned and a pulse under the burst replay. Do not bring either back without the founder asking.
// How loud it is belongs to the Mac's volume keys.
//
// IF THE TRACK IS MISSING or cannot be read, the module falls back to a bed it synthesises
// itself: a low drone that beats slowly against itself, a rumble, moving air, a few notes of
// glass, a long dark reverb and, now and then, a distant groan; flying raises a rush of air and
// the burst replay brings a deep pulse. So deleting the audio file leaves the Anatomy with
// sound, not silent. None of the synthesised sound is heard while the track plays.
//
// A browser allows no sound before a gesture, so it starts with the first click or key press.
// The Sound button this module adds to the dock, or the M key, switches it off and on; the
// choice is remembered on this device. An embedding page keeps it silent by default with
// <meta name="anatomy-sound" content="off">.
//
// For a check without ears: await window.__MM_SOUND.check() reports the track's length and
// level and renders a few seconds of the fallback bed offline.
//
// FOR THE PICTURE (the intro, 12 Nov): window.__MM_SOUND.clock() says where the music is, so the
// picture can be cut to it: { run, pos, pass, length, cross, mode, on }. pos is seconds into the
// track as it is heard now; it counts up from just under 0 when the track begins and goes back
// to 0 each time the track loops (pass counts the loops). run is false while there is no track
// sounding. restart() starts the track again from its beginning (it switches the sound on if it
// was off) and resolves true once that is under way. armed is true while the sound is waiting
// for the person's first click or key press. The cue sheet for the track (bars, sections, hits,
// loudness) is audio/ambient.cues.json, written by kit/make-cues.mjs; this module does not read it.

// The remembered on/off choice. The name changed on 11 Nov with "put sound to normal", so an "off"
// left over from before that is forgotten once and the sound is on again; M still switches it off.
const STORE = 'anatomy.sound.2';
const TRACK = new URL('../audio/ambient.mp3?v=mweb9mux', import.meta.url).href;
const CROSS = 4;                             // seconds over which the end of the track fades into its beginning
const LEVEL = 0.36;                          // the volume of the synthesised bed (heard only when there is no track)

const S = {
  ctx: null, nodes: null, on: false, timer: 0, groanAt: 0, wheel: 0, lastJobs: 0, cardOpen: false, armed: false,
  bytes: null, tried: false, track: null, trackRms: 0, trackPeak: 0, trackGain: 1, trackOut: null, trackMaster: null,
  playing: false, nextAt: 0, loops: 0, mode: 'none',
  gen: null, passes: [], voices: [],          // the passes now sounding or about to: for clock() and restart()
};

// ------------------------------------------------------------------ the track and its loop
const UP = new Float32Array(64), DOWN = new Float32Array(64);    // equal-power fade curves
for (let i = 0; i < 64; i++) { const x = i / 63; UP[i] = Math.sin(x * Math.PI / 2); DOWN[i] = Math.cos(x * Math.PI / 2); }

function measure(buf) {                      // average and peak level of a decoded track
  let sum = 0, count = 0, peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 5) { const a = Math.abs(d[i]); sum += a * a; count++; if (a > peak) peak = a; }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  // The track as it is: gain 1. Only a file that itself runs over full scale is eased back, so it does not crackle.
  const gain = peak > 1 ? 1 / peak : 1;
  return { rms, peak, gain };
}

async function bytes() {
  if (!S.bytes) {
    const r = await fetch(TRACK);
    if (!r.ok) throw new Error('no track');
    S.bytes = await r.arrayBuffer();
  }
  return S.bytes.slice(0);                   // decoding empties the buffer it is given, so hand it a copy
}

async function loadTrack(ctx) {
  try {
    const buf = await ctx.decodeAudioData(await bytes());
    const m = measure(buf);
    S.trackRms = m.rms; S.trackPeak = m.peak; S.trackGain = m.gain;
    return buf;
  } catch { return null; }
}

// For testing the loop without waiting out the whole track: ?soundtest=12 treats the track as 12 seconds long.
const TEST = +new URLSearchParams(location.search).get('soundtest') || 0;
function length() { return TEST > 0 ? Math.min(TEST, S.track.duration) : S.track.duration; }
function cross() { return Math.min(CROSS, length() / 4); }

function playOne(at, first) {                // one pass of the track; the next pass is laid over its last seconds
  const ctx = S.ctx, D = length(), X = cross();
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = S.track; src.connect(g); g.connect(S.gen);
  const t = Math.max(at, ctx.currentTime + 0.02);
  g.gain.value = first ? 1 : 0;
  if (!first) g.gain.setValueCurveAtTime(UP, t, X);
  g.gain.setValueCurveAtTime(DOWN, t + D - X, X);
  src.start(t, 0, D + 0.05); src.stop(t + D + 0.05);
  S.nextAt = t + D - X;
  if (first) S.loops = 0; else S.loops++;
  S.passes.push({ at: t, n: S.loops }); if (S.passes.length > 4) S.passes.shift();
  S.voices.push(src); if (S.voices.length > 4) S.voices.shift();
}

// Where the music is, for the picture to follow. pos is seconds into the track as it is heard now.
function clock() {
  const ctx = S.ctx, none = { run: false, pos: 0, pass: 0, length: S.track ? length() : 0, cross: S.track ? cross() : 0, mode: S.mode, on: S.on };
  if (!ctx || S.mode !== 'track' || !S.playing || !S.passes.length) return none;
  const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  let cur = S.passes[0];
  for (const p of S.passes) if (p.at <= now) cur = p;        // the newest pass that has begun; before the first begins pos is just under 0
  return { ...none, run: S.on && ctx.state === 'running', pos: now - cur.at, pass: cur.n };
}

// Start the track again from its beginning. The passes now sounding fade out in a tenth of a second.
async function restart() {
  const live = S.on && !!S.ctx && S.ctx.state === 'running';
  if (live && S.mode === 'track') {
    const last = S.passes[S.passes.length - 1];
    if (last && S.loops === 0 && S.ctx.currentTime - last.at < 0.5) return true;     // it has only just begun: nothing to do
  }
  const had = S.playing;
  if (had && S.gen) {                        // hush what was sounding first, so that switching the sound on does not let a moment of it through
    const t = S.ctx.currentTime;
    S.gen.gain.cancelScheduledValues(t);
    if (live) S.gen.gain.setTargetAtTime(0, t, 0.04); else S.gen.gain.setValueAtTime(0, t);
  }
  if (!live && !(await start())) return false;
  if (S.mode !== 'track') return false;
  if (!had) return true;                     // start() has just begun the first pass itself
  const ctx = S.ctx, t = ctx.currentTime, old = S.gen;
  for (const v of S.voices) { try { v.stop(t + 0.4); } catch { /* it had already ended */ } }
  setTimeout(() => { try { old.disconnect(); } catch { /* gone */ } }, 800);
  S.gen = ctx.createGain(); S.gen.connect(S.trackOut);
  S.voices = []; S.passes = [];
  playOne(t + 0.15, true);
  return true;
}

// ------------------------------------------------------------------ the synthesised layers
function noise(ctx, seconds, brown) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } else d[i] = w;
  }
  return buf;
}

function room(ctx, seconds) {                // the impulse of a long, dark room
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.12 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - i / n, 2.6) * 2.2;
    }
  }
  return buf;
}

function breathe(ctx, hz, depth, param, t0) { // a slow swell on one parameter
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = hz; g.gain.value = depth;
  o.connect(g); g.connect(param); o.start(t0);
}

// Builds the synthesised instrument on any audio context: the live one, or an offline one for check().
// Two buses: "bus" carries the fallback bed, "fx" carries what answers the person (it plays over the track too).
function build(ctx) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain(); master.gain.value = 0;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -14; limit.knee.value = 10; limit.ratio.value = 8; limit.attack.value = 0.01; limit.release.value = 0.4;
  const out = ctx.createGain(); out.gain.value = LEVEL;      // after the limiter, because the limiter makes up its own gain
  master.connect(limit); limit.connect(out); out.connect(ctx.destination);
  const dry = ctx.createGain(); dry.gain.value = 0.8; dry.connect(master);
  const verb = ctx.createConvolver(); verb.buffer = room(ctx, 4.5);
  const wet = ctx.createGain(); wet.gain.value = 0.5; verb.connect(wet); wet.connect(master);
  const bus = ctx.createGain(); bus.connect(dry); bus.connect(verb);
  const fx = ctx.createGain(); fx.connect(dry); fx.connect(verb);

  // The drone: two low notes a hair apart, so they beat slowly, and above them a minor second that never resolves.
  // The three highest voices are there for small speakers, which cannot play the bottom octave: the ear rebuilds the depth from them.
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 220; tone.Q.value = 0.4; tone.connect(bus);
  [[41.2, 'sine', 0.30], [41.55, 'sine', 0.26], [61.7, 'triangle', 0.07], [82.4, 'sine', 0.10], [87.3, 'sine', 0.065],
    [123.5, 'sawtooth', 0.022], [164.8, 'triangle', 0.045], [174.6, 'sine', 0.02]].forEach(([f, type, g], i) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.type = type; o.frequency.value = f; a.gain.value = g;
    o.connect(a); a.connect(tone); o.start(t0);
    breathe(ctx, 0.031 + i * 0.013, g * 0.45, a.gain, t0);
  });
  breathe(ctx, 0.021, 70, tone.frequency, t0);

  // The rumble under it.
  const rumble = ctx.createBufferSource(); rumble.buffer = noise(ctx, 6, true); rumble.loop = true;
  const rumbleCut = ctx.createBiquadFilter(); rumbleCut.type = 'lowpass'; rumbleCut.frequency.value = 85;
  const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0.55;
  rumble.connect(rumbleCut); rumbleCut.connect(rumbleGain); rumbleGain.connect(bus); rumble.start(t0);
  breathe(ctx, 0.047, 0.2, rumbleGain.gain, t0);

  // The air of a very large room.
  const air = ctx.createBufferSource(); air.buffer = noise(ctx, 5, false); air.loop = true; air.start(t0);
  const airBand = ctx.createBiquadFilter(); airBand.type = 'bandpass'; airBand.frequency.value = 520; airBand.Q.value = 0.7;
  const airGain = ctx.createGain(); airGain.gain.value = 0.018;
  air.connect(airBand); airBand.connect(airGain); airGain.connect(bus);
  breathe(ctx, 0.05, 240, airBand.frequency, t0);

  // Far above it all: a few notes of glass that drift in and out, heard only through the room.
  const glass = ctx.createGain(); glass.gain.value = 1; glass.connect(verb);
  const bedGlass = ctx.createGain(); bedGlass.connect(glass);
  [[329.6, 0.010], [493.9, 0.008], [622.3, 0.004], [659.3, 0.006]].forEach(([f, g], i) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; a.gain.value = g;
    o.connect(a); a.connect(bedGlass); o.start(t0);
    breathe(ctx, 0.017 + i * 0.011, g * 0.95, a.gain, t0);     // each one swells and fades on its own slow clock
    breathe(ctx, 0.09 + i * 0.03, f * 0.0025, o.frequency, t0);  // and wavers very slightly, like light in water
  });

  // Flying: a rush of air that follows the wheel.
  const rushBand = ctx.createBiquadFilter(); rushBand.type = 'bandpass'; rushBand.frequency.value = 900; rushBand.Q.value = 0.9;
  const rush = ctx.createGain(); rush.gain.value = 0;
  air.connect(rushBand); rushBand.connect(rush); rush.connect(fx);

  // The burst replay: a deep pulse.
  const pulseTone = ctx.createOscillator(); pulseTone.type = 'sine'; pulseTone.frequency.value = 36;
  const throb = ctx.createGain(); throb.gain.value = 0.5;
  const pulse = ctx.createGain(); pulse.gain.value = 0;
  pulseTone.connect(throb); throb.connect(pulse); pulse.connect(fx); pulseTone.start(t0);
  breathe(ctx, 2.2, 0.5, throb.gain, t0);

  return { ctx, master, out, bus, fx, bedGlass, rush, rushBand, pulse, tone, airGain };
}

function groan(n) {                          // something large shifting, far away (fallback bed only)
  const { ctx, bus } = n, t = ctx.currentTime, f = 58 + Math.random() * 26;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.68, t + 5);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + 5.6);
}

function chime(n) {                          // a fiber's card opens: low glass, struck once (fallback bed only)
  const { ctx, bus } = n, t = ctx.currentTime;
  [[196, 0.05], [293.7, 0.03], [587.3, 0.012]].forEach(([f, level]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 2.7);
  });
}

// ------------------------------------------------------------------ running
function tick() {
  if (!S.on || !S.nodes) return;
  const n = S.nodes, t = n.ctx.currentTime;
  if (S.mode === 'track') {
    // the loop: a little before the track ends, its next pass is laid over the end. Nothing else is added to the track.
    if (S.playing && t > S.nextAt - 1.5) playOne(S.nextAt, false);
    return;
  }
  // everything below belongs to the fallback bed, for when there is no track
  S.wheel *= 0.9;                            // the rush dies away after the hand stops
  n.rush.gain.setTargetAtTime(Math.min(0.11, S.wheel * 0.0009), t, 0.08);
  n.rushBand.frequency.setTargetAtTime(700 + Math.min(1400, S.wheel * 6), t, 0.1);
  const stats = window.__MM && window.__MM.stats, burst = stats && stats.burst, jobs = burst ? burst.jobs || 0 : 0;
  const running = jobs > S.lastJobs; S.lastJobs = jobs;
  n.pulse.gain.setTargetAtTime(running ? 0.22 : 0, t, running ? 0.3 : 1.2);
  const auto = document.getElementById('btn-auto'), flying = !!auto && auto.getAttribute('aria-pressed') === 'true';
  const motion = Math.min(1, S.wheel / 600 + (flying ? 0.35 : 0));
  n.airGain.gain.setTargetAtTime(0.018 + 0.03 * motion, t, 0.6);
  n.tone.frequency.setTargetAtTime(220 + 260 * motion, t, 0.8);
  if (t > S.groanAt) { groan(n); S.groanAt = t + 14 + Math.random() * 18; }
  const card = document.getElementById('card'), open = !!card && !card.hidden;
  if (open && !S.cardOpen) chime(n);
  S.cardOpen = open;
}

function label() {
  const b = document.getElementById('btn-sound'), s = document.getElementById('btn-sound-t');
  if (b) b.setAttribute('aria-pressed', S.on ? 'true' : 'false');
  if (s) s.textContent = S.on ? 'Sound on' : 'Sound off';
}

function remember(on) { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch { /* private window: nothing to remember */ } }

async function start() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  if (!S.ctx) {
    S.ctx = new AC(); S.nodes = build(S.ctx);
    S.trackOut = S.ctx.createGain(); S.trackMaster = S.ctx.createGain(); S.trackMaster.gain.value = 0;
    S.trackOut.connect(S.trackMaster); S.trackMaster.connect(S.ctx.destination);
    S.gen = S.ctx.createGain(); S.gen.connect(S.trackOut);
  }
  S.on = true; label();
  try { await S.ctx.resume(); } catch { S.on = false; label(); return false; }
  if (!S.tried) {
    S.tried = true;
    S.track = await loadTrack(S.ctx);
    S.mode = S.track ? 'track' : 'synth';
  }
  if (!S.on) return true;                    // switched off again while the track was being read
  const n = S.nodes, t = S.ctx.currentTime;
  if (S.mode === 'track') {
    // The track alone: everything synthesised stays shut (its master is left at 0), and the track comes in at once.
    n.bus.gain.value = 0; n.bedGlass.gain.value = 0;
    n.master.gain.cancelScheduledValues(t); n.master.gain.setValueAtTime(0, t);
    S.trackOut.gain.value = S.trackGain;
    if (!S.playing) { S.playing = true; playOne(t + 0.05, true); }
    S.trackMaster.gain.cancelScheduledValues(t); S.trackMaster.gain.setTargetAtTime(1, t, 0.05);
  } else {
    n.master.gain.cancelScheduledValues(t); n.master.gain.setTargetAtTime(1, t, 1.2);   // the fallback bed comes up over a few seconds
  }
  S.groanAt = t + 6;
  if (!S.timer) S.timer = setInterval(tick, 100);
  return true;
}

function stop() {
  S.on = false; label();
  if (!S.ctx) return;
  const ctx = S.ctx, t = ctx.currentTime;
  for (const g of [S.nodes.master.gain, S.trackMaster.gain]) { g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.35); }
  // suspended, the track keeps its place: switching the sound back on carries on from there
  setTimeout(() => { if (!S.on) ctx.suspend().catch(() => {}); }, 1800);
}

function toggle() { S.armed = false; if (S.on) { stop(); remember(false); } else start().then((ok) => { if (ok) remember(true); }); }

// Everything that is heard, as a stream: src/record.js uses it to put the sound into a recording of the picture.
function tap() {
  if (!S.ctx || !S.nodes) return null;
  if (!S.tapNode) { S.tapNode = S.ctx.createMediaStreamDestination(); S.nodes.out.connect(S.tapNode); S.trackMaster.connect(S.tapNode); }
  return S.tapNode.stream;
}

function mount() {
  if (document.getElementById('btn-sound')) return;
  const legend = document.getElementById('btn-legend');
  const keys = document.querySelector('#dock .keys') || (legend && legend.parentNode);
  if (!keys) return;
  const b = document.createElement('button'), k = document.createElement('kbd'), s = document.createElement('span');
  b.className = 'key'; b.id = 'btn-sound'; b.type = 'button'; b.setAttribute('aria-pressed', 'false');
  k.textContent = 'M'; s.id = 'btn-sound-t'; s.textContent = 'Sound off';
  b.append(k, s); keys.append(b);
  b.addEventListener('click', toggle);
}

// A check without ears: the track's length and level, and a few seconds of the fallback bed rendered offline.
async function check(seconds = 6) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return { error: 'no offline audio context' };
  const report = { mode: S.mode, on: S.on, loops: S.loops };
  try {
    const buf = await new OAC(2, 44100, 44100).decodeAudioData(await bytes()), m = measure(buf);
    report.track = {
      seconds: +buf.duration.toFixed(1), channels: buf.numberOfChannels, rms: +m.rms.toFixed(3), peak: +m.peak.toFixed(3), gain: +m.gain.toFixed(2),
      levelAfterGain: +(m.rms * m.gain).toFixed(3), peakAfterGain: +(m.peak * m.gain).toFixed(3),
      crossfadeSeconds: Math.min(CROSS, buf.duration / 4), megabytesInMemory: +(buf.length * buf.numberOfChannels * 4 / 1e6).toFixed(0),
    };
  } catch (e) { report.track = { error: String(e && e.message || e) }; }
  const off = new OAC(2, Math.floor(44100 * seconds), 44100), n = build(off);
  n.master.gain.value = 1; groan(n); chime(n);
  const d = (await off.startRendering()).getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += a * a; }
  report.fallbackBed = { seconds, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(3) };
  if (S.ctx && S.track) {
    report.playing = {
      at: +S.ctx.currentTime.toFixed(1), nextPassAt: +S.nextAt.toFixed(1), contextState: S.ctx.state,
      trackGain: +S.trackOut.gain.value.toFixed(3), trackSwitch: +S.trackMaster.gain.value.toFixed(3),
      synthesisedLevel: +S.nodes.master.gain.value.toFixed(3),   // 0 while the track plays: nothing is laid over it
    };
  }
  return report;
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) && el.type !== 'range') return;
  if (e.key === 'm' || e.key === 'M') toggle();
});
addEventListener('wheel', (e) => { S.wheel += Math.abs(e.deltaY); }, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!S.ctx) return;
  if (document.hidden) S.ctx.suspend().catch(() => {}); else if (S.on) S.ctx.resume().catch(() => {});
});

// On unless the person switched it off: it starts with the first click or key press, which is the earliest a
// browser allows sound. An embedding page can keep it silent by default with <meta name="anatomy-sound" content="off">;
// the Sound button and the M key still work then.
const meta = document.querySelector('meta[name="anatomy-sound"]');
const held = !!(meta && meta.content === 'off');     // the embedding page keeps the sound off until the person asks for it

// Arm the sound: it starts with the person's next click or key press, the earliest a browser allows. Called below unless
// the person switched the sound off on an earlier visit, and by the intro (src/intro.js) whenever it is about to play:
// FOUNDER, 12 Nov 6:39 PM, "click to begin not there it needs to start the sound". The film always opens on its
// Click to begin and starts the sound, whatever was remembered. Only the embedding page's meta tag keeps it silent.
function arm() {
  if (held || S.on || S.ctx) return false;
  if (S.armed) return true;
  S.armed = true;
  bytes().catch(() => {});                   // fetch the track now, so the first click does not wait for it
  const wake = (e) => {
    removeEventListener('pointerdown', wake); removeEventListener('keydown', wake);
    if (S.armed && !S.on && !(e.type === 'keydown' && (e.key === 'm' || e.key === 'M'))) start();
  };
  addEventListener('pointerdown', wake); addEventListener('keydown', wake);
  return true;
}

// On unless the person switched it off. An embedding page can keep it silent by default with
// <meta name="anatomy-sound" content="off">; the Sound button and the M key still work then.
let was = '1';
try { was = localStorage.getItem(STORE) || '1'; } catch { /* nothing remembered */ }
if (was === '1') arm();

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
window.__MM_SOUND = { get on() { return S.on; }, get mode() { return S.mode; }, get armed() { return S.armed && !S.ctx; }, arm, start, stop, toggle, check, tap, clock, restart };
