#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Публичные сигналы по компаниям из HTML hh.ru.

API hh.ru из этой среды отдаёт 403, но обычные страницы поиска открываются
(тем же способом пользуется F:\\hh_job\\market.ps1).

Всё, что ниже, — то, что любой посетитель hh.ru видит без авторизации.
Ничего закрытого не используется.

Что собираем:
  total_open    — всего открытых вакансий работодателя
  support_open  — открытых вакансий с ключевыми словами поддержки/оператора
  M_lower      — нижняя граница потока обращений в месяц:
                  support_open × 147 полезных часов × 60 / AHT(10 мин)

M_lower считается ТОЛЬКО по новым местам (открытым вакансиям) и потому
заведомо занижен — это нижняя граница, а не оценка «как есть».
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
PRODUCTIVE_HOURS = 147
AHT = 10

SUPPORT_WORDS = [
    "поддержк",
    "оператор",
    "модератор",
    "консультант",
    "клиентского сервиса",
    "службы поддержки",
]

TARGETS = [
    ("Ozon", "Ozon"),
    ("Wildberries", "Wildberries"),
    ("Avito", "Avito"),
    ("DNS", "DNS"),
    ("Citilink", "Citilink"),
    ("X5", "X5"),
    ("М.Видео", "М.Видео"),
    ("HeadHunter", "HeadHunter"),
    ("Skillbox", "Skillbox"),
    ("Туту.ру", "Туту"),
    ("ВкусВилл", "ВкусВилл"),
    ("Авиасейлс", "Авиасейлс"),
    ("ЛаМода", "Lamoda"),
    ("Островок", "Островок"),
    ("Спортмастер", "Спортмастер"),
    ("ВсеИнструменты", "ВсеИнструменты"),
]


def get(url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"}
    )
    with urllib.request.urlopen(req, timeout=35) as r:
        return r.read().decode("utf-8", "replace")


def found_count(html: str) -> int | None:
    m = re.search(r"Найдено\s*([0-9\s\xa0]+?)\s*ваканс", html)
    if not m:
        return None
    return int(re.sub(r"[^\d]", "", m.group(1)) or 0)


def employer_id(name: str) -> tuple[int | None, str | None]:
    url = "https://hh.ru/search/employer?" + urllib.parse.urlencode({"text": name, "page": 0})
    try:
        html = get(url)
    except Exception:
        return None, None
    ids = re.findall(r'/employer/(\d+)', html)
    if not ids:
        return None, None
    emp = ids[0]
    m = re.search(r'data-qa="employer-serp__employer-name"[^>]*>(.*?)<', html, re.S)
    nm = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else None
    return int(emp), nm


def vacancies_for(emp_id: int, word: str | None) -> int | None:
    params = {"employer_id": emp_id, "area": 1, "items_on_page": 100,
              "order_by": "publication_time", "page": 0}
    if word:
        params["text"] = word
    url = "https://hh.ru/search/vacancy?" + urllib.parse.urlencode(params)
    try:
        html = get(url)
    except Exception as e:  # noqa: BLE001
        print(f"    ! {type(e).__name__}", file=sys.stderr)
        return None
    return found_count(html)


def main() -> int:
    results = []
    for label, query in TARGETS:
        emp_id, emp_name = employer_id(query)
        if not emp_id:
            print(f"{label:18} — страница работодателя не найдена")
            results.append({"name": label, "found": False})
            continue
        time.sleep(0.4)
        total = vacancies_for(emp_id, None)
        support = 0
        per_word = {}
        for w in SUPPORT_WORDS:
            c = vacancies_for(emp_id, w)
            time.sleep(0.4)
            if c is None:
                continue
            per_word[w] = c
            support += c
        m_lower = support * PRODUCTIVE_HOURS * 60 / AHT
        rec = {
            "name": label,
            "found": True,
            "employer_id": emp_id,
            "employer_name": emp_name,
            "employer_url": f"https://hh.ru/employer/{emp_id}",
            "total_open": total,
            "support_open_sum_by_word": support,
            "support_by_word": per_word,
            "m_lower_per_month": round(m_lower),
            "m_lower_basis": f"{support} вакансий по словам поддержки × {PRODUCTIVE_HOURS} ч × 60 / {AHT} мин",
        }
        results.append(rec)
        print(
            f"{label:18} id={emp_id:<8} всего={str(total):<7} поддержка(сумма)={support:<6} "
            f"M≥{m_lower:,.0f}/мес  {emp_name or ''}"
        )

    with open("hh_signals.json", "w", encoding="utf-8") as f:
        json.dump({
            "source": "hh.ru, публичные страницы поиска (без авторизации)",
            "productive_hours_per_month": PRODUCTIVE_HOURS,
            "aht_minutes": AHT,
            "note": "M_lower — нижняя граница: считается только по открытым вакансиям "
                    "поддержки, то есть по НОВЫМ местам. Реальный поток выше.",
            "observed_at": time.strftime("%Y-%m-%d"),
            "results": results,
        }, f, ensure_ascii=False, indent=2)
    print("\n-> hh_signals.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
