// SR1, step 1: today's search (search_catalog, 0053) scored on the request set before any search code changes. The customer's words go
// to it as said (the ask loop's tool takes a phrase; the reading's own phrase is scored live, evals/search/live.search.test.ts).
// Writes evals/search/results/baseline.json with SR1_WRITE=1. Free: PGlite, no model.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../../../test/db/harness";
import { seedSearchFacts } from "../../../test/db/search-kit";
import { REQUESTS, scoreRequest, summarise, table, type Scored } from "../score";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
let db: TestDb; let skuOf: Map<string, string>;
beforeAll(async () => { db = await openTestDb(); ({ skuOf } = await seedSearchFacts(db)); }, 300_000);
afterAll(async () => { await db?.pg.close(); });

describe("SR1 baseline: search_catalog on the request set", () => {
  it("is scored and written down", async () => {
    const out: Scored[] = [];
    for (const r of REQUESTS) {
      const m = await db.rpc<{ matches: { product_id: string }[] }>("search_catalog", { p_query: r.text, p_source_hint: null, p_limit: 6 });
      out.push(scoreRequest(r, (m.matches ?? []).map((x) => skuOf.get(x.product_id) ?? "?")));
    }
    const s = summarise(out);
    console.log(table("Baseline: search_catalog on the customer's words", s));
    if (env.SR1_WRITE === "1") {
      const dir = fileURLToPath(new URL("../results/", import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(dir + "baseline.json", JSON.stringify({ at: new Date().toISOString(), summary: s, results: out }, null, 1) + "\n");
    }
    expect(s.n).toBe(REQUESTS.length);
  }, 300_000);
});
