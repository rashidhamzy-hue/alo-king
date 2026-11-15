// The console's one stylesheet (redesigned in DS1). It is no longer written here: it is compiled at build time by Tailwind v4 from
// packages/ui (tokens.css and styles/console.css) into ui.generated.ts by `node packages/ui/scripts/build.mjs`, and served as
// /console.css. Mobile first: a bottom navigation on phones, a sidebar from 900 px. Logical properties throughout (inline/block,
// start/end), so right-to-left Arabic mirrors without a second sheet. Every control is at least --tap (44 px) high: buttons, inputs,
// selects, textareas, links used as buttons, and the navigation. test/shell.test.ts reads this text to hold that line.
import { UI_CSS } from "./ui.generated";
export const TAP_PX = 44;
export const CSS = UI_CSS;
