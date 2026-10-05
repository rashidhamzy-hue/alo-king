// Start of every inbound message in ONE database round trip (was 6 sequential queries: dedupe insert, handoff lookup, owner lookup, customer upsert, last_inbound update, customer select).
// `bot_begin_turn` (migration 20261005180000) does them atomically in Postgres with the same semantics; until it is deployed the legacy queries run instead, so the order of
// deployment never matters. Pure of the Deno runtime: the Supabase client is injected so the round trips can be counted in tests.

export type SbLike = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>; from: (table: string) => any };
export type CustomerStart = { language: string | null; handoff_until: string | null; full_name: string | null; village: string | null; last_address: string | null; last_lat: number | null; last_lng: number | null };
export type TurnStart = { dup: boolean; handoffCustomer: string | null; owner: { vendor_id: string; name_en: string } | null; customer: CustomerStart | null; hasQuick: boolean; queries: number };

const CUST_COLS = "language,handoff_until,full_name,village,last_address,last_lat,last_lng";
const rpcMissing = (e: any) => e?.code === "PGRST202" || e?.code === "42883" || /could not find the function/i.test(String(e?.message ?? ""));

/** One upsert that records "the customer just wrote" and returns the profile row (a new customer row holds only the phone and last_inbound_at, as before). The language is set only when none is stored and one was detected. */
export async function touchCustomer(sb: SbLike, phone: string, lang: "ar" | "en" | null): Promise<CustomerStart | null> {
  const { data, error } = await sb.from("customers").upsert({ phone_number: phone, last_inbound_at: new Date().toISOString() }, { onConflict: "phone_number" }).select(CUST_COLS).single();
  if (error || !data) return null;
  if (lang && data.language == null) {
    await sb.from("customers").update({ language: lang, language_set_at: new Date().toISOString() }).eq("phone_number", phone).is("language", null);
    return { ...data, language: lang };
  }
  return data as CustomerStart;
}

export async function beginTurn(sb: SbLike, o: { messageId?: string; phone: string; norm: string; contextId?: string; touchCustomer: boolean; lang: "ar" | "en" | null }): Promise<TurnStart> {
  const { data, error } = await sb.rpc("bot_begin_turn", { p_message_id: o.messageId || null, p_phone: o.phone, p_norm: o.norm || null, p_context_id: o.contextId || null, p_touch: o.touchCustomer, p_lang: o.lang });
  if (!error && data) {
    if (data.dup) return { dup: true, handoffCustomer: null, owner: null, customer: null, hasQuick: false, queries: 1 };
    return { dup: false, handoffCustomer: data.hrow ?? null, owner: data.owner ?? null, customer: data.customer ?? null, hasQuick: data.has_quick === true, queries: 1 };
  }
  if (!rpcMissing(error)) console.error("bot_begin_turn failed, using the legacy queries", String(error?.message ?? error).slice(0, 160));
  // ---- legacy path: the same queries the bot always ran ----
  let queries = 1; // the failed rpc
  if (o.messageId) {
    queries++;
    const ins = await sb.from("processed_messages").insert({ message_id: o.messageId });
    if (ins.error) return { dup: true, handoffCustomer: null, owner: null, customer: null, hasQuick: false, queries };
  }
  queries += (o.contextId ? 1 : 0) + (o.norm ? 1 : 0);
  const [h, ow] = await Promise.all([
    o.contextId ? sb.from("handoff_log").select("customer_phone").eq("admin_message_id", o.contextId).maybeSingle() : Promise.resolve({ data: null }),
    o.norm ? sb.from("vendors").select("vendor_id,name_en").eq("owner_whatsapp_phone", o.norm).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const handoffCustomer = h?.data?.customer_phone ?? null, owner = ow?.data ?? null;
  let customer: CustomerStart | null = null;
  if (o.touchCustomer && !handoffCustomer && !owner) { customer = await touchCustomer(sb, o.phone, o.lang); queries += o.lang ? 2 : 1; }
  return { dup: false, handoffCustomer, owner, customer, hasQuick: true, queries }; // hasQuick unknown: true keeps the old "always clear" behaviour
}
