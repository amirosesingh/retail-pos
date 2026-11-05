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
import { subscribeSettingsRefresh } from "./settings-refresh";
import { readCachedRules, rulesCacheScope, writeCachedRules, type CachedRules } from "./pos-rules-cache";
import { supabaseConfig } from "./external-supabase-config";
import { rulesEqual } from "./pos-rules-pending";
import { logRules } from "./pos-rules-log";
import { terminalId } from "./activity-journal";
import { serverOrigin, posFetch } from "./server-origin";
import { platformName } from "@/platform-config/platform";
import { publishShiftSharing } from './shift-sharing-policy';

export { platformName };
import { DEFAULT_POS_RULES, normalizeRules, type PosRules } from "./pos-rules";
import {
  classifyRulesFailure,
  type RulesFailure as RulesFailureKind,
} from "./pos-rules-failure";

export const posRulesQueryKey = (storeId: string, cacheScope = "") => ["pos-rules", storeId.trim(), cacheScope] as const;

/** Why the live values are not in use, in words a supervisor can act on. */
export type { RulesFailure as RulesFailureKind } from "./pos-rules-failure";

/** Where the rules in use came from. */
export type RulesSourceKind =
  "DATABASE" | "LOCAL_PENDING" | "LAST_KNOWN_GOOD" | "LEGACY_CACHE" | "DEFAULT_SAFETY" | "UNAVAILABLE";

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
  cacheScope: string;
  shiftSharingAvailable: boolean;
  rules: PosRules;
  loading: boolean;
  /** True when the rules shown are the built-in safety set, not the saved ones. */
  usingDefaults: boolean;
  /** True when confirmed rules are in use but the last refresh failed. */
  degraded: boolean;
  /** True when these values are not verified for the current connection. */
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
  shiftSharingAvailable?: boolean;
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
  shiftSharingAvailable?: boolean;
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
    shiftSharingAvailable: boolean;
    legacyScope: boolean;
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

function currentRulesCacheScope(terminal: string, branch: string): string {
  try { return rulesCacheScope(terminal, branch, serverOrigin() || (typeof window === "undefined" ? "" : window.location.origin), supabaseConfig().url); }
  catch { return ""; }
}

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
  const device = useRef<string>("");
  if (!device.current) device.current = typeof window === "undefined" ? "server" : terminalId();
  const cacheScope = currentRulesCacheScope(device.current, scope);
  const memoryScope = JSON.stringify([device.current, scope, cacheScope]);
  const key = useMemo(() => posRulesQueryKey(scope, cacheScope), [scope, cacheScope]);

  const query = useQuery<Snapshot>({
    queryKey: key,
    // Initial read, explicit refresh, committed changes and reconnect catch-up.
    // Privileged mutations still revalidate policy on the server.
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<Snapshot> => {
      const auth = await getPosCallerAuth();
      const platform = platformName();
      const me = device.current;

      // The confirmed set for this branch: memory first, then the encrypted
      // device copy left by an earlier run.
      let cached = lastGood.get(memoryScope) ?? null;
      if (scope) {
        const stored: CachedRules | null = await readCachedRules(me, scope, cacheScope).catch(() => null);
        // A local save updates the encrypted cache before the next refresh.
        // Do not let an older in-memory confirmed entry hide that pending edit.
        if (stored && (!cached || stored.pending === true && stored.syncedAt >= cached.at)) {
          cached = {
            rules: stored.rules,
            revision: stored.revision,
            at: stored.syncedAt,
            pending: stored.pending === true,
            rowVersion: stored.rowVersion ?? 0,
            updatedAt: stored.updatedAt ?? null,
            updatedBy: stored.updatedBy ?? null,
            shiftSharingAvailable: Boolean(cacheScope && stored.shiftSharingAvailable === true),
            legacyScope: stored.legacyScope === true,
          };
          lastGood.set(memoryScope, cached);
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
          shiftSharingAvailable: now.shiftSharingAvailable,
          usingDefaults: false,
          degraded: true,
          notVerified: now.legacyScope,
          status: "DEGRADED",
          source: now.legacyScope ? "LEGACY_CACHE" : "LAST_KNOWN_GOOD",
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
          shiftSharingAvailable: now.shiftSharingAvailable,
          usingDefaults: false,
          degraded: false,
          notVerified: now.legacyScope,
          status: "PENDING_UPLOAD",
          source: now.legacyScope ? "LEGACY_CACHE" : "LOCAL_PENDING",
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
        if (currentRulesCacheScope(me, scope) !== cacheScope) return unverified("NOT_VERIFIED", "config", "The database connection changed during the rules read.");
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
                shiftSharingAvailable: Boolean(cacheScope && res.shiftSharingAvailable === true),
                legacyScope: false,
              };
              lastGood.set(memoryScope, cached);
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
                cacheScope,
                shiftSharingAvailable: cached.shiftSharingAvailable,
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
              lastGood.delete(memoryScope);
            } else {
              // Offline duration is not proof of acceptance or rejection.
              // Keep the saved pending edit until a verified result resolves it.
              lastGood.set(memoryScope, cached);
              return pendingHeld("");
            }
          }
          // A late answer must never put an older rule set back in place.
          if (!cached || cached.legacyScope || at >= cached.at) {
            const changed = !cached || cached.legacyScope || cached.revision !== revision || cached.shiftSharingAvailable !== (res.shiftSharingAvailable === true);
            lastGood.set(memoryScope, {
              rules,
              revision,
              at,
              rowVersion: Math.max(0, Number(res.rowVersion) || 0),
              updatedAt: res.updatedAt ?? null,
              updatedBy: res.updatedBy ?? null,
              shiftSharingAvailable: Boolean(cacheScope && res.shiftSharingAvailable === true),
              legacyScope: false,
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
                cacheScope,
                shiftSharingAvailable: Boolean(cacheScope && res.shiftSharingAvailable === true),
              });
            }
          }
          const now = lastGood.get(memoryScope)!;
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
            shiftSharingAvailable: now.shiftSharingAvailable,
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
        if (currentRulesCacheScope(me, scope) !== cacheScope) return unverified("NOT_VERIFIED", "config", "The database connection changed during the rules read.");
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
      subscribeSettingsRefresh(async () => {
        // A change arriving during the initial read needs a fresh read after it.
        if (queryClient.getQueryState(key)?.fetchStatus === "fetching")
          await queryClient.refetchQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
        await queryClient.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
      }, change => (change.reason === "reconnect" || change.reason === "realtime:subscribed") ||
        (change.table === "pos_store_settings" && (!change.storeId || change.storeId === scope)),
      { eventOnly: true }),
    [key, queryClient, scope],
  );

  const value = useMemo<Ctx>(() => {
    const failure = query.data?.failure ?? "none";
    const status: RulesStatus = query.data?.status ?? (query.isPending ? "SYNCING" : "SYNCING");
    return {
      cacheScope,
      shiftSharingAvailable: query.data?.shiftSharingAvailable === true,
      rules: query.data?.rules ?? DEFAULT_POS_RULES,
      loading: query.isPending,
      usingDefaults: query.data?.usingDefaults ?? false,
      degraded: query.data?.degraded ?? false,
      notVerified: query.data?.notVerified ?? false,
      status,
      statusText: query.data?.source === "LEGACY_CACHE"
        ? "Previous saved rules are preserved for offline operation. Connect to verify this database before editing; existing pending changes remain pending."
        : STATUS_TEXT[status] ?? "",
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
        if (currentRulesCacheScope(device.current, scope) !== cacheScope) throw new Error("The database connection changed while rules were being saved.");
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
          shiftSharingAvailable: Boolean(cacheScope && (answer.shiftSharingAvailable === true ||
            answer.shiftSharingAvailable === undefined && lastGood.get(memoryScope)?.shiftSharingAvailable === true)),
          legacyScope: false,
        };
        lastGood.set(memoryScope, saved);
        queryClient.setQueryData<Snapshot>(key, {
          rules: saved.rules,
          usingDefaults: false,
          degraded: false,
          notVerified: false,
          status: "LIVE",
          source: "DATABASE",
          shiftSharingAvailable: saved.shiftSharingAvailable,
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
          cacheScope,
          shiftSharingAvailable: saved.shiftSharingAvailable,
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
  }, [key, query.data, query.isPending, queryClient, scope, cacheScope, memoryScope]);

  useEffect(() => {
    if (!value.usingDefaults && value.source !== 'UNAVAILABLE') publishShiftSharing(scope, value.rules.allow_branch_shift_sharing);
  }, [scope, value.usingDefaults, value.source, value.rules.allow_branch_shift_sharing]);
  useEffect(() => () => publishShiftSharing(scope, undefined), [scope]);
  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>;
}

export function usePosRules(): Ctx {
  return (
    useContext(RulesContext) ?? {
      cacheScope: "",
      rules: DEFAULT_POS_RULES,
      loading: false,
      usingDefaults: false,
      shiftSharingAvailable: false,
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
