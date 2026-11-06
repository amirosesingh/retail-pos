import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const path='supabase/migrations/20261106042139_automatic_history_index_recovery.sql';
describe('automatic history read/INSERT-feed preparation',()=>{
 it('keeps one tool-owned atomic statement and no business repair or mutable history adapter',()=>{
  const sql=readFileSync(path,'utf8');
  expect(sql.match(/^DO \$automatic_history_index_upgrade\$/gm)).toHaveLength(1);
  expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
  expect(sql).not.toMatch(/UPDATE\s+public\.(?:products|change_history)|DELETE\s+FROM\s+public\.change_history|ALTER\s+TABLE|sync_apply_change_history|sync_delete_change_history/i);
  expect(sql).toContain('AFTER INSERT ON public.change_history');
  expect(sql).not.toMatch(/GRANT[^;]+TO PUBLIC/i);
  expect(sql).toContain('p_limit>1000');expect(sql).toContain('jsonb_array_length(p_ids)>10');
  expect(sql).toContain('HISTORY_ROWS_SINGLE_ROW_TOO_LARGE');
  expect(sql).toContain('HISTORY_INDEX_PARTIAL_INSTALL');
 });
 it.each(['lf','crlf'])('passes captured actual routines, privacy, denied scope and ledger rollback using %s bytes',(format)=>{
  const output=execFileSync(process.execPath,['scripts/test-history-index-recovery.mjs','--line-endings='+format],{encoding:'utf8',windowsHide:true,timeout:90000});
  expect(output).toContain('PASS 26 isolated automatic history SQL groups (PGlite, '+format+')');
 },95000);
});
