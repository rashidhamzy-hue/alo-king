// HO1: every new customer-facing Arabic line is listed in docs/ARABIC_REVIEW.md for a person to read before the friends' test.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ar } from "@ak/agents/messages";

const doc = readFileSync(fileURLToPath(new URL("../../../docs/ARABIC_REVIEW.md", import.meta.url)), "utf8");
const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

describe("docs/ARABIC_REVIEW.md lists every HO1 Arabic line", () => {
  const s = ar.support;
  const lines = [s.opened, s.reminder, s.stillOnIt, s.resumed, s.afterHours("08:00"), s.resolved, s.callbackButton, s.keepOrderingButton,
    s.voiceNoteButton, s.callbackNoted, s.keepOrdering, s.voiceNoteAsk, s.technical, s.capMenu, s.stalled, s.browseButton, s.myOrderButton,
    s.personButton, s.buttonError, s.retryButton, s.notOnRecord, s.browseInWords,
    ...(["person_requested", "order_problem", "complaint", "refund", "payment", "safety", "other"] as const).map((k) => s.draft(k, "AK-1234")),
    ar.ops.turnCap(20)];
  it.each(lines.map((l) => [l.slice(0, 40), l] as const))("%s", (_h, line) => { expect(doc).toContain(cell(line)); });
});
