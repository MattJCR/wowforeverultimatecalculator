// Contraste de ids de objetos que traen los addons instalados (leídos con read-loot-addons.mjs) con lo nuestro: equipables con datos, retirados
// (el servidor no los devuelve, data/observed/cache-report.json), lo que el cliente trae sin ser equipable y lo desconocido para el cliente.
// Solo contraste local: escribe data/external/loot-addons/contrast-ids.json (no se publica). Uso: node tools/extract/contrast-addon-ids.mjs
import fs from "node:fs";
const ids = (p) => new Set(fs.readFileSync(p, "utf8").split("\n").map((l) => /^(\d+),/.exec(l)).filter(Boolean).map((m) => +m[1]));
const R = "data/raw/1.60.1.70888-hotfix/";
const sparse = ids(R + "ItemSparse.csv"), itemTable = ids(R + "Item.csv");
const items = JSON.parse(fs.readFileSync("data/forever/1.60.1.70888/items.json", "utf8"));
const ours = new Set(items.items.filter((i) => !i.placeholder).map((i) => i.id));
const placeholder = new Set(items.items.filter((i) => i.placeholder).map((i) => i.id));
const rep = JSON.parse(fs.readFileSync("data/observed/cache-report.json", "utf8"));
const missing = new Set();
for (const p of rep.itemsMissing.split(",")) { const [a, b] = p.split("-").map(Number); for (let i = a; i <= (b ?? a); i++) missing.add(i); }
const retired = new Set([...missing].filter((x) => !sparse.has(x)));
const cat = (id) => ours.has(id) ? "nuestro (equipable con datos)" : placeholder.has(id) ? "de prueba/retirado por el cliente" : retired.has(id) ? "RETIRADO (el servidor no lo devuelve)" : sparse.has(id) ? "el cliente lo trae, no equipable" : itemTable.has(id) ? "el cliente lo lista sin datos (no pedido)" : "DESCONOCIDO para el cliente";

const sources = {};
const loot = JSON.parse(fs.readFileSync("data/external/loot-addons/item-ids.json", "utf8"));
sources["addons de botín (diario, tablas por jefe, probabilidades)"] = new Set(loot);
const jf = "data/external/loot-addons/journal.json";
const j = JSON.parse(fs.readFileSync(jf, "utf8"));
const forever = new Set();
j.instances.forEach((i) => { i.bosses.forEach((b) => b.items.forEach((x) => forever.add(x.id))); });
sources["diario de mazmorras (solo botín de jefes/basura)"] = forever;
const at = JSON.parse(fs.readFileSync("data/external/loot-addons/atlas.json", "utf8"));
const atF = new Set(); at.filter((i) => i.file === "forever").forEach((i) => i.bosses.forEach((b) => b.items.forEach((x) => atF.add(x.id))));
sources["tablas por jefe SOLO de Forever (instancias nuevas)"] = atF;
const lp = "data/external/lootified/ItemStats.lua";
if (fs.existsSync(lp)) sources["lecturas del juego de otro addon"] = new Set([...fs.readFileSync(lp, "utf8").matchAll(/^\s*\[(\d+)\]\s*=/gm)].map((m) => +m[1]));

const out = {};
for (const [name, set] of Object.entries(sources)) {
  const by = {};
  for (const id of set) (by[cat(id)] ??= []).push(id);
  console.log(`\n== ${name}: ${set.size} ids`);
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(v.length).padStart(5)}  ${k}${v.length <= 12 ? "  → " + v.sort((a, b) => a - b).join(",") : ""}`);
  out[name] = by;
}
fs.writeFileSync("data/external/loot-addons/contrast-ids.json", JSON.stringify(out));
