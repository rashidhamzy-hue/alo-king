// 1.23 Search words, the review list. B4's nightly and on-change job (0076) writes every new item's search words and runs a few
// phrasings through the planner; a phrasing that does not land on the item is put here instead of being guessed.
//   Done          resolve_search_word_review() (0076): a person looked and nothing needs to change.
//   Build again   rerun_search_words()         (0080): queue the item's words again (after fixing its name in the catalog, or
//                 just to retry), closing its open phrasings; new ones that fail come back here.
// Jobs that failed three times are listed too: those items have no words of their own and nobody else will retry them.
import { act, html, render, UserError, UUID, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { LEADS } from "../roles";

type Got = { phrasing?: string; status?: string | null; chosen?: string | null; candidates?: string[] | null };
type Review = { id: string; sku: string; name: string | null; name_ar: string | null; phrasing: string; got: Got | null; created_at: string };
type Job = { sku: string; reason: string; status: string; attempts: number; enqueued_at: string; done_at: string | null; last_error: string | null };
type Term = { sku: string; term: string; level: string; lang: string };
const SKU = /^[A-Za-z0-9._:-]{1,80}$/;

const STATUS: Record<string, string> = {
  matched: "picked another item", ambiguous: "asked which one", not_found: "found nothing", unavailable: "said not available",
};
const got = (g: Got | null) => {
  if (!g) return "";
  const what = STATUS[g.status ?? ""] ?? g.status ?? "no answer";
  const chosen = g.chosen ? `: ${g.chosen}` : "";
  const cands = g.candidates?.length ? ` (between ${g.candidates.slice(0, 4).join(", ")}${g.candidates.length > 4 ? ", …" : ""})` : "";
  return `${what}${chosen}${g.status === "matched" ? "" : cands}`;
};

async function page(c: Ctx) {
  const { db } = c.deps;
  const [open, failed, waiting, done] = await Promise.all([
    db.rpc<Review[]>("search_word_reviews_open"),
    db.rows<Job>("search_word_jobs", { select: "sku,reason,status,attempts,enqueued_at,done_at,last_error", where: { status: "failed", attempts: { gte: 3 } }, order: [{ col: "done_at", desc: true }], limit: 50 }),
    db.rows<{ sku: string }>("search_word_jobs", { select: "sku", where: { status: { in: ["pending", "running"] } }, limit: 1000 }),
    db.rows<{ sku: string; phrasing: string; resolved_by: string | null; resolved_at: string }>("search_word_reviews", {
      select: "sku,phrasing,resolved_by,resolved_at", where: { status: "resolved" }, order: [{ col: "resolved_at", desc: true }], limit: 15 }),
  ]);
  const reviews = open ?? [];
  const skus = [...new Set([...reviews.map((r) => r.sku), ...failed.map((j) => j.sku), ...done.map((d) => d.sku)])];
  const [products, terms, people] = await Promise.all([
    skus.length ? db.rows<{ id: string; sku: string; name_en: string; brand: string | null; owner_source_id: string | null }>("products", {
      select: "id,sku,name_en,brand,owner_source_id", where: { sku: { in: skus } } }) : [],
    reviews.length ? db.rows<Term>("language_pack", { select: "sku,term,level,lang", where: { sku: { in: [...new Set(reviews.map((r) => r.sku))] } }, order: [{ col: "level" }, { col: "term" }], limit: 2000 }) : [],
    done.some((d) => d.resolved_by) ? db.rows<{ id: string; display_name: string | null }>("parties", {
      select: "id,display_name", where: { id: { in: [...new Set(done.map((d) => d.resolved_by).filter(Boolean) as string[])] } } }) : [],
  ]);
  const product = new Map(products.map((p) => [p.sku, p]));
  const who = (id: string | null) => (id ? people.find((p) => p.id === id)?.display_name ?? "Staff" : "");
  const itemLink = (sku: string, name: string | null) => {
    const p = product.get(sku);
    const label = name ?? p?.name_en ?? sku;
    // The catalog page is the hub's; a merchant's menu item is shown by name only.
    return p && !p.owner_source_id ? html`<a href="/catalog/${p.id}">${label}</a>` : html`${label}`;
  };
  const bySku = new Map<string, Review[]>();
  for (const r of reviews) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r]);

  return render(c, "Search words", html`
<p class="muted">When an item is added or renamed, its search words are written for it and tried with a few phrasings. A phrasing that did not find the item is listed here, instead of being guessed. Fix the item's name or brand in the catalog (its words are then built again by themselves), or build them again here, or mark a phrasing done when nothing needs to change.</p>
<p>${waiting.length} item${waiting.length === 1 ? "" : "s"} waiting for words.</p>
<h2>Phrasings that did not find their item (${reviews.length})</h2>
${bySku.size === 0 ? html`<p class="muted">Nothing to review.</p>` : [...bySku].map(([sku, rs]) => {
    const t = terms.filter((x) => x.sku === sku);
    return html`<h3>${itemLink(sku, rs[0]!.name)} <span class="muted">${sku}${rs[0]!.name_ar ? html` · ${rs[0]!.name_ar}` : ""}</span></h3>
<p class="muted">Its words: ${t.length ? t.map((x, i) => html`${i ? ", " : ""}${x.term} <small>(${x.level}, ${x.lang})</small>`) : "none yet"}</p>
<table><tr><th>Someone says</th><th>What the planner did</th><th>Since</th><th></th></tr>
${rs.map((r) => html`<tr><td>${r.phrasing}</td><td>${got(r.got)}</td><td>${when(r.created_at)}</td>
<td>${form(c.f, `/search-words/${r.id}/done`, html`<button>Done</button>`, { cls: "inline" })}</td></tr>`)}</table>
${form(c.f, `/search-words/item/${encodeURIComponent(sku)}/rebuild`, html`<button>Build its words again</button>`)}`;
  })}
<h2>Items whose words could not be built (${failed.length})</h2>
${failed.length === 0 ? html`<p class="muted">None.</p>` : html`<table><tr><th>Item</th><th>Why it was queued</th><th>Tries</th><th>Last error</th><th>When</th><th></th></tr>
${failed.map((j) => html`<tr><td>${itemLink(j.sku, null)} <span class="muted">${j.sku}</span></td><td>${j.reason}</td><td>${j.attempts}</td><td>${(j.last_error ?? "").slice(0, 160)}</td><td>${when(j.done_at)}</td>
<td>${form(c.f, `/search-words/item/${encodeURIComponent(j.sku)}/rebuild`, html`<button>Try again</button>`, { cls: "inline" })}</td></tr>`)}</table>`}
<h2>Recently done</h2>
${done.length === 0 ? html`<p class="muted">None yet.</p>` : html`<table><tr><th>Item</th><th>Phrasing</th><th>By</th><th>When</th></tr>
${done.map((d) => html`<tr><td>${itemLink(d.sku, null)}</td><td>${d.phrasing}</td><td>${who(d.resolved_by)}</td><td>${when(d.resolved_at)}</td></tr>`)}</table>`}`);
}

async function resolve(c: Ctx) {
  const id = c.params.id ?? "";
  if (!UUID.test(id)) throw new UserError("That record is not valid.");
  return act(c, "search_word_review_done", { review: id }, async () => {
    const ok = await c.deps.db.rpc<boolean>("resolve_search_word_review", { p_review: id, p_by: c.staff.partyId });
    return ok ? "Marked done." : "Already done.";
  }, "/search-words");
}

async function rebuild(c: Ctx) {
  const sku = c.params.sku ?? "";
  if (!SKU.test(sku)) throw new UserError("That item is not valid.");
  return act(c, "search_words_rebuild", { sku }, async () => {
    const r = await c.deps.db.rpc<{ closed: number; job: string | null }>("rerun_search_words", { p_sku: sku, p_by: c.staff.partyId });
    const closed = r.closed ? ` ${r.closed} phrasing${r.closed === 1 ? "" : "s"} closed.` : "";
    return r.job === "running" ? `Its words are being built right now; nothing was queued twice.${closed}` : `Queued: its words are built again within a few minutes.${closed}`;
  }, "/search-words");
}

export const searchWordsSection: Section = {
  nav: { href: "/search-words", label: "Search words", roles: LEADS },
  routes: [
    { method: "GET", path: "/search-words", roles: LEADS, handler: page },
    { method: "POST", path: "/search-words/:id/done", roles: LEADS, handler: resolve },
    { method: "POST", path: "/search-words/item/:sku/rebuild", roles: LEADS, handler: rebuild },
  ],
};
