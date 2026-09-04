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
  var DEFAULTS = { theme: 'abyss', animMs: 280, hints: true, danger: true, coords: true,
                 sound: true, turnSecs: 60, autoRotate: true, playerName: 'Player' };
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
    yourTurn: function () { tone(523, 0, 0.13, 'sine', 0.08); setTimeout(function () { tone(784, 0, 0.22, 'sine', 0.08); }, 120); },
    lowTime: function () { tone(880, 660, 0.16, 'triangle', 0.07); },
    timeout: function () { tone(300, 120, 0.45, 'sawtooth', 0.07); },
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

  /* ================= who is who =================
   * R.SEAT_NAMES stays the name of the COLOUR (Amber, Jade, Violet, Coral).
   * seatNames holds the name of the PERSON in that chair for this game.
   * Two people can pick the same name - the colour chip beside it is what
   * keeps them apart, which is why every name is rendered next to its colour.
   */
  var seatNames = {};
  var NAME_MAX = 16;

  function cleanName(t) {
    var raw = String(t == null ? '' : t), out = '', i, code;
    for (i = 0; i < raw.length; i++) {
      code = raw.charCodeAt(i);
      out += (code < 32 || code === 127) ? ' ' : raw.charAt(i);
    }
    return out.replace(/ +/g, ' ').trim().slice(0, NAME_MAX);
  }

  function myName() { return cleanName(settings.playerName) || 'Player'; }

  // Falls back to the colour name so nothing can ever render blank.
  function nameOf(seat) {
    if (seat === null || seat === undefined) return '—';
    return seatNames[seat] || R.SEAT_NAMES[seat] || 'Player';
  }

  function resetSeatNames() { seatNames = {}; }


  /* ================= local play =================
   * Every seat lives on this device. A seat is either a person passing the
   * phone along or the computer; `localSeats` says which, indexed by seat.
   */
  var localCount = 2;
  var localSeats = { 0: 'human', 1: 'ai:normal', 2: 'ai:normal', 3: 'ai:normal' };
  var localNames = {};
  var aiTimer = null;

  function seatOrder(n) { return n === 4 ? [R.SOUTH, R.WEST, R.NORTH, R.EAST] : [R.SOUTH, R.NORTH]; }
  function isAiSeat(seat) {
    return mode === 'local' && String(localSeats[seat] || '').indexOf('ai:') === 0;
  }
  function aiLevel(seat) { return String(localSeats[seat] || 'ai:normal').split(':')[1] || 'normal'; }
  function anyHumanSeat() {
    var order = seatOrder(localCount);
    for (var i = 0; i < order.length; i++) if (!isAiSeat(order[i])) return true;
    return false;
  }

  // In a local game the board turns to face whoever is about to move, so the
  // person holding the phone is always looking at their own side.
  function faceCurrentPlayer() {
    if (mode !== 'local' || !state || state.result) return;
    if (!settings.autoRotate) return;
    if (isAiSeat(state.toMove)) return;                 // do not spin for the computer
    if (board.viewSeat !== state.toMove) board.setPerspective(state.toMove);
  }

  function stopAi() { clearTimeout(aiTimer); aiTimer = null; }

  function maybeAiMove() {
    stopAi();
    if (mode !== 'local' || !state || state.result || busy) return;
    if (!isAiSeat(state.toMove)) return;
    var seat = state.toMove, level = aiLevel(seat);
    // a beat before moving, so a human can see what just happened
    aiTimer = setTimeout(function () {
      if (mode !== 'local' || !state || state.result) return;
      if (state.toMove !== seat) return;
      var mv = null;
      try { mv = UT.AI.chooseMove(state, { level: level }); } catch (e) { mv = null; }
      if (!mv) { var ms = R.legalMoves(state, seat); mv = ms[0]; }
      if (mv) commitMove(mv);
    }, Math.max(220, settings.animMs));
  }


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
      resetTurnClock();
      announceTurn();
      if (state.result) { endGame(state.result); return; }
      faceCurrentPlayer();
      maybeAiMove();
    });
  }

  function endGame(res) {
    board.locked = true;
    stopAi();
    stopClock();
    paintClock();
    var title, sub;
    var name = nameOf;
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
      sub = name(res.quit) + ' resigned.';
    } else if (res.type === 'left') {
      title = name(res.winner) + ' wins';
      sub = name(res.quit) + ' left the game.';
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
    if (mode === 'local') { newGame(opts, null); resetTurnClock(); return; }
    session.broadcast({ t: 'rematch', seed: opts.seed });
    newGame(opts, mySeat);
    lastTurnSeat = null; resetTurnClock(); announceTurn();
  }

  function leaveGame() {
    clearTimeout(startTimer);
    stopClock();
    stopAi();
    if (session) { session.close(); session = null; }
    mode = 'none'; state = null; seatOf = null;
    clearChat();
    refreshChatState();
    showLobby('choose');
  }

  /* ================= turn clock =================
   * The host is the authority: only it may declare a timeout, and it tells
   * everyone else. Guests run the same countdown for display only, so a slow
   * connection can never make two players disagree about whose turn it is.
   */
  var clockTick = null, turnDeadline = 0, lowWarned = false, lastTurnSeat = null;

  function turnSecs() {
    var v = (gameOpts && gameOpts.turnSecs !== undefined) ? gameOpts.turnSecs : settings.turnSecs;
    return Math.max(0, v | 0);
  }
  function secondsLeft() {
    if (!turnDeadline || !state || state.result) return null;
    return Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
  }
  function clockText() {
    var left = secondsLeft();
    return left === null ? '' : left + 's';
  }
  function stopClock() { clearInterval(clockTick); clockTick = null; turnDeadline = 0; }

  function resetTurnClock() {
    lowWarned = false;
    var secs = turnSecs();
    turnDeadline = (secs > 0 && state && !state.result && mode !== 'none') ? Date.now() + secs * 1000 : 0;
    if (!clockTick && turnDeadline) clockTick = setInterval(tickClock, 250);
    paintClock();
  }

  function paintClock() {
    var el = $('#clock');
    if (!el) return;
    var left = secondsLeft();
    el.textContent = left === null ? '' : left + 's';
    el.className = 'clock' + (left !== null && left <= 10 ? ' low' : '');
  }

  function tickClock() {
    if (!state || state.result || !turnDeadline) { paintClock(); return; }
    var left = secondsLeft();
    paintClock();
    if (left <= 10 && !lowWarned && mySeat !== null && state.toMove === mySeat) {
      lowWarned = true; Sound.lowTime();
    }
    if (left > 0) return;
    if (mode === 'local' || isHost) declareTimeout();
  }

  function declareTimeout() {
    if (!state || state.result || busy) return;
    var seat = state.toMove;
    if (mode !== 'local' && isHost) session.broadcast({ t: 'pass', seat: seat, ply: state.ply });
    applyPass(seat);
  }

  function applyPass(seat) {
    if (!state || state.result || state.toMove !== seat) return;
    Sound.timeout();
    sysChat(nameOf(seat) + ' ran out of time and lost the turn.');
    R.passTurn(state, seat);
    board.render(state);
    updatePanel();
    resetTurnClock();
    announceTurn();
    if (state.result) { endGame(state.result); return; }
    faceCurrentPlayer();
    maybeAiMove();
  }

  // Chime once, when the turn becomes yours.
  function announceTurn() {
    if (!state || state.result || mySeat === null) { lastTurnSeat = state ? state.toMove : null; return; }
    if (state.toMove === mySeat && lastTurnSeat !== mySeat) Sound.yourTurn();
    lastTurnSeat = state.toMove;
  }

  /* ================= panel ================= */
  function updatePanel() {
    if (!state) return;
    var n = R.countPieces(state);
    var who = nameOf(state.toMove);
    var yours = (mySeat !== null && state.toMove === mySeat);
    var label = state.result ? 'Game over'
      : (mode === 'local' ? who + ' to move' : (yours ? 'Your move' : 'Waiting for ' + who));
    var danger = !state.result && settings.danger && R.tridentInDanger(state, state.toMove);
    $('#turn').innerHTML =
      '<span class="chip" style="background:' + colors[state.toMove] + '"></span>' +
      '<span>' + esc(label) + '<small>' +
      (state.result ? 'Move ' + state.ply
        : (danger ? '<span class="warn">Trident can be taken this turn</span>' : who + ' · move ' + (state.ply + 1))) +
      '</small></span><span class="clock" id="clock">' + clockText() + '</span>';

    var html = '';
    for (var s = 0; s < state.seats.length; s++) {
      var seat = state.seats[s], dead = !state.alive[seat];
      html += '<div' + (dead ? ' class="out"' : '') + '><b style="color:' + colors[seat] + '">' + n[seat] +
        '</b><span>' + esc(nameOf(seat)) + (dead ? ' · out' : '') + '</span></div>';
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

  /* ================= chat =================
   * Guests send text only. The host stamps the seat from the connection it
   * arrived on, so nobody can speak as another player, and every message is
   * inserted as text - never as markup.
   */
  var CHAT_MAX = 200, chatLastAt = {};

  function cleanChat(t) {
    // Strip control characters by code point - no regex escapes to get mangled.
    var raw = String(t == null ? '' : t), out = '', i, code;
    for (i = 0; i < raw.length; i++) {
      code = raw.charCodeAt(i);
      out += (code < 32 || code === 127) ? ' ' : raw.charAt(i);
    }
    return out.replace(/ +/g, ' ').trim().slice(0, CHAT_MAX);
  }

  function moveChat(slotSel) {
    var c = $('#chat'), slot = $(slotSel);
    if (c && slot && c.parentElement !== slot) slot.appendChild(c);
  }

  function chatAvailable() { return mode !== 'none' && mode !== 'local' && !!session; }

  function refreshChatState() {
    var c = $('#chat');
    if (!c) return;
    c.style.display = chatAvailable() ? '' : 'none';
    $('#chatinput').disabled = !chatAvailable();
    $('#chatsend').disabled = !chatAvailable();
  }

  function addChat(kind, seat, text) {
    var box = $('#chatlog');
    if (!box) return;
    var empty = box.querySelector('.empty');
    if (empty) empty.remove();
    var line = document.createElement('div');
    line.className = 'msg ' + kind;
    if (kind === 'say') {
      var who = document.createElement('b');
      who.textContent = nameOf(seat) + ':';
      if (colors[seat]) who.style.color = colors[seat];
      line.appendChild(who);
      line.appendChild(document.createTextNode(' ' + text));   // text, never markup
    } else {
      line.textContent = text;
    }
    box.appendChild(line);
    while (box.children.length > 200) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function sysChat(text) { addChat('sys', null, text); }

  function clearChat() {
    var box = $('#chatlog');
    if (box) box.innerHTML = '<div class="empty">No messages yet.</div>';
    chatLastAt = {};
  }

  function sendChat(raw) {
    var text = cleanChat(raw);
    if (!text || !chatAvailable()) return;
    var seat = mySeat === null ? R.SOUTH : mySeat;
    if (isHost) {
      addChat('say', seat, text);
      session.broadcast({ t: 'say', seat: seat, text: text });
    } else {
      session.send({ t: 'chat', text: text });   // wait for the host to echo it back
    }
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

  // The first chair is you; the rest are numbered so a pass-and-play table
  // does not end up with four people all called Player.
  function defaultSeatName(seat, order) {
    var at = order.indexOf(seat);
    if (at === 0) return myName();
    return 'Player ' + (at + 1);
  }

  function buildSeatList() {
    var host = $('#seatList');
    host.innerHTML = '';
    var order = seatOrder(localCount);
    order.forEach(function (seat) {
      var row = document.createElement('div');
      row.className = 'seatrow';
      var opts = '<option value="human">Person</option>' +
        '<option value="ai:easy">Computer · Easy</option>' +
        '<option value="ai:normal">Computer · Normal</option>' +
        '<option value="ai:hard">Computer · Hard</option>';
      row.innerHTML = '<span class="dotc" style="background:' + DEFAULT_COLORS[seat] + '"></span>' +
        '<span class="who">' + R.SEAT_NAMES[seat] + '</span>' +
        '<input type="text" class="seatname" maxlength="16" data-seat="' + seat + '">' +
        '<select data-seat="' + seat + '">' + opts + '</select>';
      var sel = row.querySelector('select');
      var nameBox = row.querySelector('.seatname');
      sel.value = localSeats[seat];
      nameBox.value = localNames[seat] || defaultSeatName(seat, order);
      nameBox.placeholder = 'Player';
      nameBox.oninput = function () { localNames[seat] = cleanName(nameBox.value); };
      function syncRow() {
        var human = sel.value === 'human';
        nameBox.style.visibility = human ? '' : 'hidden';
      }
      sel.onchange = function () { localSeats[seat] = sel.value; syncRow(); };
      syncRow();
      host.appendChild(row);
    });
    $('#localSeats2').classList.toggle('on', localCount === 2);
    $('#localSeats4').classList.toggle('on', localCount === 4);
  }

  /* ================= networking glue ================= */
  // Reveal the board only once the table is full. Showing a locked board that
  // says "Your move" is how you get a player clicking at nothing.
  function revealBoard() {
    clearTimeout(startTimer);
    if (session) session.started = true;
    showLobby('none');
    board.locked = false;
    moveChat('#chatSlotGame');
    refreshChatState();
    fitBoard();
    lastTurnSeat = null;
    resetTurnClock();
    announceTurn();
    updatePanel();
  }

  // A guest seated at a table that never fills would otherwise wait forever.
  var startTimer = null;
  function armStartTimeout() {
    clearTimeout(startTimer);
    startTimer = setTimeout(function () {
      if (!session || (state && state.result) || (session && session.started)) return;
      if (session) { session.close(); session = null; }
      mode = 'none'; state = null;
      showLobby('choose');
      status('That table never filled up — the other players left before it could start. Try again.', 'err');
    }, 75000);
  }

  function waitPanel(text) {
    showLobby('waiting');
    $('#waitLabel').textContent = text;
    moveChat('#chatSlotWait');
    refreshChatState();
  }

  function startAsHost(m, opts) {
    mode = m; isHost = true; seatOf = new Map();
    resetSeatNames();
    seatNames[R.SOUTH] = myName();
    var seed = Net.randomSeed();
    gameOpts = { size: 11, seats: seatsFor(m), seed: seed, layouts: opts && opts.layouts,
                 turnSecs: settings.turnSecs };
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
      yourSeat: seat, colors: colors, turnSecs: gameOpts.turnSecs, names: seatNames,
      layouts: gameOpts.layouts ? encodeLayouts(gameOpts.layouts) : null
    });
    var need = seatsFor(mode) === 4 ? 3 : 1, total = seatsFor(mode);
    if (s.conns.length >= need) {
      s.broadcast({ t: 'start' });
      revealBoard();
      sysChat('Everyone is here — game on.');
      status('Everyone is here. You are ' + nameOf(R.SOUTH) + ' and move first.', 'good');
    } else {
      s.broadcast({ t: 'lobby', have: s.conns.length + 1, need: total });
      waitPanel('Waiting — ' + (s.conns.length + 1) + ' of ' + total + ' players here');
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
          R.resignSeat(state, seat, 'left');
          s.broadcast({ t: 'gone', seat: seat });
          board.render(state); updatePanel();
          status(nameOf(seat) + ' disconnected.', 'err');
          sysChat(nameOf(seat) + ' disconnected.');
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

  function applyRoster(names) {
    if (!names) return;
    for (var k in names) {
      var seat = parseInt(k, 10);
      if (isNaN(seat)) continue;
      var nm = cleanName(names[k]);
      if (nm) seatNames[seat] = nm;
    }
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
      gameOpts = { size: 11, seats: d.seats, seed: d.seed, layouts: decodeLayouts(d.layouts),
                   turnSecs: d.turnSecs === undefined ? settings.turnSecs : d.turnSecs };
      resetSeatNames();
      applyRoster(d.names);
      seatNames[d.yourSeat] = myName();
      s.send({ t: 'iam', name: myName() });        // tell the table who just sat down
      newGame(gameOpts, d.yourSeat);
      board.locked = true;
      waitPanel('You are ' + nameOf(d.yourSeat) + ' — waiting for the table to fill');
      armStartTimeout();
      if (s.matched) s.matched();
      return;
    }
    if (d.t === 'lobby' && !isHost) {
      waitPanel('Waiting — ' + d.have + ' of ' + d.need + ' players here');
      sysChat(d.have + ' of ' + d.need + ' players here.');
      armStartTimeout();                 // progress means the table is alive
      return;
    }
    if (d.t === 'full' && !isHost) {
      if (session) { session.close(); session = null; }
      mode = 'none'; state = null;
      showLobby('choose');
      status('That table filled up just before you arrived. Try again.', 'err');
      return;
    }
    if (d.t === 'start' && !isHost) {
      revealBoard();
      sysChat('Everyone is here — game on.');
      status('Game on. You are ' + nameOf(mySeat) + '.', 'good');
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
    if (d.t === 'chat' && isHost) {
      var cseat = seatOf.get(conn);
      if (cseat === undefined) return;                 // not a seated player
      var ctext = cleanChat(d.text);
      if (!ctext) return;
      var now = Date.now();
      if (now - (chatLastAt[cseat] || 0) < 400) return; // flood guard
      chatLastAt[cseat] = now;
      addChat('say', cseat, ctext);
      s.broadcast({ t: 'say', seat: cseat, text: ctext });
      return;
    }
    if (d.t === 'iam' && isHost) {
      var iseat = seatOf.get(conn);
      if (iseat === undefined) return;
      seatNames[iseat] = cleanName(d.name) || R.SEAT_NAMES[iseat];
      s.broadcast({ t: 'roster', names: seatNames });
      updatePanel();
      return;
    }
    if (d.t === 'roster' && !isHost) {
      applyRoster(d.names);
      if (mySeat !== null) seatNames[mySeat] = myName();
      updatePanel();
      return;
    }
    if (d.t === 'say') {
      var stext = cleanChat(d.text);
      if (stext) addChat('say', d.seat, stext);
      return;
    }
    if (d.t === 'pass' && !isHost) {
      if (!state || state.result || d.ply !== state.ply) return;
      applyPass(d.seat);
      return;
    }
    if (d.t === 'reject' && !isHost) { busy = false; status('That move was rejected.', 'err'); return; }
    if (d.t === 'gone') {
      if (isHost) return;
      R.resignSeat(state, d.seat, 'left');
      board.render(state); updatePanel();
      status(nameOf(d.seat) + ' left the game.', 'err');
      sysChat(nameOf(d.seat) + ' left the game.');
      if (state.result) endGame(state.result);
      return;
    }
    if (d.t === 'resign') {
      R.resignSeat(state, d.seat, 'resign');
      if (isHost) s.broadcast({ t: 'resign', seat: d.seat }, conn);
      board.render(state); updatePanel();
      if (state.result) endGame(state.result);
      return;
    }
    if (d.t === 'rematch' && !isHost) {
      newGame({ size: 11, seats: gameOpts.seats, seed: d.seed, layouts: gameOpts.layouts,
                turnSecs: gameOpts.turnSecs }, mySeat);
      lastTurnSeat = null; resetTurnClock(); announceTurn();
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
    var nameBox = $('#setName');
    nameBox.value = settings.playerName === 'Player' ? '' : settings.playerName;
    nameBox.placeholder = 'Player';
    nameBox.oninput = function () {
      settings.playerName = cleanName(nameBox.value) || 'Player';
      save();
      // if this is your seat right now, the change should show immediately
      if (state && mySeat !== null) { seatNames[mySeat] = myName(); updatePanel(); }
      if (mode === 'local') { localNames[seatOrder(localCount)[0]] = ''; }
    };

    var limit = $('#setLimit');
    limit.value = String(settings.turnSecs);
    if (limit.value === '') {            // stored value is not one of the options
      limit.value = String(DEFAULTS.turnSecs);
      settings.turnSecs = DEFAULTS.turnSecs;
      save();
    }
    limit.onchange = function () {
      settings.turnSecs = parseInt(limit.value, 10) || 0;
      save();
      if (state && mode === 'local' && gameOpts) { gameOpts.turnSecs = settings.turnSecs; resetTurnClock(); }
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

    $('#btnLocalSetup').onclick = function () { showLobby('local'); buildSeatList(); };
    $('#localSeats2').onclick = function () { localCount = 2; buildSeatList(); };
    $('#localSeats4').onclick = function () { localCount = 4; buildSeatList(); };
    $('#setAutoRotate').checked = !!settings.autoRotate;
    $('#setAutoRotate').onchange = function () {
      settings.autoRotate = $('#setAutoRotate').checked; save();
    };
    $('#startLocal').onclick = function () { startLocal(localCount); };

    function startLocal(n) {
      if (session) { session.close(); session = null; }
      mode = 'local'; isHost = false;
      colors = DEFAULT_COLORS.slice();
      showLobby('none');
      // With nobody human, watch from Amber's side; otherwise start on the
      // first human seat so the phone is already the right way up.
      var order = seatOrder(n), viewer = order[0];
      for (var i = 0; i < order.length; i++) { if (!isAiSeatCfg(order[i])) { viewer = order[i]; break; } }
      resetSeatNames();
      order.forEach(function (seat) {
        seatNames[seat] = isAiSeatCfg(seat)
          ? 'Computer'
          : (cleanName(localNames[seat]) || defaultSeatName(seat, order));
      });
      newGame({ size: 11, seats: n, seed: Net.randomSeed(), turnSecs: settings.turnSecs }, null);
      board.setPerspective(viewer);
      board.locked = false;
      resetTurnClock();
      refreshChatState();
      var humans = 0;
      order.forEach(function (st2) { if (!isAiSeatCfg(st2)) humans++; });
      status(humans === order.length
        ? 'Pass the device around — ' + order.length + ' players.'
        : humans + ' of ' + order.length + ' seats are people; the rest are the computer.', 'good');
      maybeAiMove();
    }
    function isAiSeatCfg(seat) { return String(localSeats[seat] || '').indexOf('ai:') === 0; }

    // in-game controls
    $('#placeBarrier').onclick = function () { board.setPlacing(!board.placing); updatePanel(); };
    $('#rotate').onclick = function () { board.rotate(); };
    $('#resign').onclick = function () {
      if (!state || state.result) return;
      var seat = mySeat === null ? state.toMove : mySeat;
      if (mode !== 'local') session.broadcast ? session.broadcast({ t: 'resign', seat: seat }) : session.send({ t: 'resign', seat: seat });
      R.resignSeat(state, seat, 'resign');
      board.render(state); updatePanel();
      if (state.result) endGame(state.result);
    };
    $('#leave').onclick = leaveGame;

    $('#chatform').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#chatinput');
      sendChat(input.value);
      input.value = '';
      input.focus();
    });
    clearChat();
    refreshChatState();

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
