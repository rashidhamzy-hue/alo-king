import { it } from "vitest";
import { openTestDb } from "./harness";
it("probe", async () => {
  const db = await openTestDb();
  console.log("S", JSON.stringify(await db.all(`select count(*) n, sum((on_hand - reserved > 0)::int) pos from stock_levels`)));
  console.log("O", JSON.stringify(await db.all(`select count(*) from offers`)));
  console.log("L", JSON.stringify(await db.all(`select p.name_en, l.on_hand, l.reserved from products p left join stock_levels l on l.product_id=p.id where p.name_en ilike '%sugar%'`)));
}, 120000);
