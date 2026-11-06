import { describe, expect, it } from "vitest";
import { ItemSources } from "../src/model.js";
import { observedSources, type ObservedSources } from "../src/observed-sources.js";

// Datos sintéticos con la forma que deja tools/extract/read-observed.mjs.
const OBS: ObservedSources = {
  loot: {
    "N7361@1": { k: 5, n: "Grubbis", z: "Gnomeregan", m: 90, d: 1, i: { "1234": 2, "9999": 1 } },
    O55: { k: 3, z: "Colinas", i: { "1234": 7 } }, // más veces que cuerpos: se recorta a los cuerpos
    bad: { k: 1, i: { "1234": 1 } }, // clave que no es criatura ni objeto: se ignora
  },
  vendors: { N9999: { n: "Pepe", z: "Ventormenta", items: [{ id: 1234, p: 500, q: 1, c: "i900x5,c42x3,x" }] } },
  quests: { "2926": { t: "Salva el cerebro", npcName: "Tinkmaster", z: "Forjaz", c: [1234], r: [] } },
};

describe("observedSources", () => {
  const out = observedSources(OBS, new Set([1234]), new Map([[900, "Chatarra"]]), new Map([[42, "Marcas"]]));
  it("solo objetos conocidos y todas las fuentes salen válidas para el esquema", () => {
    expect([...out.keys()]).toEqual([1234]);
    expect(() => ItemSources.parse({ schemaVersion: 1, build: "x", items: { "1234": out.get(1234)! } })).not.toThrow();
  });
  it("botín: cuerpos y veces, nunca más veces que cuerpos, y la dificultad sale de la clave", () => {
    const drops = out.get(1234)!.filter((s) => s.kind === "drop");
    expect(drops).toHaveLength(2);
    expect(drops[0]).toMatchObject({ source: "creature", npcId: 7361, difficulty: 1, kills: 5, drops: 2, name: "Grubbis" });
    expect(drops[1]).toMatchObject({ source: "object", npcId: 55, difficulty: 0, kills: 3, drops: 3, name: null });
  });
  it("vendedor: coste en objetos y monedas con nombre, sin partes inválidas", () => {
    const v = out.get(1234)!.find((s) => s.kind === "vendor")!;
    expect(v).toMatchObject({ kind: "vendor", npcId: 9999, price: 500, cost: [{ type: "item", id: 900, count: 5, name: "Chatarra" }, { type: "currency", id: 42, count: 3, name: "Marcas" }] });
  });
  it("misión: a elegir o fija", () => {
    expect(out.get(1234)!.find((s) => s.kind === "quest")).toMatchObject({ questId: 2926, choice: true, giver: "Tinkmaster", title: "Salva el cerebro" });
  });
});
