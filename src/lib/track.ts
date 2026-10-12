/**
 * Which of the five steps of the tracking page an order is on. Delivery and pickup share the first three; they differ at
 * the end (DECISIONS §37.6): a pickup order that is `ready` is at step 4, "Ready at the shop"; a delivery order that is
 * `ready` is still waiting for its driver.
 */
export function stepOf(status: string, pickup: boolean): number {
  switch (status) {
    case "placed":
    case "awaiting_payment":
      return 0;
    case "accepted":
      return 1;
    case "preparing":
    case "driver_assigned":
    case "heading_to_pickup":
    case "at_pickup":
      return 2;
    case "ready":
      return pickup ? 3 : 2;
    case "picked_up":
    case "near_drop":
    case "arrived":
      return 3;
    case "delivered":
      return 4;
    default:
      return 0;
  }
}
