// Pruebas del lector de lo que anota WFUC_ItemCache (`npm run test:tools`). No tocan el cliente.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLuaTable } from "../../extract/lib/lua-table.mjs";

// Formato real de SavedVariables: claves entre corchetes, comentarios «-- [n]», comas finales, cadenas con escapes.
const SAMPLE = `
WFUC_ItemCacheDB = {
	["list"] = "1.60.1.70862:9469:691146926",
	["idx"] = 9654,
	["angle"] = 201.5,
	["seen"] = {
		["loot"] = {
			["N7361@1"] = {
				["k"] = 2,
				["n"] = "Grubbis",
				["z"] = "Gnomeregan \\"Norte\\"",
				["i"] = {
					[1234] = 2,
					[5678] = 1,
				},
			},
		},
		["vendors"] = {},
		["quests"] = {
			[2926] = {
				["c"] = {
					11, -- [1]
					12, -- [2]
				},
				["xp"] = -5e1,
			},
		},
	},
	["flag"] = true,
}
`;

describe("parseLuaTable", () => {
  const db = parseLuaTable(SAMPLE);
  it("lee cadenas, números, booleanos y tablas anidadas", () => {
    assert.equal(db.list, "1.60.1.70862:9469:691146926");
    assert.equal(db.idx, 9654);
    assert.equal(db.angle, 201.5);
    assert.equal(db.flag, true);
    assert.equal(db.seen.loot["N7361@1"].n, "Grubbis");
    assert.equal(db.seen.loot["N7361@1"].z, 'Gnomeregan "Norte"');
  });
  it("las claves numéricas y las listas con comentarios salen bien", () => {
    assert.deepEqual(db.seen.loot["N7361@1"].i, { 1234: 2, 5678: 1 });
    assert.deepEqual(db.seen.quests[2926].c, { 1: 11, 2: 12 });
    assert.equal(db.seen.quests[2926].xp, -50);
    assert.deepEqual(db.seen.vendors, {});
  });
});
