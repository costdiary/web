"""식약처 조리식품 레시피 DB(식품안전나라 오픈API COOKRCP01)를 참고 레시피 DB(data/reference.db)에 넣습니다.

쓰는 곳: 메뉴 만들기 검색('공공 레시피'), 사진으로 짐작하기의 참고 자료.
인증키는 식품안전나라(https://www.foodsafetykorea.go.kr) > 공공데이터활용서비스에서 무료로 받습니다.

    FOODSAFETY_KEY=발급받은키 python scripts/fetch_public_recipes.py

한 번에 1,000건씩 끝까지 받습니다(약 1,100건). 같은 레시피는 덮어쓰므로 여러 번 돌려도 됩니다.
이용 조건은 공공데이터포털(data.go.kr)의 해당 데이터 페이지에서 확인하세요.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import refdata  # noqa: E402

BASE = "http://openapi.foodsafetykorea.go.kr/api/{key}/COOKRCP01/json/{start}/{end}"
PAGE = 1000


def fetch(key: str, start: int, end: int) -> list[dict]:
    url = BASE.format(key=urllib.parse.quote(key, safe=""), start=start, end=end)
    with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310 (고정된 공공 API 주소)
        data = json.loads(r.read().decode("utf-8"))
    body = data.get("COOKRCP01") or {}
    code = (body.get("RESULT") or {}).get("CODE", "")
    if code and code not in ("INFO-000", "INFO-200"):
        raise RuntimeError(f"API 오류: {body.get('RESULT')}")
    return body.get("row") or []


def main() -> int:
    key = os.environ.get("FOODSAFETY_KEY", "").strip()
    if not key:
        print("FOODSAFETY_KEY 환경변수에 식품안전나라 인증키를 넣어 주세요.", file=sys.stderr)
        return 2
    conn = refdata.connect(create=True)
    total = saved = 0
    start = 1
    try:
        while True:
            rows = fetch(key, start, start + PAGE - 1)
            if not rows:
                break
            for row in rows:
                total += 1
                rec = refdata.from_cookrcp01(row)
                if rec and rec["lines"]:
                    refdata.upsert(conn, rec)
                    saved += 1
            print(f"{start}~{start + len(rows) - 1}: 누적 {saved}건 저장")
            if len(rows) < PAGE:
                break
            start += PAGE
            time.sleep(1)
    finally:
        conn.close()
    print(f"끝: 받은 {total}건 중 재료를 읽을 수 있는 {saved}건을 {refdata.db_path()} 에 넣었습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
