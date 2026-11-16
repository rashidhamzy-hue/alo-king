// LB1 (16 November): the basket after each turn, for the judge. The basket is the conversation's own record of what it holds
// (ConversationState.lastQuote: the lines, named from the last quote), never reconstructed from the shop's words. The judge reads it
// beside what the customer said, so a count or an item the customer added themselves is seen as theirs, not as the shop's mistake
// (about a third of the wrong products in every run of 150: HANDOFF, B1d). A measurement change: no ordering code reads this.
interface HeldState {
  lastQuote?: { lines?: { product_id: string; qty: number | string }[]; quote?: { lines?: { product_id: string; name?: string | null }[] } | null } | null;
}

/** "2 × name" rows of the basket held in a conversation's state; null when nothing is held. */
export function basketRows(state: HeldState | null | undefined): string[] | null {
  const held = state?.lastQuote;
  if (!held?.lines?.length) return null;
  const names = new Map<string, string>();
  for (const l of held.quote?.lines ?? []) if (l.product_id && l.name && !names.has(l.product_id)) names.set(l.product_id, l.name);
  return held.lines.map((l) => `${Number(l.qty)} × ${names.get(l.product_id) ?? `(unnamed product ${l.product_id})`}`);
}

/** The line the judge reads under each of the shop's replies. */
export const basketLine = (rows: string[] | null | undefined): string => `BASKET NOW: ${rows?.length ? rows.join("; ") : "nothing held"}`;
