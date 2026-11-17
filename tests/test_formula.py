#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Юнит-тесты формулы потери спроса.

Модель: сколько денег компания теряет, пока её каталог недоступен
ИИ-агенту покупателя.

    demand   = rev × d          весь спрос, который приходит от ИИ-агентов
    lost     = demand × u       часть, уходящая конкурентам (каталог не готов)
    captured = demand × (1 − u)  часть, которую компания уже получает

rev — публичный оборот (₽/год), d — доля спроса от агентов, u — наш замер
готовности витрины (1 = витрина закрыта для агента целиком).

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

PILOT_LOW = 1_500_000     # нижняя граница пилота-аудита, ₽
PILOT_HIGH = 3_000_000


def calc(rev: float = 0.0, d: float = 0.01, u=None) -> dict:
    """Полный расчёт. d — доля в долях единицы, u — доля недоступных товаров."""
    demand = rev * d
    lost = 0.0 if u is None else demand * u
    captured = demand if u is None else demand * (1.0 - u)
    return {
        "demand": demand,
        "lost": lost,
        "captured": captured,
        "payback_months": (PILOT_LOW / (lost / 12.0)) if lost > 0 else None,
    }


def approx(a: float, b: float, tol: float = 1e-9) -> bool:
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def test_zero_turnover_gives_zero():
    r = calc(rev=0.0, d=0.01, u=1.0)
    assert r["demand"] == 0
    assert r["lost"] == 0
    assert r["captured"] == 0
    assert r["payback_months"] is None, "при нулевой потере окупаемости нет"


def test_zero_share_gives_zero():
    r = calc(rev=998_000_000_000, d=0.0, u=1.0)
    assert r["demand"] == 0 and r["lost"] == 0


def test_closed_storefront_loses_everything():
    """Витрина закрыта для агента: u = 1, весь агентский спрос уходит."""
    rev = 998_000_000_000
    r = calc(rev=rev, d=0.01, u=1.0)
    assert approx(r["demand"], rev * 0.01)
    assert approx(r["lost"], rev * 0.01)
    assert approx(r["captured"], 0.0)


def test_ready_storefront_loses_nothing():
    """Витрина готова: u = 0, потери нет, спрос уже получают."""
    rev = 107_500_000_000
    r = calc(rev=rev, d=0.01, u=0.0)
    assert approx(r["lost"], 0.0)
    assert approx(r["captured"], rev * 0.01)


def test_partially_ready_storefront():
    """Половина товаров недоступна — теряется ровно половина агентского спроса."""
    rev = 10_000_000_000
    r = calc(rev=rev, d=0.02, u=0.5)
    assert approx(r["demand"], 200_000_000)
    assert approx(r["lost"], 100_000_000)
    assert approx(r["captured"], 100_000_000)


def test_lost_plus_captured_equals_demand():
    r = calc(rev=781_000_000_000, d=0.01, u=0.37)
    assert approx(r["lost"] + r["captured"], r["demand"])


def test_monotonic_in_turnover():
    small = calc(rev=10_000_000_000, d=0.01, u=1.0)["lost"]
    big = calc(rev=100_000_000_000, d=0.01, u=1.0)["lost"]
    assert big > small, "больше оборот — больше потеря"


def test_monotonic_in_agent_share():
    low = calc(rev=998_000_000_000, d=0.005, u=1.0)["lost"]
    high = calc(rev=998_000_000_000, d=0.04, u=1.0)["lost"]
    assert high > low, "выше доля агентского спроса — больше потеря"


def test_monotonic_in_unreachable_share():
    ready = calc(rev=998_000_000_000, d=0.01, u=0.0)["lost"]
    half = calc(rev=998_000_000_000, d=0.01, u=0.5)["lost"]
    closed = calc(rev=998_000_000_000, d=0.01, u=1.0)["lost"]
    assert ready < half < closed


def test_payback_months():
    """Пилот окупается за 12 месяцев, когда потеря равна стоимости пилота за год."""
    rev = 150_000_000
    r = calc(rev=rev, d=0.01, u=1.0)
    assert approx(r["lost"], 1_500_000)
    assert approx(r["payback_months"], 12.0)


def test_no_payback_when_nothing_is_lost():
    r = calc(rev=998_000_000_000, d=0.01, u=0.0)
    assert r["payback_months"] is None


def test_unmeasured_storefront_counts_as_no_loss():
    """u = null: измерить не удалось — потерю не выдумываем, но и спрос не теряем."""
    r = calc(rev=998_000_000_000, d=0.01, u=None)
    assert r["lost"] == 0
    assert approx(r["captured"], r["demand"])


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

    # JS принимает d в процентах, Python — в долях. Явно переводим.
    cases = [
        # (rev, d (доля), u)
        (998_000_000_000, 0.01, 1.0),
        (6_100_000_000_000, 0.04, 1.0),
        (781_000_000_000, 0.005, 1.0),
        (107_500_000_000, 0.01, 0.0),
        (10_900_000_000, 0.02, 1.0),
        (165_600_000_000, 0.01, 0.25),
        (0, 0.01, 1.0),
    ]
    js_cases = [{"rev": rev, "d": d * 100.0, "u": u} for rev, d, u in cases]
    script = (
        "const m = require(%s);"
        "const cs = %s;"
        "console.log(JSON.stringify(cs.map(c => {"
        "  const r = m.calc(c);"
        "  return {demand: r.demand, lost: r.lost, captured: r.captured};"
        "})));"
    ) % (json.dumps(js_path), json.dumps(js_cases))

    result = subprocess.run([node, "-e", script], capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr[:800])
        raise AssertionError("движок в Node не отработал")

    js_rows = json.loads(result.stdout.strip().splitlines()[-1])
    assert len(js_rows) == len(cases)
    for (rev, d, u), row in zip(cases, js_rows):
        expected = calc(rev=rev, d=d, u=u)
        assert approx(row["demand"], expected["demand"]), f"расхождение demand: {rev} {d} {u}"
        assert approx(row["lost"], expected["lost"]), f"расхождение lost: {rev} {d} {u}"
        assert approx(row["captured"], expected["captured"]), f"расхождение captured: {rev} {d} {u}"


def main() -> int:
    tests = [value for name, value in globals().items() if name.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
            print("PASS", test.__name__)
        except AssertionError as error:
            failed += 1
            print("FAIL", test.__name__, "-", error)
        except Exception as error:  # noqa: BLE001
            failed += 1
            print("ERROR", test.__name__, "-", error)
    print("\n%d/%d passed" % (len(tests) - failed, len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
