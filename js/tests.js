/* Undertow - tests.js  (v2)
 * Runs in node (`node run-tests.js`) and in the browser via tests.html.
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

  var T = R.T, S = R.SOUTH, W = R.WEST, No = R.NORTH, E = R.EAST, NEU = R.NEUTRAL;
  var SIZE11 = 11;

  function sq(name, N) {
    N = N || SIZE11;
    var c = 'abcdefghijklmnop'.indexOf(name.charAt(0));
    return R.idx(N, parseInt(name.slice(1), 10) - 1, c);
  }

  // Bare position: voids, pieces {square:[seat,type]}, barriers {square:[owner,hp]}
  function pos(voidNames, pieces, barriers, N) {
    N = N || SIZE11;
    var st = {
      N: N, seats: [S, No],
      board: new Int8Array(N * N), voids: new Uint8Array(N * N),
      barrierHp: new Uint8Array(N * N), barrierOwner: new Int8Array(N * N),
      barrierLeft: [0, 0, 0, 0], alive: [true, false, true, false],
      toMove: S, ply: 0, seed: 0, log: [], repetition: {}, result: null
    };
    for (var i = 0; i < N * N; i++) st.barrierOwner[i] = -1;
    (voidNames || []).forEach(function (v) { st.voids[sq(v, N)] = 1; });
    Object.keys(pieces || {}).forEach(function (k) {
      st.board[sq(k, N)] = R.mk(pieces[k][0], pieces[k][1]);
    });
    Object.keys(barriers || {}).forEach(function (k) {
      st.barrierOwner[sq(k, N)] = barriers[k][0];
      st.barrierHp[sq(k, N)] = barriers[k][1];
    });
    return st;
  }

  function find(st, fromName, toName, kind, n) {
    var ms = R.movesFrom(st, sq(fromName, st.N));
    for (var i = 0; i < ms.length; i++) {
      if (ms[i].to === sq(toName, st.N) && (!kind || ms[i].kind === kind) && (n === undefined || ms[i].n === n)) return ms[i];
    }
    return null;
  }
  function kings(extra, seats) {
    var o = {};
    (seats || [S, No]).forEach(function (seat) {
      o[seat === S ? 'a1' : (seat === No ? 'k11' : (seat === W ? 'a11' : 'k1'))] = [seat, T.TRIDENT];
    });
    for (var k in extra) o[k] = extra[k];
    return o;
  }

  /* ---- 1. board and setup --------------------------------------------- */
  lines.push('setup (11x11)');
  (function () {
    var st = R.createState({ size: 11, seats: 2, seed: 20260902 });
    eq('board is 11x11', st.N, 11);
    var c = R.countPieces(st);
    eq('two armies of 14', c[S] + c[No], 28);
    eq('south has 14', c[S], 14);
    // armies are centred: 7 wide on an 11 board leaves 2 columns of margin
    ok('south back rank starts on c1', R.type(st.board[sq('c1')]) === T.BOW);
    ok('south trident on f1', R.type(st.board[sq('f1')]) === T.TRIDENT);
    ok('corner a1 is empty', st.board[sq('a1')] === 0);
    ok('corner k1 is empty', st.board[sq('k1')] === 0);
    ok('north trident on f11', R.type(st.board[sq('f11')]) === T.TRIDENT);
    eq('north trident belongs to north', R.owner(st.board[sq('f11')]), No);
    ok('south moves first', st.toMove === S);
    ok('opening has legal moves', R.legalMoves(st).length > 0);
    eq('each side holds one barrier', st.barrierLeft[S] + st.barrierLeft[No], 2);
  })();

  (function () {
    var st = R.createState({ size: 11, seats: 4, seed: 7 });
    var c = R.countPieces(st);
    eq('four armies of 14', c[S] + c[W] + c[No] + c[E], 56);
    eq('west has 14', c[W], 14);
    eq('east has 14', c[E], 14);
    ok('west trident on a6', R.type(st.board[sq('a6')]) === T.TRIDENT && R.owner(st.board[sq('a6')]) === W);
    ok('east trident on k6', R.type(st.board[sq('k6')]) === T.TRIDENT && R.owner(st.board[sq('k6')]) === E);
    var corners = ['a1', 'a2', 'b1', 'k1', 'k2', 'j1', 'a11', 'a10', 'b11', 'k11', 'k10', 'j11'];
    var occupied = corners.filter(function (n) { return st.board[sq(n)] !== 0; });
    eq('all four corners stay clear', occupied.length, 0);
    eq('turn order is south, west, north, east', [S, W, No, E].join(), st.seats.join());
    eq('four barriers in play', st.barrierLeft.reduce(function (a, b) { return a + b; }, 0), 4);
  })();

  /* ---- 2. voids -------------------------------------------------------- */
  lines.push('voids');
  (function () {
    var bad = 0, notFour = 0, offCore = 0, disconnected = 0, mid = 5;
    for (var s = 0; s < 400; s++) {
      var v = R.generateVoids(11, 2, s * 7919 + 13), n = 0, i;
      for (i = 0; i < 121; i++) {
        if (!v[i]) continue;
        n++;
        var r = R.rowOf(11, i), c = R.colOf(11, i);
        // core is Chebyshev distance 1..3 from the centre - clear of every home area
        if (Math.max(Math.abs(r - mid), Math.abs(c - mid)) > 3) offCore++;
        if (r === mid && c === mid) offCore++;
        // 90-degree rotation must map a hole onto a hole
        if (!v[R.idx(11, c, 2 * mid - r)]) bad++;
      }
      if (n !== 4) notFour++;
      if (!R.isConnected(11, v, null)) disconnected++;
    }
    eq('always exactly 4 holes', notFour, 0);
    eq('every hole is 90-degree symmetric', bad, 0);
    eq('no hole outside the central core', offCore, 0);
    eq('board never splits', disconnected, 0);
    ok('layouts actually vary', R.voidOrbits(11, 2).length >= 8, R.voidOrbits(11, 2).length + ' orbits');
  })();

  /* ---- 3. push --------------------------------------------------------- */
  lines.push('push');
  (function () {
    var st = pos(['c6'], kings({ c4: [S, T.SWORD], c5: [No, T.SWORD] }));
    var mv = find(st, 'c4', 'c5', 'push');
    ok('sword pushes toward a hole', !!mv);
    eq('one death', mv.res.deaths.length, 1);
    R.applyMove(st, mv);
    eq('victim removed', st.board[sq('c6')], 0);
    eq('attacker advanced', R.type(st.board[sq('c5')]), T.SWORD);
  })();

  (function () {
    var st = pos([], kings({ c4: [S, T.SWORD], c5: [No, T.BOW] }));
    R.applyMove(st, find(st, 'c4', 'c5', 'push'));
    eq('victim displaced with no hole', R.type(st.board[sq('c6')]), T.BOW);
    eq('attacker took the square', R.type(st.board[sq('c5')]), T.SWORD);
  })();

  (function () {
    var st = pos([], kings({ c10: [S, T.SWORD], c11: [No, T.BOW] }));
    eq('push into a wall is illegal', find(st, 'c10', 'c11', 'push'), null);
  })();

  (function () {
    var st = pos([], kings({ c3: [S, T.SWORD], c4: [No, T.BOW], c5: [No, T.ROD] }));
    ok('two-deep chain moves', !!find(st, 'c3', 'c4', 'push'));
    var st3 = pos([], kings({ c3: [S, T.SWORD], c4: [No, T.BOW], c5: [No, T.ROD], c6: [No, T.SPEAR] }));
    eq('three-deep chain is immovable', find(st3, 'c3', 'c4', 'push'), null);
  })();

  (function () {
    var st = pos(['c6'], kings({ c3: [S, T.SWORD], c4: [No, T.BOW], c5: [No, T.ROD] }));
    var mv = find(st, 'c3', 'c4', 'push');
    eq('front of chain falls in', R.type(mv.res.deaths[0].piece), T.ROD);
    R.applyMove(st, mv);
    eq('hole stays a hole', st.board[sq('c6')], 0);
    eq('survivor advanced', R.type(st.board[sq('c5')]), T.BOW);
  })();

  (function () {
    var st = pos(['c5'], kings({ a3: [S, T.BOW], e7: [No, T.BOW] }));
    eq('bow push blocked by a hole', find(st, 'a3', 'e7', 'push'), null);
    var clear = pos([], kings({ a3: [S, T.BOW], e7: [No, T.BOW] }));
    ok('bow reaches far on a clear diagonal', !!find(clear, 'a3', 'e7', 'push'));
  })();

  /* ---- 4. spear -------------------------------------------------------- */
  lines.push('spear');
  (function () {
    eq('spear cannot hit at range 1',
      find(pos([], kings({ c3: [S, T.SPEAR], c4: [No, T.SWORD] })), 'c3', 'c4', 'push'), null);
    var st = pos([], kings({ c3: [S, T.SPEAR], c5: [No, T.SWORD] }));
    var mv = find(st, 'c3', 'c5', 'push');
    eq('spear drives two squares', mv.n, 2);
    R.applyMove(st, mv);
    eq('victim moved two', R.type(st.board[sq('c7')]), T.SWORD);
    eq('spear lunged two', R.type(st.board[sq('c5')]), T.SPEAR);
  })();

  (function () {
    var st = pos(['c6'], kings({ c2: [S, T.SPEAR], c4: [No, T.SWORD], c5: [No, T.BOW] }));
    var mv = find(st, 'c2', 'c4', 'push');
    eq('spear double-kill into an adjacent hole', mv.res.deaths.length, 2);
  })();

  /* ---- 5. pull --------------------------------------------------------- */
  lines.push('pull');
  (function () {
    var st = pos(['c4'], kings({ c3: [S, T.ROD], c5: [No, T.SWORD] }));
    var mv = find(st, 'c3', 'c5', 'pull');
    ok('rod pulls across a hole', !!mv);
    R.applyMove(st, mv);
    eq('puller stayed put', R.type(st.board[sq('c3')]), T.ROD);
    eq('victim died in the hole', st.board[sq('c4')], 0);
  })();

  (function () {
    eq('rod cannot pull an adjacent piece',
      find(pos([], kings({ c3: [S, T.ROD], c4: [No, T.SWORD] })), 'c3', 'c4', 'pull'), null);
    var st = pos([], kings({ c3: [S, T.ROD], c8: [No, T.SWORD] }));
    ok('rod pulls at long range on 11x11', !!find(st, 'c3', 'c8', 'pull'));
    R.applyMove(st, find(st, 'c3', 'c8', 'pull'));
    eq('victim dragged one closer', R.type(st.board[sq('c7')]), T.SWORD);
  })();

  (function () {
    var st = pos([], kings({ c3: [S, T.SCYTHE], e5: [No, T.SWORD] }));
    R.applyMove(st, find(st, 'c3', 'e5', 'pull'));
    eq('scythe drags diagonally', R.type(st.board[sq('d4')]), T.SWORD);
  })();

  /* ---- 6. barriers ----------------------------------------------------- */
  lines.push('barriers');
  (function () {
    var st = pos([], kings({ c3: [S, T.SWORD] }));
    st.barrierLeft[S] = 1;
    var places = R.legalMoves(st, S).filter(function (m) { return m.kind === 'place'; });
    ok('placement is offered on empty squares', places.length > 0);
    var onPiece = places.filter(function (m) { return st.board[m.to] !== 0; });
    eq('never offered on an occupied square', onPiece.length, 0);

    var mv = places.filter(function (m) { return m.to === sq('f5'); })[0];
    ok('can place on f5', !!mv);
    R.applyMove(st, mv);
    eq('barrier has full health', st.barrierHp[sq('f5')], R.BARRIER_HP);
    eq('barrier belongs to south', st.barrierOwner[sq('f5')], S);
    eq('placement used up the allowance', st.barrierLeft[S], 0);
    eq('placement consumed the turn', st.toMove, No);
    eq('placement notation', st.log[0], '+f5');
    eq('no second barrier', R.legalMoves(st, S).filter(function (m) { return m.kind === 'place'; }).length, 0);
  })();

  (function () {
    // A barrier is a wall: it stops movement, pushes and pull scans alike.
    var b = { f5: [No, 3] };
    var st = pos([], kings({ f3: [S, T.ROD] }), b);
    var moves = R.movesFrom(st, sq('f3')).filter(function (m) { return m.kind === 'move'; });
    var past = moves.filter(function (m) { return R.rowOf(11, m.to) >= 4 && R.colOf(11, m.to) === 5; });
    eq('cannot move onto or past a barrier', past.length, 0);

    var st2 = pos([], kings({ f4: [S, T.SWORD] }), b);
    eq('cannot push a barrier like a piece', find(st2, 'f4', 'f5', 'push'), null);

    var st3 = pos([], kings({ f3: [S, T.ROD], f7: [No, T.SWORD] }), b);
    eq('pull scan does not reach past a barrier', find(st3, 'f3', 'f7', 'pull'), null);
  })();

  (function () {
    // Striking it: three hits from anyone but its owner and it is gone.
    var st = pos([], kings({ f4: [S, T.SWORD], f8: [No, T.SWORD] }), { f5: [No, 3] });
    var mv = find(st, 'f4', 'f5', 'strike');
    ok('adjacent sword can strike a barrier', !!mv);
    eq('strike notation shows health left', R.notate(st, mv), 'Sf4!f5(2)');
    R.applyMove(st, mv);
    eq('health dropped by one', st.barrierHp[sq('f5')], 2);
    eq('strike consumed the turn', st.toMove, No);
    eq('attacker did not move', R.type(st.board[sq('f4')]), T.SWORD);

    st.toMove = S;
    R.applyMove(st, find(st, 'f4', 'f5', 'strike'));
    st.toMove = S;
    var last = find(st, 'f4', 'f5', 'strike');
    eq('final strike is marked X', R.notate(st, last), 'Sf4!f5X');
    R.applyMove(st, last);
    eq('barrier destroyed', st.barrierHp[sq('f5')], 0);
    eq('ownership cleared', st.barrierOwner[sq('f5')], -1);
    st.toMove = S;
    ok('the lane reopens once it is gone', !!find(st, 'f4', 'f5', 'move'));
  })();

  (function () {
    var st = pos([], kings({ f4: [S, T.SWORD] }), { f5: [S, 3] });
    eq('you cannot strike your own barrier', find(st, 'f4', 'f5', 'strike'), null);
  })();

  (function () {
    // Ranged pieces strike at their own attack geometry.
    var bow = pos([], kings({ c3: [S, T.BOW] }), { f6: [No, 3] });
    ok('bow strikes down a diagonal', !!find(bow, 'c3', 'f6', 'strike'));
    var rod = pos([], kings({ f3: [S, T.ROD] }), { f7: [No, 3] });
    ok('rod strikes at range', !!find(rod, 'f3', 'f7', 'strike'));
    var rodAdj = pos([], kings({ f6: [S, T.ROD] }), { f7: [No, 3] });
    eq('rod cannot strike an adjacent barrier', find(rodAdj, 'f6', 'f7', 'strike'), null);
    var spearNear = pos([], kings({ f4: [S, T.SPEAR] }), { f5: [No, 3] });
    eq('spear cannot strike at range 1', find(spearNear, 'f4', 'f5', 'strike'), null);
    var spearFar = pos([], kings({ f3: [S, T.SPEAR] }), { f5: [No, 3] });
    ok('spear strikes at exactly range 2', !!find(spearFar, 'f3', 'f5', 'strike'));
  })();

  /* ---- 7. endings and elimination -------------------------------------- */
  lines.push('endings');
  (function () {
    var st = pos(['c4'], { c3: [S, T.ROD], c5: [No, T.TRIDENT], a1: [S, T.TRIDENT] });
    R.applyMove(st, find(st, 'c3', 'c5', 'pull'));
    ok('killing the last trident ends it', st.result && st.result.type === 'trident');
    eq('the puller wins', st.result.winner, S);
  })();

  (function () {
    var st = pos(['c4'], { c3: [S, T.ROD], c5: [No, T.TRIDENT], a1: [S, T.TRIDENT], f6: [No, T.BOW] });
    st.seats = [S, W, No, E];
    st.alive = [true, false, true, false];
    R.applyMove(st, find(st, 'c3', 'c5', 'pull'));
    eq('dead army turns neutral', R.owner(st.board[sq('f6')]), NEU);
    ok('neutral piece is still on the board', R.type(st.board[sq('f6')]) === T.BOW);
  })();

  (function () {
    // Four seats: knocking one out leaves three playing, and the turn skips them.
    var st = R.createState({ size: 11, seats: 4, seed: 99 });
    st.board[R.findTrident(st, W)] = 0;
    st.alive[W] = true;
    var mv = R.legalMoves(st, S)[0];
    R.applyMove(st, mv);
    eq('west is eliminated', st.alive[W], false);
    eq('turn skipped west to north', st.toMove, No);
    var c = R.countPieces(st);
    ok('west army became neutral', c[NEU] === 13, 'neutral count ' + c[NEU]);
    ok('game continues with three players', !st.result);
    eq('three seats still alive', R.aliveSeats(st).length, 3);
  })();

  (function () {
    var st = R.createState({ size: 11, seats: 4, seed: 5 });
    [W, No, E].forEach(function (seat) { st.board[R.findTrident(st, seat)] = 0; });
    R.applyMove(st, R.legalMoves(st, S)[0]);
    ok('last seat standing wins', st.result && st.result.type === 'trident');
    eq('south wins by survival', st.result.winner, S);
    eq('three armies went neutral', R.countPieces(st)[NEU], 39);
  })();

  (function () {
    var st = pos([], { a1: [S, T.TRIDENT], k11: [No, T.TRIDENT], c3: [S, T.ROD], i9: [No, T.ROD] });
    var seq = [['c3', 'c4'], ['i9', 'i8'], ['c4', 'c3'], ['i8', 'i9']];
    for (var rep = 0; rep < 3 && !st.result; rep++) {
      for (var i = 0; i < seq.length && !st.result; i++) {
        R.applyMove(st, find(st, seq[i][0], seq[i][1], 'move'));
      }
    }
    ok('threefold repetition ends it', st.result && st.result.type === 'repetition');
    eq('equal material is a draw', st.result.winner, null);
  })();

  /* ---- 7b. running out of time ----------------------------------------- */
  lines.push('turn timeout');
  (function () {
    var st = pos([], kings({ c4: [S, T.SWORD], c9: [No, T.SWORD] }));
    var before = st.board.slice();
    R.passTurn(st, S);
    eq('turn passes to the opponent', st.toMove, No);
    eq('the board is untouched', String(st.board), String(before));
    eq('ply advances', st.ply, 1);
    eq('timeout is logged', st.log[0], '…');
    ok('the player stays in the game', st.alive[S]);

    // a pass out of turn must do nothing
    var st2 = pos([], kings({ c4: [S, T.SWORD] }));
    R.passTurn(st2, No);
    eq('cannot pass for someone else', st2.toMove, S);
    eq('nothing logged', st2.log.length, 0);
  })();

  (function () {
    // four seats: a timeout skips exactly one player
    var st = R.createState({ size: 11, seats: 4, seed: 21 });
    R.passTurn(st, S);
    eq('south times out, west is up', st.toMove, W);
    R.passTurn(st, W);
    eq('west times out, north is up', st.toMove, No);
    eq('nobody was eliminated', R.aliveSeats(st).length, 4);
  })();

  (function () {
    // both sides idling repeats the position and ends the game
    var st = pos([], { a1: [S, T.TRIDENT], k11: [No, T.TRIDENT] });
    for (var i = 0; i < 12 && !st.result; i++) R.passTurn(st, st.toMove);
    ok('endless timeouts end the game', !!st.result);
    eq('by repetition', st.result.type, 'repetition');
  })();

  /* ---- 8. notation ----------------------------------------------------- */
  lines.push('notation');
  (function () {
    var seen = {}, dup = 0;
    for (var t = 1; t <= 6; t++) { if (seen[R.LETTERS[t]]) dup++; seen[R.LETTERS[t]] = 1; }
    eq('all six letters distinct', dup, 0);

    var st = pos(['c4'], kings({ c3: [S, T.ROD], c5: [No, T.SWORD] }));
    R.applyMove(st, find(st, 'c3', 'c5', 'pull'));
    eq('pull that kills', st.log[0], 'Rc3<c5*');

    var st2 = pos([], kings({ c3: [S, T.SPEAR], c5: [No, T.SWORD] }));
    R.applyMove(st2, find(st2, 'c3', 'c5', 'push'));
    eq('spear records its distance', st2.log[0], 'Pc3>c5 2');

    var st3 = pos([], kings({ b2: [S, T.SCYTHE] }));
    R.applyMove(st3, find(st3, 'b2', 'c3', 'move'));
    eq('scythe is C not S', st3.log[0], 'Cb2-c3');

    var st4 = pos([], kings({ f10: [S, T.ROD] }));
    R.applyMove(st4, find(st4, 'f10', 'f11', 'move'));
    eq('two-digit ranks read correctly', st4.log[0], 'Rf10-f11');
  })();

  /* ---- 9. custom layouts ----------------------------------------------- */
  lines.push('custom layouts');
  (function () {
    var lay = R.defaultLayout();
    eq('layout round-trips', R.encodeLayout(R.decodeLayout(R.encodeLayout(lay))), R.encodeLayout(lay));
    ok('default layout is valid', R.layoutValid(lay));
    ok('no trident is invalid', !R.layoutValid({ back: [1, 1, 1, 1, 1, 1, 1], front: [1, 1, 1, 1, 1, 1, 1] }));
    ok('two tridents is invalid', !R.layoutValid({ back: [6, 6, 1, 1, 1, 1, 1], front: [1, 1, 1, 1, 1, 1, 1] }));

    var custom = { back: [4, 4, 4, 6, 4, 4, 4], front: [5, 5, 5, 5, 5, 5, 5] };
    var lays = {}; lays[S] = custom;
    var st = R.createState({ size: 11, seats: 2, seed: 3, layouts: lays });
    eq('custom back rank applied', R.type(st.board[sq('c1')]), T.ROD);
    eq('custom front rank applied', R.type(st.board[sq('c2')]), T.SPEAR);
    eq('custom trident placed', R.type(st.board[sq('f1')]), T.TRIDENT);
    eq('opponent keeps the default', R.type(st.board[sq('c11')]), T.BOW);
  })();

  /* ---- 10. network validation ------------------------------------------ */
  lines.push('network');
  (function () {
    var st = R.createState({ size: 11, seats: 2, seed: 777 });
    var mine = R.legalMoves(st)[5], key = R.moveKey(mine);
    ok('a legal move key round-trips', !!R.matchMove(st, key));
    eq('bogus key rejected', R.matchMove(st, 'push:0:120:9:1,1'), null);
    eq('wrong-side move rejected', R.matchMove(st, 'move:115:104:0:'), null);
    var place = R.legalMoves(st).filter(function (m) { return m.kind === 'place'; })[0];
    ok('placement keys round-trip', !!R.matchMove(st, R.moveKey(place)));

    // Every action kind has to survive the wire, since a peer only ever sends
    // a key and the receiver regenerates the move from its own engine.
    var kinds = { move: null, push: null, pull: null, place: null, strike: null };
    var arena = pos([], kings({
      c4: [S, T.SWORD], c5: [No, T.BOW],        // push
      f4: [S, T.ROD], f8: [No, T.SWORD],        // pull
      h4: [S, T.SWORD]                          // strike, against the barrier below
    }), { h5: [No, 3] });
    arena.barrierLeft[S] = 1;
    R.legalMoves(arena, S).forEach(function (m) { if (kinds[m.kind] === null) kinds[m.kind] = m; });
    Object.keys(kinds).forEach(function (k) {
      ok(k + ' key round-trips over the wire',
        !!kinds[k] && !!R.matchMove(arena, R.moveKey(kinds[k])),
        kinds[k] ? 'generated but not matched' : 'no ' + k + ' generated');
    });
  })();

  /* ---- 11. full-game fuzz ---------------------------------------------- */
  lines.push('fuzz');
  // Two models. Pure random is a crash test - on an 11x11 board it wanders and
  // often hits the cap, so it asserts invariants only. The kill-biased player
  // takes an offered kill most of the time, which is what a person does, and
  // that model has to actually finish games.
  function fuzz(seats, games, label, cap, killBias, expectEndings) {
    var crashes = 0, finished = 0, reasons = {}, longest = 0, barriersPlaced = 0, strikes = 0;
    for (var g = 0; g < games; g++) {
      var rnd = R.mulberry32(g * 31 + seats);
      var st = R.createState({ size: 11, seats: seats, seed: (rnd() * 4294967296) >>> 0 });
      try {
        for (var p = 0; p < cap && !st.result; p++) {
          var ms = R.legalMoves(st);
          if (!ms.length) { R.updateResult(st, st.toMove); break; }
          var mv, kl = [];
          if (killBias) {
            for (var q = 0; q < ms.length; q++) if (ms[q].res && ms[q].res.deaths.length) kl.push(ms[q]);
          }
          if (kl.length && rnd() < killBias) mv = kl[(rnd() * kl.length) | 0];
          else mv = ms[(rnd() * ms.length) | 0];
          if (mv.kind === 'place') barriersPlaced++;
          if (mv.kind === 'strike') strikes++;
          R.applyMove(st, mv);
          for (var i = 0; i < st.N * st.N; i++) {
            if (st.voids[i] && st.board[i]) throw new Error('piece standing in a hole at ' + R.sqName(11, i));
            if (st.voids[i] && st.barrierHp[i]) throw new Error('barrier built in a hole at ' + R.sqName(11, i));
            if (st.barrierHp[i] && st.board[i]) throw new Error('piece and barrier share ' + R.sqName(11, i));
          }
          if (st.alive[st.toMove] === false && !st.result) throw new Error('turn handed to a dead seat');
        }
        longest = Math.max(longest, st.ply);
        if (st.result) { finished++; reasons[st.result.type] = (reasons[st.result.type] || 0) + 1; }
      } catch (e) { crashes++; lines.push('    crash in ' + label + ' game ' + g + ': ' + e.message); }
    }
    eq(games + ' ' + label + ' games without crashing', crashes, 0);
    if (expectEndings) {
      ok(label + ' games reach an ending', finished >= games * 0.9, finished + '/' + games);
    }
    ok(label + ' games exercise barriers', barriersPlaced > 0 && strikes > 0,
      barriersPlaced + ' placed, ' + strikes + ' strikes');
    lines.push('    ' + label + ': ' + finished + '/' + games + ' finished ' + JSON.stringify(reasons) +
      ', longest ' + longest + ' plies, ' + barriersPlaced + ' barriers, ' + strikes + ' strikes');
  }
  fuzz(2, 30, 'random two-player', 500, 0, false);
  fuzz(4, 30, 'random four-player', 500, 0, false);
  fuzz(2, 30, 'kill-seeking two-player', 1500, 0.85, true);
  fuzz(4, 30, 'kill-seeking four-player', 1500, 0.85, true);

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
