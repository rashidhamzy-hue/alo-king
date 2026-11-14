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
};
const SHOW = ["all", "catalog", "ordering", "missing", "ready"] as const;
const SHOW_WORDS: Record<(typeof SHOW)[number], string> = {
  all: "all items", catalog: "blocks the catalog", ordering: "blocks ordering", missing: "something missing", ready: "ready",
};

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

async function page(c: Ctx) {
  const show = (SHOW as readonly string[]).includes(c.url.searchParams.get("show") ?? "") ? (c.url.searchParams.get("show") as (typeof SHOW)[number]) : "all";
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const all = (await c.deps.db.rpc<Ready[]>("product_readiness", {})) ?? [];
  const keep = (r: Ready) => show === "all" || (show === "catalog" && r.blocks_catalog.length > 0) || (show === "ordering" && r.blocks_ordering.length > 0)
    || (show === "missing" && r.missing.length > 0) || (show === "ready" && r.ready);
  const rows = all.filter(keep).filter((r) => !q || [r.sku, r.name_en, r.name_ar, r.brand].some((v) => (v ?? "").toLowerCase().includes(q)));
  const n = (f: (r: Ready) => boolean) => all.filter(f).length;
  const tab = (s: (typeof SHOW)[number], count: number) => (s === show ? html`<strong>${SHOW_WORDS[s]} (${count})</strong>` : html`<a href="/readiness?show=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}">${SHOW_WORDS[s]} (${count})</a>`);
  return render(c, "Product readiness", html`
<p>${tab("all", all.length)} · ${tab("catalog", n((r) => r.blocks_catalog.length > 0))} · ${tab("ordering", n((r) => r.blocks_ordering.length > 0))} · ${tab("missing", n((r) => r.missing.length > 0))} · ${tab("ready", n((r) => r.ready))}</p>
<p class="muted"><strong>Blocks the catalog</strong>: the WhatsApp catalog leaves the item out (no approved picture a customer may see, not placed in a category, or no price). <strong>Blocks ordering</strong>: a customer cannot order it at all (no price at the hub, or marked unavailable). A missing picture blocks the catalog, not ordering. Names, food facts, cost and search words do not stop a sale; they are listed so nothing is forgotten. Click what is missing to open the page that fixes it.</p>
<form method="get" action="/readiness"><input type="hidden" name="show" value="${show}"><input name="q" value="${q}" placeholder="SKU, name or brand"> <button>Find</button></form>
${rows.length === 0 ? html`<p class="muted">Nothing here.</p>` : html`<table><tr><th>Item</th><th>Name</th><th>Picture</th><th>Food facts</th><th>Cost</th><th>Search words</th><th>Catalog</th><th>Price</th><th>Blocks</th></tr>
${rows.map((r) => { const k = cells(r); return html`<tr><td><a href="/catalog/${r.product_id}">${r.name_en}</a><br><span class="muted">${r.sku}${r.brand ? ` · ${r.brand}` : ""}</span></td>
<td>${k.name}</td><td>${k.picture}</td><td>${k.facts}</td><td>${k.cost}</td><td>${k.words}</td><td>${k.placement}</td><td>${k.price}</td>
<td>${r.blocks_ordering.length ? html`<strong class="warn">ordering</strong>: ${r.blocks_ordering.join("; ")}<br>` : ""}${r.blocks_catalog.length ? html`<strong class="warn">catalog</strong>: ${r.blocks_catalog.join("; ")}` : ""}${r.ready ? ok("ready") : ""}</td></tr>`; })}</table>`}`);
}

export const readinessSection: Section = {
  nav: { href: "/readiness", label: "Readiness", roles: LEADS },
  routes: [{ method: "GET", path: "/readiness", roles: LEADS, handler: page }],
};
