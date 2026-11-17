// UX2b: Settings (the reference's `/ops/settings`), admin only: hours and the minimum order, the small-order fee, timers, the cash caps, the pickup
// place, the escalation steps, the two-person limits and the switches (selling requires a label, search by meaning). Every change goes through
// change_setting() (migration 0231), which refuses anyone but an admin, takes only what is on the editable list (data: editable_settings), checks the
// type and bounds, and logs who, when, before, after and why (config_changes). The rules the review calls two-person (the approval limits, the cash
// caps, selling-requires-a-label switched on, the second-person rule switched off) do not change at once: they wait in pending_approvals and are
// made by decide_approval, never by the person who asked (the Approve page shows them as cards). The log is at the foot of the page.
// People, villages and zones, windows, templates and this phone's alerts have their own pages, one link away.
import { act, html, render, text, UserError, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { pick, t, type Lang } from "../i18n";
import { ADMIN } from "../roles";
import { badge, button, dataTable, empty, icon, input } from "@ak/ui/components";
import { GROUP_ORDER, GROUPS, META, settingWords, type GroupId } from "./settingmeta";
import type { Raw } from "../html";

type Item = { key: string; field: string; kind: "int" | "number" | "bool" | "time" | "text" | "enum"; min: number | null; max: number | null; max_len: number | null; choices: string[] | null;
  two_person: boolean; two_person_when: unknown; value: unknown; changed_by_name: string | null; changed_at: string | null;
  pending: { id: string; value: unknown; requested_by: string; requested_by_name: string | null; requested_at: string } | null };
type Log = { at: string; key: string; field: string; before: unknown; after: unknown; reason: string | null; by_name: string | null; approved_by_name: string | null };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The value as a person reads it: on or off, dollars, minutes, or the words. */
export function show(L: Lang, it: Pick<Item, "key" | "field" | "kind">, v: unknown): string {
  if (v === null || v === undefined || v === "") return pick(L, "not set", "غير مضبوط");
  if (it.kind === "bool") return v ? pick(L, "On", "مفعّل") : pick(L, "Off", "معطّل");
  if (it.kind === "enum") return v === "on" ? pick(L, "On", "مفعّل") : pick(L, "Off", "معطّل");
  if ((it.kind === "number" || it.kind === "int") && /usd$/.test(it.field || it.key)) return usd(v);
  if (it.kind === "number" || it.kind === "int") return `${v}${/pct$/.test(it.field) ? "%" : /_min$/.test(it.field) ? ` ${pick(L, "min", "د")}` : ""}`;
  return String(v);
}

async function page(c: Ctx) {
  const L = c.lang;
  const { db } = c.deps;
  const [items, log] = await Promise.all([db.rpc<Item[] | null>("console_settings", {}), db.rpc<Log[] | null>("settings_log", { p_limit: 30 })]);
  if (!items) return render(c, t(L, "g_settings"), html`<p class="note">${pick(L, "Not available yet: the database has no console_settings() (migration 0231 is not applied there yet).", "غير متاح بعد: لا توجد console_settings() في قاعدة البيانات (لم تُطبَّق الهجرة 0231 هناك بعد).")}</p>`, { translated: true });
  const nameOf = (i: Pick<Item, "key" | "field">) => settingWords(L, i.key, i.field);
  const byGroup = (g: GroupId) => items.filter((i) => (META[`${i.key}.${i.field}`]?.group ?? "switches") === g);

  const control = (i: Item): Raw => {
    const label = pick(L, "New value", "القيمة الجديدة");
    if (i.kind === "bool") return html``;
    if (i.kind === "enum") return html`<label class="ak-field"><span>${label}</span><select class="ak-select" name="value">${(i.choices ?? []).map((x) => html`<option value="${x}"${x === i.value ? " selected" : ""}>${show(L, i, x)}</option>`)}</select></label>`;
    if (i.kind === "time") return input({ name: "value", label, type: "time", value: String(i.value ?? ""), required: true });
    if (i.kind === "text") return input({ name: "value", label, value: String(i.value ?? ""), maxlength: i.max_len ?? 120, attrs: i.field.endsWith("_ar") ? { dir: "rtl", lang: "ar" } : {} });
    return input({ name: "value", label, type: "number", value: String(i.value ?? ""), required: true, attrs: { step: i.kind === "int" ? "1" : "0.01", min: String(i.min ?? 0), max: String(i.max ?? ""), inputmode: "decimal" } });
  };
  const item = (i: Item) => {
    const meta = META[`${i.key}.${i.field}`];
    const id = `${i.key}-${i.field}`.replace(/[^a-z_-]/gi, "");
    const unit = meta?.unit?.[L];
    const target = i.kind === "bool" ? !i.value : null;
    const needsTwo = i.two_person && (i.two_person_when === null || i.two_person_when === undefined || (i.kind === "bool" && same(i.two_person_when, target)));
    const pend = i.pending;
    const submit = i.kind === "bool"
      ? button({ label: (target ? pick(L, "Turn on", "فعّل") : pick(L, "Turn off", "عطّل")) + (needsTwo ? pick(L, ": a second person approves", ": يوافق شخص ثانٍ") : ""), variant: target ? "gold" : "soft", icon: target ? "check" : "close" })
      : button({ label: needsTwo ? pick(L, "Ask for a second person to approve", "اطلب موافقة شخص ثانٍ") : pick(L, "Save", "احفظ"), variant: "gold", icon: "check" });
    return html`<li class="ak-setting" id="${id}"><div class="head"><strong>${nameOf(i)}</strong>
<span class="tags"><bdi class="now"><strong>${show(L, i, i.value)}</strong>${unit && i.kind !== "bool" && i.kind !== "enum" ? html` <span class="muted">${unit}</span>` : ""}</bdi>${i.two_person ? badge(pick(L, "two-person", "شخصان"), "gold", "users") : ""}</span></div>
${meta?.help ? html`<p class="muted">${meta.help[L]}</p>` : ""}
<p class="ak-who">${i.changed_at ? pick(L, `Last changed by ${i.changed_by_name ?? "staff"}, ${when(i.changed_at)}`, `آخر تغيير: ${i.changed_by_name ?? "موظف"}، ${when(i.changed_at)}`) : pick(L, "Not changed from this page yet.", "لم يُغيَّر من هذه الصفحة بعد.")}</p>
${pend ? html`<p class="note">${icon("clock")} <strong>${pick(L, "Waiting for a second person:", "بانتظار شخص ثانٍ:")}</strong> ${show(L, i, pend.value)} (${pick(L, "asked by", "طلبها")} ${pend.requested_by_name ?? ""}, ${when(pend.requested_at)}). <a href="/approve?tab=money">${pick(L, "Open it on the Approve page", "افتحها في صفحة الموافقات")}</a></p>` : ""}
<details class="ak-more"><summary>${icon("settings")} ${pick(L, "Change", "غيّر")}</summary>
${form(c.f, "/settings/change", html`<input type="hidden" name="key" value="${i.key}"><input type="hidden" name="field" value="${i.field}">${i.kind === "bool" ? html`<input type="hidden" name="value" value="${target ? "true" : "false"}">` : ""}
<div class="ak-money-fields">${control(i)}${input({ name: "reason", label: pick(L, "Why (logged with your name)", "السبب (يُسجَّل باسمك)"), required: true, maxlength: 200, attrs: { minlength: "3" } })}</div>
${needsTwo ? html`<p class="muted">${pick(L, "This change waits for another ops lead or admin; the person who asked can never approve it.", "ينتظر هذا التغيير مسؤول عمليات أو مدير آخر؛ ومن طلبه لا يستطيع الموافقة عليه أبداً.")}</p>` : ""}
<div class="actions-row">${submit}</div>`)}</details></li>`;
  };
  const groups = GROUP_ORDER.map((g) => ({ g, rows: byGroup(g) })).filter((x) => x.rows.length);

  const links = [
    ["/staff", pick(L, "People and roles", "الأشخاص والأدوار"), pick(L, "add, change a role, block", "إضافة وتغيير دور وحظر")],
    ["/zones", pick(L, "Zones, villages and delivery fees", "المناطق والقرى ورسوم التوصيل"), pick(L, "which villages are served, each zone's fee and time", "أي قرى تُخدم، ورسم كل منطقة ووقتها")],
    ["/windows", pick(L, "Delivery windows and the calendar", "نوافذ التوصيل والتقويم"), pick(L, "capacity, cut-offs, Ramadan and holidays", "السعة وآخر المواعيد ورمضان والعطل")],
    ["/templates", pick(L, "Message templates", "قوالب الرسائل"), pick(L, "their status and what is sent meanwhile", "حالتها وما يُرسل في الأثناء")],
    ["/more", pick(L, "Alerts on this phone, language, appearance", "التنبيهات على هذا الهاتف واللغة والمظهر"), pick(L, "switch push alerts on for this phone", "فعّل تنبيهات الدفع على هذا الهاتف")],
  ] as const;

  return render(c, t(L, "g_settings"), html`
<p class="muted">${pick(L, "Admin only. Each change is logged with who and when. A rule that needs two people waits on the Approve page until another ops lead or admin approves it. The database checks every value again.", "للمدير فقط. يُسجَّل كل تغيير بالاسم والوقت. القاعدة التي تحتاج شخصين تنتظر في صفحة الموافقات حتى يوافق مسؤول عمليات أو مدير آخر. وتفحص قاعدة البيانات كل قيمة من جديد.")}</p>
<ul class="hub">${links.map(([href, name, note]) => html`<li><a href="${href}"><span>${name}<br><small class="muted">${note}</small></span></a></li>`)}</ul>
${groups.map(({ g, rows }) => html`<section class="ak-card" id="${g}"><h2>${GROUPS[g].title[L]}</h2><p class="muted">${GROUPS[g].note[L]}</p><ul class="ak-rows">${rows.map(item)}</ul></section>`)}
<section class="ak-card" id="log"><h2>${pick(L, "Change log", "سجل التغييرات")}</h2>
${dataTable({ caption: pick(L, "Changes made on this page", "التغييرات التي جرت في هذه الصفحة"), empty: empty({ title: pick(L, "No change made from this page yet.", "لم يُجرَ أي تغيير من هذه الصفحة بعد."), icon: "list" }),
  columns: [{ label: pick(L, "When", "الوقت") }, { label: pick(L, "Who", "من") }, { label: pick(L, "Setting", "الإعداد"), wrap: true }, { label: pick(L, "Before", "قبل") }, { label: pick(L, "After", "بعد") }, { label: pick(L, "Why", "السبب"), wrap: true }, { label: pick(L, "Approved by", "وافق") }],
  rows: (log ?? []).map((x) => { const it = items.find((i) => i.key === x.key && i.field === x.field) ?? { key: x.key, field: x.field, kind: "text" as const };
    return { cells: [when(x.at), x.by_name ?? "", settingWords(L, x.key, x.field), show(L, it, x.before), show(L, it, x.after), x.reason ?? "", x.approved_by_name ?? "—"] }; }) })}</section>`, { translated: true });
}

/** Reads the form into the JSON value change_setting() takes, by the field's own type (from the database's list, never the browser's word for it). */
async function change(c: Ctx) {
  const L = c.lang;
  const key = text(c, "key", 60), field = c.form.field === undefined ? "" : text(c, "field", 60);
  const reason = text(c, "reason", 200);
  const items = (await c.deps.db.rpc<Item[] | null>("console_settings", {})) ?? [];
  const it = items.find((x) => x.key === key && x.field === field);
  if (!it) throw new UserError(pick(L, "That is not a setting this page changes.", "هذا ليس إعداداً تغيّره هذه الصفحة."));
  if (reason.length < 3) throw new UserError(pick(L, "Write why: the reason is logged with your name.", "اكتب السبب: يُسجَّل باسمك."));
  const raw = (c.form.value ?? "").trim();
  let value: unknown;
  if (it.kind === "bool") { if (raw !== "true" && raw !== "false") throw new UserError(pick(L, "Choose on or off.", "اختر التفعيل أو التعطيل.")); value = raw === "true"; }
  else if (it.kind === "int" || it.kind === "number") { const n = Number(raw.replace(/,/g, "")); if (raw === "" || !Number.isFinite(n)) throw new UserError(pick(L, "Type a number.", "اكتب رقماً.")); value = n; }
  else value = raw;
  const name = settingWords(L, key, field);
  return act(c, "setting_change", { key, field, value, reason }, async () => {
    const r = await c.deps.db.rpc<{ status: string; duplicate?: boolean }>("change_setting", { p_key: key, p_field: field, p_value: JSON.stringify(value), p_by: c.staff.partyId, p_reason: reason });
    if (r.status === "awaiting_approval") return r.duplicate
      ? pick(L, `${name} is already waiting for a second person.`, `${name} بانتظار شخص ثانٍ بالفعل.`)
      : pick(L, `Waiting for a second person: ${name} changes when another ops lead or admin approves it on the Approve page.`, `بانتظار شخص ثانٍ: يتغيّر «${name}» حين يوافق مسؤول عمليات أو مدير آخر في صفحة الموافقات.`);
    if (r.status === "unchanged") return pick(L, `Nothing changed: ${name} already is ${show(L, it, value)}.`, `لم يتغيّر شيء: «${name}» هو ${show(L, it, value)} بالفعل.`);
    return pick(L, `Saved: ${name} is now ${show(L, it, value)}.`, `تم الحفظ: «${name}» الآن ${show(L, it, value)}.`);
  }, "/settings");
}

export const settingsSection: Section = {
  nav: { href: "/settings", label: "Settings", roles: ADMIN },
  routes: [
    { method: "GET", path: "/settings", roles: ADMIN, handler: page },
    { method: "POST", path: "/settings/change", roles: ADMIN, handler: change },
  ],
};
