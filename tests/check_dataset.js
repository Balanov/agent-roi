// Проверка данных страницы: каждое число — со ссылкой, каждое отсутствие —
// с объяснением, замер и корпус согласованы между собой.
//
// Логика: любое число без ссылки — ошибка. Любое отсутствие числа без
// объяснения «почему» — тоже ошибка. Молчаливых дыр быть не должно.
// Дополнительно: витрина в корпусе обязана существовать в замере, а у каждой
// витрины с деньгами — быть публичный источник оборота.
const fs = require("fs");
const path = require("path");

const DOCS = path.join(__dirname, "..", "docs");

function load(file, varName) {
  const src = fs.readFileSync(path.join(DOCS, file), "utf8");
  const sandbox = { window: {} };
  new Function("window", src)(sandbox.window);
  return sandbox.window[varName];
}

let bad = 0;
const fail = (msg) => { console.log("  ! " + msg); bad++; };

/* ---------- 1. Датасет публичных цифр ---------- */
const companies = load("companies.js", "COMPANIES");
console.log("компаний в датасете:", companies.length);

const ids = companies.map((c) => c.id);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dupes.length) fail("дубли id: " + dupes.join(", "));

const EXPLAINS = /не раскры|нет|отсутств|неизвестн|в составе|оценка/i;

for (const c of companies) {
  for (const k of ["id", "name", "sector", "revSource", "marginSource", "mSource", "srcShort", "hint"]) {
    if (c[k] === undefined || c[k] === null) fail(`нет поля ${k} у ${c.id}`);
  }
  if (c.rev === null) {
    if (!EXPLAINS.test(String(c.revSource))) fail(`выручка не раскрыта, но revSource не объясняет почему: ${c.id}`);
  } else if (!/https?:/.test(String(c.revSource))) {
    fail(`есть выручка, но нет ссылки: ${c.id}`);
  }
  if (c.m === null) {
    if (!EXPLAINS.test(String(c.mSource))) fail(`объём поддержки не раскрыт, но mSource не объясняет почему: ${c.id}`);
  } else if (!/https?:/.test(String(c.mSource))) {
    fail(`есть объём поддержки, но нет ссылки: ${c.id}`);
  }
  if (c.m !== null && c.mType !== "open") {
    if (!c.derivation || String(c.derivation).length < 12) fail(`оценка объёма без формулы вывода: ${c.id}`);
  }
  if (!c.hint || c.hint.length < 40) fail(`слишком короткая подсказка: ${c.id}`);
}
console.log("с раскрытой выручкой:", companies.filter((c) => c.rev).length, "из", companies.length);
console.log("с раскрытым объёмом поддержки:", companies.filter((c) => c.m).length, "из", companies.length);

/* ---------- 2. Замер витрин ---------- */
const readiness = load("readiness-data.js", "READINESS");
const measured = readiness.filter((r) => !String(r.name).startsWith("CONTROL"));
console.log("витрин измерено:", measured.length, "· контрольных:", readiness.length - measured.length);

/* ---------- 3. Корпус: замер × оборот ---------- */
const corpus = load("readiness-companies.js", "READINESS_COMPANIES");
console.log("витрин в корпусе:", corpus.length);

const known = new Set(readiness.map((r) => r.name));
const withMoney = [];

for (const row of corpus) {
  if (!known.has(row.store)) fail(`витрина «${row.store}» есть в корпусе, но её нет в замере`);
  if (!row.basis) fail(`нет основания замера: ${row.store}`);
  if (row.unreachable !== null) {
    if (typeof row.unreachable !== "number" || row.unreachable < 0 || row.unreachable > 1) {
      fail(`некорректная доля недоступных товаров: ${row.store}`);
    }
    if (!row.measured) fail(`доля посчитана, но витрина не измерена: ${row.store}`);
  }
  if (row.rev) {
    if (!/https?:/.test(String(row.revSource))) fail(`есть оборот, но нет ссылки: ${row.store}`);
    if (row.unreachable === null) fail(`есть оборот, но нет замера готовности: ${row.store}`);
    withMoney.push(row);
  }
}

console.log("витрин с считаемыми деньгами:", withMoney.length);
for (const row of withMoney) {
  console.log(`  ${row.store}: ${(row.unreachable * 100).toFixed(0)}% товаров недоступны · ${row.revLabel}`);
}

if (!withMoney.length) fail("ни у одной витрины не считаются деньги");

if (bad) {
  console.log(`\n${bad} проблем — данные должны быть либо со ссылкой, либо с объяснением.`);
  process.exit(1);
}
console.log("\nвсе записи чистые: каждое число со ссылкой, каждое отсутствие объяснено, замер и корпус согласованы.");
