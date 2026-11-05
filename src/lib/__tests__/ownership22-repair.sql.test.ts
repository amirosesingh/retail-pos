import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
describe('ownership22 preparation artifact',()=>{
 it('contains an exact22 frozen manifest and only the approved product UPDATE',()=>{
  const text=readFileSync('scripts/maintenance/repair-str1-22-product-ownership.sql','utf8');
  const manifest=JSON.parse(text.match(/\$manifest\$([\s\S]*?)\$manifest\$/)![1]) as {id:string;before_md5:string}[];
  expect(manifest).toHaveLength(22);expect(new Set(manifest.map(x=>x.id)).size).toBe(22);
  expect(manifest.every(x=>/^[a-f0-9]{32}$/.test(x.before_md5))).toBe(true);
  expect(text).toContain('UPDATE public.products p SET owner_store_id=branch');
  expect(text).toContain("SET LOCAL TimeZone='UTC'");
  expect(text).not.toMatch(/DISABLE TRIGGER|CREATE OR REPLACE FUNCTION|ALTER TABLE|SET stock_quantity|SET sku|SET selling_price/i);
 });
 it('passes isolated captured-trigger/schema/replay/rollback verification',()=>{
  const output=execFileSync(process.execPath,['scripts/test-ownership22-repair.mjs'],{encoding:'utf8',windowsHide:true,timeout:90000});
  expect(output).toMatch(/PASS \d+ isolated ownership22/);
 },95000);
});
