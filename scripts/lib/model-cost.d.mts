// Types for scripts/lib/model-cost.mjs (COST1), for the TypeScript evals that import it.
export interface PriceRow {
  model: string; effective_from: string; input_usd_per_mtok: number; output_usd_per_mtok: number;
  long_context_above_tokens: number | null; long_input_usd_per_mtok: number | null; long_output_usd_per_mtok: number | null;
  cache_read_usd_per_mtok: number | null; cache_write_usd_per_mtok: number | null;
}
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; searches?: number }
export interface CostLine { model: string; step: string; calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; web_searches: number; usd: number; priced?: boolean }
export interface CostRecord { workflow: string; run_id: string; cap_usd: number | null; stopped_at_cap: boolean; lines: CostLine[] }
export interface Conn { url: string; key: string; fetchImpl?: typeof fetch }
export class CostCapReached extends Error { code: "COST_CAP" }
export class NoPrice extends Error { code: "NO_PRICE" }
export function normalisePrices(rows: Record<string, unknown>[]): PriceRow[];
export function priceFor(rows: PriceRow[], model: string, onDay: string): PriceRow | null;
export function usageOf(u: unknown): Usage;
export function costOfCall(p: PriceRow, u: Usage, webSearchUsd?: number): number;
export function parseCap(value: unknown, fallback: number): number;
export class CostMeter {
  constructor(opts: { workflow: string; runId: string; capUsd: number; prices: PriceRow[]; prior?: number; webSearchUsd?: number; enforce?: boolean; step?: string; day?: string; log?: (s: string) => void });
  prior: number; workflow: string; runId: string; capUsd: number; step: string; spent: number; calls: number; refused: number; stoppedAtCap: boolean; finished: boolean; conn?: Conn; readonly capReached: boolean;
  refusal(model: string | null): Error | null;
  add(model: string, usage: Usage, step?: string): number;
  addLine(line: Partial<CostLine> & { model: string }): void;
  lines(): CostLine[];
  summaryLines(): string[];
  toRecord(): CostRecord;
}
export function installFetchMeter(meter: CostMeter, g?: { fetch: typeof fetch }): () => void;
export function loadPrices(conn: Conn): Promise<PriceRow[]>;
export function priorSpend(conn: Conn, workflow: string, runId: string): Promise<number>;
export function recordRun(conn: Conn, record: CostRecord): Promise<number>;
export function startMeter(opts: { workflow: string; capDefault: number; env?: Record<string, string | undefined>; step?: string; enforce?: boolean; install?: boolean; runId?: string; capUsd?: number; prices?: PriceRow[]; prior?: number; conn?: Conn; webSearchUsd?: number; log?: (s: string) => void }): Promise<CostMeter>;
export function finishMeter(meter: CostMeter, opts?: { env?: Record<string, string | undefined>; out?: string; conn?: Conn; override?: Partial<CostRecord> }): Promise<CostMeter>;
export function recordFile(path: string, env?: Record<string, string | undefined>): Promise<CostMeter>;
export function runMetered<T>(opts: Parameters<typeof startMeter>[0], fn: (meter: CostMeter) => Promise<T>): Promise<T | undefined>;
export function autoFinish(meter: CostMeter): CostMeter;
