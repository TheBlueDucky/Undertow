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

## Nobody trusts anybody

The host is authoritative. Guests send an *intent* — a short reference to a move, never a
board state — and the host regenerates the full list of legal moves for the current
position and looks for a match before broadcasting the result. Every other player
re-derives it the same way, so a modified client cannot force an illegal position.

## Hot-seat

Add `?dev=1` to the URL for *Hot-seat 2P* and *Hot-seat 4P* buttons that put every seat on
one screen. They exist for testing the rules without four machines.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The whole site: home, play, how-to-play, rules, settings, about |
| `css/style.css` | All styling, including the five themes |
| `js/rules.js` | The rule engine — pure, DOM-free, deterministic, depends on nothing |
| `js/ui.js` | Board rendering, piece glyphs, barriers, per-seat rotation, animation |
| `js/net.js` | Peer-to-peer transport, beacon matchmaking, host-authoritative star |
| `js/main.js` | Routing, settings, sound, the three arenas, the setup editor |
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
endings, notation, custom layouts, network move validation, and four fuzz runs.

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
