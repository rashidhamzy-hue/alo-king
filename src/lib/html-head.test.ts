import { describe, expect, it } from "vitest";
import { deferHydration } from "./html-head";

describe("deferHydration", () => {
  const page =
    '<html><head><link rel="stylesheet" href="/s.css"/><link rel="modulepreload" href="/a.js"/><link rel="modulepreload" href="/b.js"/></head>' +
    '<body><h1>Hi</h1><script type="module" async="" src="/assets/index-abc.js"></script></body></html>';
  it("drops the module preloads and loads the entry script after the load event", () => {
    const out = deferHydration(page);
    expect(out).not.toContain("modulepreload");
    expect(out).toContain('<link rel="stylesheet" href="/s.css"/>');
    expect(out).not.toContain('<script type="module"');
    expect(out).toContain('addEventListener("load"');
    expect(out).toContain('import("/assets/index-abc.js")');
    expect(out).toContain("<h1>Hi</h1>");
  });
  it("leaves a page without the expected script tag as it was (apart from preloads)", () => {
    const odd = "<html><body><script>1</script></body></html>";
    expect(deferHydration(odd)).toBe(odd);
  });
});
