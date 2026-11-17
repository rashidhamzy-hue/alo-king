// D4b: rider jobs on the console, with "act for a rider" (docs/strategy/02-journeys.md, section 3; docs/strategy/06-session-plan.md,
// section 4). The ops lead does a rider's taps when the rider's phone dies, and tests a second rider while the sandbox staff line has one
// registered phone: start a shift, give a waiting order to a named rider (offered and accepted for them), picked up, arrived, delivered,
// and cash collected, in dollars and in lira. Each tap is act_for_rider (0148), which calls the same functions the rider's own taps call,
// so every refusal of theirs stands (the cash cap at offer time, "not your order", an amount more than a dollar off the order). It
// writes who acted to the order's timeline; the console writes the action log too. Nothing is sent to the ops line: the rider is not
// messaged, the customer is told "on the way" on the customer line when the goods leave. Leads only. The page refreshes each minute.
import { attempt, flashRedirect, html, id, num, render, UserError, UUID, type Ctx, type Section } from "../app";
import { DbError } from "../db";
import { form, lbp, usd } from "../html";
import { pick, t, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { onTheWayNotice, tell } from "../notices";
import { badge, button, card, empty, icon, input, limitBar, select, tabs } from "@ak/ui/components";
import { statusPill } from "@ak/ui/status";

export type Stop = { seq: number; kind: "pickup" | "dropoff"; done: boolean; arrived: boolean; source: string | null; order_id: string | null; short_code: string | null; order_status: string | null;
  village: string | null; directions: string | null; notes: string | null; payment_method: string | null; total_usd: number | string | null; fx_rate_lbp: number | string | null; change_for_usd: number | string | null; paid: boolean; items: number };
export type Job = { delivery_id: string; driver_id: string; status: string; collect_usd: number | string; stops: Stop[] };
export type RiderRow = { driver_id: string; name: string | null; on_shift: boolean; shift_since: string | null; cash_usd: number | string; cash_lbp: number | string; exposure_usd: number | string;
  delivery: { delivery_id: string; status: string; offered_at: string; accepted_at: string | null; job: Job } | null; unpaid: { order_id: string; short_code: string; total_usd: number | string; fx_rate_lbp: number | string | null }[] };
export type Waiting = { order_id: string; short_code: string; status: string; payment_method: string; total_usd: number | string; village_ar: string | null; village_en: string | null; stranded: boolean };
export type RiderBoard = { riders: RiderRow[]; waiting: Waiting[] };

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit" }) : "");
export const riderTabs = (L: Lang, here: "jobs" | "incidents") =>
  tabs([{ label: pick(L, "Jobs", "المهام"), href: "/rider-jobs", current: here === "jobs" }, { label: pick(L, "Incidents", "الحوادث"), href: "/rider-incidents", current: here === "incidents" }], pick(L, "Riders", "المناديب"));
export const villageOf = (w: Pick<Waiting, "village_ar" | "village_en">, L: Lang) => ((L === "ar" ? w.village_ar || w.village_en : w.village_en || w.village_ar) ?? "");
/** An amount line that keeps its order inside Arabic text (a left-to-right isolate). */
export const ltr = (s: string) => `\u2066${s}\u2069`;
export const payWord = (m: string, L: Lang) => (m === "cod" ? pick(L, "cash on delivery", "الدفع عند التسليم") : m === "whish" ? "Whish" : m === "omt" ? "OMT" : m);

/** Plain words for the refusals a rider's functions raise, said to the person acting for them. */
export function plain(L: Lang, e: unknown): unknown {
  if (!(e instanceof DbError)) return e;
  const m = e.message;
  const say = (en: string, ar: string) => new UserError(pick(L, en, ar));
  if (/^NOT_A_DRIVER/.test(m)) return say("That person is not a rider.", "هذا الشخص ليس مندوباً.");
  if (/^NOT_YOUR_JOB|^NOT_YOUR_ORDER/.test(m)) return say("That job or order is not this rider's.", "هذه المهمة أو هذا الطلب ليس لهذا المندوب.");
  if (/^DRIVER_NOT_ON_SHIFT/.test(m)) return say("That rider is not on shift. Start their shift first.", "هذا المندوب ليس في الوردية. ابدأ ورديته أولاً.");
  if (/^CASH_CAP/.test(m)) return say("That rider holds or carries too much cash to take another cash order (the cap is in the settings).", "هذا المندوب يحمل نقداً كثيراً فلا يمكنه أخذ طلب نقدي آخر (السقف في الإعدادات).");
  if (/^ALREADY_WITH_A_RIDER/.test(m)) return say("A rider already has this order.", "هذا الطلب مع مندوب بالفعل.");
  if (/^NOT_WAITING_FOR_RIDER/.test(m)) return say("This order is not waiting for a rider now.", "هذا الطلب لا ينتظر مندوباً الآن.");
  if (/^PICKUP_ORDER/.test(m)) return say("This is a pickup order: the customer collects it at the hub.", "هذا طلب استلام: يستلمه الزبون من المستودع.");
  if (/^AMOUNT_MISMATCH/.test(m)) return say("The amount does not match the order total (up to $1 of difference is allowed). Count again.", "المبلغ لا يطابق مجموع الطلب (يُسمح بفرق دولار واحد). أعد العدّ.");
  if (/^CHANGE_EXCEEDS_RECEIVED/.test(m)) return say("The change given is more than the money received.", "الباقي المُعاد أكبر من المبلغ المستلم.");
  if (/^NEGATIVE_AMOUNT/.test(m)) return say("An amount cannot be negative.", "لا يمكن أن يكون المبلغ سالباً.");
  if (/^NOT_AT_DOOR/.test(m)) return say("The order is not at the door yet. Record it as delivered first.", "الطلب ليس عند الباب بعد. سجّل التسليم أولاً.");
  if (/^AMOUNT_REQUIRED/.test(m)) return say("Type the amount received, in dollars, lira or both.", "اكتب المبلغ المستلم بالدولار أو الليرة أو كليهما.");
  if (/^NOT_AUTHORISED/.test(m)) return say("Only the ops lead or the admin can act for a rider.", "فقط مسؤول العمليات أو المدير يتصرف نيابة عن مندوب.");
  if (/^HANDOVER_CODE_REQUIRED/.test(m)) return say("This order is handed over only against the customer's 4-digit code. Type it, then press Delivered.", "يُسلَّم هذا الطلب مقابل رمز الزبون المكوّن من 4 أرقام فقط. اكتبه ثم اضغط «سُلّم».");
  if (/^NOT_A_PICKUP/.test(m)) return say("This is not a pickup order.", "هذا ليس طلب استلام.");
  if (/^PAYMENT_NOT_RECORDED/.test(m)) return say("Nothing was paid on this order yet: record what was received first.", "لم يُسجَّل أي دفع لهذا الطلب: سجّل المبلغ المستلم أولاً.");
  return e;
}

export async function doit(c: Ctx, action: string, args: Record<string, unknown>, back: string, run: () => Promise<string>): Promise<Response> {
  const r = await attempt(c, action, args, async () => { try { return await run(); } catch (e) { throw plain(c.lang, e); } });
  return flashRedirect(c.deps, back, r.logged ? r.msg : { err: pick(c.lang, "Not done: the action log could not be written. Try again in a minute.", "لم يتم: تعذّر تسجيل الإجراء. حاول بعد دقيقة.") });
}

export async function readBoard(c: Ctx): Promise<RiderBoard> {
  const b = await c.deps.db.rpc<RiderBoard | null>("console_rider_board", {});
  return { riders: b?.riders ?? [], waiting: b?.waiting ?? [] };
}

const STATUS: Record<string, [string, string]> = { offered: ["offered", "معروضة"], accepted: ["accepted", "مقبولة"], in_progress: ["on the road", "في الطريق"] };

async function page(c: Ctx) {
  const L = c.lang;
  const now = c.deps.now();
  const [{ riders, waiting }, cap, pickBoard] = await Promise.all([readBoard(c), c.deps.db.rpc<{ soft_usd?: number; hard_usd?: number } | null>("setting", { p_key: "cash_cap" }).catch(() => null),
    c.deps.db.rpc<{ order_id: string; short_code: string; status: string; is_pickup: boolean; village_ar: string | null; village_en: string | null }[] | null>("console_pick_board", {}).catch(() => null)]);
  const onShift = riders.filter((r) => r.on_shift);
  const off = riders.filter((r) => !r.on_shift);
  const hard = Number(cap?.hard_usd ?? 0), soft = Number(cap?.soft_usd ?? 0);
  // What the settings say, in the same words on every card. The database decides the job (offer_delivery); this only shows the numbers it will compare.
  const capWords = hard ? pick(L, `Soft cap ${usd(soft)} warns. Hard cap ${usd(hard)} blocks new cash orders until a drop.`, `السقف المرن ${usd(soft)} للتنبيه. السقف الصارم ${usd(hard)} يمنع الطلبات النقدية الجديدة حتى التسليم.`) : "";
  const picker = (w: Waiting) => select({ name: "driver", label: pick(L, "Rider", "المندوب"), hideLabel: true,
    options: onShift.map((r) => ({ value: r.driver_id, label: `${r.name ?? pick(L, "Rider", "مندوب")} · ${usd(r.exposure_usd)}${hard ? ` / ${usd(hard)}` : ""}${r.delivery ? ` · ${pick(L, "has a job", "لديه مهمة")}` : ""}` })) });
  // A pickup order has no rider and no fee: its shelf is below. A stranded order (left on the road) is first in the line.
  const packed = waiting.filter((w) => w.status === "ready" || w.stranded);
  const notPacked = waiting.filter((w) => !(w.status === "ready" || w.stranded));
  const pickups = (pickBoard ?? []).filter((b) => b.is_pickup && b.status === "ready");
  const pickupInfo = pickups.length ? await c.deps.db.rows<{ id: string; payment_method: string; total_usd: number | string; handover_code: string | null; handover_verified_at: string | null }>("orders", { select: "id,payment_method,total_usd,handover_code,handover_verified_at", where: { id: { in: pickups.map((x) => x.order_id) } } }).catch(() => []) : [];

  const stopRow = (r: RiderRow, s: Stop, job: Job) => {
    const total = Number(s.total_usd ?? 0);
    const fx = Number(s.fx_rate_lbp ?? 0);
    const needsCode = (s as Stop & { code_required?: boolean }).code_required === true;
    const pay = s.payment_method === "cod" && !s.paid ? html`${badge(pick(L, "collect", "تحصيل"), "gold", "wallet")} <bdi>${usd(total)}</bdi>${fx ? html` <span class="muted">≈ <bdi>${lbp(Math.round((total * fx) / 1000) * 1000)}</bdi></span>` : ""}${s.change_for_usd ? ` · ${pick(L, `change for ${usd(s.change_for_usd)}`, `فكّة لـ ${usd(s.change_for_usd)}`)}` : ""}` : badge(s.paid ? pick(L, "paid", "مدفوع") : payWord(s.payment_method ?? "", L), "ok", "check");
    return html`<li data-state="${s.done ? "done" : ""}"><div class="head"><strong>${s.short_code} · ${s.village ?? ""}</strong><span class="tags">${s.order_status ? statusPill(s.order_status, { lang: L }) : ""}${s.arrived ? badge(pick(L, "at the door", "عند الباب"), "ok", "pin") : ""}${s.done ? badge(pick(L, "delivered", "سُلّم"), "ok", "check") : ""}</span></div>
<p>${pay}</p>${s.directions ? html`<p class="muted">${s.directions}</p>` : ""}${s.notes ? html`<p class="muted">${pick(L, "Note", "ملاحظة")}: ${s.notes}</p>` : ""}
${s.done ? "" : html`<div class="actions-row">
${s.arrived ? "" : form(c.f, `/rider-jobs/${r.driver_id}/arrived`, html`<input type="hidden" name="order" value="${s.order_id}">${button({ label: pick(L, "Arrived", "وصل"), icon: "pin" })}`, { cls: "inline" })}
${form(c.f, `/rider-jobs/${r.driver_id}/delivered`, html`<input type="hidden" name="order" value="${s.order_id}">${needsCode ? input({ name: "code", label: pick(L, "The customer's 4-digit code", "رمز الزبون المكوّن من 4 أرقام"), required: true, maxlength: 4, attrs: { inputmode: "numeric", autocomplete: "off" } }) : ""}${button({ label: pick(L, "Delivered", "سُلّم"), variant: "primary", icon: "check" })}`, { cls: "inline" })}</div>`}</li>`;
  };

  const cash = (r: RiderRow, u: RiderRow["unpaid"][number]) => {
    const total = Number(u.total_usd); const fx = Number(u.fx_rate_lbp ?? 0);
    return html`<li><div class="head"><strong>${u.short_code}</strong><span>${badge(pick(L, "delivered, cash not recorded", "سُلّم ولم يُسجَّل النقد"), "warn", "wallet")}</span></div>
<p>${pick(L, "Total", "المجموع")}: <bdi>${usd(total)}</bdi>${fx ? html` ≈ <bdi>${lbp(Math.round((total * fx) / 1000) * 1000)}</bdi>` : ""}</p>
${form(c.f, `/rider-jobs/${r.driver_id}/collect`, html`<input type="hidden" name="order" value="${u.order_id}">
<div class="ak-money-fields">${input({ name: "usd", label: pick(L, "Dollars received", "دولارات مستلمة"), type: "text", attrs: { inputmode: "decimal" } })}${input({ name: "lbp", label: pick(L, "Lira received", "ليرات مستلمة"), type: "text", attrs: { inputmode: "numeric" } })}
${input({ name: "change_usd", label: pick(L, "Change given, dollars", "الباقي بالدولار"), type: "text", attrs: { inputmode: "decimal" } })}${input({ name: "change_lbp", label: pick(L, "Change given, lira", "الباقي بالليرة"), type: "text", attrs: { inputmode: "numeric" } })}</div>
<div class="actions-row">${button({ label: pick(L, "Cash collected", "تم تحصيل النقد"), variant: "primary", icon: "wallet" })}</div>`)}
${form(c.f, `/rider-jobs/${r.driver_id}/collect`, html`<input type="hidden" name="order" value="${u.order_id}"><input type="hidden" name="exact" value="1">${button({ label: pick(L, `Exactly ${usd(total)} in dollars`, `بالضبط ${usd(total)} بالدولار`), variant: "default" })}`)}</li>`;
  };

  const riderCard = (r: RiderRow) => {
    const d = r.delivery; const job = d?.job;
    const exposure = Number(r.exposure_usd);
    const pickups_ = job?.stops.filter((s) => s.kind === "pickup") ?? [];
    const drops = job?.stops.filter((s) => s.kind === "dropoff") ?? [];
    const stillPicking = drops.filter((s) => s.order_status === "preparing").map((s) => s.short_code);
    // Said in words and an icon, beside the bar: the bar's colour only repeats it.
    const capState = hard && exposure >= hard ? badge(pick(L, "at the hard cap: no new cash order", "عند السقف الصارم: لا طلب نقدي جديد"), "danger", "alert") : soft && exposure >= soft ? badge(pick(L, "over the soft cap: plan a drop", "فوق السقف المرن: خطّط لتسليم النقد"), "warn", "alert") : "";
    return card(html`
<p class="head">${r.on_shift ? badge(`${pick(L, "on shift since", "في الوردية منذ")} ${hm(r.shift_since)}`, "ok", "bike") : badge(pick(L, "off shift", "خارج الوردية"))}
 ${d ? badge(pick(L, ...(STATUS[d.status] ?? [d.status, d.status])), d.status === "offered" ? "warn" : "gold", "truck") : badge(pick(L, "at the hub", "في المستودع"), "neutral", "store")}</p>
<p>${pick(L, "Cash held", "النقد معه")}: <strong><bdi>${usd(r.cash_usd)}</bdi> + <bdi>${lbp(r.cash_lbp)}</bdi></strong> ${capState}</p>
${hard ? limitBar({ value: exposure, soft: soft || null, hard, label: pick(L, `${usd(exposure)} of the ${usd(hard)} hard cap`, `${usd(exposure)} من السقف الصارم ${usd(hard)}`) }) : ""}
<p class="muted"><bdi>${usd(exposure)}</bdi> ${pick(L, "counting cash still to collect", "مع النقد المنتظر تحصيله")} · ${capWords ? pick(L, `soft ${usd(soft)}, hard ${usd(hard)}`, `مرن ${usd(soft)}، صارم ${usd(hard)}`) : ""}</p>
<div class="actions-row">${button({ label: pick(L, "Cash drop", "تسليم النقد"), href: "/rider-incidents", icon: "coins", variant: "ghost" })}</div>
${!r.on_shift ? html`<div class="actions-row">${form(c.f, `/rider-jobs/${r.driver_id}/start_shift`, button({ label: pick(L, "Start their shift", "ابدأ ورديته"), icon: "bike" }), { cls: "inline" })}</div>` : ""}
${d && d.status === "offered" ? html`<div class="actions-row">${form(c.f, `/rider-jobs/${r.driver_id}/accept`, html`<input type="hidden" name="delivery" value="${d.delivery_id}">${button({ label: pick(L, "Accept for the rider", "اقبل نيابةً عنه"), variant: "primary", icon: "check" })}`, { cls: "inline" })}
${form(c.f, `/rider-jobs/${r.driver_id}/decline`, html`<input type="hidden" name="delivery" value="${d.delivery_id}">${button({ label: pick(L, "Decline for the rider", "ارفض نيابةً عنه") })}`, { cls: "inline" })}</div>
<p class="muted">${pick(L, "Orders", "الطلبات")}: ${drops.map((s) => s.short_code).join(pick(L, ", ", "، "))}</p>` : ""}
${d && d.status === "accepted" ? html`${pickups_.map((s) => html`<p>${pick(L, "Pick up at", "الاستلام من")} <strong>${s.source ?? pick(L, "the hub", "المستودع")}</strong>: ${drops.map((x) => x.short_code).join(pick(L, ", ", "، "))}</p>`)}
${stillPicking.length ? html`<p class="note">${icon("alert")} ${pick(L, `Still being picked at the hub: ${stillPicking.join(", ")}. Wait until it is packed.`, `ما زال قيد التجهيز في المستودع: ${stillPicking.join(pick(L, ", ", "، "))}. انتظر حتى يُجهَّز.`)}</p>` : ""}
<div class="actions-row">${form(c.f, `/rider-jobs/${r.driver_id}/picked_up`, html`<input type="hidden" name="delivery" value="${d.delivery_id}">${button({ label: pick(L, "Picked up: on the way", "تم الاستلام: في الطريق"), variant: "primary", icon: "truck" })}`, { cls: "inline" })}</div>` : ""}
${d && d.status === "in_progress" && drops.length ? html`<ul class="ak-rows">${drops.map((s) => stopRow(r, s, job!))}</ul>` : ""}
${r.unpaid.length ? html`<h3>${pick(L, "Cash to record", "نقد بانتظار التسجيل")}</h3><ul class="ak-rows">${r.unpaid.map((u) => cash(r, u))}</ul>` : ""}`, { title: r.name ?? pick(L, "Rider", "مندوب") });
  };

  const waitingRow = (w: Waiting) => html`<li${w.stranded ? html` data-state="late"` : ""}><div class="head"><strong>${w.short_code} · ${villageOf(w, L)}</strong><span class="tags">${statusPill(w.status, { lang: L })}${badge(payWord(w.payment_method, L), w.payment_method === "cod" ? "gold" : "ok", w.payment_method === "cod" ? "wallet" : "check")} ${badge(usd(w.total_usd))}${w.stranded ? badge(pick(L, "left on the road", "تُرك في الطريق"), "danger", "alert") : ""}</span></div>
${onShift.length ? form(c.f, "/rider-jobs/assign", html`<input type="hidden" name="order" value="${w.order_id}">${picker(w)}<div class="actions-row">${button({ label: pick(L, "Give to this rider", "أعطه لهذا المندوب"), variant: "primary", icon: "bike" })}</div>`)
  : html`<p class="muted">${pick(L, "No rider is on shift. Start a shift for one below.", "لا مندوب في الوردية. ابدأ وردية أحدهم أدناه.")}</p>`}</li>`;

  const pickupRow = (b: NonNullable<typeof pickBoard>[number]) => {
    const o = pickupInfo.find((x) => x.id === b.order_id);
    const needsCode = !!o?.handover_code && !o.handover_verified_at;
    const cod = o?.payment_method === "cod";
    return html`<li><div class="head"><strong>${b.short_code}</strong><span class="tags">${badge(pick(L, "pickup: no rider, no fee", "استلام: بلا مندوب ولا رسم"), "neutral", "store")} ${o ? badge(usd(o.total_usd)) : ""}</span></div>
${form(c.f, `/rider-jobs/pickup/${b.order_id}`, html`${needsCode ? input({ name: "code", label: pick(L, "The customer's 4-digit code", "رمز الزبون المكوّن من 4 أرقام"), required: true, maxlength: 4, attrs: { inputmode: "numeric", autocomplete: "off" } }) : ""}
${cod ? html`<div class="ak-money-fields">${input({ name: "usd", label: pick(L, "Dollars received", "دولارات مستلمة"), type: "text", attrs: { inputmode: "decimal" } })}${input({ name: "lbp", label: pick(L, "Lira received", "ليرات مستلمة"), type: "text", attrs: { inputmode: "numeric" } })}
${input({ name: "change_usd", label: pick(L, "Change given, dollars", "الباقي بالدولار"), type: "text", attrs: { inputmode: "decimal" } })}${input({ name: "change_lbp", label: pick(L, "Change given, lira", "الباقي بالليرة"), type: "text", attrs: { inputmode: "numeric" } })}</div>` : ""}
<div class="actions-row">${button({ label: pick(L, "Collected", "استُلم"), variant: "primary", icon: "check" })}</div>`)}</li>`;
  };

  return render(c, pick(L, "Dispatch", "التوزيع"), html`${riderTabs(L, "jobs")}
<p class="muted">${pick(L, "Give packed orders to a rider. The rider keeps the whole delivery fee. You are acting for the rider: every tap is recorded under your name and shows on the order's timeline; the rider is not messaged, the customer is told when the goods leave.", "أعطِ الطلبات الجاهزة لمندوب. يحتفظ المندوب بكامل رسم التوصيل. أنت تتصرف نيابةً عن المندوب: كل ضغطة تُسجَّل باسمك وتظهر في السجل الزمني للطلب؛ لا يُراسَل المندوب، ويُبلَغ الزبون عند خروج البضاعة.")}
 <span class="live" data-live>${t(L, "updated_at", { time: hm(now.toISOString()) })}</span></p>
<div class="ak-dispatch"><div>
<h2>${icon("pick")} ${pick(L, "Packed, waiting for a rider", "جاهز بانتظار مندوب")} (${packed.length})</h2>
${packed.length === 0 ? empty({ ok: true, title: pick(L, "No packed order is waiting for a rider.", "لا طلب جاهز ينتظر مندوباً.") }) : html`<ul class="ak-rows">${packed.map(waitingRow)}</ul>`}
${notPacked.length ? html`<h2>${pick(L, "Not packed yet", "لم يُجهَّز بعد")} (${notPacked.length})</h2><p class="muted">${pick(L, "These can be given now; the rider leaves only when each is packed.", "يمكن إعطاؤها الآن؛ لا يغادر المندوب إلا بعد تجهيز كل طلب.")}</p><ul class="ak-rows">${notPacked.map(waitingRow)}</ul>` : ""}
<p class="muted">${pick(L, "The system also offers these to riders on its own every minute. Giving one here offers it and accepts it for that rider.", "يعرض النظام هذه الطلبات على المناديب تلقائياً كل دقيقة. الإعطاء هنا يعرضها ويقبلها نيابةً عن ذلك المندوب.")}</p>
<h2 id="pickup">${icon("store")} ${pick(L, "Pickup shelf", "رف الاستلام")} (${pickups.length})</h2>
${pickups.length === 0 ? html`<p class="muted">${pick(L, "No order waits to be collected at the hub.", "لا طلب ينتظر الاستلام من المستودع.")}</p>` : html`<ul class="ak-rows">${pickups.map(pickupRow)}</ul>`}
</div><div>
<h2>${icon("bike")} ${pick(L, "Riders on shift", "المناديب في الوردية")} (${onShift.length})</h2>
${onShift.length === 0 ? empty({ title: pick(L, "No rider is on shift.", "لا مندوب في الوردية.") }) : html`<div class="ak-cards">${onShift.map(riderCard)}</div>`}
${capWords ? html`<p class="muted">${capWords}</p>` : ""}
${off.length ? html`<h2>${pick(L, "Off shift", "خارج الوردية")} (${off.length})</h2><div class="ak-cards">${off.map(riderCard)}</div>` : ""}
${riders.length === 0 ? empty({ title: pick(L, "No rider is registered.", "لا مندوب مسجّل.") }) : ""}
</div></div>`, { translated: true });
}

// ---------- the taps ----------
const ACTIONS = ["start_shift", "accept", "decline", "picked_up", "arrived", "delivered", "collect"] as const;
type Action = (typeof ACTIONS)[number];

async function tellOnTheWay(c: Ctx, delivery: string): Promise<string> {
  const { db } = c.deps;
  const stops = await db.rows<{ order_id: string }>("delivery_stops", { select: "order_id", where: { delivery_id: delivery, kind: "dropoff" } });
  if (!stops.length) return "";
  const orders = await db.rows<{ id: string; short_code: string; customer_id: string }>("orders", { select: "id,short_code,customer_id", where: { id: { in: stops.map((s) => s.order_id) } } });
  let failed = 0;
  for (const o of orders) { const n = await tell(c.deps, o.customer_id, "on_the_way", (m) => onTheWayNotice(o.short_code)(m), `on_the_way:${o.id}`, o.id); if (!n.sent) failed++; }
  return failed ? ` ${pick(c.lang, `${failed} customer(s) could not be told it is on the way.`, `تعذّر إبلاغ ${failed} زبون بأن طلبه في الطريق.`)}` : ` ${pick(c.lang, "The customer was told.", "أُبلغ الزبون.")}`;
}

const uuid = (L: Lang, v: string | null): string => { if (!v || !UUID.test(v)) throw new UserError(pick(L, "That record is not valid.", "هذا السجل غير صالح.")); return v; };

async function tap(c: Ctx) {
  const driver = id(c, "driver");
  const action = c.params.action as Action;
  if (!ACTIONS.includes(action)) throw new UserError(pick(c.lang, "Unknown action.", "إجراء غير معروف."));
  const L = c.lang;
  const order = (c.form.order ?? "").trim() || null;
  const delivery = (c.form.delivery ?? "").trim() || null;
  return doit(c, `rider_act_${action}`, { driver, order, delivery }, "/rider-jobs", async () => {
    const { db } = c.deps;
    const base = { p_by: c.staff.partyId, p_driver: driver, p_action: action };
    if (action === "start_shift") {
      const r = await db.rpc<{ started?: boolean }>("act_for_rider", base);
      return r.started === false ? pick(L, "Their shift was already open.", "ورديته مفتوحة بالفعل.") : pick(L, "Their shift is open. They can be offered jobs.", "فُتحت ورديته. يمكن عرض مهام عليه.");
    }
    if (action === "accept" || action === "decline") {
      const r = await db.rpc<{ ok: boolean; status: string; changed: boolean }>("act_for_rider", { ...base, p_delivery: uuid(L, delivery) });
      if (!r.changed) return pick(L, `Nothing changed: the job is already ${r.status}.`, `لم يتغيّر شيء: المهمة ${r.status} بالفعل.`);
      return action === "accept" ? pick(L, "Accepted for the rider.", "قُبلت نيابةً عن المندوب.") : pick(L, "Declined for the rider. The order will be offered to another rider.", "رُفضت نيابةً عن المندوب. سيُعرض الطلب على مندوب آخر.");
    }
    if (action === "picked_up") {
      const dlv = uuid(L, delivery);
      const r = await db.rpc<{ ok: boolean; status?: string; waiting?: string[] }>("act_for_rider", { ...base, p_delivery: dlv });
      if (!r.ok && r.status === "not_ready") throw new UserError(pick(L, `Still being picked at the hub: ${(r.waiting ?? []).join(", ")}.`, `ما زال قيد التجهيز في المستودع: ${(r.waiting ?? []).join(pick(L, ", ", "، "))}.`));
      if (!r.ok) throw new UserError(pick(L, `This job is ${r.status}: nothing was picked up.`, `هذه المهمة ${r.status}: لم يُستلم شيء.`));
      return pick(L, "Picked up: the orders are on the road.", "تم الاستلام: الطلبات في الطريق.") + (await tellOnTheWay(c, dlv));
    }
    const ord = uuid(L, order);
    if (action === "arrived") { await db.rpc("act_for_rider", { ...base, p_order: ord }); return pick(L, "Recorded: the rider is at the door.", "سُجّل: المندوب عند الباب."); }
    if (action === "delivered") {
      const code = (c.form.code ?? "").trim();
      if (code) {
        // A prepaid, gift or pickup order is handed over only against the customer's code (rider_handover, 0146): the same function the rider's own tap calls.
        const h = await db.rpc<{ ok: boolean; result?: string; tries_left?: number; needs_cash?: boolean }>("rider_handover", { p_order: ord, p_driver: driver, p_code: code });
        if (!h.ok) throw new UserError(h.result === "locked" ? pick(L, "Too many wrong tries: the code is locked and a person decides.", "محاولات خاطئة كثيرة: الرمز مقفل ويقرّر شخص.") : pick(L, `That is not the code. ${h.tries_left ?? 0} tries left.`, `هذا ليس الرمز. بقي ${h.tries_left ?? 0} محاولات.`));
        return h.needs_cash ? pick(L, "Delivered. Now record the cash the rider collected (below).", "سُلّم. سجّل الآن النقد الذي حصّله المندوب (أدناه).") : pick(L, "Delivered.", "سُلّم.");
      }
      const r = await db.rpc<{ needs_cash?: boolean; paid?: boolean }>("act_for_rider", { ...base, p_order: ord });
      return r.needs_cash ? pick(L, "Delivered. Now record the cash the rider collected (below).", "سُلّم. سجّل الآن النقد الذي حصّله المندوب (أدناه).") : pick(L, "Delivered.", "سُلّم.");
    }
    // cash, by currency
    let usdIn = num(c, "usd", { min: 0, optional: true }), lbpIn = num(c, "lbp", { min: 0, optional: true });
    const chUsd = num(c, "change_usd", { min: 0, optional: true }) ?? 0, chLbp = num(c, "change_lbp", { min: 0, optional: true }) ?? 0;
    if (c.form.exact === "1") {
      const owed = (await db.rpc<RiderRow["unpaid"] | null>("rider_unpaid_orders", { p_driver: driver }))?.find((x) => x.order_id === ord);
      if (!owed) throw new UserError(pick(L, "That order has no cash waiting to be recorded.", "لا نقد بانتظار التسجيل لهذا الطلب."));
      usdIn = Number(owed.total_usd); lbpIn = 0;
    }
    if (!usdIn && !lbpIn) throw new UserError(pick(L, "Type the amount received, in dollars, lira or both.", "اكتب المبلغ المستلم بالدولار أو الليرة أو كليهما."));
    const r = await db.rpc<{ duplicate?: boolean; cash_usd?: number | string; gate?: string; delivery_done?: boolean }>("act_for_rider", { ...base, p_order: ord, p_usd: usdIn ?? 0, p_lbp: lbpIn ?? 0, p_change_usd: chUsd, p_change_lbp: chLbp });
    if (r.duplicate) return pick(L, "That cash was already recorded; nothing changed.", "سُجّل هذا النقد بالفعل؛ لم يتغيّر شيء.");
    const gate = r.gate === "hard_cap" ? ` ${pick(L, "The rider is at the hard cash cap: they must hand cash in before another cash order.", "المندوب عند السقف الصارم للنقد: عليه تسليم النقد قبل طلب نقدي آخر.")}` : r.gate === "soft_cap" ? ` ${pick(L, "The rider is above the soft cash cap.", "المندوب فوق السقف المرن للنقد.")}` : "";
    return pick(L, `Cash recorded: ${usd(usdIn ?? 0)} and ${lbp(lbpIn ?? 0)}. The order is closed.${r.delivery_done ? " The job is complete." : ""}`, `سُجّل النقد: ${usd(usdIn ?? 0)} و ${lbp(lbpIn ?? 0)}. أُغلق الطلب.${r.delivery_done ? " اكتملت المهمة." : ""}`) + gate;
  });
}

async function assign(c: Ctx) {
  const order = id(c, "order"); const driver = id(c, "driver"); const L = c.lang;
  return doit(c, "rider_assign", { order, driver }, "/rider-jobs", async () => {
    await c.deps.db.rpc("act_for_rider", { p_by: c.staff.partyId, p_driver: driver, p_action: "assign", p_order: order });
    return pick(L, "Given to the rider: offered and accepted for them. They are not messaged.", "أُعطي للمندوب: عُرض وقُبل نيابةً عنه. لا تُرسل له رسالة.");
  });
}

/** A pickup order handed over at the hub (hub_handover, 0146): the code when it has one, and for cash what was received. The order closes only with its payment (invariant 12). */
async function pickup(c: Ctx) {
  const order = id(c, "order"); const L = c.lang;
  const code = (c.form.code ?? "").trim() || null;
  return doit(c, "pickup_handover", { order }, "/rider-jobs", async () => {
    const usdIn = num(c, "usd", { min: 0, optional: true }), lbpIn = num(c, "lbp", { min: 0, optional: true });
    const r = await c.deps.db.rpc<{ ok: boolean; already?: boolean; result?: string; reason?: string; tries_left?: number }>("hub_handover", {
      p_order: order, p_by: c.staff.partyId, p_code: code, p_usd: usdIn === null && lbpIn === null ? null : (usdIn ?? 0), p_lbp: lbpIn ?? 0,
      p_change_usd: num(c, "change_usd", { min: 0, optional: true }) ?? 0, p_change_lbp: num(c, "change_lbp", { min: 0, optional: true }) ?? 0 });
    if (r.already) return pick(L, "Already handed over.", "سُلّم بالفعل.");
    if (!r.ok) throw new UserError(r.result === "locked" ? pick(L, "Too many wrong tries: the code is locked and a person decides.", "محاولات خاطئة كثيرة: الرمز مقفل ويقرّر شخص.")
      : r.result === "wrong" ? pick(L, `That is not the code. ${r.tries_left ?? 0} tries left.`, `هذا ليس الرمز. بقي ${r.tries_left ?? 0} محاولات.`) : pick(L, "This order is not ready to be collected.", "هذا الطلب ليس جاهزاً للاستلام."));
    return pick(L, "Handed over and closed.", "سُلّم وأُغلق.");
  });
}

export const riderJobsSection: Section = {
  nav: { href: "/rider-jobs", label: "Rider jobs", roles: LEADS },
  routes: [
    { method: "GET", path: "/rider-jobs", roles: LEADS, handler: page },
    { method: "POST", path: "/rider-jobs/assign", roles: LEADS, handler: assign },
    { method: "POST", path: "/rider-jobs/pickup/:order", roles: LEADS, handler: pickup },
    { method: "POST", path: "/rider-jobs/:driver/:action", roles: LEADS, handler: tap },
  ],
};
