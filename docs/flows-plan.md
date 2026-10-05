# WhatsApp Flow menu: feasibility and plan (flow item 7, no deploy)

Status: **research only. Nothing was created, published, sent or deployed.** This session has no `KAPSO_API_KEY` (by design: it lives in Supabase/GitHub secrets), so the Platform API was not called. Findings come from the Kapso docs and agent skills (`integrate-whatsapp`, `references/whatsapp-flows-spec.md`), Meta's Flows documentation mirrored in the Kapso knowledge base, and read-only Kapso MCP queries on our account.

## 1. Verdict

A Flow menu with multi-select and quantities **can be built and sent on our current number and account, with three open items that only the owner can close** (§5): Meta business verification, a data-endpoint host decision, and a Kapso API key supplied through secrets. It is **not a drop-in replacement for the numbered text list** (flow item 4): Flows have **no quantity stepper**, so quantities need one Dropdown per dish, and a dynamic menu needs a data endpoint plus encryption. Recommendation: ship the numbered list first (no infrastructure, no Meta dependency), then pilot one Flow for repeat customers and compare completion time (§7).

## 2. Our number and account (read-only MCP)

| Fact | Value | Meaning for Flows |
|---|---|---|
| Number | `+1 201-483-5474`, display name "Kabsi", production, `CONNECTED` | Flows can only be sent from a connected production number (a sandbox number is not the real channel). |
| Quality rating / tier | `GREEN` / `TIER_250` | Flows sent inside a customer's 24 h window are not business-initiated, so the tier does not limit them. |
| WABA review | `APPROVED` | Necessary, **not sufficient**: Flows publishing can fail with `OAuthException 139000 (Integrity)` until the business is verified in Meta's Security Center (Kapso skill, Troubleshooting). Verification status is not visible through the MCP. |
| Existing flows | none (no `flow_event` logs in 30 days) | Greenfield. |
| Messages | our interactive sends are `free_customer_service` | A Flow sent in the 24 h window is an interactive service message; no template needed. |

## 3. What the Flow would look like

Flow JSON `7.3` with `data_api_version: "3.0"` and a `routing_model` (dynamic flows require it; the Kapso skill pins 7.3).

Components that matter (Meta reference):

| Need | Component | Limits |
|---|---|---|
| Pick several dishes | `CheckboxGroup` (`min-selected-items`, `max-selected-items`, dynamic `data-source`) | one list per component; per-option title/description limits apply |
| Quantity per dish | `Dropdown` (options `0`..`9`) per dish, or `TextInput input-type: number` | **no stepper exists**; Dropdown max 200 options (100 with images) is about the option list, not about a dish count |
| Show/hide slots | `If` (up to 3 nested) or the dynamic `visible` property (documented for CheckboxGroup; confirm per component in the draft test) | the layout is static: a screen cannot create a variable number of components, only reveal pre-declared ones |
| Page through a long menu | `NavigationList` | 1-20 items per list |
| Whole screen budget | | **50 components per screen, 100 screens per flow**, 3 images and 1 MB per data-channel payload |

Recommended shape (two screens, about 12 dishes per page):

1. **MENU** screen: heading (vendor), then `N = 12` pre-declared "slots". Each slot is a `Dropdown` labelled `"<dish> · $4.50 · 402,750 LBP"` with options 0-9 and `visible: ${data.slot_k_visible}`, filled by the data endpoint from the live menu (ranked by popularity or by what the customer already asked for). Footer: **Continue**. A "More" action asks the endpoint for page 2 (`data_exchange`).
2. **CONFIRM** screen (terminal): read-only summary text built by the endpoint, with the server-priced subtotal, delivery fee and total in both currencies; footer **Add to basket** completes the flow.

Why 12 slots: each slot is 1 component, so 12 dropdowns + headings + footer stay well under 50 and under typical phone scroll depth. Dishes with required options (sauce, size) cannot be expressed in the same screen without multiplying slots: send those through the existing option lists (`CZ|…`) after the Flow returns, exactly as the numbered list does.

The same CheckboxGroup + Dropdown pattern in a **static** flow (menu baked in) is not viable: menus, prices and availability change daily, and a static flow would show stale prices.

## 4. What it needs

| Requirement | Detail | Who/what |
|---|---|---|
| **Flows encryption** | One-time per phone number. Kapso generates the key pair and uploads/signs the public key with Meta (`POST /platform/v1/whatsapp/flows/{id}/setup_encryption`, skill script `setup-encryption.js`). Meta re-requires the upload in some cases (key rotation, number re-registration). | Kapso + our API key |
| **Data endpoint** | Meta calls an endpoint on every screen transition. Kapso decrypts, verifies Meta's signature (`signature_valid`), and forwards `{source:"whatsapp_flow", flow, data_exchange:{action: INIT/data_exchange/BACK, screen, data, flow_token}}` to a **Kapso Function**; the function returns `{version:"3.0", screen, data}`. Kapso documents a 15 s response timeout and 100 requests/minute per flow. | Kapso Function (JS, no `export`) |
| **Where the menu logic lives** | Our menu, prices and hours are in Supabase and must stay server-owned. The Kapso Function would only call a **new Supabase edge function** (`flow-menu`, `verify_jwt` false, own shared secret in Supabase secrets and the Kapso function's env) that returns slot data. No price is ever taken from the flow response. | new function + `supabase/config.toml` entry |
| **Business verification** | Required to publish/send reliably (error 139000). Check Meta Business Settings → Security Center → Business verification. | **Owner** |
| **Completion handling** | The finished flow arrives on our existing webhook as `interactive.type = "nfm_reply"` with `response_json` (a JSON string: `flow_token` plus whatever the final payload carries). `replyFrom()` in `broadcast.ts` only understands `button_reply`/`list_reply`, so a new `nfm_reply` branch is needed that turns `{items:[{item_id, quantity}]}` into the existing `addItems` core (server prices, open check, options check, one basket card). | code, ~1 PR |
| **Customer authorisation** | `flow_token` alone is not proof of identity (Kapso spec). We mint the token when we send the Flow: an HMAC of `phone + vendor + expiry` with a server secret, store nothing on the client, and verify it when `nfm_reply` arrives (phone must match the sender, not expired, single use). | code + secret |
| **Sending** | `POST /meta/whatsapp/v24.0/{phone_number_id}/messages` `type:"interactive"`, `interactive.type:"flow"`, `parameters:{flow_message_version:"3", flow_id, flow_cta, flow_action:"navigate"/"data_exchange", flow_token, mode:"draft"|"published"}`. In-window only (24 h); outside it needs a template with a Flow button. | existing send path |
| **Testing** | `mode:"draft"` sends the draft to a test number before publishing; Kapso also provides preview links. | us |
| **Meta limits to respect** | 50 components/screen, 100 screens, one `Footer` mandatory on a terminal screen, payload keys must not use reserved names (`action`, `screen`, `data`). | build |

## 5. Open items that block a real build

1. **Is the business verified in Meta?** Unknown from here. Without it, publishing may fail with 139000. (Owner action, no code.)
2. **A Kapso API key available to whoever runs the setup scripts** (Supabase/GitHub secret; never pasted into chat or committed).
3. **Decision: data-endpoint hosting.** Recommended: Kapso Function as a thin proxy to a Supabase edge function (one extra hop, about 100-300 ms, but prices and hours stay in one place). Alternative: put the menu query inside the Kapso Function (duplicates the server-side pricing/hours rules; not recommended).
4. **Unverified and to confirm in a draft test:** how Arabic (RTL) renders in Dropdown labels with prices; whether Meta enforces a tighter latency budget than Kapso's 15 s (a slow endpoint shows the user an error screen); and whether Flows add any Meta fee (our reading: a Flow inside the service window is free, the template-with-Flow-button path is priced as its template category).

## 6. Rules this must keep (CLAUDE.md)

- **Server-side pricing**: the Flow carries only `item_id` and `quantity`; every amount shown in the Flow is produced by the server for display, and is recomputed when the items are added. Totals, fee and COD cap stay in the existing basket/checkout path.
- **Confirmation**: the Flow ends at "Add to basket"; the order still needs the customer's own **Confirm Order** tap on the server-built summary.
- **Dual currency** in every label and summary; **no secrets** in flow JSON, endpoint code, logs or chat (shared secrets in Supabase/Kapso secrets only); **consent** is unaffected (service messages, no promotions).

## 7. Plan and estimate

| Step | Output | Effort |
|---|---|---|
| 0 | Owner confirms business verification; API key placed in secrets | owner, 30 min |
| 1 | `flow-menu` edge function: slot data (top N dishes by popularity or by the customer's last order), tested against the real menu | 0.5 day |
| 2 | Flow JSON (2 screens) + Kapso Function proxy + `setup_encryption` + `mode:"draft"` test to one test phone | 0.5-1 day |
| 3 | `nfm_reply` handler + token mint/verify + tests | 0.5 day |
| 4 | Pilot to repeat customers behind a flag; compare **time from first message to basket** and basket completion against the numbered list (item 4), using the `turn_timing` logs | 1 week of traffic |

Decision rule: keep the Flow only if it beats the numbered list on time-to-basket for repeat customers by a margin that justifies the extra infrastructure (encryption keys, a second hosted function, Meta verification dependency). If not, the numbered list stays the default and the Flow is dropped.

## 8. Alternatives considered

- **Numbered text list** (flow item 4): no infrastructure, quantities parsed deterministically ("1x2, 3"), works in the 24 h window and on every client. Weakness: typing.
- **Native catalog / multi-product messages with a cart** (Meta commerce): has real quantity steppers, but needs a Commerce Manager catalog kept in sync with our menu and an order-message handler; not researched further here and not recommended before the Flow pilot.
