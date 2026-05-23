// ui.js — DOM rendering, canvas drawing, and pointer-event handling.

// =============================================================
// Constants
// =============================================================
const PLAYER_COLORS = [
  '#e94560', '#3eb489', '#ffd479', '#80a8ff',
  '#ff80c0', '#c080ff', '#80e0d0', '#ffa860',
];

const PALETTE = [
  '#000000', '#6e6e6e', '#ffffff',
  '#e23636', '#ff8c2a', '#ffd429',
  '#3eb489', '#3a7cf0', '#7a3ce6',
  '#ff66b0', '#8b5a2b', '#4a2e16',
];

const SIZES = [
  { px: 2,  dot: 4  },
  { px: 5,  dot: 7  },
  { px: 12, dot: 12 },
  { px: 25, dot: 18 },
];

const FLUSH_INTERVAL_MS = 33; // ~30 Hz

// =============================================================
// DOM refs (resolved after DOMContentLoaded by app.js)
// =============================================================
let canvas, ctx;
let chatListEl, chatInputEl, btnSendChatEl;
let scoreboardEl, wordDisplayEl, timerEl;
let toolbarEl, btnPenEl, btnEraserEl, btnUndoEl, btnClearEl;
let colorPaletteEl, sizePickerEl;
let wordPickOverlayEl, wordPickOptionsEl, wordPickTimerEl;
let waitingOverlayEl, waitingTitleEl, waitingSubEl;
let roundEndOverlayEl, roundEndWordEl, roundEndDeltasEl;
let gameEndOverlayEl, gameEndTitleEl, finalScoreboardEl, btnPlayAgainEl;
let roundLabelEl, drawerLabelEl;

// =============================================================
// Drawing state
// =============================================================
let currentColor = '#000000';
let currentSize = 5;
let currentTool = 'pen'; // 'pen' | 'eraser'

let isDrawing = false;
let drawerStrokeIdCounter = 0;
let activeStrokeId = null;
let pointBuffer = [];
let sentAnyForStroke = false;
let flushTimerId = null;

let timerIntervalId = null;
let lastTimerSec = null;        // tracks transition into the urgent zone

// =============================================================
// Setup
// =============================================================
function initUI() {
  canvas = document.getElementById('draw-canvas');
  ctx = canvas.getContext('2d');

  chatListEl = document.getElementById('chat-list');
  chatInputEl = document.getElementById('chat-input');
  btnSendChatEl = document.getElementById('btn-send-chat');
  scoreboardEl = document.getElementById('scoreboard');
  wordDisplayEl = document.getElementById('word-display');
  timerEl = document.getElementById('timer-label');
  toolbarEl = document.getElementById('toolbar');
  btnPenEl = document.getElementById('btn-tool-pen');
  btnEraserEl = document.getElementById('btn-tool-eraser');
  btnUndoEl = document.getElementById('btn-undo-stroke');
  btnClearEl = document.getElementById('btn-clear-canvas');
  colorPaletteEl = document.getElementById('color-palette');
  sizePickerEl = document.getElementById('size-picker');
  wordPickOverlayEl = document.getElementById('word-pick-overlay');
  wordPickOptionsEl = document.getElementById('word-pick-options');
  wordPickTimerEl = document.getElementById('word-pick-timer');
  waitingOverlayEl = document.getElementById('waiting-overlay');
  waitingTitleEl = document.getElementById('waiting-title');
  waitingSubEl = document.getElementById('waiting-sub');
  roundEndOverlayEl = document.getElementById('round-end-overlay');
  roundEndWordEl = document.getElementById('round-end-word');
  roundEndDeltasEl = document.getElementById('round-end-deltas');
  gameEndOverlayEl = document.getElementById('game-end-overlay');
  gameEndTitleEl = document.getElementById('game-end-title');
  finalScoreboardEl = document.getElementById('final-scoreboard');
  btnPlayAgainEl = document.getElementById('btn-play-again');
  roundLabelEl = document.getElementById('round-label');
  drawerLabelEl = document.getElementById('drawer-label');

  buildColorPalette();
  buildSizePicker();
  wireToolbar();
  wireCanvas();
  renderCanvas();
}

function buildColorPalette() {
  colorPaletteEl.innerHTML = '';
  PALETTE.forEach(color => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = color;
    sw.dataset.color = color;
    if (color === currentColor) sw.classList.add('active');
    sw.addEventListener('click', () => {
      currentColor = color;
      currentTool = 'pen';
      refreshToolButtons();
    });
    colorPaletteEl.appendChild(sw);
  });
}

function buildSizePicker() {
  sizePickerEl.innerHTML = '';
  SIZES.forEach(({ px, dot }) => {
    const btn = document.createElement('button');
    btn.className = 'size-btn';
    if (px === currentSize) btn.classList.add('active');
    btn.dataset.size = String(px);
    const d = document.createElement('span');
    d.className = 'size-dot';
    d.style.width = `${dot}px`;
    d.style.height = `${dot}px`;
    btn.appendChild(d);
    btn.addEventListener('click', () => {
      currentSize = px;
      refreshToolButtons();
    });
    sizePickerEl.appendChild(btn);
  });
}

function wireToolbar() {
  btnPenEl.addEventListener('click', () => {
    currentTool = 'pen';
    refreshToolButtons();
  });
  btnEraserEl.addEventListener('click', () => {
    currentTool = 'eraser';
    refreshToolButtons();
  });
  btnUndoEl.addEventListener('click', () => {
    if (!isLocalDrawer() || gameState.phase !== 'drawing') return;
    if (strokes.length === 0) return;
    applyUndoStroke();
    renderCanvas();
    sendNetworkUndo();
  });
  btnClearEl.addEventListener('click', () => {
    if (!isLocalDrawer() || gameState.phase !== 'drawing') return;
    applyClearCanvas();
    renderCanvas();
    sendNetworkClear();
  });
}

function refreshToolButtons() {
  // Color swatches
  colorPaletteEl.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.color === currentColor && currentTool === 'pen');
  });
  // Size buttons
  sizePickerEl.querySelectorAll('.size-btn').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.size, 10) === currentSize);
  });
  // Pen / Eraser
  btnPenEl.classList.toggle('tool-active', currentTool === 'pen');
  btnEraserEl.classList.toggle('tool-active', currentTool === 'eraser');
}

// =============================================================
// Canvas pointer events (drawer-only)
// =============================================================
function wireCanvas() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
}

function canDraw() {
  return isLocalDrawer() && gameState.phase === 'drawing';
}

function pointerToCanvas(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function onPointerDown(e) {
  if (!canDraw()) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  isDrawing = true;
  activeStrokeId = `${myPlayerIdx}-${gameState.roundIdx}-${++drawerStrokeIdCounter}`;
  sentAnyForStroke = false;
  pointBuffer = [];

  const p = pointerToCanvas(e);
  pointBuffer.push(p);

  // Locally append the new stroke so the renderer shows it immediately.
  const colorToUse = currentTool === 'eraser' ? '#ffffff' : currentColor;
  strokes.push({ id: activeStrokeId, color: colorToUse, size: currentSize, points: [p] });
  renderCanvas();

  if (!flushTimerId) {
    flushTimerId = setInterval(flushPointBuffer, FLUSH_INTERVAL_MS);
  }
}

function onPointerMove(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const p = pointerToCanvas(e);
  pointBuffer.push(p);
  // Append locally for immediate feedback (renderCanvas reads from strokes[])
  const stroke = strokes.find(s => s.id === activeStrokeId);
  if (stroke) {
    stroke.points.push(p);
    renderCanvas();
  }
}

function onPointerUp(e) {
  if (!isDrawing) return;
  e.preventDefault();
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  isDrawing = false;
  // Final flush, marking the stroke as complete.
  flushPointBuffer(true);
  if (flushTimerId) {
    clearInterval(flushTimerId);
    flushTimerId = null;
  }
  activeStrokeId = null;
}

function flushPointBuffer(isLast = false) {
  if (!activeStrokeId) return;
  if (pointBuffer.length === 0 && !isLast) return;
  const colorToUse = currentTool === 'eraser' ? '#ffffff' : currentColor;
  const seg = {
    strokeId: activeStrokeId,
    color: colorToUse,
    size: currentSize,
    points: pointBuffer.slice(),
    isFirst: !sentAnyForStroke,
    isLast,
  };
  pointBuffer = [];
  sentAnyForStroke = true;
  sendNetworkStrokeSegment(seg);
}

// =============================================================
// Canvas rendering
// =============================================================
function renderCanvas() {
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    if (stroke.points.length === 1) {
      // Single-point stroke = a dot.
      const p = stroke.points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, stroke.size / 2), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }
}

// =============================================================
// Scoreboard
// =============================================================
function renderScoreboard() {
  if (!scoreboardEl) return;
  scoreboardEl.innerHTML = '';
  gameState.players.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.idx === gameState.drawerIdx && gameState.phase === 'drawing') li.classList.add('is-drawer');
    if (p.idx === myPlayerIdx) li.classList.add('is-you');

    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = PLAYER_COLORS[p.idx % PLAYER_COLORS.length];

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = p.name + (p.idx === myPlayerIdx ? ' (you)' : '');

    const score = document.createElement('span');
    score.className = 'player-score';
    score.textContent = String(p.score);

    li.appendChild(dot);
    li.appendChild(name);
    if (p.hasSolvedThisRound && gameState.phase === 'drawing') {
      const status = document.createElement('span');
      status.className = 'player-status';
      status.textContent = '✓';
      li.appendChild(status);
    }
    li.appendChild(score);
    scoreboardEl.appendChild(li);
  });
}

// =============================================================
// Word display + timer + drawer label
// =============================================================
function renderHeader() {
  if (!roundLabelEl) return;
  if (gameState.totalRounds > 0) {
    roundLabelEl.textContent = `Round ${gameState.roundIdx + 1}/${gameState.totalRounds}`;
  } else {
    roundLabelEl.textContent = '';
  }
  if (gameState.players.length > 0 && gameState.phase !== 'idle') {
    const drawer = gameState.players[gameState.drawerIdx];
    const youAreDrawer = gameState.drawerIdx === myPlayerIdx;
    drawerLabelEl.textContent = `— Drawer: ${youAreDrawer ? 'you' : drawer.name}`;
  } else {
    drawerLabelEl.textContent = '';
  }
  renderWordDisplay();
}

function renderWordDisplay() {
  if (!wordDisplayEl) return;
  if (gameState.phase === 'drawing') {
    wordDisplayEl.classList.remove('revealed');
    if (gameState.myWord) {
      // Drawer sees the actual word.
      wordDisplayEl.textContent = gameState.myWord.toUpperCase();
    } else {
      wordDisplayEl.textContent = gameState.wordPattern || '';
    }
  } else if (gameState.phase === 'round_end') {
    wordDisplayEl.classList.add('revealed');
    wordDisplayEl.textContent = (gameState.revealedWord || '').toUpperCase();
  } else {
    wordDisplayEl.classList.remove('revealed');
    wordDisplayEl.textContent = '';
  }
}

function updateTimerDisplay() {
  if (!timerEl) return;
  let target = 0;
  if (gameState.phase === 'drawing') target = gameState.drawingEndsAt;
  else if (gameState.phase === 'word_pick') target = gameState.pickEndsAt;
  else {
    timerEl.textContent = '';
    timerEl.classList.remove('urgent');
    lastTimerSec = null;
    return;
  }
  const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
  timerEl.textContent = String(remaining);
  timerEl.classList.toggle('urgent', remaining <= 10 && gameState.phase === 'drawing');

  // Single warning tick when we transition into the urgent zone.
  if (gameState.phase === 'drawing'
      && lastTimerSec !== null && lastTimerSec > 10 && remaining <= 10) {
    playTimeWarning();
  }
  lastTimerSec = remaining;

  if (wordPickTimerEl && gameState.phase === 'word_pick') {
    wordPickTimerEl.textContent = String(remaining);
  }
}

function startTimerLoop() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  updateTimerDisplay();
  timerIntervalId = setInterval(updateTimerDisplay, 200);
}

function stopTimerLoop() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = null;
}

// =============================================================
// Chat
// =============================================================
function appendChatMessage({ kind, senderIdx, text }) {
  if (!chatListEl) return;
  const li = document.createElement('li');
  li.classList.add(`kind-${kind}`);
  if (kind === 'guess' || kind === 'guess-own') {
    const sender = document.createElement('span');
    sender.className = 'sender';
    const player = gameState.players[senderIdx];
    sender.style.color = PLAYER_COLORS[senderIdx % PLAYER_COLORS.length];
    sender.textContent = (player ? player.name : `Player ${senderIdx + 1}`) + ':';
    li.appendChild(sender);
    const body = document.createElement('span');
    body.textContent = ' ' + text;
    li.appendChild(body);
  } else {
    // system / correct / join: plain text
    li.textContent = text;
  }
  chatListEl.appendChild(li);
  chatListEl.scrollTop = chatListEl.scrollHeight;
}

function clearChat() {
  if (chatListEl) chatListEl.innerHTML = '';
}

// Decide whether the local chat input is usable right now.
// - During drawing: drawer cannot chat (would leak the word).
// - During drawing: active guessers can type guesses.
// - During drawing: solved players can chat (their text relays to drawer + other solvers).
// - Outside drawing: anyone can chat.
function refreshChatInput() {
  if (!chatInputEl) return;
  let enabled = true;
  let placeholder = 'Type a guess…';
  if (gameState.phase === 'drawing') {
    if (myPlayerIdx === gameState.drawerIdx) {
      enabled = false;
      placeholder = 'You\'re drawing — chat disabled.';
    } else {
      const me = gameState.players[myPlayerIdx];
      if (me && me.hasSolvedThisRound) {
        placeholder = 'You solved it! Chat away.';
      }
    }
  } else if (gameState.phase === 'word_pick') {
    enabled = false;
    placeholder = 'Waiting for word pick…';
  } else if (gameState.phase === 'round_end') {
    placeholder = 'Round over.';
  } else if (gameState.phase === 'game_over') {
    placeholder = 'Game over.';
  }
  chatInputEl.disabled = !enabled;
  btnSendChatEl.disabled = !enabled;
  chatInputEl.placeholder = placeholder;
}

// =============================================================
// Overlays
// =============================================================
function showWordPickForDrawer(options) {
  if (!wordPickOverlayEl) return;
  wordPickOptionsEl.innerHTML = '';
  options.forEach((word, i) => {
    const btn = document.createElement('button');
    btn.textContent = word;
    btn.addEventListener('click', () => {
      sendWordChoice(i);
      hideOverlays();
    });
    wordPickOptionsEl.appendChild(btn);
  });
  wordPickOverlayEl.style.display = 'flex';
  waitingOverlayEl.style.display = 'none';
  roundEndOverlayEl.style.display = 'none';
  gameEndOverlayEl.style.display = 'none';
}

function showWaitingForWordPick(drawerName) {
  if (!waitingOverlayEl) return;
  waitingTitleEl.textContent = `${drawerName} is picking a word…`;
  waitingSubEl.textContent = 'Sit tight.';
  waitingOverlayEl.style.display = 'flex';
  wordPickOverlayEl.style.display = 'none';
  roundEndOverlayEl.style.display = 'none';
  gameEndOverlayEl.style.display = 'none';
}

function showRoundEnd(word, deltas) {
  if (!roundEndOverlayEl) return;
  roundEndWordEl.textContent = word;
  roundEndDeltasEl.innerHTML = '';
  deltas.forEach(d => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = d.name;
    nameSpan.style.color = PLAYER_COLORS[d.idx % PLAYER_COLORS.length];
    const deltaSpan = document.createElement('span');
    deltaSpan.className = 'delta ' + (d.delta > 0 ? 'positive' : 'zero');
    deltaSpan.textContent = d.delta > 0 ? `+${d.delta}` : '0';
    li.appendChild(nameSpan);
    li.appendChild(deltaSpan);
    roundEndDeltasEl.appendChild(li);
  });
  roundEndOverlayEl.style.display = 'flex';
  wordPickOverlayEl.style.display = 'none';
  waitingOverlayEl.style.display = 'none';
  gameEndOverlayEl.style.display = 'none';
}

function showGameEnd(standings) {
  if (!gameEndOverlayEl) return;
  finalScoreboardEl.innerHTML = '';
  standings.forEach((s, i) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = s.name + (s.idx === myPlayerIdx ? ' (you)' : '');
    nameSpan.style.color = PLAYER_COLORS[s.idx % PLAYER_COLORS.length];
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'player-score';
    scoreSpan.textContent = String(s.score);
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    finalScoreboardEl.appendChild(li);
  });
  gameEndTitleEl.textContent = standings.length > 0
    ? `Winner: ${standings[0].name}!`
    : 'Game over';
  // Only the host can start a new game.
  btnPlayAgainEl.style.display = (gameMode === 'host') ? '' : 'none';
  gameEndOverlayEl.style.display = 'flex';
  wordPickOverlayEl.style.display = 'none';
  waitingOverlayEl.style.display = 'none';
  roundEndOverlayEl.style.display = 'none';
}

function hideOverlays() {
  wordPickOverlayEl.style.display = 'none';
  waitingOverlayEl.style.display = 'none';
  roundEndOverlayEl.style.display = 'none';
  gameEndOverlayEl.style.display = 'none';
}

// =============================================================
// Phase entry hooks — called from network.js when state changes.
// =============================================================
function isLocalDrawer() {
  return myPlayerIdx === gameState.drawerIdx;
}

function refreshAll() {
  renderHeader();
  renderScoreboard();
  renderCanvas();
  refreshChatInput();
  refreshToolbarEnabled();
}

function refreshToolbarEnabled() {
  if (!toolbarEl) return;
  const enabled = canDraw();
  toolbarEl.classList.toggle('disabled', !enabled);
  canvas.classList.toggle('no-draw', !enabled);
}

// Called by app.js when entering the game screen the first time / after play-again.
function enterGameScreen() {
  clearChat();
  hideOverlays();
  drawerStrokeIdCounter = 0;
  refreshAll();
  startTimerLoop();
}

function leaveGameScreen() {
  stopTimerLoop();
  hideOverlays();
}
