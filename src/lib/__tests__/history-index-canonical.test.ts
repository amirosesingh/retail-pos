import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const {historyIndexCanonicalBlock,withHistoryIndexContract}=createRequire(import.meta.url)('../../../scripts/history-index-canonical.cjs');
const migration=readFileSync('supabase/migrations/20261106042139_automatic_history_index_recovery.sql','utf8');
const schema=readFileSync('supabase/schema.sql','utf8');
const begin='-- AUTOMATIC_HISTORY_RECONCILE_BEGIN',end='-- AUTOMATIC_HISTORY_RECONCILE_END';

describe('preserved fresh-schema history contract assembly',()=>{
 it('emits exactly the reviewed new definitions without replacing the prior schema',()=>{
  const prior='-- prior unrelated definition\nCREATE TABLE existing_fixture(id int);\n';
  const result=withHistoryIndexContract(prior,migration);
  expect(result.startsWith(prior)).toBe(true);expect(result.split(begin)).toHaveLength(2);expect(result.split(end)).toHaveLength(2);
  for(const name of ['index','rows','feed']){
   const definition=migration.replaceAll('\r\n','\n').split(`$${name}_definition$`)[1];
   expect(result).toContain(definition);
  }
  expect(result).not.toMatch(/sync_apply_change_history|sync_delete_change_history|DELETE FROM public.change_history/);
 });
 it('replaces only its own bounded block and remains idempotent across checkouts',()=>{
  const prior='-- preserve before\n'+begin+'\nold owned block\n'+end+'\n-- preserve after\n';
  const result=withHistoryIndexContract(prior,migration);
  expect(result).toContain('-- preserve before\n\n-- preserve after');
  expect(withHistoryIndexContract(result,migration)).toBe(result);
  expect(historyIndexCanonicalBlock(migration.replaceAll('\r\n','\n').replaceAll('\n','\r\n'))).toBe(historyIndexCanonicalBlock(migration));
 });
 it('removes relocated-contract separators without changing adjacent definitions',()=>{
  const before='-- existing feed\nSELECT 1;',after='-- relocated authority contract\nSELECT 2;';
  const prior=before+'\n'.repeat(18)+begin+'\nold owned block\n'+end+'\n\n'+after+'\n\n-- Final public-schema privilege hardening\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\n';
  const result=withHistoryIndexContract(prior,migration);
  expect(result.startsWith(before+'\n\n'+after+'\n\n'+begin)).toBe(true);
  expect(withHistoryIndexContract(result,migration)).toBe(result);
  expect(result.endsWith('-- Final public-schema privilege hardening\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\n')).toBe(true);
 });
 it.each([begin, end, `${begin}\n${begin}\n${end}`, `${end}\n${begin}`])('refuses malformed owned boundaries',value=>{
  expect(()=>withHistoryIndexContract(value,migration)).toThrow();
 });
 it('keeps the checked-in canonical block byte-equivalent to its prepared migration',()=>{
  const normalized=schema.replaceAll('\r\n','\n');
  expect(normalized.slice(normalized.indexOf(begin),normalized.indexOf(end)+end.length)).toBe(historyIndexCanonicalBlock(migration));
  const generator=readFileSync('scripts/generate-supabase-sync-contract.cjs','utf8');
  expect(generator).toContain('withHistoryIndexContract');
  expect(normalized.lastIndexOf('-- Final public-schema privilege hardening')).toBeGreaterThan(normalized.lastIndexOf('CREATE OR REPLACE FUNCTION'));
 });
 it('rejects changed literal boundaries or function identity instead of emitting partial DDL',()=>{
  expect(()=>historyIndexCanonicalBlock(migration.replace('$index_definition$',' $unknown_definition$'))).toThrow();
  expect(()=>historyIndexCanonicalBlock(migration.replace('CREATE OR REPLACE FUNCTION public.pos_sync_history_rows_v1(','CREATE OR REPLACE FUNCTION public.unreviewed_rows('))).toThrow();
 });
});
