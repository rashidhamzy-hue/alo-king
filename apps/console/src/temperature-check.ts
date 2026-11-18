// The console Worker's two-minute temperature check (WH1a, 0240). It names its one argument: PostgREST finds a function by the argument
// names it is sent, and a call with none found nothing (Sentry ALO-KING-GATEWAY-6, 18 November 2026).
import type { Db } from "./db";

export const runTemperatureCheck = (db: Pick<Db, "rpc">, now: Date = new Date()) =>
  db.rpc<{ missed: unknown[] }>("temperature_log_check", { p_now: now.toISOString() });
