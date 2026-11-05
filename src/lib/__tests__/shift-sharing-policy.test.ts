import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POS_RULES, normalizeRules } from '../pos-rules';
import { effectiveOperatingShiftSharing, operatingShiftAllowed, publishShiftSharing, readShiftSharing, subscribeShiftSharing } from '../shift-sharing-policy';
const require = createRequire(import.meta.url);
const { requireOwnShift, readShiftRules } = require('../../../electron/db/shift-sharing.cjs');
const { OperationsRepository } = require('../../../electron/db/repositories/operations.cjs');
afterEach(() => publishShiftSharing('A', undefined));

describe('branch shift sharing', () => {
  it('defaults ON independently of the number of shifts per till', () => {
    expect(DEFAULT_POS_RULES.allow_branch_shift_sharing).toBe(true);
    expect(DEFAULT_POS_RULES.allow_multiple_shifts_per_terminal).toBe(false);
    expect(normalizeRules({ allow_branch_shift_sharing: false }).allow_branch_shift_sharing).toBe(false);
  });
  it('preserves offline shared shift selection when an older/default rules read is unavailable', () => {
    const shift = { storeId: 'A', terminalId: 'T1' };
    expect(operatingShiftAllowed(shift, 'A', 'T2', effectiveOperatingShiftSharing(undefined))).toBe(true);
    expect(operatingShiftAllowed(shift, 'A', 'T2', effectiveOperatingShiftSharing(false))).toBe(false);
  });
  it('keeps branch locking absolute even when sharing is ON', () => {
    expect(operatingShiftAllowed({ storeId: 'B', terminalId: 'T1' }, 'A', 'T1', true)).toBe(false);
  });
  it('allows same-branch sharing ON and only the same till OFF', () => {
    const shift = { storeId: 'A', terminalId: 'T1' };
    expect(operatingShiftAllowed(shift, 'A', 'T2', true)).toBe(true);
    expect(operatingShiftAllowed(shift, 'A', 'T2', false)).toBe(false);
    expect(operatingShiftAllowed(shift, 'A', 't1', false)).toBe(true);
    expect(operatingShiftAllowed({ ...shift, terminalId: undefined }, 'A', 'T1', false)).toBe(false);
    expect(operatingShiftAllowed(shift, 'A', null, false)).toBe(true);
  });
  it('publishes only changes and clears a branch policy without persistent storage', () => {
    let calls = 0;
    const off = subscribeShiftSharing(() => calls++);
    publishShiftSharing('A', false); publishShiftSharing('A', false);
    expect(readShiftSharing('A')).toBe(false); expect(calls).toBe(1);
    publishShiftSharing('A', undefined); expect(readShiftSharing('A')).toBeUndefined(); expect(calls).toBe(2);
    off();
  });
  it.each([null, undefined, 'T2'])('native guard denies missing or foreign till %s', terminal => {
    expect(() => requireOwnShift({ terminal_id: 'T1' }, terminal, false)).toThrow('own shift');
  });
  it('native guard preserves other cashiers on the same till and sharing ON', () => {
    expect(() => requireOwnShift({ terminal_id: 'T1' }, 't1', false)).not.toThrow();
    expect(() => requireOwnShift({ terminal_id: 'T1' }, 'T2', true)).not.toThrow();
  });
  it('native effective rules preserve NULL inheritance and old schema ON', async () => {
    let rows: unknown[] = [{ store_id: '', allow_branch_shift_sharing: false }, { store_id: 'A', allow_branch_shift_sharing: null }];
    class Request { input() { return this; } async query() { return { recordset: [{ rules_json: JSON.stringify(rows) }] }; } }
    const connection = { sql: () => ({ Request }) };
    expect((await readShiftRules(connection, {}, 'A')).sharing).toBe(false);
    rows = [{ store_id: '', allow_branch_shift_sharing: false }, { store_id: 'A', allow_branch_shift_sharing: true }];
    expect((await readShiftRules(connection, {}, 'A')).sharing).toBe(true);
    rows = [{ store_id: 'A', allow_multiple_shifts_per_terminal: false }];
    expect((await readShiftRules(connection, {}, 'A')).sharing).toBe(true);
  });
  it('checks the actual local SQL shift owner for new checkout, preserving historical sync', async () => {
    const sqls: string[] = [];
    class Request { input() { return this; } async query(sql: string) { sqls.push(sql); return sql.includes('FOR JSON') ? { recordset: [{ rules_json: '[{"store_id":"A","allow_branch_shift_sharing":false}]' }] } : { recordset: [{ terminal_id: 'T1' }] }; } }
    const repository = new OperationsRepository({ sql: () => ({ Request }) }, { tables: [] });
    const op = { table: 'sales', kind: 'insert', rows: [{ id: 'sale', shift_id: 'shift' }] };
    await expect(repository.assertCheckoutShift({}, op, { branchId: 'A', terminalId: 'T2', enforcePermissions: true })).rejects.toMatchObject({ code: 'ESHIFT_TERMINAL' });
    expect(sqls[1]).toContain('UPDLOCK,HOLDLOCK');
    sqls.length = 0;
    await repository.assertCheckoutShift({}, op, { branchId: 'A', terminalId: 'T2', enforcePermissions: false });
    expect(sqls).toHaveLength(0);
  });
});
