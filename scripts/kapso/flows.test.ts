import { describe, expect, it } from "vitest";
import {
  flowFiles,
  flowPlan,
  needsDataEndpoint,
  setSecret,
  testRecipient,
  validationErrors,
} from "./flows";

describe("whatsapp-flows uploader (DECISIONS §12, §39.8)", () => {
  const files = flowFiles();
  it("finds every Flow in Arabic and English, named alo_<flow>_<lang>", () => {
    expect(files).toHaveLength(14);
    expect(files.map((f) => f.name)).toContain("alo_address_capture_ar");
    expect(files.map((f) => f.name)).toContain("alo_checkout_en");
    expect(new Set(files.map((f) => f.flow)).size).toBe(7);
  });
  it("only the Alo King app needs a data endpoint (§39.15.13); the §12 Flows are navigate-only", () => {
    for (const f of files) expect(needsDataEndpoint(f.json), f.name).toBe(f.flow === "app");
    expect(needsDataEndpoint({ data_api_version: "3.0", screens: [] })).toBe(true);
    expect(
      needsDataEndpoint({
        screens: [{ layout: { children: [{ "on-click-action": { name: "data_exchange" } }] } }],
      }),
    ).toBe(true);
  });
  it("creates what is missing, updates a draft, never touches a published Flow", () => {
    const plan = flowPlan(
      files,
      [
        { id: "a", name: "alo_address_capture_ar", status: "draft" },
        { id: "b", name: "alo_checkout_en", status: "published" },
      ],
      true,
    );
    const at = (n: string) => plan.find((p) => p.file.name === n)!;
    expect(at("alo_address_capture_ar")).toMatchObject({ action: "update", publish: true });
    expect(at("alo_checkout_en")).toMatchObject({ action: "keep", publish: false });
    expect(at("alo_item_options_en")).toMatchObject({ action: "create", publish: true });
    expect(flowPlan(files, [], false).every((p) => !p.publish)).toBe(true);
  });
  it("reads Meta's validation errors from Kapso's answer", () => {
    expect(
      validationErrors({ data: { validation_errors: [{ message: "Missing Footer" }] } }),
    ).toEqual(["Missing Footer"]);
    expect(validationErrors({ data: { id: "x" } })).toEqual([]);
  });
  it("the test recipient is the one owner phone that wrote in the last 24 hours, never a guess", () => {
    const now = Date.UTC(2026, 9, 15, 16, 0);
    const t = (h: number) => String(Math.floor((now - h * 3600_000) / 1000));
    const owner = "+96170000001";
    expect(testRecipient([{ from: "96170000001", timestamp: t(1) }], [owner], now)).toBe(owner);
    expect(testRecipient([{ from: "96170000001", timestamp: t(25) }], [owner], now)).toBeNull(); // window closed
    expect(testRecipient([{ from: "96170000002", timestamp: t(1) }], [owner], now)).toBeNull(); // not an owner
    expect(
      testRecipient([{ from: "99996170000001", timestamp: t(1) }], ["+99996170000001"], now),
    ).toBeNull(); // simulator
    expect(
      testRecipient(
        [
          { from: "96170000001", timestamp: t(1) },
          { from: "96170000003", timestamp: t(2) },
        ],
        [owner, "+96170000003"],
        now,
      ),
    ).toBeNull(); // two candidates: nothing is sent
  });
  it("a data endpoint secret is retried after Kapso's 5xx, never after a refusal", async () => {
    const waits: number[] = [];
    let n = 0;
    const flaky = async () => {
      if (++n < 3) throw new Error("kapso 502 /platform/v1/functions/f/secrets: {}");
      return { data: { saved: true } };
    };
    expect(await setSecret("f", "A", "b", flaky as any, async (ms) => void waits.push(ms))).toEqual(
      {
        data: { saved: true },
      },
    );
    expect(waits).toEqual([5_000, 15_000]);
    let refused = 0;
    const no = async () => {
      refused++;
      throw new Error("kapso 422 /platform/v1/functions/f/secrets: {}");
    };
    await expect(setSecret("f", "A", "b", no as any, async () => {})).rejects.toThrow("422");
    expect(refused).toBe(1);
  });
});
