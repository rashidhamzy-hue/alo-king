// CON1: Label work (/labels), the one label-work flow of Products (intakeframe.ts). It draws the older pages' own handlers, unchanged:
//   /labels              the Progress board (intake.ts's page; /intake moves here)
//   /labels?step=facts   every item's food facts (foodfacts.ts's list; /food-facts moves here), under the flow's tab bar
// Item pages keep their addresses (/intake/<id>, /food-facts/<id>), and every form posts where it always did.
import { drawOlder, type Ctx, type Section } from "../app";
import { ALL, LEADS } from "../roles";
import { intakeTabs } from "./intakeframe";

async function page(c: Ctx) {
  if (c.url.searchParams.get("step") === "facts") return drawOlder(c, "/food-facts", intakeTabs(c, "facts"));
  return drawOlder(c, "/intake");
}

export const labelsSection: Section = {
  nav: { href: "/labels", label: "Label work", roles: LEADS },
  routes: [{ method: "GET", path: "/labels", roles: ALL, handler: page }],
};
