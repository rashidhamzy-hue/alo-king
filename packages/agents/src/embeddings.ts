// SR1 (5): embeddings for search by meaning, from Cloudflare Workers AI (the Worker's AI binding, or the REST API in the eval scripts).
// Every call is counted with its tokens and dollars in model_costs (record_embedding_cost, 0212); the daily cap is settings.search.daily_cap_usd;
// query embeddings are cached in the database (query_embeddings), so a query said twice is embedded once. Nothing here is required for an
// answer: a failed or refused call means the search runs on words alone (search.ts).

export interface EmbedResult { vectors: number[][]; tokens: number }
export interface Embedder {
  /** Embeds texts with one model. Throws on any failure (the caller falls back to words). */
  embed(model: string, texts: string[], kind: "query" | "document"): Promise<EmbedResult>;
}

/** Tokens, counted conservatively when the API does not say (about one token per three characters, plus the start and end). */
export function approxTokens(texts: string[]): number {
  return texts.reduce((a, t) => a + Math.ceil([...t].length / 3) + 2, 0);
}

/** qwen3-embedding reads a query better with its instruction; bge-m3 takes the text as it is. Documents are never prefixed. */
export function embeddingInput(model: string, text: string, kind: "query" | "document"): string {
  if (kind === "query" && /qwen3-embedding/.test(model))
    return `Instruct: Given a customer's grocery request in Arabic, Lebanese Arabizi, English or French, retrieve the products that match it\nQuery: ${text}`;
  return text;
}

function vectorsOf(res: unknown): number[][] {
  const r = res as { data?: unknown; result?: { data?: unknown } };
  const data = (r?.data ?? r?.result?.data) as unknown;
  if (!Array.isArray(data) || !data.every((v) => Array.isArray(v) && v.every((x) => typeof x === "number"))) throw new Error("embedding_shape");
  return data as number[][];
}
function tokensOf(res: unknown, texts: string[]): number {
  const u = (res as { usage?: { prompt_tokens?: number; input_tokens?: number }; result?: { usage?: { prompt_tokens?: number } } })?.usage
    ?? (res as { result?: { usage?: { prompt_tokens?: number } } })?.result?.usage;
  const n = Number((u as { prompt_tokens?: number; input_tokens?: number } | undefined)?.prompt_tokens ?? (u as { input_tokens?: number } | undefined)?.input_tokens);
  return Number.isFinite(n) && n > 0 ? n : approxTokens(texts);
}

/** The Worker's AI binding (wrangler.jsonc "ai"). A timeout makes a slow call a failure, so the turn never waits on it for long. */
export function workersAiEmbedder(ai: { run(model: string, input: unknown): Promise<unknown> }, timeoutMs = 1500): Embedder {
  return {
    async embed(model, texts, kind) {
      const input = texts.map((t) => embeddingInput(model, t, kind));
      const res = await Promise.race([
        ai.run(model, { text: input }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("embedding_timeout")), timeoutMs)),
      ]);
      const vectors = vectorsOf(res);
      if (vectors.length !== texts.length) throw new Error("embedding_count");
      return { vectors, tokens: tokensOf(res, input) };
    },
  };
}

/** The REST API, for the scripts and evals that run outside a Worker (search-embed and search-eval workflows). */
export function restEmbedder(opts: { accountId: string; token: string; fetchImpl?: typeof fetch }): Embedder {
  const f = opts.fetchImpl ?? fetch;
  return {
    async embed(model, texts, kind) {
      const input = texts.map((t) => embeddingInput(model, t, kind));
      const r = await f(`https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${model}`, {
        method: "POST", headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: input }),
      });
      const body = await r.json().catch(() => null) as { success?: boolean; errors?: { message?: string }[] } | null;
      if (!r.ok || !body || body.success === false) throw new Error(`workers_ai_${r.status}: ${body?.errors?.map((e) => e.message).join("; ") ?? ""}`.slice(0, 300));
      const vectors = vectorsOf(body);
      if (vectors.length !== texts.length) throw new Error("embedding_count");
      return { vectors, tokens: tokensOf(body, input) };
    },
  };
}

/** pgvector's text form. */
export const toVector = (v: number[]): string => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
