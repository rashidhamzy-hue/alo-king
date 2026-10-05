// Per-stage timing for one webhook event: receive lag, database, model calls, sends. Pure helpers plus an AsyncLocalStorage so the
// fetch wrappers in index.ts can attribute time without threading a timer through every function. Logs numbers only: never content or phones.
import { AsyncLocalStorage } from "node:async_hooks";

export type Stage = "db" | "model" | "send" | "transcribe";
export type StageStat = { ms: number; n: number };
export type TimingSnapshot = Record<Stage, StageStat> & { total_ms: number; first_send_ms: number | null };

/** Flow-spec latency targets (docs/whatsapp-flow-spec.md §5), enforced by tests where the code path is deterministic. */
export const LATENCY_TARGETS = { tapMs: 1500, freeTextModelCalls: 1 } as const;

export class TurnTimer {
  private readonly t0: number;
  private first: number | null = null;
  private stages: Record<Stage, StageStat> = { db: { ms: 0, n: 0 }, model: { ms: 0, n: 0 }, send: { ms: 0, n: 0 }, transcribe: { ms: 0, n: 0 } };
  modelCalls = 0;
  constructor(private readonly clock: () => number = () => performance.now()) { this.t0 = clock(); }
  /** Times `fn` into `stage`. Overlapping calls (Promise.all) are summed, so a stage can exceed wall time. */
  async time<T>(stage: Stage, fn: () => Promise<T>): Promise<T> {
    const s = this.clock();
    try { return await fn(); }
    finally { const st = this.stages[stage]; st.ms += this.clock() - s; st.n++; if (stage === "model") this.modelCalls++; }
  }
  private bg: Promise<unknown>[] = [];
  /** Work started during the turn that must not be dropped when the turn ends (e.g. the read receipt). Never throws. */
  background(p: Promise<unknown>) { this.bg.push(p.catch(() => undefined)); }
  async drain() { await Promise.all(this.bg); }
  markFirstSend() { if (this.first === null) this.first = this.clock() - this.t0; }
  snapshot(): TimingSnapshot {
    const r = (x: number) => Math.round(x);
    const o = {} as TimingSnapshot;
    for (const k of Object.keys(this.stages) as Stage[]) o[k] = { ms: r(this.stages[k].ms), n: this.stages[k].n };
    o.total_ms = r(this.clock() - this.t0);
    o.first_send_ms = this.first === null ? null : r(this.first);
    return o;
  }
}

export const timerStore = new AsyncLocalStorage<TurnTimer>();
/** Times `fn` against the current turn's timer; a plain call when there is none (tests, scheduled jobs). */
export function timed<T>(stage: Stage, fn: () => Promise<T>): Promise<T> {
  const tm = timerStore.getStore();
  return tm ? tm.time(stage, fn) : fn();
}

/** Nearest-rank percentile, p in 1..100. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

export type TurnKind = "tap" | "text" | "voice" | "location" | "other";
export function turnKind(e: { reply?: unknown; text?: string; type?: string; loc?: unknown; audioUrl?: string }): TurnKind {
  if (e.reply) return "tap";
  if (e.loc) return "location";
  if (e.type === "audio" || e.audioUrl) return "voice";
  if (e.text) return "text";
  return "other";
}

/** Delay between WhatsApp's own timestamp (seconds, 1 s resolution) and now: Meta -> Kapso -> its buffer window -> us. */
export function receiveLagMs(waTimestamp: string | number | undefined, nowMs: number): number | null {
  const s = Number(waTimestamp);
  if (!Number.isFinite(s) || s <= 0) return null;
  return Math.max(0, nowMs - s * 1000);
}

export function summarize(tm: TurnTimer, extra: { kind: TurnKind; receive_lag_ms: number | null; model_calls: number }) {
  const s = tm.snapshot();
  return { kind: extra.kind, receive_lag_ms: extra.receive_lag_ms, total_ms: s.total_ms, first_send_ms: s.first_send_ms, model_calls: extra.model_calls,
    db: s.db, model: s.model, send: s.send, transcribe: s.transcribe };
}
