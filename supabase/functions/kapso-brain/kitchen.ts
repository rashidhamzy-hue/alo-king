// What is true about the kitchen after an order is placed (P0-3). A vendor is "linked" when someone can actually see and answer the order:
// an owner WhatsApp number, or a signed-in kitchen screen (staff profile) for that vendor. Otherwise it is a demo order (vendor not live) or
// the restaurant has not been reached. The customer is never told "the kitchen is confirming now" unless that is true. No I/O.

export type KitchenState = "linked" | "demo" | "unlinked";

export function kitchenState(o: { ownerLinked: boolean; hasKitchenScreen: boolean; isLive: boolean }): KitchenState {
  if (o.ownerLinked || o.hasKitchenScreen) return "linked";
  return o.isLive ? "unlinked" : "demo";
}

/** The last line of the "order received" message. */
export function receivedFooter(state: KitchenState, vendor: string, ar: boolean): string {
  if (state === "linked") return ar ? "المطبخ عم يأكد طلبك هلأ، رح خبرك. 👑" : "The kitchen is confirming it now, I'll keep you posted. 👑";
  if (state === "demo") return ar ? "🧪 هيدا طلب تجريبي: ما في مطعم حقيقي رح يحضّره. بتشوفو عالشاشة التجريبية للمطبخ." : "🧪 This is a demo order: no real restaurant will cook it. It shows up on our demo kitchen screen.";
  return ar
    ? `⏳ *${vendor}* مش مربوط بألو كينغ لسا، فطلبت من فريقنا يتواصل معهم. رح خبرك أول ما يردّوا، أو فيك تلغي من تحت.`
    : `⏳ *${vendor}* isn't connected to Alo King yet, so I've asked our team to reach them. I'll message you the moment they answer, or you can cancel below.`;
}

/** The 90-second follow-up while the order is still pending. Null = say nothing (a demo order has no one to wait for). */
export function stillWaitingText(state: KitchenState, code: string, vendor: string, ar: boolean): string | null {
  if (state === "demo") return null;
  if (state === "unlinked") return ar ? `⏳ لسا ما قدرنا نوصل لـ *${vendor}* بخصوص طلبك #${code}. فريقنا عم يتابع. فيك تلغي الطلب بأي وقت 🙏` : `⏳ We still haven't been able to reach *${vendor}* about order #${code}. Our team is on it. You can cancel any time 🙏`;
  return ar ? `⏳ طلبك #${code} لسا عم يتأكد منه *${vendor}*. نحنا عم نتابع 🙏` : `⏳ Order #${code} is still being confirmed by *${vendor}*. Hang tight, we're on it. 🙏`;
}
