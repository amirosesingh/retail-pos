// Desktop HTTP is restricted to the operator's OS-vault project. Never accept
// an arbitrary destination, follow redirects with credentials, or add privileges.
const LIMIT = 6 * 1024 * 1024;
async function supabaseRequest(input, config, fetcher = fetch) {
  try {
    if (!config?.url || !config?.key) throw new Error("Save the Supabase connection in Database & Cloud Connection first.");
    const base = new URL(config.url);
    const url = new URL(String(input?.url ?? ""));
    const prefix = base.pathname.replace(/\/+$/, "");
    if (base.protocol !== "https:" || url.origin !== base.origin || url.username || url.password || url.hash ||
      ![`${prefix}/rest/v1/`, `${prefix}/auth/v1/`].some(path => url.pathname.startsWith(path)))
      throw new Error("The request does not target the saved Supabase API.");
    const method = String(input.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Unsupported Supabase request method.");
    const incoming = new Headers(input.headers ?? {});
    if (incoming.get("apikey") !== config.key) throw new Error("The Supabase connection changed. Reload the saved connection before retrying.");
    const headers = new Headers();
    for (const name of ["apikey", "authorization", "content-type", "accept", "accept-profile", "content-profile", "prefer", "range", "range-unit", "x-client-info", "x-supabase-api-version"])
      if (incoming.has(name)) headers.set(name, incoming.get(name));
    if (input.body != null && typeof input.body !== "string") throw new Error("Supabase request body must be text.");
    if (Buffer.byteLength(input.body ?? "", "utf8") > LIMIT) throw new Error("Supabase request exceeds 6 MiB.");
    const response = await fetcher(url.href, {method, headers, body:["GET","HEAD"].includes(method)?undefined:input.body,
      redirect:"manual", signal:AbortSignal.timeout(30_000)});
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      await response.body?.cancel();
      throw new Error("Supabase redirected the request. Check the saved project address.");
    }
    const chunks=[];let size=0;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.byteLength;
      if(size > LIMIT) throw new Error("Supabase response exceeds 6 MiB.");
      chunks.push(Buffer.from(chunk));
    }
    const resultHeaders={};
    for(const name of ["content-type","content-range","range-unit","retry-after","x-supabase-api-version"])
      if(response.headers.has(name))resultHeaders[name]=response.headers.get(name);
    return {ok:true,status:response.status,headers:resultHeaders,body:Buffer.concat(chunks).toString("utf8")};
  } catch(error) {
    return {ok:false,error:String(error?.message ?? "Supabase network request failed.")};
  }
}
module.exports={supabaseRequest};
