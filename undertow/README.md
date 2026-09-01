# Undertow

A two-player abstract strategy game. Nobody captures anything — you win by shoving the
enemy Trident into one of the holes in the floor.

## Running it

Double-click `index.html`. That's the whole install; there is no build step and no server.

If your browser is strict about local files, serve the folder over HTTP instead:

```bash
python -m http.server 8123 --directory .
```

Then open <http://localhost:8123>.

## Playing against someone

Open the **Play** page. One player picks *Open a room* and reads out the five-character
code; the other picks *Join with a code* and types it in. From there the two browsers talk
directly to each other — moves never pass through a server.

The only thing that needs the internet is the initial handshake, which uses the public
PeerJS broker purely to introduce the two browsers to each other. Everything else — the
rules, the board, the settings, the themes — works with no connection at all.

## Hot-seat

Add `?dev=1` to the URL for a *Local hot-seat* button that puts both sides on one screen.
It exists for testing the rules without a second machine.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The whole site: home, play, how-to-play, rules, settings, about |
| `css/style.css` | All styling, including the five themes |
| `js/rules.js` | The rule engine — pure, DOM-free, deterministic, depends on nothing |
| `js/ui.js` | Board rendering, piece glyphs, selection, animation |
| `js/net.js` | Peer-to-peer transport |
| `js/main.js` | Routing, settings, sound, lobby, glue |
| `js/tests.js` | Rule engine test suite |
| `tests.html` | Runs the suite in a browser |
| `run-tests.js` | Runs the same suite in node |

`js/rules.js` has no dependencies and no side effects. Everything else is presentation,
so the rules can be tested, replayed or reused on their own.

## Tests

```bash
node run-tests.js
```

Or open `tests.html`. The suite covers push chains, wall blocks, three-deep stacks, the
pull-across-a-hole case, every void interaction, all the endings, notation, network move
validation, and a randomised full-game fuzz run that asserts no piece ever ends up
standing inside a hole.

## Design notes

Two rules shape everything else.

**A push always ends with the attacker taking the square its target vacated.** That makes
every attack simultaneously an advance, which is why the board opens up despite starting
57% full.

**Pull scans ignore voids; push scans are blocked by them.** A hole is cover against half
the army and an open lane for the other half, so the same square is safe or lethal
depending on what is looking at it. This is what the Rod exists to exploit.
