import { fetchWithDeadline } from "./fetch-deadline";

type DesktopHttp = {
  supabaseRequest?: (input: { url:string; method:string; headers:Record<string,string>; body?:string }) => Promise<{
    ok:boolean; status?:number; headers?:Record<string,string>; body?:string; error?:string;
  }>;
};

/** Preserve Supabase HTTP errors; only transport failures reject the promise. */
export const desktopSupabaseFetch: typeof fetch = async (input, init) => {
  const bridge = typeof window === "undefined" ? undefined : window.pos as unknown as DesktopHttp | undefined;
  if (!bridge?.supabaseRequest) return fetchWithDeadline(input, init);
  const url = input instanceof Request ? input.url : String(input);
  if (!/\/(?:rest|auth)\/v1\//.test(new URL(url).pathname)) return fetchWithDeadline(input, init);
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  return new Promise<Response>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once:true });
    if (signal.aborted) { signal.removeEventListener("abort", abort); reject(signal.reason); return; }
    bridge.supabaseRequest!({url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body})
      .then(result => {
        if (!result.ok) throw new TypeError(result.error ?? "Supabase network request failed.");
        resolve(new Response(request.method === "HEAD" || [204,205,304].includes(result.status!) ? null : result.body ?? "", {status:result.status,headers:result.headers}));
      }).catch(reject).finally(() => signal.removeEventListener("abort", abort));
  });
};
