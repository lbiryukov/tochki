// Заглушка Firebase compat SDK (app/auth/database) поверх подменного сервера.
// Повторяет то, чем пользуется игра: анонимный вход, ref().set/update/remove/once/on/off,
// onDisconnect, .info/connected, ServerValue.TIMESTAMP и локальные события до ответа сервера.
(function () {
  'use strict';
  let local = {}, connected = false, connWaiters = [];
  const listeners = [];
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  function get(obj, p) {
    let o = obj;
    for (const k of parts(p)) { if (o == null || typeof o !== 'object') return null; o = o[k]; }
    return o === undefined ? null : o;
  }
  function setAt(p, val) {
    const ks = parts(p);
    if (!ks.length) { local = clone(val) || {}; return; }
    let o = local;
    for (let i = 0; i < ks.length - 1; i++) {
      if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {};
      o = o[ks[i]];
    }
    if (val === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = clone(val);
  }
  const snap = (v) => ({ val: () => clone(v), exists: () => v != null });
  function fire() {
    for (const l of listeners.slice()) {
      if (l.path === '.info/connected') {
        if (l.last !== connected) { l.last = connected; l.cb(snap(connected)); }
        continue;
      }
      if (l.path === '.info/serverTimeOffset') {
        if (l.last !== 0) { l.last = 0; l.cb(snap(0)); }
        continue;
      }
      if (!l.ready) continue;
      const v = get(local, l.path), s = JSON.stringify(v);
      if (s !== l.last) { l.last = s; l.cb(snap(v)); }
    }
  }
  const es = new EventSource('/__db/events');
  es.onmessage = (e) => {
    local = JSON.parse(e.data) || {};
    connected = true;
    connWaiters.splice(0).forEach((f) => f());
    fire();
  };
  const waitConnected = () => (connected ? Promise.resolve() : new Promise((r) => connWaiters.push(r)));

  // анонимный вход: свой uid на каждую вкладку
  let uid = null;
  try { uid = sessionStorage.getItem('mock-uid'); } catch (e) {}
  const authListeners = [];
  const auth = {
    currentUser: uid ? { uid, isAnonymous: true } : null,
    onAuthStateChanged(cb) {
      authListeners.push(cb);
      setTimeout(() => cb(auth.currentUser), 0);
      return () => { const i = authListeners.indexOf(cb); if (i >= 0) authListeners.splice(i, 1); };
    },
    signInAnonymously() {
      if (!uid) {
        uid = 'u' + Math.random().toString(36).slice(2, 10);
        try { sessionStorage.setItem('mock-uid', uid); } catch (e) {}
      }
      auth.currentUser = { uid, isAnonymous: true };
      setTimeout(() => authListeners.slice().forEach((cb) => cb(auth.currentUser)), 0);
      return Promise.resolve({ user: auth.currentUser });
    },
  };
  const denied = () => { const e = new Error('PERMISSION_DENIED: Permission denied'); e.code = 'PERMISSION_DENIED'; return e; };
  const curUid = () => (auth.currentUser ? auth.currentUser.uid : '');
  const checkRead = (p) => fetch(`/__db/read?uid=${encodeURIComponent(curUid())}&path=${encodeURIComponent('/' + p)}`).then((r) => r.json()).then((r) => r.allowed);

  function resolveSV(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      const o = Array.isArray(v) ? [] : {};
      for (const k of Object.keys(v)) o[k] = resolveSV(v[k]);
      return o;
    }
    return v;
  }
  function write(op, p, value) {
    const local = resolveSV(value);
    if (op === 'set') setAt(p, local);
    else for (const k of Object.keys(local)) setAt(p + '/' + k, local[k]);
    fire();
    return fetch('/__db/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: curUid(), op, path: '/' + p, value }),
    }).then((r) => r.json()).then((r) => {
      if (r.allowed) return;
      return fetch('/__db/dump').then((x) => x.json()).then((d) => { local = d || {}; fire(); throw denied(); });
    });
  }

  function ref(p) {
    p = parts(p).join('/');
    return {
      key: parts(p).pop() || null,
      child: (c) => ref(p + '/' + c),
      set: (v) => write('set', p, v),
      update: (obj) => write('update', p, obj),
      remove: () => write('set', p, null),
      once: () => checkRead(p).then((ok) => { if (!ok) throw denied(); return waitConnected().then(() => snap(get(local, p))); }),
      on(ev, cb, errCb) {
        const info = p.startsWith('.info/');
        const l = { path: p, cb, last: undefined, ready: info };
        listeners.push(l);
        if (info) { fire(); return cb; }
        checkRead(p).then((ok) => {
          if (!ok) { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); if (errCb) errCb(denied()); return; }
          l.ready = true;
          waitConnected().then(fire);
        });
        return cb;
      },
      off(ev, cb) { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === p && (!cb || listeners[i].cb === cb)) listeners.splice(i, 1); },
      onDisconnect: () => ({ remove: () => Promise.resolve(), cancel: () => Promise.resolve(), set: () => Promise.resolve() }),
    };
  }
  const database = () => ({ ref });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  window.firebase = {
    apps: [],
    initializeApp(cfg) { const a = { options: cfg }; this.apps.push(a); return a; },
    app() { return this.apps[0]; },
    auth: () => auth,
    database,
  };
})();
