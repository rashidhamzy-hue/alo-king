// Session E, issue #139: a request that stalls mid-turn must not lose the customer's tap.
//
// What happened on staging (14 October): the market quantity tap `qt:i1:2` reached dispatch; basket_add_item ran in
// Postgres in 67 ms but its HTTP answer stalled for 101 s; the worker sat on it, the queue retried the event after
// its 90 s visibility timeout, and the retry found the turn already begun and sent nothing ("duplicate"). The
// options the customer had been shown were never answered.
//
// The fake database below mirrors the SQL of 20261014150000_dispatch_stall_replay.sql: a claimed event is
// invisible for p_visibility_s, a failed one comes back after 5 s per attempt, customer_turn_begin replays an
// unfinished turn only on the queue's attempt 2+, and a keyed basket add runs once. The stall is what the
// RPC client now reports for a request past its deadline (RpcStalled), thrown after the add already ran.
import { describe, expect, it } from "vitest";
import { runDispatch, type DispatchDeps } from "./handler";
import { RpcStalled } from "../_shared/rest-rpc";

const PHONE = "+9999613471509";
const CUST = "10000000-0000-0000-0000-000000000001";
const VENDOR = "20000000-0000-0000-0000-00000000000b";
const ITEM = "51000000-0000-0000-0000-000000000011";
const NAME = "Tannourine Natural Mineral Water (1.5L x 6 Pack)";

function world(opts: { stallFirstAdd?: boolean } = {}) {
  let clock = 0; // seconds
  const queue = [
    {
      msg_id: 1,
      event_id: 1457,
      attempts: 0,
      vt: 0,
      archived: false,
      status: "queued",
      event_type: "whatsapp.message.received",
      phone_number_id: "PNID",
      payload: {
        message: {
          id: "wamid.qty",
          type: "interactive",
          interactive: { list_reply: { id: "qt:i1:2", title: "2" } },
          kapso: { direction: "inbound" },
        },
        conversation: { phone_number: PHONE },
      },
    },
  ];
  const turns = new Map<string, { finished: boolean; lease: string | null }>();
  const ops = new Set<string>();
  const session = {
    lang: "en",
    focus_vendor_id: VENDOR,
    pending: {},
    refs: {
      v1: { id: VENDOR, label: "Alo Test Market" },
      s1: { id: "sec-water", label: "Water & Beverages" },
      i1: { id: ITEM, label: NAME },
    } as Record<string, { id: string; label: string }>,
    history: [],
    low_confidence: 0,
  };
  let qty = 0;
  let stallNextAdd = opts.stallFirstAdd ?? true;
  const basket = () =>
    qty
      ? {
          basket_id: "b1",
          vendor_id: VENDOR,
          vendor: "Alo Test Market",
          vendor_en: "Alo Test Market",
          menu_version: 1,
          subtotal_usd: 2.2 * qty,
          lines: [
            {
              line_id: "l1",
              item_id: ITEM,
              name: NAME,
              name_en: NAME,
              quantity: qty,
              line_total_usd: 2.2 * qty,
            },
          ],
        }
      : null;

  const rpc = async (fn: string, a: any): Promise<any> => {
    switch (fn) {
      case "webhook_claim": {
        const due = queue.filter((e) => !e.archived && e.vt <= clock);
        for (const e of due) {
          e.attempts++;
          e.vt = clock + a.p_visibility_s;
        }
        return due.map((e) => ({ ...e }));
      }
      case "webhook_finish": {
        const e = queue.find((x) => x.msg_id === a.p_msg_id)!;
        if (a.p_attempt != null && a.p_attempt !== e.attempts) return null;
        e.status = a.p_status;
        if (a.p_status !== "failed" || e.attempts >= 5) e.archived = true;
        else e.vt = clock + Math.min(5 * e.attempts, 60);
        return null;
      }
      case "customer_turn_begin": {
        const t = turns.get(a.p_message_id);
        let replay = false;
        if (t) {
          if (t.finished || !((a.p_attempt ?? 1) > 1)) return { duplicate: true };
          if (t.lease) return { duplicate: false, busy: true };
          t.lease = a.p_lease_id;
          replay = true;
        } else turns.set(a.p_message_id, { finished: false, lease: a.p_lease_id });
        return {
          duplicate: false,
          replay,
          first_contact: false,
          customer: { id: CUST, language: "en", blocked: false },
          session: { ...structuredClone(session), handoff: false },
          basket: basket(),
          orders: [],
          profile: {
            delivered_orders: 0,
            usual_vendors: [],
            usual_items: [],
            addresses: [],
            preferences: {},
          },
          bot_enabled: true,
          support_open: true,
        };
      }
      case "customer_turn_release": {
        const t = turns.get(a.p_message_id)!;
        if (t.lease === a.p_lease_id) t.lease = null;
        return null;
      }
      case "customer_turn_end":
        Object.assign(session, structuredClone(a.p_session));
        turns.get(a.p_message_id)!.finished = true;
        return null;
      case "basket_add_item": {
        if (a.p_op_key && ops.has(a.p_op_key))
          return { status: "added", replayed: true, line_id: "l1", basket: basket() };
        if (a.p_op_key) ops.add(a.p_op_key);
        qty += a.p_quantity; // it ran in Postgres...
        if (stallNextAdd) {
          stallNextAdd = false;
          throw new RpcStalled("basket_add_item", 8000); // ...but the answer never came back
        }
        return { status: "added", line_id: "l1", basket: basket() };
      }
      case "menu_item_options":
        return [];
      case "whatsapp_sender":
        return "PNID";
      case "merchant_members_by_phone":
        return [];
      case "outbox_claim":
      case "ops_alerts_claim":
        return [];
      default:
        return null;
    }
  };
  const sent: any[] = [];
  const deps: DispatchDeps = {
    rpc,
    whatsapp: async (_from, payload) => {
      sent.push(payload);
      return { ok: true, id: `wamid.out.${sent.length}` };
    },
    call: null,
    telegram: null,
    budgetMs: 60_000,
    customer: {
      model: null,
      transcribe: null,
      fetchMedia: async () => null,
      route: async () => null,
      config: {
        customerModel: "m",
        escalationModel: "m",
        transcriptionModel: "t",
        maxCalls: 2,
        turnMs: 8000,
        lowConfidenceHandoff: 2,
        voiceMaxBytes: 1,
      },
    },
  };
  return {
    deps,
    sent,
    queue,
    session,
    qty: () => qty,
    advance: (s: number) => (clock += s),
  };
}

describe("a request that stalls mid-turn (#139)", () => {
  it("fails the event, which comes back within seconds and replays the tap once, with the options intact", async () => {
    const w = world();

    // Attempt 1: basket_add_item stalls. Nothing is sent and the session is not saved.
    await runDispatch(w.deps);
    expect(w.sent).toHaveLength(0);
    expect(w.queue[0].status).toBe("failed");
    expect(w.session.refs.i1?.id).toBe(ITEM);

    // Five seconds later the event is due again (not after the 90 s visibility timeout).
    w.advance(5);
    await runDispatch(w.deps);

    // The replay answered the same tap: one basket card with 2 x Tannourine, never 4.
    expect(w.queue[0].status).toBe("done");
    expect(w.queue[0].attempts).toBe(2);
    expect(w.qty()).toBe(2);
    expect(w.sent).toHaveLength(1);
    const card = w.sent[0];
    expect(JSON.stringify(card)).toContain("Tannourine");
    expect(JSON.stringify(card)).toContain("2×");
    expect(card.interactive.action.buttons.map((b: any) => b.reply.id)).toContain("c:checkout");
  });

  it("a stall on every attempt still answers the customer, with the buttons, on the third", async () => {
    const w = world();
    const rpc = w.deps.rpc;
    w.deps.rpc = async (fn, a) => {
      if (fn === "basket_add_item") throw new RpcStalled(fn, 8000);
      return rpc(fn, a);
    };
    for (let k = 0; k < 3; k++) {
      await runDispatch(w.deps);
      w.advance(60);
    }
    expect(w.queue[0].status).toBe("done");
    expect(w.sent).toHaveLength(1);
    expect(JSON.stringify(w.sent[0])).toContain("c:order");
  });

  it("once the replies are out, a failure saving the session never replays the turn", async () => {
    const w = world({ stallFirstAdd: false });
    const rpc = w.deps.rpc;
    let addCalls = 0;
    w.deps.rpc = async (fn, a) => {
      if (fn === "basket_add_item") addCalls++;
      if (fn === "customer_turn_end") throw new RpcStalled(fn, 8000);
      return rpc(fn, a);
    };
    await runDispatch(w.deps);
    w.advance(60);
    await runDispatch(w.deps);
    expect(w.queue[0].status).toBe("done");
    expect(w.queue[0].attempts).toBe(1);
    expect(addCalls).toBe(1);
    expect(w.sent).toHaveLength(1);
  });
});
