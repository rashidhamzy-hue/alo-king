// What a food-fact proposal rests on, said in words a person can weigh (session D4; audit G1 points 1 and 4).
// A proposal from a web page or Open Food Facts is a second opinion: it is not printed on our pack, and a page for another market
// may describe another recipe. The words here come only from what the proposal itself recorded (its source, its basis, its market);
// nothing is inferred about the product. No hedging a person could mistake for a fact, and no praise: invariants 14 and 15.

export interface BasisFact {
  source: string; status?: string; approved_at?: string | null; detail?: Record<string, any> | null;
}

const LEBANON = /leban|لبنان/i;

/** "from a web page for the Gulf market", "inferred from the ingredient list on Open Food Facts, not printed on the pack", ... */
export function basisWords(f: BasisFact): string {
  const d = f.detail ?? {};
  const basis = String(d.basis ?? "");
  const field = String(d.source_field ?? "");
  switch (f.source) {
    case "open_food_facts": {
      const why =
        basis === "off_tag" ? "listed in Open Food Facts' allergen tags; nobody has checked it against the pack"
        : basis === "text_mapped_by_model" && field === "ingredients" ? "inferred from the ingredient list on Open Food Facts, not printed on the pack"
        : basis === "text_mapped_by_model" ? `read from Open Food Facts' own ${field === "traces" ? "“may contain” text" : "allergen text"}${d.quote ? ` (“${d.quote}”)` : ""}, not checked against the pack`
        : basis === "off_label_claim" ? "a claim Open Food Facts records from the label, not checked against our pack"
        : basis === "off_ingredient_analysis" ? "inferred by Open Food Facts from the ingredient list, not printed on the pack"
        : "as Open Food Facts lists it, not checked against the pack";
      return `Open Food Facts (second opinion): ${why}`;
    }
    case "web_page": {
      const market = typeof d.market === "string" && d.market.trim() ? d.market.trim() : null;
      const page = market ? `from a web page for the ${market} market` : "from a web page (the market is not stated)";
      const how = basis === "literal_quote_from_the_page" ? ", quoted from the page"
        : basis === "pack_claim_or_certificate_as_the_page_shows_it" ? ", a pack or certificate claim as the page shows it" : "";
      const note = !market || !LEBANON.test(market) ? "; not printed on our pack, and a recipe sold in another market may differ from the Lebanese one" : "; not checked against our pack";
      return `${page}${how}${note}`;
    }
    case "label":
      if (d.read_by === "model") return "read from the label photo by a model: a person has not checked it against the pack yet";
      return f.approved_at ? "from the pack label, checked by a person" : "typed from the pack label, waiting for the ops lead to approve it";
    case "supplier": return "from the supplier's specification sheet";
    case "certificate": return "from a certificate";
    case "lab": return "from a lab report";
    case "calculation": return "calculated from other approved facts";
    case "merchant": return "stated by the merchant";
    case "staff": return "entered by staff";
    default: return `from ${f.source}`;
  }
}

/** For an approved fact that was confirmed from a proposal: where the proposal came from, so the history is readable. */
export function confirmedFrom(f: BasisFact): string {
  const from = String(f.detail?.proposal_source ?? "");
  if (!f.detail?.confirmed_from) return "";
  return from === "web_page" ? "confirmed against the pack, from a web-page proposal"
    : from === "open_food_facts" ? "confirmed against the pack, from an Open Food Facts proposal"
    : from === "label" ? "confirmed against the pack, from the label reading" : "confirmed against the pack";
}

export const sourceName = (source: string) => (source === "open_food_facts" ? "Open Food Facts" : source === "web_page" ? "a web page" : source);
