/**
 * Client access to the database-backed POS rules.
 *
 * One rule set, one database routine, several transports. The website asks the
 * app server directly; the Android shell and the Windows till serve the app
 * from a local address inside the device, so they ask the configured hosted
 * backend over the same path every other till call uses.
 *
 * Nothing here decides policy on its own: the strict built-in defaults are a
 * safety net and are always labelled as such, never presented as the saved
 * configuration. The last rule set the database genuinely served is kept — in
 * memory and in the encrypted device store, keyed to this terminal and branch
 * — so a passing outage or a restart does not silently tighten every limit.
 * The frontend only hides and disables; every privileged action is re-checked
 * on the server.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getPosRules } from "./pos-rules.functions";
import { getPosCallerAuth } from "./pos-caller-auth";
import { subscribeSettingsChange } from "./sync-engine";
import { readCachedRules, writeCachedRules, type CachedRules } from "./pos-rules-cache";
import { rulesEqual, pendingExpired } from "./pos-rules-pending";
import { logRules } from "./pos-rules-log";
import { terminalId } from "./activity-journal";
import { serverOrigin, posFetch } from "./server-origin";
import { platformName } from "@/platform-config/platform";

export { platformName };
import { DEFAULT_POS_RULES, normalizeRules, type PosRules } from "./pos-rules";
import {
  classifyRulesFailure,
  type RulesFailure as RulesFailureKind,
} from "./pos-rules-failure";

export const posRulesQueryKey = (storeId: string) => ["pos-rules", storeId.trim()] as const;

/** Why the live values are not in use, in words a supervisor can act on. */
export type { RulesFailure as RulesFailureKind } from "./pos-rules-failure";

/** Where the rules in use came from. */
export type RulesSourceKind =
  "DATABASE" | "LOCAL_PENDING" | "LAST_KNOWN_GOOD" | "DEFAULT_SAFETY" | "UNAVAILABLE";

/** What the terminal is doing about them. */
export type RulesStatus =
  "LIVE" | "SYNCING" | "DEGRADED" | "PENDING_UPLOAD" | "NOT_VERIFIED" | "IDENTITY_UNAVAILABLE";

const FAILURE_TEXT: Record<RulesFailureKind, string> = {
  none: "",
  config: "This deployment has no central database connection configured.",
  auth: "The central database rejected this terminal's credentials.",
  permission: "This account is not allowed to read the saved rules.",
  data: "The saved rules are missing or in an unexpected shape.",
  network: "The central database could not be reached.",
  unknown: "The saved rules could not be read.",
};

const STATUS_TEXT: Record<RulesStatus, string> = {
  LIVE: "Live from the central database.",
  SYNCING: "Checking the central database…",
  DEGRADED: "Using the last confirmed rules — the latest check did not get through.",
  PENDING_UPLOAD:
    "A change saved on this terminal is in force here and is waiting to reach the central system.",
  NOT_VERIFIED:
    "This terminal has never received its branch rules, so the strict safety rules apply.",
  IDENTITY_UNAVAILABLE: "This terminal does not know its branch yet.",
};

type Ctx = {
  rules: PosRules;
  loading: boolean;
  /** True when the rules shown are the built-in safety set, not the saved ones. */
  usingDefaults: boolean;
  /** True when confirmed rules are in use but the last refresh failed. */
  degraded: boolean;
  /** True when this terminal has never received verified branch rules. */
  notVerified: boolean;
  status: RulesStatus;
  statusText: string;
  source: RulesSourceKind;
  failure: RulesFailureKind;
  /** Plain-language reason, safe to show to a supervisor. */
  failureText: string;
  backendError: string;
  /** Content stamp of the rule set in use, for diagnostics. */
  revision: string;
  branchId: string;
  terminalId: string;
  platform: string;
  lastSyncedAt: number | null;
  refresh: () => Promise<void>;
  confirmSaved: (snapshot: unknown) => Promise<void>;
  rowVersion: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

const RulesContext = createContext<Ctx | null>(null);

type Snapshot = {
  rules: PosRules;
  usingDefaults: boolean;
  degraded: boolean;
  notVerified: boolean;
  status: RulesStatus;
  source: RulesSourceKind;
  failure: RulesFailureKind;
  backendError: string;
  revision: string;
  branchId: string;
  lastSyncedAt: number | null;
  rowVersion: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Answer = {
  ok?: boolean;
  identified?: boolean;
  branchId?: string;
  backend?: string;
  backendError?: string;
  failure?: string;
  revision?: string;
  fetchedAt?: number;
  rules?: unknown;
  error?: string;
  rowVersion?: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

/**
 * Last rule set the database actually served, per branch, for this session.
 * The encrypted device copy behind it survives a restart.
 */
const lastGood = new Map<
  string,
  {
    rules: PosRules;
    revision: string;
    at: number;
    pending?: boolean;
    rowVersion: number;
    updatedAt: string | null;
    updatedBy: string | null;
  }
>();

/** Ask the server, over whichever transport this platform can actually reach. */
async function fetchRules(auth: Record<string, string>, storeId: string): Promise<Answer> {
  if (serverOrigin()) {
    const res = await posFetch("/api/public/pos-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...auth, storeId }),
    });
    const body = (await res.json().catch(() => ({}))) as Answer;
    if (!res.ok)
      return {
        ok: false,
        identified: false,
        failure: res.status === 403 ? "permission" : res.status === 401 ? "auth" : "network",
        error: body.error ?? `Rules request failed (${res.status})`,
      };
    return body;
  }
  return (await getPosRules({ data: { ...auth, storeId } })) as Answer;
}

const retryDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Transient transport failures get a short bounded retry before degrading. */
async function fetchRulesResilient(auth: Record<string, string>, storeId: string): Promise<Answer> {
  let answer: Answer = {};
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      answer = await fetchRules(auth, storeId);
    } catch (error) {
      const message = (error as Error).message;
      answer = { ok: false, failure: classifyRulesFailure(message), error: message };
    }
    if (answer.ok && answer.backend === "database") return answer;
    if (answer.failure !== "network" && answer.failure !== "unknown") return answer;
    if (attempt < 2) await retryDelay(attempt === 0 ? 250 : 750);
  }
  return answer;
}

export function PosRulesProvider({
  storeId,
  children,
}: {
  storeId?: string | null;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const scope = (storeId ?? "").trim();
  const key = useMemo(() => posRulesQueryKey(scope), [scope]);
  const device = useRef<string>("");
  if (!device.current) device.current = typeof window === "undefined" ? "server" : terminalId();

  const query = useQuery<Snapshot>({
    queryKey: key,
    // Rules are security state: always re-check with the server on mount,
    // on focus, on reconnect and on a timer.
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<Snapshot> => {
      const auth = await getPosCallerAuth();
      const platform = platformName();
      const me = device.current;

      // The confirmed set for this branch: memory first, then the encrypted
      // device copy left by an earlier run.
      let cached = lastGood.get(scope) ?? null;
      if (!cached && scope) {
        const stored: CachedRules | null = await readCachedRules(me, scope).catch(() => null);
        if (stored) {
          cached = {
            rules: stored.rules,
            revision: stored.revision,
            at: stored.syncedAt,
            pending: stored.pending === true,
            rowVersion: stored.rowVersion ?? 0,
            updatedAt: stored.updatedAt ?? null,
            updatedBy: stored.updatedBy ?? null,
          };
          lastGood.set(scope, cached);
        }
      }

      const unverified = (
        status: RulesStatus,
        failure: RulesFailureKind,
        backendError: string,
      ): Snapshot => {
        logRules(
          status === "IDENTITY_UNAVAILABLE"
            ? "POS_RULES_IDENTITY_UNAVAILABLE"
            : "POS_RULES_NOT_VERIFIED",
          { platform, terminal_id: me, branch_id: scope, category: failure },
        );
        return {
          rules: { ...DEFAULT_POS_RULES },
          usingDefaults: true,
          degraded: false,
          notVerified: true,
          status,
          source: status === "IDENTITY_UNAVAILABLE" ? "UNAVAILABLE" : "DEFAULT_SAFETY",
          failure,
          backendError,
          revision: "",
          branchId: scope,
          lastSyncedAt: null,
          rowVersion: 0,
          updatedAt: null,
          updatedBy: null,
        };
      };

      const held = (failure: RulesFailureKind, backendError: string): Snapshot => {
        const now = cached!;
        logRules("POS_RULES_USING_LAST_KNOWN_GOOD", {
          platform,
          terminal_id: me,
          branch_id: scope,
          revision: now.revision,
          category: failure,
        });
        return {
          rules: now.rules,
          usingDefaults: false,
          degraded: true,
          notVerified: false,
          status: "DEGRADED",
          source: "LAST_KNOWN_GOOD",
          failure,
          backendError,
          revision: now.revision,
          branchId: scope,
          lastSyncedAt: now.at,
          rowVersion: now.rowVersion,
          updatedAt: now.updatedAt,
          updatedBy: now.updatedBy,
        };
      };

      // A change saved on this terminal that head office has not confirmed
      // yet. It is in force here — that is the point of saving it offline.
      const pendingHeld = (backendError: string): Snapshot => {
        const now = cached!;
        logRules("POS_RULES_PENDING_IN_FORCE", {
          platform,
          terminal_id: me,
          branch_id: scope,
          revision: now.revision,
        });
        return {
          rules: now.rules,
          usingDefaults: false,
          degraded: false,
          notVerified: false,
          status: "PENDING_UPLOAD",
          source: "LOCAL_PENDING",
          failure: "none",
          backendError,
          revision: now.revision,
          branchId: scope,
          lastSyncedAt: now.at,
          rowVersion: now.rowVersion,
          updatedAt: now.updatedAt,
          updatedBy: now.updatedBy,
        };
      };

      // A terminal with no branch identity yet must not be shown the global
      // rules as if they were its branch's configuration.
      if (!scope) return unverified("IDENTITY_UNAVAILABLE", "none", "");

      logRules("POS_RULES_SYNC_STARTED", { platform, terminal_id: me, branch_id: scope });
      try {
        const res = await fetchRulesResilient(auth as Record<string, string>, scope);
        const failure = (res.failure ?? "unknown") as RulesFailureKind;
        if (res.ok && res.identified !== false && res.backend === "database") {
          const at = typeof res.fetchedAt === "number" ? res.fetchedAt : Date.now();
          const revision = res.revision ?? "";
          const rules = normalizeRules(res.rules);
          if (cached?.pending) {
            if (rulesEqual(rules, cached.rules)) {
              // Head office now has the change: it stops being pending.
              logRules("POS_RULES_SAVE_CONFIRMED", {
                platform,
                terminal_id: me,
                branch_id: scope,
                revision,
              });
              cached = {
                rules,
                revision,
                at,
                pending: false,
                rowVersion: Math.max(0, Number(res.rowVersion) || 0),
                updatedAt: res.updatedAt ?? null,
                updatedBy: res.updatedBy ?? null,
              };
              lastGood.set(scope, cached);
              await writeCachedRules({
                terminalId: me,
                branchId: scope,
                revision,
                syncedAt: at,
                rules,
                pending: false,
                rowVersion: cached.rowVersion,
                updatedAt: cached.updatedAt,
                updatedBy: cached.updatedBy,
              });
            } else if (Math.max(0, Number(res.rowVersion) || 0) > cached.rowVersion) {
              // The branch moved on while this terminal was offline. The
              // queued RPC will be rejected as STALE_RULES; stop enforcing
              // the stale local draft and let the confirmed central snapshot
              // replace it below.
              logRules("POS_RULES_PENDING_ABANDONED", {
                platform,
                terminal_id: me,
                branch_id: scope,
                category: "STALE_RULES",
              });
              cached = null;
              lastGood.delete(scope);
            } else if (pendingExpired(cached.at)) {
              // Too old to keep holding the branch to it.
              logRules("POS_RULES_PENDING_ABANDONED", {
                platform,
                terminal_id: me,
                branch_id: scope,
              });
              cached = null;
              lastGood.delete(scope);
            } else {
              lastGood.set(scope, cached);
              return pendingHeld("");
            }
          }
          // A late answer must never put an older rule set back in place.
          if (!cached || at >= cached.at) {
            const changed = !cached || cached.revision !== revision;
            lastGood.set(scope, {
              rules,
              revision,
              at,
              rowVersion: Math.max(0, Number(res.rowVersion) || 0),
              updatedAt: res.updatedAt ?? null,
              updatedBy: res.updatedBy ?? null,
            });
            if (changed) {
              logRules("POS_RULES_REVISION_CHANGED", {
                platform,
                terminal_id: me,
                branch_id: scope,
                revision,
              });
              // Only a genuine change is written back; the whole set at once.
              await writeCachedRules({
                terminalId: me,
                branchId: scope,
                revision,
                syncedAt: at,
                rules,
                rowVersion: Math.max(0, Number(res.rowVersion) || 0),
                updatedAt: res.updatedAt ?? null,
                updatedBy: res.updatedBy ?? null,
              });
            }
          }
          const now = lastGood.get(scope)!;
          logRules("POS_RULES_SYNC_SUCCESS", {
            platform,
            terminal_id: me,
            branch_id: scope,
            revision: now.revision,
          });
          return {
            rules: now.rules,
            usingDefaults: false,
            degraded: false,
            notVerified: false,
            status: "LIVE",
            source: "DATABASE",
            failure: "none",
            backendError: "",
            revision: now.revision,
            branchId: scope,
            lastSyncedAt: now.at,
            rowVersion: Math.max(0, Number(res.rowVersion) || 0),
            updatedAt: res.updatedAt ?? null,
            updatedBy: res.updatedBy ?? null,
          };
        }

        // The read did not produce verified branch rules.
        const detail = res.error ?? res.backendError ?? "";
        logRules("POS_RULES_LOAD_FAILED", {
          platform,
          terminal_id: me,
          branch_id: scope,
          category: failure,
        });
        if (cached?.pending) return pendingHeld(detail);
        if (cached) return held(failure, detail);
        return unverified("NOT_VERIFIED", failure, detail);
      } catch (e) {
        const message = (e as Error).message;
        const failure = classifyRulesFailure(message);
        logRules("POS_RULES_LOAD_FAILED", {
          platform,
          terminal_id: me,
          branch_id: scope,
          category: failure,
        });
        if (cached?.pending) return pendingHeld(message);
        if (cached) return held(failure, message);
        return unverified("NOT_VERIFIED", failure, message);
      }
    },
  });

  // An administrator changing a rule on a phone or PC reaches this till
  // through the one existing live settings channel; reconnecting after a
  // spell offline re-reads it too. No terminal has to be visited by hand.
  useEffect(
    () =>
      subscribeSettingsChange((change) => {
        if (change.table !== "pos_store_settings" && change.reason !== "desktop:pull-complete")
          return;
        if (change.storeId !== null && change.storeId !== "" && change.storeId !== scope) return;
        void queryClient.invalidateQueries({ queryKey: key });
      }),
    [key, queryClient, scope],
  );

  const value = useMemo<Ctx>(() => {
    const failure = query.data?.failure ?? "none";
    const status: RulesStatus = query.data?.status ?? (query.isPending ? "SYNCING" : "SYNCING");
    return {
      rules: query.data?.rules ?? DEFAULT_POS_RULES,
      loading: query.isPending,
      usingDefaults: query.data?.usingDefaults ?? false,
      degraded: query.data?.degraded ?? false,
      notVerified: query.data?.notVerified ?? false,
      status,
      statusText: STATUS_TEXT[status] ?? "",
      source: query.data?.source ?? "UNAVAILABLE",
      failure,
      failureText: FAILURE_TEXT[failure] ?? "",
      backendError: query.data?.backendError ?? "",
      revision: query.data?.revision ?? "",
      branchId: query.data?.branchId ?? "",
      terminalId: device.current,
      platform: platformName(),
      lastSyncedAt: query.data?.lastSyncedAt ?? null,
      rowVersion: query.data?.rowVersion ?? 0,
      updatedAt: query.data?.updatedAt ?? null,
      updatedBy: query.data?.updatedBy ?? null,
      refresh: async () => {
        await queryClient.refetchQueries({ queryKey: key });
      },
      confirmSaved: async (raw: unknown) => {
        const answer = (raw ?? {}) as Answer;
        const at = typeof answer.fetchedAt === "number" ? answer.fetchedAt : Date.now();
        const savedRules = normalizeRules(answer.rules);
        const saved = {
          rules: savedRules,
          revision: answer.revision ?? "",
          at,
          rowVersion: Math.max(0, Number(answer.rowVersion) || 0),
          updatedAt: answer.updatedAt ?? null,
          updatedBy: answer.updatedBy ?? null,
        };
        lastGood.set(scope, saved);
        queryClient.setQueryData<Snapshot>(key, {
          rules: saved.rules,
          usingDefaults: false,
          degraded: false,
          notVerified: false,
          status: "LIVE",
          source: "DATABASE",
          failure: "none",
          backendError: "",
          revision: saved.revision,
          branchId: scope,
          lastSyncedAt: at,
          rowVersion: saved.rowVersion,
          updatedAt: saved.updatedAt,
          updatedBy: saved.updatedBy,
        });
        // A device-cache failure must not turn a committed database save into
        // a false failure or make the settings editor unusable.
        await writeCachedRules({
          terminalId: device.current,
          branchId: scope,
          revision: saved.revision,
          syncedAt: at,
          rules: saved.rules,
          pending: false,
          rowVersion: saved.rowVersion,
          updatedAt: saved.updatedAt,
          updatedBy: saved.updatedBy,
        }).catch((error) =>
          logRules("POS_RULES_LOAD_FAILED", {
            platform: platformName(),
            terminal_id: device.current,
            branch_id: scope,
            category: "cache",
            message: (error as Error).message.slice(0, 200),
          }),
        );
      },
    };
  }, [key, query.data, query.isPending, queryClient, scope]);

  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>;
}

export function usePosRules(): Ctx {
  return (
    useContext(RulesContext) ?? {
      rules: DEFAULT_POS_RULES,
      loading: false,
      usingDefaults: false,
      degraded: false,
      notVerified: false,
      status: "SYNCING",
      statusText: STATUS_TEXT.SYNCING,
      source: "UNAVAILABLE",
      failure: "none",
      failureText: "",
      backendError: "",
      revision: "",
      branchId: "",
      terminalId: "",
      platform: platformName(),
      lastSyncedAt: null,
      rowVersion: 0,
      updatedAt: null,
      updatedBy: null,
      refresh: async () => {},
      confirmSaved: async () => {},
    }
  );
}
