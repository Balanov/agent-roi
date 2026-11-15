/* Калькулятор эффекта агентной автоматизации.
   Формула открыта и покрыта юнит-тестами в tests/test_formula.py.
   Данные компаний — в companies.js, отдельно от движка. */
(function () {
  "use strict";

  /* ---------- допущения модели ---------- */
  var Q = 0.5;                 // доля времени оператора, снимаемая подготовкой
  var FIXED_MONTH = 120000;    // фиксированные затраты на контур, ₽/мес
  var DAYS = 365;
  var PRODUCTIVE_HOURS = 147;  // полезных часов оператора в месяц

  var CO = {
    p1: 50,        // доля tier-1, %
    p2: 55,        // закрывает агент сам, %
    p3: 15,        // агент готовит, человек подтверждает, %
    aht: 10,       // минут на обращение
    cai: 4,        // стоимость обращения у агента, ₽
    d: 1,          // доля оборота через агентный канал, %
    c: 1200,       // стоимость часа оператора, ₽
    m: 0,          // обращений в месяц
    ops: 0,        // операторов поддержки
    rev: 0,        // выручка за год, ₽
    margin: 0      // маржа, %
  };

  /* ---------- расчёт ---------- */
  function calc(c) {
    var M = Number(c.m) || 0;
    var p1 = c.p1 / 100, p2 = c.p2 / 100, p3 = c.p3 / 100;
    var aht = Number(c.aht) || 0;
    var C = Number(c.c) || 0;
    var cai = Number(c.cai) || 0;
    var d = c.d / 100, margin = c.margin / 100;
    var rev = Number(c.rev) || 0;

    // часы, снятые с операторов, за месяц
    var hoursMonth = M * (p1 * p2 + p1 * p3 * Q) * aht / 60;
    var gross = hoursMonth * 12 * C;                        // валовая экономия, ₽/год
    var cost = M * 12 * p1 * p2 * cai + FIXED_MONTH * 12;   // стоимость решения, ₽/год
    var net = gross - cost;                                  // чистый эффект A
    var potential = rev * d * margin;                        // потенциал канала B
    var hoursYear = hoursMonth * 12;

    return {
      hoursMonth: hoursMonth,
      hoursYear: hoursYear,
      gross: gross,
      cost: cost,
      net: net,
      potential: potential,
      perDay: (net + potential) / DAYS,
      netPerDay: net / DAYS
    };
  }

  /* ---------- форматирование ---------- */
  function fmtInt(v) {
    return Math.round(v).toLocaleString("ru-RU");
  }
  function fmtMln(v) {
    var m = v / 1e6;
    if (Math.abs(m) >= 100) return fmtInt(v) + " ₽";
    return (m >= 0 ? "" : "−") + Math.abs(m).toLocaleString("ru-RU", {
      minimumFractionDigits: 1, maximumFractionDigits: 1
    }) + " млн ₽";
  }
  function fmtShort(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млрд ₽";
    if (a >= 1e6) return (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн ₽";
    if (a >= 1e3) return fmtInt(v) + " ₽";
    return fmtInt(v) + " ₽";
  }
  function fmtPct(v, dec) {
    return v.toLocaleString("ru-RU", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }) + "%";
  }

  /* ---------- состояние ---------- */
  var state = Object.assign({}, CO);
  var companies = (window.COMPANIES || []);

  /* ---------- элементы ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var elCompany = $("company"), elM = $("m"), elC = $("c"), elRev = $("rev"), elMargin = $("margin");
  var elOps = $("ops");
  var sliders = {
    p1: $("p1"), p2: $("p2"), p3: $("p3"), aht: $("aht"), cai: $("cai"), d: $("d")
  };

  function readInputs() {
    state.p1 = Number(sliders.p1.value);
    state.p2 = Number(sliders.p2.value);
    state.p3 = Number(sliders.p3.value);
    state.aht = Number(sliders.aht.value);
    state.cai = Number(sliders.cai.value);
    state.d = Number(sliders.d.value);
    state.ops = Number(elOps.value) || 0;
    state.m = Number(elM.value) || 0;
    state.c = Number(elC.value) || 0;
    state.rev = Number(elRev.value) || 0;
    state.margin = Number(elMargin.value) || 0;
  }

  /* Поток из штата: операторов × 147 полезных часов × 60 ÷ AHT. */
  function flowFromOps() {
    if (!state.ops) return 0;
    return Math.round(state.ops * PRODUCTIVE_HOURS * 60 / (state.aht || 1));
  }

  function render() {
    readInputs();
    var r = calc(state);
    var empty = !state.m && !state.rev;

    if (empty) {
      $("aNet").innerHTML = "—";
      $("aSub").textContent = "Подставьте свои цифры слева — или выберите компанию в списке ниже. Считаем только то, что можно проверить.";
      ["aGross", "aCost", "aHours", "bPot", "perDay"].forEach(function (id) {
        $(id).textContent = "—";
      });
    } else {
      $("aNet").innerHTML = fmtMln(r.net) + '<span class="cur">/год</span>';
      $("aSub").textContent = r.net >= 0
        ? "Экономия на процессе минус стоимость решения"
        : "При текущих допущениях экономия не покрывает стоимость решения — это нормальный результат, разговор всё равно полезен";
      $("aGross").textContent = fmtShort(r.gross);
      $("aCost").textContent = fmtShort(r.cost);
      $("aHours").textContent = fmtInt(r.hoursYear) + " ч";
      $("bPot").textContent = fmtShort(r.potential);
      $("perDay").textContent = fmtShort(r.perDay) + " /день";
    }

    $("mVal").textContent = state.m ? fmtInt(state.m) : "—";
    $("opsVal").textContent = state.ops ? fmtInt(state.ops) : "—";
    $("cVal").textContent = state.c ? fmtInt(state.c) + " ₽" : "—";
    $("revVal").textContent = state.rev ? fmtShort(state.rev) : "—";
    $("marginVal").textContent = state.margin ? fmtPct(state.margin, 1) : "—";
    $("p1Val").textContent = fmtPct(state.p1);
    $("p2Val").textContent = fmtPct(state.p2);
    $("p3Val").textContent = fmtPct(state.p3);
    $("ahtVal").textContent = state.aht + " мин";
    $("caiVal").textContent = state.cai + " ₽";
    $("dVal").textContent = state.d.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";

    $("fM").textContent = state.m ? fmtInt(state.m) : "—";
    $("fP1").textContent = fmtPct(state.p1);
    $("fP2").textContent = fmtPct(state.p2);
    $("fP3").textContent = fmtPct(state.p3);
    $("fAht").textContent = state.aht + " мин";
    $("fC").textContent = state.c ? fmtInt(state.c) + " ₽" : "—";
    $("fCai").textContent = state.cai + " ₽";
    $("fRev").textContent = state.rev ? fmtShort(state.rev) : "—";
    $("fD").textContent = state.d.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
    $("fMargin").textContent = state.margin ? fmtPct(state.margin, 1) : "—";

    renderGrid(r);
  }

  /* ---------- карточки компаний ---------- */
  function renderGrid(r) {
    var grid = $("companyGrid");
    if (!grid) return;
    grid.innerHTML = "";
    companies.forEach(function (co) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "comp" + (co.id === state.id ? " is-active" : "");
      var eff = "";
      var effLabel = "экономия в год";
      if (co.m && co.c) {
        var rr = calc(Object.assign({}, state, { m: co.m, c: co.c, rev: co.rev || 0, margin: co.margin || 0 }));
        eff = fmtShort(rr.net);
      } else {
        eff = "нужен штат";
        effLabel = "объём поддержки не раскрыт";
      }
      var hh = co.hh ? " · " + fmtInt(co.hh) + " вак. hh" : "";
      card.innerHTML =
        '<div class="nm">' + co.name + "</div>" +
        '<div class="sec">' + co.sector + "</div>" +
        '<div class="eff"><span>' + effLabel + '</span><b>' + eff + "</b></div>" +
        '<div class="src">' + (co.srcShort || "") + hh + "</div>";
      card.addEventListener("click", function () { applyCompany(co); });
      grid.appendChild(card);
    });
  }

  /* ---------- применение компании ---------- */
  function applyCompany(co) {
    state.id = co.id;
    if (co.m) {
      elM.value = co.m;
      // Эквивалентный штат, чтобы было видно, сколько это людей.
      if (elOps) {
        var aht = Number(sliders.aht.value) || 10;
        elOps.value = Math.max(0, Math.round(co.m * aht / (PRODUCTIVE_HOURS * 60)));
      }
      $("mHint").innerHTML = co.mSource || "";
    } else {
      elM.value = "";
      if (elOps) elOps.value = "";
      $("mHint").innerHTML = co.mSource
        ? co.mSource
        : "Публично не раскрыто — подставьте свой штат поддержки слева, поток выведется автоматически";
    }
    if (co.c) elC.value = co.c;
    if (co.rev) elRev.value = co.rev;
    if (co.margin) elMargin.value = co.margin;
    if (co.over) {
      Object.keys(co.over).forEach(function (k) {
        if (sliders[k]) sliders[k].value = co.over[k];
      });
    }
    elCompany.value = co.id;

    $("companyHint").innerHTML = co.hint || "";
    $("revHint").innerHTML = co.revSource
      ? "Источник: " + co.revSource + (co.revType === "estimate" ? " <b>(оценка)</b>" : "")
      : "Публичных данных нет — подставьте из своей отчётности";
    $("marginHint").innerHTML = co.marginSource
      ? "Источник: " + co.marginSource
      : "Маржа не раскрыта — подставьте свою";
    render();
  }

  /* ---------- селект компаний ---------- */
  function buildSelect() {
    if (!elCompany) return;
    var html = '<option value="">— свои цифры —</option>';
    companies.forEach(function (co) {
      html += '<option value="' + co.id + '">' + co.name + " — " + co.sector + "</option>";
    });
    elCompany.innerHTML = html;
    elCompany.addEventListener("change", function () {
      var id = elCompany.value;
      if (!id) {
        state.id = null;
        $("companyHint").textContent = "Публичные данные подставятся автоматически. Всё можно изменить.";
        ["mHint", "revHint", "marginHint"].forEach(function (id2) { $(id2).textContent = ""; });
        render();
        return;
      }
      var co = companies.filter(function (x) { return x.id === id; })[0];
      if (co) applyCompany(co);
    });
  }

  /* ---------- события ---------- */
  Object.keys(sliders).forEach(function (k) {
    if (sliders[k]) sliders[k].addEventListener("input", render);
  });

  // штат поддержки → поток обращений
  if (elOps) {
    elOps.addEventListener("input", function () {
      readInputs();
      if (state.ops) {
        elM.value = flowFromOps();
        $("mHint").innerHTML = "Выведено из штата: " + fmtInt(state.ops) +
          " операторов × " + PRODUCTIVE_HOURS + " ч × 60 ÷ " + state.aht + " мин";
      }
      render();
    });
  }
  // ручная правка потока сбрасывает вывод из штата
  if (elM) {
    elM.addEventListener("input", function () {
      if (elOps) elOps.value = "";
      readInputs();
      if (state.m) {
        $("mHint").innerHTML = "Введено вручную. Проверьте, что совпадает со штатом поддержки.";
      }
      render();
    });
  }
  // изменение AHT пересчитывает поток, если он выведен из штата
  if (sliders.aht) {
    sliders.aht.addEventListener("input", function () {
      readInputs();
      if (state.ops) {
        elM.value = flowFromOps();
        $("mHint").innerHTML = "Пересчитано: " + fmtInt(state.ops) +
          " операторов × " + PRODUCTIVE_HOURS + " ч × 60 ÷ " + state.aht + " мин";
      }
      render();
    });
  }

  [elC, elRev, elMargin].forEach(function (el) {
    if (el) el.addEventListener("input", render);
  });

  /* ---------- появление ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  buildSelect();
  render();

  // для тестов и внешних скриптов
  window.CONTOUR = { calc: calc, CO: CO, Q: Q, FIXED_MONTH: FIXED_MONTH };
})();
