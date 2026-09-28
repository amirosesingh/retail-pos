/**
 * One authorisation path for every sensitive action.
 *
 * 1. The branch rule says how the action must be authorised — not at all, by
 *    PIN, by an approval request, or either.
 * 2. An administrator is never prompted; the server records their approval.
 * 3. Everyone else gets the one prompt, and the answer comes from the server.
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
import { useAuthOptional } from "@/lib/pos-auth";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { GATE_RULE_KEY, offlineApprovalMode, type GateAction } from "@/lib/pos-rules";
import { isOnline } from "@/lib/sync-outbox";
import { authorizeAsAdmin } from "@/lib/pos-rules.functions";
import { getAuthorizationRules } from "@/lib/authorization-client";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  AUTH_ACTION_LABEL,
  normalizeRule,
  resolveRules,
  rulesFromLegacy,
  type AuthActionKey,
  type AuthPayload,
  type RuleMap,
} from "@/lib/authorization";
import type { TicketSnapshot } from "@/lib/ticket-snapshot";

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
  const auth = useAuthOptional();
  const isAdmin = auth?.user?.role === "admin";
  const [pending, setPending] = useState<AuthorizationPrompt | null>(null);
  const resolver = useRef<((outcome: PromptOutcome) => void) | null>(null);

  const query = useQuery({
    queryKey: ["authorization-rules", storeId ?? ""],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const caller = await getPosCallerAuth();
      const res = await getAuthorizationRules({ data: { ...caller, storeId: storeId ?? "" } });
      if (!res.ok) throw new Error(res.error);
      return res.rules.map((r) => normalizeRule({ ...r, action_key: r.actionKey }));
    },
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
      const rule = rules[request.action];
      const mode = rule?.mode ?? "none";

      // 1 · this branch does not gate the action
      if (mode === "none") return { ok: true, grantToken: null };

      // 2 · with no connection the branch rule decides what may still be
      //     approved here, and how.
      const offline = !isOnline();
      let promptMode = mode;
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

      // 3 · administrators are not prompted; the approval is logged server-side
      if (isAdmin) {
        try {
          const caller = await getPosCallerAuth();
          if (caller.accessToken) {
            const res = await authorizeAsAdmin({
              data: {
                accessToken: caller.accessToken,
                action: request.action,
                ruleKey:
                  (GATE_RULE_KEY as Record<string, string>)[request.action] ?? request.action,
                ...(request.storeId ? { storeId: request.storeId } : {}),
                ...(request.terminalId ? { terminalId: request.terminalId } : {}),
                ...(request.detail ? { detail: request.detail } : {}),
              },
            });
            if (res.ok) {
              // An approval that could not be recorded is still allowed, but
              // it is never allowed to pass unnoticed.
              if (res.warning) toast.warning(res.warning);
              return { ok: true, grantToken: res.grantToken };
            }
          }
        } catch {
          /* fall through — an admin is still allowed through */
        }
        return { ok: true, grantToken: null };
      }

      // 4 · everyone else: PIN, an approval request, or their choice of both
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
        });
      });

      if (outcome.kind === "approved") return { ok: true, grantToken: outcome.grantToken };
      if (outcome.kind === "submitted") {
        return { ok: false, grantToken: null, pendingRequestId: outcome.requestId };
      }
      return { ok: false, grantToken: null };
    },
    [rules, isAdmin, legacyRules],
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
      authorize: async () => ({ ok: true, grantToken: null }),
      rules: {},
    }
  );
}
