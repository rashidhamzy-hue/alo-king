import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { failureFromBody, failureKind, incidentAlertText, isPaused, pausedNotice } from "./sendguard.ts";

describe("failureKind: the two failures that must stop broadcasts", () => {
  it("131042 is a payment-eligibility failure, 130429 and HTTP 429 are rate limits, everything else is not ours to pause on", () => {
    expect(failureKind(131042)).toBe("payment");
    expect(failureKind(130429)).toBe("rate_limit");
    expect(failureKind(undefined, 429)).toBe("rate_limit");
    for (const c of [131026, 131049, 131047, 0, NaN, null, undefined]) expect(failureKind(c as any)).toBeNull();
    expect(failureKind(undefined, 500)).toBeNull();
  });
});
describe("failureFromBody: a send that failed straight away (HTTP error)", () => {
  it("reads Meta's / Kapso's error code from the JSON body and the HTTP status", () => {
    expect(failureFromBody(400, JSON.stringify({ error: { code: 131042, message: "Business eligibility payment issue" } }))).toEqual({ kind: "payment", code: 131042 });
    expect(failureFromBody(429, JSON.stringify({ error: { code: 130429 } }))).toEqual({ kind: "rate_limit", code: 130429 });
    expect(failureFromBody(429, "Too Many Requests")).toEqual({ kind: "rate_limit", code: null });
  });
  it("other errors and garbage give null, never throw", () => {
    expect(failureFromBody(400, JSON.stringify({ error: { code: 131009 } }))).toBeNull();
    expect(failureFromBody(500, "<html>")).toBeNull();
    expect(failureFromBody(200, "")).toBeNull();
  });
});
describe("messages", () => {
  const until = "2026-10-06T10:30:00.000Z";
  it("the admin alert names the failure, the Meta code and when sending resumes, says it is sent once, and carries no secret-looking data", () => {
    const p = incidentAlertText("payment", 131042, until), r = incidentAlertText("rate_limit", 130429, until);
    expect(p).toContain("131042"); expect(p).toMatch(/payment/i); expect(p).toMatch(/once/i); expect(p).toMatch(/13:30/); // Asia/Beirut is UTC+3 in October
    expect(r).toContain("130429"); expect(r).toMatch(/rate/i);
    expect(p).not.toMatch(/key|token|secret/i);
  });
  it("the owner is told, in their language, that offers are paused and until when; nothing about Meta internals", () => {
    expect(pausedNotice(until, false)).toMatch(/paused/i); expect(pausedNotice(until, false)).toContain("13:30");
    expect(pausedNotice(until, true)).toMatch(/[؀-ۿ]/); expect(pausedNotice(until, true)).toContain("13:30");
    expect(pausedNotice(until, false)).not.toMatch(/131042|130429|payment/i);
  });
  it("isPaused", () => {
    expect(isPaused(until, Date.parse("2026-10-06T10:00:00Z"))).toBe(true);
    expect(isPaused(until, Date.parse("2026-10-06T10:30:00Z"))).toBe(false);
    expect(isPaused(null, 0)).toBe(false); expect(isPaused("garbage", 0)).toBe(false);
  });
});

const ROOT = resolve(__dirname, "../../..");
describe("wiring", () => {
  const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  it("status webhooks: failed statuses with 131042 / 130429 are recorded as an incident (atomic RPC), alerting the admin only when the RPC says so", () => {
    expect(src).toMatch(/rpc\("record_send_failure"/);
    expect(src).toMatch(/failureKind\(r\.error_code\)/);
    expect(src).toMatch(/incidentAlertText\(/);
  });
  it("broadcasts: paused before anything is claimed or reserved, and the send loop stops at the first rate-limit / payment failure (no retry of the failing recipients)", () => {
    const i = src.indexOf("async function runBroadcast");
    const body = src.slice(i, i + 4200);
    expect(body.indexOf("send_paused_until")).toBeGreaterThan(0);
    expect(body.indexOf("send_paused_until")).toBeLessThan(body.indexOf("update({ status: \"sending\""));
    expect(body).toMatch(/stopKind/);
    expect(body).toMatch(/if \(stopKind\) /); // remaining recipients are skipped and credited back
  });
  it("there is no retry loop around sends (a failed message is never re-sent in a tight loop)", () => {
    expect(src).not.toMatch(/while \(true\)[\s\S]{0,200}rawSend/);
    expect(src).not.toMatch(/for \(let attempt/);
  });
  const mig = readdirSync(resolve(ROOT, "supabase/migrations_legacy")).filter((f) => /send_incidents/.test(f)).map((f) => readFileSync(resolve(ROOT, "supabase/migrations_legacy", f), "utf8")).join("\n");
  it("the migration: incidents table with RLS, atomic record_send_failure with a backoff ladder per kind, service-role-only functions", () => {
    expect(mig).toMatch(/create table if not exists public\.send_incidents/i);
    expect(mig).toMatch(/enable row level security/i);
    expect(mig).toMatch(/create or replace function public\.record_send_failure/i);
    expect(mig).toMatch(/for update/i);
    expect(mig).toMatch(/create or replace function public\.send_paused_until/i);
    expect(mig).toMatch(/revoke all on function public\.record_send_failure.*from public, anon, authenticated/is);
    expect(mig).toMatch(/grant execute on function public\.record_send_failure.* to service_role/is);
  });
});
