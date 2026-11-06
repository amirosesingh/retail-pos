import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const file='supabase/migrations/20261106015347_guard_existing_product_owner_during_native_sync.sql';
describe('exact live-source legacy product owner guard preparation',()=>{
 it('pins the exact old and corrected body, complete admission metadata and one assignment',()=>{
  const sql=readFileSync(file,'utf8');
  expect(sql).toContain("'a2f6dc6db0f0b8c045faf7d5f0f309b0'");expect(sql).toContain("'a076aea59e1cc926542052040f20465e'");
  const metadata=JSON.parse(sql.match(/\$metadata\$([\s\S]*?)\$metadata\$/)![1]);
  expect(metadata).toMatchObject({signature:'public.sync_apply_products(jsonb)',owner:'postgres',acl:['postgres=X/postgres','service_role=X/postgres'],config:['search_path=public, pg_temp'],strict:false,definer:false,volatility:'v',kind:'f',parallel:'u',leakproof:false,returns_set:false,result:'integer',arguments:'p_rows jsonb',cost:100,rows:0,support_absent:true});
  expect(sql).toContain('EXECUTE replace(definition,old_assignment,protected_assignment)');
  expect(sql).toContain('replace(body,protected_assignment,old_assignment) IS DISTINCT FROM original_body');
  expect(sql).not.toMatch(/\b(?:UPDATE public\.products|INSERT INTO|DELETE FROM|GRANT |REVOKE |DISABLE TRIGGER|ALTER TABLE)\b/i);
 });
 it('passes actual captured routine, role, branch, source-drift, rollback and replay cases in isolated PostgreSQL',()=>{
  const output=execFileSync(process.execPath,['scripts/test-product-owner-sync-live-source.mjs'],{encoding:'utf8',windowsHide:true,timeout:90000});
  expect(output).toMatch(/PASS 61 captured-live product owner guard cases/);
 },95000);
});
