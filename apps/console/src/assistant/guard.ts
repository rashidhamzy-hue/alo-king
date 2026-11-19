// AST1: what the code checks in an answer before anyone sees it (docs/DECISIONS.md, "AST1, the console assistant").
//   * Every number in the answer comes from a tool result read in that turn (or the question, or today's date and time given to the model).
//     A figure the tools did not give is "unsupported": the model is asked once to rewrite without it; if it still says one, the answer is
//     not shown (the panel says it could not answer from the data alone). Never invent.
//   * Every link is a console page that exists (the navigation's own addresses); any other link loses its address and keeps its words.
//   * The answer is drawn as text: escaped, short paragraphs, "- " lists, **bold**, and [words](/page) links. No HTML from the model.
import { html, Raw } from "@ak/ui/h";
import { ADVANCED, GROUPS } from "../nav";

const ARABIC_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9", "٫": ".", "٬": "," };
export const westernDigits = (s: string) => s.replace(/[٠-٩۰-۹٫٬]/g, (ch) => ARABIC_DIGITS[ch] ?? ch);

/** The numbers a text holds, as numbers (a date or a time gives each part; "1,234" is one number; signs are ignored). */
export function numbersIn(text: string): number[] {
  const s = westernDigits(text).replace(/(\d),(?=\d{3}\b)/g, "$1");
  return [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => Number.isFinite(n));
}

/** The numbers an answer states that a reader would take as figures: list markers ("1." at a line's start) and link addresses are not. */
export function answerNumbers(answer: string): number[] {
  const text = westernDigits(answer)
    .replace(/\]\([^)]*\)/g, "]")                 // a link's address
    .replace(/^\s*\d{1,2}[.)]\s/gm, " ");          // a numbered list's marker
  return numbersIn(text);
}

/** Is n one of the source numbers, as given or rounded (to whole, one or two decimals)? */
export function supported(n: number, sources: Set<number> | number[]): boolean {
  for (const s of sources) {
    if (Math.abs(n - s) < 0.0051) return true;
    if (Math.round(s) === n || Math.round(s * 10) / 10 === n || Math.round(s * 100) / 100 === n) return true;
  }
  return false;
}

/** The figures of an answer that no source holds. */
export function unsupportedNumbers(answer: string, sources: string[]): number[] {
  const pool = new Set<number>(sources.flatMap(numbersIn));
  return [...new Set(answerNumbers(answer).filter((n) => !supported(n, pool)))];
}

/** The console's pages an answer may link to: every address of the navigation, its moved and tab addresses, and the assistant. */
export const LINKABLE: ReadonlySet<string> = new Set([...GROUPS.flatMap((g) => [...g.hrefs, ...(g.also ?? [])]), ...ADVANCED, "/assistant", "/exceptions", "/cases", "/more"]);
export function safeLink(href: string): string | null {
  const m = /^(\/[a-z0-9/-]*)(\?[a-z0-9=&_-]{1,80})?$/.exec(href.trim());
  if (!m) return null;
  const path = m[1]!.replace(/\/+$/, "") || "/";
  return LINKABLE.has(path) ? path + (m[2] ?? "") : null;
}

/** The answer as a fragment: escaped text with lists, bold and checked links. */
export function renderAnswer(text: string): Raw {
  const inline = (s: string): Raw => {
    const parts: (string | Raw)[] = [];
    const re = /\[([^\]\n]{1,80})\]\(([^)\s]{1,120})\)|\*\*([^*\n]{1,120})\*\*/g;
    let last = 0;
    for (const m of s.matchAll(re)) {
      parts.push(s.slice(last, m.index));
      if (m[1] !== undefined) {
        const to = safeLink(m[2]!);
        parts.push(to ? html`<a href="${to}">${m[1]}</a>` : m[1]);
      } else parts.push(html`<strong>${m[3]}</strong>`);
      last = m.index! + m[0].length;
    }
    parts.push(s.slice(last));
    return html`${parts}`;
  };
  const blocks: Raw[] = [];
  let list: Raw[] = [];
  const flush = () => { if (list.length) { blocks.push(html`<ul>${list}</ul>`); list = []; } };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const item = /^(?:[-•*]|\d{1,2}[.)])\s+(.*)$/.exec(line);
    if (item) { list.push(html`<li>${inline(item[1]!)}</li>`); continue; }
    flush();
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(head ? html`<p><strong>${inline(head[1]!)}</strong></p>` : html`<p>${inline(line)}</p>`);
  }
  flush();
  return html`${blocks}`;
}

/** Does the text have Arabic letters (the question's language decides the answer's)? */
export const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
