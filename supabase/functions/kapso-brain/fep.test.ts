import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fepWindow, isFepActive, referralRecord } from "./fep.ts";

const REF = { source_type: "ad", source_id: "1203", source_url: "https://fb.me/x", headline: "Free delivery this week", ctwa_clid: "AbCdEf123", body: "ignored" };
const msg = (over: Record<string, unknown> = {}) => ({ id: "wamid.IN1", timestamp: "1791224000", type: "text", from: "9613956917", referral: REF, ...over });

describe("referralRecord: a Click-to-WhatsApp click on an inbound message", () => {
  it("records the ad source, id and click id, the message id and when it arrived", () => {
    const r = referralRecord(msg(), msg(), Date.parse("2026-10-05T12:00:00Z"));
    expect(r).toEqual({ message_id: "wamid.IN1", source_type: "ad", source_id: "1203", source_url: "https://fb.me/x", headline: "Free delivery this week", ctwa_clid: "AbCdEf123", referral_at: new Date(1791224000 * 1000).toISOString() });
  });
  it("is null for an ordinary message, an empty referral, or a missing message id", () => {
    expect(referralRecord({ id: "w", from: "1", type: "text" }, {}, 0)).toBeNull();
    expect(referralRecord(msg({ referral: {} }), {}, 0)).toBeNull();
    expect(referralRecord(msg({ id: undefined }), {}, 0)).toBeNull();
    expect(referralRecord(null, null, 0)).toBeNull();
  });
  it("falls back to now when the message has no usable timestamp; clips long fields; never stores the ad body", () => {
    const r = referralRecord(msg({ timestamp: "abc", referral: { ...REF, headline: "h".repeat(500), source_url: "u".repeat(900) } }), {}, Date.parse("2026-10-05T12:00:00Z"))!;
    expect(r.referral_at).toBe("2026-10-05T12:00:00.000Z");
    expect(r.headline!.length).toBeLessThanOrEqual(200); expect(r.source_url!.length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(r)).not.toContain("ignored");
  });
  it("reads the referral from the event when the message does not carry it", () => {
    const r = referralRecord(msg({ referral: undefined }), { referral: REF }, 0);
    expect(r?.source_id).toBe("1203");
  });
});

describe("fepWindow: Meta's free entry point window", () => {
  const opened = Date.parse("2026-10-05T12:00:00Z");
  it("lasts 72 hours from the first reply, and is open only inside it", () => {
    const w = fepWindow(opened);
    expect(Date.parse(w.expires_at) - Date.parse(w.opens_at)).toBe(72 * 3600_000);
    expect(isFepActive(w, opened + 71 * 3600_000)).toBe(true);
    expect(isFepActive(w, opened + 72 * 3600_000)).toBe(false);
    expect(isFepActive(w, opened - 1)).toBe(false);
  });
});

const ROOT = resolve(__dirname, "../../..");
describe("storage, wiring, and no change to sending", () => {
  const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const mig = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => /free_entry_point|fep_/.test(f)).map((f) => readFileSync(resolve(ROOT, "supabase/migrations", f), "utf8")).join("\n");
  it("the referral is recorded (once per message) for customers, not for owners, and cleared by 'delete my data' and the 90-day purge", () => {
    expect(src).toMatch(/fep_referrals"\)\.upsert\(/);
    expect(src).toMatch(/onConflict: "message_id", ignoreDuplicates: true/);
    expect(src).toMatch(/fep_referrals"\)\.delete\(\)\.eq\("customer_phone", phone\)/);
    expect(src).toMatch(/fep_referrals"\)\.delete\(\)\.lt\("created_at"/);
  });
  it("fep.ts never sends anything (tracking only)", () => {
    const fep = readFileSync(resolve(__dirname, "fep.ts"), "utf8");
    expect(fep).not.toMatch(/fetch\(|rawSend|sendText|api\.kapso/);
  });
  it("the migration: table with RLS, no anon/authenticated access, per-customer window view, and the free-share report", () => {
    expect(mig).toMatch(/create table if not exists public\.fep_referrals/i);
    expect(mig).toMatch(/enable row level security/i);
    expect(mig).toMatch(/revoke all on .*fep_referrals.* from anon, authenticated/is);
    expect(mig).toMatch(/create or replace view public\.customer_fep_windows/i);
    expect(mig).toMatch(/create or replace view public\.message_free_share_daily/i);
    expect(mig).toMatch(/free_entry_point/); // Meta's pricing.type for messages free inside the window
  });
});
