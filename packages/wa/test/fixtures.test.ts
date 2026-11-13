// Task 4.1: the parsers against the saved Kapso payloads (test/fixtures/kapso/). Every file is read; none is skipped.
import { describe, expect, it } from "vitest";
import { KapsoReceived, senderKey, unwrap } from "../src/kapso";
import { parseIdentityEvent, parsePreferenceEvent, parseStatusEvent } from "../src/webhook";
import { loadFixtures } from "./fixtures";

const CUSTOMER_LINE = "1378974041965966";

describe("fixtures on disk", () => {
  it("cover every event the gateway handles, with real message objects for messages and statuses", () => {
    const all = loadFixtures();
    const kinds = new Set(all.map((f) => f.file.split("/")[0]));
    for (const e of ["whatsapp.message.received", "whatsapp.message.delivered", "whatsapp.message.read", "whatsapp.message.failed",
      "whatsapp.contact.marketing_preference_changed", "whatsapp.contact.identity_changed"]) expect(kinds, e).toContain(e);
    const received = loadFixtures("whatsapp.message.received");
    expect(received.every((f) => f.source === "kapso-message-api" || f.source === "webhook")).toBe(true);
    const types = new Set(received.map((f) => (f.body as { message: { type: string; interactive?: { type: string } } }).message.interactive?.type ?? (f.body as { message: { type: string } }).message.type));
    for (const t of ["text", "audio", "image", "location", "button_reply", "list_reply"]) expect(types, t).toContain(t);
  });

  it("hold no real person: numbers, user ids, names and media links are fakes", () => {
    const text = loadFixtures().map((f) => JSON.stringify(f.body)).join("\n");
    expect(text.match(/\b[A-Z]{2}\.\d{10,}\b/g)?.every((x) => x.startsWith("XX.")) ?? true).toBe(true);
    expect(text).not.toMatch(/lookaside\.fbsbx|app\.kapso\.ai\/rails/);
    const phones = (text.match(/\b961\d{6,}\b/g) ?? []).filter((p) => !p.startsWith("9617000"));
    expect(phones).toEqual([]);
  });
});

describe("whatsapp.message.received", () => {
  const fixtures = loadFixtures("whatsapp.message.received");
  it.each(fixtures.map((f) => [f.file, f] as const))("%s parses and yields a sender", (_name, f) => {
    for (const item of unwrap(f.body)) {
      const e = KapsoReceived.parse(item);                     // throws on the first field the schema got wrong
      expect(e.phone_number_id).toBe(CUSTOMER_LINE);
      const who = senderKey(e);
      expect(who.waUserId ?? who.phone).toBeTruthy();
      if (who.phone) expect(who.phone).toMatch(/^\+\d{8,15}$/);
      if (e.message.type === "text") expect(e.message.text?.body).toBeTruthy();
      if (e.message.type === "audio") { expect(e.message.audio?.id).toBeTruthy(); expect(e.message.kapso.transcript?.text).toBeTruthy(); }
      if (e.message.type === "location") { expect(typeof e.message.location?.latitude).toBe("number"); }
      if (e.message.type === "interactive") expect(e.message.interactive?.button_reply?.id ?? e.message.interactive?.list_reply?.id).toBeTruthy();
      expect(e.message.kapso.origin).toBe("cloud_api");
    }
  });

  it("username: null (as Kapso sends it) is accepted; it used to fail the whole message", () => {
    const f = fixtures[0]!;
    expect((f.body as { message: { username: unknown } }).message.username).toBeNull();
    expect(() => KapsoReceived.parse(f.body)).not.toThrow();
  });
});

describe("statuses", () => {
  for (const event of ["whatsapp.message.delivered", "whatsapp.message.read"]) {
    const fixtures = loadFixtures(event);
    it.each(fixtures.map((f) => [f.file, f] as const))("%s gives the wamid, the status and Meta's pricing", (_n, f) => {
      const s = parseStatusEvent(event, f.body)!;
      expect(s.wamid).toMatch(/^wamid\./);
      expect(s.status).toBe(event.split(".").pop());
      expect(s.pricing).toEqual({ billable: false, category: "service", type: "free_customer_service" });
    });
  }
  it("a failed message carries Meta's error code", () => {
    const [f] = loadFixtures("whatsapp.message.failed");
    expect(parseStatusEvent("whatsapp.message.failed", f!.body)).toMatchObject({ status: "failed", error: { code: "131047", title: "Re-engagement message" } });
  });
});

describe("contact events", () => {
  it("marketing preference: stopped and resumed, with Kapso's sequence", () => {
    const [stopped, resumed] = [...loadFixtures("whatsapp.contact.marketing_preference_changed")].sort((a, b) => b.file.localeCompare(a.file));
    expect(parsePreferenceEvent(stopped!.body)).toEqual({ waUserId: "XX.0000000000000001", phone: "+96170000001", status: "stopped", sequence: 4821 });
    expect(parsePreferenceEvent(resumed!.body)).toMatchObject({ status: "resumed", sequence: 4822, waUserId: null });
    // The old reader took the object for a string: "[object Object]" matched no stop word, so a STOP was saved as opt-in.
    expect(String((stopped!.body as { marketing_preference: unknown }).marketing_preference)).toBe("[object Object]");
  });
  it("identity change: old and new business-scoped user ids", () => {
    const [f] = loadFixtures("whatsapp.contact.identity_changed");
    expect(parseIdentityEvent(f!.body)).toEqual({ newId: "XX.0000000000000099", oldId: "XX.0000000000000001", phone: "+96170000001" });
  });
  it("an unknown preference status is not acted on", () => {
    expect(parsePreferenceEvent({ contact: {}, marketing_preference: { status: "paused" } })).toBeNull();
  });
});

