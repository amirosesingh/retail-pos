/**
 * One authorisation path for every sensitive action.
 *
 * 1. The branch rule says how the action must be authorised — not at all, by
 *    PIN, by an approval request, or either.
 * 2. An already-authorised person confirms with their own PIN; other staff
 *    follow the configured request path.
 * 3. The answer comes from the server and yields a signed, action-bound grant.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  AuthorizationDialog,
  type AuthorizationPrompt,
  type PromptOutcome,
} from "@/platforms/web/components/pos/AuthorizationDialog";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { useAuthOptional } from "@/lib/pos-auth";
import { GATE_RULE_KEY, offlineApprovalMode, type GateAction } from "@/lib/pos-rules";
import { isOnline } from "@/lib/sync-outbox";
import { getAuthorizationRules } from "@/lib/authorization-client";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { hasSignedInIdentity } from "@/lib/session-presence";
import {
  AUTH_ACTION_LABEL,
  authorizationBinding,
  canAuthorizeAmount,
  canBypassAuthorization,
  resolveRules,
  rulesFromLegacy,
  type AuthActionKey,
  type AuthPayload,
  type RuleMap,
} from "@/lib/authorization";
import type { TicketSnapshot } from "@/lib/ticket-snapshot";
import { snapshotFingerprint } from "@/lib/ticket-snapshot";
import { claimMatchingApproval } from "@/lib/approval-centre";

export type GateRequest = {
  action: AuthActionKey;
  title: string;
  reason: string;
  storeId?: string | null;
  terminalId?: string | null;
  requestedBy?: string | null;
  detail?: string;
  /** What the approver needs to see when the action is queued. */
  payload?: AuthPayload;
  /** The whole ticket, so a remote approver decides on what the cashier sees. */
  snapshot?: TicketSnapshot | null;
  /** The value being asked for, kept beside whatever is finally granted. */
  requestedAmount?: number | null;
  requesterDirectLimit?: number | null;
  valueUnit?: "percent" | "currency" | "quantity" | "number";
  /** The parked ticket this request belongs to. */
  heldOrderId?: string | null;
};

export type GateResult = {
  ok: boolean;
  grantToken: string | null;
  /** Set when the action was queued instead of run. */
  pendingRequestId?: string;
  /** Locally verified identity when the terminal is offline. */
  offlineApproval?: { id: string; name: string; role: string };
};

type Ctx = { authorize: (request: GateRequest) => Promise<GateResult>; rules: RuleMap };

const ManagerGateContext = createContext<Ctx | null>(null);

export function ManagerGateProvider({
  storeId,
  children,
}: {
  storeId?: string | null;
  children: ReactNode;
}) {
  const { rules: legacyRules } = usePosRules();
  const session = useAuthOptional();
  const [pending, setPending] = useState<AuthorizationPrompt | null>(null);
  const resolver = useRef<((outcome: PromptOutcome) => void) | null>(null);

  const query = useQuery({
    queryKey: ["authorization-rules", storeId ?? ""],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const caller = await getPosCallerAuth();
      const res = await getAuthorizationRules({ data: { ...caller, storeId: storeId ?? "" } });
      if (!res.ok) {
        const message = res.error || "Could not load authorization rules";
        if (import.meta.env.DEV && hasSignedInIdentity())
          console.warn(`[authorization] rules unavailable: ${message}`);
        throw new Error(message);
      }
      return res.rules;
    },
    retry: false,
  });

  // Until the table answers, the branch's existing manager-PIN switches decide.
  const rules = useMemo<RuleMap>(() => {
    const rows = query.data;
    if (!rows) return rulesFromLegacy(legacyRules);
    return resolveRules(
      rows.map((r) => ({ ...r })),
      storeId ?? "",
    );
  }, [query.data, legacyRules, storeId]);

  const authorize = useCallback(
    async (request: GateRequest): Promise<GateResult> => {
      // This provider is mounted behind the terminal shell, so its first rules
      // query can run while the sign-in screen is still visible. Retry once at
      // the moment a restricted action is attempted; by then the cashier proof
      // has been stored. This also recovers cleanly after a transient outage.
      let activeRules = rules;
      if (!query.data) {
        const refreshed = await query.refetch();
        if (refreshed.data) {
          activeRules = resolveRules(
            refreshed.data.map((row) => ({ ...row })),
            storeId ?? "",
          );
        } else {
          const failure = refreshed.error ?? query.error;
          const detail = failure instanceof Error ? failure.message : "Reconnect and try again.";
          toast.error("Authorization rules are not available", {
            description: `The restricted action was blocked. ${detail}`,
          });
          return { ok: false, grantToken: null };
        }
      }
      const rule = activeRules[request.action];
      const mode = rule?.mode ?? "none";

      // 1 · this branch does not gate the action
      if (mode === "none") return { ok: true, grantToken: null };

      const signedInRole = session?.user
        ? session.user.roles.includes("admin")
          ? "admin"
          : session.user.roles.includes("manager")
            ? "manager"
            : session.user.metaRole ?? session.user.role
        : null;
      const signedInWho = {
        userId: session?.user?.staffId ?? null,
        role: signedInRole,
      };
      // A configured administrator approver is already the highest authority
      // at this boundary. The server repeats this check before the mutation.
      if (
        canBypassAuthorization(
          rule,
          signedInWho,
          request.requestedAmount,
        )
      ) {
        return { ok: true, grantToken: null };
      }

      // Retrying the exact action after an asynchronous decision consumes the
      // ready grant instead of opening a second request.
      if (isOnline() && (mode === "request" || mode === "either")) {
        const claimed = await claimMatchingApproval({
          actionKey: request.action,
          storeId: request.storeId,
          payload: request.payload,
          snapshotHash: request.snapshot ? snapshotFingerprint(request.snapshot) : undefined,
        }).catch(() => null);
        if (claimed?.grantToken) {
          if (
            claimed.approvedAmount !== null &&
            request.requestedAmount != null &&
            request.requestedAmount > claimed.approvedAmount
          ) {
            toast.error(`Only ${claimed.approvedAmount.toFixed(2)} was approved.`);
            return { ok: false, grantToken: null };
          }
          return { ok: true, grantToken: claimed.grantToken };
        }
      }

      // 2 · with no connection the branch rule decides what may still be
      //     approved here, and how.
      const offline = !isOnline();
      let promptMode = mode;
      const signedInApprover =
        rule && session?.user && signedInRole &&
        canAuthorizeAmount(
          rule,
          { userId: session.user.staffId, role: signedInRole },
          request.requestedAmount,
          request.requesterDirectLimit,
        )
          ? {
              id: session.user.staffId,
              name: session.user.name,
              role: signedInRole,
            }
          : null;
      // Eligible staff confirm with their own PIN instead of sending an
      // approval request to themselves. The server repeats this authority
      // check before it signs a grant.
      if (signedInApprover) promptMode = "pin";
      const gateAction = (
        request.action in GATE_RULE_KEY ? request.action : null
      ) as GateAction | null;
      if (offline && gateAction) {
        const allowance = offlineApprovalMode(legacyRules, gateAction);
        if (allowance === "refused") {
          toast.error("This needs a connection", {
            description: `${
              AUTH_ACTION_LABEL[request.action] || "This action"
            } can only be approved while the terminal is connected.`,
          });
          return { ok: false, grantToken: null };
        }
        // An approval request cannot travel now, so a PIN is the only route.
        if (allowance === "manager_pin" || mode === "request") promptMode = "pin";
      }

      // 3 · PIN, an approval request, or the configured choice of both.
      const outcome = await new Promise<PromptOutcome>((resolve) => {
        resolver.current = resolve;
        setPending({
          actionKey: request.action,
          mode: promptMode,
          title: request.title || AUTH_ACTION_LABEL[request.action] || "Authorisation",
          reason: request.reason,
          requireReason: rule?.requireReason ?? false,
          ...(request.storeId ? { storeId: request.storeId } : {}),
          ...(request.terminalId ? { terminalId: request.terminalId } : {}),
          ...(request.payload ? { payload: request.payload } : {}),
          binding: authorizationBinding(
            request.payload ?? {},
            request.snapshot ? snapshotFingerprint(request.snapshot) : "",
          ),
          ...(request.snapshot ? { snapshot: request.snapshot } : {}),
          ...(request.requestedAmount === undefined || request.requestedAmount === null
            ? {}
            : { requestedAmount: request.requestedAmount }),
          ...(request.requesterDirectLimit == null
            ? {}
            : { requesterDirectLimit: request.requesterDirectLimit }),
          ...(request.valueUnit ? { valueUnit: request.valueUnit } : {}),
          ...(request.heldOrderId ? { heldOrderId: request.heldOrderId } : {}),
          allowedRoles: rule?.allowedRoles ?? ["admin", "manager"],
          allowedUserIds: rule?.allowedUserIds ?? [],
          authorityLimits: rule?.authorityLimits ?? {},
          extraAuthority: rule?.extraAuthority ?? {},
          absoluteCeilings: rule?.absoluteCeilings ?? {},
          approvalTimeoutMinutes: rule?.approvalTimeoutMinutes ?? 15,
          ...(signedInApprover ? { selfAuthorizer: signedInApprover } : {}),
        });
      });

      if (outcome.kind === "approved") {
        return {
          ok: true,
          grantToken: outcome.grantToken,
          ...(outcome.offline ? { offlineApproval: outcome.authorizer } : {}),
        };
      }
      if (outcome.kind === "submitted") {
        return { ok: false, grantToken: null, pendingRequestId: outcome.requestId };
      }
      return { ok: false, grantToken: null };
    },
    [rules, legacyRules, query, session?.user, storeId],
  );

  const value = useMemo<Ctx>(() => ({ authorize, rules }), [authorize, rules]);

  const finish = (outcome: PromptOutcome) => {
    resolver.current?.(outcome);
    resolver.current = null;
    setPending(null);
  };

  return (
    <ManagerGateContext.Provider value={value}>
      {children}
      <AuthorizationDialog prompt={pending} onFinish={finish} />
    </ManagerGateContext.Provider>
  );
}

export function useManagerGate(): Ctx {
  return (
    useContext(ManagerGateContext) ?? {
      authorize: async () => ({ ok: false, grantToken: null }),
      rules: {},
    }
  );
}
