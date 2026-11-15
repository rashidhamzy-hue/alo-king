// B1b: the four classes read from a conversation's turns (evals/sim/b1b-measures.ts).
import { describe, expect, it } from "vitest";
import { b1bMeasures, b1bSection } from "../b1b-measures";
import type { ConversationResult } from "../run";

const turn = (kind: string, replies: { kind?: string; text?: string; options?: { id: string; title: string }[] }[], extra: Record<string, unknown> = {}) =>
  ({ action: { kind }, replies: replies.map((r) => ({ kind: r.kind ?? "text", text: r.text ?? "", options: r.options ?? [] })), failures: [], path: null, ...extra });
const conv = (turns: unknown[], extra: Record<string, unknown> = {}) => ({ id: "sim-001", category: "plain_order", turns, failures: [], ...extra }) as unknown as ConversationResult;

describe("B1b measures", () => {
  it("the pin asked again after the address in words, not after a pin or an item", () => {
    const said = (text: string, replies: any[]) => ({ ...turn("text", replies), action: { kind: "text", text } });
    expect(b1bMeasures(conv([turn("text", [{ kind: "location_request" }]), said("ما فيني ابعت لوكيشن. بعقلين، البناية البيضا، الطابق التاني", [{ kind: "location_request" }])])).address).toBe(true);
    expect(b1bMeasures(conv([turn("text", [{ kind: "location_request" }]), said("زيدلي ربطة خبز", [{ kind: "location_request" }])])).address).toBe(false);
    expect(b1bMeasures(conv([turn("text", [{ kind: "location_request" }]), turn("pin", [{ kind: "location_request" }])])).address).toBe(false);
  });
  it("the language check: Arabizi with digits inside words, and product names on an Arabic card, are not another language", () => {
    const az = conv([turn("text", [{ text: "Ma l2it paracetamol bel catalog 7aliyan. Bade ta3refne ism el dawa?" }])], { lang: "arabizi" });
    expect(b1bMeasures(az).language).toBe(false);
    const card = conv([turn("text", [{ text: "🛒 *طلبك AK-1017*\n\n3 × Dolsi Vegas With Caramel Filling\n$3.00\n1 × Deroni Italian Rice 900G\n$1.20\n📍 عين قني" }])], { lang: "ar" });
    expect(b1bMeasures(card).language).toBe(false);
    const en = conv([turn("text", [{ text: "Sorry, we can't deliver there yet. What would you like to order?" }])], { lang: "arabizi" });
    expect(b1bMeasures(en).language).toBe(true);
  });
  it("the village buttons after a pin, and «a first order needs a pin»", () => {
    const ask = { kind: "buttons", options: [{ id: "pinvillage:x", title: "عترين" }, { id: "pinvillage:y", title: "عينبال" }] };
    expect(b1bMeasures(conv([turn("pin", [ask])])).address).toBe(false);                              // asked once, nothing said: allowed
    expect(b1bMeasures(conv([{ ...turn("text", [{ text: "ok" }]), action: { kind: "text", text: "بدي اطلب لعترين" } }, turn("pin", [ask])])).address).toBe(true);
    expect(b1bMeasures(conv([turn("pin", [ask]), turn("pin", [ask])])).address).toBe(true);
    expect(b1bMeasures(conv([turn("text", [{ text: "For a first order we need your location" }])])).address).toBe(true);
  });
  it("language and message rules from the code checks; the off-topic line outside its scenarios", () => {
    const r = conv([turn("text", [{ text: "أنا هون بس لطلبات ألو كينغ" }], { path: "off_topic" })], { lang: "en", failures: [{ code: "message_rules", detail: "" }] });
    expect(b1bMeasures(r)).toEqual({ address: false, language: true, messageRules: true, offTopic: true });
    expect(b1bMeasures({ ...r, category: "off_topic" } as ConversationResult).offTopic).toBe(false);
    expect(b1bSection([r]).join("\n")).toContain("| message rules (fix 7) | 1 (100.0%) | 246 of 463");
  });
});
