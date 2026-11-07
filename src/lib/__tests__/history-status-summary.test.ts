import {describe,it,expect} from 'vitest';
import {nativeSyncSummary} from '../sync-status-summary';
const base={pending:0,failed:0,conflicts:0,lastPushAt:'2026-11-06T01:00:00Z',historyRecovery:{pending:true,membershipOnly:true,status:'queued',completedRows:12,error:null}};
const database={enabled:true,connected:true,tradingReady:true};
describe('pending missing-history work remains visible between bounded quanta',()=>{
 it('does not present a pending history job as a completed journal-only check',()=>{const summary=nativeSyncSummary(base,database);expect(summary).toMatchObject({state:'checking',label:'Recovering history',pending:0});expect(summary.detail).toContain('12 missing history records');expect(summary.detail).toContain('does not acknowledge');});
 it('shows the actual retained retry error without claiming completion',()=>{const summary=nativeSyncSummary({...base,historyRecovery:{...base.historyRecovery,error:'The central history service did not answer.'}},database);expect(summary).toMatchObject({state:'degraded',label:'History recovery waiting'});expect(summary.detail).toContain('central history service');});
 it('preserves real errors, pause and core transfer precedence',()=>{expect(nativeSyncSummary({...base,lastError:'Upload refused'},database).label).toBe('Needs attention');expect(nativeSyncSummary({...base,paused:true},database).label).toBe('Paused');expect(nativeSyncSummary({...base,running:true,phase:'pulling'},database).label).toBe('Receiving updates');});
 it('does not hide pending journal work, unknown counts or a disabled/disconnected database',()=>{expect(nativeSyncSummary({...base,pending:2},database).label).toBe('Waiting to upload');expect(nativeSyncSummary({...base,pending:null},database).label).toBe('Checking synchronization');expect(nativeSyncSummary(base,{...database,enabled:false}).label).toBe('Local sync disabled');expect(nativeSyncSummary(base,{...database,connected:false}).label).toBe('Local SQL unavailable');});
 it('returns to the existing precise queue-only statement after membership completes',()=>{const summary=nativeSyncSummary({...base,historyRecovery:{...base.historyRecovery,pending:false}},database);expect(summary.label).toBe('Journal queue clear');expect(summary.detail).toContain('does not verify historical data completeness');});
 it('does not trust untyped or malformed presentation fields as proof of work',()=>{for(const historyRecovery of [null,{}, {pending:'true',membershipOnly:true}, {pending:true,membershipOnly:false}])expect(nativeSyncSummary({...base,historyRecovery},database).label).toBe('Journal queue clear');});
});

describe('checkout-ready scoped history compatibility', () => {
  const held = {
    ...base,
    historyRecovery: {
      pending: true, status: 'retrying', code: 'EHISTORY_POLICY_UNAVAILABLE', branchId: 'branch-a',
    },
  };
  const ready = {
    ...database, state: 'enabled_ready',
    detail: { phase: 'history_recovery', syncReady: false, historyPending: true, branchId: 'branch-a' },
  };

  it('shows checkout availability and pending history without claiming full synchronization', () => {
    const summary = nativeSyncSummary(held, ready);
    expect(summary).toMatchObject({ state: 'degraded', label: 'Checkout ready · History pending', pending: 0 });
    expect(summary.detail).toContain('will retry automatically');
    expect(summary.detail).toContain('Full synchronization still needs verification');
    expect(nativeSyncSummary({ ...held, pending: null }, ready)).toMatchObject({ state: 'degraded', pending: null });
  });

  it('does not show checkout ready from stale, cross-branch or incomplete readiness data', () => {
    for (const unproven of [
      { ...ready, detail: null },
      { ...ready, detail: { ...ready.detail, branchId: 'branch-b' } },
      { ...ready, detail: { ...ready.detail, syncReady: true } },
      { ...ready, detail: { ...ready.detail, historyPending: false } },
      { ...ready, state: 'enabled_bootstrapping' },
    ]) {
      expect(nativeSyncSummary(held, unproven)).toMatchObject({ state: 'degraded', label: 'History recovery waiting' });
    }
    expect(nativeSyncSummary(held, { ...ready, tradingReady: false }).label).toBe('Preparing local database');
    expect(nativeSyncSummary(held, { ...ready, connected: false }).label).toBe('Local SQL unavailable');
  });

  it('keeps genuine journal work, errors and active transfer visible', () => {
    const journal = nativeSyncSummary({ ...held, pending: 2 }, ready);
    expect(journal).toMatchObject({ label: 'Waiting to upload', pending: 2 });
    expect(journal.detail).toContain('History also remains pending');
    expect(nativeSyncSummary({ ...held, lastError: 'Shift review required' }, ready).label).toBe('Needs attention');
    expect(nativeSyncSummary({ ...held, paused: true }, ready).label).toBe('Paused');
    expect(nativeSyncSummary({ ...held, running: true, phase: 'pulling' }, ready).label).toBe('Receiving updates');
  });
});
