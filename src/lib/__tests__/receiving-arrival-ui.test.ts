import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { receivingArrivalValue } from '@/platforms/web/components/pos/ReceivingArrivalFields';

const source = readFileSync('src/routes/purchasing.tsx', 'utf8');
const file = ts.createSourceFile('purchasing.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let finalizeSource = '', subscriptionSource = '', capabilitySource = '';
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'finalize') finalizeSource = node.getText(file);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'subscribeArrivalContext') subscriptionSource = node.getText(file);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'readArrivalCapability') capabilitySource = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);

function fixture({ resumed = false, custom = false, failed = false } = {}) {
  const arrival = custom ? { effectiveAt: '2026-11-06T01:02:03.0000000Z', reason: 'Goods arrived before entry' } : undefined;
  const assertCurrent = vi.fn(), checkpoint = vi.fn(() => assertCurrent);
  const prepare = vi.fn(async () => ({ stockArrival: arrival, assertCurrent }));
  const invoice = { id: 'original', invoiceDate: '2026-11-02', entryDate: '2026-11-06T03:00:00Z', supplier: 'Fixture supplier', operator: 'Receiver', lines: [] };
  const commit = vi.fn(async (..._args: unknown[]) => { if (failed) throw new Error('Synthetic save failure'); });
  const update = vi.fn(async (..._args: unknown[]) => { if (failed) throw new Error('Synthetic save failure'); });
  const success = vi.fn(), clear = vi.fn(), notify = vi.fn();
  const scope = {
    invoiceNo: 'INV-1', supplier: 'Fixture supplier', lines: [{ productId: 'p', qty: 1, cost: 2, name: 'Item' }], saving: false,
    finalizingRef: { current: false }, arrivalFields: { current: { checkpoint, prepare } },
    setSaving: vi.fn(), setFinalizeStage: vi.fn(), yieldToUi: vi.fn(async () => {}),
    draftSavePromiseRef: { current: null }, openDraftId: resumed ? 'saved-draft-id' : null,
    finalizeAttempt: { current: 'same-retry-id' }, invoiceNumberTaken: vi.fn(async () => false),
    receivingBranchId: 'registered-branch', hub: { id: 'registered-branch', name: 'Fixture branch' },
    reference: 'existing-grn', nextStockRef: vi.fn(async () => 'new-grn'),
    state: { settings: { integrations: {} }, products: [] }, currentStore: { id: 'registered-branch', code: 'FIX' },
    buildInvoice: vi.fn((_status: string, id: string) => ({ ...invoice, id })),
    can: vi.fn(() => false), db: { commitReceivingInvoice: commit, updateReceivingInvoice: update }, draftLineRemovals: ['removed'],
    stockAt: vi.fn(() => 1), logger: { log: vi.fn() }, recordActivity: vi.fn(), invoiceDate: invoice.invoiceDate,
    totals: { units: 1, cost: 2 }, toast: { error: vi.fn(), success }, money: vi.fn(String), putAwayTargets: [], setPending: vi.fn(),
    defaultPutAwayId: '', showAsPosted: vi.fn(), clearForm: clear, setEntryOpen: vi.fn(),
    reconcileAfterPost: vi.fn(async () => {}), scanRef: { current: { focus: vi.fn() } }, notifyError: notify,
  };
  const js = ts.transpileModule(finalizeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const run = new Function('scope', `const {${Object.keys(scope).join(',')}} = scope; ${js}; return finalize();`);
  return { scope, run: () => run(scope), commit, update, prepare, assertCurrent, clear, success, notify, arrival, invoice };
}

describe('receiving arrival presentation validation', () => {
  it('resolves business-zone time without changing invoice/entry dates or proving device clock', () => {
    const value = receivingArrivalValue('2026-11-06T09:02:03', '  Actual unloading time  ', 'Asia/Brunei');
    expect(value).toEqual({ effectiveAt: '2026-11-06T01:02:03.0000000Z', reason: 'Actual unloading time' });
    expect(Object.isFrozen(value)).toBe(true); expect(value).not.toHaveProperty('clockVerified');
  });
  it.each(['', ' ', 'a\nb', 'a\u0000b', 'x'.repeat(501), '\ud800', '\udc00'])('rejects missing/invalid reason %s', reason => {
    expect(() => receivingArrivalValue('2026-11-06T09:02:03', reason, 'Asia/Brunei')).toThrow();
  });
  it('rejects a nonexistent local time and requires an explicit repeated-time occurrence', () => {
    expect(() => receivingArrivalValue('2026-03-08T02:30', 'Arrival', 'America/New_York')).toThrow(/does not exist/);
    expect(() => receivingArrivalValue('2026-11-01T01:30', 'Arrival', 'America/New_York')).toThrow(/occurs twice/);
    expect(receivingArrivalValue('2026-11-01T01:30', 'Arrival', 'America/New_York', '2026-11-01T06:30:00.0000000Z').effectiveAt)
      .toBe('2026-11-01T06:30:00.0000000Z');
    expect(() => receivingArrivalValue('2026-11-01T01:30', 'Arrival', 'America/New_York', '2026-11-01T07:30:00.0000000Z')).toThrow();
  });
});

describe('actual receiving finalize function optional arrival wiring', () => {
  it.each([false, true])('keeps original default argument count/rows for resumed=%s', async resumed => {
    const f = fixture({ resumed }); await f.run();
    const calls = resumed ? f.update.mock.calls : f.commit.mock.calls;
    expect(calls).toHaveLength(1); expect(calls[0]).toHaveLength(resumed ? 5 : 3);
    expect(calls[0]![0]).toMatchObject({ invoiceDate: f.invoice.invoiceDate, entryDate: f.invoice.entryDate, storeId: 'registered-branch' });
    expect(f.clear).toHaveBeenCalledOnce(); expect(f.notify).not.toHaveBeenCalled();
    expect(f.scope.finalizingRef.current).toBe(false);
  });
  it.each([false, true])('passes only the original optional arrival for resumed=%s', async resumed => {
    const f = fixture({ resumed, custom: true }); await f.run();
    const calls = resumed ? f.update.mock.calls : f.commit.mock.calls;
    expect(calls).toHaveLength(1); expect(calls[0]).toHaveLength(resumed ? 6 : 4);
    expect(calls[0]!.at(-1)).toBe(f.arrival);
    expect(calls[0]![0]).toMatchObject({ id: resumed ? 'saved-draft-id' : 'same-retry-id', invoiceDate: f.invoice.invoiceDate, entryDate: f.invoice.entryDate });
    expect(f.prepare).toHaveBeenCalledOnce(); expect(f.assertCurrent.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it('retains the same attempt and form after failed save; success never runs early', async () => {
    const f = fixture({ custom: true, failed: true }); await f.run();
    expect(f.clear).not.toHaveBeenCalled(); expect(f.success).not.toHaveBeenCalled(); expect(f.notify).toHaveBeenCalledOnce();
    expect(f.scope.finalizeAttempt.current).toBe('same-retry-id'); expect(f.scope.finalizingRef.current).toBe(false);
    expect(f.commit.mock.calls[0]!.at(-1)).toBe(f.arrival);
  });
  it('refuses a scope/entry change during draft wait before creating any receiving commit', async () => {
    const f = fixture({ custom: true });
    f.assertCurrent.mockImplementation(() => { throw new Error('Context changed'); });
    await f.run(); expect(f.commit).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    expect(f.clear).not.toHaveBeenCalled(); expect(f.notify).toHaveBeenCalledOnce();
  });
  it('refuses capability rejection and a context change after readiness resolves', async () => {
    const denied = fixture({ custom: true }); denied.prepare.mockRejectedValue(new Error('Readiness unavailable'));
    await denied.run(); expect(denied.commit).not.toHaveBeenCalled(); expect(denied.clear).not.toHaveBeenCalled();
    const changed = fixture({ custom: true });
    changed.scope.yieldToUi.mockImplementation(async () => { if (changed.prepare.mock.calls.length) changed.assertCurrent.mockImplementation(() => { throw new Error('Context changed'); }); });
    await changed.run(); expect(changed.commit).not.toHaveBeenCalled(); expect(changed.clear).not.toHaveBeenCalled();
  });
  it('leaves posted-correction and draft-autosave code outside arrival capture', () => {
    const posted = source.slice(source.indexOf('async function saveEdit()'), source.indexOf('async function saveEdit()') + 3100);
    const draft = source.slice(source.indexOf('async function persistDraft()'), source.indexOf('async function saveDraftNow()'));
    expect(posted).not.toMatch(/stockArrival|arrivalFields|arrivalReview/);
    expect(draft).not.toMatch(/stockArrival|arrivalFields|arrivalReview/);
    expect(source).not.toMatch(/getDatabaseConfig|loadLocalDbConfig|DatabaseService\.profile/);
  });
});

describe('actual read-only receiving capability/context adapters', () => {
  it('calls only the dedicated no-argument Main capability and treats a missing bridge as unavailable', async () => {
    const js = ts.transpileModule(capabilitySource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const read = new Function('localDb', `${js};return readArrivalCapability;`);
    const capability = vi.fn(async () => ({ ok: true, available: false, reason: 'CAPTURE_NOT_ENABLED' }));
    expect(await read(() => ({ stockArrivalCapability: capability }))()).toEqual({ ok: true, available: false, reason: 'CAPTURE_NOT_ENABLED' });
    expect(capability).toHaveBeenCalledExactlyOnceWith();
    expect(await read(() => null)()).toEqual({ ok: false, available: false });
  });
  it('reuses status notifications without polling; progress-only and healthy pulses do not invalidate capability', () => {
    const handlers: Record<string, (value?: unknown) => void> = {}, disposers = Array.from({ length: 4 }, () => vi.fn());
    const subscribe = (name: string, index: number) => (callback: (value?: unknown) => void) => { handlers[name] = callback; return disposers[index]; };
    const js = ts.transpileModule(subscriptionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const make = new Function('subscribeTerminalConfig', 'subscribeCloudKeys', 'subscribeDatabaseMode', 'localDb', `${js};return subscribeArrivalContext;`);
    const changed = vi.fn(), stop = make(subscribe('terminal', 0), subscribe('cloud', 1), subscribe('mode', 2),
      () => ({ database: { subscribe: subscribe('database', 3) }, sync: { subscribe: () => { throw new Error('Wrong state channel'); } } }))(changed);
    handlers.database!({ phase: 'pulling', running: true, tables: [] });
    handlers.database!({ connected: true, tradingReady: true, enabled: true });
    handlers.database!({ phase: 'idle', pending: 10 });
    expect(changed).not.toHaveBeenCalled();
    handlers.database!({ connected: false, tradingReady: false });
    handlers.database!({ connected: false, tradingReady: false });
    expect(changed).toHaveBeenCalledExactlyOnceWith('readiness');
    handlers.database!({ connected: true, tradingReady: true });
    handlers.database!({ tradingReady: false }); expect(changed).toHaveBeenCalledTimes(2);
    handlers.database!({ connected: true, tradingReady: true, state: 'enabled_ready', get profile() { throw new Error('Profile must not be inspected'); } });
    handlers.database!({ state: 'enabled_validating', get profile() { throw new Error('Profile must not be inspected'); } });
    expect(changed).toHaveBeenCalledTimes(3);
    handlers.terminal!(); handlers.cloud!(); handlers.mode!();
    expect(changed.mock.calls.slice(3)).toEqual([['scope'], ['scope'], ['scope']]);
    stop(); expect(disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
  });
});
