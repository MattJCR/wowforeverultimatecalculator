#!/usr/bin/env node
// ¿Hay un build de WoW Forever más nuevo que el nuestro? Pregunta al servidor público de versiones (el mismo endpoint de metadatos que usa el launcher;
// una petición HTTP de texto, sin autenticación y sin tocar el cliente ni su caché) y lo compara con el build de nuestros datos y con el instalado.
// Sirve para enterarse de un parche ANTES de que el launcher lo descargue o de leer ninguna caché.
//
// Uso: node tools/update/check-remote-build.mjs        (código de salida 10 si el build publicado no es el de nuestros datos)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const URL_VERSIONS = "http://us.patch.battle.net:1119/wowf/versions";

const dataBuilds = fs.readdirSync(path.join(ROOT, "data", "forever")).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d)).sort((a, b) => Number(a.split(".")[3]) - Number(b.split(".")[3]));
const ours = dataBuilds.at(-1);

const res = await fetch(URL_VERSIONS, { signal: AbortSignal.timeout(15000) }).catch((e) => ({ ok: false, status: String(e) }));
if (!res.ok) { console.error(`No se pudo consultar ${URL_VERSIONS}: ${res.status}`); process.exit(2); }
const lines = (await res.text()).split(/\r?\n/).filter((l) => l && !l.startsWith("##"));
const header = lines[0].split("|").map((h) => h.split("!")[0]);
const rows = lines.slice(1).map((l) => Object.fromEntries(l.split("|").map((v, i) => [header[i], v])));
const published = [...new Set(rows.map((r) => r.VersionsName))];
console.log(`Publicado (${rows.map((r) => r.Region).join(", ")}): ${published.join(", ")}`);
console.log(`Nuestros datos : ${ours}`);

let installed = null;
try {
  const info = fs.readFileSync("C:/World of Warcraft/.build.info", "utf8").split(/\r?\n/);
  const cols = info[0].split("|").map((h) => h.split("!")[0]);
  const v = info.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split("|").map((x, i) => [cols[i], x]))).find((r) => /wowf/i.test(r.Product ?? ""));
  installed = v?.Version ?? null;
} catch { /* sin cliente: no pasa nada */ }
if (installed) console.log(`Instalado      : ${installed}`);

const newest = published.sort((a, b) => Number(a.split(".")[3]) - Number(b.split(".")[3])).at(-1);
if (newest !== ours) {
  console.log(`\nPARCHE NUEVO publicado (${newest}): ${installed === newest ? "el cliente ya lo tiene instalado; sigue la skill forever-patch-review" : "actualiza el juego con el launcher (lo hace el usuario) y sigue la skill forever-patch-review"}.`);
  process.exit(10);
}
console.log("\nSin build nuevo publicado. (Los hotfixes del servidor no salen aquí: para ellos, cache-peek.mjs.)");
