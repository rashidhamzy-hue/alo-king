// Scenario parts: `include: {part: order-to-placed, as: cust, lat: 33.68}` is replaced by the steps of
// scenarios/_parts/order-to-placed.yaml, with every `$AS`, `$LAT`, ... replaced by the include's values.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Scenario, Step } from "./types";

export function expand(
  sc: Scenario,
  partsDir: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
): Scenario {
  const steps: Step[] = [];
  for (const s of sc.steps) {
    if (!s.include) {
      steps.push(s);
      continue;
    }
    const { part, ...params } = s.include;
    if (!/^[a-z0-9-]+$/.test(part)) throw new Error(`bad part name "${part}"`);
    let text = JSON.stringify((parse(read(`${partsDir}/${part}.yaml`)) as { steps: Step[] }).steps);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      text = text
        .split(`$${k.toUpperCase()}`)
        .join(String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
    }
    const missing = /\$[A-Z][A-Z0-9_]*/.exec(text.replace(/\$\d/g, ""));
    if (missing) throw new Error(`part ${part}: ${missing[0]} was not given`);
    steps.push(...(JSON.parse(text) as Step[]));
  }
  return { ...sc, steps };
}
