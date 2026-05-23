// network.js — PeerJS host-authoritative wiring.
//
// Lifted from chinese_checkers_personal/js/network.js and extended with
// Pictionary-specific messages.
//
// Host owns gameState and hostBank state; guests apply broadcasts.

let gameMode = 'idle';            // 'idle' | 'host' | 'guest'
let myPlayerIdx = -1;             // 0 = host, 1..n = guests
let myName = 'Anonymous Doodler';

// Host-side
let peer = null;
const connections = new Map();    // peerId -> DataConnection
const acceptedOrder = [];         // peerIds in accept order (idx i → playerIdx i+1)
const pendingKnocks = [];         // peerIds waiting for host approval
const guestNames = new Map();     // peerId -> chosen display name
let hostSettings = null;          // { difficulty, rotations, customWords }

// Guest-side
let hostConn = null;

function setMyName(name) {
  const trimmed = String(name || '').trim().slice(0, 20);
  myName = trimmed || 'Anonymous Doodler';
  try { localStorage.setItem('pictionary_name', myName); } catch {}
}

function sanitizeName(name) {
  const trimmed = String(name || '').trim().slice(0, 20);
  return trimmed || 'Anonymous Doodler';
}

function randomRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

// =============================================================
// Host setup
// =============================================================
function startHosting() {
  const roomId = randomRoomId();
  peer = new Peer(roomId);

  peer.on('open', (id) => {
    const inviteUrl = `${location.origin}${location.pathname}?invite=${id}`;
    document.getElementById('invite-link').value = inviteUrl;
    document.getElementById('lobby-status').textContent =
      'Lobby ready. Share the invite link with friends.';
  });

  peer.on('connection', (conn) => setupGuestConnection(conn));

  peer.on('error', (err) => {
    console.error('Host PeerJS error:', err);
    document.getElementById('lobby-status').textContent =
      'Networking error: ' + err.type;
  });

  gameMode = 'host';
  myPlayerIdx = 0;
  setHostBoundSendToPeer(hostSendToPeerIdx);
}

function setupGuestConnection(conn) {
  const peerId = conn.peer;
  connections.set(peerId, conn);

  conn.on('open', () => {
    pendingKnocks.push(peerId);
    refreshLobbyUI();
  });

  conn.on('data', (data) => onGuestData(peerId, data));

  conn.on('close', () => handleGuestDisconnect(peerId));
}

function handleGuestDisconnect(peerId) {
  connections.delete(peerId);
  guestNames.delete(peerId);
  const ai = acceptedOrder.indexOf(peerId);
  if (ai !== -1) acceptedOrder.splice(ai, 1);
  const pi = pendingKnocks.indexOf(peerId);
  if (pi !== -1) pendingKnocks.splice(pi, 1);

  if (currentScreen === 'game') {
    broadcastRaw({ type: 'player_disconnected' });
    alert('A player disconnected. Game ended.');
    showScreen('landing');
    teardownNetwork();
  } else {
    refreshLobbyUI();
  }
}

function acceptKnock() {
  const peerId = pendingKnocks.shift();
  if (!peerId) return;
  acceptedOrder.push(peerId);
  connections.get(peerId)?.send({ type: 'accepted' });
  refreshLobbyUI();
}

function denyKnock() {
  const peerId = pendingKnocks.shift();
  if (!peerId) return;
  const conn = connections.get(peerId);
  conn?.send({ type: 'denied' });
  setTimeout(() => {
    conn?.close();
    connections.delete(peerId);
  }, 200);
  refreshLobbyUI();
}

// =============================================================
// Host: start the network game
// =============================================================
function startNetworkGame() {
  const total = 1 + acceptedOrder.length;
  if (total < 2) {
    alert('Need at least 2 players.');
    return;
  }
  if (total > 8) {
    alert('Maximum 8 players supported.');
    return;
  }
  const difficulty = document.getElementById('difficulty').value;
  const rotations = parseInt(document.getElementById('rotations').value, 10);
  const customWords = document.getElementById('custom-words').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  hostSettings = { difficulty, rotations, customWords };

  // Build the player-name roster: host first, then accepted guests in order.
  const names = [myName];
  acceptedOrder.forEach(peerId => {
    names.push(guestNames.get(peerId) || `Player ${names.length + 1}`);
  });

  hostSetupGame({
    numPlayers: total,
    difficulty,
    rotations,
    customWords,
    names,
  });

  // Tell each guest who they are (and everyone's names).
  acceptedOrder.forEach((peerId, i) => {
    connections.get(peerId)?.send({
      type: 'game_init',
      numPlayers: total,
      totalRounds: gameState.totalRounds,
      yourPlayerIdx: i + 1,
      names,
    });
  });

  showScreen('game');
  enterGameScreen();
  hostStartNextRound(broadcastWithVariants, hostSendToPeerIdx);
}

// =============================================================
// Guest: join
// =============================================================
function joinAsGuest(hostId) {
  peer = new Peer();

  peer.on('open', () => {
    hostConn = peer.connect(hostId);
    hostConn.on('open', () => {
      hostConn.send({ type: 'set_name', name: myName });
      document.getElementById('guest-status').textContent =
        "Knocking on the host's door…";
    });
    hostConn.on('data', onHostData);
    hostConn.on('close', () => {
      if (currentScreen === 'game') {
        alert('Host disconnected. Game ended.');
        showScreen('landing');
        teardownNetwork();
      } else {
        document.getElementById('guest-status').textContent = 'Disconnected from host.';
      }
    });
  });

  peer.on('error', (err) => {
    console.error('Guest PeerJS error:', err);
    document.getElementById('guest-status').textContent =
      `Could not connect (${err.type}). The invite may be invalid or the host has left.`;
  });

  gameMode = 'guest';
}

// =============================================================
// Host: inbound messages from guests
// =============================================================
function onGuestData(peerId, data) {
  // set_name is the only message accepted before the host accepts the knock.
  if (data.type === 'set_name') {
    guestNames.set(peerId, sanitizeName(data.name));
    refreshLobbyUI();
    return;
  }

  const playerIdx = acceptedOrder.indexOf(peerId) + 1; // 0 if not accepted
  if (playerIdx <= 0) return;

  switch (data.type) {
    case 'word_chosen':
      if (gameState.phase !== 'word_pick') return;
      if (gameState.drawerIdx !== playerIdx) return;
      hostFinalizeWordChoice(data.choiceIdx, broadcastWithVariants);
      break;

    case 'stroke_segment':
    case 'undo_stroke':
    case 'clear_canvas':
      if (gameState.phase !== 'drawing') return;
      if (gameState.drawerIdx !== playerIdx) return;
      // Apply locally (host) and relay to other guests (excluding sender).
      applyMessageLocally(data);
      relayToOthers(peerId, data);
      break;

    case 'request_guess':
      if (gameState.phase !== 'drawing') return;
      hostHandleGuess(playerIdx, String(data.text || ''));
      break;

    case 'request_chat':
      // Free-form chat from a solver (or anyone outside drawing). The host
      // applies privacy rules in hostHandleChat().
      hostHandleChat(playerIdx, String(data.text || ''));
      break;
  }
}

// =============================================================
// Host: outbound helpers
// =============================================================
function broadcastRaw(msg) {
  // Send to all accepted guests; do NOT apply locally.
  for (const peerId of acceptedOrder) {
    connections.get(peerId)?.send(msg);
  }
}

// Apply a message locally on the host (mirrors what a guest would do on receive),
// then send the same to every guest.
function broadcastApplyAndSend(msg) {
  applyMessageLocally(msg);
  broadcastRaw(msg);
}

// For messages where some recipients get a different version (e.g. round_start
// carries the secret word only to the drawer).
function broadcastWithVariants(msg) {
  if (msg.type === 'round_start') {
    const publicMsg = { ...msg };
    delete publicMsg.secretWordForDrawer;
    // Local host:
    applyMessageLocally(myPlayerIdx === msg.drawerIdx ? msg : publicMsg);
    // Each guest:
    acceptedOrder.forEach((peerId, i) => {
      const guestIdx = i + 1;
      const send = (guestIdx === msg.drawerIdx) ? msg : publicMsg;
      connections.get(peerId)?.send(send);
    });
    return;
  }
  if (msg.type === 'your_word_pick') {
    // Only the drawer gets this. drawerIdx is in gameState.
    hostSendToPeerIdx(gameState.drawerIdx, msg);
    return;
  }
  broadcastApplyAndSend(msg);
}

// Send a message to a specific player by idx. idx=0 means apply on host locally.
function hostSendToPeerIdx(idx, msg) {
  if (idx === 0) {
    applyMessageLocally(msg);
    return;
  }
  const peerId = acceptedOrder[idx - 1];
  if (!peerId) return;
  connections.get(peerId)?.send(msg);
}

function relayToOthers(excludePeerId, msg) {
  for (const peerId of acceptedOrder) {
    if (peerId === excludePeerId) continue;
    connections.get(peerId)?.send(msg);
  }
}

// =============================================================
// Host: chat / guess handling
// =============================================================
function hostHandleGuess(guesserIdx, text) {
  if (!text) return;
  // Drawer can't guess their own word (we disable input but defend anyway).
  if (guesserIdx === gameState.drawerIdx) return;
  const player = gameState.players[guesserIdx];
  if (!player) return;

  if (player.hasSolvedThisRound) {
    // Already solved → treat as chat among solvers + drawer.
    hostRelayChat(guesserIdx, text);
    return;
  }

  const result = hostJudgeGuess(guesserIdx, text, broadcastWithVariants);
  if (result !== 'correct') {
    // Wrong: echo to drawer + solvers (not to other active guessers, not back to sender).
    hostRelayChat(guesserIdx, text);
  }
  // Correct case: hostJudgeGuess already broadcast correct_guess. The local
  // apply of that message appends "✓ <name> got it!" to chat — no extra
  // broadcast needed.
}

function hostHandleChat(senderIdx, text) {
  if (!text) return;
  if (gameState.phase === 'drawing') {
    const sender = gameState.players[senderIdx];
    if (!sender) return;
    if (senderIdx === gameState.drawerIdx) {
      // Drawer can't chat during drawing (UI disables, but defend).
      return;
    }
    if (sender.hasSolvedThisRound) {
      hostRelayChat(senderIdx, text);
    } else {
      // Active guesser sent a chat (not a guess submission). Treat as guess.
      hostHandleGuess(senderIdx, text);
    }
    return;
  }
  // Outside drawing: broadcast as plain chat to everyone.
  broadcastApplyAndSend({
    type: 'chat',
    kind: 'guess',
    senderIdx,
    text,
  });
}

// Relay a wrong-guess/solver chat to drawer + already-solved players,
// excluding the sender.
function hostRelayChat(senderIdx, text) {
  const sender = gameState.players[senderIdx];
  if (!sender) return;
  const msg = { type: 'chat', kind: 'guess', senderIdx, text };
  // Determine recipients.
  const recipients = new Set();
  recipients.add(gameState.drawerIdx);
  for (const p of gameState.players) {
    if (p.hasSolvedThisRound) recipients.add(p.idx);
  }
  recipients.delete(senderIdx);
  for (const idx of recipients) {
    hostSendToPeerIdx(idx, msg);
  }
}

// =============================================================
// Drawer-side senders (host or guest, whoever is drawing this round)
// =============================================================
function sendNetworkStrokeSegment(seg) {
  const msg = { type: 'stroke_segment', ...seg };
  if (gameMode === 'host') {
    relayToAll(msg); // host already drew locally; just relay to guests
  } else {
    hostConn?.send(msg);
  }
}

function sendNetworkUndo() {
  const msg = { type: 'undo_stroke' };
  if (gameMode === 'host') {
    relayToAll(msg);
  } else {
    hostConn?.send(msg);
  }
}

function sendNetworkClear() {
  const msg = { type: 'clear_canvas' };
  if (gameMode === 'host') {
    relayToAll(msg);
  } else {
    hostConn?.send(msg);
  }
}

function relayToAll(msg) {
  for (const peerId of acceptedOrder) {
    connections.get(peerId)?.send(msg);
  }
}

function sendWordChoice(choiceIdx) {
  if (gameMode === 'host') {
    hostFinalizeWordChoice(choiceIdx, broadcastWithVariants);
  } else {
    hostConn?.send({ type: 'word_chosen', choiceIdx });
  }
}

function sendChatFromInput() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (gameMode === 'host') {
    // Host can be: drawer (chat disabled in UI), active guesser, solver, or
    // outside drawing phase. Same routing logic as guests.
    hostLocalSubmit(text);
  } else {
    // Echo locally so the sender sees their own message.
    appendChatMessage({ kind: 'guess-own', senderIdx: myPlayerIdx, text });
    if (gameState.phase === 'drawing') {
      const me = gameState.players[myPlayerIdx];
      if (me && me.hasSolvedThisRound) {
        hostConn?.send({ type: 'request_chat', text });
      } else {
        hostConn?.send({ type: 'request_guess', text });
      }
    } else {
      hostConn?.send({ type: 'request_chat', text });
    }
  }
}

function hostLocalSubmit(text) {
  // Echo locally first so the host sees their own line immediately.
  appendChatMessage({ kind: 'guess-own', senderIdx: 0, text });
  if (gameState.phase === 'drawing') {
    if (gameState.drawerIdx === 0) return; // host is drawer, shouldn't reach here
    const me = gameState.players[0];
    if (me && me.hasSolvedThisRound) {
      hostHandleChat(0, text);
    } else {
      hostHandleGuess(0, text);
    }
  } else {
    hostHandleChat(0, text);
  }
}

// =============================================================
// Guest: inbound messages from host
// =============================================================
function onHostData(data) {
  switch (data.type) {
    case 'accepted':
      document.getElementById('guest-status').textContent =
        "You're in! Waiting for the host to start the game…";
      break;
    case 'denied':
      document.getElementById('guest-status').textContent =
        'The host denied your entry.';
      hostConn?.close();
      break;
    case 'game_init':
      myPlayerIdx = data.yourPlayerIdx;
      guestSetupGame({
        numPlayers: data.numPlayers,
        totalRounds: data.totalRounds,
        names: data.names,
        myIdx: data.yourPlayerIdx,
      });
      showScreen('game');
      enterGameScreen();
      break;
    case 'player_disconnected':
      alert('A player disconnected. Game ended.');
      showScreen('landing');
      teardownNetwork();
      break;
    default:
      applyMessageLocally(data);
      break;
  }
}

// =============================================================
// Apply broadcast messages on either side (host's local apply + guest receive).
// =============================================================
function applyMessageLocally(msg) {
  switch (msg.type) {
    case 'pick_phase_start':
      gameState.phase = 'word_pick';
      gameState.drawerIdx = msg.drawerIdx;
      gameState.roundIdx = msg.roundIdx;
      gameState.totalRounds = msg.totalRounds;
      gameState.pickEndsAt = msg.pickEndsAt;
      gameState.myWord = null;
      gameState.revealedWord = null;
      gameState.wordLength = 0;
      gameState.wordPattern = '';
      for (const p of gameState.players) p.hasSolvedThisRound = false;
      resetCanvas();
      hideOverlays();
      if (gameState.drawerIdx === myPlayerIdx) {
        // The drawer will receive your_word_pick separately; show waiting in
        // the meantime so the overlay state is consistent.
      } else {
        const drawer = gameState.players[gameState.drawerIdx];
        showWaitingForWordPick(drawer ? drawer.name : `Player ${gameState.drawerIdx + 1}`);
      }
      refreshAll();
      break;

    case 'your_word_pick':
      // Drawer-only: show pick UI.
      showWordPickForDrawer(msg.options);
      break;

    case 'round_start':
      gameState.phase = 'drawing';
      gameState.drawerIdx = msg.drawerIdx;
      gameState.roundIdx = msg.roundIdx;
      gameState.totalRounds = msg.totalRounds;
      gameState.wordLength = msg.wordLength;
      gameState.wordPattern = msg.wordPattern;
      gameState.drawingEndsAt = msg.endsAt;
      gameState.revealedWord = null;
      if (msg.secretWordForDrawer && gameState.drawerIdx === myPlayerIdx) {
        gameState.myWord = msg.secretWordForDrawer;
      } else {
        gameState.myWord = null;
      }
      hideOverlays();
      refreshAll();
      playRoundStartDing();
      break;

    case 'pattern_update':
      gameState.wordPattern = msg.wordPattern;
      renderHeader();
      break;

    case 'stroke_segment':
      applyStrokeSegment(msg);
      renderCanvas();
      break;

    case 'undo_stroke':
      applyUndoStroke();
      renderCanvas();
      break;

    case 'clear_canvas':
      applyClearCanvas();
      renderCanvas();
      break;

    case 'correct_guess': {
      const guesser = gameState.players[msg.guesserIdx];
      const drawer = gameState.players[msg.drawerIdx];
      if (guesser) {
        guesser.hasSolvedThisRound = true;
        guesser.score = msg.guesserScore;
      }
      if (drawer) drawer.score = msg.drawerScore;
      appendChatMessage({
        kind: 'correct',
        text: `✓ ${guesser ? guesser.name : `Player ${msg.guesserIdx + 1}`} got it! +${msg.guesserDelta}`,
      });
      refreshScoreboardAndInput();
      playCorrectChime();
      break;
    }

    case 'chat':
      appendChatMessage({ kind: msg.kind || 'guess', senderIdx: msg.senderIdx, text: msg.text });
      break;

    case 'round_end':
      gameState.phase = 'round_end';
      gameState.revealedWord = msg.word;
      gameState.myWord = null;
      // Update scores from the deltas to be safe even if we missed messages.
      msg.deltas.forEach(d => {
        const p = gameState.players[d.idx];
        if (p) p.score = d.total;
      });
      showRoundEnd(msg.word, msg.deltas);
      refreshAll();
      break;

    case 'game_over':
      gameState.phase = 'game_over';
      showGameEnd(msg.standings);
      refreshAll();
      playFanfare();
      break;
  }
}

function refreshScoreboardAndInput() {
  renderScoreboard();
  refreshChatInput();
}

// =============================================================
// Play again (host only)
// =============================================================
function playAgain() {
  if (gameMode !== 'host' || !hostSettings) return;
  hideOverlays();
  const total = 1 + acceptedOrder.length;
  const names = [myName];
  acceptedOrder.forEach(peerId => {
    names.push(guestNames.get(peerId) || `Player ${names.length + 1}`);
  });
  hostSetupGame({
    numPlayers: total,
    difficulty: hostSettings.difficulty,
    rotations: hostSettings.rotations,
    customWords: hostSettings.customWords,
    names,
  });
  acceptedOrder.forEach((peerId, i) => {
    connections.get(peerId)?.send({
      type: 'game_init',
      numPlayers: total,
      totalRounds: gameState.totalRounds,
      yourPlayerIdx: i + 1,
      names,
    });
  });
  enterGameScreen();
  hostStartNextRound(broadcastWithVariants, hostSendToPeerIdx);
}

// =============================================================
// Lobby UI
// =============================================================
function refreshLobbyUI() {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  const li0 = document.createElement('li');
  li0.textContent = `${myName} — You (host)`;
  list.appendChild(li0);
  acceptedOrder.forEach((peerId, i) => {
    const li = document.createElement('li');
    const name = guestNames.get(peerId) || peerId.slice(0, 8);
    li.textContent = `${name}`;
    list.appendChild(li);
  });

  const knockBox = document.getElementById('knock-box');
  if (pendingKnocks.length > 0) {
    knockBox.style.display = 'block';
    const queueNote = pendingKnocks.length > 1
      ? ` (+${pendingKnocks.length - 1} more waiting)` : '';
    const knockerId = pendingKnocks[0];
    const knockerName = guestNames.get(knockerId) || knockerId.slice(0, 8);
    document.getElementById('knock-name').textContent =
      `${knockerName} wants to join${queueNote}`;
  } else {
    knockBox.style.display = 'none';
  }

  const startBtn = document.getElementById('btn-start-game');
  const total = 1 + acceptedOrder.length;
  const valid = total >= 2 && total <= 8;
  startBtn.disabled = !valid;
  startBtn.textContent = `Start Game (${total} player${total === 1 ? '' : 's'})`;
}

// =============================================================
// Teardown
// =============================================================
function teardownNetwork() {
  hostClearAllTimers();
  for (const conn of connections.values()) {
    try { conn.close(); } catch {}
  }
  connections.clear();
  acceptedOrder.length = 0;
  pendingKnocks.length = 0;
  guestNames.clear();
  try { hostConn?.close(); } catch {}
  hostConn = null;
  try { peer?.destroy(); } catch {}
  peer = null;
  gameMode = 'idle';
  myPlayerIdx = -1;
  hostSettings = null;
  leaveGameScreen();
}
