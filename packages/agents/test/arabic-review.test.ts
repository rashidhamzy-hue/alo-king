// HO1: every new customer-facing Arabic line is listed in docs/ARABIC_REVIEW.md for a person to read before the friends' test.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ar } from "@ak/agents/messages";

const doc = readFileSync(fileURLToPath(new URL("../../../docs/ARABIC_REVIEW.md", import.meta.url)), "utf8");
// Markdown table cell: backslash first, then the pipe, then line breaks (as docs/ARABIC_REVIEW.md is written).
const cell = (t: string) => t.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

describe("docs/ARABIC_REVIEW.md lists every HO1 Arabic line", () => {
  const s = ar.support;
  const lines = [s.opened, s.reminder, s.stillOnIt, s.resumed, s.afterHours("08:00"), s.resolved, s.callbackButton, s.keepOrderingButton,
    s.voiceNoteButton, s.callbackNoted, s.keepOrdering, s.voiceNoteAsk, s.technical, s.capMenu, s.stalled, s.browseButton, s.myOrderButton,
    s.personButton, s.buttonError, s.retryButton, s.notOnRecord, s.browseInWords,
    ...(["person_requested", "order_problem", "complaint", "refund", "payment", "safety", "other"] as const).map((k) => s.draft(k, "AK-1234")),
    ar.ops.turnCap(20)];
  it.each(lines.map((l) => [l.slice(0, 40), l] as const))("%s", (_h, line) => { expect(doc).toContain(cell(line)); });
});

describe("docs/ARABIC_REVIEW.md lists every B1a Arabic line", () => {
  const b = ar.basket;
  const lines = [b.minimum(5, 0.69, 4.31), b.minimumIs(5), b.cancelButton, b.cleared, b.soFar(["1 × لبنة", "2 × خبز"]),
    b.changed(["خبز: 2 → 4"]), b.unavailable(["لبنة"]), b.cancelRefused("AK-1234")];
  it.each(lines.map((l) => [l.slice(0, 40), l] as const))("%s", (_h, line) => { expect(doc).toContain(cell(line)); });
});

describe("docs/ARABIC_REVIEW.md lists every B1b Arabic line", () => {
  const f = ar.fixed;
  const lines = [f.noPinCall("بعقلين"), f.askVillageLandmark, f.noPinNote, f.welcome];
  it.each(lines.map((l) => [l.slice(0, 40), l] as const))("%s", (_h, line) => { expect(doc).toContain(cell(line)); });
});

describe("docs/ARABIC_REVIEW.md lists every CX1 Arabic line", () => {
  const c = ar.cx, o = ar.ops;
  const lines = [c.welcome("08:00", "22:00"), c.privacy, c.orderButton, c.areaButton, c.orderAsk, c.areaAsk, c.keepLine, c.choicesButton, c.choicesMissing,
    c.choicesNote, c.choicesOrder, c.exactRow, c.keepRow, c.cancelRow, c.exactSet, c.needsNote, c.cancelYes, c.pickupOff,
    ...(["best_match", "ask", "remove"] as const).flatMap((p) => [c.missingLine(p), c.missingRow[p], c.missingSet(p)]),
    c.noteRow(20), c.noteSet(20, 12.73), c.keepSet(12.73), c.noteTooSmall(7.27), c.choiceTooLate("AK-1234"), c.cancelAsk("AK-1234", 0),
    c.cancelAsk("AK-1234", 7.27), c.cancelAfterPick("AK-1234", 5.27, ["لبنة"]), c.cancelAfterPickCash("AK-1234"), c.cancelOnTheWay("AK-1234"),
    c.handoverCode("4821"), c.pickupAt("مستودع ألو كينغ"), c.pickupReady("AK-1234", "مستودع ألو كينغ"),
    o.askCode("AK-1234"), o.wrongCode(4), o.codeLocked("AK-1234"), o.codeLockedAlert("AK-1234"), o.codeOk("AK-1234"), o.keepChange(20)];
  it.each(lines.map((l) => [l.slice(0, 40), l] as const))("%s", (_h, line) => { expect(doc).toContain(cell(line)); });
});

describe("docs/ARABIC_REVIEW.md lists every B1c Arabic line", () => {
  const b = ar.basket;
  const lines = [b.which("ربطة خبز", ["Wooden Bakery Pita White Medium 400G: $0.62", "Al Forno Pita White Bread Big 800G: $1.01"]),
    b.houseDefault("ربطة خبز", "Wooden Bakery Pita White Medium 400G"), ar.answer.noOpenRepeat(["لبنة", "خبز"], 0),
    b.minimum(5, 0.69, 4.31, ["1 × لبنة"]), ar.fixed.closedKept("08:00", ["1 × لبنة"])];
  it.each(lines.map((l) => [l.slice(0, 40), l] as const))("%s", (_h, line) => { expect(doc).toContain(cell(line)); });
});

describe("docs/ARABIC_REVIEW.md lists every CFG1 Arabic line", () => {
  const lines = [ar.notice.confirmReminder("AK-1234"), ar.card.reopenedFrom("AK-1234"), ar.cx.reopenButton, ar.cx.handoverCodePickup("4821"),
    ar.cx.pickupReady("AK-1234", "مستودع ألو كينغ")];
  it.each(lines.map((l) => [l.slice(0, 40), l] as const))("%s", (_h, line) => { expect(doc).toContain(cell(line)); });
});
