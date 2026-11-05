import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ project: "https://one.test", rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: state.rest }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: state.project }) }));
let download: typeof import("../protected-feed-download.server").protectedFeedDownload;
const args = { organizationId: "default", branchId: "A", terminalId: "terminal", cursor: 123, keepCommerce: false };
const content = '[{"cursor":124,"table_name":"audit_logs","row_data":{"id":"one","note":"雪😀"}}]';
function attested(body = content, overrides: Record<string,string> = {}) {
  return new Response(body, { headers: { "content-type": "application/json", "X-POS-Feed-Projection": "1",
    "X-POS-Feed-Bytes": String(new TextEncoder().encode(body).length), "X-POS-Feed-Rows": "1", "X-POS-Feed-Continue": "0", ...overrides } });
}
beforeEach(async () => {
  vi.resetModules(); state.rest.mockReset(); state.project = "https://one.test";
  download = (await import("../protected-feed-download.server")).protectedFeedDownload;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("forwards only validated conservative continuation, including short pages", async () => {
  state.rest.mockResolvedValue(attested(content, { "X-POS-Feed-Continue": "1" }));
  const response = await download(args);
  expect(response!.headers.get("X-POS-Feed-Projection")).toBe("1");
  expect(response!.headers.get("X-POS-Feed-Continue")).toBe("1");
});
it.each(["", "true", "01", "2"])("rejects invalid continuation %s", async value => {
  state.rest.mockResolvedValue(attested(content, { "X-POS-Feed-Continue": value }));
  expect((await download(args))!.status).toBe(502);
});
it("accepts an exhausted empty array but rejects empty continuation", async () => {
  state.rest.mockResolvedValueOnce(attested("[]", { "X-POS-Feed-Rows": "0" }));
  expect(await (await download(args))!.text()).toBe("[]");
  state.rest.mockResolvedValueOnce(attested("[]", { "X-POS-Feed-Rows": "0", "X-POS-Feed-Continue": "1" }));
  expect((await download(args))!.status).toBe(502);
});
it("rejects valid JSON followed by an excess later chunk before success", async () => {
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      queueMicrotask(() => { controller.enqueue(encoder.encode(" ")); controller.close(); });
    },
  });
  state.rest.mockResolvedValue(new Response(source, { headers: attested().headers }));
  expect((await download(args))!.status).toBe(502);
});
it("uses native exact-length enforcement without a JavaScript transform when available", async () => {
  const OriginalTransformStream = TransformStream;
  const native = vi.fn(() => new OriginalTransformStream<Uint8Array, Uint8Array>());
  vi.stubGlobal("FixedLengthStream", function () { return native(); });
  vi.stubGlobal("TransformStream", vi.fn(() => { throw new Error("must use native bounded pipe"); }));
  state.rest.mockResolvedValue(attested());
  const result = await download(args);
  expect(await result!.text()).toBe(content);
  expect(native).toHaveBeenCalledOnce();
});
it("passes the caller's cancellation signal to the protected upstream request", async () => {
  const controller = new AbortController();
  state.rest.mockResolvedValue(attested());
  expect((await download({ ...args, signal: controller.signal }))!.status).toBe(200);
  expect(state.rest.mock.calls[0][1].signal).toBe(controller.signal);
});
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
  expect(state.rest.mock.calls[0][0]).toBe("rpc/pos_sync_feed_page_v1");
  expect(state.rest.mock.calls[0][1].headers).toEqual({"Accept-Encoding":"identity"});
  expect(JSON.parse(state.rest.mock.calls[0][1].body)).toEqual({p_organization_id:"default",p_branch_id:"A",p_terminal_id:"terminal",
    p_after_cursor:123,p_keep_commerce:false,p_max_bytes:2097152});
});
const invalidHeaders: Array<Record<string,string>> = [
  {"X-POS-Feed-Projection":"0"},{"X-POS-Feed-Bytes":"0"},{"X-POS-Feed-Bytes":"5242881"},
  {"X-POS-Feed-Bytes":"12.5"},{"X-POS-Feed-Bytes":"+50"},{"X-POS-Feed-Rows":"11"},
  {"X-POS-Feed-Rows":"01"},{"content-type":"text/html"},{"Content-Encoding":"gzip"},{"Content-Length":"999"},
  {"X-POS-Feed-Bytes":"2097153","X-POS-Feed-Rows":"2"},
];
it.each(invalidHeaders)("fails closed for invalid attestation %j without fallback", async headers => {
  state.rest.mockResolvedValue(attested(content,headers));
  expect((await download(args))!.status).toBe(502); expect(state.rest).toHaveBeenCalledOnce();
});
it("rejects absent protocol headers and never streams an old raw response", async () => {
  state.rest.mockResolvedValue(Response.json({rows:[{claim_proof:"secret"}],cursor:null}));
  const result=await download(args); expect(result!.status).toBe(502); expect(await result!.text()).not.toContain("secret");
});
it("rejects a short body before returning success", async () => {
  state.rest.mockResolvedValue(attested(content,{"X-POS-Feed-Bytes":String(new TextEncoder().encode(content).length+1)}));
  const result=await download(args); expect(result!.status).toBe(502);
  expect(await result!.json()).toMatchObject({code:"EFEED_PROTOCOL"});
});
it.each([
  [404,{code:"PGRST202",message:"Could not find the function public.pos_sync_feed_page_v1 in the schema cache"}],
  [400,{code:"P0001",message:"POS_FEED_STREAM_UNSUPPORTED_SOURCE"}],
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
