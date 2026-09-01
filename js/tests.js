/* Undertow - tests.js
 * Runs in node (`node js/tests.js`) and in the browser via tests.html.
 */
(function (root) {
  'use strict';
  var R = root.UT.Rules;

  var pass = 0, fail = 0, lines = [];
  function ok(name, cond, detail) {
    if (cond) { pass++; lines.push('  PASS  ' + name); }
    else { fail++; lines.push('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
  }
  function eq(name, got, want) {
    ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
  }

  function sq(s) { return R.idx(parseInt(s.charAt(1), 10) - 1, 'abcdefg'.indexOf(s.charAt(0))); }

  // Build a bare position: `voidNames` become holes, `pieces` is {square: [side, type]}.
  function pos(voidNames, pieces) {
    var st = {
      board: new Int8Array(R.SIZE), voids: new Uint8Array(R.SIZE),
      toMove: R.AMBER, ply: 0, seed: 0, log: [], repetition: {}, result: null
    };
    (voidNames || []).forEach(function (v) { st.voids[sq(v)] = 1; });
    Object.keys(pieces || {}).forEach(function (k) {
      st.board[sq(k)] = R.mk(pieces[k][0], pieces[k][1]);
    });
    return st;
  }

  // Find the generated move from `fromName` that targets `toName`.
  function find(st, fromName, toName, kind, n) {
    var ms = [], out = [];
    ms = R.movesFrom(st, sq(fromName));
    for (var i = 0; i < ms.length; i++) {
      if (ms[i].to === sq(toName) && (!kind || ms[i].kind === kind) && (n === undefined || ms[i].n === n)) {
        out.push(ms[i]);
      }
    }
    return out[0] || null;
  }

  var T = R.T, A = R.AMBER, V = R.VIOLET;

  /* ---- 1. setup ------------------------------------------------------- */
  lines.push('setup');
  (function () {
    var st = R.createState(20260901);
    var counts = R.countPieces(st);
    eq('28 pieces total', counts[0] + counts[1], 28);
    eq('14 per side', counts[0], 14);
    var nv = 0, bad = 0, i;
    for (i = 0; i < R.SIZE; i++) {
      if (!st.voids[i]) continue;
      nv++;
      var r = R.rowOf(i);
      if (r < 2 || r > 4) bad++;
    }
    eq('5 voids', nv, 5);
    eq('no void outside ranks 3-5', bad, 0);
    ok('d4 is always a void', !!st.voids[sq('d4')]);
    var asym = 0;
    for (i = 0; i < R.SIZE; i++) {
      var m = R.idx(6 - R.rowOf(i), 6 - R.colOf(i));
      if (st.voids[i] !== st.voids[m]) asym++;
    }
    eq('void layout is 180-degree symmetric', asym, 0);
    ok('board stays connected', R.isConnected(st.voids));
    ok('Amber moves first', st.toMove === R.AMBER);
    ok('opening has legal moves', R.legalMoves(st).length > 0);
    // every seed must produce a valid layout
    var badSeeds = 0;
    for (i = 0; i < 400; i++) {
      var v = R.generateVoids(i * 7919 + 13), c = 0, outside = 0;
      for (var j = 0; j < R.SIZE; j++) if (v[j]) { c++; if (R.rowOf(j) < 2 || R.rowOf(j) > 4) outside++; }
      if (c !== 5 || outside || !v[sq('d4')] || !R.isConnected(v)) badSeeds++;
    }
    eq('400 seeds all produce legal layouts', badSeeds, 0);
  })();

  /* ---- 2. push basics ------------------------------------------------- */
  lines.push('push');
  (function () {
    // Sword c4 pushes Violet sword c5 into the hole at c6.
    var st = pos(['c6'], { c4: [A, T.SWORD], c5: [V, T.SWORD] });
    var mv = find(st, 'c4', 'c5', 'push');
    ok('sword can push toward a hole', !!mv);
    eq('one death', mv.res.deaths.length, 1);
    eq('victim falls into the hole', mv.res.deaths[0].to, sq('c6'));
    R.applyMove(st, mv);
    eq('victim removed', st.board[sq('c6')], 0);
    eq('attacker advanced into vacated square', R.type(st.board[sq('c5')]), T.SWORD);
    eq('attacker left its old square', st.board[sq('c4')], 0);
  })();

  (function () {
    // No hole behind: the push still happens and the attacker takes the square.
    var st = pos([], { c4: [A, T.SWORD], c5: [V, T.BOW] });
    var mv = find(st, 'c4', 'c5', 'push');
    ok('push works with no hole behind', !!mv);
    eq('nobody dies', mv.res.deaths.length, 0);
    R.applyMove(st, mv);
    eq('victim displaced one square', R.type(st.board[sq('c6')]), T.BOW);
    eq('attacker took the vacated square', R.type(st.board[sq('c5')]), T.SWORD);
  })();

  (function () {
    // Wall: victim on the back rank with the attacker pushing outward.
    var st = pos([], { c6: [A, T.SWORD], c7: [V, T.BOW] });
    eq('push into a wall is illegal', find(st, 'c6', 'c7', 'push'), null);
  })();

  (function () {
    // Chain of two shifts; chain of three is immovable.
    var st = pos([], { c3: [A, T.SWORD], c4: [V, T.BOW], c5: [V, T.ROD] });
    var mv = find(st, 'c3', 'c4', 'push');
    ok('two-deep chain can be pushed', !!mv);
    R.applyMove(st, mv);
    eq('rear of chain moved up', R.type(st.board[sq('c5')]), T.BOW);
    eq('front of chain moved up', R.type(st.board[sq('c6')]), T.ROD);
    eq('attacker advanced', R.type(st.board[sq('c4')]), T.SWORD);

    var st3 = pos([], { c3: [A, T.SWORD], c4: [V, T.BOW], c5: [V, T.ROD], c6: [V, T.SPEAR] });
    eq('three-deep chain is immovable', find(st3, 'c3', 'c4', 'push'), null);
  })();

  (function () {
    // Chain push where the front piece falls in and the rear follows.
    var st = pos(['c6'], { c3: [A, T.SWORD], c4: [V, T.BOW], c5: [V, T.ROD] });
    var mv = find(st, 'c3', 'c4', 'push');
    eq('front of chain dies in the hole', mv.res.deaths.length, 1);
    eq('the ROD is the one that falls', R.type(mv.res.deaths[0].piece), T.ROD);
    R.applyMove(st, mv);
    eq('hole is still a hole', st.board[sq('c6')], 0);
    eq('survivor advanced into freed square', R.type(st.board[sq('c5')]), T.BOW);
  })();

  (function () {
    // Voids block push paths - the bow cannot shoot across a hole.
    var st = pos(['c5'], { a3: [A, T.BOW], e7: [V, T.BOW] });
    eq('bow push path is blocked by a hole', find(st, 'a3', 'e7', 'push'), null);
    var clear = pos([], { a3: [A, T.BOW], d6: [V, T.BOW] });
    ok('bow reaches along a clear diagonal', !!find(clear, 'a3', 'd6', 'push'));
    // A victim with its back to the wall cannot be pushed at all.
    var walled = pos([], { a3: [A, T.BOW], e7: [V, T.BOW] });
    eq('bow cannot push a victim against the wall', find(walled, 'a3', 'e7', 'push'), null);
  })();

  /* ---- 3. spear ------------------------------------------------------- */
  lines.push('spear');
  (function () {
    var adj = pos([], { c3: [A, T.SPEAR], c4: [V, T.SWORD] });
    eq('spear cannot attack at range 1', find(adj, 'c3', 'c4', 'push'), null);

    var st = pos([], { c3: [A, T.SPEAR], c5: [V, T.SWORD] });
    var mv = find(st, 'c3', 'c5', 'push');
    ok('spear attacks at exactly range 2', !!mv);
    eq('spear pushes two squares', mv.n, 2);
    R.applyMove(st, mv);
    eq('victim pushed two squares', R.type(st.board[sq('c7')]), T.SWORD);
    eq('spear lunged into the victim square', R.type(st.board[sq('c5')]), T.SPEAR);
  })();

  (function () {
    // Hole one square behind: the victim only travels one square, then dies.
    var st = pos(['c6'], { c3: [A, T.SPEAR], c5: [V, T.SWORD] });
    var mv = find(st, 'c3', 'c5', 'push');
    eq('spear kills into a near hole', mv.res.deaths.length, 1);
    eq('victim stopped in the hole', mv.res.deaths[0].to, sq('c6'));
  })();

  (function () {
    // Hole two squares past the chain: only one square of travel is spent
    // reaching it, so just the front piece falls.
    var st = pos(['c7'], { c2: [A, T.SPEAR], c4: [V, T.SWORD], c5: [V, T.BOW] });
    var mv = find(st, 'c2', 'c4', 'push');
    ok('spear can push a two-chain', !!mv);
    eq('only the front of the chain reaches the far hole', mv.res.deaths.length, 1);

    // Hole directly in front of the chain: the front falls, the rear advances
    // into the freed square, and the second step feeds it in too.
    var st2 = pos(['c6'], { c2: [A, T.SPEAR], c4: [V, T.SWORD], c5: [V, T.BOW] });
    var mv2 = find(st2, 'c2', 'c4', 'push');
    eq('spear double-kill into an adjacent hole', mv2.res.deaths.length, 2);
    R.applyMove(st2, mv2);
    eq('hole did not fill up', st2.board[sq('c6')], 0);
    eq('spear lunged to the target square', R.type(st2.board[sq('c4')]), T.SPEAR);
  })();

  /* ---- 4. pull -------------------------------------------------------- */
  lines.push('pull');
  (function () {
    // The Rod's signature: park on a hole's lip, drag the enemy across it.
    var st = pos(['c4'], { c3: [A, T.ROD], c5: [V, T.TRIDENT], a1: [A, T.TRIDENT] });
    var mv = find(st, 'c3', 'c5', 'pull');
    ok('rod pulls across a hole', !!mv);
    eq('victim dies in the hole', mv.res.deaths.length, 1);
    eq('victim lands in the hole', mv.res.deaths[0].to, sq('c4'));
    R.applyMove(st, mv);
    eq('puller did not move', R.type(st.board[sq('c3')]), T.ROD);
    eq('trident is gone', R.findTrident(st, V), -1);
    ok('killing the trident ends the game', st.result && st.result.type === 'trident');
    eq('the puller wins', st.result.winner, A);
  })();

  (function () {
    var st = pos([], { c3: [A, T.ROD], c4: [V, T.SWORD] });
    eq('rod cannot pull an adjacent piece', find(st, 'c3', 'c4', 'pull'), null);
  })();

  (function () {
    var st = pos([], { c3: [A, T.ROD], c6: [V, T.SWORD] });
    var mv = find(st, 'c3', 'c6', 'pull');
    ok('rod pulls at long range', !!mv);
    R.applyMove(st, mv);
    eq('victim dragged one square closer', R.type(st.board[sq('c5')]), T.SWORD);
    eq('puller stayed put', R.type(st.board[sq('c3')]), T.ROD);
  })();

  (function () {
    var st = pos([], { c3: [A, T.ROD], c5: [A, T.SWORD], c6: [V, T.SWORD] });
    eq('own piece blocks the pull scan', find(st, 'c3', 'c6', 'pull'), null);
  })();

  (function () {
    var st = pos([], { c3: [A, T.SCYTHE], e5: [V, T.SWORD] });
    var mv = find(st, 'c3', 'e5', 'pull');
    ok('scythe pulls on the diagonal', !!mv);
    R.applyMove(st, mv);
    eq('victim dragged diagonally', R.type(st.board[sq('d4')]), T.SWORD);
  })();

  /* ---- 5. trident ----------------------------------------------------- */
  lines.push('trident');
  (function () {
    var st = pos([], { d3: [A, T.TRIDENT], d4: [V, T.SWORD] });
    var one = find(st, 'd3', 'd4', 'push', 1);
    var two = find(st, 'd3', 'd4', 'push', 2);
    ok('trident offers a push of 1', !!one);
    ok('trident offers a push of 2', !!two);
    R.applyMove(st, two);
    eq('push of 2 moved the victim two squares', R.type(st.board[sq('d6')]), T.SWORD);
    eq('trident advanced only one square', R.type(st.board[sq('d4')]), T.TRIDENT);
  })();

  (function () {
    var st = pos([], { d3: [A, T.TRIDENT], d6: [V, T.SWORD] });
    ok('trident pulls at range 3', !!find(st, 'd3', 'd6', 'pull'));
    var far = pos([], { d3: [A, T.TRIDENT], d7: [V, T.SWORD] });
    eq('trident cannot pull at range 4', find(far, 'd3', 'd7', 'pull'), null);
  })();

  (function () {
    var st = pos([], { d1: [A, T.TRIDENT] });
    var ms = R.movesFrom(st, sq('d1'));
    var maxDist = 0;
    ms.forEach(function (m) {
      var dr = Math.abs(R.rowOf(m.to) - 0), dc = Math.abs(R.colOf(m.to) - 3);
      maxDist = Math.max(maxDist, Math.max(dr, dc));
    });
    eq('trident moves at most 3', maxDist, 3);
  })();

  /* ---- 6. danger + endings -------------------------------------------- */
  lines.push('endings');
  (function () {
    var st = pos(['c4'], { c3: [V, T.ROD], c5: [A, T.TRIDENT], a1: [V, T.TRIDENT] });
    st.toMove = R.AMBER;
    ok('trident danger is detected', R.tridentInDanger(st, A));
    ok('the safe trident is not flagged', !R.tridentInDanger(st, V));
  })();

  (function () {
    // A spear shoving the enemy Trident into a hole with its OWN Trident
    // stacked behind takes both. Dropping your own Trident loses.
    var st = pos(['c6'], { c2: [A, T.SPEAR], c4: [V, T.TRIDENT], c5: [A, T.TRIDENT] });
    var mv = find(st, 'c2', 'c4', 'push');
    eq('both tridents fall', mv.res.deaths.length, 2);
    R.applyMove(st, mv);
    ok('game ends', st.result && st.result.type === 'trident');
    ok('flagged as a double loss', st.result.both === true);
    eq('the player who caused it loses', st.result.winner, V);
  })();

  (function () {
    // Amber has one piece, walled in by voids and the board edge.
    var st = pos(['a2', 'b2', 'b1'], { a1: [A, T.TRIDENT], g7: [V, T.TRIDENT], g1: [V, T.ROD] });
    st.toMove = R.AMBER;
    eq('no legal moves', R.legalMoves(st, R.AMBER).length, 0);
    R.updateResult(st);
    ok('stalemate ends the game', st.result && st.result.type === 'stalemate');
    eq('the stalemated player loses', st.result.winner, V);
  })();

  (function () {
    // Two rods shuffling back and forth until threefold repetition.
    var st = pos([], { a1: [A, T.TRIDENT], g7: [V, T.TRIDENT], a3: [A, T.ROD], g5: [V, T.ROD], b7: [A, T.BOW] });
    var seq = [['a3', 'a4'], ['g5', 'g4'], ['a4', 'a3'], ['g4', 'g5']];
    for (var rep = 0; rep < 3 && !st.result; rep++) {
      for (var i = 0; i < seq.length && !st.result; i++) {
        var mv = find(st, seq[i][0], seq[i][1], 'move');
        if (!mv) { ok('repetition sequence stayed legal', false, seq[i].join('-')); return; }
        R.applyMove(st, mv);
      }
    }
    ok('threefold repetition ends the game', st.result && st.result.type === 'repetition');
    eq('more pieces wins the repetition', st.result.winner, A);
  })();

  (function () {
    var st = pos([], { a1: [A, T.TRIDENT], g7: [V, T.TRIDENT], a3: [A, T.ROD], g5: [V, T.ROD] });
    var seq = [['a3', 'a4'], ['g5', 'g4'], ['a4', 'a3'], ['g4', 'g5']];
    for (var rep = 0; rep < 3 && !st.result; rep++) {
      for (var i = 0; i < seq.length && !st.result; i++) {
        R.applyMove(st, find(st, seq[i][0], seq[i][1], 'move'));
      }
    }
    eq('equal material repetition is a draw', st.result.winner, null);
  })();

  /* ---- 7. notation ---------------------------------------------------- */
  lines.push('notation');
  (function () {
    var seen = {}, dup = 0;
    for (var t = 1; t <= 6; t++) {
      if (seen[R.LETTERS[t]]) dup++;
      seen[R.LETTERS[t]] = 1;
    }
    eq('all six pieces get a distinct letter', dup, 0);

    var kings = { a1: [A, T.TRIDENT], g7: [V, T.TRIDENT] };
    function withKings(extra) {
      var o = { a1: kings.a1, g7: kings.g7 };
      for (var k in extra) o[k] = extra[k];
      return o;
    }

    var st = pos(['c4'], withKings({ c3: [A, T.ROD], c5: [V, T.SWORD] }));
    R.applyMove(st, find(st, 'c3', 'c5', 'pull'));
    eq('pull that kills', st.log[0], 'Rc3<c5*');

    var st2 = pos([], withKings({ c3: [A, T.SPEAR], c5: [V, T.SWORD] }));
    R.applyMove(st2, find(st2, 'c3', 'c5', 'push'));
    eq('spear push records its distance', st2.log[0], 'Pc3>c5 2');

    var st3 = pos([], withKings({ b2: [A, T.SCYTHE] }));
    R.applyMove(st3, find(st3, 'b2', 'c3', 'move'));
    eq('scythe move is C, not S', st3.log[0], 'Cb2-c3');

    var st4 = pos(['c6'], withKings({ c2: [A, T.SPEAR], c4: [V, T.SWORD], c5: [V, T.BOW] }));
    R.applyMove(st4, find(st4, 'c2', 'c4', 'push'));
    eq('double kill shows two marks', st4.log[0], 'Pc2>c4 2**');
  })();

  /* ---- 8. network validation ------------------------------------------ */
  lines.push('network');
  (function () {
    var st = R.createState(777);
    var mine = R.legalMoves(st)[5];
    var key = R.moveKey(mine);
    var rebuilt = R.matchMove(st, key);
    ok('a legal move key round-trips', !!rebuilt);
    eq('rebuilt move matches', R.moveKey(rebuilt), key);
    eq('a bogus key is rejected', R.matchMove(st, 'push:0:48:9:1,1'), null);
    eq('a move for the wrong side is rejected', R.matchMove(st, 'move:42:35:0:'), null);
  })();

  /* ---- 9. full-game fuzz ---------------------------------------------- */
  lines.push('fuzz');
  (function () {
    var crashes = 0, finished = 0, longest = 0, reasons = {};
    for (var g = 0; g < 60; g++) {
      var rnd = R.mulberry32(g + 1);
      var st = R.createState((rnd() * 4294967296) >>> 0);
      try {
        for (var p = 0; p < 400 && !st.result; p++) {
          var ms = R.legalMoves(st);
          if (!ms.length) { R.updateResult(st); break; }
          R.applyMove(st, ms[(rnd() * ms.length) | 0]);
          // invariant: holes are never occupied
          for (var i = 0; i < R.SIZE; i++) {
            if (st.voids[i] && st.board[i]) throw new Error('piece standing in a hole at ' + R.sqName(i));
          }
        }
        longest = Math.max(longest, st.ply);
        if (st.result) { finished++; reasons[st.result.type] = (reasons[st.result.type] || 0) + 1; }
      } catch (e) { crashes++; lines.push('    crash in game ' + g + ': ' + e.message); }
    }
    eq('60 random games without crashing', crashes, 0);
    ok('most random games reach an ending', finished >= 50, finished + '/60 finished');
    lines.push('    endings seen: ' + JSON.stringify(reasons) + ', longest ' + longest + ' plies');
  })();

  var summary = (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed, ' + fail + ' failed)';
  var report = lines.join('\n') + '\n\n' + summary;

  if (typeof document !== 'undefined') {
    var el = document.getElementById('out');
    if (el) { el.textContent = report; el.className = fail ? 'bad' : 'good'; }
  } else {
    console.log(report);
    if (fail) process.exitCode = 1;
  }
})(typeof window !== 'undefined' ? window : globalThis);
