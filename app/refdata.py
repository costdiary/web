"""참고 레시피 DB: 공공 레시피(식약처 조리식품 레시피 DB, 식품안전나라 COOKRCP01)의 요리명·완성 사진·재료·분량.

사진 추정 때 "비슷한 요리의 실제 레시피"를 모델에 함께 보여 줘서 양을 보정하는 데 씁니다.
사장님 데이터(data/app.db)와 분리된 data/reference.db 에 들어가며, 사장님 화면에는 노출하지 않습니다.
출처 데이터의 이용 조건은 공공데이터포털(data.go.kr) 해당 데이터 페이지에서 확인하세요.
"""
from __future__ import annotations

import re
import sqlite3
from difflib import SequenceMatcher
from pathlib import Path

from .db import data_dir

SRC = "mfds-cookrcp01"
SRC_USER = "user-confirmed"  # 사장님이 값을 직접 확인한 레시피(누구의 것인지는 저장하지 않음)
_SCHEMA = """
CREATE TABLE IF NOT EXISTS ref_recipes (
  id INTEGER PRIMARY KEY,
  src TEXT NOT NULL, src_id TEXT NOT NULL,
  name TEXT NOT NULL, name_key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '', way TEXT NOT NULL DEFAULT '',
  image_url TEXT, image_file TEXT,
  weight_note TEXT NOT NULL DEFAULT '', parts_raw TEXT NOT NULL DEFAULT '',
  UNIQUE (src, src_id)
);
CREATE INDEX IF NOT EXISTS ref_name ON ref_recipes(name_key);
CREATE TABLE IF NOT EXISTS ref_lines (
  recipe_id INTEGER NOT NULL REFERENCES ref_recipes(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL, name TEXT NOT NULL, qty REAL, unit TEXT, raw TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ref_lines_r ON ref_lines(recipe_id);
"""


def db_path() -> Path:
    return data_dir() / "reference.db"


def connect(create: bool = False) -> sqlite3.Connection | None:
    p = db_path()
    if not p.exists() and not create:
        return None
    conn = sqlite3.connect(p, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_SCHEMA)
    return conn


# ---------------------------------------------------------------- 읽기(재료 글 -> 줄)

_HEAD = re.compile(r"[●■◆▶▷•\[\(]?\s*(재료|주재료|부재료|양념|양념장|소스|드레싱|고명|육수|국물|반죽|속재료|필수재료|선택재료|[가-힣]{1,6}\s*재료)\s*[\]\):：]?\s*")
_ITEM = re.compile(r"^(?P<name>[^\d~()/]+?)\s*(?P<qty>\d+(?:\.\d+)?(?:\s*/\s*\d+)?(?:\s*~\s*\d+(?:\.\d+)?)?)\s*(?P<unit>kg|g|ml|mL|L|cc|개|큰술|작은술|컵|T|t|스푼|장|쪽|마리|모|줄기|봉지|캔)?")


def _num(s: str) -> float | None:
    s = s.replace(" ", "")
    try:
        if "~" in s:
            a, b = s.split("~", 1)
            return (float(a) + float(b)) / 2
        if "/" in s:
            a, b = s.split("/", 1)
            return float(a) / float(b)
        return float(s)
    except (ValueError, ZeroDivisionError):
        return None


def _split_top(text: str) -> list[str]:
    """괄호 안의 쉼표는 자르지 않고 쉼표·줄바꿈으로 나눕니다."""
    out, buf, depth = [], [], 0
    for ch in text:
        if ch in "([（":
            depth += 1
        elif ch in ")]）":
            depth = max(0, depth - 1)
        if ch in ",\n" and depth == 0:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    out.append("".join(buf))
    return [x.strip() for x in out if x.strip()]


def parse_parts(text: str) -> list[dict]:
    """'연두부 75g(3/4모), 칵테일새우 20g(4마리)' 같은 글을 [{name, qty, unit, raw}] 로. g·ml·개로 바꾸지 못하는 단위는 qty=None."""
    from .recipe_ai import _unit_and_factor

    lines: list[dict] = []
    for chunk in _split_top(re.sub(r"[●■◆▶▷]", ",", str(text or ""))):  # 제목 표시(●소스)가 줄바꿈 없이 이어져도 나눕니다.
        chunk = _HEAD.sub("", chunk, count=1).strip(" :：·-")
        if not chunk:
            continue
        plain = re.sub(r"\s*\([^)]*\)", "", chunk).strip()  # 괄호 안은 다른 표기(3/4모, 목살 등)라 이름·양을 읽을 때는 뺍니다.
        m = _ITEM.match(plain)
        if not m or len(m.group("name").strip()) < 1:
            lines.append({"name": re.sub(r"(약간|적당량|조금|적당히)$", "", plain).strip()[:40], "qty": None, "unit": None, "raw": chunk[:80]})
            continue
        name = m.group("name").strip(" :：·-")[:40]
        q = _num(m.group("qty"))
        raw_unit = (m.group("unit") or "").strip()
        unit, factor = (None, 1.0)
        if raw_unit.lower() == "cc":
            unit, factor = "ml", 1.0
        elif raw_unit in ("T",):
            unit, factor = "ml", 15.0
        elif raw_unit in ("t",):
            unit, factor = "ml", 5.0
        elif raw_unit == "스푼":
            unit, factor = "ml", 15.0
        elif raw_unit:
            unit, factor = _unit_and_factor(raw_unit)
        elif q is not None:
            unit, factor = ("g", 1.0)  # 단위가 없으면 g 으로 적은 경우가 대부분
        if unit is None or q is None:
            lines.append({"name": name, "qty": None, "unit": None, "raw": chunk[:80]})
        else:
            lines.append({"name": name, "qty": round(q * factor, 2), "unit": unit, "raw": chunk[:80]})
    return lines


def name_key(name: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", str(name or "").lower())


def from_cookrcp01(row: dict) -> dict | None:
    name = str(row.get("RCP_NM") or "").strip()
    sid = str(row.get("RCP_SEQ") or "").strip()
    if not name or not sid:
        return None
    return {
        "src": SRC, "src_id": sid, "name": name[:60], "name_key": name_key(name),
        "category": str(row.get("RCP_PAT2") or "")[:20], "way": str(row.get("RCP_WAY2") or "")[:20],
        "image_url": (row.get("ATT_FILE_NO_MAIN") or row.get("ATT_FILE_NO_MK") or None),
        "weight_note": str(row.get("INFO_WGT") or "")[:20],
        "parts_raw": str(row.get("RCP_PARTS_DTLS") or "")[:2000],
        "lines": parse_parts(row.get("RCP_PARTS_DTLS") or ""),
    }


def upsert(conn: sqlite3.Connection, rec: dict) -> int:
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "INSERT INTO ref_recipes(src, src_id, name, name_key, category, way, image_url, weight_note, parts_raw) VALUES (?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(src, src_id) DO UPDATE SET name=excluded.name, name_key=excluded.name_key, category=excluded.category, way=excluded.way, "
            "image_url=excluded.image_url, weight_note=excluded.weight_note, parts_raw=excluded.parts_raw",
            (rec["src"], rec["src_id"], rec["name"], rec["name_key"], rec["category"], rec["way"], rec["image_url"], rec["weight_note"], rec["parts_raw"]),
        )
        rid = conn.execute("SELECT id FROM ref_recipes WHERE src=? AND src_id=?", (rec["src"], rec["src_id"])).fetchone()["id"]
        conn.execute("DELETE FROM ref_lines WHERE recipe_id = ?", (rid,))
        conn.executemany(
            "INSERT INTO ref_lines(recipe_id, pos, name, qty, unit, raw) VALUES (?,?,?,?,?,?)",
            [(rid, i, ln["name"], ln["qty"], ln["unit"], ln["raw"]) for i, ln in enumerate(rec["lines"])],
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return rid


# ---------------------------------------------------------------- 찾기(사진 추정에 쓰기)

def find_similar(name: str, limit: int = 2, min_score: float = 0.6) -> list[dict]:
    """요리 이름이 비슷한 참고 레시피(최대 limit개). DB 가 없으면 빈 목록."""
    key = name_key(name)
    conn = connect()
    if conn is None or len(key) < 2:
        return []
    try:
        rows = conn.execute("SELECT id, src, name, name_key, category, image_url, image_file, weight_note FROM ref_recipes").fetchall()
        scored = []
        for r in rows:
            k = r["name_key"]
            if not k:
                continue
            s = 1.0 if k == key else (0.85 if (key in k or k in key) and min(len(k), len(key)) >= 2 else SequenceMatcher(None, key, k).ratio())
            if s >= min_score:
                scored.append((s, r))
        scored.sort(key=lambda x: (-x[0], x[1]["src"] == SRC_USER, len(x[1]["name_key"])))  # 같은 점수면 공공 레시피를 먼저
        out = []
        for s, r in scored[:limit]:
            lines = conn.execute("SELECT name, qty, unit, raw FROM ref_lines WHERE recipe_id = ? ORDER BY pos", (r["id"],)).fetchall()
            out.append({**dict(r), "score": round(s, 2), "lines": [dict(x) for x in lines]})
        return out
    finally:
        conn.close()


def prompt_text(recs: list[dict]) -> str:
    """모델에 줄 참고 자료 글. 양은 레시피 원문 기준이라 1인분과 다를 수 있다고 알립니다."""
    parts = []
    for r in recs:
        items = ", ".join(
            (f"{ln['name']} {ln['qty']:g}{ln['unit']}" if ln["qty"] is not None else f"{ln['name']}({ln['raw'][:20]})") for ln in r["lines"][:25]
        )
        parts.append(f"- {r['name']}: {items}")
    return "\n".join(parts)


def image_bytes(rec: dict) -> bytes | None:
    """내려받아 둔 참고 사진(있으면). 없으면 None."""
    f = rec.get("image_file")
    if not f:
        return None
    p = data_dir() / "reference" / "images" / f
    try:
        return p.read_bytes() if p.is_file() and p.stat().st_size < 2_000_000 else None
    except OSError:
        return None


def contribute(name: str, lines: list[tuple[str, float, str]]) -> bool:
    """사장님이 확정한 레시피를 참고 DB 에 쌓습니다. lines = [(재료명, 양, 'g'|'ml'|'개')].
    누구의 데이터인지(사용자·가게)는 저장하지 않고, 같은 내용은 한 번만 저장합니다. 쌓았으면 True."""
    import hashlib
    from . import config

    if config.env_str("REF_CONTRIBUTE", "1") == "0" or len(lines) < 3 or not name_key(name):
        return False
    norm = sorted((name_key(n), round(q, 1), u) for n, q, u in lines)
    sid = hashlib.sha1((name_key(name) + repr(norm)).encode(), usedforsecurity=False).hexdigest()[:20]
    conn = connect(create=True)
    try:
        rec = {
            "src": SRC_USER, "src_id": sid, "name": str(name)[:60], "name_key": name_key(name), "category": "", "way": "",
            "image_url": None, "weight_note": "", "parts_raw": "",
            "lines": [{"name": str(n)[:40], "qty": round(float(q), 2), "unit": u, "raw": f"{n} {q:g}{u}"} for n, q, u in lines],
        }
        before = conn.execute("SELECT 1 FROM ref_recipes WHERE src=? AND src_id=?", (SRC_USER, sid)).fetchone()
        if before:
            return False
        upsert(conn, rec)
        return True
    finally:
        conn.close()
