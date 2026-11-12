// Driver cash-on-hand gate. Mirror of driver_can_take() in SQL.
export interface CashCap { softUsd: number; hardUsd: number }
export type CashGate = "ok" | "soft_cap" | "hard_cap";

export function cashGate(cashOnHandUsd: number, orderCodUsd: number, cap: CashCap): CashGate {
  if (cashOnHandUsd >= cap.hardUsd) return "hard_cap";                      // no jobs at all until a drop
  if (orderCodUsd > 0 && cashOnHandUsd + orderCodUsd > cap.hardUsd) return "hard_cap"; // this job would breach the ceiling
  if (orderCodUsd > 0 && cashOnHandUsd >= cap.softUsd) return "soft_cap";   // prepaid jobs only
  return "ok";
}

/** USD equivalent of a mixed-currency handover at the order's snapshot rate. */
export function usdEquivalent(usd: number, lbp: number, lbpPerUsd: number): number {
  return Math.round((usd + lbp / lbpPerUsd) * 100) / 100;
}

/** Change owed to the customer, preferring USD notes the driver actually carries, remainder in LBP. */
export function changeDue(totalUsd: number, paidUsd: number, paidLbp: number, lbpPerUsd: number, smallestUsdNote = 1) {
  const over = usdEquivalent(paidUsd, paidLbp, lbpPerUsd) - totalUsd;
  if (over <= 0) return { usd: 0, lbp: 0, shortUsd: Math.round(-over * 100) / 100 };
  const usd = Math.floor(over / smallestUsdNote) * smallestUsdNote;
  const lbp = Math.round(((over - usd) * lbpPerUsd) / 1000) * 1000;       // round to the nearest 1,000 LBP
  return { usd, lbp, shortUsd: 0 };
}
