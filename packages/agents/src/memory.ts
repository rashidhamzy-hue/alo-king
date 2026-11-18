// The customer controls what we remember (build plan 1.14). "What do you know about me", "forget", "stop remembering" and
// "remember again" are answered by code from SQL functions (migration 0019), typed or read by the model. A restriction the
// customer states (an allergy, "no meat") goes on the order it was said for at once, and is kept for later orders only
// after they tap yes. Fixed texts only; nothing here is written by a model.
import { buttons } from "@ak/wa/kapso";
import { deliver, type ToolContext } from "./concierge-tools";
import { normalise } from "./quick-intent";
import { messages } from "./messages";

export type MemoryCommand = "show" | "forget" | "stop" | "start";

async function rpc<T>(ctx: ToolContext, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const POLITE = "(?:\\s+(?:لو سمحت|من فضلك|please|pls|svp|merci|شكرا))*";
const PATTERNS: Record<MemoryCommand, string[]> = {
  show: ["(?:شو|شي|ايش) (?:بتعرف|بتعرفو|بتعرفوا|منعرف|بتعرفون|عم تعرف|عم تعرفو|محفوظ|حافظين|حافظ) (?:عني|عنا|عليي|الي|لالي)",
         "شو (?:عندكن|عندكم|عندك) (?:معلومات )?عني", "what do you (?:know|have|remember|keep) (?:about|on) me", "what do you store about me",
         "(?:shu|chou|sho) (?:bta3ref|bta3rfo|bta3erfo|m3arfin) (?:3anne|3ani|3anni)", "que savez vous (?:de|sur) moi"],
  // normalise() folds ى to ي, so انسى is written انسي here.
  forget: ["(?:انسي|انسا|انساني|انسوني|انسو|امحي|امحو|امسح|امسحو) (?:كل شي|معلوماتي|يلي بتعرفو عني|كل شي عني|عني)",
           "(?:انسي|انسا|انساني|انسوني)", "forget (?:me|everything|about me|my (?:data|info|information))", "delete my (?:data|info|information)",
           "(?:ensa|insa|ensani|insani)(?: kel shi| kell chi)?", "oubliez moi"],
  stop: ["(?:وقف|بطل|بطلو|وقفو) (?:تتذكر|تتذكرو|تحفظ|تحفظو|التذكر|تسجل|تسجلو)(?: شي)?(?: عني)?", "لا (?:تتذكر|تتذكرو|تحفظ|تحفظو)(?: شي)?(?: عني)?",
         "stop (?:remembering|saving|storing)(?: me| my orders| things)?", "don'?t remember (?:me|my orders|anything)",
         "(?:wa2ef|wa2fo|battel|battlo) (?:tetzakkar|tetzakar|t7afez)"],
  start: ["(?:رجاع|رجعو|ارجع|ارجعو|رجع) (?:تذكر|تتذكر|تتذكرو|احفظ|تحفظ|تحفظو)", "(?:start|resume) remembering(?: me)?", "remember me again"],
};
const COMPILED: [MemoryCommand, RegExp][] = (Object.keys(PATTERNS) as MemoryCommand[])
  .map((k) => [k, new RegExp(`^(?:${PATTERNS[k].join("|")})${POLITE}$`, "u")]);

/** A memory command typed on its own, recognised without a model. Strict: the whole message must be the command. */
export function memoryCommand(text: string): MemoryCommand | null {
  const t = normalise(text);
  if (!t || t.split(" ").length > 9) return null;
  for (const [k, re] of COMPILED) if (re.test(t)) return k;
  return null;
}

export interface MemoryView { remember: boolean; orders: number; usuals: string[]; brands: string[]; payment: string | null;
  restrictions: string[]; notes: string[]; places: (string | null)[]; contact_phone: string | null }

const PAY: Record<string, string> = { cod: "كاش عند التسليم", whish: "Whish", omt: "OMT" };
const list = (xs: (string | null)[], max = 6) => {
  const shown = xs.filter((x): x is string => !!x);
  return shown.slice(0, max).join("، ") + (shown.length > max ? ` و${shown.length - max} غيرن` : "");
};

export const MEMORY_TEXT = {
  show(v: MemoryView): string {
    const lines = ["هيدا يلي منعرفو عنك ونستعملو لنسهّل طلباتك:"];
    lines.push(`• طلبات مكتملة: ${v.orders}`);
    if (v.usuals.length) lines.push(`• أغراض بتطلبها عادةً: ${list(v.usuals)}`);
    if (v.brands.length) lines.push(`• ماركات: ${list(v.brands)}`);
    if (v.payment) lines.push(`• طريقة الدفع الأخيرة: ${PAY[v.payment] ?? v.payment}`);
    if (v.restrictions.length) lines.push(`• قيود طلبت نتذكّرها: ${list(v.restrictions)}`);
    if (v.notes.length) lines.push(`• ملاحظات: ${list(v.notes, 3)}`);
    if (v.places.filter(Boolean).length) lines.push(`• عناوين: ${list(v.places)}`);
    if (v.contact_phone) lines.push(`• رقم للسائق: ${v.contact_phone}`);
    if (!v.remember) lines.push("التذكّر موقّف: ما منتعلّم شي جديد وما منستعمل يلي فوق، إلا القيود يلي طلبت نتذكّرها.");
    lines.push("فيك تقلّي «إنسى» لنمحي هالمعلومات، أو «وقّف التذكّر».");
    return lines.join("\n");
  },
  forgetConfirm: "أكيد بدك نمحي كل شي منعرفو عنك؟ (الأغراض المعتادة، الماركات، طريقة الدفع، القيود، والعناوين يلي ما عليها طلبات.) سجلّ الطلبات نفسو بيضلّ.",
  forgetYes: "إيه، امحي",
  forgetNo: "لا",
  forgotten: "تم. محينا المعلومات يلي كنا نتذكّرها عنك. إذا بدك ما نتعلّم شي جديد كمان، قلّي «وقّف التذكّر».",
  notForgotten: "تمام، ما محينا شي.",
  stopped: "تم، ما رح نتعلّم شي جديد عنك من هلّق، وما منستعمل يلي محفوظ إلا القيود يلي طلبت نتذكّرها. إذا بدك نمحي يلي محفوظ قلّي «إنسى».",
  started: "تم، رجعنا نتذكّر طلباتك لنسهّلها عليك. فيك توقّفها بأي وقت.",
};

export const MEMORY_BUTTON = { forgetYes: "memory:forget:yes", forgetNo: "memory:forget:no", keepYes: "memory:keep:yes", keepNo: "memory:keep:no" };

type Done = { done: true; path: string } | { done: false };
const say = async (ctx: ToolContext, text: string, path: string): Promise<Done> =>
  (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok ? { done: true, path } : { done: false };

export async function answerMemory(ctx: ToolContext, cmd: MemoryCommand): Promise<Done> {
  if (cmd === "show") return say(ctx, MEMORY_TEXT.show(await rpc<MemoryView>(ctx, "customer_memory_view", { p_party: ctx.partyId })), "memory_show");
  if (cmd === "stop") { await rpc(ctx, "set_memory_pref", { p_party: ctx.partyId, p_remember: false }); ctx.state.pendingRestrictions = null; return say(ctx, MEMORY_TEXT.stopped, "memory_stop"); }
  if (cmd === "start") { await rpc(ctx, "set_memory_pref", { p_party: ctx.partyId, p_remember: true }); return say(ctx, MEMORY_TEXT.started, "memory_start"); }
  // Deleting is asked once, with a button: a misread "forget" must never wipe someone's details.
  const r = await deliver(ctx, buttons(MEMORY_TEXT.forgetConfirm, [{ id: MEMORY_BUTTON.forgetYes, title: MEMORY_TEXT.forgetYes }, { id: MEMORY_BUTTON.forgetNo, title: MEMORY_TEXT.forgetNo }]), MEMORY_TEXT.forgetConfirm);
  return r.ok ? { done: true, path: "memory_forget_confirm" } : { done: false };
}

/** The four memory buttons. Returns false for any other id. */
export async function handleMemoryButton(ctx: ToolContext, id: string): Promise<boolean> {
  switch (id) {
    case MEMORY_BUTTON.forgetYes:
      await rpc(ctx, "forget_customer_memory", { p_party: ctx.partyId });
      // What the conversation object held about places and usuals goes too.
      Object.assign(ctx.state, { placeId: null, villageId: null, directions: null, repeatOfferedAt: undefined, pendingRestrictions: null, orderRestrictions: null });
      await say(ctx, MEMORY_TEXT.forgotten, "memory_forgotten"); return true;
    case MEMORY_BUTTON.forgetNo: await say(ctx, MEMORY_TEXT.notForgotten, "memory_kept"); return true;
    case MEMORY_BUTTON.keepYes: {
      for (const r of ctx.state.pendingRestrictions ?? []) await rpc(ctx, "save_stated_restriction", { p_party: ctx.partyId, p_text: r });
      ctx.state.pendingRestrictions = null;
      await say(ctx, messages(ctx.state.lang).remember.kept, "restriction_saved"); return true;
    }
    case MEMORY_BUTTON.keepNo: ctx.state.pendingRestrictions = null; await say(ctx, messages(ctx.state.lang).remember.notKept, "restriction_once"); return true;
    default: return false;
  }
}

const fold = (s: string) => normalise(s);

/**
 * After a turn that stated restrictions: offer to keep the ones not already kept, as one button. Not offered while memory is
 * paused. Sent outside the per-turn message budget: it is a fixed question about something the customer said, not chatter.
 */
export async function offerToRemember(ctx: ToolContext, stated: string[]): Promise<void> {
  if (stated.length === 0) return;
  const view = await rpc<MemoryView>(ctx, "customer_memory_view", { p_party: ctx.partyId });
  if (!view.remember) return;
  const saved = new Set(view.restrictions.map(fold));
  const fresh = [...new Set(stated.map((s) => s.trim()).filter((s) => s.length >= 2 && !saved.has(fold(s))))].slice(0, 3);
  if (fresh.length === 0) return;
  ctx.state.pendingRestrictions = fresh;
  // B1e (QA1): in the customer's language, and "on your order" only when there is one: a basket, a card, or an order under way.
  const R = messages(ctx.state.lang).remember;
  const body = R.offer(fresh, await orderInHand(ctx));
  const r = await ctx.send(buttons(body, [{ id: MEMORY_BUTTON.keepYes, title: R.yes }, { id: MEMORY_BUTTON.keepNo, title: R.no }]));
  if (r.ok) { ctx.sent.count++; ctx.sent.texts.push(body); }
}

/** B1e: a basket, a card waiting on the tap, or an order not yet delivered: what a restriction said now goes on. Unreadable counts as none. */
const DONE = new Set(["delivered", "closed", "cancelled", "canceled", "lapsed", "failed", "refunded", "returned"]);
async function orderInHand(ctx: ToolContext): Promise<boolean> {
  if (ctx.state.lastQuote?.lines?.length || ctx.state.editing) return true;
  try {
    if (await rpc<unknown>(ctx, "card_in_hand", { p_party: ctx.partyId, p_conversation: ctx.conversationId })) return true;
    const s = await rpc<{ status?: string } | null>(ctx, "order_status_for", { p_party: ctx.partyId });
    return !!s?.status && !DONE.has(s.status);
  } catch { return false; }
}
