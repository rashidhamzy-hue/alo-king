// M1: the brief's nine rules (SYSTEM_BRIEF "Message design"), checked on every fixed message in ar, en and fr, and a snapshot of
// every message per language (packages/agents/test/__snapshots__/messages.<lang>.md) committed with the pull request, so a person
// reads the words before they ship. A template added to messages/types.ts without a sample here fails "every template is rendered".
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Outbound } from "@ak/wa/kapso";
import { asLang, LANGS, langFromReading, langOfText, messages, productName, windowLabel, windowRow, type Lang, type Messages } from "@ak/agents/messages";
import { buttonReplyText, formatOrderCard, formatWindowChoice, type CardInput, type DeliveryWindow, type Quote } from "@ak/agents/order-card";
import { repeatOfferText, statusText, type OrderStatus } from "@ak/agents/answers";
import { checkModelText, modelSentences } from "@ak/agents/output-guard";
import { templateMessage } from "@ak/agents/messages/notify";
import { pickCard, pickChangeText, returnCard, substitutionQuestion } from "../../../apps/gateway/src/ops-turn";
import { cashAsk, dropCard, offerCard, pickupCard, type Job } from "@ak/agents/job-card";

// ---------- the rules ----------
const ALLOWED = new Set(["📍", "🛒", "🛵", "✅", "💵", "🌙", "⚠️", "📦", "🏠", "🔢"]);
const GREETING_ONLY = "👑";
const MAX_LINE = 120;          // rule 1: about three phone lines
const MAX_EMOJI = 3;           // rule 4
const AMOUNT = /-?\$\d+(?:\.\d{2})?|\d{1,3}(?:,\d{3})+ (?:ل\.ل|LBP)|\b\d+ (?:ل\.ل|LBP)/gu;
const EMOJI = /\p{Extended_Pictographic}️?/gu;

interface Rendered { key: string; text: string; greeting?: boolean; kind?: "card" | "template" }

function problems(r: Rendered, m: Messages): string[] {
  const out: string[] = [];
  const lines = r.text.split("\n");
  // A template's values are one line each (Meta takes no line break inside a value): rule 1 is for messages.
  if (r.kind !== "template") lines.forEach((l, i) => { if (l.length > MAX_LINE) out.push(`rule 1: line ${i + 1} has ${l.length} characters`); });
  const emojis = (r.text.match(EMOJI) ?? []).map((e) => e.replace("️", "") === "⚠" ? "⚠️" : e);
  for (const e of emojis) {
    if (e === GREETING_ONLY ? !r.greeting : !ALLOWED.has(e)) out.push(`rule 4: emoji ${e} not allowed here`);
  }
  if (emojis.length > MAX_EMOJI) out.push(`rule 4: ${emojis.length} emojis`);
  if ((r.text.match(/\*/g) ?? []).length % 2) out.push("rule 5: an unmatched *");
  lines.forEach((l, i) => {
    for (const b of l.match(/\*[^*]+\*/g) ?? []) {
      const whole = l.trim() === b || l.trim().endsWith(b) && l.trim().startsWith("🛒");
      const total = /المجموع|Total|total/u.test(b);
      const heading = i === 0 || l.startsWith("🛒 ");
      if (!whole || (!heading && !total)) out.push(`rule 5: bold "${b}" is neither a heading nor the total`);
    }
  });
  if (/[٠-٩۰-۹]/u.test(r.text)) out.push("rule 7: Arabic-Indic digits");
  lines.forEach((l, i) => {
    const found = l.match(AMOUNT) ?? [];
    if (found.length > 1) out.push(`rule 7: line ${i + 1} has ${found.length} amounts: ${l}`);
    if (found.length === 1 && !l.replace(/[*.]+$/u, "").trimEnd().endsWith(found[0]!)) out.push(`rule 7: the amount is not on its own line: ${l}`);
  });
  void m;
  return out;
}

// ---------- samples ----------
const CODE = "AK-1042";
const W = (offset: number, dow = 3): DeliveryWindow => ({ slot_id: "11111111-2222-4333-8444-555555555555", date: "2026-11-18", dow, day_offset: offset, starts: "10:00", ends: "12:00" });
const LINES = [
  { product_id: "p1", name: "Tannourine water 2 L (pack of 6)", name_ar: "كرتونة مي تنورين 2 ليتر (6 قناني)", qty: 1, unit: "pack", line_total_usd: 2.01 },
  { product_id: "p2", name: "Al Forno white bread, large 800 g", name_ar: "خبز الفورنو أبيض كبير 800 غ", qty: 1, unit: "each", line_total_usd: 1.01 },
  { product_id: "p3", name: "Najjar Classic coffee 180 g", name_ar: null, qty: 1, unit: "each", line_total_usd: 3.25 },
];
const QUOTE: Quote = { ok: true, issues: [], lines: LINES, subtotal_usd: 6.27, delivery_fee_usd: 1, total_usd: 7.27, fx_rate_lbp: 89500, total_lbp: 651000,
  eta_minutes: 30, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: null };
const ADDRESS = { village_en: "Baakline", village_ar: "بعقلين", building: "بيت الاختبار", floor: "الطابق 2" };
const ORDER = "99999999-8888-4777-8666-555555555555";

function cards(lang: Lang): { key: string; input: CardInput }[] {
  const base: CardInput = { orderId: ORDER, shortCode: CODE, quote: QUOTE, paymentMethod: "cod", lang, address: ADDRESS };
  return [
    { key: "card.now", input: base },
    { key: "card.change", input: { ...base, changeForUsd: 20 } },
    { key: "card.window", input: { ...base, window: W(1) } },
    { key: "card.windowFar", input: { ...base, window: W(5) } },
    { key: "card.pickup", input: { ...base, quote: { ...QUOTE, pickup: true, delivery_fee_usd: 0, total_usd: 6.27, total_lbp: 561000 }, address: null } },
    { key: "card.extras", input: { ...base, paymentMethod: "whish", quote: { ...QUOTE, small_order_fee_usd: 0.5, dues_usd: 1.5, credit_usd: 1.25, total_usd: 8.02, total_lbp: 718000 } } },
    { key: "card.firstOrder", input: { ...base, paymentMethod: "whish", prepay: { reason: "first_order", maxCodUsd: 50 } } },
    { key: "card.replaces", input: { ...base, window: W(1), replaces: "AK-1040" } },
    { key: "card.noAddress", input: { ...base, address: null } },
  ];
}
const bodyOf = (o: Outbound): string => o.type === "text" ? o.text.body : o.type === "interactive" ? (o.interactive as { body: { text: string } }).body.text : JSON.stringify(o);
const buttonsOf = (o: Outbound): string[] => o.type !== "interactive" ? [] :
  ((o.interactive as { action?: { buttons?: { reply: { title: string } }[] } }).action?.buttons ?? []).map((b) => b.reply.title);

/** Every template in one language, with sample values, keyed by its path in Messages (and composed messages by name). */
function render(m: Messages): Rendered[] {
  const L = m.lang;
  const when = windowLabel(W(1), L);
  const names = LINES.map((l) => productName(l, L));
  const r: Rendered[] = [];
  const add = (key: string, text: string, extra: Partial<Rendered> = {}) => r.push({ key, text, ...extra });
  const c = m.card;
  add("card.heading", c.heading(CODE)); add("card.item", c.item("2", names[0]!, ["بلا ملح"])); add("card.more", c.more(3));
  add("card.delivery", m.amount(c.delivery(L === "ar" ? "بعقلين" : "Baakline"), 1)); add("card.smallOrder", m.amount(c.smallOrder, 0.5));
  add("card.dues", m.amount(c.dues, 1.5)); add("card.credit", m.amount(c.credit, -1.25)); add("card.total", `*${m.amount(c.total, 7.27)}*`);
  add("card.orLbp", c.orLbp(651000)); add("card.address", c.address("Baakline")); add("card.pickup", c.pickup); add("card.eta", c.eta(30));
  add("card.deliverNow", c.deliverNow); add("card.window", c.window(when)); add("card.payment", c.payment("cod"));
  for (const k of ["cod", "whish", "omt"] as const) add(`card.payName.${k}`, c.payName[k]);
  add("card.changeFor", c.changeFor); add("card.prepayFirst", c.prepayFirst(c.payName.whish, 50)); add("card.prepay", c.prepay(c.payName.whish));
  add("card.replaces", c.replaces("AK-1040")); add("card.consent", c.consent);
  add("card.confirm", c.confirm); add("card.edit", c.edit); add("card.cancel", c.cancel);
  for (const x of cards(L)) formatOrderCard(x.input).forEach((o, i, all) => add(`${x.key}${all.length > 1 ? `.${i + 1}` : ""}`, bodyOf(o), { kind: i === all.length - 1 ? "card" : undefined }));
  const long = formatOrderCard({ orderId: ORDER, shortCode: CODE, quote: { ...QUOTE, lines: Array.from({ length: 40 }, (_, i) => ({ ...LINES[i % 3]!, qty: i + 1 })) }, paymentMethod: "cod", lang: L, address: ADDRESS },
                               { before: m.answer.someMissing([names[2]!]) });
  long.forEach((o, i) => add(`card.long.${i + 1}`, bodyOf(o), { kind: i === long.length - 1 ? "card" : undefined }));

  const t = m.tap;
  add("tap.confirmed", t.confirmed(CODE)); add("tap.confirmedFor", t.confirmedFor(CODE, when)); add("tap.replaced", t.replaced(CODE, "AK-1040", when));
  add("tap.awaitingPayment", t.awaitingPayment(CODE, when, 7.27, t.channel("whish", "70123456"))); add("tap.channel", t.channel("omt", null));
  add("tap.draft", t.draft(CODE)); add("tap.cancelled", t.cancelled(CODE)); add("tap.cancelledCredit", t.cancelledCredit(CODE, 7.27));
  add("tap.slotFull", t.slotFull(CODE, when)); add("tap.slotClosed", t.slotClosed(CODE, null)); add("tap.changeOpen", t.changeOpen(CODE, when));
  add("tap.tooLate", t.tooLate(CODE, when)); add("tap.inProgress", t.inProgress(CODE)); add("tap.needsLocation", t.needsLocation);
  for (const status of ["confirmed", "awaiting_payment", "draft", "cancelled", "slot_full", "slot_closed", "change_open", "too_late", "preparing"])
    add(`buttonReply.${status}`, buttonReplyText({ status, short_code: CODE, changed: true, payment_method: "omt", total_usd: 7.27, window: status === "confirmed" ? null : W(1), credit_usd: status === "cancelled" ? 3 : 0 }, { omt: "70123456" }, L));

  const f = m.fixed;
  for (const k of ["audioUnusable", "handoff", "optOut", "optIn", "outOfStock", "error", "oneMoment", "offTopic", "askPhone", "badPhone", "phoneSaved", "askPin",
                   "askAddress", "askVillage", "pinOutside", "fxPaused", "pinVillageRefused", "keptButton", "keptOpen", "keptGone", "askVillageLandmark", "noPinNote",
                   "welcome"] as const) add(`fixed.${k}`, f[k]);
  add("fixed.noPinCall", f.noPinCall("بعقلين"));
  add("fixed.notAvailable", f.notAvailable(["سناك أبو علي"])); add("fixed.notAvailable.none", f.notAvailable([]));
  add("fixed.pinReceived", f.pinReceived("بعقلين")); add("fixed.pinReceivedThenAddress", [f.pinReceived("بعقلين"), "", f.askAddress].join("\n"));
  add("fixed.pinVillage", f.pinVillage("الخريبة", "بعقلين")); add("fixed.pinSaved", f.pinSaved("بعقلين"));
  add("fixed.closedKept", f.closedKept("08:00", names.slice(0, 2).map((n, i) => `${i + 1} × ${n}`))); add("fixed.closedKeptPin", f.closedKeptPin("08:00", names.slice(0, 1).map((n) => `2 × ${n}`)));
  add("fixed.priced", [f.priced(names[0]!, 2.01, true), f.priced(names[2]!, 3.25, false)].join("\n"));

  const w = m.windows;
  for (const k of ["choose", "button", "now", "none", "gone", "noneAt", "noneAtAll", "nowUnavailable", "orChoose", "pickupNoWindow", "restaurantNoWindow"] as const) add(`windows.${k}`, w[k]);
  add("windows.freshForWindow", w.freshForWindow([names[1]!])); add("windows.notChangeable", w.notChangeable(CODE));
  const list = formatWindowChoice(ORDER, [W(0), W(1), W(2, 4), W(3, 5), W(4, 6), W(5, 7), W(6, 1)], { withNow: true, lang: L });
  const rows = (list as unknown as { interactive: { action: { sections: { rows: { title: string; description?: string }[] }[] } } }).interactive.action.sections[0]!.rows;
  add("windows.list", [bodyOf(list), ...rows.map((x) => `[${x.title}${x.description ? ` | ${x.description}` : ""}]`)].join("\n"));

  const a = m.answer;
  const st = (status: string, extra: Partial<OrderStatus> = {}) => statusText({ short_code: CODE, status, total_usd: 7.27, payment_method: "cod", is_pickup: false, eta_remaining_minutes: 20, ...extra }, L);
  for (const s of ["awaiting_confirmation", "awaiting_payment", "confirmed", "ready", "out_for_delivery", "arrived", "delivered", "failed_delivery", "other"]) add(`status.${s}`, st(s));
  for (const s of ["awaiting_confirmation", "awaiting_payment", "confirmed", "preparing"]) add(`status.scheduled.${s}`, st(s, { window: W(1) }));
  add("status.ready.pickup", st("ready", { is_pickup: true }));
  add("answer.noOpenOrder", a.noOpenOrder); add("answer.noOpenRepeat", a.noOpenRepeat(names.slice(0, 3), 2)); add("answer.awaitingConfirmation", a.awaitingConfirmation(CODE, null)); add("answer.awaitingPayment", a.awaitingPayment(CODE, when, 7.27));
  add("answer.confirmedFor", a.confirmedFor(CODE, when)); add("answer.preparingFor", a.preparingFor(CODE, when)); add("answer.preparing", a.preparing(CODE, 20));
  add("answer.ready", a.ready(CODE, false)); add("answer.onTheWay", a.onTheWay(CODE, 10)); add("answer.arrived", a.arrived(CODE)); add("answer.delivered", a.delivered(CODE));
  add("answer.failed", a.failed(CODE)); add("answer.other", a.other(CODE)); add("answer.hours", a.hours("08:00", "22:00", true)); add("answer.hours.closed", a.hours("08:00", "22:00", false));
  add("answer.outOfArea", a.outOfArea("صيدا", ["بعقلين", "بيت الدين", "الخريبة"])); add("answer.inArea", a.inArea("بيت الدين", 1.5, 30));
  add("answer.noPrevious", a.noPrevious); add("answer.allMissing", a.allMissing(names)); add("answer.repeatOffer", repeatOfferText([...names, "x", "y", "z"], L), { greeting: true });
  add("answer.repeatButton", a.repeatButton); add("answer.stale", a.stale); add("answer.someMissing", a.someMissing([names[2]!]));
  add("answer.lira", a.lira(89500, { code: CODE, usd: 7.27, lbp: 651000 })); add("answer.lira.noOrder", a.lira(89500, null)); add("answer.noRate", a.noRate);

  // B1a: the basket said by code (the minimum, the basket so far, what changed, a refused cancel).
  const bk = m.basket;
  add("basket.minimum", bk.minimum(5, 0.69, 4.31, names.slice(0, 2).map((n, i) => `${i + 1} × ${n}`))); add("basket.minimumIs", bk.minimumIs(5));
  add("basket.which", bk.which(names[0]!, names.slice(0, 3).map((n) => `${n}: $1.01`))); add("basket.houseDefault", bk.houseDefault("ربطة خبز", names[0]!));
  add("basket.cancelButton", bk.cancelButton); add("basket.cleared", bk.cleared); add("basket.soFar", bk.soFar(names.map((n, i) => `${i + 1} × ${n}`)));
  add("basket.changed", bk.changed([`+ 2 × ${names[0]}`, `− ${names[1]}`, `${names[2]}: 1 → 3`])); add("basket.unavailable", bk.unavailable([names[2]!]));
  add("basket.cancelRefused", bk.cancelRefused(CODE));
  add("payment.proofReceived", m.payment.proofReceived(CODE)); add("payment.proofResend", m.payment.proofResend);
  // PD1 (g): the honest answer when nothing fits, as code sends it (one message).
  const h = m.honest;
  add("honest.notCarried", h.notCarried(["protein bars"])); add("honest.notCarried.two", h.notCarried(["protein bars", "dates"]));
  add("honest.cannotConfirm", h.cannotConfirm(h.fact.sugar, ["snacks"]));
  for (const f of ["sugar", "protein", "gluten", "lactose", "fat", "salt", "fragrance"] as const) add(`honest.fact.${f}`, h.cannotConfirm(h.fact[f], ["snacks"]));
  add("honest.named", [h.named(["Zero Sugar", "No Sugar"]), m.fixed.priced("Lipton Ice Tea Tropical Zero Sugar 320Ml", 0.69, true), h.closeItems].join("\n"));
  add("honest.closeItems", h.closeItems); add("honest.closeNone", h.closeNone);
  // CX1: the welcome (the one other place 👑 may appear: it is a greeting), the card's choices, cancel, the handover code, pickup.
  const cx = m.cx;
  add("cx.welcome", cx.welcome("08:00", "22:00"), { greeting: true }); add("cx.welcome.noHours", cx.welcome(null, null), { greeting: true });
  for (const k of ["privacy", "orderButton", "areaButton", "orderAsk", "areaAsk", "keepLine", "choicesButton", "choicesMissing", "choicesNote", "choicesOrder",
                   "exactRow", "keepRow", "cancelRow", "exactSet", "needsNote", "cancelYes", "pickupOff"] as const) add(`cx.${k}`, cx[k]);
  for (const p of ["best_match", "ask", "remove"] as const) {
    add(`cx.missingLine.${p}`, cx.missingLine(p)); add(`cx.missingRow.${p}`, cx.missingRow[p]); add(`cx.missingSet.${p}`, cx.missingSet(p));
  }
  add("cx.noteRow", cx.noteRow(20)); add("cx.noteSet", cx.noteSet(20, 12.73)); add("cx.keepSet", cx.keepSet(12.73)); add("cx.noteTooSmall", cx.noteTooSmall(7.27));
  add("cx.choiceTooLate", cx.choiceTooLate(CODE)); add("cx.cancelAsk", cx.cancelAsk(CODE, 0)); add("cx.cancelAsk.credit", cx.cancelAsk(CODE, 7.27));
  add("cx.cancelAfterPick", cx.cancelAfterPick(CODE, 5.27, [])); add("cx.cancelAfterPick.kept", cx.cancelAfterPick(CODE, 5.27, names));
  add("cx.cancelAfterPickCash", cx.cancelAfterPickCash(CODE)); add("cx.cancelOnTheWay", cx.cancelOnTheWay(CODE)); add("cx.handoverCode", cx.handoverCode("4821"));
  add("cx.pickupAt", cx.pickupAt(L === "ar" ? "مستودع ألو كينغ، بعقلين" : "the Alo King hub, Baakline")); add("cx.pickupReady", cx.pickupReady(CODE, L === "ar" ? "مستودع ألو كينغ، بعقلين" : "the Alo King hub, Baakline"));
  // HO1: the six case lines, their buttons, the technical lines and the Inbox drafts.
  const sp = m.support;
  for (const k of ["opened", "reminder", "stillOnIt", "resumed", "resolved", "callbackButton", "keepOrderingButton", "voiceNoteButton", "callbackNoted",
                   "keepOrdering", "voiceNoteAsk", "technical", "capMenu", "stalled", "browseButton", "myOrderButton", "personButton", "buttonError",
                   "retryButton", "notOnRecord", "browseInWords"] as const) add(`support.${k}`, sp[k]);
  add("support.afterHours", sp.afterHours("08:00"));
  for (const k of ["person_requested", "order_problem", "complaint", "refund", "payment", "safety", "other"] as const) add(`support.draft.${k}`, sp.draft(k, CODE));
  const n = m.notice;
  add("notice.orderCancelled", n.orderCancelled(CODE, "ما تأكّد الطلب بالوقت المحدد")); add("notice.riderAtDoor", n.riderAtDoor(CODE));
  add("notice.paymentReceived", n.paymentReceived(CODE, "12.50$ نقداً")); add("notice.onTheWay", n.onTheWay(CODE)); add("notice.riderWaiting", n.riderWaiting(CODE));
  add("notice.delayed", n.delayed(CODE)); add("notice.calledOff", n.calledOff(CODE, 0)); add("notice.calledOff.credit", n.calledOff(CODE, 7.27));

  const sh = m.shelf;
  add("shelf.ready", sh.ready(CODE)); add("shelf.notFound", sh.notFound(["1 × " + names[2]])); add("shelf.swapped", sh.swapped(names[2]!, "1", "Najjar Cardamom 180 g", 3.49));
  add("shelf.newTotal", sh.newTotal(7.51, 672000)); add("shelf.credit", sh.credit(1.25)); add("shelf.summary", sh.summary(["1 × " + names[2]], [{ name: names[1]!, by: "Wooden Bakery 800 g" }]), { kind: "template" });
  const changes = pickChangeText({ short_code: CODE, total_usd: 7.51, fx_rate_lbp: 89500, payment_method: "cod", credit_usd: 0.5,
    removed: [{ name: names[2]!, qty: 1, line_total_usd: 3.25 }], substituted: [{ name: names[1]!, by: "Wooden Bakery 800 g", qty: 1, line_total_usd: 1.25 }] }, L)!;
  add("shelf.message", bodyOf(changes.msg)); add("shelf.template", changes.params.join("\n"), { kind: "template" });

  const s = m.sub;
  add("sub.question", s.question(CODE, "1", names[2]!, 3.25, "Najjar Cardamom 180 g", 3.49, 0.24, 5)); add("sub.question.cheaper", s.question(CODE, "1", names[2]!, 3.25, "Najjar Cardamom", 3, -0.25, 5));
  add("sub.question.same", s.question(CODE, "1", names[2]!, 3.25, "Najjar Cardamom", 3.25, 0, 5));
  add("sub.keep", s.keep); add("sub.remove", s.remove); add("sub.kept", s.kept(CODE, 7.51)); add("sub.removed", s.removed(CODE, 4.02)); add("sub.late", s.late(CODE, 4.02));
  const q = substitutionQuestion({ offer_id: ORDER, order_id: ORDER, short_code: CODE, customer_id: ORDER, missing_name: "Najjar Classic coffee 180 g", substitute_name: "Najjar Cardamom 180 g",
                                   qty: 1, replaced_total_usd: 3.25, line_total_usd: 3.49, diff_usd: 0.24, answer_min: 5 }, L);
  add("sub.message", bodyOf(q.msg)); add("sub.template", q.params.join("\n"), { kind: "template" });

  const o = m.ops;
  const S = (k: string, v: string) => add(`ops.${k}`, v);
  S("newPick", o.newPick(CODE)); S("startButton", o.startButton(CODE)); S("pickWait", o.pickWait(CODE, 12)); S("noRider", o.noRider(CODE));
  for (const k of ["noOrders", "taken", "noOpenPick", "subNotSent", "unknown", "noReturns", "countReturn", "returnDefault", "returnAllFit", "returnAllWaste", "opsOnly",
                   "noRiders", "riderCannot", "riderConfirmButton", "cashReceivedButton", "riderOffToRider", "error", "pickDone", "pickMissing", "whichMissingButton",
                   "someone", "theRider", "aRider", "theTeam", "accept", "decline", "picked", "arrived", "delivered", "noAnswer", "exactButton", "shiftStarted",
                   "shiftAlready", "notOnShift", "offerGone", "accepted", "declined", "cashUnclear", "noJob", "dropAsk", "shiftBlocked", "softCap", "hardCap",
                   "riderUnknown", "shiftClosed", "dropHub", "dropOmt", "riderError", "chooseSubButton", "removeRow"] as const) S(k, o[k]);
  S("busy", o.busy(CODE)); S("notPickable", o.notPickable(CODE, "draft")); S("noSuchLine", o.noSuchLine(4)); S("removed", o.removed(names[2]!, 4.02));
  S("removedLine", o.removedLine(4.02)); S("ready", o.ready(CODE)); S("readyForRider", o.readyForRider(CODE)); S("waiting", o.waiting(CODE, [o.waitingOffer(names[2]!, 3), o.waitingDecide(names[1]!)]));
  S("waitingOffer", o.waitingOffer(names[2]!, 3)); S("waitingDecide", o.waitingDecide(names[1]!)); S("chooseSub", o.chooseSub(names[2]!)); S("subRow", [o.subRow(0.24), o.subRow(-0.25), o.subRow(0)].join("\n"));
  S("subAsked", o.subAsked(5)); S("subKept", o.subKept(CODE, "Najjar Cardamom")); S("subRemoved", o.subRemoved(CODE, "Najjar Cardamom"));
  S("empty", o.empty(CODE)); S("emptyOps", o.emptyOps(CODE)); S("returnsWaiting", o.returnsWaiting([CODE, "AK-1040"])); S("returnBack", o.returnBack(CODE));
  S("returnDone", o.returnDone(CODE, 3, 1)); S("returnAlready", o.returnAlready(CODE));
  S("returnCard", bodyOf(returnCard({ order_id: ORDER, short_code: CODE, status: "returned", lines: [{ name: names[0]!, qty: 1, default: "restock" }, { name: "Labneh 500 g", qty: 2, default: "write_off" }] })));
  S("riderRow", o.riderRow("Hussein", 42.5, true)); S("riderConfirm", o.riderConfirm("Hussein")); S("riderOff", o.riderOff("Hussein", 2, [CODE], 42.5, 900000));
  S("riderOff.none", o.riderOff("Hussein", 0, [], 0, 0)); S("sendBack", o.sendBack(CODE)); S("riderAlreadyOff", o.riderAlreadyOff("Hussein"));
  S("calledOff", o.calledOff(CODE)); S("notCalledOff", o.notCalledOff(CODE, "taken_over")); S("cashIn", o.cashIn(42.5, 900000)); S("pickError", o.pickError("x"));
  S("pickCard", pickCard({ order_id: ORDER, short_code: CODE, status: "preparing", notes: "⚠️ قيود الزبون: فستق", total_usd: 7.27,
    lines: LINES.map((l, i) => ({ n: i + 1, item_id: ORDER, name: l.name, qty: l.qty, unit: l.unit, on_hold: false, note: null })),
    missing: [{ item_id: ORDER, name: "Labneh", qty: 1, status: "missing" }] }).map(bodyOf).join("\n---\n"));
  S("pickAsk", o.pickAsk(CODE)); S("whichMissing", o.whichMissing(CODE)); S("foundAll", o.foundAll(2, 2));
  S("queue", o.queue([{ code: CODE, items: 3, village: "Baakline" }, { code: "AK-1043", items: 1, village: null }]));
  const job: Job = { delivery_id: ORDER, driver_id: ORDER, status: "offered", collect_usd: 7.27, stops: [
    { seq: 1, kind: "pickup", done: false, arrived: false, source: "Alo King hub", source_village: "Baakline" },
    { seq: 2, kind: "dropoff", done: false, arrived: false, order_id: ORDER, short_code: CODE, customer: "Test customer", phone: "+96170000012", village: "Baakline",
      directions: "بيت الاختبار، الطابق 2", notes: null, payment_method: "cod", total_usd: 7.27, fx_rate_lbp: 89500, change_for_usd: 20, paid: false } ] };
  S("offer", bodyOf(offerCard(job, 7))); S("pickup", bodyOf(pickupCard(job))); S("drop", bodyOf(dropCard(job.stops[1]!)));
  S("drop.paid", bodyOf(dropCard({ ...job.stops[1]!, paid: true }))); S("cashAsk", bodyOf(cashAsk({ order_id: ORDER, short_code: CODE, total_usd: 7.27, fx_rate_lbp: 89500 })));
  S("closeWithCash", o.closeWithCash(42.5)); S("dropDeclared", o.dropDeclared(42.5, 900000, true)); S("dropAlert", o.dropAlert(false));
  S("stillPicking", o.stillPicking([CODE])); S("collected", o.collected(49.77)); S("waitMore", o.waitMore(3)); S("noAnswerLogged", o.noAnswerLogged(true));
  S("noAnswerAlert", o.noAnswerAlert(CODE)); S("mismatch", o.mismatch(7.27)); S("riderErrorAlert", o.riderErrorAlert("x"));
  S("proofAlert", o.proofAlert("Whish", CODE, 7.27, true)); S("turnCap", o.turnCap(30));
  S("askCode", o.askCode(CODE)); S("wrongCode", o.wrongCode(4)); S("codeLocked", o.codeLocked(CODE)); S("codeLockedAlert", o.codeLockedAlert(CODE));
  S("codeOk", o.codeOk(CODE)); S("keepChange", o.keepChange(20));
  S("drop.keepChange", bodyOf(dropCard({ ...job.stops[1]!, keep_change: true }))); S("drop.code", bodyOf(dropCard({ ...job.stops[1]!, paid: true, code_required: true })));
  return r;
}

/** The leaf paths of a Messages object (strings and functions), for the coverage check. */
function leaves(x: unknown, path = ""): string[] {
  if (typeof x === "string" || typeof x === "function") return [path];
  if (x && typeof x === "object") return Object.entries(x).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}
const SHARED = new Set(["lang", "join", "lbp", "amount"]);   // helpers, exercised by every message that prints a list or an amount

const TEMPLATES = (JSON.parse(readFileSync(fileURLToPath(new URL("../../../templates/templates.json", import.meta.url)), "utf8")) as
  { templates: { name: string; language: string; category: string; body: string; variables: string[]; buttons?: { text: string }[]; status_note?: string }[] }).templates
  .filter((t) => t.name.startsWith("ak_"));
/** The templates that may be sent: Meta re-files some as marketing after submission (14 Nov); those are never sent. */
const UTILITY = TEMPLATES.filter((t) => t.category === "utility");

function snapshot(lang: Lang, rendered: Rendered[]): string {
  const tpl = UTILITY.filter((t) => t.language === lang);
  return [`# Fixed messages: ${lang}`, "", "Generated by packages/agents/test/messages.rules.test.ts from packages/agents/src/messages/" +
    `${lang}.ts with sample values. Every message here passed the brief's rules. Read it before it ships.`, "",
    ...rendered.flatMap((r) => [`## ${r.key}`, "", "```text", r.text, "```", ""]),
    "# Utility templates (templates/templates.json)", "",
    ...tpl.flatMap((t) => [`## ${t.name}`, "", "```text", t.body + (t.buttons?.length ? `\n[${t.buttons.map((b) => b.text).join("] [")}]` : ""), "```", ""])].join("\n");
}

describe("message design rules (SYSTEM_BRIEF, M1)", () => {
  for (const lang of LANGS) {
    const m = messages(lang);
    const rendered = render(m);
    it(`${lang}: every template is rendered`, () => {
      const keys = new Set(rendered.map((r) => r.key));
      const missing = leaves(m).filter((k) => !SHARED.has(k) && !k.startsWith("days.") && ![...keys].some((r) => r === k || r.startsWith(`${k}.`)));
      expect(missing).toEqual([]);
    });
    it(`${lang}: rules 1, 4, 5 and 7 hold on every message`, () => {
      const bad = rendered.flatMap((r) => problems(r, m).map((p) => `${r.key}: ${p}`));
      expect(bad).toEqual([]);
    });
    it(`${lang}: rule 8, the card always shows every line, the fee, the total, the address and the payment, then confirm and edit`, () => {
      for (const { key, input } of cards(lang)) {
        const parts = formatOrderCard(input);
        const card = parts.at(-1)!;
        const all = parts.map(bodyOf).join("\n");
        for (const l of input.quote.lines) expect(all, key).toContain(productName(l, lang));
        if (!input.quote.pickup) { expect(bodyOf(card), key).toContain(m.amount(m.card.delivery(lang === "ar" ? "بعقلين" : "Baakline"), input.quote.delivery_fee_usd)); expect(bodyOf(card), key).toMatch(/^📍 /mu); }
        else expect(bodyOf(card), key).toContain(m.card.pickup);
        expect(bodyOf(card), key).toContain(`*${m.amount(m.card.total, input.quote.total_usd)}*`);
        expect(bodyOf(card), key).toContain(m.card.payment(input.paymentMethod));
        expect(buttonsOf(card).slice(0, 2), key).toEqual([m.card.confirm, m.card.edit]);
        expect(bodyOf(card).length, key).toBeLessThanOrEqual(1024);
      }
      const card = bodyOf(formatOrderCard(cards(lang)[0]!.input)[0]!);
      expect(card).toContain(lang === "ar" ? "📍 بعقلين، بيت الاختبار، الطابق 2" : "📍 Baakline, بيت الاختبار, الطابق 2");
    });
    it(`${lang}: buttons and list rows fit WhatsApp (20 and 24 characters)`, () => {
      for (const t of [m.card.confirm, m.card.edit, m.card.cancel, m.fixed.keptButton, m.answer.repeatButton, m.sub.keep, m.sub.remove, m.windows.button,
                       m.ops.accept, m.ops.decline, m.ops.picked, m.ops.arrived, m.ops.delivered, m.ops.noAnswer, m.ops.exactButton, m.ops.pickDone, m.ops.pickMissing,
                       m.ops.countReturn, m.ops.returnDefault, m.ops.returnAllFit, m.ops.returnAllWaste, m.ops.riderCannot, m.ops.riderConfirmButton,
                       m.ops.cashReceivedButton, m.ops.dropHub, m.ops.dropOmt, m.ops.chooseSubButton, m.ops.whichMissingButton, m.ops.startButton("AK-1042"),
                       m.ops.sendBack("AK-1042")]) expect(t.length, t).toBeLessThanOrEqual(20);
      for (let off = 0; off < 7; off++) for (let dow = 1; dow <= 7; dow++) {
        const row = windowRow(W(off, dow), lang);
        expect(row.title.length, row.title).toBeLessThanOrEqual(24);       // W1's fix, in every language
      }
      expect(m.windows.now.length).toBeLessThanOrEqual(24);
      expect(m.ops.removeRow.length).toBeLessThanOrEqual(24);
    });
    it(`${lang}: the snapshot a person reads in the pull request`, async () => {
      await expect(snapshot(lang, rendered)).toMatchFileSnapshot(`./__snapshots__/messages.${lang}.md`);
    });
  }

  it("utility templates: a utility version per event and language, the same variables, no bold, no emoji, nothing promotional", () => {
    const eventOf = (name: string) => name.replace(/^ak_/, "").replace(/(_en|_fr)?_v\d+$/, "");
    for (const t of UTILITY) {
      expect(t.body, t.name).not.toMatch(/\*|\p{Extended_Pictographic}|[٠-٩]/u);
      expect(t.body, t.name).not.toMatch(/عرض|خصم|أفضل|مجان|offer|discount|free|promo|offre|gratuit|don't miss|ne manquez/iu);
      for (const n of t.variables.keys()) expect(t.body, t.name).toContain(`{{${n + 1}}}`);
      const same = UTILITY.filter((x) => eventOf(x.name) === eventOf(t.name));
      for (const x of same) { expect(x.variables, `${x.name} vs ${t.name}`).toEqual(t.variables); expect((x.buttons ?? []).length).toBe((t.buttons ?? []).length); }
    }
    // A template Meta re-filed as marketing is marked so and never counted as one that may be sent (invariant 17).
    for (const t of TEMPLATES.filter((x) => x.category !== "utility")) expect(t.status_note, t.name).toMatch(/MARKETING/);
    for (const ev of ["shelf_changes", "substitute_question", "order_delayed", "delivery_called_off", "kept_order_open", "on_the_way", "window_reminder"])
      for (const lang of LANGS) expect(UTILITY.some((t) => eventOf(t.name) === ev && t.language === lang && t.name.startsWith(`ak_${ev}${lang === "ar" ? "" : "_" + lang}_v`)), `${ev} ${lang}`).toBe(true);
  });

  it("a template message carries its values and one payload per quick reply", () => {
    expect(templateMessage("ak_substitute_question_en_v1", "en", { params: ["AK-1", "a", "b", "$1.00", "5"], payloads: ["sub:keep:x", "sub:remove:x"] })).toEqual({
      type: "template", template: { name: "ak_substitute_question_en_v1", language: { code: "en" }, components: [
        { type: "body", parameters: ["AK-1", "a", "b", "$1.00", "5"].map((text) => ({ type: "text", text })) },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "sub:keep:x" }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "sub:remove:x" }] }] } });
    expect((templateMessage("ak_kept_order_open_v1", "ar", { params: [], payloads: ["kept:send"] }) as { template: { components: unknown[] } }).template.components).toHaveLength(1);
  });
});

describe("the conversation's language (M1)", () => {
  it("product names follow it; a missing Arabic name falls back to English and is collected for name_gaps", () => {
    const gaps = new Set<string>();
    expect(productName(LINES[0]!, "ar", gaps)).toBe("كرتونة مي تنورين 2 ليتر (6 قناني)");
    expect(productName(LINES[2]!, "ar", gaps)).toBe("Najjar Classic coffee 180 g");
    expect(productName(LINES[0]!, "en", gaps)).toBe("Tannourine water 2 L (pack of 6)");
    expect(productName(LINES[2]!, "fr", gaps)).toBe("Najjar Classic coffee 180 g");
    expect([...gaps]).toEqual(["p3"]);
    const g2 = new Set<string>();
    formatOrderCard({ orderId: ORDER, shortCode: CODE, quote: QUOTE, paymentMethod: "cod", lang: "ar" }, { gaps: g2 });
    expect([...g2]).toEqual(["p3"]);
  });
  it("is read from the words only when they are clear, and the reading decides", () => {
    expect(langOfText("وين طلبي")).toBe("ar");
    expect(langOfText("where is my order?")).toBe("en");
    expect(langOfText("Où est ma commande ?")).toBe("fr");
    expect(langOfText("wen el talab")).toBeNull();                 // Arabizi: Arabic, but keep what the reading said
    expect(langOfText("bade 2 labne")).toBeNull();
    expect(langOfText("ok")).toBeNull();
    expect(langFromReading("arabizi")).toBe("ar"); expect(langFromReading("en")).toBe("en"); expect(langFromReading("mixed")).toBeNull();
    expect(asLang("de")).toBe("ar");
  });
  it("window labels and rows in each language", () => {
    expect(windowLabel(W(1), "ar")).toBe("بكرا 10:00-12:00");
    expect(windowLabel(W(1), "en")).toBe("Tomorrow 10:00-12:00");
    expect(windowLabel(W(5, 3), "fr")).toBe("Mercredi 18/11, 10:00-12:00");
    expect(windowRow(W(5, 3), "fr")).toEqual({ title: "Mercredi 18/11", description: "10:00-12:00" });
  });
});

describe("the model's own words (output guard, M1)", () => {
  it("at most two short sentences", () => {
    expect(checkModelText("شو بتحب تطلب؟")).toBeNull();
    expect(checkModelText("عنا نوعين لبنة. أيا بدك؟")).toBeNull();
    expect(checkModelText("Which one would you like, the 500 g or the 1 kg?")).toBeNull();
    expect(checkModelText("We have two. One is bigger. Which one?")?.code).toBe("too_long");
    expect(checkModelText("1. Labneh\n2. Bread\n3. Water")?.code).toBe("too_long");
    expect(checkModelText("x".repeat(170))?.code).toBe("too_long");
    expect(modelSentences("بدك 2.5 كيلو؟ تمام.")).toEqual(["بدك 2.5 كيلو؟", "تمام."]);
  });
  it("no price in model-written text, whatever its length", () => {
    expect(checkModelText("التوصيل $1.00")?.code).toBe("money_in_free_text");
    expect(checkModelText("It's 3 dollars.")?.code).toBe("money_in_free_text");
  });
});
