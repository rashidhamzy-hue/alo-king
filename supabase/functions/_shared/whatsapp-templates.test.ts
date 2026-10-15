import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  TEMPLATES,
  TEMPLATE_LANGS,
  checkTemplate,
  metaTemplateCreate,
  renderTemplate,
  templateByKey,
  templateLang,
  templateMessage,
  templateParam,
} from "./whatsapp-templates";

const def = (name: string) => TEMPLATES.find((t) => t.name === name)!;

describe("the template registry (DECISIONS §39.8)", () => {
  it("every template passes Meta's rules in Arabic, English and French", () => {
    for (const t of TEMPLATES) expect(checkTemplate(t), t.name).toEqual([]);
  });
  it("covers every message the session must carry outside the window", () => {
    for (const key of [
      "accepted", // order confirmed + ETA
      "on_the_way", // on the way + tracking
      "delivered", // delivered + rate
      "new_order", // merchant new order
      "claim_code",
      "payment_link",
      "gift_accepted", // Send Home receipt
      "gift_request",
      "proposal", // copilot suggestion after the 24-hour window
      "merchant_weekly",
      "support_reply",
    ])
      expect(templateByKey(key), key).not.toBeNull();
    expect(
      TEMPLATES.filter((t) => t.category === "MARKETING")
        .map((t) => t.key)
        .sort(),
    ).toEqual(["marketing_new_shop", "marketing_offer"]);
  });
  it("names and keys are unique", () => {
    expect(new Set(TEMPLATES.map((t) => t.name)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length);
  });
  it("the database map names exactly the registry (config whatsapp_template_map)", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n");
    const m = /\('whatsapp_template_map', '(\{[\s\S]*?\})', now\(\)/.exec(sql);
    expect(m).not.toBeNull();
    const map = JSON.parse(m![1]) as Record<string, string>;
    // Later migrations add keys on top of the current map.
    for (const x of sql.matchAll(/config_value\('whatsapp_template_map'\) \|\| '(\{[^']*\})'/g))
      Object.assign(map, JSON.parse(x[1]));
    expect(map).toEqual(Object.fromEntries(TEMPLATES.map((t) => [t.key, t.name])));
  });
});

describe("the checker catches what Meta refuses", () => {
  const base = def("alo_order_on_the_way");
  const bad = (patch: any) => checkTemplate({ ...base, ...patch }).join("\n");
  it("a variable at the start or end, side by side, or out of order", () => {
    expect(bad({ body: { ...base.body, en: "{{1}} is on the way in {{2}} for you" } })).toMatch(
      /starts with/,
    );
    expect(
      bad({ body: { ...base.body, en: "Your order is on the way, about {{1}} {{2}}" } }),
    ).toMatch(/ends with/);
    expect(
      bad({ body: { ...base.body, en: "Your order #{{1}}{{2}} is on the way to you now." } }),
    ).toMatch(/side by side/);
    expect(
      bad({ body: { ...base.body, en: "Your order #{{2}} is on the way in {{3}} to you now." } }),
    ).toMatch(/variables/);
  });
  it("too many variables for the text, a long button, a marketing template without STOP", () => {
    expect(bad({ body: { ...base.body, en: "Order {{1}} in {{2}} ok" } })).toMatch(/words/);
    expect(bad({ buttons: { ...base.buttons, en: ["x".repeat(26)] } })).toMatch(/button/);
    expect(checkTemplate({ ...def("alo_offer_nearby"), footer: undefined }).join()).toMatch(/STOP/);
  });
  it("emoji, a variable or a newline in a button (Meta error 2388060, refused on 15 October)", () => {
    for (const b of [
      "Great ⭐⭐⭐⭐⭐",
      "✅ Accept 15 min",
      "❌ Reject",
      "🇱🇧 Order",
      "1️⃣ One",
      "Track {{1}}",
      "Track\nmy order",
    ])
      expect(bad({ buttons: { ...base.buttons, en: [b] } }), b).toMatch(
        /emoji, a variable or a newline/,
      );
    // Arabic letters and digits, apostrophes and accents are fine.
    for (const b of ["قبول ١٥ د", "Accept, I'll pay", "J'accepte, je paie", "Un problème"])
      expect(bad({ buttons: { ...base.buttons, en: [b] } }), b).toBe("");
  });
});

describe("the send payload", () => {
  it("fills the variables in order and sets each quick reply's payload", () => {
    const msg: any = templateMessage(
      "+96170000001",
      def("alo_order_delivered"),
      "fr",
      { code: "AB3CD9", vendor: "Vendor A" },
      ["rate:o:f5", "rate:o:f3", "rcv:o:no"],
    );
    expect(msg.to).toBe("96170000001");
    expect(msg.template.name).toBe("alo_order_delivered");
    expect(msg.template.language).toEqual({ code: "fr" });
    expect(msg.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "AB3CD9",
      "Vendor A",
    ]);
    expect(msg.template.components.slice(1).map((b: any) => b.parameters[0].payload)).toEqual([
      "rate:o:f5",
      "rate:o:f3",
      "rcv:o:no",
    ]);
  });
  it("refuses a missing variable or a missing payload instead of sending a hole", () => {
    expect(() =>
      templateMessage("+1", def("alo_order_on_the_way"), "en", { code: "X" }, ["c:track"]),
    ).toThrow(/eta/);
    expect(() =>
      templateMessage("+1", def("alo_order_on_the_way"), "en", { code: "X", eta: "5" }, []),
    ).toThrow(/payloads/);
  });
  it("cleans a value to one line (Meta refuses new lines and long runs of spaces in a variable)", () => {
    expect(templateParam("a\nb\t\tc     d")).toBe("a b c d");
    expect(templateParam("")).toBe("-");
    expect([...templateParam("x".repeat(500))].length).toBe(300);
  });
  it("the claim code uses Meta's one-tap copy-code format", () => {
    const msg: any = templateMessage("+96171000001", def("alo_claim_code"), "ar", {
      code: "482913",
    });
    expect(msg.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "482913" }],
      },
    ]);
  });
  it("Arabizi and unknown languages read the Arabic template", () => {
    expect(templateLang("arabizi")).toBe("ar");
    expect(templateLang(undefined)).toBe("ar");
    expect(templateLang("fr")).toBe("fr");
  });
  it("renders the text a person reads (dry runs and transcripts)", () => {
    expect(
      renderTemplate(def("alo_order_on_the_way"), "en", { code: "AB3CD9", eta: "10-15 min" }),
    ).toBe(
      "Your order #AB3CD9 is on the way and should arrive in about 10-15 min. Tap below to track it or to reach us.",
    );
  });
});

describe("what is submitted to Meta", () => {
  it("a utility template has its body examples, footer and quick replies", () => {
    const c: any = metaTemplateCreate(def("alo_order_confirmed"), "ar");
    expect(c.category).toBe("UTILITY");
    expect(c.language).toBe("ar");
    expect(c.components[0].example.body_text[0]).toHaveLength(4);
    expect(c.components[2].buttons.every((b: any) => b.type === "QUICK_REPLY")).toBe(true);
  });
  it("every template in every language builds", () => {
    for (const t of TEMPLATES)
      for (const l of TEMPLATE_LANGS) expect(metaTemplateCreate(t, l).name).toBe(t.name);
  });
});
