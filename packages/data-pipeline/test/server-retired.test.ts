import { describe, expect, it } from "vitest";
import { parseIdRanges, retiredByServer } from "../src/server-retired.js";

describe("retiredByServer", () => {
  it("lee rangos y descarta partes inválidas", () => {
    expect([...parseIdRanges("1-3,7,x,10-11")]).toEqual([1, 2, 3, 7, 10, 11]);
  });
  it("devuelve lo que el servidor no dio y la caché final no trae; el informe de un build anterior se arrastra, el de uno posterior no vale", () => {
    const report = { build: 70790, itemsMissing: "1-3,50" };
    expect([...retiredByServer(report, "1.60.1.70790", new Set([2]))]).toEqual([1, 3, 50]);
    // arrastre: build de los datos posterior al del informe; lo que la caché nueva ya trae (2, 50) deja de estar retirado
    expect([...retiredByServer(report, "1.60.1.70800", new Set([2, 50]))]).toEqual([1, 3]);
    expect(retiredByServer(report, "1.60.1.70700", new Set()).size).toBe(0);
    expect(retiredByServer(null, "1.60.1.70790", new Set()).size).toBe(0);
  });
});
