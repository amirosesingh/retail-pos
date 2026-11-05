import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), project: 'https://one.test' }));
vi.mock('@/core/api/pos-relay.server', () => ({ serviceRest: mocks.request }));
vi.mock('../external-supabase-config', () => ({ supabaseConfig: () => ({ url: mocks.project }) }));

beforeEach(() => {
  vi.resetModules();
  mocks.request.mockReset();
  mocks.project = 'https://one.test';
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const load = async () => (await import('../financial-live-readiness.server')).financialLiveAdapterReady;

describe('financial adapter readiness', () => {
  it('shares identical in-flight checks and caches readiness only within its project', async () => {
    let finish!: (value: Response) => void;
    mocks.request.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const ready = await load();
    const first = ready(), second = ready();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    finish(response({ ready: true, version: 2 }));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await ready()).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    mocks.project = 'https://two.test';
    mocks.request.mockResolvedValueOnce(response({ ready: true, version: 2 }));
    expect(await ready()).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('permits legacy behavior only for the specifically missing capability routine', async () => {
    mocks.request.mockResolvedValueOnce(response({ code: 'PGRST202', message: 'Could not find pos_live_financial_ready' }, 404));
    const ready = await load();
    expect(await ready()).toBe(false);
    expect(await ready()).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [503, { message: 'unavailable' }],
    [403, { message: 'denied' }],
    [404, { code: 'PGRST202', message: 'another function' }],
    [200, { ready: true, version: 1 }],
    [200, { ready: false, version: 2 }],
    [200, { ready: 'true', version: 2 }],
  ])('fails closed rather than downgrading on status %s', async (status, body) => {
    mocks.request.mockResolvedValueOnce(response(body, status as number));
    await expect((await load())()).rejects.toMatchObject({ status: 503, code: 'EFINANCIAL_ADAPTER_UNAVAILABLE' });
  });

  it('does not cache failures and retries the capability check', async () => {
    mocks.request.mockResolvedValueOnce(new Response('not json', { status: 503 }))
      .mockResolvedValueOnce(response({ ready: true, version: 2 }));
    const ready = await load();
    await expect(ready()).rejects.toMatchObject({ status: 503 });
    expect(await ready()).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it('normalizes a transport failure without allowing a legacy write', async () => {
    mocks.request.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect((await load())()).rejects.toMatchObject({ status: 503, code: 'EFINANCIAL_ADAPTER_UNAVAILABLE' });
  });
  it('rejects an oversized capability response', async () => {
    mocks.request.mockResolvedValueOnce(response({ ready: true, version: 2, padding: 'x'.repeat(4096) }));
    await expect((await load())()).rejects.toMatchObject({ status: 503 });
  });
});
