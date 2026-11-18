// CX2 stage 2 (approved by the founder, 18 November 2026; docs/MESSAGES.md): the behaviours the new layout brought, checked without a model.
import { describe, expect, it } from "vitest";
import { ar, en, fr, messages } from "@ak/agents/messages";
import { feedbackCard } from "@ak/agents/feedback";
import { listTitle } from "@ak/agents/choice";
import { statusText } from "@ak/agents/answers";

describe("CX2 stage 2", () => {
  it("the question after delivery is in the customer's language (it was Arabic for everyone: the founder's chat, 08:54)", () => {
    for (const m of [ar, en, fr]) {
      const card = feedbackCard("99999999-8888-4777-8666-555555555555", "AK-1062", m.lang) as any;
      expect(card.interactive.body.text).toBe(m.feedback.ask("AK-1062"));
      expect(card.interactive.action.buttons.map((b: any) => b.reply.title)).toEqual([m.feedback.fineButton, m.feedback.problemButton]);
    }
  });

  it("a list row's title fits WhatsApp's 24 characters and keeps the size (the picker was two buttons cut to «1. نسكافيه قهوة سريع»)", () => {
    const a = listTitle("نسكافيه قهوة سريعة التحضير 3 في 1 كلاسيك 20 غ");
    const b = listTitle("نسكافيه قهوة سريعة التحضير غولد كيس 100 غ");
    for (const t of [a, b]) expect(t.length).toBeLessThanOrEqual(24);
    expect(a).toMatch(/20 غ$/); expect(b).toMatch(/100 غ$/);
    expect(a).not.toBe(b);
    expect(listTitle("Coffee Mate 450 g")).toBe("Coffee Mate 450 g");
  });

  it("a status answer and the notice for the same state say the same words (the founder's change 3)", () => {
    for (const m of [ar, en, fr]) {
      const st = (status: string) => statusText({ short_code: "AK-1062", status, total_usd: 13.13, payment_method: "card" as any, is_pickup: false, eta_remaining_minutes: null }, m.lang);
      expect(st("out_for_delivery")).toBe(m.notice.onTheWay("AK-1062"));
      expect(st("arrived")).toBe(m.notice.riderAtDoor("AK-1062"));
      expect(m.notice.riderWaiting("AK-1062")).toBe(m.notice.riderAtDoor("AK-1062"));
      expect(st("ready")).toBe(m.shelf.ready("AK-1062"));
      // cash on delivery: the amount the rider collects, on both
      const cod = statusText({ short_code: "AK-1062", status: "out_for_delivery", total_usd: 13.13, payment_method: "cod", is_pickup: false, eta_remaining_minutes: null }, m.lang);
      expect(cod).toBe(m.notice.onTheWay("AK-1062", 13.13));
      expect(cod).toContain("$13.13");
    }
  });

  it("«طازة» / Fresh comes before each product's own name (the founder's change 4)", () => {
    expect(ar.windows.freshForWindow(["كفتة 500 غ"])).toContain("• طازة كفتة 500 غ");
    expect(en.windows.freshForWindow(["Kafta 500 g"])).toContain("• Fresh Kafta 500 g");
  });

  it("the out-of-area answer names no village list, and 👑 is gone (the founder's change 2)", () => {
    for (const m of [ar, en, fr]) {
      expect(m.answer.outOfArea("Saida").split("\n")).toHaveLength(3);
      expect(m.answer.repeatOffer(["x"], 0)).not.toContain("👑");
      expect(m.cx.welcome("09:00", "21:00")).not.toContain("👑");
      expect(m.cx.welcome("09:00", "21:00")).toContain("09:00");
    }
    expect(messages("ar").cx.missingLine("ask")).toContain("منسألك قبل ما نبدّل");          // the founder's change 1
    expect(messages("en").cx.missingLine("ask")).toContain("We ask you before swapping anything");
  });
});
