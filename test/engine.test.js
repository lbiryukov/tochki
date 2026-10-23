const assert = require('assert');
const E = require('../src/engine.js');

const W = 39, H = 32;
const at = (x, y) => y * W + x;

// Строит партию из ходов P (игрок, ходящий первым) и Q, чередуя их
function game(first, seq) {
  const s = E.create(W, H, first);
  for (const [x, y] of seq) {
    const r = E.play(s, at(x, y));
    assert.ok(r.ok, `ход (${x},${y}) отклонён: ${r.reason}`);
  }
  return s;
}

let fillerP = 0, fillerQ = 0;
const fp = () => [36, fillerP++]; // далёкие «пустые» ходы
const fq = () => [38, fillerQ++];
const resetFill = () => { fillerP = 0; fillerQ = 0; };

// 1. Ромб из диагональных связей захватывает точку
resetFill();
let s = game(0, [[5, 4], [5, 5], [6, 5], fq(), [5, 6], fq(), [4, 5]]);
assert.strictEqual(s.score[0], 1, 'ромб должен захватить точку');
assert.strictEqual(s.cap[at(5, 5)], 0);
assert.strictEqual(s.terr[at(5, 5)], 0);
console.log('ok 1: захват ромбом (диагональные связи)');

// 2. Разрыв в две клетки — не окружение, закрытие разрыва — захват
resetFill();
s = game(0, [[4, 4], [5, 5], [5, 4], fq(), [6, 4], fq(), [6, 5], fq(), [6, 6], fq(), [5, 6], fq(), [4, 6]]);
assert.strictEqual(s.score[0], 0, 'кольцо с разрывом не захватывает');
E.play(s, at(...fq()));
assert.ok(E.play(s, at(4, 5)).ok);
assert.strictEqual(s.score[0], 1, 'закрытое кольцо захватывает');
console.log('ok 2: разрыв не считается, закрытие — захват');

// 3. Точку на краю поля окружить нельзя
resetFill();
s = game(0, [[4, 0], [5, 0], [6, 0], fq(), [5, 1], fq(), [4, 1], fq(), [6, 1]]);
assert.strictEqual(s.cap[at(5, 0)], -1, 'край поля не окружается');
assert.strictEqual(s.score[0], 0);
console.log('ok 3: край поля не замыкает окружение');

// 4. В пустой «домик» соперника ставить нельзя, хозяину — можно
resetFill();
s = game(0, [[10, 9], fq(), [11, 10], fq(), [10, 11], fq(), [9, 10]]);
assert.strictEqual(s.turn, 1);
assert.strictEqual(E.whyIllegal(s, 1, at(10, 10)), 'enclosed');
assert.strictEqual(E.whyIllegal(s, 0, at(10, 10)), null);
assert.strictEqual(E.play(s, at(10, 10)).ok, false);
E.play(s, at(...fq()));
assert.ok(E.play(s, at(10, 10)).ok, 'хозяин может ставить в свой домик');
console.log('ok 4: запрет хода в окружённую зону соперника');

// 5. Большое окружение захватывает чужую зону и освобождает свои точки
resetFill();
s = game(0, [[5, 4], [5, 5], [6, 5], fq(), [5, 6], fq(), [4, 5]]);
assert.strictEqual(s.score[0], 1);
const ring = [];
for (let x = 3; x <= 7; x++) ring.push([x, 3]);
for (let y = 4; y <= 7; y++) ring.push([7, y]);
for (let x = 6; x >= 3; x--) ring.push([x, 7]);
for (let y = 6; y >= 4; y--) ring.push([3, y]);
for (let k = 0; k < ring.length; k++) {
  assert.ok(E.play(s, at(...ring[k])).ok, 'кольцо синих');
  if (k < ring.length - 1) assert.ok(E.play(s, at(...fp())).ok, 'ход красных');
}
assert.strictEqual(s.score[1], 4, 'синие захватили 4 красные точки');
assert.strictEqual(s.score[0], 0, 'захват красных аннулирован');
assert.strictEqual(s.cap[at(5, 5)], -1, 'синяя точка освобождена');
assert.strictEqual(s.terr[at(5, 5)], 1);
assert.strictEqual(E.whyIllegal(s, 0, at(4, 4)), 'territory');
console.log('ok 5: перезахват и освобождение точек');

// 6. Сдача и подсчёт по договорённости
s = game(0, [[1, 1]]);
E.finish(s, { type: 'resign', player: 1 });
assert.ok(s.over && s.result.winner === 0);
assert.strictEqual(E.play(s, at(2, 2)).ok, false);
console.log('ok 6: сдача завершает партию');

// 6a. Без настройки окруживший не ходит ещё раз
resetFill();
s = game(0, [[5, 4], [5, 5], [6, 5], fq(), [5, 6], fq(), [4, 5]]);
assert.strictEqual(s.turn, 1, 'без доп. хода ход переходит синим');

// 6b. С настройкой окруживший ходит ещё раз, и цепочка доп. ходов продолжается
resetFill();
s = E.create(W, H, 0, { bonus: true });
for (const [x, y] of [[5, 4], [5, 5], [6, 5], fq(), [5, 6], fq()]) assert.ok(E.play(s, at(x, y)).ok);
let r = E.play(s, at(4, 5));
assert.ok(r.ok && r.extra && r.gained === 1, 'захват даёт доп. ход');
assert.strictEqual(s.turn, 0, 'снова ходят красные');
r = E.play(s, at(20, 20));
assert.ok(r.ok && !r.extra);
assert.strictEqual(s.turn, 1, 'после обычного хода очередь синих');
assert.deepStrictEqual(s.by.slice(-3), [1, 0, 0], 'история ходов: синие, затем два хода красных подряд');
console.log('ok 6b: доп. ход за окружение');

// 6c. Пропуск хода по времени
s = E.create(W, H, 1, { limit: 30 });
r = E.play(s, E.PASS);
assert.ok(r.ok && r.pass && s.turn === 0 && s.moves[0] === E.PASS && s.by[0] === 1, 'пропуск синих');
assert.ok(E.play(s, at(3, 3)).ok && s.turn === 1);
const rp6 = E.replay(W, H, 1, s.moves, null, s.opts);
assert.deepStrictEqual([rp6.turn, ...rp6.by], [1, 1, 0], 'replay с пропуском');
E.finish(s, { type: 'agree' });
assert.strictEqual(E.play(s, E.PASS).ok, false, 'после конца пропуск невозможен');
console.log('ok 6c: пропуск хода по времени');

// 7. Случайные партии до конца: инварианты и воспроизводимость
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function check(s) {
  const n = s.W * s.H;
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    if (s.cap[i] !== -1) {
      assert.ok(s.owner[i] !== -1 && s.owner[i] !== s.cap[i], 'захвачена только чужая точка');
      assert.strictEqual(s.terr[i], s.cap[i], 'захваченная точка на территории захватчика');
      s.cap[i] === 0 ? a++ : b++;
    }
  }
  assert.deepStrictEqual(s.score, [a, b], 'счёт совпадает');
  for (const p of [0, 1]) {
    const out = E.outside(s, p);
    for (let i = 0; i < n; i++) assert.ok(!(E.live(s, i, 1 - p) && !out[i]), 'нет незахваченных окружённых точек');
  }
}
let games = 0, totalCaptures = 0, passes = 0;
let extras = 0, timeouts = 0;
for (const [w, h, runs] of [[6, 6, 60], [10, 8, 40], [39, 32, 4]]) {
  for (let r = 0; r < runs; r++) {
    const rand = rng(1000 * w + r);
    const gopts = { bonus: r % 2 === 1, limit: r % 3 === 0 ? 30 : 0 };
    const g = E.create(w, h, rand() < 0.5 ? 0 : 1, gopts);
    let guard = 0;
    while (!g.over) {
      const m = E.legalMask(g, g.turn), opts = [];
      for (let i = 0; i < m.length; i++) if (m[i]) opts.push(i);
      assert.ok(opts.length > 0, 'у ходящего есть ходы');
      const before = g.turn;
      const pass = gopts.limit && rand() < 0.05;
      const res = E.play(g, pass ? E.PASS : opts[Math.floor(rand() * opts.length)]);
      assert.ok(res.ok);
      if (pass) timeouts++;
      if (res.regions.length) totalCaptures++;
      if (res.passed) passes++;
      if (res.extra) { extras++; assert.ok(gopts.bonus && g.turn === before, 'доп. ход только с настройкой'); }
      if (!gopts.bonus && !res.passed && !g.over) assert.strictEqual(g.turn, 1 - before, 'без настройки ходы чередуются');
      assert.strictEqual(g.by.length, g.moves.length);
      if (w < 20) check(g);
      assert.ok(++guard <= w * h * 2, 'партия конечна');
    }
    check(g);
    assert.ok(!E.hasLegal(g, 0) && !E.hasLegal(g, 1));
    const rp = E.replay(w, h, g.first, g.moves, null, g.opts);
    assert.deepStrictEqual([...rp.owner, ...rp.cap, ...rp.terr, ...rp.by], [...g.owner, ...g.cap, ...g.terr, ...g.by], 'replay совпадает');
    games++;
  }
}
console.log(`ok 7: ${games} случайных партий, захватов: ${totalCaptures}, доп. ходов: ${extras}, пропусков по времени: ${timeouts}, пропусков без ходов: ${passes}`);
console.log('Все тесты пройдены');
