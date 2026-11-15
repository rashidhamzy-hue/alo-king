// Build plan 1.22: generate the catalog language pack with the Anthropic API. Runs in GitHub Actions (language-pack.yml).
//   ANTHROPIC_API_KEY=... node evals/language/gen-pack.mjs [--limit N]  then  node evals/language/build-pack.mjs
// For every product: what people call the kind of thing, the brand as people say it, and short phrases that fit this product
// and no other on the shelf, in Lebanese Arabic, Arabizi, English and French. The model only names products; it never states a
// food fact (invariant 15): build-pack.mjs drops any term about allergens, diet, halal or nutrition that is not printed in the name.
// The generator never sees the eval set. Writes evals/language/pack.json (raw, before the build drops anything).
import Anthropic from "@anthropic-ai/sdk";
import { startMeter, autoFinish } from "../../scripts/lib/model-cost.mjs";
import { writeFileSync } from "node:fs";
import { loadCatalog, byCategory, pool, chunks, line, root } from "./catalog.mjs";

const MODEL = process.env.GEN_MODEL ?? "claude-opus-5-5";
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
// COST1: counted in model_costs and stopped at the run's dollar cap (MODEL_COST_CAP_USD); the meter wraps fetch, so it comes first.
autoFinish(await startMeter({ workflow: "language-pack", capDefault: 5, step: "pack" }));
const client = new Anthropic({ maxRetries: 6 });
const usage = { input: 0, output: 0 };

const SYSTEM = `You build the search vocabulary of a WhatsApp grocery service in the Chouf, Lebanon. Customers write Lebanese Arabic (dialect, Arabic script), Arabizi (Latin letters, with 2 3 5 7 8 9 for Arabic sounds, many spellings), English and French, mixed freely. A search term is matched when all of its words appear in the customer's message (Arabic prefixes و ب ع ال are handled automatically), so terms must be short: one to four words.
You only name products. Never write anything about allergens, ingredients, health, diet suitability, halal, calories or nutrition, unless that word is printed in the product's own name.`;

const term = { type: "object", additionalProperties: false, required: ["t", "lang"],
  properties: { t: { type: "string" }, lang: { type: "string", enum: ["ar", "arabizi", "en", "fr"] } } };
const schema = { type: "object", additionalProperties: false, required: ["products"], properties: { products: { type: "array", items: {
  type: "object", additionalProperties: false, required: ["sku", "kind", "brand", "exact"],
  properties: { sku: { type: "string" }, kind: { type: "array", items: term }, brand: { type: "array", items: term }, exact: { type: "array", items: term } } } } } };
const fillerSchema = { type: "object", additionalProperties: false, required: ["words"], properties: { words: { type: "array", items: { type: "string" } } } };

async function ask(user, sch) {
  const stream = client.messages.stream({ model: MODEL, max_tokens: 64000, system: SYSTEM, messages: [{ role: "user", content: user }],
    output_config: { effort: "high", format: { type: "json_schema", schema: sch } } });
  const res = await stream.finalMessage();
  usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") { console.error("stopped:", res.stop_reason); return null; }
  try { return JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join("")); } catch { return null; }
}

const catalog = loadCatalog().slice(0, limit);
const shelves = byCategory(catalog);
const jobs = [...shelves.entries()].flatMap(([cat, ps]) => chunks(ps, 10).map((targets) => ({ cat, shelf: ps, targets })));

const products = (await pool(jobs, 4, async ({ cat, shelf, targets }) => {
  const prompt =
    `The shelf "${cat}" holds exactly these products (one per line):\n${shelf.map(line).join("\n")}\n\n` +
    `Write the search vocabulary for these products: ${targets.map((p) => p.sku).join(", ")}.\n` +
    `Words a person reviewed earlier for some of them (keep the good ones, fix or drop the rest):\n` +
    targets.map((p) => `${p.sku}: ${p.aliases.join(" / ") || "(none)"}`).join("\n") + "\n\n" +
    `For each product give three lists, each entry with its language (ar = Arabic script, arabizi, en, fr):\n` +
    `- kind: what people call this kind of product when they do not name a brand: the everyday word, with and without the article, singular and plural, common containers said with it ("ربطة خبز", "كرتونة مي"), several Arabizi spellings, English and French. A word belongs here only if, said alone, people in the Chouf would mean this kind of product (خبز alone means Arabic bread, so it is a kind word for Arabic bread, not for baguettes or toast; those take "خبز فرنجي", "toast"). Brand names used as generic words go here too (نسكافيه for instant coffee, كلينكس for tissues) when people use them that way.\n` +
    `- brand: the brand as people say and type it: Arabic script (with and without ال where people say it), Arabizi spellings, Latin. Empty for unbranded local produce and meat.\n` +
    `- exact: short phrases (one to four words) that fit this product and no other product on the shelf: the brand or kind with the size ("مي تنورين 500", "تنورين نص ليتر", "تنورين ٦ ليتر"), flavour, colour, fat level, count, pack, or a nickname; also a single word when no other product on the shelf could be meant by it with the kind or brand (e.g. "هال" for the only cardamom coffee). Every exact phrase must be impossible to read as a sibling.\n` +
    `Aim for 10 to 30 kind terms, 3 to 12 brand terms and 4 to 15 exact terms per product. Write only what Chouf customers would really type or say.`;
  const out = await ask(prompt, schema);
  const want = new Set(targets.map((p) => p.sku));
  const got = (out?.products ?? []).filter((p) => want.has(p.sku));
  if (got.length < targets.length) console.error(`${cat}: ${targets.length - got.length} products missing from the answer`);
  return got;
})).flat();

const filler = await ask(
  `List the words customers in the Chouf use in grocery orders that never describe which product they want: quantities and number words ` +
  `(تنين، تلاتة، نص، dual forms like علبتين، ربطتين، كيلوين), units and containers said with a quantity, politeness and greetings, verbs of asking ` +
  `(بدي، عطيني، ابعتلي، جيبلي), connectors and prepositions, delivery words. Lebanese Arabic script, Arabizi spellings, English and French. ` +
  `One word per entry, no phrases. Do not include any word that names a product, a brand, a size, a flavour or a kind of product. 150 to 300 words.`,
  fillerSchema);

writeFileSync(root + "evals/language/pack.json", JSON.stringify({
  generated_at: new Date().toISOString(), model: MODEL, usage, products, filler: filler?.words ?? [] }, null, 1) + "\n");
console.log(JSON.stringify({ products: products.length, of: catalog.length, filler: filler?.words?.length ?? 0, usage }));
