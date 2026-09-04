# Undertow

A two- or four-player abstract strategy game on an 11×11 board. Nobody captures
anything — you win by shoving everyone else's Trident into a hole in the floor.

## Running it

Double-click `index.html`. That's the whole install; there is no build step and no server.

If your browser is strict about local files, serve the folder over HTTP instead:

```bash
python -m http.server 8123 --directory .
```

Then open <http://localhost:8123>.

## The three arenas

**Quick Match · 2 players** — click once and get paired with whoever else is looking.
**Quick Match · 4 players** — one player on each side of the board, last Trident standing.
**Custom room** — rearrange all fourteen pieces, pick both colours, share the room code.

Only the initial handshake touches the network. Everything else — the rules, the board,
the settings, the themes — works with no connection at all.

## How Quick Match works without a server

Room codes are easy: the broker only has to answer *"where is the peer named ABC23?"*.
Matchmaking asks a harder question — *"who else is waiting right now?"* — and something
normally has to remember that list.

Instead, players agree on a well-known name. Looking for a game, your browser first tries
to **connect** to that name. If somebody answers, you're matched. If nobody does, you
**become** that name and wait.

A waiting player can't simply play on the well-known name: releasing it later would kill
the game, and holding it would block everyone else. So the waiter runs a throwaway
**beacon** under that name alongside its own private peer. The beacon hands each arrival
the private address and, once the table is full, shuts down and frees the name for the
next group.

Seats are counted by connections that actually landed, never by invitations handed out.
That distinction matters: if a player is invited but never arrives — closed tab, blocked
NAT — counting the invitation would burn a seat, and a four-player table could never
reach four. Over-inviting is safe (a latecomer is told the table is full and goes back to
looking); under-inviting deadlocks the table forever. If someone leaves before kick-off,
the table re-lists itself.

A guest that has been seated but never sees the game start gives up after 75 seconds and
says so, rather than waiting forever.

Honest limits: it works well when a handful of people are online and gets slower as more
pile in, there is no queue or ordering, and a browser that dies leaves a stale name that
others waste a few seconds timing out against. Room codes are always there as the
reliable path.

### Changing the handshake

Peer names are prefixed with a protocol version (`undertow-v3-`). Bump `PREFIX` in
`js/net.js` whenever the handshake changes, so old tabs still running the previous build
can never share a beacon with new ones — mixed versions disagree about seat accounting and
strand the table.

Script and stylesheet URLs carry a matching `?v=` query. Bump it in `index.html` and
`tests.html` alongside `PREFIX`, otherwise browsers keep serving the previous JavaScript
and you will be debugging code that is no longer on disk. If the game ever behaves like an
older version, hard-refresh (Ctrl+F5) once.

## Names

Set a name in Settings and it is kept in this browser's local storage — nowhere else. The
default is *Player*; blanking the field falls back to it rather than showing an empty
label. Names are capped at 16 characters with control characters stripped, and are
rendered as text, never markup.

`SEAT_NAMES` in the rule engine (Amber, Jade, Violet, Coral) still names the **colour**.
The name you set identifies the **person in that chair**. Both are shown together
everywhere — turn bar, tally, chat — because nothing stops two players choosing the same
name, and the colour beside it is what tells them apart.

Online, a guest sends its name the moment it connects and the host keeps the roster and
broadcasts it, so everyone at the table sees the same list. In a local game each human
chair gets its own name box in the setup panel, prefilled with your saved name for the
first chair and *Player 2*, *Player 3*… for the rest; computer chairs are simply
*Computer*.

## Chat

Every online arena has chat, from the moment you start waiting for players through to the
end of the game. It rides the same peer-to-peer path as moves; nothing is stored, and the
log clears when you leave.

Guests send only text. The host stamps the seat from the connection it arrived on, so a
player cannot post as somebody else, and messages are inserted as text nodes rather than
markup — a message containing HTML displays as the characters that were typed. Messages
are capped at 200 characters, control characters are stripped, and the host ignores
anything arriving faster than one message every 400ms.

## The move clock

Each turn is capped (one minute by default, configurable in Settings, or off). Running out
forfeits **that turn only** — the board is untouched and the player stays in the game.

Only the host may declare a timeout; it broadcasts the result and everyone else applies it.
Guests run the same countdown purely for display, so latency can never make two clients
disagree about whose turn it is. In an online game the host's setting governs the table and
is sent in the handshake.

Because a forfeited turn changes nothing but whose move it is, two players idling in turn
repeat the position and the game ends by repetition — an abandoned game closes itself.

## Nobody trusts anybody

The host is authoritative. Guests send an *intent* — a short reference to a move, never a
board state — and the host regenerates the full list of legal moves for the current
position and looks for a match before broadcasting the result. Every other player
re-derives it the same way, so a modified client cannot force an illegal position.

## Play on this device

A first-class arena, not a debug flag. Choose two or four seats and set each one to a
person or to the computer, so the same screen covers pass-and-play, solo practice, and a
four-way game where only two people showed up.

With *turn the board to face the current player* on (the default), the board rotates so
whoever is about to move is always looking at their own side — which is what makes passing
one phone around actually work. It deliberately does not rotate for computer seats.

## The computer opponent

`js/ai.js` — minimax with alpha-beta and iterative deepening, scored from one seat's point
of view so the same code serves two players and four. With four it is *paranoid*: every
other seat is assumed to be against you. Pessimistic, but stable, unlike maxn.

It runs on the main thread on purpose. A Web Worker cannot be created from a `file://`
page, and this game has to keep working when you double-click `index.html` — so instead of
a worker there is a wall-clock budget per move (60ms / 250ms / 600ms by level) and a pass
that runs out of time is discarded rather than half-used.

Measured on this board: branching is 45 moves in two-player and 31 in four-player, at
~230k nodes/sec. Move ordering does the heavy lifting — kills first, then attacks, then
quiet moves toward the centre, with barrier placement last because it alone contributes
~89 legal moves in the early game and is rarely the best try.

| Level | Depth (2P / 4P) | Budget | Behaviour |
|---|---|---|---|
| Easy | 1 / 1 | 60ms | 35% of the time plays a random move — but never one that drops its own Trident |
| Normal | 3 / 2 | 250ms | Occasional slip |
| Hard | 5 / 4 | 600ms | No deliberate mistakes |

Verified by matches: easy beats random 11-0, normal beats easy 7-0.

## What self-play says about balance so far

**No first-player advantage is visible.** Twenty even games at easy finished 7-9 to the
second player — noise at that sample size. Nothing to fix.

**The open question: games stop finishing as play improves.**

| Matchup | Finished | Unfinished (400-ply cap) |
|---|---|---|
| easy vs easy, 20 games | 16 | 4 (20%) |
| normal vs normal, 8 games | 2 | 6 (75%) |
| hard vs normal, 4 games | 0 | 4 (100%) |

Monotonic across three points, so it is a real effect rather than a fluke of one matchup.
What it *means* is still open, because there is a confound that predicts exactly this
curve: all three levels share one evaluation function, and that function penalises
standing next to a void. A deeper search is simply better at obeying it, so stronger
players avoid holes more effectively and nothing ever dies. "The game is drawish at depth"
and "the evaluation is too cowardly" both produce this table.

The experiment that separates them is to add a term rewarding *threat* — forcing an
opponent into a position where every reply is worse — rather than only rewarding personal
safety, then re-run the same ladder. If games start finishing, the evaluation was the
problem. If they still do not, the rules need a look: a whole-game move cap, more holes,
or holes that migrate.

No rule should change on the strength of this table alone.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The whole site: home, play, how-to-play, rules, settings, about |
| `css/style.css` | All styling, including the five themes |
| `js/rules.js` | The rule engine — pure, DOM-free, deterministic, depends on nothing |
| `js/ai.js` | The computer opponent - pure, depends only on the rule engine |
| `js/ui.js` | Board rendering, piece glyphs, barriers, per-seat rotation, animation |
| `js/net.js` | Peer-to-peer transport, beacon matchmaking, host-authoritative star |
| `js/main.js` | Routing, settings, sound, the arenas, local seats, the setup editor |
| `js/tests.js` | Rule engine test suite |
| `tests.html` | Runs the suite in a browser |
| `run-tests.js` | Runs the same suite in node |

`js/rules.js` has no dependencies and no side effects. Everything else is presentation,
so the rules can be tested, replayed or reused on their own.

## Tests

```bash
node run-tests.js
```

Or open `tests.html`. The suite covers board setup for both seat counts, void symmetry
across 400 seeds, push chains, wall blocks, three-deep stacks, the pull-across-a-hole
case, every barrier interaction, four-player elimination and neutral armies, all the
endings, notation, custom layouts, network move validation, the turn clock, the
computer opponent, and four fuzz runs.

Two of those fuzz runs use a purely random player and two use a player that takes an
offered kill 85% of the time. That distinction matters: on an 11×11 board a purely random
player wanders and often hits the ply cap, so it asserts invariants only. The kill-seeking
model is a far better stand-in for a person, and it has to actually finish games — it
does, 30/30 for both seat counts, with a median around 150 plies for two players and 230
for four.

## Design notes

Three rules shape everything else.

**A push always ends with the attacker taking the square its target vacated.** That makes
every attack simultaneously an advance.

**Pull scans ignore voids; push scans are blocked by them.** A hole is cover against half
the army and an open lane for the other half, so the same square is safe or lethal
depending on what is looking at it. This is what the Rod exists to exploit.

**The barrier is the only thing that stops a pull**, which makes it the one reliable answer
to a Rod that has found a good hole. Costing one turn to place and three enemy turns to
remove, it trades your tempo for theirs — but only if they actually needed that square.

There are four holes rather than three because of the four-player mode. Two-player
fairness only needs 180° symmetry, but four-player fairness needs 90°, and under a quarter
turn every non-central square has an orbit of exactly four. Three holes cannot be made
fair for four players; four can be made fair for both.
