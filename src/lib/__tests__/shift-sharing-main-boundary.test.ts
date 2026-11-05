import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync(resolve('electron/main.cjs'), 'utf8').replaceAll('\r\n', '\n');

function fixture(saved: Record<string, unknown>) {
  const start = source.indexOf('  ipcMain.handle("business:commit-aggregate"');
  const end = source.indexOf('  ipcMain.handle(', start + 10);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const helper = source.match(/function isManagementDevice\(\)\{[^\n]+\}/)?.[0];
  expect(helper).toBeTruthy();
  const callbacks = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const commit = vi.fn().mockResolvedValue({ ok: true });
  const context = {
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => callbacks.set(name, handler) },
    guard: { guarded: (work: () => unknown) => work(), aggregate: (value: unknown) => value },
    terminalStore: { read: () => saved },
    localBranchId: () => 'A', recordId: (value: string) => value.toLowerCase(),
    adminSession: { branchId: () => 'A', touch() {}, identity: () => ({ level: 'admin', permissions: { can_process_sale: true } }) },
    stampVerifiedBranchOperations: (operations: unknown) => operations,
    aggregatePolicy: () => ({ enforcePermissions: true }),
    aggregateRepository: { commit }, publishBusinessChange() {}, scheduleLocalChanges() {}, recordFault() {},
  };
  runInNewContext(helper + '\n' + source.slice(start, end), context);
  return { commit, run: callbacks.get('business:commit-aggregate')! };
}

describe('shift-sharing Main registration authority', () => {
  it.each([
    { tokenId: 'REAL', deviceUse: 'operations', locationId: 'A' },
    { tokenId: 'REAL', deviceUse: 'management', locationId: 'A' },
  ])('ignores a renderer management claim for a branch-bound registration', async registration => {
    const f = fixture(registration);
    await f.run(null, { kind: 'sale', branchId: 'FORGED', terminalId: 'FORGED', managementDevice: true, operations: [] });
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.commit.mock.calls[0][1]).toMatchObject({ branchId: 'A', terminalId: 'REAL', managementDevice: false });
  });
  it('preserves canonical Management classification without a registered branch', async () => {
    const f = fixture({ tokenId: 'REAL', deviceUse: 'management' });
    await f.run(null, { kind: 'sale', managementDevice: false, operations: [] });
    expect(f.commit.mock.calls[0][1]).toMatchObject({ terminalId: 'REAL', managementDevice: true });
  });
});
