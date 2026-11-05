import { describe, expect, it, vi } from 'vitest';
vi.mock('../external-supabase-config', () => ({ supabaseConfig: () => ({ url: 'https://cloud.test/' }) }));
import { financialCapabilityResponse } from '../financial-capability.server';
const scope = { organizationId: 'default', branchId: 'A', terminalId: 'till-a' };
const descriptor = () => ({ version: 1, mode: 'disabled', financialProtocol: 2, localSchema: 26, ...scope, rolloutId: null, revision: '0', shiftId: null, shiftMode: null });
describe('financial capability response admission', () => {
  it('uses the configured project and keeps never-approved terminals disabled', async () => {
    const response = await financialCapabilityResponse(Response.json(descriptor()), scope);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...descriptor(), projectOrigin: 'https://cloud.test' });
  });
  it.each(['branchId', 'terminalId', 'organizationId'])('rejects a mismatched %s', async field => {
    expect((await financialCapabilityResponse(Response.json({ ...descriptor(), [field]: 'foreign' }), scope)).status).toBe(503);
  });
  it('rejects an injected project rather than forwarding it', async () => {
    expect((await financialCapabilityResponse(Response.json({ ...descriptor(), projectOrigin: 'https://foreign.test' }), scope)).status).toBe(503);
  });
  it.each(['required', 'blocked'])('preserves explicit %s and an exact bigint revision', async mode => {
    const body = { ...descriptor(), mode, revision: '9007199254740993', rolloutId: '11111111-1111-4111-8111-111111111111' };
    const response = await financialCapabilityResponse(Response.json(body), scope);
    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe(body.revision);
  });
  it('requires an authoritative mode for the exact requested shift', async () => {
    const shiftId = '11111111-1111-4111-8111-111111111111';
    for (const shiftMode of ['legacy', 'required', 'unknown']) {
      expect((await financialCapabilityResponse(Response.json({ ...descriptor(), shiftId, shiftMode }), { ...scope, shiftId })).status).toBe(200);
    }
    expect((await financialCapabilityResponse(Response.json(descriptor()), { ...scope, shiftId })).status).toBe(503);
  });
  it.each([{ revision: 1 }, { mode: 'required' }, { revision: '01' }, { revision: '9223372036854775808' }, { shiftMode: 'legacy' }, { localSchema: 25 }])('rejects malformed capability %j', async update => {
    expect((await financialCapabilityResponse(Response.json({ ...descriptor(), ...update }), scope)).status).toBe(503);
  });
});
