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
def mk(b, name):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    p = ctx.new_page()
    p.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
    p.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' and 'fonts' not in m.text and 'ERR_' not in m.text else None)
    return p
def xy(p, x, y):
    return p.evaluate("([x,y]) => { const r=document.getElementById('cv').getBoundingClientRect(); const [a,b]=__tochki.pt(y*39+x); return [a+r.left,b+r.top]; }", [x, y])
def place(p, x, y):
    c = xy(p, x, y); p.touchscreen.tap(*c); p.wait_for_timeout(60); p.touchscreen.tap(*c)
def g(p, expr): return p.evaluate(expr)
def wait(p, expr, t=5000): p.wait_for_function(expr, timeout=t)
def ok(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: raise SystemExit(1)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        A = mk(b, 'A'); A.goto(BASE)
        wait(A, "!document.getElementById('pane-start').hidden")
        ok(True, 'A: стартовый экран «Как играем?»')
        A.click('#stLink')
        wait(A, "!document.getElementById('pane-invite').hidden && document.getElementById('inviteLink').value.includes('/1/')")
        link = A.input_value('#inviteLink')
        ok(re.match(r'^http://localhost:8787/#[a-z0-9]{10}/1/[a-z0-9]{20}$', link) is not None, f'A: ссылка для соперника {link}')
        room = link.split('#')[1].split('/')[0]
        ok(re.match(r'^#' + room + r'/0/[a-z0-9]{20}$', g(A, 'location.hash')) is not None, 'A: своя ссылка в адресе, место 0')
        A.click('#invClose')
        ok(A.inner_text('#placeText') == 'Пригласить соперника', 'A: главная кнопка зовёт соперника')
        ok('ждём соперника' in A.inner_text('#status'), 'A: статус «ждём соперника»')

        B = mk(b, 'B'); B.goto(link)
        wait(B, "__tochki.net && __tochki.net.ready && __tochki.net.seat === 1 && __tochki.net.joined[1]")
        ok(True, 'B: вошёл по ссылке за синих')
        wait(A, "__tochki.net.joined[1] === true")
        ok(not B.is_hidden('#you1') and B.is_hidden('#you0'), 'B: метка «вы» у синих')
        first = g(A, '__tochki.game.first')
        print('     жребий: первыми ходят', ['красные', 'синие'][first])

        red = [(5, 4), (6, 5), (5, 6), (4, 5)]
        blue = [(5, 5), (30, 1), (30, 3), (30, 5), (30, 7)]
        tried_wrong = False
        while red:
            t = g(A, '__tochki.game.turn'); n = g(A, '__tochki.game.moves.length')
            if t == 0 and not tried_wrong:
                c = xy(B, 20, 20); B.touchscreen.tap(*c); B.wait_for_timeout(80)
                ok('ход соперника' in B.inner_text('#toast').lower(), 'B: не в свой ход точка не ставится')
                tried_wrong = True
            page, plan = (A, red) if t == 0 else (B, blue)
            x, y = plan.pop(0)
            place(page, x, y)
            wait(A, f'__tochki.game.moves.length === {n + 1}'); wait(B, f'__tochki.game.moves.length === {n + 1}')
        wait(B, '__tochki.game.score[0] === 1')
        ok(g(A, '[...__tochki.game.score]') == [1, 0] and B.inner_text('#n0') == '1', 'захват красных виден у обоих: 1 : 0')
        ok(g(A, 'Array.from(__tochki.game.moves).join()') == g(B, 'Array.from(__tochki.game.moves).join()'), 'ходы у обоих совпадают')

        C = mk(b, 'C'); C.goto(BASE + '#' + room)
        wait(C, '__tochki.net && __tochki.net.ready')
        ok('зритель' in C.inner_text('#status'), 'C: зритель по ссылке без ключа')
        D = mk(b, 'D'); D.goto(BASE + '#' + room + '/1/' + 'x' * 20)
        wait(D, "__tochki.net && __tochki.net.ready")
        ok(g(D, '__tochki.net.seat') is None, 'D: чужой ключ не даёт места')

        A.screenshot(path=SP + '/online_A.png'); B.screenshot(path=SP + '/online_B.png')

        # подсчёт по договорённости: предложение и отказ
        A.click('#menuBtn'); A.click('#mAgree')
        wait(B, "!document.getElementById('offer').hidden")
        ok('предлагает закончить' in B.inner_text('#offerText'), 'B: видит предложение подсчёта')
        B.click('#offNo')
        wait(A, "document.getElementById('toast').textContent.includes('играть дальше')")
        ok(True, 'A: узнал, что соперник хочет играть дальше')

        # ещё ход и согласие
        t = g(A, '__tochki.game.turn'); n = g(A, '__tochki.game.moves.length')
        (A if t == 0 else B).evaluate('0'); place(A if t == 0 else B, 12 if t == 0 else 33, 12); wait(B, f'__tochki.game.moves.length === {n + 1}')
        B.click('#menuBtn'); B.click('#mAgree')
        wait(A, "!document.getElementById('offer').hidden")
        A.click('#offYes')
        wait(A, "__tochki.game.over"); wait(B, "__tochki.game.over")
        ok(A.inner_text('#rTitle') == 'Вы победили' and B.inner_text('#rTitle') == 'Победил соперник', 'подсчёт: у A «Вы победили», у B «Победил соперник»')
        ok('договорённости' in B.inner_text('#rReason'), 'причина: по договорённости')

        # реванш
        ok(A.inner_text('#rNew') == 'Реванш', 'A: кнопка «Реванш»')
        A.click('#rNew')
        wait(A, f"location.hash.length > 5 && !location.hash.startsWith('#{room}') && __tochki.net && __tochki.net.ready && __tochki.net.seat === 0")
        wait(B, "document.getElementById('rNew').textContent === 'Принять реванш'")
        ok(True, 'B: видит «Принять реванш»')
        B.click('#rNew')
        wait(B, f"!location.hash.startsWith('#{room}') && __tochki.net && __tochki.net.ready && __tochki.net.seat === 1")
        wait(A, "__tochki.net.joined[1] === true")
        ok(g(A, '__tochki.net.room') == g(B, '__tochki.net.room'), 'реванш: оба в новой партии')

        # сдача в реванше
        B.click('#menuBtn'); B.click('#mResign'); B.click('#cYes')
        wait(A, '__tochki.game.over')
        ok(A.inner_text('#rTitle') == 'Вы победили' and 'Синие сдались' in A.inner_text('#rReason'), 'сдача синих видна у A')

        # мои партии и возврат к игре на одном телефоне
        A.click('#rView'); A.click('#menuBtn'); A.click('#mRooms')
        ok(A.locator('#roomsList .item').count() == 2, 'A: в «Моих партиях» две партии')
        A.click('#roomsBack'); A.click('#mLocal')
        wait(A, '__tochki.net === null')
        ok(not A.is_hidden('#undo'), 'A: вернулся к игре на одном телефоне, отмена хода снова есть')
        b.close()
finally:
    srv.terminate()
    out = srv.stdout.read()
    denied = [l for l in out.splitlines() if l.startswith('DENIED')]
    print('отказы базы:', len(denied)); [print('   ', l) for l in denied]
    print('ошибки на страницах:', errors if errors else 'нет')
