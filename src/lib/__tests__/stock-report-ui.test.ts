import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {stockReportDisplayGrade} from '@/platforms/web/components/pos/StockHistoryDialog';
import type {StockHistoryPage} from '../stock-history-report';

const page=():StockHistoryPage=>({status:'complete',reasons:[],cutoff:'2026-11-06T00:00:00.1234567Z',timeZone:'Asia/Brunei',branchId:'a',
 baselineAt:'2026-11-01T00:00:00.0000000Z',readAt:'2026-11-07T00:00:00.0000000Z',sourceRevision:'fixture',pendingCount:'0',
 rows:[{productId:'11111111-1111-4111-8111-111111111111',locationId:'a',name:'Original archive',sku:'0001',barcode:'00001',quantity:'9007199254740993',negative:false}],next:null});
const provisional=():StockHistoryPage=>({...page(),status:'incomplete',reasons:['WRITER_COVERAGE_PENDING'],coverage:{acceptedLedger:'complete',writers:'pending',balanceGrade:'recorded_provisional',timeGrade:'author_entered'}});

describe('Stock report presentation follows supplied accepted-ledger evidence',()=>{
 it('preserves complete legacy point reports without fabricating a coverage DTO',()=>{
  const original=page(),before=JSON.stringify(original);expect(stockReportDisplayGrade(original)).toBe('verified');
  expect(JSON.stringify(original)).toBe(before);expect(original.coverage).toBeUndefined();expect(original.rows[0]!.quantity).toBe('9007199254740993');
 });
 it.each(['pending','unknown'] as const)('shows only explicitly supplied %s-writer provisional recorded quantities',writers=>{
  const record=provisional();record.coverage!.writers=writers;expect(stockReportDisplayGrade(record)).toBe('provisional');
  expect(record.status).toBe('incomplete');
 });
 it.each(['ledger','writers','grade','status','ungraded','null','opening','readAt','revision'] as const)('refuses an incomplete or contradictory %s display claim',mode=>{
  const record=provisional();if(mode==='ledger')record.coverage!.acceptedLedger='incomplete';if(mode==='writers')record.coverage!.writers='confirmed';
  if(mode==='grade')record.coverage!.balanceGrade='verified';if(mode==='status')record.status='unsupported';if(mode==='ungraded')delete record.coverage;
  if(mode==='null')record.rows[0]!.quantity=null;if(mode==='opening')delete record.baselineAt;if(mode==='readAt')delete record.readAt;if(mode==='revision')delete record.sourceRevision;
  expect(stockReportDisplayGrade(record)).toBe('unavailable');
 });
 it.each(['MISSING_OPENING','CAPTURE_GAPS','UNVALIDATED_STOCK_EFFECTS','BASELINE_PREHISTORY_CHANGED'])('hides estimated numbers behind actual ledger gap %s',reason=>{
  const record=provisional();record.reasons.push(reason);expect(stockReportDisplayGrade(record)).toBe('unavailable');
 });
 it('does not label a complete response with provisional writer grades as verified',()=>{
  const record=provisional();record.status='complete';expect(stockReportDisplayGrade(record)).toBe('unavailable');
  expect(stockReportDisplayGrade(null)).toBe('unavailable');
 });
 it('preserves an explicit recorded-time uncertainty without fabricating physical clock truth',()=>{
  const record=provisional();record.reasons.push('CLOCK_UNVERIFIED');record.coverage!.timeGrade='mixed';
  expect(stockReportDisplayGrade(record)).toBe('provisional');
 });
 it('uses the same authorized request and supplied row strings, with no client sums or extra reader',()=>{
  const source=readFileSync('src/platforms/web/components/pos/StockHistoryDialog.tsx','utf8');
  expect(source).toContain('stockReportDay(value.slice(0, 10), timeZone).start');
  expect(source).toContain('Object.freeze({ ...selected })');expect(source).toContain('cutoff, timeZone, branchId');
  expect(source).toContain('pageIdentity === identity');expect(source).toContain('!mounted.current');
  for(const field of ['row.openingQuantity','row.inQuantity','row.outQuantity','row.quantity'])expect(source).toContain(field);
  expect(source).not.toMatch(/BigInt\s*\(|parseFloat\s*\(|calculateStockAsOf\s*\(|calculateStockDaySummary\s*\(/);
 });
});
