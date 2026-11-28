"""AI 검색(ChatGPT·Claude·Perplexity 등)과 검색엔진이 원가다이어리 소개를 읽을 수 있는지."""
import json
import os
import re
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

c = TestClient(app)


def _rules(robots: str, bot: str) -> list[str]:
    """robots.txt 에서 그 수집기에게 적용되는 Allow/Disallow 줄."""
    groups, cur, rules = [], [], []
    for line in robots.splitlines() + [""]:
        if line.startswith("User-agent:"):
            if rules:
                groups.append((cur, rules)); cur, rules = [], []
            cur.append(line.split(":", 1)[1].strip())
        elif line.startswith(("Allow:", "Disallow:")):
            rules.append(line)
    if cur:
        groups.append((cur, rules))
    for agents, r in groups:
        if bot in agents:
            return r
    return next(r for agents, r in groups if "*" in agents)


def test_robots_opens_public_pages_to_ai_but_not_api():
    r = c.get("/robots.txt").text
    for bot in ("GPTBot", "OAI-SearchBot", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Googlebot"):
        rules = _rules(r, bot)
        assert "Disallow: /" not in rules, bot
        assert "Disallow: /api/" in rules, bot
    assert "Disallow: /" in _rules(r, "Bytespider")
    assert "/static/js/" not in r  # 구글이 소개 화면을 그리려면 필요
    assert re.search(r"^Sitemap: https?://\S+/sitemap.xml$", r, re.M)


def test_ai_bot_can_read_landing_but_api_stays_blocked():
    ua = {"User-Agent": "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"}
    home = c.get("/", headers=ua)
    assert home.status_code == 200
    assert "noai" not in home.text
    assert "식자재" in home.text and "원가율" in home.text and "무료" in home.text  # 자바스크립트 없이도 읽힘
    assert c.get("/api/me", headers=ua).status_code in (401, 403)


def test_structured_data_is_valid_json():
    html = c.get("/").text
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        data = json.loads(block)
        types = {g["@type"] for g in data["@graph"]}
        assert {"SoftwareApplication", "FAQPage", "Organization"} <= types


def test_llms_txt_sitemap_and_guide():
    llms = c.get("/llms.txt")
    assert llms.status_code == 200 and llms.text.startswith("# 원가다이어리")
    sm = c.get("/sitemap.xml").text
    assert "/guide/menu-cost-rate" in sm
    g = c.get("/guide/menu-cost-rate")
    assert g.status_code == 200 and "원가율(%) = 한 그릇 재료비 ÷ 판매가 × 100" in g.text
    assert c.get("/guide/../main").status_code == 404
    assert c.get("/guide/nope").status_code == 404


def test_keyword_guides_are_listed_linked_and_crawlable():
    sm = c.get("/sitemap.xml").text
    pages = {
        "cost-calculator": "음식 원가계산기",
        "restaurant-cost": "음식점 원가 계산 방법",
        "receipt-management": "식당 영수증 관리 방법",
    }
    home = c.get("/").text
    llms = c.get("/llms.txt").text
    for slug, words in pages.items():
        assert f"/guide/{slug}</loc><lastmod>" in sm
        g = c.get(f"/guide/{slug}")
        assert g.status_code == 200 and words in g.text
        assert f'<link rel="canonical" href="https://mycostdiary.com/guide/{slug}">' in g.text
        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', g.text, re.S):
            json.loads(block)
        assert "<script>" not in g.text and " onclick=" not in g.text and " onsubmit=" not in g.text  # CSP: 인라인 스크립트 금지
        assert f"/guide/{slug}" in home and f"/guide/{slug}" in llms
    assert "원가계산기" in home.split("</title>")[0]
    # 계산기는 자바스크립트 없이도 예시 결과가 보인다
    calc = c.get("/guide/cost-calculator").text
    assert "3,680원" in calc and "40.9%" in calc and "/static/js/cost-calc.js" in calc
    assert c.get("/static/js/cost-calc.js").status_code == 200
    assert c.get("/static/guide/guide.css").status_code == 200


def test_share_images_exist():
    # og:image·로고가 실제로 있어야 카카오톡·검색 미리보기와 구조화 데이터가 깨지지 않는다
    for path in ("/static/og-image.png", "/static/brand/logo.png"):
        r = c.get(path)
        assert r.status_code == 200 and r.headers["content-type"] == "image/png", path


def test_google_search_console_verification_tag():
    # 구글 서치 콘솔 소유 확인(URL 접두어 속성). 지우면 서치 콘솔 확인이 풀린다.
    assert '<meta name="google-site-verification" content="QmUOVdTK9b9-jFluD5OaLgMmxPDYIrHWNC1UXkKVSLg">' in c.get("/").text


def _faq_pairs(html: str):
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        for g in json.loads(block)["@graph"]:
            if g["@type"] == "FAQPage":
                return [(q["name"], q["acceptedAnswer"]["text"]) for q in g["mainEntity"]]
    return []


def test_every_guide_shows_its_faq_and_date():
    from app.main import GUIDES
    for slug, day in GUIDES.items():
        html = c.get(f"/guide/{slug}").text
        pairs = _faq_pairs(html)
        assert pairs, slug
        for q, a in pairs:  # 구조화 데이터의 질문·답이 화면에도 그대로 보여야 한다(구글 규칙)
            assert f"<h3>{q}</h3>" in html and a in html, (slug, q)
        assert f'datetime="{day}"' in html and f'"dateModified":"{day}"' in html, slug
        assert 'class="answer"' in html, slug


def test_hub_about_redirects_and_sitemap():
    assert "/guide/no-profit" in c.get("/guide").text
    about = c.get("/about")
    assert about.status_code == 200 and "하지 않는 일" in about.text
    sm = c.get("/sitemap.xml").text
    for path in ("/guide<", "/about<", "/guide/no-profit<", "/guide/delivery-profit<"):
        assert path in sm, path
    r = c.get("/static/guide/no-profit.html", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == "/guide/no-profit"
    assert c.get("/static/index.html", follow_redirects=False).headers["location"] == "/"
    assert c.get("/static/guide/guide.css").status_code == 200


def test_home_faq_schema_matches_visible_landing_faq():
    js = open("static/js/landing.js", encoding="utf-8").read()
    pairs = _faq_pairs(c.get("/").text)
    assert len(pairs) == 8
    for q, _ in pairs:
        assert f"'{q}'" in js, q
