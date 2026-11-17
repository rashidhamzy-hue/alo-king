// UX2b: the frame Intake's pages share (the reference's `/ops/intake`: progress board, photograph, check). Four places, one tab bar:
//   Progress (/intake: the board, the steps to selling-requires-a-label, and the pack check)   Photograph (/capture, LB1: the label day)
//   Label approvals (/label-queue, LB1: the list view of what a person decides)                 Readiness (/readiness: sellable, fact-complete, label-ready)
// A person sees the tabs their role can open: a picker photographs and checks nothing else; leads and the admin see all four.
import { can, html, type Ctx } from "../app";
import type { Raw } from "../html";
import { pick } from "../i18n";
import { LEADS } from "../roles";
import { tabs } from "@ak/ui/components";

export type IntakeTab = "progress" | "photograph" | "approvals" | "readiness";

export function intakeTabs(c: Ctx, current: IntakeTab, counts: Partial<Record<IntakeTab, number>> = {}): Raw {
  const L = c.lang;
  const items: { id: IntakeTab; label: string; href: string; lead: boolean }[] = [
    { id: "progress", label: pick(L, "Progress", "التقدّم"), href: "/intake", lead: false },
    { id: "photograph", label: pick(L, "Photograph", "التصوير"), href: "/capture", lead: false },
    { id: "approvals", label: pick(L, "Label approvals", "موافقات الملصقات"), href: "/label-queue", lead: true },
    { id: "readiness", label: pick(L, "Readiness", "الجاهزية"), href: "/readiness", lead: true },
  ];
  const mine = items.filter((x) => !x.lead || can(c, LEADS));
  return html`${tabs(mine.map((x) => ({ label: x.label, href: x.href, current: x.id === current, count: counts[x.id] })), pick(L, "Intake", "الإدخال"))}`;
}
