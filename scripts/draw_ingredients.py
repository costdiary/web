"""손질된 재료 그림(3D 느낌 SVG)을 만듭니다. 모든 재료가 같은 빛(왼쪽 위)과 같은 각도(위에서 약간 비스듬히)로 그려져
   한 그릇에 모아도 한 접시처럼 보입니다. 실행: python scripts/draw_ingredients.py → static/img/ing/3d/<이름>.svg(무더기), <이름>.pc.svg(한 조각)"""
import math, random, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'img', 'ing', '3d')

def f(x):
    return f'{x:.1f}'.rstrip('0').rstrip('.')

def defs(uid, grads):
    return ('<defs>'
            + ''.join(grads) + '</defs>')

def svg(body, vb=200, grads=(), uid='a'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}">' + defs(uid, grads) + body + '</svg>\n')

def blob(cx, cy, rx, ry, rnd, n=9, wob=0.18, rot=0):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 1 + (rnd.random() - 0.5) * 2 * wob
        x, y = math.cos(a) * rx * r, math.sin(a) * ry * r
        c, s = math.cos(rot), math.sin(rot)
        pts.append((cx + x * c - y * s, cy + x * s + y * c))
    d = ''
    for i in range(n):
        p0, p1 = pts[i - 1], pts[i]
        m = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        d += (f'M{f(m[0])} {f(m[1])}' if i == 0 else '') if False else ''
    # 부드러운 닫힌 곡선(중점 사이 2차 베지어)
    mids = [((pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2) for i in range(n)]
    d = f'M{f(mids[-1][0])} {f(mids[-1][1])}'
    for i in range(n):
        d += f'Q{f(pts[i][0])} {f(pts[i][1])} {f(mids[i][0])} {f(mids[i][1])}'
    return d + 'Z'

# ---------- 조각 그리기: (rnd, x, y, scale, rot) -> svg 문자열 ----------
def kimchi(rnd, x, y, k, rot, U):
    # 썬 배추김치 한 조각: 뒤쪽에 주름진 붉은 잎, 앞쪽에 넓고 도톰한 줄기(양념이 배어 주황빛이 도는 크림색).
    # 줄기에는 세로 결, 양념 덩어리, 고춧가루 알갱이, 젖은 윤기.
    w, h = 30 * k, 24 * k
    leaf = blob(-w * .02, -h * .12, w * .56, h * .44, rnd, n=18, wob=.22)
    rib = blob(w * .02, h * .12, w * .44, h * .3, rnd, n=5, wob=.22, rot=(rnd.random() - .5) * .6)
    fib = ''.join(f'<path d="M{f(-w*.32+i*w*.13)} {f(-h*.12)} q{f(.8*k)} {f(h*.22)} {f(.2*k)} {f(h*.42)}" stroke="#e7a66f" stroke-width="{f(.9*k)}" fill="none" opacity=".75" stroke-linecap="round"/>' for i in range(6))
    veins = ''.join(f'<path d="M{f(-w*.3+i*w*.16)} {f(-h*.12)} q{f(1.6*k)} {f(-h*.12)} {f(.4*k)} {f(-h*.26)}" stroke="#7d160a" stroke-width="{f(.8*k)}" fill="none" opacity=".6" stroke-linecap="round"/>' for i in range(5))
    sauce = ''.join(f'<path d="{blob((rnd.random()-.5)*w*.7, h*.02 + rnd.random()*h*.3, (2+rnd.random()*3.4)*k, (1.2+rnd.random()*1.8)*k, rnd, n=7, wob=.35)}" fill="#c8341a" opacity=".9"/>' for _ in range(8))
    flecks = ''.join(f'<circle cx="{f((rnd.random()-.5)*w*.85)}" cy="{f((rnd.random()-.55)*h*.8)}" r="{f(.3*k+rnd.random()*.3*k)}" fill="#701306"/>' for _ in range(18))
    shine = (f'<path d="M{f(-w*.3)} {f(h*.0)} Q{f(-w*.05)} {f(-h*.08)} {f(w*.22)} {f(-h*.02)}" stroke="#fff" stroke-width="{f(1.3*k)}" fill="none" opacity=".75" stroke-linecap="round"/>'
             f'<ellipse cx="{f(-w*.2)}" cy="{f(-h*.34)}" rx="{f(2.2*k)}" ry="{f(.8*k)}" fill="#ffd6c4" opacity=".7"/>')
    return (f'<g transform="translate({f(x)} {f(y)}) rotate({f(rot)})" >'
            f'<path d="{leaf}" fill="url(#kg{U})"/>' + veins +
            f'<path d="{rib}" fill="url(#kc{U})"/>' + fib + sauce + flecks + shine +
            f'<path d="{rib}" fill="url(#kw{U})"/></g>')

KIMCHI_G = lambda U: [
    f'<linearGradient id="kc{U}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8d9a2"/><stop offset=".5" stop-color="#f0b877"/><stop offset="1" stop-color="#d8783e"/></linearGradient>',
    f'<radialGradient id="kg{U}" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#e8502c"/><stop offset=".65" stop-color="#bb2f17"/><stop offset="1" stop-color="#8a1c0b"/></radialGradient>',
    f'<radialGradient id="kw{U}" cx=".35" cy=".25" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#3a0a02" stop-opacity=".35"/></radialGradient>']

def onion(rnd, x, y, k, rot, U):
    # 채 썬 양파: 반달 모양 고리. 반투명한 흰빛에 보랏빛 가장자리.
    R, r = 15 * k, 10 * k
    a0, a1 = math.radians(200), math.radians(340 + rnd.random() * 15)
    p = lambda rr, a: (rr * math.cos(a), rr * math.sin(a))
    o0, o1, i1, i0 = p(R, a0), p(R, a1), p(r, a1), p(r, a0)
    d = (f'M{f(o0[0])} {f(o0[1])}A{f(R)} {f(R)} 0 0 1 {f(o1[0])} {f(o1[1])}'
         f'L{f(i1[0])} {f(i1[1])}A{f(r)} {f(r)} 0 0 0 {f(i0[0])} {f(i0[1])}Z')
    hm = (R + r) / 2 + 1.2 * k
    h0, h1 = p(hm, a0 + .35), p(hm, a1 - .5)
    return (f'<g transform="translate({f(x)} {f(y)}) rotate({f(rot)})" >'
            f'<path d="{d}" fill="url(#on{U})" stroke="#d9c6e4" stroke-width="{f(.8*k)}"/>'
            f'<path d="M{f(h0[0])} {f(h0[1])}A{f(hm)} {f(hm)} 0 0 1 {f(h1[0])} {f(h1[1])}" stroke="#fff" stroke-width="{f(1.3*k)}" fill="none" opacity=".85" stroke-linecap="round"/></g>')

ONION_G = lambda U: [f'<linearGradient id="on{U}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf8"/><stop offset=".6" stop-color="#f3ecf3"/><stop offset="1" stop-color="#dccbe3"/></linearGradient>']

def scallion(rnd, x, y, k, rot, U):
    # 송송 썬 파: 짧은 원통을 비스듬히 본 모양(초록 껍질 + 연한 단면 + 가운데 구멍)
    R = 6.5 * k; sq = .72
    return (f'<g transform="translate({f(x)} {f(y)}) rotate({f(rot)})" >'
            f'<ellipse cx="0" cy="{f(2.2*k)}" rx="{f(R)}" ry="{f(R*sq)}" fill="#3f7d22"/>'
            f'<rect x="{f(-R)}" y="0" width="{f(2*R)}" height="{f(2.2*k)}" fill="url(#sc{U})"/>'
            f'<ellipse cx="0" cy="0" rx="{f(R)}" ry="{f(R*sq)}" fill="#cfe9a0" stroke="#5c9b33" stroke-width="{f(1.4*k)}"/>'
            f'<ellipse cx="0" cy="0" rx="{f(R*.48)}" ry="{f(R*.48*sq)}" fill="#7fb24a"/>'
            f'<ellipse cx="{f(-R*.35)}" cy="{f(-R*.32)}" rx="{f(R*.3)}" ry="{f(R*.12)}" fill="#fff" opacity=".6"/></g>')

SCALLION_G = lambda U: [f'<linearGradient id="sc{U}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4f8f2a"/><stop offset=".4" stop-color="#8cc450"/><stop offset="1" stop-color="#3f7d22"/></linearGradient>']

def pork(rnd, x, y, k, rot, U):
    # 썬 돼지고기(앞다리살): 분홍 살코기 + 한쪽 하얀 지방 띠 + 결
    w, h = 36 * k, 20 * k
    d = blob(0, 0, w / 2, h / 2, rnd, n=9, wob=.15)
    fat = f'M{f(-w*.48)} {f(h*.18)} Q0 {f(h*.62)} {f(w*.46)} {f(h*.2)} Q0 {f(h*.42)} {f(-w*.48)} {f(h*.18)}Z'
    grain = ''.join(f'<path d="M{f(-w*.35+i*w*.18)} {f(-h*.3)} q{f(w*.05)} {f(h*.25)} 0 {f(h*.45)}" stroke="#f7c9c2" stroke-width="{f(.8*k)}" fill="none" opacity=".55"/>' for i in range(5))
    return (f'<g transform="translate({f(x)} {f(y)}) rotate({f(rot)})" >'
            f'<path d="{d}" fill="url(#pk{U})"/>' + grain +
            f'<path d="{fat}" fill="#fbf1ea" opacity=".95"/>'
            f'<ellipse cx="{f(-w*.15)}" cy="{f(-h*.2)}" rx="{f(w*.25)}" ry="{f(h*.12)}" fill="#fff" opacity=".3"/></g>')

PORK_G = lambda U: [f'<radialGradient id="pk{U}" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#f6b1a7"/><stop offset=".7" stop-color="#e08a80"/><stop offset="1" stop-color="#c76b62"/></radialGradient>']

def tofu(rnd, x, y, k, rot, U):
    # 깍둑 썬 두부: 위·왼쪽·오른쪽 면 셋이 보이는 정육면체(모서리 살짝 둥글게)
    s = 11 * k
    top = f'M0 {f(-s*.55)} L{f(s)} 0 L0 {f(s*.55)} L{f(-s)} 0Z'
    left = f'M{f(-s)} 0 L0 {f(s*.55)} L0 {f(s*1.55)} L{f(-s)} {f(s)}Z'
    right = f'M{f(s)} 0 L0 {f(s*.55)} L0 {f(s*1.55)} L{f(s)} {f(s)}Z'
    return (f'<g transform="translate({f(x)} {f(y)}) rotate({f(rot*.15)})"  stroke-linejoin="round" stroke-width="{f(2*k)}">'
            f'<path d="{left}" fill="#efe3c6" stroke="#efe3c6"/><path d="{right}" fill="#dccaa2" stroke="#dccaa2"/>'
            f'<path d="{top}" fill="url(#tf{U})" stroke="#fffaf0"/>'
            f'<path d="M{f(-s*.55)} {f(-s*.08)} L0 {f(-s*.38)}" stroke="#fff" stroke-width="{f(1.2*k)}" opacity=".8" stroke-linecap="round"/></g>')

TOFU_G = lambda U: [f'<linearGradient id="tf{U}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#f4ead2"/></linearGradient>']

def egg(rnd, x, y, k, rot, U):
    # 달걀(껍질째): 갈색 달걀, 왼쪽 위 반사광
    w, h = 15 * k, 19 * k
    d = f'M0 {f(-h)} C{f(w*.95)} {f(-h)} {f(w*1.05)} {f(h*.55)} 0 {f(h*.75)} C{f(-w*1.05)} {f(h*.55)} {f(-w*.95)} {f(-h)} 0 {f(-h)}Z'
    return (f'<g transform="translate({f(x)} {f(y)}) rotate({f(rot*.3)})" >'
            f'<path d="{d}" fill="url(#eg{U})"/>'
            f'<ellipse cx="{f(-w*.35)}" cy="{f(-h*.45)}" rx="{f(w*.22)}" ry="{f(h*.18)}" fill="#fff" opacity=".55" transform="rotate(-20 {f(-w*.35)} {f(-h*.45)})"/></g>')

EGG_G = lambda U: [f'<radialGradient id="eg{U}" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#f6dcbd"/><stop offset=".55" stop-color="#dba57a"/><stop offset="1" stop-color="#a86a3f"/></radialGradient>']

def mound(color_grad, speck, n_speck, speck_shape):
    def draw(rnd, x, y, k, rot, U):
        w, h = 62 * k, 40 * k
        d = blob(0, 0, w / 2, h / 2, rnd, n=12, wob=.08)
        out = [f'<g transform="translate({f(x)} {f(y)})" ><path d="{d}" fill="url(#{color_grad}{U})"/>']
        out.append(f'<path d="{d}" fill="url(#dome{U})"/>')
        pts = []
        for _ in range(n_speck):
            a = rnd.random() * 2 * math.pi; r = math.sqrt(rnd.random())
            px, py = math.cos(a) * r * w * .45, math.sin(a) * r * h * .42
            pts.append((py, px))
        for py, px in sorted(pts):
            out.append(speck_shape(rnd, px, py, k, speck))
        out.append(f'<ellipse cx="{f(-w*.14)}" cy="{f(-h*.22)}" rx="{f(w*.2)}" ry="{f(h*.12)}" fill="#fff" opacity=".22"/></g>')
        return ''.join(out)
    return draw

def flake(rnd, x, y, k, cols):
    s = (1.2 + rnd.random() * 1.6) * k; a = rnd.random() * 180
    return f'<rect x="{f(x-s/2)}" y="{f(y-s/3)}" width="{f(s)}" height="{f(s*.6)}" rx="{f(s*.15)}" fill="{rnd.choice(cols)}" transform="rotate({f(a)} {f(x)} {f(y)})"/>'

def grain(rnd, x, y, k, cols):
    a = rnd.random() * 180
    return (f'<ellipse cx="{f(x)}" cy="{f(y)}" rx="{f(2.2*k)}" ry="{f(1.1*k)}" fill="{rnd.choice(cols)}" stroke="#e3dccb" stroke-width="{f(.35*k)}" transform="rotate({f(a)} {f(x)} {f(y)})"/>')

def mince(rnd, x, y, k, cols):
    s = (1.6 + rnd.random() * 1.2) * k
    return f'<rect x="{f(x-s/2)}" y="{f(y-s/2)}" width="{f(s)}" height="{f(s)}" rx="{f(s*.25)}" fill="{rnd.choice(cols)}"/>'

DOME = lambda U: f'<radialGradient id="dome{U}" cx=".42" cy=".28" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#2a0c04" stop-opacity=".45"/></radialGradient>'
GOCHUGARU_G = lambda U: [DOME(U), f'<radialGradient id="gg{U}" cx=".45" cy=".35" r=".75"><stop offset="0" stop-color="#d8401f"/><stop offset="1" stop-color="#8f1f0c"/></radialGradient>']
RICE_G = lambda U: [DOME(U), f'<radialGradient id="rc{U}" cx=".45" cy=".35" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e4dccb"/></radialGradient>']
GARLIC_G = lambda U: [DOME(U), f'<radialGradient id="gl{U}" cx=".45" cy=".35" r=".75"><stop offset="0" stop-color="#fbf0c8"/><stop offset="1" stop-color="#dcc684"/></radialGradient>']

ING = {
    # 이름: (조각 그리기, 그라디언트, 무더기 조각 수, 조각 크기, 무더기인지)
    'kimchi':   (kimchi, KIMCHI_G, 11, 1.75, False),
    'onion':    (onion, ONION_G, 16, 1.75, False),
    'scallion': (scallion, SCALLION_G, 34, 1.6, False),
    'pork':     (pork, PORK_G, 9, 1.8, False),
    'tofu':     (tofu, TOFU_G, 9, 1.6, False),
    'egg':      (egg, EGG_G, 3, 2.3, False),
    'gochugaru': (mound('gg', ['#b8270f', '#d63a18', '#8a1a08', '#e8572c'], 380, flake), GOCHUGARU_G, 1, 2.3, True),
    'rice':     (mound('rc', ['#fffef8', '#fbf7ea', '#f3eddc'], 420, grain), RICE_G, 1, 2.4, True),
    'garlic':   (mound('gl', ['#f7e7a8', '#efdb8e', '#fff3c4'], 260, mince), GARLIC_G, 1, 2.2, True),
}

import re as _re
def _flat(g):
    # 그림자용: 모든 색을 어두운 갈색으로
    return _re.sub(r'(fill|stroke)="[^"]+"', lambda m: m.group(1) + ('="#2a0c04"' if m.group(1) == 'fill' else '="none"'), g)

def pile(name, fn, grads, n, k, is_mound, U):
    rnd = random.Random(name)
    if is_mound:
        return svg(fn(rnd, 100, 110, k, 0, U), grads=grads(U), uid=U)
    pts = []
    for i in range(n):
        a = i * 2.39996 + rnd.random() * .5; r = math.sqrt((i + .5) / n) * (60 if n > 4 else 24) * (0.85 + rnd.random() * .3)
        pts.append((100 + math.cos(a) * r, 104 + math.sin(a) * r * .72, rnd.random() * 360))
    pts.sort(key=lambda p: p[1])
    parts = []
    for x, y, rot in pts:
        kk = k * (0.9 + rnd.random() * .2); st = rnd.getstate()
        g = fn(rnd, x, y, kk, rot, U)
        rnd.setstate(st)
        sh = fn(rnd, x + 1.5, y + 3, kk, rot, U)
        parts.append(f'<g opacity=".35" style="filter:none">{_flat(sh)}</g>' + g)
    body = ''.join(parts)
    return svg(body, grads=grads(U), uid=U)

PSIZE = {'kimchi': 34, 'egg': 40, 'pork': 38, 'onion': 32, 'tofu': 24, 'scallion': 14}

def piece(name, fn, grads, k, is_mound, U):
    rnd = random.Random(name + 'pc')
    if is_mound:
        return svg(fn(rnd, 50, 52, k * .62, 0, U), vb=100, grads=grads(U), uid=U)
    return svg(fn(rnd, 50, 50, min(k * 1.25, 85 / PSIZE.get(name, 30)), rnd.random() * 40 - 20, U), vb=100, grads=grads(U), uid=U)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, (fn, grads, n, k, m) in ING.items():
        open(os.path.join(OUT, f'{name}.svg'), 'w').write(pile(name, fn, grads, n, k, m, name[:2] + 'p'))
        open(os.path.join(OUT, f'{name}.pc.svg'), 'w').write(piece(name, fn, grads, k, m, name[:2] + 'c'))
    js = os.path.join(os.path.dirname(__file__), '..', 'static', 'js', 'ing_drawn.js')
    open(js, 'w').write('/* static/img/ing/3d/ 에 그려 둔 재료 목록. scripts/draw_ingredients.py 가 만듭니다. */\nexport const DRAWN = ' + repr(sorted(ING)).replace("'", '"') + ';\n')
    print(sorted(ING))
