// WEB4a: what the reference's frame shows on every page (components/ref/Frame.tsx), read from the database through the website's role:
// the served villages with their fee and time and the hours (web_service_facts), the visitor's village (the `ak_village` cookie holds its id
// only: the village is all the site keeps), and the basket's count and items total (cart_view), read only when the `ak_b` cookie says the
// basket is not empty. A failed read draws the frame without that part; it never fails the page.
import { tokenOf } from "./session";
import { commerce, ordering, safeBack } from "./order";
import { chatBase, nameIn, type Lang } from "./i18n";
import type { WebEnv } from "./db";
import type { FrameData, PickerVillage } from "../components/ref/Frame";

export const villageIdOf = (cookie: string | null | undefined): string | null => /(?:^|;\s*)ak_village=([0-9a-f-]{36})(?:;|$)/.exec(cookie ?? "")?.[1] ?? null;
export const basketCountOf = (cookie: string | null | undefined): number => Number(/(?:^|;\s*)ak_b=(\d{1,3})(?:;|$)/.exec(cookie ?? "")?.[1] ?? 0);
/** A page that shows something of this visitor's (their village, their basket) is not the same for everyone: the Worker must not cache it. */
export const personal = (cookie: string | null | undefined): boolean => villageIdOf(cookie) !== null || basketCountOf(cookie) > 0;
/** The village cookie: the village's id, nothing else (no position, no name). */
export const villageCookie = (id: string | null): string => id
  ? `ak_village=${id}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax; Secure; HttpOnly`
  : "ak_village=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly";

export interface FrameOpts { lang: Lang; path: string; q?: string; live?: boolean; focus?: boolean; basketCount?: number | null }

export async function frameOf(env: WebEnv, cookie: string | null, o: FrameOpts): Promise<FrameData> {
  const f: FrameData = { lang: o.lang, path: o.path, q: o.q ?? "", live: !!o.live, chat: null, villages: [], village: null, open: null, opens: null, hours: null,
    basket: null, min: null, focus: !!o.focus };
  const count = o.basketCount ?? basketCountOf(cookie);
  const token = tokenOf(cookie);
  const [facts, cart] = await Promise.all([
    ordering(env).serviceFacts().catch(() => null),
    count > 0 && token ? commerce(env).viewCart(token).catch(() => null) : Promise.resolve(null),
  ]);
  if (facts) {
    f.villages = (facts.served ?? []).map((v: any): PickerVillage => ({ id: String(v.village_id), name: nameIn(o.lang, v.name_en, v.name_ar), fee: Number(v.fee_usd), eta: Number(v.eta_minutes) }));
    const id = villageIdOf(cookie);
    f.village = f.villages.find((v) => v.id === id) ?? null;
    f.open = facts.open_now ?? null;
    const h = facts.hours;
    if (h?.open && h?.close) { f.hours = `${h.open.slice(0, 5)}–${h.close.slice(0, 5)}`; f.opens = h.open.slice(0, 5); }
    f.chat = chatBase(facts.whatsapp);
    f.min = Number(facts.min_order_usd) > 0 ? Number(facts.min_order_usd) : null;
  }
  if (count > 0) {
    const lines = cart?.lines ?? null;
    const n = lines ? lines.reduce((a: number, l: any) => a + Number(l.qty), 0) : count;
    const total = cart?.quote?.subtotal_usd;
    f.basket = n > 0 ? { count: n, total: total !== undefined && total !== null ? Number(total) : null } : null;
  }
  return f;
}

/** Where a picker sends the visitor back, with `v=set` when a village was kept: a path of this site (safeBack) and, at most, a plain anchor on it. */
export function backTo(raw: string | null | undefined, set: boolean): string {
  const [p = "", h = ""] = String(raw ?? "").split("#", 2);
  const path = safeBack(p, "/");
  const hash = /^[a-z][a-z0-9-]{0,30}$/.test(h) ? `#${h}` : "";
  return `${set ? `${path}${path.includes("?") ? "&" : "?"}v=set` : path}${hash}`;
}
