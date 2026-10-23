/* Точки — игровой движок.
 * Состояние партии полностью определяется (W, H, first, moves, end):
 * moves — список индексов точек (y * W + x), игроки чередуются автоматически
 * (с учётом пропуска хода, если у игрока нет допустимых ходов).
 * Игроки: 0 — красные, 1 — синие.
 *
 * Правила:
 *  - точку можно ставить на свободное пересечение вне захваченных зон;
 *  - нельзя ставить внутрь зоны, окружённой живыми точками соперника ("домик");
 *  - окружение считается замкнутым, если из зоны нельзя выйти к краю поля,
 *    двигаясь по горизонтали/вертикали и не наступая на живые точки окружающего
 *    (это эквивалентно цепи, где соседние точки стоят по горизонтали, вертикали или диагонали);
 *  - зона захватывается, если внутри есть живые точки соперника; очки — только за захваченные точки;
 *  - если окружают зону, в которой ранее были захвачены свои точки, они освобождаются;
 *  - опция bonus: окруживший точки соперника ходит ещё раз;
 *  - ход PASS (-1) — пропуск хода, когда вышло время на ход.
 */
(function (root, factory) {
  const E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.DotsEngine = E;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PASS = -1;

  function create(W, H, first, opts) {
    const n = W * H;
    return {
      W, H, first: first | 0,
      opts: { bonus: !!(opts && opts.bonus), limit: (opts && opts.limit > 0) ? +opts.limit : 0 },
      moves: [], by: [], end: null,
      owner: new Int8Array(n).fill(-1), // кто поставил точку
      cap: new Int8Array(n).fill(-1),   // кем захвачена точка (-1 — живая)
      terr: new Int8Array(n).fill(-1),  // чья захваченная территория
      score: [0, 0], turn: first | 0, last: -1,
      over: false, result: null,
    };
  }

  const live = (s, i, p) => s.owner[i] === p && s.cap[i] === -1;

  // 1 — точка достижима с края поля, не проходя через живые точки игрока p
  function outside(s, p) {
    const W = s.W, H = s.H, n = W * H;
    const out = new Uint8Array(n), st = new Int32Array(n);
    let sp = 0;
    const push = (i) => { if (!out[i] && !live(s, i, p)) { out[i] = 1; st[sp++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 1; y < H - 1; y++) { push(y * W); push(y * W + W - 1); }
    while (sp) {
      const i = st[--sp], x = i % W;
      if (x > 0) push(i - 1);
      if (x < W - 1) push(i + 1);
      if (i >= W) push(i - W);
      if (i < n - W) push(i + W);
    }
    return out;
  }

  function whyIllegal(s, p, i) {
    if (s.over) return 'over';
    if (!(Number.isInteger(i) && i >= 0 && i < s.W * s.H)) return 'bounds';
    if (s.owner[i] !== -1) return 'occupied';
    if (s.terr[i] !== -1) return 'territory';
    if (!outside(s, 1 - p)[i]) return 'enclosed';
    return null;
  }

  function legalMask(s, p) {
    const n = s.W * s.H, o = outside(s, 1 - p), m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = (s.owner[i] === -1 && s.terr[i] === -1 && o[i]) ? 1 : 0;
    return m;
  }

  function hasLegal(s, p) {
    const n = s.W * s.H, o = outside(s, 1 - p);
    for (let i = 0; i < n; i++) if (s.owner[i] === -1 && s.terr[i] === -1 && o[i]) return true;
    return false;
  }

  function capture(s, p) {
    const W = s.W, n = W * s.H, q = 1 - p;
    const out = outside(s, p), seen = new Uint8Array(n), regions = [];
    for (let i0 = 0; i0 < n; i0++) {
      if (out[i0] || seen[i0] || live(s, i0, p)) continue;
      const comp = [i0];
      seen[i0] = 1;
      let enemy = false;
      for (let k = 0; k < comp.length; k++) {
        const i = comp[k], x = i % W;
        if (live(s, i, q)) enemy = true;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < n - W ? i + W : -1];
        for (const j of nb) if (j >= 0 && !seen[j] && !live(s, j, p)) { seen[j] = 1; comp.push(j); }
      }
      if (!enemy) continue; // пустой «домик» — не захват
      for (const i of comp) {
        if (s.owner[i] === q && s.cap[i] === -1) s.cap[i] = p;
        else if (s.owner[i] === p && s.cap[i] === q) s.cap[i] = -1;
        s.terr[i] = p;
      }
      regions.push(comp);
    }
    return regions;
  }

  function recount(s) {
    let a = 0, b = 0;
    for (let i = 0; i < s.cap.length; i++) {
      if (s.cap[i] === 0) a++;
      else if (s.cap[i] === 1) b++;
    }
    s.score[0] = a;
    s.score[1] = b;
  }

  const scoreWinner = (s) => (s.score[0] > s.score[1] ? 0 : s.score[1] > s.score[0] ? 1 : -1);

  // Передать ход: сопернику, если у него есть ходы; иначе снова себе; иначе конец партии
  function nextTurn(s, p, keep) {
    if (keep && hasLegal(s, p)) { s.turn = p; return 'extra'; }
    if (hasLegal(s, 1 - p)) { s.turn = 1 - p; return null; }
    if (hasLegal(s, p)) { s.turn = p; return 'passed'; }
    s.over = true;
    s.result = { reason: 'full', winner: scoreWinner(s) };
    return null;
  }

  function play(s, i) {
    const p = s.turn;
    if (i === PASS) {
      if (s.over) return { ok: false, reason: 'over' };
      s.moves.push(PASS);
      s.by.push(p);
      const t = nextTurn(s, p, false);
      return { ok: true, player: p, pass: true, regions: [], passed: t === 'passed', extra: false, gained: 0, freed: 0 };
    }
    const why = whyIllegal(s, p, i);
    if (why) return { ok: false, reason: why };
    s.owner[i] = p;
    s.moves.push(i);
    s.by.push(p);
    s.last = i;
    const before = s.score[p], beforeOpp = s.score[1 - p];
    const regions = capture(s, p);
    recount(s);
    const t = nextTurn(s, p, s.opts.bonus && regions.length > 0);
    return {
      ok: true, player: p, regions, passed: t === 'passed', extra: t === 'extra',
      gained: s.score[p] - before, freed: beforeOpp - s.score[1 - p],
    };
  }

  // end: { type: 'resign', player } | { type: 'agree' }
  function finish(s, end) {
    if (s.over) return false;
    s.end = end;
    s.over = true;
    s.result = end.type === 'resign'
      ? { reason: 'resign', winner: 1 - end.player, loser: end.player }
      : { reason: 'agree', winner: scoreWinner(s) };
    return true;
  }

  function replay(W, H, first, moves, end, opts) {
    const s = create(W, H, first, opts);
    for (const i of moves || []) {
      const r = play(s, i);
      if (!r.ok) throw new Error('Некорректный ход ' + i + ': ' + r.reason);
    }
    if (end) finish(s, end);
    return s;
  }

  return { PASS, create, play, finish, replay, whyIllegal, legalMask, hasLegal, outside, live };
});
