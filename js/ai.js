/* Undertow - ai.js
 * A client-side opponent. Pure: it reads a position and returns one of the
 * engine's own move objects. No DOM, no network, no storage.
 *
 * Search is plain minimax with alpha-beta, scored from one seat's point of
 * view, so it works unchanged for two players and for four. With four it is
 * "paranoid": every other seat is assumed to be playing against you. That is
 * pessimistic but never catastrophic, and it avoids the instability of maxn.
 *
 * It runs on the main thread on purpose. Web Workers cannot be created from a
 * file:// page, and this game has to keep working when you double-click
 * index.html, so depth is capped low enough that a turn never stalls the UI.
 */
(function (root) {
  'use strict';
  var R = root.UT.Rules;
  var T = R.T, NEUTRAL = R.NEUTRAL;
  var WIN = 1000000;

  // The ranged pullers are the pieces that actually convert holes into kills.
  var VALUE = {};
  VALUE[T.SWORD] = 100;
  VALUE[T.SCYTHE] = 125;
  VALUE[T.BOW] = 155;
  VALUE[T.ROD] = 165;
  VALUE[T.SPEAR] = 135;
  VALUE[T.TRIDENT] = 0;      // its loss ends the game; terminal scoring covers it

  // Depths are per-ply, not per-round. With four seats a round is four plies,
  // so the same nominal depth costs far more - hence the separate 4P caps and
  // the node ceiling, which keeps the worst case near a third of a second.
  var LEVELS = {
    easy:   { depth: 1, depth4: 1, blunder: 0.35, ms: 60,  label: 'Easy' },
    normal: { depth: 3, depth4: 2, blunder: 0.08, ms: 250, label: 'Normal' },
    hard:   { depth: 5, depth4: 4, blunder: 0.0,  ms: 600, label: 'Hard' }
  };

  /* ---- static evaluation ------------------------------------------------
   * Deliberately cheap: no move generation at leaves, so the search can go a
   * ply or two deeper instead. Standing next to a hole is the proxy for being
   * in danger, which is the whole game in one term.
   */
  function nearVoidCount(st, sq) {
    var N = st.N, r = R.rowOf(N, sq), c = R.colOf(N, sq), n = 0;
    for (var d = 0; d < R.ALL.length; d++) {
      var rr = r + R.ALL[d][0], cc = c + R.ALL[d][1];
      if (R.onBoard(N, rr, cc) && st.voids[R.idx(N, rr, cc)]) n++;
    }
    return n;
  }

  function evaluate(st, me) {
    var N = st.N, n = N * N, i, p, o, t, score = 0;
    var mid = (N - 1) / 2;

    for (i = 0; i < n; i++) {
      p = st.board[i];
      if (!p) continue;
      o = R.owner(p);
      if (o === NEUTRAL) continue;
      t = R.type(p);
      var friendly = (o === me);
      var sign = friendly ? 1 : -1;

      score += sign * VALUE[t];

      // exposure: a piece beside a hole is one shove from dying
      var near = nearVoidCount(st, i);
      if (near) {
        var risk = (t === T.TRIDENT ? 70 : 14) * near;
        score -= sign * risk;
      }

      // creeping toward the middle is where the holes are
      var dist = Math.max(Math.abs(R.rowOf(N, i) - mid), Math.abs(R.colOf(N, i) - mid));
      score += sign * (6 - dist) * 2;
    }

    // an unspent barrier is a tempo weapon still in hand
    for (i = 0; i < 4; i++) {
      if (!st.alive[i]) continue;
      score += (i === me ? 1 : -1) * st.barrierLeft[i] * 40;
    }
    for (i = 0; i < n; i++) {
      if (!st.barrierHp[i]) continue;
      var bo = st.barrierOwner[i];
      if (bo < 0 || bo === NEUTRAL) continue;
      score += (bo === me ? 1 : -1) * st.barrierHp[i] * 12;
    }
    return score;
  }

  function terminal(st, me, depth) {
    var res = st.result;
    if (res.winner === me) return WIN + depth;          // prefer winning sooner
    if (res.winner === null) return 0;
    return -WIN - depth;
  }

  /* ---- move ordering ----------------------------------------------------
   * Alpha-beta lives or dies on this. Kills first, then attacks, then quiet
   * moves toward the centre; barrier placement last because it is the widest
   * category by far (~89 moves early on) and rarely the best try.
   */
  function orderScore(st, mv) {
    var s = 0;
    if (mv.res && mv.res.deaths.length) {
      s += 900 * mv.res.deaths.length;
      for (var i = 0; i < mv.res.deaths.length; i++) {
        var d = mv.res.deaths[i];
        if (R.type(d.piece) === T.TRIDENT) {
          s += (R.owner(d.piece) === st.toMove) ? -100000 : 100000;  // never your own
        }
      }
    }
    if (mv.kind === 'push' || mv.kind === 'pull') s += 60;
    else if (mv.kind === 'strike') s += 30;
    else if (mv.kind === 'place') s -= 200;
    var N = st.N, mid = (N - 1) / 2;
    s -= Math.max(Math.abs(R.rowOf(N, mv.to) - mid), Math.abs(R.colOf(N, mv.to) - mid));
    return s;
  }

  function ordered(st, side) {
    var moves = R.legalMoves(st, side), i;
    for (i = 0; i < moves.length; i++) moves[i]._o = orderScore(st, moves[i]);
    moves.sort(function (a, b) { return b._o - a._o; });
    return moves;
  }

  /* ---- search ---------------------------------------------------------- */

  function search(st, depth, alpha, beta, me, budget) {
    if (st.result) return terminal(st, me, depth);
    if (depth <= 0) return evaluate(st, me);
    // Checking the clock on every node would cost more than it saves.
    if ((budget.nodes & 1023) === 0 && Date.now() > budget.deadline) budget.aborted = true;
    if (budget.aborted) return evaluate(st, me);

    var moves = ordered(st, st.toMove);
    if (!moves.length) return evaluate(st, me);

    var maximizing = (st.toMove === me);
    var best = maximizing ? -Infinity : Infinity;

    for (var i = 0; i < moves.length; i++) {
      var c = R.cloneState(st);
      R.applyMove(c, moves[i]);
      budget.nodes++;
      var sc = search(c, depth - 1, alpha, beta, me, budget);
      if (maximizing) {
        if (sc > best) best = sc;
        if (best > alpha) alpha = best;
      } else {
        if (sc < best) best = sc;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  /* ---- public ----------------------------------------------------------- */

  // Returns one of the move objects produced by the live state, so the caller
  // can apply it directly. `rnd` lets tests make blunders reproducible.
  function chooseMove(st, opts) {
    opts = opts || {};
    var level = LEVELS[opts.level] || LEVELS.normal;
    var fourUp = st.seats.length > 2;
    var depth = opts.depth || (fourUp ? level.depth4 : level.depth);
    var blunder = opts.blunder === undefined ? level.blunder : opts.blunder;
    var rnd = opts.rnd || Math.random;
    var me = st.toMove;

    var moves = ordered(st, me);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    // Iterative deepening. Each pass is cheap relative to the next, and the
    // best move from the previous depth is searched first, which is what makes
    // alpha-beta cut. A pass that runs out of time is discarded entirely -
    // a half-searched depth is worse than a fully searched shallower one.
    var budget = { nodes: 0, aborted: false,
                   deadline: Date.now() + (opts.ms || level.ms) };
    var best = moves[0], bestScore = -Infinity;

    for (var d = 1; d <= depth; d++) {
      var passBest = null, passScore = -Infinity, ties = [], i;
      for (i = 0; i < moves.length; i++) {
        var c = R.cloneState(st);
        R.applyMove(c, moves[i]);
        budget.nodes++;
        var sc = search(c, d - 1, -Infinity, Infinity, me, budget);
        if (budget.aborted) break;
        if (sc > passScore) { passScore = sc; passBest = moves[i]; ties = [moves[i]]; }
        else if (sc === passScore) ties.push(moves[i]);
      }
      if (budget.aborted) break;                 // keep the last complete pass
      if (ties.length > 1) passBest = ties[(rnd() * ties.length) | 0];
      best = passBest; bestScore = passScore;
      // put the current best first so the next, deeper pass prunes harder
      var at = moves.indexOf(best);
      if (at > 0) { moves.splice(at, 1); moves.unshift(best); }
      if (bestScore >= WIN) break;               // found a forced win, stop
    }

    // an occasional honest mistake, but never one that throws the game away
    if (blunder > 0 && rnd() < blunder) {
      var safe = [];
      for (var j = 0; j < moves.length; j++) {
        var m = moves[j];
        var losesTrident = false;
        if (m.res) {
          for (var k = 0; k < m.res.deaths.length; k++) {
            var d = m.res.deaths[k];
            if (R.type(d.piece) === T.TRIDENT && R.owner(d.piece) === me) losesTrident = true;
          }
        }
        if (!losesTrident) safe.push(m);
      }
      if (safe.length) best = safe[(rnd() * safe.length) | 0];
    }
    return best;
  }

  root.UT = root.UT || {};
  root.UT.AI = {
    LEVELS: LEVELS, VALUE: VALUE,
    evaluate: evaluate, chooseMove: chooseMove, ordered: ordered
  };
})(typeof window !== 'undefined' ? window : globalThis);
