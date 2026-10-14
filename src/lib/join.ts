// "Ask them to join" (DECISIONS §39.3). The button opens the `site-claim` edge function in the customer's own browser: the
// function counts the tap against the address the platform saw (nothing the page or the visitor sends can choose the
// key), then redirects to the customer's own WhatsApp, open on the shop's number when the seed number is a Lebanese
// mobile (else with no number), with an invitation ready to send. Alo King never messages the shop itself (§25).
// The function, its invitation and its tests: supabase/functions/_shared/site-claim.ts.
import { SUPABASE_URL } from "./config";
import type { SiteLang } from "./site";

/** The counted "Ask them to join" link for a shop that is not on Alo King yet. */
export const askToJoinUrl = (slug: string, lang: SiteLang, base: string = SUPABASE_URL) =>
  `${base.replace(/\/+$/, "")}/functions/v1/site-claim?action=join&slug=${encodeURIComponent(slug)}&lang=${lang}&ch=web`;
