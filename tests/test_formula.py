#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Юнит-тесты формулы эффекта.

Эталонная реализация на Python дублирует логику docs/calc.js. Если две
реализации разойдутся — тест в CI это поймает, и опубликованные числа
нельзя будет принимать на веру.

Запуск:  python tests/test_formula.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

Q = 0.5                 # доля времени оператора, снимаемая подготовкой
FIXED_MONTH = 120_000   # фиксированные затраты на контур, ₽/мес
DAYS = 365
PRODUCTIVE_HOURS = 147  # полезных часов оператора в месяц


def calc(m=0, p1=0.5, p2=0.55, p3=0.15, aht=10.0, c=1200.0,
         cai=4.0, rev=0.0, d=0.01, margin=0.0) -> dict:
    """Полный расчёт эффекта. Все доли — в долях единицы."""
    hours_month = m * (p1 * p2 + p1 * p3 * Q) * aht / 60
    gross = hours_month * 12 * c
    cost = m * 12 * p1 * p2 * cai + FIXED_MONTH * 12
    net = gross - cost
    potential = rev * d * margin
    return {
        "hours_month": hours_month,
        "hours_year": hours_month * 12,
        "gross": gross,
        "cost": cost,
        "net": net,
        "potential": potential,
        "per_day": (net + potential) / DAYS,
        "net_per_day": net / DAYS,
    }


def approx(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def test_zero_flow_gives_zero():
    r = calc(m=0)
    assert r["gross"] == 0
    assert r["net"] == -FIXED_MONTH * 12, "при нулевом потоке остаются только фиксированные затраты"
    assert r["potential"] == 0


def test_full_tier1_closure():
    """p2 = 1 и p3 = 0: агент закрывает все tier-1 сам."""
    m = 100_000
    r = calc(m=m, p1=1.0, p2=1.0, p3=0.0, aht=10.0, c=1000.0, cai=0.0)
    # 100 000 × 10 мин = 1 000 000 минут = 16 666,7 часов в месяц
    assert approx(r["hours_month"], m * 10 / 60)
    assert approx(r["gross"], m * 10 / 60 * 12 * 1000.0)


def test_zero_unit_cost_means_net_equals_gross():
    r = calc(m=50_000, cai=0.0)
    assert approx(r["net"], r["gross"] - FIXED_MONTH * 12), "фиксированные затраты остаются даже при нулевой себестоимости обращения"


def test_cost_is_charged_only_on_fully_closed_contacts():
    """cost_ai применяется только к тем обращениям, которые агент закрыл сам."""
    m, p1, p2, cai = 100_000, 0.5, 0.55, 4.0
    r = calc(m=m, p1=p1, p2=p2, cai=cai)
    expected = m * 12 * p1 * p2 * cai + FIXED_MONTH * 12
    assert approx(r["cost"], expected)


def test_monotonic_in_volume():
    base = calc(m=10_000)["net"]
    more = calc(m=20_000)["net"]
    assert more > base, "больше обращений — больше чистого эффекта"


def test_monotonic_in_operator_cost():
    cheap = calc(m=10_000, c=800)["net"]
    dear = calc(m=10_000, c=2000)["net"]
    assert dear > cheap, "дороже оператор — выше экономия"


def test_monotonic_against_agent_unit_cost():
    cheap = calc(m=10_000, cai=1)["net"]
    dear = calc(m=10_000, cai=20)["net"]
    assert dear < cheap, "дороже обращение у агента — меньше чистый эффект"


def test_prepared_but_confirmed_saves_half_the_time():
    """p3 даёт экономию q = 0,5 от времени оператора."""
    m, p1, p3, aht, c = 100_000, 1.0, 1.0, 10.0, 1000.0
    only_confirm = calc(m=m, p1=p1, p2=0.0, p3=p3, aht=aht, c=c, cai=0.0)
    hours = m * (p1 * 0.0 + p1 * p3 * Q) * aht / 60
    assert approx(only_confirm["hours_month"], hours)
    assert hours > 0, "подготовка с подтверждением тоже экономит время"


def test_potential_channel_is_separate_from_net():
    r = calc(m=100_000, rev=1_000_000_000, d=0.01, margin=0.20)
    assert approx(r["potential"], 1_000_000_000 * 0.01 * 0.20)
    assert approx(r["per_day"], (r["net"] + r["potential"]) / DAYS)
    assert approx(r["net_per_day"], r["net"] / DAYS)


def test_per_day_matches_year():
    r = calc(m=50_000, rev=5_000_000_000, d=0.01, margin=0.15)
    assert approx(r["per_day"] * DAYS, r["net"] + r["potential"])


def test_negative_effect_is_reported_not_hidden():
    """Если экономия не покрывает стоимость — результат отрицательный, а не спрятанный."""
    r = calc(m=10, c=1000.0)
    assert r["net"] < 0


def test_gross_equals_hours_times_cost():
    r = calc(m=77_777, p1=0.47, p2=0.61, p3=0.22, aht=9.0, c=1_234.0)
    assert approx(r["gross"], r["hours_year"] * 1_234.0)


def test_js_engine_agrees_with_python_reference():
    """Браузерный движок и эталон на Python обязаны считать одинаково.

    Иначе опубликованные на странице числа и проверяемая формула разойдутся,
    и проверяемость превратится в декорацию.
    """
    node = shutil.which("node")
    js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "calc.js")
    if not node or not os.path.exists(js_path):
        print("  (node недоступен — сверка движка пропущена)")
        return

    # JS принимает доли в процентах, Python — в долях. Явно переводим.
    cases = [
        # (m, p1%, p2%, p3%, aht, c, cai, rev, d, margin)
        (757_500, 50, 30, 15, 10, 1200, 4, 998_000_000_000, 1.0, 23.0),
        (3_333_333, 50, 30, 15, 10, 1200, 4, 0, 1.0, 0.0),
        (50_000, 45, 55, 20, 8, 960, 2, 10_000_000_000, 0.5, 15.0),
        (0, 50, 55, 15, 10, 1200, 4, 0, 1.0, 0.0),
        (1_000_000, 70, 80, 0, 20, 2000, 10, 0, 2.0, 30.0),
    ]
    js_cases = [
        {
            "m": m, "p1": p1, "p2": p2, "p3": p3, "aht": aht, "c": c,
            "cai": cai, "rev": rev, "d": d, "margin": margin,
        }
        for m, p1, p2, p3, aht, c, cai, rev, d, margin in cases
    ]
    script = (
        "const m = require(%s);"
        "const cs = %s;"
        "console.log(JSON.stringify(cs.map(c => m.calc(c))));"
    ) % (json.dumps(os.path.abspath(js_path)), json.dumps(js_cases))

    res = subprocess.run([node, "-e", script], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    got = json.loads(res.stdout)

    for (m, p1, p2, p3, aht, c, cai, rev, d, margin), g in zip(cases, got):
        py = calc(m=m, p1=p1 / 100, p2=p2 / 100, p3=p3 / 100,
                  aht=aht, c=c, cai=cai, rev=rev, d=d / 100, margin=margin / 100)
        pairs = [
            ("gross", "gross"), ("cost", "cost"), ("net", "net"),
            ("potential", "potential"), ("perDay", "per_day"), ("netPerDay", "net_per_day"),
            ("hoursMonth", "hours_month"), ("hoursYear", "hours_year"),
        ]
        for js_key, py_key in pairs:
            assert approx(g[js_key], py[py_key]), (js_key, (m, p1, p2), g[js_key], py[py_key])


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL  {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
