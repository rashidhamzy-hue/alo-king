// Numbers in customer text (DECISIONS §32.4 normalisation dictionary, §38.3 "Arabizi number normalisation"). In Arabizi a
// digit inside a word is a letter (2 = ء, 3 = ع, 5 = خ, 7 = ح: "7arr", "ta2ouk"), and only a standalone number or number
// word is a quantity ("Pepsi diet 2", "tnen shawarma", "deux manouches", "٣ كنافة"). The words that mean dishes, brands
// and descriptions live in the database (public.search_lexicon), next to the menus they search.

const WORDS: Record<string, number> = {
  // English
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  a: 1,
  an: 1,
  // French
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  // Arabizi
  wa7ad: 1,
  wahad: 1,
  wa7de: 1,
  wahde: 1,
  tnen: 2,
  tnein: 2,
  tnayn: 2,
  tlete: 3,
  tleteh: 3,
  tleta: 3,
  arba3a: 4,
  arb3a: 4,
  khamse: 5,
  khamseh: 5,
  sette: 6,
  sitte: 6,
  sab3a: 7,
  tmene: 8,
  tmenye: 8,
  tes3a: 9,
  "3ashra": 10,
  ashra: 10,
  // Arabic
  واحد: 1,
  وحده: 1,
  وحدة: 1,
  تنين: 2,
  اتنين: 2,
  اثنين: 2,
  تلاتة: 3,
  تلاته: 3,
  ثلاثة: 3,
  اربعة: 4,
  أربعة: 4,
  اربعه: 4,
  خمسة: 5,
  خمسه: 5,
  ستة: 6,
  سته: 6,
  سبعة: 7,
  سبعه: 7,
  تمانية: 8,
  تمانيه: 8,
  تسعة: 9,
  تسعه: 9,
  عشرة: 10,
  عشره: 10,
};

const toAscii = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * The quantity a message asks for, and the words left to search. A standalone number (1-50) or number word is the
 * quantity; "x2" and "2x" too. Digits inside words stay (Arabizi letters). Without a number the quantity is null.
 */
export function readQuantity(text: string): { qty: number | null; rest: string } {
  const tokens = toAscii(text.normalize("NFC")).trim().split(/\s+/).filter(Boolean);
  let qty: number | null = null;
  const rest: string[] = [];
  for (const raw of tokens) {
    const t = raw.toLowerCase().replace(/[.,!?؟،]+$/g, "");
    const m = /^(?:x?(\d{1,2})x?)$/.exec(t);
    if (qty === null && m && Number(m[1]) >= 1 && Number(m[1]) <= 50) {
      qty = Number(m[1]);
      continue;
    }
    // A number word counts only once and only as a quantity; "a"/"an"/"un"/"une" alone are kept when no dish follows.
    if (qty === null && t in WORDS && !["a", "an"].includes(t)) {
      qty = WORDS[t];
      continue;
    }
    rest.push(raw);
  }
  return { qty, rest: rest.join(" ") };
}

/** A Lebanese or international WhatsApp number written any common way, as E.164; null when it is not one. */
export function readPhone(text: string): string | null {
  const t = toAscii(text).replace(/[\s\-().]/g, "");
  const m = /(\+|00)?(\d{7,15})/.exec(t);
  if (!m) return null;
  const digits = m[2];
  if (m[1]) return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  // Lebanon without the country code: 8 digits (3x xxx xxx is written 03 xxx xxx, mobiles 70, 71, 76, 78, 79, 81).
  if (/^961\d{7,8}$/.test(digits)) return `+${digits}`;
  const local = digits.replace(/^0/, "");
  if (/^(3\d{6}|(70|71|76|78|79|81)\d{6})$/.test(local)) return `+961${local}`;
  return null;
}

/** "Mom 70 123 456" / "ماما ٠٣١٢٣٤٥٦" → a name and a number. The name is what is left once the number is removed. */
export function readRecipient(text: string): { name: string | null; phone: string | null } {
  const phone = readPhone(text);
  const name = toAscii(text)
    .replace(/(\+|00)?[\d\s\-().]{7,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return { name: name.length >= 1 ? name : null, phone };
}
