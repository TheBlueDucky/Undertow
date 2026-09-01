/* Undertow - main.js
 * Routing, settings, sound, lobby and the glue between engine, board and peer.
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
  var DEFAULTS = { theme: 'abyss', animMs: 280, hints: true, danger: true, coords: true, sound: true };
  var settings = load();

  function load() {
    var s = {}, k;
    for (k in DEFAULTS) s[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem('undertow.settings');
      if (raw) { var o = JSON.parse(raw); for (k in DEFAULTS) if (o[k] !== undefined) s[k] = o[k]; }
    } catch (e) { /* private mode, blocked storage - defaults are fine */ }
    return s;
  }
  function save() {
    try { localStorage.setItem('undertow.settings', JSON.stringify(settings)); } catch (e) {}
  }
  function applyTheme() { document.documentElement.setAttribute('data-theme', settings.theme); }

  /* ================= sound ================= */
  var actx = null;
  function tone(freqA, freqB, dur, type, vol) {
    if (!settings.sound) return;
    try {
      if (!actx) actx = new (root.AudioContext || root.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freqA, t);
      if (freqB) o.frequency.exponentialRampToValueAtTime(freqB, t + dur);
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

  /* ================= game ================= */
  var board = null, state = null, session = null;
  var mode = 'none';          // 'online' | 'local'
  var mySide = null;          // null in hot-seat
  var isHost = false, busy = false, gameSeed = 0;

  function newGame(seed, side) {
    gameSeed = seed >>> 0;
    state = R.createState(gameSeed);
    mySide = side;
    board.mySide = side;
    board.locked = false;
    board.flipped = (side === R.VIOLET);
    board.setLastMove();
    board.render(state);
    clearOverlay();
    updatePanel();
    fitBoard();   // the game view was hidden until now, so measure it here
  }

  function play(mv, fromPeer) {
    if (busy || !state || state.result) return;
    busy = true;
    var plyBefore = state.ply;
    var kills = mv.res ? mv.res.deaths.length : 0;

    if (!fromPeer && mode === 'online') {
      session.send({ t: 'move', key: R.moveKey(mv), ply: plyBefore });
    }
    if (mv.kind === 'move') Sound.move(); else Sound.push();
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
    if (res.type === 'trident') {
      title = res.winner === null ? 'Both Tridents lost' : R.SIDE_NAMES[res.winner] + ' wins';
      sub = res.both ? 'Both Tridents went into the void in one push. Whoever caused it loses.'
                     : 'The ' + R.SIDE_NAMES[1 - res.winner] + ' Trident went into the void.';
    } else if (res.type === 'repetition') {
      title = res.winner === null ? 'Draw' : R.SIDE_NAMES[res.winner] + ' wins';
      sub = 'Threefold repetition. Pieces: Amber ' + res.counts[0] + ', Violet ' + res.counts[1] +
            (res.winner === null ? ' — dead even.' : '.');
    } else if (res.type === 'resign') {
      title = R.SIDE_NAMES[res.winner] + ' wins';
      sub = R.SIDE_NAMES[1 - res.winner] + ' resigned.';
    } else {
      title = R.SIDE_NAMES[res.winner] + ' wins';
      sub = R.SIDE_NAMES[1 - res.winner] + ' has no legal moves left.';
    }
    if (mySide === null) Sound.win();
    else if (res.winner === mySide) Sound.win();
    else Sound.lose();
    showOverlay(title, sub, true);
  }

  function showOverlay(title, sub, offerRematch) {
    clearOverlay();
    var o = document.createElement('div');
    o.className = 'overlay';
    var btn = offerRematch
      ? '<div class="btn-row" style="justify-content:center;margin-top:1rem">' +
        '<button class="primary" id="rematch">Rematch</button>' +
        '<button id="toLobby">Leave</button></div>'
      : '';
    o.innerHTML = '<div class="box"><h2>' + esc(title) + '</h2><p class="note">' + esc(sub) + '</p>' + btn + '</div>';
    $('#board').appendChild(o);
    var rm = $('#rematch');
    if (rm) rm.onclick = requestRematch;
    var lb = $('#toLobby');
    if (lb) lb.onclick = leaveGame;
  }
  function clearOverlay() { var o = $('#board .overlay'); if (o) o.remove(); }

  function requestRematch() {
    if (mode === 'local') { newGame(Net.randomSeed(), null); return; }
    if (isHost) {
      var seed = Net.randomSeed(), guestSide = (mySide === R.AMBER) ? R.AMBER : R.VIOLET;
      // swap who plays Amber each rematch
      guestSide = mySide;                    // host takes the guest's old side
      session.send({ t: 'rematch', seed: seed, guestSide: 1 - guestSide });
      newGame(seed, guestSide);
      status('New game. You are ' + R.SIDE_NAMES[guestSide] + '.', 'good');
    } else {
      session.send({ t: 'rematch-req' });
      showOverlay('Rematch requested', 'Waiting for the host to accept.', false);
    }
  }

  function leaveGame() {
    if (session) { try { session.send({ t: 'bye' }); } catch (e) {} session.close(); session = null; }
    mode = 'none'; state = null;
    showLobby('choose');
  }

  /* ================= panel ================= */
  function updatePanel() {
    if (!state) return;
    var turn = $('#turn'), n = R.countPieces(state);
    var who = R.SIDE_NAMES[state.toMove];
    var yours = (mySide !== null && state.toMove === mySide);
    var label = state.result ? 'Game over'
      : (mode === 'online' ? (yours ? 'Your move' : 'Waiting for ' + who) : who + ' to move');
    var danger = !state.result && settings.danger && R.tridentInDanger(state, state.toMove);
    turn.innerHTML =
      '<span class="chip s' + state.toMove + '"></span>' +
      '<span>' + esc(label) +
      '<small>' + (state.result ? 'Move ' + state.ply
        : (danger ? '<span class="warn">Trident can be taken this turn</span>'
                  : who + ' · move ' + (state.ply + 1))) + '</small></span>';

    $('#tally').innerHTML =
      '<div class="s0"><b>' + n[0] + '</b><span>Amber</span></div>' +
      '<div class="s1"><b>' + n[1] + '</b><span>Violet</span></div>';

    var log = $('#log');
    if (!state.log.length) { log.innerHTML = '<div class="empty">No moves yet.</div>'; }
    else {
      var html = '';
      for (var i = 0; i < state.log.length; i += 2) {
        html += '<div><i>' + (i / 2 + 1) + '</i><span>' + esc(state.log[i]) +
          (state.log[i + 1] ? '  ' + esc(state.log[i + 1]) : '') + '</span></div>';
      }
      log.innerHTML = html;
      log.scrollTop = log.scrollHeight;
    }
    $('#resign').disabled = !!state.result || mode === 'none';
    $('#flip').disabled = false;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ================= lobby ================= */
  function showLobby(which) {
    $('#lobby').style.display = which === 'none' ? 'none' : '';
    $('#gameview').style.display = which === 'none' ? '' : 'none';
    $$('#lobby [data-lob]').forEach(function (el) {
      el.style.display = el.dataset.lob === which ? '' : 'none';
    });
    if (which === 'choose') status('');
  }
  function status(msg, kind) {
    var el = $('#netstatus');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function handlers(host) {
    return {
      onReady: function (code) {
        if (host) { $('#roomcode').textContent = code; showLobby('hosting'); }
        else status('Connecting to room ' + code, '');
      },
      onOpen: function (s) {
        if (host) {
          var seed = Net.randomSeed();
          s.send({ t: 'init', v: 1, seed: seed, guestSide: R.VIOLET });
          mode = 'online'; isHost = true;
          showLobby('none');
          newGame(seed, R.AMBER);
          status('Opponent connected. You are Amber and move first.', 'good');
        } else {
          s.send({ t: 'hello', v: 1 });
          status('Connected. Waiting for the board…', 'good');
        }
      },
      onData: function (d, s) { onMessage(d, s, host); },
      onClose: function () {
        if (mode !== 'online') return;
        board.locked = true;
        showOverlay('Opponent disconnected', 'The connection dropped. The game cannot continue.', false);
        var box = $('#board .box');
        if (box) {
          var b = document.createElement('button');
          b.textContent = 'Back to lobby'; b.className = 'primary';
          b.style.marginTop = '1rem'; b.onclick = leaveGame;
          box.appendChild(b);
        }
      },
      onError: function (msg) {
        status(msg, 'err');
        showLobby('choose');
        if (session) { session.close(); session = null; }
      }
    };
  }

  function onMessage(d, s, host) {
    if (d.t === 'hello' && host) { return; }
    if (d.t === 'init' && !host) {
      mode = 'online'; isHost = false;
      showLobby('none');
      newGame(d.seed, d.guestSide);
      status('Connected. You are ' + R.SIDE_NAMES[d.guestSide] + '.', 'good');
      return;
    }
    if (d.t === 'move') {
      if (!state || state.result) return;
      if (d.ply !== state.ply) {
        board.locked = true;
        showOverlay('Out of sync', 'The two boards disagree about the move number. The game cannot continue safely.', false);
        return;
      }
      var mv = R.matchMove(state, d.key);
      if (!mv) {
        board.locked = true;
        showOverlay('Illegal move received', 'Your opponent sent a move this position does not allow. Disconnected.', false);
        if (session) session.close();
        return;
      }
      if (R.owner(state.board[mv.from]) === mySide) return; // never accept moves for our own side
      play(mv, true);
      return;
    }
    if (d.t === 'resign') { state.result = { type: 'resign', winner: mySide }; endGame(state.result); return; }
    if (d.t === 'rematch-req' && host) {
      showOverlay('Rematch?', 'Your opponent wants to play again.', false);
      var box = $('#board .box');
      var b = document.createElement('button');
      b.className = 'primary'; b.textContent = 'Start rematch'; b.style.marginTop = '1rem';
      b.onclick = requestRematch;
      box.appendChild(b);
      return;
    }
    if (d.t === 'rematch' && !host) {
      newGame(d.seed, d.guestSide);
      status('New game. You are ' + R.SIDE_NAMES[d.guestSide] + '.', 'good');
      return;
    }
    if (d.t === 'bye') { if (session) session.close(); }
  }

  /* ================= board sizing ================= */
  function fitBoard() {
    var el = $('#board');
    if (!el) return;
    var wrap = el.parentElement;
    var avail = Math.min(wrap.clientWidth, root.innerHeight - 190);
    var size = Math.max(260, Math.min(620, avail));
    el.style.setProperty('--bs', size + 'px');
    board.addCoords();
  }

  /* ================= wiring ================= */
  function boot() {
    applyTheme();

    board = UI.createBoard($('#board'), {
      settings: settings,
      onMove: function (mv) { play(mv, false); }
    });

    // --- reference content that is generated from the rules themselves ---
    buildPieceCards('#piececards');
    buildPieceCards('#piececards2');

    // --- settings UI ---
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

    // --- lobby ---
    $('#btnHost').onclick = function () {
      if (session) session.close();
      status('Opening a room' + '…', '');
      showLobby('hosting');
      $('#roomcode').textContent = '·····';
      session = Net.host(handlers(true));
    };
    $('#btnJoinForm').onclick = function () { showLobby('joining'); setTimeout(function () { $('#joinCode').focus(); }, 30); };
    $('#btnJoin').onclick = doJoin;
    $('#joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    $$('#lobby [data-back]').forEach(function (b) {
      b.onclick = function () { if (session) { session.close(); session = null; } showLobby('choose'); };
    });
    $('#copyCode').onclick = function () {
      var code = $('#roomcode').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(function () { status('Room code copied.', 'good'); },
          function () { status('Could not copy — read it out instead.', ''); });
      } else { status('Copy is unavailable here — read the code out instead.', ''); }
    };

    function doJoin() {
      var code = $('#joinCode').value;
      if (session) session.close();
      status('Looking for the room' + '…', '');
      session = Net.join(code, handlers(false));
    }

    // Hot-seat exists for testing the rules on one screen; ?dev=1 reveals it.
    if (/[?&]dev=1/.test(location.search)) {
      $('#devrow').style.display = '';
      $('#btnLocal').onclick = function () {
        if (session) { session.close(); session = null; }
        mode = 'local'; isHost = false;
        showLobby('none');
        newGame(Net.randomSeed(), null);
        status('Hot-seat: both sides on this screen.', 'good');
      };
    }

    // --- in-game controls ---
    $('#resign').onclick = function () {
      if (!state || state.result) return;
      if (mode === 'online') {
        session.send({ t: 'resign' });
        state.result = { type: 'resign', winner: 1 - mySide };
      } else {
        state.result = { type: 'resign', winner: 1 - state.toMove };
      }
      endGame(state.result);
    };
    $('#flip').onclick = function () {
      board.flipped = !board.flipped;
      board.render(state);
      board.addCoords();
    };
    $('#leave').onclick = leaveGame;

    // --- routing + layout ---
    root.addEventListener('hashchange', route);
    root.addEventListener('resize', fitBoard);
    showLobby('choose');
    route();
    fitBoard();

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
    [R.T.TRIDENT, 'King', 'Slides up to three squares in any of eight directions. Pushes an adjacent enemy one or two squares, or pulls one from up to three squares. If it falls, you lose.']
  ];

  function buildPieceCards(sel) {
    var host = $(sel);
    if (!host) return;
    host.innerHTML = PIECE_TEXT.map(function (p) {
      return '<div class="piececard"><div class="ico">' + UI.glyph(p[0]) + '</div><div>' +
        '<h3>' + R.NAMES[p[0]] + '<span class="tag">' + p[1] + '</span></h3>' +
        '<p>' + p[2] + '</p></div></div>';
    }).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
