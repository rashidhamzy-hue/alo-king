// Automatic approvals (session I1; SYSTEM_PLAN 4, conflict register C6 approved 14 Nov). One page for the founder:
//   - the four rules (picture; names and size; search words; ingredients and nutrition), on or off, why, and what each checks.
//     Allergens, diet labels, prices and costs have no rule: they are always a person's, and the page says so;
//   - the day's spot checks: a random tenth of each day's automatic approvals (and, while a rule is still off, of what it would
//     have approved). Right on every one of a field's first sample switches that rule on; one wrong switches it off and undoes
//     that approval (record_spot_check, 0126);
//   - switching a rule off, or back on after a passing sample (set_auto_approval_rule); the Arabic reader's sample of 50;
//   - the intake review list: jobs that failed three times, with the reason, and "try again" (retry_intake_job, 0122).
// Writes only through those SQL functions, with the signed-in staff member as the acting party. Ops lead and admin.
import { act, html, id, render, text, UserError, type Ctx, type Section } from "../app";
import { DbError, isMissingFunction } from "../db";
import { form, when } from "../html";
import { LEADS } from "../roles";

type Rule = { field: string; enabled: boolean; first_passed_at: string | null; disabled_at: string | null; disabled_reason: string | null; checks: string;
  applied: number; logged_rule_off: number; checked_right: number; checked_wrong: number };
type Check = { check_id: string; sample_day: string; field: string; kind: string; applied: boolean; sku: string; name_en: string; name_ar: string | null; brand: string | null;
  barcode: string | null; checks: Record<string, boolean>; result: Record<string, unknown>; created_at: string;
  picture: { source_url: string | null; page_url: string | null; source_kind: string; media_path: string; status: string } | null;
  name: { name_en: string; size_en: string | null; name_ar: string | null; size_ar: string | null; current_name_en: string; status: string } | null;
  fact: { attribute: string; text: string | null; values: Record<string, number> | null } | null };
type Recent = { approval_id: string; field: string; kind: string; applied: boolean; sku: string; name_en: string; created_at: string; reverted_at: string | null };
type Listed = { job_id: string; sku: string; name_en: string; step: string; attempts: number; reason: string | null; since: string };
type Overview = { rules: Rule[]; never_automatic: string[]; arabic_reader: { passed?: boolean; sample_needed?: number; checked?: number; errors?: number; at?: string } | null;
  spot_checks: Check[]; recent: Recent[]; review_list: Listed[]; intake: { items?: number; live?: number; listed?: number; researched?: number; research_spend_usd?: number; steps?: Record<string, Record<string, number>> } };

export const FIELDS = ["picture", "name_size_category", "search_words", "ingredients_nutrition"] as const;
const LABEL: Record<string, string> = { picture: "Pictures", name_size_category: "Names and size", search_words: "Search words", ingredients_nutrition: "Ingredients and nutrition" };
const STEPS = ["new_item", "identity", "search_words", "picture", "food_facts", "price_cost", "person_approves", "live"];
const safeHref = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null);
const words = (k: string) => k.replace(/_/g, " ");

async function page(c: Ctx) {
  let o: Overview;
  try { o = await c.deps.db.rpc<Overview>("auto_approvals_overview", { p_limit: 60 }); }
  catch (e) {
    if (isMissingFunction(e) || (e instanceof DbError && (e.code === "42P01" || e.code === "PGRST205")))
      return render(c, "Automatic approvals", html`<p class="note">Not available yet: the database has no auto_approvals_overview() (migrations 0122-0127 are not applied there yet).</p>`);
    throw e;
  }
  const pics = await Promise.all(o.spot_checks.map((s) => (s.picture?.media_path ? c.deps.media.sign(s.picture.media_path, 600) : Promise.resolve(null))));
  const reader = o.arabic_reader ?? {};
  return render(c, "Automatic approvals", html`
<p>A rule approves only what code can check, never on a model's confidence. Each rule starts <strong>off</strong>: while it is off it only logs what it would
approve. Each day a random tenth of the log comes here for a spot check. When every check of a rule's first sample is right, that rule switches on; one wrong
answer switches it off at once and undoes that approval.</p>
<p class="note"><strong>Never automatic:</strong> ${o.never_automatic.join(", ")}. Allergens and diet labels are always one tap, against the real pack.</p>

<h2>Rules</h2>
<table><tr><th>Field</th><th>State</th><th>Approved by the rule</th><th>Logged while off</th><th>Spot checks</th><th></th></tr>
${o.rules.map((r) => html`<tr><td><strong>${LABEL[r.field] ?? r.field}</strong><br><small class="muted">${r.checks}</small></td>
<td>${r.enabled ? html`<strong>on</strong>` : html`off`}${r.first_passed_at ? html`<br><small>first passed ${when(r.first_passed_at)}</small>` : html`<br><small>waiting for its first passing spot check</small>`}
${r.disabled_reason ? html`<br><small class="warn">${r.disabled_reason}</small>` : ""}</td>
<td>${r.applied}</td><td>${r.logged_rule_off}</td><td>${r.checked_right} right · ${r.checked_wrong} wrong</td>
<td>${form(c.f, `/auto-approvals/rule/${r.field}`, r.enabled
    ? html`<input name="note" maxlength="300" placeholder="why"> <button name="enabled" value="off">Switch off</button>`
    : html`<button name="enabled" value="on">Switch on</button>`)}</td></tr>`)}
</table>
<p class="muted">Switching on needs a spot-check sample of that rule that was all right (after a failure: a later one). The database refuses otherwise.</p>

<h2>Spot checks waiting (${o.spot_checks.length})</h2>
${o.spot_checks.length === 0 ? html`<p class="muted">Nothing to check.</p>` : o.spot_checks.map((s, i) => html`<div class="pair" id="check-${s.check_id}">
<div>${pics[i] ? html`<a href="${pics[i]}" target="_blank" rel="noopener"><img class="proof" src="${pics[i]}" alt="picture of ${s.name_en}"></a>` : ""}</div>
<div style="flex:1"><p><strong>${LABEL[s.field] ?? s.field}</strong> · ${s.applied ? "approved by the rule" : "the rule was off: it would have approved this"} · sample of ${s.sample_day}</p>
<p>${s.sku} · <strong>${s.name_en}</strong>${s.name_ar ? html` · <span dir="rtl" lang="ar">${s.name_ar}</span>` : ""} · ${s.brand ?? "no brand"}${s.barcode ? html` · barcode ${s.barcode}` : ""}</p>
${s.picture ? html`<p>Source: ${s.picture.source_kind}${safeHref(s.picture.page_url) ? html` · <a href="${safeHref(s.picture.page_url)}" target="_blank" rel="noopener noreferrer">page</a>` : ""} · now ${s.picture.status}</p>` : ""}
${s.name ? html`<p>Proposed: <strong>${[s.name.name_en, s.name.size_en].filter(Boolean).join(" ")}</strong>${s.name.name_ar ? html` · <span dir="rtl" lang="ar">${[s.name.name_ar, s.name.size_ar].filter(Boolean).join(" ")}</span>` : ""} (was ${s.name.current_name_en})</p>` : ""}
${s.fact ? html`<p>${words(s.fact.attribute)}: ${s.fact.text ?? (s.fact.values ? Object.entries(s.fact.values).map(([k, v]) => `${words(k)} ${v}`).join(", ") : "")}</p>` : ""}
<p class="muted">Checks passed: ${Object.keys(s.checks ?? {}).map(words).join(", ")}</p>
${form(c.f, `/auto-approvals/check/${s.check_id}`, html`<input name="note" maxlength="300" placeholder="what is wrong (needed for wrong)">
<button name="verdict" value="correct">Right</button> <button name="verdict" value="wrong">Wrong</button>`)}
</div></div>`)}

<h2>Arabic names written by a model</h2>
<p>${reader.passed ? html`<strong>Passed</strong>: a reader checked ${reader.checked} with ${reader.errors} errors (${reader.at ? when(reader.at) : ""}). The names rule may approve model-written Arabic.`
  : html`Not passed: the names rule never approves Arabic a model wrote until a reader checks a sample of ${reader.sample_needed ?? 50} with no error.`}</p>
${form(c.f, "/auto-approvals/arabic", html`<label>names checked <input name="checked" inputmode="numeric" size="4"></label> <label>with an error <input name="errors" inputmode="numeric" size="4"></label>
<input name="note" maxlength="300" placeholder="note"> <button>Record the sample</button>`)}

<h2>Intake: failed three times (${o.review_list.length})</h2>
${o.review_list.length === 0 ? html`<p class="muted">Nothing failed three times.</p>` : html`<table><tr><th>Item</th><th>Step</th><th>Reason</th><th>Since</th><th></th></tr>
${o.review_list.map((l) => html`<tr><td>${l.sku} ${l.name_en}</td><td>${words(l.step)}</td><td>${l.reason ?? ""}</td><td>${when(l.since)}</td>
<td>${form(c.f, `/auto-approvals/retry/${l.job_id}`, html`<button>Try again</button>`)}</td></tr>`)}</table>`}

<h2>Intake pipeline</h2>
<p>${o.intake.items ?? 0} items · researched ${o.intake.researched ?? 0} (spend so far ${Number(o.intake.research_spend_usd ?? 0).toFixed(2)} USD) · live ${o.intake.live ?? 0}</p>
<table><tr><th>Step</th><th>Done</th><th>Waiting for a person</th><th>Queued or waiting</th><th>Listed</th></tr>
${STEPS.map((s) => { const x = o.intake.steps?.[s] ?? {}; return html`<tr><td>${words(s)}</td><td>${x.done ?? 0}</td><td>${x.needs_person ?? 0}</td>
<td>${(x.ready ?? 0) + (x.running ?? 0) + (x.waiting ?? 0)}</td><td>${x.listed ?? 0}</td></tr>`; })}</table>

<h2>Latest (${o.recent.length})</h2>
${o.recent.length === 0 ? html`<p class="muted">Nothing yet.</p>` : html`<table><tr><th>When</th><th>Field</th><th>Item</th><th></th></tr>
${o.recent.map((a) => html`<tr><td>${when(a.created_at)}</td><td>${LABEL[a.field] ?? a.field}</td><td>${a.sku} ${a.name_en}</td>
<td>${a.reverted_at ? html`<span class="warn">undone</span>` : a.applied ? "approved" : html`<span class="muted">logged (rule off)</span>`}</td></tr>`)}</table>`}`);
}

async function check(c: Ctx) {
  const check = id(c, "id");
  const verdict = (["correct", "wrong"] as const).find((v) => v === c.form.verdict);
  if (!verdict) throw new UserError("Choose right or wrong.");
  const note = text(c, "note", 300) || null;
  if (verdict === "wrong" && !note) throw new UserError("Say what is wrong.");
  return act(c, `spot_check_${verdict}`, { check }, async () => {
    const r = await c.deps.db.rpc<{ already?: boolean; status: string; field?: string; rule?: string; undo?: { what?: string } }>("record_spot_check", {
      p_check: check, p_by: c.staff.partyId, p_verdict: verdict, p_note: note });
    if (r.already) return `Already checked (${r.status}).`;
    const label = LABEL[r.field ?? ""] ?? r.field;
    if (r.status === "wrong") return `Marked wrong: the ${label} rule is off, and ${words(r.undo?.what ?? "nothing_to_undo")}.`;
    return r.rule === "switched_on" ? `Marked right: that was the ${label} rule's first passing sample, so it is now on.` : "Marked right.";
  }, "/auto-approvals");
}

async function rule(c: Ctx) {
  const field = (FIELDS as readonly string[]).find((f) => f === c.params.field);
  if (!field) throw new UserError("No such rule. Allergens, diet labels, prices and costs are never automatic.");
  const enabled = c.form.enabled === "on" ? true : c.form.enabled === "off" ? false : null;
  if (enabled === null) throw new UserError("Choose on or off.");
  const note = text(c, "note", 300) || null;
  return act(c, `auto_rule_${enabled ? "on" : "off"}`, { field }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean; enabled: boolean }>("set_auto_approval_rule", { p_field: field, p_enabled: enabled, p_by: c.staff.partyId, p_note: note });
    return r.already ? `The ${LABEL[field]} rule was already ${enabled ? "on" : "off"}.` : `The ${LABEL[field]} rule is now ${enabled ? "on" : "off"}.`;
  }, "/auto-approvals");
}

async function arabic(c: Ctx) {
  const n = (k: string) => { const v = text(c, k, 6); if (!/^\d{1,5}$/.test(v)) throw new UserError(`Type ${k === "checked" ? "how many names were checked" : "how many had an error"}.`); return Number(v); };
  const checked = n("checked"); const errors = n("errors");
  const note = text(c, "note", 300) || null;
  return act(c, "arabic_reader_sample", { checked, errors }, async () => {
    const r = await c.deps.db.rpc<{ passed: boolean; sample_needed: number }>("record_arabic_reader_sample", { p_by: c.staff.partyId, p_checked: checked, p_errors: errors, p_note: note });
    return r.passed ? "Recorded: passed. The names rule may approve model-written Arabic." : `Recorded: not passed (needs ${r.sample_needed} checked with no error).`;
  }, "/auto-approvals");
}

async function retry(c: Ctx) {
  const job = id(c, "id");
  return act(c, "intake_retry", { job }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean; step?: string; status?: string }>("retry_intake_job", { p_job: job, p_by: c.staff.partyId });
    return r.already ? `Already back in the queue (${r.status}).` : `Back in the queue: the ${words(r.step ?? "")} step runs again on the next intake run.`;
  }, "/auto-approvals");
}

export const autoApprovalsSection: Section = {
  nav: { href: "/auto-approvals", label: "Auto approvals", roles: LEADS },
  routes: [
    { method: "GET", path: "/auto-approvals", roles: LEADS, handler: page },
    { method: "POST", path: "/auto-approvals/check/:id", roles: LEADS, handler: check },
    { method: "POST", path: "/auto-approvals/rule/:field", roles: LEADS, handler: rule },
    { method: "POST", path: "/auto-approvals/arabic", roles: LEADS, handler: arabic },
    { method: "POST", path: "/auto-approvals/retry/:id", roles: LEADS, handler: retry },
  ],
};
