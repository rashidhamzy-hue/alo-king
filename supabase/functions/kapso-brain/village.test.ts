import { describe, expect, it } from "vitest";
import { matchVillage } from "./village.ts";

const V = ["Baakleen", "Beit ed-Dine", "Deir el Qamar", "Khreibeh", "Mukhtara", "Barouk", "Ain Zhalta", "Maasser el Shouf", "Damour", "Chhim", "Kfarhim", "Niha"];

describe("matchVillage: a typed village is a place, not a dish", () => {
  it("the owner's cases: Arabic and Latin spellings of Khreibeh", () => {
    expect(matchVillage("خريبة", V)).toBe("Khreibeh");
    expect(matchVillage("Khriebeh", V)).toBe("Khreibeh");
    expect(matchVillage("الخريبة", V)).toBe("Khreibeh");
    expect(matchVillage("khraibe", V)).toBe("Khreibeh");
  });
  it("other villages in three scripts", () => {
    expect(matchVillage("باقلين", V)).toBe("Baakleen"); expect(matchVillage("Baaklin", V)).toBe("Baakleen");
    expect(matchVillage("بيت الدين", V)).toBe("Beit ed-Dine"); expect(matchVillage("beiteddine", V)).toBe("Beit ed-Dine");
    expect(matchVillage("دير القمر", V)).toBe("Deir el Qamar");
    expect(matchVillage("مختارة", V)).toBe("Mukhtara"); expect(matchVillage("Moukhtara", V)).toBe("Mukhtara");
    expect(matchVillage("الدامور", V)).toBe("Damour");
  });
  it("filler words are allowed", () => { expect(matchVillage("in Baakleen", V)).toBe("Baakleen"); expect(matchVillage("أنا في خريبة", V)).toBe("Khreibeh"); expect(matchVillage("ana bi damour", V)).toBe("Damour"); expect(matchVillage("deliver to Niha", V)).toBe("Niha"); });
  it("dishes, orders and longer sentences are not villages", () => {
    for (const t of ["shawarma", "2 pizza", "burger please", "كنافة", "I want a sweet dessert in Baakleen with extra cheese", "بدي شاورما", "hi", "ok", "12", "Barouk 2"]) expect(matchVillage(t, V), t).toBeNull();
  });
  it("ambiguous skeletons are not guessed; too-short skeletons never match", () => {
    expect(matchVillage("Niha", ["Niha", "Nehha"])).toBeNull();
    expect(matchVillage("ab", ["Ab"])).toBeNull();
  });
  it("no villages known: nothing", () => expect(matchVillage("Baakleen", [])).toBeNull());
});
