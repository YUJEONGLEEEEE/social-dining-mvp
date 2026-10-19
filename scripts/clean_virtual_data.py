"""Clean the organizer's survey spreadsheet into JSON for seeding.

Usage:
    python3 scripts/clean_virtual_data.py <path/to/우연한식탁_가상데이터.xlsx>

The spreadsheet and the output stay out of git (data/private/ is ignored),
because the source file belongs to the organizer.
Contact, Instagram and consent columns are never read.
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

import openpyxl

YEAR = 2026
OUT = Path(__file__).resolve().parent.parent / "data" / "private" / "virtual_people.json"

COL_NAME, COL_AGE, COL_GENDER, COL_JOB, COL_MBTI = 1, 4, 5, 6, 7
COL_REGION, COL_INTERESTS, COL_PERSONALITY, COL_WANTS = 8, 9, 10, 11
COL_BUDGET, COL_DATES, COL_PASS, COL_FOOD = 12, 13, 14, 16

INTERESTS = [
    "운동 (헬스, 러닝, 클라이밍 등)", "맛집·카페 탐방", "여행", "영화·드라마", "음악",
    "독서·글쓰기", "자기계발·공부", "전시·공연·아트", "패션·뷰티", "사진·영상",
]
REGION_KEYWORDS = [
    ("hongdae", ("홍대", "합정")),
    ("gangnam", ("강남", "신논현")),
    ("euljiro", ("을지로", "종로")),
    ("jamsil", ("잠실",)),
]
ALL_SEOUL = ("서울권 모두", "서울 어디든", "상관없", "무방")
BUDGET = {
    "10,000~20,000원": "10k_20k",
    "20,000~30,000원": "20k_30k",
    "30,000원 이상 (상관 없음)": "30k_plus",
}
NO_FOOD = re.compile(r"^(없|아니|x$|no$|-$|none$)", re.IGNORECASE)
MBTI = re.compile(r"[EI][NS][TF][JP]")
DATE = re.compile(r"(\d{1,2})/(\d{1,2})\s*\(목\)")


def split_choices(value):
    return [v.strip() for v in str(value or "").split(", ") if v.strip()]


def parse_interests(value):
    text = str(value or "")
    return [option for option in INTERESTS if option in text]


def parse_regions(value):
    text = str(value or "")
    if any(k in text for k in ALL_SEOUL):
        return [code for code, _ in REGION_KEYWORDS]
    found = [code for code, words in REGION_KEYWORDS if any(w in text for w in words)]
    return found


def parse_mbti(value):
    raw = str(value or "").strip()
    # Keep the first type ("E(I)NFP" -> "ENFP") and fix the common l/I typo.
    cleaned = re.sub(r"\(.*?\)", "", raw).replace("l", "I").upper()
    match = MBTI.search(cleaned)
    return (match.group(0) if match else None), raw or None


def parse_dates(value):
    text = str(value or "")
    dates = sorted({date(YEAR, int(m), int(d)).isoformat() for m, d in DATE.findall(text)})
    note = None
    memo = re.search(r"\(목\)\s*\(([^)]*)\)?", text)
    if memo and memo.group(1).strip():
        note = memo.group(1).strip()
    return dates, note


def parse_food(value):
    text = str(value or "").strip().rstrip("!.")
    if not text or text == "None" or NO_FOOD.match(text):
        return None
    return text


def main(path):
    sheet = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    rows = [r for r in list(sheet.iter_rows(values_only=True))[2:] if r[COL_NAME]]
    people = []
    for index, r in enumerate(rows, start=1):
        mbti, mbti_raw = parse_mbti(r[COL_MBTI])
        dates, date_note = parse_dates(r[COL_DATES])
        regions = parse_regions(r[COL_REGION])
        budgets = [BUDGET[b] for b in split_choices(r[COL_BUDGET]) if b in BUDGET]
        people.append({
            "key": f"vp{index:03d}",
            "display_name": str(r[COL_NAME]).strip(),
            "birth_year": YEAR - int(r[COL_AGE]),
            "gender": "female" if r[COL_GENDER] == "여" else "male",
            "mbti": mbti,
            "mbti_raw": mbti_raw,
            "interests": parse_interests(r[COL_INTERESTS]),
            "personality": split_choices(r[COL_PERSONALITY]),
            "wants": split_choices(r[COL_WANTS]),
            "budget": max(budgets) if budgets else None,
            "food_restrictions": parse_food(r[COL_FOOD]),
            "region_raw": str(r[COL_REGION] or "").strip(),
            "regions": regions,
            "dates": dates,
            "date_note": date_note,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(people, ensure_ascii=False, indent=1), encoding="utf-8")

    out_of_area = sum(1 for p in people if not p["regions"])
    no_mbti = sum(1 for p in people if not p["mbti"])
    print(f"people: {len(people)}, out of area: {out_of_area}, unknown mbti: {no_mbti}")
    print(f"written: {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
