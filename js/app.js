// app.js — URL routing, screen switching, button wiring.

let currentScreen = 'landing';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  currentScreen = name;
}

document.addEventListener('DOMContentLoaded', () => {
  initUI();

  // URL-based routing.
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) {
    showScreen('lobby-guest');
    joinAsGuest(invite);
  } else {
    showScreen('landing');
  }

  // Landing
  document.getElementById('btn-host-game').addEventListener('click', () => {
    showScreen('lobby-host');
    startHosting();
    refreshLobbyUI();
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

  // Game-end overlay
  document.getElementById('btn-play-again').addEventListener('click', playAgain);
});
