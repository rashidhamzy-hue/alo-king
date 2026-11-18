// DOC2: how a screenshot's file name is read, what an upload replaces, which reference screen sits beside a page, and the one move out of the
// repository (scripts/screens). Pure: a fake store stands in for Supabase Storage.
import { describe, expect, it } from "vitest";
import { SESSION_ORDER, contentType, groupScreens, isImage, parseShot, planPrune, referenceFor, safeScreenPath } from "../../packages/core/src/screens.mjs";
// @ts-expect-error plain .mjs, no types
import { filesOfDir, sessionsAtRef, uploadFiles } from "../../scripts/screens/run.mjs";
import { screensStore } from "../../scripts/screens/storage.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("a screenshot's file name", () => {
  it("takes the width, language and theme off and keeps the page", () => {
    expect(parseShot("wh1a/wh1a-bins-390-ar.png")).toMatchObject({ session: "wh1a", key: "wh1a-bins", width: "390", lang: "ar", theme: null, ref: false });
    expect(parseShot("d4b/console-pick-done-1440-en-dark.webp")).toMatchObject({ key: "console-pick-done", width: "1440", lang: "en", theme: "dark" });
    expect(parseShot("ds1/console-case-390.webp")).toMatchObject({ key: "console-case", width: "390", lang: null });
    expect(parseShot("lb1/capture-1-start-ar-390.webp")).toMatchObject({ key: "capture-1-start", width: "390", lang: "ar" });
    expect(parseShot("ds2/ref-ops-today-1280.webp")).toMatchObject({ key: "ref-ops-today", ref: true, width: "1280" });
  });
  it("is null for anything that is not an image in a session folder", () => {
    expect(parseShot("ds2/README.md")).toBeNull();
    expect(parseShot("web-weights.txt")).toBeNull();
    expect(isImage("a.PNG") && isImage("b.webp") && isImage("c.jpeg")).toBe(true);
    expect(isImage("a.svg")).toBe(false);
    expect(contentType("a.png")).toBe("image/png");
  });
  it("only one folder deep, with plain characters, and never ..", () => {
    expect(safeScreenPath("wh1a/wh1a-bins-390-ar.png")).toBe(true);
    for (const bad of ["x.png", "a/b/c.png", "../a/b.png", "a/..png", "A b/c.png", "a/b c.png", "/a/b.png", "a/.hidden.png"]) expect(safeScreenPath(bad), bad).toBe(false);
  });
});

describe("what an upload replaces", () => {
  const have = ["ds1/console-gallery-390.webp", "ds1/console-gallery-1440.webp", "ds1/console-inbox-390.webp", "ux2a/ux2a-today-390-en.webp", "ux2a/ux2a-today-390-ar.webp", "ds2/ref-ops-today-390.webp"];
  it("deletes every older screenshot of a page the new set has, in any session, and leaves other pages alone", () => {
    expect(planPrune(have, ["ds2/console-gallery-390-en.webp", "ds2/console-gallery-1280-en.webp"])).toEqual(["ds1/console-gallery-1440.webp", "ds1/console-gallery-390.webp"]);
  });
  it("deletes what the same session no longer has of a page (a re-run with one language fewer), and keeps the new files", () => {
    expect(planPrune(have, ["ux2a/ux2a-today-390-en.webp"])).toEqual(["ux2a/ux2a-today-390-ar.webp"]);
  });
  it("an upload of nothing deletes nothing", () => { expect(planPrune(have, [])).toEqual([]); });
});

describe("the reference beside a page", () => {
  const paths = ["ds2/ref-ops-dispatch-390.webp", "ds2/ref-ops-dispatch-1280.webp", "ds2/ref-ops-shell-admin-390.webp", "ds2/ref-ops-riders-390.webp", "ds2/ref-ops-stock-390.webp", "ds2/ref-ops-orders-390.webp",
    "ds2/ref-web-aisle-390.webp", "ds2/ref-web-home-390.webp", "ds2/ref-web-join-rider-390.webp", "ds2/ref-web-for-vendors-390.webp", "ds2/ref-web-order-390.webp", "ds2/ref-web-aisle-1280.webp"];
  it("shortens a page's name from the end until a reference of that name exists", () => {
    expect(referenceFor("console-dispatch-lead", "390", paths)?.key).toBe("ref-ops-dispatch");
    expect(referenceFor("console-shell-admin", "390", paths)?.key).toBe("ref-ops-shell-admin");
    expect(referenceFor("ux3-riders-applicants", "390", paths)?.key).toBe("ref-ops-riders");
    expect(referenceFor("web2-aisle-added", "390", paths)?.key).toBe("ref-web-aisle");
    expect(referenceFor("web-home-check", "390", paths)?.key).toBe("ref-web-home");
  });
  it("names the join pages by their reference's names", () => {
    expect(referenceFor("ux3-rider-applied", "390", paths)?.key).toBe("ref-web-join-rider");
    expect(referenceFor("ux3-vendor-place", "390", paths)?.key).toBe("ref-web-for-vendors");
  });
  it("matches the width class (1440 sits beside 1280) and says nothing when the reference has no such screen", () => {
    expect(referenceFor("console-dispatch-lead", "1440", paths)?.paths).toEqual(["ds2/ref-ops-dispatch-1280.webp"]);
    expect(referenceFor("web-aisle", "1280", paths)?.paths).toEqual(["ds2/ref-web-aisle-1280.webp"]);
    expect(referenceFor("wh1a-bins", "390", paths)).toBeNull();
    expect(referenceFor("console-gallery", "390", paths)).toBeNull();
  });
  it("a console page never takes a website reference (console-order is not web-order)", () => {
    expect(referenceFor("console-order-drawer", "390", paths)).toBeNull();
    expect(referenceFor("web-order", "390", paths)?.key).toBe("ref-web-order");
  });
});

describe("the Screens page's groups", () => {
  it("lists sessions newest first, unknown sessions before the known, each page once with its widths, and no reference screens", () => {
    const g = groupScreens(["ds2/ref-ops-today-390.webp", "wh1a/wh1a-bins-390-ar.png", "wh1a/wh1a-bins-390-en.png", "wh1a/wh1a-bins-1280-en.png", "ds2/console-gallery-390-en.webp", "zz9/zz9-new-390.png"]);
    expect(g.map((s) => s.session)).toEqual(["zz9", "wh1a", "ds2"]);
    expect(g[1]!.pages).toHaveLength(1);
    expect(g[1]!.pages[0]).toMatchObject({ key: "wh1a-bins", widths: ["1280", "390"] });
    expect(g[1]!.pages[0]!.shots).toHaveLength(3);
  });
  it("knows the sessions that move out of the repository, oldest first", () => { expect(SESSION_ORDER[0]).toBe("ds1"); expect(SESSION_ORDER.at(-1)).toBe("wh1a"); });
});

// A small stand-in for the bucket: the objects, and the four calls the store makes.
function fakeStorage() {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url); const path = u.pathname.replace("/storage/v1", "");
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const body = typeof init?.body === "string" && init.headers && String((init.headers as Record<string, string>)["content-type"]).includes("json") ? JSON.parse(init.body) : init?.body;
    if (path === "/object/list/screens") {
      const prefix: string = body.prefix; const out: Record<string, unknown>[] = [];
      if (!prefix) for (const s of new Set([...objects.keys()].map((k) => k.split("/")[0]))) out.push({ name: s, id: null });
      else for (const k of objects.keys()) if (k.startsWith(prefix + "/")) out.push({ name: k.slice(prefix.length + 1), id: "x" });
      return new Response(JSON.stringify(out));
    }
    if (path.startsWith("/object/screens/") && init?.method === "POST") { objects.set(path.slice("/object/screens/".length), new Uint8Array(init.body as Uint8Array)); return new Response("{}"); }
    if (path === "/object/screens" && init?.method === "DELETE") { for (const p of body.prefixes) objects.delete(p); return new Response("[]"); }
    if (path === "/object/sign/screens") return new Response(JSON.stringify(body.paths.map((p: string) => ({ path: p, signedURL: `/object/sign/screens/${p}?token=t` }))));
    if (path.startsWith("/object/sign/screens/")) { const k = path.slice("/object/sign/screens/".length); return objects.has(k) ? new Response(objects.get(k)) : new Response("no", { status: 404 }); }
    return new Response("?", { status: 500 });
  }) as unknown as typeof fetch;
  return { objects, calls, store: screensStore({ url: "https://p.supabase.test", key: "service-key", fetchImpl }) };
}

describe("uploading", () => {
  it("uploads a folder as <session>/<file>, then a second upload of the page replaces the first and everything opens", async () => {
    const { objects, store } = fakeStorage();
    const dir = mkdtempSync(join(tmpdir(), "shots-"));
    for (const f of ["a-bins-390-ar.png", "a-bins-390-en.png", "notes.txt"]) writeFileSync(join(dir, f), Buffer.from(f));
    expect(await uploadFiles(store, filesOfDir(dir, "wh1a"))).toEqual({ uploaded: 2, removed: [] });
    expect([...objects.keys()].sort()).toEqual(["wh1a/a-bins-390-ar.png", "wh1a/a-bins-390-en.png"]);
    const dir2 = mkdtempSync(join(tmpdir(), "shots-"));
    writeFileSync(join(dir2, "a-bins-390-en.png"), Buffer.from("newer"));
    const r = await uploadFiles(store, filesOfDir(dir2, "wh1b"));
    expect(r).toEqual({ uploaded: 1, removed: ["wh1a/a-bins-390-ar.png", "wh1a/a-bins-390-en.png"] });
    expect([...objects.keys()]).toEqual(["wh1b/a-bins-390-en.png"]);
    expect(await store.open("wh1b/a-bins-390-en.png")).toBe(5);
    expect(await store.list()).toEqual(["wh1b/a-bins-390-en.png"]);
  });
  it("refuses a bad path before sending anything, and never sends the key anywhere but the headers", async () => {
    const { calls, store } = fakeStorage();
    await expect(uploadFiles(store, [{ path: "../x/y.png", bytes: Buffer.from("x") }])).rejects.toThrow(/bad path/);
    expect(calls).toEqual([]);
  });
});

describe("the move out of the repository", () => {
  it("reads every image under docs/screens at a commit, oldest session first, and not the notes", () => {
    const tree = ["docs/screens/wh1a/wh1a-bins-390-en.png", "docs/screens/wh1a/README.md", "docs/screens/ds2/ref-ops-today-390.webp", "docs/screens/ds1/console-case-390.webp", "docs/screens/zz9/new-390.png", "docs/other/x.png"];
    const git = (...a: string[]) => (a[0] === "ls-tree" ? Buffer.from(tree.join("\n")) : Buffer.from(`bytes of ${a[1]}`));
    const sessions = sessionsAtRef("abc1234", git);
    expect(sessions.map((s: { session: string }) => s.session)).toEqual(["ds1", "ds2", "wh1a", "zz9"]);
    expect(sessions[2].files).toHaveLength(1);
    expect(sessions[2].files[0].path).toBe("wh1a/wh1a-bins-390-en.png");
    expect(String(sessions[2].files[0].read())).toBe("bytes of abc1234:docs/screens/wh1a/wh1a-bins-390-en.png");
  });
  it("moved oldest first, a newer session's screenshot of a page replaces an older one's (the latest set per page)", async () => {
    const { objects, store } = fakeStorage();
    const tree = ["docs/screens/ds1/console-gallery-390.webp", "docs/screens/ds1/console-inbox-390.webp", "docs/screens/ds2/console-gallery-390-en.webp"];
    const git = (...a: string[]) => (a[0] === "ls-tree" ? Buffer.from(tree.join("\n")) : Buffer.from("b"));
    for (const s of sessionsAtRef("abc1234", git)) await uploadFiles(store, s.files.map((f: { path: string; read: () => Buffer }) => ({ path: f.path, bytes: f.read() })));
    expect([...objects.keys()].sort()).toEqual(["ds1/console-inbox-390.webp", "ds2/console-gallery-390-en.webp"]);
  });
});
