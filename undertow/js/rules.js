/* Undertow - rules.js
 * Pure game engine. No DOM. Deterministic.
 * Classic script (not a module) so the site works from file:// with no server.
 */
(function (root) {
  'use strict';

  var N = 7, SIZE = 49;

  var T = { SWORD: 1, SCYTHE: 2, BOW: 3, ROD: 4, SPEAR: 5, TRIDENT: 6 };
  var NAMES = { 1: 'Sword', 2: 'Scythe', 3: 'Bow', 4: 'Rod', 5: 'Spear', 6: 'Trident' };
  // Sword, Scythe and Spear all start with S, so notation uses distinct letters.
  var LETTERS = { 1: 'S', 2: 'C', 3: 'B', 4: 'R', 5: 'P', 6: 'T' };
  var AMBER = 0, VIOLET = 1;
  var SIDE_NAMES = ['Amber', 'Violet'];

  function idx(r, c) { return r * N + c; }
  function rowOf(i) { return (i / N) | 0; }
  function colOf(i) { return i % N; }
  function onBoard(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  function sqName(i) { return 'abcdefg'.charAt(colOf(i)) + (rowOf(i) + 1); }

  var ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ALL = ORTH.concat(DIAG);

  function owner(p) { return p >= 8 ? VIOLET : AMBER; }
  function type(p) { return p & 7; }
  function mk(o, t) { return o === VIOLET ? t + 8 : t; }

  /* ---- piece specification --------------------------------------------
   * move:   dirs + max slide distance (blocked by pieces and voids)
   * attack: 'push' | 'pull' | 'both'
   *   push  scans for the first piece; path must be clear of pieces AND voids
   *   pull  scans for the first piece, skipping empties AND voids
   *   exact: target must sit at exactly this distance (Spear)
   *   n:     displacement options
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
    move: { dirs: DIAG, max: 6 },
    attack: { mode: 'push', dirs: DIAG, range: 6, n: [1] }
  };
  SPEC[T.ROD] = {
    move: { dirs: ORTH, max: 6 },
    attack: { mode: 'pull', dirs: ORTH, range: 6, n: [1] }
  };
  SPEC[T.SPEAR] = {
    move: { dirs: ORTH, max: 2 },
    attack: { mode: 'push', dirs: ORTH, range: 2, exact: 2, n: [2] }
  };
  SPEC[T.TRIDENT] = {
    move: { dirs: ALL, max: 3 },
    attack: { mode: 'both', dirs: ALL, pushRange: 1, pullRange: 3, n: [1, 2] }
  };

  /* ---- deterministic RNG + void generation ---------------------------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var CENTER = idx(3, 3); // d4 - always a void

  function isConnected(voids) {
    var start = -1, total = 0, i;
    for (i = 0; i < SIZE; i++) if (!voids[i]) { total++; if (start < 0) start = i; }
    if (start < 0) return false;
    var seen = new Uint8Array(SIZE), stack = [start], n = 0;
    seen[start] = 1;
    while (stack.length) {
      var s = stack.pop(); n++;
      var r = rowOf(s), c = colOf(s);
      for (var d = 0; d < 4; d++) {
        var rr = r + ORTH[d][0], cc = c + ORTH[d][1];
        if (!onBoard(rr, cc)) continue;
        var j = idx(rr, cc);
        if (voids[j] || seen[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    return n === total;
  }

  // 5 voids in ranks 3-5: d4 always, plus two 180-degree-symmetric pairs.
  function generateVoids(seed) {
    var rnd = mulberry32(seed >>> 0);
    var pairs = [], seen = {}, r, c, i, m;
    for (r = 2; r <= 4; r++) for (c = 0; c < N; c++) {
      i = idx(r, c);
      if (i === CENTER) continue;
      m = idx(6 - rowOf(i), 6 - colOf(i));
      if (seen[i] || seen[m]) continue;
      seen[i] = 1; seen[m] = 1;
      pairs.push([i, m]);
    }
    for (var tries = 0; tries < 500; tries++) {
      var a = (rnd() * pairs.length) | 0, b = (rnd() * pairs.length) | 0;
      if (a === b) continue;
      var voids = new Uint8Array(SIZE);
      voids[CENTER] = 1;
      voids[pairs[a][0]] = 1; voids[pairs[a][1]] = 1;
      voids[pairs[b][0]] = 1; voids[pairs[b][1]] = 1;
      if (isConnected(voids)) return voids;
    }
    var fb = new Uint8Array(SIZE);
    fb[CENTER] = 1; fb[idx(2, 1)] = 1; fb[idx(4, 5)] = 1; fb[idx(2, 5)] = 1; fb[idx(4, 1)] = 1;
    return fb;
  }

  /* ---- state ---------------------------------------------------------- */

  var BACK_RANK = [T.BOW, T.ROD, T.SPEAR, T.TRIDENT, T.SPEAR, T.ROD, T.BOW];
  var FRONT_RANK = [T.SWORD, T.SCYTHE, T.SWORD, T.SCYTHE, T.SWORD, T.SCYTHE, T.SWORD];

  function createState(seed) {
    var st = {
      board: new Int8Array(SIZE),
      voids: generateVoids(seed),
      toMove: AMBER,
      ply: 0,
      seed: seed >>> 0,
      log: [],
      repetition: {},
      result: null
    };
    for (var c = 0; c < N; c++) {
      st.board[idx(0, c)] = mk(AMBER, BACK_RANK[c]);
      st.board[idx(1, c)] = mk(AMBER, FRONT_RANK[c]);
      st.board[idx(5, c)] = mk(VIOLET, FRONT_RANK[c]);
      st.board[idx(6, c)] = mk(VIOLET, BACK_RANK[c]);
    }
    st.repetition[hashState(st)] = 1;
    return st;
  }

  function hashState(st) {
    var s = String(st.toMove);
    for (var i = 0; i < SIZE; i++) s += String.fromCharCode(65 + st.board[i]);
    return s;
  }

  /* ---- push resolution -------------------------------------------------
   * The chain (target + at most one piece behind it) slides n squares away.
   * Each step the front piece advances; entering a void kills it and anyone
   * behind advances into the freed square. A wall stops the whole push.
   * Returns null when nothing can move, which makes the push illegal.
   */
  function resolvePush(st, from, d, n, target) {
    var dr = d[0], dc = d[1];
    function step(sq) {
      var r = rowOf(sq) + dr, c = colOf(sq) + dc;
      return onBoard(r, c) ? idx(r, c) : -1;
    }
    var chain = [], s = target;
    while (s >= 0 && st.board[s]) {
      chain.push(s);
      if (chain.length > 2) return null; // three-deep stack is immovable
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
      if (nxt < 0) break;                       // wall: push stops here
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
    var r = rowOf(target) - d[0], c = colOf(target) - d[1];
    if (!onBoard(r, c)) return null;
    var dest = idx(r, c);
    if (st.board[dest]) return null;
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
    var me = owner(st.board[from]);
    var r0 = rowOf(from), c0 = colOf(from), target = -1, dist = 0;
    for (var k = 1; k <= range; k++) {
      var r = r0 + d[0] * k, c = c0 + d[1] * k;
      if (!onBoard(r, c)) return;
      var sq = idx(r, c);
      if (st.voids[sq]) return;               // voids block push paths
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
      if (seen[kk]) continue;                 // Trident push-1 and push-2 can coincide
      seen[kk] = 1;
      out.push({ from: from, to: target, kind: 'push', dir: d, n: a.n[j], res: res });
    }
  }

  function genPull(st, from, d, range, out) {
    var me = owner(st.board[from]);
    var r0 = rowOf(from), c0 = colOf(from), target = -1;
    for (var k = 1; k <= range; k++) {
      var r = r0 + d[0] * k, c = c0 + d[1] * k;
      if (!onBoard(r, c)) return;
      var sq = idx(r, c);
      if (st.voids[sq]) continue;             // pulls reach across holes
      var q = st.board[sq];
      if (q) {
        if (owner(q) === me) return;
        if (k < 2) return;                    // adjacent: nowhere to drag it
        target = sq; break;
      }
    }
    if (target < 0) return;
    var res = resolvePull(st, from, d, target);
    if (res) out.push({ from: from, to: target, kind: 'pull', dir: d, n: 1, res: res });
  }

  function genFor(st, from, out) {
    var p = st.board[from], s = SPEC[type(p)];
    var r0 = rowOf(from), c0 = colOf(from), i, k;

    for (i = 0; i < s.move.dirs.length; i++) {
      var d = s.move.dirs[i];
      for (k = 1; k <= s.move.max; k++) {
        var r = r0 + d[0] * k, c = c0 + d[1] * k;
        if (!onBoard(r, c)) break;
        var to = idx(r, c);
        if (st.voids[to] || st.board[to]) break;
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

  function legalMoves(st, side) {
    if (side === undefined) side = st.toMove;
    var out = [];
    for (var i = 0; i < SIZE; i++) {
      var p = st.board[i];
      if (!p || owner(p) !== side) continue;
      genFor(st, i, out);
    }
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

  function applyMove(st, mv) {
    var b = st.board, i;
    var note = notate(st, mv);
    if (mv.kind === 'move') {
      b[mv.to] = b[mv.from]; b[mv.from] = 0;
    } else {
      var res = mv.res;
      for (i = 0; i < res.moved.length; i++) b[res.moved[i].from] = 0;
      for (i = 0; i < res.moved.length; i++) {
        if (!res.moved[i].died) b[res.moved[i].to] = res.moved[i].piece;
      }
      if (mv.kind === 'push') { b[mv.to] = b[mv.from]; b[mv.from] = 0; }
    }
    st.log.push(note);
    var mover = st.toMove;
    st.toMove = 1 - st.toMove;
    st.ply++;
    updateResult(st, mover);
    return st;
  }

  function notate(st, mv) {
    var g = LETTERS[type(st.board[mv.from])];
    if (mv.kind === 'move') return g + sqName(mv.from) + '-' + sqName(mv.to);
    var kills = mv.res.deaths.length, marks = '';
    while (marks.length < kills) marks += '*';
    var sym = mv.kind === 'push' ? '>' : '<';
    return g + sqName(mv.from) + sym + sqName(mv.to) + (mv.n > 1 ? ' ' + mv.n : '') + marks;
  }

  function countPieces(st) {
    var c = [0, 0];
    for (var i = 0; i < SIZE; i++) if (st.board[i]) c[owner(st.board[i])]++;
    return c;
  }

  // `mover` is the side that just acted, needed only for the rare case where a
  // chain push drops both Tridents at once: dropping your own is a loss.
  function updateResult(st, mover) {
    var hasT = [false, false], i, p;
    for (i = 0; i < SIZE; i++) {
      p = st.board[i];
      if (p && type(p) === T.TRIDENT) hasT[owner(p)] = true;
    }
    if (!hasT[AMBER] && !hasT[VIOLET]) {
      st.result = { type: 'trident', winner: mover === undefined ? null : 1 - mover, both: true };
      return st.result;
    }
    if (!hasT[AMBER]) { st.result = { type: 'trident', winner: VIOLET }; return st.result; }
    if (!hasT[VIOLET]) { st.result = { type: 'trident', winner: AMBER }; return st.result; }

    var key = hashState(st);
    var c = (st.repetition[key] || 0) + 1;
    st.repetition[key] = c;
    if (c >= 3) {
      var n = countPieces(st);
      var w = n[AMBER] > n[VIOLET] ? AMBER : (n[VIOLET] > n[AMBER] ? VIOLET : null);
      st.result = { type: 'repetition', winner: w, counts: n };
      return st.result;
    }
    if (legalMoves(st, st.toMove).length === 0) {
      st.result = { type: 'stalemate', winner: 1 - st.toMove };
      return st.result;
    }
    return null;
  }

  // Is `side`'s Trident one legal enemy action away from a hole right now?
  function tridentInDanger(st, side) {
    var moves = legalMoves(st, 1 - side);
    for (var i = 0; i < moves.length; i++) {
      var res = moves[i].res;
      if (!res) continue;
      for (var j = 0; j < res.deaths.length; j++) {
        var d = res.deaths[j];
        if (type(d.piece) === T.TRIDENT && owner(d.piece) === side) return true;
      }
    }
    return false;
  }

  function findTrident(st, side) {
    for (var i = 0; i < SIZE; i++) {
      var p = st.board[i];
      if (p && type(p) === T.TRIDENT && owner(p) === side) return i;
    }
    return -1;
  }

  // Rebuild a received move from its key so we never trust a peer's payload.
  function matchMove(st, key) {
    var moves = legalMoves(st, st.toMove);
    for (var i = 0; i < moves.length; i++) if (moveKey(moves[i]) === key) return moves[i];
    return null;
  }

  root.UT = root.UT || {};
  root.UT.Rules = {
    N: N, SIZE: SIZE, T: T, NAMES: NAMES, LETTERS: LETTERS, AMBER: AMBER, VIOLET: VIOLET,
    SIDE_NAMES: SIDE_NAMES, SPEC: SPEC, ORTH: ORTH, DIAG: DIAG, ALL: ALL,
    idx: idx, rowOf: rowOf, colOf: colOf, onBoard: onBoard, sqName: sqName,
    owner: owner, type: type, mk: mk,
    mulberry32: mulberry32, generateVoids: generateVoids, isConnected: isConnected,
    createState: createState, hashState: hashState,
    resolvePush: resolvePush, resolvePull: resolvePull,
    legalMoves: legalMoves, movesFrom: movesFrom, applyMove: applyMove,
    moveKey: moveKey, matchMove: matchMove, notate: notate,
    countPieces: countPieces, updateResult: updateResult,
    tridentInDanger: tridentInDanger, findTrident: findTrident
  };
})(typeof window !== 'undefined' ? window : globalThis);
