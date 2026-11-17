"""직원(아르바이트) 급여 계산: 시급 x 주 근무시간 + 주휴수당 -> 한 달 인건비.

법 기준(2026-11-11 웹에서 확인, **해마다 바꿔야 합니다**):
- 최저임금(시간급)
  - 2026년 10,320원: 고용노동부고시 제2025-47호(2025-08-05 고시, 2026-01-01~12-31 적용, 월 환산 2,156,880원/209시간)
  - 2027년 10,700원: 고용노동부 보도자료 "2027년 적용 최저임금안 시간급 10,700원"(2026-07-14,
    https://moel.go.kr/news/enews/report/enewsView.do?news_seq=19659), 2026-08-05 최종 고시(월 환산 2,236,300원/209시간)
  - 매년 8월 5일 전후 다음 해 금액이 고시되므로 그때 MIN_WAGE 에 한 줄 더합니다(최저임금위원회 minimumwage.go.kr).
- 주휴수당
  - 근로기준법 제55조 제1항: 1주에 평균 1회 이상의 유급휴일을 보장.
  - 근로기준법 시행령 제30조 제1항: 1주 동안의 소정근로일을 개근한 사람에게 줍니다(이 계산은 개근했다고 가정).
  - 근로기준법 제18조 제3항: 4주 동안을 평균하여 1주 소정근로시간이 15시간 미만인 근로자에게는 제55조(주휴)를 적용하지 않음
    -> 주 15시간 '이상'이면 받습니다(15시간 정확히도 포함).
  - 근로기준법 시행령 별표 2 제2호 나목: 단시간근로자의 1일 소정근로시간 = 4주 소정근로시간 ÷ 그 기간 통상근로자의 총 소정근로일 수.
    통상근로자를 주 5일·40시간으로 보면 1일 = 주 소정근로시간 ÷ 5 = 주 시간 / 40 x 8 이고, 주 40시간을 넘는 부분은 주휴 계산에 넣지 않습니다(최대 8시간분).
    (https://www.law.go.kr 근로기준법 제18조·제55조, 시행령 제30조·별표 2)
- 연장·야간·휴일근로 가산수당(근로기준법 제56조: 통상임금의 50%, 8시간 넘는 휴일근로 100%, 야간은 오후 10시~오전 6시)은
  상시 5명 이상 사업장에만 적용됩니다(근로기준법 제11조, 시행령 별표 1).
  이 계산은 '상시 5명 이상' 체크를 켰을 때만 야간근무시간 × 시급 × 50%를 더합니다. 연장·휴일 가산수당은 여전히 넣지 않고 안내만 합니다(시간대 구분 입력이 없어 정확히 계산할 수 없음).

법률 상담이 아닌 참고용 계산입니다. 실제 지급액은 고용노동부 고객상담센터(국번 없이 1350)나 노무사에게 확인하세요.
"""
from __future__ import annotations

# 연도 -> 시간당 최저임금(원). 위 주석의 출처를 보고 매년 갱신합니다.
MIN_WAGE = {2026: 10_320, 2027: 10_700}
MIN_WAGE_SOURCE = "고용노동부 최저임금 고시(2026년 제2025-47호, 2027년 2026-08-05 고시)"

HOLIDAY_MIN_WEEKLY_HOURS = 15.0  # 근로기준법 제18조 제3항
FULLTIME_WEEKLY_HOURS = 40.0     # 통상근로자 주 소정근로시간(근로기준법 제50조)
HOLIDAY_DAY_HOURS = 8.0          # 주 40시간일 때 하루 소정근로시간
WEEKS_PER_MONTH = 365 / 12 / 7   # 약 4.345주. 월 209시간(=(40+8) x 4.345) 환산과 같은 방식
NIGHT_PREMIUM = 0.5              # 근로기준법 제56조 제3항: 야간근로(22:00~06:00) 가산수당, 통상임금의 50%. 상시 5명 이상 사업장만 적용.


def min_wage(year: int) -> tuple[int, int]:
    """(그 해 최저임금, 실제로 쓴 연도). 아직 모르는 해면 알고 있는 가장 최근 값을 돌려줍니다."""
    if year in MIN_WAGE:
        return MIN_WAGE[year], year
    known = max(y for y in MIN_WAGE if y <= year) if any(y <= year for y in MIN_WAGE) else min(MIN_WAGE)
    return MIN_WAGE[known], known


def holiday_eligible(weekly_hours: float) -> bool:
    return weekly_hours >= HOLIDAY_MIN_WEEKLY_HOURS - 1e-9


def weekly_pay(hourly_wage: float, weekly_hours: float, night_hours: float = 0.0, five_plus: bool = False) -> dict:
    """한 주 급여: 기본급 = 시급 x 주 근무시간, 주휴수당 = min(주 시간, 40) / 40 x 8 x 시급 (주 15시간 이상일 때),
    야간수당 = 시급 x 야간근무시간 x 50% (상시 5명 이상 사업장일 때만, 근로기준법 제56조 제3항)."""
    wage = max(0.0, float(hourly_wage))
    hours = max(0.0, float(weekly_hours))
    night = min(max(0.0, float(night_hours)), hours)
    eligible = holiday_eligible(hours)
    holiday_hours = (min(hours, FULLTIME_WEEKLY_HOURS) / FULLTIME_WEEKLY_HOURS * HOLIDAY_DAY_HOURS) if eligible else 0.0
    base = wage * hours
    holiday = wage * holiday_hours
    night_pay = (wage * night * NIGHT_PREMIUM) if five_plus else 0.0
    return {
        "base": base, "holiday": holiday, "night": night_pay, "total": base + holiday + night_pay,
        "holiday_hours": holiday_hours, "eligible": eligible, "night_hours": night, "night_applied": five_plus and night > 0,
    }


def monthly_pay(hourly_wage: float, weekly_hours: float, night_hours: float = 0.0, five_plus: bool = False) -> dict:
    """한 달 급여(원 단위 반올림). 한 달 = 365 / 12 / 7 주."""
    w = weekly_pay(hourly_wage, weekly_hours, night_hours, five_plus)
    base = round(w["base"] * WEEKS_PER_MONTH)
    holiday = round(w["holiday"] * WEEKS_PER_MONTH)
    night = round(w["night"] * WEEKS_PER_MONTH)
    return {
        "base": base, "holiday": holiday, "night": night, "total": base + holiday + night,
        "eligible": w["eligible"], "holiday_hours_week": round(w["holiday_hours"], 2),
        "weekly_base": round(w["base"]), "weekly_holiday": round(w["holiday"]), "weekly_night": round(w["night"]),
        "month_hours": round((float(weekly_hours) + w["holiday_hours"]) * WEEKS_PER_MONTH, 1),
        "over_40": float(weekly_hours) > FULLTIME_WEEKLY_HOURS + 1e-9,
        "night_hours_week": round(w["night_hours"], 2), "night_applied": w["night_applied"],
    }


def summarize(staff: list[dict], year: int, five_plus: bool = False) -> dict:
    """재직 중인 직원만 합산합니다. staff: [{hourly_wage, weekly_hours, night_hours, active, ...}]"""
    mw, mw_year = min_wage(year)
    base = holiday = night = 0
    rows = []
    for s in staff:
        pay = monthly_pay(s["hourly_wage"], s["weekly_hours"], s.get("night_hours", 0.0), five_plus)
        rows.append({**s, "pay": pay, "below_min": s["hourly_wage"] < mw})
        if s["active"]:
            base += pay["base"]
            holiday += pay["holiday"]
            night += pay["night"]
    active = [r for r in rows if r["active"]]
    return {
        "staff": rows,
        "base_total": base, "holiday_total": holiday, "night_total": night, "total": base + holiday + night,
        "active_count": len(active), "five_plus": five_plus,
        "min_wage": mw, "min_wage_year": mw_year, "min_wage_known": mw_year == year,
        "min_wage_next": MIN_WAGE.get(year + 1), "min_wage_source": MIN_WAGE_SOURCE,
        "weeks_per_month": WEEKS_PER_MONTH,
    }
