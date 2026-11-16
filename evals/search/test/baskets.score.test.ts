// SR1 (6): the basket requests (evals/search/baskets.json): the reading step finds the basket, build_basket (0215) builds it by code
// from PD1's dishes, portions and unit prices, and quote_order prices it (invariant 7). Free: PGlite, no model.
// Before SR1 nothing built a basket from words: 0 of 52.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openTestDb, type TestDb } from "../../../test/db/harness";
import { seedSearchFacts } from "../../../test/db/search-kit";
import { readSearch } from "../../../packages/agents/src/search-reading";
import { BASKETS, passes } from "../score";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
let db: TestDb; let skuOf: Map<string, string>;
beforeAll(async () => { db = await openTestDb(); ({ skuOf } = await seedSearchFacts(db, { stock: 50 })); }, 300_000);
afterAll(async () => { await db?.pg.close(); });

describe("SR1: baskets built by code and priced by quote_order", () => {
  it("builds every basket request as asked", async () => {
    const out: { id: string; lang: string; ok: boolean; why: string[]; lines: string[]; subtotal: number | null }[] = [];
    for (const b of BASKETS) {
      const why: string[] = [];
      const r = readSearch(b.text);
      if (r.basket?.type !== b.basket.type) why.push(`read as ${r.basket?.type ?? "no basket"}`);
      const ask = r.basket ?? b.basket;
      const built = await db.rpc<any>("build_basket", { p_text: b.text, p_ask: ask, p_filters: r.filters });
      if (b.expect.refused) { if (built.refused !== b.expect.refused) why.push(`not refused (${built.refused})`); out.push({ id: b.id, lang: b.lang, ok: !why.length, why, lines: [], subtotal: null }); continue; }
      const lines: any[] = built.lines ?? [];
      const skus = lines.map((l) => skuOf.get(l.product_id) ?? "?");
      if (b.basket.dish && built.dish !== b.basket.dish) why.push(`dish ${built.dish}`);
      if (b.basket.people && built.people !== b.basket.people) why.push(`people ${built.people}`);
      for (const k of b.expect.kinds ?? []) if (!lines.some((l) => l.kind === k && Number(l.qty) > 0)) why.push(`no ${k}`);
      for (const k of b.expect.missing_kinds ?? []) if (!(built.missing ?? []).some((m: any) => m.kind === k)) why.push(`${k} not said as missing`);
      const units = lines.reduce((a, l) => a + Number(l.qty), 0);
      if (b.expect.min_items && units < b.expect.min_items) why.push(`${units} units`);
      for (const [i, l] of lines.entries()) {
        const p = passes(skus[i]!, b.filters);
        if (!p.ok) why.push(`${skus[i]} fails ${p.why}`);
        if (b.expect.tag && !(await db.one(`select 1 as x from product_tags where product_id = $1 and tag_code = $2`, [l.product_id, b.expect.tag]))) why.push(`${skus[i]} not ${b.expect.tag}`);
      }
      let subtotal: number | null = null;
      if (lines.length) {
        const q = await db.rpc<any>("quote_order", { p_lines: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty) })), p_village: null, p_pickup: true });
        subtotal = Number(q.subtotal_usd ?? q.items_usd ?? NaN);
        if (!q.lines?.every((l: any) => l.ok)) why.push("quote not ok");
        if (b.expect.max_usd !== undefined && !(subtotal <= b.expect.max_usd)) why.push(`subtotal ${subtotal} over ${b.expect.max_usd}`);
      } else if ((b.expect.kinds ?? []).length || b.expect.min_items) why.push("empty");
      out.push({ id: b.id, lang: b.lang, ok: !why.length, why, lines: skus.map((s, i) => `${s}x${lines[i].qty}`), subtotal });
    }
    const right = out.filter((x) => x.ok).length;
    console.log(`baskets right: ${right} of ${out.length}`);
    for (const x of out.filter((y) => !y.ok)) console.log(x.id, x.why.join("; "), x.lines.join(" "));
    if (env.SR1_WRITE === "1") {
      const dir = fileURLToPath(new URL("../results/", import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(dir + "baskets.json", JSON.stringify({ at: new Date().toISOString(), right, n: out.length, results: out }, null, 1) + "\n");
    }
    expect(out.filter((x) => x.why.some((w) => w.includes(" fails "))).length).toBe(0);   // nothing crosses a stated filter
    expect(right / out.length).toBeGreaterThanOrEqual(0.85);
  }, 300_000);
});
