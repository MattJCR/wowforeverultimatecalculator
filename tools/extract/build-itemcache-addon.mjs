// Genera el addon WFUC_ItemCache en tools/addon/WFUC_ItemCache/ (fuera del cliente; NO lo instala).
// Pide al servidor, poco a poco, los objetos que conocemos y que la caché local de hotfixes (DBCache.bin) no trae.
// Uso: node tools/extract/build-itemcache-addon.mjs [build]     (por defecto 1.60.1.70790)
// El usuario copia la carpeta a Interface\AddOns a mano, juega con /wfucitems start y, tras salir bien del juego,
// se repite la lectura de hotfixes (docs/EXTRACTION.md). El cliente sigue siendo solo lectura para las herramientas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD = process.argv[2] ?? "1.60.1.70790";
const OUT = path.join(ROOT, "tools", "addon", "WFUC_ItemCache");
const BATCH = 5; // peticiones por tanda
const INTERVAL = 2; // segundos entre tandas

const ids = (p) => (fs.existsSync(p) ? new Set(fs.readFileSync(p, "utf8").split("\n").map((l) => /^(\d+),/.exec(l)).filter(Boolean).map((m) => Number(m[1]))) : new Set());
const raw = (b, t) => path.join(ROOT, "data", "raw", b, `${t}.csv`);
const have = ids(raw(`${BUILD}-hotfix`, "ItemSparse"));
if (have.size === 0) throw new Error(`No hay ${BUILD}-hotfix/ItemSparse.csv: exporta antes con ITEMS=1 HOTFIXES=1 tools/extract/export-tables.sh ${BUILD}`);

// Todo objeto conocido que la caché no trae: tabla Item de este volcado, todos los ItemSparse de volcados anteriores y la copia de la comunidad.
const known = new Set(ids(raw(`${BUILD}-hotfix`, "Item")));
for (const d of fs.readdirSync(path.join(ROOT, "data", "raw"))) if (/-hotfix$/.test(d)) for (const x of ids(raw(d, "ItemSparse"))) known.add(x);
const ws = path.join(ROOT, "data", "external", "wowsims", "db.json");
if (fs.existsSync(ws)) for (const i of JSON.parse(fs.readFileSync(ws, "utf8")).items) known.add(i.id);
const list = [...known].filter((x) => !have.has(x)).sort((a, b) => a - b);

const rows = [];
for (let i = 0; i < list.length; i += 14) rows.push(`  ${list.slice(i, i + 14).join(", ")},`);
const minutes = Math.ceil((list.length / BATCH) * INTERVAL / 60);
const lua = `-- WFUC_ItemCache v2: pide al servidor, poco a poco, los ${list.length} objetos conocidos que faltan en la cache local.
-- Uso: /wfucitems start | stop | status | reset. No se inicia solo. Guarda por donde va en WFUC_ItemCacheDB
-- (variables guardadas del propio juego, se escriben al salir/recargar) y retoma desde ahi.
local ids = {
${rows.join("\n")}
}
local BATCH, INTERVAL = ${BATCH}, ${INTERVAL} -- ${BATCH} peticiones cada ${INTERVAL} segundos (~${minutes} min en total)
WFUC_ItemCacheDB = WFUC_ItemCacheDB or { idx = 1 }
local db = WFUC_ItemCacheDB
local ticker
local function say(msg) DEFAULT_CHAT_FRAME:AddMessage('|cff66ccffWFUC|r ' .. msg) end
local function known()
  local n = 0
  for _, id in ipairs(ids) do if GetItemInfo(id) then n = n + 1 end end
  return n
end
local function stop(why) if ticker then ticker:Cancel() ticker = nil end say(why) end
local function tick()
  if UnitAffectingCombat('player') then return end
  local sent = 0
  while sent < BATCH do
    local id = ids[db.idx]
    if not id then
      stop('terminado: recorridos los ' .. #ids .. '. Espera 1 min, escribe /wfucitems status y despues /logout (salir del todo, sin cierre forzado).')
      return
    end
    db.idx = db.idx + 1
    if not GetItemInfo(id) then -- los que el cliente ya conoce no se piden
      if C_Item and C_Item.RequestLoadItemDataByID then C_Item.RequestLoadItemDataByID(id) else GetItemInfo(id) end
      sent = sent + 1
    end
  end
  if db.idx % 500 < 12 then say((db.idx - 1) .. ' / ' .. #ids) end
end
local ev = CreateFrame('Frame')
ev:RegisterEvent('PLAYER_LEAVING_WORLD')
ev:SetScript('OnEvent', function() if ticker then ticker:Cancel() ticker = nil end end)
SLASH_WFUCITEMS1 = '/wfucitems'
SlashCmdList.WFUCITEMS = function(arg)
  arg = (arg or ''):lower()
  if arg == 'start' then
    if ticker then say('ya esta en marcha') return end
    ticker = C_Timer.NewTicker(INTERVAL, tick)
    say('retomando desde ' .. db.idx .. ' / ' .. #ids .. ' (se detiene en combate o al cambiar de zona; /wfucitems stop para parar)')
  elseif arg == 'stop' then stop('parado en ' .. db.idx .. ' / ' .. #ids)
  elseif arg == 'reset' then db.idx = 1 say('avance a cero')
  else say('recorridos ' .. (db.idx - 1) .. ' / ' .. #ids .. '; ya conocidos por el cliente: ' .. known()) end
end
`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "WFUC_ItemCache.lua"), lua);
fs.writeFileSync(path.join(OUT, "WFUC_ItemCache.toc"), "## Interface: 16001\n## Title: WFUC ItemCache\n## Notes: Pide por lotes pequenos los objetos que faltan en la cache local (manual: /wfucitems start)\n## Author: local\n## Version: 2\n## SavedVariables: WFUC_ItemCacheDB\n\nWFUC_ItemCache.lua\n");
console.log(`${list.length} objetos (≈ ${minutes} min) → ${path.relative(ROOT, OUT)}`);
