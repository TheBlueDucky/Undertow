/* Undertow - ui.js
 * Board rendering, piece glyphs, selection and animation. Knows nothing
 * about networking; it just reports chosen moves through onMove.
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

  /* ---- board controller ---- */
  function createBoard(el, opts) {
    opts = opts || {};
    var api = {
      el: el,
      state: null,
      flipped: false,
      mySide: null,        // side the local player controls; null = control both
      locked: false,
      settings: opts.settings || {},
      onMove: opts.onMove || function () {},
      onSelect: opts.onSelect || function () {}
    };

    var layers = document.createElement('div');
    el.innerHTML = '';
    var sqLayer = document.createElement('div'); sqLayer.className = 'layer squares';
    var pcLayer = document.createElement('div'); pcLayer.className = 'layer pieces';
    el.appendChild(sqLayer); el.appendChild(pcLayer);

    var squares = [], pieceEls = [], sel = -1, targets = {}, choiceEl = null, lastMove = null;

    function dr(i) { return api.flipped ? R.rowOf(i) : 6 - R.rowOf(i); }
    function dc(i) { return api.flipped ? 6 - R.colOf(i) : R.colOf(i); }

    for (var i = 0; i < R.SIZE; i++) {
      var s = document.createElement('div');
      s.className = 'sq';
      s.innerHTML = '<span class="hint"></span>';
      s.dataset.sq = i;
      sqLayer.appendChild(s);
      squares.push(s);
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
        if (list.length === 1) { commit(list[0]); }
        else { showChoice(sq, list); }
        return;
      }
      var p = st.board[sq];
      if (p && R.owner(p) === st.toMove) {
        if (sel === sq) { clearSel(); return; }
        select(sq);
      } else {
        clearSel();
      }
    }

    function select(sq) {
      sel = sq;
      targets = {};
      var ms = R.movesFrom(api.state, sq);
      for (var i = 0; i < ms.length; i++) {
        (targets[ms[i].to] = targets[ms[i].to] || []).push(ms[i]);
      }
      paint();
      api.onSelect(sq, ms);
    }

    function clearSel() { sel = -1; targets = {}; killChoice(); paint(); api.onSelect(-1, []); }

    function commit(mv) { clearSel(); api.onMove(mv); }

    function showChoice(sq, list) {
      killChoice();
      choiceEl = document.createElement('div');
      choiceEl.className = 'choice';
      var cell = el.clientWidth / 7;
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
      for (i = 0; i < R.SIZE; i++) {
        var s = squares[i];
        var cls = 'sq';
        if ((R.rowOf(i) + R.colOf(i)) % 2 === 0) cls += ' alt';
        if (st.voids[i]) cls += ' void';
        if (i === sel) cls += ' sel';
        if (lastMove && (i === lastMove[0] || i === lastMove[1])) cls += ' last';
        if (showHints && targets[i]) {
          var kills = false;
          for (var j = 0; j < targets[i].length; j++) {
            if (targets[i][j].res && targets[i][j].res.deaths.length) kills = true;
          }
          cls += targets[i][0].kind === 'move' ? ' mv' : (kills ? ' kill' : ' atk');
        }
        s.className = cls;
        s.style.setProperty('--r', dr(i));
        s.style.setProperty('--c', dc(i));
      }
      el.classList.toggle('clickable', myTurn());
    }

    function renderPieces() {
      var st = api.state;
      pcLayer.innerHTML = '';
      pieceEls = new Array(R.SIZE);
      for (var i = 0; i < R.SIZE; i++) {
        var p = st.board[i];
        if (!p) continue;
        var d = document.createElement('div');
        d.className = 'pc s' + R.owner(p);
        d.style.setProperty('--r', dr(i));
        d.style.setProperty('--c', dc(i));
        d.innerHTML = '<span class="pc-in">' + glyph(R.type(p)) + '</span>';
        d.title = R.SIDE_NAMES[R.owner(p)] + ' ' + R.NAMES[R.type(p)] + ' on ' + R.sqName(i);
        pcLayer.appendChild(d);
        pieceEls[i] = d;
      }
      markDanger();
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
      sel = -1; targets = {}; killChoice();
      paint();
      renderPieces();
    };

    api.setPerspective = function (side) {
      api.flipped = side === R.VIOLET;
      api.render();
    };

    api.setLastMove = function (a, b) { lastMove = (a === undefined) ? null : [a, b]; };

    // Animate `mv` on the CURRENT state, then invoke done() so the caller can
    // apply it and re-render. Elements are positioned from the pre-move board.
    api.animate = function (mv, done) {
      var ms = api.settings.animMs;
      if (ms === undefined) ms = 280;
      clearSel();
      el.style.setProperty('--anim', ms + 'ms');
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
        m.el.style.setProperty('--r', dr(m.to));
        m.el.style.setProperty('--c', dc(m.to));
        if (m.died) m.el.classList.add('falling');
      });
      setTimeout(finish, ms + 30);

      function finish() {
        api.setLastMove(mv.from, mv.to);
        done();
      }
    };

    api.addCoords = function () {
      var old = el.querySelectorAll('.coord');
      for (var k = 0; k < old.length; k++) old[k].remove();
      if (api.settings.coords === false) return;
      var cell = 100 / 7, i;
      for (i = 0; i < 7; i++) {
        var f = document.createElement('span');
        f.className = 'coord';
        f.textContent = 'abcdefg'.charAt(api.flipped ? 6 - i : i);
        f.style.left = (i * cell + cell * 0.72) + '%';
        f.style.bottom = '2px';
        el.appendChild(f);
        var rk = document.createElement('span');
        rk.className = 'coord';
        rk.textContent = String(api.flipped ? i + 1 : 7 - i);
        rk.style.top = (i * cell + cell * 0.06) + '%';
        rk.style.left = '3px';
        el.appendChild(rk);
      }
    };

    return api;
  }

  root.UT.UI = { glyph: glyph, createBoard: createBoard, GLYPHS: G };
})(typeof window !== 'undefined' ? window : globalThis);
