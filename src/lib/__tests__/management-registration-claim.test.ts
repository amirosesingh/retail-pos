import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite;
const proof = "a".repeat(64);
beforeAll(async () => {
 db = new PGlite();
 await db.exec(`CREATE SCHEMA private;
 CREATE TABLE stores(id text PRIMARY KEY,deleted_at timestamptz,archived_at timestamptz,is_active boolean DEFAULT true);
 INSERT INTO stores(id) VALUES ('branch-a');
 CREATE TABLE terminal_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id text REFERENCES stores(id) ON DELETE SET NULL,
 location_name text, platform text, status text DEFAULT 'active', revoked_at timestamptz, management_sync_enabled boolean DEFAULT false,
 claim_proof text, claimed_proof_hash text, claimed_at timestamptz, expires_at timestamptz, claimed_by_device text,
 claimed_platform text, claimed_os text, is_claimed boolean, activated_at timestamptz, last_seen_at timestamptz);`);
 const migration = readFileSync('supabase/migrations/20261022024932_management_registration_claim.sql','utf8');
 await db.exec(migration); await db.exec(migration);
});
afterAll(async () => { await db.close(); });
async function issue(platform: string, location: string | null, name = 'Branch', replica = false) {
 return (await db.query<{id:string}>(`INSERT INTO terminal_tokens(platform,location_id,location_name,management_sync_enabled) VALUES($1,$2,$3,$4) RETURNING id`,[platform,location,name,replica])).rows[0].id;
}
const claim = (id: string, platform: string, hash = proof) => db.query<{ok:boolean}>(`SELECT private.terminal_token_claim_impl($1,'device',$2,$3,'os') AS ok`,[id,hash,platform]);
it.each(['android','ios'])("accepts deliberate mobile Management on %s with a device-bound retry", async platform => {
 const id = await issue('mobile',null,'All branches — management');
 expect((await claim(id,platform)).rows[0].ok).toBe(true);
 expect((await claim(id,platform)).rows[0].ok).toBe(true);
 await expect(claim(id,platform,'b'.repeat(64))).rejects.toThrow('PROOF_MISMATCH');
 await expect(claim(id,'electron')).rejects.toThrow('PLATFORM_MISMATCH');
});
it('accepts explicit Management PC tokens and rejects them on phones', async () => {
 const id = await issue('pc',null,'All branches — management',true);
 await expect(claim(id,'ios')).rejects.toThrow('PLATFORM_MISMATCH');
 expect((await claim(id,'electron')).rows[0].ok).toBe(true);
});
it('rejects unspecified branchless tokens and never upgrades a deleted branch token', async () => {
 const unspecified = await issue('mobile',null);
 await expect(claim(unspecified,'android')).rejects.toThrow('BRANCH_REQUIRED');
 const id = await issue('mobile','branch-a','All branches — management');
 await db.exec(`DELETE FROM stores WHERE id='branch-a'`);
 await expect(claim(id,'ios')).rejects.toThrow('BRANCH_REQUIRED');
});
it('keeps revocation, expiry, proof and Operations checks', async () => {
 const revoked = await issue('mobile',null,'All branches — management');
 await db.query(`UPDATE terminal_tokens SET status='revoked' WHERE id=$1`,[revoked]);
 await expect(claim(revoked,'ios')).rejects.toThrow('REVOKED');
 const expired = await issue('pc',null,'All branches — management',true);
 await db.query(`UPDATE terminal_tokens SET expires_at=now()-interval '1 day' WHERE id=$1`,[expired]);
 await expect(claim(expired,'electron')).rejects.toThrow('EXPIRED');
 const fresh = await issue('mobile',null,'All branches — management');
 await expect(claim(fresh,'ios','')).rejects.toThrow('PROOF_REQUIRED');
 await db.exec(`INSERT INTO stores(id) VALUES ('branch-b')`);
 const ops = await issue('pc','branch-b');
 expect((await claim(ops,'electron')).rows[0].ok).toBe(true);
});
