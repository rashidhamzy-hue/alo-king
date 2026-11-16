// SR1: the new search scored on the request set, free (PGlite, no model): the customer's words through the reading step
// (search-reading.ts) into find_products (0214), with the seeded test facts. The hard gate: no returned item fails a fact filter.
// The share with a right item in the first five is written with SR1_WRITE=1 to evals/search/results/word.json (words alone; the meaning
// list needs the live embeddings, evals/search/embed.live.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../../../test/db/harness";
import { seedSearchFacts } from "../../../test/db/search-kit";
import { readSearch } from "../../../packages/agents/src/search-reading";
import { MEANING, REQUESTS, scoreRequest, summarise, table, type Scored } from "../score";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
let db: TestDb; let skuOf: Map<string, string>;
beforeAll(async () => { db = await openTestDb(); ({ skuOf } = await seedSearchFacts(db)); }, 300_000);
afterAll(async () => { await db?.pg.close(); });

describe("SR1: find_products on the request set (words alone)", () => {
  it("returns no item that fails a fact filter, and finds a right item in the first five", async () => {
    const out: (Scored & { query: string; filters: unknown; reason: string | null })[] = [];
    for (const r of [...REQUESTS, ...MEANING]) {
      const reading = readSearch(r.text);
      const m = await db.rpc<{ matches: { product_id: string }[]; reason: string | null }>("find_products",
        { p_query: reading.query, p_filters: reading.filters, p_limit: 8 });
      out.push({ ...scoreRequest(r, m.matches.map((x) => skuOf.get(x.product_id) ?? "?")), query: reading.query, filters: reading.filters, reason: m.reason });
    }
    const s = summarise(out.filter((x) => x.kind !== "meaning"));
    const sm = summarise(out.filter((x) => x.kind === "meaning"));
    console.log(table("The meaning subset (m001-m024), not in the gate", sm));
    console.log(table("find_products, words alone, on the reading of the customer's words", s));
    for (const x of out.filter((y) => !y.right || y.factFails.length)) console.log(x.id, JSON.stringify(x.query), JSON.stringify(x.filters), x.reason, x.returned.slice(0, 5).join(" "), JSON.stringify(x.factFails));
    if (env.SR1_WRITE === "1") {
      const dir = fileURLToPath(new URL("../results/", import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(dir + "word.json", JSON.stringify({ at: new Date().toISOString(), summary: s, meaning: sm, results: out }, null, 1) + "\n");
    }
    expect(s.fact_fails).toBe(0);                       // the hard gate
    expect(s.share).toBeGreaterThanOrEqual(0.85);
  }, 300_000);
});
