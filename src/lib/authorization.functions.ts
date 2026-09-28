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
  accessToken: z.string().min(10).optional(),
  terminalToken: z.string().min(10).optional(),
  cashierToken: z.string().min(10).optional(),
});

const rulesInput = caller.extend({ storeId: z.string().max(64).optional() });

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
  requireReason: z.boolean().default(false),
  threshold: z.number().nullable().default(null),
});

const pinInput = caller.extend({
  actionKey: z.string().min(1).max(64),
  authorizerId: z.string().min(1).max(64),
  pin: z.string().regex(/^\d{4,8}$/),
  storeId: z.string().max(64).optional(),
  terminalId: z.string().max(64).optional(),
  reason: z.string().max(400).optional(),
  requestedAmount: z.number().finite().nonnegative().nullish(),
  requesterDirectLimit: z.number().finite().nonnegative().nullish(),
  valueUnit: z.enum(["percent", "currency", "quantity", "number"]).default("number"),
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
      name: z.string().max(160).default(""),
      tier: z.string().max(60).optional(),
      points: z.number().finite().optional(),
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

const idInput = caller.extend({ id: z.string().uuid() });

const claimInput = caller.extend({
  id: z.string().uuid(),
  /** the ticket in hand right now, so a changed ticket cannot use an old approval */
  snapshotHash: z.string().max(40).optional(),
});

type Caller = { id: string; name: string; role: string; isSupervisor: boolean };

/** Any signed-in till user: a staff account or a cashier PIN session. */
async function assertCaller(data: z.infer<typeof caller>): Promise<Caller> {
  if (data.accessToken) {
    const { verifyPosStaff } = await import("./secure-settings.server");
    const staff = await verifyPosStaff(data.accessToken);
    return { id: staff.userId, name: staff.userId, role: staff.role, isSupervisor: staff.isAdmin };
  }
  const sessionToken = data.cashierToken ?? data.terminalToken;
  if (sessionToken) {
    const { verifyCashierSession } = await import("./pos-session.server");
    const session = verifyCashierSession(sessionToken);
    if (session) {
      return { id: session.id, name: session.username, role: "cashier", isSupervisor: false };
    }
  }
  throw new Error("Not signed in");
}

/** Effective rules for the caller's branch. */
export const getAuthorizationRules = createServerFn({ method: "POST" })
  .validator((data: unknown) => rulesInput.parse(data))
  .handler(async ({ data }) => {
    const { loadRuleRows } = await import("./authorization.server");
    try {
      await assertCaller(data);
      const rows = await loadRuleRows(data.storeId ?? "");
      return { ok: true as const, rules: rows };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300), rules: [] };
    }
  });

/** Administrators only; the write itself is made with service rights. */
export const saveAuthorizationRule = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveRuleInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      if (!who.isSupervisor) return { ok: false as const, error: "Administrators only" };
      const { saveRuleRow } = await import("./authorization.server");
      await saveRuleRow({
        actionKey: data.actionKey,
        scopeType: data.scopeType,
        scopeId: data.scopeType === "branch" ? data.scopeId : "",
        mode: data.mode,
        allowedRoles: data.allowedRoles,
        allowedUserIds: data.allowedUserIds,
        requesterRoles: data.requesterRoles,
        requesterUserIds: data.requesterUserIds,
        authorityLimits: data.authorityLimits,
        extraAuthority: data.extraAuthority,
        absoluteCeilings: data.absoluteCeilings,
        requireReason: data.requireReason,
        threshold: data.threshold,
        isEnabled: true,
      });
      return { ok: true as const };
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
    let who: Caller;
    try {
      who = await assertCaller(data);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }

    // Guessing is stopped on the server, keyed on the authoriser, so trying
    // from a second till does not reset the count.
    const key = `authz:${data.authorizerId.toLowerCase()}`;
    const state = await throttleStatus(key);
    if (state.locked) {
      return {
        ok: false as const,
        error: `Too many wrong PINs — try again in ${minutesLeft(state)} minute(s)`,
      };
    }

    const rows = await loadRuleRows(data.storeId ?? "").catch(() => []);
    const rule = resolveRules(rows, data.storeId ?? "")[data.actionKey];
    const roles = rule?.allowedRoles ?? ["admin", "manager"];
    const users = rule?.allowedUserIds ?? [];

    const person = await verifyAuthorizationPin(data.authorizerId, data.pin, roles, users);
    if (!person) {
      const after = await throttleFail(key);
      await writeLog({
        actionKey: data.actionKey,
        modeUsed: "pin",
        requestedBy: who.id,
        authorizedBy: data.authorizerId,
        storeId: data.storeId ?? "",
        terminalId: data.terminalId ?? "",
        outcome: "failed_pin",
        detail: { reason: data.reason ?? "" },
      });
      return {
        ok: false as const,
        error: after.locked
          ? `Too many wrong PINs — try again in ${minutesLeft(after)} minute(s)`
          : "That ID or PIN is not allowed to authorise this",
      };
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
        authorizedBy: person.userId,
        authorizerRole: person.role,
        storeId: data.storeId ?? "",
        terminalId: data.terminalId ?? "",
        outcome: "denied",
        detail: {
          reason: "approval authority exceeded",
          requested_amount: data.requestedAmount,
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
      authorizedBy: person.userId,
      authorizerRole: person.role,
      storeId: data.storeId ?? "",
      terminalId: data.terminalId ?? "",
      outcome: "approved",
      detail: { reason: data.reason ?? "", requested_amount: data.requestedAmount ?? null },
    });
    return {
      ok: true as const,
      authorizer: { id: person.userId, name: person.name, role: person.role },
      grantToken: signOverrideGrant({
        action: data.actionKey,
        approvedBy: person.userId,
        role: person.role,
      }),
      warning: logged.ok ? "" : "Approved, but the audit entry could not be written.",
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
      const { createRequest, markRequestNotified, loadRuleRows } =
        await import("./authorization.server");
      const { resolveRules, canRequestApproval } = await import("./authorization");
      const rule = resolveRules(await loadRuleRows(data.storeId ?? ""), data.storeId ?? "")[
        data.actionKey
      ];
      if (!canRequestApproval(rule, { userId: who.id, role: who.role })) {
        return {
          ok: false as const,
          error: "You are not allowed to request approval for this action",
        };
      }
      const { normalizeSnapshot, snapshotFingerprint } = await import("./ticket-snapshot");
      const snapshot = data.snapshot ? normalizeSnapshot(data.snapshot) : null;
      const created = await createRequest({
        id: data.requestId,
        actionKey: data.actionKey,
        requestedBy: who.id,
        requestedByName: who.name,
        storeId: data.storeId ?? "",
        terminalId: data.terminalId ?? "",
        reason: data.reason,
        payload: data.payload,
        ttlHours: 24,
        requestedAmount: data.requestedAmount ?? snapshot?.requestedValue ?? null,
        requesterDirectLimit: data.requesterDirectLimit ?? null,
        valueUnit: data.valueUnit,
        snapshot,
        snapshotHash: snapshotFingerprint(snapshot),
        heldOrderId: data.heldOrderId ?? null,
      });
      const request = created.request;
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
    meta: { action_key: request.actionKey, audience: "approvers" },
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
    meta: { action_key: request.actionKey, audience: request.requestedBy },
    client_event_id: `approval-decision-${request.id}`,
    created_at: new Date().toISOString(),
  });
}

/** The approvals queue, for anyone allowed to decide something. */
export const listAuthorizationRequests = createServerFn({ method: "POST" })
  .validator((data: unknown) => listInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const { listRequests, loadRuleRows } = await import("./authorization.server");
      const { resolveRules, canAuthorizeAmount } = await import("./authorization");
      const rules = resolveRules(
        await loadRuleRows(data.storeId ?? "").catch(() => []),
        data.storeId ?? "",
      );
      const all = await listRequests({
        ...(data.storeId ? { storeId: data.storeId } : {}),
        allBranches: data.allBranches,
        status: data.status,
      });
      // Someone only sees what they could act on, plus their own requests.
      const visible = all.filter(
        (r) =>
          r.requestedBy.toLowerCase() === who.id.toLowerCase() ||
          canAuthorizeAmount(
            rules[r.actionKey],
            { userId: who.id, role: who.role },
            r.requestedAmount,
            r.requesterDirectLimit,
          ),
      );
      return {
        ok: true as const,
        requests: visible,
        me: { id: who.id, role: who.role },
        rules: Object.values(rules),
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
      const { getRequest, decideRequest, loadRuleRows, writeLog } =
        await import("./authorization.server");
      const { resolveRules, canAuthorizeAmount, effectiveApprovalAuthority } =
        await import("./authorization");
      const existing = await getRequest(data.id);
      if (!existing) return { ok: false as const, error: "That request no longer exists" };
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
      if (
        !canAuthorizeAmount(
          rules[existing.actionKey],
          { userId: who.id, role: who.role },
          requestedDecisionAmount,
          existing.requesterDirectLimit,
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
          authorizedBy: who.id,
          authorizerRole: who.role,
          storeId: existing.storeId,
          terminalId: existing.terminalId,
          outcome: "denied",
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
      await writeLog({
        actionKey: existing.actionKey,
        modeUsed: "request",
        requestId: existing.id,
        requestedBy: existing.requestedBy,
        authorizedBy: who.id,
        authorizerRole: who.role,
        storeId: existing.storeId,
        terminalId: existing.terminalId,
        outcome: data.approve ? "approved" : "rejected",
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
        },
      });
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
      const { getRequest, consumeRequest } = await import("./authorization.server");
      const { signOverrideGrant } = await import("./pos-rules.server");
      const request = await getRequest(data.id);
      if (!request) return { ok: false as const, error: "That request no longer exists" };
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
      // The ticket must still be the one the approver looked at.
      if (request.snapshotHash && data.snapshotHash && data.snapshotHash !== request.snapshotHash) {
        return {
          ok: false as const,
          error: "The ticket has changed since it was approved — send it again",
        };
      }
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
        approvedAmount: request.approvedAmount ?? request.requestedAmount,
        grantToken: signOverrideGrant({
          action: request.actionKey,
          approvedBy: request.decidedBy ?? "approval",
          role: "approval",
        }),
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });

/** The requester may take back a request nobody has decided yet. */
export const cancelAuthorizationRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => idInput.parse(data))
  .handler(async ({ data }) => {
    try {
      const who = await assertCaller(data);
      const { cancelRequest } = await import("./authorization.server");
      const done = await cancelRequest(data.id, who.id);
      return done
        ? { ok: true as const }
        : { ok: false as const, error: "That request can no longer be cancelled" };
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
      await writeLog({
        actionKey: "staff.set_pin",
        modeUsed: "admin_auto",
        outcome: "approved",
        requestedBy: who.id,
        authorizedBy: who.id,
        authorizerRole: who.role,
        detail: { target: data.userId },
      }).catch(() => undefined);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 300) };
    }
  });
