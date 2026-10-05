// Cheap routing for simple turns (flow spec item 5). Pure: decides which model answers; nothing here calls a model.
// Off by default (CHEAP_ROUTER_ENABLED). Conservative on purpose: only clearly informational, read-only turns go to the cheap model;
// anything that orders, changes a basket, confirms, cancels, complains or contains a number goes to the main model.

/** Strictly "true" (any case, spaces ignored) turns it on; everything else, including unset, is off. */
export const cheapRouterEnabled = (v: string | undefined | null): boolean => String(v ?? "").trim().toLowerCase() === "true";

// Tools the cheap model may use: read-only, plus an escape hatch back to the main model. No basket, checkout, confirm, cancel or handoff tool.
export const CHEAP_TOOL_NAMES = ["search_menu", "get_vendor_info", "present_offer", "show_menu", "basket_show", "needs_full_assistant"];

const normArabic = (s: string) => s.replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const norm = (s: string) => normArabic(String(s ?? "")).toLowerCase().replace(/[.,!?؟،"'`]+/g, " ").replace(/\s+/g, " ").trim();

// Anything that acts, decides, complains or carries a quantity: never cheap.
const MAIN_ONLY = new RegExp([
  "(?<![a-z])[\\d٠-٩]+(?![a-z])|\\b\\d+\\s?x\\b|\\bx\\s?\\d+\\b", // quantities, addresses, floors, times (but not the digits inside Arabizi words like 3endkon)
  "\\b(order|add|remove|change|checkout|check out|confirm|cancel|yes|no|nope|ok|okay|sure|pay|refund|late|cold|wrong|missing|where is|status|reorder|usual|delete|forget|person|human|agent|name|address|my basket|my order|basket|cart|want|get me|i'll take|ill take|give me|can i get|can i have|make it|instead|swap|more|less|arrive|arrives|arrival|eta|on the way|allerg\\w*|intoleran\\w*|celiac|coeliac|gluten|nuts?|peanuts?|sesame|sick|poison\\w*|terrible|complain\\w*|problem|issue|vegans?|vegetarians?|halal|keto|diabet\\w*|pregnan\\w*)\\b",
  "بدي|اطلب|ضيف|شيل|غير|تاكيد|الغي|الغاء|نعم|(?:^|\\s)لا(?:\\s|$)|حساسيه|تسمم|شكوي|مشكله|سكري|حامل|نباتي|استرجاع|تاخر|بارد|غلط|وين طلبي|طلبي|سلتي|اسمي|عنواني|احذف|امسح|شخص|موظف",
  "\\b(badde|baddi|bade|beddi|bidi|talab|e7zef|emsa7|7ada|shakhs|talabi)\\b",
].join("|"));

const INFO = new RegExp([
  "^(hi|hello|hey|hiya|good (morning|afternoon|evening)|thanks|thank you|thx|merci|marhaba|ahla|ahlan|salam|shokran|shukran)( there| all| alo king)?$",
  "^(مرحبا|اهلا|اهلين|سلام|هلا|شكرا|يسلمو|مساء الخير|صباح الخير)$",
  "\\b(what (?:s |is |are )?(?:good|popular|best|new|on the menu|available|open)|what do you (have|recommend|offer|serve)|show me the menu|(the )?menu|recommend|suggest|any (offers|deals|specials)|offers|deals|hungry|craving)\\b",
  "\\b(do you deliver|are you open|open now|opening hours|what time do you (open|close)|how much is (the )?delivery|delivery (fee|time|areas?)|how long (?:does|is) (?:the )?delivery (?:take|time))\\b",
  "شو (في|عندكم|الافضل|اطيب)|رشحلي|اقترح|المنيو|هل (في|عندكم) توصيل|كم (سعر )?التوصيل|متي (بتسكروا|بتفتحوا)|مفتوح|عروض",
  "\\b(shu fi|shou fi|shu 3endkon|shou 3ndkon|shou 3endkon|shu 3ndkon|rashe7li|2tere7)\\b",
].join("|"));

/** A model may only run tools it was actually given: an undeclared (hallucinated) tool name is rejected, never dispatched. */
export const isDeclaredTool = (tools: { name: string }[], name: string): boolean => tools.some((t) => t.name === name);

export type RouteCtx = { pendingCart: boolean; activeBaskets?: number; fromVoice?: boolean };
export function routeTurn(text: string, ctx: RouteCtx): "cheap" | "main" {
  const t = norm(text);
  if (!t || t.length > 70) return "main";
  if (ctx.pendingCart || ctx.fromVoice) return "main"; // someone is mid-order, or this came from a replayed voice note
  if (MAIN_ONLY.test(t)) return "main";
  return INFO.test(t) ? "cheap" : "main";
}
