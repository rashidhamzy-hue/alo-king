// UX2b, migration 0232: a rider's written terms on file. The Riders page shows, for each rider, whether their written terms are on file
// (what they are called, when signed, who recorded them, the document in the private bucket). Nothing about a rider is rated or scored.
// Written before the migration.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let lead: string; let picker: string; let rider: string; let rider2: string; let customer: string;
const record = (driver: string, by: string, ref: string, path: string | null = null, signed = "2026-11-10") =>
  db.rpc("record_rider_terms", { p_driver: driver, p_by: by, p_reference: ref, p_signed_on: signed, p_path: path });

beforeAll(async () => {
  db = await openTestDb();
  const party = async (role: string, name: string) => (await db.one(`insert into parties(role, display_name) values ($1, $2) returning id`, [role, name])).id as string;
  lead = await party("ops_lead", "Hussein"); picker = await party("picker", "Rana"); rider = await party("driver", "Samir"); rider2 = await party("driver", "Karim"); customer = await party("customer", "A customer");
}, 120_000);

describe("recording a rider's written terms", () => {
  it("the ops lead or an admin records them; a picker may not; only a rider can have them", async () => {
    await expect(record(rider, picker, "Rider terms v1")).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(record(customer, lead, "Rider terms v1")).rejects.toThrow(/NOT_A_RIDER/);
    await expect(record(rider, lead, "ab")).rejects.toThrow(/REFERENCE_REQUIRED/);
    await expect(record(rider, lead, "Rider terms v1", "labels/other/photo.jpg")).rejects.toThrow(/TERMS_PATH/);
    await expect(record(rider, lead, "Rider terms v1", null, "2999-01-01")).rejects.toThrow(/SIGNED_ON_FUTURE/);
    expect(await record(rider, lead, "Rider terms v1, signed copy", `rider_terms/${rider}/2026-11-10/abc.jpg`)).toMatchObject({ ok: true, replaced: false });
  });

  it("a newer record replaces the old one, which stays as history", async () => {
    expect(await record(rider, lead, "Rider terms v2", null, "2026-11-12")).toMatchObject({ ok: true, replaced: true });
    const rows = await db.all(`select reference, superseded_at from rider_terms where driver_id = $1 order by recorded_at`, [rider]);
    expect(rows.map((r: any) => [r.reference, r.superseded_at !== null])).toEqual([["Rider terms v1, signed copy", true], ["Rider terms v2", false]]);
    await expect(db.pg.query(`delete from rider_terms where driver_id = $1`, [rider])).rejects.toThrow(/APPEND_ONLY/);
  });

  it("rider_terms_on_file() lists the current record of each rider and nothing about a rating", async () => {
    await record(rider2, lead, "Rider terms v1", `rider_terms/${rider2}/2026-11-12/def.jpg`, "2026-11-12");
    const list = await db.rpc("rider_terms_on_file");
    expect(list).toHaveLength(2);
    expect(list.find((x: any) => x.driver_id === rider)).toMatchObject({ reference: "Rider terms v2", signed_on: "2026-11-12", recorded_by_name: "Hussein", has_document: false });
    expect(list.find((x: any) => x.driver_id === rider2)).toMatchObject({ has_document: true, document_path: `rider_terms/${rider2}/2026-11-12/def.jpg` });
    const cols = (await db.all(`select column_name from information_schema.columns where table_name = 'rider_terms'`)).map((c: any) => c.column_name);
    expect(cols.filter((c: string) => /rating|score|rank|stars|review/.test(c))).toEqual([]);
  });
});
