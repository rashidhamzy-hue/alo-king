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
  // B1c: counts of pieces in a pack's name (sim-003: "thirty pieces", "twelve pieces"), and the words for three said as «تلات»
  "tlet": 3, "تلات": 3, "ten": 10, "dix": 10, "عشره": 10, "twelve": 12, "douze": 12, "طنعش": 12, "اتنعش": 12, "twenty": 20, "vingt": 20,
  "عشرين": 20, "thirty": 30, "trente": 30, "تلاتين": 30, "forty": 40, "quarante": 40, "اربعين": 40, "fifty": 50, "خمسين": 50,
  // B1d (sim-015: «2 pocket wipes arba3in» is the 40-piece pack): the tens in Arabizi
  "3ashra": 10, "3ashara": 10, "3eshrin": 20, "3ishrin": 20, "3ichrin": 20, "tletin": 30, "tlatin": 30, "tleteen": 30, "arba3in": 40, "arb3in": 40,
  "arba3een": 40, "khamsin": 50, "khamseen": 50,
};
const num = (w: string | undefined): number | null => (w == null ? null : /^\d+(?:\.\d+)?$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? null);
/** A number written with a clitic («لتلاته», "to three" in one word; «بتلاته»): the number, else null. */
const numWord = (w: string | undefined): number | null => num(w) ?? (w && /^[لب]./u.test(w) ? num(w.slice(1)) : null);

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

// B1c: "change it to 3", «غيّر الكمية لتلاتة», «خليهن ٣», "make it 3", "mets-en 3": the count becomes that (sim-121 made 4 of 1 + 3).
const SET_VERB = /^(?:غير|غيرلي|غيرها|غيرهن|عدل|عدللي|خلي|خليها|خليهن|خليه|خليلي|صير|صيرها|خليا|change|changer|modifie|modifiez|make|set|mets|mettez|khalli|khallih|khalliha|khallihon|ghayyer|ghayer|ghayyir|sayyerha)$/u;
/** The count after a "make it / change to" verb, within the next seven words («غير كميه الرول اون نيفيا لتلاته» is 3). */
function setCountIn(t: string): number | null {
  const w = t.split(" ");
  for (let i = 0; i < w.length; i++) {
    if (!SET_VERB.test(w[i]!)) continue;
    for (let j = i + 1; j <= i + 7 && j < w.length; j++) {
      const n = numWord(w[j]);
      if (n != null && n > 0) return n;
    }
  }
  return null;
}
// B1c: «بدي بس ...», "I only want", "je veux seulement": what follows is the basket as it should be: each count is set (sim-052 made
// 4 of 2 mortadella by adding).
const ONLY_WANT = /(?:^| )(?:بدي بس|بس بدي|بدنا بس|baddi bas|badde bas|bade bas|bas baddi|bas badde|i only want|i just want|only want|just want|je veux seulement|je veux juste|je ne veux que|seulement)(?: |$)/u;
// B1c: «خلي بس الملح والجلي», "keep only": the lines after it stay as they are, never taken off (sim-065 took off the jelly and the fish).
const KEEP_ONLY = /(?:^| )(?:خلي بس|خليلي بس|khalli bas|khalle bas|khallih bas|keep only|just keep|garde seulement|gardez seulement|garde juste)(?: |$)/u;
// B1c: «بدل الماجي بدي الملح», "instead of Maggi": the line it names is taken off (sim-065 added a Maggi and the salt).
const INSTEAD = /(?:^| )(?:بدل|بدال|عوض|badal|bdal|3awad|instead of|au lieu de|à la place de|a la place de|à la place du|a la place du)(?: (?:ال|el|l|al|the|du|de la|des|le|la))? ([^ ]+)/u;

/** B1c: the phrases that say what the basket should be, for every line of the message. */
function wholeMessageChanges(intent: OrderIntent, said: string): OrderIntent {
  if (!intent.lines.length || intent.intent === "cancel") return intent;
  const t = fold(said);
  let lines = intent.lines as Line[];
  // «بدل X»: the line whose first words are X is taken off (another line is what replaces it)
  const instead = INSTEAD.exec(t)?.[1];
  if (instead && lines.length > 1) {
    const w = instead.replace(/^ال/u, "");
    lines = lines.map((l) => (l.change !== "remove" && fold(`${l.raw} ${l.query}`).split(" ").some((x) => x.replace(/^ال/u, "") === w && w.length >= 3) ? { ...l, change: "remove" as const } : l));
  }
  // «خلي بس X و Y»: a line read as taken off whose words come after the phrase stays as it is
  const keep = KEEP_ONLY.exec(t);
  if (keep) {
    const at = keep.index + keep[0].length;
    lines = lines.filter((l) => {
      if (l.change !== "remove") return true;
      const first = fold(l.raw).split(" ").find((x) => x.length >= 3);
      return !(first && t.indexOf(first, at) >= at);
    });
  }
  // «بدي بس ...»: every count said is the count
  if (ONLY_WANT.test(t)) lines = lines.map((l) => (l.change === "remove" ? l : { ...l, change: "set" as const }));
  return lines === intent.lines ? intent : { ...intent, lines };
}

/** B1f: a line that says only a count and a container ("7 2anenin", «٧ قناني», "7 bottles"): no word of a product of its own. */
const COUNT_ONLY = /^(?:\d+(?:\.\d+)?|[\p{L}]+)? ?(?:2annine|2anine|2anenin|2nenin|annine|anenin|قنينه|قناني|قنينات|bottle|bottles|bouteilles?|3elbe|3elab|3lab|علبه|علب|kis|kyes|akyas|كيس|اكياس|pack|packs|packets?|باكيت|باكيتات|cans?|tanke|tankat|pieces?|pcs|7abbe|7abbet|حبه|حبات)?(?: (?:in total|total|en tout|au total|بالمجموع|kello|kellon|كلن|كلهن))?$/u;

/** B1f (b1b-yani-total-arabizi, read live as two lines): «زيد واحدة، يعني 7» read as "one more" plus a line of 7 of the same item is one
 *  line set to 7. Only when the message says the total and the two lines are one item (the same search words, or the second says only a
 *  count): two items are never merged. */
function totalAcrossTwo(intent: OrderIntent, total: number | null): OrderIntent {
  if (total == null || total <= 0 || intent.lines.length !== 2) return intent;
  const [a, b] = intent.lines as [Line, Line];
  if (a.change === "remove" || b.change === "remove") return intent;
  const withTotal = [a, b].find((l) => l.qty === total);
  const other = withTotal === a ? b : a;
  if (!withTotal || other.qty === total) return intent;
  const same = fold(a.query) === fold(b.query) || COUNT_ONLY.test(fold(withTotal.raw).replace(/[,،.]/gu, " ").replace(/\s+/gu, " ").trim());
  if (!same) return intent;
  return { ...intent, lines: [{ ...other, qty: total, change: "set" }] };
}

function addOrSet(intent: OrderIntent, said: string): OrderIntent {
  const t = fold(said);
  if (intent.lines.length === 2 && intent.intent !== "cancel") {
    const merged = totalAcrossTwo(intent, num(TOTAL_AFTER.exec(t)?.[1]) ?? num(TOTAL_BEFORE.exec(t)?.[1]));
    if (merged !== intent) return merged;
  }
  // Only an edit to what is in hand: a message that names one item, with a quantity.
  if (intent.lines.length !== 1 || intent.intent === "cancel") return intent;
  const l = intent.lines[0] as Line;
  if (l.change === "remove") return intent;
  const total = num(TOTAL_AFTER.exec(t)?.[1]) ?? num(TOTAL_BEFORE.exec(t)?.[1]);
  if (total != null && total > 0) return { ...intent, lines: [{ ...l, qty: total, change: "set" }] };
  // «ما بدي زيد شي، بس غيّر ...» ("I don't want to add anything, just change ..."): a "more" word said in the negative asks for no more.
  const moreSaid = MORE.test(t.replace(/(?:^| )(?:ما|مش|ma|mish|mesh|msh) (?:بدي |بدنا |baddi |badde |bade )?(?:زيد|زيدلي|ضيف|كمان|zid|zidli|kaman|kamen)(?= |$)/gu, " ").replace(NOT_MORE_OF_IT, " "));
  const setTo = setCountIn(t);
  if (setTo != null && setTo > 0 && !moreSaid) return { ...intent, lines: [{ ...l, qty: setTo, change: "set" }] };
  const notJust = num(NOT_JUST.exec(t)?.[1]);
  if (notJust != null && notJust !== l.qty && l.qty > 0) return { ...intent, lines: [{ ...l, change: "set" }] };
  // B1d: «بدي بس ...» ("I only want") says the count, whatever else the message says (sim-051).
  if (ONLY_WANT.test(t)) return intent;
  if (moreSaid && (l.change === "set" || l.change == null) && intent.intent !== "order") return { ...intent, lines: [{ ...l, change: "add" }] };
  if (moreSaid && l.change === "set") return { ...intent, lines: [{ ...l, change: "add" }] };
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

// ---------- B1d: counts (evals/cases/b1d_counts_edits.json, sim-test 43781701377) ----------
// Number words that make up a weight or a volume said in words («تنين وخمسين غرام», «واحدة وتلاتة مية ملل», "arba3 eh miyyeh gram").
const MEASURE_NUM = "\\d+(?:\\.\\d+)?|واحد|واحده|وحده|تنين|اتنين|تلات|تلاته|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|تمن|تمنه|تمان|تمانه|تسع|تسعه|عشر|عشره" +
  "|عشرين|تلاتين|اربعين|خمسين|ستين|سبعين|تمانين|تسعين|ميه|مئه|مايه|مية|ميتين|تلتميه|ربعميه|خمسميه|الف|نص|wa7de|wa7ad|tnein|tnen|tlete|tlet|arba3|arba3a" +
  "|khamse|khams|sette|set|sab3a|tmene|tes3a|3ashra|3ashrin|khamsin|miyye|miyyeh|miye|mia|meyye|mitein|alf|nos|one|two|three|four|five|six|seven|eight" +
  "|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|half|un|une|deux|trois|quatre|cinq|cent|cents|mille|demi";
const MEASURE_UNIT = "g|gr|gm|gram|grams|gramme|grammes|غ|غم|غرام|غرامات|جرام|ml|مل|ملل|ميلي|cl|l|lt|ltr|litre|litres|liter|liters|ليتر|لتر|kg|كغ|كيلو" +
  "|كيلوغرام|kilo|kilos|كيلوات";
const MEASURE_FILLER = "و|w|wa|we|and|et|eh|ah|um|emm|emmm|يعني|ya3ni|bas|بس";
const MEASURE_ONLY = new RegExp(`^(?:(?:${MEASURE_NUM}|${MEASURE_FILLER})(?: |$)|و(?:${MEASURE_NUM})(?: |$))+(?:${MEASURE_UNIT})$|^(?:${MEASURE_NUM})(?:${MEASURE_UNIT})$`, "u");
// «مية» after a number or before a unit is a hundred, never water («تلات قناني جلي ... واحدة وتلاتة مية ملل», sim-137 put Tannourine on the card).
const HUNDRED = new RegExp(`(?:^| )(?:(?:${MEASURE_NUM}) (?:و ?)?(?:مية|ميه|مايه|miyye|miyyeh|mia)|(?:مية|ميه|miyye|miyyeh) (?:${MEASURE_UNIT}))(?: |$)`, "u");

/**
 * A line that is only a weight or a volume («خمس غرام» after «اتنين domo sugar vanillin», sim-008; «واحدة وتلاتة مية ملل» after the dish
 * soap, sim-137) is the size of the line before it, never an item of its own: it joins that line's words, and its number is not a count.
 */
function measureOnlyLines(intent: OrderIntent): OrderIntent {
  if (intent.lines.length < 2) return intent;
  const out: Line[] = [];
  for (const l of intent.lines as Line[]) {
    const raw = fold(l.raw);
    const prev = out[out.length - 1];
    const measure = MEASURE_ONLY.test(raw) || (HUNDRED.test(raw) && raw.split(" ").every((w) => new RegExp(`^(?:${MEASURE_NUM}|${MEASURE_FILLER}|${MEASURE_UNIT}|و\\S+)$`, "u").test(w)))
      || packOfPrevious(raw);
    if (prev && measure && !l.brand_hint && l.change !== "remove") {
      out[out.length - 1] = { ...prev, raw: `${prev.raw} ${l.raw.trim()}`.trim() };
      continue;
    }
    out.push(l);
  }
  return out.length === intent.lines.length ? intent : { ...intent, lines: out };
}

// «التاني تبع الخمس رغفان» ("the other one, the five-loaf one", gate run 43812039544, hz0377): a line that only points back and says the
// pack (a number of loaves or pieces) describes the line before it.
const POINT_BACK = "التاني|الثاني|تاني|التانيه|الاول|الاولى|تبع|تبعون|تبعو|يلي|اللي|هيدا|هيدي|هيداك|هيديك|منو|منها|the|other|one|ones|with|of|that|el|l|tene|tenye|teneh|tabe3|yalli|le|la|autre|celui|celle|avec|de|du";
const PACK_UNIT = "رغيف|رغفان|ارغفه|رغيفات|loaf|loaves|ra8ifs?|r8ifs?|rghifs?|pains?|حبه|حبات|قطع|قطعه|pieces?|pcs";
function packOfPrevious(raw: string): boolean {
  const w = raw.split(" ");
  const strip = (x: string) => x.replace(/^ال(?=\p{L})/u, "");
  const isNum = (x: string) => new RegExp(`^(?:${MEASURE_NUM})$`, "u").test(strip(x)) || new RegExp(`^(?:${MEASURE_NUM})$`, "u").test(x);
  const isUnit = (x: string) => new RegExp(`^(?:${PACK_UNIT})$`, "u").test(strip(x)) || new RegExp(`^(?:${PACK_UNIT})$`, "u").test(x);
  return w.some(isNum) && w.some(isUnit) && w.some((x) => new RegExp(`^(?:${POINT_BACK})$`, "u").test(x))
    && w.every((x) => isNum(x) || isUnit(x) || new RegExp(`^(?:${POINT_BACK})$`, "u").test(x));
}

// «3tine», «a3tini», «عطيني» is "give me", never a count (sim-046: «3tine rabtet khebez 3arabi» put two breads on the card).
const GIVE_ME = /(?:^| )(?:3tine|3tini|3tiny|3teene|3tene|a3tine|a3tini|ateene|atini|عطيني|اعطيني|عطينا|عطيتي)(?: |$)/u;
// «wa7de tene», «وحدة تانية», "one more", «tenye»: one more, never two (sim-test 43776071899 read «wa7de tene» as 2).
const ONE_MORE = /(?:^| )(?:(?:wa7de|wa7ad|wahde|wahad|wa7da|وحده|واحد|واحده) (?:tene|tenye|tenyeh|tanye|tenyi|tani|tany|teni|تانيه|تاني|تانيي|كمان|kamen|kaman|kman)|one more|another one|une autre|un autre|encore une|encore un)(?: |$)/u;
const ANOTHER = /(?:^| )(?:tene|tenye|tenyeh|tanye|tenyi|tani|tany|تانيه|تانيي|another|autre)(?: |$)/u;
const TWO = /(?:^| )(?:2|tnein|tnen|tnayn|tneyn|tenyin|tintayn|tinten|tenten|تنين|اتنين|تنتين|ثنين|two|deux)(?: |$)/u;
/** The numbers said in words or digits: what a count could have come from. */
const countsIn = (t: string): number[] => t.split(" ").map((w) => numWord(w)).filter((n): n is number => n != null && n > 0);
const UNIT_NEXT = new RegExp(`^(?:${MEASURE_UNIT}|${PIECES_WORDS()})$`, "u");
function PIECES_WORDS() { return "حبه|حبات|حبة|قطعه|قطع|pieces|piece|pcs|pc|pièces|morceaux|wa2it|7abbe|7abbet"; }

/**
 * The counts the model read against the customer's own words:
 *  - «3tine X» ("give me X") with no two said is one, not two;
 *  - «wa7de tene», «X tenye» ("another X") is one more, not two;
 *  - a line that starts with its count («3 Snickers caramel ...», sim-136 put 2 on the card) has that count.
 */
function countsSaid(intent: OrderIntent, said: string): OrderIntent {
  if (!intent.lines.length || intent.intent === "cancel") return intent;
  const t = fold(said);
  const single = intent.lines.length === 1;
  let touched = false;
  const lines = (intent.lines as Line[]).map((l) => {
    if (l.change === "remove") return l;
    const raw = fold(l.raw);
    const words = single ? `${raw} ${t}` : raw;
    // the line's own leading count, when it is a plain count (not a weight, a volume or pieces)
    const w = raw.split(" ");
    const lead = num(w[0]);
    if (lead != null && lead > 0 && lead < 100 && Number.isInteger(lead) && lead !== l.qty && !UNIT_NEXT.test(w[1] ?? "") && !/^\d+(?:\.\d+)?[\p{L}]/u.test(l.raw.trim())
        && !countsIn(raw).includes(l.qty) && !(single && countsIn(t).includes(l.qty))) {
      touched = true;
      return { ...l, qty: lead };
    }
    if (l.qty === 2 || l.qty === 3) {
      const noCount = !countsIn(raw.replace(GIVE_ME, " ")).includes(l.qty) && !countsIn(t.replace(GIVE_ME, " ")).includes(l.qty) && !(l.qty === 2 && TWO.test(raw));
      if ((ONE_MORE.test(words) || (ANOTHER.test(raw) && !TWO.test(words))) && noCount) {
        touched = true;
        return { ...l, qty: 1, change: l.change === "set" ? l.change : (l.change ?? null) };
      }
      if (GIVE_ME.test(words) && noCount && !countsIn(words.replace(GIVE_ME, " ")).some((n) => n === l.qty)) {
        touched = true;
        return { ...l, qty: 1 };
      }
    }
    return l;
  });
  return touched ? { ...intent, lines } : intent;
}

// What says "more": the line is added to what is there. Without one of these, a count said for an item already in the basket is its count.
const MORE_ANY = /(?:^| )و?(?:كمان|زياده|زيدلي|زيد|زيدو|زيدها|زيدهن|ضيف|ضيفلي|ضيفو|ضيفي|ضيفها|ضيفهن|kman|kaman|kamen|kamein|zyede|ziyade|zid|zidli|zidle|zidlo|zidla|dif|difli|difle|add|adding|more|another|extra|encore|ajoute|ajoutez|ajouter|rajoute|rajoutez|de plus|en plus|tene|tenye|tenyeh|tanye|tani|تانيه|تاني|autre)(?: |$)/u;
const NOT_MORE = /(?:^| )(?:ما|مش|ma|mish|mesh|msh|don'?t|do not|no|pas|ne)(?: (?:بدي|بدنا|baddi|badde|bade|want|veux|need))? (?:زيد|زيدلي|ضيف|كمان|zid|zidli|zidle|kaman|kamen|add|ajouter)(?: (?:شي|shi|anything|rien|more))?(?= |$)/gu;
// «شو فيني زيد؟», "what can I add?" asks what to add, and «كمان بدي X», "w kamen baddi X" is "also I want X": neither is more of X
// (run 43824481535: sim-051 «بدي بس اتنين ثوم، شو فيني زيد؟» made 4 garlic; sim-036 «كمان بدي علبتين شاي» made 4 tea).
const NOT_MORE_OF_IT = /(?:^| )(?:(?:شو|شي|ايش|shu|sho|chou|what)(?: (?:فيني|فيي|فينا|بقدر|بقدرو|منقدر|fiyye|fiye|fini|ba2der|can i|can we|could i|should i))? (?:زيد|ازيد|نزيد|ضيف|zid|ziid|add)|(?:و ?)?(?:كمان|kamen|kaman|kman) (?:بدي|بدنا|baddi|badde|bade|bidde|i want|je veux))(?= |$)/gu;
/** True when the message asks for more of something, said in the positive. */
export function saysMore(said: string): boolean {
  return MORE_ANY.test(fold(said).replace(NOT_MORE, " ").replace(NOT_MORE_OF_IT, " "));
}
// «ناقص 3 بامبرز», "it's missing", «il manque»: what is missing goes on the card, it is never taken off (sim-135 took the diapers off).
const MISSING_ITEM = /(?:^| )و?(?:ناقص|ناقصني|ناقصه|ناقصين|نقصان|na2es|na2s|naa2es|missing|manque|il manque|manquent)(?: |$)/u;
const REMOVE_WORDS = /(?:^| )و?(?:شيل|شيلي|شيلو|شيله|شيلها|شيلهن|اشطب|بلا|بلاش|ما بدي|مش بدي|shil|shile|shilo|sheel|bala|ma baddi|ma badde|remove|take off|without|no more|enlève|enlevez|enleve|retire|retirez|sans)(?: |$)/u;
// «2 tahina bas», «3 Germex w 1 Domo bas»: "only" said after the items: those counts are the counts.
const ONLY_AFTER = /(?:^| )(?:bas|bass|بس|only|seulement|just)$/u;

/**
 * B1d: what a message about the basket in hand says, against the model's marks:
 *  - a line marked "add" when nothing in the message says more («3 Germex badal 2, w 1 Domo bicarbonate», sim-107; «ma baddi zid shi,
 *    kif fiyye kammel hek? 2 tahina bas», sim-023; a question «sar 5?») is its count, never added again;
 *  - a line marked "remove" in a message that says it is missing and asks nothing off is not taken off.
 */
function editMarks(intent: OrderIntent, said: string): OrderIntent {
  if (!intent.lines.length || intent.intent === "cancel") return intent;
  const t = fold(said);
  const more = saysMore(said);
  const missing = MISSING_ITEM.test(t) && !REMOVE_WORDS.test(t);
  const onlyAfter = (l: Line) => ONLY_AFTER.test(fold(l.raw)) || (intent.lines.length === 1 && ONLY_AFTER.test(t));
  let touched = false;
  const lines = (intent.lines as Line[]).map((l) => {
    if (l.change === "add" && !more) { touched = true; return { ...l, change: "set" as const }; }
    if (l.change === "remove" && missing) { touched = true; return { ...l, change: more ? "add" as const : null }; }
    if ((l.change === "add" || l.change == null) && onlyAfter(l) && !more) { touched = true; return { ...l, change: "set" as const }; }
    return l;
  });
  return touched ? { ...intent, lines } : intent;
}

// «مش الكبير», "not the big one", «mish el kbir» read as a modifier (gate run 43812039544, hz0377 and g0377: the large loaf chosen): a size
// ruled out says which product, so it goes into the line's own words, where the planner reads sizes.
const NOT_SIZE = new RegExp(`(?:^| )(?:مش|مو|ما|بلا|mish|mesh|msh|mush|ma|bala|not|no|pas|sans)(?: (?:${ARTICLE}))? ?(?:${SIZE})(?: |$)`, "u");
function sizeModifiers(intent: OrderIntent): OrderIntent {
  let touched = false;
  const lines = (intent.lines as Line[]).map((l) => {
    const ruled = (l.modifiers ?? []).filter((m) => NOT_SIZE.test(fold(m)) && !fold(l.raw).includes(fold(m)));
    if (!ruled.length) return l;
    touched = true;
    return { ...l, raw: `${l.raw.trim()} ${ruled.join(" ")}`.trim() };
  });
  return touched ? { ...intent, lines } : intent;
}

/** The reading after code's corrections. `said`: the customer's own words of the turn (texts and transcripts). */
export function tidyReading(intent: OrderIntent, said: string): OrderIntent {
  if (!said.trim()) return intent;
  const tidy = addOrSet(wholeMessageChanges(sizeOnlyLines(measureOnlyLines(sizeModifiers(buildingColour(intent, said)))), said), said);
  return editMarks(countsSaid(tidy, said), said);
}

// ---------- pieces that are the pack's size ----------
const PIECES = "حبه|حبات|حبة|قطعه|قطع|pieces|piece|pcs|pc|pièces|morceaux|wa2it|7abbe|7abbet";
const CONTAINERS_OF_PACK = "قناني|قنينه|قنينات|2anenne|2anene|2annine|2nanine|ananine|bottles|bottle|bouteilles|علب|علبات|3elab|3lab|cans|canettes|tins";
/**
 * "32 pieces" said of a product sold as a pack of 32 is one pack (sim-147: «حفاضات وي وي مقاس 6، 32 حبة» became 32 packs). True when
 * the line's count is said in pieces and the chosen product's own name carries the same count of pieces.
 */
export function packSizeQty(line: { raw: string; qty: number }, productNames: (string | null | undefined)[]): boolean {
  return packSizeCount(line, productNames) != null;
}

/**
 * B1c (sim-003): the count of packs when the line's count is the pack's own number of pieces: the other count said in the line
 * ("Three large blue trash bags, Vimax, thirty pieces" is 3; "one pack ... twelve pieces" is 1), else 1. Null when it is not.
 */
export function packSizeCount(line: { raw: string; qty: number }, productNames: (string | null | undefined)[]): number | null {
  const n = line.qty;
  if (!(n > 1)) return null;
  const words = fold(line.raw).split(" ");
  // the count is said in pieces: "30 pieces", "thirty pieces", «٣٠ حبة»
  const pieces = new RegExp(`^(?:${PIECES})$`, "u");
  // B1d (run 43824481535): bottles and cans of a pack of that many («Rim 2L, 6 2anenne» of "2L X 6", sim-140; «تلات علب» of "185G X3", sim-043)
  const units = new RegExp(`^(?:${PIECES}|${CONTAINERS_OF_PACK})$`, "u");
  const at = words.findIndex((w, i) => num(w) === n && units.test(words[i + 1] ?? ""));
  const glued = new RegExp(`(?:^|[^\\d.])${n} ?(?:${PIECES})(?:$|[^\\p{L}])`, "u").test(fold(line.raw));
  const pack = new RegExp(`(?:^|[^\\d.])${n} ?(?:${PIECES}|sheets|wipes|count|ct|x|rolls|loaves)(?:$|[^\\p{L}])|(?:^| )x ?${n}(?:$|[^\\d])`, "iu");
  const namePack = productNames.some((p) => !!p && pack.test(fold(p.replace(/×/g, " x "))));
  // B1d (sim-135): a number that is one end of a range the product's name carries («١٦-٣٠ كيلو» of the "16-30Kg" diapers) is a size.
  const rangeOf = new RegExp(`(?:^|[^\\d.])(?:${n} ?[-–] ?\\d+|\\d+ ?[-–] ?${n})(?:$|[^\\d])`, "u");
  const inRange = rangeOf.test(DIGITS(line.raw)) && productNames.some((p) => !!p && rangeOf.test(DIGITS(p)));
  // the other count in the line, said before the pieces: "three ... thirty pieces"
  // (never a size: «مقاس 6», "size 4", "N8", nor a weight or a volume: "400 g", nor the other end of a range)
  const sizeWord = /^(?:مقاس|المقاس|قياس|نمره|رقم|size|taille|no|n|numero|number|ma2as|mi2as)$/u, unit = /^(?:g|gr|kg|ml|cl|l|lt|ltr|غ|غرام|كغ|كيلو|مل|ليتر|لتر|grams?|kilos?|litres?|liters?)$/u;
  const rangeEnds = new Set([...DIGITS(line.raw).matchAll(/(\d+) ?[-–] ?(\d+)/gu)].flatMap((m) => [Number(m[1]), Number(m[2])]));
  const other = words.map((w) => num(w)).find((x, i) => x != null && x !== n && x > 0 && x < 100 && i !== at && !units.test(words[i + 1] ?? "")
    && !sizeWord.test(words[i - 1] ?? "") && !unit.test(words[i + 1] ?? "") && !rangeEnds.has(x));
  if (inRange) return other ?? 1;
  if ((at >= 0 || glued) && namePack) return other ?? 1;
  // B1d (sim-015): «tnein gipsy wet wipes miyye w 2 pocket wipes arba3in» read as 40: the number is the pack's own count of pieces
  // (40Pcs), and the customer said the count of packs too.
  if (namePack && other != null && words.some((w) => num(w) === n)) return other;
  return weightCount(line, productNames);
}

/**
 * B1d (sim-test 43776071899: «٣ كيلو» of sugar became three 5 kg bags): a count said in kilos, of a product sold in packs of another
 * weight, is the number of packs nearest that weight, at least one. Null when the line's count is not a weight said in kilos or the
 * pack is a kilo (the count stands).
 */
export function weightCount(line: { raw: string; qty: number }, productNames: (string | null | undefined)[]): number | null {
  const n = line.qty;
  const words = fold(line.raw).split(" ");
  const kilos = words.some((w, i) => num(w) === n && /^(?:kg|كغ|كيلو|كيلوات|kilo|kilos|كيلوغرام)$/u.test(words[i + 1] ?? ""))
    || new RegExp(`(?:^|[^\\d.])${n} ?(?:kg|كغ|كيلو|kilo)(?:$|[^\\p{L}])`, "u").test(fold(line.raw));
  if (!kilos) return null;
  const weights = productNames.flatMap((p) => {
    const m = p ? /(\d+(?:\.\d+)?) ?(kg|g|gr|غ|غرام|كغ|كيلو)(?:$|[^\p{L}])/iu.exec(DIGITS(p)) : null;
    if (!m) return [];
    const w = Number(m[1]) / (/^(?:kg|كغ|كيلو)$/iu.test(m[2]!) ? 1 : 1000);
    return w > 0 ? [w] : [];
  });
  const w = weights[0];
  if (w == null || Math.abs(w - 1) < 1e-9) return null;
  const packs = Math.max(1, Math.round(n / w));
  return packs === n ? null : packs;
}
