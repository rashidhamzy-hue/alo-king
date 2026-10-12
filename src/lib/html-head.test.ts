import { describe, expect, it, vi } from "vitest";
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
    expect(out).toContain("largest-contentful-paint");
    expect(out).toContain('import("/assets/index-abc.js")');
    expect(out).toContain("setTimeout(go,1500)");
    expect(out).toContain("<h1>Hi</h1>");
  });
  it("leaves a page without the expected script tag as it was (apart from preloads)", () => {
    const odd = "<html><body><script>1</script></body></html>";
    expect(deferHydration(odd)).toBe(odd);
  });

  // Runs the generated inline script against a fake browser and counts how often, and when, the entry script is imported.
  function run(opts: { supported?: string[] | null; throws?: boolean; fire?: number }) {
    vi.useFakeTimers();
    const imports: number[] = [];
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    let onLoad: () => void = () => {};
    let callback: (l: unknown, o: { disconnect: () => void }) => void = () => {};
    class FakeObserver {
      static supportedEntryTypes =
        opts.supported === undefined ? ["largest-contentful-paint"] : opts.supported;
      constructor(cb: typeof callback) {
        if (opts.throws) throw new Error("no");
        callback = cb;
      }
      observe() {}
    }
    const html = deferHydration(page);
    const body = (html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "").replace(
      "import(",
      "__imp(",
    );
    const win = opts.supported === null ? {} : { PerformanceObserver: FakeObserver };
    new Function("addEventListener", "window", "PerformanceObserver", "setTimeout", "__imp", body)(
      (_e: string, fn: () => void) => (onLoad = fn),
      win,
      opts.supported === null ? undefined : FakeObserver,
      (fn: () => void, ms: number) => timers.push({ at: now + ms, fn }),
      () => imports.push(now),
    );
    onLoad();
    const advance = (to: number) => {
      for (const tm of timers.filter((q) => q.at <= to).sort((a, b) => a.at - b.at)) {
        now = tm.at;
        tm.fn();
        timers.splice(timers.indexOf(tm), 1);
      }
      now = to;
    };
    for (let i = 0; i < (opts.fire ?? 0); i++) callback([], { disconnect() {} });
    advance(2000);
    vi.useRealTimers();
    return imports;
  }
  it("imports once, 150 ms after the largest content is recorded", () => {
    expect(run({ fire: 2 })).toEqual([150]);
  });
  it("imports once at 1.5 s when no largest content is ever reported", () => {
    expect(run({})).toEqual([1500]);
  });
  it("imports at once where the browser cannot report largest content or the observer throws", () => {
    expect(run({ supported: ["paint"] })[0]).toBe(0);
    expect(run({ supported: null })[0]).toBe(0);
    expect(run({ throws: true })[0]).toBe(0);
  });
});
