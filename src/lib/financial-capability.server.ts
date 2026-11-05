import { supabaseConfig } from './external-supabase-config';

type Scope = { organizationId: string; branchId: string; terminalId: string; shiftId?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Validate database metadata; project identity always comes from hosting config. */
export async function financialCapabilityResponse(response: Response, scope: Scope): Promise<Response> {
  try {
    const raw = await response.text();
    if (raw.length > 4096) throw new Error();
    const value = JSON.parse(raw);
    const expected = ['version', 'mode', 'financialProtocol', 'localSchema', 'organizationId', 'branchId', 'terminalId', 'rolloutId', 'revision', 'shiftId', 'shiftMode'].sort();
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected) ||
      value.version !== 1 || value.financialProtocol !== 2 || value.localSchema !== 26 ||
      !['disabled', 'required', 'blocked'].includes(value.mode) || value.organizationId !== scope.organizationId || value.branchId !== scope.branchId || value.terminalId !== scope.terminalId ||
      typeof value.revision !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value.revision) || BigInt(value.revision) > 9223372036854775807n ||
      value.shiftId !== (scope.shiftId ?? null) || (scope.shiftId ? !['legacy', 'required', 'unknown'].includes(value.shiftMode) : value.shiftMode !== null) ||
      (value.mode === 'disabled' ? value.rolloutId !== null || value.revision !== '0' : typeof value.rolloutId !== 'string' || !uuid.test(value.rolloutId) || value.revision === '0')) throw new Error();
    const url = new URL(supabaseConfig().url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error();
    const projectOrigin = url.origin;
    return Response.json({ ...value, projectOrigin });
  } catch {
    return Response.json({ ok: false, code: 'EFINANCIAL_CAPABILITY_UNAVAILABLE', error: 'The financial capability could not be verified. Saved work remains intact.' }, { status: 503 });
  }
}
