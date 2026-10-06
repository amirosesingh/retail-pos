/**
 * Server functions for the authorisation framework.
 *
 * Every entry point proves who is calling before it does anything, and every
 * outcome — approved, rejected, wrong PIN or refused — is written to the
 * authorisation log.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const caller = z.object({
  sessionToken: z.string().min(10).optional(),
  accessToken: z.string().min(10).optional(),
  terminalToken: z.string().min(10).optional(),
  cashierToken: z.string().min(10).optional(),
});

const rulesInput = caller.extend({ storeId: z.string().max(64).optional() });
const peopleInput = caller.extend({ storeId: z.string().max(64).optional() });

const saveRuleInput = caller.extend({
  actionKey: z.string().min(1).max(64),
  scopeType: z.enum(["global", "branch"]),
  scopeId: z.string().max(64).default(""),
  mode: z.enum(["none", "pin", "request", "either"]),
  allowedRoles: z.array(z.string().max(40)).max(20).default([]),
  allowedUserIds: z.array(z.string().max(64)).max(50).default([]),
  requesterRoles: z.array(z.string().max(40)).max(20).default([]),
  requesterUserIds: z.array(z.string().max(64)).max(50).default([]),
  authorityLimits: z.record(z.string(), z.number().finite().nonnegative()).default({}),
  extraAuthority: z.record(z.string(), z.number().finite().nonnegative()).default({}),
  absoluteCeilings: z.record(z.string(), z.number().finite().nonnegative()).default({}),
  approvalTimeoutMinutes: z.number().int().min(1).max(1440).default(15),
  escalationAfterMinutes: z.number().int().min(1).max(1440).nullable().default(null),
  escalationRoles: z.array(z.string().max(40)).max(20).default([]),
  requireReason: z.boolean().default(false),
  threshold: z.number().nullable().default(null),
  expectedVersion: z.number().int().nonnegative().default(0),
});

const pinInput = caller.extend({
  actionKey: z.string().min(1).max(64),
  authorizerId: z.string().min(1).max(64),
  selfAuthorization: z.boolean().default(false),
  pin: z.string().regex(/^\d{4,8}$/),
  storeId: z.string().max(64).optional(),
  terminalId: z.string().max(64).optional(),
  reason: z.string().max(400).optional(),
  requestedAmount: z.number().finite().nonnegative().nullish(),
  requesterDirectLimit: z.number().finite().nonnegative().nullish(),
  valueUnit: z.enum(["percent", "currency", "quantity", "number"]).default("number"),
  binding: z.string().min(1).max(80),
  auditContext: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
});

const snapshotLine = z.object({
  sku: z.string().max(60).default(""),
  name: z.string().max(160).default(""),
  qty: z.number().finite(),
  unitPrice: z.number().finite(),
  discount: z.number().finite().default(0),
  lineTotal: z.number().finite(),
  priceOverridden: z.boolean().optional(),
});

const snapshotInput = z.object({
  ticketId: z.string().max(80).default(""),
  capturedAt: z.string().max(40).default(""),
  storeId: z.string().max(64).default(""),
  terminalId: z.string().max(64).default(""),
  cashier: z.string().max(120).default(""),
  billNo: z.string().max(40).optional(),
  lines: z.array(snapshotLine).max(300).default([]),
  subtotal: z.number().finite().default(0),
  discount: z.number().finite().default(0),
  tax: z.number().finite().default(0),
  serviceCharge: z.number().finite().default(0),
  total: z.number().finite().default(0),
  requestedValue: z.number().finite().nullish(),
  requestedLabel: z.string().max(120).optional(),
  expectedTotal: z.number().finite().nullish(),
  member: z
    .object({
      id: z.string().max(80).default(""),
      code: z.string().max(80).optional(),
      name: z.string().max(160).default(""),
      phone: z.string().max(60).optional(),
      email: z.string().max(160).optional(),
      tier: z.string().max(60).optional(),
      points: z.number().finite().optional(),
      totalSpend: z.number().finite().optional(),
    })
    .nullish(),
});

const submitInput = caller.extend({
  /** Stable across a lost response and the offline fallback. */
  requestId: z.string().uuid().optional(),
  actionKey: z.string().min(1).max(64),
  storeId: z.string().max(64).optional(),
  terminalId: z.string().max(64).optional(),
  reason: z.string().max(400).default(""),
  payload: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
  requestedAmount: z.number().finite().nullish(),
  requesterDirectLimit: z.number().finite().nonnegative().nullish(),
  valueUnit: z.enum(["percent", "currency", "quantity", "number"]).default("number"),
  heldOrderId: z.string().max(80).nullish(),
  snapshot: snapshotInput.nullish(),
});

const listInput = caller.extend({
  storeId: z.string().max(64).optional(),
  allBranches: z.boolean().default(false),
  status: z.string().max(20).default("pending"),
});

const decideInput = caller.extend({
  id: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().max(400).default(""),
  /** the approver may grant a different value than the one asked for */
  approvedAmount: z.number().finite().nullish(),
});

const idInput = caller.extend({
  id: z.string().uuid(),
  reason: z.string().max(400).default("Approval cancelled by requester"),
});

const claimInput = caller.extend({
  id: z.string().uuid(),
  /** the ticket in hand right now, so a changed ticket cannot use an old approval */
  snapshotHash: z.string().max(40).optional(),
});

const mutationInput = caller.extend({
  actionKey: z.string().min(1).max(64),
  storeId: z.string().max(64),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  snapshotHash: z.string().max(40).default(""),
  requestedAmount: z.number().finite().nonnegative().nullish(),
  grantToken: z.string().max(4096).nullish(),
});

type Caller = {
  id: string;
  name: string;
  role: string;
  isSupervisor: boolean;
  storeId: string;
  canAccessAllBranches: boolean;
  canManageRules: boolean;
  canDiscardHeldOrder: boolean;
};

/** Any signed-in till user: a staff account or a cashier PIN session. */
async function assertCaller(data: z.infer<typeof caller>): Promise<Caller> {
  // Use the same proof precedence as the rest of the till backend. A PIN login
  // can carry a revocable device session, a cashier proof and an Auth token at
  // once; the verified person session and terminal activation supply the
  // authoritative actor and branch without letting a second token mask them.
  const [{ verifyRelayCaller }, { resolveRelayScope }] = await Promise.all([
    import("@/core/api/pos-relay.server"),
    import("@/core/api/relay-policy.server"),
  ]);
  const verified = await verifyRelayCaller(data);
  const scope = await resolveRelayScope(verified);
  const role = scope.roleSlug || scope.role || "staff";
  return {
    id: scope.staffUserId || verified.authUserId || scope.label,
    name: scope.actorName || scope.label,
    role,
    isSupervisor: scope.isSupervisor,
    storeId: scope.storeId || "",
    canAccessAllBranches: role === "admin",
    canManageRules:
      role === "admin" || role === "manager" || scope.permissions.can_access_pos_settings === true,
    canDiscardHeldOrder: scope.isSupervisor || scope.permissions.can_discard_held_order === true,
  };
}

export function callerStore(
  who: Pick<Caller, "storeId" | "canAccessAllBranches">,
  requested?: string,
): string {
  const wanted = requested ?? "";
  if (who.canAccessAllBranches) return wanted || who.storeId;
  if (!who.storeId) throw new Error("Your account is not assigned to a branch");
  if (wanted && wanted !== who.storeId) throw new Error("Cross-branch access is not allowed");
  return who.storeId;
}

/** Final mutation boundary: re-read the current rule and verify a bound signed grant. */
export const verifyBusinessAuthorization = createServerFn({ method: "POST" })
  .validator((data: unknown) => mutationInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const storeId = callerStore(who, data.storeId);
      const { loadRuleRows } = await import("./authorization.server");
      const { resolveRules, authorizationBinding, canBypassAuthorization } =
        await import("./authorization");
      const { verifyOverrideGrant } = await import("./pos-rules.server");
      const rule = resolveRules(await loadRuleRows(storeId), storeId)[data.actionKey];
      if (!rule?.isEnabled || rule.mode === "none") return { ok: true as const, required: false };
      if (
        canBypassAuthorization(
          rule,
          { userId: who.id, role: who.role },
          data.requestedAmount,
        )
      ) {
        return { ok: true as const, required: false, bypassedBy: who.id };
      }
      const binding = authorizationBinding(data.payload, data.snapshotHash);
      const grant = verifyOverrideGrant(data.grantToken ?? undefined, data.actionKey, {
        storeId,
        binding,
      });
      if (!grant) {
        return { ok: false as const, error: "A valid authorization grant is required" };
      }
      if (
        grant.approvedAmount !== undefined &&
        grant.approvedAmount !== null &&
        (data.requestedAmount === undefined ||
          data.requestedAmount === null ||
          data.requestedAmount > grant.approvedAmount)
      ) {
        return { ok: false as const, error: "The requested value exceeds the approved amount" };
      }
      // A queued approval can be invalidated after it was claimed (for
      // example when its line or bill is voided). Signed tokens are therefore
      // checked against the durable request status, not trusted in isolation.
      if (grant.requestId) {
        const { getRequest } = await import("./authorization.server");
        const request = await getRequest(grant.requestId);
        if (
          !request ||
          request.status !== "approved" ||
          !request.consumedAt ||
          request.requestedBy.toLowerCase() !== who.id.toLowerCase()
        ) {
          return { ok: false as const, error: "That approval is no longer valid" };
        }
      }
      return { ok: true as const, required: true, grant };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/** Effective rules for the caller's branch. */
export const getAuthorizationRules = createServerFn({ method: "POST" })
  .validator((data: unknown) => rulesInput.parse(data))
  .handler(async ({ data }) => {
    const { loadRuleRows } = await import("./authorization.server");
    try {
      const who = await assertCaller(data);
      const rows = await loadRuleRows(callerStore(who, data.storeId));
      return { ok: true as const, rules: rows };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300), rules: [] };
    }
  });

/** Active people available for named requester/approver assignments. */
export const listAuthorizationPeople = createServerFn({ method: "POST" })
  .validator((data: unknown) => peopleInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      if (!who.canManageRules) return { ok: false as const, error: "Settings permission required" };
      // A global rules editor must be able to choose named approvers from all
      // branches. Branch-scoped editors remain constrained to their own store.
      const storeId =
        who.canAccessAllBranches && !data.storeId ? "" : callerStore(who, data.storeId);
      const { listAuthorizationPeopleRows } = await import("./authorization.server");
      return { ok: true as const, people: await listAuthorizationPeopleRows(storeId) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300), people: [] };
    }
  });

function ruleConfigurationError(data: z.infer<typeof saveRuleInput>): string | null {
  if (data.mode === "none") return null;
  if (!data.allowedRoles.length && !data.allowedUserIds.length) {
    return "Select at least one role or named person who may authorise this action";
  }
  if (
    (data.mode === "request" || data.mode === "either") &&
    !data.requesterRoles.length &&
    !data.requesterUserIds.length
  ) {
    return "Select at least one role or named person who may request approval";
  }
  if ((data.escalationAfterMinutes === null) !== (data.escalationRoles.length === 0)) {
    return "Escalation needs both a delay and at least one backup approver role";
  }
  const badAuthorityKey = [
    ...Object.keys(data.authorityLimits),
    ...Object.keys(data.extraAuthority),
    ...Object.keys(data.absoluteCeilings),
  ].find((key) => !/^(role|user):[a-z0-9._@-]+$/i.test(key));
  return badAuthorityKey
    ? `Authority key "${badAuthorityKey}" must start with role: or user:`
    : null;
}

/** Explicit POS-settings permission edits branch rules; only admins edit global defaults. */
export const saveAuthorizationRule = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveRuleInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      if (!who.canManageRules) {
        return { ok: false as const, error: "POS settings permission is required" };
      }
      if (data.scopeType === "global" && !who.canAccessAllBranches) {
        return { ok: false as const, error: "Only an administrator can change global rules" };
      }
      const configurationError = ruleConfigurationError(data);
      if (configurationError) return { ok: false as const, error: configurationError };
      const scopeId = data.scopeType === "branch" ? callerStore(who, data.scopeId) : "";
      const { saveRuleRow } = await import("./authorization.server");
      const rule = await saveRuleRow({
        actionKey: data.actionKey,
        scopeType: data.scopeType,
        scopeId,
        mode: data.mode,
        allowedRoles: data.allowedRoles,
        allowedUserIds: data.allowedUserIds,
        requesterRoles: data.requesterRoles,
        requesterUserIds: data.requesterUserIds,
        authorityLimits: data.authorityLimits,
        extraAuthority: data.extraAuthority,
        absoluteCeilings: data.absoluteCeilings,
        approvalTimeoutMinutes: data.approvalTimeoutMinutes,
        escalationAfterMinutes: data.escalationAfterMinutes,
        escalationRoles: data.escalationRoles,
        requireReason: data.requireReason,
        threshold: data.threshold,
        isEnabled: true,
        expectedVersion: data.expectedVersion,
        changedBy: who.id || who.name,
      });
      return { ok: true as const, rule };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/**
 * PIN authorisation. The PIN is checked in the database against exactly the
 * people the rule allows, and a short-lived signed grant is returned.
 */
export const authorizeWithPin = createServerFn({ method: "POST" })
  .validator((data: unknown) => pinInput.parse(data))
  .handler(async ({ data }) => {
    const { loadRuleRows, verifyAuthorizationPin, writeLog } =
      await import("./authorization.server");
    const { signOverrideGrant } = await import("./pos-rules.server");
    const { resolveRules, canAuthorizeAmount, effectiveApprovalAuthority } =
      await import("./authorization");
    const { throttleStatus, throttleFail, throttleReset, minutesLeft } =
      await import("./pin-throttle.server");
    const auditContext = Object.fromEntries(
      Object.entries(data.auditContext).filter(
        ([key]) => !["reason", "requested_amount", "self_authorization"].includes(key),
      ),
    );
    let who: Caller;
    try {
      who = await assertCaller(data);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }

    // Guessing is stopped on the server, keyed on the authoriser, so trying
    // from a second till does not reset the count.
    const authorizerId = data.selfAuthorization ? who.id : data.authorizerId;
    const key = `authz:${authorizerId.toLowerCase()}`;
    const state = await throttleStatus(key);
    if (state.locked) {
      return {
        ok: false as const,
        error: `Too many wrong PINs — try again in ${minutesLeft(state)} minute(s)`,
      };
    }

    let storeId: string;
    try {
      storeId = callerStore(who, data.storeId);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
    const rows = await loadRuleRows(storeId);
    const rule = resolveRules(rows, storeId)[data.actionKey];
    if (
      !rule ||
      !rule.isEnabled ||
      rule.mode === "none" ||
      (!data.selfAuthorization && rule.mode !== "pin" && rule.mode !== "either")
    ) {
      await writeLog({
        actionKey: data.actionKey,
        modeUsed: "pin",
        requestedBy: who.id,
        requestedByName: who.name,
        authorizedBy: authorizerId,
        authorizedByName: authorizerId,
        storeId,
        terminalId: data.terminalId ?? "",
        outcome: "denied",
        purpose: data.reason ?? "",
        detail: {
          reason: "PIN is not the configured authorisation method",
          ...auditContext,
        },
      });
      return {
        ok: false as const,
        error: "This rule requires an approval request; a PIN cannot authorise it",
      };
    }
    if (rule.requireReason && (data.reason ?? "").trim().length < 3) {
      return { ok: false as const, error: "A reason is required for this action" };
    }
    const roles = rule?.allowedRoles ?? ["admin", "manager"];
    const users = rule?.allowedUserIds ?? [];

    const person = await verifyAuthorizationPin(authorizerId, data.pin, roles, users);
    if (!person) {
      const after = await throttleFail(key);
      await writeLog({
        actionKey: data.actionKey,
        modeUsed: "pin",
        requestedBy: who.id,
        requestedByName: who.name,
        authorizedBy: authorizerId,
        authorizedByName: authorizerId,
        storeId,
        terminalId: data.terminalId ?? "",
        outcome: "failed_pin",
        purpose: data.reason ?? "",
        detail: { reason: data.reason ?? "", ...auditContext },
      });
      return {
        ok: false as const,
        error: after.locked
          ? `Too many wrong PINs — try again in ${minutesLeft(after)} minute(s)`
          : "That ID or PIN is not allowed to authorise this",
      };
    }
    const { canAuthorize } = await import("./authorization");
    if (!canAuthorize(rule, { userId: person.userId, role: person.role })) {
      return { ok: false as const, error: "This person is excluded from authorising this action" };
    }
    if (
      !canAuthorizeAmount(
        rule,
        { userId: person.userId, role: person.role },
        data.requestedAmount,
        data.requesterDirectLimit,
      )
    ) {
      const authority = effectiveApprovalAuthority(
        rule,
        { userId: person.userId, role: person.role },
        data.requesterDirectLimit,
      );
      await writeLog({
        actionKey: data.actionKey,
        modeUsed: "pin",
        requestedBy: who.id,
        requestedByName: who.name,
        authorizedBy: person.userId,
        authorizedByName: person.name,
        authorizerRole: person.role,
        storeId,
        terminalId: data.terminalId ?? "",
        outcome: "denied",
        purpose: data.reason ?? "",
        detail: {
          reason: "approval authority exceeded",
          requested_amount: data.requestedAmount,
          self_authorization: data.selfAuthorization,
          ...auditContext,
          ...authority,
        },
      });
      return {
        ok: false as const,
        error: `Requested value is ${data.requestedAmount}. This approver's effective maximum is ${authority.effectiveMaximum}. Higher authority is required.`,
      };
    }
    await throttleReset(key);
    const logged = await writeLog({
      actionKey: data.actionKey,
      modeUsed: "pin",
      requestedBy: who.id,
      requestedByName: who.name,
      authorizedBy: person.userId,
      authorizedByName: person.name,
      authorizerRole: person.role,
      storeId,
      terminalId: data.terminalId ?? "",
      outcome: "approved",
      purpose: data.reason ?? "",
      detail: {
        reason: data.reason ?? "",
        requested_amount: data.requestedAmount ?? null,
        self_authorization: data.selfAuthorization,
        ...auditContext,
      },
    });
    if (!logged.ok) {
      return { ok: false as const, error: "Approval audit could not be recorded" };
    }
    return {
      ok: true as const,
      authorizer: { id: person.userId, name: person.name, role: person.role },
      grantToken: signOverrideGrant({
        action: data.actionKey,
        approvedBy: person.userId,
        approvedByName: person.name,
        role: person.role,
        modeUsed: data.selfAuthorization ? "self_pin" : "pin",
        storeId,
        binding: data.binding,
        approvedAmount: data.requestedAmount ?? null,
      }),
    };
  });

/**
 * Send an action to the approvals queue.
 *
 * The ticket travelling with the request is fingerprinted here, on the
 * server, so the till cannot claim later that a different ticket was the one
 * approved. Only people allowed to decide the action are told about it.
 */
export const submitAuthorizationRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => submitInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const {
        createRequest,
        markRequestNotified,
        loadRuleRows,
        listAuthorizationPeopleRows,
        writeLog,
        hasRequestAudit,
      } = await import("./authorization.server");
      const { resolveRules, canRequestApproval } = await import("./authorization");
      const storeId = callerStore(who, data.storeId);
      const rule = resolveRules(await loadRuleRows(storeId), storeId)[data.actionKey];
      if (!canRequestApproval(rule, { userId: who.id, role: who.role })) {
        return {
          ok: false as const,
          error: "You are not allowed to request approval for this action",
        };
      }
      if (rule.requireReason && data.reason.trim().length < 3) {
        return { ok: false as const, error: "A reason is required for this request" };
      }
      const { normalizeSnapshot, snapshotFingerprint } = await import("./ticket-snapshot");
      const snapshot = data.snapshot ? normalizeSnapshot(data.snapshot) : null;
      if (data.actionKey === "discount_over_limit") {
        const billNo = snapshot?.billNo ?? "";
        if (!billNo || snapshot?.ticketId !== billNo || data.payload["bill_no"] !== billNo) {
          return {
            ok: false as const,
            error: "A discount approval must be tied to one reserved bill number",
          };
        }
        if (data.payload["discount_scope"] === "item") {
          const targetIndex = Number(data.payload["target_index"]);
          const line = Number.isInteger(targetIndex) ? snapshot.lines[targetIndex] : undefined;
          const expectedLineKey = line
            ? [billNo, targetIndex, line.sku, line.qty, line.unitPrice].join("|")
            : "";
          if (!line || data.payload["target_line_key"] !== expectedLineKey) {
            return {
              ok: false as const,
              error: "An item approval must match one exact item on that bill",
            };
          }
        } else if (data.payload["discount_scope"] !== "bill") {
          return { ok: false as const, error: "Choose a bill or item discount scope" };
        }
      }
      const branchPeople = await listAuthorizationPeopleRows(storeId);
      // Role authority is deliberately branch-bound. A specifically named
      // person on a global rule may be in another branch, so include only
      // those exact IDs from the company directory.
      const { includedAuthorizationUserIds, excludedAuthorizationUserIds } =
        await import("./authorization");
      const namedIds = new Set(
        includedAuthorizationUserIds(rule.allowedUserIds).map((id) => id.toLowerCase()),
      );
      const excludedIds = new Set(
        excludedAuthorizationUserIds(rule.allowedUserIds).map((id) => id.toLowerCase()),
      );
      const globalPeople =
        rule.scopeType === "global" && namedIds.size
          ? await listAuthorizationPeopleRows("")
          : branchPeople;
      const requesterId = who.id.toLowerCase();
      const branchIds = new Set(branchPeople.map((person) => person.id.toLowerCase()));
      const primaryApprovers = globalPeople.filter(
        (person) =>
          person.id.toLowerCase() !== requesterId &&
          !excludedIds.has(person.id.toLowerCase()) &&
          (namedIds.has(person.id.toLowerCase()) ||
            (branchIds.has(person.id.toLowerCase()) &&
              rule.allowedRoles.some((role) => role.toLowerCase() === person.role.toLowerCase()))),
      );
      if (!primaryApprovers.length) {
        return {
          ok: false as const,
          error: "No active authorized approver is available for this branch and rule",
        };
      }
      const escalationApprovers = branchPeople.filter(
        (person) =>
          person.id.toLowerCase() !== requesterId &&
          rule.escalationRoles.some((role) => role.toLowerCase() === person.role.toLowerCase()),
      );
      const approvalRoute = {
        primaryRoles: rule.allowedRoles,
        primaryUserIds: [...namedIds],
        primaryApprovers,
        escalationAfterMinutes: rule.escalationAfterMinutes,
        escalationRoles: rule.escalationRoles,
        escalationApprovers,
        ruleScopeType: rule.scopeType,
        ruleScopeId: rule.scopeId,
      };
      const created = await createRequest({
        id: data.requestId,
        actionKey: data.actionKey,
        requestedBy: who.id,
        requestedByName: who.name,
        storeId,
        terminalId: data.terminalId ?? "",
        reason: data.reason,
        payload: data.payload,
        ttlHours: rule.approvalTimeoutMinutes / 60,
        requestedAmount: data.requestedAmount ?? snapshot?.requestedValue ?? null,
        requesterDirectLimit: data.requesterDirectLimit ?? null,
        valueUnit: data.valueUnit,
        snapshot,
        snapshotHash: snapshotFingerprint(snapshot),
        heldOrderId: data.heldOrderId ?? null,
        approvalRoute,
      });
      const request = created.request;
      const logged = (await hasRequestAudit(request.id))
        ? { ok: true as const }
        : await writeLog({
            actionKey: request.actionKey,
            modeUsed: "request",
            requestId: request.id,
            requestedBy: request.requestedBy,
            requestedByName: request.requestedByName,
            storeId: request.storeId,
            terminalId: request.terminalId,
            outcome: "requested",
            purpose: request.reason,
            detail: {
              requested_amount: request.requestedAmount,
              requester_direct_limit: request.requesterDirectLimit,
              value_unit: request.valueUnit,
              snapshot_hash: request.snapshotHash,
              held_order_id: request.heldOrderId,
              payload: request.payload,
              approval_route: request.approvalRoute,
            },
          });
      if (!logged.ok) {
        return { ok: false as const, error: "The request could not be added to the audit trail" };
      }
      // A retry after a lost response returns the existing UUID. Do not send
      // the approver a second WhatsApp message for the same logical request.
      if (created.created) {
        await notifyApprovers(request, who).catch(() => undefined);
        await markRequestNotified(request.id);
      }
      return { ok: true as const, request };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/**
 * Tell the people who may decide this action, through the existing activity
 * feed. Nobody else is notified.
 */
async function notifyApprovers(
  request: import("./authorization").AuthorizationRequest,
  who: Caller,
): Promise<void> {
  const { writeActivityEvent } = await import("./activity-events.server");
  const { AUTH_ACTION_LABEL } = await import("./authorization");
  const label = AUTH_ACTION_LABEL[request.actionKey] ?? request.actionKey;
  await writeActivityEvent({
    event_type: "approval_requested",
    severity: "warning",
    title: `Approval needed — ${label}`,
    message: request.reason || `${who.name} is waiting for a decision.`,
    actor_id: who.id,
    actor_name: who.name,
    actor_role: who.role,
    terminal_id: request.terminalId || null,
    terminal_name: null,
    store_id: request.storeId || null,
    entity_type: "authorization_request",
    entity_id: request.id,
    amount: request.requestedAmount,
    meta: {
      action_key: request.actionKey,
      audience: "configured_approvers",
      audience_user_ids: request.approvalRoute?.primaryApprovers.map((person) => person.id) ?? [],
      audience_roles: request.approvalRoute?.primaryRoles ?? [],
      escalation_after_minutes: request.approvalRoute?.escalationAfterMinutes ?? null,
      escalation_user_ids:
        request.approvalRoute?.escalationApprovers.map((person) => person.id) ?? [],
      escalation_roles: request.approvalRoute?.escalationRoles ?? [],
    },
    client_event_id: `approval-req-${request.id}`,
    created_at: new Date().toISOString(),
  });
}

/** Tell the cashier who asked what happened to their request. */
async function notifyRequester(
  request: {
    id: string;
    actionKey: string;
    requestedBy: string;
    storeId: string;
    terminalId: string;
  },
  approve: boolean,
  approver: Caller,
  amount: number | null,
): Promise<void> {
  const { writeActivityEvent } = await import("./activity-events.server");
  const { AUTH_ACTION_LABEL } = await import("./authorization");
  const label = AUTH_ACTION_LABEL[request.actionKey] ?? request.actionKey;
  await writeActivityEvent({
    event_type: approve ? "approval_granted" : "approval_rejected",
    severity: approve ? "info" : "warning",
    title: approve ? `Approved — ${label}` : `Rejected — ${label}`,
    message: approve
      ? `${approver.name} approved the request. It is ready to use once.`
      : `${approver.name} rejected the request.`,
    actor_id: approver.id,
    actor_name: approver.name,
    actor_role: approver.role,
    terminal_id: request.terminalId || null,
    terminal_name: null,
    store_id: request.storeId || null,
    entity_type: "authorization_request",
    entity_id: request.id,
    amount,
    meta: {
      action_key: request.actionKey,
      audience: request.requestedBy,
      audience_user_ids: [request.requestedBy],
    },
    client_event_id: `approval-decision-${request.id}`,
    created_at: new Date().toISOString(),
  });
}

/** Notify the originating till when its approval window closes unanswered. */
async function notifyRequesterExpired(
  request: import("./authorization").AuthorizationRequest,
): Promise<void> {
  const { writeActivityEvent } = await import("./activity-events.server");
  const { AUTH_ACTION_LABEL } = await import("./authorization");
  const label = AUTH_ACTION_LABEL[request.actionKey] ?? request.actionKey;
  await writeActivityEvent({
    event_type: "approval_expired",
    severity: "warning",
    title: `Expired — ${label}`,
    message: "The approval window expired. The restricted action remains blocked.",
    actor_id: null,
    actor_name: "System",
    actor_role: "system",
    terminal_id: request.terminalId || null,
    terminal_name: null,
    store_id: request.storeId || null,
    entity_type: "authorization_request",
    entity_id: request.id,
    amount: request.requestedAmount,
    meta: {
      action_key: request.actionKey,
      audience: request.requestedBy,
      audience_user_ids: [request.requestedBy],
    },
    client_event_id: `approval-expired-${request.id}`,
    created_at: new Date().toISOString(),
  });
}

/** The approvals queue, for anyone allowed to decide something. */
export const listAuthorizationRequests = createServerFn({ method: "POST" })
  .validator((data: unknown) => listInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const { expirePendingRequests, listRequests, loadRuleRows, writeLog } =
        await import("./authorization.server");
      const { resolveRules, canViewAuthorizationRequest } = await import("./authorization");
      const expired = await expirePendingRequests();
      await Promise.all(
        expired.map(async (request) => {
          await writeLog({
            actionKey: request.actionKey,
            modeUsed: "request",
            requestId: request.id,
            requestedBy: request.requestedBy,
            requestedByName: request.requestedByName,
            storeId: request.storeId,
            terminalId: request.terminalId,
            outcome: "expired",
            purpose: request.reason,
            detail: {
              expires_at: request.expiresAt,
              approval_route: request.approvalRoute,
            },
          });
          await notifyRequesterExpired(request).catch(() => undefined);
          const { releaseDecidedHold } = await import("./record-edits.server");
          await releaseDecidedHold(request.id).catch(() => undefined);
        }),
      );
      if (data.allBranches && !who.canAccessAllBranches) {
        return {
          ok: false as const,
          error: "Only administrators can view approvals across branches",
          requests: [] as never[],
          rules: [] as never[],
        };
      }
      const requestedStoreId = data.allBranches ? "" : callerStore(who, data.storeId);
      // Fetch broadly on the trusted server, then return only branch-bound or
      // explicitly routed rows. This lets a named cross-branch approver see
      // their ticket without granting general cross-branch browsing.
      const all = await listRequests({
        allBranches: true,
        status: data.status,
      });
      const rulesByStore = new Map<string, ReturnType<typeof resolveRules>>();
      for (const branch of new Set(all.map((request) => request.storeId))) {
        rulesByStore.set(branch, resolveRules(await loadRuleRows(branch), branch));
      }
      // Someone only sees what they could act on, plus their own requests.
      const visible = all.filter((r) => {
        const sameBranch = r.storeId === requestedStoreId;
        const branchVisible = (data.allBranches && who.canAccessAllBranches) || sameBranch;
        return canViewAuthorizationRequest(
          rulesByStore.get(r.storeId)?.[r.actionKey],
          { userId: who.id, role: who.role },
          r,
          branchVisible,
          Date.now(),
          data.status === "all" && who.canAccessAllBranches,
        );
      });
      const visibleBranches = new Set(visible.map((request) => request.storeId));
      return {
        ok: true as const,
        requests: visible,
        me: { id: who.id, role: who.role },
        rules: Array.from(rulesByStore.entries())
          .filter(([branch]) => visibleBranches.has(branch))
          .flatMap(([, rules]) => Object.values(rules)),
      };
    } catch (e) {
      return {
        ok: false as const,
        error: (e as Error).message.slice(0, 300),
        requests: [] as never[],
        rules: [] as never[],
      };
    }
  });

/** Approve or reject from the decider's own signed-in session — no PIN. */
export const decideAuthorizationRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => decideInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const { getRequest, decideRequest, loadRuleRows, writeLog, hasRequestAudit } =
        await import("./authorization.server");
      const {
        resolveRules,
        canAuthorizeAmount,
        canAuthorizeEscalated,
        canDecideRequestAmount,
        effectiveApprovalAuthority,
        isRoutedApprover,
      } = await import("./authorization");
      const existing = await getRequest(data.id);
      if (!existing) return { ok: false as const, error: "That request no longer exists" };
      const routed = isRoutedApprover(existing, { userId: who.id });
      const explicitCrossBranch = !!existing.approvalRoute && routed;
      if (!who.canAccessAllBranches && existing.storeId !== who.storeId && !explicitCrossBranch) {
        return { ok: false as const, error: "Cross-branch access is not allowed" };
      }
      if (!(await hasRequestAudit(existing.id))) {
        return { ok: false as const, error: "This request has no verified creation audit" };
      }
      if (existing.status !== "pending") {
        return { ok: false as const, error: `This request is already ${existing.status}` };
      }
      const rules = resolveRules(
        await loadRuleRows(existing.storeId).catch(() => []),
        existing.storeId,
      );
      const requestedDecisionAmount = data.approve
        ? (data.approvedAmount ?? existing.requestedAmount ?? null)
        : existing.requestedAmount;
      if (!routed) {
        return { ok: false as const, error: "This request was not routed to you" };
      }
      if (
        !canDecideRequestAmount(
          rules[existing.actionKey],
          { userId: who.id, role: who.role },
          existing,
          requestedDecisionAmount,
        )
      ) {
        const authority = effectiveApprovalAuthority(
          rules[existing.actionKey],
          {
            userId: who.id,
            role: who.role,
          },
          existing.requesterDirectLimit,
        );
        await writeLog({
          actionKey: existing.actionKey,
          modeUsed: "request",
          requestId: existing.id,
          requestedBy: existing.requestedBy,
          requestedByName: existing.requestedByName,
          authorizedBy: who.id,
          authorizedByName: who.name,
          authorizerRole: who.role,
          storeId: existing.storeId,
          terminalId: existing.terminalId,
          outcome: "denied",
          purpose: existing.reason,
          detail: {
            reason: "approval authority exceeded",
            requested_amount: requestedDecisionAmount,
            ...authority,
          },
        });
        return {
          ok: false as const,
          error:
            authority.effectiveMaximum === null
              ? "You are not allowed to decide this action"
              : `Requested value is ${requestedDecisionAmount}. Your effective maximum is ${authority.effectiveMaximum}. Higher authority is required.`,
        };
      }
      if (existing.requestedBy.toLowerCase() === who.id.toLowerCase()) {
        return { ok: false as const, error: "You cannot approve your own request" };
      }
      // The approver may grant a smaller value than the one asked for; the
      // amount stored is the one their session sent, never the till's.
      const approvedAmount = data.approve
        ? (data.approvedAmount ?? existing.requestedAmount ?? null)
        : null;
      const currentRule = rules[existing.actionKey];
      const usedEscalation =
        !canAuthorizeAmount(
          currentRule,
          { userId: who.id, role: who.role },
          requestedDecisionAmount,
          existing.requesterDirectLimit,
        ) && canAuthorizeEscalated(currentRule, { role: who.role }, existing.createdAt);
      const updated = await decideRequest({
        id: data.id,
        approve: data.approve,
        decidedBy: who.id,
        decidedByName: who.name,
        note: data.note,
        approvedAmount,
        approvedPayload: data.approve
          ? { ...existing.payload, approved_amount: approvedAmount }
          : {},
      });
      if (!updated) {
        const latest = await getRequest(data.id);
        return {
          ok: false as const,
          error: latest
            ? `This request is already ${latest.status}`
            : "That request no longer exists",
          request: latest,
        };
      }
      const decisionLogged = await writeLog({
        actionKey: existing.actionKey,
        modeUsed: "request",
        requestId: existing.id,
        requestedBy: existing.requestedBy,
        requestedByName: existing.requestedByName,
        authorizedBy: who.id,
        authorizedByName: who.name,
        authorizerRole: who.role,
        storeId: existing.storeId,
        terminalId: existing.terminalId,
        outcome: data.approve ? "approved" : "rejected",
        purpose: existing.reason,
        detail: {
          note: data.note,
          requested_amount: existing.requestedAmount,
          approved_amount: approvedAmount,
          requester_direct_limit: existing.requesterDirectLimit,
          value_unit: existing.valueUnit,
          ...effectiveApprovalAuthority(
            rules[existing.actionKey],
            { userId: who.id, role: who.role },
            existing.requesterDirectLimit,
          ),
          snapshot_hash: existing.snapshotHash,
          held_order_id: existing.heldOrderId,
          approval_route: existing.approvalRoute,
          escalated: usedEscalation,
          escalation_eligible_at: existing.approvalRoute?.escalationAfterMinutes
            ? new Date(
                Date.parse(existing.createdAt) +
                  existing.approvalRoute.escalationAfterMinutes * 60_000,
              ).toISOString()
            : null,
        },
      });
      if (!decisionLogged.ok) {
        return {
          ok: false as const,
          error: "Decision saved, but its audit entry failed; support must reconcile it before use",
        };
      }
      await notifyRequester(existing, data.approve, who, approvedAmount).catch(() => undefined);
      // A rejected request must not leave a posted record locked.
      if (!data.approve) {
        const { releaseDecidedHold } = await import("./record-edits.server");
        await releaseDecidedHold(existing.id).catch(() => undefined);
      }
      return { ok: true as const, request: updated };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/**
 * Where a request the caller made has got to.
 *
 * This is the only place an approval turns into permission. A live message
 * saying "approved" is a notification, nothing more; the till still has to
 * come here, and the server checks the owner, the status, the expiry, the
 * ticket it was granted against and that nobody has used it already.
 */
export const claimAuthorizationRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => claimInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const { getRequest, consumeRequest, hasApprovalAudit } =
        await import("./authorization.server");
      const { signOverrideGrant } = await import("./pos-rules.server");
      const { authorizationBinding } = await import("./authorization");
      const request = await getRequest(data.id);
      if (!request) return { ok: false as const, error: "That request no longer exists" };
      callerStore(who, request.storeId);
      if (request.requestedBy.toLowerCase() !== who.id.toLowerCase()) {
        return { ok: false as const, error: "That request belongs to someone else" };
      }
      if (request.status !== "approved") {
        return {
          ok: true as const,
          status: request.status,
          grantToken: "",
          approvedAmount: null,
        };
      }
      if (!(await hasApprovalAudit(request.id))) {
        return { ok: false as const, error: "This approval has no verified audit entry" };
      }
      // The ticket must still be the one the approver looked at.
      if (request.snapshotHash && data.snapshotHash !== request.snapshotHash) {
        return {
          ok: false as const,
          error: "The ticket has changed since it was approved — send it again",
        };
      }
      const grantToken = signOverrideGrant({
        action: request.actionKey,
        approvedBy: request.decidedBy ?? "approval",
        role: "approval",
        storeId: request.storeId,
        binding: authorizationBinding(request.payload, request.snapshotHash),
        requestId: request.id,
        approvedAmount: request.approvedAmount ?? request.requestedAmount ?? null,
      });
      const claimed = await consumeRequest(
        request.id,
        request.snapshotHash ? request.snapshotHash : undefined,
      );
      if (!claimed) {
        return { ok: false as const, error: "That approval has already been used" };
      }
      return {
        ok: true as const,
        status: "approved" as const,
        actionKey: request.actionKey,
        approvedAmount: request.approvedAmount ?? request.requestedAmount,
        requestedAmount: request.requestedAmount,
        requesterDirectLimit: request.requesterDirectLimit,
        valueUnit: request.valueUnit,
        approvedPayload: request.approvedPayload,
        approvedBy: request.decidedBy,
        approvedByName: request.decidedByName,
        grantToken,
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/**
 * The requester may void a pending or approved request. This is also the
 * lifecycle hook used when its held bill or approved line is discarded.
 */
export const cancelAuthorizationRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => idInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const { cancelRequest, getRequest, writeLog } = await import("./authorization.server");
      const request = await getRequest(data.id);
      // A request may already have expired or been removed. That is the same
      // safe outcome the discard flow is trying to achieve.
      if (!request) {
        return { ok: true as const, changed: false, status: "missing" as const };
      }
      callerStore(who, request.storeId);
      const ownsRequest = request.requestedBy.toLowerCase() === who.id.toLowerCase();
      if (!ownsRequest && !who.isSupervisor && !who.canDiscardHeldOrder) {
        return { ok: false as const, error: "That request cannot be cancelled" };
      }
      if (request.status !== "pending" && request.status !== "approved") {
        return { ok: true as const, changed: false, status: request.status };
      }
      // cancelRequest deliberately filters by the original owner. Passing the
      // acting supervisor here would turn a valid cross-cashier discard into
      // a silent no-op.
      const done = await cancelRequest(data.id, request.requestedBy, data.reason);
      if (!done) return { ok: false as const, error: "That request could not be cancelled" };
      const logged = await writeLog({
        actionKey: request.actionKey,
        modeUsed: "request",
        requestId: request.id,
        requestedBy: request.requestedBy,
        requestedByName: request.requestedByName,
        storeId: request.storeId,
        terminalId: request.terminalId,
        outcome: "cancelled",
        purpose: data.reason,
        detail: {
          previous_status: request.status,
          consumed_at: request.consumedAt,
          approved_by: request.decidedBy,
          approved_by_name: request.decidedByName,
          approved_amount: request.approvedAmount,
          approved_payload: request.approvedPayload,
        },
      });
      return logged.ok
        ? { ok: true as const, changed: true, status: "cancelled" as const }
        : { ok: false as const, error: "Request cancelled, but its audit entry failed" };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/** Administrators set another person's authorisation PIN; it is never read back. */
export const setStaffAuthorizationPin = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    caller.extend({ userId: z.string().min(1), pin: z.string().regex(/^\d{4,6}$/) }).parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      if (!who.isSupervisor) return { ok: false as const, error: "Administrators only" };
      const { setUserAuthorizationPin, writeLog } = await import("./authorization.server");
      await setUserAuthorizationPin(data.userId, data.pin, who.id);
      const logged = await writeLog({
        actionKey: "staff.set_pin",
        modeUsed: "admin_auto",
        outcome: "approved",
        requestedBy: who.id,
        requestedByName: who.name,
        authorizedBy: who.id,
        authorizedByName: who.name,
        authorizerRole: who.role,
        purpose: `Set authorisation PIN for ${data.userId}`,
        detail: { target: data.userId },
      });
      if (!logged.ok) {
        return { ok: false as const, error: "PIN was changed, but its audit entry failed" };
      }
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });
