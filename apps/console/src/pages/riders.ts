// 3.4 Cash drops and rider payouts. Confirm a declared drop per currency (confirm_cash_drop), show rider_statement(),
// pay the rider's earnings (pay_rider_earnings), end the shift (close_shift, never forced from here), and send the rider an
// end-of-shift message with the same figures, through the gateway on the ops line (invariants 1 and 9).
// The delivery fee and tips are the rider's (invariant 10): the statement and the payout come from the SQL, not from here.
// F1: the hub pays the part of a rider's earnings their cash does not cover only from what the drawer holds (0105); a damaged
// note found in a confirmed hub drop is recorded once per form (record_damaged_note, 0105); and each rider's cash over/short at
// the door today, with what they owe for shortfalls beyond the tolerance, comes from day_close_report (0104).
import { act, can, html, id, num, render, text, upload, UserError, type Ctx, type Section } from "../app";
import { DbError } from "../db";
import { form, lbp, usd, when } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { moneyTabs } from "./moneyframe";
import { badge, button, card, empty, icon, input, limitBar, tabs } from "@ak/ui/components";

type Drop = { id: string; driver_id: string; method: string; declared_usd: number | string; declared_lbp: number | string; receipt_ref: string | null;
  receipt_media_path: string | null; created_at: string };
type Statement = { cash_held_usd: number | string; earnings_usd: number | string; to_hand_over_usd: number | string };
type DayRider = { rider_id: string; over_short_usd: number | string; short_owed_usd: number | string; cod_flags: number | string };
type Note = { drop_id: string; amount_usd: number | string; absorbed_by: string };

const formKey = (c: Ctx) => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60); return k.length >= 8 ? `console:${k}` : null; };

/** Plain words for the refusals only this page meets (the shared ones are in app.ts). */
async function plain<T>(p: Promise<T>, drawer: string): Promise<T> {
  try { return await p; }
  catch (e) {
    if (e instanceof DbError && /^NOT_ENOUGH_CASH hub_cash/.test(e.message)) throw new UserError(drawer);
    if (e instanceof DbError && /^EXCEEDS_DROP/.test(e.message)) throw new UserError("That is more than this drop (with the damaged notes already recorded on it).");
    throw e;
  }
}

async function riderFigures(c: Ctx, driver: string) {
  const [st, native] = await Promise.all([
    c.deps.db.rpc<Statement>("rider_statement", { p_driver: driver }),
    c.deps.db.rpc<{ usd: number | string; lbp: number | string }[]>("driver_cash_native", { p_driver: driver }),
  ]);
  const n = Array.isArray(native) ? native[0] : null;
  return { held: Number(st?.cash_held_usd ?? 0), earnings: Number(st?.earnings_usd ?? 0), handOver: Number(st?.to_hand_over_usd ?? 0),
           usd: Number(n?.usd ?? 0), lbp: Number(n?.lbp ?? 0) };
}

/** Money, Cash drops: what each rider holds and is owed, the drop they declared (to count and confirm), payouts, statements and damaged notes. */
async function drops(c: Ctx) {
  const { db, media } = c.deps;
  const L = c.lang;
  const declared = await db.rows<Drop>("cash_drops", { select: "id,driver_id,method,declared_usd,declared_lbp,receipt_ref,receipt_media_path,created_at", where: { status: "declared" }, order: [{ col: "created_at" }] });
  const drivers = await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { role: "driver", is_blocked: false }, order: [{ col: "display_name" }], limit: 200 });
  const open = new Map((await db.rows<{ id: string; driver_id: string; started_at: string }>("driver_shifts", { select: "id,driver_id,started_at", where: { ended_at: null } })).map((s) => [s.driver_id, s]));
  const name = (d: string) => drivers.find((x) => x.id === d)?.display_name ?? pick(L, "Rider", "مندوب");
  const figures = await Promise.all(drivers.map((d) => riderFigures(c, d.id)));
  const rows = drivers.map((d, i) => ({ ...d, f: figures[i]!, shift: open.get(d.id), drops: declared.filter((x) => x.driver_id === d.id) }))
    .filter((x) => x.shift || Math.abs(x.f.held) > 0.004 || Math.abs(x.f.earnings) > 0.004 || x.drops.length);
  const receipts = new Map(await Promise.all(declared.map(async (d) => [d.id, d.receipt_media_path ? await media.sign(d.receipt_media_path, 300) : null] as const)));
  const today = new Map(((await db.rpc<{ riders?: DayRider[] }>("day_close_report", {}))?.riders ?? []).map((x) => [x.rider_id, x]));
  const confirmed = (await db.rows<Drop & { confirmed_at: string }>("cash_drops", { select: "id,driver_id,method,declared_usd,declared_lbp,confirmed_at",
    where: { status: "confirmed", method: "hub" }, order: [{ col: "confirmed_at", desc: true }], limit: 10 }));
  const notes = confirmed.length ? await db.rows<Note>("damaged_notes", { select: "drop_id,amount_usd,absorbed_by", where: { drop_id: { in: confirmed.map((d) => d.id) } } }) : [];
  const overShort = (d: string) => {
    const t = today.get(d);
    if (!t || (Math.abs(Number(t.over_short_usd)) < 0.005 && Number(t.cod_flags) === 0)) return html`<span class="muted">${pick(L, "none", "لا شيء")}</span>`;
    const os = Number(t.over_short_usd), owed = Number(t.short_owed_usd);
    return L === "ar"
      ? html`${os < 0 ? "ناقص" : "زائد"} ${usd(Math.abs(os))}${owed > 0.004 ? html` · <strong>عليه ${usd(owed)}</strong>` : ""}`
      : html`${os < 0 ? "short" : "over"} ${usd(Math.abs(os))}${owed > 0.004 ? html` · <strong>owes ${usd(owed)}</strong>` : ""}`;
  };

  return render(c, pick(L, "Cash drops and rider payouts", "تسليم النقد ودفعات المناديب"), html`${await moneyTabs(c, "drops")}
<p class="muted">${pick(L, "Count the cash with the rider, note by note, per currency. Confirm only what you counted. The counted figure is recorded; the expected one is never edited.", "اعدّ النقد مع المندوب ورقة ورقة لكل عملة. أكّد ما عددته فقط. يُسجَّل المبلغ المعدود ولا يُعدَّل المتوقع أبداً.")}</p>
<h2>${pick(L, `Cash drops to confirm (${declared.length})`, `تسليمات نقد للتأكيد (${declared.length})`)}</h2>
${rows.length === 0 ? empty({ title: pick(L, "No rider on shift or holding money.", "لا مندوب في الوردية ولا يحمل مالاً."), icon: "wallet" }) : html`<div class="ak-cards">${rows.map((x) => card(html`
<p class="head">${x.shift ? badge(`${pick(L, "on shift since", "في الوردية منذ")} ${when(x.shift.started_at)}`, "ok", "bike") : badge(pick(L, "shift ended", "انتهت الوردية"))}</p>
<dl class="ak-facts"><dt>${pick(L, "Cash held", "النقد معه")}</dt><dd><strong>${usd(x.f.usd)} + ${lbp(x.f.lbp)}</strong> <span class="muted">(${usd(x.f.held)})</span></dd>
<dt>${pick(L, "Earnings owed (fees and tips)", "الأرباح المستحقة (الرسوم والإكراميات)")}</dt><dd>${usd(x.f.earnings)}</dd>
<dt>${pick(L, "To hand over", "يسلّم للمحل")}</dt><dd>${usd(x.f.handOver)}</dd>
<dt>${pick(L, "Cash over/short today", "فائض أو عجز النقد اليوم")}</dt><dd>${overShort(x.id)}</dd></dl>
${x.drops.map((d) => html`<div class="ak-two"><p><strong>${pick(L, "Declared", "المُصرَّح به")}: ${usd(d.declared_usd)} + ${lbp(d.declared_lbp)}</strong> · ${d.method} · ${when(d.created_at)}${d.receipt_ref ? ` · ${d.receipt_ref}` : ""}${receipts.get(d.id) ? html` <a href="${receipts.get(d.id)}" target="_blank" rel="noopener">${pick(L, "receipt", "الإيصال")}</a>` : ""}</p>
${form(c.f, `/riders/drop/${d.id}`, html`${button({ label: pick(L, "Counted: confirm", "عددتُه: أكّد"), variant: "gold", icon: "check" })}`, { cls: "inline" })}</div>`)}
<div class="actions-row">${x.f.earnings > 0.004 ? form(c.f, `/riders/${x.id}/pay`, button({ label: pick(L, "Pay earnings", "ادفع الأرباح"), icon: "coins" }), { cls: "inline" }) : ""}
${form(c.f, `/riders/${x.id}/statement`, button({ label: pick(L, "Send statement on WhatsApp", "أرسل الكشف عبر واتساب"), variant: "soft", icon: "message" }), { cls: "inline" })}</div>`, { title: x.display_name ?? pick(L, "Rider", "مندوب") }))}</div>
<p class="muted">${pick(L, "Pay earnings: the rider keeps their fees and tips out of the cash they carry (dollars first, then lira); anything more is paid from the hub till, never more than it holds. The database works it out.", "دفع الأرباح: يحتفظ المندوب برسومه وإكرامياته من النقد الذي يحمله (الدولار أولاً ثم الليرة)؛ وأي زيادة تُدفع من صندوق المستودع ولا تتجاوز ما فيه. تحسبها قاعدة البيانات.")}</p>
<p class="muted">${pick(L, "Over/short: a few cents of lira rounding at the door is the company's; a shortfall beyond it (up to a dollar) is owed by the rider and flagged. More than a dollar is refused at the door.", "الفائض والعجز: بضعة سنتات تقريب بالليرة عند الباب على الشركة؛ وما زاد عنها (حتى دولار) يدين به المندوب ويُعلَّم. وأكثر من دولار يُرفض عند الباب.")}</p>`}
<h2>${pick(L, "Damaged notes", "الأوراق التالفة")}</h2>
<p class="muted">${pick(L, "A note in a confirmed drop that cannot be used. It leaves the drawer once: the first this month is the company's, later ones are the rider's.", "ورقة في تسليم مؤكّد لا يمكن استعمالها. تخرج من الصندوق مرة واحدة: أول واحدة هذا الشهر على الشركة والتالية على المندوب.")}</p>
${confirmed.length === 0 ? empty({ title: pick(L, "No confirmed drop at the hub yet.", "لا تسليم مؤكّد في المستودع بعد."), icon: "wallet" }) : html`<ul class="ak-rows">${confirmed.map((d) => {
  const taken = notes.filter((n) => n.drop_id === d.id).reduce((a, n) => a + Number(n.amount_usd), 0);
  return html`<li><div class="head"><strong>${name(d.driver_id)}</strong><span class="muted">${usd(d.declared_usd)} + ${lbp(d.declared_lbp)} · ${when(d.confirmed_at)}${taken > 0 ? ` · ${pick(L, "damaged so far", "التالف حتى الآن")} ${usd(taken)}` : ""}</span></div>
${form(c.f, `/riders/drop/${d.id}/damaged`, html`<div class="ak-money-fields">${input({ name: "amount_usd", label: pick(L, "USD", "دولار"), type: "number", required: true, attrs: { step: "0.01", min: "0.01", inputmode: "decimal" } })}</div><div class="actions-row">${button({ label: pick(L, "Record damaged note", "سجّل ورقة تالفة"), icon: "check" })}</div>`)}</li>`;
})}</ul>`}`, { translated: true });
}


// ---------- UX3: Applicants (people who applied on /join/rider) ----------
// An application is not a rider. It reaches this tab after the applicant confirmed their number on WhatsApp (they messaged us first) and opened a case in the Inbox.
// Accept creates the rider through accept_rider_application (a driver party on the ops line, from the number they confirmed); it starts no shift, records no terms
// and sends nothing. Decline needs a reason. Both are logged here (staff_actions) and in join_log. Never a rating, score or rank of an applicant.
type Applicant = { id: string; status: string; name: string; village: string | null; vehicle: string | null; licence: boolean | null; days: string[] | null; shifts: string[] | null;
  phone: string | null; case_id: string | null; case_state: string; created_at: string; decided_at: string | null; decided_by_name: string | null; decision_reason: string | null };

const VEHICLE: Record<string, [string, string]> = { motorbike: ["Motorbike", "دراجة نارية"], car: ["Car", "سيارة"], bicycle: ["Bicycle", "دراجة هوائية"] };
const SHIFT: Record<string, [string, string]> = { morning: ["Morning", "صباحية"], evening: ["Evening", "مسائية"] };
const DAY: Record<string, [string, string]> = { mon: ["Monday", "الاثنين"], tue: ["Tuesday", "الثلاثاء"], wed: ["Wednesday", "الأربعاء"], thu: ["Thursday", "الخميس"], fri: ["Friday", "الجمعة"], sat: ["Saturday", "السبت"], sun: ["Sunday", "الأحد"] };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).replace(/_/g, " ");
const word = (t: Record<string, [string, string]>, k: string, L: Lang) => (t[k] ? pick(L, t[k]![0], t[k]![1]) : cap(k));

async function openApplicants(c: Ctx): Promise<number> {
  try { return ((await c.deps.db.rpc<unknown[] | null>("join_applicants_console", { p_kind: "rider", p_state: "open", p_limit: 200 })) ?? []).length; } catch { return 0; }
}
async function ridersTabs(c: Ctx, current: "roster" | "applicants") {
  const L = c.lang;
  return tabs([
    { label: pick(L, "Roster", "القائمة"), href: "/riders", current: current === "roster" },
    { label: pick(L, "Applicants", "المتقدّمون"), href: "/riders?tab=applicants", current: current === "applicants", count: await openApplicants(c) },
  ], pick(L, "Riders", "المناديب"));
}

async function applicants(c: Ctx) {
  const L = c.lang; const { db } = c.deps;
  const [open, decided, join] = await Promise.all([
    db.rpc<Applicant[]>("join_applicants_console", { p_kind: "rider", p_state: "open", p_limit: 100 }),
    db.rpc<Applicant[]>("join_applicants_console", { p_kind: "rider", p_state: "decided", p_limit: 30 }),
    db.rpc<{ rider?: { shifts?: { id: string; from: string; to: string }[] } } | null>("setting", { p_key: "join" }),
  ]);
  const times = new Map((join?.rider?.shifts ?? []).map((x) => [x.id, `${x.from}–${x.to}`]));
  const shifts = (a: Applicant) => (a.shifts ?? []).map((id) => html`${word(SHIFT, id, L)} <bdi dir="ltr">${times.get(id) ?? ""}</bdi>`);
  const joinList = (xs: unknown[]) => xs.map((x, i) => html`${i ? ", " : ""}${x}`);
  const facts = (a: Applicant) => html`<dl class="ak-facts">
<dt>${pick(L, "Village", "القرية")}</dt><dd>${a.village ?? ""}</dd>
<dt>${pick(L, "Vehicle", "وسيلة النقل")}</dt><dd>${a.vehicle ? word(VEHICLE, a.vehicle, L) : ""}</dd>
<dt>${pick(L, "Licence", "رخصة")}</dt><dd>${a.licence ? pick(L, "Licence: yes", "رخصة: نعم") : pick(L, "Licence: no", "رخصة: لا")}</dd>
<dt>${pick(L, "Days", "الأيام")}</dt><dd>${joinList((a.days ?? []).map((d) => word(DAY, d, L)))}</dd>
<dt>${pick(L, "Shifts", "الورديات")}</dt><dd>${joinList(shifts(a))}</dd>
<dt>${pick(L, "WhatsApp number", "رقم واتساب")}</dt><dd><bdi dir="ltr">${a.phone ?? pick(L, "none", "لا يوجد")}</bdi></dd>
<dt>${pick(L, "Applied", "قُدّم")}</dt><dd>${when(a.created_at)}</dd></dl>`;
  const caseLink = (a: Applicant) => (a.case_id ? html`<p><a href="/inbox/${a.case_id}">${a.case_state === "resolved" ? pick(L, "Its case in the Inbox (resolved)", "حالته في الوارد (مُغلقة)") : pick(L, "Open its case in the Inbox", "افتح حالته في الوارد")}</a></p>` : "");
  const waiting = open.map((a) => card(html`
<p class="head">${badge(pick(L, "waiting for a person", "بانتظار شخص"), "warn", "hourglass")}</p>
${facts(a)}${caseLink(a)}
<div class="actions-row">${form(c.f, `/riders/applicants/${a.id}/accept`, button({ label: pick(L, "Accept", "قبول"), variant: "gold", icon: "check" }), { cls: "inline" })}</div>
<details class="ak-more"><summary>${icon("close")} ${pick(L, "Decline", "رفض")}</summary>
${form(c.f, `/riders/applicants/${a.id}/decline`, html`${input({ name: "reason", label: pick(L, "Why (kept with the decision)", "السبب (يُحفظ مع القرار)"), required: true, maxlength: 500 })}
<div class="actions-row">${button({ label: pick(L, "Decline", "رفض"), variant: "danger", icon: "close" })}</div>`)}</details>`, { title: a.name }));
  const done = decided.map((a) => card(html`
<p class="head">${a.status === "accepted" ? badge(pick(L, "Accepted", "مقبول"), "ok", "check") : badge(pick(L, "Declined", "مرفوض"), "neutral", "close")}
<span class="muted">${a.decided_by_name ?? ""} · ${when(a.decided_at)}</span></p>
${a.decision_reason ? html`<p>${a.decision_reason}</p>` : ""}${facts(a)}${caseLink(a)}`, { title: a.name }));
  return render(c, pick(L, "Riders", "المناديب"), html`${await ridersTabs(c, "applicants")}
<p class="muted">${pick(L, "People who applied on the website after confirming their number on WhatsApp (they messaged us first). Each is not a rider yet: accepting is what makes them one. It starts no shift, records no terms and sends no message; answer them from the Inbox case, and record their written terms on the roster before they carry cash.",
  "أشخاص قدّموا طلباً على الموقع بعد أن أكّدوا رقمهم على واتساب (راسلونا أولاً). ليس أحدهم مندوباً بعد: القبول هو ما يجعله مندوباً. لا يبدأ وردية ولا يسجّل شروطاً ولا يرسل رسالة؛ أجبهم من حالتهم في الوارد، وسجّل شروطهم المكتوبة في القائمة قبل أن يحملوا نقداً.")}</p>
<h2>${pick(L, `Waiting (${open.length})`, `بالانتظار (${open.length})`)}</h2>
${open.length === 0 ? empty({ title: pick(L, "Nobody is waiting.", "لا أحد بالانتظار."), icon: "users" }) : html`<div class="ak-cards">${waiting}</div>`}
<h2>${pick(L, "Decided", "تم البتّ فيها")}</h2>
${decided.length === 0 ? empty({ title: pick(L, "No application has been decided yet.", "لم يُبتّ في أي طلب بعد."), icon: "list" }) : html`<div class="ak-cards">${done}</div>`}`, { translated: true });
}

/** The refusals only these two actions meet, in words. */
async function decide<T>(c: Ctx, run: Promise<T>): Promise<T> {
  const L = c.lang;
  try { return await run; }
  catch (e) {
    if (e instanceof DbError && /^ALREADY_DECIDED/.test(e.message)) throw new UserError(pick(L, "Someone already decided this application.", "بتّ شخص آخر في هذا الطلب."));
    if (e instanceof DbError && /^ALREADY_ON_OPS_LINE/.test(e.message)) throw new UserError(pick(L, "This number is already on the ops line, so they are a rider or staff already. Nothing was changed.", "هذا الرقم موجود أصلاً على خط العمليات، فهو مندوب أو موظف بالفعل. لم يتغيّر شيء."));
    if (e instanceof DbError && /^NO_CONFIRMED_NUMBER/.test(e.message)) throw new UserError(pick(L, "This application has no confirmed number, so no rider can be made from it.", "لا رقم مؤكَّد لهذا الطلب، فلا يمكن إنشاء مندوب منه."));
    throw e;
  }
}

async function acceptApplicant(c: Ctx) {
  const application = id(c, "application"); const L = c.lang;
  return act(c, "rider_applicant_accept", { application }, async () => {
    const name = (await c.deps.db.rows<{ name: string }>("join_applications", { select: "name", where: { id: application }, limit: 1 }))[0]?.name ?? "";
    await decide(c, c.deps.db.rpc("accept_rider_application", { p_application: application, p_by: c.staff.partyId }));
    return pick(L, `${name} is now a rider. Next: record their written terms on the roster.`, `${name} صار مندوباً. الخطوة التالية: سجّل شروطه المكتوبة في القائمة.`);
  }, "/riders?tab=applicants");
}

async function declineApplicant(c: Ctx) {
  const application = id(c, "application"); const L = c.lang;
  const reason = text(c, "reason", 500);
  if (reason.length < 3) throw new UserError(pick(L, "Write the reason (at least 3 characters).", "اكتب السبب (٣ أحرف على الأقل)."));
  return act(c, "rider_applicant_decline", { application, reason }, async () => {
    await decide(c, c.deps.db.rpc("decline_rider_application", { p_application: application, p_by: c.staff.partyId, p_reason: reason }));
    return pick(L, "Declined. The reason is kept.", "تم الرفض. السبب محفوظ.");
  }, "/riders?tab=applicants");
}

/** Riders: the roster. Who is on shift (start and end), the cash each holds against the caps, and whether their written terms are on file. No rating, no score. */
async function roster(c: Ctx) {
  const { db } = c.deps;
  const L = c.lang;
  const [board, caps, terms] = await Promise.all([
    db.rpc<{ riders: { driver_id: string; name: string | null; on_shift: boolean; shift_since: string | null; cash_usd: number | string; cash_lbp: number | string; exposure_usd: number | string;
      delivery: { status: string } | null }[] } | null>("console_rider_board", {}),
    db.rpc<{ soft_usd?: number; hard_usd?: number } | null>("setting", { p_key: "cash_cap" }),
    db.rpc<{ driver_id: string; reference: string; signed_on: string; has_document: boolean; document_path: string | null; recorded_by_name: string | null; recorded_at: string }[] | null>("rider_terms_on_file", {}).catch(() => null),
  ]);
  const riders = board?.riders ?? [];
  const soft = Number(caps?.soft_usd ?? 0), hard = Number(caps?.hard_usd ?? 0);
  const termsOf = new Map((terms ?? []).map((t) => [t.driver_id, t]));
  const links = new Map(await Promise.all([...termsOf.values()].map(async (t) => [t.driver_id, t.document_path ? await c.deps.media.sign(t.document_path, 300) : null] as const)));
  const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit" }) : "");
  const today = c.deps.now().toISOString().slice(0, 10);
  const lead = can(c, LEADS);
  const cardOf = (r: (typeof riders)[number]) => {
    const exposure = Number(r.exposure_usd);
    const t = termsOf.get(r.driver_id);
    const capState = hard && exposure >= hard ? badge(pick(L, "at the hard cap: no new cash order", "عند السقف الصارم: لا طلب نقدي جديد"), "danger", "alert")
      : soft && exposure >= soft ? badge(pick(L, "over the soft cap", "فوق السقف المرن"), "warn", "alert") : badge(pick(L, "under the caps", "تحت السقفين"), "ok", "check");
    return card(html`
<p class="head">${r.on_shift ? badge(`${pick(L, "on shift since", "في الوردية منذ")} ${hm(r.shift_since)}`, "ok", "bike") : badge(pick(L, "off shift", "خارج الوردية"))}
${r.delivery ? badge(pick(L, "a job in hand", "في مهمة"), "gold", "truck") : ""}</p>
<p>${pick(L, "Cash held", "النقد معه")}: <strong><bdi>${usd(r.cash_usd)}</bdi> + <bdi>${lbp(r.cash_lbp)}</bdi></strong> ${capState}</p>
${hard ? limitBar({ value: exposure, soft: soft || null, hard, label: pick(L, `${usd(exposure)} of the ${usd(hard)} hard cap`, `${usd(exposure)} من السقف الصارم ${usd(hard)}`) }) : ""}
<p class="muted"><bdi>${usd(exposure)}</bdi> ${pick(L, "counting cash still to collect", "مع النقد المنتظر تحصيله")}${hard ? pick(L, ` · soft ${usd(soft)}, hard ${usd(hard)} (set in Settings)`, ` · مرن ${usd(soft)}، صارم ${usd(hard)} (من الإعدادات)`) : ""}</p>
<h3>${pick(L, "Written terms", "الشروط المكتوبة")}</h3>
${t ? html`<p>${badge(pick(L, "on file", "محفوظة"), "ok", "check")} <bdi>${t.reference}</bdi> · ${pick(L, "signed", "وُقّعت")} <bdi>${t.signed_on}</bdi>${links.get(r.driver_id) ? html` · <a href="${links.get(r.driver_id)}" target="_blank" rel="noopener">${pick(L, "open the document", "افتح المستند")}</a>` : ""}</p>
<p class="muted">${pick(L, "Recorded by", "سجّلها")} ${t.recorded_by_name ?? ""} · ${when(t.recorded_at)}</p>`
  : html`<p>${badge(pick(L, "not on file", "غير محفوظة"), "warn", "alert")} ${pick(L, "A rider carries cash and fees only with their written terms on file.", "لا يحمل المندوب نقداً ورسوماً إلا بعد حفظ شروطه المكتوبة.")}</p>`}
${lead ? html`<details class="ak-more"><summary>${icon("list")} ${t ? pick(L, "Record newer terms", "سجّل شروطاً أحدث") : pick(L, "Record the written terms", "سجّل الشروط المكتوبة")}</summary>
${form(c.f, `/riders/${r.driver_id}/terms`, html`<div class="ak-money-fields">${input({ name: "reference", label: pick(L, "Document and version", "المستند والإصدار"), required: true, maxlength: 120 })}${input({ name: "signed_on", label: pick(L, "Signed on", "تاريخ التوقيع"), type: "date", required: true, value: today, attrs: { max: today } })}
<label class="ak-field"><span>${pick(L, "Scan or photo (optional)", "مسح أو صورة (اختياري)")}</span><input class="ak-input" type="file" name="terms" accept="image/*,application/pdf"></label></div>
<div class="actions-row">${button({ label: pick(L, "Save", "احفظ"), icon: "check" })}</div>`, { files: true })}</details>
<div class="actions-row">${r.on_shift ? form(c.f, `/riders/${r.driver_id}/end-shift`, button({ label: pick(L, "End shift", "أنهِ الوردية"), icon: "bike", variant: "soft" }), { cls: "inline" })
  : form(c.f, `/riders/${r.driver_id}/start-shift`, button({ label: pick(L, "Start shift", "ابدأ الوردية"), icon: "bike", variant: "gold" }), { cls: "inline" })}
${button({ label: pick(L, "Cash drops and payouts", "تسليم النقد والدفعات"), href: "/money/drops", icon: "wallet", variant: "ghost" })}</div>` : ""}`, { title: r.name ?? pick(L, "Rider", "مندوب") });
  };
  const on = riders.filter((r) => r.on_shift), off = riders.filter((r) => !r.on_shift);
  return render(c, pick(L, "Riders", "المناديب"), html`${await ridersTabs(c, "roster")}
<p class="muted">${pick(L, "Who rides, who is on shift, the cash each holds against the caps, and whether their written terms are on file. Riders are never rated or scored here: this page measures the service, not people.", "من يوصّل، ومن في الوردية، والنقد الذي يحمله كل واحد مقابل السقفين، وهل شروطه المكتوبة محفوظة. لا تقييم ولا درجات للمناديب هنا: تقيس هذه الصفحة الخدمة لا الأشخاص.")}</p>
<h2>${pick(L, `On shift (${on.length})`, `في الوردية (${on.length})`)}</h2>
${on.length === 0 ? empty({ title: pick(L, "No rider is on shift.", "لا مندوب في الوردية."), icon: "bike" }) : html`<div class="ak-cards">${on.map(cardOf)}</div>`}
${off.length ? html`<h2>${pick(L, `Off shift (${off.length})`, `خارج الوردية (${off.length})`)}</h2><div class="ak-cards">${off.map(cardOf)}</div>` : ""}
<p class="muted">${pick(L, "Dispatching, jobs and incidents are on the ", "التوزيع والمهام والحوادث في صفحة ")}<a href="/rider-jobs">${pick(L, "Dispatch page", "التوزيع")}</a>.</p>`, { translated: true });
}

async function startShift(c: Ctx) {
  const driver = id(c, "driver");
  const L = c.lang;
  return act(c, "rider_start_shift", { driver }, async () => {
    const r = await c.deps.db.rpc<{ started?: boolean }>("act_for_rider", { p_by: c.staff.partyId, p_driver: driver, p_action: "start_shift" });
    return r.started === false ? pick(L, "Their shift was already open.", "ورديته مفتوحة بالفعل.") : pick(L, "Their shift is open. They can be offered jobs.", "فُتحت ورديته. يمكن عرض مهام عليه.");
  }, "/riders");
}

async function recordTerms(c: Ctx) {
  const driver = id(c, "driver");
  const L = c.lang;
  const reference = text(c, "reference", 120);
  const signed = (c.form.signed_on ?? "").trim();
  if (reference.length < 3) throw new UserError(pick(L, "Name the document and its version.", "سمِّ المستند وإصداره."));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signed)) throw new UserError(pick(L, "Choose the day it was signed.", "اختر يوم التوقيع."));
  const path = await upload(c, "terms", `rider_terms/${driver}`);
  return act(c, "rider_terms", { driver, reference, signed_on: signed, document: !!path }, async () => {
    const r = await c.deps.db.rpc<{ replaced: boolean }>("record_rider_terms", { p_driver: driver, p_by: c.staff.partyId, p_reference: reference, p_signed_on: signed, p_path: path });
    return r.replaced ? pick(L, "Newer terms recorded; the earlier ones stay as history.", "سُجّلت شروط أحدث؛ وتبقى السابقة في السجل.") : pick(L, "The written terms are on file.", "حُفظت الشروط المكتوبة.");
  }, "/riders");
}

async function confirmDrop(c: Ctx) {
  const drop = id(c, "drop");
  return act(c, "cash_drop_confirm", { drop }, async () => {
    const left = await c.deps.db.rpc<number | string>("confirm_cash_drop", { p_drop: drop, p_by: c.staff.partyId });
    return pick(c.lang, `Drop confirmed. The rider still holds ${usd(left)} in value.`, `تم تأكيد التسليم. ما زال المندوب يحمل ما قيمته ${usd(left)}.`);
  }, "/money/drops");
}

async function pay(c: Ctx) {
  const driver = id(c, "driver");
  return act(c, "rider_pay_earnings", { driver }, async () => {
    const r = await plain(c.deps.db.rpc<Record<string, number | string>>("pay_rider_earnings", { p_driver: driver, p_by: c.staff.partyId }),
      "Not paid: the rider's cash does not cover their earnings and the drawer does not hold the rest by the books. Confirm a cash drop first, then pay.");
    return `Paid. Kept from cash: ${usd(r.kept_usd)} and ${lbp(r.kept_lbp)}; from the hub till: ${usd(r.paid_from_hub_usd)}. ` +
      `The rider hands over ${usd(r.to_hand_over_usd)} and ${lbp(r.to_hand_over_lbp)}.`;
  }, "/money/drops");
}

async function damagedNote(c: Ctx) {
  const drop = id(c, "drop");
  const amount = num(c, "amount_usd", { min: 0.01, max: 1000 });
  return act(c, "cash_drop_damaged_note", { drop, amount_usd: amount }, async () => {
    const key = formKey(c);
    if (!key) throw new UserError("Open the page again and resend the form.");
    const r = await plain(c.deps.db.rpc<{ duplicate: boolean; absorbed_by: string; amount_usd: number | string }>("record_damaged_note",
      { p_drop: drop, p_amount_usd: amount, p_by: c.staff.partyId, p_key: key }),
      "The drawer does not hold that much by the books. Confirm the drop first.");
    if (r.duplicate) return "That damaged note was already recorded; nothing changed.";
    return `Damaged note of ${usd(r.amount_usd)} taken out of the drawer, ${r.absorbed_by === "company" ? "absorbed by the company (the first this month)" : "owed by the rider"}.`;
  }, "/money/drops");
}

async function endShift(c: Ctx) {
  const driver = id(c, "driver");
  return act(c, "rider_end_shift", { driver }, async () => {
    const r = await c.deps.db.rpc<{ closed: boolean; reason?: string }>("close_shift", { p_driver: driver });
    if (r?.closed) return "Shift ended.";
    const why: Record<string, string> = { no_open_shift: "There is no open shift.", active_deliveries: "The rider still has a delivery in hand.",
      cash_outstanding: "The rider still holds cash: confirm the drop first." };
    throw new UserError(`Shift not ended. ${why[r?.reason ?? ""] ?? r?.reason ?? ""}`);
  }, "/riders");
}

/** The figures, in the words riders read on the ops line. Numbers from rider_statement() and driver_cash_native(), nothing else. */
export function statementText(f: { usd: number; lbp: number; earnings: number; handOver: number }) {
  return [
    "كشف آخر الدوام 🧾",
    `معك هلّق: ${usd(f.usd)} و ${lbp(f.lbp)}`,
    `أرباحك (التوصيل والإكراميات): ${usd(f.earnings)}`,
    `بتسلّم للمحل: ${usd(f.handOver)}`,
    "إذا في شي مش مزبوط، احكي مسؤول العمليات.",
  ].join("\n");
}

async function statement(c: Ctx) {
  const driver = id(c, "driver");
  return act(c, "rider_statement_message", { driver }, async () => {
    const f = await riderFigures(c, driver);
    const to = await c.deps.db.rpc<string | null>("party_address", { p_party: driver, p_line: "ops" });
    if (!to) throw new UserError("This rider has no WhatsApp number on the ops line.");
    const shift = (await c.deps.db.rows<{ id: string }>("driver_shifts", { select: "id", where: { driver_id: driver }, order: [{ col: "started_at", desc: true }], limit: 1 }))[0];
    // The same figures for the same shift are one message, however many times the button is pressed.
    const key = `console:statement:${driver}:${shift?.id ?? "none"}:${f.usd.toFixed(2)}:${f.lbp.toFixed(0)}:${f.earnings.toFixed(2)}`;
    const r = await c.deps.send({ line: "ops", partyId: driver, to, category: "utility", dedupeKey: key, msg: { type: "text", text: { body: statementText(f) } } });
    if (!r.ok) throw new UserError(`Not sent: ${r.refused}.`);
    return r.wamid === "already_sent" ? "This statement was already sent; not sent twice." : "Statement sent to the rider.";
  }, "/money/drops");
}

export const ridersSection: Section = {
  nav: { href: "/riders", label: "Riders", roles: LEADS },
  routes: [
    { method: "GET", path: "/riders", roles: LEADS, handler: (c) => (c.url.searchParams.get("tab") === "applicants" ? applicants(c) : roster(c)) },
    { method: "POST", path: "/riders/applicants/:application/accept", roles: LEADS, handler: acceptApplicant },
    { method: "POST", path: "/riders/applicants/:application/decline", roles: LEADS, handler: declineApplicant },
    { method: "GET", path: "/money/drops", roles: LEADS, handler: drops },
    { method: "POST", path: "/riders/:driver/start-shift", roles: LEADS, handler: startShift },
    { method: "POST", path: "/riders/:driver/terms", roles: LEADS, handler: recordTerms },
    { method: "POST", path: "/riders/drop/:drop", roles: LEADS, handler: confirmDrop },
    { method: "POST", path: "/riders/drop/:drop/damaged", roles: LEADS, handler: damagedNote },
    { method: "POST", path: "/riders/:driver/pay", roles: LEADS, handler: pay },
    { method: "POST", path: "/riders/:driver/end-shift", roles: LEADS, handler: endShift },
    { method: "POST", path: "/riders/:driver/statement", roles: LEADS, handler: statement },
  ],
};
