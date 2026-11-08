// Genera el addon WFUC_ItemCache en tools/addon/WFUC_ItemCache/ (fuera del cliente; NO lo instala).
// Pide al servidor, poco a poco, los objetos que conocemos y que la caché local de hotfixes (DBCache.bin) no trae.
// Uso: node tools/extract/build-itemcache-addon.mjs [build]     (por defecto 1.60.1.70862)
// El usuario copia la carpeta a Interface\AddOns a mano, juega con el botón del minimapa (o /wfucitems start) y, tras salir
// bien del juego, se repite la lectura de hotfixes (docs/EXTRACTION.md). El cliente sigue siendo solo lectura para las herramientas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD = process.argv[2] ?? "1.60.1.70862";
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
const base = [...known].filter((x) => !have.has(x)).sort((a, b) => a - b);

// Lectura de una tabla del volcado (con comillas) para sacar ids que el cliente REFERENCIA aunque no tenga el objeto/hechizo.
function table(t) {
  const p = raw(`${BUILD}-hotfix`, t);
  if (!fs.existsSync(p)) return { h: [], rows: [] };
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
  const rows = lines.slice(1).map((l) => {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === "," && !q) { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out;
  });
  return { h: lines[0].split(","), rows };
}
const column = (t, re) => { const x = table(t); const idx = x.h.map((n, i) => (re.test(n) ? i : -1)).filter((i) => i >= 0); return x.rows.flatMap((r) => idx.map((i) => Number(r[i]))).filter((n) => n > 0); };

// Objetos que otras tablas del cliente nombran (piezas de conjunto, apariencias, objetos con efecto, resultados de recetas, versión de la otra facción)
// y que no están en la lista base: se piden al final, para no mover el avance ya guardado de la lista base.
const spellEffects = table("SpellEffect");
const eEff = spellEffects.h.indexOf("Effect"), eItem = spellEffects.h.indexOf("EffectItemType"), eSpell = spellEffects.h.indexOf("SpellID");
const referencedItems = new Set([
  ...column("ItemSet", /^ItemID\[/), ...column("ItemModifiedAppearance", /^ItemID$/), ...column("ItemXItemEffect", /^ItemID$/), ...column("ItemSparse", /^OppositeFactionItemID$/),
  ...spellEffects.rows.filter((r) => Number(r[eEff]) === 24).map((r) => Number(r[eItem])).filter((n) => n > 0),
]);
// Objetos que aparecen en tablas de botín leídas de otros addons (tools/extract/read-loot-addons.mjs), si se han leído.
const lootIds = path.join(ROOT, "data", "external", "loot-addons", "item-ids.json");
if (fs.existsSync(lootIds)) for (const x of JSON.parse(fs.readFileSync(lootIds, "utf8"))) referencedItems.add(x);
const inBase = new Set(base);
const itemExtras = [...referencedItems].filter((x) => !inBase.has(x) && !have.has(x)).sort((a, b) => a - b);
const list = [...base, ...itemExtras];

// Hechizos que los objetos usan y que el cliente no trae con nombre: efectos de objeto, hechizos de conjunto, hechizos que esos disparan y encantamientos.
const haveSpell = new Set(column("SpellName", /^ID$/));
const spellRefs = new Set([...column("ItemEffect", /^SpellID$/), ...column("ItemSetSpell", /^SpellID$/)]);
const ench = table("SpellItemEnchantment");
const enchEffect = ench.h.map((n, i) => (/^Effect\[/.test(n) ? i : -1)).filter((i) => i >= 0);
const enchArg = ench.h.map((n, i) => (/^EffectArg\[/.test(n) ? i : -1)).filter((i) => i >= 0);
for (const r of ench.rows) enchEffect.forEach((ei, k) => { if ([1, 3, 7].includes(Number(r[ei])) && Number(r[enchArg[k]]) > 0) spellRefs.add(Number(r[enchArg[k]])); }); // proc, equipar, usar
const trigger = spellEffects.h.indexOf("EffectTriggerSpell");
for (const r of spellEffects.rows) if (spellRefs.has(Number(r[eSpell])) && Number(r[trigger]) > 0) spellRefs.add(Number(r[trigger]));
const spells = [...spellRefs].filter((x) => !haveSpell.has(x)).sort((a, b) => a - b);

const fmt = (arr) => { const out = []; for (let i = 0; i < arr.length; i += 14) out.push(`  ${arr.slice(i, i + 14).join(", ")},`); return out.join("\n"); };
const total = list.length + spells.length;
const minutes = Math.ceil((total / BATCH) * INTERVAL / 60);
const sum = (a) => a.reduce((s, x) => (s + x) % 1000000007, 0);
const listId = `${BUILD}:${base.length}:${sum(base)}`; // solo la lista base: así el avance guardado sigue valiendo al añadir ids al final
const extraId = `${itemExtras.length}:${sum(itemExtras)}`;
const spellId = `${spells.length}:${sum(spells)}`;

// Las rutas de textura van con «/» (WoW las acepta) para no depender de escapes de Lua.
const lua = `-- WFUC_ItemCache v6: pide al servidor, poco a poco, los ${list.length} objetos y ${spells.length} hechizos de objeto que conocemos y faltan en la cache local.
-- Objetos: los ${base.length} de la lista base + ${itemExtras.length} que el cliente nombra en conjuntos, apariencias, efectos, recetas y version de la otra faccion. Hechizos: efectos de objeto, de conjunto y de encantamiento.
-- Ademas anota, sin pedir nada, lo que el juego ya te ensena: botin por criatura/objeto (cuerpos y veces que salio cada objeto), vendedores con sus costes y recompensas de mision (WFUC_ItemCacheDB.seen).
-- Al terminar espera 60 s y guarda en WFUC_ItemCacheDB.report que ids siguen sin llegar (el servidor no los devuelve = probablemente ya no existen).
-- Boton que orbita por fuera del borde del minimapa: clic izquierdo = empezar / parar; clic derecho = estado; Mayus + clic derecho = empezar de cero; arrastrar = mover.
-- Colores: ROJO sin empezar · NARANJA trabajando · AMARILLO pendiente (parado a medias o en pausa por combate) · VERDE terminado.
-- Silencioso: no escribe en el chat salvo que lo pidas (comando o clic derecho). Tambien: /wfucitems start | stop | status | report | seen | reset. No se inicia solo. Guarda por donde va en WFUC_ItemCacheDB
-- (variables guardadas del propio juego, se escriben al salir/recargar) y retoma desde ahi.
local ids = {
${fmt(list)}
}
local BASE_N = ${base.length} -- los primeros BASE_N ids son la lista base; el resto son referenciados por el cliente
local spells = {
${fmt(spells)}
}
local BATCH, INTERVAL = ${BATCH}, ${INTERVAL} -- ${BATCH} peticiones cada ${INTERVAL} segundos (~${minutes} min en total)
local LIST_ID = '${listId}' -- identifica la lista base de objetos (el avance sobrevive si solo cambian los ids del final)
local EXTRA_ID = '${extraId}' -- identifica los objetos anadidos al final
local SPELL_ID = '${spellId}' -- identifica la lista de hechizos
local COLORS = { red = { 0.9, 0.15, 0.15 }, orange = { 1, 0.55, 0 }, yellow = { 1, 0.9, 0.1 }, green = { 0.15, 0.8, 0.2 } }
local atan2 = math.atan2 or math.atan

local db, ticker, button, refresh, seenSummary -- db se rellena en ADDON_LOADED: las variables guardadas NO existen cuando se ejecuta este fichero

-- Silencioso por defecto: el estado se ve en el color y el tooltip del boton. Solo habla cuando TU lo pides (comando /wfucitems o clic derecho).
local speak = false
local function say(msg) if speak then DEFAULT_CHAT_FRAME:AddMessage('|cff66ccffWFUC|r ' .. msg) end end

local function cached(id)
  if C_Item and C_Item.IsItemDataCachedByID then return C_Item.IsItemDataCachedByID(id) end
  return GetItemInfo(id) ~= nil
end

local function spellCached(id)
  if C_Spell then
    if C_Spell.IsSpellDataCached then return C_Spell.IsSpellDataCached(id) end
    if C_Spell.GetSpellName then return C_Spell.GetSpellName(id) ~= nil end
  end
  return GetSpellInfo ~= nil and GetSpellInfo(id) ~= nil
end

local function requestSpell(id)
  if C_Spell and C_Spell.RequestLoadSpellData then C_Spell.RequestLoadSpellData(id)
  elseif GetSpellInfo then GetSpellInfo(id) end
end

local function finished() return db.idx > #ids and db.sidx > #spells end

-- Cuenta cuantos de los ya pedidos conoce el cliente (solo de los ya pedidos, para no lanzar peticiones nuevas).
local knownCache, knownAt = 0, -100
local function known()
  if GetTime() - knownAt < 5 then return knownCache end
  local n = 0
  for i = 1, math.min(db.idx - 1, #ids) do if cached(ids[i]) then n = n + 1 end end
  for i = 1, math.min(db.sidx - 1, #spells) do if spellCached(spells[i]) then n = n + 1 end end
  knownCache, knownAt = n, GetTime()
  return n
end

local function state()
  if not db then return 'red', 'Cargando' end
  if ticker then
    if UnitAffectingCombat('player') then return 'yellow', 'En pausa (combate)' end
    return 'orange', 'Trabajando'
  end
  if finished() then return 'green', 'Terminado' end
  if db.idx == 1 and db.sidx == 1 then return 'red', 'Sin empezar' end
  return 'yellow', 'Pendiente: parado a mitad'
end

-- «1-5,9,12-14» a partir de una lista ordenada de ids.
local function ranges(list)
  local out, a, b = {}, nil, nil
  local function push() if a then out[#out + 1] = (a == b) and tostring(a) or (a .. '-' .. b) end end
  for _, id in ipairs(list) do
    if a and id == b + 1 then b = id else push() a, b = id, id end
  end
  push()
  return table.concat(out, ',')
end

-- Informe para tools: ids pedidos que el cliente sigue sin tener. Solo mira lo ya pedido y no lanza peticiones.
local function report()
  local noItems, noSpells, gotItems, gotSpells = {}, {}, 0, 0
  for i = 1, math.min(db.idx - 1, #ids) do
    if cached(ids[i]) then gotItems = gotItems + 1 else noItems[#noItems + 1] = ids[i] end
  end
  for i = 1, math.min(db.sidx - 1, #spells) do
    if spellCached(spells[i]) then gotSpells = gotSpells + 1 else noSpells[#noSpells + 1] = spells[i] end
  end
  table.sort(noItems) table.sort(noSpells)
  local version, build = GetBuildInfo()
  db.report = {
    at = date('%Y-%m-%d %H:%M'), version = version, build = build, list = LIST_ID,
    items = math.min(db.idx - 1, #ids), itemsKnown = gotItems, itemsMissing = ranges(noItems),
    spells = math.min(db.sidx - 1, #spells), spellsKnown = gotSpells, spellsMissing = ranges(noSpells),
  }
  say('informe: objetos ' .. gotItems .. ' conocidos, ' .. #noItems .. ' sin llegar; hechizos ' .. gotSpells .. ' conocidos, ' .. #noSpells .. ' sin llegar. Guardado en WFUC_ItemCacheDB.report (se escribe al salir/recargar).')
end

refresh = function()
  if not button then return end
  local color = COLORS[(state())]
  button.dot:SetColorTexture(color[1], color[2], color[3], 1)
end

local function stop(why)
  if ticker then ticker:Cancel() ticker = nil end
  if why then say(why) end
  refresh()
end

local function tick()
  if UnitAffectingCombat('player') then return end
  local sent = 0
  while sent < BATCH do
    local id = ids[db.idx]
    if id then
      db.idx = db.idx + 1
      if not cached(id) then -- los que el cliente ya conoce no se piden
        if C_Item and C_Item.RequestLoadItemDataByID then C_Item.RequestLoadItemDataByID(id) else GetItemInfo(id) end
        sent = sent + 1
      end
    else
      local sp = spells[db.sidx]
      if not sp then
        stop('terminado: ' .. #ids .. ' objetos y ' .. #spells .. ' hechizos recorridos. En 60 s se guarda el informe; despues /logout (salir del todo, sin cierre forzado).')
        C_Timer.After(60, function() if db and finished() then report() end end)
        return
      end
      db.sidx = db.sidx + 1
      if not spellCached(sp) then
        requestSpell(sp)
        sent = sent + 1
      end
    end
  end
  if db.idx % 500 < 12 then say((db.idx - 1) .. ' / ' .. #ids .. ' objetos') end
end

local function start()
  if not db then return end
  if ticker then say('ya esta en marcha') return end
  if finished() then say('ya esta terminado (Mayus + clic derecho o /wfucitems reset para empezar de cero)') refresh() return end
  ticker = C_Timer.NewTicker(INTERVAL, tick)
  say('retomando: objetos ' .. math.min(db.idx, #ids + 1) - 1 .. ' / ' .. #ids .. ', hechizos ' .. math.min(db.sidx, #spells + 1) - 1 .. ' / ' .. #spells .. ' (se detiene en combate o al cambiar de zona)')
  refresh()
end

local function status()
  local _, label = state()
  say(label .. ': objetos ' .. math.min(db.idx - 1, #ids) .. ' / ' .. #ids .. ', hechizos ' .. math.min(db.sidx - 1, #spells) .. ' / ' .. #spells .. '; ya conocidos por el cliente de los pedidos: ' .. known())
end

local function reset()
  stop()
  db.idx, db.sidx, db.report = 1, 1, nil
  say('avance a cero')
  refresh()
end

local function placeButton()
  local a = math.rad(db.angle or 200)
  button:ClearAllPoints()
  local r = Minimap:GetWidth() / 2 + 22 -- por FUERA del borde del minimapa (el radio sigue al tamano que tenga)
  button:SetPoint('CENTER', Minimap, 'CENTER', math.cos(a) * r, math.sin(a) * r)
end

local function showTooltip(self)
  local _, label = state()
  GameTooltip:SetOwner(self, 'ANCHOR_LEFT')
  GameTooltip:ClearLines()
  GameTooltip:AddLine('WFUC ItemCache')
  GameTooltip:AddLine(label, 1, 1, 1)
  local done = math.min(db.idx - 1, #ids) + math.min(db.sidx - 1, #spells)
  local all = #ids + #spells
  GameTooltip:AddLine(done .. ' / ' .. all .. ' (' .. math.floor(done * 100 / all) .. '%): ' .. #ids .. ' objetos + ' .. #spells .. ' hechizos', 0.8, 0.8, 0.8)
  if finished() then
    GameTooltip:AddLine('Recibidos por el cliente: ' .. known() .. '. El resto, probablemente ya no existe en el servidor.', 0.8, 0.8, 0.8, true)
    if db.report then GameTooltip:AddLine('Informe guardado ' .. db.report.at, 0.8, 0.8, 0.8) else GameTooltip:AddLine('El informe se guarda 60 s despues de terminar', 0.8, 0.8, 0.8) end
  else
    GameTooltip:AddLine('Faltan unos ' .. math.ceil((all - done) / BATCH * INTERVAL / 60) .. ' min', 0.8, 0.8, 0.8)
  end
  GameTooltip:AddLine('Observado: ' .. seenSummary(), 0.8, 0.8, 0.8, true)
  GameTooltip:AddLine(' ')
  GameTooltip:AddLine('Clic izquierdo: empezar / parar', 0.6, 0.8, 1)
  GameTooltip:AddLine('Clic derecho: estado en el chat', 0.6, 0.8, 1)
  GameTooltip:AddLine('Mayus + clic derecho: empezar de cero', 0.6, 0.8, 1)
  GameTooltip:AddLine('Arrastrar: mover el boton', 0.6, 0.8, 1)
  GameTooltip:Show()
end

local function createButton()
  button = CreateFrame('Button', 'WFUCItemCacheButton', Minimap)
  button:SetSize(31, 31)
  button:SetFrameStrata('MEDIUM')
  button:SetFrameLevel(8)
  button:RegisterForClicks('LeftButtonUp', 'RightButtonUp')
  button:RegisterForDrag('LeftButton')
  local bg = button:CreateTexture(nil, 'BACKGROUND')
  bg:SetSize(20, 20)
  bg:SetPoint('CENTER', 0, 1)
  bg:SetTexture('Interface/Minimap/UI-Minimap-Background')
  local dot = button:CreateTexture(nil, 'ARTWORK')
  dot:SetSize(17, 17)
  dot:SetPoint('CENTER', 0, 1)
  dot:SetColorTexture(1, 1, 1, 1)
  if button.CreateMaskTexture then -- circulo; sin mascara se ve cuadrado pero funciona igual
    local mask = button:CreateMaskTexture()
    mask:SetTexture('Interface/CharacterFrame/TempPortraitAlphaMask', 'CLAMPTOBLACKADDITIVE', 'CLAMPTOBLACKADDITIVE')
    mask:SetAllPoints(dot)
    dot:AddMaskTexture(mask)
  end
  button.dot = dot
  local border = button:CreateTexture(nil, 'OVERLAY')
  border:SetSize(53, 53)
  border:SetPoint('TOPLEFT')
  border:SetTexture('Interface/Minimap/MiniMap-TrackingBorder')
  local label = button:CreateFontString(nil, 'OVERLAY', 'GameFontNormalSmall')
  label:SetPoint('CENTER', 0, 1)
  label:SetText('WF')
  label:SetTextColor(0, 0, 0)
  button:SetHighlightTexture('Interface/Minimap/UI-Minimap-ZoomButton-Highlight')
  button:SetScript('OnClick', function(_, b)
    speak = (b == 'RightButton') -- el clic derecho pide el estado: ese si se escribe en el chat
    if b == 'RightButton' then
      if IsShiftKeyDown() then reset() else status() end
    elseif ticker then
      stop('parado en ' .. db.idx .. ' / ' .. #ids)
    else
      start()
    end
    speak = false
  end)
  local tipTicker
  button:SetScript('OnEnter', function(self)
    showTooltip(self)
    tipTicker = C_Timer.NewTicker(1, function() if GameTooltip:GetOwner() == self then showTooltip(self) end end)
  end)
  button:SetScript('OnLeave', function() if tipTicker then tipTicker:Cancel() tipTicker = nil end GameTooltip:Hide() end)
  button:SetScript('OnDragStart', function(self)
    self:SetScript('OnUpdate', function()
      local mx, my = Minimap:GetCenter()
      local px, py = GetCursorPosition()
      local s = Minimap:GetEffectiveScale()
      db.angle = math.deg(atan2(py / s - my, px / s - mx))
      placeButton()
    end)
  end)
  button:SetScript('OnDragStop', function(self) self:SetScript('OnUpdate', nil) end)
  placeButton()
  refresh()
end

-- ---------- Observacion pasiva (v5): lo que el juego ya te ensena, anotado en WFUC_ItemCacheDB.seen. No hace ninguna peticion. ----------
local function safe(f) -- un fallo aqui nunca debe romper el resto del addon
  return function(...)
    if not db then return end
    local ok, err = pcall(f, ...)
    if not ok then db.errors, db.lastError = (db.errors or 0) + 1, tostring(err) end
  end
end

local function idOf(link) return link and tonumber(link:match('item:(%d+)')) end

-- «N123» criatura / «O123» objeto del mundo a partir de un GUID (Tipo-0-servidor-instancia-zona-ID-copia).
local function guidKey(guid)
  if not guid then return nil end
  local kind, _, _, _, _, id = strsplit('-', guid)
  id = tonumber(id)
  if not id then return nil end
  if kind == 'Creature' or kind == 'Vehicle' then return 'N' .. id end
  if kind == 'GameObject' then return 'O' .. id end
end

local function where()
  local _, _, diff, _, _, _, _, map = GetInstanceInfo()
  return GetRealZoneText() or '', map or 0, diff or 0
end

local looted = {} -- cuerpos ya contados en esta sesion (un cuerpo cuenta una vez aunque se abra varias)
local onLoot = safe(function()
  if not GetLootSourceInfo then return end
  local bySource = {}
  for slot = 1, GetNumLootItems() do
    local id = idOf(GetLootSlotLink(slot))
    local src = { GetLootSourceInfo(slot) }
    for k = 1, #src, 2 do
      local guid = src[k]
      if guidKey(guid) and not looted[guid] then
        bySource[guid] = bySource[guid] or {}
        if id then bySource[guid][#bySource[guid] + 1] = id end
      end
    end
  end
  local zone, map, diff = where()
  for guid, list in pairs(bySource) do
    looted[guid] = true
    local key = guidKey(guid) .. (diff > 0 and ('@' .. diff) or '')
    local e = db.seen.loot[key]
    if not e then e = { k = 0, i = {} } db.seen.loot[key] = e end
    e.k = e.k + 1
    e.z, e.m, e.d = zone, map, diff
    if not e.n then
      if UnitGUID('target') == guid then e.n = UnitName('target') elseif UnitGUID('mouseover') == guid then e.n = UnitName('mouseover') end
    end
    local once = {}
    for _, id in ipairs(list) do
      if not once[id] then once[id] = true e.i[id] = (e.i[id] or 0) + 1 end -- en cuantos cuerpos salio
    end
  end
end)

local onMerchant = safe(function()
  local key = guidKey(UnitGUID('npc'))
  if not key then return end
  local rows = {}
  for i = 1, GetMerchantNumItems() do
    local id = idOf(GetMerchantItemLink(i))
    if id then
      local price, qty, avail, ext
      if GetMerchantItemInfo then
        local _
        _, _, price, qty, avail, _, _, ext = GetMerchantItemInfo(i)
      elseif C_MerchantFrame and C_MerchantFrame.GetItemInfo then
        local t = C_MerchantFrame.GetItemInfo(i)
        if t then price, qty, avail, ext = t.price, t.stackCount, t.numAvailable, t.hasExtendedCost end
      end
      local row = { id = id, p = price, q = qty, a = avail }
      if ext and GetMerchantItemCostInfo then -- coste en objetos o monedas: «i123x5» objeto, «c42x5» moneda
        local parts = {}
        for j = 1, (GetMerchantItemCostInfo(i)) do
          local _, value, link = GetMerchantItemCostItem(i, j)
          local cost = idOf(link)
          if cost then parts[#parts + 1] = 'i' .. cost .. 'x' .. value
          elseif link and link:match('currency:(%d+)') then parts[#parts + 1] = 'c' .. link:match('currency:(%d+)') .. 'x' .. value end
        end
        row.c = table.concat(parts, ',')
      end
      rows[#rows + 1] = row
    end
  end
  local zone, map = where()
  db.seen.vendors[key] = { n = UnitName('npc'), z = zone, m = map, t = time(), items = rows }
end)

local onQuest = safe(function()
  local id = GetQuestID and GetQuestID()
  if not id or id == 0 then return end
  local choices, rewards = {}, {}
  for i = 1, GetNumQuestChoices() do local x = idOf(GetQuestItemLink('choice', i)) if x then choices[#choices + 1] = x end end
  for i = 1, GetNumQuestRewards() do local x = idOf(GetQuestItemLink('reward', i)) if x then rewards[#rewards + 1] = x end end
  local zone, map = where()
  db.seen.quests[id] = {
    t = GetTitleText and GetTitleText(), npc = guidKey(UnitGUID('npc')), npcName = UnitName('npc'), z = zone, m = map,
    c = choices, r = rewards, xp = GetRewardXP and GetRewardXP(), money = GetRewardMoney and GetRewardMoney(),
  }
end)

local function countKeys(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end
seenSummary = function()
  local items = 0
  for _, e in pairs(db.seen.loot) do items = items + countKeys(e.i) end
  return countKeys(db.seen.loot) .. ' fuentes de botin (' .. items .. ' pares objeto-fuente), ' .. countKeys(db.seen.vendors) .. ' vendedores, ' .. countKeys(db.seen.quests) .. ' misiones'
end

-- Un marco por evento y sin comparar el nombre del evento: el cliente actual entrega algunos argumentos (y a veces el propio evento) como
-- valores «secretos» y compararlos da error («attempt to compare a secret string value»); asi solo se mira arg1 de ADDON_LOADED, y con guarda.
local function onEvent(name, fn)
  local f = CreateFrame('Frame')
  f:RegisterEvent(name)
  f:SetScript('OnEvent', fn)
  return f
end

local loader
loader = onEvent('ADDON_LOADED', function(_, _, arg1)
  if issecretvalue and issecretvalue(arg1) then return end
  if arg1 ~= 'WFUC_ItemCache' then return end
  WFUC_ItemCacheDB = WFUC_ItemCacheDB or {}
  db = WFUC_ItemCacheDB
  if db.list ~= LIST_ID then db.list, db.idx, db.sidx, db.report = LIST_ID, 1, 1, nil end -- lista base nueva (otro parche): empezar de cero; la misma: retomar
  db.idx = db.idx or 1
  db.sidx = db.sidx or 1
  if db.extra ~= EXTRA_ID then -- cambiaron los objetos del final: si ya habia pasado de la lista base, volver a su final
    db.extra = EXTRA_ID
    if db.idx > BASE_N + 1 then db.idx = BASE_N + 1 end
  end
  if db.spellList ~= SPELL_ID then db.spellList, db.sidx = SPELL_ID, 1 end
  db.seen = db.seen or {}
  db.seen.loot, db.seen.vendors, db.seen.quests = db.seen.loot or {}, db.seen.vendors or {}, db.seen.quests or {} -- lo observado nunca se borra con reset
  createButton()
  loader:UnregisterEvent('ADDON_LOADED')
end)
onEvent('PLAYER_LEAVING_WORLD', function()
  if ticker then ticker:Cancel() ticker = nil end
  refresh()
end)
onEvent('LOOT_OPENED', function() onLoot() end)
onEvent('MERCHANT_SHOW', function() onMerchant() end)
onEvent('QUEST_COMPLETE', function() onQuest() end)
onEvent('PLAYER_REGEN_DISABLED', function() refresh() end) -- entrar o salir de combate cambia naranja <-> amarillo
onEvent('PLAYER_REGEN_ENABLED', function() refresh() end)

SLASH_WFUCITEMS1 = '/wfucitems'
SlashCmdList.WFUCITEMS = function(arg)
  if not db then return end
  speak = true -- los comandos escritos si contestan
  arg = (arg or ''):lower()
  if arg == 'start' then start()
  elseif arg == 'stop' then stop('parado en ' .. db.idx .. ' / ' .. #ids)
  elseif arg == 'reset' then reset()
  elseif arg == 'report' then report()
  elseif arg == 'seen' then say('observado: ' .. seenSummary() .. (db.errors and (' (errores internos: ' .. db.errors .. ', ultimo: ' .. db.lastError .. ')') or ''))
  else status() end
  speak = false
end
`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "WFUC_ItemCache.lua"), lua);
fs.writeFileSync(path.join(OUT, "WFUC_ItemCache.toc"), "## Interface: 16001\n## Title: WFUC ItemCache\n## Notes: Pide por lotes pequenos los objetos y hechizos de objeto que faltan en la cache local (boton del minimapa o /wfucitems start) y anota botin, vendedores y misiones que ves\n## Author: local\n## Version: 6\n## SavedVariables: WFUC_ItemCacheDB\n\nWFUC_ItemCache.lua\n");
console.log(`${base.length} objetos de la lista base + ${itemExtras.length} referenciados + ${spells.length} hechizos (≈ ${minutes} min) → ${path.relative(ROOT, OUT)}`);
