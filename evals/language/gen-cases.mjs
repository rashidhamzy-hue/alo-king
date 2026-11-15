// Build plan 1.22: the generated eval set for catalog language. Runs in GitHub Actions (language-pack.yml), never in the Worker.
//   ANTHROPIC_API_KEY=... node evals/language/gen-cases.mjs [--limit N]
// Truth is known by construction: each message is written for products this script chose, and a second model, given only the
// shelf and the message, must name the same products or the message is dropped. The generator never sees the language pack.
// Writes evals/language/cases.json.
import Anthropic from "@anthropic-ai/sdk";
import { startMeter, autoFinish } from "../../scripts/lib/model-cost.mjs";
import { writeFileSync } from "node:fs";
import { loadCatalog, byCategory, pool, chunks, line, root } from "./catalog.mjs";

const GEN_MODEL = process.env.GEN_MODEL ?? "claude-opus-5-5";
const CHECK_MODEL = process.env.CHECK_MODEL ?? "claude-sonnet-5-5";
const MULTI = Number(process.env.MULTI ?? 120);
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
// COST1: counted in model_costs and stopped at the run's dollar cap (MODEL_COST_CAP_USD); the meter wraps fetch, so it comes first.
autoFinish(await startMeter({ workflow: "language-pack", capDefault: 5, step: "cases" }));
const client = new Anthropic({ maxRetries: 6 });
const usage = { input: 0, output: 0, cache_read: 0 };

const RULES = `You write test messages for an automated WhatsApp grocery ordering service in the Chouf, Lebanon.
Write as real customers there write: Lebanese Arabic (dialect, never Modern Standard Arabic), Arabizi (Latin letters with 2 3 5 7 8 9 for Arabic sounds), English and French, often mixed in one sentence, with the brand said the way people say it (in Arabic script or Latin letters). Vary the openings (بدي، عطيني، ابعتلي، baddi، 3tine، please send، je veux), with or without a quantity, with or without a greeting, short or chatty. Misspellings that people really make are welcome; nonsense is not.
Never mention allergies, ingredients, health, diet suitability, halal, calories or nutrition. Never name a shop or restaurant.`;

async function ask(model, system, user, schema, effort = "high") {
  const stream = client.messages.stream({
    model, max_tokens: 32000, system, messages: [{ role: "user", content: user }],
    output_config: { effort, format: { type: "json_schema", schema } },
  });
  const res = await stream.finalMessage();
  usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens; usage.cache_read += res.usage.cache_read_input_tokens ?? 0;
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text); } catch { return null; }
}

const singleSchema = { type: "object", additionalProperties: false, required: ["cases"], properties: { cases: { type: "array", items: {
  type: "object", additionalProperties: false, required: ["sku", "lang", "text"],
  properties: { sku: { type: "string" }, lang: { type: "string", enum: ["ar_lb", "arabizi", "en", "fr", "mixed"] }, text: { type: "string" } } } } } };
const multiSchema = { type: "object", additionalProperties: false, required: ["text", "lang"],
  properties: { lang: { type: "string", enum: ["ar_lb", "arabizi", "en", "fr", "mixed"] }, text: { type: "string" } } };
const checkSchema = { type: "object", additionalProperties: false, required: ["skus"],
  properties: { skus: { type: "array", items: { type: "string" } } } };

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const catalog = loadCatalog().slice(0, limit);
const shelves = byCategory(catalog);
const shelfText = (cat) => (shelves.get(cat) ?? []).map(line).join("\n");

// 1. Single-item messages: three per product, written with the whole shelf in view so each one points at one product.
async function writeSingles(targets) {
  const jobs = [...byCategory(targets).entries()].flatMap(([cat, ps]) => chunks(ps, 12).map((t) => ({ cat, targets: t })));
  return (await pool(jobs, 4, async ({ cat, targets }) => {
    const out = await ask(GEN_MODEL, RULES,
      `The shelf "${cat}" holds exactly these products (one per line):\n${shelfText(cat)}\n\n` +
      `For each of these target products write three messages, each asking for that one product and nothing else:\n${targets.map((p) => p.sku).join(", ")}\n` +
      `Message 1 in Lebanese Arabic script, message 2 in Arabizi, message 3 in English, French or a mix with Arabic.\n` +
      `Each message must say enough (brand, size, flavour, type, as a customer would say it) that a shop assistant looking at this shelf would hand over exactly that product and no other on the shelf. ` +
      `If the product is the only one of its kind on the shelf, the plain word for it is enough. Do not copy the English label word for word; say it as people say it.`,
      singleSchema);
    const want = new Set(targets.map((p) => p.sku));
    return (out?.cases ?? []).filter((c) => want.has(c.sku)).map((c) => ({ ...c, cat }));
  })).flat();
}
const singles = await writeSingles(catalog);

// 2. Multi-item messages: random baskets of 2 to 4 products from anywhere in the catalog.
const rand = rng(1122);
const baskets = Array.from({ length: MULTI }, () => {
  const n = 2 + Math.floor(rand() * 3); const pick = new Set();
  while (pick.size < n) pick.add(catalog[Math.floor(rand() * catalog.length)]);
  return [...pick];
});
const multis = (await pool(baskets, 4, async (items) => {
  const cats = [...new Set(items.map((p) => p.category))];
  const out = await ask(GEN_MODEL, RULES,
    `Shelves involved:\n${cats.map((c) => `## ${c}\n${shelfText(c)}`).join("\n\n")}\n\n` +
    `Write one WhatsApp message ordering exactly these products, one of each unless you choose a quantity, and nothing else:\n${items.map(line).join("\n")}\n` +
    `Each product must be described so that a shop assistant looking at those shelves would hand over exactly it. Pick the language mix yourself.`,
    multiSchema);
  return out?.text ? { text: out.text, lang: out.lang, skus: items.map((p) => p.sku), cats } : null;
})).filter(Boolean);

// 3. Check: a second model, shown only the shelves and the message, names the products. Disagreement drops the case.
const verify = async (text, cats) => {
  const out = await ask(CHECK_MODEL,
    "You work at a grocery store in Lebanon and read customers' WhatsApp orders (Lebanese Arabic, Arabizi, English, French).",
    `Shelves:\n${cats.map((c) => `## ${c}\n${shelfText(c)}`).join("\n\n")}\n\nCustomer message:\n${text}\n\n` +
    `List the SKU of every product the customer is asking for. If a requested item could be more than one product on the shelves, or is not on them, put "UNCLEAR" for it.`,
    checkSchema, "medium");
  return out?.skus ?? null;
};
const cases = []; let dropped = 0; let id = 0;
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
await pool(singles, 6, async (c) => {
  const got = await verify(c.text, [c.cat]);
  if (got && sameSet(got, [c.sku])) cases.push({ kind: "single", lang: c.lang, text: c.text, items: [{ sku: c.sku }] });
  else dropped++;
});
// Products left with fewer than two checked messages get one more round.
const countSingles = () => { const m = new Map(); for (const c of cases) if (c.kind === "single") m.set(c.items[0].sku, (m.get(c.items[0].sku) ?? 0) + 1); return m; };
const retry = catalog.filter((p) => (countSingles().get(p.sku) ?? 0) < 2);
if (retry.length) {
  const more = await writeSingles(retry); singles.push(...more);
  await pool(more, 6, async (c) => {
    const got = await verify(c.text, [c.cat]);
    if (got && sameSet(got, [c.sku])) cases.push({ kind: "single", lang: c.lang, text: c.text, items: [{ sku: c.sku }] });
    else dropped++;
  });
}
await pool(multis, 6, async (m) => {
  const got = await verify(m.text, m.cats);
  if (got && sameSet(got, m.skus)) cases.push({ kind: "multi", lang: m.lang, text: m.text, items: m.skus.map((sku) => ({ sku })) });
  else dropped++;
});
cases.sort((a, b) => (a.kind + a.items[0].sku + a.text).localeCompare(b.kind + b.items[0].sku + b.text));
for (const c of cases) c.id = `g${String(++id).padStart(4, "0")}`;

const perSku = new Map(); for (const c of cases.filter((c) => c.kind === "single")) perSku.set(c.items[0].sku, (perSku.get(c.items[0].sku) ?? 0) + 1);
const thin = catalog.filter((p) => (perSku.get(p.sku) ?? 0) < 2).map((p) => p.sku);
writeFileSync(root + "evals/language/cases.json", JSON.stringify({
  generated_at: new Date().toISOString(), generator: GEN_MODEL, checker: CHECK_MODEL,
  written: singles.length + multis.length, dropped_by_check: dropped, products_with_fewer_than_two: thin, usage, cases }, null, 1) + "\n");
console.log(JSON.stringify({ singles: singles.length, multis: multis.length, kept: cases.length, dropped, thin: thin.length, usage }));
