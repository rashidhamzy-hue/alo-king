// What a recorded WhatsApp message said, in words, for the console's pages (Inbox, an order's story, Exceptions).
import { pick, type Lang as UiLang } from "./i18n";

/** QA1: the gateway records a message that is not plain text as its whole WhatsApp body (JSON). Shown as its words: the text with its
 *  buttons or list rows, a template's name, or "[location]". The list's copy is cut at 200 characters (0136), so a cut JSON is read too. */
export function messageWords(type: string, body: string | null, L: UiLang = "en"): string {
  if (!body) return `[${type}]`;
  if (!body.trimStart().startsWith("{")) return body;
  let m: any = null;
  try { m = JSON.parse(body); } catch { /* cut at 200 characters: read what is there */ }
  if (type === "location" || m?.type === "location") return pick(L, "[location]", "[موقع]");
  if (type === "template" || m?.type === "template") {
    const name = m?.template?.name ?? /"name":\s*"([^"\\]+)"/.exec(body)?.[1] ?? "";
    return `[${pick(L, "template", "قالب")}: ${name}]`;
  }
  const cut = /"body":\s*\{\s*"text":\s*"((?:[^"\\]|\\.)*)/.exec(body)?.[1];
  let text: string | null = m?.interactive?.body?.text ?? m?.text?.body ?? null;
  if (text === null && cut !== undefined) { try { text = JSON.parse(`"${cut}"`); } catch { text = cut; } }
  if (text === null) return `[${type}]`;
  const choices: string[] = [...(m?.interactive?.action?.buttons ?? []).map((b: any) => b?.reply?.title),
    ...(m?.interactive?.action?.sections ?? []).flatMap((x: any) => (x?.rows ?? []).map((r: any) => r?.title))].filter((t: unknown): t is string => typeof t === "string");
  return choices.length ? `${text} [${choices.join(" | ")}]` : text;
}
