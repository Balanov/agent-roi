/* ПРОСЧЁТ — движок расчёта потери спроса из-за неготового каталога.
 *
 * Смысл: агент покупателя приходит к витрине и уходит, если каталог для него
 * закрыт или в карточках нет нужных полей. Мы это измерили (readiness-probe),
 * перевели в деньги по публичному обороту владельца и получили сумму, которая
 * сейчас уходит конкурентам.
 *
 * Формула:
 *   demand   = rev × d                 весь спрос, который приходит от ИИ-агентов
 *   lost     = demand × u              часть, уходящая конкурентам (каталог не готов)
 *   captured = demand × (1 − u)        часть, которую вы уже получаете
 *   payback  = pilot / (lost / 12)     месяцев окупаемости пилота
 *
 * rev — публичный оборот (выручка или GMV) с ссылкой; u — наш замер готовности.
 * d — доля спроса от ИИ-агентов: допущение с диапазоном и источниками.
 *
 * Формула вынесена в чистую функцию calc(): она работает и в браузере, и в Node,
 * чтобы эталон на Python можно было сверять с тем, что считает страница.
 */
(function () {
  "use strict";

  /* ================= ФОРМУЛА ================= */

  var D_LOW = 0.5;              // нижняя граница доли спроса от агентов, %
  var D_HIGH = 4;               // верхняя граница (прогноз доли рынка к 2028–29), %
  var PILOT_LOW = 1500000;      // пилот-аудит, ₽
  var PILOT_HIGH = 3000000;

  var CO = { d: 1 };

  function calc(c) {
    var rev = Number(c.rev) || 0;
    var d = Number(c.d) / 100;
    var u = c.u === null || c.u === undefined ? null : Number(c.u);

    var demand = rev * d;
    var lost = u === null ? 0 : demand * u;
    var captured = u === null ? demand : demand * (1 - u);

    return {
      demand: demand,
      lost: lost,
      captured: captured,
      d: d,
      u: u,
      paybackMonths: lost > 0 ? (PILOT_LOW / (lost / 12)) : null
    };
  }

  var api = {
    calc: calc, CO: CO, D_LOW: D_LOW, D_HIGH: D_HIGH, PILOT_LOW: PILOT_LOW, PILOT_HIGH: PILOT_HIGH
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CONTOUR = api;
  if (typeof document === "undefined") return;

  /* ================= ИНТЕРФЕЙС ================= */

  var $ = function (id) { return document.getElementById(id); };
  var state = Object.assign({}, CO);
  var readiness = (window.READINESS || []);
  var corpus = (window.READINESS_COMPANIES || []);

  var elStore = $("company");
  var sliderD = $("d");

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

  /* ---------- данные замера: числа на странице считаются, а не хранятся текстом ---------- */
  function measure() {
    var CLOSED = [401, 403, 307, 498, 439];
    var stores = readiness.filter(function (r) { return String(r.name).indexOf("CONTROL") !== 0; });
    var cards = 0, full = 0, closed = 0, usableTotal = 0, usableCards = 0;

    stores.forEach(function (r) {
      var total = r.total || 0;
      var cov = r.cov || {};
      cards += total;
      if (CLOSED.indexOf(r.status) >= 0) closed++;
      if (!total) return;
      var usable = Math.min(cov.name || 0, cov.price || 0, cov.priceCurrency || 0, cov.availability || 0);
      usableTotal += usable * total;
      usableCards += total;
      if (usable >= 1) full += total;
    });

    return {
      stores: stores.length,
      cards: cards,
      full: full,
      closed: closed,
      usableShare: usableCards ? usableTotal / usableCards : 0
    };
  }

  function paintMeasure() {
    var m = measure();
    var set = function (id, value) { var el = $(id); if (el) el.textContent = value; };
    set("mStores", String(m.stores));
    set("mCards", String(m.cards));
    set("mClosed", String(m.closed));
    set("mUsable", Math.round(m.usableShare * 100) + "%");
  }

  /* ---------- расчёт ---------- */
  function current() {
    var row = corpus.filter(function (c) { return c.store === state.store; })[0];
    if (!row) return null;
    return Object.assign({}, state, { rev: row.rev, u: row.unreachable, row: row });
  }

  function render() {
    if (sliderD) state.d = Number(sliderD.value);
    renderExamples();
    var data = current();
    var out = $("calcOut");
    if (!data || !data.row) {
      $("aNet").textContent = "—";
      $("aSub").textContent = "Выберите витрину из замера.";
      return;
    }

    var r = calc(data);
    var row = data.row;
    var closed = row.unreachable === 1 && row.cards === 0 && row.status !== 200;
    var closedByCode = [401, 403, 307, 498, 439].indexOf(row.status) >= 0;

    $("aNet").textContent = fmtMoney(r.lost);
    $("aSub").textContent = closedByCode
      ? "Столько вы теряете в год, пока витрина не отвечает анонимному агенту (HTTP " + row.status + ")."
      : (row.unreachable === 0
        ? "Эта витрина уже готова: агент видит карточки и может покупать."
        : "Столько вы теряете в год на товарах, которых агент не может купить.");

    $("aDemand").textContent = fmtMoney(r.demand);
    $("aCaptured").textContent = fmtMoney(r.captured);
    $("aPayback").textContent = r.paybackMonths
      ? (r.paybackMonths < 12
        ? "≈ " + Math.max(1, Math.round(r.paybackMonths)) + " мес."
        : "≈ " + (r.paybackMonths / 12).toFixed(1) + " года")
      : "—";

    $("dVal").textContent = state.d.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";

    // состав агентского спроса: что получаете и что уходит
    var total = r.demand || 1;
    var wLost = Math.round(r.lost / total * 100);
    var wCap = 100 - wLost;
    $("capBar").style.width = wCap + "%";
    $("lostBar").style.width = wLost + "%";
    $("capLegend").textContent = "получаете " + fmtMoney(r.captured);
    $("lostLegend").textContent = "уходит " + fmtMoney(r.lost);

    renderScenarios(data);
  }

  /* ---------- сценарии по доле агентского спроса ---------- */
  function renderScenarios(data) {
    var lo = $("scLow"), base = $("scBase"), hi = $("scHigh");
    if (!lo || !base || !hi) return;
    if (!data || !data.row) {
      lo.textContent = base.textContent = hi.textContent = "—";
      return;
    }
    lo.textContent = fmtMoney(calc(Object.assign({}, data, { d: D_LOW })).lost);
    base.textContent = fmtMoney(calc(Object.assign({}, data, { d: CO.d })).lost);
    hi.textContent = fmtMoney(calc(Object.assign({}, data, { d: D_HIGH })).lost);
  }

  /* ---------- примеры на первом экране: кто и сколько ---------- */
  function renderExamples() {
    var host = $("examples");
    if (!host) return;
    var rows = corpus.filter(function (c) { return c.rev && c.unreachable !== null; });
    var top = rows.map(function (c) {
      return { row: c, lost: calc(Object.assign({}, state, { rev: c.rev, u: c.unreachable })).lost };
    }).sort(function (a, b) { return b.lost - a.lost; }).slice(0, 3);

    var html = top.map(function (item) {
      return '<a class="ex" href="#companies"><span class="exn">' + item.row.store +
        '</span><span class="exv">' + fmtMoney(item.lost) + " / год</span></a>";
    }).join("");
    html += '<a class="ex ex-go" href="#calc"><span class="exn">Своя витрина</span>' +
      '<span class="exv">прогнать замер →</span></a>';
    host.innerHTML = html;
  }

  /* ---------- список витрин ---------- */
  function buildSelect() {
    if (!elStore) return;
    var rows = corpus.filter(function (c) { return c.rev && c.unreachable !== null; });
    var html = '<option value="">— выберите витрину —</option>';
    rows.forEach(function (c) {
      html += '<option value="' + c.store + '">' + c.store + " — " + (c.owner || "") + "</option>";
    });
    elStore.innerHTML = html;
    // сразу показываем пример, чтобы первый экран не был пустым:
    // по умолчанию — витрина с самой крупной потерей, она же первая в примерах
    if (rows.length) {
      var top = rows.map(function (c) {
        return { row: c, lost: calc(Object.assign({}, state, { rev: c.rev, u: c.unreachable })).lost };
      }).sort(function (a, b) { return b.lost - a.lost; })[0];
      state.store = top.row.store;
      elStore.value = top.row.store;
      paintHint(top.row);
    }
  }

  function paintHint(row) {
    var hint = $("companyHint");
    if (!hint || !row) return;
    hint.innerHTML = row.basis + (row.revLabel ? " · " + row.revLabel : "");
  }

  /* ---------- боковая панель ---------- */
  function openDrawer(row) {
    var r = calc(Object.assign({}, state, { rev: row.rev, u: row.unreachable }));

    $("dSector").textContent = "витрина: " + row.store;
    $("dTitle").textContent = row.owner || row.store;
    $("dSub").textContent = row.revLabel || "";
    $("dNet").textContent = fmtMoney(r.lost);

    var rows = [
      ["HTTP-ответ анонимному агенту", row.status ? String(row.status) : "—"],
      ["Product-карточек найдено", row.cards ? String(row.cards) : "не найдено"],
      ["Доля товаров, которых агент не купит", row.unreachable === null ? "не измерено" : fmtPct(row.unreachable * 100, 0)],
      ["Оборот (публичный)", row.rev ? fmtMoney(row.rev) : "не раскрыт"],
      ["Весь спрос от ИИ-агентов", fmtMoney(r.demand)],
      ["Уходит конкурентам", fmtMoney(r.lost)],
      ["Уже получаете", fmtMoney(r.captured)],
      ["Пилот окупается за", r.paybackMonths
        ? (r.paybackMonths < 12 ? "≈ " + Math.max(1, Math.round(r.paybackMonths)) + " мес."
          : "≈ " + (r.paybackMonths / 12).toFixed(1) + " года")
        : "—"]
    ];
    $("dKv").innerHTML = rows.map(function (x) {
      return '<div class="kv"><span class="k">' + x[0] + '</span><span class="v">' + x[1] + "</span></div>";
    }).join("");

    var srcs = [];
    srcs.push("<b>Наш замер: " + row.basis + "</b>");
    if (row.note) srcs.push(row.note);
    if (row.revSource) srcs.push("<b>Оборот: " + row.revLabel + "</b> — " + row.revSource);
    srcs.push('<a href="https://github.com/Balanov/readiness-probe" target="_blank" rel="noopener">Код замера и сырые данные — GitHub</a>');
    $("dSrcs").innerHTML = srcs.map(function (s) { return "<div>" + s + "</div>"; }).join("");

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
    if (value === null || value === undefined) return { bg: "var(--line)", title: "не измерено" };
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

  /* ---------- построение ---------- */
  function bind() {
    if (elStore) {
      elStore.addEventListener("change", function () {
        state.store = elStore.value;
        var row = corpus.filter(function (c) { return c.store === state.store; })[0];
        if (row) paintHint(row);
        render();
      });
    }
    if (sliderD) {
      sliderD.addEventListener("input", function () {
        state.d = Number(sliderD.value);
        render();
      });
    }

    // плитки формулы ведут на источник
    document.querySelectorAll(".tile").forEach(function (t) {
      t.addEventListener("click", function () {
        var u = t.dataset.src;
        if (u) window.open(u, "_blank", "noopener");
      });
    });

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

    document.querySelectorAll("[data-close]").forEach(function (n) {
      n.addEventListener("click", closeDrawer);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawer();
    });

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          io.unobserve(e.target);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      document.querySelectorAll(".rv").forEach(function (el) { io.observe(el); });
    } else {
      document.querySelectorAll(".rv").forEach(function (el) { el.classList.add("in"); });
    }
  }

  /* ---------- список витрин-карточек ---------- */
  function renderCards() {
    var grid = $("storeGrid");
    if (!grid) return;
    grid.innerHTML = "";
    corpus.filter(function (c) { return c.rev && c.unreachable !== null; }).forEach(function (c) {
      var lost = calc(Object.assign({}, state, { rev: c.rev, u: c.unreachable })).lost;
      var demand = calc(Object.assign({}, state, { rev: c.rev, u: c.unreachable })).demand;
      var card = document.createElement("button");
      card.type = "button";
      card.className = "co";
      card.innerHTML =
        '<div class="nm">' + c.store + '<span class="tag ' + (c.unreachable === 0 ? "" : "na") + '">' +
        (c.unreachable === 0 ? "готов" : "не готов") + "</span></div>" +
        '<div class="sec">' + (c.owner || "") + " · " + (c.revLabel || "") + "</div>" +
        '<div class="eff"><span>уходит конкурентам</span><b>' + fmtMoney(lost) + "</b></div>" +
        '<div class="src">агентский спрос ' + fmtMoney(demand) + " / год · " + c.basis + "</div>";
      card.addEventListener("click", function () { openDrawer(c); });
      grid.appendChild(card);
    });
  }

  buildSelect();
  paintMeasure();
  renderCards();
  render();
  renderHeat();
  bind();
})();
