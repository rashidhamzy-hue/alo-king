// CON1: the one label-work flow (docs/DECISIONS.md, "CON1, a simple console, 19 November 2026"). Before CON1 the label day was spread over
// Intake, Food facts and Label approvals; now one tab bar walks it in order, and the older addresses move here (app.ts, MOVED):
//   Progress (/labels: the board, the steps to selling-requires-a-label, the pack check; it was /intake)
//   Photograph (/capture, LB1: the label day's three photos)              Approve readings (/approve?tab=labels: the Approvals inbox's kind)
//   Food facts (/labels?step=facts: every item's facts; it was /food-facts) Readiness (/readiness: sellable, fact-complete, label-ready)
// The reading itself is the label-read workflow (GitHub, Actions), as the Progress board says. A picker photographs and sees no tab bar.
// UX2b drew the first version of this frame (four tabs).
import { can, html, type Ctx } from "../app";
import type { Raw } from "../html";
import { pick } from "../i18n";
import { LEADS } from "../roles";
import { tabs } from "@ak/ui/components";

export type IntakeTab = "progress" | "photograph" | "approvals" | "facts" | "readiness";

export function intakeTabs(c: Ctx, current: IntakeTab, counts: Partial<Record<IntakeTab, number>> = {}): Raw {
  const L = c.lang;
  if (!can(c, LEADS)) return html``;
  const items: { id: IntakeTab; label: string; href: string }[] = [
    { id: "progress", label: pick(L, "1 Progress", "١ التقدّم"), href: "/labels" },
    { id: "photograph", label: pick(L, "2 Photograph", "٢ التصوير"), href: "/capture" },
    { id: "approvals", label: pick(L, "3 Approve readings", "٣ الموافقة على القراءات"), href: "/approve?tab=labels" },
    { id: "facts", label: pick(L, "4 Food facts", "٤ المعلومات الغذائية"), href: "/labels?step=facts" },
    { id: "readiness", label: pick(L, "5 Readiness", "٥ الجاهزية"), href: "/readiness" },
  ];
  return html`${tabs(items.map((x) => ({ label: x.label, href: x.href, current: x.id === current, count: counts[x.id] })), pick(L, "Label work", "عمل الملصقات"))}`;
}
