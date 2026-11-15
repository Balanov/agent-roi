// Проверка датасета компаний: синтаксис, уникальность id, наличие
// источника у каждого раскрытого числа и явное объяснение у каждого
// нераскрытого. Запускается в CI при каждом пуше.
//
// Логика: любое число без ссылки — ошибка. Любое отсутствие числа без
// объяснения «почему не раскрыто» — тоже ошибка. Молчаливых дыр быть не должно.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "docs", "companies.js");
const src = fs.readFileSync(file, "utf8");

const sandbox = { window: { COMPANIES: [] } };
new Function("window", src)(sandbox.window);
const list = sandbox.window.COMPANIES;

let bad = 0;
const fail = (msg) => { console.log("  ! " + msg); bad++; };

console.log("записей:", list.length);

const ids = list.map((c) => c.id);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dupes.length) fail("дубли id: " + dupes.join(", "));

const EXPLAINS = /не раскры|нет|отсутств|неизвестн|в составе/i;

for (const c of list) {
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
  if (c.margin === null) {
    if (!EXPLAINS.test(String(c.marginSource))) fail(`маржа не раскрыта, но marginSource не объясняет почему: ${c.id}`);
  } else if (!/https?:/.test(String(c.marginSource))) {
    fail(`есть маржа, но нет ссылки: ${c.id}`);
  }
  if (!c.hint || c.hint.length < 40) fail(`слишком короткая подсказка: ${c.id}`);
}

const withM = list.filter((c) => c.m);
console.log("с раскрытым объёмом поддержки:", withM.map((c) => `${c.name} (${c.m.toLocaleString("ru-RU")}/мес)`).join(" · "));
console.log("с раскрытой выручкой:", list.filter((c) => c.rev).length, "из", list.length);
console.log("с раскрытой маржой:", list.filter((c) => c.margin).length, "из", list.length);

if (bad) {
  console.log(`\n${bad} проблем — данные должны быть либо со ссылкой, либо с объяснением.`);
  process.exit(1);
}
console.log("\nвсе записи чистые: каждое число со ссылкой, каждое отсутствие объяснено.");
