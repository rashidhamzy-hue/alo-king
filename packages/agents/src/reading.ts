// Session B1b: what code corrects in the model's reading before the planner sees it (B1a's reading leftovers in docs/HANDOFF.md).
// Applied inside extractOrder, so the turn, the live evals and the language gate all read the same corrected reading.
//  - «البناية البيضا» / "el binaye bayda" / "the white building": the colour of a building is the address, never eggs (sim-113,
//    sim-117, sim-066, sim-006). A line made only of those words leaves the order and the phrase becomes the building.
//  - add versus set: «ya3ni 7», "so total 7", «مش ١ بس», «3 kman» say which one (sim-066, sim-140, sim-110, sim-040; B1a's second
//    run: «٣ بيبسي ... مش ١ بس» gave 4).
//  - a line that is only a size or a container («l 2annine l z8ire», "the small bottle") belongs to the line before it (M1's gate
//    run, g0752: it matched 7Up 330 ml on its own).
//  - "32 pieces": a count of pieces that is the pack's own size is one pack (sim-147: 32 packs of 32 diapers). Checked against the
//    product the planner chose (packSizeQty), so code never guesses it from the words alone.
// Cases: evals/cases/reading_tidy.json. Pure: no database, no model.
import type { OrderIntent } from "./schemas";

type Line = OrderIntent["lines"][number] & { change?: "add" | "set" | "remove" | null };

const DIGITS = (t: string) => t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
const fold = (t: string) => DIGITS(t).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْـ]/g, "")
  .replace(/[^\p{L}\p{N}.' ]+/gu, " ").replace(/\s+/g, " ").trim();
const NUMBER_WORDS: Record<string, number> = {
  "wa7ad": 1, "wa7de": 1, "wahad": 1, "one": 1, "un": 1, "une": 1, "واحد": 1, "وحده": 1, "tnein": 2, "tnen": 2, "tenyin": 2, "two": 2, "deux": 2,
  "تنين": 2, "اتنين": 2, "tlete": 3, "tleteh": 3, "three": 3, "trois": 3, "تلاته": 3, "tlate": 3, "arba3a": 4, "four": 4, "quatre": 4, "اربعه": 4,
  "khamse": 5, "five": 5, "cinq": 5, "خمسه": 5, "sette": 6, "six": 6, "سته": 6, "sab3a": 7, "seven": 7, "sept": 7, "سبعه": 7,
};
const num = (w: string | undefined): number | null => (w == null ? null : /^\d+(?:\.\d+)?$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? null);

// ---------- the colour of a building ----------
const BUILDING = "binaye|bineye|binaya|binayeh|bnaye|binen|binyen|building|immeuble|batiment|bet|beit|bayt|house|maison|بنايه|البنايه|بنايتنا|بيت|البيت|عماره|العماره|مبنى|المبنى";
const WHITE = "bayda|bayde|beida|beyda|baida|bida|abyad|l abyad|el abyad|white|blanc|blanche|بيضا|البيضا|بيضاء|البيضاء|الابيض|ابيض|بيضه";
const COLOUR_PHRASE = new RegExp(`(?:^| )(?:و|ف)?((?:(?:the|l|el|al|ال) )?(?:${BUILDING})(?: (?:l|el|al))? (?:${WHITE})|(?:the )?white (?:building|house)|(?:l|el|al)? ?(?:${WHITE}) (?:building|binaye|bineye))(?= |$)`, "u");
const EGG_OR_WHITE = new RegExp(`^(?:(?:el|l|al|the|a|كرتونه|carton) )?(?:${WHITE}|bayd|bayed|بيض|البيض|eggs?|white eggs?|bayd abyad|بيض ابيض)(?: (?:${WHITE}))?$`, "u");

function buildingColour(intent: OrderIntent, said: string): OrderIntent {
  const t = fold(said);
  const m = COLOUR_PHRASE.exec(t);
  if (!m) return intent;
  const phrase = m[1]!.trim();
  const rest = ` ${t.replace(phrase, " ")} `;
  const lines = intent.lines.filter((l) => {
    const raw = fold(l.raw), q = fold(l.query);
    const colourOnly = EGG_OR_WHITE.test(raw) || EGG_OR_WHITE.test(q) || phrase.includes(raw);
    // A line the customer also said outside the phrase («بدي كرتونة بيض، والبناية البيضا») is a real item.
    return !(colourOnly && !rest.includes(` ${raw} `) && !rest.includes(` ${q} `));
  });
  if (lines.length === intent.lines.length && intent.address.building) return intent;
  // The building in the customer's own words (the original letters, not the folded ones), for the rider.
  const original = phraseIn(said, phrase) ?? phrase;
  return { ...intent, lines, address: { ...intent.address, building: intent.address.building ?? original } };
}
/** The customer's own spelling of a folded phrase: the shortest run of their words that folds to it. */
function phraseIn(said: string, phrase: string): string | null {
  const words = said.split(/[\s,،.]+/u).filter(Boolean);
  for (let n = 1; n <= 5; n++) for (let i = 0; i + n <= words.length; i++) {
    const w = words.slice(i, i + n).join(" ");
    if (fold(w).replace(/^[وف](?=ال)/u, "") === phrase) return w.replace(/^[وف](?=ال)/u, "");
  }
  return null;
}

// ---------- add versus set ----------
const TOTAL_AFTER = /(?:^| )(?:ya3ni|ya3ne|yaani|ya3n|يعني|so|donc|that'?s|that makes|ca fait|ça fait|soit|total|totale?|au total|en tout|بالمجموع|المجموع|المجموعه|kello|kellon|كلن|كلهن)(?: (?:total|totale|كلن|كلهن|of|de))? (\d+(?:\.\d+)?|[\p{L}]+)/u;
const TOTAL_BEFORE = /(\d+(?:\.\d+)?) (?:total|in total|en tout|au total|بالمجموع|kello|كلن|كلهن)(?: |$)/u;
const NOT_JUST = /(?:^| )(?:مش|مو|mesh|mish|msh|mush|not|pas)(?: (?:just|only|seulement))? (\d+(?:\.\d+)?|[\p{L}\p{N}]+)(?: (?:بس|bas|bass|only))?(?: |$)/u;
const MORE = /(?:^| )(?:كمان|زياده|زيدلي|زيد|kman|kaman|kamen|kamein|zyede|ziyade|zid|zidli|zidlo|zidle|more|another|extra|encore|de plus|en plus)(?: |$)/u;

function addOrSet(intent: OrderIntent, said: string): OrderIntent {
  const t = fold(said);
  // Only an edit to what is in hand: a message that names one item, with a quantity.
  if (intent.lines.length !== 1 || intent.intent === "cancel") return intent;
  const l = intent.lines[0] as Line;
  if (l.change === "remove") return intent;
  const total = num(TOTAL_AFTER.exec(t)?.[1]) ?? num(TOTAL_BEFORE.exec(t)?.[1]);
  if (total != null && total > 0) return { ...intent, lines: [{ ...l, qty: total, change: "set" }] };
  const notJust = num(NOT_JUST.exec(t)?.[1]);
  if (notJust != null && notJust !== l.qty && l.qty > 0) return { ...intent, lines: [{ ...l, change: "set" }] };
  if (MORE.test(t) && (l.change === "set" || l.change == null) && intent.intent !== "order") return { ...intent, lines: [{ ...l, change: "add" }] };
  if (MORE.test(t) && l.change === "set") return { ...intent, lines: [{ ...l, change: "add" }] };
  return intent;
}

// ---------- a line that is only a size ----------
const ARTICLE = "l|el|al|il|the|a|le|la|les|ال";
const CONTAINER = "2annine|2anine|annine|2nine|قنينه|القنينه|قناني|bottle|bottles|bouteille|petite bouteille|3elbe|3lbe|علبه|العلبه|kis|كيس|الكيس|pack|باكيت|can|tanke|size|taille|حجم|الحجم";
const SIZE = "z8ire|zghire|zgheer|zghir|sghire|sghir|صغيره|الصغيره|صغير|الصغير|small|smaller|petite|petit|kbire|kbir|kbar|كبيره|الكبيره|كبير|الكبير|large|big|bigger|grande|grand|wasat|wasta|وسط|الوسط|medium|moyenne|moyen";
const SIZE_ONLY = new RegExp(`^(?:(?:${ARTICLE}) )?(?:(?:${CONTAINER}) (?:(?:${ARTICLE}) )?(?:${SIZE})|(?:${SIZE}) (?:(?:${ARTICLE}) )?(?:${CONTAINER})|(?:${SIZE}))(?: \\d+(?:\\.\\d+)? ?(?:l|ml|cl|g|kg|ليتر|لتر)?)?$`, "u");

function sizeOnlyLines(intent: OrderIntent): OrderIntent {
  if (intent.lines.length < 2) return intent;
  const out: Line[] = [];
  for (const l of intent.lines as Line[]) {
    const q = fold(l.query), raw = fold(l.raw);
    const prev = out[out.length - 1];
    if (prev && (SIZE_ONLY.test(q) || SIZE_ONLY.test(raw)) && !l.brand_hint) {
      // The customer's own words when they say more (the size «0.85» the query left out), else the query.
      const words = SIZE_ONLY.test(raw) && raw.length >= q.length ? l.raw.trim() : l.query.trim();
      // Into the customer's words for that line, never its search words: «2annine z8ire» searched alone finds a small bottle of
      // anything (7Up 330 ml in g0752). The planner reads the raw words for the size.
      out[out.length - 1] = { ...prev, raw: `${prev.raw} ${words}`.trim() };
      continue;
    }
    out.push(l);
  }
  return out.length === intent.lines.length ? intent : { ...intent, lines: out };
}

/** The reading after code's corrections. `said`: the customer's own words of the turn (texts and transcripts). */
export function tidyReading(intent: OrderIntent, said: string): OrderIntent {
  if (!said.trim()) return intent;
  return addOrSet(sizeOnlyLines(buildingColour(intent, said)), said);
}

// ---------- pieces that are the pack's size ----------
const PIECES = "حبه|حبات|حبة|قطعه|قطع|pieces|piece|pcs|pc|pièces|morceaux|wa2it|7abbe|7abbet";
/**
 * "32 pieces" said of a product sold as a pack of 32 is one pack (sim-147: «حفاضات وي وي مقاس 6، 32 حبة» became 32 packs). True when
 * the line's count is said in pieces and the chosen product's own name carries the same count of pieces.
 */
export function packSizeQty(line: { raw: string; qty: number }, productNames: (string | null | undefined)[]): boolean {
  const n = line.qty;
  if (!(n > 1)) return false;
  const said = new RegExp(`(?:^|[^\\d.])${n} ?(?:${PIECES})(?:$|[^\\p{L}])`, "u").test(fold(line.raw));
  if (!said) return false;
  const pack = new RegExp(`(?:^|[^\\d.])${n} ?(?:${PIECES}|sheets|wipes|count|ct|x)(?:$|[^\\p{L}])`, "iu");
  return productNames.some((p) => !!p && pack.test(fold(p)));
}
