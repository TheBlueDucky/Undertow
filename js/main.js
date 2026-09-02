/* Undertow - main.js  (v2)
 * Routing, settings, sound, the three arenas, and the glue between the
 * engine, the board and the peers.
 */
(function (root) {
  'use strict';
  var R = root.UT.Rules, UI = root.UT.UI, Net = root.UT.Net;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ================= settings ================= */
  var THEMES = [
    { id: 'abyss', name: 'Abyss', cols: ['#1f2a33', '#e8913a', '#8b6fd4', '#05080b'] },
    { id: 'dusk', name: 'Dusk', cols: ['#31241d', '#f0a95c', '#7fb3c8', '#0a0605'] },
    { id: 'parchment', name: 'Parchment', cols: ['#dbc8a4', '#c2652a', '#6a4b9c', '#3b3226'] },
    { id: 'neon', name: 'Neon', cols: ['#101024', '#ffb02e', '#b14aff', '#000000'] },
    { id: 'moss', name: 'Moss', cols: ['#1d2f24', '#e0a13c', '#9d7fd6', '#050a07'] }
  ];
  var DEFAULT_COLORS = ['#e8913a', '#3fbf9f', '#8b6fd4', '#e8556a', '#6b7785'];
  var DEFAULTS = { theme: 'abyss', animMs: 280, hints: true, danger: true, coords: true, sound: true };
  var settings = load();

  function load() {
    var s = {}, k;
    for (k in DEFAULTS) s[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem('undertow.settings');
      if (raw) { var o = JSON.parse(raw); for (k in DEFAULTS) if (o[k] !== undefined) s[k] = o[k]; }
    } catch (e) {}
    return s;
  }
  function save() { try { localStorage.setItem('undertow.settings', JSON.stringify(settings)); } catch (e) {} }
  function applyTheme() { document.documentElement.setAttribute('data-theme', settings.theme); }

  /* ================= sound ================= */
  var actx = null;
  function tone(a, b, dur, type, vol) {
    if (!settings.sound) return;
    try {
      if (!actx) actx = new (root.AudioContext || root.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type || 'sine';
      o.frequency.setValueAtTime(a, t);
      if (b) o.frequency.exponentialRampToValueAtTime(b, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.09, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  var Sound = {
    move: function () { tone(420, 300, 0.08, 'triangle', 0.05); },
    push: function () { tone(200, 130, 0.14, 'square', 0.05); },
    fall: function () { tone(340, 42, 0.62, 'sawtooth', 0.08); },
    place: function () { tone(150, 220, 0.16, 'square', 0.06); },
    strike: function () { tone(660, 240, 0.13, 'square', 0.06); },
    win: function () { tone(392, 0, 0.18, 'sine', 0.09); setTimeout(function () { tone(587, 0, 0.4, 'sine', 0.09); }, 150); },
    lose: function () { tone(240, 90, 0.7, 'sine', 0.09); }
  };

  /* ================= router ================= */
  var PAGES = ['home', 'play', 'rules', 'howto', 'settings', 'about'];
  function route() {
    var id = (location.hash || '#/home').replace('#/', '');
    if (PAGES.indexOf(id) < 0) id = 'home';
    $$('.page').forEach(function (p) { p.classList.toggle('on', p.id === 'page-' + id); });
    $$('nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#/' + id); });
    document.title = id === 'home' ? 'Undertow' : 'Undertow — ' + $('#page-' + id).dataset.title;
    if (id === 'play') setTimeout(fitBoard, 0);
    root.scrollTo(0, 0);
  }

  /* ================= game state ================= */
  var board = null, state = null, session = null;
  var mode = 'none';        // 'quick2' | 'quick4' | 'custom' | 'local'
  var mySeat = null, isHost = false, busy = false, seatOf = null, gameOpts = null;
  var colors = DEFAULT_COLORS.slice();
  var customLayout = R.defaultLayout(), customColors = DEFAULT_COLORS.slice();

  function seatsFor(m) { return m === 'quick4' ? 4 : 2; }

  function newGame(opts, seat) {
    gameOpts = opts;
    state = R.createState(opts);
    mySeat = seat;
    board.mySide = seat;
    board.colors = colors;
    board.locked = false;
    board.setLastMove();
    board.render(state);                 // hand the board its state before anything reads it
    board.setPerspective(seat === null ? R.SOUTH : seat);
    clearOverlay();
    updatePanel();
    fitBoard();
  }

  // Everyone runs the engine. The host is the only one that decides.
  function requestMove(mv) {
    if (busy || !state || state.result) return;
    if (mode === 'local' || isHost) { commitMove(mv); return; }
    session.send({ t: 'intent', key: R.moveKey(mv) });
    busy = true;                       // wait for the host to confirm
    setTimeout(function () { busy = false; }, 4000);
  }

  function commitMove(mv) {
    if (!state || state.result) return;
    if (mode !== 'local' && isHost) {
      session.broadcast({ t: 'move', key: R.moveKey(mv), ply: state.ply });
    }
    applyLocally(mv);
  }

  function applyLocally(mv) {
    busy = true;
    var kills = mv.res ? mv.res.deaths.length : 0;
    if (mv.kind === 'place') Sound.place();
    else if (mv.kind === 'strike') Sound.strike();
    else if (mv.kind === 'move') Sound.move();
    else Sound.push();
    if (kills) setTimeout(Sound.fall, 90);

    board.animate(mv, function () {
      R.applyMove(state, mv);
      board.render(state);
      updatePanel();
      busy = false;
      if (state.result) endGame(state.result);
    });
  }

  function endGame(res) {
    board.locked = true;
    var title, sub;
    var name = function (s) { return s === null || s === undefined ? '—' : R.SEAT_NAMES[s]; };
    // seat count comes from the position, not the mode string (hot-seat 4P is 'local')
    var nSeats = state ? state.seats.length : 2;
    if (res.type === 'trident') {
      title = res.winner === null ? 'Everyone fell' : name(res.winner) + ' wins';
      sub = res.both ? 'Every Trident went into the void.'
        : (nSeats === 4 ? 'Last Trident standing.' : 'The losing Trident went into the void.');
    } else if (res.type === 'repetition') {
      title = res.winner === null ? 'Draw' : name(res.winner) + ' wins';
      sub = 'Threefold repetition — decided on pieces remaining.';
    } else if (res.type === 'resign') {
      title = name(res.winner) + ' wins';
      sub = 'By resignation.';
    } else {
      title = name(res.winner) + ' wins';
      sub = name(res.stuck) + ' has no legal moves left.';
    }
    if (mySeat === null || res.winner === mySeat) Sound.win(); else Sound.lose();
    showOverlay(title, sub, true);
  }

  function showOverlay(title, sub, offerRematch) {
    clearOverlay();
    var o = document.createElement('div');
    o.className = 'overlay';
    var btns = offerRematch
      ? '<div class="btn-row" style="justify-content:center;margin-top:1rem">' +
        (mode === 'local' || isHost ? '<button class="primary" id="rematch">Rematch</button>' : '') +
        '<button id="toLobby">Leave</button></div>'
      : '';
    o.innerHTML = '<div class="box"><h2>' + esc(title) + '</h2><p class="note">' + esc(sub) + '</p>' + btns + '</div>';
    $('#board').appendChild(o);
    if ($('#rematch')) $('#rematch').onclick = doRematch;
    if ($('#toLobby')) $('#toLobby').onclick = leaveGame;
  }
  function clearOverlay() { var o = $('#board .overlay'); if (o) o.remove(); }

  function doRematch() {
    var opts = { size: 11, seats: state ? state.seats.length : seatsFor(mode),
                 seed: Net.randomSeed(), layouts: gameOpts.layouts };
    if (mode === 'local') { newGame(opts, null); return; }
    session.broadcast({ t: 'rematch', seed: opts.seed });
    newGame(opts, mySeat);
  }

  function leaveGame() {
    if (session) { session.close(); session = null; }
    mode = 'none'; state = null; seatOf = null;
    showLobby('choose');
  }

  /* ================= panel ================= */
  function updatePanel() {
    if (!state) return;
    var n = R.countPieces(state);
    var who = R.SEAT_NAMES[state.toMove];
    var yours = (mySeat !== null && state.toMove === mySeat);
    var label = state.result ? 'Game over'
      : (mode === 'local' ? who + ' to move' : (yours ? 'Your move' : 'Waiting for ' + who));
    var danger = !state.result && settings.danger && R.tridentInDanger(state, state.toMove);
    $('#turn').innerHTML =
      '<span class="chip" style="background:' + colors[state.toMove] + '"></span>' +
      '<span>' + esc(label) + '<small>' +
      (state.result ? 'Move ' + state.ply
        : (danger ? '<span class="warn">Trident can be taken this turn</span>' : who + ' · move ' + (state.ply + 1))) +
      '</small></span>';

    var html = '';
    for (var s = 0; s < state.seats.length; s++) {
      var seat = state.seats[s], dead = !state.alive[seat];
      html += '<div' + (dead ? ' class="out"' : '') + '><b style="color:' + colors[seat] + '">' + n[seat] +
        '</b><span>' + R.SEAT_NAMES[seat] + (dead ? ' · out' : '') + '</span></div>';
    }
    if (n[R.NEUTRAL]) html += '<div class="out"><b>' + n[R.NEUTRAL] + '</b><span>Abandoned</span></div>';
    $('#tally').innerHTML = html;

    var log = $('#log');
    if (!state.log.length) log.innerHTML = '<div class="empty">No moves yet.</div>';
    else {
      var per = state.seats.length, out = '';
      for (var i = 0; i < state.log.length; i += per) {
        out += '<div><i>' + (i / per + 1) + '</i><span>' +
          state.log.slice(i, i + per).map(esc).join('  ') + '</span></div>';
      }
      log.innerHTML = out;
      log.scrollTop = log.scrollHeight;
    }

    var pb = $('#placeBarrier');
    pb.disabled = !board.canPlace();
    pb.textContent = board.placing ? 'Cancel placement'
      : (state.barrierLeft[mySeat === null ? state.toMove : mySeat] ? 'Place barrier' : 'Barrier used');
    $('#resign').disabled = !!state.result || mode === 'none';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ================= lobby ================= */
  var setArenaButtons = function () {};   // replaced during boot
  function showLobby(which) {
    $('#lobby').style.display = which === 'none' ? 'none' : '';
    $('#gameview').style.display = which === 'none' ? '' : 'none';
    $$('#lobby [data-lob]').forEach(function (el) {
      el.style.display = el.dataset.lob === which ? '' : 'none';
    });
    if (which === 'choose') { status(''); setArenaButtons(true); }
  }
  function status(msg, kind) {
    var el = $('#netstatus');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  /* ================= networking glue ================= */
  // Reveal the board only once the table is full. Showing a locked board that
  // says "Your move" is how you get a player clicking at nothing.
  function revealBoard() {
    showLobby('none');
    board.locked = false;
    fitBoard();
    updatePanel();
  }

  function waitPanel(text) {
    showLobby('waiting');
    $('#waitLabel').textContent = text;
  }

  function startAsHost(m, opts) {
    mode = m; isHost = true; seatOf = new Map();
    var seed = Net.randomSeed();
    gameOpts = { size: 11, seats: seatsFor(m), seed: seed, layouts: opts && opts.layouts };
    colors = (opts && opts.colors) || DEFAULT_COLORS.slice();
    newGame(gameOpts, R.SOUTH);
    board.locked = true;                       // nobody moves until the table fills
    if (m !== 'custom') waitPanel(seatsFor(m) === 4 ? 'Waiting for three more players' : 'Waiting for an opponent');
  }

  function guestSeats(m) {
    return seatsFor(m) === 4 ? [R.WEST, R.NORTH, R.EAST] : [R.NORTH];
  }

  function onGuestJoined(conn, count, s) {
    var seat = guestSeats(mode)[count - 1];
    seatOf.set(conn, seat);
    conn.send({
      t: 'init', v: 2, mode: mode, seed: gameOpts.seed, seats: seatsFor(mode),
      yourSeat: seat, colors: colors,
      layouts: gameOpts.layouts ? encodeLayouts(gameOpts.layouts) : null
    });
    var need = seatsFor(mode) === 4 ? 3 : 1;
    if (s.conns.length >= need) {
      s.broadcast({ t: 'start' });
      revealBoard();
      status('Everyone is here. You are ' + R.SEAT_NAMES[R.SOUTH] + ' and move first.', 'good');
    } else {
      waitPanel('Waiting — ' + s.conns.length + ' of ' + need + ' joined');
    }
  }

  function encodeLayouts(l) {
    if (!l) return null;
    var o = {};
    for (var k in l) o[k] = R.encodeLayout(l[k]);
    return o;
  }
  function decodeLayouts(o) {
    if (!o) return null;
    var l = {};
    for (var k in o) l[k] = R.decodeLayout(o[k]);
    return l;
  }

  function netHandlers() {
    return {
      onStatus: function (m) { status(m + '…'); },
      onReady: function (code) {
        if (isHost && mode === 'custom') { $('#roomcode').textContent = code; }
      },
      onWaiting: function (s) {
        // quick match: we became the beacon, so we are the host
        if (mode === 'none') return;
        isHost = true; seatOf = new Map();
        if (!state) startAsHost(mode, { layouts: null, colors: DEFAULT_COLORS.slice() });
      },
      onGuest: function (conn, count, s) { onGuestJoined(conn, count, s); },
      onOpen: function (s) {
        // we are a guest; wait for init
        isHost = false;
        status('Connected. Waiting for the board…', 'good');
      },
      onData: function (d, conn, s) { onMessage(d, conn, s); },
      onPeerGone: function (conn, s) {
        if (mode === 'none' || !state) return;
        if (isHost) {
          var seat = seatOf && seatOf.get(conn);
          if (seat === undefined || state.result) return;
          R.resignSeat(state, seat);
          s.broadcast({ t: 'gone', seat: seat });
          board.render(state); updatePanel();
          status(R.SEAT_NAMES[seat] + ' disconnected.', 'err');
          if (state.result) endGame(state.result);
        } else {
          board.locked = true;
          showOverlay('Host disconnected', 'The player hosting this game left, so it cannot continue.', false);
          addLeaveButton();
        }
      },
      onError: function (msg) {
        showLobby('choose');   // this clears the status line, so set it after
        status(msg, 'err');
        if (session) { session.close(); session = null; }
        mode = 'none';
      }
    };
  }

  function addLeaveButton() {
    var box = $('#board .box');
    if (!box) return;
    var b = document.createElement('button');
    b.className = 'primary'; b.textContent = 'Back to lobby';
    b.style.marginTop = '1rem'; b.onclick = leaveGame;
    box.appendChild(b);
  }

  function onMessage(d, conn, s) {
    if (d.t === 'init' && !isHost) {
      mode = d.mode; mySeat = d.yourSeat;
      colors = d.colors || DEFAULT_COLORS.slice();
      gameOpts = { size: 11, seats: d.seats, seed: d.seed, layouts: decodeLayouts(d.layouts) };
      newGame(gameOpts, d.yourSeat);
      board.locked = true;
      waitPanel('You are ' + R.SEAT_NAMES[d.yourSeat] + ' — waiting for the table to fill');
      if (s.matched) s.matched();
      return;
    }
    if (d.t === 'start' && !isHost) {
      revealBoard();
      status('Game on. You are ' + R.SEAT_NAMES[mySeat] + '.', 'good');
      return;
    }
    if (d.t === 'intent' && isHost) {
      if (!state || state.result) return;
      var seat = seatOf.get(conn);
      if (seat === undefined || seat !== state.toMove) return;      // not their turn
      var mv = R.matchMove(state, d.key);
      if (!mv) { try { conn.send({ t: 'reject' }); } catch (e) {} return; }
      if (mv.from >= 0 && R.owner(state.board[mv.from]) !== seat) return;
      commitMove(mv);
      return;
    }
    if (d.t === 'move' && !isHost) {
      if (!state || state.result) return;
      if (d.ply !== state.ply) {
        board.locked = true;
        showOverlay('Out of sync', 'The boards disagree about the move number, so the game cannot continue safely.', false);
        addLeaveButton();
        return;
      }
      var m2 = R.matchMove(state, d.key);
      if (!m2) {
        board.locked = true;
        showOverlay('Illegal move received', 'The host sent a move this position does not allow. Disconnected.', false);
        addLeaveButton();
        if (session) session.close();
        return;
      }
      busy = false;
      applyLocally(m2);
      return;
    }
    if (d.t === 'reject' && !isHost) { busy = false; status('That move was rejected.', 'err'); return; }
    if (d.t === 'gone') {
      if (isHost) return;
      R.resignSeat(state, d.seat);
      board.render(state); updatePanel();
      status(R.SEAT_NAMES[d.seat] + ' left the game.', 'err');
      if (state.result) endGame(state.result);
      return;
    }
    if (d.t === 'resign') {
      R.resignSeat(state, d.seat);
      if (isHost) s.broadcast({ t: 'resign', seat: d.seat }, conn);
      board.render(state); updatePanel();
      if (state.result) endGame(state.result);
      return;
    }
    if (d.t === 'rematch' && !isHost) {
      newGame({ size: 11, seats: gameOpts.seats, seed: d.seed, layouts: gameOpts.layouts }, mySeat);
      return;
    }
  }

  /* ================= board sizing ================= */
  function fitBoard() {
    var el = $('#board');
    if (!el) return;
    var avail = Math.min(el.parentElement.clientWidth, root.innerHeight - 190);
    el.style.setProperty('--bs', Math.max(280, Math.min(680, avail)) + 'px');
    if (board) board.addCoords();
  }

  /* ================= custom setup editor ================= */
  var CYCLE = [R.T.SWORD, R.T.SCYTHE, R.T.BOW, R.T.ROD, R.T.SPEAR, R.T.TRIDENT, 0];

  function buildEditor() {
    var host = $('#editorGrid');
    host.innerHTML = '';
    ['back', 'front'].forEach(function (rank) {
      var row = document.createElement('div');
      row.className = 'editrow';
      row.innerHTML = '<span class="editlabel">' + (rank === 'back' ? 'Back' : 'Front') + '</span>';
      for (var k = 0; k < R.ARMY; k++) {
        (function (k) {
          var b = document.createElement('button');
          b.className = 'slot';
          b.onclick = function () {
            var cur = customLayout[rank][k];
            customLayout[rank][k] = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
            refreshEditor();
          };
          row.appendChild(b);
        })(k);
      }
      host.appendChild(row);
    });
    refreshEditor();
  }

  function refreshEditor() {
    var rows = $$('#editorGrid .editrow');
    ['back', 'front'].forEach(function (rank, ri) {
      var slots = rows[ri].querySelectorAll('.slot');
      for (var k = 0; k < R.ARMY; k++) {
        var t = customLayout[rank][k];
        slots[k].innerHTML = t ? UI.glyph(t) : '';
        slots[k].className = 'slot' + (t ? '' : ' empty');
        slots[k].style.background = t ? customColors[R.SOUTH] : '';
        slots[k].style.color = t ? board.ink(customColors[R.SOUTH]) : '';
        slots[k].title = t ? R.NAMES[t] : 'Empty';
      }
    });
    var valid = R.layoutValid(customLayout);
    var count = 0;
    ['back', 'front'].forEach(function (r) {
      customLayout[r].forEach(function (t) { if (t) count++; });
    });
    $('#editorStatus').textContent = valid
      ? count + ' pieces, one Trident. Ready.'
      : 'Your army needs exactly one Trident.';
    $('#editorStatus').className = 'status ' + (valid ? 'good' : 'err');
    $('#openCustom').disabled = !valid;
  }

  /* ================= wiring ================= */
  function boot() {
    applyTheme();
    board = UI.createBoard($('#board'), {
      settings: settings,
      colors: colors,
      onMove: function (mv) { requestMove(mv); },
      onPlacingChange: function () { updatePanel(); }
    });

    buildPieceCards('#piececards');
    buildPieceCards('#piececards2');

    // themes
    var tg = $('#themegrid');
    THEMES.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'swatch' + (settings.theme === t.id ? ' on' : '');
      b.dataset.theme = t.id;
      b.innerHTML = esc(t.name) + '<span class="bar">' +
        t.cols.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span>';
      b.onclick = function () {
        settings.theme = t.id; save(); applyTheme();
        $$('#themegrid .swatch').forEach(function (x) { x.classList.toggle('on', x.dataset.theme === t.id); });
      };
      tg.appendChild(b);
    });

    var speed = $('#setSpeed');
    speed.value = settings.animMs;
    $('#speedVal').textContent = settings.animMs === 0 ? 'off' : settings.animMs + 'ms';
    speed.oninput = function () {
      settings.animMs = parseInt(speed.value, 10);
      $('#speedVal').textContent = settings.animMs === 0 ? 'off' : settings.animMs + 'ms';
      save();
    };
    [['setHints', 'hints'], ['setDanger', 'danger'], ['setCoords', 'coords'], ['setSound', 'sound']]
      .forEach(function (pair) {
        var el = $('#' + pair[0]);
        el.checked = !!settings[pair[1]];
        el.onchange = function () {
          settings[pair[1]] = el.checked; save();
          if (state) { board.render(state); board.addCoords(); }
        };
      });
    $('#resetSettings').onclick = function () {
      for (var k in DEFAULTS) settings[k] = DEFAULTS[k];
      save(); applyTheme(); location.reload();
    };

    // arenas
    $('#btnQuick2').onclick = function () { beginQuick('quick2'); };
    $('#btnQuick4').onclick = function () { beginQuick('quick4'); };
    $('#btnCustomSetup').onclick = function () { showLobby('custom'); buildEditor(); };
    $('#btnJoinForm').onclick = function () { showLobby('joining'); setTimeout(function () { $('#joinCode').focus(); }, 30); };
    $('#btnJoin').onclick = doJoin;
    $('#joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    $$('#lobby [data-back]').forEach(function (b) {
      b.onclick = function () { if (session) { session.close(); session = null; } mode = 'none'; showLobby('choose'); };
    });

    setArenaButtons = function (on) {
      ['#btnQuick2', '#btnQuick4', '#btnCustomSetup', '#btnJoinForm', '#openCustom', '#btnJoin']
        .forEach(function (sel) { var b = $(sel); if (b) b.disabled = !on; });
    }
    function beginQuick(m) {
      if (session) session.close();
      mode = m; state = null; isHost = false;
      setArenaButtons(false);
      showLobby('searching');
      $('#searchLabel').textContent = m === 'quick4' ? 'Finding a four-player table' : 'Finding an opponent';
      session = Net.quickMatch(seatsFor(m), netHandlers());
    }
    function doJoin() {
      if (session) session.close();
      mode = 'custom'; isHost = false; state = null;
      status('Looking for the room…');
      session = Net.join($('#joinCode').value, netHandlers());
    }

    // custom room
    [R.SOUTH, R.NORTH].forEach(function (seat, i) {
      var inp = $('#color' + i);
      inp.value = customColors[seat];
      inp.oninput = function () { customColors[seat] = inp.value; refreshEditor(); };
    });
    $('#resetLayout').onclick = function () {
      customLayout = R.defaultLayout();
      customColors = DEFAULT_COLORS.slice();
      $('#color0').value = customColors[R.SOUTH];
      $('#color1').value = customColors[R.NORTH];
      refreshEditor();
    };
    $('#openCustom').onclick = function () {
      if (session) session.close();
      var lays = {};
      lays[R.SOUTH] = { back: customLayout.back.slice(), front: customLayout.front.slice() };
      lays[R.NORTH] = { back: customLayout.back.slice(), front: customLayout.front.slice() };
      mode = 'custom';
      showLobby('hosting');
      $('#roomcode').textContent = '·····';
      session = Net.host({ capacity: 1 }, netHandlers());
      startAsHost('custom', { layouts: lays, colors: customColors.slice() });
      showLobby('hosting');
    };
    $('#copyCode').onclick = function () {
      var code = $('#roomcode').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(
          function () { status('Room code copied.', 'good'); },
          function () { status('Could not copy — read it out instead.'); });
      }
    };

    // hot-seat, for testing the rules on one screen
    if (/[?&]dev=1/.test(location.search)) {
      $('#devrow').style.display = '';
      $('#btnLocal2').onclick = function () { startLocal(2); };
      $('#btnLocal4').onclick = function () { startLocal(4); };
    }
    function startLocal(n) {
      if (session) { session.close(); session = null; }
      mode = 'local'; isHost = false;
      colors = DEFAULT_COLORS.slice();
      showLobby('none');
      newGame({ size: 11, seats: n, seed: Net.randomSeed() }, null);
      status('Hot-seat: ' + n + ' seats on this screen.', 'good');
    }

    // in-game controls
    $('#placeBarrier').onclick = function () { board.setPlacing(!board.placing); updatePanel(); };
    $('#rotate').onclick = function () { board.rotate(); };
    $('#resign').onclick = function () {
      if (!state || state.result) return;
      var seat = mySeat === null ? state.toMove : mySeat;
      if (mode !== 'local') session.broadcast ? session.broadcast({ t: 'resign', seat: seat }) : session.send({ t: 'resign', seat: seat });
      R.resignSeat(state, seat);
      board.render(state); updatePanel();
      if (state.result) endGame(state.result);
    };
    $('#leave').onclick = leaveGame;

    root.addEventListener('hashchange', route);
    root.addEventListener('resize', fitBoard);
    showLobby('choose');
    route();

    if (!Net.available()) {
      status('The peer-to-peer library did not load, so online play is unavailable. Everything else works offline.', 'err');
    }
  }

  var PIECE_TEXT = [
    [R.T.SWORD, 'Push', 'Steps one square orthogonally. Shoves the piece in front of it one square and takes its place.'],
    [R.T.SCYTHE, 'Pull', 'Steps one square diagonally. Drags an enemy two or three squares away on a diagonal one square closer, without moving itself.'],
    [R.T.BOW, 'Push', 'Slides any distance on a diagonal. Shoves the first enemy it reaches one square and takes its place.'],
    [R.T.ROD, 'Pull', 'Slides any distance orthogonally. Drags the first enemy on its line one square closer — and its scan reaches straight over holes.'],
    [R.T.SPEAR, 'Push', 'Steps one or two squares orthogonally. Strikes a target exactly two squares away, drives it two squares, and lunges into its place.'],
    [R.T.TRIDENT, 'King', 'Slides up to three squares in any of eight directions. Pushes an adjacent enemy one or two squares, or pulls one from up to three squares. If it falls, you are out.']
  ];

  function buildPieceCards(sel) {
    var host = $(sel);
    if (!host) return;
    host.innerHTML = PIECE_TEXT.map(function (p) {
      return '<div class="piececard"><div class="ico" style="background:' + DEFAULT_COLORS[0] + '">' +
        UI.glyph(p[0]) + '</div><div><h3>' + R.NAMES[p[0]] + '<span class="tag">' + p[1] + '</span></h3>' +
        '<p>' + p[2] + '</p></div></div>';
    }).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
