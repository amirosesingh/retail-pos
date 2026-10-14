import { beforeEach, describe, expect, it, vi } from "vitest";
const saved = vi.hoisted(() => new Map<string,string>());
const writes = vi.hoisted(() => ({soft: vi.fn(), commit: vi.fn()}));
vi.mock("@/core/api/pos-db", () => ({db: {upsertShiftSession: writes.soft,commitShiftSession: writes.commit}}));
vi.mock("../business-storage", () => ({readBusinessValue: (key: string) => saved.get(key),writeBusinessValue: (key: string,value: string) => saved.set(key,value)}));
import {beginShiftSession,endShiftSessions,localShiftSessions} from "../shift-sessions";
beforeEach(() => {saved.clear();vi.clearAllMocks();writes.commit.mockResolvedValue("cloud");vi.stubGlobal("window",{});});
describe("sign-out session persistence", () => {
  it("waits for the closing write and closes only the current staff member", async () => {
    beginShiftSession({shiftId: "shift",storeId: "branch",staffId: "cashier",staffName: "Cashier"});
    beginShiftSession({shiftId: "shift",storeId: "branch",staffId: "admin",staffName: "Admin"});
    let finish!: () => void;
    writes.commit.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
    let finished = false;
    const closing = endShiftSessions({staffId: "cashier",awaitWrites: true}).then(() => {finished = true;});
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(writes.commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({staffId: "cashier",signedOutAt: expect.any(String)}));
    expect(localShiftSessions().find(row => row.staffId === "admin")?.signedOutAt).toBeNull();
    finish();await closing;
    expect(finished).toBe(true);
  });
  it("does not send an already-rejected identity to the database", async () => {
    beginShiftSession({shiftId: "shift",storeId: "branch",staffId: "cashier",staffName: "Cashier"});
    vi.clearAllMocks();
    await endShiftSessions({staffId: "cashier",awaitWrites: true,persist: false});
    expect(writes.commit).not.toHaveBeenCalled();
    expect(writes.soft).not.toHaveBeenCalled();
  });
});
