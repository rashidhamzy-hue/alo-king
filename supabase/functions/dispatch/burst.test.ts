// Five messages in a row get one reply (CUSTOMER-EXPERIENCE §3.1 #6): the dispatch side of the debounce. The database's
// decision (customer_burst) is tested in supabase/tests/99_first_contact.sql; here: what dispatch does with each answer.
import { describe, expect, it } from "vitest";
import { runDispatch, type DispatchDeps } from "./handler";
import { inboundBurst, withBurst } from "./customer/burst";
import type { CustomerInbound } from "./customer/turn";

const CUST = "10000000-0000-0000-0000-000000000001";
const text = (body: string): CustomerInbound => ({
  from: "+96170000001",
  messageId: "wamid.1",
  type: "text",
  text: body,
  buttonId: null,
  location: null,
  audio: null,
  name: null,
});

describe("inboundBurst", () => {
  it("asks the database only about typed text", async () => {
    const calls: any[] = [];
    const rpc = async (fn: string, a: any) => (
      calls.push([fn, a]),
      { status: "wait", wait_s: 1.2 }
    );
    expect(
      await inboundBurst(rpc, 7, {
        ...text("x"),
        type: "interactive",
        text: null,
        buttonId: "c:order",
      }),
    ).toEqual({
      kind: "single",
    });
    expect(await inboundBurst(rpc, 7, { ...text("x"), type: "location", text: null })).toEqual({
      kind: "single",
    });
    expect(calls).toHaveLength(0);
    expect(await inboundBurst(rpc, 7, text("hi"))).toEqual({ kind: "wait", seconds: 1.2 });
    expect(calls).toEqual([["customer_burst", { p_event_id: 7 }]]);
    // STOP and deletion never wait for the rest of a burst.
    for (const urgent of ["STOP", "delete my data"])
      expect(await inboundBurst(rpc, 8, text(urgent)), urgent).toEqual({ kind: "single" });
    expect(calls).toHaveLength(1);
  });
  it("reads each answer; anything odd answers the message alone", async () => {
    const r = (x: any) => async () => x;
    expect(await inboundBurst(r({ status: "folded", into: 3 }), 7, text("a"))).toEqual({
      kind: "folded",
    });
    expect(await inboundBurst(r({ status: "burst", texts: ["a", "b"] }), 7, text("a"))).toEqual({
      kind: "burst",
      texts: ["a", "b"],
    });
    expect(await inboundBurst(r({ status: "burst", texts: ["a"] }), 7, text("a"))).toEqual({
      kind: "single",
    });
    expect(await inboundBurst(r({ status: "wait", wait_s: 99 }), 7, text("a"))).toEqual({
      kind: "wait",
      seconds: 30,
    });
    expect(await inboundBurst(r({ status: "wait", wait_s: -1 }), 7, text("a"))).toEqual({
      kind: "single",
    });
    expect(await inboundBurst(r(null), 7, text("a"))).toEqual({ kind: "single" });
    expect(
      await inboundBurst(
        async () => {
          throw new Error("down");
        },
        7,
        text("a"),
      ),
    ).toEqual({ kind: "single" });
    expect(await inboundBurst(r({ status: "wait", wait_s: 1 }), "x", text("a"))).toEqual({
      kind: "single",
    });
  });
  it("the leader's message carries every text, joined, and keeps them apart for the turn", () => {
    const m = withBurst(text("hi"), ["hi", "2 shawarma", "x".repeat(3000)]);
    expect(m.text?.startsWith("hi\n2 shawarma\n")).toBe(true);
    expect(m.text).toHaveLength(2000);
    expect(m.burst).toHaveLength(3);
    expect(m.messageId).toBe("wamid.1");
  });
});

// A queue of three typed messages from one customer, claimed together; customer_burst as the database answers it.
function world() {
  const ev = (n: number, body: string, type = "text") => ({
    msg_id: 100 + n,
    event_id: n,
    event_type: "whatsapp.message.received",
    phone_number_id: "PNID",
    attempts: 1,
    payload: {
      conversation: { phone_number: "+96170000001" },
      message: {
        id: `wamid.${n}`,
        type,
        kapso: { direction: "inbound" },
        ...(type === "text"
          ? { text: { body } }
          : { interactive: { button_reply: { id: "c:track" } } }),
      },
    },
  });
  const bodies: Record<number, string> = { 1: "hi", 2: "i want shawarma", 3: "2 please" };
  let queue = [ev(1, bodies[1]), ev(2, bodies[2]), ev(3, bodies[3])];
  let quiet = false;
  let due: any[] = [];
  const calls: { fn: string; args: any }[] = [];
  const rpc = async (fn: string, a: any): Promise<any> => {
    calls.push({ fn, args: a });
    switch (fn) {
      case "webhook_claim": {
        const q = queue;
        queue = [];
        return q;
      }
      case "webhook_next_due":
        return due.length ? 0.1 : null;
      case "customer_burst":
        if (!quiet) return { status: "wait", wait_s: 1.5 };
        // The first one claimed after the quiet leads; the others were folded into it.
        return a.p_event_id === 1
          ? { status: "burst", texts: ["hi", "i want shawarma", "2 please"], count: 3 }
          : { status: "folded", into: 1 };
      case "webhook_defer":
        due.push(a);
        return true;
      case "merchant_members_by_phone":
        return [];
      case "whatsapp_sender":
        return "PNID";
      case "customer_turn_begin":
        return {
          duplicate: false,
          first_contact: false,
          customer: { id: CUST, language: "en", blocked: false },
          session: {
            lang: "en",
            pending: {},
            refs: {},
            history: [],
            low_confidence: 0,
            handoff: false,
          },
          basket: null,
          orders: [],
          profile: {},
          bot_enabled: true,
          support_open: true,
        };
      case "catalog_search":
        return { status: "ok", items: [] };
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
    whatsapp: async (_from, payload) => (
      sent.push(payload),
      { ok: true, id: `wamid.out.${sent.length}` }
    ),
    call: null,
    budgetMs: 60_000,
    // The wait inside the run: the deferred messages come back once the customer is quiet.
    sleep: async () => {
      quiet = true;
      // Back on the queue as they were (same message, same text), with the attempt the deferral gave back.
      queue = due.map((d) => ({
        ...ev(d.p_event_id, bodies[d.p_event_id]),
        attempts: d.p_attempt,
      }));
      due = [];
    },
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
        freeText: false,
      },
    },
  };
  return { deps, sent, calls, of: (fn: string) => calls.filter((c) => c.fn === fn), ev };
}

describe("dispatch: a burst of typed messages", () => {
  it("each waits without spending an attempt, then one turn answers all three with one reply", async () => {
    const w = world();
    await runDispatch(w.deps);
    // Three deferrals first (none finished: they are back on the queue, their attempt given back).
    expect(
      w.of("webhook_defer").map((c) => [c.args.p_event_id, c.args.p_attempt, c.args.p_delay_s]),
    ).toEqual([
      [1, 1, 1.5],
      [2, 1, 1.5],
      [3, 1, 1.5],
    ]);
    // Then one turn, for the leader's message, with the three texts read as one.
    expect(w.of("customer_turn_begin").map((c) => c.args.p_message_id)).toEqual(["wamid.1"]);
    // The greeting is dropped and the quantity read, as for one message saying both lines.
    expect(w.of("catalog_search")[0].args.p_query).toBe("i want shawarma please");
    expect(w.sent).toHaveLength(1);
    // Every event is finished once: the leader and the two folded ones, all done.
    expect(w.of("webhook_finish").map((c) => [c.args.p_event_id, c.args.p_status])).toEqual([
      [1, "done"],
      [2, "done"],
      [3, "done"],
    ]);
  });

  it("a tap is never held back", async () => {
    const w = world();
    let queue: any[] | null = [w.ev(9, "", "interactive")];
    const rpc = w.deps.rpc;
    w.deps.rpc = async (fn, a) => {
      if (fn === "webhook_claim") {
        const q = queue ?? [];
        queue = null;
        return q;
      }
      return rpc(fn, a);
    };
    await runDispatch(w.deps);
    expect(w.of("customer_burst")).toHaveLength(0);
    expect(w.of("customer_turn_begin")).toHaveLength(1);
  });

  it("a message that cannot be put back is answered at once rather than never", async () => {
    const w = world();
    const rpc = w.deps.rpc;
    w.deps.rpc = async (fn, a) => (fn === "webhook_defer" ? false : rpc(fn, a));
    await runDispatch(w.deps);
    expect(w.of("customer_turn_begin")).toHaveLength(3);
    expect(w.of("webhook_finish")).toHaveLength(3);
  });
});
