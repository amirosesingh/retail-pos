import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayScope } from '@/core/api/relay-policy.server';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), ready: vi.fn() }));
vi.stubGlobal('fetch', mocks.fetch);
vi.mock('@/lib/financial-live-readiness.server', () => ({ financialLiveAdapterReady: mocks.ready }));
vi.mock('@/lib/external-supabase-config', () => ({
  supabaseConfig: () => ({ url: 'https://example.test', key: 'k' }),
  runtimeEnvValue: () => 'service-key',
}));
import { runRelayRpc } from '@/core/api/pos-relay.server';
const scope: RelayScope = {
  kind: 'cashier', label: 'Till', storeId: 'STORE-A', role: 'staff', roleSlug: 'cashier',
  permissions: { can_process_refund: true }, isSupervisor: false,
  staffUserId: 'cashier', appUserId: '11111111-1111-4111-8111-111111111111', terminalId: 'TILL-A',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const refund = { kind: 'rpc' as const, table: 'sales', fn: 'sale_refund', args: { _sale_id: 'sale-1', _client_refund_id: 'retry-1', _lines: null } };
beforeEach(() => { mocks.fetch.mockReset(); mocks.ready.mockReset().mockResolvedValue(true); });

describe('financial live relay admission', () => {
  it('preserves legacy optional array defaults in the complete named RPC body', async () => {
    mocks.fetch.mockResolvedValueOnce(json({}));
    const sale = { kind: 'rpc' as const, table: 'sales', fn: 'pos_sale_commit', args: { _sale: { store_id: 'STORE-A' } } };
    expect((await runRelayRpc(sale, { ...scope, permissions: { can_process_sale: true } })).ok).toBe(true);
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(Object.keys(body)).toHaveLength(9);
    expect(body).toMatchObject({ p_items: [], p_payments: [], p_movements: [], p_member: null, p_exchange_bill: null });
  });
  it('uses the financial sale adapter only after the existing sale and branch guards', async () => {
    mocks.fetch.mockResolvedValueOnce(json({}));
    const sale = { kind: 'rpc' as const, table: 'sales', fn: 'pos_sale_commit', args: { _sale: { id: 'sale-1', store_id: 'STORE-A' }, _items: [], _payments: [], _movements: [] } };
    expect((await runRelayRpc(sale, { ...scope, permissions: { can_process_sale: true } })).ok).toBe(true);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toContain('/rpc/pos_live_financial_sale');
    expect(JSON.parse(init.body)).toEqual({ p_author: scope.appUserId, p_branch: 'STORE-A', p_terminal: 'TILL-A', p_sale: sale.args._sale, p_items: [], p_payments: [], p_movements: [], p_member: null, p_exchange_bill: null });
  });
  it('does not admit a sale from a foreign branch', async () => {
    const sale = { kind: 'rpc' as const, table: 'sales', fn: 'pos_sale_commit', args: { _sale: { store_id: 'STORE-B' } } };
    expect((await runRelayRpc(sale, { ...scope, permissions: { can_process_sale: true } })).code).toBe('STORE_FORBIDDEN');
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('derives the refund actor, terminal and branch from the verified scope and record', async () => {
    mocks.fetch.mockResolvedValueOnce(json([{ store_id: 'STORE-A' }])).mockResolvedValueOnce(json({}));
    expect((await runRelayRpc(refund, scope)).ok).toBe(true);
    const [url, init] = mocks.fetch.mock.calls[1];
    expect(url).toContain('/rpc/pos_live_financial_refund');
    expect(JSON.parse(init.body)).toEqual({ p_author: scope.appUserId, p_branch: 'STORE-A', p_terminal: 'TILL-A', p_sale_id: 'sale-1', p_lines: null, p_client_refund_id: 'retry-1', p_reason: null });
  });
  it('checks permission before capability or database requests', async () => {
    expect((await runRelayRpc(refund, { ...scope, permissions: {} })).code).toBe('PERMISSION_DENIED');
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('denies another branch before checking capability', async () => {
    mocks.fetch.mockResolvedValueOnce(json([{ store_id: 'STORE-B' }]));
    expect((await runRelayRpc(refund, scope)).code).toBe('STORE_FORBIDDEN');
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('never retries a failed new adapter through the legacy writer', async () => {
    mocks.fetch.mockResolvedValueOnce(json([{ store_id: 'STORE-A' }])).mockResolvedValueOnce(json({ message: 'conflict' }, 409));
    expect((await runRelayRpc(refund, scope)).ok).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toContain('/rpc/pos_live_financial_refund');
  });
  it('preserves the old writer when the verified capability is absent', async () => {
    mocks.ready.mockResolvedValueOnce(false);
    mocks.fetch.mockResolvedValueOnce(json([{ store_id: 'STORE-A' }])).mockResolvedValueOnce(json({}));
    expect((await runRelayRpc(refund, scope)).ok).toBe(true);
    expect(mocks.fetch.mock.calls[1][0]).toContain('/rpc/sale_refund');
  });
});
