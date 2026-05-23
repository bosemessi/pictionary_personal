// app.js — URL routing, screen switching, button wiring.

let currentScreen = 'landing';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  currentScreen = name;
}

document.addEventListener('DOMContentLoaded', () => {
  initUI();

  // Pre-fill name inputs from localStorage.
  let savedName = '';
  try { savedName = localStorage.getItem('pictionary_name') || ''; } catch {}
  document.getElementById('player-name').value = savedName;
  document.getElementById('player-name-guest').value = savedName;

  // URL-based routing.
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) {
    showScreen('lobby-guest');
    // Wait for the user to confirm their name + click Join.
  } else {
    showScreen('landing');
  }

  // Landing
  document.getElementById('btn-host-game').addEventListener('click', () => {
    unlockAudio();
    setMyName(document.getElementById('player-name').value);
    showScreen('lobby-host');
    startHosting();
    refreshLobbyUI();
  });

  // Guest join (only wired when ?invite= present)
  document.getElementById('btn-join-game').addEventListener('click', () => {
    if (!invite) return;
    unlockAudio();
    setMyName(document.getElementById('player-name-guest').value);
    document.getElementById('guest-name-step').style.display = 'none';
    document.getElementById('guest-status').textContent = 'Connecting…';
    joinAsGuest(invite);
  });

  // Host lobby
  document.getElementById('btn-copy-link').addEventListener('click', () => {
    const input = document.getElementById('invite-link');
    input.select();
    navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
    const btn = document.getElementById('btn-copy-link');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
  document.getElementById('btn-accept-knock').addEventListener('click', acceptKnock);
  document.getElementById('btn-deny-knock').addEventListener('click', denyKnock);
  document.getElementById('btn-start-game').addEventListener('click', startNetworkGame);
  document.getElementById('btn-host-back').addEventListener('click', () => {
    teardownNetwork();
    showScreen('landing');
  });

  // Game
  document.getElementById('btn-send-chat').addEventListener('click', sendChatFromInput);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatFromInput();
  });
  document.getElementById('btn-leave-game').addEventListener('click', () => {
    if (confirm('Leave the game? This will end it for everyone.')) {
      teardownNetwork();
      showScreen('landing');
    }
  });

  // Sound toggle
  const btnSound = document.getElementById('btn-sound');
  function refreshSoundButton() {
    btnSound.textContent = isSoundEnabled() ? '🔊' : '🔇';
  }
  refreshSoundButton();
  btnSound.addEventListener('click', () => {
    setSoundEnabled(!isSoundEnabled());
    refreshSoundButton();
  });

  // Game-end overlay
  document.getElementById('btn-play-again').addEventListener('click', playAgain);
});
