// WEB2: the card of an order placed on the website, sent to the customer's WhatsApp by the gateway (invariant 1: the website never sends a
// message itself). The website asks (web_place_order writes web_card_requests, 0228); the minute cron sends each card through the gateway
// with a stable key, as the same card a chat order gets (sendCard, the stored card of order_card, 0229), in the language the page was in.
// CX2 (0255): each request is claimed before it is sent (web_card_claim), so it goes once even when "Card AK-xxxx" comes in the same minute.
// The card's own Confirm button is the confirmation (invariant 4): nothing here confirms. A card that cannot go (outside the 24-hour window,
// STOP, no address) is recorded, never retried every minute; the order page then says how to get it ("Card AK-xxxx" on WhatsApp).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendRequest, SendResult } from "@ak/wa/gateway";
import type { Outbound } from "@ak/wa/kapso";
import type { ConversationState, ToolContext } from "./concierge-tools";
import { resendCard } from "./windows";
import { asLang } from "./messages";

interface Due { order_id: string; customer_id: string; conversation_id: string; short_code: string; lang: string }

/** A ToolContext for one code-started card: its sends go to the customer line, keyed on the order, so a retried minute sends nothing twice. */
export function cardContext(deps: { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult> }, d: Due, to: string, key: string,
                            refusals: string[]): ToolContext {
  const state: ConversationState = { lang: asLang(d.lang) };
  let i = 0;
  return {
    db: deps.db, partyId: d.customer_id, conversationId: d.conversation_id, state, sent: { count: 0, texts: [] },
    send: async (msg: Outbound, opts?: { orderId?: string }) => {
      const r = await deps.send({ line: "customer", partyId: d.customer_id, to, msg, category: "service", orderId: opts?.orderId ?? d.order_id,
                                  dedupeKey: `${key}:${i++}` });
      if (!r.ok) refusals.push(r.refused);
      return r;
    },
  };
}

/** The minute cron's step: every card the website asked for, once. Returns how many went out. */
export async function sendWebCards(deps: { db: SupabaseClient; send: (r: SendRequest) => Promise<SendResult> }): Promise<number> {
  const { data, error } = await deps.db.rpc("web_cards_due", { p_limit: 20 });
  if (error) throw new Error(`web_cards_due: ${error.message}`);
  let sent = 0;
  for (const d of (data ?? []) as Due[]) {
    const to = ((await deps.db.rpc("party_address", { p_party: d.customer_id, p_line: "customer" })).data as string | null) ?? null;
    // CX2: claimed first, so a "Card AK-xxxx" typed in the same minute and this cron never both send it (AK-1063).
    const claim = (await deps.db.rpc("web_card_claim", { p_order: d.order_id, p_by: "cron" })).data as { claimed: boolean } | null;
    if (!claim?.claimed) continue;
    let outcome = "refused:no_address";
    if (to) {
      const refusals: string[] = [];
      const ok = await resendCard(cardContext(deps, d, to, `webcard:${d.order_id}`, refusals), d.order_id);
      outcome = ok ? "sent" : `refused:${refusals[0] ?? "no_card"}`;
      if (ok) sent++;
    }
    await deps.db.rpc("web_card_done", { p_order: d.order_id, p_outcome: outcome });
  }
  return sent;
}

/** A message as the three readers below see it: trimmed, its spaces collapsed to one, and a final full stop or exclamation mark dropped.
 *  The patterns then need no repeated or optional space next to each other (no backtracking on a long run of spaces). */
export const webWords = (text: string): string => text.slice(0, 200).trim().replace(/\s+/g, " ").replace(/[.!؟?]+$/u, "").trimEnd();
/** "Card AK-1042", typed by the website's button: read by code before any model. Never a confirmation. Match it on webWords(text). */
export const CARD_AGAIN = /^(?:card|carte|كرت|الكرت) (AK-[0-9A-Z]{2,10})$/iu;
/** "ALO-7K3Q9P" (with or without words around it): the website's sign-in code, read by code before any model. */
export const LINK_CODE = /\bALO[- ]?([23456789A-HJ-NP-Z]{6})(?![0-9A-Z])/i;
/** "Sign out", in the ways people write it. Only the words alone: anything longer is a message. Match it on webWords(text). */
export const SIGN_OUT = /^(?:sign ?(?:me )?out|log ?(?:me )?out|d[ée]connexion|d[ée]connecte[sz]?-moi|me d[ée]connecter|سجل ?خروج|سجّل ?خروج|تسجيل (?:ال)?خروج|سجلني خروج|سجّلني خروج|طلعني من الموقع)(?: (?:everywhere|partout|من كل مكان|من كل الأجهزة))?$/iu;
