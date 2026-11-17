/* ПРОСЧЁТ — движок расчёта и витрины.
 *
 * Формула вынесена в чистую функцию calc(): она работает и в браузере, и в Node,
 * чтобы эталон на Python можно было сверять с тем, что считает страница.
 * Всё остальное — интерфейс, и в Node не выполняется.
 */
(function () {
  "use strict";

  /* ================= ФОРМУЛА ================= */

  var Q = 0.5;                 // доля времени оператора, снимаемая подготовкой
  var FIXED_MONTH = 120000;    // фиксированные затраты на контур, ₽/мес
  var DAYS = 365;
  var PRODUCTIVE_HOURS = 147;  // полезных часов оператора в месяц

  var CO = {
    p1: 50, p2: 55, p3: 15, aht: 10, cai: 4, d: 1,
    c: 1200, m: 0, ops: 0, rev: 0, margin: 0
  };

  function calc(c) {
    var M = Number(c.m) || 0;
    var p1 = c.p1 / 100, p2 = c.p2 / 100, p3 = c.p3 / 100;
    var aht = Number(c.aht) || 0;
    var C = Number(c.c) || 0;
    var cai = Number(c.cai) || 0;
    var d = c.d / 100, margin = c.margin / 100;
    var rev = Number(c.rev) || 0;

    var hoursMonth = M * (p1 * p2 + p1 * p3 * Q) * aht / 60;
    var gross = hoursMonth * 12 * C;
    var cost = M * 12 * p1 * p2 * cai + FIXED_MONTH * 12;
    var net = gross - cost;
    var potential = rev * d * margin;

    return {
      hoursMonth: hoursMonth,
      hoursYear: hoursMonth * 12,
      gross: gross, cost: cost, net: net, potential: potential,
      perDay: (net + potential) / DAYS,
      netPerDay: net / DAYS
    };
  }

  var api = {
    calc: calc, CO: CO, Q: Q, FIXED_MONTH: FIXED_MONTH, PRODUCTIVE_HOURS: PRODUCTIVE_HOURS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CONTOUR = api;
  if (typeof document === "undefined") return;

  /* ================= ИНТЕРФЕЙС ================= */

  var $ = function (id) { return document.getElementById(id); };
  var state = Object.assign({}, CO);
  var companies = (window.COMPANIES || []);
  var readiness = (window.READINESS || []);

  var elCompany = $("company"), elM = $("m"), elC = $("c"), elRev = $("rev"),
      elMargin = $("margin"), elOps = $("ops");
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
    state.ops = elOps ? (Number(elOps.value) || 0) : 0;
    state.m = elM ? (Number(elM.value) || 0) : 0;
    state.c = elC ? (Number(elC.value) || 0) : 0;
    // выручка и маржа приходят из карточки компании, а не из полей ввода
    if (elRev) state.rev = Number(elRev.value) || 0;
    if (elMargin) state.margin = Number(elMargin.value) || 0;
  }

  function flowFromOps() {
    if (!state.ops) return 0;
    return Math.round(state.ops * PRODUCTIVE_HOURS * 60 / (state.aht || 1));
  }

  /* ---------- форматирование ---------- */
  function fmtInt(v) { return Math.round(v).toLocaleString("ru-RU"); }
  function fmtMoney(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " млрд ₽";
    if (a >= 1e6) return (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн ₽";
    if (a >= 1e3) return fmtInt(v) + " ₽";
    return fmtInt(v) + " ₽";
  }
  function fmtPct(v, dec) {
    return v.toLocaleString("ru-RU", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }) + "%";
  }
  function fmtHours(v) { return fmtInt(v) + " ч"; }

  /* ---------- пересчёт и вывод ---------- */
  var lastNet = null;
  var netCur = 0;
  var netRaf = null;

  function setNet(target) {
    var node = $("aNet");
    if (!node) return;
    if (netRaf) { cancelAnimationFrame(netRaf); netRaf = null; }
    if (document.hidden) {
      // в свёрнутой вкладке анимация не идёт — показываем итог сразу
      netCur = target;
      node.textContent = fmtMoney(target);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        Math.abs(target - netCur) < 1) {
      netCur = target;
      node.textContent = fmtMoney(target);
      return;
    }
    var from = netCur, t0 = null, dur = 560;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      netCur = from + (target - from) * e;
      node.textContent = fmtMoney(netCur);
      if (p < 1) {
        netRaf = requestAnimationFrame(step);
      } else {
        netRaf = null;
        netCur = target;
        node.textContent = fmtMoney(target);
      }
    }
    netRaf = requestAnimationFrame(step);
  }

  function render() {
    readInputs();
    var r = calc(state);
    var empty = !state.m && !state.rev;

    if (empty) {
      if (netRaf) { cancelAnimationFrame(netRaf); netRaf = null; }
      netCur = 0;
      $("aNet").textContent = "—";
    } else {
      setNet(r.net);
    }

    $("aSub").textContent = empty
      ? "Выберите компанию или впишите свой штат поддержки — посчитаем по открытым данным."
      : (r.net >= 0
        ? "Столько возвращает год поддержки при текущих допущениях. Проверяется пилотом за 2–3 недели."
        : "При текущих допущениях экономия не покрывает стоимость решения — это нормальный результат, разговор всё равно полезен.");

    $("aGross").textContent = empty ? "—" : fmtMoney(r.gross);
    $("aCost").textContent = empty ? "—" : fmtMoney(r.cost);
    $("aHours").textContent = empty ? "—" : fmtHours(r.hoursYear);
    $("aFte").textContent = empty ? "—" : fmtInt(Math.round(r.hoursYear / (PRODUCTIVE_HOURS * 12)));
    $("bPot").textContent = empty ? "—" : fmtMoney(r.potential);
    $("perDay").textContent = empty ? "—" : fmtMoney(r.perDay) + " /день";

    $("opsVal").textContent = state.ops ? fmtInt(state.ops) : "—";
    $("mVal").textContent = state.m ? fmtInt(state.m) : "—";
    $("cVal").textContent = state.c ? fmtInt(state.c) + " ₽" : "—";
    $("p1Val").textContent = fmtPct(state.p1);
    $("p2Val").textContent = fmtPct(state.p2);
    $("p3Val").textContent = fmtPct(state.p3);
    $("ahtVal").textContent = state.aht + " мин";
    $("caiVal").textContent = state.cai + " ₽";
    $("dVal").textContent = state.d.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";

    if (lastNet !== null && Math.abs(lastNet - r.net) > 1) {
      var node = $("aNet");
      node.classList.add("changed");
      setTimeout(function () { node.classList.remove("changed"); }, 600);
    }
    lastNet = r.net;

    renderWaterfall(r, empty);
    renderScenarios(r, empty);
    renderGrid(r);
  }

  /* ---------- состав суммы ---------- */
  function renderWaterfall(r, empty) {
    var max = Math.max(r.gross, r.cost, 1);
    setWf("barHours", "wfHours", r.hoursYear / max, empty ? "—" : fmtHours(r.hoursYear));
    setWf("barGross", "wfGross", r.gross / max, empty ? "—" : fmtMoney(r.gross));
    setWf("barCost", "wfCost", r.cost / max, empty ? "—" : "− " + fmtMoney(r.cost));
    setWf("barNet", "wfNet", r.net / max, empty ? "—" : fmtMoney(r.net));
  }

  function setWf(barId, valId, ratio, text) {
    var bar = $(barId);
    var val = $(valId);
    if (bar) bar.style.width = Math.max(0, Math.min(100, ratio * 100)) + "%";
    if (val) val.textContent = text;
  }

  /* ---------- сценарии: диапазон вместо одной точки ---------- */
  var SC_LOW_P2 = 20;   // факт Ozon: собственный ассистент закрывает до 20%
  var SC_HIGH_P2 = 84;  // верхняя граница Intercom

  function renderScenarios(r, empty) {
    var lo = $("scLow"), base = $("scBase"), hi = $("scHigh");
    if (!lo || !base || !hi) return;
    if (empty) {
      lo.textContent = "—";
      base.textContent = "—";
      hi.textContent = "—";
      return;
    }
    lo.textContent = fmtMoney(calc(Object.assign({}, state, { p2: SC_LOW_P2 })).net);
    base.textContent = fmtMoney(r.net);
    hi.textContent = fmtMoney(calc(Object.assign({}, state, { p2: SC_HIGH_P2 })).net);
  }

  /* ---------- сетка компаний ---------- */
  function companyTag(co) {
    if (!co.m) return { cls: "na", text: "не раскрыто" };
    if (co.mType === "open") return { cls: "", text: "публично" };
    return { cls: "est", text: "оценка снизу" };
  }

  function renderGrid(r) {
    var grid = $("companyGrid");
    if (!grid) return;
    grid.innerHTML = "";
    companies.forEach(function (co) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "co";
      var tag = companyTag(co);
      var eff = "";
      var note = "";
      if (co.m && co.c) {
        var rr = calc(Object.assign({}, state, {
          m: co.m, c: co.c, rev: co.rev || 0, margin: co.margin || 0
        }, co.over || {}));
        eff = fmtMoney(rr.net);
        note = co.mType === "open"
          ? (co.srcShort || "")
          : "оценка снизу · " + (co.srcShort || "");
      } else {
        eff = "нужен штат";
        note = "публично не раскрыто — впишите свой штат поддержки";
      }
      var hh = co.hh ? " · " + fmtInt(co.hh) + " вак. hh" : "";
      card.innerHTML =
        '<div class="nm">' + co.name + '<span class="tag ' + tag.cls + '">' + tag.text + "</span></div>" +
        '<div class="sec">' + co.sector + "</div>" +
        '<div class="eff"><span>экономия в год</span><b>' + eff + "</b></div>" +
        '<div class="src">' + note + hh + "</div>";
      card.addEventListener("click", function () { openDrawer(co); });
      grid.appendChild(card);
    });
  }

  /* ---------- боковая панель ---------- */
  function openDrawer(co) {
    var rr = calc(Object.assign({}, state, {
      m: co.m || 0, c: co.c || state.c, rev: co.rev || 0, margin: co.margin || 0
    }, co.over || {}));

    $("dSector").textContent = co.sector;
    $("dTitle").textContent = co.name;
    $("dSub").textContent = co.srcShort || "";
    $("dNet").textContent = (co.m && co.c) ? fmtMoney(rr.net) : "нужен штат";

    var rows = [
      ["Выручка за год", co.rev ? fmtMoney(co.rev) : "не раскрыта"],
      ["Маржа", co.margin ? fmtPct(co.margin, 1) : "не раскрыта"],
      ["Объём поддержки", co.m ? fmtInt(co.m) + " обращений/мес" : "не раскрыт"],
      ["Как получено", co.mType === "open" ? "раскрыто компанией" : (co.mType ? "оценка снизу" : "—")],
      ["Эквивалентный штат", co.m ? fmtInt(Math.round(co.m * state.aht / (PRODUCTIVE_HOURS * 60))) + " операторов" : "—"],
      ["Экономия на процессе", co.m ? fmtMoney(rr.net) + " /год" : "нужен штат"],
      ["Вакансий на hh.ru", co.hh ? fmtInt(co.hh) : "—"]
    ];
    $("dKv").innerHTML = rows.map(function (x) {
      return '<div class="kv"><span class="k">' + x[0] + '</span><span class="v">' + x[1] + "</span></div>";
    }).join("");

    var srcs = [];
    if (co.mSource) srcs.push(co.mSource);
    if (co.revSource) srcs.push(co.revSource);
    if (co.marginSource) srcs.push(co.marginSource);
    if (co.derivation) srcs.push("<b>Вывод: " + co.derivation + "</b>");
    if (co.caveat) srcs.push("<b>Оговорка: " + co.caveat + "</b>");
    if (co.quote) srcs.push("<i>«" + co.quote + "»</i>");
    $("dSrcs").innerHTML = srcs.map(function (s) {
      return "<div>" + s + "</div>";
    }).join("") || '<div>Источников нет</div>';

    $("drawer").classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    $("drawer").classList.remove("open");
    document.body.style.overflow = "";
  }

  /* ---------- тепловая карта ---------- */
  var HEAT_COLS = [
    { key: "http", label: "GET 200" },
    { key: "name", label: "name" },
    { key: "price", label: "price" },
    { key: "availability", label: "availability" },
    { key: "sku", label: "sku" }
  ];

  function heatCell(value) {
    if (value === null || value === undefined) {
      return { bg: "var(--line)", title: "не измерено" };
    }
    if (value === "yes") return { bg: "oklch(.62 .13 207)", title: "доступно" };
    if (value === "no") return { bg: "oklch(.86 .03 22)", title: "недоступно" };
    if (value >= 0.75) return { bg: "oklch(.62 .13 207)", title: Math.round(value * 100) + "%" };
    if (value >= 0.4) return { bg: "oklch(.74 .12 207)", title: Math.round(value * 100) + "%" };
    if (value > 0) return { bg: "oklch(.84 .11 207)", title: Math.round(value * 100) + "%" };
    return { bg: "oklch(.95 .03 207)", title: "0%" };
  }

  function renderHeat() {
    var host = $("heat");
    if (!host || !readiness.length) return;
    host.style.setProperty("--cols", String(HEAT_COLS.length));

    var head = '<div class="heat-row"><span class="hname" style="font:600 10px var(--mono);color:var(--muted);letter-spacing:.06em">ВИТРИНА</span>' +
      HEAT_COLS.map(function (c) { return '<span class="hlbl">' + c.label + "</span>"; }).join("") + "</div>";
    host.innerHTML = head;

    readiness.forEach(function (row, idx) {
      var el = document.createElement("div");
      el.className = "heat-row";
      var cells = "";
      HEAT_COLS.forEach(function (col) {
        var v = null;
        if (col.key === "http") v = row.status === 200 ? "yes" : "no";
        else if (row.total) v = row.cov[col.key];
        var c = heatCell(v);
        cells += '<span class="cell" style="background:' + c.bg + '" title="' +
          row.name + " · " + col.label + ": " + c.title + '"></span>';
      });
      el.innerHTML = '<span class="hname" title="' + row.name + '">' + row.name + "</span>" + cells;
      el.style.opacity = "0";
      el.style.transform = "translateX(-10px)";
      el.style.transition = "opacity .5s var(--ease),transform .5s var(--ease)";
      host.appendChild(el);
      setTimeout(function () {
        el.style.opacity = "1";
        el.style.transform = "none";
        el.querySelectorAll(".cell").forEach(function (cell, k) {
          setTimeout(function () { cell.classList.add("on"); }, k * 22);
        });
      }, 40 * idx);
    });
  }

  /* ---------- счётчики при прокрутке ---------- */
  function countUp(el) {
    var target = parseFloat(el.dataset.count || "0");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = fmtInt(target);
      return;
    }
    var t0 = null, dur = 1100;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtInt(target * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- построение ---------- */
  function buildSelect() {
    if (!elCompany) return;
    var html = '<option value="">— выберите компанию —</option>';
    companies.forEach(function (co) {
      html += '<option value="' + co.id + '">' + co.name + " — " + co.sector + "</option>";
    });
    elCompany.innerHTML = html;
  }

  function paintCounts() {
    var marks = document.querySelectorAll("[data-count-companies]");
    for (var i = 0; i < marks.length; i++) {
      marks[i].textContent = String(companies.length);
    }
  }

  function hideExample() {
    var note = $("exampleNote");
    if (note) note.hidden = true;
  }

  function applyCompany(co) {
    state.id = co.id;
    state.rev = co.rev || 0;
    state.margin = co.margin || 0;
    if (co.m) {
      elM.value = co.m;
      var aht = Number(sliders.aht.value) || 10;
      elOps.value = Math.max(0, Math.round(co.m * aht / (PRODUCTIVE_HOURS * 60)));
      $("companyHint").innerHTML = co.mSource || "";
    } else {
      elM.value = "";
      elOps.value = "";
      $("companyHint").innerHTML = co.mSource ||
        "Публично не раскрыто — подставьте свой штат поддержки, поток выведется автоматически";
    }
    if (co.c) elC.value = co.c;
    if (elRev && co.rev) elRev.value = co.rev;
    if (elMargin && co.margin) elMargin.value = co.margin;
    if (co.over) {
      Object.keys(co.over).forEach(function (k) { if (sliders[k]) sliders[k].value = co.over[k]; });
    }
    elCompany.value = co.id;
    render();
  }

  /* ---------- события ---------- */
  function bind() {
    Object.keys(sliders).forEach(function (k) {
      if (sliders[k]) sliders[k].addEventListener("input", function () {
        readInputs();
        if (sliders[k] === sliders.aht && state.ops) {
          elM.value = flowFromOps();
        }
        render();
      });
    });

    elOps.addEventListener("input", function () {
      hideExample();
      readInputs();
      if (state.ops) {
        elM.value = flowFromOps();
      }
      render();
    });

    if (elM) {
      elM.addEventListener("input", function () {
        elOps.value = "";
        readInputs();
        render();
      });
    }

    [elC, elRev, elMargin].forEach(function (el) {
      if (el) el.addEventListener("input", render);
    });

    elCompany.addEventListener("change", function () {
      hideExample();
      var id = elCompany.value;
      if (!id) {
        state.id = null;
        state.rev = 0;
        state.margin = 0;
        $("companyHint").textContent = "Выберите компанию или впишите свой штат поддержки.";
        render();
        return;
      }
      var co = companies.filter(function (x) { return x.id === id; })[0];
      if (co) applyCompany(co);
    });

    // плитки формулы ведут на источник
    document.querySelectorAll(".tile").forEach(function (t) {
      t.addEventListener("click", function () {
        var u = t.dataset.src;
        if (u) window.open(u, "_blank", "noopener");
      });
    });

    // копирование формулы
    var copy = $("copyFormula");
    if (copy) {
      copy.addEventListener("click", function () {
        var text = ($("formulaText").innerText || "").trim();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function () {
            copy.textContent = "скопировано";
            setTimeout(function () { copy.textContent = "скопировать"; }, 1600);
          });
        }
      });
    }

    // панель
    document.querySelectorAll("[data-close]").forEach(function (n) {
      n.addEventListener("click", closeDrawer);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawer();
    });

    // появление блоков и счётчики
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          if (e.target.dataset.count !== undefined) countUp(e.target);
          io.unobserve(e.target);
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
      document.querySelectorAll(".rv").forEach(function (el) { io.observe(el); });
      document.querySelectorAll("[data-count]").forEach(function (el) { io.observe(el); });
    } else {
      document.querySelectorAll(".rv").forEach(function (el) { el.classList.add("in"); });
      document.querySelectorAll("[data-count]").forEach(function (el) { countUp(el); });
    }
  }

  /* ---------- пример на публичных данных ---------- */
  function initExample() {
    var co = companies.filter(function (x) { return x.id === "ozon"; })[0];
    if (!co) return;
    applyCompany(co);
    var note = $("exampleNote");
    if (note) note.hidden = false;
  }

  buildSelect();
  paintCounts();
  initExample();
  render();
  renderHeat();
  bind();
})();
