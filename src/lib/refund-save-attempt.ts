import { observeLocalStartup } from "./local-startup";

/** Observe the existing public database-state channel without reacting to health/activity noise. */
export function observeRefundDatabaseContext(
  database: Parameters<typeof observeLocalStartup>[0],
  changed: () => void,
): () => void {
  let previous: string | null = null;
  return observeLocalStartup(database, state => {
    const profile = (state as { profile?: Record<string, unknown> | null } | null)?.profile;
    const identity = JSON.stringify([state?.state, state?.enabled, state?.configured, state?.connected, state?.tradingReady,
      profile?.id, profile?.host, profile?.instanceName, profile?.port, profile?.database]);
    if (identity !== previous) { previous = identity; changed(); }
  });
}

type RefundAuthorization = { ok: boolean; nativeRefundGrant?: string; error?: string; code?: string };

type RefundAttempt = {
  key: string;
  nativeGrant?: string;
  inFlight?: Promise<boolean>;
};

type RefundSave = {
  saleId: string;
  branchId: string;
  amount: number;
  grantToken?: string | null;
  context: () => string;
  authorize: (grant: string | null, assertCurrent: () => void) => Promise<RefundAuthorization>;
  save: (grant: string | null | undefined) => Promise<unknown>;
  accepted: (isCurrent: () => boolean) => void;
};

const nativeGrant = (value: unknown): value is string =>
  typeof value === "string" && /^native-refund-v1:[A-Za-z0-9_-]{43}$/.test(value);

/**
 * Retain only a Main-issued handle while this renderer cannot confirm a save.
 * Main still checks that handle and the repository proves the original receipt
 * on every retry. This is neither durable approval storage nor refund recovery
 * after a renderer/Main restart or Main's existing handle-retention deadline.
 */
export class RefundSaveAttempts {
  private context: string | null = null;
  private attempts = new Map<string, RefundAttempt>();

  hasUncertain(input: Pick<RefundSave, "saleId" | "branchId" | "amount" | "context">): boolean {
    const attempt = this.attempts.get(input.saleId);
    return this.context === input.context() && Boolean(attempt && nativeGrant(attempt.nativeGrant) &&
      attempt.key === JSON.stringify([input.saleId, input.branchId, input.amount]));
  }

  run(input: RefundSave): Promise<boolean> {
    const context = input.context();
    if (this.context !== context) {
      this.context = context;
      this.attempts.clear();
    }
    const key = JSON.stringify([input.saleId, input.branchId, input.amount]);
    let attempt = this.attempts.get(input.saleId);
    if (attempt && attempt.key !== key)
      return Promise.reject(new Error("This refund attempt belongs to a different saved receipt amount or branch."));
    if (attempt?.inFlight) return attempt.inFlight;
    if (!attempt) {
      if (this.attempts.size >= 128)
        return Promise.reject(new Error("Confirm the existing saved refunds before starting another attempt."));
      attempt = { key };
      this.attempts.set(input.saleId, attempt);
    }
    const savedAttempt = attempt;
    const isCurrent = () => this.context === context && input.context() === context;
    const assertCurrent = () => {
      if (!isCurrent()) throw Object.assign(new Error("The operator, branch or connection changed. Reopen this receipt before continuing."), { code: "EREFUND_CONTEXT" });
    };
    const work = async () => {
      assertCurrent();
      const authorization = await input.authorize(savedAttempt.nativeGrant ?? input.grantToken ?? null, assertCurrent);
      assertCurrent();
      if (!authorization.ok) {
        // Main returns this only for an unused, expired admission. Keep every
        // ambiguous failure; a fresh approval must be requested explicitly.
        if (authorization.code === "EAPPROVAL_EXPIRED") delete savedAttempt.nativeGrant;
        throw Object.assign(new Error(authorization.error ?? "The refund authorization was not confirmed."), { code: authorization.code });
      }
      const grant = authorization.nativeRefundGrant ?? input.grantToken;
      if (authorization.nativeRefundGrant !== undefined) {
        if (!nativeGrant(authorization.nativeRefundGrant) ||
          (savedAttempt.nativeGrant && savedAttempt.nativeGrant !== authorization.nativeRefundGrant))
          throw new Error("The saved refund authorization could not be matched to its original attempt.");
        savedAttempt.nativeGrant = authorization.nativeRefundGrant;
      } else if (savedAttempt.nativeGrant) {
        throw new Error("Main must confirm the original local refund authorization before retrying.");
      }
      assertCurrent();
      try { await input.save(grant); }
      catch (error) {
        if ((error as { code?: string })?.code === "EAPPROVAL_EXPIRED") delete savedAttempt.nativeGrant;
        throw error;
      }
      assertCurrent();
      input.accepted(isCurrent);
      if (this.attempts.get(input.saleId) === savedAttempt) this.attempts.delete(input.saleId);
      return true;
    };
    savedAttempt.inFlight = work().finally(() => {
      delete savedAttempt.inFlight;
      if (!savedAttempt.nativeGrant && this.attempts.get(input.saleId) === savedAttempt)
        this.attempts.delete(input.saleId);
    });
    return savedAttempt.inFlight;
  }
}
