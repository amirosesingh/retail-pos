import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs");
const { ShiftAuthorAuthority } = require("../../../electron/shift-authority.cjs");
const { createShiftAuthorKeys } = require("../../../electron/security/shift-author-key.cjs");
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const protocol = require("../../../electron/security/shift-author-protocol.cjs");
type Row = Record<string, any>;
const authorId = "10000000-0000-4000-8000-000000000001",
  otherId = "10000000-0000-4000-8000-000000000002";
const shiftId = "20000000-0000-4000-8000-000000000001",
  intentId = "30000000-0000-4000-8000-000000000001";
const subject = "canonical.cashier",
  branch = "fixture-branch";
const all = {
  can_shift_cash_count: true,
  can_shift_cash_recount: true,
  can_shift_variance_approve: true,
  can_process_sale: true,
};
const deferred = () => {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const directories: string[] = [];
afterEach(() => {
  session.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
function login(id = authorId, name = subject, permissions: Row = all) {
  session.grant("staff", "public.login.alias", permissions, "pos", branch);
  session.bindVerifiedAuthor(id, name);
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pos-main-author-fixture-"));
  directories.push(directory);
  const secret = randomBytes(32),
    safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString(value: string) {
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", secret, iv);
        return Buffer.concat([
          iv,
          cipher.update(value, "utf8"),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
      },
      decryptString(value: Buffer) {
        const cipher = createDecipheriv("aes-256-gcm", secret, value.subarray(0, 12));
        cipher.setAuthTag(value.subarray(-16));
        return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(
          "utf8",
        );
      },
    };
  let state: { keys: Row[]; authors: Row[] } = { keys: [], authors: [] };
  const events: string[] = [],
    controls: { onQuery?: () => void } = {};
  class Transaction {
    image!: typeof state;
    async begin() {
      this.image = structuredClone(state);
      events.push("begin");
    }
    async commit() {
      state = structuredClone(this.image);
      events.push("commit");
    }
    async rollback() {
      events.push("rollback");
    }
  }
  class Request {
    inputs: Row = {};
    constructor(readonly owner: Transaction | object) {}
    input(name: string, ...values: any[]) {
      this.inputs[name] = values.at(-1);
      return this;
    }
    async query(sql: string) {
      controls.onQuery?.();
      const data = this.owner instanceof Transaction ? this.owner.image : state;
      if (sql.startsWith("SELECT * FROM dbo.pos_sync_shift_author_keys"))
        return { recordset: data.keys.filter((row) => row.scope_hash === this.inputs.scope) };
      if (sql.startsWith("SELECT DISTINCT TOP(2)"))
        return {
          recordset: [
            ...new Set(
              [
                ...data.authors.filter((row) => row.scope_hash === this.inputs.scope).map((row) => row.key_id),
                ...((data as Row).starts??[]).map((row:Row)=>JSON.parse(row.proof_json)).filter((proof:Row)=>proof.projectOrigin===this.inputs.project&&proof.terminalId===this.inputs.terminal&&proof.authorId===this.inputs.author).map((proof:Row)=>proof.keyId),
              ],
            ),
          ].map((key_id) => ({ key_id })),
        };
      if (sql.startsWith("INSERT dbo.pos_sync_shift_author_keys")) {
        const p = this.inputs;
        data.keys.push({
          scope_hash: p.scope,
          project_origin: p.project,
          terminal_id: p.terminal,
          author_id: p.author,
          key_id: p.key,
          public_key: p.public,
        });
        return { recordset: [] };
      }
      if (sql.startsWith("INSERT dbo.pos_sync_shift_authors")) {
        const p = this.inputs;
        data.authors.push({
          intent_id: p.intent,
          scope_hash: p.scope,
          key_id: p.key,
          attestation_json: p.attestation,
        });
        return { recordset: [] };
      }
      throw new Error("Unexpected fixture SQL: " + sql);
    }
  }
  const manager = {
    pool: {},
    sql: () => ({ Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }),
  };
  const context = {
    terminal: {
      tokenId: "fixture-terminal",
      deviceUse: "operations",
      branchId: branch,
      deviceBindingProof: "fixture-proof",
    },
    project: "https://fixture.supabase.co",
    branch,
    management: false,
  };
  const keys = createShiftAuthorKeys({ safeStorage, directory: () => directory }),
    fetcher = vi.fn();
  const authority = new ShiftAuthorAuthority({
    keys,
    session,
    connectionManager: manager,
    terminal: () => context.terminal,
    project: () => context.project,
    branch: () => context.branch,
    isManagementDevice: () => context.management,
    backendUrl: () => "https://fixture.invalid",
    fetcher,
  });
  login();
  return {
    authority,
    keys,
    manager,
    context,
    directory,
    safeStorage,
    fetcher,
    controls,
    events,
    get state() {
      return state;
    },
    Transaction,
  };
}
const facts = {
  branchId: branch,
  shiftId,
  intentId,
  action: "RECOUNT",
  payloadHash: "a".repeat(64),
};

describe("Main protected shift author", () => {
  it("uses the verified UUID and canonical subject while preserving the public login alias", async () => {
    const f = fixture(),
      capture = f.authority.capture("RECOUNT"),
      author = await f.authority.prepare(capture),
      proof = author.sign(facts);
    expect(session.status().subject).toBe("public.login.alias");
    expect(proof).toMatchObject({ authorId, subject, action: "RECOUNT" });
    expect(f.state.keys).toHaveLength(1);
    expect(f.state.keys[0].author_id).toBe(authorId);
  });
  it.each(["RECOUNT", "VARIANCE"])(
    "does not turn a cashier ORIGINAL grant into %s permission",
    (action) => {
      const f = fixture();
      login(authorId, subject, { can_shift_cash_count: true });
      expect(() => f.authority.capture("ORIGINAL")).not.toThrow();
      expect(() => f.authority.capture(action)).toThrowError(
        expect.objectContaining({ code: "PERMISSION_DENIED" }),
      );
      expect(readdirSync(f.directory)).toEqual([]);
    },
  );
  it("does not infer action permission from an administrator label", () => {
    const f = fixture();
    session.grant("admin", subject, {}, "pos", branch);
    session.bindVerifiedAuthor(authorId, subject);
    expect(() => f.authority.capture("RECOUNT")).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED" }),
    );
  });
  it("keeps ordinary POS authority usable when an old backend has no stable author identity", () => {
    const f = fixture();
    session.grant(
      "staff",
      "cashier",
      { can_process_sale: true, can_shift_cash_count: true },
      "pos",
      branch,
    );
    expect(session.hasPermission("can_process_sale")).toBe(true);
    expect(session.hasPosAuthority()).toBe(true);
    expect(() => f.authority.capture("ORIGINAL")).toThrow();
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it("retains the terminal branch restriction independently of a person's verified UUID", () => {
    const f = fixture();
    session.grant("staff", subject, all, "pos", "other-branch");
    session.bindVerifiedAuthor(authorId, subject);
    expect(() => f.authority.capture("RECOUNT")).toThrowError(
      expect.objectContaining({ code: "SYNC_BRANCH_FORBIDDEN" }),
    );
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it.each(["manual", "management"])("rejects %s authority without generating a key", (kind) => {
    const f = fixture();
    if (kind === "manual") session.grant("admin", subject, all, "manual", branch);
    else f.context.management = true;
    expect(() => f.authority.capture("RECOUNT")).toThrow();
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it("permits identity enrollment on an authorized management device without granting local shift actions", async () => {
    const f = fixture();
    f.context.management = true;
    f.context.branch = "";
    expect(() => f.authority.capture("ENROLL")).not.toThrow();
    expect(() => f.authority.capture("RECOUNT")).toThrow();
    f.fetcher.mockRejectedValue(new Error("isolated unavailable"));
    await expect(f.authority.enrollOnline({ cashierToken: "fixture" })).resolves.toMatchObject({
      ok: false,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(session.hasPermission("can_process_sale")).toBe(true);
  });
  it.each([
    "other person",
    "same person new session",
    "lock",
    "permission revoked",
    "project",
    "terminal",
    "branch",
    "pool",
  ])("fences %s changes after capture", async (change) => {
    const f = fixture(),
      capture = f.authority.capture("RECOUNT");
    if (change === "other person") login(otherId, "other");
    if (change === "same person new session") login();
    if (change === "lock") session.clear();
    if (change === "permission revoked") login(authorId, subject, { can_process_sale: true });
    if (change === "project") f.context.project = "https://other.supabase.co";
    if (change === "terminal") f.context.terminal.tokenId = "other-terminal";
    if (change === "branch") f.context.branch = "other";
    if (change === "pool") f.manager.pool = {};
    await expect(f.authority.prepare(capture)).rejects.toMatchObject({
      code: "ESYNC_SHIFT_AUTHOR_CHANGED",
    });
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it("rechecks the person after an awaited metadata read and rolls back", async () => {
    const f = fixture(),
      capture = f.authority.capture("RECOUNT");
    f.controls.onQuery = () => {
      f.controls.onQuery = undefined;
      login(otherId, "other");
    };
    await expect(f.authority.prepare(capture)).rejects.toMatchObject({
      code: "ESYNC_SHIFT_AUTHOR_CHANGED",
    });
    expect(f.events).toEqual(["begin", "rollback"]);
    expect(f.state.keys).toEqual([]);
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it("signs only the captured action/branch and saves that proof in the caller transaction", async () => {
    const f = fixture(),
      author = await f.authority.prepare(f.authority.capture("RECOUNT"));
    expect(() => author.sign({ ...facts, action: "VARIANCE" })).toThrow();
    expect(() => author.sign({ ...facts, branchId: "other" })).toThrow();
    const transaction = new f.Transaction();
    await transaction.begin();
    const proof = author.sign(facts);
    await author.save(transaction, proof);
    await transaction.commit();
    expect(JSON.parse(f.state.authors[0].attestation_json)).toEqual(proof);
    expect(proof.subject).toBe(subject);
  });
  it("allows offline signing but retains an unenrolled intent until the same key is enrolled", async () => {
    const f = fixture(),
      author = await f.authority.prepare(f.authority.capture("RECOUNT")),
      proof = author.sign(facts);
    expect(() => f.authority.validatePending(proof)).toThrowError(
      expect.objectContaining({ code: "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING" }),
    );
    const info = f.keys.prepare(author.binding, { expectedKeyId: author.keyId });
    f.keys.markEnrolled(author.binding, { keyId: info.keyId, publicKey: info.publicKey });
    login(otherId, "later.cashier", { can_process_sale: true });
    expect(f.authority.validatePending(proof)).toEqual(proof);
    expect(session.identity().authorId).toBe(otherId);
    expect(() => f.authority.validatePending({ ...proof, subject: "retagged" })).toThrowError(
      expect.objectContaining({ code: "ESYNC_SHIFT_AUTHOR_INVALID" }),
    );
  });
  it.each(["key reference", "signature reference only"])(
    "does not replace a missing sealed key after restart with %s",
    async (kind) => {
      const f = fixture(),
        author = await f.authority.prepare(f.authority.capture("RECOUNT")),
        proof = author.sign(facts),
        tx = new f.Transaction();
      await tx.begin();
      await author.save(tx, proof);
      await tx.commit();
      if (kind === "signature reference only") f.state.keys.splice(0);
      for (const name of readdirSync(f.directory)) unlinkSync(join(f.directory, name));
      const reloaded = new ShiftAuthorAuthority({
        ...f.authority,
        keys: createShiftAuthorKeys({ safeStorage: f.safeStorage, directory: () => f.directory }),
      });
      await expect(reloaded.prepare(reloaded.capture("RECOUNT"))).rejects.toMatchObject({
        code: "ESYNC_SHIFT_AUTHOR_KEY_MISSING",
      });
      expect(readdirSync(f.directory)).toEqual([]);
    },
  );
  it("rejects a saved signature that points at another key without normalizing history", async () => {
    const f = fixture(),
      author = await f.authority.prepare(f.authority.capture("RECOUNT"));
    f.state.authors.push({ scope_hash: f.state.keys[0].scope_hash, key_id: intentId });
    const before = structuredClone(f.state);
    await expect(f.authority.prepare(f.authority.capture("RECOUNT"))).rejects.toMatchObject({
      code: "ESYNC_SHIFT_AUTHOR_KEY_MISMATCH",
    });
    expect(f.state).toEqual(before);
    expect(author.keyId).toBe(f.state.keys[0].key_id);
  });
  it("treats enrollment failure as a pending key without removing cashier authority", async () => {
    const f = fixture();
    f.fetcher.mockRejectedValue(new Error("offline fixture"));
    await expect(
      f.authority.enrollOnline({ cashierToken: "fixture-signed-person" }),
    ).resolves.toMatchObject({ ok: false });
    expect(session.hasPermission("can_process_sale")).toBe(true);
    expect(session.identity().authorId).toBe(authorId);
  });
  it("uses a separate enrollment domain, coalesces requests and never adopts a late enrollment as the current session", async () => {
    const f = fixture(),
      reply = deferred();
    f.fetcher.mockReturnValue(reply.promise);
    const pending = f.authority.enrollOnline({
      cashierToken: "fixture-signed-person",
      sessionToken: "fixture-session",
    });
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
    const second = f.authority.enrollOnline({ cashierToken: "fixture-signed-person" });
    const [url, options] = f.fetcher.mock.calls[0],
      body = JSON.parse(options.body);
    expect(url).toBe("https://fixture.invalid/api/v1/pos/shift-author-enroll");
    expect(body).toMatchObject({
      cashierToken: "fixture-signed-person",
      terminalToken: "fixture-terminal",
      deviceBindingProof: "fixture-proof",
      enrollment: { authorId },
    });
    expect(() => protocol.enrollmentMessage(body.enrollment)).not.toThrow();
    login(otherId, "later.cashier", { can_process_sale: true });
    reply.resolve({
      ok: true,
      json: async () => ({ ok: true, ...body.enrollment, subject, enrolled: true }),
    });
    await expect(pending).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(session.identity().authorId).toBe(otherId);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(
      f.keys.prepare({ projectOrigin: f.context.project, terminalId: "fixture-terminal", authorId })
        .enrolled,
    ).toBe(true);
  });
  it.each(["subject", "authorId", "keyId", "publicKey", "projectOrigin", "terminalId"])(
    "does not mark an enrollment with a mismatched %s",
    async (field) => {
      const f = fixture();
      f.fetcher.mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            ok: true,
            ...body.enrollment,
            subject,
            enrolled: true,
            [field]: "mismatch",
          }),
        };
      });
      await expect(f.authority.enrollOnline({ cashierToken: "fixture" })).resolves.toMatchObject({
        ok: false,
      });
      expect(
        f.keys.prepare({
          projectOrigin: f.context.project,
          terminalId: "fixture-terminal",
          authorId,
        }).enrolled,
      ).toBe(false);
    },
  );
  it("never enrolls from a username-only session proof", async () => {
    const f = fixture();
    await expect(
      f.authority.enrollOnline({ sessionToken: "legacy-user-label" }),
    ).resolves.toMatchObject({ ok: false });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it("a fresh verified session retains its enrollment attempt while the older session waits on SQL", async () => {
    const f = fixture(),
      gate = deferred(),
      prepare = f.authority.prepare.bind(f.authority);
    vi.spyOn(f.authority, "prepare").mockImplementationOnce(async (value: unknown) => {
      const capture=value as Row;
      await gate.promise;
      capture.assertCurrent();
      return prepare(capture);
    });
    const old = f.authority.enrollOnline({ cashierToken: "old-epoch-proof" });
    login();
    f.fetcher.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(body.cashierToken).toBe("new-epoch-proof");
      return {
        ok: true,
        json: async () => ({ ok: true, ...body.enrollment, subject, enrolled: true }),
      };
    });
    await expect(f.authority.enrollOnline({ cashierToken: "new-epoch-proof" })).resolves.toEqual({
      ok: true,
    });
    gate.resolve();
    await expect(old).resolves.toMatchObject({ ok: false, code: "ESYNC_SHIFT_AUTHOR_CHANGED" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("transaction final author guard", () => {
  it.each([false, true])(
    "rolls back a changed author after the last await (replay=%s)",
    async (replay) => {
      const f = fixture(),
        capture = f.authority.capture("ORIGINAL"),
        repository = new OperationsRepository(f.manager, loadRegistry()),
        gate = deferred();
      repository.applyOperation = vi.fn(async () => 1);
      const pending = repository.apply(
        "fixture",
        [{ table: "shifts", kind: "update", match: { id: shiftId }, values: { store_id: branch } }],
        { branchId: branch },
        async () => {
          await gate.promise;
        },
        replay
          ? async () => {
              await gate.promise;
              return false;
            }
          : undefined,
        capture.assertCurrent,
      );
      await vi.waitFor(() => expect(f.events).toContain("begin"));
      login(otherId, "other");
      gate.resolve();
      await expect(pending).rejects.toMatchObject({ code: "ESYNC_SHIFT_AUTHOR_CHANGED" });
      expect(f.events).toEqual(["begin", "rollback"]);
    },
  );
});

describe("author proof transport and holds", () => {
  it("does not repeat an explicit author denial even when a gateway reports500", async () => {
    const { PushWorker } = require("../../../electron/sync/push-worker.cjs"),
      worker = new PushWorker({}),
      work = vi.fn(async () => {
        throw Object.assign(new Error("author held"), {
          code: "ESHIFT_AUTHOR_REVOKED",
          status: 500,
        });
      });
    await expect(worker.retry(work)).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_REVOKED" });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("sends the stored proof outside the immutable payload without attaching the next cashier", async () => {
    const f = fixture(),
      author = await f.authority.prepare(f.authority.capture("RECOUNT")),
      proof = author.sign(facts),
      calls: Row[] = [];
    const client = new CloudClient({
      configStore: { read: () => ({}) },
      terminalStore: { read: () => ({ tokenId: "fixture-terminal" }) },
    });
    client.shiftProtocolRequest = async (payload: Row) => {
      calls.push(payload);
      return { ok: true };
    };
    const frozen = { payloadJson: '{"exact":"frozen bytes"}' };
    await client.pushAggregate({
      batchId: intentId,
      branchId: branch,
      shiftIntent: frozen,
      shiftAuthor: proof,
    });
    expect(calls[0].sqlServerAggregate).toEqual({
      batchId: intentId,
      organizationId: "default",
      branchId: branch,
      shiftIntent: frozen,
      shiftAuthor: proof,
    });
    expect(frozen).toEqual({ payloadJson: '{"exact":"frozen bytes"}' });
  });
  it.each([
    "ESHIFT_AUTHOR_REVOKED",
    "ESHIFT_AUTHOR_PERMISSION_REVOKED",
    "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING",
  ])("retains transport credentials for %s while still attempting guarded pull", async (code) => {
    const pull = vi.fn(async () => ({ merged: 0 })),
      coordinator = new SyncCoordinator({
        pushWorker: {
          run: async () => {
            throw Object.assign(new Error("author held"), { code, status: 403 });
          },
          pending: async () => 0,
        },
        pullWorker: { run: pull },
      });
    coordinator.refresh = async () => {};
    const result = await coordinator.runOnce({ branchId: branch });
    expect(result).toMatchObject({ ok: false, code, credentialsInvalid: false });
    expect(pull).toHaveBeenCalledTimes(1);
  });
  it("preserves invalid-transport handling for generic403", async () => {
    const pull = vi.fn(),
      coordinator = new SyncCoordinator({
        pushWorker: {
          run: async () => {
            throw Object.assign(new Error("transport denied"), { code: "HTTP_403", status: 403 });
          },
        },
        pullWorker: { run: pull },
      });
    coordinator.refresh = async () => {};
    expect(await coordinator.runOnce()).toMatchObject({ credentialsInvalid: true });
    expect(pull).not.toHaveBeenCalled();
  });
});

describe("Main asynchronous session adoption", () => {
  const installed = () => {
    const f = fixture(),
      main = readFileSync("electron/main.cjs", "utf8"),
      handlers = new Map<string, (...args: any[]) => any>(),
      ipcMain = {
        handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
      };
    require("../../../electron/ipc-privilege.cjs").install(ipcMain, {
      isFirstRun: () => false,
      writeBarrier: new (require("../../../electron/sync/write-barrier.cjs").WriteBarrier)(),
    });
    const request = vi.fn(),
      verify = vi.fn(),
      enroll = vi
        .spyOn(f.authority, "enrollOnline")
        .mockResolvedValue({ ok: false, code: "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING" });
    const context: Row = {
      ipcMain,
      guard: require("../../../electron/ipc-guard.cjs"),
      adminSession: session,
      sessionAdoptionRevision: 0,
      databaseManager: f.manager,
      terminalStore: {
        read: () => f.context.terminal,
        lastBinding: () => null,
        write: (value: Row) => {
          f.context.terminal = value as typeof f.context.terminal;
          return { ok: true };
        },
      },
      cloudCredentials: { read: () => ({ url: f.context.project }) },
      authorizationServerUrl: () => "https://fixture.invalid",
      localBranchId: () => f.context.branch,
      shiftAuthority: f.authority,
      syncCloud: { setAuthorizationProof: vi.fn() },
      rememberVerifiedBranch: vi.fn(),
      fetch: request,
      verifySyncedStaffPin: verify,
      AbortController,
      AbortSignal,
      setTimeout,
      clearTimeout,
      activationBoundary: require("../../../electron/verified-activation.cjs"),
      assertSafeRegistrationChange: vi.fn(),
      recordRegistrationChange: vi.fn(),
    };
    const helper = main.indexOf("function captureSessionAdoption()"),
      helperEnd = main.indexOf("\nfunction registerIpc()", helper);
    runInNewContext(main.slice(helper, helperEnd), context);
    for (const [first, last] of [
      ["auth:cashier-login", "app:ready"],
      ["staff:sign-in", "approval:own-token-vault"],
      ["admin:adopt-session", "admin:unlock"],
    ]) {
      const start = main.indexOf(`ipcMain.handle("${first}"`),
        end = main.indexOf(`ipcMain.handle("${last}"`, start);
      runInNewContext(main.slice(start, end), context);
    }
    return {
      ...f,
      context,
      request,
      verify,
      enroll,
      call: (name: string, ...args: any[]) => handlers.get(name)!({}, ...args),
    };
  };
  const online = () => ({
    ok: true,
    cashier: {
      id: authorId,
      username: subject,
      role: "staff",
      store_id: branch,
      permissions: { can_process_sale: true },
    },
    cashierToken: "signed-person-fixture",
    sessionToken: "session-fixture",
  });
  it("ordinary online cashier login binds the verified person and succeeds when enrollment is pending", async () => {
    const f = installed();
    f.request.mockResolvedValue({ ok: true, status: 200, json: async () => online() });
    await expect(
      f.call("auth:cashier-login", { username: "login.alias", pin: "1234" }),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    expect(session.identity()).toMatchObject({
      authorId,
      canonicalSubject: subject,
      subject,
      permissions: { can_process_sale: true },
    });
    expect(f.enroll).toHaveBeenCalledExactlyOnceWith({
      cashierToken: "signed-person-fixture",
      sessionToken: "session-fixture",
    });
    expect(session.hasPermission("can_process_sale")).toBe(true);
  });
  it("a late online PIN result cannot adopt or enroll over the next person's session", async () => {
    const f = installed(),
      response = deferred();
    f.request.mockReturnValue(response.promise);
    const pending = f.call("auth:cashier-login", { username: "login.alias", pin: "1234" });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    login(otherId, "next.person");
    response.resolve({ ok: true, status: 200, json: async () => online() });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "EAUTH_CHANGED" });
    expect(f.enroll).not.toHaveBeenCalled();
    expect(session.identity().authorId).toBe(otherId);
    expect(f.context.syncCloud.setAuthorizationProof).not.toHaveBeenCalled();
  });
  it("offline sign-in carries the same synced app_users UUID/canonical user_id and does not enroll", async () => {
    const f = installed();
    f.verify.mockResolvedValue({
      ok: true,
      staff: {
        id: authorId,
        username: subject,
        role: "staff",
        store_id: branch,
        permissions: { can_process_sale: true },
      },
    });
    await expect(f.call("staff:sign-in", "login.alias", "1234")).resolves.toMatchObject({
      ok: true,
    });
    expect(session.identity()).toMatchObject({ authorId, canonicalSubject: subject });
    expect(f.enroll).not.toHaveBeenCalled();
    expect(session.hasPermission("can_process_sale")).toBe(true);
  });
  it("a late offline PIN result cannot replace the next session", async () => {
    const f = installed(),
      result = deferred();
    f.verify.mockReturnValue(result.promise);
    const pending = f.call("staff:sign-in", "login.alias", "1234");
    await vi.waitFor(() => expect(f.verify).toHaveBeenCalledTimes(1));
    login(otherId, "next.person");
    result.resolve({
      ok: true,
      staff: { id: authorId, username: subject, role: "staff", store_id: branch, permissions: all },
    });
    await expect(pending).resolves.toMatchObject({ ok: false, reason: "unavailable" });
    expect(session.identity().authorId).toBe(otherId);
    expect(f.enroll).not.toHaveBeenCalled();
  });
  const adopted = () => ({
    ok: true,
    level: "staff",
    subject,
    authorId,
    permissions: { can_process_sale: true },
    branchId: branch,
    terminal: { id: "fixture-terminal", platform: "pc", mode: "operations", branchId: branch },
  });
  it("password/session adoption binds the verified stable UUID and keeps enrollment independent", async () => {
    const f = installed();
    f.request.mockResolvedValue({ ok: true, status: 200, json: async () => adopted() });
    await expect(
      f.call("admin:adopt-session", { accessToken: "fixture-personal-auth-token" }),
    ).resolves.toMatchObject({ ok: true, level: "staff" });
    expect(session.identity()).toMatchObject({ authorId, canonicalSubject: subject });
    expect(f.enroll).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ accessToken: "fixture-personal-auth-token" }),
    );
    expect(session.hasPermission("can_process_sale")).toBe(true);
  });
  it("a late password/session adoption cannot enroll the next person with the earlier proof", async () => {
    const f = installed(),
      response = deferred();
    f.request.mockReturnValue(response.promise);
    const pending = f.call("admin:adopt-session", { accessToken: "fixture-personal-auth-token" });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    login(otherId, "next.person");
    response.resolve({ ok: true, status: 200, json: async () => adopted() });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "EAUTH_DENIED" });
    expect(f.enroll).not.toHaveBeenCalled();
    expect(session.identity().authorId).toBe(otherId);
  });
  it.each(["new session", "terminal", "project", "pool"])(
    "does not adopt an earlier result after %s changed",
    (change) => {
      const f = fixture(),
        main = readFileSync("electron/main.cjs", "utf8"),
        start = main.indexOf("function captureSessionAdoption()"),
        end = main.indexOf("\nfunction enrollCurrentShiftAuthor", start),
        context: Row = {
          adminSession: session,
          databaseManager: f.manager,
          terminalStore: { read: () => f.context.terminal },
          cloudCredentials: { read: () => ({ url: f.context.project }) },
          authorizationServerUrl: () => "https://fixture.invalid",
          sessionAdoptionRevision: 0,
        };
      runInNewContext(main.slice(start, end) + "\nthis.capture=captureSessionAdoption;", context);
      const current = context.capture();
      expect(current()).toBe(true);
      if (change === "new session") login();
      if (change === "terminal") f.context.terminal.tokenId = "other";
      if (change === "project") f.context.project = "https://other.supabase.co";
      if (change === "pool") f.manager.pool = {};
      expect(current()).toBe(false);
    },
  );
});


describe('protected closing-start author proof', () => {
  const eventId='40000000-0000-4000-8000-000000000001';
  const payloadJson=JSON.stringify({version:1,branchId:branch,shiftId,eventId,event:{id:eventId,event:'closing_started',actor_name:subject},parent:{id:shiftId,closing_started_by:subject}});
  it('requires can_close_shift rather than cash-count or administrator identity alone', () => {
    const f=fixture();login();
    expect(()=>f.authority.capture('START_CLOSE')).toThrowError(expect.objectContaining({code:'PERMISSION_DENIED'}));
    login(authorId,subject,{can_close_shift:true});expect(f.authority.capture('START_CLOSE').subject).toBe(subject);
    f.context.management=true;expect(()=>f.authority.capture('START_CLOSE')).toThrow();
  });
  it('reuses the same exact sealed key and validates A proof after B signs in',async()=>{
    const f=fixture();login(authorId,subject,{can_close_shift:true});
    const author=await f.authority.prepare(f.authority.capture('START_CLOSE'));
    const proof=author.signClosingStart({branchId:branch,shiftId,eventId,payloadJson});
    const info=f.keys.prepare(author.binding,{expectedKeyId:author.keyId});
    expect(proof.keyId).toBe(author.keyId);expect(f.state.keys).toHaveLength(1);
    expect(()=>f.authority.validatePendingClosingStart(proof)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING'}));
    f.keys.markEnrolled(author.binding,{keyId:info.keyId,publicKey:info.publicKey});
    login(otherId,'next.person');expect(f.authority.validatePendingClosingStart(proof)).toEqual(proof);
    expect(()=>f.authority.validatePendingClosingStart({...proof,subject:'next.person'})).toThrow();
    expect(()=>f.authority.validatePendingClosingStart({...proof,payloadJson:payloadJson+' '})).toThrow();
    expect(()=>f.authority.validatePendingClosingStart({...proof,eventId:intentId})).toThrow();
    expect(()=>f.authority.validatePendingClosingStart({...proof,projectOrigin:'https://different.invalid'})).toThrow();
    expect(()=>f.authority.validatePending(proof)).toThrow();
    expect(readdirSync(f.directory)).toHaveLength(1);
  });
  it('rejects a supplied hash mismatch and binding override before touching key material',()=>{
    const f=fixture(),binding=f.authority.binding(authorId),input={subject,branchId:branch,shiftId,eventId,payloadJson,payloadHash:'a'.repeat(64)};
    expect(()=>f.keys.signClosingStart(binding,input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(()=>f.keys.signClosingStart(binding,{...input,authorId:otherId})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it('rejects a switched session before start signing and never changes the prior author',async()=>{
    const f=fixture();login(authorId,subject,{can_close_shift:true});
    const author=await f.authority.prepare(f.authority.capture('START_CLOSE'));
    login(otherId,'next.person',{can_close_shift:true});
    expect(()=>author.signClosingStart({branchId:branch,shiftId,eventId,payloadJson})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));
    expect(f.state.keys).toHaveLength(1);expect(f.state.keys[0].author_id).toBe(authorId);
  });
  it('strictly separates the public domain and bounds UTF8 bytes',()=>{
    const unsigned={version:1,algorithm:'Ed25519',keyId:intentId,authorId,subject,projectOrigin:'https://fixture.invalid',terminalId:'terminal',branchId:branch,shiftId,eventId,payloadHash:'a'.repeat(64),payloadJson};
    expect(protocol.closingStartMessage(unsigned)).toContain('retail-pos.shift-author.closing-start.v1');
    expect(()=>protocol.closingStartMessage({...unsigned,payloadJson:'é'.repeat(8193)})).toThrow();
    expect(()=>protocol.normalizeClosingStart({...unsigned,signature:'A'.repeat(86),action:'START_CLOSE'})).toThrow();
  });
});


describe('installed Main closing-start transaction',()=>{
  function installedStart(){
    const f=fixture(),state=f.state as Row;
    state.shifts=[{id:shiftId,store_id:branch,terminal_id:'fixture-terminal',opened_at:'2026-11-02T01:00:00.000Z',opened_by_staff_id:subject,opened_by_name:subject,state:'ACTIVE',status:'OPEN',row_version:1}];
    state.shift_close_events=[];state.starts=[];
    const Base=f.manager.sql().Request;
    const faults:{beforeSave?:()=>void;saveError?:boolean;beforeFinalize?:()=>void}={};
    class Request extends Base{
      async query(sql:string){
        const image=this.owner instanceof f.Transaction?this.owner.image: f.state as Row;
        if(sql.includes('FROM dbo.[shifts]'))return {recordset:structuredClone((image as Row).shifts.filter((row:Row)=>row.id===this.inputs.shift&&row.store_id===this.inputs.branch))};
        if(sql.includes('FROM dbo.[shift_close_events]'))return {recordset:structuredClone((image as Row).shift_close_events.filter((row:Row)=>row.id===this.inputs.event&&row.shift_id===this.inputs.shift&&row.store_id===this.inputs.branch))};
        if(sql.startsWith('INSERT dbo.pos_sync_shift_closing_starts')){
          faults.beforeSave?.();if(faults.saveError)throw new Error('Synthetic proof insert failure');
          (image as Row).starts.push({shift_id:this.inputs.shift,branch_id:this.inputs.branch,event_id:this.inputs.event,proof_json:this.inputs.proof});return {recordset:[]};
        }
        return super.query(sql);
      }
    }
    const originalSql=f.manager.sql;f.manager.sql=()=>({...originalSql(),Request});
    const repository=new OperationsRepository(f.manager);
    repository.query=async(_branch:string,table:string)=>({rows:structuredClone(table==='pos_settings'?[{integration_settings:{allowAnyStaffCloseShift:true}}]:(f.state as Row)[table]??[])});
    repository.applyOperation=async(tx:Row,op:Row)=>{
      if(op.kind==='update'){Object.assign(tx.image[op.table][0],structuredClone(op.values));tx.image[op.table][0].row_version++;}
      else tx.image[op.table].push(...structuredClone(op.rows));
      return 1;
    };
    const handlers=new Map<string,(...args:any[])=>any>(),ipcMain={handle:(name:string,fn:(...args:any[])=>any)=>handlers.set(name,fn)};
    require('../../../electron/ipc-privilege.cjs').install(ipcMain,{isFirstRun:()=>false,writeBarrier:new(require('../../../electron/sync/write-barrier.cjs').WriteBarrier)()});
    const main=readFileSync('electron/main.cjs','utf8'),start=main.indexOf('async function startLocalShiftClose('),end=main.indexOf('async function commitLocalShiftCashCount(',start);
    const context:Row={require:createRequire(join(process.cwd(),'electron/main.cjs')),shiftAuthority:f.authority,localBranchId:()=>branch,guard:require('../../../electron/ipc-guard.cjs'),operationsRepository:repository,adminSession:session,recordId:require('../../../electron/sync/uuid-fields.cjs').recordId,randomUUID:()=>intentId,publishBusinessChange:vi.fn(),pendingShiftCloseSync:new Set(),scheduleAutomaticSync:vi.fn()};
    runInNewContext(main.slice(start,end),context);
    const channel='business:shift-close-start';
    ipcMain.handle(channel,(_event:unknown,value:Row)=>context.startLocalShiftClose(value));
    const realApply=repository.apply.bind(repository);
    repository.apply=(...args:any[])=>{
      const finalize=args[5];args[5]=()=>{faults.beforeFinalize?.();return finalize?.();};return realApply(...args);
    };
    return {...f,get state(){return f.state;},repository,faults,context,call:async()=>handlers.get(channel)!({}, {shiftId,reason:'End of day',terminalId:'fixture-terminal'})};
  }
  it('atomically saves the actual parent/event evidence and preserves it across replay',async()=>{
    const f=installedStart();login(authorId,subject,{can_close_shift:true});
    await expect(f.call()).resolves.toMatchObject({ok:true,state:'CASH_COUNT_REQUIRED'});
    const state=f.state as Row;expect(state.starts).toHaveLength(1);expect(state.shift_close_events).toHaveLength(1);
    const proof=JSON.parse(state.starts[0].proof_json),payload=JSON.parse(proof.payloadJson);
    expect(payload.parent).toMatchObject({id:shiftId,store_id:branch,closing_started_by:subject,close_reason:'End of day'});
    expect(payload.parent).toHaveProperty('opened_at','2026-11-02T01:00:00.000Z');
    expect(payload.event).toMatchObject({id:intentId,actor_name:subject,actor_staff_id:subject,event:'closing_started'});
    expect(payload.event).not.toHaveProperty('row_version');expect(payload.event).not.toHaveProperty('updated_at');
    const before=state.starts[0].proof_json;login(otherId,'next.person',{can_close_shift:true});
    await expect(f.call()).resolves.toMatchObject({ok:true,replayed:true});expect((f.state as Row).starts[0].proof_json).toBe(before);
  });
  it('never generates a replacement when only an immutable start proof still references the lost key',async()=>{
    const f=installedStart();login(authorId,subject,{can_close_shift:true});await f.call();
    const proof=JSON.parse((f.state as Row).starts[0].proof_json);f.state.keys.splice(0);
    unlinkSync(join(f.directory,readdirSync(f.directory)[0]));
    await expect(f.authority.prepare(f.authority.capture('START_CLOSE'))).rejects.toMatchObject({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'});
    expect(readdirSync(f.directory)).toEqual([]);expect((f.state as Row).starts[0].proof_json).toBe(JSON.stringify(proof));
  });
  it('the installed wrapper denies a cashier or administrator without can_close_shift before any writes',async()=>{
    const f=installedStart();login(authorId,subject,{can_shift_cash_count:true});
    await expect(f.call()).resolves.toMatchObject({ok:false});
    session.grant('admin',subject,{can_shift_cash_count:true},'pos',branch);session.bindVerifiedAuthor(authorId,subject);
    await expect(f.call()).resolves.toMatchObject({ok:false});expect((f.state as Row).starts).toEqual([]);expect((f.state as Row).shifts[0].state).toBe('ACTIVE');
  });
  it.each(['proof insert','session switch while saving','session switch before commit'])('rolls back start row/event/proof on %s',async(fault)=>{
    const f=installedStart();login(authorId,subject,{can_close_shift:true});
    if(fault==='proof insert')f.faults.saveError=true;
    else if(fault==='session switch while saving')f.faults.beforeSave=()=>login(otherId,'next.person',{can_close_shift:true});
    else f.faults.beforeFinalize=()=>login(otherId,'next.person',{can_close_shift:true});
    await expect(f.call()).rejects.toThrow();expect((f.state as Row).starts).toEqual([]);expect((f.state as Row).shift_close_events).toEqual([]);expect((f.state as Row).shifts[0].state).toBe('ACTIVE');
  });
});


describe('background start/count handover transport',()=>{
  it.each([true,false])('validates enrolled A and independent B without current A login (A enrolled=%s)',async(enrolled)=>{
    const f=fixture();login(authorId,subject,{can_close_shift:true});
    const starter=await f.authority.prepare(f.authority.capture('START_CLOSE'));
    const startProof=starter.signClosingStart({branchId:branch,shiftId,eventId:intentId,payloadJson:'{}'});
    const aInfo=f.keys.prepare(starter.binding,{expectedKeyId:starter.keyId});
    if(enrolled)f.keys.markEnrolled(starter.binding,{keyId:aInfo.keyId,publicKey:aInfo.publicKey});
    login(otherId,'counter-b',{can_shift_cash_count:true});
    const counter=await f.authority.prepare(f.authority.capture('ORIGINAL'));
    const countProof=counter.sign({...facts,action:'ORIGINAL'});
    const bInfo=f.keys.prepare(counter.binding,{expectedKeyId:counter.keyId});
    f.keys.markEnrolled(counter.binding,{keyId:bInfo.keyId,publicKey:bInfo.publicKey});
    const intent={version:1,intentId,shiftId,kind:'ORIGINAL',payloadJson:'{}',baseToken:null,predecessorIntentId:null,predecessorIntentHash:null,operations:[],shiftAuthor:countProof,shiftClosingStart:startProof};
    const failAggregate=vi.fn(),cloud={pushAggregate:vi.fn(async()=>{throw Object.assign(new Error('Synthetic transport stop after serialization'),{status:403,code:'FIXTURE_STOP'});})};
    const worker=new(require('../../../electron/sync/push-worker.cjs').PushWorker)({reader:{pendingAggregates:async()=>[{aggregateId:intentId,changes:[{entity_type:'shifts'}]}],protectedIntent:async()=>intent,failAggregate},cloud,registry:loadRegistry(),validateAuthor:(value:Row)=>f.authority.validatePending(value),validateClosingStart:(value:Row)=>f.authority.validatePendingClosingStart(value)});
    await expect(worker.pushAggregates(branch,100)).rejects.toMatchObject({code:enrolled?'FIXTURE_STOP':'ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING'});
    expect(failAggregate).toHaveBeenCalledTimes(1);
    if(enrolled){expect(cloud.pushAggregate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({shiftAuthor:countProof,shiftClosingStart:startProof}));expect(session.identity().authorId).toBe(otherId);}
    else expect(cloud.pushAggregate).not.toHaveBeenCalled();
    const client=new CloudClient({}),wire:Row[]=[];client.shiftProtocolRequest=async(value:Row)=>{wire.push(value);return {ok:true};};
    await client.pushAggregate({batchId:intentId,branchId:branch,shiftIntent:{payloadJson:'exact immutable intent'},shiftAuthor:countProof,shiftClosingStart:startProof});
    expect(wire[0].sqlServerAggregate).toMatchObject({shiftClosingStart:startProof,shiftAuthor:countProof,shiftIntent:{payloadJson:'exact immutable intent'}});
    expect(startProof.authorId).toBe(authorId);expect(countProof.authorId).toBe(otherId);expect(startProof.keyId).not.toBe(countProof.keyId);
  });
});

// Companion proofs never change the existing frozen intent or persist into its
// historical author table. Future persistence is a separate metadata protocol.
describe('Main companion shift financial basis proof',()=>{
  const financialFacts={branchId:branch,shiftId,intentId,action:'RECOUNT',graphPayloadHash:'a'.repeat(64),basisHash:'b'.repeat(64),serverBasisId:'40000000-0000-4000-8000-000000000001',formula:'canonical-exact-decimal-v2'};
  const financialProtocol=require('../../../electron/security/shift-financial-protocol.cjs');
  it.each(['ORIGINAL','RECOUNT'])('reuses the exact sealed key for %s without touching old author records',async action=>{
    const f=fixture(),author=await f.authority.prepare(f.authority.capture(action));
    const before=readFileSync(join(f.directory,readdirSync(f.directory)[0]));
    const proof=author.signFinancialBasis({...financialFacts,action});
    expect(proof).toMatchObject({...financialFacts,action,subject,keyId:author.keyId,authorId});
    const info=f.keys.prepare(author.binding,{expectedKeyId:author.keyId});
    const {signature,...unsigned}=proof;
    expect(require('node:crypto').verify(null,Buffer.from(financialProtocol.financialBasisMessage(unsigned)),{key:Buffer.from(info.publicKey,'base64url'),format:'der',type:'spki'},Buffer.from(signature,'base64url'))).toBe(true);
    expect(f.state.keys).toHaveLength(1);expect(f.state.authors).toHaveLength(0);
    expect(readFileSync(join(f.directory,readdirSync(f.directory)[0]))).toEqual(before);
    const old=author.sign({...facts,action});expect(old.payloadHash).toBe(facts.payloadHash);expect(old).not.toHaveProperty('basisHash');
  });
  it.each(['VARIANCE','START_CLOSE','ENROLL'])('does not expose the new method for %s',async action=>{
    const f=fixture();login(authorId,subject,{...all,can_close_shift:true});
    const author=await f.authority.prepare(f.authority.capture(action));expect(author).not.toHaveProperty('signFinancialBasis');
  });
  it('requires a captured expected key and never creates/replaces one while signing',()=>{
    const f=fixture(),binding=f.authority.binding(authorId),input={subject,...financialFacts};
    expect(()=>f.keys.signFinancialBasis(binding,input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(()=>f.keys.signFinancialBasis(binding,{...input,expectedKeyId:intentId})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'}));
    expect(readdirSync(f.directory)).toEqual([]);
    const info=f.keys.prepare(binding),before=readFileSync(join(f.directory,readdirSync(f.directory)[0]));
    expect(()=>f.keys.signFinancialBasis(binding,{...input,expectedKeyId:intentId})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_KEY_MISMATCH'}));
    expect(readFileSync(join(f.directory,readdirSync(f.directory)[0]))).toEqual(before);
    expect(()=>f.keys.signFinancialBasis(binding,{...input,expectedKeyId:info.keyId,authorId:otherId})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(()=>f.keys.signFinancialBasis(binding,{...input,expectedKeyId:info.keyId,basisHash:'invalid'})).toThrow();
    expect(readFileSync(join(f.directory,readdirSync(f.directory)[0]))).toEqual(before);
  });
  it('rejects foreign branch/action or caller-controlled author/key fields',async()=>{
    const f=fixture(),author=await f.authority.prepare(f.authority.capture('RECOUNT'));
    for(const patch of [{branchId:'B'},{action:'ORIGINAL'},{subject:'other'},{authorId:otherId},{expectedKeyId:intentId}])expect(()=>author.signFinancialBasis({...financialFacts,...patch})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(f.state.authors).toHaveLength(0);
  });
  it.each(['epoch','role','branch','permission','terminal','pool'])('rejects changed %s before signing',async change=>{
    const f=fixture(),author=await f.authority.prepare(f.authority.capture('RECOUNT'));
    if(change==='epoch')login(otherId,'next.person');
    if(change==='role'){session.grant('admin','new.role',all,'pos',branch);session.bindVerifiedAuthor(authorId,subject);}
    if(change==='branch')f.context.branch='B';
    if(change==='permission')login(authorId,subject,{...all,can_shift_cash_recount:false});
    if(change==='terminal')f.context.terminal.tokenId='other-terminal';
    if(change==='pool')f.manager.pool={};
    expect(()=>author.signFinancialBasis(financialFacts)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));expect(f.state.authors).toHaveLength(0);
  });
  it('checks the epoch again after loading/signing with the captured key',async()=>{
    const f=fixture(),author=await f.authority.prepare(f.authority.capture('RECOUNT'));
    const original=f.keys.signFinancialBasis;
    vi.spyOn(f.keys,'signFinancialBasis').mockImplementation((...args:unknown[])=>{const proof=original(...args);login(otherId,'next.person');return proof;});
    expect(()=>author.signFinancialBasis(financialFacts)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));expect(f.state.authors).toHaveLength(0);
  });
  it('never regenerates a captured key that disappears after preparation',async()=>{
    const f=fixture(),author=await f.authority.prepare(f.authority.capture('RECOUNT'));
    unlinkSync(join(f.directory,readdirSync(f.directory)[0]));
    expect(()=>author.signFinancialBasis(financialFacts)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'}));expect(readdirSync(f.directory)).toEqual([]);
  });
});

// FINANCIAL_OPEN is a Main-only signing foundation. No opening writer, receipt
// issuer, database migration or cloud capability is activated by these tests.
describe('Main financial OPEN author foundation',()=>{
  const operationProtocol=require('../../../electron/security/financial-author-protocol.cjs');
  const openingRow={id:shiftId,store_id:branch,terminal_id:'fixture-terminal',status:'OPEN',state:'ACTIVE',opening_float:20,closed_at:null};
  const rowHash=require('node:crypto').createHash('sha256').update(JSON.stringify(openingRow),'utf8').digest('hex');
  const openingPayload=JSON.stringify({version:1,localAggregateId:intentId,shiftId,openingRowHash:rowHash,row:openingRow});
  const input={branchId:branch,operationId:intentId,action:'OPEN',payloadJson:openingPayload};
  it('requires verified can_open_shift and preserves the Operations-only restriction',()=>{
    const f=fixture();expect(()=>f.authority.captureFinancial('OPEN')).toThrowError(expect.objectContaining({code:'PERMISSION_DENIED'}));
    session.grant('admin','admin.identity',{can_close_shift:true},'pos',branch);session.bindVerifiedAuthor(authorId,subject);
    expect(()=>f.authority.captureFinancial('OPEN')).toThrowError(expect.objectContaining({code:'PERMISSION_DENIED'}));
    login(authorId,subject,{can_open_shift:true});expect(f.authority.captureFinancial('OPEN').action).toBe('FINANCIAL_OPEN');
    f.context.management=true;expect(()=>f.authority.captureFinancial('OPEN')).toThrowError(expect.objectContaining({code:'PERMISSION_DENIED'}));
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it('never grants other operation kinds through the OPEN capture',()=>{
    const f=fixture();login(authorId,subject,{can_open_shift:true,...all});
    for(const action of ['SALE','REFUND','TENDER','VOID','FINANCIAL_OPEN'])expect(()=>f.authority.captureFinancial(action)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it('binds exact raw opening bytes, actual stable author and captured key without old-table writes',async()=>{
    const f=fixture();login(authorId,subject,{can_open_shift:true});
    const author=await f.authority.prepare(f.authority.captureFinancial('OPEN'));
    const before=readFileSync(join(f.directory,readdirSync(f.directory)[0]));
    const proof=author.signFinancialOperation(input),info=f.keys.prepare(author.binding,{expectedKeyId:author.keyId});
    expect(proof).toMatchObject({authorId,subject,branchId:branch,terminalId:'fixture-terminal',operationId:intentId,action:'OPEN',keyId:author.keyId,payloadHash:require('node:crypto').createHash('sha256').update(openingPayload,'utf8').digest('hex')});
    const {signature,...unsigned}=proof;
    expect(require('node:crypto').verify(null,Buffer.from(operationProtocol.financialOperationMessage(unsigned)),{key:Buffer.from(info.publicKey,'base64url'),format:'der',type:'spki'},Buffer.from(signature,'base64url'))).toBe(true);
    expect(f.state.authors).toEqual([]);expect(f.state.keys).toHaveLength(1);
    expect(readFileSync(join(f.directory,readdirSync(f.directory)[0]))).toEqual(before);
    const changed=author.signFinancialOperation({...input,payloadJson:openingPayload+' '});expect(changed.payloadHash).not.toBe(proof.payloadHash);
    expect(author).not.toHaveProperty('signFinancialBasis');
  });
  it.each(['ORIGINAL','RECOUNT','VARIANCE','START_CLOSE','ENROLL'])('does not expose operation signing from %s',async action=>{
    const f=fixture();login(authorId,subject,{...all,can_open_shift:true,can_close_shift:true});
    const author=await f.authority.prepare(f.authority.capture(action));expect(author).not.toHaveProperty('signFinancialOperation');
  });
  it('rejects caller scope/hash/subject/key overrides, empty bytes and oversized payloads',async()=>{
    const f=fixture();login(authorId,subject,{can_open_shift:true});
    const author=await f.authority.prepare(f.authority.captureFinancial('OPEN'));
    for(const patch of [{branchId:'B'},{action:'SALE'},{subject:'other'},{expectedKeyId:shiftId},{payloadHash:'a'.repeat(64)},{payloadJson:''},{payloadJson:'é'.repeat(3*1024*1024+1)}])expect(()=>author.signFinancialOperation({...input,...patch})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(f.state.authors).toEqual([]);
  });
  it('requires an expected key and rejects arbitrary binding overrides before key access',()=>{
    const f=fixture(),binding=f.authority.binding(authorId),facts={subject,branchId:branch,operationId:intentId,action:'OPEN',payloadHash:'a'.repeat(64)};
    expect(()=>f.keys.signFinancialOperation(binding,facts)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(()=>f.keys.signFinancialOperation(binding,{...facts,expectedKeyId:shiftId})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'}));
    expect(()=>f.keys.signFinancialOperation(binding,{...facts,expectedKeyId:shiftId,authorId:otherId})).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_INVALID'}));
    expect(()=>f.keys.signFinancialOperation(binding,{...facts,expectedKeyId:shiftId,payloadHash:'invalid'})).toThrow();
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it.each(['epoch','role','branch','terminal','pool'])('rejects changed %s before OPEN signing',async change=>{
    const f=fixture();login(authorId,subject,{can_open_shift:true});const author=await f.authority.prepare(f.authority.captureFinancial('OPEN'));
    if(change==='epoch')login(otherId,'other.person',{can_open_shift:true});
    if(change==='role'){session.grant('supervisor','role.changed',{can_open_shift:true},'pos',branch);session.bindVerifiedAuthor(authorId,subject);}
    if(change==='branch')f.context.branch='B';if(change==='terminal')f.context.terminal.tokenId='other';if(change==='pool')f.manager.pool={};
    expect(()=>author.signFinancialOperation(input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));expect(f.state.authors).toEqual([]);
  });
  it('rechecks the current permission even without a changed session epoch',async()=>{
    const f=fixture();login(authorId,subject,{can_open_shift:true});const author=await f.authority.prepare(f.authority.captureFinancial('OPEN'));
    const check=vi.spyOn(session,'hasPermission').mockReturnValue(false);
    try{expect(()=>author.signFinancialOperation(input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));}finally{check.mockRestore();}
  });
  it('checks session again after signing and never silently recreates a missing captured key',async()=>{
    const f=fixture();login(authorId,subject,{can_open_shift:true});const author=await f.authority.prepare(f.authority.captureFinancial('OPEN'));
    const original=f.keys.signFinancialOperation;
    vi.spyOn(f.keys,'signFinancialOperation').mockImplementation((...args:unknown[])=>{const proof=original(...args);login(otherId,'other.person',{can_open_shift:true});return proof;});
    expect(()=>author.signFinancialOperation(input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));
    const missing=fixture();login(authorId,subject,{can_open_shift:true});const same=await missing.authority.prepare(missing.authority.captureFinancial('OPEN'));
    unlinkSync(join(missing.directory,readdirSync(missing.directory)[0]));
    expect(()=>same.signFinancialOperation(input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'}));expect(readdirSync(missing.directory)).toEqual([]);
  });
});

describe('Main pending opening-origin closing foundation',()=>{
 const p=require('../../../electron/security/shift-financial-protocol.cjs');
 const input={branchId:branch,shiftId,intentId,action:'RECOUNT',graphPayloadHash:'a'.repeat(64),basisHash:'b'.repeat(64),openingOrigin:{localAggregateId:intentId,rowHash:'c'.repeat(64)},formula:'canonical-exact-decimal-v2'};
 it.each(['ORIGINAL','RECOUNT'])('signs %s with the captured closing author and unchanged vault key',async action=>{
  const f=fixture(),author=await f.authority.prepare(f.authority.capture(action)),before=readFileSync(join(f.directory,readdirSync(f.directory)[0]));
  const proof=author.signOpeningFinancialBasis({...input,action}),{signature,...unsigned}=proof,info=f.keys.prepare(author.binding,{expectedKeyId:author.keyId});
  expect(proof).toMatchObject({authorId,subject,openingOrigin:input.openingOrigin});expect(proof).not.toHaveProperty('serverBasisId');
  expect(require('node:crypto').verify(null,Buffer.from(p.openingFinancialBasisMessage(unsigned)),{key:Buffer.from(info.publicKey,'base64url'),format:'der',type:'spki'},Buffer.from(signature,'base64url'))).toBe(true);
  expect(f.state.authors).toEqual([]);expect(readFileSync(join(f.directory,readdirSync(f.directory)[0]))).toEqual(before);
 });
 it('rejects scope overrides, mixed baseline and missing captured keys',async()=>{
  const f=fixture(),author=await f.authority.prepare(f.authority.capture('RECOUNT'));
  for(const patch of [{branchId:'B'},{action:'ORIGINAL'},{serverBasisId:null}])expect(()=>author.signOpeningFinancialBasis({...input,...patch})).toThrow();
  unlinkSync(join(f.directory,readdirSync(f.directory)[0]));expect(()=>author.signOpeningFinancialBasis(input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'}));expect(readdirSync(f.directory)).toEqual([]);
 });
 it.each(['epoch','branch','permission'])('holds changed %s instead of signing as a later operator',async change=>{
  const f=fixture(),author=await f.authority.prepare(f.authority.capture('RECOUNT'));
  if(change==='epoch')login(otherId,'later');if(change==='branch')f.context.branch='B';if(change==='permission')login(authorId,subject,{...all,can_shift_cash_recount:false});
  expect(()=>author.signOpeningFinancialBasis(input)).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));
 });
});
