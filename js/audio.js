// audio.js — synthesized sound effects via Web Audio API.
// No sample files; everything is generated from oscillators on demand.

let audioCtx = null;
let soundEnabled = true;

(function loadSoundPref() {
  try {
    const saved = localStorage.getItem('pictionary_sound');
    if (saved === '0') soundEnabled = false;
  } catch {}
})();

function ensureAudioCtx() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

// Browsers freeze the AudioContext until a user gesture. Call this from a
// click handler to nudge it back to 'running'.
function unlockAudio() {
  const ctx = ensureAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function setSoundEnabled(on) {
  soundEnabled = !!on;
  try { localStorage.setItem('pictionary_sound', soundEnabled ? '1' : '0'); } catch {}
  if (soundEnabled) unlockAudio();
}

function isSoundEnabled() {
  return soundEnabled;
}

// Schedule a single oscillator note with a quick attack and exponential decay.
function tone(ctx, freq, startTime, duration, gain = 0.25, type = 'sine') {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(gain, startTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

function playSequence(notes, type = 'sine') {
  if (!soundEnabled) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  let t = ctx.currentTime;
  for (const n of notes) {
    tone(ctx, n.freq, t, n.dur, n.gain ?? 0.25, type);
    t += n.dur * 0.9; // slight overlap
  }
}

// =============================================================
// Sound effects
// =============================================================

// Ascending C–E–G triad: positive resolution.
function playCorrectChime() {
  playSequence([
    { freq: 523.25, dur: 0.10 }, // C5
    { freq: 659.25, dur: 0.10 }, // E5
    { freq: 783.99, dur: 0.18 }, // G5
  ], 'triangle');
}

// Slightly more triumphant 4-note finish for game-end.
function playFanfare() {
  playSequence([
    { freq: 523.25, dur: 0.16 }, // C5
    { freq: 659.25, dur: 0.16 }, // E5
    { freq: 783.99, dur: 0.16 }, // G5
    { freq: 1046.5, dur: 0.30 }, // C6
  ], 'triangle');
}

// A soft "new round starting" cue.
function playRoundStartDing() {
  playSequence([
    { freq: 880, dur: 0.18, gain: 0.18 }, // A5
  ], 'sine');
}

// A short alert tick when the timer enters the urgent zone.
function playTimeWarning() {
  playSequence([
    { freq: 440, dur: 0.07, gain: 0.18 }, // A4
  ], 'square');
}
