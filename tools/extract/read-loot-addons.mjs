// Lee (solo lectura) los datos de botín de los addons de botín instalados en el cliente y los deja normalizados en
// data/external/loot-addons/*.json. SOLO CONTRASTE LOCAL: son datos de la comunidad con licencia que impide mezclarlos con los nuestros;
// data/external/ no se publica. Sirven para (1) saber qué objetos esperar de cada jefe, (2) contrastar lo que observe el addon propio
// y (3) ampliar la lista de ids que WFUC_ItemCache pide a la caché.
// Uso: node tools/extract/read-loot-addons.mjs [carpeta AddOns]      (por defecto la del cliente)
// El cliente se lee, nunca se escribe; la salida va al repositorio.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ADDONS = process.argv[2] ?? "C:/World of Warcraft/_forever_/Interface/AddOns";
const OUT = path.join(ROOT, "data", "external", "loot-addons");
// Carpetas de los addons que se leen (necesarias para localizar los ficheros).
const JOURNAL = path.join(ADDONS, "ForeverDungeonJournal", "Data");
const ATLAS = path.join(ADDONS, "AtlasLootClassic_DungeonsAndRaids");

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split(/\r?\n/) : null);
const luaConsts = (lines) => {
  // local A, B, C = "x", "y", "z"
  const m = {};
  for (const l of lines) {
    const r = /^local\s+([A-Za-z_][\w, ]*?)\s*=\s*((?:"[^"]*"\s*,?\s*)+)$/.exec(l);
    if (!r) continue;
    const names = r[1].split(",").map((s) => s.trim());
    const vals = [...r[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    names.forEach((n, i) => { if (vals[i] !== undefined) m[n] = vals[i]; });
  }
  return m;
};

// ---------- Diario de mazmorras: jefes (con npcID), basura, misiones y recompensas ----------
function readJournal() {
  const lines = read(path.join(JOURNAL, "Dungeons.lua"));
  if (!lines) return null;
  const instances = [];
  let inst = null, section = null, boss = null, quest = null;
  const itemRe = /^\s*\{(\d+),\s*"([^"]*)"(?:,\s*"([^"]*)")?(?:,\s*(\d+))?(?:,\s*"([^"]*)")?\s*\}/;
  for (const l of lines) {
    const h = /^(?:FDJ\.DB\[|\s{4}\[)"([^"]+)"\]\s*=\s*\{/.exec(l);
    if (h) { inst = { name: h[1], bosses: [], quests: [] }; instances.push(inst); section = boss = quest = null; continue; }
    if (!inst) continue;
    let m;
    if ((m = /^\s*level = "([^"]*)"/.exec(l)) && !section) inst.level = m[1];
    if ((m = /^\s*location = "([^"]*)"/.exec(l)) && !section) inst.location = m[1];
    if (/^\s*bosses = \{/.test(l)) { section = "bosses"; boss = null; continue; }
    if (/^\s*quests = \{/.test(l)) { section = "quests"; quest = null; boss = null; }
    if (section === "bosses") {
      if ((m = /^\s*name = "([^"]*)"/.exec(l))) { boss = { name: m[1], items: [] }; inst.bosses.push(boss); continue; }
      if (!boss) continue;
      if ((m = /^\s*npcID = (\d+)/.exec(l))) boss.npcID = Number(m[1]);
      if (/^\s*trash = true/.test(l)) boss.trash = true;
      if (/^\s*rare = true/.test(l)) boss.rare = true;
      if ((m = itemRe.exec(l))) boss.items.push({ id: Number(m[1]), name: m[2], slot: m[3] || undefined, quality: m[4] ? Number(m[4]) : undefined, from: m[5] || undefined });
    } else if (section === "quests") {
      if ((m = /^\s*name = "([^"]*)"/.exec(l))) { quest = { name: m[1], rewards: [] }; inst.quests.push(quest); continue; }
      if (!quest) continue;
      if ((m = /^\s*id = (\d+)/.exec(l))) quest.id = Number(m[1]);
      if ((m = /^\s*pickup = "([^"]*)"/.exec(l))) quest.pickup = m[1];
      if ((m = /^\s*turnin = "([^"]*)"/.exec(l))) quest.turnin = m[1];
      if ((m = /^\s*faction = "([^"]*)"/.exec(l))) quest.faction = m[1];
      if ((m = /^\s*level = (\d+)/.exec(l))) quest.level = Number(m[1]);
      if (/^\s*rewardChoice = true/.test(l)) quest.choice = true;
      if (/^\s*rewardItems = /.test(l)) for (const x of l.matchAll(/\{(\d+),\s*"([^"]*)"/g)) quest.rewards.push({ id: Number(x[1]), name: x[2] });
      if ((m = /^\s*noteItem = \{(\d+),\s*"([^"]*)"(?:,\s*\d+)?(?:,\s*"([^"]*)")?/.exec(l))) quest.noteItem = { id: Number(m[1]), name: m[2], note: m[3] };
    }
  }
  // Botín compartido: objetos que caen de varios jefes de varias mazmorras.
  const shared = [];
  const sl = read(path.join(JOURNAL, "SharedLoot.lua"));
  if (sl) {
    const consts = luaConsts(sl);
    let cur = null, zone = null;
    for (const l of sl) {
      let m;
      if ((m = /^\s*\{\s*(\d+),\s*"([^"]*)",\s*\{/.exec(l))) { cur = { id: Number(m[1]), name: m[2], from: [] }; shared.push(cur); continue; }
      if (!cur) continue;
      if ((m = /^\s*\[([A-Za-z_]\w*)\]\s*=\s*\{(.*)\}\s*,?\s*$/.exec(l))) {
        zone = consts[m[1]] ?? m[1];
        for (const b of m[2].matchAll(/"([^"]*)"/g)) cur.from.push({ instance: zone, boss: b[1] });
      }
    }
  }
  return { instances, shared };
}

// ---------- Tablas de botín por jefe y dificultad ----------
function readAtlas(file) {
  const lines = read(path.join(ATLAS, file));
  if (!lines) return [];
  const al = (s) => { const m = /AL\["([^"]+)"\]|"([^"]+)"/.exec(s); return m ? (m[1] ?? m[2]) : s.trim(); };
  const instances = [];
  let inst = null, boss = null, diff = null;
  for (const l of lines) {
    let m;
    if ((m = /^data\["([^"]+)"\]\s*=\s*\{/.exec(l))) { inst = { key: m[1], bosses: [] }; instances.push(inst); boss = diff = null; continue; }
    if (!inst) continue;
    if (!boss && !inst.name && (m = /^\s*name\s*=\s*(.*?)(?:\s*\.\.\s*[A-Za-z_]\w*)?\s*,\s*(?:--.*)?$/.exec(l))) { inst.name = al(m[1]); continue; }
    if ((m = /^\t\t\tname\s*=\s*(.*?)\s*,\s*(?:--.*)?$/.exec(l))) { boss = { name: al(m[1]), items: [] }; inst.bosses.push(boss); diff = null; continue; }
    if (!boss) continue;
    if ((m = /^\s*\[([A-Za-z_]\w*)\]\s*=\s*\{\s*$/.exec(l))) { diff = m[1]; continue; }
    if ((m = /^\s*\{\s*(\d+)\s*,\s*(\d+)\s*[,}]/.exec(l))) boss.items.push({ id: Number(m[2]), diff: diff ?? undefined });
  }
  return instances.filter((i) => i.bosses.length);
}

// ---------- Probabilidades de caída [npc][objeto] = % ----------
function readDroprate() {
  const lines = read(path.join(ATLAS, "droprate.lua"));
  if (!lines) return null;
  const out = {};
  let npc = null;
  for (const l of lines) {
    let m;
    if ((m = /^\t\[(\d+)\]\s*=\s*\{/.exec(l))) { npc = Number(m[1]); out[npc] = {}; continue; }
    if (npc !== null && (m = /^\t\t\[(\d+)\]\s*=\s*([\d.]+)/.exec(l))) out[npc][Number(m[1])] = Number(m[2]);
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
const journal = readJournal();
const atlas = [...readAtlas("forever.lua").map((i) => ({ ...i, file: "forever" })), ...readAtlas("data.lua").map((i) => ({ ...i, file: "classic" }))];
const droprate = readDroprate();
const w = (n, o) => o && fs.writeFileSync(path.join(OUT, n), JSON.stringify(o));
w("journal.json", journal);
w("atlas.json", atlas);
w("droprate.json", droprate);
fs.writeFileSync(
  path.join(OUT, "ATTRIBUTION.md"),
  "# Datos de botín de addons instalados (solo contraste local)\n\nGenerado por `tools/extract/read-loot-addons.mjs` a partir de los ficheros de los addons de botín instalados en el cliente (lectura; el cliente no se toca). Son datos recopilados por la comunidad con licencia que impide mezclarlos con los de este repositorio: **no se publican ni se mezclan con nuestros datos**; `data/external/` está en `.gitignore`. Sirven para contrastar lo que observa WFUC_ItemCache y para ampliar la lista de ids que pide.\n",
);

const items = new Set();
const add = (id) => id && items.add(id);
journal?.instances.forEach((i) => { i.bosses.forEach((b) => b.items.forEach((x) => add(x.id))); i.quests.forEach((q) => { q.rewards.forEach((x) => add(x.id)); add(q.noteItem?.id); }); });
journal?.shared.forEach((s) => add(s.id));
atlas.forEach((i) => i.bosses.forEach((b) => b.items.forEach((x) => add(x.id))));
Object.values(droprate ?? {}).forEach((m) => Object.keys(m).forEach((id) => add(Number(id))));
fs.writeFileSync(path.join(OUT, "item-ids.json"), JSON.stringify([...items].sort((a, b) => a - b)));
console.log(`diario: ${journal?.instances.length ?? 0} instancias, ${journal?.instances.reduce((n, i) => n + i.bosses.length, 0) ?? 0} jefes/grupos, ${journal?.instances.reduce((n, i) => n + i.quests.length, 0) ?? 0} misiones, ${journal?.shared.length ?? 0} objetos compartidos`);
console.log(`tablas por jefe: ${atlas.length} instancias (${atlas.filter((i) => i.file === "forever").length} de Forever), ${atlas.reduce((n, i) => n + i.bosses.length, 0)} jefes; probabilidades de ${Object.keys(droprate ?? {}).length} criaturas`);
console.log(`${items.size} objetos distintos → ${path.relative(ROOT, OUT)}`);
