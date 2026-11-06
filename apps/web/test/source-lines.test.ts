import { describe, expect, it } from "vitest";
import type { ItemSourceEntry } from "@wfuc/schema";
import { moneyText, sourceLines } from "../src/components/gear-format";

const drop = (npcId: number, drops: number, kills: number, name: string | null = "Grubbis"): ItemSourceEntry => ({ kind: "drop", source: "creature", npcId, name, zone: "Gnomeregan", difficulty: 1, kills, drops, origin: "beta-measured" });

describe("moneyText", () => {
  it("oro, plata y cobre; cero si no hay nada", () => {
    expect(moneyText(12005)).toBe("1g 20s 5c");
    expect(moneyText(500)).toBe("5s");
    expect(moneyText(0)).toBe("0c");
  });
});

describe("sourceLines", () => {
  it("botín observado con cuerpos y veces, la mejor probabilidad primero (a igualdad, la de más cuerpos), y los sobrantes resumidos", () => {
    const lines = sourceLines([drop(1, 1, 10), drop(2, 5, 5, null), drop(3, 1, 4), drop(4, 1, 2), drop(5, 1, 1)]);
    expect(lines[0]).toContain("criatura 2");
    expect(lines[0]).toContain("salió en 5 de 5");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("2 fuentes de botín más");
  });
  it("vendedor con precio y coste, y misión a elegir", () => {
    const lines = sourceLines([
      { kind: "vendor", npcId: 9, name: "Pepe", zone: null, price: 12005, quantity: 1, cost: [{ type: "currency", id: 42, count: 3, name: "Marcas" }], origin: "beta-measured" },
      { kind: "quest", questId: 7, title: "Salva el cerebro", choice: true, giver: null, zone: null, origin: "beta-measured" },
    ]);
    expect(lines[0]).toBe("Vendedor: Pepe: 1g 20s 5c + 3 × Marcas (observado)");
    expect(lines[1]).toBe("Misión: Salva el cerebro (a elegir) (observado)");
  });
});
