import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { LocalStartupState } from "../local-startup";
import type { StartupActivity as ActivitySnapshot } from "../desktop-startup-progress";
import { observeDesktopStartup, startupPresentation } from "../desktop-startup-progress";
const require = createRequire(import.meta.url);
const { StartupActivity, reportActivity } = require("../../../electron/db/startup-activity.cjs");
describe("read-only startup activity", () => {
  it.each([
    ["metadata_packagecheck","Checking the recovery update…"],
    ["metadata_probe","Checking local recovery support…"],
    ["metadata_backing_up","Backing up the local database…"],
    ["metadata_verifying_backup","Verifying the database backup…"],
    ["metadata_installing","Preparing local recovery support…"],
    ["metadata_readback","Verifying local recovery support…"],
  ])("shows actual %s preparation without releasing data readiness",(phase,label)=>{
    const activity=new StartupActivity(),run=activity.begin();
    run.report({phase,path:"private-path",proof:"private-proof"});
    expect(activity.snapshot()).toMatchObject({active:true,phase});
    expect(startupPresentation(activity.snapshot(),"Loading").message).toBe(label);
    expect(JSON.stringify(activity.snapshot())).not.toMatch(/private-/);
    run.finish(undefined,{complete:false});
    expect(activity.snapshot()).toMatchObject({active:false,phase:"waiting"});
  });
  it("does not resolve a prior shift-review failure when only metadata preparation finishes",()=>{
    const activity=new StartupActivity(),failed=activity.begin();
    failed.finish(Object.assign(new Error("SYNC_SHIFT_GRAPH_CONFLICT"),{code:"SYNC_SHIFT_GRAPH_CONFLICT"}));
    const schema=activity.begin();schema.report({phase:"metadata_readback"});schema.finish(undefined,{complete:false});
    expect(activity.snapshot()).toMatchObject({active:false,phase:"waiting",failure:"blocked",reason:"shift-data"});
    const actualRecovery=activity.begin();actualRecovery.report({phase:"applying"});actualRecovery.finish();
    expect(activity.snapshot()).toMatchObject({active:false,phase:"complete"});expect(activity.snapshot()).not.toHaveProperty("failure");
  });
  it("keeps progress on its own main-window-only stream with no automatic renderer retry", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const publish = main.slice(
      main.indexOf("publishStartupActivity:"),
      main.indexOf("publish: (state)"),
    );
    expect(publish).toContain('mainWindow.webContents.send("database:startup-activity"');
    expect(publish).not.toContain("database:state");
    expect(publish).not.toContain("BrowserWindow.getAllWindows");
    const observer = readFileSync("src/lib/desktop-startup-progress.ts", "utf8");
    expect(observer).not.toContain("setTimeout");
    expect(observer).not.toContain("retryStartup");
    expect(observer).not.toContain("resetRetry");
  });
  it("preserves active work while showing an actual manual pause, never promising auto retry", () => {
    const idle = startupPresentation(
      { active: false, phase: "waiting", failure: "temporary" },
      "loading",
      true,
    );
    expect(idle).toMatchObject({ active: false, message: "Synchronization paused" });
    expect(idle.notice).not.toContain("Automatic");
    expect(startupPresentation({ active: true, phase: "applying" }, "loading", true)).toMatchObject(
      {
        active: true,
        message: "Saving downloaded data locally…",
        notice: expect.stringContaining("paused"),
      },
    );
  });
  it("existing sync events beat stale initial pause state without any extra status query", async () => {
    let resolve!: (value: LocalStartupState) => void;
    let event!: (value: { paused?: boolean }) => void;
    const off = vi.fn(),
      paused = vi.fn();
    const stop = observeDesktopStartup(
      { getState: () => new Promise((r) => (resolve = r)) },
      () => {},
      () => {},
      {
        subscribe: (cb) => {
          event = cb;
          return off;
        },
      },
      paused,
    );
    event({ paused: true });
    resolve({ startupPaused: false });
    await Promise.resolve();
    expect(paused).toHaveBeenCalledExactlyOnceWith(true);
    stop();
    event({ paused: false });
    expect(paused).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledOnce();
  });
  it("keeps blocker explanations alongside pauses and never labels uploads as local saves", () => {
    expect(
      startupPresentation(
        { active: false, phase: "waiting", failure: "blocked", reason: "shift-data" },
        "loading",
        true,
      ).notice,
    ).toMatch(/reconciliation.*paused/);
    expect(
      startupPresentation({ active: true, phase: "uploading", processedRows: 42 }, "loading")
        .detail,
    ).toBeUndefined();
  });
  it("fences old runs, pool/backend/scope changes and sanitizes output", () => {
    let identity = [{}, "profile-secret", "backend-a"];
    const activity = new StartupActivity({ identity: () => identity });
    const old = activity.begin();
    old.report({ phase: "downloading", table: "shifts", processedRows: 5, secret: "no" });
    expect(activity.snapshot()).toMatchObject({ active: true, processedRows: 5 });
    expect(JSON.stringify(activity.snapshot())).not.toContain("secret");
    identity = [identity[0], "profile-secret", "backend-b"];
    old.finish();
    expect(activity.snapshot()).toBeNull();
    const current = activity.begin();
    old.report({ phase: "applying" });
    expect(activity.snapshot().phase).toBe("preparing");
    current.finish();
    expect(activity.snapshot().active).toBe(false);
  });
  it("retains blockers during retries and reconnects until complete success", () => {
    let identity = [{}, "same-profile", "same-scope"];
    const activity = new StartupActivity({ identity: () => identity });
    activity.begin().finish(new Error("SYNC_SHIFT_GRAPH_CONFLICT"));
    identity = [{}, "same-profile", "same-scope"];
    const retry = activity.begin();
    expect(activity.snapshot()).toMatchObject({
      active: true,
      failure: "blocked",
      reason: "shift-data",
    });
    retry.report({ phase: "downloading" });
    retry.finish(Object.assign(new Error("timeout"), { status: 503 }));
    expect(activity.snapshot().failure).toBe("blocked");
    activity.begin().finish();
    expect(activity.snapshot().failure).toBeUndefined();
  });
  it("subscriber failures cannot change accepted work", () => {
    const activity = new StartupActivity({
      publish: () => {
        throw Error("subscriber");
      },
    });
    expect(() => {
      const run = activity.begin();
      run.report({ phase: "applying" });
      run.finish();
      reportActivity(() => {
        throw Error("subscriber");
      }, {});
    }).not.toThrow();
  });
  it("uses separate event fences and never reloads database state on progress", async () => {
    let resolve!: (value: LocalStartupState) => void;
    let stateEvent!: (value: LocalStartupState) => void;
    let activityEvent!: (value: ActivitySnapshot | null) => void;
    const off = vi.fn(),
      update = vi.fn(),
      progress = vi.fn();
    const stop = observeDesktopStartup(
      {
        getState: () => new Promise((r) => (resolve = r)),
        subscribe: (cb) => {
          stateEvent = cb;
          return off;
        },
        onStartupActivity: (cb) => {
          activityEvent = cb;
          return off;
        },
      },
      update,
      progress,
    );
    activityEvent({ active: true, phase: "applying", processedRows: 20 });
    expect(update).not.toHaveBeenCalled();
    stateEvent({ state: "enabled_bootstrapping" });
    resolve({ state: "old", startupActivity: null });
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledTimes(1);
    stateEvent({ state: "changed", startupActivity: null });
    expect(progress).toHaveBeenLastCalledWith(null);
    stop();
    activityEvent(null);
    stateEvent({});
    expect(update).toHaveBeenCalledTimes(2);
    expect(off).toHaveBeenCalledTimes(2);
  });
  it("shows committed rows without invented percentages and keeps permanent blockers honest", () => {
    expect(
      startupPresentation(
        { active: true, phase: "applying", table: "change_history", processedRows: 42 },
        "loading",
      ),
    ).toMatchObject({
      active: true,
      message: "Saving downloaded data locally…",
      detail: "Change history · 42 rows saved locally",
    });
    expect(
      startupPresentation(
        { active: false, phase: "waiting", failure: "blocked", reason: "shift-data" },
        "loading",
      ),
    ).toMatchObject({
      active: false,
      message: "Waiting for database recovery",
      notice: expect.stringContaining("reconciliation"),
    });
  });
});

describe("actual Main preparation promise boundary", () => {
  function fixture() {
    const main = readFileSync("electron/main.cjs", "utf8");
    const source = main.slice(
      main.indexOf("let localDataPreparePromise=null;"),
      main.indexOf("let localDatabaseRecoveryPromise=null;"),
    );
    const activity = new StartupActivity();
    const begin = vi.fn(() => activity.begin());
    const ensure = vi.fn();
    const transition = vi.fn();
    const markReady = vi.fn();
    const prepare = new Function(
      "isManagementDevice",
      "managementReplica",
      "databaseConfig",
      "databaseService",
      "localDataLifecycle",
      "localBranchId",
      "diagnostics",
      "syncRegistry",
      `${source};return prepareLocalData;`,
    )(
      () => false,
      {},
      { profile: () => ({ retentionDays: 90 }) },
      { beginStartupActivity: begin, transition, markReady },
      { ensure, preserveCachedReady: () => false },
      () => "branch-fixture",
      { logConnection: () => {}, bootstrapDiagnostic: () => ({}) },
      { tables: [] },
    );
    return { activity, begin, ensure, transition, markReady, prepare };
  }
  it("keeps one actual Operations run active and finalizes only when its promise finishes", async () => {
    const f = fixture();
    let resolve!: (value: object) => void;
    f.ensure.mockImplementation(() => new Promise((r) => (resolve = r)));
    const pending = f.prepare();
    expect(f.prepare()).toBe(pending);
    expect(f.ensure).toHaveBeenCalledTimes(1);
    expect(f.activity.snapshot()).toMatchObject({ active: true, phase: "preparing" });
    f.ensure.mock.calls[0][0].onActivity({
      phase: "downloading",
      table: "shifts",
      processedRows: 25,
    });
    expect(f.activity.snapshot()).toMatchObject({ active: true, processedRows: 25 });
    resolve({ ok: true });
    await pending;
    expect(f.activity.snapshot()).toMatchObject({ active: false, phase: "complete" });
    expect(f.transition).not.toHaveBeenCalled();
    expect(f.markReady).not.toHaveBeenCalled();
  });
  it("preserves the same failed result and readiness guard for a permanent graph conflict", async () => {
    const f = fixture();
    const error = Object.assign(new Error("SYNC_SHIFT_GRAPH_CONFLICT"), { code: "P0001" });
    f.ensure.mockRejectedValue(error);
    await expect(f.prepare()).rejects.toBe(error);
    expect(f.transition).toHaveBeenCalledWith(
      "enabled_bootstrapping",
      expect.objectContaining({ syncReady: false }),
    );
    expect(f.activity.snapshot()).toMatchObject({
      active: false,
      failure: "blocked",
      reason: "shift-data",
    });
    expect(f.markReady).not.toHaveBeenCalled();
  });
});
