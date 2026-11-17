// Product readiness (session D4): one row per active hub item from product_readiness() (0111): its name, picture, food facts, cost,
// search words, catalog placement and price, each ok or what is missing, with a link to the page that fixes it. The two filters
// answer different questions: "blocks the catalog" (the Meta feed leaves the item out) and "blocks ordering" (a customer cannot
// order it). No approved picture blocks the catalog, not ordering. Reads only; ops lead and admin.
import { html, render, type Ctx, type Section } from "../app";
import { usd } from "../html";
import { LEADS } from "../roles";

export type Ready = {
  product_id: string; sku: string; name_en: string; name_ar: string | null; brand: string | null;
  name: "approved" | "waiting" | "rejected" | "none"; picture: "approved" | "guide_only" | "waiting" | "none";
  facts: { approved: number; waiting: number; ingredients: boolean; allergens: number; allergens_of: number; ok: boolean };
  cost: boolean; search_words: "built" | "queued" | "failed" | "none"; placement: boolean; category: string | null;
  price: boolean; price_usd: number | string | null; available: boolean;
  blocks_catalog: string[]; blocks_ordering: string[]; missing: string[]; ready: boolean;
  // PD1 (0206): the two levels of the product data standard, and what each misses.
  level?: "not_sellable" | "sellable" | "fact_complete"; template?: string | null;
  missing_sellable?: string[]; missing_fact_complete?: string[];
  // SELL1 (0226): a pack to read? and has its label been read and approved? (loose produce, meat and bakery with no real barcode are not packaged)
  packaged?: boolean; label_ready?: boolean; missing_label?: string[];
};
type Summary = { sell_requires_label: boolean; packaged: number; label_ready: number;
  by_template: Record<string, { active: number; packaged: number; label_ready: number }> };
const SHOW = ["all", "not_sellable", "sellable", "fact_complete", "label", "catalog", "ordering", "missing", "ready"] as const;
const SHOW_WORDS: Record<(typeof SHOW)[number], string> = {
  all: "all items", not_sellable: "not sellable", sellable: "sellable, facts not confirmed", fact_complete: "fact-complete", label: "packaged, not label-ready",
  catalog: "blocks the catalog", ordering: "blocks ordering", missing: "something missing", ready: "ready",
};
const words = (keys: string[] | undefined) => (keys ?? []).map((k) => k.replace(/_/g, " ")).join(", ");
/** PD1: the item's level, with the fields it still misses for the next one. */
function levelCell(r: Ready) {
  if (r.level === "fact_complete") return ok("fact-complete");
  if (r.level === "sellable") return html`<span>sellable</span><br><small class="muted">for fact-complete: ${words(r.missing_fact_complete)}</small>`;
  return html`${bad("not sellable")}<br><small class="muted">needs: ${words(r.missing_sellable)}</small>`;
}

/** SELL1: loose, or packaged with its label read and approved, or what the label still has to give. */
function labelCell(r: Ready) {
  if (!r.packaged) return html`<span class="muted">loose</span>`;
  if (r.label_ready) return html`${ok("packaged, label-ready")}`;
  return html`<span class="warn">packaged, not label-ready</span><br><small class="muted">label missing: ${words(r.missing_label)}</small>`;
}

const ok = (label = "ok") => html`<span class="ok">${label}</span>`;
const bad = (label: string, href?: string) => (href ? html`<a class="warn" href="${href}">${label}</a>` : html`<span class="warn">${label}</span>`);

function cells(r: Ready) {
  const q = encodeURIComponent(r.sku);
  return {
    name: r.name === "approved" ? ok("approved") : r.name === "waiting" ? bad("waiting", `/names?q=${q}`) : r.name === "rejected" ? ok("kept as is") : html`<span class="muted">not reviewed</span>`,
    picture: r.picture === "approved" ? ok("approved") : r.picture === "guide_only" ? bad("guide only (licence unknown)", "/pictures?status=approved") : r.picture === "waiting" ? bad("waiting", "/pictures") : bad("none", "/intake"),
    facts: r.facts.ok ? ok(`all ${r.facts.allergens_of} allergens`) : bad(`${r.facts.ingredients ? "ingredients ok" : "no ingredients"}, allergens ${r.facts.allergens}/${r.facts.allergens_of}${r.facts.waiting ? `, ${r.facts.waiting} waiting` : ""}`, r.facts.waiting ? `/intake/${r.product_id}` : `/food-facts/${r.product_id}`),
    cost: r.cost ? ok("known") : bad("none", "/receiving"),
    words: r.search_words === "built" ? ok("built") : bad(r.search_words === "queued" ? "queued" : r.search_words === "failed" ? "failed" : "none", "/search-words"),
    placement: r.placement ? ok(r.category ?? "placed") : bad("not placed"),
    price: r.price ? ok(usd(r.price_usd)) : bad(r.price_usd === null ? "none" : "unavailable", `/catalog/${r.product_id}`),
  };
}

/** SELL1: the setting, and per template the packaged items that are label-ready out of the packaged total (a template with none is left out). */
function labels(s: Summary | null | undefined) {
  if (!s) return "";
  const rows = Object.entries(s.by_template ?? {}).filter(([, v]) => v.packaged > 0).sort(([a], [b]) => a.localeCompare(b));
  return html`<h3>Packaged items and their labels</h3>
<p>Selling requires a label: ${s.sell_requires_label ? "on" : "off"}. <span class="muted">(The setting <code>sell_requires_label</code>. When on, a packaged item whose label has not been read and approved by a person cannot be quoted, added to a card, found as orderable or shown as orderable: the chat and the site say "coming soon". Loose produce, meat and bakery with no real barcode are not packaged and sell on the core. Turning it on is a person's decision.)</span></p>
<table><tr><th>Template</th><th>Packaged</th><th>Label-ready</th></tr>
${rows.map(([code, v]) => html`<tr><td>${code.replace(/_/g, " ")}</td><td>${v.packaged}</td><td>${v.label_ready} of ${v.packaged}</td></tr>`)}
<tr><td><strong>all</strong></td><td>${s.packaged}</td><td>${s.label_ready} of ${s.packaged}</td></tr></table>
<p class="muted">The packaged items not label-ready, with what each misses, are under "packaged, not label-ready" above.</p>`;
}

async function page(c: Ctx) {
  const show = (SHOW as readonly string[]).includes(c.url.searchParams.get("show") ?? "") ? (c.url.searchParams.get("show") as (typeof SHOW)[number]) : "all";
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const all = (await c.deps.db.rpc<Ready[]>("product_readiness", {})) ?? [];
  const summary = await c.deps.db.rpc<Summary>("readiness_summary", {});
  const keep = (r: Ready) => show === "all" || (show === r.level) || (show === "label" && !!r.packaged && !r.label_ready) || (show === "catalog" && r.blocks_catalog.length > 0) || (show === "ordering" && r.blocks_ordering.length > 0)
    || (show === "missing" && r.missing.length > 0) || (show === "ready" && r.ready);
  const rows = all.filter(keep).filter((r) => !q || [r.sku, r.name_en, r.name_ar, r.brand].some((v) => (v ?? "").toLowerCase().includes(q)));
  const n = (f: (r: Ready) => boolean) => all.filter(f).length;
  const tab = (s: (typeof SHOW)[number], count: number) => (s === show ? html`<strong>${SHOW_WORDS[s]} (${count})</strong>` : html`<a href="/readiness?show=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}">${SHOW_WORDS[s]} (${count})</a>`);
  return render(c, "Product readiness", html`
<p>${tab("all", all.length)} · ${tab("not_sellable", n((r) => r.level === "not_sellable"))} · ${tab("sellable", n((r) => r.level === "sellable"))} · ${tab("fact_complete", n((r) => r.level === "fact_complete"))} · ${tab("label", n((r) => !!r.packaged && !r.label_ready))}</p>
${labels(summary)}
<p class="muted"><strong>Sellable</strong>: the core is complete (names in English and Arabic, category with its template, storage, sale unit, price); it can be ordered and its facts read "not confirmed yet". <strong>Fact-complete</strong>: its template is complete too (for packaged food: ingredients, the 14 allergens and the nutrition panel; for a cleaning product: hazard warnings as printed); only these answer a filter such as "no added sugar" or "fragrance-free". Facts need a re-check after 12 months.</p>
<p>${tab("catalog", n((r) => r.blocks_catalog.length > 0))} · ${tab("ordering", n((r) => r.blocks_ordering.length > 0))} · ${tab("missing", n((r) => r.missing.length > 0))} · ${tab("ready", n((r) => r.ready))}</p>
<p class="muted"><strong>Blocks the catalog</strong>: the WhatsApp catalog leaves the item out (no approved picture a customer may see, not placed in a category, or no price). <strong>Blocks ordering</strong>: a customer cannot order it at all (no price at the hub, or marked unavailable). A missing picture blocks the catalog, not ordering. Names, food facts, cost and search words do not stop a sale; they are listed so nothing is forgotten. Click what is missing to open the page that fixes it.</p>
<form method="get" action="/readiness"><input type="hidden" name="show" value="${show}"><input name="q" value="${q}" placeholder="SKU, name or brand"> <button>Find</button></form>
${rows.length === 0 ? html`<p class="muted">Nothing here.</p>` : html`<table><tr><th>Item</th><th>Level</th><th>Name</th><th>Picture</th><th>Food facts</th><th>Cost</th><th>Search words</th><th>Catalog</th><th>Price</th><th>Blocks</th></tr>
${rows.map((r) => { const k = cells(r); return html`<tr><td><a href="/catalog/${r.product_id}">${r.name_en}</a><br><span class="muted">${r.sku}${r.brand ? ` · ${r.brand}` : ""}${r.template ? ` · ${r.template.replace(/_/g, " ")}` : ""}</span></td>
<td>${levelCell(r)}<br>${labelCell(r)}</td><td>${k.name}</td><td>${k.picture}</td><td>${k.facts}</td><td>${k.cost}</td><td>${k.words}</td><td>${k.placement}</td><td>${k.price}</td>
<td>${r.blocks_ordering.length ? html`<strong class="warn">ordering</strong>: ${r.blocks_ordering.join("; ")}<br>` : ""}${r.blocks_catalog.length ? html`<strong class="warn">catalog</strong>: ${r.blocks_catalog.join("; ")}` : ""}${r.ready ? ok("ready") : ""}</td></tr>`; })}</table>`}`);
}

export const readinessSection: Section = {
  nav: { href: "/readiness", label: "Readiness", roles: LEADS },
  routes: [{ method: "GET", path: "/readiness", roles: LEADS, handler: page }],
};
