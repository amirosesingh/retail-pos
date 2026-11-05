import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite, publicKey: string;
const author = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const terminal = "00000000-0000-4000-8000-000000000003", key = "00000000-0000-4000-8000-000000000004";
const enrollment = () => ({ version: 1, algorithm: "Ed25519", keyId: key, authorId: author, projectOrigin: "https://project.fixture", terminalId: terminal, publicKey });
const enroll = async (value: unknown = enrollment(), subject = "cashier") => (await db.query<{ result: { ok: boolean; replayed: boolean } }>("SELECT public.pos_shift_author_enroll($1::jsonb,$2) result", [JSON.stringify(value), subject])).rows[0].result;
const read = async () => (await db.query<{ result: { terminal_enrolled: boolean; key: Record<string, unknown> | null } }>("SELECT public.pos_shift_author_key($1,$2,$3,$4) result", ["https://project.fixture", terminal, author, key])).rows[0].result;
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  publicKey = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64url");
  db = new PGlite(); await db.waitReady;
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
    CREATE TABLE public.app_users(id uuid PRIMARY KEY,user_id text,is_active boolean,permissions jsonb);
    CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,platform text,status text,is_claimed boolean,revoked_at timestamptz);
    INSERT INTO app_users VALUES('${author}','cashier',true,'{"can_shift_cash_count":true,"can_shift_cash_recount":false}'),('${other}','other',true,'{}');
    INSERT INTO terminal_tokens VALUES('${terminal}','pc','used',true,NULL);`);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261102101610_shift_author_key_registry.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await db.exec("RESET ROLE;SET request.jwt.claim.role='service_role';TRUNCATE pos_sync_private.shift_author_keys;UPDATE app_users SET is_active=true;UPDATE terminal_tokens SET revoked_at=NULL;");
});
afterAll(async () => { await db?.close(); });

describe("isolated PostgreSQL author-key registry", () => {
  it("enrolls once and idempotently returns the same immutable binding without changing permissions", async () => {
    expect(await enroll()).toEqual({ ok: true, replayed: false });
    expect(await enroll()).toEqual({ ok: true, replayed: true });
    const result = await read();
    expect(result).toMatchObject({ terminal_enrolled: true, key: { author_id: author, key_id: key, public_key: publicKey, subject: "cashier", revoked_at: null } });
    expect((await db.query<{ permissions: unknown }>("SELECT permissions FROM app_users WHERE id=$1", [author])).rows[0].permissions).toEqual({ can_shift_cash_count: true, can_shift_cash_recount: false });
  });
  it("denies other-author claims, inactive profiles, revoked terminals and unknown aliases", async () => {
    await expect(enroll(enrollment(), "other")).rejects.toThrow("SHIFT_AUTHOR_DENIED");
    await expect(enroll({ ...enrollment(), targetAuthor: other })).rejects.toThrow("SHIFT_AUTHOR_DENIED");
    await db.exec(`UPDATE app_users SET is_active=false WHERE id='${author}'`);
    await expect(enroll()).rejects.toThrow("SHIFT_AUTHOR_DENIED");
    await db.exec(`UPDATE app_users SET is_active=true;UPDATE terminal_tokens SET revoked_at=now()`);
    await expect(enroll()).rejects.toThrow("SHIFT_AUTHOR_DENIED");
    expect((await read()).terminal_enrolled).toBe(false);
  });
  it("does not replace a saved key or reuse its id for another profile", async () => {
    await enroll();
    await expect(enroll({ ...enrollment(), keyId: other })).rejects.toThrow("SHIFT_AUTHOR_KEY_MISMATCH");
    await expect(enroll({ ...enrollment(), authorId: other }, "other")).rejects.toThrow("SHIFT_AUTHOR_KEY_MISMATCH");
    await expect(enroll({ ...enrollment(), authorId: other, keyId: other }, "other")).rejects.toThrow("SHIFT_AUTHOR_KEY_MISMATCH");
    expect((await read()).key?.key_id).toBe(key);
  });
  it("retains revoked public history and terminal enrollment while refusing reenrollment or unrevocation", async () => {
    await enroll();
    await db.exec("UPDATE pos_sync_private.shift_author_keys SET revoked_at=now()");
    expect(await read()).toMatchObject({ terminal_enrolled: true, key: { key_id: key } });
    await expect(enroll()).rejects.toThrow("SHIFT_AUTHOR_KEY_MISMATCH");
    await expect(db.exec("UPDATE pos_sync_private.shift_author_keys SET revoked_at=NULL")).rejects.toThrow("SHIFT_AUTHOR_KEY_IMMUTABLE");
    await expect(db.exec("UPDATE pos_sync_private.shift_author_keys SET subject='other'")).rejects.toThrow("SHIFT_AUTHOR_KEY_IMMUTABLE");
    await expect(db.exec("DELETE FROM pos_sync_private.shift_author_keys")).rejects.toThrow("SHIFT_AUTHOR_KEY_IMMUTABLE");
  });
  it("allows only the service RPCs, with no direct registry grants and RLS enabled", async () => {
    const flags = await db.query<{ direct: boolean; service_rpc: boolean; public_rpc: boolean; rls: boolean }>(`SELECT
      has_table_privilege('service_role','pos_sync_private.shift_author_keys','SELECT') direct,
      has_function_privilege('service_role','public.pos_shift_author_enroll(jsonb,text)','EXECUTE') service_rpc,
      has_function_privilege('authenticated','public.pos_shift_author_enroll(jsonb,text)','EXECUTE') public_rpc,
      (SELECT relrowsecurity FROM pg_class WHERE oid='pos_sync_private.shift_author_keys'::regclass) rls`);
    expect(flags.rows[0]).toEqual({ direct: false, service_rpc: true, public_rpc: false, rls: true });
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try { await expect(enroll()).rejects.toThrow("permission denied"); } finally { await db.exec("RESET ROLE"); }
    }
    await db.exec("SET ROLE service_role");
    try { expect(await enroll()).toMatchObject({ ok: true }); } finally { await db.exec("RESET ROLE"); }
    await db.exec("SET request.jwt.claim.role='authenticated'");
    await expect(enroll()).rejects.toThrow("SHIFT_AUTHOR_DENIED");
  });
});
