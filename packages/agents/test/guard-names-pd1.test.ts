// PD1 (e): the narrowed safety check (evals/cases/pd1_names_and_echoes.json). Invariants 14, 15 and 16 are unchanged: a stated fact
// still needs an approved record returned this turn, now for that product, and is said with its source.
import { describe, expect, it } from "vitest";
import { checkModelText } from "@ak/agents/output-guard";
import data from "../../../evals/cases/pd1_names_and_echoes.json";

type Case = { id: string; text: string; products?: { id: string; names: string[] }[]; customer?: string; approved?: Record<string, string[]>; expect: string | null };

describe("PD1: names and echoes are not claims; facts need a record for that product", () => {
  it.each((data.cases as Case[]).map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const v = checkModelText(c.text, {
      products: c.products ?? [],
      customerWords: c.customer ?? "",
      approvedByProduct: new Map(Object.entries(c.approved ?? {}).map(([k, v]) => [k, new Set(v)])),
    });
    expect(v?.code ?? null).toBe(c.expect);
  });
});

describe("PD1 (g): no catalogue offer while settings.catalog has no catalogue", () => {
  it.each(data.catalogue.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const v = checkModelText(c.text, "ready" in c ? { catalogueReady: (c as { ready: boolean }).ready } : {});
    expect(v?.code ?? null).toBe(c.expect);
  });
});

describe("PD1: callers that pass nothing new keep today's check", () => {
  it("the attribute-group unlock of 1.10 still holds for the evals' wording cases", () => {
    expect(checkModelText("It has 12 g of protein per 100 g.", { approvedFacts: new Set(["nutrition"]) })).toBeNull();
    expect(checkModelText("It has 12 g of protein per 100 g.")?.code).toBe("unapproved_food_claim");
  });
  it("a per-product record turns the attribute-group unlock off: the concierge passes records per product only", () => {
    expect(checkModelText("It has 12 g of protein per 100 g.", { approvedByProduct: new Map([["p1", new Set(["nutrition"])]]) })?.code)
      .toBe("unapproved_food_claim");
  });
});

import { preflight } from "@ak/wa/gateway";
import { makeConciergeTools, type ToolContext } from "@ak/agents/concierge-tools";

describe("PD1: the gateway's second check gets the same tool results", () => {
  const req = (body: string, authored: Record<string, unknown>) => ({ line: "customer" as const, partyId: "x", to: "x", category: "service" as const,
    dedupeKey: "k:1:1", msg: { type: "text" as const, text: { body } }, authored: { by: "model" as const, ...authored } });
  it("a returned name passes; without it the same words are refused", () => {
    const products = [{ id: "p1", names: ["Balance Protein Crackers Sour Cream & Onion 70G"] }];
    expect(preflight(req("We have Balance Protein Crackers.", { products, approvedByProduct: {} }))).toBeNull();
    expect(preflight(req("We have Balance Protein Crackers.", { approvedByProduct: {} }))).toBe("model_text_unapproved_food_claim");
  });
  it("the catalogue is not offered while it is not connected", () => {
    expect(preflight(req("Shall I show you the catalogue?", { catalogueReady: false }))).toBe("model_text_catalogue_claim");
  });
});

describe("PD1: the Concierge's tools record names and records per product", () => {
  function fakeCtx(facts: Record<string, unknown[]>) {
    const sent: { body: string; authored: unknown }[] = [];
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "search_catalog") return { data: { reason: null, matches: [
          { product_id: "p1", name_en: "Balance Protein Crackers Sour Cream & Onion 70G", name_ar: null, available: 3, price_usd: 0.69 },
          { product_id: "p5", name_en: "Y Biscuits 40G", name_ar: null, available: 3, price_usd: 0.5 }] }, error: null };
        if (fn === "product_facts_for_chat") return { data: { applies: true, level: facts[String(args.p_product)] ? "fact_complete" : "sellable",
          facts: facts[String(args.p_product)] ?? [], claims: [], note: "" }, error: null };
        return { data: null, error: null };
      },
      from: () => ({ insert: async () => ({ error: null }) }),
    };
    const ctx = { db, partyId: "c", conversationId: "v", state: {}, sent: { count: 0, texts: [] }, catalogueReady: false,
      send: async (msg: { text?: { body: string } }, opts?: { authored?: unknown }) => { sent.push({ body: msg.text?.body ?? "", authored: opts?.authored }); return { ok: true, wamid: "w" }; },
    } as unknown as ToolContext;
    return { ctx, sent, tools: makeConciergeTools(ctx) };
  }
  const nutrition = [{ attribute: "nutrition", kind: "nutrition", value: null, status: "declared", source: "label", expired: false }];

  it("a name the search returned may be written; the gateway is told the names", async () => {
    const { tools, sent } = fakeCtx({});
    await tools.search_catalog({ query: "protein" });
    expect(await tools.reply({ text: "We have Balance Protein Crackers." })).toEqual({ ok: true });
    expect((sent[0]!.authored as { products: { id: string }[] }).products.map((p) => p.id)).toContain("p1");
  });
  it("a record for one product unlocks that product only, with its source", async () => {
    const { tools } = fakeCtx({ p5: nutrition });
    await tools.search_catalog({ query: "biscuits" });
    await tools.food_facts({ product_ids: ["p1", "p5"] });
    expect(await tools.reply({ text: "The pack of Y Biscuits says no added sugar." })).toEqual({ ok: true });
    expect(await tools.reply({ text: "The pack of Balance Protein Crackers says no added sugar." })).toMatchObject({ ok: false, error: "refused:unapproved_food_claim" });
  });
  it("no catalogue button while the catalogue is not connected", async () => {
    const { tools } = fakeCtx({});
    expect(await tools.reply({ text: "Tell me what you need.", buttons: [{ id: "c", title: "Catalogue" }] })).toMatchObject({ ok: false, error: "refused:catalogue_claim" });
  });
});
