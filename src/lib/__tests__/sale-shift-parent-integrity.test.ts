import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { PGlite as Database } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const schema = readFileSync("scripts/preparation/sale-shift-parent-integrity.sql", "utf8");
const legacySale = randomUUID();
const legacyShift = randomUUID();
let db: Database;

async function saveSale(id: string, shift: string | null, branch = "A") {
  await db.query("INSERT INTO sales(id,shift_id,store_id) VALUES($1,$2,$3)", [id, shift, branch]);
}

async function saveShift(id: string, branch = "A") {
  await db.query("INSERT INTO shifts(id,store_id) VALUES($1,$2)", [id, branch]);
}

async function countSale(id: string) {
  return (await db.query<{ count: number }>("SELECT count(*)::int FROM sales WHERE id=$1", [id])).rows[0].count;
}

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA private;
    CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text NOT NULL);
    CREATE TABLE sales(id uuid PRIMARY KEY,shift_id text,store_id text NOT NULL,total_amount numeric);
    CREATE TABLE sale_items(id uuid PRIMARY KEY,sale_id uuid REFERENCES sales(id));
  `);
  await saveSale(legacySale, legacyShift);
  await db.exec(schema);
  await db.exec(schema);
});

afterAll(async () => { await db?.close(); });

describe("deferred sale shift integrity", () => {
  it("preserves the existing orphan and allows edits that leave its binding unchanged", async () => {
    await db.query("UPDATE sales SET total_amount=18,shift_id=shift_id WHERE id=$1", [legacySale]);
    expect((await db.query("SELECT shift_id,total_amount::text FROM sales WHERE id=$1", [legacySale])).rows).toEqual([
      { shift_id: legacyShift, total_amount: "18" },
    ]);
  });

  it("rolls back the whole sale batch until the same-branch shift arrives and accepts the same sale after it does", async () => {
    const id = randomUUID(), shift = randomUUID(), item = randomUUID();
    const saveBatch = async () => {
      await db.exec("BEGIN");
      await saveSale(id, shift);
      await db.query("INSERT INTO sale_items VALUES($1,$2)", [item, id]);
      await db.exec("COMMIT");
    };
    await expect(saveBatch()).rejects.toMatchObject({ code: "23503", message: "POS_SALE_SHIFT_PARENT_REQUIRED" });
    await db.exec("ROLLBACK");
    expect(await countSale(id)).toBe(0);
    expect((await db.query("SELECT id FROM sale_items WHERE id=$1", [item])).rows).toEqual([]);

    await saveShift(shift);
    await saveBatch();
    expect(await countSale(id)).toBe(1);
    expect((await db.query("SELECT id FROM sale_items WHERE sale_id=$1", [id])).rows).toEqual([{ id: item }]);
  });

  it("accepts an in-flight opening written in the same transaction after its sale row", async () => {
    const id = randomUUID(), shift = randomUUID();
    await db.exec("BEGIN");
    await saveSale(id, shift.toUpperCase());
    await saveShift(shift);
    await db.exec("COMMIT");
    expect(await countSale(id)).toBe(1);
  });

  it("rejects a foreign-branch parent and a malformed shift reference", async () => {
    const foreignShift = randomUUID(), sale = randomUUID();
    await saveShift(foreignShift, "B");
    await expect(saveSale(sale, foreignShift)).rejects.toMatchObject({ code: "23503", message: "POS_SALE_SHIFT_PARENT_REQUIRED" });
    await expect(saveSale(sale, "incorrect")).rejects.toMatchObject({ code: "23503", message: "POS_SALE_SHIFT_PARENT_REQUIRED" });
    expect(await countSale(sale)).toBe(0);
  });

  it("validates the final sale identity after a same-transaction rekey", async () => {
    const original = randomUUID(), final = randomUUID(), shift = randomUUID();
    const saveRekeyedSale = async () => {
      await db.exec("BEGIN");
      await saveSale(original, shift);
      await db.query("UPDATE sales SET id=$1 WHERE id=$2", [final, original]);
      await db.exec("COMMIT");
    };
    await expect(saveRekeyedSale()).rejects.toMatchObject({ code: "23503", message: "POS_SALE_SHIFT_PARENT_REQUIRED" });
    await db.exec("ROLLBACK");
    expect(await countSale(final)).toBe(0);

    await saveShift(shift);
    await saveRekeyedSale();
    expect(await countSale(original)).toBe(0);
    expect(await countSale(final)).toBe(1);
  });

  it("accepts allowed unlinked sales and validates only the final same-transaction shift association", async () => {
    const sale = randomUUID(), final = randomUUID();
    await saveShift(final);
    await saveSale(randomUUID(), null);
    await db.exec("BEGIN");
    await saveSale(sale, randomUUID());
    await db.query("UPDATE sales SET shift_id=$1 WHERE id=$2", [final, sale]);
    await db.exec("COMMIT");
    expect(await countSale(sale)).toBe(1);
    await expect(db.query("UPDATE sales SET store_id='B' WHERE id=$1", [sale])).rejects.toMatchObject({
      code: "23503",
      message: "POS_SALE_SHIFT_PARENT_REQUIRED",
    });
  });
});
