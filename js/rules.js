/* Undertow - rules.js  (v2: 11x11, 2 or 4 players, barriers)
 * Pure game engine. No DOM. Deterministic.
 * Classic script (not a module) so the site works from file:// with no server.
 */
(function (root) {
  'use strict';

  var T = { SWORD: 1, SCYTHE: 2, BOW: 3, ROD: 4, SPEAR: 5, TRIDENT: 6 };
  var NAMES = { 1: 'Sword', 2: 'Scythe', 3: 'Bow', 4: 'Rod', 5: 'Spear', 6: 'Trident' };
  // Sword, Scythe and Spear all start with S, so notation uses distinct letters.
  var LETTERS = { 1: 'S', 2: 'C', 3: 'B', 4: 'R', 5: 'P', 6: 'T' };

  // Seats are named by the side of the board they sit on.
  var SOUTH = 0, WEST = 1, NORTH = 2, EAST = 3, NEUTRAL = 4;
  var SEAT_NAMES = ['Amber', 'Jade', 'Violet', 'Coral'];
  var BARRIER_HP = 3;

  function idx(N, r, c) { return r * N + c; }
  function rowOf(N, i) { return (i / N) | 0; }
  function colOf(N, i) { return i % N; }
  function onBoard(N, r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  function fileLetter(c) { return 'abcdefghijklmnop'.charAt(c); }
  function sqName(N, i) { return fileLetter(colOf(N, i)) + (rowOf(N, i) + 1); }

  var ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ALL = ORTH.concat(DIAG);

  // owner in the high nibble, piece type in the low nibble
  function owner(p) { return p >> 4; }
  function type(p) { return p & 15; }
  function mk(o, t) { return (o << 4) | t; }

  /* ---- piece specification --------------------------------------------
   * move:   dirs + max slide distance (blocked by pieces, voids and barriers)
   * attack: 'push' | 'pull' | 'both'
   *   push  scans for the first blocker; path must be clear of everything else
   *   pull  scans for the first blocker, skipping empties AND voids
   *   exact: target must sit at exactly this distance (Spear)
   *   n:     displacement options
   * A scan that ends on an enemy barrier becomes a strike instead of an attack.
   */
  var SPEC = {};
  SPEC[T.SWORD] = {
    move: { dirs: ORTH, max: 1 },
    attack: { mode: 'push', dirs: ORTH, range: 1, n: [1] }
  };
  SPEC[T.SCYTHE] = {
    move: { dirs: DIAG, max: 1 },
    attack: { mode: 'pull', dirs: DIAG, range: 3, n: [1] }
  };
  SPEC[T.BOW] = {
    move: { dirs: DIAG, max: 99 },
    attack: { mode: 'push', dirs: DIAG, range: 99, n: [1] }
  };
  SPEC[T.ROD] = {
    move: { dirs: ORTH, max: 99 },
    attack: { mode: 'pull', dirs: ORTH, range: 99, n: [1] }
  };
  SPEC[T.SPEAR] = {
    move: { dirs: ORTH, max: 2 },
    attack: { mode: 'push', dirs: ORTH, range: 2, exact: 2, n: [2] }
  };
  SPEC[T.TRIDENT] = {
    move: { dirs: ALL, max: 3 },
    attack: { mode: 'both', dirs: ALL, pushRange: 1, pullRange: 3, n: [1, 2] }
  };

  /* ---- deterministic RNG ---------------------------------------------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- void generation -------------------------------------------------
   * Four holes forming one orbit under 90-degree rotation about the centre.
   * Two-player fairness needs 180-degree symmetry; four-player fairness needs
   * 90-degree, and every non-centre square has an orbit of exactly four - so
   * four holes is the only count that can be fair for both.
   * Holes are confined to the central core, clear of every home area.
   */
  function coreRadius(N, homeDepth) {
    return Math.max(1, ((N - 1) / 2) - homeDepth);
  }

  function voidOrbits(N, homeDepth) {
    var mid = (N - 1) / 2, rad = coreRadius(N, homeDepth);
    var seen = {}, orbits = [], r, c;
    for (r = mid - rad; r <= mid + rad; r++) {
      for (c = mid - rad; c <= mid + rad; c++) {
        var i = idx(N, r, c);
        if (r === mid && c === mid) continue;   // centre is its own orbit of 1
        if (seen[i]) continue;
        var orbit = [], cur = i, k, distinct = {};
        for (k = 0; k < 4; k++) {
          orbit.push(cur);
          seen[cur] = 1; distinct[cur] = 1;
          var rr = rowOf(N, cur), cc = colOf(N, cur);
          cur = idx(N, cc, 2 * mid - rr);        // rotate 90 degrees about the centre
        }
        if (orbit.length === 4 && Object.keys(distinct).length === 4) orbits.push(orbit);
      }
    }
    return orbits;
  }

  function isConnected(N, voids, barrierHp) {
    var start = -1, total = 0, i;
    for (i = 0; i < N * N; i++) {
      if (voids[i] || (barrierHp && barrierHp[i])) continue;
      total++; if (start < 0) start = i;
    }
    if (start < 0) return false;
    var seen = {}, stack = [start], n = 0;
    seen[start] = 1;
    while (stack.length) {
      var s = stack.pop(); n++;
      var r = rowOf(N, s), c = colOf(N, s);
      for (var d = 0; d < 4; d++) {
        var rr = r + ORTH[d][0], cc = c + ORTH[d][1];
        if (!onBoard(N, rr, cc)) continue;
        var j = idx(N, rr, cc);
        if (voids[j] || (barrierHp && barrierHp[j]) || seen[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    return n === total;
  }

  function generateVoids(N, homeDepth, seed) {
    var rnd = mulberry32(seed >>> 0);
    var orbits = voidOrbits(N, homeDepth);
    for (var tries = 0; tries < 200 && orbits.length; tries++) {
      var orbit = orbits[(rnd() * orbits.length) | 0];
      var voids = new Uint8Array(N * N);
      for (var i = 0; i < orbit.length; i++) voids[orbit[i]] = 1;
      if (isConnected(N, voids, null)) return voids;
    }
    var fb = new Uint8Array(N * N);
    if (orbits.length) for (var j = 0; j < orbits[0].length; j++) fb[orbits[0][j]] = 1;
    return fb;
  }

  /* ---- setup ----------------------------------------------------------- */

  var BACK_RANK = [T.BOW, T.ROD, T.SPEAR, T.TRIDENT, T.SPEAR, T.ROD, T.BOW];
  var FRONT_RANK = [T.SWORD, T.SCYTHE, T.SWORD, T.SCYTHE, T.SWORD, T.SCYTHE, T.SWORD];
  var ARMY = 7;          // pieces per rank
  var HOME_DEPTH = 2;    // ranks per player

  // Where seat `s` puts the piece at index `k` of its back (d=0) or front (d=1) rank.
  function homeSquare(N, seat, d, k) {
    var off = ((N - ARMY) / 2) | 0;     // centre the army on its side
    if (seat === SOUTH) return idx(N, d, off + k);
    if (seat === NORTH) return idx(N, N - 1 - d, off + ARMY - 1 - k);
    if (seat === WEST)  return idx(N, off + ARMY - 1 - k, d);
    return idx(N, off + k, N - 1 - d);  // EAST
  }

  function defaultLayout() {
    return { back: BACK_RANK.slice(), front: FRONT_RANK.slice() };
  }

  // layouts: optional per-seat {back:[7], front:[7]} for custom rooms
  function createState(opts) {
    opts = opts || {};
    var N = opts.size || 11;
    var seats = opts.seats === 4 ? [SOUTH, WEST, NORTH, EAST] : [SOUTH, NORTH];
    var st = {
      N: N,
      seats: seats,
      board: new Int8Array(N * N),
      voids: opts.voids || generateVoids(N, HOME_DEPTH, opts.seed || 1),
      barrierHp: new Uint8Array(N * N),
      barrierOwner: new Int8Array(N * N),
      barrierLeft: [0, 0, 0, 0],
      alive: [false, false, false, false],
      toMove: SOUTH,
      ply: 0,
      seed: (opts.seed || 1) >>> 0,
      log: [],
      repetition: {},
      result: null
    };
    for (var i = 0; i < N * N; i++) st.barrierOwner[i] = -1;

    for (var s = 0; s < seats.length; s++) {
      var seat = seats[s];
      var lay = (opts.layouts && opts.layouts[seat]) || defaultLayout();
      for (var k = 0; k < ARMY; k++) {
        if (lay.back[k]) st.board[homeSquare(N, seat, 0, k)] = mk(seat, lay.back[k]);
        if (lay.front[k]) st.board[homeSquare(N, seat, 1, k)] = mk(seat, lay.front[k]);
      }
      st.alive[seat] = true;
      st.barrierLeft[seat] = opts.barriers === false ? 0 : 1;
    }
    st.toMove = seats[0];
    st.repetition[hashState(st)] = 1;
    return st;
  }

  function nextSeat(st, from) {
    var order = st.seats, i = order.indexOf(from);
    for (var k = 1; k <= order.length; k++) {
      var s = order[(i + k) % order.length];
      if (st.alive[s]) return s;
    }
    return from;
  }

  function hashState(st) {
    var s = String(st.toMove) + '|';
    for (var i = 0; i < st.N * st.N; i++) {
      s += String.fromCharCode(65 + st.board[i] + (st.barrierHp[i] ? 100 + st.barrierHp[i] : 0));
    }
    return s;
  }

  /* ---- what blocks a scan ---------------------------------------------- */

  function blocked(st, sq) { return st.board[sq] !== 0 || st.barrierHp[sq] > 0; }
  function hostile(st, sq, me) {
    // a piece you may attack: anyone else's, including a neutral (dead) army
    var p = st.board[sq];
    return p !== 0 && owner(p) !== me;
  }

  /* ---- push resolution -------------------------------------------------
   * The chain (target + at most one piece behind it) slides n squares away.
   * Each step the front piece advances; entering a void kills it and anyone
   * behind advances into the freed square. A wall, a barrier or a third piece
   * stops the whole push.
   */
  function resolvePush(st, from, d, n, target) {
    var N = st.N, dr = d[0], dc = d[1];
    function step(sq) {
      var r = rowOf(N, sq) + dr, c = colOf(N, sq) + dc;
      return onBoard(N, r, c) ? idx(N, r, c) : -1;
    }
    var chain = [], s = target;
    while (s >= 0 && st.board[s]) {
      chain.push(s);
      if (chain.length > 2) return null;       // three-deep stack is immovable
      s = step(s);
    }
    if (!chain.length) return null;

    var pos = chain.slice(), moved = [], i;
    for (i = 0; i < chain.length; i++) {
      moved.push({ piece: st.board[chain[i]], from: chain[i], to: chain[i], died: false });
    }
    var deaths = [], steps = 0;

    for (var k = 0; k < n && pos.length; k++) {
      var front = pos[pos.length - 1];
      var nxt = step(front);
      if (nxt < 0) break;                      // wall
      if (st.barrierHp[nxt]) break;            // barriers stop a push dead
      if (st.voids[nxt]) {
        var dying = moved[pos.length - 1];
        dying.to = nxt; dying.died = true;
        deaths.push(dying);
        pos.pop();
        for (i = 0; i < pos.length; i++) { pos[i] = step(pos[i]); moved[i].to = pos[i]; }
        steps++;
      } else {
        for (i = pos.length - 1; i >= 0; i--) { pos[i] = step(pos[i]); moved[i].to = pos[i]; }
        steps++;
      }
    }
    if (steps === 0) return null;
    return { moved: moved, deaths: deaths, steps: steps, advance: true };
  }

  /* ---- pull resolution -------------------------------------------------
   * Target is dragged one square toward the puller. That square is
   * guaranteed empty-or-void by the scan. The puller never moves.
   */
  function resolvePull(st, from, d, target) {
    var N = st.N;
    var r = rowOf(N, target) - d[0], c = colOf(N, target) - d[1];
    if (!onBoard(N, r, c)) return null;
    var dest = idx(N, r, c);
    if (st.board[dest] || st.barrierHp[dest]) return null;
    var rec = { piece: st.board[target], from: target, to: dest, died: !!st.voids[dest] };
    return { moved: [rec], deaths: rec.died ? [rec] : [], steps: 1, advance: false };
  }

  /* ---- move generation ------------------------------------------------- */

  function resKey(res) {
    var s = '';
    for (var i = 0; i < res.moved.length; i++) {
      s += res.moved[i].from + '>' + res.moved[i].to + (res.moved[i].died ? 'x' : '') + ';';
    }
    return s;
  }

  function moveKey(m) {
    return m.kind + ':' + m.from + ':' + m.to + ':' + (m.n || 0) + ':' + (m.dir ? m.dir.join(',') : '');
  }

  function genPush(st, from, d, range, a, out) {
    var N = st.N, me = owner(st.board[from]);
    var r0 = rowOf(N, from), c0 = colOf(N, from), target = -1, dist = 0;
    for (var k = 1; k <= range; k++) {
      var r = r0 + d[0] * k, c = c0 + d[1] * k;
      if (!onBoard(N, r, c)) return;
      var sq = idx(N, r, c);
      if (st.voids[sq]) return;                       // voids block push paths
      if (st.barrierHp[sq]) {                         // a wall you can chip away at
        if (st.barrierOwner[sq] !== me && (!a.exact || k === a.exact)) {
          out.push({ from: from, to: sq, kind: 'strike', dir: d, n: 0 });
        }
        return;
      }
      var q = st.board[sq];
      if (q) {
        if (owner(q) === me) return;
        target = sq; dist = k; break;
      }
    }
    if (target < 0) return;
    if (a.exact && dist !== a.exact) return;
    var seen = {};
    for (var j = 0; j < a.n.length; j++) {
      var res = resolvePush(st, from, d, a.n[j], target);
      if (!res) continue;
      var kk = resKey(res);
      if (seen[kk]) continue;                         // Trident push-1 and push-2 can coincide
      seen[kk] = 1;
      out.push({ from: from, to: target, kind: 'push', dir: d, n: a.n[j], res: res });
    }
  }

  function genPull(st, from, d, range, out) {
    var N = st.N, me = owner(st.board[from]);
    var r0 = rowOf(N, from), c0 = colOf(N, from), target = -1;
    for (var k = 1; k <= range; k++) {
      var r = r0 + d[0] * k, c = c0 + d[1] * k;
      if (!onBoard(N, r, c)) return;
      var sq = idx(N, r, c);
      if (st.voids[sq]) continue;                     // pulls reach across holes
      if (st.barrierHp[sq]) {                         // but never across a barrier
        if (st.barrierOwner[sq] !== me && k >= 2) {
          out.push({ from: from, to: sq, kind: 'strike', dir: d, n: 0 });
        }
        return;
      }
      var q = st.board[sq];
      if (q) {
        if (owner(q) === me) return;
        if (k < 2) return;                            // adjacent: nowhere to drag it
        target = sq; break;
      }
    }
    if (target < 0) return;
    var res = resolvePull(st, from, d, target);
    if (res) out.push({ from: from, to: target, kind: 'pull', dir: d, n: 1, res: res });
  }

  function genFor(st, from, out) {
    var N = st.N, p = st.board[from], s = SPEC[type(p)];
    var r0 = rowOf(N, from), c0 = colOf(N, from), i, k;

    for (i = 0; i < s.move.dirs.length; i++) {
      var d = s.move.dirs[i];
      for (k = 1; k <= s.move.max; k++) {
        var r = r0 + d[0] * k, c = c0 + d[1] * k;
        if (!onBoard(N, r, c)) break;
        var to = idx(N, r, c);
        if (st.voids[to] || blocked(st, to)) break;
        out.push({ from: from, to: to, kind: 'move' });
      }
    }

    var a = s.attack;
    if (a.mode === 'push' || a.mode === 'both') {
      var pr = a.mode === 'both' ? a.pushRange : a.range;
      for (i = 0; i < a.dirs.length; i++) genPush(st, from, a.dirs[i], pr, a, out);
    }
    if (a.mode === 'pull' || a.mode === 'both') {
      var qr = a.mode === 'both' ? a.pullRange : a.range;
      for (i = 0; i < a.dirs.length; i++) genPull(st, from, a.dirs[i], qr, out);
    }
  }

  // Placing your barrier costs a whole turn and can go on any empty square.
  function genPlacements(st, side, out) {
    if (!st.barrierLeft[side]) return;
    for (var i = 0; i < st.N * st.N; i++) {
      if (st.voids[i] || blocked(st, i)) continue;
      out.push({ from: -1, to: i, kind: 'place' });
    }
  }

  function legalMoves(st, side) {
    if (side === undefined) side = st.toMove;
    var out = [];
    for (var i = 0; i < st.N * st.N; i++) {
      var p = st.board[i];
      if (!p || owner(p) !== side) continue;
      genFor(st, i, out);
    }
    genPlacements(st, side, out);
    return out;
  }

  function movesFrom(st, from) {
    var p = st.board[from];
    if (!p || owner(p) !== st.toMove) return [];
    var out = [];
    genFor(st, from, out);
    return out;
  }

  /* ---- applying moves --------------------------------------------------- */

  // A search clone. `voids` and `seats` never change, so they are shared.
  // `quiet` states skip notation and repetition bookkeeping - both are pure
  // overhead inside a search tree.
  function cloneState(st) {
    return {
      N: st.N, seats: st.seats, voids: st.voids,
      board: new Int8Array(st.board),
      barrierHp: new Uint8Array(st.barrierHp),
      barrierOwner: new Int8Array(st.barrierOwner),
      barrierLeft: st.barrierLeft.slice(),
      alive: st.alive.slice(),
      toMove: st.toMove, ply: st.ply, seed: st.seed,
      log: st.log, repetition: {}, result: st.result,
      quiet: true
    };
  }

  function applyMove(st, mv) {
    var b = st.board, i, mover = st.toMove;
    var note = st.quiet ? '' : notate(st, mv);

    if (mv.kind === 'place') {
      st.barrierHp[mv.to] = BARRIER_HP;
      st.barrierOwner[mv.to] = mover;
      st.barrierLeft[mover] = 0;
    } else if (mv.kind === 'strike') {
      st.barrierHp[mv.to] -= 1;
      if (st.barrierHp[mv.to] <= 0) { st.barrierHp[mv.to] = 0; st.barrierOwner[mv.to] = -1; }
    } else if (mv.kind === 'move') {
      b[mv.to] = b[mv.from]; b[mv.from] = 0;
    } else {
      var res = mv.res;
      for (i = 0; i < res.moved.length; i++) b[res.moved[i].from] = 0;
      for (i = 0; i < res.moved.length; i++) {
        if (!res.moved[i].died) b[res.moved[i].to] = res.moved[i].piece;
      }
      if (mv.kind === 'push') { b[mv.to] = b[mv.from]; b[mv.from] = 0; }
    }

    if (!st.quiet) st.log.push(note);
    eliminate(st);
    st.toMove = nextSeat(st, mover);
    st.ply++;
    updateResult(st, mover);
    return st;
  }

  // A seat whose Trident is gone is out. Its army stays on the board as
  // neutral scenery: still pushable, still blocks, but it never gets a turn.
  function eliminate(st) {
    for (var s = 0; s < st.seats.length; s++) {
      var seat = st.seats[s];
      if (!st.alive[seat]) continue;
      if (findTrident(st, seat) >= 0) continue;
      st.alive[seat] = false;
      for (var i = 0; i < st.N * st.N; i++) {
        if (st.board[i] && owner(st.board[i]) === seat) {
          st.board[i] = mk(NEUTRAL, type(st.board[i]));
        }
        if (st.barrierOwner[i] === seat) st.barrierOwner[i] = NEUTRAL;
      }
      st.barrierLeft[seat] = 0;
    }
  }

  function notate(st, mv) {
    var N = st.N;
    if (mv.kind === 'place') return '+' + sqName(N, mv.to);
    var g = LETTERS[type(st.board[mv.from])];
    if (mv.kind === 'strike') {
      var left = st.barrierHp[mv.to] - 1;
      return g + sqName(N, mv.from) + '!' + sqName(N, mv.to) + (left > 0 ? '(' + left + ')' : 'X');
    }
    if (mv.kind === 'move') return g + sqName(N, mv.from) + '-' + sqName(N, mv.to);
    var kills = mv.res.deaths.length, marks = '';
    while (marks.length < kills) marks += '*';
    var sym = mv.kind === 'push' ? '>' : '<';
    return g + sqName(N, mv.from) + sym + sqName(N, mv.to) + (mv.n > 1 ? ' ' + mv.n : '') + marks;
  }

  function countPieces(st) {
    var c = [0, 0, 0, 0, 0];
    for (var i = 0; i < st.N * st.N; i++) if (st.board[i]) c[owner(st.board[i])]++;
    return c;
  }

  function aliveSeats(st) {
    var a = [];
    for (var s = 0; s < st.seats.length; s++) if (st.alive[st.seats[s]]) a.push(st.seats[s]);
    return a;
  }

  function updateResult(st, mover) {
    var live = aliveSeats(st);

    if (live.length === 0) {
      // everyone knocked out at once - the player who caused it loses
      st.result = { type: 'trident', winner: null, both: true };
      return st.result;
    }
    if (live.length === 1 && st.seats.length > 1) {
      // if the mover eliminated themselves alongside others, they still lose
      st.result = { type: 'trident', winner: live[0] };
      return st.result;
    }

    var key = hashState(st);
    var c = (st.repetition[key] || 0) + 1;
    st.repetition[key] = c;
    if (c >= 3) {
      var n = countPieces(st), best = -1, winner = null, tie = false;
      for (var i = 0; i < live.length; i++) {
        if (n[live[i]] > best) { best = n[live[i]]; winner = live[i]; tie = false; }
        else if (n[live[i]] === best) tie = true;
      }
      st.result = { type: 'repetition', winner: tie ? null : winner, counts: n };
      return st.result;
    }
    if (legalMoves(st, st.toMove).length === 0) {
      // out of options: that seat is out, and the game continues without them
      var stuck = st.toMove;
      if (live.length > 2) {
        st.alive[stuck] = false;
        for (var j = 0; j < st.N * st.N; j++) {
          if (st.board[j] && owner(st.board[j]) === stuck) st.board[j] = mk(NEUTRAL, type(st.board[j]));
        }
        st.toMove = nextSeat(st, stuck);
        return updateResult(st, mover);
      }
      st.result = { type: 'stalemate', winner: live[0] === stuck ? live[1] : live[0], stuck: stuck };
      return st.result;
    }
    return null;
  }

  // Is `side`'s Trident one legal enemy action away from a hole right now?
  function tridentInDanger(st, side) {
    var live = aliveSeats(st);
    for (var s = 0; s < live.length; s++) {
      if (live[s] === side) continue;
      var moves = legalMoves(st, live[s]);
      for (var i = 0; i < moves.length; i++) {
        var res = moves[i].res;
        if (!res) continue;
        for (var j = 0; j < res.deaths.length; j++) {
          var d = res.deaths[j];
          if (type(d.piece) === T.TRIDENT && owner(d.piece) === side) return true;
        }
      }
    }
    return false;
  }

  function findTrident(st, side) {
    for (var i = 0; i < st.N * st.N; i++) {
      var p = st.board[i];
      if (p && type(p) === T.TRIDENT && owner(p) === side) return i;
    }
    return -1;
  }

  // Running out of time forfeits the turn only - the board is untouched and
  // the seat stays in the game. Because only `toMove` changes, two players
  // idling in turn will repeat the position and end the game by repetition.
  function passTurn(st, seat) {
    if (st.result || st.toMove !== seat) return st;
    st.log.push('…');
    st.toMove = nextSeat(st, seat);
    st.ply++;
    updateResult(st, seat);
    return st;
  }

  // Resigning (or dropping out of a four-player game) removes that seat's
  // Trident, which runs the normal elimination path: army goes neutral.
  function resignSeat(st, seat) {
    if (st.result) return st;
    var t = findTrident(st, seat);
    if (t >= 0) st.board[t] = 0;
    st.log.push('=' + SEAT_NAMES[seat].charAt(0));
    eliminate(st);
    if (st.toMove === seat) st.toMove = nextSeat(st, seat);
    updateResult(st, seat);
    return st;
  }

  // Rebuild a received move from its key so we never trust a peer's payload.
  function matchMove(st, key) {
    var moves = legalMoves(st, st.toMove);
    for (var i = 0; i < moves.length; i++) if (moveKey(moves[i]) === key) return moves[i];
    return null;
  }

  /* ---- custom layouts: compact, shareable encoding ---------------------- */

  function encodeLayout(lay) {
    var s = '';
    for (var i = 0; i < ARMY; i++) s += String(lay.back[i] || 0);
    for (var j = 0; j < ARMY; j++) s += String(lay.front[j] || 0);
    return s;
  }
  function decodeLayout(s) {
    if (!s || s.length !== ARMY * 2) return defaultLayout();
    var back = [], front = [], i;
    for (i = 0; i < ARMY; i++) back.push(parseInt(s.charAt(i), 10) || 0);
    for (i = 0; i < ARMY; i++) front.push(parseInt(s.charAt(ARMY + i), 10) || 0);
    return { back: back, front: front };
  }
  function layoutValid(lay) {
    var tridents = 0;
    for (var i = 0; i < ARMY; i++) {
      if (lay.back[i] === T.TRIDENT) tridents++;
      if (lay.front[i] === T.TRIDENT) tridents++;
    }
    return tridents === 1;
  }

  root.UT = root.UT || {};
  root.UT.Rules = {
    T: T, NAMES: NAMES, LETTERS: LETTERS, SPEC: SPEC,
    SOUTH: SOUTH, WEST: WEST, NORTH: NORTH, EAST: EAST, NEUTRAL: NEUTRAL,
    SEAT_NAMES: SEAT_NAMES, BARRIER_HP: BARRIER_HP, ARMY: ARMY, HOME_DEPTH: HOME_DEPTH,
    ORTH: ORTH, DIAG: DIAG, ALL: ALL,
    idx: idx, rowOf: rowOf, colOf: colOf, onBoard: onBoard, sqName: sqName, fileLetter: fileLetter,
    owner: owner, type: type, mk: mk,
    mulberry32: mulberry32, generateVoids: generateVoids, voidOrbits: voidOrbits,
    isConnected: isConnected, coreRadius: coreRadius,
    createState: createState, cloneState: cloneState, hashState: hashState, homeSquare: homeSquare,
    defaultLayout: defaultLayout, encodeLayout: encodeLayout, decodeLayout: decodeLayout,
    layoutValid: layoutValid,
    resolvePush: resolvePush, resolvePull: resolvePull,
    legalMoves: legalMoves, movesFrom: movesFrom, applyMove: applyMove,
    moveKey: moveKey, matchMove: matchMove, notate: notate,
    countPieces: countPieces, updateResult: updateResult, aliveSeats: aliveSeats,
    nextSeat: nextSeat, tridentInDanger: tridentInDanger, findTrident: findTrident,
    resignSeat: resignSeat, passTurn: passTurn,
    BACK_RANK: BACK_RANK, FRONT_RANK: FRONT_RANK
  };
})(typeof window !== 'undefined' ? window : globalThis);
