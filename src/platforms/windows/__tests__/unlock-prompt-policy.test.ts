import { describe, expect, it, vi } from "vitest";
import { canPromptForUnlock } from "../unlock-prompt-policy";
import { wrapBridge } from "../privilege-bridge";

describe("terminal unlock prompt scope", () => {
  it.each([
    "pos.setSetting", "pos.writeTerminalConfig", "pos.writeBranding", "pos.cacheStaffRoster",
    "pos.commitAggregate", "pos.writeBatch", "pos.openDrawer", "pos.print", "pos.closeWindow",
    "pos.sync.auto", "pos.sync.runNow", "pos.sync.finalizeShiftClose", "pos.sync.reconcile",
    "pos.database.authorizeSettings", "pos.database.retryStartup", "pos.installUpdate",
  ])("never opens a maintenance PIN dialog for %s", (call) => {
    expect(canPromptForUnlock(call, false)).toBe(false);
    expect(canPromptForUnlock(call, true)).toBe(false);
  });

  it("allows explicit maintenance but never a background maintenance request", () => {
    expect(canPromptForUnlock("pos.database.restore", true)).toBe(true);
    expect(canPromptForUnlock("pos.database.restore", false)).toBe(false);
    expect(canPromptForUnlock("pos.unknownNewAction", true)).toBe(false);
  });

  it("preserves denied startup writes without opening a dialog or retrying", async () => {
    const refusal = { ok:false, code:"EPRIVILEGE", requiredLevel:"supervisor" as const };
    const write = vi.fn(async () => refusal);
    const prompt = vi.fn(async () => true);
    const wrapped = wrapBridge({setSetting:write}, async (_message,_level,allow) => allow ? prompt() : false,
      call => canPromptForUnlock(`pos.${call}`, true));
    expect(await wrapped.setSetting()).toBe(refusal);
    expect(write).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("captures maintenance intent before IPC and refreshes an existing session silently", async () => {
    let clicked = false;
    const refresh = vi.fn(async () => true);
    let attempts = 0;
    const wrapped = wrapBridge({database:{restore:async()=>{
      clicked = true;
      return ++attempts === 1 ? {ok:false,code:"EPRIVILEGE",requiredLevel:"admin" as const} : {ok:true};
    }}}, refresh, call => canPromptForUnlock(`pos.${call}`,clicked));
    expect(await wrapped.database.restore()).toEqual({ok:true});
    expect(refresh).toHaveBeenCalledWith("", "admin", false);
  });
});
