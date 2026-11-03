import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ project: "https://one.test", rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: state.rest }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: state.project }) }));
let download: typeof import("../protected-history-download.server").protectedHistoryDownload;
const args = { organizationId: "default", branchId: "A", terminalId: "terminal", cursor: null, historyDays: 90, keepCommerce: false };
const content = '{"rows":[{"id":"one","note":"雪😀"}],"cursor":null}';
function attested(body = content, overrides: Record<string,string> = {}) {
  return new Response(body, { headers: { "content-type": "application/json", "X-POS-History-Projection": "1",
    "X-POS-History-Bytes": String(new TextEncoder().encode(body).length), "X-POS-History-Rows": "1", ...overrides } });
}
beforeEach(async () => {
  vi.resetModules(); state.rest.mockReset(); state.project = "https://one.test";
  download = (await import("../protected-history-download.server")).protectedHistoryDownload;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("streams protected bytes without parsing or serializing success JSON", async () => {
  const source = attested();
  const json = vi.spyOn(source,"json").mockRejectedValue(new Error("must not parse"));
  const text = vi.spyOn(source,"text").mockRejectedValue(new Error("must not decode"));
  state.rest.mockResolvedValue(source);
  const result = await download(args);
  expect(result!.status).toBe(200); expect(await result!.text()).toBe(content);
  expect(json).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
  expect(result!.headers.get("content-length")).toBeNull();
  expect(result!.headers.get("cache-control")).toBe("no-store");
  expect(state.rest.mock.calls[0][0]).toBe("rpc/pos_sync_history_page_v1");
  expect(state.rest.mock.calls[0][1].headers).toEqual({"Accept-Encoding":"identity"});
  expect(JSON.parse(state.rest.mock.calls[0][1].body)).toEqual({p_organization_id:"default",p_branch_id:"A",p_terminal_id:"terminal",
    p_after_cursor:null,p_history_days:90,p_keep_commerce:false,p_max_bytes:2097152});
});
const invalidHeaders: Array<Record<string,string>> = [
  {"X-POS-History-Projection":"0"},{"X-POS-History-Bytes":"0"},{"X-POS-History-Bytes":"5242881"},
  {"X-POS-History-Bytes":"12.5"},{"X-POS-History-Bytes":"+50"},{"X-POS-History-Rows":"11"},
  {"X-POS-History-Rows":"01"},{"content-type":"text/html"},{"Content-Encoding":"gzip"},{"Content-Length":"999"},
  {"X-POS-History-Bytes":"2097153","X-POS-History-Rows":"2"},
];
it.each(invalidHeaders)("fails closed for invalid attestation %j without fallback", async headers => {
  state.rest.mockResolvedValue(attested(content,headers));
  expect((await download(args))!.status).toBe(502); expect(state.rest).toHaveBeenCalledOnce();
});
it("rejects absent protocol headers and never streams an old raw response", async () => {
  state.rest.mockResolvedValue(Response.json({rows:[{claim_proof:"secret"}],cursor:null}));
  const result=await download(args); expect(result!.status).toBe(502); expect(await result!.text()).not.toContain("secret");
});
it("enforces declared byte count during stream consumption", async () => {
  state.rest.mockResolvedValue(attested(content,{"X-POS-History-Bytes":String(new TextEncoder().encode(content).length+1)}));
  const result=await download(args); await expect(result!.text()).rejects.toThrow("EHISTORY_PROTOCOL");
});
it.each([
  [404,{code:"PGRST202",message:"Could not find the function public.pos_sync_history_page_v1 in the schema cache"}],
  [400,{code:"P0001",message:"POS_HISTORY_STREAM_UNSUPPORTED_SOURCE"}],
])("uses project-scoped bounded negative capability caching only for explicit unsupported responses", async (status,error) => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  state.rest.mockImplementation(async()=>Response.json(error,{status}));
  expect(await download(args)).toBeNull(); expect(await download(args)).toBeNull(); expect(state.rest).toHaveBeenCalledTimes(1);
  state.project="https://two.test"; expect(await download(args)).toBeNull(); expect(state.rest).toHaveBeenCalledTimes(2);
  state.project="https://one.test"; vi.setSystemTime(32_000);
  expect(await download(args)).toBeNull(); expect(state.rest).toHaveBeenCalledTimes(3);
});
it.each([
  [403,{code:"42501",message:"denied"}],[503,{message:"unavailable"}],
  [404,{code:"PGRST202",message:"Could not find public.some_other_rpc"}],
  [400,{code:"P0001",message:"POS_HISTORY_STREAM_ROW_TOO_LARGE"}],
])("preserves failure %s without legacy fallback or capability caching", async (status,error) => {
  state.rest.mockImplementation(async()=>Response.json(error,{status}));
  for(let index=0;index<2;index++) {
    const result=await download(args); expect(result!.status).toBe(status); expect(await result!.json()).toEqual(error);
  }
  expect(state.rest).toHaveBeenCalledTimes(2);
});
it("preserves transport failure without enabling fallback", async () => {
  state.rest.mockRejectedValue(new Error("network unavailable"));
  await expect(download(args)).rejects.toThrow("network unavailable");
});
it("rejects compressed errors instead of forwarding encoded bytes as JSON",async()=>{
  state.rest.mockResolvedValue(new Response("compressed",{status:503,headers:{"Content-Encoding":"gzip"}}));
  expect((await download(args))!.status).toBe(502);
});
