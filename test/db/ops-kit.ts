// The ops line driven end to end for the hub tests: real SQL, real turn code (runTurn -> processOpsTurn), WhatsApp replaced by
// a recorder that honours the outbox claim exactly as the gateway does.
import type { SupabaseClient } from "@supabase/supabase-js";
import { asSupabase } from "./harness";
import { runTurn, type Pending, type TurnDeps } from "../../apps/gateway/src/turn";
import type { Hub } from "./hub-kit";

export interface Sent { line: string; to: string; partyId: string; type: string; body: string; buttons: string[]; rows: string[]; key: string }

export function opsLine(h: Hub) {
  const outbox: Sent[] = [];
  let n = 0;
  let failNext: Error | null = null;
  const deps: TurnDeps = {
    db: asSupabase(h.db) as unknown as SupabaseClient,
    model: { messages: { create: async () => { throw new Error("no model on the ops line"); } } } as any, modelName: "none",
    send: async (req) => {
      if (failNext) { const e = failNext; failNext = null; throw e; }
      if (!(await h.db.rpc("outbox_claim", { p_key: req.dedupeKey, p_line: req.line, p_party: req.partyId, p_payload: req.msg }))) return { ok: true, wamid: "already_sent" };
      const m = req.msg as any;
      outbox.push({ line: req.line, to: req.to, partyId: req.partyId, type: m.type, key: req.dedupeKey,
        body: m.text?.body ?? m.interactive?.body?.text ?? "",
        buttons: (m.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id),
        rows: (m.interactive?.action?.sections ?? []).flatMap((s: any) => s.rows.map((r: any) => r.id)) });
      await h.db.rpc("outbox_mark", { p_key: req.dedupeKey, p_wamid: "out" + outbox.length });
      return { ok: true, wamid: "out" + outbox.length };
    },
  };
  const msg = (phone: string, partial: Record<string, unknown>): Pending[] => [{ line: "ops", who: { phone }, event: {
    phone_number_id: "ops", conversation: { id: "c", contact_name: "Staff" },
    message: { id: `wamid.ops${++n}`, timestamp: "0", kapso: { direction: "inbound" }, ...partial } } as any }];
  return {
    outbox, deps,
    failNextSend: (e: Error) => { failNext = e; },
    text: (phone: string, body: string) => runTurn(deps, msg(phone, { type: "text", text: { body } }), {}),
    tap: (phone: string, id: string) => runTurn(deps, msg(phone, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } }), {}),
    pickRow: (phone: string, id: string) => runTurn(deps, msg(phone, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: "x" } } }), {}),
    raw: (pending: Pending[]) => runTurn(deps, pending, {}),
    msg,
    /** Everything sent to one party, newest last. */
    to: (partyId: string) => outbox.filter((m) => m.partyId === partyId),
    lastButtons: (partyId: string) => [...outbox].reverse().find((m) => m.partyId === partyId && m.buttons.length)?.buttons ?? [],
  };
}

export const PHONES = { ops: "+96171000001", picker: "+96171000002", rider: (i: number) => `+9617111110${i}` };
