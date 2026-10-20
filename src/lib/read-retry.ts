import { isCurrentEpoch, sessionEpoch } from "./session-epoch";

/** Retry reads only; permission, validation and schema errors stay definitive. */
export function isTransientReadError(error: unknown): boolean {
  const failure = error as { message?: string; code?: string; status?: number; name?: string } | null;
  if (!failure || failure.name === "AbortError") return false;
  const code = String(failure.code ?? "");
  const status = Number(failure.status ?? 0);
  if ((status >= 400 && status < 500 && ![408, 429].includes(status)) || /^(22|23|28|42)/.test(code)) return false;
  return [408, 429, 502, 503, 504].includes(status) ||
    ["57014", "53300", "ECONNRESET", "ETIMEDOUT"].includes(code) ||
    failure.name === "TimeoutError" ||
    /failed to fetch|fetch failed|network(?:error| error| request failed)|load failed|timed? ?out|connection (?:reset|closed|terminated)/i.test(failure.message ?? "");
}

export async function retryDataRead<T>(read: () => PromiseLike<T>, isCurrent: () => boolean = () => true): Promise<T> {
  const epoch = sessionEpoch();
  const valid = () => isCurrentEpoch(epoch) && isCurrent();
  for (let attempt = 0; ; attempt++) {
    if (!valid()) throw new Error("The data request was superseded by a newer session.");
    try {
      const result = await read();
      if (!valid()) throw new Error("The data request was superseded by a newer session.");
      return result;
    } catch (error) {
      if (attempt >= 2 || !valid() || !isTransientReadError(error) ||
          (typeof navigator !== "undefined" && navigator.onLine === false)) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 300 : 1200));
    }
  }
}

/** Bound a composite read too, including credential/client restoration before HTTP starts. */
export async function withReadDeadline<T>(read: () => PromiseLike<T>, milliseconds = 45_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DOMException("The data service did not respond in time. Please retry.", "TimeoutError")), milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
