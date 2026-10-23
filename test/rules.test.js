const assert = require('assert');
const targaryen = require('targaryen');
const rules = require('../firebase/database.rules.json');

const R = 'abcd2345';
const K0 = 'k0k0k0k0k0k0k0k0k0k0', K1 = 'k1k1k1k1k1k1k1k1k1k1';
const meta = { w: 39, h: 32, first: 1, created: 1760000000000 };
const u1 = { uid: 'u1', provider: 'anonymous' }, u2 = { uid: 'u2', provider: 'anonymous' }, u3 = { uid: 'u3', provider: 'anonymous' };

let db = targaryen.database(rules, {}).with({ debug: false });
let n = 0;
const anon = () => targaryen.database(rules, db.snapshot('/').val() || {});
function expect(ok, res, name) {
  n++;
  assert.strictEqual(res.allowed, ok, `${name}: ожидалось ${ok ? 'разрешено' : 'запрещено'}\n${res.info}`);
  if (ok && res.newDatabase) db = res.newDatabase;
  console.log(`ok ${n}: ${name}`);
}

// Создание комнаты одним обновлением
expect(false, anon().update('/', { [`keys/${R}/0`]: K0, [`keys/${R}/1`]: K1, [`rooms/${R}/meta`]: meta }), 'без входа комнату не создать');
expect(true, db.as(u1).update('/', { [`keys/${R}/0`]: K0, [`keys/${R}/1`]: K1, [`rooms/${R}/meta`]: meta }), 'создание комнаты');
expect(false, db.as(u3).write(`/keys/${R}/1`, 'zzzzzzzzzzzzzzzzzzzz'), 'ключ места не перезаписать');
expect(false, db.as(u3).write(`/rooms/${R}/meta`, meta), 'мету не перезаписать');
expect(false, db.as(u3).update('/', { [`keys/zzzz9999/0`]: 'short', [`rooms/zzzz9999/meta`]: meta }), 'короткий ключ не пройдёт');

// Места
expect(false, db.as(u1).write(`/members/${R}/u1/0`, 'wrongwrongwrongwrong'), 'чужой ключ не даёт места');
expect(true, db.as(u1).write(`/members/${R}/u1/0`, K0), 'создатель занимает место 0');
expect(true, db.as(u1).write(`/rooms/${R}/joined/0`, true), 'отметка «подключился» 0');
expect(false, db.as(u2).write(`/rooms/${R}/joined/1`, true), 'без места нельзя отметиться');
expect(false, db.as(u2).write(`/members/${R}/u2/0`, K1), 'ключ места 1 не подходит к месту 0');
expect(false, db.as(u2).write(`/members/${R}/u1/1`, K1), 'нельзя записать место за другого');

// Ходы до прихода соперника
expect(false, db.as(u1).write(`/rooms/${R}/moves/0`, 100), 'без соперника ходить нельзя');
expect(true, db.as(u2).write(`/members/${R}/u2/1`, K1), 'соперник занимает место 1');
expect(true, db.as(u2).write(`/rooms/${R}/joined/1`, true), 'отметка «подключился» 1');
expect(true, db.as(u2).write(`/rooms/${R}/online/1`, true), 'отметка «в сети»');
expect(true, db.as(u2).write(`/rooms/${R}/online/1`, null), 'снятие «в сети»');

// Чтение
expect(true, db.as(u3).read(`/rooms/${R}`), 'зритель видит партию');
expect(false, anon().read(`/rooms/${R}`), 'без входа партию не прочитать');
expect(false, db.as(u3).read(`/keys/${R}`), 'ключи не читаются');
expect(false, db.as(u3).read(`/members/${R}/u1`), 'чужие места не читаются');
expect(true, db.as(u1).read(`/members/${R}/u1`), 'свои места читаются');
expect(false, db.as(u3).read(`/rooms`), 'список комнат не читается');

// Ходы
expect(true, db.as(u2).write(`/rooms/${R}/moves/0`, 100), 'ход синих');
expect(false, db.as(u1).write(`/rooms/${R}/moves/0`, 101), 'ход не перезаписать');
expect(false, db.as(u2).write(`/rooms/${R}/moves/0`, null), 'ход не удалить');
expect(false, db.as(u3).write(`/rooms/${R}/moves/1`, 101), 'зритель не ходит');
expect(false, db.as(u1).write(`/rooms/${R}/moves/1`, 5000), 'точка за полем');
expect(false, db.as(u1).write(`/rooms/${R}/moves/1`, 'x'), 'ход — только число');
expect(false, db.as(u1).write(`/rooms/${R}/moves/abc`, 1), 'номер хода — только цифры');
expect(true, db.as(u1).write(`/rooms/${R}/moves/1`, 101), 'ход красных');
expect(false, db.as(u1).write(`/rooms/${R}/hack`, 1), 'лишние ветки запрещены');
expect(false, db.as(u1).write(`/rooms/${R}`, null), 'партию не удалить');

// Подсчёт по договорённости
expect(true, db.as(u1).write(`/rooms/${R}/agree/0`, 2), 'красные предлагают подсчёт');
expect(false, db.as(u1).write(`/rooms/${R}/agree/1`, 2), 'нельзя согласиться за соперника');
expect(false, db.as(u1).write(`/rooms/${R}/end`, { type: 'agree' }), 'без согласия соперника не закончить');
expect(true, db.as(u2).write(`/rooms/${R}/agree/1`, -1), 'соперник отказывается');
expect(false, db.as(u2).write(`/rooms/${R}/end`, { type: 'agree' }), 'отказ не завершает партию');
expect(true, db.as(u2).write(`/rooms/${R}/agree/1`, 2), 'соперник соглашается');

// Сдача: только за себя
expect(false, db.as(u2).write(`/rooms/${R}/end`, { type: 'resign', player: 0 }), 'сдаться можно только за себя');
expect(false, db.as(u3).write(`/rooms/${R}/end`, { type: 'resign', player: 1 }), 'зритель не сдаётся');
const snap = db;
expect(true, db.as(u2).write(`/rooms/${R}/end`, { type: 'resign', player: 1 }), 'синие сдаются');
expect(false, db.as(u1).write(`/rooms/${R}/end`, { type: 'agree' }), 'конец не перезаписать');
expect(false, db.as(u1).write(`/rooms/${R}/moves/2`, 102), 'после конца ходить нельзя');
db = snap;
expect(true, db.as(u1).write(`/rooms/${R}/end`, { type: 'agree' }), 'обоюдный подсчёт завершает партию');

// Один человек на обоих местах (игра на одном телефоне по ссылке)
const R2 = 'qwer6789';
expect(true, db.as(u1).update('/', { [`keys/${R2}/0`]: K0, [`keys/${R2}/1`]: K1, [`rooms/${R2}/meta`]: meta }), 'вторая комната');
expect(true, db.as(u1).write(`/members/${R2}/u1/0`, K0), 'место 0');
expect(true, db.as(u1).write(`/members/${R2}/u1/1`, K1), 'то же устройство на месте 1');
expect(false, db.as(u1).write(`/rooms/BAD-ID/meta`, meta), 'кривой номер комнаты');

// Реванш
expect(false, db.as(u3).write(`/rooms/${R}/next`, { room: 'zxcv1234', key: K1 }), 'зритель не создаёт реванш');
expect(false, db.as(u1).write(`/rooms/${R}/next`, { room: 'BAD', key: K1 }), 'кривой реванш');
expect(true, db.as(u1).write(`/rooms/${R}/next`, { room: 'zxcv1234', key: K1 }), 'реванш');
expect(false, db.as(u2).write(`/rooms/${R}/next`, { room: 'asdf1234', key: K1 }), 'реванш не перезаписать');

// Настройки партии, время ходов и пропуски
const R3 = 'tttt1111', T0 = 1760000000000, TS = { '.sv': 'timestamp' };
const metaT = { w: 39, h: 32, first: 0, created: T0, bonus: true, limit: 30 };
const at = (t) => ({ now: t });
expect(false, db.as(u1).update('/', { [`keys/zzzz0000/0`]: K0, [`keys/zzzz0000/1`]: K1, [`rooms/zzzz0000/meta`]: { ...metaT, limit: 5000 } }), 'лимит больше 59:59 не пройдёт');
expect(false, db.as(u1).update('/', { [`keys/zzzz0001/0`]: K0, [`keys/zzzz0001/1`]: K1, [`rooms/zzzz0001/meta`]: { ...metaT, bonus: 'yes' } }), 'доп. ход — только да/нет');
expect(true, db.as(u1).update('/', { [`keys/${R3}/0`]: K0, [`keys/${R3}/1`]: K1, [`rooms/${R3}/meta`]: metaT }), 'партия с доп. ходом и 0:30 на ход');
expect(true, db.as(u1).write(`/members/${R3}/u1/0`, K0), 'место 0');
expect(true, db.as(u2).write(`/members/${R3}/u2/1`, K1), 'место 1');
expect(false, db.as(u2).update(`/rooms/${R3}`, { 'joined/1': true, started: T0 - 5000, last: T0 }, at(T0)), 'время начала — только серверное');
expect(true, db.as(u2).update(`/rooms/${R3}`, { 'joined/1': true, started: TS, last: TS }, at(T0)), 'соперник сел, часы пошли');
expect(false, db.as(u2).write(`/rooms/${R3}/started`, TS, { now: T0 + 1 }), 'начало партии не перезаписать');
expect(false, db.as(u3).write(`/rooms/${R3}/last`, TS), 'зритель не трогает часы');
expect(false, db.as(u1).write(`/rooms/${R3}/last`, null), 'часы не удалить');
expect(true, db.as(u1).update(`/rooms/${R3}`, { 'moves/0': 100, 'times/0': TS, last: TS }, at(T0 + 12000)), 'ход со временем');
expect(false, db.as(u1).update(`/rooms/${R3}`, { 'times/1': TS }, at(T0 + 13000)), 'время без хода не записать');
expect(false, db.as(u1).update(`/rooms/${R3}`, { 'moves/1': 101, 'times/1': T0 }, at(T0 + 13000)), 'время хода — только серверное');
expect(false, db.as(u1).update(`/rooms/${R3}`, { 'moves/1': -1, 'times/1': TS, last: TS }, at(T0 + 12000 + 20000)), 'рано пропускать: прошло 20 с из 30');
expect(true, db.as(u1).update(`/rooms/${R3}`, { 'moves/1': -1, 'times/1': TS, last: TS }, at(T0 + 12000 + 29000)), 'пропуск по времени (допуск 2 с)');
expect(false, db.as(u1).update(`/rooms/${R3}`, { 'moves/2': -2, 'times/2': TS, last: TS }, at(T0 + 90000)), 'кривой ход');
// В партии без лимита пропусков нет
expect(false, db.as(u1).update(`/rooms/${R2}`, { 'moves/0': -1 }, at(T0 + 999999)), 'без лимита пропуск запрещён');

console.log(`Все ${n} проверок правил пройдены`);
