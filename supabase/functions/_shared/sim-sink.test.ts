import { describe, expect, it } from "vitest";
import { isSimNumber, simSinkSend } from "./sim-sink.ts";

describe("simulator sink (§36)", () => {
  it("knows simulator numbers", () => {
    expect(isSimNumber("+9999611608167")).toBe(true);
    expect(isSimNumber("9999611608167")).toBe(true);
    expect(isSimNumber("+96170123456")).toBe(false);
  });
  it("records a message when the sink is on", async () => {
    const r = await simSinkSend(
      async () => true,
      "PNID",
      { to: "+9999611608167" },
      () => "x",
    );
    expect(r).toEqual({ ok: true, id: "sim.x" });
  });
  it("refuses for good when the sink is off (production)", async () => {
    expect(await simSinkSend(async () => false, "PNID", { to: "+9999611608167" })).toEqual({
      ok: false,
      retry: false,
      error: "simulator number and the sink is off",
    });
  });
  it("retries when the sink cannot be reached (a stalled request, #139), instead of losing the message", async () => {
    const r = await simSinkSend(
      async () => {
        throw new Error("RpcStalled: sim_sink_record");
      },
      "PNID",
      { to: "+9999611608167" },
    );
    expect(r).toMatchObject({ ok: false, retry: true });
    expect(r.ok ? "" : r.error).toMatch(/unreachable.*RpcStalled/);
  });
});
