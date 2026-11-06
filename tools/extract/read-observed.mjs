// Lee (solo lectura) lo que WFUC_ItemCache ha anotado jugando —botín por criatura/objeto, vendedores y recompensas de misión—
// de WTF\Account\*\SavedVariables\WFUC_ItemCache.lua y lo funde en data/observed/sources.json (datos NUESTROS, procedencia `beta-measured`).
// También deja el informe de objetos/hechizos que el servidor no devolvió en data/observed/cache-report.json.
// Uso: node tools/extract/read-observed.mjs [ruta a WFUC_ItemCache.lua ...]      (por defecto busca en el cliente)
// Cada ejecución FUNDE con lo ya guardado (el addon acumula, así que se toma el máximo por cuenta), no pisa observaciones antiguas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLuaTable } from "./lib/lua-table.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "data", "observed");
const WTF = "C:/World of Warcraft/_forever_/WTF/Account";

function findFiles() {
  const out = [];
  if (!fs.existsSync(WTF)) return out;
  for (const acc of fs.readdirSync(WTF)) {
    const p = path.join(WTF, acc, "SavedVariables", "WFUC_ItemCache.lua");
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

const files = process.argv.length > 2 ? process.argv.slice(2) : findFiles();
if (!files.length) { console.log("No hay WFUC_ItemCache.lua (se escribe al salir o recargar con el addon puesto)."); process.exit(0); }

const prevPath = path.join(OUT, "sources.json");
const store = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, "utf8")) : { loot: {}, vendors: {}, quests: {} };
const max = (a, b) => Math.max(a ?? 0, b ?? 0);
let report = null;

for (const f of files) {
  const db = parseLuaTable(fs.readFileSync(f, "utf8"));
  const seen = db.seen ?? {};
  for (const [key, e] of Object.entries(seen.loot ?? {})) {
    const cur = (store.loot[key] ??= { k: 0, i: {} });
    // El addon acumula en cada cuenta: se toma el máximo por objeto (dos cuentas distintas del mismo jugador no se suman a ciegas).
    cur.k = max(cur.k, e.k);
    cur.n ??= e.n; cur.z ??= e.z; cur.m ??= e.m; cur.d ??= e.d;
    for (const [id, n] of Object.entries(e.i ?? {})) cur.i[id] = max(cur.i[id], n);
  }
  for (const v of Object.values(seen.vendors ?? {})) v.items = Object.values(v.items ?? {}); // las listas Lua salen como {1:…,2:…}
  for (const q of Object.values(seen.quests ?? {})) { q.c = Object.values(q.c ?? {}); q.r = Object.values(q.r ?? {}); }
  for (const [key, v] of Object.entries(seen.vendors ?? {})) if (!store.vendors[key] || (v.t ?? 0) >= (store.vendors[key].t ?? 0)) store.vendors[key] = v;
  for (const [id, q] of Object.entries(seen.quests ?? {})) store.quests[id] = q;
  if (db.report) report = { ...db.report, file: path.basename(path.dirname(path.dirname(f))) };
}
store.updated = new Date().toISOString().slice(0, 10);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(prevPath, JSON.stringify(store));
if (report) fs.writeFileSync(path.join(OUT, "cache-report.json"), JSON.stringify(report, null, 1));
const items = new Set(Object.values(store.loot).flatMap((e) => Object.keys(e.i)));
console.log(`${Object.keys(store.loot).length} fuentes de botín (${items.size} objetos distintos), ${Object.keys(store.vendors).length} vendedores, ${Object.keys(store.quests).length} misiones → data/observed/sources.json${report ? "; informe de caché guardado" : ""}`);
