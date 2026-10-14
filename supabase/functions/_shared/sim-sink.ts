// Simulator numbers (+999, DECISIONS §36) are recorded in sim_outbox by `sim_sink_record` and never sent. When the
// sink is off (production) the RPC answers false and the message is refused for good, so a +999 number can never
// reach Kapso. When the RPC itself fails (a stalled request, #139), the send is retried like any other failed send:
// before this, a stall read as "the sink is off" and the message (e2e run 38611719257: the rating card) was lost.
export type SimSendResult = { ok: true; id: string } | { ok: false; retry: boolean; error: string };

export const isSimNumber = (to: unknown) => /^\+?999[0-9]{6,12}$/.test(String(to ?? ""));

export async function simSinkSend(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>,
  phoneNumberId: string,
  payload: Record<string, unknown>,
  newId: () => string = () => crypto.randomUUID(),
): Promise<SimSendResult> {
  let recorded: unknown;
  try {
    recorded = await rpc("sim_sink_record", {
      p_phone_number_id: phoneNumberId,
      p_payload: payload,
    });
  } catch (e) {
    return {
      ok: false,
      retry: true,
      error: `simulator sink unreachable: ${String(e).slice(0, 120)}`,
    };
  }
  return recorded === true
    ? { ok: true, id: `sim.${newId()}` }
    : { ok: false, retry: false, error: "simulator number and the sink is off" };
}
