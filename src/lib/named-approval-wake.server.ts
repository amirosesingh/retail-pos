import { RelayAuthenticationError, serviceRest, verifyRelayCaller } from "@/core/api/pos-relay.server";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
import { approverActionAllowed } from "./approval-action-permissions";
import { approvalBranchAllowed, approvalScopeConfigured } from "./approval-branch-scope";
import { canAuthorize, includedAuthorizationUserIds, normalizeRequest, resolveRules } from "./authorization";
import type { AuthorizationRequest, AuthorizationRule } from "./authorization";
import { sameBranchId } from "./branch-id";
import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";
import { TERMINAL_EMAIL_DOMAIN } from "./internal-domains";
import { z } from "zod";

const badgeSchema = z.object({
  action: z.literal("named_approval_badge"),
  projectUrl: z.string().url().max(400),
  accessToken: z.string().min(10).max(4000),
  terminalToken: z.string().min(1).max(200).optional(),
  deviceBindingProof: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict().refine(input => !input.terminalToken || !!input.deviceBindingProof);

type BadgePerson = Parameters<typeof approvalBranchAllowed>[0] & {
  id: string;
  role: string | null;
};

export function namedApprovalBadgeVisible(request: AuthorizationRequest, rule: AuthorizationRule | undefined, who: BadgePerson, now = Date.now()) {
  const route = request.approvalRoute;
  const id = who.id.toLowerCase();
  if (!id || who.branchRestricted || !request.storeId || sameBranchId(request.storeId, who.storeId) ||
      request.requestedBy.toLowerCase() === id || request.status !== "pending" ||
      !(Date.parse(request.expiresAt) > now) || route?.ruleScopeType !== "global" ||
      !route.primaryUserIds.some(userId => userId.toLowerCase() === id) ||
      !route.primaryApprovers.some(person => person.id.toLowerCase() === id)) return false;
  if (approvalScopeConfigured(who.permissions) && !approvalBranchAllowed(who, request.storeId)) return false;
  return rule?.scopeType === "global" && (rule.mode === "request" || rule.mode === "either") &&
    includedAuthorizationUserIds(rule.allowedUserIds).some(userId => userId.toLowerCase() === id) &&
    canAuthorize(rule, { userId: id, role: who.role }) &&
    approverActionAllowed(request.actionKey, { role: who.isAdmin ? "admin" : who.role, permissions: who.permissions });
}

export function namedApprovalWakeProject(): string | undefined {
  const configured = runtimeEnvValue("POS_NAMED_APPROVAL_WAKE_PROJECT_URL");
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" && url.origin === configured && supabaseConfig().url === configured)
      return configured;
  } catch { /* Leave the normal approval refresh active. */ }
  return undefined;
}

export async function readNamedApprovalBadge(body: unknown, signal: AbortSignal) {
  const parsed = badgeSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { ok: false } };
  const project = namedApprovalWakeProject();
  if (!project) return { status: 200, body: { ok: true, enabled: false, approvalIds: [] } };
  if (parsed.data.projectUrl !== project) return { status: 403, body: { ok: false } };

  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  try {
    deadline.throwIfAborted();
    const { accessToken, terminalToken, deviceBindingProof } = parsed.data;
    const caller = await verifyRelayCaller({ accessToken, terminalToken, deviceBindingProof }, { strictAvailability: true });
    const email = caller.email?.toLowerCase();
    if (caller.kind !== "staff" || !caller.authUserId || !email ||
        (email.startsWith("terminal.") && email.endsWith(`@${TERMINAL_EMAIL_DOMAIN}`)))
      return { status: 403, body: { ok: false } };
    deadline.throwIfAborted();
    const scope = await resolveRelayScope(caller, { strictAvailability: true });
    if (scope.stale || !scope.staffUserId || namedApprovalWakeProject() !== project)
      return { status: 403, body: { ok: false } };
    if (scope.branchRestricted) return { status: 200, body: { ok: true, enabled: false, approvalIds: [] } };

    const who = {
      id: scope.staffUserId, role: scope.roleSlug ?? scope.role, storeId: scope.storeId ?? "",
      permissions: scope.permissions, isAdmin: scope.roleSlug === "admin" || scope.role === "admin",
    };
    const now = new Date();
    const query = new URLSearchParams({
      select: "id,action_key,requested_by,store_id,status,expires_at,approval_route",
      status: "eq.pending", expires_at: `gt.${now.toISOString()}`,
      approval_route: `cs.${JSON.stringify({ ruleScopeType: "global", primaryUserIds: [who.id.toLowerCase()] })}`,
      order: "created_at.desc,id.desc", limit: "100",
    });
    const { loadRuleRows } = await import("./authorization.server");
    const rulesByStore = new Map<string, ReturnType<typeof resolveRules>>();
    const approvalIds = new Set<string>();
    for (let offset = 0; approvalIds.size < 10; offset += 100) {
      query.set("offset", String(offset));
      const response = await serviceRest(`authorization_requests?${query}`, { signal: deadline });
      if (!response.ok) return { status: 503, body: { ok: false } };
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || rows.length > 100) return { status: 503, body: { ok: false } };
      for (const row of rows) {
        deadline.throwIfAborted();
        const request = normalizeRequest(row);
        if (!request.storeId || sameBranchId(request.storeId, who.storeId)) continue;
        let rules = rulesByStore.get(request.storeId);
        if (!rules) {
          rules = resolveRules(await loadRuleRows(request.storeId, deadline), request.storeId);
          rulesByStore.set(request.storeId, rules);
        }
        if (namedApprovalBadgeVisible(request, rules[request.actionKey], who))
          approvalIds.add(request.id);
        if (approvalIds.size === 10) break;
      }
      if (rows.length < 100) break;
    }
    if (namedApprovalWakeProject() !== project || deadline.aborted) return { status: 503, body: { ok: false } };
    return { status: 200, body: { ok: true, project, approvalIds: [...approvalIds] } };
  } catch (error) {
    const status = error instanceof RelayAuthenticationError || (error as { status?: number })?.status === 401 ? 403 : 503;
    return { status, body: { ok: false } };
  }
}

export async function wakeNamedApprovers(request: AuthorizationRequest): Promise<void> {
  if (!namedApprovalWakeProject() || request.approvalRoute?.ruleScopeType !== "global" ||
      !request.approvalRoute.primaryUserIds.length) return;
  try {
    const response = await serviceRest("rpc/pos_send_named_approval_wake_v1", {
      method: "POST",
      signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({ p_request_id: request.id }),
    });
    await response.body?.cancel();
  } catch { /* The committed request and its authorized refresh are durable. */ }
}
