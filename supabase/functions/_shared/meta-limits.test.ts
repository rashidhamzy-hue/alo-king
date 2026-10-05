import { describe, expect, it } from "vitest";
import { META, checkInteractive, clampInteractive } from "./meta-limits";

const btn = (titles: string[], body = "hi") => ({ type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: titles.map((t, k) => ({ type: "reply", reply: { id: `ID${k}`, title: t } })) } } });
const list = (rows: any[], extra: any = {}) => ({ type: "interactive", interactive: { type: "list", body: { text: "pick" }, action: { button: "Choose", sections: [{ title: "Menu", rows }] }, ...extra } });
const row = (k: number, o: any = {}) => ({ id: `R${k}`, title: `Row ${k}`, ...o });

describe("checkInteractive: the checker itself", () => {
  it("accepts a valid button message and a valid list", () => {
    expect(checkInteractive(btn(["Yes", "No", "More"]))).toEqual([]);
    expect(checkInteractive(list(Array.from({ length: 10 }, (_, k) => row(k))))).toEqual([]);
  });
  it("ignores text and template payloads", () => {
    expect(checkInteractive({ type: "text", text: { body: "x".repeat(5000) } })).toEqual([]);
    expect(checkInteractive({ type: "template", template: { name: "x" } })).toEqual([]);
  });
  it("fails more than 3 buttons", () => expect(checkInteractive(btn(["a", "b", "c", "d"])).join()).toMatch(/4 buttons/));
  it("fails a button title over 20 characters (and counts emoji as one)", () => {
    expect(checkInteractive(btn(["x".repeat(21)])).join()).toMatch(/button title/);
    expect(checkInteractive(btn(["x".repeat(20)]))).toEqual([]);
    expect(checkInteractive(btn(["✅ " + "x".repeat(18)]))).toEqual([]); // 20 characters with the emoji
  });
  it("fails more than 10 list rows, rows over 24 characters, descriptions over 72", () => {
    expect(checkInteractive(list(Array.from({ length: 11 }, (_, k) => row(k)))).join()).toMatch(/11 rows/);
    expect(checkInteractive(list([row(1, { title: "y".repeat(25) })])).join()).toMatch(/row title/);
    expect(checkInteractive(list([row(1, { title: "y".repeat(24) })]))).toEqual([]);
    expect(checkInteractive(list([row(1, { description: "d".repeat(73) })])).join()).toMatch(/description/);
  });
  it("fails a body over 1024 characters", () => {
    expect(checkInteractive(btn(["a"], "b".repeat(1025))).join()).toMatch(/body/);
    expect(checkInteractive(btn(["a"], "b".repeat(1024)))).toEqual([]);
  });
  it("also catches empty/duplicate titles, oversized ids, long headers/footers/list buttons", () => {
    expect(checkInteractive(btn(["a", "a"])).join()).toMatch(/duplicate button title/);
    expect(checkInteractive(btn([""])).join()).toMatch(/empty button title/);
    expect(checkInteractive(list([row(1), row(1)])).join()).toMatch(/duplicate row id/);
    expect(checkInteractive(list([row(1)], { header: { type: "text", text: "h".repeat(61) } })).join()).toMatch(/header/);
    const longBtn = list([row(1)]); (longBtn.interactive as any).action.button = "z".repeat(21);
    expect(checkInteractive(longBtn).join()).toMatch(/list button/);
  });
  it("limits are the documented numbers", () => {
    expect([META.maxButtons, META.buttonTitle, META.listRows, META.rowTitle, META.body]).toEqual([3, 20, 10, 24, 1024]);
  });
});

describe("clampInteractive: whatever a builder produces, what is sent passes the checker", () => {
  it("fixes every kind of overflow", () => {
    const bad = btn(["x".repeat(40), "y", "z", "w"], "b".repeat(3000));
    expect(checkInteractive(bad).length).toBeGreaterThan(0);
    expect(checkInteractive(clampInteractive(bad))).toEqual([]);
    const badList: any = list(Array.from({ length: 25 }, (_, k) => row(k, { title: "t".repeat(60), description: "d".repeat(200) })), { header: { type: "text", text: "h".repeat(200) }, footer: { text: "f".repeat(200) } });
    badList.interactive.action.button = "b".repeat(50); badList.interactive.action.sections[0].title = "s".repeat(50);
    expect(checkInteractive(badList).length).toBeGreaterThan(0);
    expect(checkInteractive(clampInteractive(badList))).toEqual([]);
  });
  it("leaves valid payloads and non-interactive payloads untouched", () => {
    const ok = btn(["Yes", "No"]);
    expect(clampInteractive(ok)).toEqual(ok);
    const txt = { type: "text", text: { body: "x".repeat(3000) } };
    expect(clampInteractive(txt)).toBe(txt);
  });
  it("does not mutate its input and keeps emoji intact", () => {
    const p = btn(["✅ " + "x".repeat(30)]);
    const before = JSON.stringify(p);
    const out: any = clampInteractive(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(out.interactive.action.buttons[0].reply.title.startsWith("✅ ")).toBe(true);
  });
});
