import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  sponsorshipInput,
  sponsorshipApprovalPayload,
  visibleSponsorship,
  type SponsorshipRecord,
} from "./sponsorship";
const proof = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
});
async function caller(data: z.infer<typeof proof>, storeId: string | null, permission: string) {
  const { requireCallerScope } = await import("./privileged-caller.server");
  const scope = await requireCallerScope(data, { permission });
  if (scope.kind === "terminal" || !scope.staffUserId)
    throw new Error("A current staff sign-in is required");
  if (
    (storeId && scope.storeId && scope.storeId.toLowerCase() !== storeId.toLowerCase()) ||
    (scope.branchRestricted && !scope.storeId)
  )
    throw new Error("This sponsorship is outside your assigned branch");
  return scope;
}
async function sponsorshipDatabaseError(response: Response, fallback: string) {
  let message = fallback;
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message) message = payload.message.slice(0, 300);
  } catch {
    /* Keep a readable fallback for a non-JSON upstream response. */
  }
  return new Error(message);
}
const owner = (scope: { role: string | null; roleSlug: string | null }) =>
  scope.role === "admin" || scope.roleSlug === "admin";
export const loadSponsorships = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    proof
      .extend({
        storeId: z.string().min(1).max(64),
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const scope = await caller(data, data.storeId, "can_view_sponsorship");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest(
      `sponsorship_issues?store_id=eq.${encodeURIComponent(data.storeId)}&order=created_at.desc,id.desc&limit=50&offset=${data.offset}`,
    );
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "The sponsorship database upgrade is not installed yet"
          : "Could not load sponsorships",
      );
    const records = (await response.json()) as SponsorshipRecord[];
    let approvals: { id: string; status: string; decision_note: string | null }[] = [];
    if (records.length) {
      const res = await serviceRest(
        `authorization_requests?id=in.(${records.map((record) => record.id).join(",")})&select=id,status,decision_note`,
      );
      if (!res.ok) throw new Error("Could not verify sponsorship approvals");
      approvals = await res.json();
    }
    return records.map((record) => ({
      ...visibleSponsorship(
        record,
        owner(scope) || scope.permissions.can_view_cost_margin === true,
      ),
      approval_status: approvals.find((item) => item.id === record.id)?.status ?? "not_submitted",
      approval_note: approvals.find((item) => item.id === record.id)?.decision_note ?? "",
    }));
  });
export const requestSponsorship = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ proof, routing: sponsorshipInput }).parse(input))
  .handler(async ({ data }) => {
    const input = data.routing;
    const scope = await caller(data.proof, input.storeId, "can_create_sponsorship");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest("rpc/prepare_numbered_sponsorship", {
      method: "POST",
      body: JSON.stringify({
        p_id: input.id,
        p_store: input.storeId,
        p_recipient: input.recipient,
        p_contact: input.contact,
        p_purpose: input.purpose,
        p_lines: input.lines,
        p_actor: scope.staffUserId,
        p_number_prefix: input.numbering.prefix,
        p_start: input.numbering.minimum,
        p_padding: input.numbering.padding,
      }),
    });
    if (!response.ok)
      throw await sponsorshipDatabaseError(response, "The sponsorship could not be prepared");
    const record = (await response.json()) as SponsorshipRecord;
    const { sponsorshipDirectAllowed } = await import("./sponsorship.server");
    if (await sponsorshipDirectAllowed(scope))
      return {
        ...visibleSponsorship(
          record,
          owner(scope) || scope.permissions.can_view_cost_margin === true,
        ),
        approval_status: "not_required",
      };
    const { submitAuthorizationRequest } = await import("./authorization.functions");
    const result = await submitAuthorizationRequest({
      data: {
        ...data.proof,
        requestId: record.id,
        actionKey: "sponsorship",
        storeId: record.store_id,
        terminalId: scope.terminalId ?? "",
        reason: record.purpose,
        payload: sponsorshipApprovalPayload(record),
        requestedAmount: record.total_value,
        valueUnit: "currency",
      },
    });
    if (!result.ok)
      throw new Error(result.error || "Could not submit the sponsorship for approval");
    return visibleSponsorship(
      record,
      owner(scope) || scope.permissions.can_view_cost_margin === true,
    );
  });
export const handOverSponsorship = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    proof
      .extend({ id: z.string().uuid(), receivedBy: z.string().trim().min(2).max(160) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const scope = await caller(data, null, "can_issue_sponsorship");
    const { sponsorshipRecord } = await import("./sponsorship.server");
    const record = await sponsorshipRecord(data.id);
    if (scope.storeId && scope.storeId.toLowerCase() !== record.store_id.toLowerCase())
      throw new Error("This sponsorship is outside your assigned branch");
    const { getRequest, loadRuleRows, hasApprovalAudit, hasRequestAudit } =
      await import("./authorization.server");
    const { sponsorshipDirectAllowed } = await import("./sponsorship.server");
    if (record.status !== "issued" && !(await sponsorshipDirectAllowed(scope))) {
      const request = await getRequest(data.id);
      if (
        !request ||
        request.status !== "approved" ||
        !request.decidedBy ||
        request.decidedBy === request.requestedBy ||
        !(await hasApprovalAudit(request.id)) ||
        !(await hasRequestAudit(request.id))
      )
        throw new Error("A separate, audited approval is required for every sponsorship");
      const { approvalPerson } = await import("./approval-token-server");
      const approver = await approvalPerson(request.decidedBy);
      const { approverActionAllowed } = await import("./approval-action-permissions");
      const { approvalPersonBranchAllowed } = await import("./approval-branch-scope");
      const { resolveRules, canDecideRequestAmount, isRoutedApprover } =
        await import("./authorization");
      const rule = resolveRules(await loadRuleRows(record.store_id), record.store_id).sponsorship;
      if (
        !approver?.is_active ||
        !approverActionAllowed("sponsorship", approver) ||
        !approvalPersonBranchAllowed(approver, record.store_id) ||
        !isRoutedApprover(request, { userId: approver.user_id }) ||
        !canDecideRequestAmount(
          rule,
          { userId: approver.user_id, role: approver.role_slug || approver.role },
          request,
          record.total_value,
        )
      )
        throw new Error("The sponsorship approval is no longer eligible; request a new approval");
    }
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest("rpc/issue_sponsorship", {
      method: "POST",
      body: JSON.stringify({
        p_id: data.id,
        p_actor: scope.staffUserId,
        p_received_by: data.receivedBy,
      }),
    });
    if (!response.ok) {
      throw await sponsorshipDatabaseError(
        response,
        "The database did not confirm sponsorship handover; refresh the history before retrying",
      );
    }
    return visibleSponsorship(
      (await response.json()) as SponsorshipRecord,
      owner(scope) || scope.permissions.can_view_cost_margin === true,
    );
  });

/** Read only totals for authorized sales-report viewers, never recipient details. */
export const loadSponsorshipDailyValues = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    proof
      .extend({
        storeId: z.string().min(1).max(64),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        zone: z.string().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await caller(data, data.storeId, "can_view_sales_reports");
    const duration = Date.parse(data.to) - Date.parse(data.from);
    if (!Number.isFinite(duration) || duration < 0 || duration > 731 * 86400000)
      throw new Error("Choose a reporting period of at most two years");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest("rpc/sponsorship_daily_values", {
      method: "POST",
      body: JSON.stringify({
        p_store: data.storeId,
        p_from: data.from,
        p_to: data.to,
        p_zone: data.zone,
      }),
    });
    if (!response.ok) throw new Error("Could not load sponsorship reporting totals");
    return (await response.json()) as { day: string; value: number }[];
  });

export const getSponsorshipAccess = createServerFn({ method: "POST" })
  .validator((input: unknown) => proof.parse(input))
  .handler(async ({ data }) => {
    const scope = await caller(data, null, "can_view_sponsorship");
    const { sponsorshipDirectAllowed } = await import("./sponsorship.server");
    return { direct: await sponsorshipDirectAllowed(scope) };
  });
export const getSponsorshipDirectPolicy = createServerFn({ method: "POST" })
  .validator((input: unknown) => proof.parse(input))
  .handler(async ({ data }) => {
    const scope = await caller(data, null, "can_access_pos_settings");
    if (!owner(scope))
      throw new Error("Only an administrator can manage direct sponsorship issuers");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const [policy, people] = await Promise.all([
      serviceRest("sponsorship_direct_issue_policy?id=eq.1&limit=1"),
      serviceRest("app_users?select=user_id,full_name&is_active=eq.true&order=full_name.asc"),
    ]);
    if (!policy.ok || !people.ok)
      throw new Error("Could not load the sponsorship direct issue policy");
    const rows = (await policy.json()) as { user_ids: string[]; row_version: number }[];
    if (!rows[0]) throw new Error("The direct issue policy database upgrade is required");
    return {
      userIds: rows[0].user_ids,
      version: rows[0].row_version,
      people: (await people.json()) as { user_id: string; full_name: string }[],
    };
  });
export const saveSponsorshipDirectPolicy = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    proof
      .extend({
        userIds: z.array(z.string().min(1).max(160)).max(100),
        version: z.number().int().nonnegative(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const scope = await caller(data, null, "can_access_pos_settings");
    if (!owner(scope))
      throw new Error("Only an administrator can manage direct sponsorship issuers");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest("rpc/save_sponsorship_direct_issuers", {
      method: "POST",
      body: JSON.stringify({
        p_users: [...new Set(data.userIds)],
        p_version: data.version,
        p_actor: scope.staffUserId,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Could not save direct sponsorship issuers: ${(await response.text()).slice(0, 200)}`,
      );
    const saved = (await response.json()) as { user_ids: string[]; row_version: number };
    return { userIds: saved.user_ids, version: saved.row_version };
  });
