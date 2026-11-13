// B4: the address cases from the founder's first live order. The judge must fail the readings the live model gave on 13 Nov
// (village left out of «عبعقلين»; «راجح» from «بحي راجح» as a village) and pass right ones. The live run is in evals/live.
import { describe, expect, it } from "vitest";
import cases from "../cases/address_readings.json";
import { judgeAddress, type AddressCase } from "../run";

const byId = (id: string) => (cases.cases as AddressCase[]).find((c) => c.id === id)!;

describe("address readings (B4)", () => {
  it("13 Nov, the order: the live reading left the village out; that fails, «بعقلين» passes", () => {
    expect(judgeAddress(byId("addr-13nov-order"), null)).toMatchObject({ ok: false, why: "village left out" });
    expect(judgeAddress(byId("addr-13nov-order"), "بعقلين").ok).toBe(true);
    expect(judgeAddress(byId("addr-13nov-order"), "Baakline").ok).toBe(true);
  });
  it("13 Nov, the voice note: «راجح» as a village fails; an empty village passes", () => {
    expect(judgeAddress(byId("addr-13nov-voice"), "راجح").ok).toBe(false);
    expect(judgeAddress(byId("addr-13nov-voice"), null).ok).toBe(true);
  });
  it("a neighbourhood next to a village: the village passes, the neighbourhood fails", () => {
    expect(judgeAddress(byId("addr-hay"), "بعقلين").ok).toBe(true);
    expect(judgeAddress(byId("addr-hay"), "حي الصالحين").ok).toBe(false);
    expect(judgeAddress(byId("addr-7ay"), "el 3ein").ok).toBe(false);
  });
  it("every case is well formed", () => {
    for (const c of cases.cases as AddressCase[]) {
      expect(c.texts?.length || c.transcripts?.length).toBeTruthy();
      expect(c.village === null || c.village.length > 0).toBe(true);
    }
  });
});
