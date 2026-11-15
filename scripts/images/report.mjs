#!/usr/bin/env node
// Session PIX: the picture queue as the founder needs to read it. After a run, for every ACTIVE item: either a candidate waiting
// for approval (or already approved), or a NAMED reason why there is none. Reads only (service key); makes no model call.
//   node scripts/images/report.mjs            writes pictures-report.json and pictures-report.md, and the run summary
// Exit code 1 if any item has neither a candidate nor a reason (the "done when" of the session), or the queue cannot be read.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeStore } from "./lib/store.mjs";
import { salesBySku, rankItems } from "./fetch-images.mjs";

const USABLE = new Set(["cc_by_sa", "brand_own", "own_photo", "public_page"]);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };

/** The reason an item has no candidate, in words a person can act on. `attempt` is the item's latest attempt row, or undefined. */
export function reasonFor(attempt, rejected = 0) {
  if (!attempt) return { code: "not_tried", text: rejected ? "a person rejected the earlier picture; no run has looked since" : "no run has looked at this item yet" };
  const ev = attempt.detail?.evaluated ?? [];
  const count = {};
  for (const e of ev) for (const r of e.reasons ?? []) { const k = String(r).startsWith("duplicate:") ? "duplicate" : String(r).startsWith("error:") ? "download_or_check_error" : r; count[k] = (count[k] ?? 0) + 1; }
  const dupOf = [...new Set(ev.map((e) => e.duplicate_of).filter(Boolean))];
  const list = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ");
  switch (attempt.outcome) {
    case "none_found": return { code: "none_found", text: `no source returned a candidate (${(attempt.sources_tried ?? []).join(", ") || "no source"} asked)` };
    case "none_passed": return { code: dupOf.length && Object.keys(count).every((k) => k === "duplicate" || k === "narrow") ? "duplicate" : "none_passed",
      text: `${attempt.seen} candidates looked at, none passed: ${list}${dupOf.length ? `; same picture as ${dupOf.join(", ")}` : ""}` };
    case "skipped_rejected": return { code: "rejected_before", text: "the only candidate is a picture a person rejected before" };
    case "error": return { code: "error", text: `the last run failed on this item: ${attempt.detail?.error ?? attempt.detail?.errors?.[0]?.error ?? "unknown"}; it is tried again next run` };
    case "proposed": return { code: "proposed_then_gone", text: "a picture was proposed and is no longer waiting (superseded or rejected)" };
    default: return { code: attempt.outcome, text: String(attempt.outcome) };
  }
}

/** Pure: products (active), images (all statuses), attempts (any order), sales (SKU -> units). */
export function buildReport({ products, images, attempts, sales }) {
  const latest = new Map();
  for (const a of [...attempts].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))) latest.set(a.product_id, a);
  const imgs = new Map();
  for (const i of images) { if (!imgs.has(i.product_id)) imgs.set(i.product_id, []); imgs.get(i.product_id).push(i); }
  const ranked = rankItems(products.map((p) => ({ ...p, product_id: p.id })), sales);
  const rows = ranked.map((p) => {
    const mine = imgs.get(p.id) ?? [];
    const approved = mine.find((i) => i.status === "approved" && USABLE.has(i.licence));
    const proposed = mine.filter((i) => i.status === "proposed" && USABLE.has(i.licence)).sort((a, b) => String(b.fetched_at).localeCompare(String(a.fetched_at)))[0];
    const pic = approved ?? proposed;
    const base = { sku: p.sku, name: p.name_en, rank: p.rank, units: p.units };
    if (pic) return { ...base, state: approved ? "approved" : "candidate", source_kind: pic.source_kind, licence: pic.licence, page_host: host(pic.page_url), source_url: pic.source_url, page_url: pic.page_url, fetched_at: pic.fetched_at, width_px: pic.width_px, height_px: pic.height_px };
    const reason = reasonFor(latest.get(p.id), mine.filter((i) => i.status === "rejected").length);
    return { ...base, state: "no_candidate", reason_code: reason.code, reason: reason.text };
  });
  const by = (f) => rows.reduce((m, r) => { const k = f(r); if (k != null) m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const queue = rows.filter((r) => r.state === "candidate");
  return {
    generated_at: new Date().toISOString(),
    items: rows.length,
    candidates_waiting: queue.length,
    approved: rows.filter((r) => r.state === "approved").length,
    no_candidate: rows.filter((r) => r.state === "no_candidate").length,
    // Not finished is not a reason: an item no run has looked at, or whose last run failed, still has to be run.
    unexplained: rows.filter((r) => r.state === "no_candidate" && ["not_tried", "error"].includes(r.reason_code)).length,
    by_source: by((r) => (r.state === "no_candidate" ? null : r.source_kind)),
    by_reason: by((r) => (r.state === "no_candidate" ? r.reason_code : null)),
    approve_first: rows.filter((r) => r.rank != null && r.rank <= 20).map((r) => ({ rank: r.rank, sku: r.sku, name: r.name, units: r.units, state: r.state, reason: r.reason ?? null })),
    rows,
  };
}

export function markdown(rep) {
  const L = [];
  L.push(`# Product pictures: the queue (${rep.generated_at})`, "",
    `- active items: **${rep.items}**; candidates waiting for approval: **${rep.candidates_waiting}**; already approved: **${rep.approved}**; no candidate, with a named reason: **${rep.no_candidate}**; not finished (not tried, or failed): **${rep.unexplained}**`,
    `- candidates by source: ${JSON.stringify(rep.by_source)}`, `- reasons for no candidate: ${JSON.stringify(rep.by_reason)}`, "",
    "## The 20 fastest sellers (approve these first)", "", "| # | SKU | Item | Units (reference) | State |", "|---|---|---|---|---|",
    ...rep.approve_first.map((r) => `| ${r.rank} | ${r.sku} | ${r.name} | ${r.units ?? ""} | ${r.state === "no_candidate" ? `none: ${r.reason}` : r.state} |`), "",
    "## Items with no candidate, and why", "", "| SKU | Item | Reason |", "|---|---|---|",
    ...rep.rows.filter((r) => r.state === "no_candidate").map((r) => `| ${r.sku} | ${r.name} | ${r.reason_code}: ${r.reason} |`), "");
  return L.join("\n");
}

async function selectAll(store, table, query) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const page = await store.select(table, `${query}&limit=1000&offset=${off}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error("missing SUPABASE_URL or SUPABASE_SERVICE_KEY"); process.exit(2); }
  const store = makeStore({ url, key });
  const [products, images, attempts] = await Promise.all([
    selectAll(store, "products", "select=id,sku,name_en&is_active=eq.true&order=sku"),
    selectAll(store, "product_images", "select=product_id,status,source_kind,licence,source_url,page_url,fetched_at,width_px,height_px&order=fetched_at"),
    selectAll(store, "product_image_attempts", "select=product_id,run_id,outcome,sources_tried,seen,kept,detail,created_at&order=created_at"),
  ]);
  const sales = salesBySku(readFileSync(fileURLToPath(new URL("../../supabase/seed/catalog.csv", import.meta.url)), "utf8"));
  const rep = buildReport({ products, images, attempts, sales });
  writeFileSync("pictures-report.json", JSON.stringify(rep, null, 1));
  writeFileSync("pictures-report.md", markdown(rep));
  console.log(JSON.stringify({ items: rep.items, candidates_waiting: rep.candidates_waiting, approved: rep.approved, no_candidate: rep.no_candidate, unexplained: rep.unexplained, by_source: rep.by_source, by_reason: rep.by_reason }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = markdown(rep).split("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.slice(0, 40).join("\n") + `\n\n(the full list: pictures-report.md in the run's artifact)\n`);
  }
  if (rep.unexplained > 0) { console.error(`FAIL: ${rep.unexplained} items have neither a candidate nor a finished reason (not tried, or the last run failed)`); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
