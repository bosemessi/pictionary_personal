# Multiplayer Pictionary — Build Blueprint

A static, peer-to-peer web Pictionary, hosted on GitHub Pages. Inherits the
architecture of [chinese_checkers_personal](../../chinese_checkers_personal/)
(host-authoritative WebRTC over PeerJS, N-player lobby with approval gate)
and the visual chrome of [connect4-personal](../../connect4-personal/).

> Click **Host a Game** → share the link → 1–7 friends knock → host accepts →
> drawer picks a word → 60s of frantic doodling → guessers race to type the
> answer → scores tally → next drawer.

---

## 1. Tools & Dependencies

| Category        | Requirement                                                  |
| --------------- | ------------------------------------------------------------ |
| Local dev       | VS Code + Live Server (or `python3 -m http.server`)          |
| Runtime deps    | **PeerJS** via CDN. No `npm`, no build step.                 |
| Version control | Git → GitHub Pages                                           |

---

## 2. Folder Structure

```text
pictionary_personal/
├── index.html          # All screens in one file (landing, lobby, game, end)
├── css/
│   ├── style.css       # Shared chrome: palette, screens, buttons, inputs
│   └── game.css        # Canvas, toolbar, chat sidebar, scoreboard, word pick
├── js/
│   ├── app.js          # Entry point: URL routing + screen switching
│   ├── gameLogic.js    # Rounds, drawer rotation, scoring, timer, word match
│   ├── network.js      # PeerJS host/guest + Pictionary message types
│   ├── ui.js           # Canvas, toolbar, chat, scoreboard renderers
│   └── words.js        # Built-in word bank (Easy / Medium / Hard)
├── docs/
│   └── plan.md         # This document
└── README.md
```

---

## 3. Player Model

| Role        | Count           | Notes                                                |
| ----------- | --------------- | ---------------------------------------------------- |
| Host        | 1               | Owns the canonical game state. Always Player 1.      |
| Guest       | 1–7             | Connects via invite link, knocks, joins the lobby.   |
| Drawer      | 1 per round     | Rotates through all players in `acceptedOrder`.      |
| Guesser     | Everyone else   | Types guesses in the chat sidebar.                   |

Minimum to start: 2 players. Maximum: 8 (1 host + 7 guests).

---

## 4. Game Loop

### Round lifecycle

```
                ┌──────────────────────┐
                │  Word-pick (15s)     │
                │  Drawer sees 3 words │
                │  Others wait         │
                └──────────┬───────────┘
                           │ pick made (or auto-pick on timeout)
                           ▼
                ┌──────────────────────┐       guesses
                │  Drawing (60s)       │ ◀─── arrive in
                │  Canvas live-syncs   │       chat sidebar
                │  Timer counts down   │
                └──────────┬───────────┘
                           │ timer = 0  OR  all guessers correct
                           ▼
                ┌──────────────────────┐
                │  Reveal (5s)         │
                │  Show word + scores  │
                └──────────┬───────────┘
                           │
                           ▼  (rotate drawer; repeat for N rotations)
                ┌──────────────────────┐
                │  Game over           │
                │  Final scoreboard    │
                │  [Play Again] button │
                └──────────────────────┘
```

### Word selection

- Drawer is shown **3 random options** drawn from `wordPool`.
- A 15s timer; on timeout, the first option auto-picks.
- `wordPool = builtInWords[difficulty] ++ customWords` — both live on the host only.
- Guests never receive the word pool, the chosen word, or the other two options.

### Scoring (skribbl-style)

| Event                            | Points                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| Guesser gets the word            | `max(50, ceil(secondsRemaining * 2))` — faster = more      |
| Drawer (per correct guess)       | `25` per guesser who gets it                               |
| No one guesses                   | Drawer gets `0`; guessers get `0`                          |

Round ends as soon as every non-drawer player has guessed correctly (don't waste
their time waiting out the clock).

### Word match

```js
function normalize(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}
```

Exact match after normalization. *(Future: a "close!" hint when Levenshtein
distance is 1.)*

---

## 5. Canvas & Drawing Tools

### Canvas

- Logical coordinate space: **800×600** (sent over the wire at this resolution).
- CSS scales the canvas to fit the viewport; renderer translates wire coords
  to the local canvas's actual pixel size. This decouples drawing from the
  receiver's screen.
- Background: clean white. Cursor: crosshair while drawing; default otherwise.

### Toolbar

| Tool          | Behavior                                                            |
| ------------- | ------------------------------------------------------------------- |
| Pen           | Draws a stroke at the current color and size.                       |
| Eraser        | A "pen" with color = white. (Stored as a normal stroke.)            |
| Color palette | 12 swatches: black, grey, white, red, orange, yellow, green, blue, purple, pink, brown, dark-brown. |
| Brush sizes   | 4 sizes: 2px, 5px, 12px, 25px (logical).                            |
| Undo          | Pops the last stroke off the history stack and re-renders.          |
| Clear         | Empties the history stack and re-renders.                           |

The toolbar is only **interactive** for the drawer. Non-drawers see a dimmed
toolbar (or it hides entirely — to decide during UI build).

### Stroke representation

A stroke is `{ id, color, size, points: [{x, y}, ...] }`. The drawer streams
stroke updates over the network in batches (see §6). The receiver maintains the
same `strokes[]` array and re-renders by replaying it.

---

## 6. Network Protocol

Built on the `chinese_checkers_personal` template:
host-authoritative, guests send requests, host validates and broadcasts.

### Message types

#### Lobby (reused from chinese_checkers)
| Type            | Direction         | Payload                                 |
| --------------- | ----------------- | --------------------------------------- |
| `accepted`      | host → guest      | —                                       |
| `denied`        | host → guest      | —                                       |
| `game_init`     | host → guest      | `{ playerIdx, players: [name, ...] }`   |

#### Round flow
| Type             | Direction          | Payload                                                       |
| ---------------- | ------------------ | ------------------------------------------------------------- |
| `round_start`    | host → all         | `{ drawerIdx, wordLength, durationSec }` — *word itself only to drawer* |
| `your_word_pick` | host → drawer only | `{ options: [w1, w2, w3], pickDeadline }`                     |
| `word_chosen`    | drawer → host      | `{ choiceIdx }`                                               |
| `word_revealed`  | host → drawer only | `{ word }` (sent once pick is finalized)                      |
| `tick`           | host → all         | `{ secondsRemaining }` (sent ~1Hz; could be derived locally)  |
| `round_end`      | host → all         | `{ word, scoreDeltas: { idx: delta, ... } }`                  |
| `game_over`      | host → all         | `{ finalScores: [...], winnerIdx }`                           |

#### Drawing
| Type             | Direction          | Payload                                                       |
| ---------------- | ------------------ | ------------------------------------------------------------- |
| `stroke_segment` | drawer → host → all | `{ strokeId, color, size, points: [{x,y},...], isFirst, isLast }` |
| `undo_stroke`    | drawer → host → all | —                                                              |
| `clear_canvas`   | drawer → host → all | —                                                              |

Drawer sends a segment every ~33ms (≤30Hz) while drawing, batching pointer
events to keep messages small. The host echoes segments to *all other* peers
(skipping the drawer, who already has them locally).

#### Chat & guesses
| Type             | Direction          | Payload                                                       |
| ---------------- | ------------------ | ------------------------------------------------------------- |
| `request_guess`  | guest → host       | `{ text }`                                                    |
| `chat`           | host → all         | `{ senderIdx, text, kind }` — `kind` ∈ `'guess'` (wrong), `'system'` |
| `correct_guess`  | host → all         | `{ guesserIdx, scoreDelta, totalScore }` — text NOT broadcast |

**Guess privacy** (per design decision): host validates each `request_guess`
silently. Wrong guesses are broadcast as chat to *everyone except guessers
who haven't gotten it yet* — i.e., only the drawer and players who already
solved can read live guesses. Correct guesses never broadcast their text;
just the "Player X got it!" notice.

### Host validation rules

The host rejects (silently drops) any message that doesn't pass:

- `stroke_segment` / `undo_stroke` / `clear_canvas`: sender must be the current drawer.
- `word_chosen`: sender must be the current drawer, and there must be an active pick window.
- `request_guess`: sender must NOT be the current drawer, and sender must not have already guessed correctly this round.

### Disconnect handling

If any player drops mid-game: end the round, return everyone to a "Game ended:
player disconnected" state, then to landing. Same behavior as chinese_checkers.

---

## 7. UI Screens

This is a single-page app. [index.html](../index.html) holds all screens; JS
toggles `.active`.

### Screen 1 — Landing

- Title, tagline
- **Host a Game** button

### Screen 2 — Lobby

**Host view**
- Invite link + Copy button
- Live player list (`Player N — <peer-id-snippet>`)
- Knock approval popup (queue-aware: shows count of others waiting)
- **Custom words** textarea (one per line, optional)
- **Difficulty** dropdown: Easy / Medium / Hard / Mixed
- **Rounds** dropdown: 1 / 2 / 3 rotations through the players
- **Start Game** button (disabled if <2 players)

**Guest view**
- Status text ("Knocking…", "You're in!", etc.)

### Screen 3 — Game

Three regions, side by side on desktop, stacked on mobile:

```
┌────────────────────────────────────────────────────────┐
│  Header: word/blanks · timer · current drawer · scores │
├──────────────────────────────────┬─────────────────────┤
│                                  │  Chat / Guesses     │
│         800×600 canvas           │   ┌──────────────┐  │
│  (or word-pick UI for drawer     │   │ system: ...  │  │
│   during the 15s pick window)    │   │ p2: cat      │  │
│                                  │   │ ...          │  │
│                                  │   └──────────────┘  │
│  ┌──────────────────────────┐    │   ┌──────────────┐  │
│  │ toolbar (drawer only)    │    │   │ type guess…  │  │
│  └──────────────────────────┘    │   └──────────────┘  │
└──────────────────────────────────┴─────────────────────┘
```

Header word display:
- Drawer sees the full word.
- Guessers see blanks: `_ _ _ _ _` (with spaces preserved as visible spaces).

### Screen 4 — Round/Game End overlays

- Round end: 5s overlay showing the word and the round's score deltas.
- Game end: final scoreboard, **Play Again** (returns the host's room to lobby).

---

## 8. State Diagram

```
LANDING ──host clicks──▶ LOBBY_HOST ──Start──▶ GAME ──game_over──▶ END
                              ▲                                      │
LANDING ──invite URL──▶ LOBBY_GUEST                                  │
                                                                     │
LOBBY_HOST ◀─────────────── Play Again ──────────────────────────────┘
```

`GAME` is itself a loop: `WORD_PICK → DRAWING → ROUND_REVEAL → (next drawer)`.

---

## 9. Development Phasing

### Phase 1 — UI Shell
Landing + lobby + game-screen scaffolding. URL routing (`?invite=`). No
PeerJS yet. Static canvas with a placeholder drawing tool you can use locally.

### Phase 2 — Local Game Engine
Canvas drawing with the full toolbar (pen, eraser, colors, sizes, undo, clear).
Stroke history. Word bank and word-pick UI. Timer and round transitions, all
client-side. You can play "solo Pictionary" in one tab.

### Phase 3 — Network Bridge
Port the chinese_checkers network.js wholesale. Wire up lobby (knock/accept/
deny/start). Two-tab smoke test with `game_init` only.

### Phase 4 — Round Synchronization
Add `round_start`, `your_word_pick`, `word_chosen`, `round_end`. No drawing
sync yet — just verify that all peers transition through the round states in
lockstep.

### Phase 5 — Drawing Sync
Add `stroke_segment`, `undo_stroke`, `clear_canvas`. This is the highest-bandwidth
channel and where most bugs live. Test with 2 then 4 peers.

### Phase 6 — Guess & Chat
Add `request_guess`, `chat`, `correct_guess`. Implement the privacy rule
(wrong guesses visible only to drawer + solved players).

### Phase 7 — Scoring, Game-End, Play Again
Persist scores across rounds. Game-end overlay. Play Again routes the room
back to the lobby cleanly (without re-knocking).

### Phase 8 — Polish
Mobile layout. Sound effects (correct guess chime, round-end fanfare).
Word-length hints. Reveal animations. Cursor preview for the drawer.

---

## 10. Open Questions (deferred)

- **Spectators**: Should a 9th joiner be allowed as a non-player observer?
  Probably not for v1.
- **Reconnect**: PeerJS connections die hard. A "rejoin via same link" flow
  could survive a transient network blip.
- **Word repeats**: Should the host avoid offering a word twice in one game?
  Easy to add — keep a `usedWords` Set on the host.
- **Fuzzy matching**: A "Close!" hint when Levenshtein distance to the word is 1.
- **Hint reveals**: Pictionary often reveals letters as time runs out
  (`c _ _` at 30s, `c a _` at 15s). Nice-to-have.
