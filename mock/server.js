// Подменная Realtime Database для проверки: хранит данные в памяти,
// каждую запись и чтение проверяет настоящими правилами (database.rules.json),
// изменения рассылает подписчикам через Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const targaryen = require('targaryen');
const rules = require('../firebase/database.rules.json');

let data = {};
const clients = new Set();
const PORT = +process.env.PORT || 8787;
const WWW = path.join(__dirname, 'www');

const auth = (uid) => (uid ? { uid, provider: 'anonymous' } : null);
const dbAs = (uid) => targaryen.database(rules, data).as(auth(uid));

function resolveSV(v) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return Date.now();
    const o = Array.isArray(v) ? [] : {};
    for (const k of Object.keys(v)) o[k] = resolveSV(v[k]);
    return o;
  }
  return v;
}
function json(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function broadcast() { const msg = `data: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); }

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/__db/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (u.pathname === '/__db/read') {
    const r = dbAs(u.searchParams.get('uid')).read(u.searchParams.get('path') || '/');
    json(res, { allowed: r.allowed });
    return;
  }
  if (u.pathname === '/__db/dump') { json(res, data); return; }
  if (u.pathname === '/__db/write' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { uid, op, path: p, value } = JSON.parse(body);
      const db = dbAs(uid);
      // серверные метки времени ({'.sv':'timestamp'}) подставляет сам проверяющий правила
      const r = op === 'update' ? db.update(p || '/', value) : db.write(p || '/', value);
      if (r.allowed) { data = r.newDatabase.snapshot('/').val() || {}; broadcast(); }
      else console.log('DENIED', uid, op, p, JSON.stringify(value).slice(0, 120));
      json(res, { allowed: r.allowed });
    });
    return;
  }
  const file = path.join(WWW, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('mock db on', PORT));
