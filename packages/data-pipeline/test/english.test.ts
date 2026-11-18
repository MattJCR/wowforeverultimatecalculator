import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hideUnresolved, sameNumbers } from "../src/english-official.js";
import { Abilities, ClassTalents, EnglishText, Items, Races, Unassigned } from "../src/model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = join(root, "data", "forever", "1.60.1.70959");
const ready = existsSync(join(DATA, "i18n", "en.json")) && existsSync(join(DATA, "classes", "mage.json"));
const TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];

describe.skipIf(!ready)("textos en inglés (del juego, contrastados con las cifras del cliente)", () => {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(DATA, f), "utf8")) as T;
  const en = EnglishText.parse(read("i18n/en.json"));
  const mage = ClassTalents.parse(read("classes/mage.json"));
  const races = Races.parse(read("races.json"));
  const classes = TOKENS.map((t) => ClassTalents.parse(read(`classes/${t}.json`)));
  const abilities = TOKENS.map((t) => Abilities.parse(read(`abilities/${t}.json`)));

  it("lleva la procedencia de la comunidad", () => {
    expect(en.provenance).toBe("community");
  });

  it("nombra las 9 clases y sus árboles en inglés", () => {
    expect(Object.keys(en.classes)).toHaveLength(9);
    expect(en.classes.MAGE ?? en.classes.Mage).toBeDefined();
    const m = (en.classes.MAGE ?? en.classes.Mage)!;
    expect(m.name).toBe("Mage");
    expect(m.specs).toEqual(["Arcane", "Fire", "Frost"]);
    expect(en.legacyTrees).toHaveLength(3);
  });

  it("todos los talentos de clase y las ventajas de Legacy tienen nombre y un texto por rango", () => {
    for (const t of mage.specs.flatMap((s) => s.talents)) {
      const e = en.talents[t.nodeId];
      expect(e, `${t.name} (${t.nodeId})`).toBeDefined();
      expect(e!.name).not.toBe("");
      expect(e!.descriptions.length).toBeGreaterThanOrEqual(t.maxRank);
    }
    const legacy = ClassTalents.parse(read("legacy.json"));
    for (const t of legacy.specs.flatMap((s) => s.talents)) expect(en.talents[t.nodeId], t.name ?? String(t.nodeId)).toBeDefined();
  });

  it("los talentos de las 9 clases tienen un texto inglés por rango con las mismas cifras que el del cliente", () => {
    const bad: string[] = [];
    for (const c of classes) {
      for (const t of c.specs.flatMap((s) => s.talents)) {
        const e = en.talents[t.nodeId];
        if (!e || e.descriptions.length < t.descriptions.length) bad.push(`${t.name} (${t.nodeId}): sin inglés`);
        else t.descriptions.forEach((es, i) => !sameNumbers(hideUnresolved(es), e.descriptions[i]!) && bad.push(`${t.name} (${t.nodeId}) rango ${i + 1}`));
      }
    }
    expect(bad).toEqual([]);
  });

  it("los nodos no activos tienen nombre y texto inglés (cuando el cliente trae hechizo)", () => {
    for (const c of classes) {
      for (const t of c.inactiveTalents) {
        const e = en.talents[t.nodeId];
        expect(e?.name, `${t.name} (${t.nodeId})`).toBeTruthy();
        expect(e!.descriptions.length, `${t.name} (${t.nodeId})`).toBe(t.descriptions.length);
      }
    }
  });

  it("todos los rangos de habilidad de las 9 clases tienen nombre inglés y un texto con las cifras del español", () => {
    const missing: string[] = [];
    const differ: string[] = [];
    for (const file of abilities) {
      for (const a of file.abilities) {
        for (const r of a.ranks) {
          const e = en.spells[r.spellId];
          if (!e?.name) {
            missing.push(`${a.name} (${r.spellId})`);
            continue;
          }
          const text = e.description ?? "";
          if (r.description && !text) missing.push(`${a.name} (${r.spellId}): sin texto`);
          else if (r.description && !sameNumbers(hideUnresolved(r.description), text)) differ.push(`${a.name} (${r.spellId})`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(differ).toEqual([]);
  });

  it("cada racial se empareja con la suya por nombre (el orden de las listas de la comunidad no coincide con el del cliente)", () => {
    for (const r of races.races) {
      const e = en.races[r.id];
      expect(e, r.name).toBeDefined();
      expect(e!.racials).toHaveLength(r.racials.length);
      expect(e!.racials.every((x) => x.name !== "")).toBe(true);
    }
    const human = races.races.find((r) => r.id === 1)!;
    expect(human.racials.map((a) => en.races[1]!.racials[a.order]!.name)).toEqual(["Will to Survive", "Perception", "Ruthless", "The Human Spirit"]);
  });

  it("las raciales usan el inglés oficial del cliente (nombre del hechizo y texto de la tabla), con las cifras del español", () => {
    const enus = join(root, "data", "external", "enus", "ChrRaceRacialAbility.csv");
    if (!existsSync(enus)) return; // las tablas inglesas no se versionan
    const lines = readFileSync(enus, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
    expect(lines).toHaveLength(40);
    expect(en.races[7]!.racials[2]!.description).toBe("Maximum Mana, Rage, or Energy increased by 5%");
    // las dos que la tabla da con otra duración se leen del hechizo (70707: 15 s con línea Ley / 30 s con convergencia elemental, y «Attuned» / «Charged» 1 h)
    expect(en.races[95]!.racials[1]!.description).toMatch(/for 15 sec. If a leyline is nearby, you will become Attuned for the next 1 hr/);
    expect(en.races[96]!.racials[1]!.description).toMatch(/for 30 sec. If an elemental convergence is nearby, you will become Charged for the next 1 hr/);
  });

  it("los objetos visibles en la web tienen nombre inglés", () => {
    if (!existsSync(join(DATA, "items.json"))) return;
    const items = Items.parse(read("items.json"));
    const unavailable = new Set(items.unavailable.map((u) => u.id));
    const missing = items.items.filter((i) => !i.placeholder && !unavailable.has(i.id) && !en.items[i.id]).map((i) => `${i.id} ${i.name}`);
    // 11/11 (70888): la caché enUS (leída con el juego en inglés) ya trae el nombre de todos los objetos visibles; antes quedaban 24 pendientes (lista vaciada)
    // 11/11 (segunda lectura del 70888): 27 objetos que el servidor devolvió después de la caché inglesa de las 07:16 (3 en la segunda lectura, 24 tras el escaneo a 10/s); se vacía al volver a jugar en inglés y repetir la lectura
    // 16/11 (70938): 66 objetos nuevos del parche con nombre solo en español (la caché inglesa sigue siendo la del 11/11, build 70888) más los 27 anteriores; se vacía al entrar al juego en inglés y repetir la lectura
    // 17/11 (70938, tercera lectura): 81 objetos más (conjuntos de nivel 1 de las 9 clases y otros) con nombre solo en español; la caché inglesa sigue siendo la del 11/11
    // 18/11 (70959): 5 objetos nuevos (22315, 22343, 22398, 22472 y 219343) con nombre solo en español; la caché inglesa sigue siendo la del 11/11
    expect(missing).toEqual(["862 Anillo con runas","9484 Leotardos de choque de hechizo","12059 Medallón de conquistador","12532 Aguja del Tallapiedras","12547 Mandilete de Mar Alom","12589 Fajín pluma de polvo","12590 Artillero vil","12592 Hoja negra de Shahram","12609 Pañuelo de visión policromática","12895 Peto del Vuelo cromático","12903 Musleras del desafiante cromático","12929 Talismán Furia de ascuas","12945 Musleras del Desafiante cromático","12963 Leotardos de maestro del acero","13098 Sortija tejedaño","13260 Botas de Bailavientos","13502 Faja artesanal de maestro herrero","13505 Hojarruna del Barón Osahendido","13954 Escarpines Verdantis","14536 Camisote con huesos","14555 Navaja solar de Alcor","14557 El cuerno de león de Ventormenta","14558 Colgante de Lady Maye","14576 Empuñadura de ébano de Marduk","14577 Pantalones Humo de calavera","15853 Segadora de viento","15854 Plata de danza","17061 Sombra de Juno","18047 Botos de llamas","18048 Martillo de maestro forjador","18104 Faja Ola feral","18344 Guanteletes Corteza de piedra","18348 Quel'Serrar","18425 Jarra de Kreeg","18466 Lacre real de Eldre'Thalas","18469 Lacre real de Eldre'Thalas","18674 Sortija de piedra endurecida","18676 Fajín del Asaltavientos","18677 Capa Céfiro","18691 Colgante de consejero oscuro","18692 Escarpes de caballero de la Muerte","18697 Zapatillas piedrafría","18701 Sortija de estimulación","18736 Leotardos de can de la Peste","18741 Brazal de Morlune","18754 Brazales endurecidos de inferi","18755 Palo de fuego xorotiano","18756 Protector del Guardia del Terror","18757 Manto diabólico","18758 Espada de espectro","18759 Hacha maliciosa","18761 Toque de olvido","22267 Turbante de tejechizos","22314 Arpón de cazador","22315 Martillo de Revitalización","22317 Nudillos de latón para zurdo","22318 Arco largo de Malgen","22319 Escrito sobre Derecho divino","22322 El rompe mandíbulas","22325 Cinturón del Timador","22326 Sortija de amalgama","22327 Amuleto de los redimidos","22328 Musleras de Vigilancia","22329 Cetro de Enfoque interminable","22330 Sudario de Maestría Arcana","22331 Sortija del Héroe férreo","22332 Hoja de Necromancia","22333 Martillo de Poderío divino","22334 Sortija de Reparación","22335 Bastón de orden de Lord Valthalak","22336 Égida draconiana de la Legión","22337 Sudario de Dominación","22339 Sortija rúnica de brujería","22340 Colgante de Celeridad","22342 Leotardos de Tormento","22343 Manoplas de Ferocidad","22345 Tótem de las mareas","22398 Ídolo de Rejuvenecimiento","22401 Tratado sobre Esperanza","22472 Botas de ferocidad","217727 Resguardo de los muertos","219343 Capucha de afanador","226815 Muñequeras cuoroferal","226816 Cintura cuoroferal","226817 Sobrehombros cuoroferal","226818 Piernas cuoroferal","226819 Yelmo cuoroferal","226820 Guantes cuoroferal","226821 Botas cuoroferal","226822 Peto cuoroferal","226845 Muñequeras Mantoscuro","226846 Cintura Mantoscuro","226847 Sobrehombros Mantoscuro","226848 Grebas Mantoscuro","226849 Yelmo Mantoscuro","226850 Guantes Mantoscuro","226851 Botas Mantoscuro","226852 Peto Mantoscuro","226873 Muñequeras de heroísmo","226874 Cintura de heroísmo","226875 Sobrehombros de heroísmo","226876 pantalones de heroísmo","226877 Yelmo de heroísmo","226878 Guantes de heroísmo","226879 Botas de heroísmo","226880 Peto de heroísmo","226897 Muñequeras de maestro de bestias","226898 Cintura de maestro de bestias","226899 Sobrehombros de maestro de bestias","226900 pantalones de maestro de bestias","226901 Yelmo de maestro de bestias","226902 Guantes de maestro de bestias","226903 Botas de maestro de bestias","226904 Peto de maestro de bestias","226921 Muñequeras Brumamorta","226922 Cintura Brumamorta","226923 Sobrehombros Brumamorta","226924 pantalones Brumamorta","226925 Yelmo Brumamorta","226926 Guantes Brumamorta","226927 Botas Brumamorta","226928 Peto Brumamorta","226937 Muñequeras de hechicero","226938 Cintura de hechicero","226939 Sobrehombros de hechicero","226940 pantalones de hechicero","226941 Yelmo de hechicero","226942 Guantes de hechicero","226943 Botas de hechicero","226944 Peto de hechicero","226961 Muñequeras del virtuoso","226962 Cintura del virtuoso","226963 Sobrehombros del virtuoso","226964 pantalones del virtuoso","226965 Yelmo del virtuoso","226966 Guantes del virtuoso","226967 Botas del virtuoso","226968 Peto del virtuoso","226993 Muñequeras Forjaalma","226994 Cintura Forjaalma","226995 Sobrehombros Forjaalma","226996 pantalones Forjaalma","226997 Yelmo Forjaalma","226998 Guantes Forjaalma","226999 Botas Forjaalma","227000 Peto Forjaalma","227033 Muñequeras de los Cinco Truenos","227034 Cintura de los Cinco Truenos","227035 Sobrehombros de los Cinco Truenos","227036 pantalones de los Cinco Truenos","227037 Yelmo de los Cinco Truenos","227038 Guantes de los Cinco Truenos","227039 Botas de los Cinco Truenos","227040 Peto de los Cinco Truenos","270126 Colgante de conquistador","276069 Mazo de tañido sepultural","276072 Mantón de tejido de alma","276073 Sortija de los condenados","276632 Filo del ingenio","281599 Colores desgastados","282027 Escamas del Devorador","282700 Arrancabelleras de las Sombras","284270 Mirada de gigante antiguo","286590 Fajín de reina silítida","286613 Diente del rey Mosh","286641 Cuchilla del Caníbal","286645 Lanza de Atal'ai reforjada","287028 Puños atormentados","287038 Escarpines de naturopatía","287039 Puños ajados de explorador","287043 Sortija predatoria","287044 Sudario de depredador","287045 Azadón antiguo","287046 Atizador del pilón"]);
  });

  it("los efectos de objetos y los bonus de conjunto tienen nombre y texto en inglés, y los conjuntos su nombre", () => {
    if (!existsSync(join(DATA, "items.json"))) return;
    const items = Items.parse(read("items.json"));
    const bad: string[] = [];
    const effects = [...items.items.flatMap((i) => i.effects.map((e) => ({ ...e, what: `objeto ${i.id}` }))), ...items.sets.flatMap((s) => s.bonuses.map((b) => ({ ...b, what: `conjunto ${s.id}` })))];
    for (const e of effects) {
      if (!e.name && !e.text) continue; // el cliente no trae nada que traducir
      const x = en.spells[e.spellId];
      if (!x?.name && !x?.description) bad.push(`${e.what} hechizo ${e.spellId} ${e.name}`);
      else if (e.text && !x.description) bad.push(`${e.what} hechizo ${e.spellId} ${e.name}: sin texto`);
    }
    for (const s of items.sets) if (!en.itemSets[s.id]) bad.push(`conjunto ${s.id} ${s.name}`);
    expect(bad).toEqual([]);
  });

  it("los datos sin asignar tienen inglés (salvo los huecos que ni el cliente nombra)", () => {
    const un = Unassigned.parse(read("unassigned.json"));
    const bad: string[] = [];
    for (const e of un.orphanEntries) {
      if (!e.name) continue;
      const x = en.entries[e.entryId];
      if (!x?.name || x.descriptions.length !== e.descriptions.length) bad.push(`entrada ${e.entryId} ${e.name}`);
    }
    for (const t of un.alternativeTrees) {
      for (const n of t.nodes) {
        if (!n.name) continue;
        const x = en.talents[n.nodeId];
        if (!x?.name || x.descriptions.length !== n.descriptions.length) bad.push(`árbol ${t.traitTreeId} nodo ${n.nodeId} ${n.name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("las traducciones propias están marcadas y no quedan textos pendientes de traducir", () => {
    const report = JSON.parse(readFileSync(join(root, "data", "i18n", "en-verification.json"), "utf8")) as { pending: unknown[]; ownMismatches: unknown[] };
    expect(report.pending).toEqual([]);
    expect(report.ownMismatches).toEqual([]);
    expect(en.ownTranslation.length).toBeGreaterThan(0);
  });
});
