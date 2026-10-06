import { describe, expect, it } from "vitest";
import { matchVillage } from "./village.ts";

const V = ["Baakleen", "Beit ed-Dine", "Deir el Qamar", "Khreibeh", "Mukhtara", "Barouk", "Ain Zhalta", "Maasser el Shouf", "Damour", "Chhim", "Kfarhim", "Niha"];

describe("matchVillage: a typed village is a place, not a dish", () => {
  it("the owner's cases: Arabic and Latin spellings of Khreibeh", () => {
    expect(matchVillage("خريبة", V)).toBe("Khreibeh");
    expect(matchVillage("Khriebeh", V)).toBe("Khreibeh");
    expect(matchVillage("الخريبة", V)).toBe("Khreibeh");
    expect(matchVillage("khraibe", V)).toBeNull(); // a 3-consonant skeleton is too collision-prone: exact spelling only
  });
  it("other villages in three scripts", () => {
    expect(matchVillage("باقلين", V)).toBe("Baakleen"); expect(matchVillage("Baaklin", V)).toBe("Baakleen");
    expect(matchVillage("بيت الدين", V)).toBe("Beit ed-Dine"); expect(matchVillage("beiteddine", V)).toBe("Beit ed-Dine");
    expect(matchVillage("دير القمر", V)).toBe("Deir el Qamar");
    expect(matchVillage("مختارة", V)).toBe("Mukhtara"); expect(matchVillage("Moukhtara", V)).toBe("Mukhtara");
    expect(matchVillage("الدامور", V)).toBeNull(); // three consonants: Arabic spelling needs a longer skeleton (documented limit)
  });
  it("filler words are allowed", () => { expect(matchVillage("in Baakleen", V)).toBe("Baakleen"); expect(matchVillage("أنا في خريبة", V)).toBe("Khreibeh"); expect(matchVillage("ana bi damour", V)).toBe("Damour"); expect(matchVillage("deliver to Niha", V)).toBe("Niha"); });
  it("dishes, orders and longer sentences are not villages", () => {
    for (const t of ["shawarma", "2 pizza", "burger please", "كنافة", "I want a sweet dessert in Baakleen with extra cheese", "بدي شاورما", "hi", "ok", "12", "Barouk 2"]) expect(matchVillage(t, V), t).toBeNull();
  });
  it("short skeletons collide with dishes: they match only by exact spelling", () => {
    for (const t of ["burek", "borek", "sham", "shaam", "naha", "qamar el din", "bruk", "baroque"]) expect(matchVillage(t, V), t).toBeNull();
    expect(matchVillage("Barouk", V)).toBe("Barouk"); expect(matchVillage("Niha", V)).toBe("Niha"); // the exact name still works
  });
  it("ambiguous skeletons are not guessed", () => expect(matchVillage("Khreibeh", ["Khreibeh", "Khraibeh"])).toBeNull());
  it("no ordinary dish or drink name in a typical menu is read as a village", () => {
    const dishes = ["shawarma", "falafel", "burek", "borek", "sfiha", "kibbeh", "kafta", "hummus", "labneh", "manoushe", "zaatar", "tabbouleh", "fattoush", "mjaddara", "knefe", "baklava", "ouzi", "sham", "shish tawook", "taouk", "farouj", "mashawi", "pizza", "burger", "pepsi", "juice", "kahwe", "jallab", "ayran", "mankousheh", "جبنة", "فتوش", "تبولة", "كبة", "صفيحة", "بوريك", "حمص", "لبنة", "فلافل", "شاورما", "عصير", "قهوة", "كنافة", "بقلاوة", "منقوشة", "مشاوي", "فروج"];
    for (const d of dishes) expect(matchVillage(d, V), d).toBeNull();
  });
  it("no villages known: nothing", () => expect(matchVillage("Baakleen", [])).toBeNull());
});
