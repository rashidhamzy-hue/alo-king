// Template health (OPS1, strategy 05 section A "Settings"). Read only. For every WhatsApp template we keep: where it stands with Meta
// (approved, pending, moved to marketing, not usable) and what is sent in its place meanwhile. The rule is in SQL (template_sendable,
// 0121; the view template_health, 0142). A template Meta filed as marketing is never sent (CLAUDE.md invariant 17).
import { html, render, type Ctx, type Section } from "../app";
import { LEADS } from "../roles";

interface Row { name: string; line: string; language: string; category: string; status: string; state: string; fallback: string; skips_7d: number | string }
const STATE: Record<string, string> = { approved: "Approved", pending: "Pending", moved_to_marketing: "Moved to marketing", not_usable: "Not usable" };
const FALLBACK: Record<string, string> = {
  none_needed: "Not needed: the template is sent",
  free_text_in_24h_window: "The same words as free text, only inside the customer's 24-hour window; outside it the message is skipped and logged",
  text_to_the_registered_phone: "Text to the registered phone (the staff line has no templates while testing)",
};

async function page(c: Ctx) {
  let rows: Row[] = [];
  try { rows = await c.deps.db.rows<Row>("template_health", { select: "name,line,language,category,status,state,fallback,skips_7d", order: [{ col: "state" }, { col: "name" }] }); }
  catch { return render(c, "Template health", html`<p class="note">The database has no template_health view yet (migration 0142 has not reached it). See "OPS1" in docs/HANDOFF.md.</p>`); }
  const count = (s: string) => rows.filter((r) => r.state === s).length;
  return render(c, "Template health", html`
<p>${count("approved")} approved, ${count("pending")} pending, ${count("moved_to_marketing")} moved to marketing, ${count("not_usable")} not usable.</p>
<p class="muted">Meta decides. The hourly sync reads its answer. A template filed as marketing is never sent, whatever its status: invariant 17.</p>
<table><tr><th>Template</th><th>Line</th><th>State</th><th>Meta: status, category</th><th>What is sent meanwhile</th><th>Skipped, 7 days</th></tr>
${rows.map((r) => html`<tr><td>${r.name}</td><td>${r.line}</td><td>${STATE[r.state] ?? r.state}</td><td>${r.status}, ${r.category}</td>
<td>${r.state === "moved_to_marketing" ? html`Never sent. ` : ""}${FALLBACK[r.fallback] ?? r.fallback}</td><td>${Number(r.skips_7d)}</td></tr>`)}</table>`);
}

export const templatesSection: Section = {
  nav: { href: "/templates", label: "Template health", roles: LEADS },
  routes: [{ method: "GET", path: "/templates", roles: LEADS, handler: page }],
};
