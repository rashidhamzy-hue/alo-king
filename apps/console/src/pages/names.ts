// Names review (session D4): the 282 names and sizes proposed by 5.18 (data/proposals/names.json, loaded by migration 0110 into
// product_name_proposals), beside the catalog's own, one item at a time. Approve, correct or reject each through
// review_product_name(); approving writes the product's name (its size after it), which queues its search words again (0076).
// Rejecting an approved one puts the earlier name back. Ops lead and admin: the page and the SQL function both refuse a picker.
// Arabic written by a model is marked: the checks cannot tell a wrong word from a right one, so a reader of Arabic decides.
//
// D5 adds, on top of the forms as they were (nothing a form posts has changed):
//   * keyboard shortcuts (public/shell.js, from pwa.ts): the arrow keys move between items, a approves, c starts a correction, r rejects;
//   * "Approve all shown": the items on the screen, at most 20, each through review_product_name() one at a time and each logged in
//     staff_actions, then one undo for the whole batch. Nothing is approved that was not on the screen: the form carries a signed list
//     of exactly what was shown, with a fingerprint of what each looked like (proposal and catalog name), and an item that changed
//     since the page was drawn, or was decided meanwhile, is skipped and said so.
// This page stays in English (the 24 older pages do): the Arabic reader of the proposals is the person using it.
import { act, attempt, audit, auditQuietly, flashRedirect, html, id, render, returnTo, text, UserError, UUID, type Ctx, type Section } from "../app";
import { DbError } from "../db";
import { form, when } from "../html";
import { LEADS } from "../roles";
import { hmac, randomToken, same } from "../session";

export type Proposal = {
  id: string; sku: string; current_name_en: string; current_name_ar: string | null; current_brand: string | null; current_sell_unit: string | null;
  name_en: string; name_ar: string | null; size_en: string | null; size_ar: string | null; ar_source: "catalog" | "model_written"; added_words: string[];
  off_hint: { name?: string | null; brands?: string | null; quantity?: string | null } | null; original: Record<string, string | null> | null;
  status: "proposed" | "approved" | "rejected"; corrected: boolean; decided_by: string | null; decided_at: string | null; review_note: string | null;
  applied_name_en: string | null; applied_name_ar: string | null;
};
export type Live = { sku: string; name_en: string; name_ar: string | null; brand: string | null; sell_unit: string };
const SHOW = ["proposed", "approved", "rejected", "all"] as const;
const PER_PAGE = 15;
export const MAX_BATCH = 20;
const enc = new TextEncoder();

/** What a person saw for one item: the proposal's words and status and the catalog's own name. If any changes, the screen was out of date. */
async function fingerprint(r: Proposal, p: Live | undefined): Promise<string> {
  const data = [r.id, r.status, r.name_en, r.name_ar, r.size_en, r.size_ar, p?.name_en, p?.name_ar].map((x) => x ?? "").join("\u241f");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data))).slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const drifted = (p: Live | undefined, r: Proposal) => !!p && (diff(p.name_en, r.current_name_en) || diff(p.name_ar, r.current_name_ar)) && r.status === "proposed";
const batchSig = (c: Ctx, items: string) => hmac(c.deps.secret, `names-batch:${c.staff.partyId}:${items}`);
type Batch = { ref: string; approved: string[]; at: string };

/** This person's latest batch that is still whole: approved something and not yet undone. */
async function lastBatch(c: Ctx): Promise<Batch | null> {
  try {
    const done = (await c.deps.db.rows<{ ref: string; args: { approved?: string[] } | null; at: string; ok: boolean | null }>("staff_actions", {
      select: "ref,args,at,ok", where: { action: "names_batch_approve", phase: "done", party_id: c.staff.partyId }, order: [{ col: "seq", desc: true }], limit: 1 }))[0];
    if (!done?.ref || !done.args?.approved?.length) return null;
    const undone = await c.deps.db.rows<{ seq: number }>("staff_actions", { select: "seq", where: { action: "names_batch_undo", phase: "done", ref: `u-${done.ref}` }, limit: 1 });
    return undone.length ? null : { ref: done.ref, approved: done.args.approved, at: done.at };
  } catch { return null; }
}

/** The name the product will carry: the proposed name with its size after it, as migration 0110 writes it. */
export const withSize = (name: string | null, size: string | null) => (name ? [name, size].filter(Boolean).join(" ") : null);
export const ar = (s: string | null) => (s ? html`<span dir="rtl" lang="ar">${s}</span>` : html`<span class="muted">none</span>`);
export const diff = (a: string | null, b: string | null) => (a ?? "") !== (b ?? "");

async function page(c: Ctx) {
  const { db } = c.deps;
  const status = (SHOW as readonly string[]).includes(c.url.searchParams.get("status") ?? "") ? (c.url.searchParams.get("status") as (typeof SHOW)[number]) : "proposed";
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const pageNo = Math.max(1, Math.min(200, Number(c.url.searchParams.get("page")) || 1));
  let all: { status: string }[]; let rows: Proposal[];
  try {
    [all, rows] = await Promise.all([
      db.rows<{ status: string }>("product_name_proposals", { select: "status", limit: 5000 }),
      db.rows<Proposal>("product_name_proposals", { where: status === "all" ? {} : { status }, order: [{ col: "sku" }], limit: 5000 }),
    ]);
  } catch (e) {
    // staging can lag the Worker: migration 0110 not applied yet
    if (e instanceof DbError && (e.code === "42P01" || e.code === "PGRST205")) return render(c, "Names review", html`<p class="note">Not available yet: the database has no product_name_proposals table (migration 0110 is not applied there yet).</p>`);
    throw e;
  }
  const count = (s: string) => all.filter((x) => x.status === s).length;
  const decided = count("approved") + count("rejected");
  const live = new Map((rows.length ? await db.rows<Live>("products", { select: "sku,name_en,name_ar,brand,sell_unit", where: { sku: { in: rows.map((r) => r.sku) } } }) : []).map((p) => [p.sku, p]));
  const hits = rows.filter((r) => !q || [r.sku, r.name_en, r.name_ar, r.current_name_en, r.current_name_ar, r.current_brand].some((v) => (v ?? "").toLowerCase().includes(q)));
  const shown = hits.slice((pageNo - 1) * PER_PAGE, pageNo * PER_PAGE);
  const eligible = status === "proposed" ? shown.filter((r) => live.get(r.sku) && !drifted(live.get(r.sku), r)).slice(0, MAX_BATCH) : [];
  const items = (await Promise.all(eligible.map(async (r) => `${r.id}:${await fingerprint(r, live.get(r.sku))}`))).join(",");
  const last = await lastBatch(c);
  const modelArabic = eligible.filter((r) => r.ar_source === "model_written").length;
  const link = (o: { status?: string; page?: number }) => `/names?status=${o.status ?? status}${q ? `&q=${encodeURIComponent(q)}` : ""}${o.page && o.page > 1 ? `&page=${o.page}` : ""}`;

  return render(c, "Names review", html`
<p><strong>${decided} of ${all.length}</strong> decided · ${count("approved")} approved · ${count("rejected")} rejected · ${count("proposed")} waiting</p>
<p>${SHOW.map((s, i) => html`${i ? " · " : ""}${s === status ? html`<strong>${s === "proposed" ? "waiting" : s}</strong>` : html`<a href="${link({ status: s })}">${s === "proposed" ? "waiting" : s}</a>`}`)}</p>
<form method="get" action="/names"><input type="hidden" name="status" value="${status}"><input name="q" value="${q}" placeholder="SKU, name or brand"> <button>Find</button></form>
<p class="muted">Approving saves the name with its size after it (for example “Candia Ayran 250 ml”) and queues the item's search words again. A correction is saved
and applied in one step. Rejecting a waiting proposal keeps the catalog's name; rejecting an approved one puts the earlier name back. Arabic marked “written by a model” needs a person who reads Arabic.</p>
${last ? html`<div class="note">${form(c.f, "/names/batch/undo", html`<input type="hidden" name="batch" value="${last.ref}"><input type="hidden" name="back_status" value="${status}"><input type="hidden" name="back_q" value="${q}"><input type="hidden" name="back_page" value="${pageNo}">
<p>Your last “Approve all shown” approved ${last.approved.length} names (${when(last.at)}). <button class="secondary">Undo this batch (${last.approved.length})</button></p>`)}</div>` : ""}
${eligible.length ? html`<div class="card">${form(c.f, "/names/batch/approve", html`<input type="hidden" name="items" value="${items}"><input type="hidden" name="sig" value="${await batchSig(c, items)}">
<input type="hidden" name="back_status" value="${status}"><input type="hidden" name="back_q" value="${q}"><input type="hidden" name="back_page" value="${pageNo}">
<p><button>Approve all shown (${eligible.length})</button></p>
<p class="muted">Approves only the ${eligible.length} on this screen, one at a time, each saved in the action log. Anything that changes meanwhile is skipped. You can undo the whole batch afterwards.${modelArabic ? ` ${modelArabic} of them have Arabic written by a model: read it first.` : ""}</p>`)}</div>` : ""}
<p class="muted">Keys: <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>a</kbd> approve · <kbd>c</kbd> correct (then Enter) · <kbd>r</kbd> reject.</p>
<div data-names>${shown.length === 0 ? html`<p class="muted">Nothing here.</p>` : shown.map((r) => block(c, r, live.get(r.sku), { status, q, page: pageNo }))}</div>
<p>${pageNo > 1 ? html`<a href="${link({ page: pageNo - 1 })}">← newer</a> ` : ""}Page ${pageNo} of ${Math.max(1, Math.ceil(hits.length / PER_PAGE))} (${hits.length} items)
${pageNo * PER_PAGE < hits.length ? html` <a href="${link({ page: pageNo + 1 })}">next →</a>` : ""}</p>`);
}

function block(c: Ctx, r: Proposal, p: Live | undefined, back: { status: string; q: string; page: number }) {
  const saveEn = withSize(r.name_en, r.size_en); const saveAr = withSize(r.name_ar, r.size_ar) ?? p?.name_ar ?? null;
  const moved = p && r.status === "approved" && (diff(p.name_en, r.applied_name_en) || diff(p.name_ar, r.applied_name_ar));
  return html`<div class="pair" id="${r.sku}" data-sku="${r.sku}"><div>
<p><strong>${r.sku}</strong> · ${r.current_brand ?? "no brand"} · ${r.current_sell_unit ?? ""} · <span class="muted">${r.status === "proposed" ? "waiting" : r.status}${r.corrected ? ", corrected" : ""}</span></p>
${!p ? html`<p class="warn">This item is not in the catalog database, so nothing can be applied.</p>` : ""}
${drifted(p, r) ? html`<p class="warn">The catalog name has changed since this was proposed: check that the proposal still fits.</p>` : ""}
${moved ? html`<p class="warn">The catalog name was changed after this approval, so it cannot be undone from here.</p>` : ""}
<table><tr><th></th><th>In the catalog now</th><th>Proposed</th></tr>
<tr><td>English name</td><td>${p?.name_en ?? r.current_name_en}</td><td class="${diff(p?.name_en ?? r.current_name_en, r.name_en) ? "warn" : ""}">${r.name_en}</td></tr>
<tr><td>English size</td><td class="muted">in the name</td><td>${r.size_en ?? html`<span class="muted">none</span>`}</td></tr>
<tr><td>Arabic name</td><td>${ar(p?.name_ar ?? r.current_name_ar)}</td><td class="${diff(p?.name_ar ?? r.current_name_ar, r.name_ar) ? "warn" : ""}">${ar(r.name_ar)}</td></tr>
<tr><td>Arabic size</td><td class="muted">in the name</td><td>${ar(r.size_ar)}</td></tr>
<tr><td><strong>Will be saved as</strong></td><td colspan="2">${saveEn} · ${ar(saveAr)}</td></tr></table>
${r.ar_source === "model_written" ? html`<p class="note">The Arabic was written by a model: it needs a person who reads Arabic.</p>` : html`<p class="muted">The Arabic is the catalog's own.</p>`}
${r.added_words.length ? html`<p class="note">Words the generator had to add: ${r.added_words.join(", ")}.</p>` : ""}
${r.off_hint ? html`<p class="muted">Open Food Facts calls it: ${[r.off_hint.name, r.off_hint.brands, r.off_hint.quantity].filter(Boolean).join(" · ")}.</p>` : ""}
${r.original ? html`<p class="muted">Before the correction: ${[r.original.name_en, r.original.size_en].filter(Boolean).join(" ")}${r.original.name_ar ? html` · ${ar(withSize(r.original.name_ar, r.original.size_ar ?? null))}` : ""}.</p>` : ""}
${r.review_note ? html`<p class="muted">Note: ${r.review_note}</p>` : ""}
${form(c.f, `/names/${r.id}`, html`<input type="hidden" name="back_status" value="${back.status}"><input type="hidden" name="back_q" value="${back.q}"><input type="hidden" name="back_page" value="${back.page}">
<p><label>English name <input name="name_en" value="${r.name_en}" maxlength="160" size="34"></label> <label>size <input name="size_en" value="${r.size_en ?? ""}" maxlength="40" size="10"></label></p>
<p><label>Arabic name <input name="name_ar" value="${r.name_ar ?? ""}" maxlength="160" size="34" dir="rtl" lang="ar"></label> <label>size <input name="size_ar" value="${r.size_ar ?? ""}" maxlength="40" size="10" dir="rtl" lang="ar"></label></p>
<p><input name="note" maxlength="300" placeholder="note (why)">
${r.status === "approved" ? html`<button name="decision" value="correct">Save the correction</button> <button name="decision" value="reject">Undo (reject)</button>`
  : html`<button name="decision" value="approve">Approve</button> <button name="decision" value="correct">Save my correction</button>${r.status === "proposed" ? html` <button name="decision" value="reject">Reject</button>` : ""}`}</p>`)}
</div></div>`;
}

async function decide(c: Ctx) {
  const proposal = id(c, "id");
  const decision = (["approve", "correct", "reject"] as const).find((d) => d === c.form.decision);
  if (!decision) throw new UserError("Choose approve, correct or reject.");
  const args = decision === "correct"
    ? { p_name_en: text(c, "name_en", 160), p_name_ar: text(c, "name_ar", 160), p_size_en: text(c, "size_en", 40), p_size_ar: text(c, "size_ar", 40) }
    : {};
  const note = text(c, "note", 300) || null;
  const status = (SHOW as readonly string[]).includes(c.form.back_status ?? "") ? c.form.back_status : "proposed";
  const q = encodeURIComponent((c.form.back_q ?? "").slice(0, 60));
  const pg = Math.max(1, Math.min(200, Number(c.form.back_page) || 1));
  const back = returnTo(c, `/names?status=${status}${q ? `&q=${q}` : ""}${pg > 1 ? `&page=${pg}` : ""}`);
  // UX2b: an approval made from an Approve card carries Undo, because the database can take it back as it is: rejecting an approved
  // proposal puts the earlier name back (review_product_name), unless the catalog name was changed since.
  const fromCard = back.startsWith("/approve?");
  let approvedNow = false;
  const out = await attempt(c, `name_${decision}`, { proposal, ...(decision === "correct" ? { name_en: args.p_name_en, name_ar: args.p_name_ar, size_en: args.p_size_en, size_ar: args.p_size_ar } : {}) }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean; status: string; sku?: string; name_en?: string; changed?: boolean; reverted?: boolean; words_queued?: boolean }>("review_product_name", {
      p_proposal: proposal, p_by: c.staff.partyId, p_decision: decision, p_note: note, ...args,
    });
    if (r.already) return `Already ${r.status}.`;
    if (r.status === "rejected") return r.reverted ? `Undone: the earlier name of ${r.sku} is back.` : `Rejected: ${r.sku} keeps the catalog's name.`;
    approvedNow = r.status === "approved";
    return `${decision === "correct" ? "Saved your correction" : "Approved"}: ${r.sku} is now “${r.name_en}”.${r.changed ? (r.words_queued ? " Its search words are queued again." : "") : " The name did not change."}`;
  });
  if (!out.logged) return flashRedirect(c.deps, back, { err: "Not done: the action log could not be written. Try again in a minute." });
  const undo = fromCard && approvedNow && decision === "approve" ? { label: c.lang === "ar" ? "تراجع" : "Undo", action: `/names/${proposal}`, fields: { decision: "reject", note: "undone from the approve card", return_to: back } } : undefined;
  return flashRedirect(c.deps, back, out.msg, undo);
}

const backOf = (c: Ctx) => {
  const status = (SHOW as readonly string[]).includes(c.form.back_status ?? "") ? c.form.back_status : "proposed";
  const q = encodeURIComponent((c.form.back_q ?? "").slice(0, 60));
  const pg = Math.max(1, Math.min(200, Number(c.form.back_page) || 1));
  return `/names?status=${status}${q ? `&q=${q}` : ""}${pg > 1 ? `&page=${pg}` : ""}`;
};
type Result = { already: boolean; status: string; sku?: string; reverted?: boolean };

/** Approve all shown: only what the signed list says was on the screen, one proposal at a time, each logged, then one summary entry. */
async function batchApprove(c: Ctx) {
  const items = (c.form.items ?? "").slice(0, 2000);
  const back = backOf(c);
  if (!items || !same(c.form.sig ?? "", await batchSig(c, items))) throw new UserError("That list is not the one on your screen. Reload the page and try again.");
  const wanted = items.split(",").map((x) => x.split(":") as [string, string]);
  if (wanted.length === 0 || wanted.length > MAX_BATCH || wanted.some(([i, f]) => !UUID.test(i ?? "") || !/^[0-9a-f]{12}$/.test(f ?? ""))) throw new UserError("That list is not valid.");
  const ids = wanted.map(([i]) => i);
  const { db } = c.deps;
  const rows = await db.rows<Proposal>("product_name_proposals", { where: { id: { in: ids } }, limit: MAX_BATCH });
  const live = new Map((await db.rows<Live>("products", { select: "sku,name_en,name_ar,brand,sell_unit", where: { sku: { in: rows.map((r) => r.sku) } } })).map((p) => [p.sku, p]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const batch = randomToken(8);
  try { await audit(c.deps, c.staff, { action: "names_batch_approve", phase: "intent", ref: batch, args: { shown: ids } }); }
  catch { return flashRedirect(c.deps, back, { err: "Not done: the action log could not be written. Try again in a minute." }); }
  const approved: string[] = [], skipped: string[] = [], failed: string[] = [];
  for (const [pid, fp] of wanted) {
    const r = byId.get(pid!);
    if (!r || r.status !== "proposed" || (await fingerprint(r, live.get(r.sku))) !== fp) { skipped.push(pid!); continue; }   // decided or changed since the page was drawn
    const out = await attempt(c, "name_approve", { proposal: pid, batch }, async () => {
      const res = await db.rpc<Result>("review_product_name", { p_proposal: pid, p_by: c.staff.partyId, p_decision: "approve", p_note: `approve all shown (${batch})` });
      if (res.already) throw new UserError("already decided");
      return `Approved ${res.sku}.`;
    });
    if (!out.logged) { failed.push(pid!); break; }                                                                  // the log is down: stop, do no more
    (out.ok ? approved : failed).push(pid!);
  }
  const summary = `approved ${approved.length} of ${wanted.length}${skipped.length ? `, skipped ${skipped.length}` : ""}${failed.length ? `, refused ${failed.length}` : ""}`;
  await auditQuietly(c.deps, c.staff, { action: "names_batch_approve", phase: "done", ref: batch, ok: failed.length === 0, args: { approved, skipped, failed }, result: summary });
  const said = `Approve all shown: ${summary}.${approved.length ? " You can undo the batch from the top of this page." : ""}${skipped.length ? " Skipped items changed or were decided after the page was drawn." : ""}`;
  return flashRedirect(c.deps, back, failed.length ? { err: said } : { ok: said });
}

/** Undo the latest batch: each approved name rejected through the same function, which puts the earlier name back. */
async function batchUndo(c: Ctx) {
  const batch = (c.form.batch ?? "").trim();
  const back = backOf(c);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(batch)) throw new UserError("That batch is not valid.");
  const { db } = c.deps;
  const done = (await db.rows<{ party_id: string; ok: boolean | null; args: { approved?: string[] } | null }>("staff_actions", { select: "party_id,ok,args", where: { action: "names_batch_approve", phase: "done", ref: batch }, limit: 1 }))[0];
  if (!done?.args?.approved?.length) throw new UserError("That batch was not found.");
  if (done.party_id !== c.staff.partyId && c.staff.role !== "admin") throw new UserError("Only the person who approved the batch, or the admin, can undo it.");
  if ((await db.rows<{ seq: number }>("staff_actions", { select: "seq", where: { action: "names_batch_undo", phase: "done", ref: `u-${batch}` }, limit: 1 })).length) return flashRedirect(c.deps, back, { ok: "That batch was already undone." });
  const ref = `u-${batch}`;
  try { await audit(c.deps, c.staff, { action: "names_batch_undo", phase: "intent", ref, args: { approved: done.args.approved } }); }
  catch { return flashRedirect(c.deps, back, { err: "Not done: the action log could not be written. Try again in a minute." }); }
  const undone: string[] = [], refused: string[] = [];
  for (const pid of done.args.approved) {
    const out = await attempt(c, "name_undo", { proposal: pid, batch }, async () => {
      const res = await db.rpc<Result>("review_product_name", { p_proposal: pid, p_by: c.staff.partyId, p_decision: "reject", p_note: `undo of approve all shown (${batch})` });
      return res.already ? "Already rejected." : "Undone.";
    });
    if (!out.logged) { refused.push(pid); break; }
    (out.ok ? undone : refused).push(pid);
  }
  const summary = `undone ${undone.length} of ${done.args.approved.length}${refused.length ? `, ${refused.length} could not be put back (changed since)` : ""}`;
  await auditQuietly(c.deps, c.staff, { action: "names_batch_undo", phase: "done", ref, ok: refused.length === 0, args: { undone, refused }, result: summary });
  return flashRedirect(c.deps, back, refused.length ? { err: `Undo: ${summary}.` } : { ok: `Undo: ${summary}. The earlier names are back; the proposals are listed under “rejected”.` });
}

export const namesSection: Section = {
  nav: { href: "/names", label: "Names", roles: LEADS },
  routes: [
    { method: "GET", path: "/names", roles: LEADS, handler: page },
    { method: "POST", path: "/names/batch/approve", roles: LEADS, handler: batchApprove },
    { method: "POST", path: "/names/batch/undo", roles: LEADS, handler: batchUndo },
    { method: "POST", path: "/names/:id", roles: LEADS, handler: decide },
  ],
};
