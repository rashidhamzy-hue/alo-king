// LB1: the approval queue of the label day, in the order of one sitting (docs/NEXT_SESSIONS.md, LB1; migration 0211, approval_queue()):
//   1 allergens   2 halal, diet labels and certificates   3 hazard and printed warnings   4 disagreements between sources   5 the rest
// A person (the ops lead or an admin) decides each row against the pack photo: confirm as read, confirm with a correction, or reject. The
// database approves (review_proposed_fact, review_field_value, review_claim, review_certificate) and refuses anyone else; nothing here
// approves by itself, and a web or Open Food Facts proposal on its own is never in the list (the label replaces them). Functional only.
import { attempt, flashRedirect, html, id, render, returnTo, text, UserError, type Ctx, type Section } from "../app";
import { form } from "../html";
import { pick } from "../i18n";
import { LEADS } from "../roles";
import { intakeTabs } from "./intakeframe";
import { button } from "@ak/ui/components";

export type Row = { group: number; kind: "fact" | "field" | "claim" | "certificate"; id: string; product_id: string; sku: string; name_en: string; name_ar: string | null; aisle: string;
  label: string; value_text: string; quote: string | null; source: string; disagrees: { source: string; value?: unknown; page_url?: string }[] | null;
  photos: { front: string | null; back: string | null; side: string | null } };
const SHOWN = 60;
export const GROUP = (L: "en" | "ar", g: number) => [
  [pick(L, "Allergens", "مسبّبات الحساسية"), pick(L, "Each answered from the pack: contains, may contain or free.", "كل واحد يُجاب من العبوة: يحتوي أو قد يحتوي أو خالٍ.")],
  [pick(L, "Halal, diet labels and certificates", "الحلال وبطاقات الحمية والشهادات"), pick(L, "Only where the pack or the certificate says it.", "فقط حيث تقوله العبوة أو الشهادة.")],
  [pick(L, "Hazard and printed warnings", "تحذيرات الخطر والتحذيرات المطبوعة"), pick(L, "Each line exactly as printed.", "كل سطر كما هو مطبوع.")],
  [pick(L, "Disagreements between sources", "اختلاف المصادر"), pick(L, "The label's reading is shown with what another source said.", "قراءة الملصق مع ما قالته مصادر أخرى.")],
  [pick(L, "The rest of the label readings", "بقية قراءات الملصقات"), pick(L, "Ingredients, nutrition, claims and other fields.", "المكوّنات والقيم الغذائية والادعاءات وحقول أخرى.")],
][g - 1]!;
export const LIST_FIELDS = new Set(["hazard_warnings", "warnings_as_printed", "pictograms"]);
export const label = (s: string) => s.replace(/_/g, " ");

async function page(c: Ctx) {
  const L = c.lang;
  const all = (await c.deps.db.rpc<Row[] | null>("approval_queue", { p_limit: 400 })) ?? [];
  const rows = all.slice(0, SHOWN);
  const links = new Map<string, Record<string, string | null>>();
  await Promise.all([...new Set(rows.map((x) => x.product_id))].map(async (p) => {
    const ph = rows.find((x) => x.product_id === p)!.photos;
    const sign = async (path: string | null) => (path ? c.deps.media.sign(path, 900) : null);
    links.set(p, { front: await sign(ph.front), back: await sign(ph.back), side: await sign(ph.side) });
  }));
  const edit = (x: Row) => {
    if (x.kind === "fact" && /^(milk|eggs|gluten|crustaceans|fish|peanuts|soy|tree_nuts|celery|mustard|sesame|sulphites|lupin|molluscs)$/.test(x.label))
      return html`<label>${pick(L, "The pack says", "العبوة تقول")} <select name="value">${["contains", "may_contain", "free"].map((v) => html`<option${v === x.value_text ? " selected" : ""}>${v}</option>`)}</select></label>`;
    if (x.kind === "fact" && ["halal", "vegetarian", "vegan"].includes(x.label))
      return html`<label>${pick(L, "The pack says", "العبوة تقول")} <select name="value">${["yes", "no"].map((v) => html`<option${v === x.value_text ? " selected" : ""}>${v}</option>`)}</select></label>`;
    if (x.kind === "field" && LIST_FIELDS.has(x.label)) return html`<label>${pick(L, "One line each, as printed", "سطر لكل تحذير كما هو مطبوع")}<br><textarea name="corrected" rows="3">${x.value_text.split("; ").join("\n")}</textarea></label>`;
    if (x.kind === "field") return html`<label>${pick(L, "As printed", "كما هو مطبوع")}<br><input name="corrected" value="${x.value_text}" maxlength="500"></label>`;
    return "";
  };
  const row = (x: Row) => {
    const ph = links.get(x.product_id) ?? {};
    return html`<li class="card"><p><strong><a href="/intake/${x.product_id}">${x.name_en}</a></strong> <bdi class="muted">${x.name_ar ?? ""}</bdi><br><small class="muted">${x.aisle} · ${x.sku}</small></p>
<p><strong>${label(x.label)}</strong>: <bdi>${x.value_text}</bdi>${x.quote ? html`<br><span class="muted">${pick(L, "printed words", "الكلمات المطبوعة")}: “${x.quote}”</span>` : ""}</p>
${x.disagrees?.length ? html`<p class="note">${pick(L, "Another source said otherwise:", "مصدر آخر قال غير ذلك:")} ${x.disagrees.map((d) => `${d.source}${d.value !== undefined ? `: ${typeof d.value === "string" ? d.value : JSON.stringify(d.value)}` : ""}`).join("; ")}</p>` : ""}
<p>${(["front", "back", "side"] as const).map((s) => ph[s] ? html`<a class="ak-btn" href="${ph[s]!}">${pick(L, { front: "Front photo", back: "Back photo", side: "Side photo" }[s], { front: "صورة الواجهة", back: "صورة الخلف", side: "صورة الجانب" }[s])}</a> ` : "")}</p>
${form(c.f, `/label-queue/${x.kind}/${x.id}/confirm`, html`<p>${edit(x)}</p><p><button>${pick(L, "Confirm", "أكّد")}</button></p>`)}
${form(c.f, `/label-queue/${x.kind}/${x.id}/reject`, html`<input name="note" placeholder="${pick(L, "why (optional)", "السبب (اختياري)")}" maxlength="200"> <button class="secondary">${pick(L, "Reject", "ارفض")}</button>`)}</li>`;
  };
  const groups = [1, 2, 3, 4, 5].map((g) => ({ g, rows: rows.filter((x) => x.group === g), total: all.filter((x) => x.group === g).length })).filter((x) => x.total > 0);
  return render(c, pick(L, "Label approvals", "موافقات الملصقات"), html`${intakeTabs(c, "approvals", { approvals: all.length })}
<p>${button({ label: pick(L, "Decide one card at a time", "قرّر بطاقة بطاقة"), href: "/approve?tab=labels", variant: "gold", icon: "approve" })}</p>
<p class="muted">${pick(L, "In the order of one sitting. Decide each row against the pack photo; nothing is published until you confirm it. A web page on its own never appears here: the label replaces it.",
  "بترتيب جلسة واحدة. قرّر في كل صف بالنظر إلى صورة العبوة؛ لا يُنشر شيء حتى تؤكده. صفحة الويب وحدها لا تظهر هنا: الملصق يحلّ محلها.")}</p>
${all.length === 0 ? html`<p class="flash ok">${pick(L, "Nothing waits for a person.", "لا شيء ينتظر شخصاً.")}</p>` : html`<p>${all.length} ${pick(L, "waiting", "بالانتظار")}${all.length > SHOWN ? ` (${pick(L, `the first ${SHOWN} are shown; the rest after you decide these`, `أول ${SHOWN} معروضة؛ والبقية بعد أن تقرّر هذه`)})` : ""}</p>`}
${groups.map(({ g, rows: rs, total }) => html`<h2 data-group="${g}">${GROUP(L, g)[0]} (${total})</h2><p class="muted">${GROUP(L, g)[1]}</p><ul class="cap-list queue">${rs.map(row)}</ul>`)}`, { translated: true });
}

const KINDS = ["fact", "field", "claim", "certificate"] as const;
async function decide(c: Ctx) {
  const L = c.lang;
  const kind = c.params.kind ?? "";
  const decision = c.params.decision === "confirm" ? "confirm" : c.params.decision === "reject" ? "reject" : null;
  if (!(KINDS as readonly string[]).includes(kind) || !decision) throw new UserError(pick(L, "Unknown decision.", "قرار غير معروف."));
  const rid = id(c, "id");
  const note = text(c, "note", 200) || null;
  const db = c.deps.db;
  return attempt(c, `label_queue_${decision}`, { kind, id: rid }, async () => {
    if (kind === "fact") {
      if (decision === "reject") await db.rpc("review_proposed_fact", { p_fact: rid, p_by: c.staff.partyId, p_decision: "reject", p_note: note });
      else await db.rpc("review_proposed_fact", { p_fact: rid, p_by: c.staff.partyId, p_decision: "confirm", p_value: text(c, "value", 20) || null, p_status: "declared", p_detail: null, p_evidence: null, p_note: null, p_expires_at: null });
    } else if (kind === "field") {
      let corrected: { value: unknown } | null = null;
      if (decision === "confirm" && c.form.corrected !== undefined) {
        const now = (await db.rows<{ value: unknown }>("product_field_values", { select: "value", where: { id: rid }, limit: 1 }))[0]?.value;
        if (Array.isArray(now)) {
          const lines = c.form.corrected.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
          if (JSON.stringify(lines) !== JSON.stringify(now)) corrected = { value: lines };
        } else if (typeof now === "string") {
          const v = text(c, "corrected", 500);
          if (v && v !== now) corrected = { value: v };
        }
      }
      await db.rpc("review_field_value", { p_value: rid, p_by: c.staff.partyId, p_decision: decision, p_note: note, p_corrected: corrected });
    } else if (kind === "claim") await db.rpc("review_claim", { p_claim: rid, p_by: c.staff.partyId, p_decision: decision, p_note: note });
    else await db.rpc("review_certificate", { p_certificate: rid, p_by: c.staff.partyId, p_decision: decision, p_note: note });
    return decision === "confirm" ? pick(L, "Confirmed against the pack and published.", "تم التأكيد مقابل العبوة والنشر.") : pick(L, "Rejected: nothing is published from it.", "رُفض: لا يُنشر منه شيء.");
  }).then((r) => flashRedirect(c.deps, returnTo(c, "/label-queue"), r.logged ? r.msg : { err: pick(L, "Not done: the action log could not be written. Try again in a minute.", "لم يتم: تعذّر تسجيل الإجراء. حاول بعد دقيقة.") }));
}

export const labelQueueSection: Section = {
  nav: { href: "/label-queue", label: "Label approvals", roles: LEADS },
  routes: [
    { method: "GET", path: "/label-queue", roles: LEADS, handler: page },
    { method: "POST", path: "/label-queue/:kind/:id/:decision", roles: LEADS, handler: decide },
  ],
};
