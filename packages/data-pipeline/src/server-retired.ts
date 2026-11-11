import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Rangos «1-5,9,12-14» del informe de WFUC_ItemCache → ids. */
export function parseIdRanges(text: string): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

/** Lo que el addon de la caché deja en data/observed/cache-report.json. */
export interface CacheReport {
  build?: number | string;
  itemsMissing?: string;
}

/**
 * Objetos RETIRADOS: el addon de la caché los pidió al servidor (los conocíamos por el cliente, por volcados anteriores o por la copia de
 * la comunidad) y el servidor no los devolvió. Un informe de un build anterior al de los datos (`buildId` = «1.60.1.70888») se arrastra:
 * sigue retirando lo que la caché del build nuevo tampoco trae, hasta que el addon se vuelva a pasar con el build nuevo y su informe lo sustituya.
 * Se descartan los que la caché final SÍ trae (`have`): el servidor responde con retraso y el informe se hace 60 s después de pedir, así que
 * unos cuantos aparecen como «sin llegar» y luego llegan (y los que el servidor devuelve en un parche posterior). Ninguno de los retirados debe volver por otra vía (ni arrastrado de una caché antigua ni de la copia de la comunidad).
 */
export function retiredByServer(report: CacheReport | null, buildId: string, have: Set<number>): Set<number> {
  if (!report?.itemsMissing) return new Set();
  // Un informe de un build POSTERIOR al de los datos no puede aplicarse (sería de otro servidor/parche futuro)
  if (Number(report.build) > Number(buildId.split(".").pop())) return new Set();
  return new Set([...parseIdRanges(report.itemsMissing)].filter((id) => !have.has(id)));
}

/** Lee el informe del addon (data/observed/cache-report.json) y devuelve los objetos retirados; vacío si no hay informe. */
export function loadRetired(repoRoot: string, buildId: string, have: Set<number>): Set<number> {
  const file = join(repoRoot, "data", "observed", "cache-report.json");
  return retiredByServer(existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CacheReport) : null, buildId, have);
}
