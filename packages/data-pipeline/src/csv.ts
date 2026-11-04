import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

export type Row = Record<string, string>;

export interface RawTables {
  dir: string;
  /** Lee una tabla CSV; falla con un mensaje claro si no existe. */
  table(name: string): Row[];
  /** Hash de las tablas que se han leido, para el manifest. */
  inputs(): { table: string; sha256: string }[];
}

/** Columnas de texto en las que el hotfix puede traer el inglés sin traducir encima del español del cliente. */
const HOTFIX_TEXT_COLUMNS: Record<string, string[]> = {
  Spell: ["Description_lang", "AuraDescription_lang", "NameSubtext_lang"],
  SpellName: ["Name_lang"],
};

/** Marcadores del cliente (`$m1`, `${$m1/2}`) de un texto, ordenados: dos textos con los mismos dicen lo mismo con otras palabras. */
const markers = (text: string): string => (text.match(/\$\{[^}]*\}|\$[A-Za-z0-9<>@]+/g) ?? []).sort().join("|");

/** Cifras escritas con dígitos, ordenadas («1,5» y «1.5» cuentan igual): dos textos con las mismas cifras dicen lo mismo con otras palabras. */
const figures = (text: string): string => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", ".")))).sort().join("|");

/**
 * Los hotfixes del servidor repiten a veces un hechizo con su texto en inglés aunque el cliente ya trae su traducción
 * (parche 70658: 24 descripciones y 8 nombres). Si el volcado es `<build>-hotfix` y existen `<build>` (estático) y
 * `<build>-hotfix-enUS`, un texto del hotfix IGUAL al inglés y distinto del estático se sustituye por el del estático
 * cuando los dos llevan los mismos marcadores Y las mismas cifras. Lo que el hotfix cambia de verdad (otro marcador, otras
 * cifras escritas a mano —Mordedura feroz del 70755: 50-66 → 62-82—, otro nombre en español) se queda como está.
 */
function staticTextWhereHotfixIsUntranslated(dir: string, name: string, rows: Row[]): number {
  const columns = HOTFIX_TEXT_COLUMNS[name];
  if (!columns || !dir.endsWith("-hotfix")) return 0;
  const staticFile = join(dir.slice(0, -"-hotfix".length), `${name}.csv`);
  const englishFile = join(`${dir}-enUS`, `${name}.csv`);
  if (!existsSync(staticFile) || !existsSync(englishFile)) return 0;
  const read = (file: string) => new Map((parse(readFileSync(file), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Row[]).map((r) => [r.ID!, r]));
  const fixed = read(staticFile);
  const english = read(englishFile);
  let changed = 0;
  for (const row of rows) {
    const base = fixed.get(row.ID!);
    const en = english.get(row.ID!);
    if (!base || !en) continue;
    for (const c of columns) {
      const staticText = base[c] ?? "";
      if (staticText && row[c] && row[c] === en[c] && row[c] !== staticText && markers(row[c]!) === markers(staticText) && figures(row[c]!) === figures(staticText)) {
        row[c] = staticText;
        changed++;
      }
    }
  }
  return changed;
}

/** Tablas de objetos cuyas filas ausentes se pueden arrastrar del volcado anterior (`carried-from.json`). */
const CARRIED_TABLES = new Set(["Item", "ItemSparse", "ItemSearchName", "ItemEffect", "ItemXItemEffect"]);

/**
 * El 70658 se leyó desde la pantalla de personajes y su caché trae ≈ 4 100 filas de ItemSparse menos que la del 70532 (objetos
 * básicos incluidos), casi seguro porque aún no se han enviado. Si `<volcado>/carried-from.json` = `{"from": "<carpeta>"}`, las
 * filas de objetos que faltan se toman de esa carpeta (las del volcado nuevo mandan). Borrar el fichero lo desactiva.
 */
/** Carpeta de la que se arrastran las filas de objetos (`carried-from.json`), o null. */
export function carriedFrom(dir: string): string | null {
  const marker = join(dir, "carried-from.json");
  return existsSync(marker) ? join(dir, "..", (JSON.parse(readFileSync(marker, "utf8")) as { from: string }).from) : null;
}

/** Tablas de objetos que `"carriedWins"` deja con la fila del volcado anterior. */
const ITEM_ROW_TABLES = new Set(["Item", "ItemSparse", "ItemSearchName"]);

/**
 * Tablas de hechizos con filas que solo llegaban por hotfix (consumibles nuevos, hechizos de objeto). Solo se arrastran si el marcador
 * lleva `"spellTables": true` (caché de hotfixes que no se aplica al build nuevo, p. ej. el 70790) y solo del primer nivel.
 */
const CARRIED_SPELL_TABLES = new Set([
  "Spell", "SpellName", "SpellEffect", "SpellMisc", "SpellAuraOptions", "SpellCategories", "SpellClassOptions", "SpellCooldowns",
  "SpellEquippedItems", "SpellLevels", "SpellPower", "SpellRadius", "SpellTargetRestrictions", "SpellProcsPerMinute",
]);

function carriedRows(dir: string, name: string, rows: Row[]): number {
  const spellTable = CARRIED_SPELL_TABLES.has(name);
  if (!CARRIED_TABLES.has(name) && !spellTable) return 0;
  const marker = join(dir, "carried-from.json");
  if (spellTable && !(existsSync(marker) && (JSON.parse(readFileSync(marker, "utf8")) as { spellTables?: boolean }).spellTables)) return 0;
  // `"carriedWins": true`: las filas de objeto del primer nivel sustituyen a las del volcado nuevo (los hotfixes del servidor siguen vigentes
  // aunque la caché no se pueda aplicar a este build y el estático conserva la fila anterior al hotfix).
  const carriedWins = existsSync(marker) && (JSON.parse(readFileSync(marker, "utf8")) as { carriedWins?: boolean }).carriedWins === true && ITEM_ROW_TABLES.has(name);
  const index = new Map(rows.map((r, i) => [r.ID, i] as const));
  const have = new Set(rows.map((r) => r.ID));
  let added = 0;
  // La cadena se sigue hasta el final (70790 → 70755 → 70532): un volcado que arrastra de otro que a su vez arrastra.
  const seen = new Set<string>([dir]);
  for (let source = carriedFrom(dir); source && !seen.has(source) && !(spellTable && seen.size > 1); source = carriedFrom(source)) {
    const first = seen.size === 1;
    seen.add(source);
    const from = join(source, `${name}.csv`);
    if (!existsSync(from)) continue;
    for (const r of parse(readFileSync(from), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Row[]) {
      if (carriedWins && first && index.has(r.ID)) {
        rows[index.get(r.ID)!] = r;
        continue;
      }
      if (!have.has(r.ID!)) {
        have.add(r.ID);
        rows.push(r);
        added++;
      }
    }
  }
  return added;
}

export function openRawTables(dir: string): RawTables {
  const cache = new Map<string, Row[]>();
  const hashes = new Map<string, string>();
  return {
    dir,
    table(name) {
      const hit = cache.get(name);
      if (hit) return hit;
      let buf: Buffer;
      try {
        buf = readFileSync(join(dir, `${name}.csv`));
      } catch {
        throw new Error(`Falta ${name}.csv en ${dir}. Exportalo con tools/extract/export-tables.sh`);
      }
      hashes.set(name, createHash("sha256").update(buf).digest("hex"));
      const rows = parse(buf, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Row[];
      staticTextWhereHotfixIsUntranslated(dir, name, rows);
      carriedRows(dir, name, rows);
      cache.set(name, rows);
      return rows;
    },
    inputs() {
      return [...hashes].sort(([a], [b]) => a.localeCompare(b)).map(([table, sha256]) => ({ table, sha256 }));
    },
  };
}

export const int = (v: string | undefined): number => (v === undefined || v === "" ? 0 : Number.parseInt(v, 10));
