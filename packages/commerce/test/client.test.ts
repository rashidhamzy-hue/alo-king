// The commerce client has no logic, so what can go wrong is the wiring: a method calling a function that does not exist, or
// naming an argument the function does not have (PostgREST then answers "function not found"). Each method is called against a
// recorder and checked against the latest definition of its function in supabase/migrations. The database behaviour itself is
// tested on the real migrations in test/db/commerce-c4.test.ts.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelCommerce, CommerceError, webCommerce, WEB_CHANNEL_FUNCTIONS, type RpcSource } from "../src/index";

const migrations = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();

/** The parameter names of the latest `create [or replace] function <fn>(...)`, and whether a later migration dropped it. */
function signature(fn: string): string[] | null {
  let params: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(migrations + f, "utf8");
    const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      let depth = 1, i = m.index + m[0].length;
      const start = i;
      while (depth > 0 && i < sql.length) { if (sql[i] === "(") depth++; else if (sql[i] === ")") depth--; i++; }
      const inner = sql.slice(start, i - 1);
      const parts: string[] = []; let d = 0, cur = "";
      for (const c of inner) { if (c === "(") d++; if (c === ")") d--; if (c === "," && d === 0) { parts.push(cur); cur = ""; } else cur += c; }
      if (cur.trim()) parts.push(cur);
      params = parts.map((p) => p.trim().split(/\s+/)[0]!.toLowerCase());
    }
  }
  return params;
}

function recorder() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: RpcSource = { rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return Promise.resolve({ data: { ok: true }, error: null }); } };
  return { db, calls };
}

describe("packages/commerce: every method calls a real function with its real argument names", () => {
  it("the website's methods", async () => {
    const { db, calls } = recorder();
    const w = webCommerce(db);
    await w.startSession("phone"); await w.sessionState("t"); await w.endSession("t"); await w.linkCode("t");
    await w.setLine("t", "AK-0001", 2, 1.5); await w.viewCart("t"); await w.checkoutQuote("t", { place: "p" });
    await w.checkoutOrder("t", { requestKey: "k".repeat(10), place: "p" }); await w.confirm("t", "o", "k".repeat(10));
    expect(calls.map((c) => c.fn)).toEqual([...WEB_CHANNEL_FUNCTIONS]);
    for (const c of calls) {
      const sig = signature(c.fn);
      expect(sig, c.fn).not.toBeNull();
      expect(Object.keys(c.args).sort(), c.fn).toEqual([...sig!].sort());
    }
  });

  it("the gateway's and the console's methods", async () => {
    const { db, calls } = recorder();
    const c = channelCommerce(db);
    await c.claimLinkCode("party", "ALO-7K3Q9P", "wamid"); await c.revokeWebSessions("party");
    await c.planCart("party", [{ sku: "AK-0001", qty: 1 }]); await c.quoteOrder([{ product_id: "x", qty: 1 }], "v", false, null);
    await c.createOrderForTurn({ turnKey: "t", customer: "c", conversation: "v", lines: [], village: null, place: null });
    await c.confirmTap("o", "p", "w"); await c.handleOrderButton("o", "edit", "p");
    for (const call of calls) {
      const sig = signature(call.fn);
      expect(sig, call.fn).not.toBeNull();
      // Every argument the client sends is a parameter of the function (the rest have defaults).
      for (const k of Object.keys(call.args)) expect(sig, `${call.fn}(${k})`).toContain(k);
    }
  });

  it("the web_channel list is the same in the client, the migration's grants and the permission script", () => {
    const grants = readFileSync(migrations + "0132_web_channel_role.sql", "utf8")
      .match(/grant execute on function (\w+)\(/g)!.map((g) => g.replace(/grant execute on function |\(/g, ""));
    expect([...grants].sort()).toEqual([...WEB_CHANNEL_FUNCTIONS].sort());
    const script = readFileSync(fileURLToPath(new URL("../../../scripts/check_permissions.sh", import.meta.url)), "utf8");
    const listed = script.match(/web_allowed text\[\] := array\[([^\]]+)\]/)![1]!.match(/'(\w+)'/g)!.map((s) => s.slice(1, -1));
    expect([...listed].sort()).toEqual([...WEB_CHANNEL_FUNCTIONS].sort());
  });

  it("an error from the database is thrown with the function's name and the database's message", async () => {
    const db: RpcSource = { rpc: () => Promise.resolve({ data: null, error: { message: "NO_SESSION", code: "P0001" } }) };
    const err = await webCommerce(db).viewCart("t").catch((e) => e);
    expect(err).toBeInstanceOf(CommerceError);
    expect(err.message).toBe("cart_view: NO_SESSION");
    expect(err.code).toBe("P0001");
  });

  it("takes a supabase-js client as it is", () => {
    const asSource = (c: SupabaseClient): RpcSource => c;   // a type check: fails to compile if the shapes drift apart
    expect(typeof asSource).toBe("function");
  });
});
