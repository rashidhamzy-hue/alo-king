// B1a: the three measures its "done when" names, read by code from what a run recorded, so a run on main can be set against SIM1's
// baseline (docs/SIM_REPORT_2026-11-15.md) on the same definitions. Each reads only replies and the judge's flags.
//  - minimum-order loop: the minimum was mentioned in two or more turns, at least once without an amount ($). Code's minimum line
//    always carries the minimum, the basket and the gap, so a loop of it alone is never counted; SIM1's model never could.
//  - lost basket: «you have no open order» said after the first turn (the status shortcut answering mid-order, SIM1 fix 3).
//  - wrong product: the judge's wrong_or_uninvited_product (its rubric made explicit after run 43730014902: see basketSection).
// SIM1's first run, first 150 scenarios (sim-001 to sim-150, all judged): loops 66, lost baskets 11, wrong products 40;
// all 463 judged first attempts: 227, 40, 143.
import type { ConversationResult } from "./run";

export const MINIMUM_WORDS = /الحد الأدنى|minimum|minimal|7ad el adna|7add el adna|montant minimum/i;
export const NO_OPEN_ORDER = /ما عندك طلب مفتوح|no open order|pas de commande en cours|aucune commande/i;
const AMOUNT = /\$\d/;

export interface BasketMeasures { minimumLoop: boolean; minimumWithoutAmount: boolean; lostBasket: boolean; wrongProduct: boolean }

export function basketMeasures(r: ConversationResult): BasketMeasures {
  const said = r.turns.map((t) => t.replies.filter((m) => MINIMUM_WORDS.test(m.text)));
  const turns = said.filter((x) => x.length > 0);
  const bare = turns.filter((x) => !x.some((m) => AMOUNT.test(m.text)));
  return {
    minimumLoop: turns.length >= 2 && bare.length >= 1,
    minimumWithoutAmount: bare.length > 0,
    lostBasket: r.turns.slice(1).some((t) => t.replies.some((m) => NO_OPEN_ORDER.test(m.text))),
    wrongProduct: !!r.verdict?.wrong_or_uninvited_product,
  };
}

/** SIM1's counts on the same definitions (first attempts of run 43696512658). */
export const SIM1_BASELINE = { first150: { conversations: 150, minimumLoop: 66, lostBasket: 11, wrongProduct: 40 },
                               all: { conversations: 463, minimumLoop: 227, lostBasket: 40, wrongProduct: 143 } } as const;

/** The section of the report: each measure now, SIM1's rate on the same scenarios, and the change. */
export function basketSection(judged: ConversationResult[]): string[] {
  const n = judged.length;
  if (!n) return [];
  const m = judged.map(basketMeasures);
  const count = (k: keyof BasketMeasures) => m.filter((x) => x[k]).length;
  const onlyFirst150 = judged.every((r) => Number(r.id.slice(4)) <= 150);
  const base = onlyFirst150 && n === 150 ? SIM1_BASELINE.first150 : SIM1_BASELINE.all;
  const row = (label: string, k: "minimumLoop" | "lostBasket" | "wrongProduct") => {
    const now = count(k) / n, was = base[k] / base.conversations;
    return `| ${label} | ${count(k)} (${(100 * now).toFixed(1)}%) | ${base[k]} of ${base.conversations} (${(100 * was).toFixed(1)}%) | ${was ? `${(100 * (now - was) / was).toFixed(0)}%` : "-"} |`;
  };
  return ["## Basket integrity (B1a measures)", "",
    `Definitions in \`evals/sim/basket-measures.ts\`. Baseline: SIM1's first run, ${base === SIM1_BASELINE.first150 ? "the same first 150 scenarios" : "all judged first attempts"}.`, "",
    "| measure | this run | SIM1 | change in rate |", "| --- | --- | --- | --- |",
    row("minimum-order loop", "minimumLoop"), row("lost basket («no open order» mid-order)", "lostBasket"), row("wrong or uninvited product (judge)", "wrongProduct"),
    `| minimum said without its amount (any turn) | ${count("minimumWithoutAmount")} | | |`, "",
    "The judge's rubric for a wrong product was made explicit after the second B1a run (43730014902): what the customer added themselves, " +
    "to reach the minimum or on second thought, is what they asked for. That run's 54 flags, read one by one: 17 were the customer's own " +
    "additions, 3 had no wrong product, 34 were the shop's. SIM1's 40 were judged on the old wording and were not read one by one.", ""];
}
