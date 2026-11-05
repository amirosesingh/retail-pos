import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
describe('service-only bounded feed SQL',()=>{
 it('adds only a new guarded RPC and retains the existing delegate/projection',()=>{
  const text=readFileSync(resolve('supabase/migrations/20261104040251_protected_byte_bounded_feed_download.sql'),'utf8');
  expect(text.match(/CREATE (?:OR REPLACE )?FUNCTION/g)).toHaveLength(1);
  expect(text).toContain('SECURITY INVOKER');
  expect(text).toContain("'e3171846683edb5d58c7a5291526555a'");
  expect(text).toContain("'4633e04e150c350518938f2ba661fca1'");
  expect(text).toContain('p_after_cursor,10)');
  expect(text).toContain('FROM PUBLIC,anon,authenticated');
  expect(text).toContain('TO service_role');
  expect(text).toContain('X-POS-Feed-Continue');
  expect(text).not.toMatch(/CREATE TABLE|ALTER TABLE|UPDATE public\.|DELETE FROM|INSERT INTO/i);
 });
 it('passes isolated SQL privacy, scope, byte, cursor and source-drift cases',()=>{
  const output=execFileSync(process.execPath,['scripts/test-protected-feed-page.mjs'],{cwd:process.cwd(),encoding:'utf8',timeout:30000,windowsHide:true});
  expect(output).toMatch(/PASS \d+ isolated feed SQL/);
 },35000);
});
