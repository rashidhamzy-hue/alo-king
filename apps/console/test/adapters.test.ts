// The production adapters (Supabase Auth, Storage, PostgREST's function list) against a recorded fetch: the URL, the headers,
// and what each answer means. The live smoke test in .github/workflows/console.yml proves them against the real project.
import { describe, expect, it } from "vitest";
import { goTrue } from "../src/auth";
import { supabaseMedia } from "../src/media";
import { supabaseDb } from "../src/db";

const URL0 = "https://proj.supabase.test";
function recorder(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (u: string | URL | Request, init: RequestInit = {}) => { calls.push({ url: String(u), init }); return answer(String(u), init); }) as typeof fetch;
  return { calls, f };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("Supabase Auth adapter", () => {
  it("signs in with the password grant and reads the party from app_metadata; a refused pair is null, an outage throws", async () => {
    const ok = recorder(() => json({ user: { id: "u1", email: "a@b.c", app_metadata: { party_id: "p1" } } }));
    expect(await goTrue({ url: URL0, key: "svc", fetchImpl: ok.f }).signIn("a@b.c", "pw")).toEqual({ id: "u1", email: "a@b.c", partyId: "p1" });
    expect(ok.calls[0]!.url).toBe(`${URL0}/auth/v1/token?grant_type=password`);
    expect((ok.calls[0]!.init.headers as Record<string, string>).apikey).toBe("svc");
    expect(JSON.parse(String(ok.calls[0]!.init.body))).toEqual({ email: "a@b.c", password: "pw" });
    expect(await goTrue({ url: URL0, key: "svc", fetchImpl: recorder(() => json({ error: "invalid_grant" }, 400)).f }).signIn("a@b.c", "x")).toBeNull();
    await expect(goTrue({ url: URL0, key: "svc", fetchImpl: recorder(() => json({}, 503)).f }).signIn("a@b.c", "x")).rejects.toThrow(/auth_503/);
  });

  it("reads the user behind a link's token with that token, and sets a password through the admin API", async () => {
    const r = recorder((u) => (u.endsWith("/user") ? json({ id: "u1", app_metadata: {} }) : json({})));
    const a = goTrue({ url: URL0, key: "svc", fetchImpl: r.f });
    expect(await a.userFromToken("tok")).toEqual({ id: "u1", email: null, partyId: null });
    expect((r.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    await a.setPassword("u1", "a long password");
    expect(r.calls[1]).toMatchObject({ url: `${URL0}/auth/v1/admin/users/u1`, init: { method: "PUT" } });
  });
});

describe("Storage adapter", () => {
  it("signs a path into a full link, refuses odd paths, and writes without overwriting", async () => {
    const r = recorder((u) => (u.includes("/sign/") ? json({ signedURL: "/object/sign/media/a/b.jpg?token=T" }) : json({ Key: "x" })));
    const m = supabaseMedia({ url: URL0, key: "svc", fetchImpl: r.f });
    expect(await m.sign("a/b.jpg", 5)).toBe(`${URL0}/storage/v1/object/sign/media/a/b.jpg?token=T`);
    expect(JSON.parse(String(r.calls[0]!.init.body))).toEqual({ expiresIn: 30 });     // never shorter than 30 s
    expect(await m.sign("../secret", 60)).toBeNull();
    expect(await m.sign("https://evil.test/x", 60)).toBeNull();
    await m.put("console_audit/2026-11-13/x.json", "{}", "application/json");
    expect((r.calls.at(-1)!.init.headers as Record<string, string>)["x-upsert"]).toBe("false");
    await expect(supabaseMedia({ url: URL0, key: "svc", fetchImpl: recorder(() => json({}, 409)).f }).put("a.json", "{}", "application/json")).rejects.toThrow(/storage_409/);
  });
});

describe("function list", () => {
  it("knows a function from PostgREST's description, and says yes when the description cannot be read", async () => {
    const r = recorder(() => json({ paths: { "/rpc/set_fx_rate": {}, "/orders": {} } }));
    const db = supabaseDb({} as never, { url: URL0, key: "svc", fetchImpl: r.f });
    expect(await db.hasFunction("set_fx_rate")).toBe(true);
    expect(await db.hasFunction("release_handoff")).toBe(false);
    expect(r.calls).toHaveLength(1);                                                 // cached
    const down = supabaseDb({} as never, { url: URL0, key: "svc", fetchImpl: recorder(() => json({}, 500)).f });
    expect(await down.hasFunction("anything")).toBe(true);
  });
});
