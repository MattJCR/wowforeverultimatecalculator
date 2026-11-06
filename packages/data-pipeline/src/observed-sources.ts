import type { ItemSourceEntry } from "./model.js";

/** Lo que `tools/extract/read-observed.mjs` deja en data/observed/sources.json (anotado por el addon de la caché al jugar). */
export interface ObservedSources {
  loot: Record<string, { k: number; n?: string; z?: string; m?: number; d?: number; i: Record<string, number> }>;
  vendors: Record<string, { n?: string; z?: string; t?: number; items: { id: number; p?: number; q?: number; a?: number; c?: string }[] }>;
  quests: Record<string, { t?: string; npc?: string; npcName?: string; z?: string; c: number[]; r: number[] }>;
}

const idOf = (key: string): { source: "creature" | "object"; npcId: number; difficulty: number } | null => {
  const m = /^([NO])(\d+)(?:@(\d+))?$/.exec(key);
  return m ? { source: m[1] === "N" ? "creature" : "object", npcId: Number(m[2]), difficulty: m[3] ? Number(m[3]) : 0 } : null;
};

/**
 * Fuentes observadas jugando (`beta-measured`): botín por criatura/objeto con cuántos cuerpos se abrieron, vendedores con su coste y
 * recompensas de misión. Solo de objetos que conocemos; los nombres de los objetos del coste salen de `names`.
 */
export function observedSources(obs: ObservedSources, itemIds: Set<number>, names: Map<number, string>, currencies: Map<number, string>): Map<number, ItemSourceEntry[]> {
  const out = new Map<number, ItemSourceEntry[]>();
  const push = (id: number, e: ItemSourceEntry) => {
    if (!itemIds.has(id)) return;
    const list = out.get(id) ?? [];
    list.push(e);
    out.set(id, list);
  };
  for (const [key, e] of Object.entries(obs.loot ?? {})) {
    const k = idOf(key);
    if (!k) continue;
    for (const [id, drops] of Object.entries(e.i ?? {})) push(Number(id), { kind: "drop", ...k, name: e.n ?? null, zone: e.z || null, kills: e.k, drops: Math.min(drops, e.k), origin: "beta-measured" });
  }
  for (const [key, v] of Object.entries(obs.vendors ?? {})) {
    const k = idOf(key);
    if (!k) continue;
    for (const row of v.items ?? []) {
      const cost = (row.c ? row.c.split(",") : []).flatMap((part) => {
        const m = /^([ic])(\d+)x(\d+)$/.exec(part);
        if (!m) return [];
        const type = m[1] === "i" ? ("item" as const) : ("currency" as const);
        const id = Number(m[2]);
        return [{ type, id, count: Number(m[3]), name: (type === "item" ? names.get(id) : currencies.get(id)) ?? null }];
      });
      push(row.id, { kind: "vendor", npcId: k.npcId, name: v.n ?? null, zone: v.z || null, price: row.p ?? 0, quantity: row.q ?? 1, cost, origin: "beta-measured" });
    }
  }
  for (const [qid, q] of Object.entries(obs.quests ?? {})) {
    const base = { kind: "quest" as const, questId: Number(qid), title: q.t ?? null, giver: q.npcName ?? null, zone: q.z || null, origin: "beta-measured" as const };
    for (const id of q.c ?? []) push(id, { ...base, choice: true });
    for (const id of q.r ?? []) push(id, { ...base, choice: false });
  }
  return out;
}
