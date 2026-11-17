// UX2a, the coordinator's decision of 17 November: the picker walks ambient, then fresh, then chilled, then frozen, so cold goods are taken last and stay cold.
// pick_list (0031) listed ambient, chilled, frozen, fresh (the enum's order); 0227 puts fresh before chilled and frozen. Nothing else about the list changes.
import { beforeAll, describe, expect, it } from "vitest";
import { openHub, placeOrder, type Hub } from "./hub-kit";

let h: Hub;
beforeAll(async () => { h = await openHub(); }, 120_000);

describe("the walking order of a pick list", () => {
  it("is ambient, fresh, chilled, frozen, and by name inside each", async () => {
    const names = ["Tannourine Mineral Water 2L X6", "Najjar Cafe Classic Normal 180G", "Al Forno Pita White Bread Big 800G", "Leen Taanayel Labneh Premium"];
    const ids = await Promise.all(names.map((n) => h.product(n)));
    // one item of each storage zone, bought in the opposite order to the walk
    const zones = ["frozen", "chilled", "fresh", "ambient"] as const;
    for (let i = 0; i < 4; i++) await h.db.pg.query(`update products set storage = $2::storage_zone where id = $1`, [ids[i], zones[i]]);
    const o = await placeOrder(h, ids.map((product_id) => ({ product_id, qty: 1 })));
    const list = await h.db.rpc("pick_list", { p_order: o.orderId });
    const walked = (list.lines as { product_id: string; storage: string; n: number }[]);
    expect(walked.map((l) => l.storage)).toEqual(["ambient", "fresh", "chilled", "frozen"]);
    expect(walked.map((l) => l.n)).toEqual([1, 2, 3, 4]);                              // numbered in the order they are walked, for "missing 2"
    expect(walked.map((l) => l.product_id)).toEqual([ids[3], ids[2], ids[1], ids[0]]);
  });
});
