// Loads the saved Kapso payloads under test/fixtures/kapso/ (task 4.1). Shared by the parser and SDK tests.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../test/fixtures/kapso/", import.meta.url));
export type Fixture = { file: string; line: string; event: string; source: string; body: unknown };
export function loadFixtures(event?: string): Fixture[] {
  const out: Fixture[] = [];
  for (const d of readdirSync(dir)) {
    if (!d.startsWith("whatsapp.") || (event && d !== event)) continue;
    for (const f of readdirSync(dir + d).sort()) out.push({ file: `${d}/${f}`, ...JSON.parse(readFileSync(`${dir}${d}/${f}`, "utf8")) });
  }
  return out;
}
