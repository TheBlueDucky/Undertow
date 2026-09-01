/* Undertow - net.js
 * Peer-to-peer transport over PeerJS. The broker is only used to introduce
 * the two players; once connected, moves travel directly between them.
 * Every received move is re-derived from the local rule engine, so a
 * tampered peer cannot inject an illegal move - it just gets rejected.
 */
(function (root) {
  'use strict';

  var PREFIX = 'undertow-v1-';
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

  // crypto is available on file:// in every current browser, but fall back to
  // Math.random rather than throw if some context does not expose it.
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

  function randomSeed() {
    return fill(new Uint32Array(1))[0] >>> 0;
  }

  function available() { return typeof root.Peer !== 'undefined'; }

  function makeSession(handlers) {
    var h = handlers || {};
    var s = {
      peer: null, conn: null, code: null,
      isHost: false, open: false, closed: false
    };

    s.send = function (obj) {
      if (s.conn && s.open) { try { s.conn.send(obj); } catch (e) { /* channel gone */ } }
    };

    s.close = function () {
      s.closed = true; s.open = false;
      try { if (s.conn) s.conn.close(); } catch (e) {}
      try { if (s.peer) s.peer.destroy(); } catch (e) {}
    };

    s.bindConn = function (conn) {
      s.conn = conn;
      conn.on('open', function () {
        s.open = true;
        if (h.onOpen) h.onOpen(s);
      });
      conn.on('data', function (d) {
        if (h.onData && d && typeof d === 'object') h.onData(d, s);
      });
      conn.on('close', function () {
        s.open = false;
        if (!s.closed && h.onClose) h.onClose(s);
      });
      conn.on('error', function (e) {
        if (h.onError) h.onError(describe(e), s);
      });
    };

    return s;
  }

  function describe(e) {
    if (!e) return 'Unknown connection error.';
    var t = e.type || e.name || '';
    if (t === 'peer-unavailable') return 'No room with that code. Check the letters and that the host is still waiting.';
    if (t === 'network') return 'Lost contact with the matchmaking broker. Check your connection.';
    if (t === 'browser-incompatible') return 'This browser does not support the peer-to-peer connection this game needs.';
    if (t === 'unavailable-id') return 'That room code is already taken.';
    if (t === 'webrtc') return 'The direct connection failed. A strict firewall or VPN can block this.';
    if (t === 'server-error') return 'The matchmaking broker is not responding right now.';
    return e.message || String(t) || 'Connection error.';
  }

  /* ---- host ---- */
  function host(handlers) {
    var h = handlers || {};
    if (!available()) { if (h.onError) h.onError('Could not load the peer-to-peer library. Check your internet connection and reload.'); return null; }
    var s = makeSession(h);
    s.isHost = true;
    var attempts = 0;

    function tryOpen() {
      attempts++;
      s.code = randomCode(5);
      var peer = new root.Peer(PREFIX + s.code, { debug: 0 });
      s.peer = peer;

      peer.on('open', function () {
        if (h.onReady) h.onReady(s.code, s);
      });
      peer.on('connection', function (conn) {
        if (s.conn) { try { conn.close(); } catch (e) {} return; } // one guest only
        s.bindConn(conn);
      });
      peer.on('error', function (e) {
        if (e && e.type === 'unavailable-id' && attempts < 5) {
          try { peer.destroy(); } catch (x) {}
          tryOpen();
          return;
        }
        if (h.onError) h.onError(describe(e), s);
      });
      peer.on('disconnected', function () {
        if (!s.closed && !s.open && h.onError) h.onError('Disconnected from the broker before anyone joined.', s);
      });
    }

    tryOpen();
    return s;
  }

  /* ---- guest ---- */
  function join(code, handlers) {
    var h = handlers || {};
    if (!available()) { if (h.onError) h.onError('Could not load the peer-to-peer library. Check your internet connection and reload.'); return null; }
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { if (h.onError) h.onError('A room code is 5 letters and numbers.'); return null; }

    var s = makeSession(h);
    s.code = code;
    var peer = new root.Peer({ debug: 0 });
    s.peer = peer;

    var timer = setTimeout(function () {
      if (!s.open && !s.closed && h.onError) h.onError('The host did not answer. They may have closed the room.', s);
    }, 20000);

    peer.on('open', function () {
      if (h.onReady) h.onReady(code, s);
      s.bindConn(peer.connect(PREFIX + code, { reliable: true, serialization: 'json' }));
    });
    peer.on('error', function (e) {
      clearTimeout(timer);
      if (h.onError) h.onError(describe(e), s);
    });

    var origOpen = h.onOpen;
    h.onOpen = function (sess) { clearTimeout(timer); if (origOpen) origOpen(sess); };

    return s;
  }

  root.UT = root.UT || {};
  root.UT.Net = {
    host: host, join: join, available: available,
    randomCode: randomCode, randomSeed: randomSeed, PREFIX: PREFIX
  };
})(typeof window !== 'undefined' ? window : globalThis);
