// AUTO1 (docs/DECISIONS.md, "AUTO1, approvals by rule, 19 November 2026"): "a person approves the rule; the rule approves the item". On the
// Auto-approvals list (Approvals, Auto-approvals, "As a list"): the two rules a person approved and whether each is on (and why one is off),
// everything they decided today with Undo on each (one tap; automation_undo puts back what the rule did), the week's checks (right or wrong;
// more than one wrong switches the rule off by itself), and the pictures a re-check disagrees with (never changed by it: the founder decides).
// Writes only through automation_undo and record_automation_check, as the signed-in staff member. Ops lead and admin.
import { act, html, id, text, UserError, type Ctx } from "../app";
import { form, when } from "../html";
import { pick } from "../i18n";
import type { AutomationOverview } from "./approve";

type Recheck = { checked: number; agrees: number; disagrees: number; unsure: number;
  rows: { image_id: string; sku: string; name_en: string; outcome: string; reason: string; confidence: number; still_approved: boolean }[] };

const KIND: Record<string, [string, string]> = { dish: ["Dish", "طبق"], photo: ["Picture", "صورة"], menu: ["Menu stamped", "ختم القائمة"] };
const ACTION: Record<string, [string, string]> = { approved: ["approved", "مقبول"], rejected: ["rejected", "مرفوض"], stamped: ["checked", "مفحوصة"] };

export async function automationPart(c: Ctx) {
  const L = c.lang;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(c.url.searchParams.get("day") ?? "") ? c.url.searchParams.get("day") : null;
  const o = await c.deps.db.rpc<AutomationOverview | null>("automation_overview", { p_limit: 60 }).catch(() => null);
  if (!o) return html`<p class="note">${pick(L, "Approval by rule is not on this database yet (migrations 0263 and 0264).", "الموافقة بالقاعدة ليست في قاعدة البيانات بعد (0263 و0264).")}</p>`;
  const today = day ? await c.deps.db.rpc<AutomationOverview["today"]>("automation_today", { p_day: day }).catch(() => o.today) : o.today;
  const rech = await c.deps.db.rpc<Recheck | null>("photo_recheck_report", {}).catch(() => null);
  const rules = (["dish", "photo"] as const).map((k) => ({ k, r: o.rules?.[k] }));
  const decisions = today?.decisions ?? [];
  return html`<h2>${pick(L, "Approved by a rule a person approved", "موافقة بقاعدة وافق عليها شخص")}</h2>
<p>${pick(L, "The founder's decision of 19 November: a person approves the rule; the rule approves the item. Every automatic decision is recorded with its rule and version, and can be undone in one tap.",
          "قرار المؤسس في 19 تشرين الثاني: شخص يوافق على القاعدة، والقاعدة توافق على الصنف. كل قرار تلقائي مسجّل مع قاعدته ونسختها، ويمكن التراجع عنه بنقرة.")}</p>
<table><tr><th>${pick(L, "Rule", "القاعدة")}</th><th>${pick(L, "State", "الحالة")}</th></tr>
${rules.map(({ k, r }) => html`<tr><td><strong>${k === "dish" ? pick(L, "Dishes from menus", "أطباق القوائم") : pick(L, "Product pictures", "صور المنتجات")}</strong> <small class="muted"><bdi>${r?.version ?? ""}</bdi></small></td>
<td>${r?.enabled ? html`<strong>${pick(L, "on", "تعمل")}</strong>` : html`<span class="warn">${pick(L, "off", "متوقفة")}</span>${r?.off_reason ? html`<br><small class="warn"><bdi>${r.off_reason}</bdi></small>` : ""}`}
<br><small class="muted">${pick(L, "Switched on or off on the Settings page (admin).", "تُشغَّل أو توقَف من صفحة الإعدادات (المدير).")}</small></td></tr>`)}
</table>
<p class="muted">${pick(L, "Never by rule: a price to confirm, an unclear name, a price change or removal on re-import, allergens and label readings, a picture with Hebrew text, a health claim, another shop's branding or a price tag. Visibility and approving a place stay a person's.",
  "لا شيء بالقاعدة: سعر للتأكيد، اسم غير واضح، تغيير سعر أو حذف عند إعادة الاستيراد، مسببات الحساسية وقراءات الملصقات، صورة فيها كتابة عبرية أو ادعاء صحي أو علامة متجر آخر أو بطاقة سعر. الظهور والموافقة على مكان تبقى لشخص.")}</p>

<h2 id="automatic-today">${pick(L, "Approved automatically", "تمت الموافقة تلقائياً")} · ${today?.day ?? ""} (${decisions.length})</h2>
${decisions.length === 0 ? html`<p class="muted">${pick(L, "Nothing decided by a rule on this day.", "لم تقرّر القاعدة شيئاً في هذا اليوم.")}</p>` : html`<table>
<tr><th>${pick(L, "When", "متى")}</th><th>${pick(L, "What", "ماذا")}</th><th>${pick(L, "Why", "لماذا")}</th><th></th></tr>
${decisions.map((d) => html`<tr><td>${when(d.at)}</td><td>${pick(L, KIND[d.kind]?.[0] ?? d.kind, KIND[d.kind]?.[1] ?? d.kind)} ${pick(L, ACTION[d.action]?.[0] ?? d.action, ACTION[d.action]?.[1] ?? d.action)}:
<strong><bdi>${d.title}</bdi></strong>${d.place ? html` <span class="muted">· <bdi>${d.place}</bdi></span>` : ""}</td><td><small><bdi>${d.reason}</bdi></small> <small class="muted"><bdi>${d.version}</bdi></small></td>
<td>${d.undone ? html`<span class="muted">${pick(L, "undone", "تم التراجع")}${d.undone_by ? html` (<bdi>${d.undone_by}</bdi>)` : ""}</span>`
  : form(c.f, `/automation/undo/${d.id}`, html`<button>${pick(L, "Undo", "تراجع")}</button>`)}</td></tr>`)}</table>`}
<form method="get" action="/approve"><input type="hidden" name="tab" value="auto"><input type="hidden" name="view" value="list"><label>${pick(L, "Another day", "يوم آخر")} <input type="date" name="day" value="${today?.day ?? ""}"></label> <button>${pick(L, "Show", "اعرض")}</button></form>

<h2>${pick(L, "This week's checks", "فحوص هذا الأسبوع")} (${o.checks_waiting ?? 0})</h2>
<p class="muted">${pick(L, "Each Monday 50 of last week's automatic decisions of each kind come here, one card at a time (Approvals, Auto-approvals). A wrong one is undone at once; more than one wrong switches that rule off, and Today says why.",
  "كل إثنين تأتي هنا 50 من قرارات الأسبوع الماضي التلقائية من كل نوع، بطاقة بطاقة (الموافقات، الموافقات التلقائية). الخاطئ يُتراجع عنه فوراً؛ وأكثر من خطأ واحد يوقف تلك القاعدة، وتقول صفحة اليوم السبب.")}</p>

${rech && rech.checked > 0 ? html`<h2>${pick(L, "Re-check of approved pictures", "إعادة فحص الصور المقبولة")}</h2>
<p>${pick(L, `${rech.checked} checked: ${rech.agrees} agree, ${rech.disagrees} disagree, ${rech.unsure} unsure. Nothing was changed; withdraw a picture on Photos if it is wrong.`,
  `فُحصت ${rech.checked}: ${rech.agrees} متفقة، ${rech.disagrees} مختلفة، ${rech.unsure} غير متأكدة. لم يتغير شيء؛ اسحب الصورة من صفحة الصور إن كانت خاطئة.`)}</p>
${rech.rows.length ? html`<table><tr><th>${pick(L, "Item", "الصنف")}</th><th>${pick(L, "The check says", "يقول الفحص")}</th></tr>
${rech.rows.map((r) => html`<tr><td><bdi>${r.sku}</bdi> <bdi>${r.name_en}</bdi></td><td>${r.outcome === "disagrees" ? html`<strong>${pick(L, "disagrees", "مختلف")}</strong>` : pick(L, "unsure", "غير متأكد")}: <bdi>${r.reason}</bdi></td></tr>`)}</table>` : ""}` : ""}`;
}

export async function undo(c: Ctx) {
  const decision = id(c, "id");
  const note = text(c, "note", 300) || null;
  return act(c, "automation_undo", { decision }, async () => {
    const r = await c.deps.db.rpc<{ already?: boolean; what?: string }>("automation_undo", { p_decision: decision, p_by: c.staff.partyId, p_note: note });
    if (r.already) return "Already undone.";
    const words: Record<string, string> = { dish_back_in_the_queue: "Undone: the dish is back in the queue and off sale (or at its earlier price).",
      picture_back_in_the_queue: "Undone: the picture is back in Photos for a person; an earlier picture is back.", stamp_put_back: "Undone: the menu's stamp is as it was.",
      dish_changed_since_left_as_is: "Recorded as undone; the dish was changed by a person since, so it is left as it is.",
      picture_changed_since_left_as_is: "Recorded as undone; the picture was changed by a person since, so it is left as it is.",
      stamp_changed_since_left_as_is: "Recorded as undone; the menu was stamped by a person since." };
    return words[r.what ?? ""] ?? "Undone.";
  }, "/approve?tab=auto&view=list");
}

export async function weekCheck(c: Ctx) {
  const check = id(c, "id");
  const verdict = (["correct", "wrong"] as const).find((v) => v === c.form.verdict);
  if (!verdict) throw new UserError("Choose right or wrong.");
  const note = text(c, "note", 300) || null;
  if (verdict === "wrong" && !note) throw new UserError("Say what is wrong.");
  return act(c, `automation_check_${verdict}`, { check }, async () => {
    const r = await c.deps.db.rpc<{ already?: boolean; status: string; switched_off?: boolean }>("record_automation_check", { p_check: check, p_by: c.staff.partyId, p_verdict: verdict, p_note: note });
    if (r.already) return `Already checked (${r.status}).`;
    if (r.status === "wrong") return r.switched_off ? "Marked wrong and undone. That is more than one wrong this week: the rule is now off (Today says why)." : "Marked wrong and undone.";
    return "Marked right.";
  }, "/approve?tab=auto&view=list");
}
