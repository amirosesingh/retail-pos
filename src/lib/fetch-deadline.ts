/** Keep caller cancellation while bounding stalled database requests. */
export function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const original = init?.signal ?? (input instanceof Request ? input.signal : null);
  const deadline = AbortSignal.timeout(30_000);
  const signal = original ? AbortSignal.any([original, deadline]) : deadline;
  return fetch(input, { ...init, signal });
}
