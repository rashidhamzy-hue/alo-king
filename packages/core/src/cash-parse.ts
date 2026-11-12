// Reads what a rider types after a delivery: "20$", "١٥ دولار و ٤٥٠ الف", "1,800,000", "tamem", "20 usd rajja3t 200 alf".
// Pure code, no model: money is never interpreted by a language model.
export interface CashMessage { usd: number; lbp: number; changeUsd: number; changeLbp: number; exact: boolean }

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function normalise(s: string): string {
  let t = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[٬،٫]/g, ",").toLowerCase();
  for (let prev = ""; prev !== t; ) { prev = t; t = t.replace(/(\d),(\d{3})(?!\d)/, "$1$2"); }   // 1,800,000 -> 1800000
  return t;
}

const EXACT = /^(tamem|tamam|تمام|مظبوط|مزبوط|ok|exact|كامل|متل ما هو|مدفوع)$/;
const CHANGE = /(رجعت|رجّعت|رديت|ردّيت|الباقي|باقي|rajja3t|raja3t|rja3t|change|radet|baqi|ba2e)/;
const USD = /(\$|usd|dollar|dolar|دولار|دولارات)/;
const LBP = /(lbp|ll|l\.l|ليرة|ليره|lira|لبناني)/;
const THOUSAND = /(alf|alef|الف|ألف|آلاف|الاف|k)(?!\p{L})/u;
const MILLION = /(million|malyoun|malyon|مليون|ملايين|m)(?!\p{L})/u;

function amounts(part: string): { usd: number; lbp: number } {
  let usd = 0, lbp = 0;
  const re = /(\$)?\s*(\d+(?:\.\d+)?)\s*([^\d\s]{0,12}(?:\s+[^\d\s]{1,12})?)?/g;
  for (const m of part.matchAll(re)) {
    let n = Number(m[2]); const tail = (m[3] ?? "").trim();
    if (!Number.isFinite(n)) continue;
    const dollar = !!m[1] || USD.test(tail);
    if (MILLION.test(tail)) n *= 1_000_000; else if (THOUSAND.test(tail)) n *= 1_000;
    if (dollar) usd += n;
    else if (LBP.test(tail) || MILLION.test(tail) || THOUSAND.test(tail) || n >= 5_000) lbp += n;   // nobody is handed 5,000 dollars at a door
    else usd += n;                                                                                  // a bare small number is dollars
  }
  return { usd, lbp };
}

export function parseCashMessage(text: string): CashMessage | null {
  const t = normalise(text).trim();
  if (!t) return null;
  if (EXACT.test(t)) return { usd: 0, lbp: 0, changeUsd: 0, changeLbp: 0, exact: true };
  const ch = CHANGE.exec(t);
  const paid = amounts(ch ? t.slice(0, ch.index) : t);
  const back = ch ? amounts(t.slice(ch.index + ch[0].length)) : { usd: 0, lbp: 0 };
  if (paid.usd === 0 && paid.lbp === 0) return null;
  return { usd: paid.usd, lbp: paid.lbp, changeUsd: back.usd, changeLbp: back.lbp, exact: false };
}

/** What the rider should be holding out as change, in lira rounded to the nearest 1,000 (small USD change rarely exists). */
export function suggestChangeLbp(totalUsd: number, paidUsd: number, paidLbp: number, fx: number): number {
  const over = paidUsd + paidLbp / fx - totalUsd;
  return over <= 0 ? 0 : Math.round((over * fx) / 1000) * 1000;
}
