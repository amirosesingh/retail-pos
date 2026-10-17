import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({query:vi.fn(),cleanups:[] as (()=>void)[]}));
vi.mock("react",()=>({useEffect:(fn:()=>void|(()=>void))=>{const cleanup=fn();if(cleanup)h.cleanups.push(cleanup);},useSyncExternalStore:(_subscribe:unknown,snapshot:()=>unknown)=>snapshot()}));
vi.mock("@/core/api/pos-db",()=>({db:{queryAuditLogs:h.query}}));
vi.mock("../session-presence",()=>({hasSignedInIdentity:()=>true}));
vi.mock("../business-storage",()=>({readBusinessValue:()=>null,writeBusinessValue:vi.fn()}));
vi.mock("../activity-journal",()=>({replayOrder:(v:unknown)=>v,stamp:vi.fn()}));
vi.mock("@/platform-config/platform",()=>({isTerminalApp:()=>false}));
vi.mock("@/core/local-db/local-db",()=>({localDb:()=>null}));
import { logger, setAuditActor, useAuditLogs, useAuditHistoryError } from "../audit-log";
// eslint-disable-next-line react-hooks/rules-of-hooks -- Deterministic hook dispatcher for history tests.
const read=()=>useAuditLogs(true);
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
beforeEach(()=>{
  vi.useFakeTimers();h.query.mockReset();h.query.mockResolvedValue([]);
  vi.stubGlobal("window",{setInterval,removeEventListener:vi.fn(),addEventListener:vi.fn()});
  vi.stubGlobal("document",{visibilityState:"visible"});
  setAuditActor({staffId:crypto.randomUUID(),storeId:"a",role:"admin"});
});
afterEach(()=>{h.cleanups.splice(0).forEach(fn=>fn());vi.useRealTimers();vi.unstubAllGlobals();});
describe("saved audit history",()=>{
  it("loads saved history on the web and refreshes it",async()=>{
    h.query.mockResolvedValue([{id:"saved",created_at:"2026-10-17T00:00:00Z",action_name:"Sale",details:{}}]);
    read();await flush();expect(logger.all().map(row=>row.id)).toContain("saved");
    h.query.mockResolvedValue([]);await vi.advanceTimersByTimeAsync(30_000);
    expect(logger.all().map(row=>row.id)).not.toContain("saved");
  });
  it("ignores a delayed response after the staff or branch changes",async()=>{
    let finish:(v:unknown)=>void=()=>{};h.query.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    read();setAuditActor({staffId:"other",storeId:"b"});
    finish([{id:"old-branch",created_at:"2026-10-17T00:00:00Z",details:{}}]);await flush();
    expect(logger.all().map(row=>row.id)).not.toContain("old-branch");
  });
  it("reports failed history reads while retaining the visible cache",async()=>{
    h.query.mockRejectedValue(new Error("Unavailable"));read();await flush();
    expect(useAuditHistoryError()).toBe("Unavailable");
  });
});
