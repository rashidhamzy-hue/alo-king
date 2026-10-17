// Sets the WhatsApp conversational components of a number (DECISIONS §39.15.11, session 5g): the ice breakers shown before
// a customer's first message and the commands typed with "/" (/order, /explore, /orders, /help), from
// whatsapp/conversational.json, through Kapso's Meta proxy (https://api.kapso.ai only, CLAUDE.md). Checks Meta's limits
// first (meta-limits.ts), then reads back what Meta holds. When Meta or the proxy refuses, it prints the refusal and exits
// 2, and the workflow opens one `owner` issue with the WhatsApp Manager steps (§25).
// Env: KAPSO_API_KEY, PHONE_NUMBER_ID. Usage: node --experimental-strip-types scripts/kapso/conversational.ts
import { readFileSync } from "node:fs";
import { checkConversational } from "../../supabase/functions/_shared/meta-limits.ts";

const KAPSO_META = "https://api.kapso.ai/meta/whatsapp/v24.0";

export type Conversational = {
  enable_welcome_message: boolean;
  prompts: string[];
  commands: { command_name: string; command_description: string }[];
};

/** The body Meta's POST /{phone_number_id}/conversational_automation takes. */
export const automationBody = (c: Conversational) => ({
  enable_welcome_message: c.enable_welcome_message,
  prompts: c.prompts,
  commands: c.commands.map((x) => ({
    command_name: x.command_name,
    command_description: x.command_description,
  })),
});

/** Whether what Meta read back holds every ice breaker and command we set (order is Meta's). */
export function sameAutomation(want: Conversational, got: any): boolean {
  const a = got?.conversational_automation ?? got ?? {};
  const prompts: string[] = Array.isArray(a.prompts) ? a.prompts : [];
  const cmds: any[] = Array.isArray(a.commands) ? a.commands : [];
  return (
    want.prompts.every((p) => prompts.includes(p)) &&
    want.commands.every((c) =>
      cmds.some(
        (x) =>
          x?.command_name === c.command_name && x?.command_description === c.command_description,
      ),
    )
  );
}

async function main() {
  const key = process.env.KAPSO_API_KEY ?? "";
  const pn = process.env.PHONE_NUMBER_ID ?? "";
  if (!key || !/^[0-9]{5,30}$/.test(pn))
    throw new Error("KAPSO_API_KEY and PHONE_NUMBER_ID are required");
  const c: Conversational = JSON.parse(readFileSync("whatsapp/conversational.json", "utf8"));
  const problems = checkConversational(c);
  if (problems.length) throw new Error(`breaks Meta's limits: ${problems.join("; ")}`);
  const headers = { "X-API-Key": key, "content-type": "application/json" };
  const res = await fetch(`${KAPSO_META}/${pn}/conversational_automation`, {
    method: "POST",
    headers,
    body: JSON.stringify(automationBody(c)),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? body;
    console.log(
      `refused: ${res.status} ${String(e?.message ?? JSON.stringify(e)).slice(0, 300)}${e?.code ? ` (code ${e.code})` : ""}`,
    );
    process.exit(2);
  }
  const got = await fetch(`${KAPSO_META}/${pn}?fields=conversational_automation`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const now: any = await got.json().catch(() => ({}));
  const ok = got.ok && sameAutomation(c, now);
  console.log(
    [
      `| ice breakers and commands | ${ok ? "set and read back" : got.ok ? "set; Meta reads back something else" : "set; not readable back"} |`,
      `|---|---|`,
      ...c.prompts.map((p) => `| ice breaker | ${p} |`),
      ...c.commands.map((x) => `| /${x.command_name} | ${x.command_description} |`),
    ].join("\n"),
  );
  if (got.ok && !ok) process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
