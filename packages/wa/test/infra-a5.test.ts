// Session A5 (infra): G1-15 (the line check), G1-17 (media hosts), G1-18 (a send that could not be marked), G1-24 (the typing call).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { loadFixtures } from "./fixtures";
import { allowedMediaUrl, fetchKapsoMedia, isKapsoMediaHost, kapsoMediaUrlOf } from "../src/media";
import { lineProblem } from "../src/webhook";
import { showTyping } from "../src/kapso";
import { send, type SendRequest } from "../src/gateway";

vi.mock("@sentry/cloudflare", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("G1-17: media is fetched from Kapso's hosts only", () => {
  it("accepts Kapso's domain and its subdomains over https, nothing else", () => {
    for (const ok of ["https://app.kapso.ai/rails/active_storage/blobs/redirect/abc/voice.ogg", "https://api.kapso.ai/x", "https://kapso.ai/x"]) expect(allowedMediaUrl(ok)).toBe(ok);
    for (const no of [
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",   // Meta's host: refused, as before
      "https://example.com/a.jpg", "https://evilkapso.ai/a", "https://kapso.ai.evil.com/a", "https://evil.com/?h=app.kapso.ai",
      "http://app.kapso.ai/a", "https://user:pw@app.kapso.ai/a", "https://app.kapso.ai:8443/a", "ftp://app.kapso.ai/a", "not a url", "", null, undefined,
      "https://169.254.169.254/latest/meta-data", "https://localhost/a", "https://127.0.0.1/a",
    ]) expect(allowedMediaUrl(no as string)).toBeNull();
    expect(isKapsoMediaHost("APP.KAPSO.AI")).toBe(true);
    expect(isKapsoMediaHost("kapso.ai.")).toBe(true);
  });
  it("takes the first of the offered addresses that passes (the other one is checked too)", () => {
    expect(kapsoMediaUrlOf("https://evil.test/a", "https://app.kapso.ai/b")).toBe("https://app.kapso.ai/b");
    expect(kapsoMediaUrlOf("https://evil.test/a", undefined)).toBeNull();
  });
  it("every media address in the saved Kapso payloads is refused unless it is Kapso's (the saved ones are scrubbed to example.invalid)", () => {
    const urls = loadFixtures().flatMap((f) => JSON.stringify(f.body).match(/https:\/\/[^"]+/g) ?? []);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(allowedMediaUrl(u)).toBeNull();
  });
  it("fetches a Kapso address, follows a Kapso redirect to its storage over https, and never sends a credential", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.startsWith("https://app.kapso.ai") ? new Response(null, { status: 302, headers: { location: "https://storage.example.net/blob?sig=1" } }) : new Response("bytes", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchKapsoMedia("https://app.kapso.ai/rails/x", f);
    expect(await res.text()).toBe("bytes");
    expect(calls.map((c) => c.url)).toEqual(["https://app.kapso.ai/rails/x", "https://storage.example.net/blob?sig=1"]);
    expect(calls.every((c) => c.init?.redirect === "manual")).toBe(true);
    expect(calls.every((c) => !(c.init?.headers))).toBe(true);
  });
  it("refuses a host that is not Kapso's without calling out, a redirect from a non-Kapso host, a redirect to http, and a loop", async () => {
    const never = vi.fn();
    await expect(fetchKapsoMedia("https://evil.test/a", never as unknown as typeof fetch)).rejects.toThrow("MEDIA_HOST_REFUSED");
    expect(never).not.toHaveBeenCalled();
    const hop = (to: string) => (async (url: string) => (url.startsWith("https://app.kapso.ai/") || url.startsWith("https://other.example.net/"))
      ? new Response(null, { status: 302, headers: { location: to } }) : new Response("x", { status: 200 })) as unknown as typeof fetch;
    // Kapso -> storage host -> redirect again: the storage host does not get to send us further
    const chained = (async (url: string) => url.startsWith("https://app.kapso.ai/") ? new Response(null, { status: 302, headers: { location: "https://other.example.net/b" } })
      : new Response(null, { status: 302, headers: { location: "https://third.example.net/c" } })) as unknown as typeof fetch;
    await expect(fetchKapsoMedia("https://app.kapso.ai/a", chained)).rejects.toThrow("MEDIA_REDIRECT_REFUSED");
    await expect(fetchKapsoMedia("https://app.kapso.ai/a", hop("http://storage.example.net/b"))).rejects.toThrow("MEDIA_REDIRECT_REFUSED");
    await expect(fetchKapsoMedia("https://app.kapso.ai/a", hop("https://user:pw@storage.example.net/b"))).rejects.toThrow("MEDIA_REDIRECT_REFUSED");
    await expect(fetchKapsoMedia("https://app.kapso.ai/a", hop("https://app.kapso.ai/a"))).rejects.toThrow("MEDIA_TOO_MANY_REDIRECTS");
  });
});

describe("G1-15: a message event must say which number it came to", () => {
  const customer = "1378974041965966", ops = "597907523413541";
  it("accepts every saved real message event for its own number", () => {
    for (const f of loadFixtures().filter((x) => x.event.startsWith("whatsapp.message."))) {
      const id = (f.body as { phone_number_id: string }).phone_number_id;
      expect(lineProblem(f.event, f.body, id), f.file).toBeNull();
    }
  });
  it("refuses a message event with no phone_number_id (before: it passed), and one for the other line", () => {
    for (const f of loadFixtures().filter((x) => x.event.startsWith("whatsapp.message.")).slice(0, 12)) {
      const { phone_number_id: _drop, ...without } = f.body as Record<string, unknown>;
      expect(lineProblem(f.event, without, customer), f.file).toBe("no phone_number_id");
      expect(lineProblem(f.event, { ...without, phone_number_id: "" }, customer)).toBe("no phone_number_id");
      expect(lineProblem(f.event, { ...without, phone_number_id: null }, customer)).toBe("no phone_number_id");
      expect(lineProblem(f.event, { ...without, phone_number_id: ops }, customer)).toBe("wrong line");
    }
  });
  it("checks every item of a batch, not only the first", () => {
    const item = (id?: string) => ({ message: { id: "w" }, ...(id ? { phone_number_id: id } : {}) });
    expect(lineProblem("whatsapp.message.received", { batch: true, data: [item(customer), item(customer)] }, customer)).toBeNull();
    expect(lineProblem("whatsapp.message.received", { batch: true, data: [item(customer), item(ops)] }, customer)).toBe("wrong line");
    expect(lineProblem("whatsapp.message.received", { batch: true, data: [item(customer), item()] }, customer)).toBe("no phone_number_id");
    expect(lineProblem("whatsapp.message.sent", { batch: true, data: [] }, customer)).toBeNull();
  });
  it("contact events carry no number in Kapso's shape: allowed without one, refused with the wrong one", () => {
    for (const f of loadFixtures().filter((x) => x.event.startsWith("whatsapp.contact."))) expect(lineProblem(f.event, f.body, customer), f.file).toBeNull();
    expect(lineProblem("whatsapp.contact.identity_changed", { contact: {}, phone_number_id: ops }, customer)).toBe("wrong line");
  });
});

describe("G1-24: the typing indicator is one function in packages/wa", () => {
  it("marks the message read with a text typing indicator, through the Kapso client", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    await showTyping({ KAPSO_BASE_URL: "https://api.kapso.ai/meta/whatsapp/v24.0", KAPSO_API_KEY: "k" }, "1378974041965966", "wamid.IN1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/1378974041965966/messages");
    expect(JSON.parse(String(init.body))).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN1", typing_indicator: { type: "text" } });
  });
});

describe("G1-18: a message that went out and could not be marked sent raises a Sentry event", () => {
  const env = { KAPSO_BASE_URL: "https://kapso.test", KAPSO_API_KEY: "k", PHONE_NUMBER_ID_CUSTOMER: "1", PHONE_NUMBER_ID_OPS: "2" };
  const req: SendRequest = { line: "customer", partyId: "p1", to: "96170000001", category: "service", dedupeKey: "turn-77:abc", msg: { type: "text", text: { body: "سر شخصي" } } };
  const db = (markFails: boolean) => ({
    rpc: (fn: string) => Promise.resolve(fn === "can_send" ? { data: "ok", error: null } : fn === "outbox_claim" ? { data: true, error: null }
      : fn === "outbox_mark" && markFails ? { data: null, error: { message: "down" } } : { data: null, error: null }),
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  }) as any;
  it("tells Sentry once, with the key and the message id and nothing personal, and still returns ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OUT9" }] }), { status: 200, headers: { "content-type": "application/json" } })));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await send(db(true), env, req)).toEqual({ ok: true, wamid: "wamid.OUT9" });
    quiet.mockRestore();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = (Sentry.captureMessage as any).mock.calls[0];
    expect(msg).toBe("outbox_mark_failed_after_send");
    expect(ctx).toMatchObject({ level: "error", extra: { dedupeKey: "turn-77:abc", wamid: "wamid.OUT9" }, fingerprint: ["outbox_mark_failed_after_send"] });
    expect(JSON.stringify(ctx)).not.toMatch(/96170000001|سر شخصي/);
  });
  it("says nothing when the mark worked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OUT10" }] }), { status: 200, headers: { "content-type": "application/json" } })));
    expect(await send(db(false), env, { ...req, dedupeKey: "turn-77:def" })).toEqual({ ok: true, wamid: "wamid.OUT10" });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
  it("a Sentry that throws never turns a sent message into a retry", async () => {
    (Sentry.captureMessage as any).mockImplementationOnce(() => { throw new Error("sentry down"); });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OUT11" }] }), { status: 200, headers: { "content-type": "application/json" } })));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(send(db(true), env, { ...req, dedupeKey: "turn-77:ghi" })).resolves.toEqual({ ok: true, wamid: "wamid.OUT11" });
    quiet.mockRestore();
  });
});
