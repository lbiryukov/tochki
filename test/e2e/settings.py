import re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

# Запуск из корня репозитория: python test/e2e/<скрипт>.py  (перед этим: npm run build)
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-output'
OUT.mkdir(exist_ok=True)
SP = str(OUT)
BASE = 'http://localhost:8787/'
srv = subprocess.Popen(['node', 'mock/server.js'], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(0.8)
errors = []
def mk(b, name, scheme='light'):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=scheme)
    p = ctx.new_page()
    p.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
    p.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' and 'ERR_' not in m.text else None)
    return p
def xy(p, x, y):
    return p.evaluate("([x,y]) => { const r=document.getElementById('cv').getBoundingClientRect(); const [a,b]=__tochki.pt(y*39+x); return [a+r.left,b+r.top]; }", [x, y])
def place(p, x, y):
    c = xy(p, x, y); p.touchscreen.tap(*c); p.wait_for_timeout(60); p.touchscreen.tap(*c)
def g(p, expr): return p.evaluate(expr)
def wait(p, expr, t=8000): p.wait_for_function(expr, timeout=t)
def ok(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: raise SystemExit(1)
MOVES = 'Array.from(__tochki.game.moves).join()'
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        A = mk(b, 'A'); A.goto(BASE)
        wait(A, "!document.getElementById('pane-start').hidden")
        ok(A.is_hidden('#timeRow') and not A.is_checked('#optBonus') and not A.is_checked('#optTimed'), 'A: по умолчанию без доп. хода и без лимита')
        A.click('label[for=optBonus]')
        ok(A.is_checked('#optBonus') and 'ещё раз' in A.inner_text('#optBonusNote'), 'A: включил доп. ход за окружение')
        A.click('label[for=optTimed]'); A.wait_for_timeout(100)
        A.screenshot(path=SP + '/s_start.png')
        A.click('label[for=optTimed]')
        ok(A.is_hidden('#timeRow'), 'A: время на ход снова выключено')
        A.click('#stLink')
        wait(A, "!document.getElementById('pane-invite').hidden && document.getElementById('inviteLink').value.includes('/1/')")
        ok('доп. ход за окружение · без ограничения времени' in A.inner_text('#inviteInfo'), 'A: правила видны при приглашении')
        link = A.input_value('#inviteLink'); A.click('#invClose')

        B = mk(b, 'B'); B.goto(link)
        wait(B, "__tochki.net && __tochki.net.ready && __tochki.net.seat === 1")
        wait(B, "document.getElementById('toast').textContent.includes('Правила партии')")
        ok(True, 'B: при входе видит правила партии: ' + B.inner_text('#toast'))
        wait(A, "__tochki.net.joined[1] === true")
        ok(g(B, '__tochki.game.opts.bonus') is True, 'B: доп. ход включён и у соперника')

        red = [(5, 4), (6, 5), (5, 6), (4, 5)]
        blue = [(5, 5), (30, 1), (30, 3), (30, 5), (30, 7)]
        while red:
            t = g(A, '__tochki.game.turn'); n = g(A, '__tochki.game.moves.length')
            page, plan = (A, red) if t == 0 else (B, blue)
            x, y = plan.pop(0); place(page, x, y)
            wait(A, f'__tochki.game.moves.length === {n + 1}'); wait(B, f'__tochki.game.moves.length === {n + 1}')
            A.wait_for_timeout(150)
        ok(g(A, '__tochki.game.score[0]') == 1, 'красные окружили синюю точку')
        ok(g(A, '__tochki.game.turn') == 0 and g(B, '__tochki.game.turn') == 0, 'доп. ход: снова ходят красные у обоих')
        ok('ход соперника' in B.inner_text('#status'), 'B: видит «ход соперника»')
        n = g(A, '__tochki.game.moves.length'); place(A, 20, 20)
        wait(B, f'__tochki.game.moves.length === {n + 1}')
        ok(g(B, '__tochki.game.turn') == 1, 'после обычного хода очередь синих')
        B.wait_for_timeout(1200); place(B, 33, 12); wait(A, f'__tochki.game.moves.length === {n + 2}')

        A.click('#menuBtn')
        ok('доп. ход за окружение' in A.inner_text('#gameInfo'), 'меню: «Эта партия: …»')
        A.click('#mAgree'); wait(B, "!document.getElementById('offer').hidden"); B.click('#offYes')
        wait(A, '__tochki.game.over'); wait(B, '__tochki.game.over')
        ok(not A.is_hidden('#rStats') and 'В среднем' in A.inner_text('#rStats'), 'статистика времени в конце партии')
        print('     ' + ' | '.join(A.inner_text('#rStats').split('\n')))
        st = g(A, '__tochki.timeStats()')
        total = g(A, '__tochki.game.moves.length')
        ok(st[0]['moves'] == 5 and st[0]['moves'] + st[1]['moves'] == total and st[1]['max'] > 1000, f'ходов: красные {st[0]["moves"]}, синие {st[1]["moves"]} (всего {total}); самый долгий ход синих больше секунды')
        ok('Пропущено' not in A.inner_text('#rStats'), 'без лимита строки о пропусках нет')
        A.screenshot(path=SP + '/s_result.png')

        # ---- партия с лимитом 0:05 ----
        A.click('#rView'); A.click('#menuBtn'); A.click('#mNew')
        A.click('label[for=optBonus]'); A.click('label[for=optTimed]')
        for _ in range(5): A.click('#tSecDec')
        ok(A.input_value('#tMin') == '0' and A.input_value('#tSec') == '05', 'A: выставил 0:05 кнопками')
        A.click('#tSecDec')
        ok(A.input_value('#tSec') == '05', 'меньше 5 секунд не ставится')
        A.fill('#tMin', '2'); A.fill('#tSec', '75'); A.click('#pane-start h2')
        ok(A.input_value('#tSec') == '59' and '2:59' in A.inner_text('#optTimedNote'), 'ручной ввод: 2:75 → 2:59')
        A.fill('#tMin', '0'); A.fill('#tSec', '5'); A.click('#pane-start h2')
        ok('0:05 на ход' in A.inner_text('#optTimedNote'), 'ручной ввод 0:05')
        A.click('#stLink')
        wait(A, "!document.getElementById('pane-invite').hidden && document.getElementById('inviteLink').value.includes('/1/')")
        link2 = A.input_value('#inviteLink'); A.click('#invClose')
        B.goto(link2)
        wait(B, "__tochki.net && __tochki.net.ready && __tochki.net.seat === 1 && __tochki.net.started > 0")
        wait(A, "__tochki.net.joined[1] === true && __tochki.net.lastAt > 0")
        first = g(A, '__tochki.game.first')
        ok(g(B, '__tochki.game.opts.limit') == 5, f'лимит 5 с у обоих, первыми ходят {["красные","синие"][first]}')
        A.wait_for_timeout(2600)
        ok(re.search(r'0:0[1-3]', A.inner_text('#status')) is not None, 'отсчёт идёт: ' + A.inner_text('#status'))
        A.screenshot(path=SP + '/s_timer.png')
        wait(A, '__tochki.game.moves.length >= 1', 6000); wait(B, '__tochki.game.moves.length >= 1', 6000)
        ok(g(A, '__tochki.game.moves[0]') == -1 and g(A, '__tochki.game.turn') == 1 - first, 'время вышло: ход перешёл сопернику')
        mover, other = (A, B) if first == 1 else (B, A)
        # тот, чей сейчас ход, закрывает игру; его ход пропустит телефон соперника
        mover.close()
        t0 = time.time()
        wait(other, '__tochki.game.moves.length >= 2', 12000)
        dt = time.time() - t0
        ok(g(other, '__tochki.game.moves[1]') == -1 and 4.5 < dt < 10, f'ход ушедшего игрока пропустил телефон соперника через {dt:.1f} с')
        # завершаем: оставшийся сдаётся
        other.click('#menuBtn'); other.click('#mResign'); other.click('#cYes')
        wait(other, '__tochki.game.over')
        ok('Пропущено по времени' in other.inner_text('#rStats'), 'в статистике есть строка о пропусках')
        print('     ' + ' | '.join(other.inner_text('#rStats').split('\n')))

        # ---- партия на одном телефоне с лимитом ----
        L = mk(b, 'L', 'dark'); L.goto(BASE)
        wait(L, "!document.getElementById('pane-start').hidden")
        L.click('label[for=optTimed]')
        for _ in range(5): L.click('#tSecDec')
        L.click('#stLocal')
        wait(L, 'document.getElementById("sheet").hidden')
        t1 = g(L, '__tochki.game.turn')
        place(L, 10, 10)
        wait(L, '__tochki.game.moves.length === 1')
        wait(L, '__tochki.game.moves.length === 2', 7000)
        ok(g(L, '__tochki.game.moves[1]') == -1 and g(L, '__tochki.game.turn') == t1, 'на одном телефоне: время вышло, ход перешёл')
        L.click('#menuBtn'); L.wait_for_timeout(6000)
        ok(g(L, '__tochki.game.moves.length') == 2, 'пока открыто меню, часы стоят')
        L.click('#mClose'); L.wait_for_timeout(1500)
        ok(re.search(r'0:0[2-4]', L.inner_text('#status')) is not None, 'после меню отсчёт продолжился: ' + L.inner_text('#status'))
        L.screenshot(path=SP + '/s_local_dark.png')
        L.reload(); wait(L, '__tochki.game && __tochki.game.moves.length === 2')
        ok(g(L, '__tochki.local.times.length') == 2, 'после перезагрузки времена ходов на месте')
        b.close()
finally:
    srv.terminate()
    out = srv.stdout.read()
    denied = [l for l in out.splitlines() if l.startswith('DENIED')]
    print('отказы базы:', len(denied)); [print('   ', l) for l in denied]
    print('ошибки на страницах:', errors if errors else 'нет')
