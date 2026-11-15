// OPS1 item 2: the website Worker reports its errors to Sentry. No SDK: the Astro entry point is not ours to wrap, so one small file posts
// a Sentry envelope straight to the DSN's ingest address (the same format scripts/ci/sentry-ingest-check.sh posts). Nothing about the
// visitor leaves: no request, no cookies, no address; every string is scrubbed.
import { describe, expect, it, vi } from "vitest";
import { scrubString } from "../../../packages/core/src/scrub";
import { guarded, parseDsn, reportCheckIn, reportError, resetLimiter, scrubText } from "../src/lib/sentry";

const DSN = "https://abc123publickey@o1.ingest.example.io/4242";
const env = { SENTRY_DSN: DSN, ENVIRONMENT: "staging" };
const okFetch = () => vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
const parts = (call: unknown[]) => { const [url, init] = call as [string, RequestInit]; const lines = String(init.body).split("\n"); return { url, init, header: JSON.parse(lines[0]!), item: JSON.parse(lines[1]!), payload: JSON.parse(lines[2]!) }; };

describe("the website's scrubber is the shared one", () => {
  it("gives the same answer on every kind of thing that must not leave (this fails if either copy is changed alone)", () => {
    for (const t of ["failed for +961 71 234 567 today", "user LB.13491208655302741918", "Authorization: Bearer abcdefgh12345678", "key sk-ant-api03-abcdefghijkl", "order 4821 qty 3 total 12.50",
                     "sb_secret_abc123", ["token ey", "JhbGciOiJIUzI1NiJ9abcdefgh.ey", "Jyb2xlIjoid2ViIn0abcdefgh.abcdefghij12345"].join(""), "plain words"])
      expect(scrubText(t)).toBe(scrubString(t));
  });
});

describe("the DSN", () => {
  it("is read into key, host and project, and anything else is no DSN", () => {
    expect(parseDsn(DSN)).toEqual({ key: "abc123publickey", host: "o1.ingest.example.io", project: "4242" });
    for (const bad of [undefined, "", "not a url", "http://k@h/1", "https://h/1", "https://k@h/notanumber"]) expect(parseDsn(bad)).toBeNull();
  });
});

describe("reporting an error", () => {
  it("posts one event envelope to the project's ingest address, tagged with where it happened", async () => {
    resetLimiter();
    const f = okFetch();
    expect(await reportError(env, new Error("catalog read failed"), "page", f)).toBe(true);
    const p = parts(f.mock.calls[0]!);
    expect(p.url).toBe("https://o1.ingest.example.io/api/4242/envelope/");
    expect((p.init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=abc123publickey");
    expect(p.item).toEqual({ type: "event" });
    expect(p.payload).toMatchObject({ level: "error", environment: "staging", tags: { where: "page", service: "web" }, exception: { values: [{ type: "Error", value: "catalog read failed" }] } });
  });

  it("scrubs phone numbers, user ids, keys and tokens from the message, and sends no request, cookie or address", async () => {
    resetLimiter();
    const f = okFetch();
    await reportError(env, new Error("failed for +96171234567 user LB.13491208655302741918 key sk-ant-api03-abcdefghijkl Bearer abcdefgh12345678"), "page", f);
    const body = String((f.mock.calls[0]![1] as RequestInit).body);
    for (const leak of ["96171234567", "LB.1349", "sk-ant-api03", "abcdefgh12345678"]) expect(body).not.toContain(leak);
    expect(parts(f.mock.calls[0]!).payload.request).toBeUndefined();
    expect(parts(f.mock.calls[0]!).payload.user).toBeUndefined();
  });

  it("does nothing without a DSN, never throws when Sentry is down, and never sends more than twenty a minute", async () => {
    resetLimiter();
    const f = okFetch();
    expect(await reportError({ ENVIRONMENT: "staging" }, new Error("x"), "page", f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    const down = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => { throw new Error("network"); });
    expect(await reportError(env, new Error("x"), "page", down)).toBe(false);
    resetLimiter();
    const g = okFetch();
    for (let i = 0; i < 30; i++) await reportError(env, new Error(`e${i}`), "page", g);
    expect(g).toHaveBeenCalledTimes(20);
  });

  it("a non-Error value is reported by its text, not dropped", async () => {
    resetLimiter();
    const f = okFetch();
    await reportError(env, "something odd", "page", f);
    expect(parts(f.mock.calls[0]!).payload.exception.values[0].value).toBe("something odd");
  });
});

describe("the deploy's check-in", () => {
  it("is a cron check-in to its own monitor (never an error issue), and says whether Sentry took it", async () => {
    const f = okFetch();
    const r = await reportCheckIn(env, "deploy-smoke-web-staging", f);
    expect(r).toMatchObject({ ok: true });
    expect(r.id).toMatch(/^[0-9a-f]{32}$/);
    const p = parts(f.mock.calls[0]!);
    expect(p.item).toEqual({ type: "check_in" });
    expect(p.payload).toMatchObject({ monitor_slug: "deploy-smoke-web-staging", status: "ok", environment: "staging" });
    expect(p.payload.monitor_config.schedule).toEqual({ type: "interval", value: 1, unit: "year" });   // never reports a miss between deploys
    expect(await reportCheckIn(env, "x", vi.fn(async (_url: string, _init: RequestInit) => new Response("no", { status: 429 })))).toMatchObject({ ok: false });
    expect(await reportCheckIn({}, "x", okFetch())).toMatchObject({ ok: false });
  });
});

describe("guarded: the middleware's wrapper", () => {
  it("returns the response untouched, and reports a thrown error then throws it again (the page still fails as it did)", async () => {
    resetLimiter();
    const f = okFetch();
    const res = new Response("ok");
    expect(await guarded(env, "page", async () => res, f)).toBe(res);
    expect(f).not.toHaveBeenCalled();
    const boom = new Error("db down");
    await expect(guarded(env, "page", async () => { throw boom; }, f)).rejects.toBe(boom);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
