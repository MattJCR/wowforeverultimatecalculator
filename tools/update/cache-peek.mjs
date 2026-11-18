#!/usr/bin/env node
// Vistazo rápido a DBCache.bin (hotfixes del servidor): qué tablas y qué ids trae que NUESTRO último volcado no tiene, sin arrancar wow.tools.local
// (que tarda de 8 a 25 min en leerla). Solo lectura: abre el fichero, lo lee entero y lo cierra; no escribe nada, ni en el cliente.
//
// Uso:  node tools/update/cache-peek.mjs [DBCache.bin] [--base <carpeta de volcado, p. ej. data/raw/1.60.1.70959-hotfix>] [--max N] [--json salida.json]
//   sin ruta: la caché esES del cliente instalado (lectura directa; si el juego está abierto, mejor una copia)
//   sin --base: el volcado `-hotfix` más reciente de data/raw
//
// Formato: cabecera de 44 bytes y registros «XFTH» de 32 bytes (región, pushID, uniqueId, tableHash, recordId, tamaño, estado) + datos.
// El hash es el de tabla del formato DB2 (no un hash del nombre): ItemSparse y Item van fijados; el resto se deduce comparando sus ids con los CSV del volcado base.
// Estados de un registro: 1 válido · 2 retirado · 3 inexistente (el servidor contestó «no existe») · 4 no público.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && /^--(base|max|json)$/.test(argv[i - 1])));
const MAX = Number(opt("max", 25));

/** Entradas del fichero: { push, hash, id, size, status }. */
export function scan(buf) {
  const out = [];
  let off = 44;
  while (off + 32 <= buf.length && buf.toString("latin1", off, off + 4) === "XFTH") {
    const push = buf.readUInt32LE(off + 8), hash = buf.readUInt32LE(off + 16), id = buf.readUInt32LE(off + 20), size = buf.readUInt32LE(off + 24), status = buf[off + 28];
    out.push({ push, hash, id, size, status, off: off + 32 });
    off += 32 + size;
  }
  return { entries: out, parsed: off, length: buf.length };
}

const PRESET = new Map([[0x919be54e, "ItemSparse"], [0x50238ec2, "Item"]]);
const idsOfCsv = (file) => (fs.existsSync(file) ? new Set(fs.readFileSync(file, "utf8").split("\n").map((l) => /^(\d+),/.exec(l)).filter(Boolean).map((m) => Number(m[1]))) : null);

const clientCache = "C:/World of Warcraft/_forever_/Cache/ADB/esES/DBCache.bin";
const file = positional[0] ?? clientCache;
let base = opt("base", null);
if (!base) {
  const raw = path.join(ROOT, "data", "raw");
  const dirs = fs.readdirSync(raw).filter((d) => /^\d+\.\d+\.\d+\.\d+-hotfix$/.test(d)).sort();
  base = path.join(raw, dirs.at(-1));
}

const buf = fs.readFileSync(file);
const { entries, parsed, length } = scan(buf);
const stat = fs.statSync(file);
console.log(`Caché: ${file}\n  ${(length / 1048576).toFixed(2)} MB, modificada ${stat.mtime.toISOString().replace("T", " ").slice(0, 16)}; ${entries.length} registros${parsed === length ? "" : ` (¡solo se leyó hasta ${parsed} de ${length}!)`}`);
const pushes = [...new Set(entries.map((e) => e.push))].sort((a, b) => a - b);
console.log(`  pushID: ${pushes.length} lotes, de ${pushes[0]} a ${pushes.at(-1)}`);
console.log(`Volcado base: ${path.relative(ROOT, base)}\n`);

// Último registro de cada id por hash (manda el pushID mayor).
const perHash = new Map();
for (const e of entries) {
  let t = perHash.get(e.hash);
  if (!t) perHash.set(e.hash, (t = { hash: e.hash, n: 0, last: new Map() }));
  t.n++;
  const prev = t.last.get(e.id);
  if (!prev || e.push >= prev.push) t.last.set(e.id, e);
}
const csvTables = fs.existsSync(base) ? fs.readdirSync(base).filter((f) => f.endsWith(".csv")).map((f) => f.slice(0, -4)) : [];
const csvIds = new Map(csvTables.map((n) => [n, idsOfCsv(path.join(base, n + ".csv"))]));
const nameOf = (t) => {
  if (PRESET.has(t.hash)) return PRESET.get(t.hash);
  const valid = [...t.last.values()].filter((e) => e.status === 1).map((e) => e.id);
  if (valid.length < 20) return null;
  const score = [...csvIds].map(([n, set]) => [n, valid.filter((id) => set.has(id)).length / valid.length]).sort((x, y) => y[1] - x[1]);
  return score[0] && score[0][1] >= 0.9 && (!score[1] || score[0][1] - score[1][1] >= 0.1) ? score[0][0] : null;
};
const report = { cache: file, mtime: stat.mtime.toISOString(), records: entries.length, pushes: [pushes[0], pushes.at(-1)], base, tables: [] };
console.log("tabla".padEnd(26), "registros".padStart(9), "válidos".padStart(8), "inexist.".padStart(9), "retirados".padStart(10), "nuevos vs. volcado".padStart(19));
for (const t of [...perHash.values()].sort((x, y) => y.n - x.n).slice(0, 40)) {
  const name = nameOf(t);
  const last = [...t.last.values()];
  const valid = last.filter((e) => e.status === 1).map((e) => e.id);
  const gone = last.filter((e) => e.status === 3).map((e) => e.id);
  const removed = last.filter((e) => e.status === 2).length;
  const known = name ? csvIds.get(name) : null;
  const fresh = known ? valid.filter((id) => !known.has(id)) : null;
  report.tables.push({ table: name ?? "0x" + t.hash.toString(16), records: t.n, valid: valid.length, nonexistent: gone.length, removed, new: fresh, nonexistentIds: name === "ItemSparse" || name === "Item" ? gone : undefined });
  console.log((name ?? "0x" + t.hash.toString(16)).padEnd(26), String(t.n).padStart(9), String(valid.length).padStart(8), String(gone.length).padStart(9), String(removed).padStart(10), (fresh ? String(fresh.length) : "").padStart(19));
}
for (const t of report.tables) {
  if (!t.new?.length || !/^(ItemSparse|Item|ItemSearchName|Spell|SpellName|TraitDefinition|TraitNode|SkillLineAbility)$/.test(t.table)) continue;
  console.log(`
${t.table}: ${t.new.length} ids válidos que el volcado no tiene${t.new.length > MAX ? ` (primeros ${MAX})` : ""}: ${t.new.slice(0, MAX).join(", ")}`);
}
const jsonOut = opt("json", null);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); console.log(`\nInforme: ${jsonOut}`); }
