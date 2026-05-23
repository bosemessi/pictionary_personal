# Pictionary — Multiplayer

A peer-to-peer, browser-based Pictionary you can host from a single tab and share with up to seven friends via link. No accounts. No servers. No build step.

> Click **Host a Game** → copy the link → friends join → you approve them at the door → pick a word → draw → race to type the answer.

---

## Highlights

- **Zero backend.** All peers connect through the host's browser over WebRTC using [PeerJS](https://peerjs.com/) — the only runtime dependency, loaded from a CDN.
- **2 to 8 players.** Drawer rotates each round; you can play through 1, 2, or 3 full rotations.
- **Host approval ("Gatekeeper").** Only people the host explicitly admits get into the lobby. Multiple knockers are queued.
- **Host-authoritative.** The host owns the word pool, the chosen word, and the score. Guesses are validated server-side (well, host-side), so the secret never leaks to non-drawers.
- **Standard drawing toolbox.** 12 colors, 4 brush sizes, eraser, undo last stroke, clear canvas.
- **Custom word lists.** Paste your own words into the lobby — they're added on top of the built-in Easy/Medium/Hard bank.
- **Guess privacy.** Wrong guesses are visible only to the drawer and players who have already solved this round — other active guessers can't peek at each other's attempts.
- **Static-site friendly.** Pure HTML, CSS, and vanilla JS — drops straight onto GitHub Pages.

---

## Quick Start

### Play it

1. Open [index.html](index.html) in a browser (or visit the deployed GitHub Pages URL).
2. Click **Host a Game** — you get an invite URL like `.../index.html?invite=ab12cd34`.
3. Send the link to one to seven friends.
4. As they "knock," click **Let them in** to admit each one.
5. Pick a difficulty + number of rotations, optionally paste a custom word list, and click **Start Game**.
6. The drawer picks one of three words → 60s to doodle → guessers race to type the answer.

### Run it locally

Any static server works. The simplest options:

```bash
# VS Code: install "Live Server", then right-click index.html → Open with Live Server
# Or using Python:
python3 -m http.server 5500
# Then visit http://localhost:5500
```

To test multiplayer locally, open the invite link in a second browser window (a different browser or an incognito tab works best, so the two peers don't share state).

---

## How It Works

The app is a single page with four "screens" that JavaScript swaps in and out — no reloads, no routing library.

```
                  ┌──────────────────┐
  URL has no      │  Landing         │
  ?invite=  ────▶ │  [Host a Game]   │
                  └────────┬─────────┘
                           │ host clicks
                           ▼
                  ┌──────────────────┐        ┌──────────────────┐
                  │   Lobby (Host)   │        │  Lobby (Guest)   │
                  │  invite link +   │◀──────▶│  "Knocking…"     │
                  │  approval popup  │  peer  └──────────────────┘
                  └────────┬─────────┘  conn           ▲
                           │                           │
                           │  host clicks Start        │ URL has ?invite=xxxx
                           ▼                           │
                  ┌──────────────────────────────────┐ │
                  │            Game                  │◀┘
                  │  WORD_PICK → DRAWING → REVEAL    │
                  │  (loops; drawer rotates)         │
                  └────────┬─────────────────────────┘
                           │ all rounds played
                           ▼
                  ┌──────────────────┐
                  │  Game Over       │
                  │  [Play Again]    │
                  └──────────────────┘
```

### The network: host-authoritative

- **Host** calls `new Peer(roomId)` with a random 8-character ID derived from the shareable URL ([js/network.js](js/network.js)).
- **Guests** land on `?invite=<roomId>` and call `peer.connect(hostId)` — they all connect to the host, not to each other.
- The host owns the canonical `gameState`. Guests send *requests* (`request_guess`, `word_chosen`, `stroke_segment`); the host validates them and broadcasts the result. The two-player Connect 4 sibling uses a flat-peer approach, but with N players the host-as-relay model keeps state from diverging.
- Each round is a tiny state machine on the host: `WORD_PICK` (15s, drawer picks from 3 candidate words) → `DRAWING` (60s, or until everyone solves) → `ROUND_END` (5s reveal) → next drawer.

### The canvas

- **800×600 logical coordinate space.** Strokes are sent over the wire in this resolution; CSS scales the canvas to fit the viewport. Receivers translate logical coords to their local canvas, so drawing looks identical at any size.
- **Stroke streaming.** The drawer batches pointer events at ~30Hz and ships them as `stroke_segment` messages. Each segment carries its `strokeId` so receivers can group points into the right stroke and `undo` cleanly pops the last one.

### Guess privacy

When a guesser submits a wrong guess, the host echoes the *text* only to (a) the current drawer and (b) players who have already solved this round. Other active guessers don't see it — preventing copy-paste cheating while still letting solved players banter with the drawer. Correct guesses never broadcast the text at all; everyone just sees a "✓ Player N got it! +<points>" notice.

### Scoring

| Event                            | Points                                                    |
| -------------------------------- | --------------------------------------------------------- |
| Guesser gets the word            | `max(50, secondsRemaining × 2)` — faster = more           |
| Drawer (per correct guess)       | `25` per guesser who gets it                              |

Round ends as soon as every non-drawer player has guessed correctly, or the 60s timer expires.

---

## Project Layout

```
pictionary_personal/
├── index.html              # All screens in one file
├── css/
│   ├── style.css           # Shared chrome (palette, screens, buttons, lobby)
│   └── game.css            # Canvas, toolbar, scoreboard, chat, overlays
├── js/
│   ├── app.js              # Entry point: URL routing + button wiring
│   ├── gameLogic.js        # Round state machine, scoring, stroke history
│   ├── network.js          # PeerJS host-authoritative wiring + message types
│   ├── ui.js               # Canvas, toolbar, chat, scoreboard, overlays
│   └── words.js            # Built-in word bank (Easy / Medium / Hard)
└── docs/
    └── plan.md             # Original design blueprint
```

---

## Design Notes

| Decision | Why |
|---|---|
| **PeerJS over a custom WebSocket server** | No infra to run, no cost, no cold starts. PeerJS's public broker handles signaling; swap in your own if you scale. |
| **Host-authoritative state** | The host owns the word, the timer, and the score. Guesses are validated host-side, so guests never receive the secret — even in their browser memory. |
| **Stroke streaming with `strokeId`s** | Sending stroke *batches* (not whole strokes) keeps the drawing live; tagging segments with a stable `strokeId` makes undo a one-line operation on every peer. |
| **Logical 800×600 canvas, CSS-scaled** | Wire coordinates are resolution-independent. A drawing made on a 4K screen looks the same on a phone. |
| **Guess privacy via selective relay** | Easier than encrypting per-recipient: the host just doesn't forward wrong guesses to active guessers. Trust is implicit in the host's authority. |
| **Drawer chat disabled during drawing** | Simpler than implementing a separate "drawer hint" channel that's safe from word-leakage. Pure pictionary purists approve. |

---

## Roadmap

Ideas that would be fun to add:

- **Spectator mode** — a 9th joiner who watches but doesn't get a drawer slot.
- **Letter reveal hints** — at 30s/15s remaining, reveal one/two letters of the word.
- **Fuzzy "close!" feedback** — when guess is Levenshtein-1 from the word.
- **Sound effects** — chime on correct guess, fanfare on round end.
- **Player names** — let everyone type a display name on join instead of `Player N`.
- **Reconnect** — survive a transient network blip without losing the room.
- **Save & replay** — record stroke history and let players watch a round back.

---

## Credits

Built as a personal project, following the pattern of [connect4-personal](https://github.com/bosemessi/connect4-personal) and [chinese_checkers_personal](https://github.com/bosemessi/chinese_checkers_personal). Powered by [PeerJS](https://peerjs.com/) for the WebRTC plumbing. The full build blueprint lives in [docs/plan.md](docs/plan.md).
