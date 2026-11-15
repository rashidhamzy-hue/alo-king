// 3.2 Today (redesigned in D5): what needs a person first, oldest first, each with its one action; then orders late or at risk, riders
// with cash against the cap, the drawer, and a short green summary when the day is quiet. Reads only; the two buttons on an
// exception post to the exceptions page's own forms.
// "Late" is measured against the zone's ETA from the database (zones.base_eta_minutes), never a number in code (invariant 13).
import { html, render, type Ctx, type Section } from "../app";
import { form, lbp, minutesSince, usd, when } from "../html";
import { pick, t } from "../i18n";
import { kindCta, kindHref, kindName } from "../kinds";
import { ALL, LEADS } from "../roles";

export const ACTIVE = ["awaiting_confirmation", "awaiting_payment", "confirmed", "preparing", "ready", "out_for_delivery", "arrived", "failed_delivery", "delivered"] as const;
const IN_PROGRESS = new Set(["confirmed", "preparing", "ready", "out_for_delivery", "arrived"]);
const WORDS_AR: Record<string, string> = {
  awaiting_confirmation: "أُرسلت البطاقة بانتظار ضغطة الزبون", awaiting_payment: "بانتظار تحويل", confirmed: "مؤكد", preparing: "قيد التجهيز", ready: "جاهز",
  out_for_delivery: "في الطريق", arrived: "المندوب عند الباب", failed_delivery: "فشل التوصيل: البضاعة ستعود", delivered: "سُلّم ولم يُدفع بعد", closed: "مُغلق", cancelled: "مُلغى",
};
export const statusWord = (lang: "en" | "ar", s: string) => (lang === "ar" ? WORDS_AR[s] : WORDS[s]) ?? s;
const WORDS: Record<string, string> = {
  awaiting_confirmation: "card sent, waiting for the customer's tap", awaiting_payment: "waiting for a transfer", confirmed: "confirmed",
  preparing: "being picked", ready: "packed", out_for_delivery: "on the way", arrived: "rider at the door",
  failed_delivery: "failed delivery: goods to come back", delivered: "delivered, not paid yet", closed: "closed", cancelled: "cancelled",
};

/** Midnight in Beirut, as an instant. */
export function beirutMidnight(now: Date): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return new Date(now.getTime() - (((parts.hour ?? 0) % 24) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)) * 1000 - now.getMilliseconds());
}

type Order = { id: string; short_code: string; status: string; village_id: string | null; is_pickup: boolean; total_usd: number | string;
  payment_method: string; created_at: string; confirmed_at: string | null; customer_id: string };

export async function todayData(c: Ctx) {
  const { db } = c.deps;
  const now = c.deps.now();
  const since = beirutMidnight(now).toISOString();
  const [active, finished, villages, zones, waiting] = await Promise.all([
    db.rows<Order>("orders", { select: "id,short_code,status,village_id,is_pickup,total_usd,payment_method,created_at,confirmed_at,customer_id", where: { status: { in: ACTIVE } }, order: [{ col: "created_at" }], limit: 500 }),
    db.rows<{ status: string }>("orders", { select: "status", where: { status: { in: ["closed", "cancelled"] }, created_at: { gte: since } }, limit: 5000 }),
    db.rows<{ id: string; name_en: string; zone_id: string | null }>("villages", { select: "id,name_en,zone_id" }),
    db.rows<{ id: string; base_eta_minutes: number }>("zones", { select: "id,base_eta_minutes" }),
    db.rpc<string[] | null>("orders_waiting_for_rider", {}),
  ]);
  const village = new Map(villages.map((v) => [v.id, v]));
  const eta = new Map(zones.map((z) => [z.id, Number(z.base_eta_minutes)]));
  const noRider = new Set(waiting ?? []);
  const orders = active.map((o) => {
    const v = o.village_id ? village.get(o.village_id) : undefined;
    const limit = v?.zone_id ? eta.get(v.zone_id) ?? null : null;
    const age = minutesSince(o.confirmed_at ?? o.created_at, now) ?? 0;
    const lateBy = IN_PROGRESS.has(o.status) && limit !== null && o.confirmed_at ? age - limit : null;
    return { ...o, villageName: v?.name_en ?? (o.is_pickup ? "pickup at the hub" : ""), eta: limit, age, lateBy, noRider: noRider.has(o.id) };
  });
  orders.sort((a, b) => (b.lateBy ?? -1e9) - (a.lateBy ?? -1e9) || b.age - a.age);

  const counts = new Map<string, number>();
  for (const o of [...active, ...finished]) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);

  const shifts = await db.rows<{ driver_id: string; started_at: string; opening_float_usd: number | string }>("driver_shifts", { select: "driver_id,started_at,opening_float_usd", where: { ended_at: null } });
  const ids = shifts.map((s) => s.driver_id);
  const names = ids.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: ids } } }) : [];
  const cap = (await db.rpc<{ soft_usd?: number; hard_usd?: number } | null>("setting", { p_key: "cash_cap" })) ?? {};
  const riders = await Promise.all(shifts.map(async (s) => {
    const [native, held, exposure] = await Promise.all([
      db.rpc<{ usd: number | string; lbp: number | string }[]>("driver_cash_native", { p_driver: s.driver_id }),
      db.rpc<number | string>("driver_cash_usd", { p_driver: s.driver_id }),
      db.rpc<number | string>("driver_exposure_usd", { p_driver: s.driver_id }),
    ]);
    const n = Array.isArray(native) ? native[0] : (native as unknown as { usd: number; lbp: number } | null);
    return { ...s, name: names.find((p) => p.id === s.driver_id)?.display_name ?? "Rider", usd: Number(n?.usd ?? 0), lbp: Number(n?.lbp ?? 0),
             heldUsd: Number(held ?? 0), exposure: Number(exposure ?? 0) };
  }));
  return { orders, counts, riders, cap: { soft: Number(cap.soft_usd ?? 0), hard: Number(cap.hard_usd ?? 0) } };
}

type Exc = { id: string; kind: string; ref: string; detail: Record<string, unknown> | null; status: string; created_at: string };
const detailText = (d: Record<string, unknown> | null) => Object.entries(d ?? {}).filter(([k]) => !/(_id|^id$|customer)/.test(k)).slice(0, 5).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 200);

/** The exception inbox's data. Each read is on its own: a database that lags costs that block, never the page. */
async function inboxData(c: Ctx) {
  const { db } = c.deps;
  const [excs, chats, cfg] = await Promise.all([
    db.rows<Exc>("ops_exceptions", { select: "id,kind,ref,detail,status,created_at", where: { status: { in: ["open", "acknowledged"] } }, order: [{ col: "created_at" }], limit: 100 }).catch(() => [] as Exc[]),
    // HO1: customers waiting for a person are the open cases (0135); no chat is locked any more.
    db.rows<{ id: string }>("support_cases", { select: "id", where: { state: { in: ["open", "claimed"] } }, limit: 100 }).catch(() => [] as { id: string }[]),
    db.rpc<{ high_priority_kinds?: string[] } | null>("setting", { p_key: "push_alerts" }).catch(() => null),
  ]);
  return { excs, chats: chats.length, high: new Set(cfg?.high_priority_kinds ?? []) };
}

async function today(c: Ctx) {
  const L = c.lang;
  const lead = LEADS.includes(c.staff.role);
  const [d, inbox] = await Promise.all([todayData(c), lead ? inboxData(c) : Promise.resolve({ excs: [] as Exc[], chats: 0, high: new Set<string>() })]);
  const now = c.deps.now();
  const word = (s: string) => statusWord(L, s);
  const statusOrder = [...ACTIVE, "closed", "cancelled"];
  const late = d.orders.filter((o) => (o.lateBy ?? 0) > 0).length;
  const atRisk = d.orders.filter((o) => (o.lateBy ?? 0) > 0 || o.noRider);
  const overCap = d.riders.filter((r) => d.cap.soft && r.exposure >= d.cap.soft);
  const quiet = inbox.excs.length === 0 && inbox.chats === 0 && atRisk.length === 0 && overCap.length === 0;
  const orderLink = (o: { id: string; short_code: string }) => (lead ? html`<a href="/orders/${o.id}">${o.short_code}</a>` : o.short_code);

  let drawer: unknown = "";
  if (lead) {
    try {
      const v = await c.deps.db.rpc<{ drawer: { usd: number | string; lbp: number | string } }>("hub_cash_view", { p_since: beirutMidnight(now).toISOString() });
      drawer = html`<h2>${t(L, "drawer_h")}</h2><p>${t(L, "drawer_line", { amount: `${usd(v.drawer.usd)}${Number(v.drawer.lbp) ? ` + ${lbp(v.drawer.lbp)}` : ""}` })} <a href="/money">${pick(L, "Hub money", "نقد المركز")}</a></p>`;
    } catch { /* the drawer line stays off */ }
  }

  return render(c, t(L, "today_title"), html`
${lead ? html`<h2>${t(L, "inbox_h")}${inbox.excs.length ? html` (${inbox.excs.length})` : ""}</h2>
${inbox.excs.length === 0 && inbox.chats === 0 ? html`<p class="muted">${t(L, "nothing_needs")}</p>` : ""}
${inbox.excs.length ? html`<ul class="inbox">${inbox.excs.map((e) => html`<li class="${inbox.high.has(e.kind) ? "high" : ""}">
<strong>${kindName(e.kind, L)}</strong>${inbox.high.has(e.kind) ? html` <span class="tag high">${t(L, "high")}</span>` : ""}${e.status === "acknowledged" ? html` <span class="tag">${t(L, "being_handled")}</span>` : ""}
<br><span class="muted">${when(e.created_at)} · ${minutesSince(e.created_at, now)} ${t(L, "min")}${detailText(e.detail) ? html` · ${detailText(e.detail)}` : ""}</span>
<div class="actions"><a class="btn primary" href="${kindHref(e)}">${kindCta(e.kind, L)}</a>
${e.status === "open" ? form(c.f, `/exceptions/${e.id}/acknowledged`, html`<input type="hidden" name="back" value="/"><button class="secondary">${t(L, "im_on_it")}</button>`) : ""}
${form(c.f, `/exceptions/${e.id}/resolved`, html`<input type="hidden" name="back" value="/"><button class="secondary">${t(L, "resolved")}</button>`)}</div></li>`)}</ul>` : ""}
${inbox.chats ? html`<p><a class="btn" href="/inbox">${t(L, "chats_waiting", { n: inbox.chats })}</a></p>` : ""}` : ""}
${quiet ? html`<p class="summary-ok">${t(L, "quiet_summary")}</p>` : ""}
${atRisk.length ? html`<h2>${t(L, "at_risk_h")} (${atRisk.length})</h2><ul class="inbox">${atRisk.map((o) => html`<li class="${(o.lateBy ?? 0) > 0 ? "high" : ""}">
<strong>${orderLink(o)}</strong> · ${word(o.status)}${(o.lateBy ?? 0) > 0 ? html` · <strong class="warn">${o.lateBy} ${pick(L, "min late", "د تأخير")}</strong>` : ""}${o.noRider ? html` · <strong class="warn">${pick(L, "no rider yet", "لا مندوب بعد")}</strong>` : ""}
<br><span class="muted">${o.villageName} · ${usd(o.total_usd)} · ${o.payment_method}</span></li>`)}</ul>` : ""}
<p>${late ? html`<strong class="warn">${late} ${pick(L, "late", "متأخر")}</strong> · ` : ""}${statusOrder.filter((s) => d.counts.get(s)).map((s, i) => html`${i ? " · " : ""}${word(s)}: ${d.counts.get(s)}`)}
<span class="muted"> (${pick(L, "closed and cancelled: since midnight, Beirut", "المُغلقة والمُلغاة: منذ منتصف الليل بتوقيت بيروت")})</span></p>
<h2>${t(L, "open_orders_h")}</h2>
${d.orders.length === 0 ? html`<p class="muted">${pick(L, "No open orders.", "لا طلبات مفتوحة.")}</p>` : html`<table><tr><th>${pick(L, "Order", "الطلب")}</th><th>${pick(L, "Status", "الحالة")}</th><th>${t(L, "village")}</th><th>${t(L, "total")}</th><th>${pick(L, "Pay", "الدفع")}</th><th>${pick(L, "Minutes", "الدقائق")}</th><th>${pick(L, "Zone ETA", "الوقت المتوقع")}</th></tr>
${d.orders.map((o) => html`<tr class="${(o.lateBy ?? 0) > 0 ? "late" : ""}"><td>${orderLink(o)}</td>
<td>${word(o.status)}${o.noRider ? html` <strong class="warn">· ${pick(L, "no rider yet", "لا مندوب بعد")}</strong>` : ""}</td><td>${o.villageName}</td>
<td>${usd(o.total_usd)}</td><td>${o.payment_method}</td>
<td>${o.age}${(o.lateBy ?? 0) > 0 ? html` <strong>(${o.lateBy} ${pick(L, "late", "تأخير")})</strong>` : ""}</td><td>${o.eta ?? ""}</td></tr>`)}</table>`}
<h2>${t(L, "riders_h")}</h2>
${d.riders.length === 0 ? html`<p class="muted">${pick(L, "No rider on shift.", "لا مندوب في الوردية.")}</p>` : html`<table><tr><th>${pick(L, "Rider", "المندوب")}</th><th>${t(L, "since")}</th><th>${pick(L, "Cash held", "النقد المحتفظ به")}</th><th>${pick(L, "Held, in USD", "المحتفظ به بالدولار")}</th><th>${pick(L, "Exposure", "التعرض")}</th></tr>
${d.riders.map((r) => html`<tr class="${d.cap.hard && r.exposure >= d.cap.hard ? "late" : ""}"><td>${r.name}</td><td>${when(r.started_at)}</td>
<td>${usd(r.usd)}${r.lbp ? html` + ${lbp(r.lbp)}` : ""}</td><td>${usd(r.heldUsd)}</td>
<td>${usd(r.exposure)}${d.cap.soft && r.exposure >= d.cap.soft ? html` <strong class="warn">${pick(L, "above the soft cap", "فوق السقف المرن")} (${usd(d.cap.soft)})</strong>` : ""}</td></tr>`)}</table>
<p class="muted">${pick(L, "Exposure is the cash held plus cash still to collect on accepted jobs. The database refuses a job that would pass the hard cap", "التعرض هو النقد المحتفظ به مضافاً إليه النقد المنتظر تحصيله من المهام المقبولة. ترفض قاعدة البيانات أي مهمة تتجاوز السقف الصارم")} (${usd(d.cap.hard)}).</p>`}
${drawer}`, { translated: true });
}

export const todaySection: Section = {
  nav: { href: "/", label: "Today", roles: ALL },
  routes: [{ method: "GET", path: "/", roles: ALL, handler: today }],
};
