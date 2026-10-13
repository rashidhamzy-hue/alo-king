import { describe, expect, it } from "vitest";
import { LIMITS, makeHandler, type SiteClaimDeps } from "./site-claim";

const VENDOR = "20000000-0000-0000-0000-0000000000d1";
const CLAIM = "40000000-0000-0000-0000-000000000001";
const PHONE = "+96176555001";
const SEED = "+96170123456";

function setup(opts: {
  rpcs?: Record<string, (a: any) => any>;
  sendOk?: boolean;
  limitOk?: boolean;
  limiterThrows?: boolean;
  voice?: boolean;
}) {
  const calls: { fn: string; args: any }[] = [];
  const sent: { to: string; code: string; via: string }[] = [];
  const stored: string[] = [];
  const removed: string[] = [];
  const logs: string[] = [];
  const deps: SiteClaimDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "web_rate_hit") {
        if (opts.limiterThrows) throw new Error("db down");
        return opts.limitOk !== false;
      }
      return opts.rpcs?.[fn]?.(args) ?? null;
    },
    whatsappCode: async (to, code) => {
      sent.push({ to, code, via: "whatsapp" });
      return opts.sendOk === false ? { ok: false, error: "window" } : { ok: true, id: "w1" };
    },
    voiceCode: opts.voice
      ? async (to, code) => {
          sent.push({ to, code, via: "voice" });
          return { ok: true };
        }
      : null,
    storeDocument: async (path) => {
      stored.push(path);
      return true;
    },
    removeDocument: async (path) => {
      removed.push(path);
    },
    log: (m) => logs.push(m),
    visitorKey: async () => "visitor1",
  };
  const handler = makeHandler(deps);
  const post = (body: unknown) =>
    handler(
      new Request("https://x.test/functions/v1/site-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { handler, post, calls, sent, stored, removed, logs };
}
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
// A multipart body written by hand: the test environment's FormData is not the one Request understands.
const upload = (fields: Record<string, string>, bytes: Uint8Array = JPEG) => {
  const boundary = "----akboundary";
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(fields))
    parts.push(
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sign.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    bytes,
    enc.encode(`\r\n--${boundary}--\r\n`),
  );
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    body.set(p, at);
    at += p.length;
  }
  return new Request("https://x.test/functions/v1/site-claim", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
};

describe("site-claim", () => {
  it("answers the browser's preflight and refuses other methods", async () => {
    const { handler } = setup({});
    const pre = await handler(new Request("https://x.test/", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect((await handler(new Request("https://x.test/", { method: "GET" }))).status).toBe(405);
  });

  it("search returns names and towns, never a phone beyond its last two digits", async () => {
    const { post, calls } = setup({
      rpcs: {
        vendor_claim_search: () => [
          {
            vendor_id: VENDOR,
            name: "مشاوي أبو كليم",
            branch_label: null,
            town: "بعقلين",
            claim_status: "unclaimed",
            seed_phone_tail: "…56",
            score: 0.9,
            secret_extra: "+96170123456",
          },
          {
            vendor_id: CLAIM,
            name: "Taken",
            town: "x",
            claim_status: "claimed",
            seed_phone_tail: null,
          },
        ],
      },
    });
    const r = await j(await post({ action: "search", q: "abu claim" }));
    expect(r.status).toBe(200);
    expect(r.body.results[0]).toEqual({
      vendor_id: VENDOR,
      name: "مشاوي أبو كليم",
      branch_label: null,
      town: "بعقلين",
      claimed: false,
      frozen: false,
      phone_tail: "…56",
    });
    expect(r.body.results[1].claimed).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("96170123456");
    expect(calls.find((c) => c.fn === "vendor_claim_search")?.args).toEqual({
      p_query: "abu claim",
      p_limit: 8,
    });
    expect((await j(await post({ action: "search", q: "a" }))).status).toBe(400);
  });

  it("lookup returns one business the same way and nothing for an unknown id", async () => {
    const { post } = setup({
      rpcs: {
        vendor_claim_lookup: (a) =>
          a.p_vendor_id === VENDOR
            ? [
                {
                  vendor_id: VENDOR,
                  name: "Abu Claim",
                  town: "Baakline",
                  claim_status: "frozen",
                  seed_phone_tail: "…56",
                  in_brand: true,
                  secret: SEED,
                },
              ]
            : [],
      },
    });
    const ok = await j(await post({ action: "lookup", vendor_id: VENDOR }));
    expect(ok.body).toEqual({
      ok: true,
      found: true,
      business: {
        vendor_id: VENDOR,
        name: "Abu Claim",
        branch_label: null,
        town: "Baakline",
        claimed: false,
        frozen: true,
        phone_tail: "…56",
        in_brand: true,
      },
    });
    expect((await j(await post({ action: "lookup", vendor_id: CLAIM }))).body).toEqual({
      ok: true,
      found: false,
    });
    expect((await j(await post({ action: "lookup", vendor_id: "x" }))).status).toBe(400);
  });

  it("start sends the code to the shop's own number and never returns it", async () => {
    const { post, sent } = setup({
      rpcs: {
        claim_start: () => ({
          claim_id: CLAIM,
          case: "A",
          status: "code_sent",
          channel: "whatsapp",
          phone_tail: "…56",
          send: { channel: "whatsapp", to: SEED, code: "482913" },
        }),
      },
    });
    const r = await j(
      await post({ action: "start", vendor_id: VENDOR, phone: PHONE, name: "Samir", lang: "ar" }),
    );
    expect(r.body).toMatchObject({
      ok: true,
      status: "code_sent",
      claim_id: CLAIM,
      channel: "whatsapp",
      phone_tail: "…56",
    });
    expect(sent).toEqual([{ to: SEED, code: "482913", via: "whatsapp" }]);
    expect(JSON.stringify(r.body)).not.toContain("482913");
    expect(JSON.stringify(r.body)).not.toContain(SEED);
  });

  it("a landline gets the voice call; with no voice provider the claim moves to documents", async () => {
    const start = () => ({
      claim_id: CLAIM,
      case: "B",
      status: "code_sent",
      channel: "voice",
      phone_tail: "…99",
      send: { channel: "voice", to: "+9615333399", code: "123456" },
    });
    const withVoice = setup({ rpcs: { claim_start: start }, voice: true });
    await withVoice.post({ action: "start", vendor_id: VENDOR, phone: PHONE });
    expect(withVoice.sent[0]).toEqual({ to: "+9615333399", code: "123456", via: "voice" });

    const noVoice = setup({
      rpcs: {
        claim_start: start,
        claim_use_documents: () => ({
          status: "awaiting_documents",
          claim_id: CLAIM,
          missing: ["registration", "sign_photo"],
        }),
      },
    });
    const r = await j(await noVoice.post({ action: "start", vendor_id: VENDOR, phone: PHONE }));
    expect(r.body).toMatchObject({
      ok: true,
      status: "awaiting_documents",
      missing: ["registration", "sign_photo"],
      code_not_delivered: true,
    });
    expect(noVoice.calls.some((c) => c.fn === "claim_use_documents")).toBe(true);
  });

  it("when WhatsApp refuses the code the claim moves to documents instead of waiting", async () => {
    const { post, calls } = setup({
      sendOk: false,
      rpcs: {
        claim_start: () => ({
          claim_id: CLAIM,
          case: "A",
          status: "code_sent",
          channel: "whatsapp",
          send: { channel: "whatsapp", to: SEED, code: "111111" },
        }),
        claim_use_documents: () => ({
          status: "awaiting_documents",
          claim_id: CLAIM,
          missing: ["registration"],
        }),
      },
    });
    const r = await j(await post({ action: "start", vendor_id: VENDOR, phone: PHONE }));
    expect(r.body.code_not_delivered).toBe(true);
    expect(calls.map((c) => c.fn)).toContain("claim_use_documents");
  });

  it("passes the database's other answers through without extras", async () => {
    for (const status of ["already_owner", "rate_limited", "not_available", "no_brand"]) {
      const { post } = setup({ rpcs: { claim_start: () => ({ status, leak: SEED }) } });
      const r = await j(
        await post({
          action: "start",
          vendor_id: VENDOR,
          phone: PHONE,
          brand_wide: status === "no_brand",
        }),
      );
      expect(r.body).toEqual({ ok: true, status });
    }
    const contested = setup({
      rpcs: {
        claim_start: () => ({
          claim_id: CLAIM,
          case: "G",
          status: "awaiting_documents",
          contested: true,
          missing: ["registration"],
        }),
      },
    });
    expect(
      (await j(await contested.post({ action: "start", vendor_id: VENDOR, phone: PHONE }))).body,
    ).toMatchObject({
      contested: true,
      case: "G",
    });
  });

  it("validates before calling the database", async () => {
    const { post, calls } = setup({});
    for (const body of [
      { action: "start", vendor_id: "nope", phone: PHONE },
      { action: "start", vendor_id: VENDOR, phone: "0176555001" },
      { action: "verify", claim_id: CLAIM, phone: PHONE, code: "12345" },
      { action: "verify", claim_id: CLAIM, phone: PHONE, code: "abcdef" },
      {
        action: "register",
        phone: PHONE,
        business_type: "spaceship",
        name_en: "X",
        lat: 33.7,
        lon: 35.5,
      },
      { action: "register", phone: PHONE, business_type: "cafe", lat: 33.7, lon: 35.5 },
      { action: "nope" },
    ]) {
      const r = await j(await post(body));
      expect(r.status).toBe(400);
    }
    expect(calls.filter((c) => c.fn !== "web_rate_hit")).toEqual([]);
  });

  it("verify maps the answers and keeps ids out", async () => {
    const { post } = setup({
      rpcs: {
        claim_verify_code: () => ({
          status: "approved",
          claim_id: CLAIM,
          vendor_id: VENDOR,
          member_id: "m1",
        }),
      },
    });
    const r = await j(
      await post({ action: "verify", claim_id: CLAIM, phone: PHONE, code: "482913" }),
    );
    expect(r.body).toEqual({ ok: true, status: "approved", claim_id: CLAIM });
    const wrong = setup({
      rpcs: { claim_verify_code: () => ({ status: "wrong_code", claim_id: CLAIM, left: 3 }) },
    });
    expect(
      (
        await j(
          await wrong.post({ action: "verify", claim_id: CLAIM, phone: PHONE, code: "000000" }),
        )
      ).body,
    ).toEqual({
      ok: true,
      status: "wrong_code",
      claim_id: CLAIM,
      left: 3,
    });
  });

  it("rate limits each visitor and fails closed if the limiter breaks", async () => {
    const limited = setup({ limitOk: false });
    const r = await j(await limited.post({ action: "search", q: "abu" }));
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ ok: false, error: "rate_limited" });
    expect(limited.calls.filter((c) => c.fn !== "web_rate_hit")).toEqual([]);
    expect(limited.calls[0]?.args).toEqual({
      p_key: "site:search:visitor1",
      p_max: LIMITS.search[0],
      p_window_s: LIMITS.search[1],
    });

    const broken = setup({ limiterThrows: true });
    expect((await j(await broken.post({ action: "search", q: "abu" }))).status).toBe(429);
    expect(broken.logs).toContain("rate limiter failed");
  });

  it("registers a business with a pin inside Lebanon only", async () => {
    const { post, calls } = setup({
      rpcs: {
        vendor_register: () => ({
          status: "awaiting_documents",
          vendor_id: VENDOR,
          claim_id: CLAIM,
          case: "E",
          missing: ["registration", "sign_photo"],
        }),
      },
    });
    const ok = await j(
      await post({
        action: "register",
        phone: PHONE,
        name_en: "Cedar Bakery",
        name_ar: "",
        business_type: "bakery_manakish",
        lat: 33.68,
        lon: 35.58,
        home_kitchen: false,
        lang: "en",
      }),
    );
    expect(ok.body).toEqual({
      ok: true,
      status: "awaiting_documents",
      claim_id: CLAIM,
      case: "E",
      missing: ["registration", "sign_photo"],
    });
    expect(calls.find((c) => c.fn === "vendor_register")?.args).toMatchObject({
      p_name_ar: null,
      p_name_en: "Cedar Bakery",
      p_lang: "en",
    });
    const out = await j(
      await post({
        action: "register",
        phone: PHONE,
        name_en: "Dubai Cafe",
        business_type: "cafe",
        lat: 25.2,
        lon: 55.3,
      }),
    );
    expect(out.body).toEqual({ ok: false, error: "pin_outside_lebanon" });
  });

  describe("documents", () => {
    const claims = (status = "awaiting_documents") => ({
      claims_for_phone: () => [{ claim_id: CLAIM, status }],
    });
    it("stores a real image and records it on the claim", async () => {
      const { handler, stored, calls } = setup({
        rpcs: {
          ...claims(),
          claim_add_document: () => ({
            status: "awaiting_documents",
            claim_id: CLAIM,
            missing: ["registration"],
          }),
        },
      });
      const r = await j(
        await handler(upload({ claim_id: CLAIM, phone: PHONE, kind: "sign_photo" })),
      );
      expect(r.body).toEqual({
        ok: true,
        status: "awaiting_documents",
        claim_id: CLAIM,
        missing: ["registration"],
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatch(new RegExp(`^${CLAIM}/sign_photo-[0-9a-f-]{36}\\.jpg$`));
      expect(calls.find((c) => c.fn === "claim_add_document")?.args).toMatchObject({
        p_phone: PHONE,
        p_kind: "sign_photo",
        p_mime: "image/jpeg",
        p_claim_id: CLAIM,
      });
    });
    it("stores nothing for a claim that is not waiting for documents from this number", async () => {
      const { handler, stored } = setup({ rpcs: claims("pending_review") });
      const r = await j(
        await handler(upload({ claim_id: CLAIM, phone: PHONE, kind: "sign_photo" })),
      );
      expect(r.body).toEqual({ ok: true, status: "no_claim" });
      expect(stored).toEqual([]);
    });
    it("looks at the bytes, not the name: a script renamed .jpg is refused", async () => {
      const { handler, stored } = setup({ rpcs: claims() });
      const html = new TextEncoder().encode("<script>alert(1)</script>");
      const r = await j(
        await handler(upload({ claim_id: CLAIM, phone: PHONE, kind: "registration" }, html)),
      );
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("file_type");
      expect(stored).toEqual([]);
    });
    it("removes the file again when the database refuses it", async () => {
      const { handler, stored, removed } = setup({
        rpcs: { ...claims(), claim_add_document: () => ({ status: "too_many", claim_id: CLAIM }) },
      });
      await handler(upload({ claim_id: CLAIM, phone: PHONE, kind: "registration" }));
      expect(removed).toEqual(stored);
    });
    it("refuses an unknown kind and an oversize file", async () => {
      const { handler } = setup({ rpcs: claims() });
      expect(
        (await j(await handler(upload({ claim_id: CLAIM, phone: PHONE, kind: "selfie" })))).status,
      ).toBe(400);
      const big = new Uint8Array(8 * 1024 * 1024 + 1);
      big.set(JPEG);
      expect(
        (
          await j(
            await handler(upload({ claim_id: CLAIM, phone: PHONE, kind: "registration" }, big)),
          )
        ).body.error,
      ).toBe("file_size");
    });
  });

  it("driver applications need consent, a known vehicle and a valid number", async () => {
    const { post, calls } = setup({
      rpcs: { driver_apply: () => ({ status: "received", id: "x" }) },
    });
    const good = {
      action: "driver_apply",
      name: "Karim Haddad",
      phone: PHONE,
      place: "Baakline",
      vehicle: "motorbike",
      licence: true,
      languages: ["ar", "en"],
      availability: ["evenings"],
      note: "",
      consent: true,
      lang: "ar",
    };
    expect((await j(await post(good))).body).toEqual({ ok: true, status: "received" });
    expect(calls.find((c) => c.fn === "driver_apply")?.args).toMatchObject({
      p_vehicle: "motorbike",
      p_licence: true,
      p_note: null,
    });
    expect((await j(await post({ ...good, consent: false }))).body.error).toBe("consent_required");
    expect((await j(await post({ ...good, vehicle: "rocket" }))).status).toBe(400);
    expect((await j(await post({ ...good, languages: ["xx"] }))).status).toBe(400);
    expect((await j(await post({ ...good, phone: "71555123" }))).status).toBe(400);
  });

  it("an unexpected error is a bare 500 with no detail for the visitor", async () => {
    const { post, logs } = setup({
      rpcs: {
        vendor_claim_search: () => {
          throw new Error("boom +96170123456");
        },
      },
    });
    const r = await j(await post({ action: "search", q: "abu" }));
    expect(r).toEqual({ status: 500, body: { ok: false, error: "server" } });
    expect(logs).toContain("site-claim failed");
  });
});
