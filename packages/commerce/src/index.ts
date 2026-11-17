// The commerce core's typed client (docs/SYSTEM_PLAN.md section 1, session C4).
//
// The core is the SQL. This file holds no logic: each method calls one SQL function with its named arguments and returns what the
// function returned, typed. Prices, fees, stock, windows and order states are the database's (invariants 7, 19). Errors are
// thrown as CommerceError with the database's message (NO_SESSION, NOT_YOUR_ORDER, REQUEST_KEY_REUSED, ...).
//
// Two faces, because two kinds of caller hold two kinds of key:
//   webCommerce(db)     the website, connected as the database role web_channel. Every call takes the session token; the
//                       database finds the party from it. These are the only functions web_channel may execute (0132).
//   channelCommerce(db) the gateway and the console, with the service role: the same core plus what takes a party id
//                       (claim_link_code from the customer-line turn, plan_cart, quote_order, the card, the confirm tap).
// Neither face is given to an agent: the Concierge's tools never confirm (invariant 4).

/** The slice of supabase-js (or any PostgREST client) this needs: rpc only. */
export interface RpcSource {
  rpc(fn: any, args?: any): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
}

export class CommerceError extends Error {
  constructor(readonly fn: string, message: string, readonly code?: string) { super(`${fn}: ${message}`); this.name = "CommerceError"; }
}

async function call<T>(db: RpcSource, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new CommerceError(fn, error.message, error.code);
  return data as T;
}

// ---------- shapes the functions return ----------
export type PaymentMethod = "cod" | "whish" | "omt";
export type Channel = "whatsapp" | "catalog" | "web" | "console" | "app";

export interface QuoteIssue { code: string; [k: string]: unknown }
export interface QuoteLine {
  product_id: string; sku: string; name: string; name_ar: string | null; qty: number; unit: string | null;
  unit_price_usd: number; line_total_usd: number; source_id: string; source: string; ok: boolean; bought_to_order: boolean;
}
export interface DeliveryWindow { slot_id: string; [k: string]: unknown }
export interface Quote {
  ok: boolean; issues: QuoteIssue[]; lines: QuoteLine[];
  subtotal_usd: number; delivery_fee_usd: number; small_order_fee_usd: number; total_usd: number;
  fx_rate_lbp: number | null; total_lbp: number | null; eta_minutes: number | null; pickup: boolean;
  village_id: string | null; village: string | null; village_ar: string | null;
  slot_id: string | null; window: DeliveryWindow | null; bought_to_order: boolean;
  dues_usd?: number;
}
export interface CartItem { sku: string; qty: number; price?: number | null; currency?: string }
export interface Removed { sku: string; name?: string; name_ar?: string; reason: "unknown" | "out_of_stock" | "coming_soon" }
export interface PriceChanged { sku: string; name: string; name_ar: string | null; cart_price: number; price_usd: number }
/** plan_cart (0085): a cart read as quote lines and priced by quote_order. */
export interface CartPlan {
  ok: boolean; error?: string;
  lines: { sku: string; product_id: string; name: string; name_ar: string | null; qty: number; cart_price: unknown; currency: string | null }[];
  quote_lines: { product_id: string; qty: number }[];
  quote: Quote | null; issues: QuoteIssue[]; removed: Removed[]; price_changed: PriceChanged[];
  village_id: string | null; place_id: string | null; pickup: boolean; payment_method: PaymentMethod;
}
export interface CartView extends Partial<CartPlan> { ok: boolean; error?: string; cart_id: string | null; linked: boolean }
export interface CheckoutQuote extends Partial<CartPlan> { ok: boolean; error?: string; cart_id?: string | null; slot_id?: string | null; linked?: boolean; ready?: boolean }
export interface CardResult {
  created: boolean; reused?: boolean; error?: string; order_id?: string; short_code?: string; status?: string;
  payment_method?: PaymentMethod; change_for_usd?: number | null; quote?: Quote | null; issues?: QuoteIssue[];
  removed?: Removed[]; price_changed?: PriceChanged[];
}
export type ConfirmStatus = "confirmed" | "awaiting_payment" | "confirm_on_whatsapp" | "stale_quote" | "needs_location"
  | "change_too_late" | "slot_full" | "slot_closed" | (string & {});
export interface ConfirmResult {
  status: ConfirmStatus; changed: boolean; short_code?: string; reason?: string; order_status?: string;
  payment_method?: PaymentMethod; total_usd?: number; fx_rate_lbp?: number | null; issues?: QuoteIssue[];
  window?: DeliveryWindow | null; windows?: DeliveryWindow[]; replaces?: string;
}
export interface SessionStart { token: string; expires_at: string; linked: false }
export interface SessionState { valid: boolean; linked: boolean; expires_at?: string; linked_at?: string | null; code_waiting?: { code: string; expires_at: string } | null }
export type LinkCode = { ok: true; code: string; expires_at: string } | { ok: false; error: "already_linked" };
export type ClaimStatus = "linked" | "not_a_code" | "unknown" | "used" | "expired" | "not_customer";
export interface ClaimResult { ok: boolean; status: ClaimStatus; again?: boolean; session_id?: string }

/** The cart, checkout and session functions web_channel may execute (migration 0132), in the order the client lists them. */
export const WEB_SESSION_FUNCTIONS = [
  "web_session_start", "web_session_state", "web_session_end", "web_link_code",
  "cart_set_line", "cart_view", "checkout_quote", "checkout_order", "web_confirm_order",
] as const;
/** The catalog read functions (migrations 0154 and 0155, session WEB1): public, no token, no party. */
export const WEB_CATALOG_FUNCTIONS = ["web_catalog_home", "web_catalog_category", "web_catalog_product", "web_catalog_search"] as const;
/** The Food pages' functions (migration 0224, session LV1): the places listed before they sign. Never orderable; no price, stock or menu. */
export const WEB_LISTING_FUNCTIONS = ["web_food_list", "web_food_place", "web_listing_want", "web_listing_remove"] as const;
/** The join pages' functions (migration 0233, session UX3): an application to ride or to sell. An application is a case for staff, never a rider or a merchant. */
export const WEB_JOIN_FUNCTIONS = ["web_join_options", "web_join_state", "web_join_code", "web_apply_rider", "web_apply_vendor"] as const;
/** Everything the database role web_channel may execute. A test keeps this equal to the grants and to scripts/check_permissions.sh. */
export const WEB_CHANNEL_FUNCTIONS = [...WEB_SESSION_FUNCTIONS, ...WEB_CATALOG_FUNCTIONS, ...WEB_LISTING_FUNCTIONS, ...WEB_JOIN_FUNCTIONS] as const;

// ---------- the catalog pages' shapes ----------
export interface CatalogPicture {
  /** Key in the public `catalog` bucket: <SUPABASE_URL>/storage/v1/object/public/catalog/<path>. Only a picture a customer may see and the bucket holds. */
  path: string; licence: "cc_by_sa" | "brand_own" | "own_photo"; source_kind: string; attribution: string | null; source_url: string | null;
  width_px: number | null; height_px: number | null;
}
export interface CatalogCard {
  sku: string; name_en: string; name_ar: string | null; brand: string | null; sell_unit: string; price_usd: number; in_stock: boolean;
  /** SELL1 (0226): a packaged item with no label reading yet, while sell_requires_label is on. in_stock is false then; the site says "Coming soon". Absent on an older database. */
  coming_soon?: boolean; orderable?: boolean;
  picture: CatalogPicture | null;
}
export interface ServedVillage { name_en: string; name_ar: string | null; fee_usd: number; eta_minutes: number }
export interface CatalogHome {
  service: { open: string | null; close: string | null; tz: string | null; open_now: boolean | null; served: ServedVillage[] };
  categories: { code: string; name_en: string; name_ar: string; count: number }[];
  whatsapp: { home: string | null; product: string | null };
}
export type CatalogCategory =
  | { ok: false; error: "unknown_category" }
  | { ok: true; category: { code: string; name_en: string; name_ar: string };
      sections: { title_en: string | null; title_ar: string | null; items: CatalogCard[] }[]; whatsapp: string | null };
export interface CatalogFact {
  attribute: string; kind: "allergen" | "diet" | "ingredients" | "nutrition"; name_en: string; name_ar: string | null;
  /** false: no current approved, unexpired fact with a checked status. Value, detail and source are then null: say "not verified". */
  verified: boolean; value: string | null; detail: { text?: string; values?: Record<string, unknown>; per?: string; units?: unknown; ar?: string; lang?: string } | null;
  status: "certified" | "declared" | "calculated" | "not_verified"; source: string | null; reviewed_at: string | null;
}
/** A template field kept as a value (0203, `product_field_values`): the value only when it is approved and current, with where it came from. */
export interface CatalogField {
  key: string; group: string; type: "text" | "number" | "boolean" | "enum" | "list" | "range" | "evidence" | "facts"; unit: string | null;
  verified: boolean; value: unknown; source: string | null; reviewed_at: string | null;
}
/** Nutrition per 100 g or 100 ml (product_nutrition, 0204): present only for a fact-complete item of a template with a nutrition field. A number not printed is null. */
export interface CatalogNutrition {
  per: string; energy_kcal: number | null; fat_g: number | null; saturated_fat_g: number | null; carbohydrate_g: number | null; sugars_g: number | null;
  added_sugars_g: number | null; protein_g: number | null; fibre_g: number | null; salt_g: number | null; serving_size_g: number | null;
  status: string; source: string | null; reviewed_at: string | null;
}
/** An approved, unexpired printed claim with the printed words; only for a fact-complete item. */
export interface CatalogClaim { claim: string; name_en: string; name_ar: string; value: string | null; quote: string; source: string; reviewed_at: string | null }
export interface CatalogTemplate {
  code: string; name_en: string; name_ar: string; is_food: boolean; level: "not_sellable" | "sellable" | "fact_complete";
  /** The food groups this item's template has. A template without them (produce, water, cleaning, beauty, baby care, pet) has none. */
  groups: ("ingredients" | "allergens" | "diet" | "nutrition")[];
}
/** What the product page and its JSON-LD are both built from (web_catalog_product, 0218): one read, so they cannot disagree. */
export type CatalogProduct =
  | { ok: false; error: "unknown_product" }
  | { ok: true; product: Omit<CatalogCard, "picture"> & { name_fr: string | null; gtin: string | null; size: string | null };
      category: { code: string; name_en: string; name_ar: string }; template: CatalogTemplate;
      picture: CatalogPicture | null; facts: CatalogFact[]; nutrition: CatalogNutrition | null; claims: CatalogClaim[]; fields: CatalogField[];
      certificates: { kind: string; valid_until: string | null }[]; credit_open_food_facts: boolean; whatsapp: string | null };
export interface CatalogSearch { ok: boolean; q: string; matches: CatalogCard[]; reason: "too_short" | "no_match" | "none_pass" | null; filters?: Record<string, unknown> }

// ---------- the listings (LV1): a place listed before it signs ----------
/** What a listing holds, and all of it: a name, a kind, a village, the distance from the hub and a map link (maps_url is on the place's own read). */
export interface Listing { listing_id: string; name: string; kind: string; village: string | null; village_ar: string | null; km_from_hub: number }
export interface FoodList {
  ok: true; total: number; rows: Listing[]; kinds: { kind: string; count: number }[];
  villages: { village: string | null; village_ar: string | null; count: number }[]; whatsapp: string | null;
}
export type FoodPlace = { ok: false; error: "unknown_listing" } | { ok: true; listing: Listing & { maps_url: string }; whatsapp: string | null };
export type ListingWant = { ok: true; counted: boolean; capped?: boolean } | { ok: false; error: "no_session" | "unknown_listing" };
export type ListingRemove = { ok: true; hidden: boolean; already?: boolean; request_id?: string } | { ok: false; error: "no_session" | "bad_who" | "unknown_listing" };
export type RemoveWho = "owner" | "manager" | "staff" | "other";
export type ClaimListingResult =
  | { ok: false; status: "not_a_claim" | "unknown" }
  | { ok: true; status: "claimed"; again: boolean; listing_id: string; name: string; hidden: boolean; case: { case_id: string; opened?: boolean; after_hours?: boolean; opens?: string | null } };

// ---------- the join pages (UX3): /join/rider and /for-vendors ----------
export type JoinPurpose = "rider" | "vendor";
export interface JoinOptions {
  villages: { name_en: string; name_ar: string | null; served: boolean }[];
  shifts: { id: string; from: string; to: string }[]; vehicles: string[]; vendor_kinds: string[];
  cash_cap: { soft_usd: number; hard_usd: number }; fees: { min_usd: number; max_usd: number } | null; whatsapp: string | null;
}
export interface JoinState {
  valid: boolean; linked: boolean; code_waiting?: { code: string; expires_at: string } | null; application?: { id: string; name: string; created_at: string } | null;
}
export type JoinCode = { ok: true; code: string; expires_at: string } | { ok: false; error: "bad_purpose" | "no_session" | "already_linked" };
export type JoinError = "no_session" | "not_confirmed" | "bad_name" | "bad_village" | "bad_vehicle" | "bad_licence" | "bad_hours" | "bad_kind" | "limit";
export type JoinApplied = { ok: true; again: boolean; id: string; listing?: string | null } | { ok: false; error: JoinError };
export interface RiderApplication { name: string; village: string; vehicle: string; licence: boolean; days: string[]; shifts: string[] }
export interface VendorApplication { name: string; kind: string; village: string; listing?: string | null }

// ---------- the website (role web_channel) ----------
export function webCommerce(db: RpcSource) {
  return {
    startSession: (device?: string | null) => call<SessionStart>(db, "web_session_start", { p_device: device ?? null }),
    sessionState: (token: string) => call<SessionState>(db, "web_session_state", { p_token: token }),
    endSession: (token: string) => call<{ ok: boolean }>(db, "web_session_end", { p_token: token }),
    linkCode: (token: string) => call<LinkCode>(db, "web_link_code", { p_token: token }),
    setLine: (token: string, sku: string, qty: number, priceSeen?: number | null) =>
      call<CartView>(db, "cart_set_line", { p_token: token, p_sku: sku, p_qty: qty, p_price_seen: priceSeen ?? null }),
    viewCart: (token: string) => call<CartView>(db, "cart_view", { p_token: token }),
    checkoutQuote: (token: string, at: { place?: string | null; slot?: string | null; village?: string | null } = {}) =>
      call<CheckoutQuote>(db, "checkout_quote", { p_token: token, p_place: at.place ?? null, p_slot: at.slot ?? null, p_village: at.village ?? null }),
    checkoutOrder: (token: string, o: { requestKey: string; place: string; slot?: string | null; payment?: PaymentMethod | null;
                                        changeFor?: number | null; notes?: string | null }) =>
      call<CardResult>(db, "checkout_order", { p_token: token, p_request_key: o.requestKey, p_place: o.place, p_slot: o.slot ?? null,
        p_payment: o.payment ?? null, p_change_for: o.changeFor ?? null, p_notes: o.notes ?? null }),
    confirm: (token: string, orderId: string, requestKey: string) =>
      call<ConfirmResult>(db, "web_confirm_order", { p_token: token, p_order: orderId, p_request_key: requestKey }),
  };
}
export type WebCommerce = ReturnType<typeof webCommerce>;

// ---------- the website's catalog pages (role web_channel; no token, the catalog is public) ----------
export function webCatalog(db: RpcSource) {
  return {
    home: () => call<CatalogHome>(db, "web_catalog_home", {}),
    category: (code: string) => call<CatalogCategory>(db, "web_catalog_category", { p_code: code }),
    product: (sku: string) => call<CatalogProduct>(db, "web_catalog_product", { p_sku: sku }),
    /** The chat's search (find_products, 0214, through web_catalog_search, 0216) with the filters read from the box by the chat's reading
     *  step. Only items whose approved facts pass come back. A search that finds nothing is logged as demand by the database. */
    search: (text: string, limit = 12, filters: Record<string, unknown> = {}) =>
      call<CatalogSearch>(db, "web_catalog_search", { p_text: text, p_limit: limit, p_filters: filters }),
  };
}
export type WebCatalog = ReturnType<typeof webCatalog>;

// ---------- the Food pages (role web_channel; reads need no token, the two writes take the visitor's session) ----------
export function webListings(db: RpcSource) {
  return {
    list: (o: { kind?: string | null; village?: string | null; sort?: "distance" | "name"; limit?: number; offset?: number } = {}) =>
      call<FoodList>(db, "web_food_list", { p_kind: o.kind ?? null, p_village: o.village ?? null, p_sort: o.sort ?? "distance", p_limit: o.limit ?? 24, p_offset: o.offset ?? 0 }),
    place: (id: string) => call<FoodPlace>(db, "web_food_place", { p_id: id }),
    /** "I want to order from here": demand, once per anonymous session or signed-in customer. No contact detail. */
    want: (token: string, listing: string) => call<ListingWant>(db, "web_listing_want", { p_token: token, p_listing: listing }),
    /** "Remove this listing": the page is hidden at once and a staff case is raised. */
    remove: (token: string, listing: string, who: RemoveWho, reason?: string | null) =>
      call<ListingRemove>(db, "web_listing_remove", { p_token: token, p_listing: listing, p_who: who, p_reason: reason ?? null }),
  };
}
export type WebListings = ReturnType<typeof webListings>;

/** The join pages' reads and writes, as web_channel. The applicant's party always comes from the confirmed session, never from the request. */
export function webJoin(db: RpcSource) {
  return {
    options: () => call<JoinOptions>(db, "web_join_options", {}),
    state: (token: string, purpose: JoinPurpose) => call<JoinState>(db, "web_join_state", { p_token: token, p_purpose: purpose }),
    code: (token: string, purpose: JoinPurpose) => call<JoinCode>(db, "web_join_code", { p_token: token, p_purpose: purpose }),
    applyRider: (token: string, a: RiderApplication) =>
      call<JoinApplied>(db, "web_apply_rider", { p_token: token, p_name: a.name, p_village: a.village, p_vehicle: a.vehicle, p_licence: a.licence, p_days: a.days, p_shifts: a.shifts }),
    applyVendor: (token: string, a: VendorApplication) =>
      call<JoinApplied>(db, "web_apply_vendor", { p_token: token, p_name: a.name, p_kind: a.kind, p_village: a.village, p_listing: a.listing ?? null }),
  };
}
export type WebJoin = ReturnType<typeof webJoin>;

// ---------- the gateway and the console (service role) ----------
export function channelCommerce(db: RpcSource) {
  return {
    /** The customer-line turn, by code and before any model, when a message is "Claim <listing_id>" (LV1). A staff case; nothing is sent from here. */
    claimListing: (party: string, conversation: string, text: string, wamid?: string | null) =>
      call<ClaimListingResult>(db, "claim_listing", { p_party: party, p_conversation: conversation, p_text: text, p_wamid: wamid ?? null }),
    /** The customer-line turn, by code and before any model, when a message carries a link code. */
    claimLinkCode: (party: string, text: string, wamid?: string | null) =>
      call<ClaimResult>(db, "claim_link_code", { p_party: party, p_code: text, p_wamid: wamid ?? null }),
    /** "Sign out everywhere": the number of sessions ended. */
    revokeWebSessions: (party: string, reason?: string) =>
      call<number>(db, "web_sessions_revoke", { p_party: party, p_reason: reason ?? "sign_out_everywhere" }),
    planCart: (party: string | null, items: CartItem[], village?: string | null, catalog?: string | null) =>
      call<CartPlan>(db, "plan_cart", { p_party: party, p_items: items, p_village: village ?? null, p_catalog: catalog ?? null }),
    quoteOrder: (lines: { product_id: string; qty: number; source_id?: string }[], village?: string | null, pickup = false, slot?: string | null) =>
      call<Quote>(db, "quote_order", { p_lines: lines, p_village: village ?? null, p_pickup: pickup, p_slot: slot ?? null }),
    /** The card: a draft awaiting the customer's confirm action. A retried turn (same key, same basket) gets the same draft. */
    createOrderForTurn: (o: { turnKey: string | null; customer: string; conversation: string; lines: { product_id: string; qty: number }[];
                              village: string | null; place: string | null; pickup?: boolean; payment?: PaymentMethod;
                              changeFor?: number | null; notes?: string | null; slot?: string | null }) =>
      call<CardResult>(db, "create_order_for_turn", { p_turn_key: o.turnKey, p_customer: o.customer, p_conversation: o.conversation,
        p_lines: o.lines, p_village: o.village, p_place: o.place, p_pickup: o.pickup ?? false, p_payment: o.payment ?? "cod",
        p_change_for: o.changeFor ?? null, p_notes: o.notes ?? null, p_slot: o.slot ?? null }),
    /** The customer's confirm tap on WhatsApp: the message id is the evidence. */
    confirmTap: (order: string, party: string, wamid: string) =>
      call<ConfirmResult>(db, "confirm_order_checked", { p_order: order, p_party: party, p_wamid: wamid }),
    handleOrderButton: (order: string, action: "confirm" | "edit" | "cancel", party: string, wamid?: string | null) =>
      call<ConfirmResult>(db, "handle_order_button", { p_order: order, p_action: action, p_party: party, p_wamid: wamid ?? null }),
  };
}
export type ChannelCommerce = ReturnType<typeof channelCommerce>;
