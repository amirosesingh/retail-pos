/**
 * One place every failure passes through.
 *
 * Database, network and RPC errors arrive as raw Postgres or fetch messages.
 * Staff standing at a till cannot act on "violates foreign key constraint",
 * so each known shape is translated into a plain sentence and shown as a
 * toast. Nothing fails silently.
 */
import { toast } from "sonner";
import { guardNotification, isConnectivityMessage } from "./notification-guard";
import { anyDatabaseReachable } from "@/core/activation/connection-health";

export type NotifyKind = "success" | "info" | "warning" | "error";

type Failure = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  statusCode?: number;
  name?: string;
  table?: string | null;
  sqlNumber?: number | null;
};

export type ErrorCategory =
  | "invalid-request"
  | "authentication"
  | "permission"
  | "not-found"
  | "timeout"
  | "conflict"
  | "validation"
  | "rate-limit"
  | "server"
  | "upstream"
  | "unavailable"
  | "network"
  | "database-disconnected"
  | "database-read"
  | "database-write"
  | "already-running"
  | "configuration"
  | "file-unavailable"
  | "sync"
  | "unexpected";

const text = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error;
  const e = error as Failure;
  return [e.message, e.details, e.hint].filter(Boolean).join(" — ");
};

const statusOf = (error: unknown, raw: string): number => {
  const value = Number((error as Failure | null)?.status ?? (error as Failure | null)?.statusCode);
  if (Number.isInteger(value) && value >= 400 && value <= 599) return value;
  const match = /(?:http|status|failed|error|refused)?\s*[(:]?\b(400|401|403|404|408|409|422|429|500|502|503|504)\b/i.exec(raw);
  return match ? Number(match[1]) : 0;
};

/** Stable technical classification shared by every platform UI. */
export function classifyError(error: unknown): ErrorCategory {
  const raw = text(error);
  const lower = raw.toLowerCase();
  const code = String((error as Failure | null)?.code ?? "").toUpperCase();
  const status = statusOf(error, raw);
  if (status === 400) return "invalid-request";
  if (status === 401 || code === "PGRST301" || /jwt.*(expired|invalid)|session.*expired/.test(lower)) return "authentication";
  if (status === 403 || code === "42501" || /permission denied|row-level security|forbidden/.test(lower)) return "permission";
  if (status === 404 || code === "PGRST116") return "not-found";
  if (status === 408 || status === 504 || /timed? ?out|etimeout/.test(lower)) return "timeout";
  if (status === 409 || code === "23505" || /duplicate key|already exists/.test(lower)) return "conflict";
  if (status === 422 || code === "23502" || /validation|invalid input|business rule|null value/.test(lower)) return "validation";
  if (status === 429 || /rate limit|too many requests/.test(lower)) return "rate-limit";
  if (status === 502) return "upstream";
  if (status === 503) return "unavailable";
  if (status === 500) return "server";
  if (/failed to fetch|networkerror|load failed|offline|network request|econnrefused|enotfound/.test(lower)) return "network";
  if (/database.*not connected|enotconnected/.test(lower)) return "database-disconnected";
  if (/database|\bsql\b/.test(lower) && /write|insert|update|save|readonly|constraint/.test(lower)) return "database-write";
  if (/database|\bsql\b/.test(lower) && /read|select|query/.test(lower)) return "database-read";
  if (/already.*(running|progress)|duplicate.*attempt|mutex|busy/.test(lower)) return "already-running";
  if (/configuration|not configured|missing.*(?:key|url)|invalid api key/.test(lower)) return "configuration";
  if (/enoent|path|file.*(?:missing|unavailable)|directory/.test(lower)) return "file-unavailable";
  if (/sync|relay|cloud.*refused|partial/.test(lower)) return "sync";
  return "unexpected";
}

const actionKind = (action: string) => {
  const value = action.toLowerCase();
  if (/load|read|fetch|refresh|find|search|list/.test(value)) return "read";
  if (/log ?in|sign ?in/.test(value)) return "login";
  if (/terminal.*(?:regist|activat)|regist.*terminal/.test(value)) return "terminal";
  if (/sync|upload|sending.*change/.test(value)) return "sync";
  if (/refund|return/.test(value)) return "refund";
  if (/payment|tender/.test(value)) return "payment";
  if (/sale|checkout|order/.test(value)) return "sale";
  return "action";
};

/** Turn a backend failure into something a cashier can act on. */
export function describeError(error: unknown, action = "That action"): string {
  const raw = text(error);
  const code = String((error as Failure | null)?.code ?? "");
  const category = classifyError(error);
  const kind = actionKind(action);

  if (code === "ESQLSERVER_WRITE") {
    const table = (error as Failure | null)?.table;
    const target = table ? ` while writing ${table}` : "";
    return `${action} could not be saved to local SQL Server${target}. The transaction was rolled back; check Database & Cloud Connection and retry.`;
  }

  if (code === "23503" || /foreign key constraint/i.test(raw))
    return `${action} is blocked because other records still point at this entry. Remove or reassign those records first.`;

  if (category === "network")
    return kind === "sync"
      ? "Some changes could not be synced. Your pending changes have been kept and will retry when the connection returns."
      : `${action} could not reach the server. Check your internet connection and try again.`;
  if (category === "authentication")
    return kind === "sync"
      ? "Cloud sync authentication has expired. Sign in or re-register this terminal to resume syncing."
      : kind === "terminal"
        ? "Terminal authentication has expired. Authenticate the terminal again."
        : "Your session is invalid or has expired. Please sign in again.";
  if (category === "permission")
    return `You don't have permission to complete ${action.toLowerCase()}. Contact an administrator if you require access.`;
  if (category === "not-found") return `${action} could not be completed because the requested record no longer exists. Refresh and try again.`;
  if (category === "timeout") return `${action} took too long to complete. Check your connection and try again.`;
  if (category === "rate-limit") return `${action} was temporarily limited because too many requests were made. Wait a moment and try again.`;
  if (category === "already-running") return "This operation is already in progress. Please wait for it to complete.";
  if (category === "database-disconnected") return "The database is not connected. Verify the database connection before continuing.";
  if (category === "database-read") return `${action} could not read the database. Reconnect the database and try again.`;
  if (category === "database-write")
    return kind === "read"
      ? `${action} could not read the database. Verify the connection and try again.`
      : kind === "sale"
      ? "The sale could not be saved to the database. No successful save was confirmed. Please try again."
      : kind === "payment" || kind === "refund"
        ? `${action} could not be saved to the database. No successful save was confirmed. Please try again.`
        : `${action} could not be saved to the database. Verify the connection and try again.`;
  if (category === "invalid-request") return `${action} could not be completed because the request was invalid. Check the entered information and try again.`;
  if (category === "validation") return `${action} could not be completed because some information is invalid or a business rule was not met. Check the form and try again.`;
  if (category === "conflict") return `${action} conflicts with an existing or newer record. Refresh the data before trying again.`;
  if (category === "configuration") return `${action} could not be completed because this device is not configured correctly. Open Database & Cloud Connection and check the saved settings.`;
  if (category === "file-unavailable") return `${action} could not access the required file or database location. Check that it is available and try again.`;
  if (category === "unavailable" || category === "upstream") return `${action} could not be completed because a required service is temporarily unavailable. Try again shortly.`;
  if (category === "server") return `${action} could not be completed because the server encountered an unexpected problem. Please try again.`;
  if (category === "sync") return "Some changes could not be synced. Your pending changes have been kept and can be retried.";

  if (/PGRST20\d|schema cache|could not find the/i.test(raw))
    return `${action} could not be completed because the database setup is out of date. Ask an administrator to apply the current database upgrade.`;
  // Unknown backend text can contain SQL, endpoints, paths or credentials.
  // Keep it in secure logs; the normal UI gets a stable recovery instruction.
  return `${action} could not be completed. Please try again. If it continues, contact support.`;
}

/** Show a message. The single entry point for all user-facing notifications. */
export function showNotification(message: string, kind: NotifyKind = "info", description?: string) {
  const options = description ? { description } : undefined;
  const emit = () => {
    if (kind === "success") return toast.success(message, options);
    if (kind === "error") return toast.error(message, options);
    if (kind === "warning") return toast.warning(message, options);
    return toast(message, options);
  };
  // A connectivity complaint is only true when nothing at all is reachable.
  if (kind === "success") return emit();
  return guardNotification(message, emit);
}

/** Report a caught failure as a readable popup and return the message shown. */
export function notifyError(error: unknown, action = "That action"): string {
  // Neither this terminal nor the central database would take the change:
  // that needs a modal the operator has to acknowledge, not a passing toast.
  if ((error as { name?: string } | null)?.name === "AllTargetsFailed") {
    const message = (error as Error).message;
    // Blocking modal only when both databases really are gone.
    void anyDatabaseReachable().then((reachable) => {
      if (reachable || typeof window === "undefined") return;
      window.dispatchEvent(new CustomEvent("pos:db-unreachable", { detail: { message, action } }));
    });
    return message;
  }
  const message = describeError(error, action);
  if (isConnectivityMessage(message)) guardNotification(message, () => toast.error(message));
  else showNotification(message, "error");
  return message;
}

/**
 * Run work and surface any failure as a popup instead of a silent break.
 * Returns the result, or null when it failed.
 */
export async function withNotify<T>(action: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    notifyError(error, action);
    return null;
  }
}
