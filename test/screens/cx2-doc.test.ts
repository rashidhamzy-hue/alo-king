// CX2 stage 1: docs/MESSAGES.md is written from test/screens/cx2-messages.ts (the proposal) and today's message snapshots, so the document
// a person reads is the words the code makes. Regenerate with `npx vitest run test/screens/cx2-doc.test.ts -u`. Free; no browser.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LS, screens, type Bubble, type L } from "./cx2-messages";

const LANG_NAME: Record<L, string> = { ar: "Arabic", en: "English" };
const fence = (b: Bubble) => {
  const extra = [
    ...(b.buttons?.length ? [`[${b.buttons.join("] [")}]`] : []),
    ...(b.location ? [`[📍 ${b.location}]`] : []),
    ...(b.list ? [`[☰ ${b.list.button}]`, ...b.list.rows.map((r) => `  • ${r.title}${r.description ? `  —  ${r.description}` : ""}`)] : []),
  ];
  return ["```text", ...(b.them ? [`(the customer) ${b.body}`] : [b.body]), ...extra, "```"].join("\n");
};

/** Every customer-facing message key in today's snapshot (the ops line's are staff messages), with its English and Arabic words. */
function inventory(): { key: string; en: string; ar: string }[] {
  const read = (lang: string) => {
    const s = readFileSync(fileURLToPath(new URL(`../../packages/agents/test/__snapshots__/messages.${lang}.md`, import.meta.url)), "utf8");
    return new Map([...s.matchAll(/^## (\S+)\n\n```text\n([\s\S]*?)\n```/gm)].map((m) => [m[1]!, m[2]!]));
  };
  const en = read("en"), ar = read("ar");
  return [...en.keys()].filter((k) => !k.startsWith("ops.") && !k.startsWith("ak_")).map((key) => ({ key, en: en.get(key)!, ar: ar.get(key) ?? "" }));
}
const oneLine = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ⏎ ").slice(0, 160) + (t.length > 160 ? "…" : "");

function doc(): string {
  const S = screens();
  const out: string[] = [];
  out.push("# Customer messages: before and after (CX2)", "",
    "**Stage 1, waiting for the founder.** Every customer message, as WhatsApp shows it, before (today's code; where today's code is not one function, the founder's own staging chat of 18 November 07:36 to 09:06) and after (the proposal), in Arabic and English. French follows the English in stage 2.",
    "The pictures are on the console's **Screens** page, session **cx2**: each message is two pages, `cx2-<message>-before` and `cx2-<message>-after`, at 390 px, Arabic and English.",
    "Reply in the chat with what to change (\"card: drop the italic line\", \"welcome: say ...\"); stage 2 puts the approved words in the code, with the message-rules tests and snapshots changed on purpose.",
    "This file is written by `test/screens/cx2-doc.test.ts` from `test/screens/cx2-messages.ts`: change the words there, not here.", "");
  out.push("## The rules, before and after", "",
    "| Rule | Before (M1, SYSTEM_BRIEF) | After (proposed) |", "|---|---|---|",
    "| Layout | Plain lines; a heading only on the card | Every message opens with one **bold heading line** and its emoji; a blank line between sections; lines under about 60 characters on a phone |",
    "| Emoji | 10 allowed (📍 🛒 🛵 ✅ 💵 🌙 ⚠️ 📦 🏠 🔢), at most 3, 👑 only in a greeting | Widened on purpose to 22: the 10, plus ⏱️ 🔁 🕘 👋 🙏 🔎 ✏️ ❌ 💬 ☀️ 👇 📝; at most 6 in an order card, 3 elsewhere; one per heading or button; 👑 retired (👋 greets) |",
    "| Bold | Only the card's heading and the total | Headings, the total, the gap to the minimum, and a button's name when the text tells the customer to tap it |",
    "| Italic | None | The consent and privacy lines, in italics, last |",
    "| Amounts | Each amount on its own line (rule 7) | An amount ends its line after « · » (\"3 × Tannourine water 6 × 2 L · $6.03\"); still one amount a line, Latin digits, $ before the number |",
    "| Arabic amounts | `$6.03` alone on its line, so it reads left to right | In an Arabic line WhatsApp draws a dollar amount as `6.03$` (as «12.50$ نقداً» already reads); that is how Arabic readers write it, so no hidden direction marks are added. The text sent is still `$6.03` |",
    "| Lists | Bullets in text, choices as three buttons cut to 20 characters | Choices of products, times and options are WhatsApp **list messages** (a row title up to 24 characters, a description up to 72 with the full name and price, up to 10 rows); buttons only for two or three short actions, each with its emoji, at most 20 characters |",
    "| Places | The out-of-area answer listed every village we serve (25 on staging) | Never a list of villages: we ask for the village or the location |",
    "| Language | Some code messages were Arabic whatever the customer wrote (the feedback question, the payment template's amount) | Every message in the customer's language |",
    "| Templates | `ak_*` utility templates, no bold, no emoji (Meta) | Unchanged: they are sent only outside the 24-hour window; inside it the session message above goes instead |", "");
  out.push("## What the founder's chat showed (18 November, AK-1062 and AK-1063)", "",
    "Fixed in stage 1, each with a failing case first (`evals/cases/cx2_founder_chat.json`, `test/db/cx2-founder-chat.test.ts`, `test/db/web2-turn.test.ts`):",
    "1. «نص كفة» (half a kilo of kafta) in the 07:37 voice note was not found and nothing said so. Kafta now has the word «كفة» (0256), and a line not found is always said: by code before a card, a question or the kept-order message, and after the model's reply if the reply did not name it.",
    "2. «cafe mate» (Coffee-mate creamer) was asked as «which one?» over three Najjar coffees. Coffee Mate now has the words (0256), and a «which one?» never offers products when a word the customer said names another product's brand or kind: that line gets PD1's honest answer.",
    "3. The website order's card went twice, Arabic then English (08:52:12 and 08:52:15). Each card request is claimed once (0255): one card, in the language of the page.",
    "", "Seen and proposed here (stage 2): the out-of-area list of 25 villages (07:38); the feedback question and its thank-you in Arabic to every customer; the payment template sent inside the window, in Arabic, with «9.44$ نقداً»; the picker's buttons cut to «1. نسكافيه قهوة سريع» and «2. نسكافيه قهوة سريع»; the hours said as 08:00 (settings.hours is 09:00 to 21:00 from 0255).", "");
  out.push("## The messages", "");
  for (const s of S) {
    out.push(`### ${s.title} (\`${s.key}\`)`, "", s.why, "");
    for (const lang of LS) {
      out.push(`**Before, ${LANG_NAME[lang]}**`, "", ...s.before[lang].map(fence), "", `**After, ${LANG_NAME[lang]}**`, "", ...s.after[lang].map(fence), "");
    }
  }
  out.push("## Every other customer message", "",
    "Today's words (English; the Arabic is in `packages/agents/test/__snapshots__/messages.ar.md` under the same key). In stage 2 each gets the rules above: a bold heading line where it is more than one line, its emoji from the set, amounts after « · », buttons with an emoji; the words stay unless the founder changes them here.", "",
    "| Key | Today (English) |", "|---|---|");
  const shown = new Set(["card.now", "card.window", "card.pickup", "card.extras", "card.long.1", "card.long.2", "basket.which", "cx.welcome", "fixed.closedKept", "fixed.keptOpen",
    "answer.hours", "answer.hours.closed", "answer.outOfArea", "answer.inArea", "fixed.askPin", "fixed.pinOutside", "tap.confirmed", "notice.onTheWay", "notice.riderAtDoor",
    "status.delivered", "notice.paymentReceived", "honest.notCarried", "honest.notFound", "honest.fits", "notice.confirmReminder", "notice.orderCancelled", "basket.minimum",
    "windows.list", "support.opened"]);
  for (const r of inventory()) if (!shown.has(r.key)) out.push(`| \`${r.key}\` | ${oneLine(r.en)} |`);
  out.push("");
  return out.join("\n");
}

describe("CX2: docs/MESSAGES.md", () => {
  it("is the proposal as the code writes it", async () => {
    await expect(doc()).toMatchFileSnapshot("../../docs/MESSAGES.md");
  });
  it("every button fits WhatsApp (20 characters), every list row (24 and 72), every message body (1,024 interactive, 4,096 text)", () => {
    for (const s of screens()) for (const lang of LS) for (const b of s.after[lang]) {
      for (const t of b.buttons ?? []) expect(t.length, `${s.key} ${lang} ${t}`).toBeLessThanOrEqual(20);
      for (const r of b.list?.rows ?? []) { expect(r.title.length, r.title).toBeLessThanOrEqual(24); expect((r.description ?? "").length, r.description).toBeLessThanOrEqual(72); }
      expect(b.body.length, s.key).toBeLessThanOrEqual(b.buttons || b.list || b.location ? 1024 : 4096);
      if (b.list) expect(b.list.button.length).toBeLessThanOrEqual(20);
    }
  });
});
