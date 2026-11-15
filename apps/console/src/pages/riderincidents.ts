// D4b: rider incidents on the console (docs/strategy/02-journeys.md, section 3 "Safety and help"; the functions are C2's, 0035): a rider who
// cannot continue (mark_rider_off), their order handed to another rider (act_for_rider "assign": the transfer), an order called off with no
// charge when no rider can take it (call_off_stranded), and the cash a rider held, counted and received at the hub (receive_rider_cash).
// The same functions the ops line's buttons call, with the signed-in person as the actor; nothing here is sent to the ops line. The
// customers of the orders left on the road are told on the customer line that their order is delayed, or called off. The cron offers
// every order that waits for a rider to the next one, every minute, as before. Leads only.
import { html, id, render, UserError, type Ctx, type Section } from "../app";
import { form, lbp, usd, when } from "../html";
import { pick } from "../i18n";
import { LEADS } from "../roles";
import { calledOffNotice, delayedNotice, tell } from "../notices";
import { badge, button, dataTable, empty, select } from "@ak/ui/components";
import { doit, ltr, payWord, readBoard, riderTabs, villageOf } from "./riderjobs";

type Incident = { id: string; driver_id: string; by_party: string; reason: string; detail: { requeued?: unknown[]; stranded?: unknown[]; cash_usd?: number; cash_lbp?: number }; created_at: string };
type Off = { already?: boolean; rider: string | null; requeued: { order_id: string; short_code: string }[]; stranded: { order_id: string; short_code: string; customer_id: string }[]; cash_usd: number | string; cash_lbp: number | string };

async function page(c: Ctx) {
  const { db } = c.deps; const L = c.lang;
  const [{ riders, waiting }, incidents] = await Promise.all([
    readBoard(c),
    db.rows<Incident>("rider_incidents", { select: "id,driver_id,by_party,reason,detail,created_at", order: [{ col: "created_at", desc: true }], limit: 15 }).catch(() => [] as Incident[]),
  ]);
  const people = incidents.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: [...new Set(incidents.flatMap((i) => [i.driver_id, i.by_party]))] } } }) : [];
  const name = (p: string) => people.find((x) => x.id === p)?.display_name ?? pick(L, "someone", "شخص");
  const onShift = riders.filter((r) => r.on_shift);
  const stranded = waiting.filter((w) => w.stranded);
  const holding = riders.filter((r) => !r.on_shift && (Math.abs(Number(r.cash_usd)) > 0.004 || Math.abs(Number(r.cash_lbp)) > 0.4));

  return render(c, pick(L, "Rider incidents", "حوادث المناديب"), html`${riderTabs(L, "incidents")}
<p class="muted">${pick(L, "When a rider cannot go on (an accident, a breakdown, a dead phone). Everything you press is recorded under your name.", "عندما لا يستطيع المندوب المتابعة (حادث، عطل، هاتف متوقف). كل ما تضغط عليه يُسجَّل باسمك.")}</p>
<h2>${pick(L, "A rider cannot continue", "مندوب لا يستطيع المتابعة")} (${onShift.length})</h2>
${onShift.length === 0 ? empty({ ok: true, title: pick(L, "No rider is on shift.", "لا مندوب في الوردية.") }) : html`<ul class="ak-rows">${onShift.map((r) => html`<li><div class="head"><strong>${r.name ?? pick(L, "Rider", "مندوب")}</strong><span class="tags">${r.delivery ? badge(pick(L, "has a job", "لديه مهمة"), "gold", "truck") : badge(pick(L, "no job", "بلا مهمة"))}${badge(ltr(`${usd(r.cash_usd)} + ${lbp(r.cash_lbp)}`), "neutral", "wallet")}</span></div>
${form(c.f, `/rider-incidents/${r.driver_id}/off`, html`<label class="ak-check"><input type="checkbox" name="sure" value="1" required><span>${pick(L, "Their shift ends. A job not yet picked up goes back to the queue; an order already on the road waits for another rider.", "تنتهي ورديته. المهمة التي لم تُستلم تعود إلى القائمة؛ والطلب الذي في الطريق ينتظر مندوباً آخر.")}</span></label>
${button({ label: pick(L, "This rider cannot continue", "هذا المندوب لا يستطيع المتابعة"), variant: "danger", icon: "alert" })}`)}</li>`)}</ul>`}
<h2>${pick(L, "On the road with nobody", "في الطريق بلا مندوب")} (${stranded.length})</h2>
${stranded.length === 0 ? empty({ ok: true, title: pick(L, "No order is left on the road.", "لا طلب متروك في الطريق.") }) : html`<ul class="ak-rows">${stranded.map((w) => html`<li><div class="head"><strong>${w.short_code} · ${villageOf(w, L)}</strong><span class="tags">${badge(payWord(w.payment_method, L))}${badge(usd(w.total_usd))}</span></div>
${onShift.length ? form(c.f, "/rider-jobs/assign", html`<input type="hidden" name="order" value="${w.order_id}">${select({ name: "driver", label: pick(L, "Another rider", "مندوب آخر"), hideLabel: true, options: onShift.map((r) => ({ value: r.driver_id, label: r.name ?? pick(L, "Rider", "مندوب") })) })}
<div class="actions-row">${button({ label: pick(L, "Transfer to this rider", "حوّل إلى هذا المندوب"), variant: "primary", icon: "bike" })}</div>`) : html`<p class="muted">${pick(L, "No rider is on shift to take it.", "لا مندوب في الوردية ليأخذه.")}</p>`}
${form(c.f, `/rider-incidents/${w.order_id}/call-off`, html`<label class="ak-check"><input type="checkbox" name="sure" value="1" required><span>${pick(L, "Call it off: no charge to the customer, the goods come back for counting, and a paid order is owed its money as credit.", "إلغاء التوصيل: بلا رسوم على الزبون، وتعود البضاعة للعدّ، ويُمنح الطلب المدفوع رصيداً.")}</span></label>
${button({ label: pick(L, "Call it off, no charge", "ألغِ التوصيل بلا رسوم"), variant: "default" })}`)}</li>`)}</ul>`}
<h2>${pick(L, "Cash to receive at the hub", "نقد بانتظار الاستلام في المركز")} (${holding.length})</h2>
${holding.length === 0 ? empty({ ok: true, title: pick(L, "No rider off shift holds cash.", "لا مندوب خارج الوردية يحمل نقداً.") }) : html`<ul class="ak-rows">${holding.map((r) => html`<li><div class="head"><strong>${r.name ?? pick(L, "Rider", "مندوب")}</strong><span class="tags">${badge(ltr(`${usd(r.cash_usd)} + ${lbp(r.cash_lbp)}`), "gold", "wallet")}</span></div>
${form(c.f, `/rider-incidents/${r.driver_id}/cash`, html`<label class="ak-check"><input type="checkbox" name="sure" value="1" required><span>${pick(L, `I counted ${usd(r.cash_usd)} and ${lbp(r.cash_lbp)} with the rider. Record it as handed in at the hub.`, `عددتُ ${usd(r.cash_usd)} و ${lbp(r.cash_lbp)} مع المندوب. سجّله كمُسلَّم في المركز.`)}</span></label>
${button({ label: pick(L, "Cash received", "تم استلام النقد"), variant: "primary", icon: "wallet" })}`)}</li>`)}</ul>`}
<h2>${pick(L, "Recent incidents", "آخر الحوادث")}</h2>
${dataTable({ caption: pick(L, "Recent rider incidents", "آخر حوادث المناديب"), empty: html`<p class="muted">${pick(L, "None yet.", "لا شيء بعد.")}</p>`,
  columns: [{ label: pick(L, "When", "متى") }, { label: pick(L, "Rider", "المندوب") }, { label: pick(L, "By", "بواسطة") }, { label: pick(L, "Orders back in the queue", "طلبات عادت للقائمة"), num: true }, { label: pick(L, "Left on the road", "متروكة في الطريق"), num: true }],
  rows: incidents.map((i) => ({ cells: [when(i.created_at), name(i.driver_id), name(i.by_party), i.detail?.requeued?.length ?? 0, i.detail?.stranded?.length ?? 0] })) })}`, { translated: true });
}

async function off(c: Ctx) {
  const driver = id(c, "driver"); const L = c.lang;
  return doit(c, "rider_off", { driver }, "/rider-incidents", async () => {
    if (c.form.sure !== "1") throw new UserError(pick(L, "Tick the box to confirm.", "أشّر على المربع للتأكيد."));
    const r = await c.deps.db.rpc<Off>("mark_rider_off", { p_driver: driver, p_by: c.staff.partyId, p_reason: "cannot_continue" });
    if (r.already) return pick(L, `${r.rider ?? "The rider"} was already off.`, `${r.rider ?? "المندوب"} خارج الوردية بالفعل.`);
    let told = 0, failed = 0;
    for (const x of r.stranded) {
      const n = await tell(c.deps, x.customer_id, "order_delayed", (m) => delayedNotice(x.short_code)(m), `riderinc:${x.order_id}`, x.order_id);
      if (n.sent) told++; else failed++;
    }
    const cash = Number(r.cash_usd) || Number(r.cash_lbp) ? pick(L, ` Cash they hold: ${usd(r.cash_usd)} and ${lbp(r.cash_lbp)}: count it on the incidents page.`, ` النقد الذي يحمله: ${usd(r.cash_usd)} و ${lbp(r.cash_lbp)}: عدّه في صفحة الحوادث.`) : "";
    return pick(L, `${r.rider ?? "The rider"} is off. ${r.requeued.length} job(s) back in the queue; ${r.stranded.length} order(s) on the road wait for a rider (${r.stranded.map((x) => x.short_code).join(", ") || "none"}).${r.stranded.length ? ` ${told} customer(s) told of the delay${failed ? `, ${failed} could not be told` : ""}.` : ""}`,
      `${r.rider ?? "المندوب"} خارج الوردية. ${r.requeued.length} مهمة عادت للقائمة؛ ${r.stranded.length} طلب في الطريق ينتظر مندوباً (${r.stranded.map((x) => x.short_code).join(pick(L, ", ", "، ")) || "لا شيء"}).${r.stranded.length ? ` أُبلغ ${told} زبون بالتأخير${failed ? `، وتعذّر إبلاغ ${failed}` : ""}.` : ""}`) + cash;
  });
}

async function callOff(c: Ctx) {
  const order = id(c, "order"); const L = c.lang;
  return doit(c, "rider_call_off", { order }, "/rider-incidents", async () => {
    if (c.form.sure !== "1") throw new UserError(pick(L, "Tick the box to confirm.", "أشّر على المربع للتأكيد."));
    const r = await c.deps.db.rpc<{ ok: boolean; status: string; short_code: string; customer_id?: string; credit_usd?: number | string }>("call_off_stranded", { p_order: order, p_by: c.staff.partyId });
    if (!r.ok) return pick(L, `${r.short_code} was not called off (${r.status}).`, `لم يُلغَ توصيل ${r.short_code} (${r.status}).`);
    let said = "";
    if (r.customer_id) {
      const n = await tell(c.deps, r.customer_id, "delivery_called_off", (m) => calledOffNotice(r.short_code, Number(r.credit_usd ?? 0))(m), `calloff:${order}`, order);
      said = n.sent ? pick(L, " The customer was told.", " أُبلغ الزبون.") : pick(L, ` The customer could not be told (${n.why}): phone them.`, ` تعذّر إبلاغ الزبون (${n.why}): اتصل به.`);
    }
    return pick(L, `${r.short_code} is called off. The goods come back through the returns count.${said}`, `أُلغي توصيل ${r.short_code}. تعود البضاعة عبر عدّ المرتجعات.${said}`);
  });
}

async function cash(c: Ctx) {
  const driver = id(c, "driver"); const L = c.lang;
  return doit(c, "rider_cash_received", { driver }, "/rider-incidents", async () => {
    if (c.form.sure !== "1") throw new UserError(pick(L, "Tick the box to say you counted it.", "أشّر على المربع لتأكيد أنك عددته."));
    const r = await c.deps.db.rpc<{ nothing?: boolean; usd: number | string; lbp: number | string }>("receive_rider_cash", { p_driver: driver, p_by: c.staff.partyId });
    return r.nothing ? pick(L, "This rider holds no cash.", "لا نقد مع هذا المندوب.") : pick(L, `Received at the hub: ${usd(r.usd)} and ${lbp(r.lbp)}.`, `استُلم في المركز: ${usd(r.usd)} و ${lbp(r.lbp)}.`);
  });
}

export const riderIncidentsSection: Section = {
  nav: { href: "/rider-incidents", label: "Rider incidents", roles: LEADS },
  routes: [
    { method: "GET", path: "/rider-incidents", roles: LEADS, handler: page },
    { method: "POST", path: "/rider-incidents/:driver/off", roles: LEADS, handler: off },
    { method: "POST", path: "/rider-incidents/:order/call-off", roles: LEADS, handler: callOff },
    { method: "POST", path: "/rider-incidents/:driver/cash", roles: LEADS, handler: cash },
  ],
};
