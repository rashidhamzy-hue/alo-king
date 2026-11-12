// Mirror of the order_transitions table, for fast checks and for tests.
// The database function transition_order() is the authority; this file must match its seed rows.
export type OrderStatus =
  | "draft" | "awaiting_confirmation" | "awaiting_payment" | "confirmed" | "preparing" | "ready"
  | "out_for_delivery" | "arrived" | "delivered" | "closed" | "cancelled" | "failed_delivery" | "returned";
export type Actor = "customer" | "agent" | "driver" | "merchant" | "picker" | "ops" | "system";

export const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, Actor[]>>> = {
  draft: { awaiting_confirmation: ["agent"], cancelled: ["customer", "ops", "system"] },
  awaiting_confirmation: { draft: ["customer", "agent"], confirmed: ["customer"], awaiting_payment: ["customer"], cancelled: ["customer", "ops", "system"] },
  awaiting_payment: { confirmed: ["ops", "system"], cancelled: ["customer", "ops", "system"] },
  confirmed: { preparing: ["picker", "merchant", "system"], cancelled: ["customer", "ops"] },
  preparing: { ready: ["picker", "merchant", "system"], cancelled: ["ops"] },
  ready: { out_for_delivery: ["driver", "system"], delivered: ["picker", "ops"], cancelled: ["ops"] },
  out_for_delivery: { arrived: ["driver", "system"], failed_delivery: ["driver", "ops"] },
  arrived: { delivered: ["driver"], failed_delivery: ["driver", "ops"] },
  failed_delivery: { out_for_delivery: ["ops"], returned: ["driver", "picker", "ops"] },
  delivered: { closed: ["system", "ops"] },
  returned: { closed: ["system", "ops"] },
  closed: {},
  cancelled: {},
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** The agent is never an actor on confirmation, payment, or anything after it. */
export const AGENT_MAY_REACH: OrderStatus[] = ["draft", "awaiting_confirmation"];
