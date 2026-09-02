/* Undertow - ui.js  (v2)
 * Board rendering, piece glyphs, selection, barriers and animation.
 * Knows nothing about networking; it reports chosen moves through onMove.
 */
(function (root) {
  'use strict';
  var R = root.UT.Rules;

  /* ---- piece glyphs (24x24, stroke-based, inherit currentColor) ---- */
  var G = {};
  G[R.T.SWORD] =
    '<path d="M12 2.5 14.2 6.5 14.2 13.5 9.8 13.5 9.8 6.5Z"/>' +
    '<path d="M6.8 14.6h10.4"/><path d="M12 14.6v6.9"/><path d="M9.6 21.5h4.8"/>';
  G[R.T.SCYTHE] =
    '<path d="M8.4 21.5 14.6 4.6"/>' +
    '<path d="M14.6 4.6C9.2 4.2 4.6 7.1 3.4 12.4"/>' +
    '<path d="M14.6 4.6c-3.8 1.2-6.4 3.6-7.4 7.1"/>';
  G[R.T.BOW] =
    '<path d="M8.2 2.8a11 11 0 0 1 0 18.4"/>' +
    '<path d="M8.2 2.8v18.4"/>' +
    '<path d="M5.6 12h12.8"/><path d="M15.2 8.8 18.4 12l-3.2 3.2"/>';
  G[R.T.ROD] =
    '<path d="M7.2 21.5 13.6 7.4"/>' +
    '<path d="M13.6 7.4a3.9 3.9 0 1 0-4.2-4.1"/>';
  G[R.T.SPEAR] =
    '<path d="M12 21.5V8.6"/>' +
    '<path d="M12 2.2 15.6 9.2H8.4Z"/>' +
    '<path d="M9.4 11.6h5.2"/>';
  G[R.T.TRIDENT] =
    '<path d="M12 21.5V10.4"/>' +
    '<path d="M6 10.4V4.2"/><path d="M18 10.4V4.2"/><path d="M12 10.4V2.4"/>' +
    '<path d="M6 10.4h12"/>';

  function glyph(t) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + G[t] + '</svg>';
  }

  // How many 90-degree turns to put a seat's home side at the bottom.
  var ROT = {};
  ROT[R.SOUTH] = 0; ROT[R.WEST] = 1; ROT[R.NORTH] = 2; ROT[R.EAST] = 3;

  function createBoard(el, opts) {
    opts = opts || {};
    var api = {
      el: el,
      state: null,
      viewSeat: R.SOUTH,
      mySide: null,        // seat the local player controls; null = control all
      locked: false,
      placing: false,      // barrier placement mode
      settings: opts.settings || {},
      onMove: opts.onMove || function () {},
      onPlacingChange: opts.onPlacingChange || function () {},
      colors: opts.colors || null   // per-seat hex, so custom rooms can recolour
    };

    // Pick black or white lettering for whatever colour a seat is wearing.
    function ink(hex) {
      var h = String(hex || '').replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length !== 6) return '#111';
      var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#14100a' : '#fdfbf7';
    }
    function paintSeat(elem, seat) {
      if (!api.colors || !api.colors[seat]) return;
      elem.style.background = api.colors[seat];
      elem.style.color = ink(api.colors[seat]);
    }
    api.ink = ink;

    el.innerHTML = '';
    var sqLayer = document.createElement('div'); sqLayer.className = 'layer squares';
    var pcLayer = document.createElement('div'); pcLayer.className = 'layer pieces';
    el.appendChild(sqLayer); el.appendChild(pcLayer);

    var squares = [], pieceEls = [], sel = -1, targets = {}, choiceEl = null, lastMove = null, N = 0;

    function viewOf(i) {
      var n = api.state.N, r = R.rowOf(n, i), c = R.colOf(n, i), k = ROT[api.viewSeat] || 0;
      for (var t = 0; t < k; t++) { var nr = c, nc = n - 1 - r; r = nr; c = nc; }
      return [n - 1 - r, c];
    }
    function dr(i) { return viewOf(i)[0]; }
    function dc(i) { return viewOf(i)[1]; }

    function buildGrid() {
      var n = api.state.N;
      if (n === N) return;
      N = n;
      sqLayer.innerHTML = '';
      squares = [];
      el.style.setProperty('--n', n);
      for (var i = 0; i < n * n; i++) {
        var s = document.createElement('div');
        s.className = 'sq';
        s.innerHTML = '<span class="hint"></span>';
        s.dataset.sq = i;
        sqLayer.appendChild(s);
        squares.push(s);
      }
    }

    sqLayer.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.sq') : null;
      if (!t) return;
      handleClick(parseInt(t.dataset.sq, 10));
    });

    function myTurn() {
      if (api.locked || !api.state || api.state.result) return false;
      return api.mySide === null || api.mySide === api.state.toMove;
    }

    function handleClick(sq) {
      killChoice();
      if (!myTurn()) return;
      var st = api.state;

      if (targets[sq]) {
        var list = targets[sq];
        if (list.length === 1) commit(list[0]);
        else showChoice(sq, list);
        return;
      }
      if (api.placing) { setPlacing(false); return; }
      var p = st.board[sq];
      if (p && R.owner(p) === st.toMove) {
        if (sel === sq) { clearSel(); return; }
        select(sq);
      } else {
        clearSel();
      }
    }

    function select(sq) {
      api.placing = false; api.onPlacingChange(false);
      sel = sq;
      targets = {};
      var ms = R.movesFrom(api.state, sq);
      for (var i = 0; i < ms.length; i++) (targets[ms[i].to] = targets[ms[i].to] || []).push(ms[i]);
      paint();
    }

    function clearSel() { sel = -1; targets = {}; killChoice(); paint(); }
    function commit(mv) { sel = -1; targets = {}; killChoice(); api.placing = false; api.onPlacingChange(false); api.onMove(mv); }

    // Barrier placement: light up every legal square, commit on click.
    function setPlacing(on) {
      api.placing = !!on;
      sel = -1; targets = {}; killChoice();
      if (on) {
        var ms = R.legalMoves(api.state, api.state.toMove);
        for (var i = 0; i < ms.length; i++) {
          if (ms[i].kind === 'place') (targets[ms[i].to] = targets[ms[i].to] || []).push(ms[i]);
        }
      }
      paint();
      api.onPlacingChange(api.placing);
    }
    api.setPlacing = setPlacing;
    api.canPlace = function () {
      var st = api.state;
      return !!(st && !st.result && st.barrierLeft[st.toMove] && myTurn());
    };

    function showChoice(sq, list) {
      killChoice();
      choiceEl = document.createElement('div');
      choiceEl.className = 'choice';
      var cell = el.clientWidth / api.state.N;
      choiceEl.style.left = (dc(sq) * cell + cell / 2) + 'px';
      choiceEl.style.top = (dr(sq) * cell) + 'px';
      list.forEach(function (mv) {
        var b = document.createElement('button');
        var kills = mv.res && mv.res.deaths.length;
        b.textContent = (mv.kind === 'push' ? 'Push ' : 'Pull ') + mv.n + (kills ? ' ☠' : '');
        b.onclick = function (ev) { ev.stopPropagation(); commit(mv); };
        choiceEl.appendChild(b);
      });
      el.appendChild(choiceEl);
    }
    function killChoice() { if (choiceEl) { choiceEl.remove(); choiceEl = null; } }

    /* ---- painting ---- */
    function paint() {
      var st = api.state, i;
      var showHints = api.settings.hints !== false;
      for (i = 0; i < st.N * st.N; i++) {
        var s = squares[i], cls = 'sq';
        if ((R.rowOf(st.N, i) + R.colOf(st.N, i)) % 2 === 0) cls += ' alt';
        if (st.voids[i]) cls += ' void';
        if (i === sel) cls += ' sel';
        if (lastMove && (i === lastMove[0] || i === lastMove[1])) cls += ' last';
        if (showHints && targets[i]) {
          var kind = targets[i][0].kind, kills = false;
          for (var j = 0; j < targets[i].length; j++) {
            if (targets[i][j].res && targets[i][j].res.deaths.length) kills = true;
          }
          if (kind === 'move') cls += ' mv';
          else if (kind === 'place') cls += ' place';
          else if (kind === 'strike') cls += ' strike';
          else cls += kills ? ' kill' : ' atk';
        }
        s.className = cls;
        var v = viewOf(i);
        s.style.setProperty('--r', v[0]);
        s.style.setProperty('--c', v[1]);
      }
      el.classList.toggle('clickable', myTurn());
    }

    function renderPieces() {
      var st = api.state;
      pcLayer.innerHTML = '';
      pieceEls = new Array(st.N * st.N);
      for (var i = 0; i < st.N * st.N; i++) {
        if (st.barrierHp[i]) { pcLayer.appendChild(barrierEl(i)); continue; }
        var p = st.board[i];
        if (!p) continue;
        var d = document.createElement('div');
        d.className = 'pc s' + R.owner(p);
        var v = viewOf(i);
        d.style.setProperty('--r', v[0]);
        d.style.setProperty('--c', v[1]);
        d.innerHTML = '<span class="pc-in">' + glyph(R.type(p)) + '</span>';
        paintSeat(d.firstChild, R.owner(p));
        var who = R.owner(p) === R.NEUTRAL ? 'Abandoned' : R.SEAT_NAMES[R.owner(p)];
        d.title = who + ' ' + R.NAMES[R.type(p)] + ' on ' + R.sqName(st.N, i);
        pcLayer.appendChild(d);
        pieceEls[i] = d;
      }
      markDanger();
    }

    function barrierEl(i) {
      var st = api.state, o = st.barrierOwner[i], hp = st.barrierHp[i];
      var d = document.createElement('div');
      d.className = 'br s' + (o < 0 ? R.NEUTRAL : o) + ' hp' + hp;
      var v = viewOf(i);
      d.style.setProperty('--r', v[0]);
      d.style.setProperty('--c', v[1]);
      var pips = '';
      for (var k = 0; k < R.BARRIER_HP; k++) pips += '<i' + (k < hp ? '' : ' class="off"') + '></i>';
      d.innerHTML = '<span class="br-in"><span class="pips">' + pips + '</span></span>';
      paintSeat(d.firstChild, o < 0 ? R.NEUTRAL : o);
      d.title = (o < 0 || o === R.NEUTRAL ? 'Abandoned' : R.SEAT_NAMES[o]) +
        ' barrier on ' + R.sqName(st.N, i) + ' — ' + hp + '/' + R.BARRIER_HP + ' health';
      return d;
    }

    function markDanger() {
      var st = api.state;
      if (api.settings.danger === false || st.result) return;
      if (!R.tridentInDanger(st, st.toMove)) return;
      var t = R.findTrident(st, st.toMove);
      if (t >= 0 && pieceEls[t]) pieceEls[t].classList.add('danger');
    }

    /* ---- public ---- */
    api.render = function (st) {
      if (st) api.state = st;
      buildGrid();
      sel = -1; targets = {}; killChoice();
      if (api.placing && !api.canPlace()) api.placing = false;
      renderPieces();
      if (api.placing) { setPlacing(true); return; }   // setPlacing repaints squares
      paint();
    };

    api.setPerspective = function (seat) {
      api.viewSeat = seat === null || seat === undefined ? R.SOUTH : seat;
      api.render();
      api.addCoords();
    };

    api.rotate = function () {
      var order = [R.SOUTH, R.WEST, R.NORTH, R.EAST];
      api.setPerspective(order[(order.indexOf(api.viewSeat) + 1) % 4]);
    };

    api.setLastMove = function (a, b) { lastMove = (a === undefined) ? null : [a, b]; };

    // Animate `mv` on the CURRENT state, then invoke done() so the caller can
    // apply it and re-render. Elements are positioned from the pre-move board.
    api.animate = function (mv, done) {
      var ms = api.settings.animMs;
      if (ms === undefined) ms = 280;
      clearSel();
      el.style.setProperty('--anim', ms + 'ms');

      if (mv.kind === 'place' || mv.kind === 'strike') { finish(); return; }

      var moves = [];
      if (mv.kind === 'move') {
        moves.push({ el: pieceEls[mv.from], to: mv.to, died: false });
      } else {
        for (var i = 0; i < mv.res.moved.length; i++) {
          var m = mv.res.moved[i];
          moves.push({ el: pieceEls[m.from], to: m.to, died: m.died });
        }
        if (mv.kind === 'push') moves.push({ el: pieceEls[mv.from], to: mv.to, died: false });
      }
      if (ms <= 0) { finish(); return; }
      moves.forEach(function (m) {
        if (!m.el) return;
        var v = viewOf(m.to);
        m.el.style.setProperty('--r', v[0]);
        m.el.style.setProperty('--c', v[1]);
        if (m.died) m.el.classList.add('falling');
      });
      setTimeout(finish, ms + 30);

      function finish() {
        api.setLastMove(mv.from < 0 ? mv.to : mv.from, mv.to);
        done();
      }
    };

    api.addCoords = function () {
      var old = el.querySelectorAll('.coord');
      for (var k = 0; k < old.length; k++) old[k].remove();
      if (api.settings.coords === false || !api.state) return;
      var n = api.state.N, cell = 100 / n, i;
      // On a quarter-turned view the axes swap: the bottom edge runs along
      // ranks and the left edge along files, so the labels have to swap too.
      var quarter = ((ROT[api.viewSeat] || 0) % 2) === 1;
      for (i = 0; i < n; i++) {
        // label whichever board square currently sits in that display slot
        var bottom = squareAtView(n - 1, i), left = squareAtView(i, 0);
        if (bottom >= 0) {
          var f = document.createElement('span');
          f.className = 'coord';
          f.textContent = quarter ? String(R.rowOf(n, bottom) + 1) : R.fileLetter(R.colOf(n, bottom));
          f.style.left = (i * cell + cell * 0.66) + '%';
          f.style.bottom = '1px';
          el.appendChild(f);
        }
        if (left >= 0) {
          var rk = document.createElement('span');
          rk.className = 'coord';
          rk.textContent = quarter ? R.fileLetter(R.colOf(n, left)) : String(R.rowOf(n, left) + 1);
          rk.style.top = (i * cell + cell * 0.05) + '%';
          rk.style.left = '2px';
          el.appendChild(rk);
        }
      }
    };

    function squareAtView(vr, vc) {
      var n = api.state.N;
      for (var i = 0; i < n * n; i++) {
        var v = viewOf(i);
        if (v[0] === vr && v[1] === vc) return i;
      }
      return -1;
    }

    return api;
  }

  root.UT.UI = { glyph: glyph, createBoard: createBoard, GLYPHS: G, ROT: ROT };
})(typeof window !== 'undefined' ? window : globalThis);
