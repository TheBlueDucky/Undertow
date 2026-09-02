/* Undertow - net.js  (v2)
 * Peer-to-peer transport over PeerJS. The broker only introduces players;
 * once connected, moves travel directly between browsers.
 *
 * Quick Match with no server:
 *   A player looking for a game first tries to CONNECT to a well-known name
 *   ("NormalMatch"). If someone answers, they are matched. If nobody does,
 *   they REGISTER that name themselves and wait.
 *
 *   The waiter cannot simply play on that name: releasing it later would kill
 *   the game, and holding it would block everyone else. So the waiter runs a
 *   throwaway BEACON peer under the well-known name alongside its own private
 *   peer. The beacon hands each arrival the private id, and once the table is
 *   full the beacon is destroyed, freeing the name for the next group.
 *
 * The host is authoritative: guests send an intent, the host validates it
 * against its own rule engine and broadcasts the result. Everyone re-derives
 * every move locally, so a tampered client cannot inject an illegal position.
 */
(function (root) {
  'use strict';

  // Bumped when the handshake changes. Old clients must never share a beacon
  // name with new ones - their seat accounting differs and the table deadlocks.
  var PREFIX = 'undertow-v3-';
  var BEACON = { 2: PREFIX + 'NormalMatch', 4: PREFIX + 'NormalMatch4' };
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  var SEEK_TIMEOUT = 5000;
  var JOIN_TIMEOUT = 20000;
  // One id per page load. A beacon stamps it on the handshake so a tab can
  // never be matched against its own beacon (e.g. two Quick Match clicks).
  var TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

  function fill(arr) {
    var c = root.crypto || root.msCrypto;
    if (c && c.getRandomValues) { c.getRandomValues(arr); return arr; }
    for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 4294967296);
    return arr;
  }
  function randomCode(n) {
    var s = '', a = fill(new Uint8Array(n || 5));
    for (var i = 0; i < a.length; i++) s += ALPHABET.charAt(a[i] % ALPHABET.length);
    return s;
  }
  function randomSeed() { return fill(new Uint32Array(1))[0] >>> 0; }
  function available() { return typeof root.Peer !== 'undefined'; }

  function describe(e) {
    if (!e) return 'Unknown connection error.';
    var t = e.type || e.name || '';
    if (t === 'peer-unavailable') return 'No room with that code. Check the letters and that the host is still waiting.';
    if (t === 'network') return 'Lost contact with the matchmaking broker. Check your connection.';
    if (t === 'browser-incompatible') return 'This browser cannot make the peer-to-peer connection this game needs.';
    if (t === 'unavailable-id') return 'That room code is already taken.';
    if (t === 'webrtc') return 'The direct connection failed. A strict firewall or VPN can block this.';
    if (t === 'server-error') return 'The matchmaking broker is not responding right now.';
    return e.message || String(t) || 'Connection error.';
  }

  /* ================= session ================= */
  function Session(h) {
    this.h = h || {};
    this.peer = null;
    this.beacon = null;
    this.conns = [];
    this.isHost = false;
    this.closed = false;
    this.code = null;
    this.capacity = 1;
    this.started = false;
  }

  Session.prototype.broadcast = function (obj, except) {
    for (var i = 0; i < this.conns.length; i++) {
      var c = this.conns[i];
      if (c === except || !c.open) continue;
      try { c.send(obj); } catch (e) { /* channel gone */ }
    }
  };
  Session.prototype.send = function (obj) {
    // guests have exactly one connection: the host
    if (this.conns[0] && this.conns[0].open) {
      try { this.conns[0].send(obj); } catch (e) {}
    }
  };
  Session.prototype.close = function () {
    this.closed = true;
    var i;
    for (i = 0; i < this.conns.length; i++) { try { this.conns[i].close(); } catch (e) {} }
    try { if (this.beacon) this.beacon.destroy(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.conns = [];
  };
  Session.prototype.dropBeacon = function () {
    if (!this.beacon) return;
    try { this.beacon.destroy(); } catch (e) {}
    this.beacon = null;
  };

  Session.prototype.bind = function (conn, isGuestOfMine) {
    var s = this, h = s.h;
    conn.on('open', function () {
      if (isGuestOfMine) {
        if (s.conns.length >= s.capacity) { try { conn.send({ t: 'full' }); conn.close(); } catch (e) {} return; }
        s.conns.push(conn);
        // The table is full only once real connections have landed. Retire the
        // beacon here, never when an invitation is merely handed out.
        if (s.conns.length >= s.capacity) s.dropBeacon();
        if (h.onGuest) h.onGuest(conn, s.conns.length, s);
      } else {
        s.conns.push(conn);
        if (h.onOpen) h.onOpen(s);
      }
    });
    conn.on('data', function (d) { if (h.onData && d && typeof d === 'object') h.onData(d, conn, s); });
    conn.on('close', function () {
      var i = s.conns.indexOf(conn);
      if (i >= 0) s.conns.splice(i, 1);
      // Someone left before kick-off: put the table back on the board.
      if (!s.closed && !s.started && s.openBeacon && s.conns.length < s.capacity) s.openBeacon();
      if (!s.closed && h.onPeerGone) h.onPeerGone(conn, s);
    });
    conn.on('error', function () { /* surfaced via close */ });
  };

  /* ================= hosting a coded room ================= */
  function host(opts, handlers) {
    var h = handlers || {};
    if (!available()) { if (h.onError) h.onError('Could not load the peer-to-peer library. Check your internet connection and reload.'); return null; }
    var s = new Session(h);
    s.isHost = true;
    s.capacity = opts.capacity || 1;
    var attempts = 0;

    function tryOpen() {
      attempts++;
      s.code = randomCode(5);
      var peer = new root.Peer(PREFIX + s.code, { debug: 0 });
      s.peer = peer;
      peer.on('open', function () { if (h.onReady) h.onReady(s.code, s); });
      peer.on('connection', function (c) { s.bind(c, true); });
      peer.on('error', function (e) {
        if (e && e.type === 'unavailable-id' && attempts < 5) {
          try { peer.destroy(); } catch (x) {}
          tryOpen(); return;
        }
        if (h.onError) h.onError(describe(e), s);
      });
    }
    tryOpen();
    return s;
  }

  /* ================= joining a coded room ================= */
  function join(code, handlers) {
    var h = handlers || {};
    if (!available()) { if (h.onError) h.onError('Could not load the peer-to-peer library. Check your internet connection and reload.'); return null; }
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { if (h.onError) h.onError('A room code is 5 letters and numbers.'); return null; }

    var s = new Session(h);
    s.code = code;
    var peer = new root.Peer({ debug: 0 });
    s.peer = peer;
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled && !s.closed && h.onError) h.onError('The host did not answer. They may have closed the room.', s);
    }, JOIN_TIMEOUT);

    var origOpen = h.onOpen;
    h.onOpen = function (sess) { settled = true; clearTimeout(timer); if (origOpen) origOpen(sess); };

    peer.on('open', function () { s.bind(peer.connect(PREFIX + code, { reliable: true, serialization: 'json' }), false); });
    peer.on('error', function (e) {
      if (e && e.type === 'peer-unavailable') { clearTimeout(timer); }
      if (h.onError) h.onError(describe(e), s);
    });
    return s;
  }

  /* ================= quick match ================= */
  /* seats = 2 or 4. Resolves into either a host session or a guest session. */
  function quickMatch(seats, handlers) {
    var h = handlers || {};
    if (!available()) { if (h.onError) h.onError('Could not load the peer-to-peer library. Check your internet connection and reload.'); return null; }
    var name = BEACON[seats] || BEACON[2];
    var capacity = seats === 4 ? 3 : 1;

    var s = new Session(h);
    s.capacity = capacity;
    var rounds = 0, done = false, phase = 'idle', probeTimer = null, answered = false;

    // our own private peer, used either to reach a waiter or to be reached
    var peer = new root.Peer({ debug: 0 });
    s.peer = peer;
    peer.on('open', function () { seek(); });
    peer.on('connection', function (c) { s.bind(c, true); });   // used once we are the waiter
    peer.on('error', function (e) {
      if (done || s.closed) return;
      // "nobody is waiting under that name" arrives here, not on the connection,
      // and it is the normal case - it means the slot is ours to take.
      if (e && e.type === 'peer-unavailable') {
        if (phase === 'seeking' && !answered) { answered = true; clearTimeout(probeTimer); becomeWaiter(); }
        return;
      }
      if (h.onError) h.onError(describe(e), s);
    });

    // Step 1: is anyone already waiting under the well-known name?
    function seek() {
      if (done || s.closed) return;
      rounds++;
      if (rounds > 4) { if (h.onError) h.onError('Could not find or open a match. Try again, or use a room code.', s); return; }
      phase = 'seeking'; answered = false;
      if (h.onStatus) h.onStatus('Looking for an opponent');

      var probe = peer.connect(name, { reliable: true, serialization: 'json' });
      probeTimer = setTimeout(function () {
        if (answered || done) return;
        answered = true;
        try { probe.close(); } catch (e) {}
        becomeWaiter();                       // nobody home - take the name
      }, SEEK_TIMEOUT);

      probe.on('data', function (d) {
        if (answered || !d) return;
        if (d.t === 'go') {
          answered = true; clearTimeout(probeTimer);
          try { probe.close(); } catch (e) {}
          // never match a tab against its own beacon
          if (d.tab === TAB_ID || d.host === peer.id) {
            if (h.onError) h.onError('You are already waiting for a game in this tab.', s);
            return;
          }
          connectToHost(d.host);
        } else if (d.t === 'full') {
          answered = true; clearTimeout(probeTimer);
          try { probe.close(); } catch (e) {}
          setTimeout(seek, 400);              // that table filled up; look again
        }
      });
      probe.on('error', function () {
        if (answered || done) return;
        answered = true; clearTimeout(probeTimer);
        becomeWaiter();
      });
    }

    // Step 2a: nobody waiting - register the well-known name as a beacon.
    function becomeWaiter() {
      if (done || s.closed || s.beacon) return;
      phase = 'waiting';
      var b;
      try { b = new root.Peer(name, { debug: 0 }); } catch (e) { setTimeout(seek, 300); return; }
      s.beacon = b;
      s.isHost = true;

      b.on('open', function () {
        if (h.onStatus) h.onStatus(seats === 4 ? 'Waiting for three more players' : 'Waiting for an opponent');
        if (h.onWaiting) h.onWaiting(s);
      });
      // Invite anyone while a real seat is still open. Over-inviting is safe:
      // a latecomer is simply told the table is full and goes back to looking.
      // Under-inviting is not - it strands the table forever.
      b.on('connection', function (c) {
        c.on('open', function () {
          var full = s.conns.length >= s.capacity;
          try { c.send(full ? { t: 'full' } : { t: 'go', host: peer.id, tab: TAB_ID }); } catch (e) {}
          setTimeout(function () { try { c.close(); } catch (e) {} }, 1500);
        });
      });
      b.on('error', function (e) {
        // someone claimed the name a moment before us - go back to seeking
        s.beacon = null;
        if (e && e.type === 'unavailable-id') { s.isHost = false; setTimeout(seek, 200 + Math.random() * 400); return; }
        if (h.onError) h.onError(describe(e), s);
      });
    }
    s.openBeacon = becomeWaiter;

    // Step 2b: someone was waiting - connect to their private peer and play.
    function connectToHost(hostId) {
      if (done || s.closed) return;
      done = true; phase = 'playing';
      s.isHost = false;
      if (h.onStatus) h.onStatus('Opponent found, connecting');
      s.bind(peer.connect(hostId, { reliable: true, serialization: 'json' }), false);
    }

    s.matched = function () { done = true; };
    return s;
  }

  root.UT = root.UT || {};
  root.UT.Net = {
    host: host, join: join, quickMatch: quickMatch, available: available,
    randomCode: randomCode, randomSeed: randomSeed, describe: describe,
    PREFIX: PREFIX, BEACON: BEACON
  };
})(typeof window !== 'undefined' ? window : globalThis);
