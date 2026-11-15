// D4b: the pick queue (docs/strategy/02-journeys.md, section 4 "Picking" and "Packing"; strategy 05, section A). A picker needs no WhatsApp:
// the orders to pick in the order they were promised, start, then line by line picked, missing or substitute, then done with a short
// packing checklist. Every action calls the SQL functions the ops line already calls (start_pick, pick_item_missing,
// pick_offer_substitute, pick_remove_missing, finish_pick through finish_pick_packed), with the signed-in person as the picker, and is
// written to the action log with who acted. Nothing is sent to the ops line. What the customer must hear (the order changed at the
// shelf, a substitute to answer) goes on the customer line, through the gateway (src/notices.ts). The rider is offered by the cron
// every minute, as before; with the queue switched on (settings.picking.console_queue) only once picking has started, and nothing
// leaves the hub before it is packed (0033, 0147). The packing steps are data (settings.packing_checklist), not words in this file.
import { attempt, flashRedirect, html, id, render, UserError, type Ctx, type Section } from "../app";
import { DbError } from "../db";
import { Raw, form, usd } from "../html";
import { pick, t, type Lang } from "../i18n";
import { ALL, LEADS } from "../roles";
import { pickChangeNotice, substitutionNotice, tell, type Offer, type PickChanges } from "../notices";
import { badge, button, card, empty, timerChip, type Tone } from "@ak/ui/components";
import { messages } from "@ak/agents/messages";

type Board = { order_id: string; short_code: string; status: string; is_pickup: boolean; confirmed_at: string | null; promise_at: string | null; promise_min: number | null;
  window: { starts: string; ends: string; day_offset: number } | null; village_ar: string | null; village_en: string | null; items: number; chilled: number; has_note: boolean;
  picker_id: string | null; picker: string | null; started_at: string | null; finished_at: string | null };
type Line = { n: number; item_id: string; name: string; qty: number | string; unit: string | null; storage: string; on_hold: boolean; note: string | null };
type Missing = { item_id: string; name: string; qty: number | string; status: string; reason: string | null; line_total_usd: number | string };
type PickList = { order_id: string; short_code: string; status: string; notes: string | null; picker_id: string | null; started_at: string | null; finished_at: string | null;
  total_usd: number | string; payment_method: string; lines: Line[]; missing: Missing[] };
type Candidate = { product_id: string; name: string; unit_price_usd: number | string; line_total_usd: number | string; diff_usd: number | string };
type Step = { key: string; when: "always" | "chilled"; en: string; ar: string };

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit" }) : "");
const mins = (iso: string | null, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)) : 0);
const STORAGE: Record<string, [string, string, Tone]> = { chilled: ["Chilled", "مبرّد", "gold"], frozen: ["Frozen", "مجمّد", "gold"], fresh: ["Fresh", "طازج", "gold"] };
const fmtQty = (q: number | string) => String(Number(q));
const lineWord = (L: Lang, n: number) => (L === "ar" ? `${n} ${n === 1 ? "بند" : "بنود"}` : `${n} ${n === 1 ? "line" : "lines"}`);
const local = (n: string) => n.replace(/[^0-9]/g, "").slice(0, 3);

/** Plain words for the refusals this page meets, in the staff member's language. The database decided; this only explains. */
function plain(L: Lang, e: unknown): unknown {
  if (!(e instanceof DbError)) return e;
  const m = e.message;
  const say = (en: string, ar: string) => new UserError(pick(L, en, ar));
  if (/LINES_NOT_CHECKED (\d+)/.test(m)) { const n = /LINES_NOT_CHECKED (\d+)/.exec(m)![1]; return say(`${n} line(s) are neither ticked as picked nor recorded as missing.`, `${n} بند لم يُؤشَّر عليه كملتقط ولم يُسجَّل كناقص.`); }
  if (/^NOT_BEING_PICKED/.test(m)) return say("This order is not being picked now.", "هذا الطلب ليس قيد التجهيز الآن.");
  if (/^SUBSTITUTES_OFF/.test(m)) return say("Substitutes are switched off.", "البدائل متوقفة.");
  if (/^OFFER_ALREADY_OPEN/.test(m)) return say("A substitute is already offered for this line.", "عُرض بديل لهذا البند بالفعل.");
  if (/^NOT_A_CANDIDATE|^OUT_OF_STOCK/.test(m)) return say("That substitute is no longer available.", "هذا البديل لم يعد متاحاً.");
  if (/^BAD_FOUND_QTY/.test(m)) return say("Type how many you found: zero up to less than the quantity ordered.", "اكتب كم وجدت: من صفر إلى أقل من الكمية المطلوبة.");
  if (/^LINE_NOT_MISSING/.test(m)) return say("That line is not waiting for a decision.", "هذا البند لا ينتظر قراراً.");
  if (/^ITEM_NOT_FOUND/.test(m)) return say("That line is no longer on the order.", "هذا البند لم يعد في الطلب.");
  return e;
}

/** Runs one action: logged first, the SQL called, logged again; success goes to `to`, a refusal back to `back`. */
async function doit(c: Ctx, action: string, args: Record<string, unknown>, back: string, run: () => Promise<{ msg: string; to?: string }>): Promise<Response> {
  let to = back;
  const r = await attempt(c, action, args, async () => {
    try { const x = await run(); if (x.to) to = x.to; return x.msg; } catch (e) { throw plain(c.lang, e); }
  });
  return flashRedirect(c.deps, r.logged && r.ok ? to : back, r.logged ? r.msg : { err: pick(c.lang, "Not done: the action log could not be written. Try again in a minute.", "لم يتم: تعذّر تسجيل الإجراء. حاول بعد دقيقة.") });
}

const village = (b: Pick<Board, "village_ar" | "village_en" | "is_pickup">, L: Lang) => (b.is_pickup ? pick(L, "pickup at the hub", "استلام من المركز") : (L === "ar" ? b.village_ar || b.village_en : b.village_en || b.village_ar) ?? "");

// ---------- the queue ----------
async function board(c: Ctx) {
  const { db } = c.deps;
  const L = c.lang;
  const now = c.deps.now();
  const [rows, mine, cfg] = await Promise.all([
    db.rpc<Board[] | null>("console_pick_board", {}),
    db.rpc<string | null>("pick_open_for", { p_picker: c.staff.partyId }),
    db.rpc<{ console_queue?: boolean } | null>("setting", { p_key: "picking" }).catch(() => null),
  ]);
  const all = rows ?? [];
  const waiting = all.filter((x) => x.status === "confirmed");
  const busy = all.filter((x) => x.status === "preparing");
  const packed = all.filter((x) => x.status === "ready");
  const row = (b: Board, opts: { start?: boolean; open?: boolean }) => {
    const age = mins(b.confirmed_at, now);
    const chip = b.window
      ? timerChip({ minutes: 0, promise: null, state: "idle", text: `${pick(L, "window", "نافذة")} ${b.window.starts}-${b.window.ends}` })
      : timerChip({ minutes: age, promise: b.promise_min, text: `${age} ${t(L, "min")}${b.promise_at ? ` · ${pick(L, "promised", "الوعد")} ${hm(b.promise_at)}` : ""}` });
    const late = !b.window && b.promise_min !== null && age > b.promise_min;
    return html`<li${late ? new Raw(' data-state="late"') : ""}><div class="head"><strong>${b.short_code} · ${village(b, L)}</strong>${chip}</div>
<div class="tags">${badge(lineWord(L, b.items))}${b.chilled > 0 ? badge(`${b.chilled} ${pick(L, "chilled or frozen", "مبرّد أو مجمّد")}`, "gold") : ""}${b.has_note ? badge(pick(L, "customer note", "ملاحظة الزبون"), "warn", "alert") : ""}
${b.picker ? badge(`${pick(L, "picker", "المجهّز")}: ${b.picker}`, b.picker_id === c.staff.partyId ? "ok" : "neutral", "user") : ""}${b.status === "ready" ? badge(pick(L, `packed ${hm(b.finished_at)}`, `جُهّز ${hm(b.finished_at)}`), "ok", "check") : ""}</div>
${opts.start || opts.open ? html`<div class="actions-row">${opts.start ? form(c.f, `/pick/${b.order_id}/start`, button({ label: pick(L, "Start picking", "ابدأ التجهيز"), variant: "primary", icon: "stock" }), { cls: "inline" }) : ""}
${opts.open ? button({ label: pick(L, "Open the list", "افتح القائمة"), href: `/pick/${b.order_id}`, variant: b.picker_id === c.staff.partyId ? "primary" : "default" }) : ""}</div>` : ""}</li>`;
  };
  const myOrder = mine ? all.find((x) => x.order_id === mine) : undefined;
  const lead = LEADS.includes(c.staff.role);

  return render(c, pick(L, "Pick queue", "قائمة التجهيز"), html`
<p class="muted">${pick(L, "Orders to pick, the one promised first at the top. Start one, tick each line or say what is missing, then finish with the packing steps. No WhatsApp needed.", "الطلبات المطلوب تجهيزها، الأقرب وعداً في الأعلى. ابدأ طلباً، أشّر على كل بند أو قل ما الناقص، ثم أنهِ بخطوات التعبئة. لا حاجة إلى واتساب.")}
 <span class="live" data-live>${t(L, "updated_at", { time: hm(now.toISOString()) })}</span></p>
${myOrder ? card(html`<p><strong>${pick(L, `You are picking ${myOrder.short_code}.`, `أنت تجهّز ${myOrder.short_code}.`)}</strong></p>
<div class="actions-row">${button({ label: pick(L, "Continue", "تابع"), href: `/pick/${myOrder.order_id}`, variant: "primary", icon: "stock" })}</div>`, { title: pick(L, "Your open pick", "تجهيزك المفتوح") }) : ""}
<h2>${pick(L, "Waiting to be picked", "بانتظار التجهيز")} (${waiting.length})</h2>
${waiting.length === 0 ? empty({ ok: true, title: pick(L, "Nothing is waiting.", "لا شيء بالانتظار.") }) : html`<ul class="ak-rows">${waiting.map((b) => row(b, { start: !mine }))}</ul>${mine ? html`<p class="muted">${pick(L, "Finish the order you started before you start another.", "أنهِ الطلب الذي بدأته قبل أن تبدأ آخر.")}</p>` : ""}`}
${busy.length ? html`<h2>${pick(L, "Being picked", "قيد التجهيز")} (${busy.length})</h2><ul class="ak-rows">${busy.map((b) => row(b, { open: true }))}</ul>` : ""}
${packed.length ? html`<h2>${pick(L, "Packed, waiting for the rider", "جاهز بانتظار المندوب")} (${packed.length})</h2><ul class="ak-rows">${packed.map((b) => row(b, {}))}</ul>` : ""}
${lead ? card(html`<p class="muted">${pick(L, "When this is on, a rider is offered an order only once its picking has started, and nothing is handed to a rider before it is packed. Turn it on when the hub picks on the console.", "عند التفعيل لا يُعرض الطلب على مندوب إلا بعد بدء تجهيزه، ولا يُسلَّم لمندوب قبل أن يُجهَّز. فعّله عندما يُجهَّز في المركز عبر اللوحة.")}</p>
<p>${cfg?.console_queue ? badge(pick(L, "on", "مفعّل"), "ok", "check") : badge(pick(L, "off", "متوقف"))}</p>
${form(c.f, "/pick/queue-mode", html`<input type="hidden" name="on" value="${cfg?.console_queue ? "0" : "1"}">${button({ label: cfg?.console_queue ? pick(L, "Turn off", "إيقاف") : pick(L, "Turn on", "تفعيل"), variant: "default" })}`)}`,
  { title: pick(L, "Offer the rider when picking starts", "عرض الطلب على المندوب عند بدء التجهيز") }) : ""}`, { translated: true });
}

async function queueMode(c: Ctx) {
  const on = c.form.on === "1";
  return doit(c, "pick_queue_mode", { on }, "/pick", async () => {
    await c.deps.db.rpc("set_console_pick_queue", { p_by: c.staff.partyId, p_on: on });
    return { msg: on ? pick(c.lang, "On: a rider is offered an order when its picking starts.", "تم التفعيل: يُعرض الطلب على المندوب عند بدء تجهيزه.") : pick(c.lang, "Off: orders are offered as before.", "تم الإيقاف: تُعرض الطلبات كما في السابق.") };
  });
}

async function start(c: Ctx) {
  const order = id(c, "order");
  const L = c.lang;
  return doit(c, "pick_start", { order }, "/pick", async () => {
    const r = await c.deps.db.rpc<{ status: string; open_order?: string; open_code?: string; short_code?: string; order_status?: string; held?: string[]; picker_id?: string }>("start_pick", { p_order: order, p_by: c.staff.partyId });
    if (r.status === "started" || r.status === "already") {
      const held = r.held?.length ? ` ${pick(L, "On hold and taken off:", "موقوف ومُزال:")} ${r.held.join(pick(L, ", ", "، "))}.` : "";
      return { msg: pick(L, "Picking started.", "بدأ التجهيز.") + held, to: `/pick/${order}` };
    }
    if (r.status === "taken") throw new UserError(pick(L, "Someone else is already picking this order.", "شخص آخر يجهّز هذا الطلب بالفعل."));
    if (r.status === "busy") throw new UserError(pick(L, `Finish ${r.open_code ?? "your open order"} first.`, `أنهِ ${r.open_code ?? "طلبك المفتوح"} أولاً.`));
    throw new UserError(pick(L, `${r.short_code ?? "This order"} cannot be picked now (${r.order_status ?? "not ready"}).`, `لا يمكن تجهيز ${r.short_code ?? "هذا الطلب"} الآن (${r.order_status ?? ""}).`));
  });
}

// ---------- one order's list ----------
async function list(c: Ctx) {
  const { db } = c.deps;
  const L = c.lang;
  const order = id(c, "order");
  const [l, rows, marks, offers, cfg] = await Promise.all([
    db.rpc<PickList | null>("pick_list", { p_order: order }),
    db.rpc<Board[] | null>("console_pick_board", {}),
    db.rows<{ item_id: string }>("pick_line_marks", { select: "item_id", where: { order_id: order } }),
    db.rows<{ id: string; missing_item_id: string; expires_at: string }>("substitution_offers", { select: "id,missing_item_id,expires_at", where: { order_id: order, status: "open" } }).catch(() => []),
    db.rpc<{ offer_substitutes?: boolean } | null>("setting", { p_key: "picking" }).catch(() => null),
  ]);
  if (!l || !l.order_id) return flashRedirect(c.deps, "/pick", { err: pick(L, "That order was not found.", "لم يُعثر على هذا الطلب.") });
  const b = (rows ?? []).find((x) => x.order_id === order);
  const marked = new Set(marks.map((m) => m.item_id));
  const now = c.deps.now();
  const open = l.status === "preparing" && !l.finished_at;
  const mineOrLead = !l.picker_id || l.picker_id === c.staff.partyId || LEADS.includes(c.staff.role);
  const askMissing = c.url.searchParams.get("missing");
  const pending = l.missing.filter((m) => m.status === "missing");
  const taken = l.missing.filter((m) => m.status === "removed");
  const picked = l.lines.filter((x) => marked.has(x.item_id)).length;
  const back = html`<p>${button({ label: pick(L, "Back to the queue", "العودة إلى القائمة"), href: "/pick", variant: "ghost" })}</p>`;

  if (!open) {
    return render(c, `${l.short_code}`, html`${back}${empty({ title: l.status === "ready" || l.finished_at ? pick(L, "This order is packed.", "هذا الطلب جُهّز.") : pick(L, "This order is not being picked.", "هذا الطلب ليس قيد التجهيز."), ok: !!l.finished_at })}`, { translated: true });
  }

  // candidates for each missing line, only when substitutes are on and no offer is open yet
  const offerFor = new Map(offers.map((o) => [o.missing_item_id, o]));
  const cands = new Map<string, Candidate[]>();
  if (cfg?.offer_substitutes) {
    await Promise.all(pending.filter((m) => !offerFor.has(m.item_id)).map(async (m) => {
      const r = await db.rpc<{ candidates?: Candidate[] } | null>("substitute_candidates", { p_missing: m.item_id }).catch(() => null);
      cands.set(m.item_id, r?.candidates ?? []);
    }));
  }

  const lineRow = (x: Line) => {
    const done = marked.has(x.item_id);
    const st = STORAGE[x.storage];
    return html`<li id="l${x.n}" data-state="${done ? "done" : ""}"><div class="head"><strong><bdi class="qty">${fmtQty(x.qty)} ×</bdi> <bdi>${x.name}</bdi></strong>
<span class="tags">${x.unit && x.unit.toLowerCase() !== "each" ? badge(x.unit) : ""}${st ? badge(pick(L, st[0], st[1]), st[2]) : ""}${x.on_hold ? badge(pick(L, "on hold", "موقوف"), "danger", "alert") : ""}${done ? badge(pick(L, "picked", "مُلتقط"), "ok", "check") : ""}</span></div>
${x.note ? html`<p class="muted">${pick(L, "Note", "ملاحظة")}: ${x.note}</p>` : ""}
${mineOrLead ? html`<div class="actions-row">
${form(c.f, `/pick/${order}/mark/${x.item_id}`, html`<input type="hidden" name="n" value="${x.n}"><input type="hidden" name="picked" value="${done ? "0" : "1"}">${done
  ? button({ label: pick(L, "Undo", "تراجع"), variant: "ghost" })
  : button({ label: pick(L, "Picked", "تم الالتقاط"), variant: "primary", icon: "check" })}`, { cls: "inline" })}
${done ? "" : button({ label: pick(L, "Missing or short", "ناقص أو أقل"), href: `/pick/${order}?missing=${x.item_id}#l${x.n}`, variant: "default", icon: "alert" })}</div>` : ""}
${askMissing === x.item_id && mineOrLead ? html`<div class="note">${form(c.f, `/pick/${order}/missing/${x.item_id}`, html`<input type="hidden" name="n" value="${x.n}">
<label>${pick(L, `How many did you find? (0 if none; less than ${fmtQty(x.qty)})`, `كم وجدت؟ (0 إن لم تجد؛ أقل من ${fmtQty(x.qty)})`)}
<input type="number" name="found" min="0" step="any" value="0" inputmode="decimal" required></label>
${button({ label: pick(L, "Record it", "سجّل"), variant: "danger" })}`)}</div>` : ""}</li>`;
  };

  const missingRow = (m: Missing) => {
    const offer = offerFor.get(m.item_id);
    const options = cands.get(m.item_id) ?? [];
    return html`<li data-state="missing"><div class="head"><strong><bdi class="qty">${fmtQty(m.qty)} ×</bdi> <bdi>${m.name}</bdi></strong><span class="tags">${badge(pick(L, "missing", "ناقص"), "warn", "alert")}</span></div>
${offer ? html`<p>${pick(L, `A substitute was offered. Waiting for the customer until ${hm(offer.expires_at)}.`, `عُرض بديل. بانتظار الزبون حتى ${hm(offer.expires_at)}.`)}</p>` : ""}
${!offer && options.length ? html`<p class="muted">${pick(L, "Offer the customer one substitute, or take the line off the order.", "اعرض على الزبون بديلاً واحداً، أو أزل البند من الطلب.")}</p>
<div class="actions-row">${options.map((o) => form(c.f, `/pick/${order}/offer/${m.item_id}/${o.product_id}`, button({ label: `${o.name} · ${Number(o.diff_usd) === 0 ? pick(L, "same price", "نفس السعر") : `${Number(o.diff_usd) > 0 ? "+" : "−"}${usd(Math.abs(Number(o.diff_usd)))}`}`, variant: "default" }), { cls: "inline" }))}</div>` : ""}
<div class="actions-row">${form(c.f, `/pick/${order}/remove/${m.item_id}`, button({ label: offer ? pick(L, "Withdraw and take it off", "اسحب العرض وأزل البند") : pick(L, "Take it off the order", "أزل البند من الطلب"), variant: "default" }), { cls: "inline" })}</div></li>`;
  };

  return render(c, `${l.short_code} · ${b ? village(b, L) : ""}`, html`${back}
<p>${badge(`${picked} / ${l.lines.length} ${pick(L, "picked", "ملتقط")}`, picked === l.lines.length && pending.length === 0 ? "ok" : "neutral", "stock")}
${l.picker_id && l.picker_id !== c.staff.partyId ? badge(pick(L, "picked by someone else", "يجهّزه شخص آخر"), "warn", "user") : ""}
${b && b.promise_at ? timerChip({ minutes: mins(b.confirmed_at, now), promise: b.promise_min, text: `${pick(L, "promised", "الوعد")} ${hm(b.promise_at)}` }) : ""}</p>
${l.notes ? html`<div class="note"><strong>${pick(L, "Customer's note", "ملاحظة الزبون")}:</strong> <bdi>${l.notes}</bdi></div>` : ""}
${pending.length ? html`<h2>${pick(L, "Decide on the missing lines", "قرّر بشأن البنود الناقصة")} (${pending.length})</h2><ul class="ak-rows">${pending.map(missingRow)}</ul>` : ""}
<h2>${pick(L, "Lines to pick, in shelf order", "بنود التجهيز بترتيب الرفوف")}</h2>
${l.lines.length === 0 ? empty({ title: pick(L, "No line is left to pick.", "لا بند متبقٍّ للتجهيز.") }) : html`<ul class="ak-rows">${l.lines.map(lineRow)}</ul>`}
${taken.length ? html`<h2>${pick(L, "Taken off this order", "أُزيل من هذا الطلب")}</h2><ul class="ak-rows">${taken.map((m) => html`<li><div class="head"><span><bdi>${fmtQty(m.qty)} × ${m.name}</bdi></span><span class="muted">${usd(m.line_total_usd)}</span></div></li>`)}</ul>` : ""}
<div class="actions-row">${button({ label: pick(L, "All picked: packing and done", "تم الالتقاط: التعبئة والإنهاء"), href: `/pick/${order}/done`, variant: "primary", icon: "check" })}</div>`, { translated: true });
}

async function mark(c: Ctx) {
  const order = id(c, "order"); const item = id(c, "item");
  const picked = c.form.picked !== "0";
  return doit(c, picked ? "pick_line_picked" : "pick_line_unpicked", { order, item }, `/pick/${order}#l${local(c.form.n ?? "")}`, async () => {
    await c.deps.db.rpc("pick_mark_line", { p_item: item, p_by: c.staff.partyId, p_picked: picked });
    return { msg: picked ? pick(c.lang, "Picked.", "تم الالتقاط.") : pick(c.lang, "Unmarked.", "أُلغي التأشير.") };
  });
}

async function missing(c: Ctx) {
  const order = id(c, "order"); const item = id(c, "item"); const L = c.lang;
  const found = Number((c.form.found ?? "").replace(",", "."));
  if (!Number.isFinite(found) || found < 0) throw new UserError(pick(L, "Type how many you found (0 if none).", "اكتب كم وجدت (0 إن لم تجد)."));
  return doit(c, "pick_line_missing", { order, item, found }, `/pick/${order}#l${local(c.form.n ?? "")}`, async () => {
    const { db } = c.deps;
    await db.rpc("pick_mark_line", { p_item: item, p_by: c.staff.partyId, p_picked: false });     // what was ticked before no longer holds
    const r = await db.rpc<{ decision: string; total_usd: number | string; credit_usd?: number | string; substitute_name?: string }>("pick_item_missing", { p_item: item, p_by: c.staff.partyId, p_found: found });
    // CX1: the customer chose "closest match" on the card; the database kept it for them, so nothing is asked.
    if (r.decision === "substituted") {
      const l = await db.rpc<{ short_code?: string } | null>("pick_list", { p_order: order }).catch(() => null);
      return { msg: messages(L).ops.subKept(l?.short_code ?? "", r.substitute_name ?? "") };
    }
    const credit = Number(r.credit_usd ?? 0) > 0 ? ` ${pick(L, `Credit owed to the customer: ${usd(r.credit_usd)}.`, `رصيد للزبون: ${usd(r.credit_usd)}.`)}` : "";
    if (r.decision === "pending") return { msg: pick(L, "Recorded as missing. Offer a substitute or take the line off.", "سُجّل كناقص. اعرض بديلاً أو أزل البند.") };
    return { msg: pick(L, `Taken off the order. The new total is ${usd(r.total_usd)}.`, `أُزيل من الطلب. المجموع الجديد ${usd(r.total_usd)}.`) + credit };
  });
}

async function remove(c: Ctx) {
  const order = id(c, "order"); const item = id(c, "missing"); const L = c.lang;
  return doit(c, "pick_line_remove", { order, item }, `/pick/${order}`, async () => {
    const r = await c.deps.db.rpc<{ total_usd: number | string }>("pick_remove_missing", { p_missing: item, p_by: c.staff.partyId });
    return { msg: pick(L, `Taken off the order. The new total is ${usd(r.total_usd)}.`, `أُزيل من الطلب. المجموع الجديد ${usd(r.total_usd)}.`) };
  });
}

async function offer(c: Ctx) {
  const order = id(c, "order"); const item = id(c, "missing"); const product = id(c, "product"); const L = c.lang;
  return doit(c, "pick_offer_substitute", { order, item, product }, `/pick/${order}`, async () => {
    const o = await c.deps.db.rpc<Offer>("pick_offer_substitute", { p_missing: item, p_product: product, p_by: c.staff.partyId });
    const n = await tell(c.deps, o.customer_id, "substitute_question", (m) => substitutionNotice(o, m.lang), `subask:${o.offer_id}`, o.order_id);
    return { msg: n.sent ? pick(L, `The customer was asked. They have ${o.answer_min} minutes; no answer means the line is taken off.`, `سُئل الزبون. أمامه ${o.answer_min} دقائق؛ وعدم الرد يعني إزالة البند.`)
      : pick(L, `Offer saved, but the customer could not be asked (${n.why}). Take the line off, or wait: it ends by itself in ${o.answer_min} minutes.`, `حُفظ العرض لكن تعذّر سؤال الزبون (${n.why}). أزل البند أو انتظر: ينتهي تلقائياً بعد ${o.answer_min} دقائق.`) };
  });
}

// ---------- done: the packing checklist ----------
async function steps(c: Ctx, l: PickList): Promise<Step[]> {
  const cfg = await c.deps.db.rpc<{ items?: Step[] } | null>("setting", { p_key: "packing_checklist" }).catch(() => null);
  const chilled = l.lines.some((x) => x.storage !== "ambient");
  return (cfg?.items ?? []).filter((s) => s.when === "always" || (s.when === "chilled" && chilled));
}

async function doneForm(c: Ctx) {
  const { db } = c.deps; const L = c.lang;
  const order = id(c, "order");
  const [l, marks] = await Promise.all([db.rpc<PickList | null>("pick_list", { p_order: order }), db.rows<{ item_id: string }>("pick_line_marks", { select: "item_id", where: { order_id: order } })]);
  if (!l || l.status !== "preparing") return flashRedirect(c.deps, "/pick", { err: pick(L, "This order is not being picked.", "هذا الطلب ليس قيد التجهيز.") });
  const marked = new Set(marks.map((m) => m.item_id));
  const unmarked = l.lines.filter((x) => !marked.has(x.item_id));
  const pending = l.missing.filter((m) => m.status === "missing");
  const all = await steps(c, l);
  const blocked = unmarked.length > 0 || pending.length > 0;
  return render(c, `${l.short_code} · ${pick(L, "packing", "التعبئة")}`, html`
<p>${button({ label: pick(L, "Back to the list", "العودة إلى القائمة"), href: `/pick/${order}`, variant: "ghost" })}</p>
${blocked ? html`<div class="note">${unmarked.length ? html`<p><strong>${pick(L, `${unmarked.length} line(s) are not ticked yet:`, `${unmarked.length} بند لم يُؤشَّر عليه بعد:`)}</strong> ${unmarked.map((x) => x.name).join(pick(L, ", ", "، "))}</p>` : ""}
${pending.length ? html`<p><strong>${pick(L, "Waiting for a decision:", "بانتظار قرار:")}</strong> ${pending.map((x) => x.name).join(pick(L, ", ", "، "))}</p>` : ""}</div>` : ""}
${form(c.f, `/pick/${order}/done`, html`<fieldset class="card"><legend><strong>${pick(L, "Packing steps", "خطوات التعبئة")}</strong></legend>
${all.length === 0 ? html`<p class="muted">${pick(L, "No packing step is set.", "لا خطوات تعبئة محدّدة.")}</p>` : all.map((s) => html`<label class="ak-check"><input type="checkbox" name="check_${s.key}" value="1" required><span>${L === "ar" ? s.ar : s.en}</span></label>`)}
<p class="muted">${pick(L, `Write the order code ${l.short_code} and the village on the bag.`, `اكتب رمز الطلب ${l.short_code} واسم القرية على الكيس.`)}</p></fieldset>
${button({ label: pick(L, "Packed: done", "جُهّز: إنهاء"), variant: "primary", icon: "check", disabled: blocked })}`)}`, { translated: true });
}

async function done(c: Ctx) {
  const order = id(c, "order"); const L = c.lang;
  return doit(c, "pick_done", { order }, `/pick/${order}/done`, async () => {
    const { db } = c.deps;
    const l = await db.rpc<PickList | null>("pick_list", { p_order: order });
    if (!l) throw new UserError(pick(L, "That order was not found.", "لم يُعثر على هذا الطلب."));
    const need = await steps(c, l);
    const checked = need.filter((s) => c.form[`check_${s.key}`] === "1").map((s) => s.key);
    if (checked.length < need.length) throw new UserError(pick(L, "Tick every packing step first.", "أشّر على كل خطوات التعبئة أولاً."));
    const r = await db.rpc<{ status: string; short_code: string; customer_id?: string; changed?: boolean; changes?: PickChanges }>("finish_pick_packed", { p_order: order, p_by: c.staff.partyId, p_packing: { checked } });
    if (r.status === "waiting") throw new UserError(pick(L, "A missing line still waits for a decision.", "بند ناقص ما زال ينتظر قراراً."));
    if (r.status === "empty") return { msg: pick(L, `Nothing is left on ${r.short_code}. The ops lead was told.`, `لم يبقَ شيء في ${r.short_code}. أُبلغ مسؤول العمليات.`), to: "/pick" };
    if (r.status === "not_started" || r.status === "not_pickable") throw new UserError(pick(L, "This order is not being picked.", "هذا الطلب ليس قيد التجهيز."));
    let said = "";
    if (r.status === "ready" && r.changes && r.customer_id && pickChangeNotice(r.changes)) {
      const changes = r.changes;
      const n = await tell(c.deps, r.customer_id, "shelf_changes", (m) => pickChangeNotice(changes, m.lang)!, `pickdone:${order}`, order);
      said = n.sent ? ` ${pick(L, "The customer was told what changed.", "أُبلغ الزبون بما تغيّر.")}` : ` ${pick(L, `The customer could not be told what changed (${n.why}): phone them.`, `تعذّر إبلاغ الزبون بما تغيّر (${n.why}): اتصل به.`)}`;
    }
    return { msg: pick(L, `${r.short_code} is packed. A rider can take it.`, `${r.short_code} جاهز. يمكن للمندوب استلامه.`) + said, to: "/pick" };
  });
}

export const pickSection: Section = {
  nav: { href: "/pick", label: "Pick queue", roles: ALL },
  routes: [
    { method: "GET", path: "/pick", roles: ALL, handler: board },
    { method: "POST", path: "/pick/queue-mode", roles: LEADS, handler: queueMode },
    { method: "POST", path: "/pick/:order/start", roles: ALL, handler: start },
    { method: "GET", path: "/pick/:order", roles: ALL, handler: list },
    { method: "POST", path: "/pick/:order/mark/:item", roles: ALL, handler: mark },
    { method: "POST", path: "/pick/:order/missing/:item", roles: ALL, handler: missing },
    { method: "POST", path: "/pick/:order/remove/:missing", roles: ALL, handler: remove },
    { method: "POST", path: "/pick/:order/offer/:missing/:product", roles: ALL, handler: offer },
    { method: "GET", path: "/pick/:order/done", roles: ALL, handler: doneForm },
    { method: "POST", path: "/pick/:order/done", roles: ALL, handler: done },
  ],
};
