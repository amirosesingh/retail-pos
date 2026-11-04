import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayScope } from '@/core/api/relay-policy.server';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), project: 'https://fixture.test', sequence: 0 }));
vi.stubGlobal('fetch', mocks.fetch);
vi.mock('@/lib/external-supabase-config', () => ({ supabaseConfig: () => ({ url: mocks.project, key: 'fixture' }), runtimeEnvValue: () => 'fixture-service' }));
import { runRelayRead, runRelayRpc } from '@/core/api/pos-relay.server';
const scope: RelayScope = { kind: 'cashier', label: 'Cashier', storeId: 'A', terminalId: 'ACTUAL-TILL', staffUserId: 'actual-person', role: 'staff', roleSlug: 'cashier', isSupervisor: false, permissions: { can_process_sale: true } };
const op = { kind: 'rpc' as const, table: 'sales', fn: 'pos_sale_commit', args: { _sale: { store_id: 'A', id: 'sale' }, p_terminal: 'FORGED', p_actor: 'FORGED' } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { mocks.fetch.mockReset(); mocks.project = `https://fixture-${++mocks.sequence}.test`; });
describe('shift-sharing guarded relay', () => {
 it('sends only the verified terminal/actor and all canonical optional defaults', async () => {
  mocks.fetch.mockResolvedValueOnce(json({}));
  expect((await runRelayRpc(op, scope)).ok).toBe(true);
  const [url, init] = mocks.fetch.mock.calls[0];
  expect(url).toContain('/rpc/pos_checkout_sale_for_terminal');
  expect(JSON.parse(init.body)).toEqual({ p_terminal: 'ACTUAL-TILL', p_actor: 'actual-person', _sale: op.args._sale, _items: [], _payments: [], _movements: [], _member: null, _exchange_bill: null });
 });
 it('checks permission and branch before any guarded call', async () => {
  expect((await runRelayRpc(op, { ...scope, permissions: {} })).code).toBe('PERMISSION_DENIED');
  expect((await runRelayRpc({ ...op, args: { _sale: { store_id: 'B' } } }, scope)).code).toBe('STORE_FORBIDDEN');
  expect(mocks.fetch).not.toHaveBeenCalled();
 });
 it('falls back only when the exact new routine is absent on an older schema', async () => {
  mocks.fetch.mockResolvedValueOnce(json({ code: 'PGRST202', message: 'Could not find pos_checkout_sale_for_terminal' }, 404)).mockResolvedValueOnce(json({}));
  expect((await runRelayRpc(op, scope)).ok).toBe(true);
  expect(mocks.fetch.mock.calls[1][0]).toContain('/rpc/pos_sale_commit');
 });
 it('does not repeat a recently confirmed missing-schema request for the same project', async () => {
  mocks.fetch.mockImplementation(async (url: string) => url.endsWith('/pos_checkout_sale_for_terminal') ? json({ code: 'PGRST202', message: 'Could not find pos_checkout_sale_for_terminal' }, 404) : json({}));
  expect((await runRelayRpc(op, scope)).ok).toBe(true);
  expect((await runRelayRpc(op, scope)).ok).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  mocks.project = 'https://different-project.test';
  expect((await runRelayRpc(op, scope)).ok).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(5);
 });
 it.each([403, 409, 503])('never retries a guarded failure through an older writer (%s)', async status => {
  mocks.fetch.mockResolvedValueOnce(json({ code: 'DENIED' }, status));
  expect((await runRelayRpc(op, scope)).ok).toBe(false);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
 });
 it('does not downgrade on a malformed 404 mentioning the compatibility code', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response('PGRST202 pos_checkout_sale_for_terminal', { status: 404 }));
  expect((await runRelayRpc(op, scope)).ok).toBe(false);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
 });
 it('asks for active shift using the verified identity, not a caller-supplied terminal', async () => {
  mocks.fetch.mockResolvedValueOnce(json({ id: 'own-shift' }));
  expect((await runRelayRead({ kind: 'activeShift', storeId: 'A' }, scope)).row?.id).toBe('own-shift');
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ p_branch: 'A', p_terminal: 'ACTUAL-TILL' });
 });
 it('denies foreign-branch operating reads even for an administrator on a normal till', async () => {
  expect((await runRelayRead({ kind: 'activeShift', storeId: 'B' }, { ...scope, role: 'admin', isSupervisor: true, branchRestricted: true })).code).toBe('STORE_FORBIDDEN');
  expect(mocks.fetch).not.toHaveBeenCalled();
 });
});
