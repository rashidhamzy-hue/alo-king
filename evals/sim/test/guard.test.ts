// SIM1: evals/sim makes no write to staging and sends nothing.
//   - the guard lets only GET reach staging, and only during the copy; Kapso and every other host are never reached;
//   - the copy reads the listed catalogue tables with GET and never a table of people, chats, orders or money;
//   - a whole run (stand-in models, a fake staging served from the repository seeds) ends with staging seen only by GET during
//     the copy, every Kapso send recorded and none forwarded, and nothing refused.
import { afterEach, describe, expect, it } from "vitest";
import { installFetchGuard, type Guard } from "../guard";
import { COPY_TABLES, NEVER_COPY, readStaging, scrubSettings } from "../staging";
import { KAPSO_ORIGIN, MEDIA_ORIGIN } from "../driver";
import { openTestDb } from "../../../test/db/harness";
import { mockConcierge, mockCustomer, mockJudge } from "../mock";
import { runAll } from "../run";
import scenarios from "../scenarios.json";
import type { Scenario } from "../scenarios";

const STAGING = "https://staging.sim.invalid";
let guard: Guard | null = null;
afterEach(() => { guard?.restore(); guard = null; });

/** A fake upstream: answers staging GETs from `tables`, and records every request that got past the guard. */
function upstream(tables: Record<string, unknown[]> = {}) {
  const seen: { method: string; url: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push({ method: (init?.method ?? "GET").toUpperCase(), url });
    const u = new URL(url);
    const t = u.pathname.replace("/rest/v1/", "");
    const rows = tables[t];
    if (!rows) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    const off = Number(u.searchParams.get("offset") ?? 0), lim = Number(u.searchParams.get("limit") ?? 1000);
    return new Response(JSON.stringify(rows.slice(off, off + lim)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, seen };
}

describe("the fetch guard", () => {
  it("staging: GET during the copy only; any write refused; closed after the copy", async () => {
    const up = upstream({ products: [{ id: 1 }] });
    guard = installFetchGuard({ stagingOrigin: STAGING, kapsoOrigin: KAPSO_ORIGIN, mediaOrigin: MEDIA_ORIGIN, allowHosts: ["api.anthropic.com"], upstream: up.f });
    expect((await fetch(`${STAGING}/rest/v1/products?select=*`)).status).toBe(200);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      await expect(fetch(`${STAGING}/rest/v1/orders`, { method, body: "{}" })).rejects.toThrow(/SIM_GUARD_REFUSED/);
      await expect(fetch(`${STAGING}/rest/v1/rpc/transition_order`, { method, body: "{}" })).rejects.toThrow(/staging is read with GET only/);
    }
    guard.phase = "run";
    await expect(fetch(`${STAGING}/rest/v1/products?select=*`)).rejects.toThrow(/closed after the copy/);
    expect(up.seen).toEqual([{ method: "GET", url: `${STAGING}/rest/v1/products?select=*` }]);
  });

  it("Kapso: recorded and answered, never forwarded; the real Kapso host and any other host refused", async () => {
    const up = upstream();
    guard = installFetchGuard({ stagingOrigin: STAGING, kapsoOrigin: KAPSO_ORIGIN, mediaOrigin: MEDIA_ORIGIN, allowHosts: ["api.anthropic.com"], upstream: up.f });
    guard.phase = "run";
    const r = await fetch(`${KAPSO_ORIGIN}/v24.0/PN_CUSTOMER/messages`, { method: "POST", body: JSON.stringify({ to: "x", type: "text", text: { body: "hi" } }) });
    expect(((await r.json()) as { messages: { id: string }[] }).messages[0]!.id).toMatch(/^wamid\.SIM/);
    expect(guard.kapso).toHaveLength(1);
    expect(guard.kapso[0]!.body.text.body).toBe("hi");
    await expect(fetch("https://api.kapso.ai/meta/whatsapp/v24.0/1378974041965966/messages", { method: "POST", body: "{}" })).rejects.toThrow(/host not allowed/);
    await expect(fetch("https://example.com/")).rejects.toThrow(/host not allowed/);
    expect((await fetch(`${MEDIA_ORIGIN}/note.ogg`)).status).toBe(200);
    await fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" });
    expect(up.seen.map((s) => new URL(s.url).hostname)).toEqual(["api.anthropic.com"]);
  });
});

describe("the staging copy", () => {
  it("reads only the listed tables, with GET, and never a table of people, chats, orders or money", async () => {
    const up = upstream(Object.fromEntries(COPY_TABLES.map((t) => [t.table, [{ a: 1 }]])));
    guard = installFetchGuard({ stagingOrigin: STAGING, kapsoOrigin: KAPSO_ORIGIN, mediaOrigin: MEDIA_ORIGIN, allowHosts: [], upstream: up.f });
    const copy = await readStaging(STAGING, "service-key", fetch);
    expect(Object.keys(copy).sort()).toEqual(COPY_TABLES.map((t) => t.table).sort());
    expect(up.seen.every((s) => s.method === "GET")).toBe(true);
    const read = up.seen.map((s) => new URL(s.url).pathname.replace("/rest/v1/", ""));
    for (const t of NEVER_COPY) expect(read).not.toContain(t);
    expect(up.seen.find((s) => s.url.includes("product_facts"))!.url).toContain("approved_at=not.is.null");
  });

  it("replaces a phone-like value in the settings with an invented one", () => {
    const s = scrubSettings([{ key: "payment_accounts", value: { whish: "+961 70 123 456", omt: "03123456", note: "pay 5" } }, { key: "min_order_usd", value: 5 }]);
    expect(s.replaced).toBe(2);
    expect(JSON.stringify(s.rows)).not.toMatch(/70 123 456|03123456/);
  });
});

describe("a whole run sends nothing and writes nothing to staging", () => {
  it("stand-in models, a fake staging made from the repository seeds: GET only, during the copy; Kapso recorded only", async () => {
    // What a staging read would return: every copied table of a database built from the seeds, as JSON (PostgREST's shape).
    const seed = await openTestDb();
    await seed.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500); update stock_levels set on_hand = 500;
      update sources set village_id = (select id from villages where name_en = 'Baakline') where kind = 'dark_store';`);
    const tables: Record<string, unknown[]> = {};
    for (const t of COPY_TABLES) tables[t.table] = JSON.parse(JSON.stringify(await seed.all(`select * from ${t.table}${t.filter ? " where approved_at is not null and superseded_at is null" : ""}`)));
    await seed.pg.close();
    const up = upstream(tables);
    guard = installFetchGuard({ stagingOrigin: STAGING, kapsoOrigin: KAPSO_ORIGIN, mediaOrigin: MEDIA_ORIGIN, allowHosts: [], upstream: up.f });
    const copy = await readStaging(STAGING, "service-key", fetch);
    const pick = (scenarios as Scenario[]);
    const chosen = ["plain_order", "night", "person", "off_topic"].map((c) => pick.find((s) => s.category === c)!);
    const s = await runAll({ scenarios: chosen, copy, guard, outDir: null, log: () => {},
      raw: { concierge: mockConcierge(), customer: mockCustomer(() => "Potato, Tomato - deliver to Baakline"), judge: mockJudge() },
      models: { concierge: "claude-haiku-5-5", customer: "claude-sonnet-5-5", judge: "claude-sonnet-5-5" },
      soft: 27, hard: 33, concurrency: 2, calibrate: 2, reruns: 0, maxMinutes: 10 });
    expect(s.source).toBe("staging");
    expect(s.results).toHaveLength(4);
    expect(s.results.filter((r) => r.status === "error")).toEqual([]);
    expect(guard.staging.length).toBeGreaterThan(0);
    expect(guard.staging.every((r) => r.method === "GET")).toBe(true);
    expect(up.seen.every((r) => r.method === "GET" && new URL(r.url).origin === STAGING)).toBe(true);     // nothing else got past the guard
    expect(up.seen.length).toBe(guard.staging.length);                                           // and staging only while copying
    expect(guard.refused).toEqual([]);
    expect(guard.kapso.length).toBeGreaterThan(0);                                               // what would have gone out, recorded
    expect(s.spent).toBeGreaterThan(0);
  }, 180_000);
});
