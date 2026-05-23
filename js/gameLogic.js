// gameLogic.js — host-authoritative game engine.
//
// Two layers:
//   1. Shared state every peer keeps in sync: players[], current round info,
//      stroke history. Updated by message handlers in network.js.
//   2. Host-only state: word pool, used words, timer handles, current round's
//      choices and solvers. Drives the round state machine.

// =============================================================
// Shared state (all peers)
// =============================================================
const ROUND_DURATION_SEC = 60;
const WORD_PICK_SEC = 15;
const ROUND_REVEAL_SEC = 5;

let gameState = {
  phase: 'idle',          // 'idle' | 'word_pick' | 'drawing' | 'round_end' | 'game_over'
  roundIdx: 0,            // 0-based; incremented on each round_start
  totalRounds: 0,         // numPlayers * rotations
  drawerIdx: 0,           // playerIdx of the current drawer
  wordLength: 0,          // for blanks display (guessers)
  wordPattern: '',        // e.g. "_ _ _ _ _ _" with spaces preserved literally
  myWord: null,           // the drawer fills this in for themselves; null for guessers
  revealedWord: null,     // populated when phase transitions to round_end
  drawingEndsAt: 0,       // Date.now() ms; drives the timer display
  pickEndsAt: 0,          // for word-pick phase
  players: [],            // [{ idx, name, score, hasSolvedThisRound }]
};

// Stroke history is canonical; the canvas is re-rendered from it on every change.
let strokes = [];               // [{ id, color, size, points: [{x,y},...] }]
let strokeIdCounter = 0;

// =============================================================
// Host-only state
// =============================================================
let hostWordPool = [];          // built from difficulty + customWords
let hostUsedWords = new Set();
let hostRotations = 2;          // 1 | 2 | 3
let hostCurrentChoices = null;  // [w1, w2, w3] for the current word_pick
let hostChosenWord = null;      // string once the drawer picked
let hostSolvers = [];           // [{ idx, secondsRemaining }] in order
let hostRoundTimerId = null;    // setTimeout for round end
let hostPickTimerId = null;     // setTimeout for word-pick auto-pick
let hostTickIntervalId = null;  // setInterval for local timer display refresh
let hostCurrentDeltas = null;   // { idx: delta } accumulated this round
let hostRevealTimers = [];      // setTimeout handles for letter reveals
let hostRevealedIndices = null; // Set of revealed letter positions this round

// =============================================================
// Word normalization & matching
// =============================================================
function normalizeWord(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

function wordsMatch(guess, secret) {
  return normalizeWord(guess) === normalizeWord(secret);
}

function makeWordPattern(word, revealedIndices) {
  // Render letters as "_" but keep spaces visible. revealedIndices is a Set
  // of character positions whose letter should be shown (uppercased).
  const revealed = revealedIndices instanceof Set
    ? revealedIndices
    : new Set(revealedIndices || []);
  return word.split('').map((c, i) => {
    if (c === ' ') return '  ';
    if (revealed.has(i)) return c.toUpperCase();
    return '_';
  }).join(' ');
}

// =============================================================
// Player helpers
// =============================================================
function makePlayers(numPlayers, names) {
  const arr = [];
  for (let i = 0; i < numPlayers; i++) {
    const name = (names && names[i]) ? names[i] : `Player ${i + 1}`;
    arr.push({ idx: i, name, score: 0, hasSolvedThisRound: false });
  }
  return arr;
}

function resetSolverFlags() {
  for (const p of gameState.players) p.hasSolvedThisRound = false;
}

// =============================================================
// Canvas history
// =============================================================
function resetCanvas() {
  strokes = [];
}

function applyStrokeSegment(seg) {
  // seg: { strokeId, color, size, points: [{x,y},...], isFirst, isLast }
  let stroke = strokes.find(s => s.id === seg.strokeId);
  if (!stroke) {
    stroke = { id: seg.strokeId, color: seg.color, size: seg.size, points: [] };
    strokes.push(stroke);
  }
  for (const p of seg.points) stroke.points.push(p);
}

function applyUndoStroke() {
  strokes.pop();
}

function applyClearCanvas() {
  strokes = [];
}

// =============================================================
// Host: game setup
// =============================================================
function hostSetupGame({ numPlayers, difficulty, rotations, customWords, names }) {
  gameState.players = makePlayers(numPlayers, names);
  gameState.totalRounds = numPlayers * rotations;
  gameState.roundIdx = -1;       // advanceRound bumps to 0
  gameState.phase = 'idle';
  hostRotations = rotations;
  hostWordPool = buildWordPool(difficulty, customWords);
  hostUsedWords = new Set();
  resetCanvas();
}

// Mirror of the above on the guest side. Players are reconstructed by the
// host's broadcast on round_start (we just need an empty array of the right
// shape until then).
function guestSetupGame({ numPlayers, totalRounds, names, myIdx }) {
  gameState.players = makePlayers(numPlayers, names);
  gameState.totalRounds = totalRounds;
  gameState.roundIdx = -1;
  gameState.phase = 'idle';
  resetCanvas();
}

// =============================================================
// Host: round state machine
// =============================================================
function hostStartNextRound(broadcast, sendToPeer) {
  hostClearAllTimers();
  gameState.roundIdx += 1;
  if (gameState.roundIdx >= gameState.totalRounds) {
    hostEndGame(broadcast);
    return;
  }
  // Drawer rotation: simply roundIdx mod numPlayers.
  const drawerIdx = gameState.roundIdx % gameState.players.length;
  gameState.drawerIdx = drawerIdx;
  gameState.phase = 'word_pick';
  gameState.myWord = null;
  gameState.revealedWord = null;
  gameState.wordLength = 0;
  gameState.wordPattern = '';
  resetSolverFlags();
  resetCanvas();
  hostCurrentChoices = pickThreeWords(hostWordPool, hostUsedWords);
  hostChosenWord = null;
  hostSolvers = [];
  hostCurrentDeltas = {};
  for (const p of gameState.players) hostCurrentDeltas[p.idx] = 0;

  const pickDeadline = Date.now() + WORD_PICK_SEC * 1000;
  gameState.pickEndsAt = pickDeadline;

  // Tell EVERYONE the picking phase has started (so non-drawers can show a
  // waiting overlay with a countdown).
  broadcast({
    type: 'pick_phase_start',
    drawerIdx,
    roundIdx: gameState.roundIdx,
    totalRounds: gameState.totalRounds,
    pickEndsAt: pickDeadline,
  });

  // Tell only the drawer their three options.
  sendToPeer(drawerIdx, {
    type: 'your_word_pick',
    options: hostCurrentChoices,
    pickEndsAt: pickDeadline,
  });

  // Auto-pick on timeout.
  hostPickTimerId = setTimeout(() => {
    if (hostChosenWord === null) hostFinalizeWordChoice(0, broadcast);
  }, WORD_PICK_SEC * 1000);
}

function hostFinalizeWordChoice(choiceIdx, broadcast) {
  if (!hostCurrentChoices) return;
  if (hostChosenWord !== null) return;
  clearTimeout(hostPickTimerId);
  hostPickTimerId = null;
  const word = hostCurrentChoices[Math.max(0, Math.min(2, choiceIdx))];
  hostChosenWord = word;
  hostUsedWords.add(word);

  gameState.phase = 'drawing';
  gameState.wordLength = word.length;
  gameState.wordPattern = makeWordPattern(word);
  const endsAt = Date.now() + ROUND_DURATION_SEC * 1000;
  gameState.drawingEndsAt = endsAt;

  // Drawer learns the actual word locally.
  if (gameState.drawerIdx === 0) {
    gameState.myWord = word;
  }

  // Everyone (including drawer) gets the round_start broadcast.
  broadcast({
    type: 'round_start',
    drawerIdx: gameState.drawerIdx,
    roundIdx: gameState.roundIdx,
    totalRounds: gameState.totalRounds,
    wordLength: word.length,
    wordPattern: gameState.wordPattern,
    endsAt,
    secretWordForDrawer: word, // network.js strips this when sending to non-drawer peers
  });

  hostRoundTimerId = setTimeout(() => hostEndRound('timeout', broadcast), ROUND_DURATION_SEC * 1000);
  scheduleLetterReveals(word, broadcast);
}

// Reveal one or two random letters as the timer runs down. Pure host-side
// scheduling; receivers learn about reveals via pattern_update messages.
function scheduleLetterReveals(word, broadcast) {
  const nonSpaceIdx = [];
  for (let i = 0; i < word.length; i++) if (word[i] !== ' ') nonSpaceIdx.push(i);

  // Skip reveals for very short words (≤3 chars would be ~trivial).
  let numReveals;
  if (nonSpaceIdx.length <= 3) numReveals = 0;
  else if (nonSpaceIdx.length <= 5) numReveals = 1;
  else numReveals = 2;
  if (numReveals === 0) return;

  // Fisher-Yates shuffle, take the first numReveals positions.
  for (let i = nonSpaceIdx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nonSpaceIdx[i], nonSpaceIdx[j]] = [nonSpaceIdx[j], nonSpaceIdx[i]];
  }
  const reveals = nonSpaceIdx.slice(0, numReveals);
  hostRevealedIndices = new Set();

  const timings = numReveals === 1 ? [30] : [30, 15]; // seconds remaining
  reveals.forEach((idx, i) => {
    const remaining = timings[i];
    const delayMs = (ROUND_DURATION_SEC - remaining) * 1000;
    const handle = setTimeout(() => {
      if (gameState.phase !== 'drawing') return;
      hostRevealedIndices.add(idx);
      const pattern = makeWordPattern(word, hostRevealedIndices);
      broadcast({ type: 'pattern_update', wordPattern: pattern });
    }, delayMs);
    hostRevealTimers.push(handle);
  });
}

// Returns 'correct' | 'wrong' (host-side only)
function hostJudgeGuess(guesserIdx, text, broadcast) {
  if (gameState.phase !== 'drawing') return 'wrong';
  if (guesserIdx === gameState.drawerIdx) return 'wrong';
  const player = gameState.players[guesserIdx];
  if (!player || player.hasSolvedThisRound) return 'wrong';
  if (!wordsMatch(text, hostChosenWord)) return 'wrong';

  // Correct! Score this guesser.
  const secondsRemaining = Math.max(0, Math.ceil((gameState.drawingEndsAt - Date.now()) / 1000));
  const guesserPoints = Math.max(50, secondsRemaining * 2);
  player.hasSolvedThisRound = true;
  player.score += guesserPoints;
  hostCurrentDeltas[guesserIdx] = (hostCurrentDeltas[guesserIdx] || 0) + guesserPoints;
  hostSolvers.push({ idx: guesserIdx, secondsRemaining });

  // Drawer also gets points per solver.
  const drawerPoints = 25;
  gameState.players[gameState.drawerIdx].score += drawerPoints;
  hostCurrentDeltas[gameState.drawerIdx] = (hostCurrentDeltas[gameState.drawerIdx] || 0) + drawerPoints;

  broadcast({
    type: 'correct_guess',
    guesserIdx,
    drawerIdx: gameState.drawerIdx,
    guesserScore: player.score,
    drawerScore: gameState.players[gameState.drawerIdx].score,
    guesserDelta: guesserPoints,
    drawerDelta: drawerPoints,
  });

  // If everyone except the drawer has solved, end the round early.
  const nonDrawers = gameState.players.filter(p => p.idx !== gameState.drawerIdx);
  if (nonDrawers.every(p => p.hasSolvedThisRound)) {
    hostEndRound('all_solved', broadcast);
  }
  return 'correct';
}

function hostEndRound(reason, broadcast) {
  if (gameState.phase !== 'drawing') return;
  clearTimeout(hostRoundTimerId);
  hostRoundTimerId = null;

  const revealed = hostChosenWord;
  gameState.phase = 'round_end';
  gameState.revealedWord = revealed;

  // Aggregate score deltas into a clean payload.
  const deltas = gameState.players.map(p => ({
    idx: p.idx,
    name: p.name,
    delta: hostCurrentDeltas[p.idx] || 0,
    total: p.score,
  }));

  broadcast({
    type: 'round_end',
    word: revealed,
    reason,
    deltas,
  });

  // Auto-advance after the reveal window.
  hostRoundTimerId = setTimeout(() => hostStartNextRound(broadcast, hostBoundSendToPeer), ROUND_REVEAL_SEC * 1000);
}

function hostEndGame(broadcast) {
  gameState.phase = 'game_over';
  const standings = [...gameState.players]
    .map(p => ({ idx: p.idx, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  broadcast({
    type: 'game_over',
    standings,
  });
}

function hostClearAllTimers() {
  if (hostRoundTimerId) clearTimeout(hostRoundTimerId);
  if (hostPickTimerId) clearTimeout(hostPickTimerId);
  if (hostTickIntervalId) clearInterval(hostTickIntervalId);
  for (const t of hostRevealTimers) clearTimeout(t);
  hostRoundTimerId = null;
  hostPickTimerId = null;
  hostTickIntervalId = null;
  hostRevealTimers = [];
}

// network.js sets this to a bound sendToPeer(idx, msg) function on the host.
// We need a forward reference because hostStartNextRound's setTimeout body
// fires later and we need a stable callable.
let hostBoundSendToPeer = () => {};
function setHostBoundSendToPeer(fn) { hostBoundSendToPeer = fn; }
